import { describe, expect, it, vi } from 'vitest';
import { StoreAddressService } from './store-address.service.js';

/**
 * Multi-bin (2026-08-06) — owner report: «bitta yacheykada 1dan ortiq
 * narsalarni kiritib bo'lmayapti, bitta narsani esa 1dan ortiq yacheykaga
 * kiritib bo'lmayapti». Root cause: `assignProducts` used to OVERWRITE a
 * product's single `attributes.__yacheyka` on every bind — a second bind
 * silently moved the product OUT of its first cell (one item → many cells
 * was structurally impossible). Fix: ProductCellLink (many-to-many) — every
 * bind ADDS, never moves; `__yacheyka` only seeds once (first bind) for old
 * single-label readers.
 *
 * In-memory fake Prisma client (no DB) — mutable maps so a sequence of calls
 * (assign → assign → getCellProducts → unassign) observes real state
 * transitions, matching how the actual endpoints get called in order.
 */

const PROD_1 = '11111111-1111-1111-1111-111111111111';
const PROD_2 = '22222222-2222-2222-2222-222222222222';

interface FakeProduct {
  id: string;
  name: string;
  code: string | null;
  barcodes: string[];
  archived: boolean;
  attributes: Record<string, unknown>;
}

/** Minimal shape of the `where` clauses StoreAddressService actually issues. */
interface FakeWhere {
  id?: { in: string[] };
  OR?: Array<{ attributes?: { equals: unknown }; id?: { in: string[] } }>;
}

function makeService() {
  const cells = new Map([
    ['cell-A', { id: 'cell-A', name: '01-01-01-01', storeId: 'store-1', zone: null }],
    ['cell-B', { id: 'cell-B', name: '01-01-01-02', storeId: 'store-1', zone: null }],
  ]);
  const products = new Map<string, FakeProduct>([
    [
      PROD_1,
      { id: PROD_1, name: 'Tovar 1', code: null, barcodes: [], archived: false, attributes: {} },
    ],
    [
      PROD_2,
      { id: PROD_2, name: 'Tovar 2', code: null, barcodes: [], archived: false, attributes: {} },
    ],
  ]);
  // links: Set of `${productId}:${cellId}`
  const links = new Set<string>();

  // getCellProducts/getCellStock issue `{ accountId, OR: [{attributes:...}, {id:{in}}] }`;
  // assignProducts issues `{ accountId, id: { in } }` — both handled generically so this
  // fake stays correct if the service's exact query shape shifts.
  const matches = (p: FakeProduct, where: FakeWhere): boolean => {
    if (where.id?.in) return where.id.in.includes(p.id);
    if (where.OR) {
      return where.OR.some((clause) => {
        if (clause.attributes) return p.attributes.__yacheyka === clause.attributes.equals;
        if (clause.id?.in) return clause.id.in.includes(p.id);
        return false;
      });
    }
    return false;
  };

  const client = {
    store: { findFirst: vi.fn(async () => ({ id: 'store-1' })) },
    storeCell: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => cells.get(where.id) ?? null),
    },
    product: {
      findMany: vi.fn(async ({ where }: { where: FakeWhere }) =>
        [...products.values()].filter((p) => matches(p, where)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { attributes: unknown } }) => {
          const p = products.get(where.id);
          if (p) p.attributes = data.attributes as Record<string, unknown>;
          return p;
        },
      ),
    },
    productCellLink: {
      upsert: vi.fn(async ({ create }: { create: { productId: string; cellId: string } }) => {
        links.add(`${create.productId}:${create.cellId}`);
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { productId: string; cellId: string } }) => {
        const key = `${where.productId}:${where.cellId}`;
        const had = links.has(key);
        links.delete(key);
        return { count: had ? 1 : 0 };
      }),
      findMany: vi.fn(async ({ where }: { where: { cellId: string } }) => {
        const out: Array<{ productId: string }> = [];
        for (const key of links) {
          const [productId, cellId] = key.split(':');
          if (cellId === where.cellId) out.push({ productId: productId as string });
        }
        return out;
      }),
    },
    // Q1 (egasi, 2026-08-11): `unassignProduct` endi chiqarishdan oldin
    // yacheykadagi QOLDIQNI tekshiradi. Bu ssenariylar sof bog'lanish
    // haqida — hech qayerda sanoq yo'q, shuning uchun qulf hech qachon
    // yonmaydi va multi-bin xulqi o'zgarishsiz qoladi.
    stockByCell: { findFirst: vi.fn(async () => null) },
    // Qulf + o'chirish bitta tranzaksiyada — fake bir xil client ustida
    // ishlaydi, ya'ni yuqoridagi holat-o'tishlari o'zgarishsiz kuzatiladi.
    $transaction: undefined as unknown as (
      fn: (t: unknown) => Promise<unknown>,
    ) => Promise<unknown>,
  };
  client.$transaction = async (fn: (t: unknown) => Promise<unknown>) => fn(client);
  const svc = new StoreAddressService(
    { client } as never,
    {} as never,
    {} as never,
    {} as never,
    // N2 — sanoq izi qatlami; bu testlar `setCellStock` ni chaqirmaydi.
    { recordCount: async () => ({ recorded: false }) } as never,
  );
  return { svc, products, links };
}

