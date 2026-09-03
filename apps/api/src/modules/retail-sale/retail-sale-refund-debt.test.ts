import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { SALE_DEBT_SOURCE_DOC_TYPE } from '../debt/sale-debt-registry.js';
import { mockSaleDebtRegistryTx } from '../debt/sale-debt-registry.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * SALES-04 + SALES-05 (Faza 7) — what a POS return actually settles.
 *
 * Two holes, both at the service WIRING level (the pure rules are covered in
 * `retail-refund-validation.test.ts` / `retail-loyalty.test.ts`; pricing them
 * right is worthless if `refund()` never asks):
 *
 *  SALES-04 — a receipt sold on credit refunded CASH: the till paid out money
 *    it never took, and the debt stayed on the customer's balance. Two losses
 *    from one return, and no mechanism existed to give the credit back.
 *
 *  SALES-05 — refunding 1 of 10 items flipped the receipt to 'refunded', so
 *    the other 9 could never be returned; and the bonus earned on all 10 was
 *    clawed back in full.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

interface OriginalPosition {
  productId: string | null;
  quantity: string;
  priceMinor: bigint;
  discount: string;
  sumMinor: bigint;
}

interface PriorRefund {
  sumMinor: bigint;
  cashAmountMinor: bigint;
  cardAmountMinor: bigint;
  debtReturnMinor: bigint;
  positions: { productId: string; quantity: string }[];
}

function makeHarness(opts: {
  positions: OriginalPosition[];
  /**
   * Original tenders — DEBT rows are the credit the receipt put on the
   * account; CASH_* rows are what the DRAWER took (P5 naqd cap'i).
   * `amountBaseMinor` berilmasa `amountMinor` deb olinadi (so'm qatorlarida
   * ular teng) — dublyor SERVER select'ining shaklini takrorlaydi.
   */
  payments?: {
    method: string;
    amountMinor: bigint;
    amountBaseMinor?: bigint;
    /** `CASH_USD` qatorining MUZLATILGAN kursi (×10^8). */
    rateMinor?: bigint;
  }[];
  priorRefunds?: PriorRefund[];
  agentId?: string | null;
  /** The SOLD_ON_CREDIT audit event of the original sale, if one was written. */
  creditEventAgentId?: string;
  /** The original sale's recorded EARNING bonus op, if any. */
  earnedPoints?: number;
  /**
   * Q3 — chekdan tug'ilgan UNDIRISH REYESTRI qatori (bo'lmasa: chek Q2 dan
   * OLDIN post qilingan yoki qarzni avans qoplagan).
   */
  registryRow?: { totalMinor: bigint; paidMinor?: bigint; status?: string };
}) {
  const created: { data: Record<string, unknown> }[] = [];
  const sumMinor = opts.positions.reduce((a, p) => a + p.sumMinor, 0n);

  // Q3 — `refund()` endi reyestr qatorini ham harakatlantiradi, ya'ni bu
  // harness'ga uchta yangi delegat kerak (`$queryRaw` qulfi · `debt` ·
  // `debtNote`). NUSXA YOZILMAYDI — umumiy mock'dan olinadi.
  const registry = mockSaleDebtRegistryTx();
  if (opts.registryRow) {
    registry.debtRows.push({
      id: 'debt-registry-1',
      name: 'QRZ-2026-00007',
      sourceDocType: SALE_DEBT_SOURCE_DOC_TYPE,
      sourceDocId: SALE_ID,
      counterpartyId: opts.agentId ?? AGENT_ID,
      totalMinor: opts.registryRow.totalMinor,
      paidMinor: opts.registryRow.paidMinor ?? 0n,
      status: opts.registryRow.status ?? 'unpaid',
      nextContactAt: new Date('2026-09-08T04:00:00.000Z'),
      closedAt: null,
    });
  }

  const tx = {
    ...registry.tx,
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
    // 2026-08-17 — dollar qaytarish mirror chekka `CASH_USD` qatori yozadi
    // (smenaning dollar hisobi aynan shu qatorni o'qiydi).
    retailSalePayment: { create: vi.fn().mockResolvedValue({}) },
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    // F6 (2026-08-13) — refund() qaytaruvchi kassirning JORIY ochiq smenasini
    // topadi; bu jihozda u ASL chek smenasining o'zi (bir-smena stsenariysi),
    // shuning uchun qarz/pul assertlari o'zgarmaydi.
    cashierSession: {
      findFirst: vi.fn(async () => ({
        id: SESSION_ID,
        cashierId: 'cashier-1',
        cashDeskId: CASHDESK_ID,
        storeId: STORE_ID,
        cashDesk: { currency: 'UZS' },
      })),
    },
    cashierAuditEvent: {
      findFirst: vi.fn(async () =>
        opts.creditEventAgentId ? { payload: { agentId: opts.creditEventAgentId } } : null,
      ),
    },
    bonusOperation: {
      findFirst: vi.fn(async (args: { where: { transactionType: string } }) =>
        args.where.transactionType === 'EARNING' && opts.earnedPoints
          ? { agentId: AGENT_ID, bonusProgramId: 'prog-1', bonusValue: opts.earnedPoints }
          : null,
      ),
    },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'ТРН-2026-00001',
        state: 'posted',
        version: 3,
        sessionId: SESSION_ID,
        agentId: opts.agentId ?? null,
        sumMinor,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: CASHDESK_ID,
          storeId: STORE_ID,
          cashDesk: { currency: 'UZS' },
        },
        payments: (opts.payments ?? []).map((p) => ({
          amountBaseMinor: p.amountMinor,
          // Server select'i `rateMinor` ni ham o'qiydi — dublyor shu shaklni
          // takrorlaydi (uzatilmasa `null`, ya'ni «kurs yozilmagan» holati).
          rateMinor: null,
          ...p,
        })),
        positions: opts.positions.map((p) => ({
          costMinor: null,
          basePriceMinor: null,
          ...p,
        })),
      }),
      // Earlier refunds mirrored from this receipt (cumulative caps).
      findMany: vi.fn().mockResolvedValue(opts.priorRefunds ?? []),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const money = { applyDeltas: vi.fn().mockResolvedValue(undefined) };
  const balance = { applyDelta: vi.fn().mockResolvedValue(undefined) };
  const loyalty = { computeEarnedPoints: vi.fn(), createOperation: vi.fn() };

  const svc = new RetailSaleService(
    { client } as never,
    { applyDeltas: vi.fn() } as never,
    money as never,
    loyalty as never,
    undefined as never,
    balance as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
  return { svc, tx, client, created, money, balance, loyalty, registry };
}

