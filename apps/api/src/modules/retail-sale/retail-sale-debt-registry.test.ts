import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import {
  DEFAULT_SALE_DEBT_TERM_DAYS,
  SALE_DEBT_SOURCE_DOC_TYPE,
  tashkentDayKey,
} from '../debt/sale-debt-registry.js';
import { mockSaleDebtRegistryTx } from '../debt/sale-debt-registry.mock.js';
import { DebtCollectionService } from '../manager/collection/debt-collection.service.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * Q2 — KASSA CHEKIDAN UNDIRISH REYESTRIGA QATOR
 * (reja: `docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md`).
 *
 * EGASINING SHIKOYATI (2026-08-25): «Qarzdorlikni undirish bo'limiga kassadan
 * qo'shilgan yangi qarzdorliklar ko'rinmayapti.» Sabab — qarz IKKI daftarda
 * yashaydi va undirish ro'yxati FAQAT `Debt` reyestridan o'qiydi, POS cheki esa
 * faqat `CounterpartyBalance` ga yozardi.
 *
 * Bu fayl rejaning BESH INVARIANTIDAN uchtasini qulflaydi (2-si Q3, 5-si A2):
 *   1. balansga IKKI MARTA yozilmaydi (`applyDelta` AYNAN bitta chaqiruv);
 *   3. idempotentlik — bitta chekdan ko'pi bilan bitta qator;
 *   4. AVANS qarz emas — manfiy balansdan `Debt` qatori TUG'ILMAYDI.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const TOTAL = 300_000n;

interface HarnessOpts {
  /** `FOR UPDATE` bilan o'qiladigan «balansOldin». `null` = qator YO'Q. */
  balanceBefore?: bigint | null;
  /** Yashiq valyutasi — MK31 dollar yashiq stsenariysi uchun. */
  deskCurrency?: string;
  agentId?: string | null;
  /** Reyestrda ALLAQACHON mavjud qator (idempotentlik testi). */
  seedExistingRow?: boolean;
  /**
   * Q4 — akkauntning `company_settings.sale_debt_term_days` i.
   * `undefined` ⇒ sozlama qatori umuman YO'Q (Q1/Q2 ning default xulqi).
   */
  saleDebtTermDays?: number | null;
}

function makeHarness(opts: HarnessOpts = {}) {
  const registry = mockSaleDebtRegistryTx(
    opts.balanceBefore === undefined ? 0n : opts.balanceBefore,
    undefined,
    opts.saleDebtTermDays,
  );
  if (opts.seedExistingRow) {
    registry.debtRows.push({
      id: 'debt-seed',
      name: 'QRZ-2026-00001',
      sourceDocType: SALE_DEBT_SOURCE_DOC_TYPE,
      sourceDocId: SALE_ID,
      totalMinor: TOTAL,
    });
  }

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
    retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierAuditEvent,
    // Audit hodisasi uchun `applyDelta` DAN KEYINGI qoldiq (qulfli o'qish EMAS).
    counterpartyBalance: { findFirst: vi.fn().mockResolvedValue({ balanceMinor: TOTAL }) },
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
        name: 'CHK-Q2-1',
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

  const balanceService = { applyDelta: vi.fn().mockResolvedValue(undefined) };
  const svc = new RetailSaleService(
    { client } as never,
    {
      lockBalances: vi.fn().mockResolvedValue(new Map()),
      assertAvailable: vi.fn(),
      applyDeltas: vi.fn(),
    } as never,
    { applyDeltas: vi.fn().mockResolvedValue(undefined) } as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    balanceService as never,
    { applyPayment: async () => {} } as never,
  );

  return { svc, tx, registry, balanceService, cashierAuditEvent };
}

/** To'liq QARZGA sotilgan chek. */
const DEBT_PAY = {
  cashAmountMinor: '0',
  cardAmountMinor: '0',
  debtAmountMinor: TOTAL.toString(),
  expectedSumMinor: TOTAL.toString(),
};

