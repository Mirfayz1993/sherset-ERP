import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * K3 (K-reja 7.1) — bo'linadigan tovar istisnosining SIMLARI.
 *
 * Sof qoida `retail-allocation.test.ts` da qulflangan; bu fayl uchta da'voni
 * tekshiradi:
 *   1. bayroq POZITSIYA bilan birga o'qiladi (qo'shimcha so'rov YO'Q) va
 *      `post()` da bo'linish HAQIQATAN to'xtaydi;
 *   2. bayroq O'CHIQ tovarda xulq BAYT-BAYTGA avvalgidek (qabul mezoni:
 *      «bayroq o'chiq tovarlarda taqsimot mutlaqo o'zgarmagan»);
 *   3. `sendToPicking()` (rezerv) ham AYNI qoidada — aks holda rezerv ikki
 *      ombordan tushib, post() esa rad etardi (bo'shamaydigan hold).
 *
 * Nega kassa TO'XTAMAYDI degan savolga javob 3-testda: bitta manba qoplasa
 * (jonlidagi eng ko'p uchraydigan holat — qoldiqning ~94 % i bitta yacheykasiz
 * hovuzda) sotuv avvalgidek o'tadi.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const USER_NAME = 'Kassir';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const STORE_UN = 'store-unassigned';
const STORE_07 = 'store-07';
const STORE_02 = 'store-02';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const CASCADE_ROWS = [
  { id: STORE_02, name: 'Ombor 02', allowNegativeStock: false, attributes: { __posPriority: 2 } },
  { id: STORE_07, name: 'Ombor 07', allowNegativeStock: false, attributes: { __posPriority: 1 } },
];

function balancesFor(qtyByStore: Record<string, string>) {
  return (
    _tx: unknown,
    _acc: string,
    storeId: string,
    assortments: Array<{ kind: string; id: string }>,
  ) => {
    const qty = qtyByStore[storeId];
    const map = new Map<string, unknown>();
    if (qty !== undefined) {
      for (const a of assortments) {
        map.set(a.id, {
          storeId,
          assortmentKind: a.kind,
          assortmentId: a.id,
          qty,
          reservedQty: '0',
          costBalanceMinor: '0',
        });
      }
    }
    return Promise.resolve(map);
  };
}

function makeStockStub(qtyByStore: Record<string, string> = {}) {
  return {
    lockBalances: vi.fn(balancesFor(qtyByStore)),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    applyReservationDeltas: vi.fn().mockResolvedValue(undefined),
    releaseReservationByDoc: vi.fn().mockResolvedValue(false),
  };
}

function makeService(client: unknown, stock: ReturnType<typeof makeStockStub>) {
  return new RetailSaleService(
    { client } as never,
    stock as never,
    { applyDeltas: vi.fn().mockResolvedValue(undefined) } as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    { applyPayment: async () => {} } as never,
  );
}

/** `pieceTracked` POZITSIYA bilan birga keladi — bu naqshning o'zi qulflanadi. */
function makePostHarness(opts: { pieceTracked: boolean }) {
  const tx = {
    documentSequence: mockDocumentSequence(),
    stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
    // K4 — bayrog'i YOQILGAN tovarda `post()` bo'lak reyestrini ham yopadi
    // (mijozga ketgan bo'lak `sold` bo'ladi). Bu dunyoda reyestr BO'SH, ya'ni
    // K3 ning o'lchovlari o'zgarmaydi.
    stockPiece: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSalePositionAllocation: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSale: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: SALE_ID,
        state: 'posted',
        agentId: null,
        sumMinor: 100_000n,
      }),
    },
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    stockReservation: { findMany: vi.fn().mockResolvedValue([]) },
    stock: { findMany: vi.fn().mockResolvedValue([]) },
    counterpartyBalance: { findFirst: vi.fn(async () => ({ balanceMinor: 0n })) },
  };
  const productFindMany = vi.fn(async () => []);
  const client = {
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => CASCADE_ROWS) },
    product: { findMany: productFindMany },
    priceType: { findMany: vi.fn(async () => []) },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'CHK-1',
        state: 'draft',
        sumMinor: 100_000n,
        sessionId: SESSION_ID,
        agentId: null,
        customerOrderId: null,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: 'cd-1',
          storeId: STORE_UN,
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: false },
          cashDesk: { currency: 'UZS' },
        },
        positions: [
          {
            id: 'pos-1',
            productId: PRODUCT_ID,
            quantity: 2,
            priceMinor: 50_000n,
            discount: 0,
            product: { name: 'UzKabel VVG 2x2.5', pieceTracked: opts.pieceTracked },
          },
        ],
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx, productFindMany };
}

