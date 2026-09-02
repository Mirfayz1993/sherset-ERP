import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * SALES-01 (CRITICAL) + FE-01 — the refund payout must be bounded by the
 * ORIGINAL receipt, not by numbers the client sent.
 *
 * The hole: `refund()` ran `parsed.positions[].priceMinor` through
 * `computePositions()` and then called `validateRefundAmount(thatTotal, …)` —
 * the cap and the thing being capped came from the same request body. A caller
 * holding `retailsale:approve` (any cashier) could refund a 10 000 so'm item
 * with `priceMinor: 10000000` and MoneyService would take the cash out of the
 * till. Every other guard (qty-subset, payout ≤ refund sum) passed.
 *
 * These tests exercise `refund()` end-to-end against a mocked Prisma so the
 * WIRING is covered too — pricing the refund correctly in a pure helper is
 * worthless if the service keeps reading the client's price.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';
/** Zod'да `productId` uuid — schema-parse ni o'tishi uchun haqiqiy uuid. */
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

interface OriginalPosition {
  productId: string | null;
  quantity: string;
  priceMinor: bigint;
  discount: string;
  sumMinor: bigint;
  costMinor?: bigint | null;
  basePriceMinor?: bigint | null;
}

function makeHarness(positions: OriginalPosition[]) {
  const created: { data: Record<string, unknown> }[] = [];
  const moneyApplyDeltas = vi.fn().mockResolvedValue(undefined);
  const stockApplyDeltas = vi.fn().mockResolvedValue(undefined);

  const tx = {
    // G4 — post() endi ajratmani YACHEYKA kesimida quradi va saqlaydi.
    stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
    retailSalePositionAllocation: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSale: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return { id: 'refund-1', ...args.data };
      }),
    },
    retailSalePosition: { findMany: vi.fn().mockResolvedValue([]) },
    stockOperation: { findMany: vi.fn().mockResolvedValue([]) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // refund() endi smenani post() dagi SALES-07 naqshida SHARTLI claim
    // qiladi (`updateMany where state:'open'`) — dublyor shu yuzani beradi.
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    bonusOperation: { findFirst: vi.fn(async () => null) },
    // F6 (2026-08-13) — refund() qaytaruvchi kassirning JORIY ochiq smenasini
    // topadi; bu jihozda u ASL chek smenasining o'zi (bir-smena stsenariysi),
    // shuning uchun pul/summa assertlari o'zgarmaydi.
    cashierSession: {
      findFirst: vi.fn(async () => ({
        id: SESSION_ID,
        cashierId: 'cashier-1',
        cashDeskId: CASHDESK_ID,
        storeId: STORE_ID,
        cashDesk: { currency: 'UZS' },
      })),
    },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'ТРН-2026-00001',
        state: 'posted',
        // SALES-05: refund() endi chekni versiya bo'yicha qulflaydi va
        // qaytarilgan ulushni asl summaga nisbatan hisoblaydi.
        version: 1,
        sumMinor: positions.reduce((a, p) => a + p.sumMinor, 0n),
        sessionId: SESSION_ID,
        agentId: null,
        // SALES-04: chek qanday to'langani (qarz ulushi bormi) — bu yerda
        // sof pul chekи, qarz yo'q.
        payments: [],
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: CASHDESK_ID,
          storeId: STORE_ID,
          cashDesk: { currency: 'UZS' },
        },
        positions: positions.map((p) => ({
          costMinor: null,
          basePriceMinor: null,
          ...p,
        })),
      }),
      // Oldingi qaytarishlar yo'q (kumulyativ chegaralar uchun).
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const svc = new RetailSaleService(
    { client } as never,
    { applyDeltas: stockApplyDeltas } as never,
    { applyDeltas: moneyApplyDeltas } as never,
    { createOperation: vi.fn() } as never,
    undefined as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
  return { svc, tx, created, moneyApplyDeltas };
}

/** 1 dona 1 000 000 tiyinga, 10% chegirma → mijoz 900 000 to'lagan. */
const DISCOUNTED: OriginalPosition[] = [
  {
    productId: PRODUCT_ID,
    quantity: '1',
    priceMinor: 1_000_000n,
    discount: '10',
    sumMinor: 900_000n,
  },
];

