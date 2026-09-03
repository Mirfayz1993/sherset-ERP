import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * F6 — kaskadning SIMLARI: `Store.attributes.__posPriority` sozlangan bo'lsa
 * post/picking/cancel/refund stok amallari SMENA omborida emas, KASKADNING
 * BIRINCHI omborida («Ombor 07») yuradi; sozlanmagan bo'lsa xulq eskisidek.
 * Sof taqsimot mantiqi `retail-stock-cascade.test.ts` da — bu fayl WIRING
 * uchun: to'g'ri hisob noto'g'ri omborga ulansa qiymati yo'q.
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

/** «Kassa oldidagi ombor» bayrog'i qo'yilgan variant (G4 3-qoidasi uchun). */
const CASCADE_ROWS_FRONT = [
  { id: STORE_02, name: 'Ombor 02', allowNegativeStock: false, attributes: { __posPriority: 2 } },
  {
    id: STORE_07,
    name: 'Ombor 07',
    allowNegativeStock: false,
    attributes: { __posPriority: 1, __posFrontStore: true },
  },
];

/**
 * G4 (2026-08-25) — yetarlilik qarorini endi `assertAvailable` emas, TAQSIMOT
 * qiladi va u qulflangan balansdan o'qiydi. Shuning uchun stub `lockBalances`
 * ombor bo'yicha HAQIQIY qoldiq qaytarishi kerak (ilgari bo'sh Map yetardi).
 */
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

// ── post() ────────────────────────────────────────────────────────────────

function makePostHarness(opts: { stores: unknown[] }) {
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
  const client = {
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => opts.stores) },
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
            product: { name: 'Tovar A' },
          },
        ],
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