/** 100 000 tiyinlik chek, 10 dona. */
const TEN: OriginalPosition[] = [
  { productId: PRODUCT_ID, quantity: '10', priceMinor: 10_000n, discount: '0', sumMinor: 100_000n },
];

const refundReq = (quantity: string, over: Record<string, string> = {}) => ({
  positions: [{ productId: PRODUCT_ID, quantity }],
  cashAmountMinor: '0',
  cardAmountMinor: '0',
  ...over,
});

describe('refund() — a receipt sold on credit gives the CREDIT back (SALES-04)', () => {
  it('clears the customer debt and pays out NO cash on a 100% credit receipt', async () => {
    const { svc, balance, money, created } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10'));

    expect(balance.applyDelta).toHaveBeenCalledTimes(1);
    const [, acc, cp, cur, delta] = balance.applyDelta.mock.calls[0];
    expect({ acc, cp, cur, delta }).toEqual({
      acc: ACCOUNT,
      cp: AGENT_ID,
      cur: 'UZS',
      delta: -100_000n,
    });
    // Kassadan bir tiyin ham chiqmaydi — u yerga hech qachon pul kelmagan.
    expect(money.applyDeltas).not.toHaveBeenCalled();
    expect(created[0]?.data.debtReturnMinor).toBe(100_000n);
  });

  it('REJECTS paying cash back for goods bought entirely on credit', async () => {
    const { svc, balance, money } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '100000' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
    expect(balance.applyDelta).not.toHaveBeenCalled();
  });

  it('splits a mixed receipt: cash back up to what was paid, the rest off the debt', async () => {
    // 100 000: 40 000 naqd + 60 000 qarz.
    const { svc, balance, money, created } = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 40_000n },
        { method: 'DEBT', amountMinor: 60_000n },
      ],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '40000' }));

    expect(money.applyDeltas.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ deltaMinor: -40_000n }),
    ]);
    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-60_000n);
    expect(created[0]?.data.debtReturnMinor).toBe(60_000n);
  });

  it('REJECTS cash above the money share of a mixed receipt', async () => {
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 40_000n },
        { method: 'DEBT', amountMinor: 60_000n },
      ],
      agentId: AGENT_ID,
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '40001' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('writes down only the refunded SHARE of the debt on a partial return', async () => {
    const { svc, balance, created } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'));

    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-30_000n);
    expect(created[0]?.data.debtReturnMinor).toBe(30_000n);
  });

  it('does not touch the debt of an earlier refund a second time (cumulative)', async () => {
    const { svc, balance } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: AGENT_ID,
      priorRefunds: [
        {
          sumMinor: 30_000n,
          cashAmountMinor: 0n,
          cardAmountMinor: 0n,
          debtReturnMinor: 30_000n,
          positions: [{ productId: PRODUCT_ID, quantity: '3' }],
        },
      ],
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('7'));

    // Qolgan 7 dona = 70 000; jami 100 000 dan oshmaydi.
    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-70_000n);
  });

  it('finds the debtor of a LEGACY receipt from its SOLD_ON_CREDIT audit event', async () => {
    // Bu tuzatishdan OLDIN sotilgan qarz cheklarida `agentId` NULL: to'lov
    // oynasidagi mijoz chekka yozilmasdi. Qarz kimga yozilgani faqat audit
    // izida qolgan — aks holda prodda turgan har qarz chekini qaytarib
    // bo'lmasdi.
    const { svc, balance } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: null,
      creditEventAgentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10'));

    expect(balance.applyDelta.mock.calls[0]?.[2]).toBe(AGENT_ID);
    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-100_000n);
  });

  it('lets a legacy receipt still be refunded with an explicit zero debt return', async () => {
    // Audit izi ham yo'q bo'lsa: tovar omborga qaytadi, kassadan pul chiqmaydi
    // (qarz ulushiga naqd cheklovi 0), qarz esa qo'lda tuzatiladi.
    const { svc, balance, money, created } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: null,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { debtReturnMinor: '0' }));

    expect(balance.applyDelta).not.toHaveBeenCalled();
    expect(money.applyDeltas).not.toHaveBeenCalled();
    expect(created[0]?.data.debtReturnMinor).toBe(0n);
  });

  it('REJECTS a credit refund when the receipt has no customer to credit', async () => {
    const { svc, balance } = makeHarness({
      positions: TEN,
      payments: [{ method: 'DEBT', amountMinor: 100_000n }],
      agentId: null,
    });

    await expect(svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(balance.applyDelta).not.toHaveBeenCalled();
  });

  it('a plain cash receipt still refunds in cash and never touches a balance', async () => {
    const { svc, balance, money } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '100000' }));

    expect(money.applyDeltas.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ deltaMinor: -100_000n }),
    ]);
    expect(balance.applyDelta).not.toHaveBeenCalled();
  });
});

