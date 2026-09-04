import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SEARCH_MAX_LEN, SEARCH_TAKE } from './tsd-search.js';
import { TsdService } from './tsd.service.js';

/**
 * TSD skan endpointi — wiring (G-reja G5).
 *
 * Eng muhim qulf: javobda NARX bo'lmasligi. Test buni javob shaklidan emas,
 * SO'ROVDAN ham tekshiradi — `select` oq ro'yxati ishlatilganini.
 */

const PRODUCT = {
  id: 'p1',
  name: 'Kabel 2x1.5',
  code: 'K-15',
  article: 'ART-15',
  barcodes: ['4780001'],
  uom: 'm',
  archived: false,
  attributes: { __yacheyka: '02-03-01-04' },
};

function makePrisma(over: { products?: unknown[]; piece?: unknown } = {}) {
  const findMany = vi.fn().mockResolvedValue(over.products ?? [PRODUCT]);
  // K4 — bo'lak shoxi (K1 da `supported: false` edi, endi bo'lak topiladi).
  const pieceFindFirst = vi.fn().mockResolvedValue(
    over.piece === undefined
      ? {
          id: 'piece-1',
          label: 'BLK-000123',
          length: { toString: () => '68' },
          whole: false,
          status: 'active',
          assortmentId: 'p1',
          storeId: 's1',
          store: { name: 'Ombor 02' },
          cell: { name: '02-03-01-04' },
          reservedPositionId: null,
        }
      : over.piece,
  );
  const client = {
    product: { findMany, findFirst: vi.fn().mockResolvedValue({ id: 'p1', name: 'Kabel 2x1.5' }) },
    stockPiece: { findFirst: pieceFindFirst },
    stock: {
      findMany: vi.fn().mockResolvedValue([{ assortmentId: 'p1', qty: 180 }]),
    },
    stockByCell: {
      findMany: vi.fn().mockResolvedValue([
        {
          assortmentId: 'p1',
          storeId: 's1',
          cellId: 'c1',
          qty: { toString: () => '100' },
          store: { name: 'Ombor 02' },
          cell: { name: '02-03-01-04' },
        },
      ]),
    },
  };
  return { prisma: { client } as never, findMany, pieceFindFirst, client };
}

describe('TsdService.scan — narxsizlik', () => {
  it('tovar so`rovi `select` OQ RO`YXATI bilan ketadi (narx ustunlari so`ralmaydi)', async () => {
    const { prisma, findMany } = makePrisma();
    await new TsdService(prisma).scan('acc-1', { code: '4780001' });
    const args = findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(args.select).toBeDefined();
    expect(Object.keys(args.select).filter((k) => /price|cost/i.test(k))).toEqual([]);
  });

  it('javobda narx-nomli kalit yo`q', async () => {
    const { prisma } = makePrisma();
    const out = await new TsdService(prisma).scan('acc-1', { code: '4780001' });
    expect(JSON.stringify(out)).not.toMatch(/price|Price/);
  });
});

