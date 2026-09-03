import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { allowedFrom, canTransition, transitionRejection } from './retail-sale-fsm.js';
import { RetailSaleStateSchema } from './retail-sale.schema.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * RetailSale FSM — omborchi zanjirining OXIRI (2026-08-02, To'lqin 0 qoldig'i).
 *
 * `f6cc310` (To'lqin 0.1) enum'ga `picking`/`ready` qo'shib POS ro'yxatlarini
 * ochdi, lekin zanjirning oxiri berk qoldi:
 *   - `post()` faqat `draft` ni qabul qilardi → omborchi «tayyor» bosgach
 *     kassirning to'lov tugmasi (`sotuv/page.tsx` «Tayyor» ro'yxati →
 *     `POST /retail-sales/:id/post`) **400** qaytarardi;
 *   - `cancel()` ham faqat `draft` → yig'ilayotgan chek abadiy osilib qolardi
 *     (na to'lanadi, na bekor qilinadi).
 *
 * Bu testlar shu ikki o'tishni va CAS qo'riqchisining ular bilan MOS ekanini
 * qulflaydi (qo'riqchi tor bo'lsa haqiqiy o'tish 409 bo'lardi).
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';

// --- 1. Pure transition table ---

describe("retail-sale-fsm — o'tish jadvali", () => {
  it("post: draft va ready — HA; picking/posted/refunded/cancelled — YO'Q", () => {
    expect(canTransition('draft', 'post')).toBe(true);
    expect(canTransition('ready', 'post')).toBe(true);
    // Tovar hali yig'ilmagan — kassir pul olmasligi kerak.
    expect(canTransition('picking', 'post')).toBe(false);
    expect(canTransition('posted', 'post')).toBe(false);
    expect(canTransition('refunded', 'post')).toBe(false);
    expect(canTransition('cancelled', 'post')).toBe(false);
  });

  it("cancel: to'lovgacha bo'lgan uchala holatdan — HA", () => {
    expect(canTransition('draft', 'cancel')).toBe(true);
    expect(canTransition('picking', 'cancel')).toBe(true);
    expect(canTransition('ready', 'cancel')).toBe(true);
    // To'langan chek bekor qilinmaydi — u refund orqali qaytariladi.
    expect(canTransition('posted', 'cancel')).toBe(false);
    expect(canTransition('refunded', 'cancel')).toBe(false);
    expect(canTransition('cancelled', 'cancel')).toBe(false);
  });

  it('send-to-picking faqat draft, mark-ready faqat picking', () => {
    expect(allowedFrom('send-to-picking')).toEqual(['draft']);
    expect(allowedFrom('mark-ready')).toEqual(['picking']);
  });

  it("har ruxsat etilgan holat Zod enum'ida ham bor (enum ↔ FSM drift qo'riqchisi)", () => {
    const enumStates = RetailSaleStateSchema.options as readonly string[];
    for (const t of ['post', 'cancel', 'send-to-picking', 'mark-ready'] as const) {
      for (const state of allowedFrom(t)) {
        expect(enumStates).toContain(state);
      }
    }
  });

  it('rad etish xabari joriy holatni ham, kutilganlarni ham aytadi', () => {
    const msg = transitionRejection('picking', 'post');
    expect(msg).toContain('picking');
    expect(msg).toContain('draft');
    expect(msg).toContain('ready');
  });
});

// --- 2. Service wiring ---

interface PrismaLike {
  client: unknown;
}

function makeStockStub() {
  return {
    lockBalances: vi.fn().mockResolvedValue(new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    applyReservationDeltas: vi.fn().mockResolvedValue(undefined),
    // P3 — `false` = «bo'shatiladigan rezerv yo'q edi». Haqiqiy servis shu
    // javob bo'yicha balanslarni qayta o'qish-o'qimaslikni hal qiladi.
    releaseReservationByDoc: vi.fn().mockResolvedValue(false),
  };
}

function makeMoneyStub() {
  return { applyDeltas: vi.fn().mockResolvedValue(undefined) };
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
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
}

function makePostClient(state: string) {
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
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: SALE_ID, state: 'posted', agentId: null, sumMinor: 100_000n }),
    },
    // Kassa TZ §6.1 — post() endi har to'lov turini alohida qator qilib yozadi.
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashDesk: { update: vi.fn() },
    // Faza Q1: smena agregati endi `state:'open'` sharti bilan CLAIM qilinadi
    // (shartsiz `update` o'rniga) — yopilayotgan smenaga post 409 beradi.
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    loyaltyProgram: { findFirst: vi.fn(async () => null) },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'CHK-1',
        state,
        sumMinor: 100_000n,
        sessionId: SESSION_ID,
        agentId: null,
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
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

