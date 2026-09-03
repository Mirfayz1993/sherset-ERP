import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * F8 — IKKI MARTA TO'LASH POYGASI (ikki kassir, bitta zakaz).
 *
 * Nega alohida fayl va nega mock `count: 0` YETARLI EMAS:
 * qo'shni `retail-sale-customer-order.test.ts` da «qulf yutqazdi» holati
 * `updateMany → {count: 0}` bilan modellashtirilgan — u FAQAT «count 0
 * bo'lsa nima bo'ladi» ni tekshiradi. Bu yerda esa `count` ni MEN
 * bermayman: ikki `post()` HAQIQATAN parallel yuritiladi, ular BITTA
 * xotiradagi zakaz qatorini bo'lishadi, va `updateMany` predikati Postgres
 * qator-qulfi qoidasi bo'yicha baholanadi:
 *
 *   • qulf birinchi kelganda olinadi va TX OXIRIGACHA (commit) ushlanadi;
 *   • ikkinchi tranzaksiya kutadi va qulf bo'shagach predikatni QAYTA
 *     baholaydi (EvalPlanQual) — o'shanda zakaz allaqachon `paid`.
 *
 * Ya'ni test aynan «ikkalasi ham zakazni `confirmed` deb KO'RDI» stsenariysini
 * qo'yadi va bittasi yutishini talab qiladi. Yutqazgan chek — to'liq rollback:
 * pul kassaga TUSHMAYDI, ombor YECHILMAYDI, `applyPayment` chaqirilmaydi.
 */

const ACCOUNT = 'acc-1';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = 'sess-1';
const STORE_ID = 'store-1';
const ORDER_SUM = 100_000n;

/** Navbatli mutex — Postgres qator-qulfini modellaydi. */
function makeMutex() {
  let tail: Promise<void> = Promise.resolve();
  return async function lock(): Promise<() => void> {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const wait = tail;
    tail = tail.then(() => gate);
    await wait;
    return release;
  };
}

/** Ikki kassir bo'lishadigan YAGONA zakaz qatori. */
interface SharedOrder {
  state: string;
  sumMinor: bigint;
  payedSumMinor: bigint;
  version: number;
  reservedSumMinor: bigint;
}

function makeWorld() {
  const order: SharedOrder = {
    state: 'confirmed',
    sumMinor: ORDER_SUM,
    payedSumMinor: 0n,
    version: 1,
    reservedSumMinor: ORDER_SUM,
  };
  const lock = makeMutex();
  const applyPaymentCalls: bigint[] = [];
  const cashDeltas: bigint[] = [];
  const stockDeltas: string[] = [];

  // MAVJUD primitivning xulqi (customer-order.service.applyPayment):
  // to'lovni qo'shadi va to'liq to'langanda `paid` ga o'tkazadi.
  const co = {
    applyPayment: vi.fn(
      async (
        _tx: unknown,
        _acc: string,
        _uid: string,
        _orderId: string,
        amount: bigint,
        _dir: string,
      ) => {
        applyPaymentCalls.push(amount);
        order.payedSumMinor += amount;
        if (order.payedSumMinor >= order.sumMinor) order.state = 'paid';
      },
    ),
  };

  const stock = {
    lockBalances: vi.fn(async () => new Map()),
    assertAvailable: vi.fn(),
    // Real ombor kaskadi I/O — poyga oynasi aynan shu yerda ochiladi.
    applyDeltas: vi.fn(async (_tx: unknown, _a: string, _u: string, deltas: unknown[]) => {
      await new Promise((r) => setTimeout(r, 5));
      for (const d of deltas)
        stockDeltas.push(String((d as { assortmentId: string }).assortmentId));
    }),
    // P3 dan keyin `post()` buni IKKI hujjat uchun chaqiradi: zakaz rezervi
    // (`customerorder`) va chekning o'z yig'ish rezervi (`retailsale`).
    // Dublyor ikkalasini FARQLAYDI — aks holda chek yo'li zakaz mirrorini
    // ham nolga tushirib, testni yolg'on yashil qilardi.
    releaseReservationByDoc: vi.fn(
      async (_tx: unknown, _a: string, _u: string, docType: string) => {
        if (docType !== 'customerorder') return false; // chekda rezerv yo'q
        order.reservedSumMinor = 0n;
        return true;
      },
    ),
  };

  const money = {
    applyDeltas: vi.fn(async (_tx: unknown, _a: string, deltas: Array<{ deltaMinor: bigint }>) => {
      for (const d of deltas) cashDeltas.push(d.deltaMinor);
    }),
  };

  function makeClient(saleId: string) {
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
        findUniqueOrThrow: vi.fn(async () => ({
          id: saleId,
          agentId: null,
          sumMinor: ORDER_SUM,
        })),
      },
      retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      posAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      customerOrder: {
        updateMany: vi.fn(async (args: { where: { state: { in: string[] } } }) => {
          // Qulf shu yerda olinadi va tranzaksiya oxirigacha ushlanadi.
          release = await lock();
          if (!args.where.state.in.includes(order.state)) return { count: 0 };
          order.version += 1;
          return { count: 1 };
        }),
        update: vi.fn(async () => {
          order.reservedSumMinor = 0n;
          return {};
        }),
        findFirstOrThrow: vi.fn(async () => ({
          sumMinor: order.sumMinor,
          payedSumMinor: order.payedSumMinor,
          storeId: STORE_ID,
        })),
      },
      customerOrderPosition: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    let release: (() => void) | null = null;

    const client = {
      documentSequence: mockDocumentSequence(),
      employee: { findUnique: vi.fn(async () => null) },
      store: { findMany: vi.fn(async () => []) },
      product: { findMany: vi.fn(async () => []) },
      priceType: { findMany: vi.fn(async () => []) },
      retailSale: {
        findFirst: vi.fn(async () => ({
          id: saleId,
          name: `CH-${saleId}`,
          state: 'draft',
          sumMinor: ORDER_SUM,
          agentId: null,
          organizationId: null,
          sessionId: SESSION_ID,
          customerOrderId: ORDER_ID,
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
          positions: [
            {
              id: `${saleId}-p1`,
              productId: PRODUCT_ID,
              quantity: '1',
              priceMinor: ORDER_SUM,
              product: { name: 'Tovar' },
            },
          ],
        })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
        try {
          return await fn(tx);
        } finally {
          // Commit/rollback — qulf shu paytda bo'shaydi.
          release?.();
          release = null;
        }
      }),
    };
    return client;
  }

  const makeSvc = (saleId: string) =>
    new RetailSaleService(
      { client: makeClient(saleId) } as never,
      stock as never,
      money as never,
      undefined as never,
      undefined as never,
      { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
      co as never,
    );

  return { order, co, stock, money, makeSvc, applyPaymentCalls, cashDeltas, stockDeltas };
}

