import { describe, expect, it, vi } from 'vitest';
import { mockSaleDebtRegistryTx } from '../debt/sale-debt-registry.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * P3 / §1.H — H12 — `RetailSale.payedSumMinor` O'LIK USTUN EDI.
 *
 * 🔴 PROD O'LCHOVI (2026-08-12): 17/17 chekda `payed_sum_minor = 0` — shu
 * jumladan `posted` va 84 600 so'm NAQD olingan ТРН-2026-00007 da ham. Kod
 * tomonida sabab: bu ustunga RetailSale yo'lida hech kim YOZMAGAN (butun
 * repoda `payedSumMinor` faqat `CustomerOrder` uchun o'qilardi).
 *
 * SHARTNOMA (repodagi qolgan hujjatlar bilan bir xil — invoice/order/supply):
 *
 *     sumMinor − payedSumMinor = shu hujjat bo'yicha QOLGAN qarz
 *
 * Ya'ni chek uchun `payed = jami − qarz`. ATAYLAB `pay.paidMinor` EMAS: u
 * mijoz UZATGAN pul va QAYTIMNI ham o'z ichiga oladi. Aynan shu farq prod
 * chekida ko'rinadi (ТРН-2026-00016: tovar 32 000 so'm, mijoz $2 bergan,
 * qaytim 104.10 so'm) — `paidMinor` yozilsa hujjat o'z summasidan KO'P
 * to'langan bo'lib turardi.
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const STORE_ID = 'store-1';
const AGENT_ID = 'agent-1';

function makeStockStub() {
  return {
    lockBalances: vi.fn().mockResolvedValue(new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    applyReservationDeltas: vi.fn().mockResolvedValue(undefined),
    releaseReservationByDoc: vi.fn().mockResolvedValue(false),
  };
}

function makeClient(opts: { sumMinor: bigint; agentId?: string | null }) {
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
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: SALE_ID,
        state: 'posted',
        agentId: opts.agentId ?? null,
        sumMinor: opts.sumMinor,
      }),
    },
    // Q2 — qarzli chek endi UNDIRISH REYESTRIGA ham qator ochadi: balans
    // qulfi (`$queryRaw`), `debt` va `debtNote` delegatlari shu mock'dan.
    ...mockSaleDebtRegistryTx().tx,
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashDesk: { update: vi.fn() },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retailSalePosition: { update: vi.fn().mockResolvedValue({}) },
    cashierAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // Qarzli chekda balans jurnaliga yozgandan keyin YANGI qoldiq o'qiladi
    // (kassa TZ §9 — «kimning qarzi qanchagacha o'sdi» jurnalga tushsin).
    counterpartyBalance: { findFirst: vi.fn(async () => ({ balanceMinor: 60_000n })) },
  };
  const client = {
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    loyaltyProgram: { findFirst: vi.fn(async () => null) },
    product: { findMany: vi.fn(async () => []) },
    priceType: { findMany: vi.fn(async () => []) },
    counterparty: { findFirst: vi.fn(async () => ({ id: AGENT_ID })) },
    retailSale: {
      findFirst: vi.fn().mockResolvedValue({
        id: SALE_ID,
        name: 'CHK-1',
        state: 'ready',
        sumMinor: opts.sumMinor,
        sessionId: SESSION_ID,
        agentId: opts.agentId ?? null,
        customerOrderId: null,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: 'cd-1',
          storeId: STORE_ID,
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: true },
          cashDesk: { currency: 'UZS' },
        },
        positions: [{ id: 'pos-1', productId: 'prod-A', quantity: 1, priceMinor: opts.sumMinor }],
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

function makeService(client: unknown): RetailSaleService {
  return new RetailSaleService(
    { client } as never,
    makeStockStub() as never,
    { applyDeltas: vi.fn().mockResolvedValue(undefined) } as never,
    { computeEarnedPoints: vi.fn(), createOperation: vi.fn() } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    { applyPayment: async () => {} } as never,
  );
}

/** Flip'ga yozilgan `data` — `payedSumMinor` shu yerda. */
function flipData(tx: { retailSale: { updateMany: { mock: { calls: unknown[][] } } } }) {
  return (tx.retailSale.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

describe('P3 / H12 — chek to‘langan summani YOZADI', () => {
  it('to‘liq to‘langan chek: payedSum = jami', async () => {
    const { client, tx } = makeClient({ sumMinor: 100_000n });

    await makeService(client).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '100000',
      cardAmountMinor: '0',
      expectedSumMinor: '100000',
    });

    expect(flipData(tx).payedSumMinor).toBe(100_000n);
  });

  it('qarzga qoldirilgan qism CHEGIRILADI (payed = jami − qarz)', async () => {
    const { client, tx } = makeClient({ sumMinor: 100_000n, agentId: AGENT_ID });

    await makeService(client).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '40000',
      cardAmountMinor: '0',
      debtAmountMinor: '60000',
      expectedSumMinor: '100000',
    });

    const data = flipData(tx);
    expect(data.payedSumMinor).toBe(40_000n);
    // Shartnomaning O'ZI: qolgan qarz = sumMinor − payedSumMinor.
    expect(100_000n - (data.payedSumMinor as bigint)).toBe(60_000n);
  });

  /**
   * 🔴 Bu test aynan `pay.paidMinor` ni yozib qo'yish xatosini tutadi.
   * Mijoz 150 000 berdi, tovar 100 000, qaytim 50 000 — «to'langan» 100 000
   * bo'lishi kerak, 150 000 EMAS (aks holda hujjat o'z summasidan ko'p
   * to'langan bo'lib ko'rinardi va qoldiq MANFIY chiqardi).
   */
  it('qaytim QO‘SHILMAYDI — payed hech qachon jamidan oshmaydi', async () => {
    const { client, tx } = makeClient({ sumMinor: 100_000n });

    await makeService(client).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '150000',
      cardAmountMinor: '0',
      expectedSumMinor: '100000',
    });

    const data = flipData(tx);
    expect(data.payedSumMinor).toBe(100_000n);
    expect(data.changeMinor).toBe(50_000n);
  });

  it('aralash to‘lov (naqd + karta) ham to‘liq yopadi', async () => {
    const { client, tx } = makeClient({ sumMinor: 100_000n });

    await makeService(client).post(ACCOUNT, USER_ID, SALE_ID, {
      cashAmountMinor: '30000',
      cardAmountMinor: '70000',
      expectedSumMinor: '100000',
    });

    expect(flipData(tx).payedSumMinor).toBe(100_000n);
  });
});
