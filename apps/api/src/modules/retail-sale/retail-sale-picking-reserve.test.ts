import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * P3 (§1.H — H5) — YIG'ILAYOTGAN CHEK TOVARNI USHLAB TURADI.
 *
 * 🔴 O'LCHANGAN BO'SHLIQ (prod, 2026-08-12): `stock_reservations` jadvalida
 * BITTA ham qator yo'q edi, `sendToPicking` esa faqat holat flipi + omborchi
 * topshirig'i yaratardi. Ya'ni «Omborchiga yuborish» bosilgan chek ombor
 * qoldig'iga UMUMAN tegmasdi va ikkinchi kassa o'sha oxirgi donani sotib
 * yuborishi mumkin edi.
 *
 * Minus qoldiq chiqmasdi (`post()` da `assertAvailable` bor) — muammo undan
 * NOZIKROQ: xato eng qimmat lahzaga surilardi. Ikkinchi kassir tovarni
 * yig'ib, mijozni kutdirib, TO'LOV bosganda «qoldiq yetmaydi» xatosini
 * olardi. Egasi qarori (2026-08-12): picking'da rezerv qilinsin.
 *
 * Shartnoma — bitta hujjat bo'yicha uch bo'g'in (zakaz rezervi bilan ayni
 * mexanizm, `StockService.applyReservationDeltas` / `releaseReservationByDoc`):
 *
 *   send-to-picking → `reserve`
 *   cancel          → `release_cancel`
 *   post            → `release_consume`  (`assertAvailable` dan OLDIN)
 *
 * Bu fayl har uch bo'g'inni ALOHIDA va TARTIBI bilan qulflaydi.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const USER_NAME = 'Kassir 1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const STORE_ID = 'store-1';
const PRODUCT_A = 'prod-A';
const PRODUCT_B = 'prod-B';

/**
 * G4 (2026-08-25) — rezerv ham TAQSIMOT bo'yicha quriladi va u qulflangan
 * balansdan o'qiydi, shuning uchun stub endi haqiqiy qoldiq qaytaradi
 * (ilgari bo'sh Map yetardi: yetarlilikni `assertAvailable` stubi hal qilardi).
 */
function makeStockStub(opts: { hasHold?: boolean; unavailable?: boolean } = {}) {
  return {
    lockBalances: vi.fn(
      (
        _tx: unknown,
        _acc: string,
        storeId: string,
        assortments: Array<{ kind: string; id: string }>,
      ) =>
        Promise.resolve(
          new Map(
            assortments.map((a) => [
              a.id,
              {
                storeId,
                assortmentKind: a.kind,
                assortmentId: a.id,
                qty: opts.unavailable ? '0' : '100',
                reservedQty: '0',
                costBalanceMinor: '0',
              },
            ]),
          ),
        ),
    ),
    assertAvailable: vi.fn(() => {
      if (opts.unavailable) {
        throw new BadRequestException('Insufficient stock: prod-A (requested 2, available 1)');
      }
    }),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    applyReservationDeltas: vi.fn().mockResolvedValue(undefined),
    // `hasHold` = hujjatda rostdan rezerv bor edi (servis shundagina
    // balanslarni qayta o'qiydi).
    releaseReservationByDoc: vi.fn().mockResolvedValue(opts.hasHold ?? false),
  };
}

function makeService(client: unknown, stock: ReturnType<typeof makeStockStub>): RetailSaleService {
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

// ─────────────────────────────────────────────────────────────────────────────
// send-to-picking
// ─────────────────────────────────────────────────────────────────────────────

function makePickingClient(opts: { state?: string; positions?: Array<[string, number]> } = {}) {
  const positions = (opts.positions ?? [[PRODUCT_A, 2]]).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
  const tx = {
    documentSequence: mockDocumentSequence(),
    // G4 — post() endi ajratmani YACHEYKA kesimida quradi va saqlaydi.
    stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
    retailSalePositionAllocation: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSale: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        state: opts.state ?? 'draft',
        // Chek `storeId`i ATAYLAB yo'q — POS uni to'ldirmaydi (prodda 17/17
        // chekda NULL). Do'kon SMENADAN olinadi, `post()` bilan bir manba.
        session: { storeId: STORE_ID, store: { allowNegativeStock: false } },
        positions,
      }),
      // `createPickingTasksForSale` best-effort va fon rejimida ketadi;
      // omborchi biriktirilmagan bo'lsa (prodda `sklad_keepers` = 0) u
      // erta chiqadi. Rezerv esa undan MUSTAQIL.
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'picking' }),
    },
    skladKeeper: { findMany: vi.fn().mockResolvedValue([]) },
    store: { findMany: vi.fn(async () => []) },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

