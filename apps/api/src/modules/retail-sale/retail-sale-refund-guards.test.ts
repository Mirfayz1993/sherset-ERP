import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * refund() qo'riqchilari — QA 2026-08-10 + F6 siyosat-bekor 2026-08-13.
 *
 * **A. Vozvrat zanjiri (cheksiz pul generatori) — O'ZGARMAGAN.** refund()
 * yaratadigan mirror chek ham `state:'posted'` bilan tug'iladi va unda to'lov
 * qatorlari YO'Q — ya'ni `originalDebtMinor = 0` bo'lib butun summa naqd
 * qaytariladi. Guard bo'lmasa mirror'ni qayta-qayta refund qilib kassadan
 * cheksiz pul (va omborga cheksiz stok) olish mumkin. Qaytarish faqat ASL
 * chekdan.
 *
 * **B. F6 (2026-08-13, EGASI QARORI — ONGLI SIYOSAT-BEKOR).** Eski niyat
 * (2026-08-10): «qaytarish faqat ASL chek smenasi ochiq bo'lsa o'tadi va o'sha
 * smenaga yoziladi». Egasining 2026-08-13 talabi — «kassir istalgan chekga
 * vozvrat qilishi kerak» — bu niyatni BEKOR qildi: endi qaytarish
 * QAYTARUVCHI KASSIRNING JORIY OCHIQ SMENASIGA yoziladi, asl chek smenasi
 * yopiq bo'lsa ham. Hisoblagichlar (returnsCount/returnsSumMinor) va naqd
 * chiqim (CashDesk) ham JORIY smenada — Z-hisobot sessionId bo'yicha
 * agregatlagani uchun avtomatik to'g'ri bo'ladi.
 *
 * **C. Atomik claim — SAQLANDI, faqat JORIY smenaga ko'chdi.** Joriy smena
 * `findFirst` bilan tranzaksiyadan TASHQARIDA topiladi (eskirgan nusxa);
 * o'qish bilan tx orasida `close()` yugursa, claim `updateMany where
 * {state:'open'}` count=0 qaytaradi va BUTUN qaytarish orqaga qaytadi
 * (post() dagi SALES-07 naqshi).
 *
 * Dublyor Postgres semantikasini halol modellaydi: `findFirst` — DETACHED
 * (eskirgan) nusxa, `updateMany` esa JONLI qator ustida shartni atomik
 * baholaydi.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
/** Asl chek smenasi — F6'dan keyin uning holati qaytarishga TA'SIR QILMAYDI. */
const ORIG_SESSION_ID = 'sess-orig';
const ORIG_CASHDESK_ID = 'cd-orig';
/** Qaytaruvchi kassirning JORIY ochiq smenasi — mirror shu yerga yoziladi. */
const CUR_SESSION_ID = 'sess-cur';
const CUR_CASHDESK_ID = 'cd-cur';
const STORE_ID = 'store-1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown>;

function makeHarness(
  opts: {
    /** Chek o'zi vozvrat mirror'i bo'lsa — asl chek id'si. */
    refundedFromId?: string | null;
    /**
     * ASL chek smenasining holati (snapshot). F6: sukut 'closed' — barcha
     * asosiy testlar «asl smena yopiq bo'lsa ham o'tadi» rejimida yuradi,
     * eski precheck qaytib kelsa hammasi birdan qizaradi.
     */
    originalSessionState?: string;
    /** Kassirda ochiq smena bormi (findFirst natijasi). false = yo'q. */
    hasOpenSession?: boolean;
    /** JORIY smenaning JONLI holati (claim onida) — poyga simulyatsiyasi. */
    liveCurrentState?: string;
  } = {},
) {
  const isMirror = Boolean(opts.refundedFromId);
  /** JONLI joriy smena qatori — claim shu yerda atomik baholanadi. */
  const currentRow: Row = {
    id: CUR_SESSION_ID,
    accountId: ACCOUNT,
    state: opts.liveCurrentState ?? 'open',
  };

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
      create: vi.fn(async (args: { data: Row }) => ({ id: 'refund-1', ...args.data })),
    },
    retailSalePosition: { findMany: vi.fn().mockResolvedValue([]) },
    stockOperation: { findMany: vi.fn().mockResolvedValue([]) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    cashierSession: {
      // Eski (buggy) shartsiz yo'l — fix'dan keyin bu chaqirilmasligi kerak.
      update: vi.fn().mockResolvedValue({}),
      // JONLI qator ustida shartni baholaydi (SALES-07 naqshi).
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (args.where.id !== currentRow.id) return { count: 0 };
        if (args.where.state !== undefined && args.where.state !== currentRow.state) {
          return { count: 0 };
        }
        Object.assign(currentRow, args.data);
        return { count: 1 };
      }),
    },
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    bonusOperation: { findFirst: vi.fn(async () => null) },
    cashierAuditEvent: { findFirst: vi.fn(async () => null) },
    // F6 — refund() qaytaruvchi kassirning JORIY ochiq smenasini shu yerdan
    // topadi (`findCurrentForCashier` bilan bir xil where-shakl).
    cashierSession: {
      findFirst: vi.fn(async () =>
        opts.hasOpenSession === false
          ? null
          : {
              id: CUR_SESSION_ID,
              cashierId: 'cashier-1',
              cashDeskId: CUR_CASHDESK_ID,
              storeId: STORE_ID,
              cashDesk: { currency: 'UZS' },
            },
      ),
    },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: isMirror ? 'ТРН-2026-00002' : 'ТРН-2026-00001',
        state: 'posted',
        version: 1,
        sessionId: ORIG_SESSION_ID,
        agentId: null,
        refundedFromId: opts.refundedFromId ?? null,
        sumMinor: 100_000n,
        session: {
          id: ORIG_SESSION_ID,
          // F6: sukut 'closed' — asl smena holati endi to'siq EMAS.
          state: opts.originalSessionState ?? 'closed',
          cashierId: 'cashier-1',
          cashDeskId: ORIG_CASHDESK_ID,
          storeId: STORE_ID,
          cashDesk: { currency: 'UZS' },
        },
        // Mirror chekda to'lov qatorlari YO'Q — bug aynan shu yerdan:
        // qarz ulushi 0 deb o'qiladi va butun summa naqdga ochiladi.
        // P5: dublyor SERVER select'ining shaklini takrorlaydi —
        // `amountBaseMinor` naqd cap'i uchun O'QILADI.
        payments: isMirror
          ? []
          : [{ method: 'CASH_UZS', amountMinor: 100_000n, amountBaseMinor: 100_000n }],
        positions: [
          {
            productId: PRODUCT_ID,
            quantity: '1',
            priceMinor: 100_000n,
            discount: '0',
            sumMinor: 100_000n,
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

  const money = { applyDeltas: vi.fn().mockResolvedValue(undefined) };
  const svc = new RetailSaleService(
    { client } as never,
    { applyDeltas: vi.fn().mockResolvedValue(undefined) } as never,
    money as never,
    { createOperation: vi.fn() } as never,
    undefined as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
  return { svc, tx, client, money, currentRow };
}

const CASH_REFUND_REQ = {
  positions: [{ productId: PRODUCT_ID, quantity: '1' }],
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
};

describe('refund() — vozvrat chekini QAYTA refund qilib bo`lmaydi (cheksiz pul generatori)', () => {
  it('mirror chekni refund qilishga urinish → 400, pul ham, mirror ham YO`Q', async () => {
    const { svc, tx, money } = makeHarness({ refundedFromId: 'original-sale-0' });

    await expect(svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Kassadan bir tiyin ham chiqmaydi, ikkinchi darajali mirror yaratilmaydi.
    expect(money.applyDeltas).not.toHaveBeenCalled();
    expect(tx.retailSale.create).not.toHaveBeenCalled();
  });

  it('asl (refundedFromId = null) chek hamon qaytariladi', async () => {
    const { svc, money } = makeHarness();

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ);

    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
  });
});

