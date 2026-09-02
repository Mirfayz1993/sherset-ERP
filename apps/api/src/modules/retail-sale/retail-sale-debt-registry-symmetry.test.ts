import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { SALE_DEBT_SOURCE_DOC_TYPE } from '../debt/sale-debt-registry.js';
import { mockSaleDebtRegistryTx } from '../debt/sale-debt-registry.mock.js';
import { allowedFrom } from './retail-sale-fsm.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * Q3 — SIMMETRIYA: vozvrat va chek tahriri REYESTRNI ham harakatlantiradi
 * (reja: `docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md`, invariant 2).
 *
 * MUAMMO: Q2 dan keyin qarzga sotilgan chek `Debt` reyestriga qator ochadi va
 * u undirish ro'yxatida ko'rinadi. Tovar qaytarilsa balansdan `−debtReturn`
 * yoziladi — lekin qator joyida qolsa undirish ro'yxati QAYTARILGAN tovar
 * uchun pul talab qilib turardi va mijozga «qarzingizni to'lang» eslatmasi
 * ketardi. Ya'ni bitta qarz ikki daftarda ikki xil songa aylanardi.
 *
 * QOIDA: balans qancha harakatlansa, reyestr qatori AYNAN shuncha
 * harakatlanadi — va bu yo'l `applyDelta` ni HECH QACHON chaqirmaydi
 * (qator `balanceAdopted = true`; ikkalasi yozsa qarz ikki marta kamayardi).
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const AGENT2_ID = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const DEBT_ROW_ID = 'debt-registry-1';

const SERVICE = readFileSync(join(import.meta.dirname, 'retail-sale.service.ts'), 'utf8');

/** 300 000 tiyinlik chek, 3 dona — to'liq QARZGA sotilgan. */
const SUM = 300_000n;

interface RegistrySeed {
  totalMinor: bigint;
  paidMinor?: bigint;
  status?: string;
  counterpartyId?: string;
  nextContactAt?: Date | null;
}

interface HarnessOpts {
  /** Reyestrda chekdan tug'ilgan qator. Berilmasa — qator YO'Q. */
  registryRow?: RegistrySeed;
  /** Yashiq valyutasi (MK31 — dollar yashiq §2.3 chegarasi). */
  deskCurrency?: string;
  /** Kontragent kesimidagi «balansOldin» (tahrirda ikki mijoz bo'lishi mumkin). */
  balanceByCounterparty?: Map<string, bigint | null>;
  /** Chekning naqd bilan to'langan qismi (qolgani — qarz). */
  paidMinor?: bigint;
  agentId?: string | null;
}