/** Reyestrda `retailsale` manbasidan tug'ilgan qatorlar. */
const saleRows = (registry: ReturnType<typeof mockSaleDebtRegistryTx>) =>
  registry.debtRows.filter((r) => r.sourceDocType === SALE_DEBT_SOURCE_DOC_TYPE);

// ───────────────────────── asosiy funksiya ─────────────────────────

describe('Q2 — qarzga sotilgan chek undirish reyestrida paydo bo`ladi', () => {
  it('bitta qator ochiladi: balanceAdopted, sourceDocId=sale.id, muddat NULL EMAS', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const rows = saleRows(registry);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.totalMinor).toBe(TOTAL);
    expect(row?.paidMinor).toBe(0n);
    expect(row?.currency).toBe('UZS');
    expect(row?.status).toBe('unpaid');
    // Invariant 1 — qator balansga QAYTA yozmaydi.
    expect(row?.balanceAdopted).toBe(true);
    expect(row?.sourceDocId).toBe(SALE_ID);
    expect(row?.sourceDocType).toBe(SALE_DEBT_SOURCE_DOC_TYPE);
    // 🔴 NULL bo'lsa qator `no_due_date` chelagida qolib, eslatma cron'i
    // (`nextContactAt: { lte: now }`) uni umuman ko'rmasdi.
    expect(row?.nextContactAt).toBeInstanceOf(Date);
    // Qarzni bergan KASSIR — §3.9 kunlik kassir hisoboti shundan yig'iladi.
    expect(row?.issuedById).toBe(USER_ID);
    expect(row?.ownerId).toBe(USER_ID);
    expect(row?.name).toMatch(/^QRZ-\d{4}-\d{5}$/);
  });

  it('«bu qator qayerdan keldi» — DebtNote (kind: debt_issue) yoziladi', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(registry.debtNote.create).toHaveBeenCalledTimes(1);
    const note = registry.debtNote.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(note.kind).toBe('debt_issue');
    expect(note.authorId).toBe(USER_ID);
    expect(String(note.text)).toContain('CHK-Q2-1');
    expect(String(note.text)).toContain('balanceAdopted');
  });

  it('🔴 INVARIANT 1 — balansga AYNAN BIR MARTA yoziladi (ikki karra sanash yo`q)', async () => {
    const { svc, balanceService } = makeHarness({ balanceBefore: 0n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(balanceService.applyDelta).toHaveBeenCalledTimes(1);
    const call = balanceService.applyDelta.mock.calls[0] ?? [];
    expect(call[4]).toBe(TOTAL);
    // Mijozga Telegram xabari AYNAN shu `source` orqali ketadi — reyestr
    // qatori ikkinchi `applyDelta` chaqirmagani uchun ikkinchi xabar ham
    // ketmaydi (`source:'debt'` yo'li ochilmaydi).
    expect((call[5] as { source?: string })?.source).toBe('retailsale');
  });

  it('to`liq NAQD chek — reyestr qatori YO`Q, balansga ham yozilmaydi', async () => {
    const { svc, registry, balanceService } = makeHarness();

    await svc.post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: TOTAL.toString(),
      cardAmountMinor: '0',
      expectedSumMinor: TOTAL.toString(),
    });

    expect(saleRows(registry)).toHaveLength(0);
    expect(balanceService.applyDelta).not.toHaveBeenCalled();
    expect(registry.queryRaw).not.toHaveBeenCalled();
  });

  it('mijozsiz qarz — mavjud 400 xulqi O`ZGARMADI, qator ham ochilmaydi', async () => {
    const { svc, registry } = makeHarness({ agentId: null });

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(saleRows(registry)).toHaveLength(0);
  });
});

// ───────────────────────── invariant 3: idempotentlik ─────────────────────────