/**
 * F6 (2026-08-13) — «istalgan chekka qaytarish»: eski «asl smena ochiq
 * bo'lishi shart» precheck'i (2026-08-10) egasining qarori bilan BEKOR.
 * Yangi to'siq bitta: qaytaruvchi kassirda OCHIQ smena bo'lishi kerak.
 */
describe('refund() — F6: mirror JORIY smenaga, asl smena holati to`siq emas', () => {
  it('asl smena YOPIQ bo`lsa ham qaytarish O`TADI (eski 409-niyat 2026-08-13 da bekor)', async () => {
    const { svc, tx, money } = makeHarness({ originalSessionState: 'closed' });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ);

    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
    expect(tx.retailSale.create).toHaveBeenCalledTimes(1);
  });

  it('mirror chek JORIY ochiq smenaga yoziladi (asl smenaga EMAS)', async () => {
    const { svc, tx } = makeHarness();

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ);

    const data = tx.retailSale.create.mock.calls[0]?.[0]?.data as Row;
    expect(data.sessionId).toBe(CUR_SESSION_ID);
  });

  it('naqd qaytim JORIY smena kassasidan chiqadi (asl kassadan EMAS)', async () => {
    const { svc, money } = makeHarness();

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ);

    // applyDeltas(tx, accountId, deltas) — deltalar 3-argument.
    const deltas = money.applyDeltas.mock.calls[0]?.[2] as Array<Row>;
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      sourceKind: 'cash_desk',
      sourceId: CUR_CASHDESK_ID,
      deltaMinor: -100_000n,
    });
  });

  it('qaytaruvchida ochiq smena YO`Q → 409 «Ochiq smena yo`q…», hech narsa yozilmaydi', async () => {
    const { svc, tx, money } = makeHarness({ hasOpenSession: false });

    const err: unknown = await svc
      .refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(String((err as Error).message)).toMatch(/Ochiq smena yo'q/);

    expect(money.applyDeltas).not.toHaveBeenCalled();
    expect(tx.retailSale.create).not.toHaveBeenCalled();
  });
});