const POST_BODY = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('F6 — post(): stok ombori kaskaddan', () => {
  it('kaskad sozlangan: ayirish tovar TURGAN ombordan (07), smena omboridan emas', async () => {
    // G4: ombor endi «kaskadning birinchisi» bo'lgani uchun emas, TOVAR o'sha
    // yerda bo'lgani uchun tanlanadi. Bu holatda faqat 07 da qoldiq bor.
    const { client } = makePostHarness({ stores: CASCADE_ROWS });
    const stock = makeStockStub({ [STORE_07]: '10' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    expect(stock.lockBalances.mock.calls[0][2]).toBe(STORE_07);
    expect(stock.applyDeltas).toHaveBeenCalledTimes(1);
    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
      cellId: string | null;
      cellMode: string;
    }>;
    expect(deltas).toHaveLength(1);
    expect(deltas[0].storeId).toBe(STORE_07);
    expect(deltas[0].qtyDelta).toBe('-2');
    // Yacheykasiz ajratma ⇒ `store-only`: `applyDeltas` band yacheykalardan
    // KATTA-BIRINCHI avtomat ayirmasin (sanalgan yacheykani buzardi).
    expect(deltas[0].cellId).toBeNull();
    expect(deltas[0].cellMode).toBe('store-only');
  });

  it('🔴 07 yetmasa: qolgani BOSHQA ombordan AVTOMATIK (tasdiq YO‘Q)', async () => {
    // Egasining Q1-v2 qarori (2026-08-24): «omborchi ruxsati degan narsa yo'q».
    // Aynan eski tasdiq-to'siq 2026-08-24 06:46 da kassani to'xtatib qo'ygan edi.
    const { client } = makePostHarness({ stores: CASCADE_ROWS });
    const stock = makeStockStub({ [STORE_07]: '1', [STORE_02]: '10' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    expect(stock.applyDeltas).toHaveBeenCalledTimes(1);
    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
    }>;
    // 2 dona kerak: 07 da 1 ta yolg'iz qoplamaydi ⇒ yolg'iz qoplaydigan
    // ENG KICHIK manba — Ombor 02 (10 ta). Hammasi bitta joydan.
    expect(deltas).toHaveLength(1);
    expect(deltas[0].storeId).toBe(STORE_02);
    expect(deltas[0].qtyDelta).toBe('-2');
  });

  it('kaskad sozlanmagan: eski xulq — smena ombori, hold-so‘rovi ham YO‘Q', async () => {
    const { client, tx } = makePostHarness({
      stores: [{ id: STORE_UN, name: 'Taqsimlanmagan', allowNegativeStock: false, attributes: {} }],
    });
    const stock = makeStockStub({ [STORE_UN]: '10' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    expect(stock.lockBalances.mock.calls[0][2]).toBe(STORE_UN);
    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{ storeId: string }>;
    expect(deltas[0].storeId).toBe(STORE_UN);
    // Kaskadsiz yo'l bitta ham ortiqcha so'rov qilmaydi (post()dagi izoh).
    expect(tx.stockReservation.findMany).not.toHaveBeenCalled();
  });

  it('HECH QAYERDA yetmasa: 400, hech narsa ayirilmaydi', async () => {
    // Eski xulq (F6) «bosh omborchi tasdig'i kerak» der edi — egasi uni BEKOR
    // QILDI. Endi 400 faqat HAQIQIY defitsitda: tizimning hech bir omborida
    // yetarli tovar yo'q.
    const { client } = makePostHarness({ stores: CASCADE_ROWS });
    const stock = makeStockStub({ [STORE_07]: '1' });

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
      details: { shortages: Array<{ assortmentId: string; missing: string }> };
    };
    expect(resp.error).toBe('InsufficientStock');
    // Xabar endi tasdiqqa EMAS, defitsitga ishora qiladi.
    expect(resp.message).not.toContain("bosh omborchi tasdig'i");
    // K3 (7.1) — `reason` maydoni qo'shildi (sabab: xabar matni shunga qarab
    // tanlanadi). Bo'linmaydigan tovarda u har doim `insufficient`.
    expect(resp.details.shortages).toEqual([
      { assortmentId: PRODUCT_ID, requested: '2', missing: '1', reason: 'insufficient' },
    ]);
    expect(stock.applyDeltas).not.toHaveBeenCalled();
  });
});

// ── G4: ajratma → delta va saqlash ─────────────────────────────────

describe('G4 — post(): ajratma deltaga va jadvalga tushadi', () => {
  const CELL_A = 'cell-a';

  it('yacheykadagi tovar: delta cellId bilan yoziladi va ajratma SAQLANADI', async () => {
    const { client, tx } = makePostHarness({ stores: CASCADE_ROWS });
    const stock = makeStockStub({ [STORE_07]: '10' });
    tx.stockByCell.findMany.mockResolvedValue([
      {
        storeId: STORE_07,
        cellId: CELL_A,
        assortmentId: PRODUCT_ID,
        qty: '5',
        cell: { name: '07-01-01-01' },
      },
    ]);

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      cellId: string | null;
      cellMode: string;
      qtyDelta: string;
      docPositionId: string;
    }>;
    expect(deltas).toHaveLength(1);
    expect(deltas[0].cellId).toBe(CELL_A);
    // Yacheykali ajratmada `auto` — `applyDeltas` AYNAN o'sha yacheykani siljitadi.
    expect(deltas[0].cellMode).toBe('auto');
    expect(deltas[0].docPositionId).toBe('pos-1');

    // Ajratma jadvalga yozildi (eski qatorlar avval o'chiriladi — qayta post).
    expect(tx.retailSalePositionAllocation.deleteMany).toHaveBeenCalled();
    const rows = tx.retailSalePositionAllocation.createMany.mock.calls[0][0].data as Array<{
      positionId: string;
      storeId: string;
      cellId: string | null;
      qty: string;
    }>;
    expect(rows).toEqual([
      { accountId: ACCOUNT, positionId: 'pos-1', storeId: STORE_07, cellId: CELL_A, qty: '2' },
    ]);
  });

  it('bo‘linish: ikki manba → ikki delta va ikki ajratma qatori', async () => {
    // 07 da 1 ta, 02 da 1 ta — hech biri yolg'iz qoplamaydi ⇒ 3-holat.
    // Tartib: avval boshqa omborlar, 07 ENG OXIRIDA.
    //
    // 🔴 DIQQAT: «07 oxirida» qoidasi FAQAT `__posFrontStore` bayrog'i
    // qo'yilganda ishlaydi. Bayroqsiz tartibni `__posPriority` belgilaydi va
    // pp=1 bo'lgan 07 BIRINCHI kelardi — ya'ni egasining «07 bo'shab qolmasin»
    // qoidasi jimgina bajarilmasdi. Ombor kartasidagi checkbox SHART.
    const { client, tx } = makePostHarness({ stores: CASCADE_ROWS_FRONT });
    const stock = makeStockStub({ [STORE_07]: '1', [STORE_02]: '1' });

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
    }>;
    expect(deltas.map((d) => [d.storeId, d.qtyDelta])).toEqual([
      [STORE_02, '-1'],
      [STORE_07, '-1'],
    ]);
    const rows = tx.retailSalePositionAllocation.createMany.mock.calls[0][0].data as Array<{
      storeId: string;
      qty: string;
    }>;
    expect(rows.map((r) => [r.storeId, r.qty])).toEqual([
      [STORE_02, '1'],
      [STORE_07, '1'],
    ]);
  });

  it('🔴 SAQLANGAN ajratma ustuvor — post() qayta rejalashtirmaydi', async () => {
    // `sendToPicking` tovarni AYNAN shu yacheykada band qilgan va omborchi
    // o'sha yerdan yig'gan. Qayta rejalashtirsak, jismonan olingan joy bilan
    // hisobdan chiqarilgan joy mos kelmay qolardi.
    const { client, tx } = makePostHarness({ stores: CASCADE_ROWS });
    const stock = makeStockStub({ [STORE_07]: '10', [STORE_02]: '10' });
    tx.retailSalePositionAllocation.findMany.mockResolvedValue([
      { positionId: 'pos-1', storeId: STORE_02, cellId: 'cell-x', qty: '2' },
    ]);

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      cellId: string | null;
      qtyDelta: string;
    }>;
    expect(deltas).toHaveLength(1);
    // 07 da ham tovar bor edi, lekin saqlangan ajratma 02 ni ko'rsatgan.
    expect(deltas[0].storeId).toBe(STORE_02);
    expect(deltas[0].cellId).toBe('cell-x');
    expect(deltas[0].qtyDelta).toBe('-2');
  });

  it('saqlangan ajratma YETMASA qayta rejalashtiriladi', async () => {
    const { client, tx } = makePostHarness({ stores: CASCADE_ROWS });
    const stock = makeStockStub({ [STORE_07]: '10' });
    // Pozitsiya 2 ta, saqlangan qator atigi 1 ta ⇒ qoplamaydi.
    tx.retailSalePositionAllocation.findMany.mockResolvedValue([
      { positionId: 'pos-1', storeId: STORE_02, cellId: null, qty: '1' },
    ]);

    await makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY);

    const deltas = stock.applyDeltas.mock.calls[0][3] as Array<{ storeId: string }>;
    expect(deltas[0].storeId).toBe(STORE_07);
  });

  it('BRAK omboridagi qoldiq sotilmaydi (400)', async () => {
    const brakRows = [
      ...CASCADE_ROWS,
      {
        id: 'store-brak',
        name: 'BRAK',
        allowNegativeStock: false,
        attributes: { __posPriority: 9, __brakStore: true },
      },
    ];
    const { client } = makePostHarness({ stores: brakRows });
    const stock = makeStockStub({ 'store-brak': '100' });

    await expect(
      makeService(client, stock).post(ACCOUNT, USER_ID, SALE_ID, POST_BODY),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stock.applyDeltas).not.toHaveBeenCalled();
  });
});