const POST_BODY = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('K3/7.1 — post(): bo`linadigan tovar BO`LINMAYDI', () => {
  it('bayroq YOQILGAN, tovar ikki omborda: 400 va HECH NARSA ayirilmaydi', async () => {
    // 2 dona kerak: 07 da 1, 02 da 1 — hech biri yolg'iz qoplamaydi.
    // Oddiy tovarda bu «bo'linish» bo'lardi; kabelda mijozga ikki bo'lak
    // berib bo'lmaydi.
    const { client } = makePostHarness({ pieceTracked: true });
    const stock = makeStockStub({ [STORE_07]: '1', [STORE_02]: '1' });

    let caught: BadRequestException | null = null;
    try {
      await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);
    } catch (e) {
      caught = e as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const resp = caught?.getResponse() as {
      error: string;
      message: string;
      details: { shortages: Array<{ reason: string; largestSingle?: string }> };
    };
    expect(resp.error).toBe('InsufficientStock');
    expect(resp.details.shortages[0]?.reason).toBe('no-single-source');
    expect(resp.details.shortages[0]?.largestSingle).toBe('1');
    // Xabar «yetarli miqdor yo'q» DEMAYDI — tovar bor, faqat bir bo'lakda emas.
    expect(resp.message).not.toContain("yetarli miqdor yo'q");
    expect(resp.message).toContain('uzluksiz');
    expect(stock.applyDeltas).not.toHaveBeenCalled();
  });

  it('bayroq O`CHIQ, AYNI qoldiq: avvalgidek BO`LINADI (xulq o`zgarmagan)', async () => {
    const { client } = makePostHarness({ pieceTracked: false });
    const stock = makeStockStub({ [STORE_07]: '1', [STORE_02]: '1' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
    }>;
    expect(deltas).toHaveLength(2);
    expect(deltas.map((d) => d.qtyDelta)).toEqual(['-1', '-1']);
  });

  it('bayroq YOQILGAN, bitta manba qoplaydi: sotuv AVVALGIDEK o`tadi', async () => {
    // Jonlidagi eng ko'p uchraydigan holat (qoldiqning ~94 % i yacheykasiz
    // hovuzda) — kassa TO'XTAMAYDI.
    const { client } = makePostHarness({ pieceTracked: true });
    const stock = makeStockStub({ [STORE_07]: '10' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
    }>;
    expect(deltas).toHaveLength(1);
    expect(deltas[0].storeId).toBe(STORE_07);
    expect(deltas[0].qtyDelta).toBe('-2');
  });

  it('bayroq uchun QO`SHIMCHA so`rov yuborilmaydi (pozitsiya bilan keladi)', async () => {
    const { client, productFindMany } = makePostHarness({ pieceTracked: true });
    const stock = makeStockStub({ [STORE_07]: '10' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    // Yagona `product.findMany` — narx snapshot'i (`loadFrozenPrices`).
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany.mock.calls[0]?.[0]).toMatchObject({
      select: { id: true, name: true, buyPrice: true, salePrices: true },
    });
  });
});

// ── sendToPicking() ────────────────────────────────────────────────────────

function makePickingHarness(opts: { pieceTracked: boolean }) {
  const tx = {
    documentSequence: mockDocumentSequence(),
    stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
    retailSalePositionAllocation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSale: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    store: { findMany: vi.fn(async () => CASCADE_ROWS) },
    skladKeeper: { findMany: vi.fn().mockResolvedValue([]) },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        state: 'draft',
        name: 'CHK-1',
        storeId: null,
        store: null,
        session: {
          storeId: STORE_UN,
          store: { allowNegativeStock: false, name: 'Taqsimlanmagan' },
        },
        positions: [
          {
            id: 'pos-1',
            productId: PRODUCT_ID,
            quantity: 2,
            product: { pieceTracked: opts.pieceTracked },
          },
        ],
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'picking' }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

describe('K3/7.1 — sendToPicking(): rezerv ham bo`linmaydi', () => {
  it('bayroq YOQILGAN, tovar ikki omborda: 400, rezerv YOZILMAYDI', async () => {
    // Rezerv ikki ombordan tushsa, post() esa uni rad etardi ⇒ hech qachon
    // bo'shamaydigan hold. Xato mijoz oldida emas, savat bosilgan lahzada.
    const { client } = makePickingHarness({ pieceTracked: true });
    const stock = makeStockStub({ [STORE_07]: '1', [STORE_02]: '1' });

    await expect(
      makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stock.applyReservationDeltas).not.toHaveBeenCalled();
  });

  it('bayroq O`CHIQ: rezerv avvalgidek ikki ombordan tushadi', async () => {
    const { client } = makePickingHarness({ pieceTracked: false });
    const stock = makeStockStub({ [STORE_07]: '1', [STORE_02]: '1' });

    await makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME);

    const deltas = stock.applyReservationDeltas.mock.calls[0][3] as Array<{ qtyDelta: string }>;
    expect(deltas).toHaveLength(2);
  });
});
