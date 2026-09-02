import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * CAS (compare-and-swap) state-guard tests.
 *
 * These tests lock in the behavior added in commit c7063f0:
 * `post()`, `cancel()`, and `refund()` use `updateMany WHERE state = '<expected>'`
 * so concurrent transitions can't both succeed. If a peer flips the row first,
 * `updateMany` returns count=0 and we throw ConflictException instead of
 * applying side effects (cash inflow, refund mirror, stock decrement) on top
 * of stale state.
 *
 * Stock cascade (added in V2): post() also calls StockService.lockBalances +
 * assertAvailable + applyDeltas before the cash inflow. We stub StockService
 * with a minimal mock that satisfies the Map<string, StockBalance> contract.
 *
 * We mock Prisma at the tx level — count=0 simulates "lost the race".
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';

interface PrismaLike {
  client: unknown;
}

function makeStockStub() {
  return {
    lockBalances: vi.fn().mockResolvedValue(new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    applyReservationDeltas: vi.fn().mockResolvedValue(undefined),
    // P3 — `false` = «bo'shatiladigan rezerv yo'q» (picking'siz sotilgan
    // chek). Servis shu javobga qarab balanslarni qayta o'qimaydi.
    releaseReservationByDoc: vi.fn().mockResolvedValue(false),
  };
}

function makeMoneyStub() {
  return {
    applyDeltas: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(
  client: unknown,
  stock: ReturnType<typeof makeStockStub> = makeStockStub(),
  money: ReturnType<typeof makeMoneyStub> = makeMoneyStub(),
): RetailSaleService {
  return new RetailSaleService(
    { client } as unknown as PrismaLike as never,
    stock as never,
    money as never,
    undefined as never,
    undefined as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
}

describe('RetailSaleService.post — CAS state guard', () => {
  it('throws ConflictException when updateMany returns count=0 (lost race)', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() endi ajratmani YACHEYKA kesimida quradi va saqlaydi.
      stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
      retailSalePositionAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      retailSale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
      // Kassa TZ §6.1 — post() endi har to`lov turini alohida qator qilib
      // yozadi; qoidalar `retail-tenders.test.ts` da qoplangan.
      retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cashDesk: { update: vi.fn() },
      // Faza Q1: smena agregati `state:'open'` sharti bilan CLAIM qilinadi.
      cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => []) },
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          state: 'draft',
          sumMinor: 100_000n,
          sessionId: SESSION_ID,
          session: {
            id: SESSION_ID,
            state: 'open',
            cashierId: 'cashier-1',
            cashDeskId: CASHDESK_ID,
            storeId: STORE_ID,
            salesCount: 0,
            salesSumMinor: 0n,
            store: { allowNegativeStock: true },
            cashDesk: { currency: 'UZS' },
          },
          positions: [],
        }),
      },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
        return fn(tx);
      }),
    };

    const stock = makeStockStub();
    const money = makeMoneyStub();
    const svc = makeService(client, stock, money);
    await expect(
      svc.post(ACCOUNT, USER_ID, SALE_ID, {
        cashAmountMinor: '100000',
        cardAmountMinor: '0',
        expectedSumMinor: '100000',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Critical: NO side effects must have fired (cash, session, stock, ledger)
    expect(tx.cashierSession.updateMany).not.toHaveBeenCalled();
    expect(stock.applyDeltas).not.toHaveBeenCalled();
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('proceeds with cash inflow + session aggregate when CAS succeeds (count=1)', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
      stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
      retailSalePositionAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      retailSale: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'posted' }),
      },
      // Kassa TZ §6.1 — post() endi har to`lov turini alohida qator qilib
      // yozadi; qoidalar `retail-tenders.test.ts` da qoplangan.
      retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cashDesk: { update: vi.fn().mockResolvedValue({}) },
      // Faza Q1: smena agregati `state:'open'` sharti bilan CLAIM qilinadi.
      cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => []) },
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          state: 'draft',
          sumMinor: 100_000n,
          sessionId: SESSION_ID,
          session: {
            id: SESSION_ID,
            state: 'open',
            cashierId: 'cashier-1',
            cashDeskId: CASHDESK_ID,
            storeId: STORE_ID,
            salesCount: 0,
            salesSumMinor: 0n,
            store: { allowNegativeStock: true },
            cashDesk: { currency: 'UZS' },
          },
          positions: [],
        }),
      },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
        return fn(tx);
      }),
    };

    const money = makeMoneyStub();
    await makeService(client, undefined, money).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '100000',
      cardAmountMinor: '0',
      expectedSumMinor: '100000',
    });

    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
    const moneyArgs = money.applyDeltas.mock.calls[0]?.[2] as Array<{
      sourceKind: string;
      sourceId: string;
      deltaMinor: bigint;
      currency: string;
      documentKind: string;
    }>;
    expect(moneyArgs).toEqual([
      expect.objectContaining({
        sourceKind: 'cash_desk',
        sourceId: CASHDESK_ID,
        deltaMinor: 100_000n,
        currency: 'UZS',
        documentKind: 'retailsale',
      }),
    ]);
    expect(tx.cashierSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it('skips cashDesk.update when cashAmount is zero (card-only payment)', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
      stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
      retailSalePositionAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      retailSale: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'posted' }),
      },
      // Kassa TZ §6.1 — post() endi har to`lov turini alohida qator qilib
      // yozadi; qoidalar `retail-tenders.test.ts` da qoplangan.
      retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cashDesk: { update: vi.fn() },
      // Faza Q1: smena agregati `state:'open'` sharti bilan CLAIM qilinadi.
      cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => []) },
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          state: 'draft',
          sumMinor: 50_000n,
          sessionId: SESSION_ID,
          session: {
            id: SESSION_ID,
            state: 'open',
            cashierId: 'cashier-1',
            cashDeskId: CASHDESK_ID,
            storeId: STORE_ID,
            salesCount: 0,
            salesSumMinor: 0n,
            store: { allowNegativeStock: true },
            cashDesk: { currency: 'UZS' },
          },
          positions: [],
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const money = makeMoneyStub();
    await makeService(client, undefined, money).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '0',
      cardAmountMinor: '50000',
      expectedSumMinor: '50000',
    });
    // Card-only payment must NOT touch the cash ledger.
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('runs the stock cascade for positions with productId and skips service-only rows', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
      stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
      retailSalePositionAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      retailSale: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'posted' }),
      },
      // post() also freezes the price snapshot onto the lines (kassa TZ §5.3)
      // and appends cashier audit events (§9); both are covered on their own in
      // retail-sale-freeze.test.ts / cashier-audit.test.ts.
      retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      // Kassa TZ §6.1 — post() endi har to`lov turini alohida qator qilib
      // yozadi; qoidalar `retail-tenders.test.ts` da qoplangan.
      retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cashDesk: { update: vi.fn().mockResolvedValue({}) },
      // Faza Q1: smena agregati `state:'open'` sharti bilan CLAIM qilinadi.
      cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => []) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      priceType: { findMany: vi.fn().mockResolvedValue([]) },
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          state: 'draft',
          sumMinor: 100_000n,
          sessionId: SESSION_ID,
          session: {
            id: SESSION_ID,
            state: 'open',
            cashierId: 'cashier-1',
            cashDeskId: CASHDESK_ID,
            storeId: STORE_ID,
            salesCount: 0,
            salesSumMinor: 0n,
            store: { allowNegativeStock: true },
            cashDesk: { currency: 'UZS' },
          },
          // `priceMinor` sxemada NOT NULL — P12 narx siyosati (0-narx taqiqi)
          // uni o'qiydi, shuning uchun dublyor ham real qator shaklida turadi.
          positions: [
            { id: 'pos-1', productId: 'prod-1', quantity: 2, priceMinor: 100_000n },
            { id: 'pos-2', productId: null, quantity: 1, priceMinor: 100_000n }, // service line — skip
            { id: 'pos-3', productId: 'prod-2', quantity: 5, priceMinor: 100_000n },
          ],
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const stock = makeStockStub();
    const money = makeMoneyStub();
    await makeService(client, stock, money).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '100000',
      cardAmountMinor: '0',
      expectedSumMinor: '100000',
    });

    // Two product rows in, two deltas out (service row skipped)
    expect(stock.applyDeltas).toHaveBeenCalledTimes(1);
    const deltasArg = stock.applyDeltas.mock.calls[0]?.[3] as Array<{
      assortmentId: string;
      qtyDelta: string;
    }>;
    expect(deltasArg).toHaveLength(2);
    expect(deltasArg.map((d) => d.assortmentId).sort()).toEqual(['prod-1', 'prod-2']);
    // All outflows are negative
    expect(deltasArg.every((d) => d.qtyDelta.startsWith('-'))).toBe(true);
    // Money ledger fired exactly once for the cash inflow
    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
  });
});

