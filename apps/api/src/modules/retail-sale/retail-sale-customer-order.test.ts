import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDocumentSequence } from '../../prisma/document-sequence.mock.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * F8 — chek ↔ zakaz bog'lanishi (`RetailSale.customerOrderId`).
 *
 * Ustun + relation + indeks sxemada ALLAQACHON bor edi, lekin hech bir kod
 * unga yozmasdi. Bu fayl simning ikkala uchini qulflaydi:
 *   • `create()` — id chekka yoziladi, TENANT ichida tekshiriladi, do'kon mos,
 *     holat to'lanadigan bo'lishi shart;
 *   • `post()` — to'lov MAVJUD primitiv (`CustomerOrderService.applyPayment`)
 *     orqali zakazga tushadi va zakaz `paid` ga o'zi o'tadi;
 *   • ikki marta to'lash — TX ICHIDA, holat-shartli `updateMany` bilan
 *     (poyga testi qo'shni faylda: `…-concurrency.test.ts`).
 */

const ACCOUNT = 'acc-1';
const USER_ID = 'user-1';
const SALE_ID = 'sale-1';
const SESSION_ID = 'sess-1';
const CASHDESK_ID = 'cd-1';
const STORE_ID = 'store-1';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function makeStockStub() {
  return {
    lockBalances: vi.fn().mockResolvedValue(new Map()),
    assertAvailable: vi.fn(),
    applyDeltas: vi.fn().mockResolvedValue(undefined),
    releaseReservationByDoc: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCoStub() {
  return { applyPayment: vi.fn().mockResolvedValue(undefined) };
}

function makeService(
  client: unknown,
  stock: ReturnType<typeof makeStockStub> = makeStockStub(),
  co: ReturnType<typeof makeCoStub> = makeCoStub(),
): RetailSaleService {
  return new RetailSaleService(
    { client } as never,
    stock as never,
    { applyDeltas: vi.fn().mockResolvedValue(undefined) } as never,
    undefined as never,
    undefined as never,
    { applyDelta: vi.fn().mockResolvedValue(undefined) } as never,
    co as never,
  );
}

// ── create() ────────────────────────────────────────────────────────────────

function createClient(order: unknown) {
  const created = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: SALE_ID,
    ...args.data,
    positions: [],
  }));
  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    cashierSession: {
      findFirst: vi.fn(async () => ({
        id: SESSION_ID,
        state: 'open',
        cashierId: USER_ID,
        storeId: STORE_ID,
      })),
    },
    customerOrder: { findFirst: vi.fn(async () => order) },
    retailSale: { findFirst: vi.fn(async () => null), create: created },
  };
  return { client, created };
}

const CREATE_INPUT = {
  sessionId: '33333333-3333-4333-8333-333333333333',
  customerOrderId: ORDER_ID,
  positions: [{ productId: PRODUCT_ID, quantity: '1.5', priceMinor: '10000' }],
};