describe('TsdService.scan — natija shakli', () => {
  it('tovar topilganda yacheyka kesimi va jami qoldiq qaytadi', async () => {
    const { prisma } = makePrisma();
    const out = await new TsdService(prisma).scan('acc-1', { code: '4780001' });
    expect(out.kind).toBe('product');
    expect(out.products[0]).toMatchObject({
      id: 'p1',
      homeCell: '02-03-01-04',
      totalQty: '180',
    });
    expect(out.products[0]?.cells[0]).toMatchObject({
      storeName: 'Ombor 02',
      cellName: '02-03-01-04',
      qty: '100',
    });
  });

  it('topilmasa `none`', async () => {
    const { prisma } = makePrisma({ products: [] });
    const out = await new TsdService(prisma).scan('acc-1', { code: 'yo`q' });
    expect(out.kind).toBe('none');
  });

  it('yacheyka kodida tovar UMUMAN qidirilmaydi', async () => {
    const { prisma, findMany } = makePrisma();
    const out = await new TsdService(prisma).scan('acc-1', { code: '01-02-03-04' });
    expect(out.kind).toBe('cell');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bo`lak kodi (K4) — BO`LAK topiladi, tovar tanlovi OCHILMAYDI', async () => {
    // K1–K3 davrida bu yerda `supported: false` turardi (bo'lakni ochadigan
    // ekran yo'q edi). K4 kesim oqimini qurdi ⇒ shox to'ldirildi. O'zgarmagan
    // qism — TOVAR qidiruvi umuman ishga tushmasligi (K-reja 7.3).
    const { prisma, findMany } = makePrisma();
    const out = await new TsdService(prisma).scan('acc-1', { code: 'BLK-000123' });
    expect(out).toMatchObject({
      kind: 'piece',
      piece: { supported: true, found: true, label: 'BLK-000123', length: '68' },
      products: [],
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('topilmagan bo`lak — `found: false` (jimgina boshqa tovar ochilmaydi)', async () => {
    const { prisma, findMany } = makePrisma({ piece: null });
    const out = await new TsdService(prisma).scan('acc-1', { code: 'BLK-999999' });
    expect(out).toMatchObject({ kind: 'piece', piece: { supported: true, found: false } });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bo`lak javobida NARX maydoni YO`Q', async () => {
    const { prisma } = makePrisma();
    const out = (await new TsdService(prisma).scan('acc-1', { code: 'BLK-000123' })) as {
      piece: Record<string, unknown>;
    };
    const keys = JSON.stringify(out.piece).toLowerCase();
    for (const forbidden of ['price', 'narx', 'cost', 'buy']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('kodsiz so`rov 400', async () => {
    const { prisma } = makePrisma();
    await expect(new TsdService(prisma).scan('acc-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('tenant bo`yicha filtrlanadi', async () => {
    const { prisma, findMany } = makePrisma();
    await new TsdService(prisma).scan('acc-9', { code: '4780001' });
    const args = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ accountId: 'acc-9', deletedAt: null });
  });
});
/**
 * T3 — NOM/ARTIKUL QIDIRUVI (`GET /tsd/search`).
 *
 * Eng muhim ikki qulf:
 *   1. javobda NARX yo'q va so'rov OQ RO'YXAT ustida ketadi (skan bilan bir xil);
 *   2. javob SHAKLI `/tsd/scan` bilan AYNAN bir xil — ilovada bitta renderer.
 */

const ARCHIVED = {
  id: 'p2',
  name: 'Kabel eski',
  code: 'K-OLD',
  article: null,
  barcodes: [],
  uom: 'm',
  archived: true,
  attributes: {},
};

describe('TsdService.search — narxsizlik', () => {
  it('so`rov `select` OQ RO`YXATI bilan ketadi (narx ustunlari so`ralmaydi)', async () => {
    const { prisma, findMany } = makePrisma();
    await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    const args = findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(args.select).toBeDefined();
    expect(Object.keys(args.select).filter((k) => /price|cost|margin/i.test(k))).toEqual([]);
    // Oq ro'yxat — QORA ro'yxat emas: har qiymat `true`.
    expect(Object.values(args.select).every((v) => v === true)).toBe(true);
  });

  it('javobda narx-nomli kalit yo`q', async () => {
    const { prisma } = makePrisma();
    const out = await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    expect(JSON.stringify(out)).not.toMatch(/price|cost|margin|narx/i);
  });
});

describe('TsdService.search — so`rov shakli', () => {
  it('nom/artikul/kod ICHIDA va shtrix AYNAN qidiriladi', async () => {
    const { prisma, findMany } = makePrisma();
    await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    const args = findMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } };
    expect(args.where.OR).toEqual([
      { name: { contains: 'kabel', mode: 'insensitive' } },
      { article: { contains: 'kabel', mode: 'insensitive' } },
      { code: { contains: 'kabel', mode: 'insensitive' } },
      { barcodes: { has: 'kabel' } },
    ]);
  });

  it('tenant bo`yicha filtrlanadi va o`chirilganlar chiqmaydi', async () => {
    const { prisma, findMany } = makePrisma();
    await new TsdService(prisma).search('acc-9', { q: 'kabel' });
    const args = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ accountId: 'acc-9', deletedAt: null });
  });

  it('`take` 30 va DB tartibi ANIQ (kesish DB tomonda)', async () => {
    // Tartibsiz `take` har so'rovda boshqa 30 tani olib kelardi.
    const { prisma, findMany } = makePrisma();
    await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    const args = findMany.mock.calls[0]?.[0] as { take: number; orderBy: unknown };
    expect(args.take).toBe(SEARCH_TAKE);
    expect(args.orderBy).toEqual([{ archived: 'asc' }, { name: 'asc' }]);
  });

  it('so`rov tozalanadi va javobda tozalangani qaytadi', async () => {
    const { prisma, findMany } = makePrisma();
    const out = await new TsdService(prisma).search('acc-1', { q: '  ka%bel   2x1.5 ' });
    expect(out.query).toBe('kabel 2x1.5');
    const args = findMany.mock.calls[0]?.[0] as {
      where: { OR: [{ name: { contains: string } }] };
    };
    expect(args.where.OR[0].name.contains).toBe('kabel 2x1.5');
  });

  it('uzun so`rov kesiladi (400 emas)', async () => {
    const { prisma } = makePrisma();
    const out = await new TsdService(prisma).search('acc-1', { q: 'k'.repeat(500) });
    expect(out.query).toHaveLength(SEARCH_MAX_LEN);
  });

  it('qisqa so`rov 400 va DB ga UMUMAN bormaydi', async () => {
    const { prisma, findMany } = makePrisma();
    await expect(new TsdService(prisma).search('acc-1', { q: 'k' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Tozalashdan keyin bo'sh qolgan so'rov ham to'xtatiladi.
    await expect(new TsdService(prisma).search('acc-1', { q: ' %% ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('so`rovsiz 400', async () => {
    const { prisma } = makePrisma();
    await expect(new TsdService(prisma).search('acc-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('TsdService.search — natija', () => {
  it('topilmasa bo`sh ro`yxat va QOLDIQ so`rovlari umuman ketmaydi', async () => {
    const { prisma, client } = makePrisma({ products: [] });
    const out = await new TsdService(prisma).search('acc-1', { q: 'topilmas' });
    expect(out.products).toEqual([]);
    expect(out.truncated).toBe(false);
    expect(client.stock.findMany).not.toHaveBeenCalled();
    expect(client.stockByCell.findMany).not.toHaveBeenCalled();
  });

  it('arxivlangan tovar ro`yxat OXIRIDA', async () => {
    const { prisma } = makePrisma({ products: [ARCHIVED, PRODUCT] });
    const out = await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    expect(out.products.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('ro`yxat kesilganda `truncated` — omborchi «hammasi shu» deb o`ylamasin', async () => {
    const many = Array.from({ length: SEARCH_TAKE }, (_, i) => ({ ...PRODUCT, id: `p${i}` }));
    const { prisma } = makePrisma({ products: many });
    const out = await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    expect(out.truncated).toBe(true);
    expect(out.products).toHaveLength(SEARCH_TAKE);
  });

  it('🔴 MULTI-HIT: bitta natijada ham tovar TANLANMAYDI — ro`yxat qaytadi', async () => {
    const { prisma } = makePrisma();
    const out = await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    expect(Array.isArray(out.products)).toBe(true);
    expect(out.products).toHaveLength(1);
  });
});

describe('T3 qabul mezoni — javob SHAKLI `/tsd/scan` bilan AYNI', () => {
  /**
   * Ilova bitta renderer (`ProductHitCard`) va bitta `PickProductScreen`
   * bilan ishlaydi. Ikki sirt ikki xil shakl bersa, ikkinchisida `cells`
   * yoki `homeCell` yo'q bo'lib qolgan kun ekran jimgina bo'sh joy chizardi
   * va buni test emas, omborchi topardi. Shuning uchun ikkala yo'l ham
   * `buildProductHits` dan chiqadi — bu test shuni qulflaydi.
   */
  it('kalitlar to`plami ham, qiymatlar ham bir xil', async () => {
    const scanned = await new TsdService(makePrisma().prisma).scan('acc-1', { code: '4780001' });
    const found = await new TsdService(makePrisma().prisma).search('acc-1', { q: 'kabel' });
    const a = scanned.products[0];
    const b = found.products[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Object.keys(a ?? {}).sort()).toEqual(Object.keys(b ?? {}).sort());
    expect(b).toEqual(a);
  });

  it('shaklda `homeCell`, `totalQty` va yacheyka kesimi bor', async () => {
    const { prisma } = makePrisma();
    const out = await new TsdService(prisma).search('acc-1', { q: 'kabel' });
    expect(out.products[0]).toMatchObject({
      id: 'p1',
      article: 'ART-15',
      homeCell: '02-03-01-04',
      totalQty: '180',
    });
    expect(out.products[0]?.cells[0]).toMatchObject({
      cellName: '02-03-01-04',
      qty: '100',
    });
  });
});