describe('StoreAddressService — multi-bin (product ↔ cell many-to-many)', () => {
  it('binds the SAME product to a SECOND cell WITHOUT unbinding it from the first', async () => {
    const { svc, products } = makeService();

    await svc.assignProducts('acc-1', 'store-1', 'cell-A', { productIds: [PROD_1] });
    expect(products.get(PROD_1)?.attributes.__yacheyka).toBe('01-01-01-01');

    // Second bind — a DIFFERENT cell for the SAME product. Before the fix
    // this overwrote __yacheyka to cell-B, silently dropping cell-A.
    await svc.assignProducts('acc-1', 'store-1', 'cell-B', { productIds: [PROD_1] });
    // Home cache stays at the FIRST cell — never overwritten.
    expect(products.get(PROD_1)?.attributes.__yacheyka).toBe('01-01-01-01');

    // Both cells now list the product as bound.
    const inA = await svc.getCellProducts('acc-1', 'store-1', 'cell-A');
    const inB = await svc.getCellProducts('acc-1', 'store-1', 'cell-B');
    expect(inA.items.map((p) => p.id)).toContain(PROD_1);
    expect(inB.items.map((p) => p.id)).toContain(PROD_1);
  });

  it('binds TWO DIFFERENT products to the SAME cell', async () => {
    const { svc } = makeService();

    await svc.assignProducts('acc-1', 'store-1', 'cell-A', { productIds: [PROD_1] });
    await svc.assignProducts('acc-1', 'store-1', 'cell-A', { productIds: [PROD_2] });

    const inA = await svc.getCellProducts('acc-1', 'store-1', 'cell-A');
    const ids = inA.items.map((p) => p.id);
    expect(ids).toContain(PROD_1);
    expect(ids).toContain(PROD_2);
    expect(ids).toHaveLength(2);
  });

  it('unassigning from ONE cell leaves the OTHER binding intact', async () => {
    const { svc, links } = makeService();

    await svc.assignProducts('acc-1', 'store-1', 'cell-A', { productIds: [PROD_1] });
    await svc.assignProducts('acc-1', 'store-1', 'cell-B', { productIds: [PROD_1] });
    expect(links.has(`${PROD_1}:cell-A`)).toBe(true);
    expect(links.has(`${PROD_1}:cell-B`)).toBe(true);

    const res = await svc.unassignProduct('acc-1', 'store-1', 'cell-B', PROD_1);
    expect(res.unassigned).toBe(true);
    expect(links.has(`${PROD_1}:cell-A`)).toBe(true);
    expect(links.has(`${PROD_1}:cell-B`)).toBe(false);

    const inA = await svc.getCellProducts('acc-1', 'store-1', 'cell-A');
    expect(inA.items.map((p) => p.id)).toContain(PROD_1);
  });

  it('re-assigning an already-linked product is a no-op (idempotent, no duplicate)', async () => {
    const { svc } = makeService();

    await svc.assignProducts('acc-1', 'store-1', 'cell-A', { productIds: [PROD_1] });
    await svc.assignProducts('acc-1', 'store-1', 'cell-A', { productIds: [PROD_1] });

    const inA = await svc.getCellProducts('acc-1', 'store-1', 'cell-A');
    expect(inA.items.filter((p) => p.id === PROD_1)).toHaveLength(1);
  });
});