describe('RetailSaleService.refund — payout is capped by the ORIGINAL receipt', () => {
  it('REJECTS a refund priced above the original line (SALES-01 over-refund)', async () => {
    const { svc, moneyApplyDeltas } = makeHarness([
      {
        productId: PRODUCT_ID,
        quantity: '1',
        priceMinor: 10_000n,
        discount: '0',
        sumMinor: 10_000n,
      },
    ]);

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, {
        positions: [
          { productId: PRODUCT_ID, quantity: '1', priceMinor: '10000000', discount: '0' },
        ],
        cashAmountMinor: '10000000',
        cardAmountMinor: '0',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The till must not have been touched.
    expect(moneyApplyDeltas).not.toHaveBeenCalled();
  });

  it('prices the mirror receipt from the original — not from the inflated request', async () => {
    const { svc, created } = makeHarness([
      {
        productId: PRODUCT_ID,
        quantity: '1',
        priceMinor: 10_000n,
        discount: '0',
        sumMinor: 10_000n,
      },
    ]);

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, {
      positions: [{ productId: PRODUCT_ID, quantity: '1', priceMinor: '10000000', discount: '0' }],
      cashAmountMinor: '10000',
      cardAmountMinor: '0',
    });

    expect(created[0]?.data.sumMinor).toBe(10_000n);
  });

  it('refunds a DISCOUNTED receipt at the discounted sum, not the list price (FE-01)', async () => {
    const { svc, created, moneyApplyDeltas } = makeHarness(DISCOUNTED);

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, {
      positions: [{ productId: PRODUCT_ID, quantity: '1', priceMinor: '1000000', discount: '0' }],
      cashAmountMinor: '900000',
      cardAmountMinor: '0',
    });

    expect(created[0]?.data.sumMinor).toBe(900_000n);
    const deltas = moneyApplyDeltas.mock.calls[0]?.[2];
    expect(deltas[0].deltaMinor).toBe(-900_000n);
  });

  it('REJECTS paying back the full list price of a discounted receipt', async () => {
    const { svc, moneyApplyDeltas } = makeHarness(DISCOUNTED);

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, {
        positions: [{ productId: PRODUCT_ID, quantity: '1', priceMinor: '1000000', discount: '0' }],
        // 1 000 000 was never paid — only 900 000 was.
        cashAmountMinor: '1000000',
        cardAmountMinor: '0',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moneyApplyDeltas).not.toHaveBeenCalled();
  });

  it('prorates a partial refund (Σ refund ≤ original.sumMinor)', async () => {
    const { svc, created } = makeHarness([
      {
        productId: PRODUCT_ID,
        quantity: '10',
        priceMinor: 100_000n,
        discount: '10',
        sumMinor: 900_000n,
      },
    ]);

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, {
      positions: [{ productId: PRODUCT_ID, quantity: '3', priceMinor: '100000', discount: '0' }],
      cashAmountMinor: '270000',
      cardAmountMinor: '0',
    });

    expect(created[0]?.data.sumMinor).toBe(270_000n);
  });

  it('writes the ORIGINAL price/discount onto the mirror line', async () => {
    const { svc, created } = makeHarness(DISCOUNTED);

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, {
      positions: [{ productId: PRODUCT_ID, quantity: '1', priceMinor: '7', discount: '99' }],
      cashAmountMinor: '0',
      cardAmountMinor: '0',
    });

    const rows = (created[0]?.data.positions as { create: Record<string, unknown>[] }).create;
    expect(rows[0]?.priceMinor).toBe(1_000_000n);
    expect(rows[0]?.discount).toBe('10');
    expect(rows[0]?.sumMinor).toBe(900_000n);
  });

  it('accepts a request that omits priceMinor/discount entirely (server prices it)', async () => {
    const { svc, created } = makeHarness(DISCOUNTED);

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, {
      positions: [{ productId: PRODUCT_ID, quantity: '1' }],
      cashAmountMinor: '900000',
      cardAmountMinor: '0',
    });

    expect(created[0]?.data.sumMinor).toBe(900_000n);
  });
});
