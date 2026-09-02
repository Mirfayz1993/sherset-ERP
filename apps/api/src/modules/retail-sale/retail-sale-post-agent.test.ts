import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * QA 2026-08-10 — naqd/karta sotuvda ham mijoz chekka YOZILADI.
 *
 * Eski shart `debtAmount > 0n && debtAgentId && !sale.agentId` edi: to'lov
 * oynasida tanlangan mijoz FAQAT qarzli to'lovda chekka tushardi. Naqd yoki
 * karta bilan to'lagan mijoz jimgina tashlanardi — chekda `agentId` NULL
 * qolib, loyalty ball yozilmasdi (accrueLoyalty `sale.agentId` ga qaraydi)
 * va SALES-04 qaytarish izi ham ishlamasdi.
 *
 * Qo'shimcha teshik: `parsed.agentId` hech qayerda TENANT bilan
 * tekshirilmasdi — FK faqat mavjudlikni tekshiradi, begona akkauntning
 * mijozi chekka (qarz bo'lsa — qarz daftariga ham) yozilishi mumkin edi.
 * Endi: counterparty {id, accountId} topilmasa → 400.
 *
 * Harness post-guards testidagi naqshda: saleRow/sessionRow jonli qatorlar,
 * updateMany shartlarni ular ustida baholaydi.
 */

const ACC = 'acc-1';
const USER = 'user-1';
const SALE = 'sale-1';
const SESSION = 'sess-1';
const KNOWN_AGENT = '00000000-0000-0000-0000-0000000000aa';
const FOREIGN_AGENT = '00000000-0000-0000-0000-0000000000ff';

type Row = Record<string, unknown>;

function matchesState(cond: unknown, value: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === 'object' && cond !== null && 'in' in cond) {
    return (cond as { in: unknown[] }).in.includes(value);
  }
  return cond === value;
}

function makeHarness(opts: { saleAgentId?: string | null } = {}) {
  const sessionRow: Row = { id: SESSION, accountId: ACC, state: 'open' };
  const saleRow: Row = {
    id: SALE,
    accountId: ACC,
    state: 'draft',
    agentId: opts.saleAgentId ?? null,
  };

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
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (!matchesState(args.where.state, saleRow.state)) return { count: 0 };
        Object.assign(saleRow, args.data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...saleRow, sumMinor: 100_000n })),
    },
    retailSalePayment: { createMany: vi.fn(async () => ({ count: 1 })) },
    cashierAuditEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    counterpartyBalance: { findFirst: vi.fn(async () => ({ balanceMinor: 100_000n })) },
    cashierSession: {
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (args.where.id !== sessionRow.id) return { count: 0 };
        if (!matchesState(args.where.state, sessionRow.state)) return { count: 0 };
        Object.assign(sessionRow, args.data);
        return { count: 1 };
      }),
    },
  };

  const counterpartyFindFirst = vi.fn(async (args: { where: { id: string; accountId: string } }) =>
    args.where.id === KNOWN_AGENT && args.where.accountId === ACC ? { id: args.where.id } : null,
  );

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
    priceType: { findMany: vi.fn(async () => []) },
    bonusOperation: { findFirst: vi.fn(async () => null) },
    bonusProgram: { findFirst: vi.fn(async () => null) },
    counterparty: { findFirst: counterpartyFindFirst },
    retailSale: {
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
  return { svc, saleRow, money, balance, counterpartyFindFirst, tx };
}

/** Sof naqd to'lov — qarz YO'Q. */
const cashPayload = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('post() — naqd sotuvda ham mijoz chekka yoziladi', () => {
  it('naqd to`lov + agentId → mijoz chekka YOZILADI (loyalty/qaytarish izi uchun)', async () => {
    const h = makeHarness({ saleAgentId: null });

    await h.svc.post(ACC, USER, SALE, { ...cashPayload, agentId: KNOWN_AGENT });

    expect(h.saleRow.agentId).toBe(KNOWN_AGENT);
    // Qarz yo'q — balansga hech narsa yozilmaydi.
    expect(h.balance.applyDelta).not.toHaveBeenCalled();
  });

  it('agentId yuborilmasa hech narsa o`zgarmaydi (chek anonim qoladi)', async () => {
    const h = makeHarness({ saleAgentId: null });

    await h.svc.post(ACC, USER, SALE, cashPayload);

    expect(h.saleRow.agentId).toBeNull();
    expect(h.counterpartyFindFirst).not.toHaveBeenCalled();
  });
});

describe('post() — agentId tenant ichida tekshiriladi', () => {
  it('begona akkaunt mijozi → 400, chek POST bo`lmaydi, pul QIMIRLAMAYDI', async () => {
    const h = makeHarness({ saleAgentId: null });

    await expect(
      h.svc.post(ACC, USER, SALE, { ...cashPayload, agentId: FOREIGN_AGENT }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.saleRow.state).toBe('draft');
    expect(h.saleRow.agentId).toBeNull();
    expect(h.money.applyDeltas).not.toHaveBeenCalled();
  });

  it('begona mijoz QARZLI to`lovda ham 400 — qarz daftariga yozilmaydi', async () => {
    const h = makeHarness({ saleAgentId: null });

    await expect(
      h.svc.post(ACC, USER, SALE, {
        cashAmountMinor: '0',
        cardAmountMinor: '0',
        debtAmountMinor: '100000',
        expectedSumMinor: '100000',
        agentId: FOREIGN_AGENT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.balance.applyDelta).not.toHaveBeenCalled();
  });
});
