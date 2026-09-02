import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * 🔴 2026-08-16, egasining qarori: KASSADA NARX CHEKLOVI YO'Q.
 *
 * P12 da (2026-08-12) yoqilgan pol va 0-narx taqiqi 2026-08-19 da BUTUNLAY
 * olib tashlandi (`price-policy-guard.ts` o'chirildi; ilgari u bayroq bilan
 * o'chiq turardi — o'chiq bayroq jimgina yoqilishi mumkin edi). Bu fayl
 * TESKARI shartnomani qulflaydi: ilgari 400 qaytargan har bir holat chekni
 * `posted` holatiga olib borishi shart — shu jumladan 0 so'mlik qator.
 *
 * Nega `post()` darajasida sinaladi: chek yopish yo'lida boshqa joyda ikkinchi
 * tekshiruv paydo bo'lishi mumkin — bu yagona ishonchli qamrov.
 *
 * Harness `retail-sale-post-guards.test.ts` dagi dublyordan olingan: `findFirst`
 * — detached snapshot, `updateMany` — jonli qator.
 */

const ACC = 'acc-1';
const USER = 'user-1';
const SALE = 'sale-1';
const SESSION = 'sess-1';
const PRODUCT = 'prod-1';

type Row = Record<string, unknown>;

function matchesState(cond: unknown, value: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === 'object' && cond !== null && 'in' in cond) {
    return (cond as { in: unknown[] }).in.includes(value);
  }
  return cond === value;
}

interface Opts {
  /** Kassir kiritgan birlik narxi (tiyin). */
  priceMinor: bigint;
  /** Chek chegirmasi foizi. */
  discount?: string;
  /** Karta tan narxi — `null` = yig'ilmagan (pol YO'Q). */
  buyPrice?: bigint | null;
  /** Karta chakana narxi (tiyin). */
  basePrice?: bigint | null;
  quantity?: string;
}

function makeHarness(opts: Opts) {
  const quantity = opts.quantity ?? '1';
  const discount = opts.discount ?? '0';
  // Chek summasi = qator jamisi (chegirma bilan) — `expectedSumMinor` shu.
  const gross = opts.priceMinor * BigInt(quantity === '1' ? 1 : Number(quantity));
  const sumMinor = (gross * (100n - BigInt(discount))) / 100n;

  const sessionRow: Row = { id: SESSION, accountId: ACC, state: 'open' };
  const saleRow: Row = { id: SALE, accountId: ACC, state: 'draft', agentId: null };

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
      findUniqueOrThrow: vi.fn(async () => ({ ...saleRow, sumMinor })),
    },
    retailSalePayment: { createMany: vi.fn(async () => ({ count: 1 })) },
    retailSalePosition: { updateMany: vi.fn(async () => ({ count: 1 })) },
    cashierAuditEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    counterpartyBalance: { findFirst: vi.fn(async () => ({ balanceMinor: 0n })) },
    cashierSession: {
      update: vi.fn(async () => ({ ...sessionRow })),
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
        if (args.where.id !== sessionRow.id) return { count: 0 };
        if (!matchesState(args.where.state, sessionRow.state)) return { count: 0 };
        Object.assign(sessionRow, args.data);
        return { count: 1 };
      }),
    },
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: {
      findMany: vi.fn(async () => [
        {
          id: PRODUCT,
          name: 'Rubilnik seriy 400A',
          buyPrice: opts.buyPrice === undefined ? 80_000n : opts.buyPrice,
          salePrices:
            opts.basePrice === null
              ? []
              : [{ priceTypeId: 'pt-default', value: String(opts.basePrice ?? 100_000n) }],
        },
      ]),
    },
    priceType: {
      findMany: vi.fn(async () => [{ id: 'pt-default', isDefault: true }]),
    },
    counterparty: {
      findFirst: vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
    },
    retailSale: {
      findFirst: vi.fn(async () => ({
        id: SALE,
        name: 'ТРН-1',
        state: 'draft',
        agentId: null,
        sumMinor,
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
        positions: [
          {
            id: 'pos-1',
            productId: PRODUCT,
            quantity,
            priceMinor: opts.priceMinor,
            discount,
            product: { name: 'Rubilnik seriy 400A' },
          },
        ],
      })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const money = { applyDeltas: vi.fn(async () => undefined) };
  const stock = {
    lockBalances: vi.fn(async () => new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn(async () => undefined),
    applyReservationDeltas: vi.fn(async () => undefined),
    // P3 — `false` = bo'shatiladigan rezerv yo'q edi.
    releaseReservationByDoc: vi.fn(async () => false),
  };

  const svc = new RetailSaleService(
    { client } as never,
    stock as never,
    money as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    {} as never,
    { applyDelta: vi.fn(async () => undefined) } as never,
    { applyPayment: async () => {} } as never,
  );
  const pay = () =>
    svc.post(ACC, USER, SALE, {
      cashAmountMinor: sumMinor.toString(),
      cardAmountMinor: '0',
      expectedSumMinor: sumMinor.toString(),
    });
  return { svc, pay, money, stock, saleRow };
}

describe('🔴 2026-08-16 · post() NARX CHEKLOVI YO`Q (egasining qarori)', () => {
  it('poldan past narxli chek O`TADI', async () => {
    const h = makeHarness({ priceMinor: 79_900n, buyPrice: 80_000n });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });

  it("polga teng narxli chek o'tadi", async () => {
    const h = makeHarness({ priceMinor: 80_000n, buyPrice: 80_000n });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });

  it('chek chegirmasi polni buzsa ham O`TADI', async () => {
    const h = makeHarness({ priceMinor: 100_000n, discount: '25', buyPrice: 80_000n });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });

  it("tan narx NULL bo'lgan tovarda past narx o'tadi", async () => {
    const h = makeHarness({ priceMinor: 1_00n, buyPrice: null });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });

  it('🔴 0 narxli qator O`TADI — tovar BEPULGA sotiladi', async () => {
    const h = makeHarness({ priceMinor: 0n, buyPrice: null });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });

  it('🔴 tan narxi BOR tovar ham bepulga sotiladi (pol umuman qo`llanmaydi)', async () => {
    const h = makeHarness({ priceMinor: 0n, buyPrice: 80_000n, basePrice: 100_000n });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });

  it("karta narxi tan narxdan past tovar o'z karta narxida sotiladi", async () => {
    const h = makeHarness({ priceMinor: 3_500_000n, buyPrice: 24_500_000n, basePrice: 3_500_000n });
    await h.pay();
    expect(h.saleRow.state).toBe('posted');
  });
});