describe('refund() — a partial return leaves the receipt open (SALES-05)', () => {
  it('keeps the receipt POSTED when units are still out', async () => {
    const { svc, tx } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('1', { cashAmountMinor: '10000' }));

    expect(tx.retailSale.updateMany.mock.calls[0][0].data.state).toBeUndefined();
  });

  it('closes the receipt once the last unit comes back', async () => {
    const { svc, tx } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      priorRefunds: [
        {
          sumMinor: 90_000n,
          cashAmountMinor: 90_000n,
          cardAmountMinor: 0n,
          debtReturnMinor: 0n,
          positions: [{ productId: PRODUCT_ID, quantity: '9' }],
        },
      ],
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('1', { cashAmountMinor: '10000' }));

    expect(tx.retailSale.updateMany.mock.calls[0][0].data.state).toBe('refunded');
  });

  it('accepts the remaining 9 after 1 was already returned (the real scenario)', async () => {
    const { svc, created } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      priorRefunds: [
        {
          sumMinor: 10_000n,
          cashAmountMinor: 10_000n,
          cardAmountMinor: 0n,
          debtReturnMinor: 0n,
          positions: [{ productId: PRODUCT_ID, quantity: '1' }],
        },
      ],
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('9', { cashAmountMinor: '90000' }));

    expect(created[0]?.data.sumMinor).toBe(90_000n);
  });

  it('REJECTS the 11th unit across two refunds (cumulative over-refund)', async () => {
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      priorRefunds: [
        {
          sumMinor: 40_000n,
          cashAmountMinor: 40_000n,
          cardAmountMinor: 0n,
          debtReturnMinor: 0n,
          positions: [{ productId: PRODUCT_ID, quantity: '4' }],
        },
      ],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('7', { cashAmountMinor: '70000' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('REJECTS cash already paid back by an earlier refund (cumulative money cap)', async () => {
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      priorRefunds: [
        {
          sumMinor: 40_000n,
          // Bu qaytarishda 40 000 emas, 60 000 chiqib ketgan bo'lsa (buzuq
          // ma'lumot/qo'l bilan tuzatish) — qolganiga cheklov qattiqroq.
          cashAmountMinor: 60_000n,
          cardAmountMinor: 0n,
          debtReturnMinor: 0n,
          positions: [{ productId: PRODUCT_ID, quantity: '4' }],
        },
      ],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('6', { cashAmountMinor: '60000' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('serializes concurrent refunds on the receipt VERSION (stale cumulative read)', async () => {
    // Ikki parallel qaytarish bir xil «oldingi qaytarishlar» ro'yxatini o'qiydi;
    // versiya-qulfi bo'lmasa ikkalasi ham to'liq summani qaytarardi.
    const { svc, tx } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('1', { cashAmountMinor: '10000' }));

    expect(tx.retailSale.updateMany.mock.calls[0][0].where).toMatchObject({
      id: SALE_ID,
      accountId: ACCOUNT,
      state: 'posted',
      version: 3,
    });
    expect(tx.retailSale.updateMany.mock.calls[0][0].data.version).toEqual({ increment: 1 });
  });
});

describe('refund() — loyalty clawback follows the refunded share (SALES-05)', () => {
  it('claws back only the share of a partial refund', async () => {
    const { svc, loyalty } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      agentId: AGENT_ID,
      earnedPoints: 1000,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('1', { cashAmountMinor: '10000' }));

    expect(loyalty.createOperation).toHaveBeenCalledTimes(1);
    expect(loyalty.createOperation.mock.calls[0][2]).toMatchObject({ bonusValue: -100 });
  });

  it('claws back the whole recorded value on a full refund', async () => {
    const { svc, loyalty } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
      agentId: AGENT_ID,
      earnedPoints: 1000,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '100000' }));

    expect(loyalty.createOperation.mock.calls[0][2]).toMatchObject({ bonusValue: -1000 });
  });
});

/**
 * P5 (2026-08-12) — 🔴 KANAL CAP'i, WIRING darajasida.
 *
 * Sof qoida `retail-refund-validation.test.ts` da; bu yerdagi savol boshqa:
 * `refund()` uni HAQIQATAN chaqiradimi va chekning to'lov qatorlaridan
 * naqd ulushini TO'G'RI o'qiydimi.
 *
 * Prod dalili (`ops-p5-live-verify.ts` R1, 2026-08-12): 100% KARTA bilan
 * to'langan ТРН-2026-00033 `cashAmountMinor = 20000` bilan qaytarildi va
 * **201** oldi; kassa qoldig'i 85 357,21 → 85 157,21 so'm. Ya'ni yashiq
 * o'zi hech qachon olmagan 200 so'mni chiqarib yubordi.
 */
describe('refund() — yashiq olmagan pulni qaytara olmaydi (P5)', () => {
  it('🔴 REJECTS naqd qaytarishni 100% KARTA bilan to`langan chekda', async () => {
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CARD', amountMinor: 100_000n }],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '100000' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('🔴 REJECTS naqd qaytarishni TERMINAL chekda', async () => {
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [{ method: 'TERMINAL', amountMinor: 100_000n }],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('o`sha chek KARTA qatori orqali qaytariladi — yashiq qimirlamaydi', async () => {
    const { svc, money, created } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CARD', amountMinor: 100_000n }],
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cardAmountMinor: '100000' }));

    expect(money.applyDeltas).not.toHaveBeenCalled();
    expect(created[0]?.data.cardAmountMinor).toBe(100_000n);
    expect(created[0]?.data.cashAmountMinor).toBe(0n);
  });

  it('ARALASH chekda naqd FAQAT naqd ulushigacha chiqadi', async () => {
    // 100 000: 30 000 naqd + 70 000 karta.
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 30_000n },
        { method: 'CARD', amountMinor: 70_000n },
      ],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '30001' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    const ok = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 30_000n },
        { method: 'CARD', amountMinor: 70_000n },
      ],
    });
    await ok.svc.refund(
      ACCOUNT,
      USER_ID,
      SALE_ID,
      refundReq('10', { cashAmountMinor: '30000', cardAmountMinor: '70000' }),
    );
    expect(ok.money.applyDeltas.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ deltaMinor: -30_000n }),
    ]);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('🔴 DOLLAR cheki SO`MDA qaytarilmaydi — dollar ulushi so`m cap`iga kirmaydi', async () => {
    // 2026-08-17 da SHARTNOMA O'ZGARDI (egasi qarori, prodda o'lchangan
    // yo'qotishdan keyin). Ilgari bu test «dollar chek so'mda qaytariladi»
    // deb qulflab turgan edi va aynan shu prodda pul yo'qotdi:
    // ТРН-2026-00318 (4 690 000 so'm + $100) → ТРН-2026-00323 5 890 000
    // so'm NAQD qaytardi ⇒ so'm kassasi 1 200 000 ga kamaydi, $100 esa
    // yashiqda qolib ketdi (smena dollar hisobi hech qachon kamaymadi).
    //
    // Endi: $8.38 dollar ulushi so'm naqd cap'iga KIRMAYDI, shuning uchun
    // 100 000 tiyin naqd qaytarish RAD etiladi. Dollar `cashUsdReturnMinor`
    // orqali, o'z birligida qaytariladi.
    const { svc } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_USD', amountMinor: 838n, amountBaseMinor: 100_000n }],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '100000' })),
      // Xabar kassirga DOLLAR maydonini ko'rsatadi — «rad etildi, nega
      // ekani noma'lum» holati bo'lmasin.
    ).rejects.toThrow(/DOLLARDA to'langan/);
  });

  it('QISMAN qaytarishlar zanjirida naqd cap KÜMÜLATIV (bo`lib chiqarib bo`lmaydi)', async () => {
    // 100 000: 30 000 naqd + 70 000 karta. Birinchi qaytarishda 30 000 naqd
    // allaqachon chiqqan ⇒ ikkinchisiga naqd qolmaydi.
    const { svc, money } = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 30_000n },
        { method: 'CARD', amountMinor: 70_000n },
      ],
      priorRefunds: [
        {
          sumMinor: 100_000n,
          cashAmountMinor: 30_000n,
          cardAmountMinor: 0n,
          debtReturnMinor: 0n,
          positions: [],
        },
      ],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });
});

