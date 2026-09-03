import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { mockSaleDebtRegistryTx } from '../debt/sale-debt-registry.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * Faza Q1 — `post()` ning IKKI qo'riqchisi.
 *
 * **A. Smena claim'i (`SALES-07`).** `post()` smena holatini tranzaksiyadan
 * TASHQARIDA o'qiydi (`sale.session.state !== 'open'`), keyin tranzaksiya ichida
 * smenani SHARTSIZ `update` qiladi. Ikki o'qish orasida `close()` yugursa, chek
 * YOPILGAN smenaga post bo'ladi: pul yashiqqa tushadi, lekin `close()` uni
 * allaqachon sanab bo'lgan ⇒ smena naqdi hech qachon to'g'ri chiqmaydi va
 * kassirga tushuntirib bo'lmaydigan farq yoziladi.
 *
 * Dublyor Postgres semantikasini halol modellaydi: `findFirst` — DETACHED
 * (eskirgan) nusxa, `updateMany` esa JONLI qator ustida shartni atomik
 * baholaydi. Ya'ni «o'qish eski, yozuv jonli» — aynan poyga oynasi.
 *
 * **B. `agentId` divergensiyasi (Faza 8 hisoboti, «Yangi topilma»).** Qarz
 * `parsed.agentId ?? sale.agentId` ga yoziladi, chek qatori esa faqat
 * `!sale.agentId` bo'lganda yangilanadi. Chekda A, to'lov oynasida B bo'lsa:
 * daftar B'ga yoziladi, chek A'ni ko'rsatadi, qaytarishda esa
 * `resolveCreditDebtorId` chekni afzal ko'radi ⇒ qarz **A'dan** yechiladi.
 * Ikkalasi ham noto'g'ri mijozning saldosi.
 *
 * QAROR — 400, ustidan yozish EMAS. Chek — huquqiy hujjat; to'lov oynasi uning
 * kontragentini JIMGINA qayta yozib yuborishi kerak emas (bu Faza 7/8 bo'ylab
 * quvilgan «jim divergensiya» klassining o'zi). Zid bo'lmasa (chek bo'sh)
 * mavjud xulq saqlanadi: mijoz chekka YOZILADI.
 */

const ACC = 'acc-1';
const USER = 'user-1';
const SALE = 'sale-1';
const SESSION = 'sess-1';
const AGENT_A = '00000000-0000-0000-0000-0000000000aa';
const AGENT_B = '00000000-0000-0000-0000-0000000000bb';

type Row = Record<string, unknown>;

function matchesState(cond: unknown, value: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === 'object' && cond !== null && 'in' in cond) {
    return (cond as { in: unknown[] }).in.includes(value);
  }
  return cond === value;
}

interface Opts {
  /** JONLI smena holati (chek snapshot'ida DOIM 'open' turadi — eskirgan o'qish). */
  liveSessionState?: string;
  saleAgentId?: string | null;
}

function makeHarness(opts: Opts = {}) {
  const sessionRow: Row = { id: SESSION, accountId: ACC, state: opts.liveSessionState ?? 'open' };
  const saleRow: Row = {
    id: SALE,
    accountId: ACC,
    state: 'draft',
    agentId: opts.saleAgentId ?? null,
  };

  const cashierSession = {
    // Faza Q1 dan OLDIN post() shu shartsiz yo'ldan yurardi.
    update: vi.fn(async (args: { data: Row }) => {
      Object.assign(sessionRow, args.data);
      return { ...sessionRow };
    }),
    updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
      if (args.where.id !== sessionRow.id) return { count: 0 };
      if (!matchesState(args.where.state, sessionRow.state)) return { count: 0 };
      Object.assign(sessionRow, args.data);
      return { count: 1 };
    }),
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
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (!matchesState(args.where.state, saleRow.state)) return { count: 0 };
        Object.assign(saleRow, args.data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...saleRow, sumMinor: 100_000n })),
    },
    // Q2 — qarzli chek endi UNDIRISH REYESTRIGA ham qator ochadi: balans
    // qulfi (`$queryRaw`), `debt` va `debtNote` delegatlari shu mock'dan.
    ...mockSaleDebtRegistryTx().tx,
    retailSalePayment: { createMany: vi.fn(async () => ({ count: 1 })) },
    cashierAuditEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    counterpartyBalance: { findFirst: vi.fn(async () => ({ balanceMinor: 100_000n })) },
    cashierSession,
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
    priceType: { findMany: vi.fn(async () => []) },
    // post() endi to'lov oynasidan kelgan agentId'ni tenant ichida tekshiradi
    // (begona akkaunt mijozi 400 oladi) — bu testlarda mijozlar "o'z"
    // akkauntdan deb qabul qilinadi.
    counterparty: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
    retailSale: {
      // DETACHED nusxa: smena holati o'qish ONIDAGI holat (bu yerda doim 'open').
      findFirst: vi.fn(async () => ({
        id: SALE,
        name: 'ТРН-1',
        state: 'draft',
        agentId: saleRow.agentId,
        sumMinor: 100_000n,
        sessionId: SESSION,
        organizationId: 'org-1',
        session: {
          id: SESSION,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: 'cd-1',
          storeId: 'st-1',
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: true },
          cashDesk: { currency: 'UZS' },
        },
        positions: [],
      })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const money = { applyDeltas: vi.fn(async () => undefined) };
  const balance = { applyDelta: vi.fn(async () => undefined) };
  const stock = {
    lockBalances: vi.fn(async () => new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn(async () => undefined),
  };
  const loyalty = { computeEarnedPoints: vi.fn(), createOperation: vi.fn() };

  const svc = new RetailSaleService(
    { client } as never,
    stock as never,
    money as never,
    loyalty as never,
    {} as never,
    balance as never,
    // F8: CustomerOrderService — zakazsiz chekda chaqirilmaydi.
    { applyPayment: async () => {} } as never,
  );
  return { svc, sessionRow, saleRow, money, balance, cashierSession, tx };
}

// ---------------------------------------------------------------------------
// A. Yopilayotgan smenaga post → 409
// ---------------------------------------------------------------------------

describe('Faza Q1 · post() smenani atomik claim qiladi (SALES-07)', () => {
  it('o`qish bilan tranzaksiya orasida smena yopilsa → 409, pul QIMIRLAMAYDI', async () => {
    const h = makeHarness({ liveSessionState: 'closed' });

    await expect(
      h.svc.post(ACC, USER, SALE, {
        cashAmountMinor: '100000',
        cardAmountMinor: '0',
        expectedSumMinor: '100000',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Claim chek CAS'idan KEYIN, lekin pul/ombor kaskadidan OLDIN turadi:
    // haqiqiy bazada tranzaksiya orqaga qaytib chek ham `draft` bo'lib qoladi,
    // dublyor esa rollback qilmaydi — shuning uchun bu yerda o'lchanadigan
    // narsa PUL harakati (rollback bo'lsa ham, bo'lmasa ham u sodir
    // BO'LMASLIGI kerak).
    expect(h.money.applyDeltas).not.toHaveBeenCalled();
    // Smena agregati ham oshmaydi — claim `state:'open'` bilan rad etildi.
    expect(h.sessionRow.salesCount).toBeUndefined();
  });

  it('smena hamon ochiq bo`lsa post o`tadi va agregat bir marta oshadi', async () => {
    const h = makeHarness();

    await h.svc.post(ACC, USER, SALE, {
      cashAmountMinor: '100000',
      cardAmountMinor: '0',
      expectedSumMinor: '100000',
    });

    expect(h.money.applyDeltas).toHaveBeenCalledTimes(1);
    expect(h.saleRow.state).toBe('posted');
    expect(h.sessionRow.salesCount).toEqual({ increment: 1 });
    expect(h.sessionRow.salesSumMinor).toEqual({ increment: 100_000n });
  });
});

// ---------------------------------------------------------------------------
// B. agentId divergensiyasi
// ---------------------------------------------------------------------------

describe('Faza Q1 · qarz daftari va chek BIR kontragentga ishora qiladi', () => {
  const debtPayload = {
    cashAmountMinor: '0',
    cardAmountMinor: '0',
    debtAmountMinor: '100000',
    expectedSumMinor: '100000',
  };

  it('chekdagi mijoz to`lov oynasidagidan farq qilsa → 400, qarz YOZILMAYDI', async () => {
    const h = makeHarness({ saleAgentId: AGENT_A });

    await expect(
      h.svc.post(ACC, USER, SALE, { ...debtPayload, agentId: AGENT_B }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.balance.applyDelta).not.toHaveBeenCalled();
    expect(h.saleRow.agentId).toBe(AGENT_A);
  });

  it('chek bo`sh bo`lsa mijoz chekka YOZILADI va qarz o`shanga tushadi', async () => {
    const h = makeHarness({ saleAgentId: null });

    await h.svc.post(ACC, USER, SALE, { ...debtPayload, agentId: AGENT_B });

    expect(h.saleRow.agentId).toBe(AGENT_B);
    expect(h.balance.applyDelta).toHaveBeenCalledTimes(1);
    expect(h.balance.applyDelta.mock.calls[0]?.[2]).toBe(AGENT_B);
  });

  it('bir xil mijoz qayta yuborilsa hech narsa buzilmaydi', async () => {
    const h = makeHarness({ saleAgentId: AGENT_A });

    await h.svc.post(ACC, USER, SALE, { ...debtPayload, agentId: AGENT_A });

    expect(h.saleRow.agentId).toBe(AGENT_A);
    expect(h.balance.applyDelta.mock.calls[0]?.[2]).toBe(AGENT_A);
  });

  it('to`lov oynasi mijoz yubormasa chekdagi mijoz ishlatiladi', async () => {
    const h = makeHarness({ saleAgentId: AGENT_A });

    await h.svc.post(ACC, USER, SALE, debtPayload);

    expect(h.balance.applyDelta.mock.calls[0]?.[2]).toBe(AGENT_A);
    expect(h.saleRow.agentId).toBe(AGENT_A);
  });
});
