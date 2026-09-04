import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StockService } from '../stock/stock.service.js';
import { InventoryService, assertNotCountSession } from './inventory.service.js';

/**
 * SANASH SESSIYASI QO'RIQCHISI — XULQ testlari (N-reja N1, §2.1).
 * (`inventory.cell.test.ts` naqshi: haqiqiy servis + soxta `tx`, DB kerak emas.)
 *
 * Qo'riqlanadigan shartnoma:
 *   - `countSession = true` hujjat `post` ga o'tmaydi (400) va `applyDeltas`
 *     CHAQIRILMAYDI — qoldiq `setCellStock` avto-hujjatlari bilan allaqachon
 *     tenglashgan, ikkinchi yozuv «361 885 soxta son» hodisasini takrorlardi;
 *   - `cancel` ham o'tmaydi (400) — u ham `applyDeltas` chaqiradi va HECH QACHON
 *     qo'llanmagan deltani «teskari» qilib qoldiqni buzardi;
 *   - `update()` sessiya hujjatini rad etadi (u `deleteMany` bilan sanoq izini
 *     o'chirardi);
 *   - `clone()` bayroqni KO'CHIRMAYDI — nusxa oddiy qoralama bo'ladi;
 *   - 🔴 ORQAGA MOSLIK: bayroqsiz (bugungi jonli) hujjat post ham, cancel ham,
 *     update ham AVVALGIDEK ishlaydi — bir bayt xulq o'zgarmaydi.
 */

const dec = (n: string | number) =>
  ({ toString: () => String(n), negated: () => dec(`-${n}`) }) as never;

interface FakePosition {
  id: string;
  assortmentKind: string;
  assortmentId: string;
  expectedQty: ReturnType<typeof dec>;
  actualQty: ReturnType<typeof dec>;
  varianceQty: ReturnType<typeof dec>;
  costMinor: bigint | null;
  cellId: string | null;
  cell: string | null;
  productId: string | null;
  position: number;
}

const pos = (over: Partial<FakePosition> = {}): FakePosition => ({
  id: 'pos-1',
  assortmentKind: 'product',
  assortmentId: 'prod-1',
  expectedQty: dec('0'),
  actualQty: dec('5'),
  varianceQty: dec('5'),
  costMinor: null,
  cellId: 'cell-A',
  cell: '02-01-01-04',
  productId: 'prod-1',
  position: 1,
  ...over,
});

/**
 * Soxta tranzaksiya — `applyDeltas` ning HAR QANDAY izini yozib boradi.
 * `stockTouches` bo'sh bo'lishi = qoldiqqa umuman tegilmagani.
 */