/**
 * DOLLAR QAYTARISH (2026-08-17, egasi qarori — prodda o'lchangan yo'qotishdan keyin).
 *
 * Ilgari dollarda to'langan chek to'liq SO'M bilan qaytarilardi: so'm yashig'i
 * kamayib, mijozning dollari yashiqda qolib ketardi va smenaning dollar hisobi
 * («expectedUsdCash») hech qachon kamaymasdi. Endi dollar O'Z birligida qaytadi.
 *
 * Qulflanadigan shartnomalar:
 *   1. mirror chekka `CASH_USD` qatori yoziladi — SENTDA (smena hisobi shuni o'qiydi);
 *   2. kurs ASL chekdan MUZLATILGAN holda olinadi (joriy kurs EMAS);
 *   3. dollar cap'i: olingandan ko'p dollar chiqmaydi;
 *   4. dollar SO'M pul daftariga TUSHMAYDI (ikki karra chiqim bo'lmasin);
 *   5. kursi yozilmagan dollar qatorida dollar qaytarish TAQIQ (jim 0 emas).
 */
describe('refund() — DOLLAR dollarda qaytadi (2026-08-17)', () => {
  // IZCHIL FIKSTURA: kurs 12 000 so'm/$ (×10^8). $1.00 = 100 sent ⇒
  // 100 × 1.2e12 / 1e8 = 1 200 000 tiyin (= 12 000 so'm). Chek ham shu qiymatda,
  // ya'ni «to'liq dollarda to'langan 12 000 so'mlik chek».
  const RATE_E8 = 1_200_000_000_000n;
  const USD_CENTS = 100n;
  const USD_BASE = 1_200_000n;
  const USD_POSITIONS: OriginalPosition[] = [
    {
      productId: PRODUCT_ID,
      quantity: '10',
      priceMinor: 120_000n,
      discount: '0',
      sumMinor: USD_BASE,
    },
  ];
  const usdReceipt = () => ({
    positions: USD_POSITIONS,
    payments: [
      {
        method: 'CASH_USD',
        amountMinor: USD_CENTS,
        amountBaseMinor: USD_BASE,
        rateMinor: RATE_E8,
      },
    ],
  });

  it('mirror chekka `CASH_USD` qatori yozadi — SENTDA', async () => {
    const { svc, tx } = makeHarness(usdReceipt());

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashUsdReturnMinor: '100' }));

    expect(tx.retailSalePayment.create).toHaveBeenCalledTimes(1);
    const arg = tx.retailSalePayment.create.mock.calls[0]?.[0] as {
      data: { method: string; amountMinor: bigint; currency: string; rateMinor: bigint };
    };
    expect(arg.data.method).toBe('CASH_USD');
    expect(arg.data.amountMinor).toBe(USD_CENTS); // SENT, tiyin emas
    expect(arg.data.currency).toBe('USD');
  });

  it('kurs ASL chekdan MUZLATILGAN holda olinadi', async () => {
    const { svc, tx } = makeHarness(usdReceipt());

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashUsdReturnMinor: '100' }));

    const arg = tx.retailSalePayment.create.mock.calls[0]?.[0] as {
      data: { rateMinor: bigint; amountBaseMinor: bigint };
    };
    // Joriy kurs olinsa kurs o'zgarganda do'konga foyda/zarar yasalardi.
    expect(arg.data.rateMinor).toBe(RATE_E8);
    expect(arg.data.amountBaseMinor).toBe(USD_BASE);
  });

  it('dollar SO`M pul daftariga TUSHMAYDI (ikki karra chiqim yo`q)', async () => {
    const { svc, money } = makeHarness(usdReceipt());

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashUsdReturnMinor: '100' }));

    // So'm naqd 0 ⇒ so'm kassasidan hech narsa chiqmaydi.
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('🔴 olingandan KO`P dollar qaytarib bo`lmaydi', async () => {
    const { svc } = makeHarness(usdReceipt());

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashUsdReturnMinor: '101' })),
    ).rejects.toThrow(/Dollar qaytarish/);
  });

  it('kursi yozilmagan dollar qatorida dollar qaytarish TAQIQ (jimgina 0 emas)', async () => {
    const { svc } = makeHarness({
      positions: USD_POSITIONS,
      // `rateMinor` yo'q — eski chek.
      payments: [{ method: 'CASH_USD', amountMinor: USD_CENTS, amountBaseMinor: USD_BASE }],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashUsdReturnMinor: '100' })),
    ).rejects.toThrow(/kursi yozilmagan/);
  });

  it('ARALASH chek: so`m ulushi so`mda, dollar ulushi dollarda', async () => {
    // 1 200 000 tiyin chek: 600 000 so'm naqd + $0.50 (50 sent = 600 000 tiyin).
    const { svc, money, tx } = makeHarness({
      positions: USD_POSITIONS,
      payments: [
        { method: 'CASH_UZS', amountMinor: 600_000n },
        { method: 'CASH_USD', amountMinor: 50n, amountBaseMinor: 600_000n, rateMinor: RATE_E8 },
      ],
    });

    await svc.refund(
      ACCOUNT,
      USER_ID,
      SALE_ID,
      refundReq('10', { cashAmountMinor: '600000', cashUsdReturnMinor: '50' }),
    );

    // So'm: aynan olingan 600 000 chiqadi (dollar ulushi qo'shilmaydi).
    expect(money.applyDeltas.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ deltaMinor: -600_000n }),
    ]);
    // Dollar: alohida qator, sentda.
    const arg = tx.retailSalePayment.create.mock.calls[0]?.[0] as {
      data: { amountMinor: bigint };
    };
    expect(arg.data.amountMinor).toBe(50n);
  });

  it('so`m ulushidan ko`p so`m qaytarib bo`lmaydi (dollar cap`ni ko`tarmaydi)', async () => {
    const { svc } = makeHarness({
      positions: USD_POSITIONS,
      payments: [
        { method: 'CASH_UZS', amountMinor: 600_000n },
        { method: 'CASH_USD', amountMinor: 50n, amountBaseMinor: 600_000n, rateMinor: RATE_E8 },
      ],
    });

    // To'liq 1 200 000 so'm naqd — dollar ulushi so'mga aylantirilib berilmaydi.
    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '1200000' })),
    ).rejects.toThrow(/so'm pul olgan/);
  });

  it('dollar qatori YO`Q chekda dollar qaytarish 0 bilan cheklanadi', async () => {
    const { svc } = makeHarness({
      positions: TEN,
      payments: [{ method: 'CASH_UZS', amountMinor: 100_000n }],
    });

    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashUsdReturnMinor: '1' })),
    ).rejects.toThrow(/Dollar qaytarish/);
  });
});

