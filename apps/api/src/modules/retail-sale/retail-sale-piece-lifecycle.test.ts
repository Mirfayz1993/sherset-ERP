import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * K4/6-vazifa — CHEK HAYOTIY SIKLI va bo'lak reyestri.
 *
 * Uch da'vo:
 *   1. `post()` — mijozga ketgan bo'lak qoldiq ayirish TRANZAKSIYASI ICHIDA
 *      reyestrdan chiqadi (`sold`). Ajralsa sverka o'sha ondayoq yolg'on
 *      farq berardi;
 *   2. 🔴 `cancel()` — bo'lak OMBORDA QOLADI, faqat «mijoz oldida turibdi»
 *      bog'lanishi uziladi. Kesilgan kabelni qaytarib ulab bo'lmaydi
 *      (K-reja 2-bo'lim: «mijoz voz kechsa hech nima buzilmaydi»);
 *   3. kassirning bo'lak kelishuvi («150+30») chek qatoriga YOZILADI —
 *      K3 da u faqat savatda qolardi va omborchiga yetib bormasdi.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const STORE = 'store-1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function makeStockStub() {
  return {
    lockBalances: vi.fn(
      async (
        _t: unknown,
        _a: string,
        storeId: string,
        assortments: Array<{ kind: string; id: string }>,
      ) => {
        const map = new Map<string, unknown>();
        for (const a of assortments) {
          map.set(a.id, {
            storeId,
            assortmentKind: a.kind,
            assortmentId: a.id,
            qty: '1000',
            reservedQty: '0',
            costBalanceMinor: '0',
          });
        }
        return map;
      },
    ),
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

/** `post()` uchun dunyo: bitta qator, unga ikkita kesilgan bo'lak biriktirilgan. */
function makePostWorld(pieces: Array<{ id: string; length: string; status?: string }>) {
  const pieceUpdateMany = vi.fn().mockResolvedValue({ count: pieces.length });
  const tx = {
    documentSequence: mockDocumentSequence(),
    stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
    stockPiece: {
      findMany: vi.fn().mockResolvedValue(
        pieces.map((p) => ({
          id: p.id,
          reservedPositionId: 'pos-1',
          length: { toString: () => p.length },
          status: p.status ?? 'active',
        })),
      ),
      updateMany: pieceUpdateMany,
    },
    retailSalePositionAllocation: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSale: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: SALE_ID, state: 'posted', agentId: null, sumMinor: 100_000n }),
    },
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    stockReservation: { findMany: vi.fn().mockResolvedValue([]) },
    stock: { findMany: vi.fn().mockResolvedValue([]) },
    counterpartyBalance: { findFirst: vi.fn(async () => ({ balanceMinor: 0n })) },
  };
  const client = {
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
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
          storeId: STORE,
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: false },
          cashDesk: { currency: 'UZS' },
        },
        positions: [
          {
            id: 'pos-1',
            productId: PRODUCT_ID,
            quantity: 180,
            priceMinor: 555n,
            discount: 0,
            product: { name: 'UzKabel VVG 2x2.5', pieceTracked: true },
          },
        ],
      }),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx, pieceUpdateMany };
}

const POST_BODY = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('K4 — post(): bo`lak reyestrdan chiqadi', () => {
  it('kesilgan bo`laklar `sold` bo`ladi — qoldiq ayirish bilan BIR tranzaksiyada', async () => {
    const w = makePostWorld([
      { id: 'piece-a', length: '150' },
      { id: 'piece-b', length: '30' },
    ]);
    const stock = makeStockStub();
    await makeService(w.client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    expect(w.pieceUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['piece-a', 'piece-b'] } },
      data: expect.objectContaining({ status: 'consumed', consumedReason: 'sold' }),
    });
    // Qoldiq ayirish HAM bo'ldi: reyestr va qoldiq bir-birini kutmaydi.
    expect(stock.applyDeltas).toHaveBeenCalledTimes(1);
    // Ikkalasi ham AYNI tranzaksiya obyektida.
    expect(w.client.$transaction).toHaveBeenCalledTimes(1);
  });

  it("bo'lagi yo'q chek (reyestr bo'sh) — sotuv AVVALGIDEK o'tadi", async () => {
    const w = makePostWorld([]);
    const stock = makeStockStub();
    await makeService(w.client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    expect(w.pieceUpdateMany).not.toHaveBeenCalled();
    expect(stock.applyDeltas).toHaveBeenCalledTimes(1);
  });

  it('🔴 nomuvofiqlik (bo`laklar ≠ chek miqdori) sotuvni TO`XTATMAYDI', async () => {
    // 180 m sotilyapti, biriktirilgani 150 m. To'lov paytida chekni rad etish
    // 2026-08-24 hodisasining aynan shakli bo'lardi — sotuv o'tadi, faqat
    // log'da ko'rinadi.
    const w = makePostWorld([{ id: 'piece-a', length: '150' }]);
    const stock = makeStockStub();
    await expect(
      makeService(w.client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY),
    ).resolves.toBeDefined();
    expect(w.pieceUpdateMany).toHaveBeenCalled();
  });
});