describe('P3 — «Omborchiga yuborish» tovarni REZERV qiladi', () => {
  it('har pozitsiya smena do‘konida band qilinadi (docType retailsale, reason reserve)', async () => {
    const { client } = makePickingClient({
      positions: [
        [PRODUCT_A, 2],
        [PRODUCT_B, 3],
      ],
    });
    const stock = makeStockStub();

    await makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME);

    expect(stock.applyReservationDeltas).toHaveBeenCalledTimes(1);
    const deltas = stock.applyReservationDeltas.mock.calls[0][3];
    expect(deltas).toEqual([
      {
        storeId: STORE_ID,
        assortmentKind: 'product',
        assortmentId: PRODUCT_A,
        qtyDelta: '2',
        docType: 'retailsale',
        docId: SALE_ID,
        reason: 'reserve',
      },
      {
        storeId: STORE_ID,
        assortmentKind: 'product',
        assortmentId: PRODUCT_B,
        qtyDelta: '3',
        docType: 'retailsale',
        docId: SALE_ID,
        reason: 'reserve',
      },
    ]);
  });

  it('qulflash rezervdan OLDIN — usiz ikki parallel yuborish reservedQty ni yo‘qotardi', async () => {
    const { client } = makePickingClient();
    const stock = makeStockStub();

    await makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME);

    expect(stock.lockBalances).toHaveBeenCalledTimes(1);
    expect(stock.lockBalances.mock.invocationCallOrder[0]).toBeLessThan(
      stock.applyReservationDeltas.mock.invocationCallOrder[0],
    );
    // Qulf SMENA do'koniga tushadi (rezerv keyin o'sha do'kondan yechiladi).
    expect(stock.lockBalances.mock.calls[0][2]).toBe(STORE_ID);
  });

  /**
   * Rezervning butun ma'nosi shu: yetishmovchilik SAVAT bosilgan lahzada
   * chiqsin, mijoz oldidagi to'lov lahzasida emas.
   */
  it('qoldiq yetmasa yuborilmaydi — holat ham, rezerv ham o‘zgarmaydi', async () => {
    const { client, tx } = makePickingClient();
    const stock = makeStockStub({ unavailable: true });

    await expect(
      makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.retailSale.updateMany).not.toHaveBeenCalled();
    expect(stock.applyReservationDeltas).not.toHaveBeenCalled();
  });

  it('xizmat qatorlari (productId = null) rezerv qilinmaydi', async () => {
    const { client, tx } = makePickingClient({ positions: [] });
    const stock = makeStockStub();
    // Faqat xizmat: `positions` bo'sh emas, lekin productId yo'q.
    client.retailSale.findFirst.mockResolvedValue({
      id: SALE_ID,
      state: 'draft',
      session: { storeId: STORE_ID, store: { allowNegativeStock: false } },
      positions: [{ productId: null, quantity: 1 }],
    });

    await makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME);

    expect(stock.applyReservationDeltas).not.toHaveBeenCalled();
    expect(stock.assertAvailable).not.toHaveBeenCalled();
    // Chek baribir yig'ishga ketadi — xizmat ham yig'ish varaqasiga tushadi.
    expect(tx.retailSale.updateMany).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cancel
// ─────────────────────────────────────────────────────────────────────────────

function makeCancelClient(state: string) {
  const tx = {
    documentSequence: mockDocumentSequence(),
    // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
    stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
    retailSalePositionAllocation: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    retailSale: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    restockTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    store: { findMany: vi.fn(async () => []) },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        state,
        name: 'CHK-1',
        sessionId: SESSION_ID,
        sumMinor: 100_000n,
        session: { storeId: STORE_ID },
        positions: [{ productId: PRODUCT_A, quantity: 2 }],
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'cancelled' }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

describe('P3 — bekor qilingan chek rezervni BO‘SHATADI', () => {
  it.each(['picking', 'ready'])('%s chek bekor qilinsa hold yechiladi', async (state) => {
    const { client } = makeCancelClient(state);
    const stock = makeStockStub({ hasHold: true });

    await makeService(client, stock).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(stock.releaseReservationByDoc).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      USER_ID,
      'retailsale',
      SALE_ID,
      'release_cancel',
    );
  });

  /**
   * Bo'shatish flip bilan BIR tranzaksiyada bo'lishi shart: ajralsa, oradagi
   * xato «chek bekor, tovar abadiy band» holatini qoldirardi — uni yechadigan
   * hujjat endi yo'q (bekor qilingan chekni na post, na qayta cancel qilib
   * bo'ladi).
   */
  it('bo‘shatish flip bilan bir tranzaksiyada', async () => {
    const { client, tx } = makeCancelClient('picking');
    const stock = makeStockStub({ hasHold: true });

    await makeService(client, stock).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.retailSale.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      stock.releaseReservationByDoc.mock.invocationCallOrder[0],
    );
  });

  it('qulflash bo‘shatishdan OLDIN (releaseReservationByDoc shartnomasi)', async () => {
    const { client } = makeCancelClient('picking');
    const stock = makeStockStub({ hasHold: true });

    await makeService(client, stock).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(stock.lockBalances.mock.invocationCallOrder[0]).toBeLessThan(
      stock.releaseReservationByDoc.mock.invocationCallOrder[0],
    );
    expect(stock.lockBalances.mock.calls[0][2]).toBe(STORE_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// post — hold yutiladi, va AYNAN yetarlilik tekshiruvidan OLDIN
// ─────────────────────────────────────────────────────────────────────────────

function makePostClient(state: string) {
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
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: SALE_ID, state: 'posted', agentId: null, sumMinor: 100_000n }),
    },
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashDesk: { update: vi.fn() },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retailSalePosition: { update: vi.fn().mockResolvedValue({}) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const client = {
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    loyaltyProgram: { findFirst: vi.fn(async () => null) },
    product: { findMany: vi.fn(async () => []) },
    // Narx snapshot'i (kassa TZ §5.3) — bu fayl uni tekshirmaydi, lekin
    // `post()` yo'lida turadi. Bo'sh natija = «yig'ilmagan» (NULL≠0).
    priceType: { findMany: vi.fn(async () => []) },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'CHK-1',
        state,
        sumMinor: 100_000n,
        sessionId: SESSION_ID,
        agentId: null,
        customerOrderId: null,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: 'cd-1',
          storeId: STORE_ID,
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: true },
          cashDesk: { currency: 'UZS' },
        },
        positions: [{ id: 'pos-1', productId: PRODUCT_A, quantity: 2, priceMinor: 50_000n }],
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

const PAYMENT = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('P3 — to‘langan chek o‘z holdini YUTADI', () => {
  it('yig‘ilgan chek to‘langanda release_consume yoziladi', async () => {
    const { client } = makePostClient('ready');
    const stock = makeStockStub({ hasHold: true });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(stock.releaseReservationByDoc).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      USER_ID,
      'retailsale',
      SALE_ID,
      'release_consume',
    );
  });

  /**
   * 🔴 TARTIB — bu fazaning eng nozik joyi. Bo'shatish `assertAvailable` dan
   * KEYIN qolsa, chekning O'Z rezervi o'z to'lovini bloklardi: yig'ilgan chek
   * kassada «qoldiq yetmaydi» xatosini olardi. Ya'ni H5 tuzatilib, o'rniga
   * battari qo'yilgan bo'lardi — va bu faqat REZERVLI yo'lda ko'rinardi.
   */
  it('bo‘shatish YETARLILIK QARORIDAN oldin, qoldiq esa qayta o‘qiladi', async () => {
    // G4 (2026-08-25): yetarlilik qarorini endi `assertAvailable` emas,
    // TAQSIMOT qiladi — ajratma qulflangan `qty − rezerv` bilan chegaralangan,
    // ya'ni undan oshib ketolmaydi. Tartib invarianti O'ZGARMADI, faqat
    // «qaror nuqtasi» ko'chdi: uni taqsimotning yacheyka-o'qishi belgilaydi.
    const { client, tx } = makePostClient('ready');
    const stock = makeStockStub({ hasHold: true });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    const planRead = tx.stockByCell.findMany.mock.invocationCallOrder[0] as number;
    expect(stock.releaseReservationByDoc.mock.invocationCallOrder[0]).toBeLessThan(planRead);
    // Bo'shatishdan keyin balanslar ESKIRADI — qayta qulflanadi (2-chaqiruv),
    // aks holda taqsimot bo'shatilgan holdni hamon band deb sanardi.
    expect(stock.lockBalances).toHaveBeenCalledTimes(2);
    expect(stock.lockBalances.mock.invocationCallOrder[1]).toBeLessThan(planRead);
  });

  /**
   * P3 «Sotish» yo'li (picking'siz to'g'ridan-to'g'ri sotuv) — rezerv umuman
   * yaratilmagan. Bo'shatish so'raladi (bitta arzon SELECT), lekin qoldiq
   * QAYTA O'QILMAYDI: hot-path bitta ham ortiqcha qulflovchi so'rov qilmaydi.
   */
  it('rezervsiz (draft) sotuvda qoldiq qayta o‘qilmaydi', async () => {
    const { client } = makePostClient('draft');
    const stock = makeStockStub({ hasHold: false });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(stock.releaseReservationByDoc).toHaveBeenCalledTimes(1);
    expect(stock.lockBalances).toHaveBeenCalledTimes(1);
  });
});