function makeTx() {
  const stockTouches: string[] = [];
  const positionDeletes: unknown[] = [];
  const stateClaims: unknown[] = [];

  const tx = {
    store: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
    stock: {
      findFirst: vi.fn(async () => ({ qty: dec('100'), costBalanceMinor: 0n })),
      upsert: vi.fn(async () => {
        stockTouches.push('stock.upsert');
        return {};
      }),
    },
    stockByCell: {
      findUnique: vi.fn(async () => ({ qty: dec('3') })),
      upsert: vi.fn(async () => {
        stockTouches.push('stockByCell.upsert');
        return {};
      }),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => {
        stockTouches.push('stockByCell.update');
        return {};
      }),
    },
    stockOperation: {
      createMany: vi.fn(async () => {
        stockTouches.push('stockOperation.createMany');
        return { count: 0 };
      }),
      findMany: vi.fn(async () => []),
    },
    product: { findMany: vi.fn(async () => []) },
    storeCell: { findMany: vi.fn(async () => []) },
    inventoryPosition: {
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async (args: unknown) => {
        positionDeletes.push(args);
        return { count: 0 };
      }),
    },
    inventory: {
      updateMany: vi.fn(async (args: unknown) => {
        stateClaims.push(args);
        return { count: 1 };
      }),
      update: vi.fn(async () => ({ id: 'inv-1' })),
      findFirstOrThrow: vi.fn(async () => ({ id: 'inv-1', state: 'posted' })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { tx, stockTouches, positionDeletes, stateClaims };
}

interface FakeDoc {
  state: string;
  applicable: boolean;
  countSession: boolean;
  positions: FakePosition[];
}

function makeService(doc: Partial<FakeDoc>, tx: unknown) {
  const full = {
    id: 'inv-1',
    accountId: 'acc',
    storeId: 'store-1',
    organizationId: 'org-1',
    projectId: null,
    externalCode: null,
    description: null,
    attributes: {},
    deletedAt: null,
    version: 1,
    state: 'draft',
    applicable: false,
    countSession: false,
    positions: [pos()],
    ...doc,
  };
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    client: {
      inventory: {
        findFirst: vi.fn(async () => full),
        findMany: vi.fn(async () => []),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'inv-2', ...args.data };
        }),
      },
      product: { findMany: vi.fn(async () => [{ id: 'prod-1', buyPrice: 0n }]) },
      employee: { findUnique: vi.fn(async () => null) },
      documentSequence: {
        findUnique: vi.fn(async () => ({ value: 41 })),
        update: vi.fn(async () => ({ value: 42 })),
        createMany: vi.fn(async () => ({ count: 1 })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      auditLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    },
  };
  // StockService konstruktor clientini applyDeltas ishlatmaydi (tx parametr).
  const stock = new StockService({ client: {} } as never);
  const attrs = { validateAndNormalize: vi.fn(async () => ({})) };
  const webhook = { fireForEvent: vi.fn() };
  const svc = new InventoryService(prisma as never, stock, attrs as never, webhook as never);
  return { svc, prisma, created };
}

