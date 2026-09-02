import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { SALE_DEBT_SOURCE_DOC_TYPE } from '../debt/sale-debt-registry.js';
import { mockSaleDebtRegistryTx } from '../debt/sale-debt-registry.mock.js';
import { CASHIER_EVENT } from './cashier-audit.js';
import { RetailSaleService } from './retail-sale.service.js';
import { TENDER } from './retail-tenders.js';

/**
 * A2 — AVANSDAN TO'LASH (`PREPAY` tenderi)
 * (reja: `docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md`).
 *
 * EGASINING SHIKOYATI (2026-08-25): «Ba'zi mijozlarimiz bizga oldindan pul
 * berib qo'yishadi, keyin tovar olishadi — shu mijozlar bilan ishlay
 * olmayapmiz.» A1 QABUL yo'lini ochdi; bu faza SARFLASH yo'lini ochadi.
 *
 * Fayl rejaning invariantlaridan ikkitasini qulflaydi:
 *   4. AVANS QARZ EMAS — avansdan to'lov `Debt` reyestriga TEGMAYDI;
 *   5. avans O'ZIDAN ORTIQ sarflanmaydi — ortig'i JIMGINA qarzga aylanmaydi,
 *      400 bilan rad etiladi.
 * Va A2 ning o'z shartnomasini: chek TO'LANGAN sanaladi, kassa naqdi
 * O'ZGARMAYDI, mijoz balansi +summa.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const TOTAL = 100_000n;

interface HarnessOpts {
  /** `FOR UPDATE` bilan o'qiladigan «balansOldin». Manfiy = AVANS bor. */
  balanceBefore?: bigint | null;
  deskCurrency?: string;
  agentId?: string | null;
}

function makeHarness(opts: HarnessOpts = {}) {
  /** Balans qulfi uchun yugurtirilgan SQL matnlari (kod-shakli tekshiruvi). */
  const lockSqls: string[] = [];
  const registry = mockSaleDebtRegistryTx(
    opts.balanceBefore === undefined ? -1_000_000n : opts.balanceBefore,
  );

  /**
   * 🔴 JONLI BALANS. Registry-mock'ining `$queryRaw` i BITTA statik son
   * qaytaradi, haqiqiy baza esa `applyDelta` dan KEYIN yangilangan qiymatni
   * beradi. A2 ning butun kesishuv-testi (avans → keyin qarz) aynan shu
   * farqqa tayanadi: statik mock bilan test TARTIBNI umuman o'lchamasdi.
   *
   * Shuning uchun bu yerda balans HOLATLI: `applyDelta` uni siljitadi,
   * `$queryRaw` va `counterpartyBalance.findFirst` esa o'sha ondagi
   * qiymatni qaytaradi — Postgres qanday qilsa, shunday.
   */
  const startBalance = opts.balanceBefore === undefined ? -1_000_000n : opts.balanceBefore;
  let liveBalance: bigint | null = startBalance;

  const paymentCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const cashierAuditEvent = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const tx = {
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
        .mockResolvedValue({ id: SALE_ID, state: 'posted', agentId: AGENT_ID, sumMinor: TOTAL }),
    },
    ...registry.tx,
    // Balans so'rovi JONLI qiymatdan; `FROM debts` qulfi registry-mock'iga
    // o'tadi (u yerda haqiqiy qatorlar turibdi).
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray | readonly string[], ...values: unknown[]) => {
        const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (sql.includes('counterparty_balances')) {
          lockSqls.push(sql);
          return liveBalance === null ? [] : [{ balance_minor: liveBalance }];
        }
        return registry.queryRaw(strings, ...values);
      },
    ),
    retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    retailSalePayment: { createMany: paymentCreateMany },
    cashierAuditEvent,
    counterpartyBalance: {
      findFirst: vi.fn(async () => (liveBalance === null ? null : { balanceMinor: liveBalance })),
    },
    cashDesk: { update: vi.fn().mockResolvedValue({}) },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    loyaltyProgram: { findFirst: vi.fn(async () => null) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
    priceType: { findMany: vi.fn().mockResolvedValue([]) },
    counterparty: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'CHK-A2-1',
        state: 'draft',
        sumMinor: TOTAL,
        sessionId: SESSION_ID,
        organizationId: 'org-1',
        agentId: opts.agentId === undefined ? AGENT_ID : opts.agentId,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: 'cd-1',
          storeId: 'store-1',
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: true },
          cashDesk: { currency: opts.deskCurrency ?? 'UZS' },
        },
        positions: [],
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const balanceService = {
    applyDelta: vi.fn(
      async (
        _tx: unknown,
        _acc: string,
        _cp: string,
        _cur: string,
        delta: bigint,
        _meta: unknown,
      ) => {
        liveBalance = (liveBalance ?? 0n) + delta;
      },
    ),
  };
  const money = { applyDeltas: vi.fn().mockResolvedValue(undefined) };
  const svc = new RetailSaleService(
    { client } as never,
    {
      lockBalances: vi.fn().mockResolvedValue(new Map()),
      assertAvailable: vi.fn(),
      applyDeltas: vi.fn(),
    } as never,
    money as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    balanceService as never,
    { applyPayment: async () => {} } as never,
  );

  return {
    svc,
    tx,
    registry,
    balanceService,
    money,
    cashierAuditEvent,
    paymentCreateMany,
    lockSqls,
    balanceAfter: () => liveBalance,
  };
}

