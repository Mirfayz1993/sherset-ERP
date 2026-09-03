import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * Kassa TZ §5.3 — `post()` freezes cost + base price onto the receipt lines.
 *
 * What these tests defend, in order of how badly each would hurt:
 *   1. the numbers are written at all, and from the product CARD (not the line);
 *   2. an absent cost is written as NULL, never coerced to 0 — a 0 cost is what
 *      makes a report claim 100% margin;
 *   3. the write is inside the post transaction, so a receipt that fails to post
 *      is not left holding a snapshot;
 *   4. a lost CAS race writes nothing at all.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';
const DEFAULT_TYPE = 'pt-retail';

function makeStockStub() {
  return {
    lockBalances: vi.fn().mockResolvedValue(new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    applyReservationDeltas: vi.fn().mockResolvedValue(undefined),
    // P3 — `false` = bo'shatiladigan rezerv yo'q edi.
    releaseReservationByDoc: vi.fn().mockResolvedValue(false),
  };
}

function makeMoneyStub() {
  return { applyDeltas: vi.fn().mockResolvedValue(undefined) };
}

interface Position {
  id: string;
  productId: string | null;
  quantity: string;
  /** post() bularni audit hodisalari uchun o'qiydi (kassa TZ §9). */
  priceMinor?: bigint;
  product?: { name: string } | null;
}

interface ProductCard {
  id: string;
  buyPrice: bigint | null;
  salePrices: unknown;
}

function makeHarness(opts: {
  positions: Position[];
  products: ProductCard[];
  casCount?: number;
  defaultPriceTypeId?: string | null;
}) {
  const positionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
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
      updateMany: vi.fn().mockResolvedValue({ count: opts.casCount ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: SALE_ID,
        state: 'posted',
        agentId: null,
        sumMinor: 100_000n,
      }),
    },
    retailSalePosition: { updateMany: positionUpdateMany },
    // post() endi kassir audit hodisalarini ham shu tranzaksiyada yozadi
    // (kassa TZ §9) — alohida `cashier-audit.test.ts` da qoplangan.
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // Kassa TZ §6.1 — post() endi har to'lov turini alohida qator qilib
    // yozadi; qoidalar `retail-tenders.test.ts` da qoplangan.
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashDesk: { update: vi.fn().mockResolvedValue({}) },
    cashierSession: {
      update: vi.fn().mockResolvedValue({}),
      // Faza Q1: post() smenani `state:'open'` sharti bilan CLAIM qiladi.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const productFindMany = vi.fn().mockResolvedValue(opts.products);
  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: { findMany: productFindMany },
    // Narx turlari `position` bo'yicha o'qiladi: birinchi non-default = optom
    // chegara (audit uchun). `defaultPriceTypeId: null` = hisobda narx turi yo'q.
    priceType: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          opts.defaultPriceTypeId === null
            ? []
            : [{ id: opts.defaultPriceTypeId ?? DEFAULT_TYPE, isDefault: true }],
        ),
    },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'ТРН-2026-00001',
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
        // Audit hodisalari uchun kerakli maydonlar sukut bilan to'ldiriladi —
        // bu fayl MUZLATISHNI sinaydi, hodisalar `cashier-audit.test.ts` da.
        positions: opts.positions.map((p) => ({
          product: null,
          // P12 dan keyin 0-narx qatori bilan chek POST BO'LMAYDI (egasining
          // qarori) — sukut narx bu fayldagi har bir kartaning polidan yuqori
          // olindi, aks holda muzlatish testlari narx siyosatiga urilib qolardi.
          priceMinor: 3_600_000n,
          discount: '0',
          ...p,
        })),
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const svc = new RetailSaleService(
    { client } as never,
    makeStockStub() as never,
    makeMoneyStub() as never,
    undefined as never,
    undefined as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
  return { svc, tx, client, positionUpdateMany, productFindMany };
}