describe('Q2 — idempotentlik (invariant 3)', () => {
  it('reyestrda o`sha `sourceDocId` bilan qator BOR — ikkinchisi ochilmaydi', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n, seedExistingRow: true });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(saleRows(registry)).toHaveLength(1);
    // Raqam ham SARFLANMAYDI — `QRZ-` ketma-ketligida teshik qolmaydi.
    // 🔴 Faqat `QRZ-` kaliti tekshiriladi: post() endi AYNI tranzaksiyada
    // kunlik chek raqamini ham suradi (`CHEKKUN:…`, 2026-09-02) va u har
    // chekda, shu jumladan idempotent takrorda ham, o'z raqamini oladi.
    const qrzCalls = registry.tx.documentSequence.update.mock.calls.filter(
      (c: [{ where: { accountId_key: { key: string } } }]) =>
        c[0].where.accountId_key.key.startsWith('QRZ-'),
    );
    expect(qrzCalls).toHaveLength(0);
    expect(registry.debtNote.create).not.toHaveBeenCalled();
  });

  it('takroriy post: `ON CONFLICT DO NOTHING` — ikkinchi qator qo`shilmaydi', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n });

    // Birinchi post → qator ochiladi.
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);
    // Ikkinchi post (mock holatli — qator saqlanib qoldi) → qo'shilmaydi.
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(saleRows(registry)).toHaveLength(1);
  });
});

// ───────────────── §2.2 KESISHUV QOIDASI — avans bilan chorrahada ─────────────────

describe('Q2 — §2.2 kesishuv qoidasi (invariant 4: AVANS qarz emas)', () => {
  it('avansi qarzdan KATTA mijoz → qator UMUMAN ochilmaydi, balans esa o`sadi', async () => {
    // Balans −1 000 000 (avans), chek qarzi 300 000 ⇒ −700 000: qarz TUG'ILMADI.
    const { svc, registry, balanceService } = makeHarness({ balanceBefore: -1_000_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(saleRows(registry)).toHaveLength(0);
    expect(registry.debtNote.create).not.toHaveBeenCalled();
    // Balans yo'li O'ZGARMAYDI — avans yeyilishi AYNAN shu delta bilan yoziladi.
    expect(balanceService.applyDelta).toHaveBeenCalledTimes(1);
    expect(balanceService.applyDelta.mock.calls[0]?.[4]).toBe(TOTAL);
  });

  it('avans QISMAN qopladi → qator FAQAT qolgan qismga ochiladi', async () => {
    // Balans −100 000, chek qarzi 300 000 ⇒ +200 000 ⇒ qator 200 000.
    const { svc, registry } = makeHarness({ balanceBefore: -100_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const rows = saleRows(registry);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalMinor).toBe(200_000n);
    const note = String(registry.debtNote.create.mock.calls[0]?.[0].data.text);
    expect(note).toContain('AVANSIDAN');
    expect(note).toContain('100000');
  });

  it('balansi O`LCHANMAGAN (`null`) mijoz → to`liq qator + izohda ochiq qayd', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: null });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const rows = saleRows(registry);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalMinor).toBe(TOTAL);
    // NULL ≠ 0 — ehtiyotkor tanlov OCHIQ yoziladi, jimgina emas.
    expect(String(registry.debtNote.create.mock.calls[0]?.[0].data.text)).toContain('LCHANMAGAN');
  });

  it('qarz USTIGA qarz (balans musbat) → qator to`liq chek qarziga', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 200_000n });

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(saleRows(registry)[0]?.totalMinor).toBe(TOTAL);
  });
});

// ───────────────────────── valyuta chegarasi (§2.3) ─────────────────────────