// ─────────────────────────────────────────────────────────────────────────
describe("assertNotCountSession — sof qo'riqchi", () => {
  it("bayroqsiz hujjatni O'TKAZADI (undefined ham, false ham)", () => {
    expect(() => assertNotCountSession({}, 'post')).not.toThrow();
    expect(() => assertNotCountSession({ countSession: false }, 'cancel')).not.toThrow();
    expect(() => assertNotCountSession({ countSession: null }, 'update')).not.toThrow();
  });

  it("bayroqli hujjatda har uch amal uchun 400 va O'ZIGA XOS xabar beradi", () => {
    for (const action of ['post', 'cancel', 'update'] as const) {
      expect(() => assertNotCountSession({ countSession: true }, action)).toThrow(
        BadRequestException,
      );
    }
    expect(() => assertNotCountSession({ countSession: true }, 'post')).toThrow(/post qilinmaydi/);
    expect(() => assertNotCountSession({ countSession: true }, 'cancel')).toThrow(
      /bekor qilinmaydi/,
    );
    expect(() => assertNotCountSession({ countSession: true }, 'update')).toThrow(/tahrirlanmaydi/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("transition() — ikki karra qo'llash qo'riqchisi", () => {
  it("sessiya hujjati POST ga o'tmaydi va qoldiqqa TEGILMAYDI", async () => {
    const { tx, stockTouches, stateClaims } = makeTx();
    const { svc } = makeService({ countSession: true, state: 'draft' }, tx);

    await expect(svc.transition('acc', 'user', 'inv-1', 'post')).rejects.toThrow(
      BadRequestException,
    );
    // 🔴 DALIL: birorta qoldiq yozuvi YO'Q va hatto holat ham da'vo qilinmagan —
    // qo'riqchi `post()` ga KIRISHDAN oldin to'xtatadi.
    expect(stockTouches).toEqual([]);
    expect(stateClaims).toEqual([]);
  });

  it("sessiya hujjati CANCEL ga ham o'tmaydi va qoldiqqa TEGILMAYDI", async () => {
    const { tx, stockTouches, stateClaims } = makeTx();
    const { svc } = makeService({ countSession: true, state: 'posted', applicable: true }, tx);

    await expect(svc.transition('acc', 'user', 'inv-1', 'cancel')).rejects.toThrow(
      BadRequestException,
    );
    expect(stockTouches).toEqual([]);
    expect(stateClaims).toEqual([]);
  });

  it("ORQAGA MOSLIK: bayroqsiz hujjat AVVALGIDEK post bo'ladi (qoldiq qimirlaydi)", async () => {
    const { tx, stockTouches, stateClaims } = makeTx();
    const { svc } = makeService({ countSession: false, state: 'draft' }, tx);

    await svc.transition('acc', 'user', 'inv-1', 'post');

    // expected=3 (yacheyka), actual=5 → +2 yoziladi: qoldiqqa TEGILDI.
    expect(stockTouches).toContain('stockByCell.upsert');
    expect(stockTouches).toContain('stock.upsert');
    expect(stateClaims.length).toBe(1);
  });

  it("ORQAGA MOSLIK: bayroqsiz hujjat AVVALGIDEK cancel bo'ladi", async () => {
    const { tx, stockTouches, stateClaims } = makeTx();
    const { svc } = makeService(
      {
        countSession: false,
        state: 'posted',
        applicable: true,
        positions: [pos({ varianceQty: dec('2') })],
      },
      tx,
    );

    await svc.transition('acc', 'user', 'inv-1', 'cancel');

    expect(stateClaims.length).toBe(1);
    expect(stockTouches).toContain('stock.upsert');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("update() — sanoq izi tahrirdan qo'riqlanadi", () => {
  const body = {
    version: 1,
    positions: [{ assortmentId: '11111111-1111-4111-8111-111111111111', actualQty: '7' }],
  };

  it('sessiya hujjati rad etiladi va `deleteMany` ISHLAMAYDI', async () => {
    const { tx, positionDeletes } = makeTx();
    const { svc } = makeService({ countSession: true }, tx);

    await expect(svc.update('acc', 'user', 'inv-1', body)).rejects.toThrow(BadRequestException);
    // 🔴 DALIL: sanoq qatorlari o'chirilmadi — iz butun.
    expect(positionDeletes).toEqual([]);
    expect(tx.inventory.update).not.toHaveBeenCalled();
  });

  it('ORQAGA MOSLIK: bayroqsiz hujjat AVVALGIDEK tahrirlanadi', async () => {
    const { tx, positionDeletes } = makeTx();
    const { svc } = makeService({ countSession: false }, tx);

    await svc.update('acc', 'user', 'inv-1', body);

    expect(positionDeletes.length).toBe(1);
    expect(tx.inventory.update).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("clone() — bayroq nusxaga KO'CHMAYDI", () => {
  it("sessiya hujjatining nusxasi ODDIY qoralama bo'ladi", async () => {
    const { tx } = makeTx();
    const { svc, created } = makeService({ countSession: true, state: 'counted' }, tx);

    await svc.clone('acc', 'user', 'inv-1');

    expect(created.length).toBe(1);
    expect(created[0]?.countSession).toBe(false);
    expect(created[0]?.state).toBe('draft');
    // Sessiya izi maydonlari ham ko'chmaydi (ular MANBA sessiyaniki).
    expect(created[0]?.countedBy).toBeUndefined();
    expect(created[0]?.closedAt).toBeUndefined();
    expect(created[0]?.confirmedBy).toBeUndefined();
    expect(created[0]?.confirmedAt).toBeUndefined();
  });

  it('bayroqsiz hujjat nusxasi ham bayroqsiz qoladi', async () => {
    const { tx } = makeTx();
    const { svc, created } = makeService({ countSession: false }, tx);

    await svc.clone('acc', 'user', 'inv-1');

    expect(created[0]?.countSession).toBe(false);
  });
});
