import { describe, expect, it, vi } from 'vitest';
import { StoreAddressService } from './store-address.service.js';

/**
 * T-reja T6 dan qolgan qarz (N-reja §5-N2, 5-vazifa):
 * **`getCellProducts` da `deletedAt: null` filtri YO'Q edi.**
 *
 * Qo'shni `getCellStock` («Ko'rish» ekranidagi qoldiq ro'yxati) da filtr BOR:
 * u yumshoq o'chirilgan tovarni tashlab yuboradi. `getCellProducts`
 * («yacheykaga biriktirilgan tovarlar») da esa yo'q edi — ya'ni ikki endpoint
 * BIR savolga («shu yacheykada nima bor?») IKKI XIL javob berardi.
 *
 * Sabab: `attributes.__yacheyka` yumshoq o'chirilgan tovar qatorida ham
 * QOLADI (o'chirish faqat `deleted_at` ni yozadi), `ProductCellLink` ham
 * o'chmaydi ⇒ o'lik tovar ro'yxatda ko'rinishda davom etardi.
 *
 * ⚠️ Asoslash aniq bo'lsin: bu tuzatish **sessiya izini qutqarmaydi** —
 * T12 dan keyin TSD ilovasi bu endpointni umuman chaqirmaydi. Haqiqiy asos —
 * web'ning «Ko'rish» ekrani va ikki endpointning bir xil qoidaga bo'ysunishi.
 */

const ALIVE = '11111111-1111-4111-8111-111111111111';
const DEAD = '22222222-2222-4222-8222-222222222222';

interface FakeProduct {
  id: string;
  name: string;
  code: string | null;
  barcodes: string[];
  archived: boolean;
  deletedAt: Date | null;
  homeCell: string | null;
}

/** `where` ning bu servis haqiqatda yuboradigan shakli. */
interface FakeWhere {
  deletedAt?: null;
  id?: { in: string[] };
  OR?: Array<{ attributes?: { equals: unknown }; id?: { in: string[] } }>;
}

/**
 * `deletedAt` filtrini HURMAT QILADIGAN fake — «oldi/keyin» ni o'lchash uchun.
 * `honourDeletedAt: false` — filtr yozilmagan (TUZATISHDAN OLDINGI) holat.
 */
function makeService(opts?: { honourDeletedAt?: boolean }) {
  const honour = opts?.honourDeletedAt !== false;
  const products: FakeProduct[] = [
    {
      id: ALIVE,
      name: 'Tirik tovar',
      code: 'A-1',
      barcodes: ['111'],
      archived: false,
      deletedAt: null,
      homeCell: '02-01-01-04',
    },
    {
      // Yumshoq o'chirilgan, LEKIN `__yacheyka` atributi qatorida QOLGAN —
      // o'chirish faqat `deleted_at` ni yozadi.
      id: DEAD,
      name: "O'chirilgan tovar",
      code: 'D-1',
      barcodes: ['222'],
      archived: false,
      deletedAt: new Date('2026-08-01T00:00:00Z'),
      homeCell: '02-01-01-04',
    },
  ];

  const whereCalls: FakeWhere[] = [];

  const matches = (p: FakeProduct, where: FakeWhere): boolean => {
    if (honour && where.deletedAt === null && p.deletedAt !== null) return false;
    if (where.id?.in) return where.id.in.includes(p.id);
    if (where.OR) {
      return where.OR.some((c) => {
        if (c.attributes) return p.homeCell === c.attributes.equals;
        if (c.id?.in) return c.id.in.includes(p.id);
        return false;
      });
    }
    return false;
  };

  const client = {
    store: { findFirst: vi.fn(async () => ({ id: 'store-1' })) },
    storeCell: {
      findFirst: vi.fn(async () => ({
        id: 'cell-1',
        name: '02-01-01-04',
        barcode: null,
        zone: null,
      })),
    },
    product: {
      findMany: vi.fn(async ({ where }: { where: FakeWhere }) => {
        whereCalls.push(where);
        return products
          .filter((p) => matches(p, where))
          .map((p) => ({
            id: p.id,
            name: p.name,
            code: p.code,
            barcodes: p.barcodes,
            archived: p.archived,
            description: null,
            images: [] as Array<{ id: string }>,
          }));
      }),
    },
    productCellLink: { findMany: vi.fn(async () => []) },
    // `getCellStock` yo'li uchun: ikkala tovar ham yacheykada qoldiq bilan turadi.
    stockByCell: {
      findMany: vi.fn(async () => [
        { assortmentKind: 'product', assortmentId: ALIVE, qty: { toString: () => '5' } },
        { assortmentKind: 'product', assortmentId: DEAD, qty: { toString: () => '9' } },
      ]),
    },
    variant: { findMany: vi.fn(async () => []) },
  };
  const svc = new StoreAddressService(
    { client } as never,
    {} as never,
    {} as never,
    {} as never,
    { recordCount: async () => ({ recorded: false }) } as never,
  );
  return { svc, whereCalls };
}

describe('getCellProducts — yumshoq o`chirilgan tovar (T6 qarzi)', () => {
  it('🔴 OLDI (filtrsiz): 2 qator — o`lik tovar ham ro`yxatda edi', async () => {
    // `honourDeletedAt: false` = tuzatishdan OLDINGI xulqni takrorlaydi.
    const { svc } = makeService({ honourDeletedAt: false });
    const res = await svc.getCellProducts('acc-1', 'store-1', 'cell-1');
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.id).sort()).toEqual([ALIVE, DEAD].sort());
  });

  it('✅ KEYIN: 1 qator — faqat tirik tovar', async () => {
    const { svc } = makeService();
    const res = await svc.getCellProducts('acc-1', 'store-1', 'cell-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe(ALIVE);
    expect(res.items.map((i) => i.id)).not.toContain(DEAD);
  });

  it('so`rovda `deletedAt: null` HAQIQATDA bor (fake emas, `where` ning o`zi)', async () => {
    const { svc, whereCalls } = makeService();
    await svc.getCellProducts('acc-1', 'store-1', 'cell-1');
    expect(whereCalls).toHaveLength(1);
    expect(whereCalls[0].deletedAt).toBeNull();
  });

  it('🔴 PARITET: `getCellStock` bilan bir xil qoida (u ham 1 qator qaytaradi)', async () => {
    const { svc, whereCalls } = makeService();
    const stock = await svc.getCellStock('acc-1', 'store-1', 'cell-1');
    // `stock_by_cell` da IKKALA tovar ham turibdi, lekin o'lik tovar tashlanadi.
    expect(stock.items).toHaveLength(1);
    expect(stock.items[0].assortmentId).toBe(ALIVE);
    // Ikkala endpoint ham `deletedAt: null` bilan so'raydi.
    for (const where of whereCalls) expect(where.deletedAt).toBeNull();
  });
});