describe('Q2 — qarz daftari valyutasidan boshqa yashiq', () => {
  it('USD yashiq → qator OCHILMAYDI va bu JIMGINA emas (ogohlantirish logi)', async () => {
    const { svc, registry, balanceService } = makeHarness({ deskCurrency: 'USD' });
    const warn = vi.spyOn(
      (svc as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );

    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    expect(saleRows(registry)).toHaveLength(0);
    // Balans qulfi ham olinmaydi — u so'm qatoriga tegardi, bu esa boshqa daftar.
    expect(registry.queryRaw).not.toHaveBeenCalled();
    // Mavjud xulq (balansga yozish) BUZILMAYDI.
    expect(balanceService.applyDelta).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('USD'));
  });
});

// ───────────────────── kod-shakl qo'riqchisi: qulf tartibi ─────────────────────

const SERVICE = readFileSync(join(import.meta.dirname, 'retail-sale.service.ts'), 'utf8');

/** `post()` ning qarz bloki — `if (debtAmount > 0n && debtAgentId) { … }`. */
function debtBlock(): string {
  const start = SERVICE.indexOf('if (debtAmount > 0n && debtAgentId) {');
  expect(start, 'qarz bloki topilmadi').toBeGreaterThan(-1);
  const end = SERVICE.indexOf('// Smena agregatlari', start);
  expect(end, 'blok oxiri topilmadi').toBeGreaterThan(start);
  return SERVICE.slice(start, end);
}

describe('Q2 — kod shakli: balans QULFI `applyDelta` dan OLDIN (P1 tartibi)', () => {
  it('`lockCounterpartyBalance` chaqiruvi `applyDelta` dan OLDIN turadi', () => {
    const body = debtBlock();
    const lock = body.indexOf('this.lockCounterpartyBalance(');
    const delta = body.indexOf('this.counterpartyBalance.applyDelta(');
    expect(lock, 'qulf chaqiruvi yo`q').toBeGreaterThan(-1);
    expect(delta).toBeGreaterThan(-1);
    // Qulfsiz o'qilgan «balansOldin» bilan ikki parallel chek bir xil qarorga
    // kelib, ikkalasi ham qator ochmasdi (yoki ikkalasi ham to'liq ochardi).
    expect(lock).toBeLessThan(delta);
  });

  it('reyestr yozuvchisi balans deltasidan KEYIN chaqiriladi', () => {
    const body = debtBlock();
    expect(body.indexOf('this.counterpartyBalance.applyDelta(')).toBeLessThan(
      body.indexOf('this.writeSaleDebtRegistryRow('),
    );
  });

  it('qulf `FOR UPDATE` bilan va kontragent-balans jadvalidan olinadi', () => {
    const start = SERVICE.indexOf('private async lockCounterpartyBalance');
    const body = SERVICE.slice(start, start + 900);
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('counterparty_balances');
  });

  it('reyestr yozuvchisi `applyDelta` ni CHAQIRMAYDI (invariant 1)', () => {
    const start = SERVICE.indexOf('private async writeSaleDebtRegistryRow');
    const end = SERVICE.indexOf('\n  /**', start + 10);
    // Izohlar olib tashlanadi — ular `applyDelta` ni ATAYLAB tilga oladi
    // («balans deltasidan KEYIN»); qo'riqchi KODni tekshiradi, matnni emas.
    // Bu `counterparty-balance-sources.ts` skanerining aynan shu odati.
    const body = SERVICE.slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(body).not.toContain('applyDelta');
  });
});

// ─────────────── uchma-uch: qator UNDIRISH RO'YXATIDA ko'rinadi ───────────────

/**
 * Q2 ning butun mohiyati: yozilgan qator menejerning «Qarz undirish» ekraniga
 * yetib borsin. Shu sababdan bu test `DebtCollectionService.list` ni AYNAN
 * yozilgan qator shakli bilan yugurtiradi — «yozdik» bilan «ko'rindi» orasida
 * yana bir yashirin filtr qolmasin.
 */
