import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * KUNLIK CHEK RAQAMI — SERVIS DARAJASIDAGI ULANISH (2026-09-02, egasi).
 *
 * Qoidaning o'zi (kun chegarasi, kalit shakli) sof modulda va
 * `daily-receipt-number.test.ts` da. Bu yerda faqat ULANISH tekshiriladi —
 * va aynan shu to'rt narsa, chunki ular buzilsa QOG'OZ noto'g'ri chiqadi:
 *   1. `post()` chekka `receiptNo` YOZADI (aks holda chek eski, uzun hujjat
 *      nomi bilan chiqib qoladi);
 *   2. hisoblagich HAR KASSIR uchun alohida (egasining talabi);
 *   3. bir kassirning ketma-ket cheklari 1 → 2 bo'lib o'sadi;
 *   4. sotuvsiz chek AYNI hisoblagichdan oladi, yopiq smenada esa umuman
 *      raqam bermaydi.
 */

const ACC = 'acc-1';
const USER = 'user-1';
const SALE = 'sale-1';
// UUID — `allocateReceiptNumber` sxemasi `sessionId` ni uuid deb tekshiradi.
const SESSION = '11111111-1111-4111-8111-111111111111';
const CASHIER_A = 'cashier-a';
const CASHIER_B = 'cashier-b';

type Row = Record<string, unknown>;

function matchesState(cond: unknown, value: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === 'object' && cond !== null && 'in' in cond) {
    return (cond as { in: unknown[] }).in.includes(value);
  }
  return cond === value;
}

/**
 * `documentSequence` ATAYLAB tashqaridan berilishi mumkin: ikki ketma-ket
 * post bir hisoblagichni ko'rgandagina «1 → 2» o'sishini o'lchab bo'ladi
 * (har harness o'z mock'ini yasasa test vakuum bo'lardi).
 */