describe('K4 — cancel(): bo`lak OMBORDA qoladi', () => {
  function makeCancelWorld() {
    const pieceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      documentSequence: mockDocumentSequence(),
      retailSale: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      stockPiece: { updateMany: pieceUpdateMany },
      stockReservation: { findMany: vi.fn().mockResolvedValue([]) },
      cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const client = {
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          state: 'picking',
          name: 'CHK-1',
          sessionId: SESSION_ID,
          sumMinor: 100_000n,
          session: { storeId: STORE },
          positions: [
            {
              productId: PRODUCT_ID,
              quantity: 180,
              // K4 — bayroq POZITSIYA bilan keladi (qo'shimcha so'rov yo'q).
              product: { pieceTracked: true },
            },
          ],
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'cancelled' }),
      },
      store: { findMany: vi.fn(async () => []) },
      // Bekor qilingan chekning yig'ish topshiriqlari ham yopiladi (P3).
      restockTask: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { client, tx, pieceUpdateMany };
  }

  it('faqat BOG`LANISH uziladi — `status` TEGILMAYDI', async () => {
    const w = makeCancelWorld();
    await makeService(w.client, makeStockStub()).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(w.pieceUpdateMany).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT, reservedSaleId: SALE_ID, status: 'active' },
      data: { reservedSaleId: null, reservedPositionId: null },
    });
    const data = w.pieceUpdateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    // 🔴 Bo'lak `consumed` QILINMAYDI: u jismonan javonda turibdi va ertaga
    // boshqa mijozga ketadi. Qoldiq ham o'zgarmaydi (kesim stok-neytral edi).
    expect(data.status).toBeUndefined();
    expect(data.consumedReason).toBeUndefined();
  });
});

describe('K4 — kassirning bo`lak kelishuvi chekka yoziladi', () => {
  it('`pieceLengths` chek qatoriga «150+30» bo`lib tushadi', async () => {
    const created = vi.fn().mockResolvedValue({ id: SALE_ID, positions: [] });
    const client = {
      cashierSession: {
        findFirst: vi.fn(async () => ({
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          storeId: STORE,
        })),
      },
      employee: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
      retailSale: {
        findFirst: vi.fn(async () => null),
        create: created,
        count: vi.fn(async () => 0),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({})),
    };

    const svc = makeService(client, makeStockStub());
    // `nextRetailSaleName` ichki so'rovlarini chetlab o'tish uchun uni
    // vaqtincha almashtiramiz — bu test FAQAT `pieceLengths` simini o'lchaydi.
    (svc as unknown as { nextRetailSaleName: () => Promise<string> }).nextRetailSaleName =
      async () => 'CHK-1';

    await svc.create(ACCOUNT, {
      sessionId: '22222222-2222-4222-8222-222222222222',
      positions: [
        {
          productId: PRODUCT_ID,
          quantity: '180',
          priceMinor: '555',
          discount: '0',
          pieceLengths: ['150', '30'],
        },
        // Bo'linmagan qator — kelishuv saqlanmaydi (izoh `formatPieceLengths`).
        {
          productId: PRODUCT_ID,
          quantity: '5',
          priceMinor: '100',
          discount: '0',
        },
      ],
    });

    const rows = created.mock.calls[0]?.[0]?.data?.positions?.create as Array<
      Record<string, unknown>
    >;
    expect(rows[0]?.pieceLengths).toBe('150+30');
    expect(rows[1]?.pieceLengths).toBeNull();
  });
});