/** To'liq AVANSDAN to'langan chek. */
const PREPAY_PAY = {
  cashAmountMinor: '0',
  cardAmountMinor: '0',
  prepayAmountMinor: TOTAL.toString(),
  expectedSumMinor: TOTAL.toString(),
};

const paymentLines = (m: ReturnType<typeof vi.fn>) =>
  ((m.mock.calls[0]?.[0]?.data ?? []) as Array<Record<string, unknown>>) ?? [];

const flipData = (tx: { retailSale: { updateMany: ReturnType<typeof vi.fn> } }) =>
  tx.retailSale.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;

// ───────────────────────── asosiy funksiya ─────────────────────────

describe('A2 — avansdan to`lash: chek to`langan, kassa naqdi o`zgarmaydi', () => {
  it('to`liq avansdan: PREPAY qatori yoziladi va balansga +summa tushadi', async () => {
    const { svc, balanceService, paymentCreateMany } = makeHarness({
      balanceBefore: -1_000_000n,
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    const lines = paymentLines(paymentCreateMany);
    const prepayLine = lines.find((l) => l.method === TENDER.prepay);
    expect(prepayLine).toBeDefined();
    expect(prepayLine?.amountMinor).toBe(TOTAL);
    expect(prepayLine?.amountBaseMinor).toBe(TOTAL);
    expect(prepayLine?.currency).toBe('UZS');

    // Delta MUSBAT — avans yeyiladi (−1 000 000 → −900 000).
    expect(balanceService.applyDelta).toHaveBeenCalledTimes(1);
    const call = balanceService.applyDelta.mock.calls[0] ?? [];
    expect(call[2]).toBe(AGENT_ID);
    expect(call[4]).toBe(TOTAL);
    expect((call[5] as { docType?: string })?.docType).toBe('salePrepay');
    expect((call[5] as { docId?: string })?.docId).toBe(SALE_ID);
  });

  it('🔴 mijozga TELEGRAM xabari KETMAYDI — `source` berilmaydi', async () => {
    const { svc, balanceService } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    // Musbat delta `source` bilan berilsa mijozga «🛒 Qarzga qo'shildi»
    // ketardi — avansini sarflagan mijoz uchun bu OCHIQ YOLG'ON.
    const meta = (balanceService.applyDelta.mock.calls[0] ?? [])[5] as { source?: string };
    expect(meta?.source).toBeUndefined();
  });

  it('🔴 chek TO`LANGAN sanaladi — payedSumMinor = jami (DEBT dan asosiy farq)', async () => {
    const { svc, tx } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    expect(flipData(tx).payedSumMinor).toBe(TOTAL);
  });

  it('🔴 KASSA NAQDI O`ZGARMAYDI — pul daftariga delta yozilmaydi', async () => {
    const { svc, money } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    // Naqd 0, qaytim 0 ⇒ `cashToDrawer === 0n` ⇒ MoneyService umuman
    // chaqirilmaydi. Bu A2 ning o'zagi: pul allaqachon A1 yo'li bilan kirgan.
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('🔴 NAQD USTUNI (legacy) avansni SANAMAYDI — smena kutilgan naqdi o`smaydi', async () => {
    const { svc, tx } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    // `collectCashInputs` AYNAN shu ustunni o'qiydi. Avans unga kirsa
    // kassirga SOXTA ORTIQCHA yozilardi (hech kim bermagan pul).
    expect(flipData(tx).cashAmountMinor).toBe(0n);
    expect(flipData(tx).cardAmountMinor).toBe(0n);
  });

  it('🔴 INVARIANT 4 — Debt reyestriga BIR MARTA ham tegilmaydi', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    expect(registry.debtRows).toHaveLength(0);
    expect(registry.debtNote.create).not.toHaveBeenCalled();
  });

  it('audit izi — PAID_FROM_PREPAY, avans oldin/keyin bilan', async () => {
    const { svc, cashierAuditEvent } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    const rows = cashierAuditEvent.createMany.mock.calls.flatMap(
      (c) => (c[0]?.data ?? []) as Array<Record<string, unknown>>,
    );
    const ev = rows.find((r) => r.type === CASHIER_EVENT.paidFromPrepay);
    expect(ev).toBeDefined();
    expect(ev?.docId).toBe(SALE_ID);
    const payload = ev?.payload as Record<string, unknown>;
    expect(payload.agentId).toBe(AGENT_ID);
    expect(payload.prepayMinor).toBe(TOTAL.toString());
    expect(payload.balanceBeforeMinor).toBe('-1000000');
  });

  it('aralash chek: avans + naqd — ikkala qator ham yoziladi', async () => {
    const { svc, paymentCreateMany, balanceService, money } = makeHarness({
      balanceBefore: -40_000n,
    });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '60000',
      cardAmountMinor: '0',
      prepayAmountMinor: '40000',
      expectedSumMinor: TOTAL.toString(),
    });

    const lines = paymentLines(paymentCreateMany);
    expect(lines.find((l) => l.method === TENDER.cashUzs)?.amountMinor).toBe(60_000n);
    expect(lines.find((l) => l.method === TENDER.prepay)?.amountMinor).toBe(40_000n);
    expect((balanceService.applyDelta.mock.calls[0] ?? [])[4]).toBe(40_000n);
    // Naqd ulushi yashiqqa TUSHADI — avans esa yo'q.
    expect(money.applyDeltas).toHaveBeenCalledTimes(1);
    const deltas = (money.applyDeltas.mock.calls[0] ?? [])[2] as Array<{ deltaMinor: bigint }>;
    expect(deltas[0]?.deltaMinor).toBe(60_000n);
  });
});

// ───────────────────────── invariant 5: cap ─────────────────────────

describe('A2 — invariant 5: avans o`zidan ortiq sarflanmaydi', () => {
  it('avansdan ORTIQ → 400, jimgina qarzga AYLANMAYDI', async () => {
    const { svc, balanceService, registry } = makeHarness({ balanceBefore: -30_000n });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Hech narsa yozilmadi: na balans, na reyestr.
    expect(balanceService.applyDelta).not.toHaveBeenCalled();
    expect(registry.debtRows).toHaveLength(0);
  });

  it('xato matni ANIQ SON bilan aytadi (kassir nima qilishni bilsin)', async () => {
    const { svc } = makeHarness({ balanceBefore: -30_000n });

    // 30 000 tiyin = 300 so'm; xabar major birlikda aytadi.
    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY)).rejects.toThrow(/300/);
  });

  it('avansi YO`Q mijoz (balans musbat) → 400', async () => {
    const { svc } = makeHarness({ balanceBefore: 500_000n });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('balans O`LCHANMAGAN (qator yo`q) → avans 0 deb qaraladi, 400', async () => {
    // `null` = o'lchanmagan. AVANS uchun bu 0 bilan bir xil natija beradi
    // (yo'q pulni sarflatmaymiz) — bu ehtiyotkor tomon.
    const { svc } = makeHarness({ balanceBefore: null });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('🔴 QAYTIM YO`Q — chek qoldig`idan ortiq avans 400 beradi', async () => {
    const { svc, money } = makeHarness({ balanceBefore: -1_000_000n });

    await expect(
      svc.post(ACCOUNT, USER_ID, SALE_ID, {
        cashAmountMinor: '60000',
        cardAmountMinor: '0',
        // 60 000 naqd + 100 000 avans = 160 000, chek esa 100 000.
        // Ortiqchasi qaytim bo'lib yashiqdan CHIQIB KETARDI.
        prepayAmountMinor: TOTAL.toString(),
        expectedSumMinor: TOTAL.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(money.applyDeltas).not.toHaveBeenCalled();
  });

  it('mijozsiz avans → 400', async () => {
    const { svc } = makeHarness({ balanceBefore: -1_000_000n, agentId: null });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('§2.3 chegarasi — DOLLAR yashiqda avans 400 (JIM emas)', async () => {
    const { svc, balanceService } = makeHarness({
      balanceBefore: -1_000_000n,
      deskCurrency: 'USD',
    });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(balanceService.applyDelta).not.toHaveBeenCalled();
  });
});

// ────────────────── Q2 bilan kesishuv (§2.2 tartibi) ──────────────────

describe('A2 × Q2 — avans QARZ blokidan OLDIN qo`llanadi', () => {
  const MIXED = {
    cashAmountMinor: '0',
    cardAmountMinor: '0',
    prepayAmountMinor: '40000',
    debtAmountMinor: '60000',
    expectedSumMinor: TOTAL.toString(),
  };

  it('🔴 avans 40k + qarz 60k → reyestr qatori TO`LIQ 60k bo`ladi', async () => {
    // Bu testning butun mohiyati TARTIB. Agar qarz bloki avval yugursa,
    // §2.2 balansni hamon −40 000 deb ko'rib qatorni 20 000 ga ochardi va
    // 40 000 qarz undirish ro'yxatida KO'RINMAY qolardi — egasining
    // birinchi shikoyatining aynan qaytishi.
    const { svc, registry, balanceService } = makeHarness({ balanceBefore: -40_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, MIXED);

    const rows = registry.debtRows.filter((r) => r.sourceDocType === SALE_DEBT_SOURCE_DOC_TYPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalMinor).toBe(60_000n);

    // Ikkita alohida delta: avans (+40k) va qarz (+60k). Tartib ham shu.
    expect(balanceService.applyDelta).toHaveBeenCalledTimes(2);
    expect((balanceService.applyDelta.mock.calls[0] ?? [])[4]).toBe(40_000n);
    expect((balanceService.applyDelta.mock.calls[0] ?? [])[5]).toMatchObject({
      docType: 'salePrepay',
    });
    expect((balanceService.applyDelta.mock.calls[1] ?? [])[4]).toBe(60_000n);
    expect((balanceService.applyDelta.mock.calls[1] ?? [])[5]).toMatchObject({
      docType: 'retailsale',
    });
  });

  it('chek qisman to`langan: payedSumMinor = jami − qarz', async () => {
    const { svc, tx } = makeHarness({ balanceBefore: -40_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, MIXED);

    expect(flipData(tx).payedSumMinor).toBe(40_000n);
  });

  it('balans QULFLAB o`qiladi — FOR UPDATE, counterparty_balances dan', async () => {
    const { svc, lockSqls } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PREPAY_PAY);

    const lock = lockSqls.find((s) => s.includes('counterparty_balances'));
    expect(lock).toBeDefined();
    expect(lock).toContain('FOR UPDATE');
  });
});

// ───────────────────── kod shakli qo'riqchilari ─────────────────────

const SERVICE_SRC = readFileSync(join(import.meta.dirname, 'retail-sale.service.ts'), 'utf8');
/** Izohlar olib tashlangan kod — qo'riqchi izoh matniga aldanmasin. */
const CODE = SERVICE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('A2 — kod shakli qo`riqchilari', () => {
  it('🔴 avans bloki QARZ blokidan OLDIN turadi (qulf tartibi + §2.2)', () => {
    const prepay = CODE.indexOf('planPrepaySaleAuditEvent(id,');
    const debtBlock = CODE.indexOf('planCreditSaleAuditEvent(id,');
    expect(prepay).toBeGreaterThan(0);
    expect(debtBlock).toBeGreaterThan(0);
    expect(prepay).toBeLessThan(debtBlock);
  });

  it('🔴 avans deltasi `salePrepay` docType bilan yoziladi, `retailsale` bilan EMAS', () => {
    // Turlar ajratilmasa kassa tarixida «qarz» va «avans sarfi» bir xil
    // nomlanardi va A3 ning yorliqlari ikkisini ajrata olmasdi.
    expect(CODE).toContain("docType: 'salePrepay'");
  });

  it('🔴 vozvratda avans deltasi QARZ blokidan OLDIN (deadlock tartibi)', () => {
    const prepayRefund = CODE.indexOf('prepayReturn > 0n && prepayPayerId');
    const debtRefund = CODE.indexOf('debtReturn > 0n && debtorId');
    expect(prepayRefund).toBeGreaterThan(0);
    expect(debtRefund).toBeGreaterThan(0);
    expect(prepayRefund).toBeLessThan(debtRefund);
  });

  it('🔴 avans bloki `Debt` yozuvchisini CHAQIRMAYDI (invariant 4)', () => {
    const start = CODE.indexOf('if (prepayAmount > 0n && debtAgentId)');
    const end = CODE.indexOf('planCreditSaleAuditEvent(id,');
    expect(start).toBeGreaterThan(0);
    const block = CODE.slice(start, end);
    expect(block).not.toContain('writeSaleDebtRegistryRow');
    expect(block).not.toContain('moveSaleDebtRegistryRow');
    expect(block).not.toContain('debtNote');
  });
});

// ───────────────────── edit() chegarasi (ochiq qayd) ─────────────────────

/**
 * A2 — AVANSDAN to'langan chek TAHRIRLANMAYDI.
 *
 * `planReceiptEdit` ning pul mantig'i bitta soddalashtirishga tayanadi:
 * `cashDeltaMinor = yangi payed − eski payed`, ya'ni «to'langan hamma narsa
 * NAQD». Avansdan to'langan chekda bu yashiqqa HECH QACHON kirmagan pulni
 * chiqarib yuborardi (R1 sinfi), mijozning balansi esa joyida qolardi.
 *
 * Tahrirni to'g'ri qilish uchun `planReceiptEdit` ga kanal-kesimi kerak —
 * bu A2 hajmidan tashqarida va hisobotda OCHIQ CHEGARA sifatida qayd
 * etilgan. Shu sababdan JIM emas, 400.
 */
function makeEditHarness(payments: Array<{ method: string }>) {
  const client = {
    retailSale: {
      findFirst: vi.fn(async () => ({
        id: SALE_ID,
        name: 'CHK-A2-EDIT',
        state: 'posted',
        version: 1,
        agentId: AGENT_ID,
        sumMinor: TOTAL,
        payedSumMinor: TOTAL,
        refundedFromId: null,
        positions: [],
        payments,
      })),
      findMany: vi.fn(async () => []),
    },
  };
  const svc = new RetailSaleService(
    { client } as never,
    { applyDeltas: vi.fn() } as never,
    { applyDeltas: vi.fn() } as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn() } as never,
    { applyDelta: vi.fn() } as never,
    { applyPayment: async () => {} } as never,
  );
  return { svc, client };
}

const EDIT_REQ = { version: 1, paidMinor: TOTAL.toString(), debtMinor: '0' };

describe('A2 — edit(): avansdan to`langan chek tahrirlanmaydi', () => {
  it('🔴 PREPAY qatori bor chek → 400, kassir vozvratga yo`naltiriladi', async () => {
    const { svc } = makeEditHarness([{ method: TENDER.prepay }]);

    await expect(svc.edit(ACCOUNT, USER_ID, SALE_ID, EDIT_REQ)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.edit(ACCOUNT, USER_ID, SALE_ID, EDIT_REQ)).rejects.toThrow(/vozvrat|Tovarni/);
  });

  it('PREPAY qatorisiz chek — A2 qo`riqchisi yo`lni TO`SMAYDI', async () => {
    const { svc } = makeEditHarness([{ method: TENDER.cashUzs }]);

    // Jihoz minimal (tovar tarkibi bo'sh), shuning uchun tahrir baribir
    // rad etiladi — LEKIN BOSHQA sabab bilan. Muhimi shu: A2 qo'riqchisi
    // avanssiz chekka umuman tegmaydi.
    await expect(svc.edit(ACCOUNT, USER_ID, SALE_ID, EDIT_REQ)).rejects.not.toThrow(/avansidan/);
  });

  it('to`lov qatorlari UMUMAN yo`q eski chek ham qo`riqchidan o`tadi', async () => {
    const { svc } = makeEditHarness([]);

    await expect(svc.edit(ACCOUNT, USER_ID, SALE_ID, EDIT_REQ)).rejects.not.toThrow(/avansidan/);
  });
});