describe('RetailSaleService.create — customerOrderId', () => {
  it('writes customerOrderId onto the receipt', async () => {
    const { client, created } = createClient({
      id: ORDER_ID,
      state: 'confirmed',
      storeId: STORE_ID,
    });
    const svc = makeService(client);

    await svc.create(ACCOUNT, CREATE_INPUT);

    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]?.[0].data.customerOrderId).toBe(ORDER_ID);
  });

  it('leaves customerOrderId null when not supplied (existing callers unchanged)', async () => {
    const { client, created } = createClient(null);
    const svc = makeService(client);

    await svc.create(ACCOUNT, { ...CREATE_INPUT, customerOrderId: undefined });

    expect(client.customerOrder.findFirst).not.toHaveBeenCalled();
    expect(created.mock.calls[0]?.[0].data.customerOrderId).toBeNull();
  });

  it('rejects an order that belongs to another tenant (FK only checks existence)', async () => {
    const { client } = createClient(null);
    const svc = makeService(client);

    await expect(svc.create(ACCOUNT, CREATE_INPUT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an order that is already paid', async () => {
    const { client } = createClient({ id: ORDER_ID, state: 'paid', storeId: STORE_ID });
    const svc = makeService(client);

    await expect(svc.create(ACCOUNT, CREATE_INPUT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an order from a different store than the shift', async () => {
    const { client } = createClient({
      id: ORDER_ID,
      state: 'confirmed',
      storeId: 'other-store',
    });
    const svc = makeService(client);

    await expect(svc.create(ACCOUNT, CREATE_INPUT)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── post() ──────────────────────────────────────────────────────────────────

interface PostOrderRow {
  state?: string;
  sumMinor: bigint;
  payedSumMinor: bigint;
  storeId?: string;
}

function postClient(opts: {
  customerOrderId: string | null;
  order?: PostOrderRow;
  claimCount?: number;
}) {
  const orderUpdateMany = vi.fn().mockResolvedValue({ count: opts.claimCount ?? 1 });
  const positionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const orderUpdate = vi.fn().mockResolvedValue({});
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn(async () => ({
        id: SALE_ID,
        agentId: null,
        sumMinor: 100_000n,
      })),
    },
    retailSalePayment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashierSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retailSalePosition: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    posAuditEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    customerOrder: {
      updateMany: orderUpdateMany,
      update: orderUpdate,
      findFirstOrThrow: vi.fn(async () => ({
        state: opts.order?.state ?? 'confirmed',
        sumMinor: opts.order?.sumMinor ?? 100_000n,
        payedSumMinor: opts.order?.payedSumMinor ?? 0n,
        storeId: opts.order?.storeId ?? STORE_ID,
      })),
    },
    customerOrderPosition: { updateMany: positionUpdateMany },
  };

  const client = {
    documentSequence: mockDocumentSequence(),
    employee: { findUnique: vi.fn(async () => null) },
    store: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
    priceType: { findMany: vi.fn(async () => []) },
    retailSale: {
      findFirst: vi.fn(async () => ({
        id: SALE_ID,
        name: 'CH-1',
        state: 'draft',
        sumMinor: 100_000n,
        agentId: null,
        organizationId: null,
        sessionId: SESSION_ID,
        customerOrderId: opts.customerOrderId,
        session: {
          id: SESSION_ID,
          state: 'open',
          cashierId: 'cashier-1',
          cashDeskId: CASHDESK_ID,
          storeId: STORE_ID,
          salesCount: 0,
          salesSumMinor: 0n,
          store: { allowNegativeStock: true },
          cashDesk: { currency: 'UZS' },
        },
        positions: [
          {
            id: 'pos-1',
            productId: PRODUCT_ID,
            quantity: '1',
            priceMinor: 100_000n,
            product: { name: 'Tovar' },
          },
        ],
      })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx, orderUpdateMany, orderUpdate, positionUpdateMany };
}

const PAYMENT = {
  cashAmountMinor: '100000',
  cardAmountMinor: '0',
  expectedSumMinor: '100000',
};

describe('RetailSaleService.post — zakaz to‘lovi', () => {
  it('applies the receipt total to the order through the EXISTING applyPayment primitive', async () => {
    const { client, orderUpdateMany } = postClient({ customerOrderId: ORDER_ID });
    const co = makeCoStub();
    const svc = makeService(client, makeStockStub(), co);

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(orderUpdateMany).toHaveBeenCalledTimes(1);
    // Qulf holat-shartli — «to'langan» zakaz predikatga tushmaydi.
    const where = orderUpdateMany.mock.calls[0]?.[0].where;
    expect(where.id).toBe(ORDER_ID);
    expect(where.accountId).toBe(ACCOUNT);
    expect(where.state.in).toEqual(['confirmed', 'awaiting_payment']);

    expect(co.applyPayment).toHaveBeenCalledTimes(1);
    const [txArg, acc, uid, orderId, amount, direction] = co.applyPayment.mock.calls[0] ?? [];
    expect(txArg).toBeDefined();
    expect(acc).toBe(ACCOUNT);
    expect(uid).toBe(USER_ID);
    expect(orderId).toBe(ORDER_ID);
    expect(amount).toBe(100_000n);
    expect(direction).toBe('apply');
  });

  it('does not touch the order path when the receipt carries no order', async () => {
    const { client, orderUpdateMany } = postClient({ customerOrderId: null });
    const co = makeCoStub();
    const svc = makeService(client, makeStockStub(), co);

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(co.applyPayment).not.toHaveBeenCalled();
  });

  it('rejects the post when the order is no longer payable (count=0 — already paid)', async () => {
    const { client } = postClient({ customerOrderId: ORDER_ID, claimCount: 0 });
    const co = makeCoStub();
    const svc = makeService(client, makeStockStub(), co);

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(co.applyPayment).not.toHaveBeenCalled();
  });

  it('consumes the order reserve when the receipt closes the order in full', async () => {
    const stock = makeStockStub();
    const { client, orderUpdate, positionUpdateMany } = postClient({
      customerOrderId: ORDER_ID,
      order: { sumMinor: 100_000n, payedSumMinor: 0n },
    });
    const svc = makeService(client, stock, makeCoStub());

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    expect(stock.releaseReservationByDoc).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      USER_ID,
      'customerorder',
      ORDER_ID,
      'release_consume',
    );
    // Mirrorlar ham nolga tushadi — aks holda zakaz kartasi «rezervda 5»
    // deb turaverardi (`customer-order.service.delete()` bilan bir retsept).
    expect(positionUpdateMany).toHaveBeenCalledWith({
      where: { customerOrderId: ORDER_ID, accountId: ACCOUNT },
      data: { reservedQty: 0 },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: ORDER_ID, accountId: ACCOUNT },
      data: { reservedSumMinor: 0n },
    });
    // Rezerv bo'shatilgach qoldiq QAYTA o'qiladi — aks holda zakazning O'Z
    // rezervi `assertAvailable` da o'z sotuvini bloklardi.
    expect(stock.lockBalances).toHaveBeenCalledTimes(2);
  });

  it('keeps the reserve when the receipt only partially covers the order', async () => {
    const stock = makeStockStub();
    const { client } = postClient({
      customerOrderId: ORDER_ID,
      // Zakaz 250 000, chek 100 000 — qoldiq to'lanmagan.
      order: { sumMinor: 250_000n, payedSumMinor: 0n },
    });
    const co = makeCoStub();
    const svc = makeService(client, stock, co);

    await svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT);

    // P3 dan keyin `releaseReservationByDoc` chekning O'Z rezervi uchun ham
    // chaqiriladi, shuning uchun «umuman chaqirilmagan» da'vosi endi mavzuni
    // ko'rsatmasdi — ZAKAZ rezervi tegilmaganini tekshiramiz.
    expect(stock.releaseReservationByDoc).not.toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      USER_ID,
      'customerorder',
      ORDER_ID,
      expect.anything(),
    );
    // Chekning o'z rezervi so'raladi (bu yerda yo'q — stub `false` qaytaradi),
    // shuning uchun balanslar QAYTA O'QILMAYDI: bitta qulflash.
    expect(stock.lockBalances).toHaveBeenCalledTimes(1);
    // To'lov baribir zakazga tushadi — `applyPayment` qisman to'lovda holatni
    // O'ZGARTIRMAYDI, ya'ni zakaz `paid` bo'lmaydi va qoldig'i to'lanishi mumkin.
    expect(co.applyPayment).toHaveBeenCalledTimes(1);
  });

  it('rejects an order whose store differs from the shift store', async () => {
    const { client } = postClient({
      customerOrderId: ORDER_ID,
      order: { sumMinor: 100_000n, payedSumMinor: 0n, storeId: 'other-store' },
    });
    const co = makeCoStub();
    const svc = makeService(client, makeStockStub(), co);

    await expect(svc.post(ACCOUNT, USER_ID, SALE_ID, PAYMENT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(co.applyPayment).not.toHaveBeenCalled();
  });
});