function makeCollection(
  debtRow: Record<string, unknown>,
  /** Q4 — bazadagi cheklar (`saleId → CHK-…`). Berilmasa chek topilmaydi. */
  sales: Record<string, string> = {},
) {
  const client = {
    debt: { findMany: vi.fn().mockResolvedValue([debtRow]) },
    debtNote: { groupBy: vi.fn().mockResolvedValue([]) },
    retailSale: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in
          .filter((id) => sales[id] !== undefined)
          .map((id) => ({ id, name: sales[id] })),
      ),
    },
  };
  return new DebtCollectionService({ client } as never, {} as never);
}

describe('Q2 — yozilgan qator undirish ro`yxatida CHIQADI', () => {
  it('chekdan tug`ilgan qator ro`yxatga tushadi, muddati va javobgari bilan', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n });
    const now = new Date('2026-08-25T10:00:00.000Z');
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const written = saleRows(registry)[0] as Record<string, unknown>;
    const collection = makeCollection({
      id: 'debt-1',
      name: written.name,
      counterpartyId: AGENT_ID,
      totalMinor: written.totalMinor,
      paidMinor: written.paidMinor,
      currency: written.currency,
      status: written.status,
      problem: false,
      nextContactAt: written.nextContactAt,
      lastCallAt: null,
      lastCallOutcome: null,
      counterparty: { name: 'Sinov mijoz', phone: null },
      owner: null,
      issuedBy: { id: USER_ID, name: 'Kassir' },
    });

    const res = await collection.list(ACCOUNT, { scope: 'all', limit: 50 } as never, now);

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.remainingMinor).toBe(TOTAL);
    // Muddat 14 kun keyin ⇒ hali kelmagan, ya'ni «kechikkan» EMAS.
    expect(res.rows[0]?.overdueDays).toBeLessThan(0);
    expect(res.rows[0]?.responsible?.id).toBe(USER_ID);
  });
});

// ───────────────────── Q4 — MUDDAT SOZLAMASI + MANBA ─────────────────────

/**
 * Q4 (2026-08-25) — kassa qarzining muddati akkaunt sozlamasidan
 * (`CompanySettings.saleDebtTermDays`), va yozilgan qator undirish
 * ro'yxatida MANBA belgisi bilan chiqadi.
 * Reja: `docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md` §Q4.
 */