/**
 * A2 (2026-08-25) — AVANSDAN to'langan chekning QAYTARILISHI.
 *
 * NEGA SHU FAYLDA: qaytarish jihozi (`makeHarness`) shu yerda va u aynan
 * kerakli yuzani beradi (`payments` qatorlari, `priorRefunds`, mirror
 * `create`, balans/pul dublyorlari). Ikkinchi nusxa yozilsa biri bir kun
 * eskirardi — repoda takrorlangan saboq.
 *
 * Qoida `DEBT` bilan bir xil SINFDA: pul kassaga bu chek orqali KIRMAGAN,
 * demak undan CHIQMAYDI ham. Farqi — qayerga qaytishida: qarz mijozning
 * qarzini kamaytiradi, avans esa mijozning avansini TIKLAYDI.
 */
describe('A2 — refund(): avans mijozning BALANSIGA qaytadi, naqd berilmaydi', () => {
  it('100% avansdan to`langan chek: balans −summa, kassadan bir tiyin ham chiqmaydi', async () => {
    const { svc, balance, money, tx } = makeHarness({
      positions: TEN,
      payments: [{ method: 'PREPAY', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10'));

    expect(balance.applyDelta).toHaveBeenCalledTimes(1);
    const [, acc, cp, cur, delta, meta] = balance.applyDelta.mock.calls[0];
    expect({ acc, cp, cur, delta }).toEqual({
      acc: ACCOUNT,
      cp: AGENT_ID,
      cur: 'UZS',
      delta: -100_000n,
    });
    // Alohida hujjat turi — kassa tarixida «qarz» bilan aralashmaydi.
    expect((meta as { docType?: string })?.docType).toBe('salePrepay');
    // 🔴 `source` YO'Q: manfiy delta mijozga «Qarzingizdan ayirildi» xabarini
    // tanlardi, mijoz esa qarzdor emas edi.
    expect((meta as { source?: string })?.source).toBeUndefined();

    expect(money.applyDeltas).not.toHaveBeenCalled();
    // Mirror chekka PREPAY qatori — kümülativ cap AYNAN shundan o'qiladi.
    expect(tx.retailSalePayment.create).toHaveBeenCalledTimes(1);
    const row = tx.retailSalePayment.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(row.method).toBe('PREPAY');
    expect(row.amountMinor).toBe(100_000n);
  });

  it('🔴 avansdan to`langan chekni NAQD qaytarib bo`lmaydi (R1 sinfi)', async () => {
    const { svc } = makeHarness({
      positions: TEN,
      payments: [{ method: 'PREPAY', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    // Avans puli yashiqqa BU chek orqali kirmagan — naqd qaytarish yashiqdan
    // hech qachon kirmagan pulni chiqarardi (100% karta chekining aynan
    // takrori, prodda o'lchangan R1 hodisasi).
    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '100000' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('qisman qaytarish: avans ulushi PROPORSIONAL qaytadi', async () => {
    const { svc, balance, created } = makeHarness({
      positions: TEN,
      payments: [{ method: 'PREPAY', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('4'));

    expect((balance.applyDelta.mock.calls[0] ?? [])[4]).toBe(-40_000n);
    // Mirror «to'liq yopilgan» bo'lib yoziladi: mijozning puli unga qaytdi.
    expect(created[0]?.data.payedSumMinor).toBe(40_000n);
  });

  it('aralash chek (avans + naqd): har ulush O`Z kanaliga qaytadi', async () => {
    const { svc, balance, money } = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 60_000n },
        { method: 'PREPAY', amountMinor: 40_000n },
      ],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10', { cashAmountMinor: '60000' }));

    // Naqd ulushi yashiqdan, avans ulushi balansdan.
    expect((balance.applyDelta.mock.calls[0] ?? [])[4]).toBe(-40_000n);
    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
    const deltas = (money.applyDeltas.mock.calls[0] ?? [])[2] as Array<{ deltaMinor: bigint }>;
    expect(deltas[0]?.deltaMinor).toBe(-60_000n);
  });

  it('🔴 INVARIANT 4 — avans vozvrati UNDIRISH REYESTRIGA tegmaydi', async () => {
    const { svc, registry } = makeHarness({
      positions: TEN,
      payments: [{ method: 'PREPAY', amountMinor: 100_000n }],
      agentId: AGENT_ID,
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('10'));

    // Avansdan hech qachon `Debt` qatori tug'ilmagan — harakatlantiradigan
    // qator ham yo'q. Q3 ning bloki `debtReturn > 0n` ichida turibdi.
    expect(registry.debtRows).toHaveLength(0);
    expect(registry.debtNote.create).not.toHaveBeenCalled();
  });

  it('kümülativ cap: avval qaytarilgan avans IKKINCHI marta qaytmaydi', async () => {
    const { svc } = makeHarness({
      positions: TEN,
      payments: [{ method: 'PREPAY', amountMinor: 100_000n }],
      agentId: AGENT_ID,
      priorRefunds: [
        {
          sumMinor: 60_000n,
          cashAmountMinor: 0n,
          cardAmountMinor: 0n,
          debtReturnMinor: 0n,
          positions: [{ productId: PRODUCT_ID, quantity: '6' }],
          // Mirror chekdagi PREPAY qatori — server kümülativ ulushni aynan
          // shundan o'qiydi (`priorTotals.prepayMinor`).
          payments: [{ method: 'PREPAY', amountMinor: 60_000n }],
        } as never,
      ],
    });

    // Qolgan 4 dona uchun eng ko'pi 40 000; 41 000 so'rasa rad etiladi.
    await expect(
      svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('4', { prepayReturnMinor: '41000' })),
    ).rejects.toThrow(/Avansga qaytarish/);
  });

  it('uch kanalli chek (naqd + avans + qarz) — uchala cap ham to`g`ri bo`linadi', async () => {
    const { svc, balance, created } = makeHarness({
      positions: TEN,
      payments: [
        { method: 'CASH_UZS', amountMinor: 30_000n },
        { method: 'PREPAY', amountMinor: 40_000n },
        { method: 'DEBT', amountMinor: 30_000n },
      ],
      agentId: AGENT_ID,
    });

    // Yarmi qaytariladi: naqd 15 000, avans 20 000, qarz 15 000.
    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('5', { cashAmountMinor: '15000' }));

    const deltas = balance.applyDelta.mock.calls.map((c) => c[4] as bigint);
    // Avans BIRINCHI (qulf tartibi: BALANS → QARZLAR), keyin qarz.
    expect(deltas).toEqual([-20_000n, -15_000n]);
    expect(created[0]?.data.debtReturnMinor).toBe(15_000n);
  });
});