const PAYMENT = {
  cashAmountMinor: ORDER_SUM.toString(),
  cardAmountMinor: '0',
  expectedSumMinor: ORDER_SUM.toString(),
};

describe('F8 — ikki kassir bitta zakazni bir vaqtda to‘laydi', () => {
  it('faqat BITTASI yutadi; yutqazgan aniq ConflictException oladi', async () => {
    const w = makeWorld();

    const results = await Promise.allSettled([
      w.makeSvc('sale-A').post(ACCOUNT, 'kassir-A', 'sale-A', PAYMENT),
      w.makeSvc('sale-B').post(ACCOUNT, 'kassir-B', 'sale-B', PAYMENT),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason = (lost[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ConflictException);
    // Xato kassirga TUSHUNARLI — «nimadir xato ketdi» emas.
    expect(String((reason as Error).message)).toContain(
      'to‘lanadigan holatda emas'.replace('‘', "'"),
    );
  });

  it('yutqazgan chek pul ham olmaydi, zakazga ham tegmaydi (to‘liq rollback)', async () => {
    const w = makeWorld();

    await Promise.allSettled([
      w.makeSvc('sale-A').post(ACCOUNT, 'kassir-A', 'sale-A', PAYMENT),
      w.makeSvc('sale-B').post(ACCOUNT, 'kassir-B', 'sale-B', PAYMENT),
    ]);

    // Zakazga to'lov ANIQ BIR MARTA tushdi — ikki karra to'lov yo'q.
    expect(w.co.applyPayment).toHaveBeenCalledTimes(1);
    expect(w.applyPaymentCalls).toEqual([ORDER_SUM]);
    expect(w.order.payedSumMinor).toBe(ORDER_SUM);
    expect(w.order.state).toBe('paid');

    // Kassaga pul ham bir marta tushdi (yutqazgan `throw` dan OLDIN
    // pul yozmaganini isbotlaydi: qulf pul kaskadidan OLDIN olinadi).
    expect(w.cashDeltas).toEqual([ORDER_SUM]);
    // Ombor ham bir marta yechildi.
    expect(w.stockDeltas).toEqual([PRODUCT_ID]);
    // ZAKAZ rezervi bir marta yutildi (chekning o'z rezervi alohida chaqiruv —
    // shuning uchun umumiy son emas, `customerorder` chaqiruvlari sanaladi).
    const orderReleases = w.stock.releaseReservationByDoc.mock.calls.filter(
      (c) => c[3] === 'customerorder',
    );
    expect(orderReleases).toHaveLength(1);
  });

  it('uchinchi urinish (zakaz allaqachon `paid`) ham rad etiladi', async () => {
    const w = makeWorld();
    await w.makeSvc('sale-A').post(ACCOUNT, 'kassir-A', 'sale-A', PAYMENT);
    expect(w.order.state).toBe('paid');

    await expect(
      w.makeSvc('sale-C').post(ACCOUNT, 'kassir-C', 'sale-C', PAYMENT),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(w.co.applyPayment).toHaveBeenCalledTimes(1);
  });
});