describe('refund() — smena atomik claim qilinadi (SALES-07 naqshi, endi JORIY smenada)', () => {
  it('o`qish bilan tranzaksiya orasida JORIY smena yopilsa → 409', async () => {
    // findFirst hali 'open' deb ko'rgan (eskirgan nusxa), JONLI qator esa
    // allaqachon 'closed' — claim count=0 qaytarib butun tx'ni yiqitadi.
    const { svc, currentRow } = makeHarness({ liveCurrentState: 'closed' });

    await expect(svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ)).rejects.toBeInstanceOf(
      ConflictException,
    );

    // Claim rad etildi — agregat oshmaydi. (Haqiqiy bazada butun tranzaksiya,
    // jumladan pul/ombor kaskadi ham, orqaga qaytadi.)
    expect(currentRow.returnsCount).toBeUndefined();
  });

  it('claim SHARTLI updateMany bilan JORIY smenada o`tadi va agregat oshadi', async () => {
    const { svc, tx, currentRow } = makeHarness();

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, CASH_REFUND_REQ);

    expect(tx.cashierSession.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.cashierSession.updateMany.mock.calls[0]?.[0]?.where).toMatchObject({
      id: CUR_SESSION_ID,
      accountId: ACCOUNT,
      state: 'open',
    });
    expect(currentRow.returnsCount).toEqual({ increment: 1 });
    expect(currentRow.returnsSumMinor).toEqual({ increment: 100_000n });
    // Eski shartsiz yo'l o'lik: hech kim `update` chaqirmaydi.
    expect(tx.cashierSession.update).not.toHaveBeenCalled();
  });
});