// ── sendToPicking() ───────────────────────────────────────────────────────

describe('F6 — sendToPicking(): rezerv kaskad omborida', () => {
  it('hold post() ayiradigan omborda (07) yoziladi', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
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
          positions: [{ productId: PRODUCT_ID, quantity: 3 }],
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'picking' }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    // G4: rezerv ham TAQSIMOT bo'yicha — qoldiq qulflangan balansdan o'qiladi.
    const stock = makeStockStub({ [STORE_07]: '10' });

    await makeService(client, stock).sendToPicking(ACCOUNT, SALE_ID, USER_ID, USER_NAME);

    // G4: qulflash tartibi endi kaskad emas, ID bo'yicha (deadlock oldini
    // olish) — shuning uchun «birinchi qulf» emas, «hammasi qulflandi» va
    // rezerv AYNAN kerakli omborda ekani tekshiriladi.
    const lockedStores = stock.lockBalances.mock.calls.map((c) => c[2]);
    expect(lockedStores).toEqual([STORE_02, STORE_07]);
    const deltas = stock.applyReservationDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
      reason: string;
    }>;
    expect(deltas[0].storeId).toBe(STORE_07);
    expect(deltas[0].qtyDelta).toBe('3');
    expect(deltas[0].reason).toBe('reserve');
  });
});