/**
 * 2026-08-02 (kassa TZ §9): cancel() endi holat-almashtirish va audit yozuvini
 * BITTA tranzaksiyada bajaradi — poygada yutgan odam jurnalga tushadi,
 * yutqazgani hech narsa yozmaydi. Mock shuni aks ettiradi.
 */
function makeCancelCasClient(casCount: number) {
  const retailSale = {
    findFirst: vi.fn().mockResolvedValue({
      id: SALE_ID,
      state: 'draft',
      name: 'ТРН-1',
      sessionId: SESSION_ID,
      sumMinor: 100_000n,
      positions: [],
    }),
    updateMany: vi.fn().mockResolvedValue({ count: casCount }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'cancelled' }),
  };
  const cashierAuditEvent = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
  return {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    retailSale,
    cashierAuditEvent,
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ retailSale, cashierAuditEvent }),
      ),
  };
}

describe('RetailSaleService.cancel — CAS state guard', () => {
  it('throws ConflictException when the sale was posted between read and cancel', async () => {
    const client = makeCancelCasClient(0);

    await expect(makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Poygani yutqazgan urinish jurnalga HECH NARSA yozmaydi.
    expect(client.cashierAuditEvent.createMany).not.toHaveBeenCalled();
  });

  it('cancels successfully when CAS matches', async () => {
    const client = makeCancelCasClient(1);

    const result = (await makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID)) as {
      state: string;
    };
    expect(result.state).toBe('cancelled');
    // 2026-08-02: qo'riqchi `state: 'draft'` dan FSM jadvalidagi ruxsat etilgan
    // holatlar ro'yxatiga kengaydi (`picking`/`ready` cheklar ham bekor
    // qilinadi — TZ §4). Bu yerdagi eski qat'iy tenglik aynan o'sha tor
    // qo'riqchini qulflab turgan edi.
    expect(client.retailSale.updateMany).toHaveBeenCalledWith({
      where: { id: SALE_ID, accountId: ACCOUNT, state: { in: ['draft', 'picking', 'ready'] } },
      data: { state: 'cancelled' },
    });
  });
});