describe('Q4 — muddat AKKAUNT SOZLAMASIDAN olinadi', () => {
  /** Toshkent kalendar kuni bo'yicha muddat kuni (`YYYY-MM-DD`). */
  const dueDay = (row: Record<string, unknown>) => tashkentDayKey(row.nextContactAt as Date);

  it('sozlama YO`Q (qator umuman yo`q) ⇒ Q1 defaulti — 14 kun, xulq O`ZGARMAYDI', async () => {
    const { svc, registry, tx } = makeHarness({ balanceBefore: 0n });
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const row = saleRows(registry)[0] as Record<string, unknown>;
    const posted = tashkentDayKey(new Date());
    const expected = tashkentDayKey(
      new Date(Date.parse(`${posted}T00:00:00.000Z`) + DEFAULT_SALE_DEBT_TERM_DAYS * 86_400_000),
    );
    expect(dueDay(row)).toBe(expected);
    // Sozlama AYNAN akkaunt kesimida o'qiladi.
    expect(tx.companySettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: ACCOUNT } }),
    );
  });

  it('sozlama qatori BOR, lekin ustun `null` ⇒ ham default (NULL = sozlanmagan)', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n, saleDebtTermDays: null });
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const row = saleRows(registry)[0] as Record<string, unknown>;
    const posted = tashkentDayKey(new Date());
    const expected = tashkentDayKey(
      new Date(Date.parse(`${posted}T00:00:00.000Z`) + DEFAULT_SALE_DEBT_TERM_DAYS * 86_400_000),
    );
    expect(dueDay(row)).toBe(expected);
  });

  it('sozlangan 3 kun ⇒ qator AYNAN 3 kunlik muddat bilan ochiladi', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n, saleDebtTermDays: 3 });
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const row = saleRows(registry)[0] as Record<string, unknown>;
    const posted = tashkentDayKey(new Date());
    const expected = tashkentDayKey(
      new Date(Date.parse(`${posted}T00:00:00.000Z`) + 3 * 86_400_000),
    );
    expect(dueDay(row)).toBe(expected);
  });

  it('🔴 sozlama `0` ⇒ muddat O`SHA KUN (NULL bilan chalkashmaydi)', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n, saleDebtTermDays: 0 });
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const row = saleRows(registry)[0] as Record<string, unknown>;
    expect(dueDay(row)).toBe(tashkentDayKey(new Date()));
    // Muddat baribir NULL EMAS — Q1 ning 2-shartnomasi buzilmaydi.
    expect(row.nextContactAt).toBeInstanceOf(Date);
  });

  it('🔴 YAROQSIZ sozlama chekni YIQITMAYDI — default olinadi', async () => {
    // Kassani 500 bilan to'xtatish 2026-08-24 hodisasining sinfi bo'lardi.
    const { svc, registry } = makeHarness({ balanceBefore: 0n, saleDebtTermDays: -5 });
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const row = saleRows(registry)[0] as Record<string, unknown>;
    const posted = tashkentDayKey(new Date());
    const expected = tashkentDayKey(
      new Date(Date.parse(`${posted}T00:00:00.000Z`) + DEFAULT_SALE_DEBT_TERM_DAYS * 86_400_000),
    );
    expect(dueDay(row)).toBe(expected);
  });

  it('sozlama SOF qoidadan yuradi — servisda ikkinchi formula yozilmagan', () => {
    const src = readFileSync(join(import.meta.dirname, 'retail-sale.service.ts'), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      '',
    );
    // Muddat sof moduldan (`resolveSaleDebtTermDays`) chiqariladi…
    expect(src).toMatch(/resolveSaleDebtTermDays\(/);
    // …va sozlama AYNAN `companySettings` dan o'qiladi (qulf OLINMAYDI:
    // bu sozlama, pul emas — deadlock yuzasiga uchinchi ishtirokchi
    // qo'shilmaydi).
    expect(src).toMatch(/companySettings\.findUnique/);
    expect(src).not.toMatch(/company_settings[\s\S]{0,80}FOR UPDATE/);
  });
});

describe('Q4 — chekdan tug`ilgan qator undirish ro`yxatida MANBA bilan chiqadi', () => {
  it('qator `retailsale` manbasi va CHEK RAQAMI bilan ko`rinadi', async () => {
    const { svc, registry } = makeHarness({ balanceBefore: 0n });
    const now = new Date('2026-08-25T10:00:00.000Z');
    await svc.post(ACCOUNT, USER_ID, SALE_ID, DEBT_PAY);

    const written = saleRows(registry)[0] as Record<string, unknown>;
    const collection = makeCollection(
      {
        id: 'debt-1',
        name: written.name,
        counterpartyId: AGENT_ID,
        totalMinor: written.totalMinor,
        paidMinor: written.paidMinor,
        currency: written.currency,
        status: written.status,
        problem: false,
        nextContactAt: written.nextContactAt,
        lastCallAt: null,
        lastCallOutcome: null,
        // 🔴 AYNAN Q2 yozgan bog'lam — test uni qo'ldan to'ldirmaydi.
        sourceDocType: written.sourceDocType,
        sourceDocId: written.sourceDocId,
        counterparty: { name: 'Sinov mijoz', phone: null },
        owner: null,
        issuedBy: { id: USER_ID, name: 'Kassir' },
      },
      { [SALE_ID]: 'CHK-Q2-1' },
    );

    const res = await collection.list(ACCOUNT, { scope: 'all', limit: 50 } as never, now);

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      source: 'retailsale',
      sourceDocId: SALE_ID,
      sourceDocNumber: 'CHK-Q2-1',
    });
    expect(res.summary.retailSaleCount).toBe(1);
    expect(res.summary.registryCount).toBe(0);
  });
});