// ── cancel() ──────────────────────────────────────────────────────────────

describe('F6 — cancel(): qulf hold HAQIQATAN turgan omborga', () => {
  it('rezerv 07 da yozilgan bo‘lsa, qulf ham 07 da (smena omborida emas)', async () => {
    const tx = {
      documentSequence: mockDocumentSequence(),
      // G4 — post() ajratmani yacheyka kesimida quradi va saqlaydi.
      stockByCell: { findMany: vi.fn().mockResolvedValue([]) },
      retailSalePositionAllocation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      retailSale: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      stockReservation: { findMany: vi.fn().mockResolvedValue([{ storeId: STORE_07 }]) },
      cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const client = {
      store: { findMany: vi.fn(async () => CASCADE_ROWS) },
      restockTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          state: 'picking',
          name: 'CHK-1',
          sessionId: SESSION_ID,
          sumMinor: 100_000n,
          session: { storeId: STORE_UN },
          positions: [{ productId: PRODUCT_ID, quantity: 2 }],
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'cancelled' }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const stock = makeStockStub();

    await makeService(client, stock).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(stock.lockBalances).toHaveBeenCalledTimes(1);
    expect(stock.lockBalances.mock.calls[0][2]).toBe(STORE_07);
    expect(stock.releaseReservationByDoc).toHaveBeenCalledWith(
      tx,
      ACCOUNT,
      USER_ID,
      'retailsale',
      SALE_ID,
      'release_cancel',
    );
  });
});

// ── refund() ──────────────────────────────────────────────────────────────

describe('F6 — refund(): qaytgan tovar kaskad omboriga kiradi', () => {
  it('kirim deltasi 07 ga (sotuv ayirgan ombor), smena omboriga emas', async () => {
    const stockApplyDeltas = vi.fn().mockResolvedValue(undefined);
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
        create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
          id: 'refund-1',
          ...args.data,
        })),
      },
      retailSalePosition: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'rp-1', productId: PRODUCT_ID, quantity: '1', position: 1 }]),
      },
      stockOperation: { findMany: vi.fn().mockResolvedValue([]) },
      cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => CASCADE_ROWS) },
      bonusOperation: { findFirst: vi.fn(async () => null) },
      cashierSession: {
        findFirst: vi.fn(async () => ({
          id: SESSION_ID,
          cashierId: 'cashier-1',
          cashDeskId: 'cd-1',
          storeId: STORE_UN,
          cashDesk: { currency: 'UZS' },
        })),
      },
      retailSale: {
        findFirst: vi.fn().mockResolvedValue({
          id: SALE_ID,
          name: 'ТРН-2026-00001',
          state: 'posted',
          version: 1,
          sumMinor: 10_000n,
          sessionId: SESSION_ID,
          agentId: null,
          refundedFromId: null,
          organizationId: null,
          payments: [],
          session: {
            id: SESSION_ID,
            state: 'open',
            cashierId: 'cashier-1',
            cashDeskId: 'cd-1',
            storeId: STORE_UN,
            cashDesk: { currency: 'UZS' },
          },
          positions: [
            {
              productId: PRODUCT_ID,
              quantity: '1',
              priceMinor: 10_000n,
              discount: '0',
              sumMinor: 10_000n,
              costMinor: null,
              basePriceMinor: null,
            },
          ],
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const svc = new RetailSaleService(
      { client } as never,
      { applyDeltas: stockApplyDeltas } as never,
      { applyDeltas: vi.fn().mockResolvedValue(undefined) } as never,
      { createOperation: vi.fn() } as never,
      undefined as never,
      { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
      { applyPayment: async () => {} } as never,
    );

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, {
      positions: [{ productId: PRODUCT_ID, quantity: '1' }],
      cashAmountMinor: '10000',
      cardAmountMinor: '0',
    });

    expect(stockApplyDeltas).toHaveBeenCalledTimes(1);
    const deltas = stockApplyDeltas.mock.calls[0][3] as Array<{
      storeId: string;
      qtyDelta: string;
      reason: string;
    }>;
    expect(deltas[0].storeId).toBe(STORE_07);
    expect(deltas[0].qtyDelta).toBe('1');
    expect(deltas[0].reason).toBe('unpost');
  });
});