describe('RetailSaleService.refund — CAS state guard', () => {
  it('throws ConflictException when another refund already flipped state', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
      stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
      retailSalePositionAllocation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      retailSale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
      },
      retailSalePosition: { findMany: vi.fn().mockResolvedValue([]) },
      stockOperation: { findMany: vi.fn().mockResolvedValue([]) },
      // Kassa TZ §6.1 — post() endi har to`lov turini alohida qator qilib
      // yozadi; qoidalar `retail-tenders.test.ts` da qoplangan.
      retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cashDesk: { update: vi.fn() },
      cashierSession: { update: vi.fn() },
    };

    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => []) },
      // F6 (2026-08-13) — refund() tranzaksiyadan oldin qaytaruvchi kassirning
      // JORIY ochiq smenasini topadi; CAS-guard undan KEYIN, tx ichida.
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
        findFirst: vi.fn(),
        // Oldingi qaytarishlar (kumulyativ chegaralar) — bu yerda yo'q.
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    // nextRetailSaleName uses findFirst on retailSale.
    let firstCall = true;
    (client.retailSale.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return {
          id: SALE_ID,
          state: 'posted',
          // SALES-05: qisman qaytarish endi holatni flip qilmaydi, shuning
          // uchun mutex chekning `version` ustuniga ko'chdi.
          version: 1,
          sumMinor: 100_000n,
          sessionId: SESSION_ID,
          agentId: null,
          name: 'TRN-001',
          // SALES-04: qarz ulushi (bu chekda yo'q).
          payments: [],
          session: {
            id: SESSION_ID,
            state: 'open',
            cashierId: 'cashier-1',
            cashDeskId: CASHDESK_ID,
            storeId: STORE_ID,
            cashDesk: { currency: 'UZS' },
          },
          // §105: refund() now loads + validates original positions
          // (over-refund guard). SALES-01: it also PRICES the refund from
          // them, so the money columns are part of the real query shape.
          // Mirror it so this CAS test still exercises posted→refunded.
          positions: [
            {
              productId: '00000000-0000-0000-0000-000000000099',
              quantity: '1',
              priceMinor: 100_000n,
              discount: '0',
              sumMinor: 100_000n,
            },
          ],
        };
      }
      return null;
    });

    const stock = makeStockStub();
    const money = makeMoneyStub();
    await expect(
      makeService(client, stock, money).refund(ACCOUNT, USER_ID, SALE_ID, {
        positions: [
          {
            productId: '00000000-0000-0000-0000-000000000099',
            quantity: '1',
            priceMinor: '100000',
            discount: '0',
          },
        ],
        cashAmountMinor: '100000',
        cardAmountMinor: '0',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Critical: refund mirror must NOT have been created, NO stock restored,
    // and NO money ledger entry written.
    expect(tx.retailSale.create).not.toHaveBeenCalled();
    expect(stock.applyDeltas).not.toHaveBeenCalled();
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });
});