const PAYMENT = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('RetailSaleService.post — price freeze', () => {
  it('writes the card cost + retail tier onto the line', async () => {
    const { svc, positionUpdateMany } = makeHarness({
      positions: [{ id: 'pos-1', productId: 'p1', quantity: '2' }],
      products: [
        {
          id: 'p1',
          buyPrice: 2_480_000n,
          salePrices: [
            { priceTypeId: 'pt-wholesale', value: '2800000' },
            { priceTypeId: DEFAULT_TYPE, value: '3600000' },
          ],
        },
      ],
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(positionUpdateMany).toHaveBeenCalledTimes(1);
    expect(positionUpdateMany).toHaveBeenCalledWith({
      where: { retailSaleId: SALE_ID, accountId: ACCOUNT, productId: 'p1' },
      data: { costMinor: 2_480_000n, basePriceMinor: 3_600_000n },
    });
  });

  it('writes NULL cost — never 0 — when the card has no buyPrice', async () => {
    const { svc, positionUpdateMany } = makeHarness({
      positions: [{ id: 'pos-1', productId: 'p1', quantity: '1' }],
      products: [
        { id: 'p1', buyPrice: null, salePrices: [{ priceTypeId: DEFAULT_TYPE, value: '500' }] },
      ],
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    const data = positionUpdateMany.mock.calls[0]?.[0]?.data;
    expect(data).toEqual({ costMinor: null, basePriceMinor: 500n });
    // Explicit: a NULL cost must not have been rewritten as a zero cost.
    expect(data.costMinor).not.toBe(0n);
  });

  it('skips the write entirely for a product with no cost and no price', async () => {
    const { svc, positionUpdateMany } = makeHarness({
      positions: [{ id: 'pos-1', productId: 'p1', quantity: '1' }],
      products: [{ id: 'p1', buyPrice: null, salePrices: null }],
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(positionUpdateMany).not.toHaveBeenCalled();
  });

  it('issues ONE statement per distinct product, not per line', async () => {
    const { svc, positionUpdateMany } = makeHarness({
      positions: [
        { id: 'pos-1', productId: 'p1', quantity: '1' },
        { id: 'pos-2', productId: 'p1', quantity: '3' },
        { id: 'pos-3', productId: 'p2', quantity: '1' },
      ],
      products: [
        { id: 'p1', buyPrice: 100n, salePrices: [{ priceTypeId: DEFAULT_TYPE, value: '300' }] },
        { id: 'p2', buyPrice: 700n, salePrices: [{ priceTypeId: DEFAULT_TYPE, value: '900' }] },
      ],
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(positionUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('ignores service-only lines (productId === null) without querying for them', async () => {
    const { svc, positionUpdateMany, productFindMany } = makeHarness({
      positions: [{ id: 'pos-1', productId: null, quantity: '1' }],
      products: [],
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(productFindMany).not.toHaveBeenCalled();
    expect(positionUpdateMany).not.toHaveBeenCalled();
  });

  it('writes nothing when the CAS state guard loses the race', async () => {
    const { svc, positionUpdateMany } = makeHarness({
      positions: [{ id: 'pos-1', productId: 'p1', quantity: '1' }],
      products: [
        { id: 'p1', buyPrice: 100n, salePrices: [{ priceTypeId: DEFAULT_TYPE, value: '300' }] },
      ],
      casCount: 0,
    });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(positionUpdateMany).not.toHaveBeenCalled();
  });

  it('still resolves a base price when the account has no default PriceType', async () => {
    const { svc, positionUpdateMany } = makeHarness({
      positions: [{ id: 'pos-1', productId: 'p1', quantity: '1' }],
      products: [
        { id: 'p1', buyPrice: 10n, salePrices: [{ priceTypeId: 'default', value: '250' }] },
      ],
      defaultPriceTypeId: null,
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(positionUpdateMany.mock.calls[0]?.[0]?.data).toEqual({
      costMinor: 10n,
      basePriceMinor: 250n,
    });
  });
});