function makeHarness(opts: HarnessOpts = {}) {
  const paidMinor = opts.paidMinor ?? 0n;
  const debtMinor = SUM - paidMinor;
  const agentId = opts.agentId === undefined ? AGENT_ID : opts.agentId;
  const currency = opts.deskCurrency ?? 'UZS';

  const registry = mockSaleDebtRegistryTx(0n, opts.balanceByCounterparty);
  if (opts.registryRow) {
    registry.debtRows.push({
      id: DEBT_ROW_ID,
      name: 'QRZ-2026-00007',
      sourceDocType: SALE_DEBT_SOURCE_DOC_TYPE,
      sourceDocId: SALE_ID,
      counterpartyId: opts.registryRow.counterpartyId ?? agentId ?? AGENT_ID,
      totalMinor: opts.registryRow.totalMinor,
      paidMinor: opts.registryRow.paidMinor ?? 0n,
      status: opts.registryRow.status ?? 'unpaid',
      nextContactAt:
        opts.registryRow.nextContactAt === undefined
          ? new Date('2026-09-08T04:00:00.000Z')
          : opts.registryRow.nextContactAt,
      closedAt: null,
    });
  }

  const created: { data: Record<string, unknown> }[] = [];
  const tx = {
    ...registry.tx,
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
    retailSalePayment: { create: vi.fn().mockResolvedValue({}) },
    stockOperation: { findMany: vi.fn().mockResolvedValue([]) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };

  const payments = [
    ...(paidMinor > 0n
      ? [
          {
            method: 'CASH_UZS',
            amountMinor: paidMinor,
            amountBaseMinor: paidMinor,
            rateMinor: null,
          },
        ]
      : []),
    ...(debtMinor > 0n
      ? [{ method: 'DEBT', amountMinor: debtMinor, amountBaseMinor: debtMinor, rateMinor: null }]
      : []),
  ];

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    cashierSession: {
      findFirst: vi.fn(async () => ({
        id: SESSION_ID,
        cashierId: 'cashier-1',
        cashDeskId: CASHDESK_ID,
        storeId: STORE_ID,
        cashDesk: { currency },
      })),
    },
    cashierAuditEvent: { findFirst: vi.fn(async () => null) },
    bonusOperation: { findFirst: vi.fn(async () => null) },
    retailSale: {
      findFirst: vi.fn(async () => ({
        id: SALE_ID,
        name: 'ТРН-2026-00042',
        state: 'posted',
        version: 3,
        sessionId: SESSION_ID,
        organizationId: 'org-1',
        agentId,
        refundedFromId: null,
        sumMinor: SUM,
        payedSumMinor: paidMinor,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: CASHDESK_ID,
          storeId: STORE_ID,
          cashDesk: { currency },
        },
        payments,
        positions: [
          {
            productId: PRODUCT_ID,
            quantity: '3',
            priceMinor: 100_000n,
            discount: '0',
            sumMinor: SUM,
            costMinor: null,
            basePriceMinor: null,
          },
        ],
      })),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const money = { applyDeltas: vi.fn().mockResolvedValue(undefined) };
  const balance = { applyDelta: vi.fn().mockResolvedValue(undefined) };
  const svc = new RetailSaleService(
    { client } as never,
    { applyDeltas: vi.fn(), lockBalances: vi.fn(), assertAvailable: vi.fn() } as never,
    money as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    balance as never,
    { applyPayment: async () => {} } as never,
  );
  return { svc, tx, client, created, money, balance, registry };
}

/** Reyestrdagi chek qatori (mock holatli — yozilgan qiymat AYNAN shu yerda). */
const row = (registry: ReturnType<typeof mockSaleDebtRegistryTx>) =>
  registry.debtRows.find((r) => r.id === DEBT_ROW_ID) as Record<string, unknown> | undefined;

const noteText = (registry: ReturnType<typeof mockSaleDebtRegistryTx>) =>
  registry.debtNote.create.mock.calls.map((c) => String(c[0].data.text)).join('\n');

const refundReq = (quantity: string, over: Record<string, string> = {}) => ({
  positions: [{ productId: PRODUCT_ID, quantity }],
  cashAmountMinor: '0',
  cardAmountMinor: '0',
  ...over,
});

// ──────────────────────────── refund() simmetriyasi ────────────────────────────

describe('Q3 — refund(): reyestr qatori balans bilan BIRGA harakatlanadi', () => {
  it('to`liq vozvrat → qator YOPILADI (paid, qoldiq 0, muddat NULL)', async () => {
    const { svc, balance, registry } = makeHarness({ registryRow: { totalMinor: SUM } });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'));

    // Balans −300 000 oldi…
    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-SUM);
    // …reyestr ham AYNAN shuncha (invariant 2).
    const r = row(registry);
    expect(r?.totalMinor).toBe(0n);
    expect(r?.status).toBe('paid');
    expect(r?.closedAt).toBeInstanceOf(Date);
    // §3.6 — yopilgan qatorga keyingi aloqa sanasi kerak emas.
    expect(r?.nextContactAt).toBeNull();
  });

  it('qisman vozvrat → qator KAMAYADI, lekin ochiq qoladi (undirish davom etadi)', async () => {
    const { svc, balance, registry } = makeHarness({ registryRow: { totalMinor: SUM } });

    // 3 donadan 1 tasi qaytdi ⇒ 100 000.
    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('1'));

    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-100_000n);
    const r = row(registry);
    expect(r?.totalMinor).toBe(200_000n);
    expect(r?.status).toBe('unpaid');
    expect(r?.closedAt).toBeNull();
    expect(r?.nextContactAt).toBeInstanceOf(Date);
  });

  it('🔴 INVARIANT 2 — balans deltasi va reyestr deltasi AYNAN teng', async () => {
    const { svc, balance, registry } = makeHarness({ registryRow: { totalMinor: SUM } });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('2'));

    const balanceDelta = balance.applyDelta.mock.calls[0]?.[4] as bigint;
    const registryDelta = (row(registry)?.totalMinor as bigint) - SUM;
    expect(registryDelta).toBe(balanceDelta);
  });

  it('🔴 INVARIANT 1 — yozuvchi `applyDelta` ni CHAQIRMAYDI (bir marta harakat)', async () => {
    const { svc, balance } = makeHarness({ registryRow: { totalMinor: SUM } });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'));

    // Reyestr qatori ham yozilgan bo'lsa-da, balansga TEGILGANI bitta.
    expect(balance.applyDelta).toHaveBeenCalledTimes(1);
  });

  it('avans QISMAN qoplagan chek (qator chek qarzidan KICHIK) → qator 0 ga tushadi, manfiyga emas', async () => {
    // §2.2: chek qarzi 300 000, lekin avans 200 000 ini yegan ⇒ qator 100 000.
    const { svc, registry } = makeHarness({ registryRow: { totalMinor: 100_000n } });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'));

    const r = row(registry);
    expect(r?.totalMinor).toBe(0n);
    expect(r?.status).toBe('paid');
  });

  it('🔴 NIZO — to`langan qarzga vozvrat: qator `paidMinor` dan PASTGA tushmaydi + DebtNote', async () => {
    // Mijoz 120 000 to'lagan; chek to'liq qaytarilmoqda ⇒ qator 0 ga tushishi
    // «kerak» edi, lekin real pulni yo'q qilib bo'lmaydi.
    const { svc, registry } = makeHarness({
      registryRow: { totalMinor: SUM, paidMinor: 120_000n, status: 'partial' },
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'));

    const r = row(registry);
    expect(r?.totalMinor).toBe(120_000n);
    expect(r?.status).toBe('paid');
    // 400 EMAS — nizo OCHIQ qayd etiladi (mijoz pulini yo'qotmaydi).
    const text = noteText(registry);
    expect(text).toContain('NIZO');
    expect(text).toContain('120000');
  });

  it('reyestr qatori YO`Q (Q2 dan oldingi eski chek) → vozvrat BUZILMAYDI', async () => {
    const { svc, balance, registry } = makeHarness();
    const warn = vi.spyOn(
      (svc as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );

    await expect(svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'))).resolves.toBeDefined();

    // Balans MAVJUD xulqi bilan harakatlanadi…
    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-SUM);
    // …lekin bu JIMGINA o'tmaydi.
    expect(registry.debtNote.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TOPILMADI'));
  });

  it('qarzsiz (to`liq naqd) chek qaytarilsa reyestrga UMUMAN tegilmaydi', async () => {
    const { svc, registry } = makeHarness({
      paidMinor: SUM,
      registryRow: { totalMinor: SUM },
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3', { cashAmountMinor: '300000' }));

    // Qarz ulushi 0 ⇒ `debtReturn` 0 ⇒ reyestr bloki umuman ochilmaydi.
    expect(row(registry)?.totalMinor).toBe(SUM);
    expect(registry.debtNote.create).not.toHaveBeenCalled();
  });

  it('USD yashiq (§2.3) → reyestr qulfi ham OLINMAYDI, balans yo`li buzilmaydi', async () => {
    const { svc, balance, registry } = makeHarness({
      deskCurrency: 'USD',
      registryRow: { totalMinor: SUM },
    });

    await svc.refund(ACCOUNT, USER_ID, SALE_ID, refundReq('3'));

    expect(balance.applyDelta.mock.calls[0]?.[3]).toBe('USD');
    // Qator so'mda yuritiladi — USD chekida u umuman ochilmagan edi.
    expect(registry.queryRaw).not.toHaveBeenCalled();
    expect(row(registry)?.totalMinor).toBe(SUM);
  });
});

// ───────────────────────────── edit() simmetriyasi ─────────────────────────────

const editReq = (over: Record<string, unknown> = {}) => ({
  version: 3,
  paidMinor: '0',
  debtMinor: SUM.toString(),
  ...over,
});

describe('Q3 — edit(): reyestr qatori yangi qarz summasiga moslashadi', () => {
  it('qarz ulushi KAMAYSA qator ham kamayadi (naqd qo`shildi)', async () => {
    const { svc, balance, registry } = makeHarness({
      registryRow: { totalMinor: SUM },
      // §2.2 uchun: balansda AYNAN shu chekning qarzi turibdi.
      balanceByCounterparty: new Map([[AGENT_ID, SUM]]),
    });

    await svc.edit(
      ACCOUNT,
      USER_ID,
      SALE_ID,
      editReq({ paidMinor: '100000', debtMinor: '200000' }),
    );

    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-100_000n);
    expect(row(registry)?.totalMinor).toBe(200_000n);
    expect(row(registry)?.status).toBe('unpaid');
  });

  it('qarz ulushi OSHSA qator ham oshadi', async () => {
    const { svc, registry } = makeHarness({
      paidMinor: 100_000n,
      registryRow: { totalMinor: 200_000n },
      balanceByCounterparty: new Map([[AGENT_ID, 200_000n]]),
    });

    await svc.edit(ACCOUNT, USER_ID, SALE_ID, editReq({ paidMinor: '0', debtMinor: '300000' }));

    expect(row(registry)?.totalMinor).toBe(SUM);
  });

  it('MIJOZ ALMASHDI → qator YANGI mijozga ko`chadi (to`lov yo`q edi)', async () => {
    const { svc, balance, registry } = makeHarness({
      registryRow: { totalMinor: SUM },
      balanceByCounterparty: new Map([
        [AGENT_ID, SUM],
        [AGENT2_ID, 0n],
      ]),
    });

    await svc.edit(ACCOUNT, USER_ID, SALE_ID, editReq({ agentId: AGENT2_ID }));

    // Balans: eskisidan to'liq yechildi, yangisiga to'liq yozildi.
    expect(balance.applyDelta.mock.calls[0]?.[4]).toBe(-SUM);
    expect(balance.applyDelta.mock.calls[1]?.[4]).toBe(SUM);
    const r = row(registry);
    expect(r?.counterpartyId).toBe(AGENT2_ID);
    expect(r?.totalMinor).toBe(SUM);
    expect(noteText(registry)).toContain(AGENT_ID);
  });

  it('MIJOZ ALMASHDI, lekin YANGI mijozning AVANSI bor → qator YOPILADI (invariant 4)', async () => {
    const { svc, registry } = makeHarness({
      registryRow: { totalMinor: SUM },
      balanceByCounterparty: new Map([
        [AGENT_ID, SUM],
        // Avansi chek qarzidan katta ⇒ qarz TUG'ILMAYDI.
        [AGENT2_ID, -1_000_000n],
      ]),
    });

    await svc.edit(ACCOUNT, USER_ID, SALE_ID, editReq({ agentId: AGENT2_ID }));

    const r = row(registry);
    expect(r?.totalMinor).toBe(0n);
    expect(r?.status).toBe('paid');
  });

  it('🔴 MIJOZ ALMASHDI, lekin qatorga TO`LOV tushgan → ko`chirilmaydi, eskida yopiladi', async () => {
    const { svc, registry } = makeHarness({
      registryRow: { totalMinor: SUM, paidMinor: 50_000n, status: 'partial' },
      balanceByCounterparty: new Map([
        [AGENT_ID, SUM],
        [AGENT2_ID, 0n],
      ]),
    });

    await svc.edit(ACCOUNT, USER_ID, SALE_ID, editReq({ agentId: AGENT2_ID }));

    const r = row(registry);
    // To'lovlar ESKI mijozniki — qator ular bilan birga ko'cha olmaydi.
    expect(r?.counterpartyId).toBe(AGENT_ID);
    expect(r?.totalMinor).toBe(50_000n);
    expect(r?.status).toBe('paid');
    expect(noteText(registry)).toContain('KO`CHIRILMADI');
  });

  it('qator YO`Q edi (avans qoplagan chek), tahrirdan keyin qarz BOR → Q2 yozuvchisi qator ochadi', async () => {
    const { svc, registry } = makeHarness({
      paidMinor: 100_000n,
      // Qator yo'q; balansda avansdan keyin 0 turibdi.
      balanceByCounterparty: new Map([[AGENT_ID, 200_000n]]),
    });

    await svc.edit(ACCOUNT, USER_ID, SALE_ID, editReq({ paidMinor: '0', debtMinor: '300000' }));

    const opened = registry.debtRows.filter(
      (r) => r.sourceDocType === SALE_DEBT_SOURCE_DOC_TYPE && r.sourceDocId === SALE_ID,
    );
    expect(opened).toHaveLength(1);
    expect(opened[0]?.totalMinor).toBe(SUM);
    expect(opened[0]?.balanceAdopted).toBe(true);
  });

  it('USD yashiq (§2.3) → tahrirda ham reyestrga tegilmaydi', async () => {
    const { svc, registry } = makeHarness({
      deskCurrency: 'USD',
      registryRow: { totalMinor: SUM },
    });

    await svc.edit(
      ACCOUNT,
      USER_ID,
      SALE_ID,
      editReq({ paidMinor: '100000', debtMinor: '200000' }),
    );

    expect(registry.queryRaw).not.toHaveBeenCalled();
    expect(row(registry)?.totalMinor).toBe(SUM);
  });
});

// ─────────────────────────── cancel() — tegmasligi SHART ───────────────────────────

/**
 * Q3 vazifa 3 — «`cancel()` ni tekshir». Tekshiruv natijasi: TEGISH KERAK
 * EMAS, chunki bekor qilish faqat POST QILINMAGAN cheklarga ishlaydi va qarz
 * (balansda ham, reyestrda ham) faqat `post()` da tug'iladi.
 *
 * Bu test premise'ni QULFLAYDI: kimdir `CANCELLABLE` ga `'posted'` qo'shsa
 * (masalan «kassir post qilingan chekni bekor qilsin» talabi bilan), qizil
 * bo'ladi va Q3 ni qayta ko'rib chiqishga majbur qiladi.
 */
describe('Q3 — cancel() undirish reyestriga TEGMAYDI (premise qulfi)', () => {
  it('bekor qilish POST QILINGAN chekka umuman qo`llanmaydi', () => {
    expect([...allowedFrom('cancel')]).not.toContain('posted');
    expect([...allowedFrom('cancel')]).not.toContain('refunded');
  });

  it('`cancel()` kodida reyestr yo`li YO`Q', () => {
    const start = SERVICE.indexOf('async cancel(accountId: string');
    const end = SERVICE.indexOf('async updateComment(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SERVICE.slice(start, end);
    expect(body).not.toContain('moveSaleDebtRegistryRow');
    expect(body).not.toContain('writeSaleDebtRegistryRow');
  });
});

// ────────────────────── kod-shakli qo'riqchilari (invariant 1) ──────────────────────

/** Izohlarsiz metod tanasi — qo'riqchi KODni tekshiradi, matnni emas. */
function methodBody(startMarker: string, endMarker: string): string {
  const start = SERVICE.indexOf(startMarker);
  expect(start, `«${startMarker}» topilmadi`).toBeGreaterThan(-1);
  const end = SERVICE.indexOf(endMarker, start + startMarker.length);
  expect(end, `«${endMarker}» topilmadi`).toBeGreaterThan(start);
  return SERVICE.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Q3 — kod shakli: harakatlantiruvchi balansga TEGMAYDI', () => {
  it('`moveSaleDebtRegistryRow` `applyDelta` ni CHAQIRMAYDI', () => {
    const body = methodBody('private async moveSaleDebtRegistryRow', '\n  /**');
    expect(body).not.toContain('applyDelta');
  });

  it('qator qulfi `FOR UPDATE` bilan va `debts` jadvalidan olinadi', () => {
    const body = methodBody('private async moveSaleDebtRegistryRow', '\n  /**');
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('FROM debts');
    // Barqaror qulflash tartibi — `lockOpenDebts` odati (deadlock'ga qarshi).
    expect(body).toContain('ORDER BY id ASC');
  });

  it('`refund()` da reyestr harakati balans deltasidan KEYIN turadi (BALANS → QARZLAR)', () => {
    const start = SERVICE.indexOf('if (debtReturn > 0n && debtorId) {');
    expect(start).toBeGreaterThan(-1);
    const body = SERVICE.slice(start, SERVICE.indexOf("// SMENA CLAIM'i", start));
    expect(body.indexOf('this.counterpartyBalance.applyDelta(')).toBeLessThan(
      body.indexOf('this.moveSaleDebtRegistryRow('),
    );
  });

  it('`edit()` da balans QULFI `applyDelta` dan OLDIN olinadi (Q2 tartibi)', () => {
    const body = methodBody('async edit(accountId: string', '\n  async refund(');
    const lock = body.indexOf('this.lockCounterpartyBalance(');
    const delta = body.indexOf('this.counterpartyBalance.applyDelta(');
    const move = body.indexOf('this.moveSaleDebtRegistryRow(');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(delta);
    expect(delta).toBeLessThan(move);
  });
});