function makeHarness(
  opts: {
    cashierId?: string;
    sessionState?: string;
    documentSequence?: ReturnType<typeof mockDocumentSequence>;
  } = {},
) {
  const documentSequence = opts.documentSequence ?? mockDocumentSequence();
  const sessionRow: Row = { id: SESSION, accountId: ACC, state: 'open' };
  const saleRow: Row = { id: SALE, accountId: ACC, state: 'draft', agentId: null };

  const tx = {
    documentSequence,
    stockByCell: { findMany: vi.fn(async () => []) },
    retailSalePositionAllocation: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    retailSale: {
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (!matchesState(args.where.state, saleRow.state)) return { count: 0 };
        Object.assign(saleRow, args.data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...saleRow, sumMinor: 100_000n })),
    },
    retailSalePosition: { updateMany: vi.fn(async () => ({ count: 0 })) },
    retailSalePayment: { createMany: vi.fn(async () => ({ count: 1 })) },
    cashierAuditEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    counterpartyBalance: { findFirst: vi.fn(async () => null) },
    cashDesk: { update: vi.fn(async () => ({})) },
    cashierSession: {
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (args.where.id !== sessionRow.id) return { count: 0 };
        if (!matchesState(args.where.state, sessionRow.state)) return { count: 0 };
        Object.assign(sessionRow, args.data);
        return { count: 1 };
      }),
    },
  };

  const client = {
    documentSequence,
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
    priceType: { findMany: vi.fn(async () => []) },
    loyaltyProgram: { findFirst: vi.fn(async () => null) },
    counterparty: { findFirst: vi.fn(async () => null) },
    cashierSession: {
      findFirst: vi.fn(async (args: { where: { id: string } }) =>
        args.where.id === SESSION
          ? { cashierId: opts.cashierId ?? CASHIER_A, state: opts.sessionState ?? 'open' }
          : null,
      ),
    },
    retailSale: {
      findFirst: vi.fn(async () => ({
        id: SALE,
        name: 'ТРН-2026-00073',
        state: 'draft',
        agentId: null,
        sumMinor: 100_000n,
        sessionId: SESSION,
        organizationId: 'org-1',
        session: {
          id: SESSION,
          state: 'open',
          cashierId: opts.cashierId ?? CASHIER_A,
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

  const svc = new RetailSaleService(
    { client } as never,
    {
      lockBalances: vi.fn(async () => new Map()),
      assertAvailable: vi.fn(),
      applyDeltas: vi.fn(async () => undefined),
    } as never,
    { applyDeltas: vi.fn(async () => undefined) } as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn(async () => undefined) } as never,
    { applyDelta: vi.fn(async () => undefined) } as never,
    { applyPayment: async () => {} } as never,
  );
  return { svc, tx, client, saleRow, documentSequence };
}

const PAY = { cashAmountMinor: '100000', cardAmountMinor: '0', expectedSumMinor: '100000' };

/** Hisoblagich `update` chaqiruvlaridan FAQAT kunlik chek kalitlari. */
function receiptKeys(seq: ReturnType<typeof mockDocumentSequence>): string[] {
  return seq.update.mock.calls
    .map((c) => (c[0] as { where: { accountId_key: { key: string } } }).where.accountId_key.key)
    .filter((k) => k.startsWith('CHEKKUN:'));
}

beforeEach(() => {
  vi.useFakeTimers();
  // 02.09.2026 14:00 Toshkent (= 09:00Z) — kun chegarasidan uzoq, ya'ni test
  // vaqt mintaqasidan qat'i nazar barqaror.
  vi.setSystemTime(new Date('2026-09-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('post() — chekka kunlik raqam yoziladi', () => {
  it('`receiptNo` chek qatoriga yoziladi va 1 dan boshlanadi', async () => {
    const { svc, tx, saleRow } = makeHarness();

    await svc.post(ACC, USER, SALE, PAY);

    expect(tx.retailSale.updateMany.mock.calls[0][0].data).toMatchObject({
      state: 'posted',
      receiptNo: 1,
    });
    expect(saleRow.receiptNo).toBe(1);
  });

  it('hisoblagich kaliti — KASSIR + Toshkent kuni', async () => {
    const { svc, documentSequence } = makeHarness({ cashierId: CASHIER_A });

    await svc.post(ACC, USER, SALE, PAY);

    expect(receiptKeys(documentSequence)).toEqual([`CHEKKUN:${CASHIER_A}:2026-09-02`]);
  });

  it('bir kassirning ketma-ket cheklari 1 → 2 bo`lib o`sadi', async () => {
    const shared = mockDocumentSequence();
    const first = makeHarness({ documentSequence: shared });
    await first.svc.post(ACC, USER, SALE, PAY);
    const second = makeHarness({ documentSequence: shared });
    await second.svc.post(ACC, USER, SALE, PAY);

    expect(first.saleRow.receiptNo).toBe(1);
    expect(second.saleRow.receiptNo).toBe(2);
  });

  it('BOSHQA kassir o`z hisoblagichidan oladi (yana 1 dan)', async () => {
    // 🔴 Egasining talabi: raqam har kassir uchun ALOHIDA. Umumiy hisoblagich
    // bo'lganda ikkinchi kassirning birinchi cheki 2 bo'lib chiqardi.
    const shared = mockDocumentSequence();
    const a = makeHarness({ cashierId: CASHIER_A, documentSequence: shared });
    await a.svc.post(ACC, USER, SALE, PAY);
    const b = makeHarness({ cashierId: CASHIER_B, documentSequence: shared });
    await b.svc.post(ACC, USER, SALE, PAY);

    expect(a.saleRow.receiptNo).toBe(1);
    expect(b.saleRow.receiptNo).toBe(1);
    expect(receiptKeys(shared)).toEqual([
      `CHEKKUN:${CASHIER_A}:2026-09-02`,
      `CHEKKUN:${CASHIER_B}:2026-09-02`,
    ]);
  });
});

describe('allocateReceiptNumber() — sotuvsiz chek', () => {
  it('AYNI hisoblagichdan keyingi raqamni beradi', async () => {
    const shared = mockDocumentSequence();
    const sale = makeHarness({ documentSequence: shared });
    await sale.svc.post(ACC, USER, SALE, PAY); // 1 — haqiqiy chek

    const proforma = makeHarness({ documentSequence: shared });
    await expect(proforma.svc.allocateReceiptNumber(ACC, { sessionId: SESSION })).resolves.toEqual({
      number: 2,
    });
  });

  it('YOPIQ smenada raqam berilmaydi (400)', async () => {
    const { svc, documentSequence } = makeHarness({ sessionState: 'closed' });

    await expect(svc.allocateReceiptNumber(ACC, { sessionId: SESSION })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Hisoblagich SURILMAYDI — aks holda kunlik ketma-ketlikda teshik qolardi.
    expect(receiptKeys(documentSequence)).toEqual([]);
  });

  it('begona smena — 404', async () => {
    const { svc } = makeHarness();

    await expect(
      svc.allocateReceiptNumber(ACC, { sessionId: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