const PAYMENT = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe("RetailSaleService.post — yig'ilgan chek to'lanadi", () => {
  it("ready holatidagi chek to'lanadi (regressiya: ilgari 400 edi)", async () => {
    const { client, tx } = makePostClient('ready');
    const money = makeMoneyStub();
    const svc = makeService(client, makeStockStub(), money);

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT)).resolves.toBeTruthy();

    // Pul kassaga tushdi va smena agregatlari yangilandi.
    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
    expect(tx.cashierSession.updateMany).toHaveBeenCalledTimes(1);
    // Claim SHARTLI bo'lishi shart — shartsiz bo'lsa poyga oynasi qaytadi.
    expect(tx.cashierSession.updateMany.mock.calls[0][0].where.state).toBe('open');
  });

  it("CAS qo'riqchisi ready ni ham qamraydi (tor bo'lsa haqiqiy to'lov 409 bo'lardi)", async () => {
    const { client, tx } = makePostClient('ready');
    await makeService(client).post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    const where = tx.retailSale.updateMany.mock.calls[0][0].where;
    expect(where.state).toEqual({ in: ['draft', 'ready'] });
  });

  it("picking holatidagi chek to'lanmaydi — tovar hali yig'ilmagan", async () => {
    const { client, tx } = makePostClient('picking');
    const money = makeMoneyStub();
    const svc = makeService(client, makeStockStub(), money);

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Hech qanday yon ta'sir bo'lmasligi shart.
    expect(tx.retailSale.updateMany).not.toHaveBeenCalled();
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });
});

function makeCancelClient(state: string) {
  const restockTask = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  // Bekor qilish holat-almashtirishi va audit yozuvi (kassa TZ §9) BITTA
  // tranzaksiyada: poygada yutgan odam jurnalga tushadi, yutqazgani hech narsa
  // yozmaydi. Shuning uchun mock endi `$transaction` beradi.
  const cashierAuditEvent = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const retailSale = {
    findFirst: vi.fn().mockResolvedValue({
      id: SALE_ID,
      state,
      name: 'CHK-1',
      sessionId: SESSION_ID,
      sumMinor: 100_000n,
      // P3 — rezervni bo'shatish do'koni smenadan olinadi (chek `storeId`i
      // POS'da to'ldirilmaydi — prodda 17/17 chekda NULL).
      session: { storeId: STORE_ID },
      positions: [{ productId: 'prod-1', quantity: 2 }],
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SALE_ID, state: 'cancelled' }),
  };
  const client = {
    documentSequence: mockDocumentSequence(),
    restockTask,
    retailSale,
    cashierAuditEvent,
    store: { findMany: vi.fn(async () => []) },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ retailSale, cashierAuditEvent }),
      ),
  };
  return { client, restockTask, cashierAuditEvent };
}

describe("RetailSaleService.cancel — yig'ilayotgan chek bekor qilinadi", () => {
  it.each(['draft', 'picking', 'ready'])('%s holatidan bekor qilinadi', async (state) => {
    const { client } = makeCancelClient(state);
    await expect(makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID)).resolves.toBeTruthy();
    const where = client.retailSale.updateMany.mock.calls[0][0].where;
    expect(where.state).toEqual({ in: ['draft', 'picking', 'ready'] });
  });

  it("picking bekor qilinganda ochiq yig'ish topshiriqlari cancelled bo'ladi (done EMAS)", async () => {
    const { client, restockTask } = makeCancelClient('picking');
    await makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(restockTask.updateMany).toHaveBeenCalledTimes(1);
    const call = restockTask.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ status: 'cancelled' });
    expect(call.where).toMatchObject({
      accountId: ACCOUNT,
      sourceId: SALE_ID,
      sourceType: 'retailsale',
      type: 'picking',
    });
    // Allaqachon yopilganlar qayta tegilmaydi.
    expect(call.where.status).toEqual({ notIn: ['done', 'cancelled'] });
  });

  it('bekor qilish audit jurnaliga BOSQICHI bilan tushadi (kassa TZ §9)', async () => {
    // `ready` bosqichida bekor qilish — tovar allaqachon yig'ilgan, kimdir uni
    // joyiga qaytarishi kerak; jurnal buni ayta olishi shart.
    const { client, cashierAuditEvent } = makeCancelClient('ready');
    await makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID);

    expect(cashierAuditEvent.createMany).toHaveBeenCalledTimes(1);
    const rows = cashierAuditEvent.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: ACCOUNT,
      sessionId: SESSION_ID,
      employeeId: USER_ID,
      type: 'SALE_CANCELLED',
      docId: SALE_ID,
    });
    expect(rows[0].payload).toMatchObject({ stage: 'ready', name: 'CHK-1' });
  });

  it("draft bekor qilinganda topshiriq tozalash CHAQIRILMAYDI (topshiriq yo'q)", async () => {
    const { client, restockTask } = makeCancelClient('draft');
    await makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID);
    expect(restockTask.updateMany).not.toHaveBeenCalled();
  });

  it("to'langan chek bekor qilinmaydi (refund yo'li bilan qaytariladi)", async () => {
    const { client } = makeCancelClient('posted');
    await expect(makeService(client).cancel(ACCOUNT, USER_ID, SALE_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.retailSale.updateMany).not.toHaveBeenCalled();
  });
});
