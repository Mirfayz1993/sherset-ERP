import { describe, expect, it, vi } from 'vitest';
import { RetailSaleFilterSchema } from './retail-sale.schema.js';
import { RetailSaleService } from './retail-sale.service.js';

/**
 * V1 — POS Vozvrat oynasi: «shu tovar qatnashgan barcha cheklar».
 *
 * Naqdga olib ketgan MIJOZSIZ chekni faqat tovar orqali topish mumkin —
 * `search` (name/agent.name contains) va `agentId` buning o'rnini bosolmaydi.
 * Filtr `positions.some.productId` bilan ishlaydi; indeks bazada tayyor:
 * `RetailSalePosition @@index([accountId, productId])`.
 *
 * NON-VACUOUS: qo'shishdan oldin `RetailSaleFilterSchema` `productId` ni
 * jimgina TASHLAB yuborardi (Zod default `strip`), `where` da esa `positions`
 * umuman yo'q edi — quyidagi testlar yiqiladi.
 */

const ACC = 'acc-1';
const PRODUCT = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000c1';

function makeHarness() {
  const findMany = vi.fn(async () => [] as unknown[]);
  const count = vi.fn(async () => 0);
  const client = { retailSale: { findMany, count } };
  const svc = new RetailSaleService(
    { client } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, findMany, count };
}

describe('V1 — `GET /retail-sales?productId=`', () => {
  it('sxema `productId` ni QABUL qiladi (jimgina tashlamaydi)', () => {
    const parsed = RetailSaleFilterSchema.parse({ productId: PRODUCT });
    expect(parsed.productId).toBe(PRODUCT);
  });

  it('uuid bo`lmagan `productId` RAD etiladi (butun ro`yxat qaytib qolmasin)', () => {
    expect(() => RetailSaleFilterSchema.parse({ productId: '00724' })).toThrow();
  });

  it('`where` ga `positions.some.productId` tushadi', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { productId: PRODUCT, limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where?.positions).toEqual({ some: { productId: PRODUCT } });
    // Umumiy so'rov shakli buzilmaydi.
    expect(args?.where?.accountId).toBe(ACC);
  });

  it('`productId` berilmasa `where` ga tushmaydi (ro`yxat sahifasi o`zgarmaydi)', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where && 'positions' in args.where).toBe(false);
  });

  it('boshqa filtrlar bilan BIRGA ishlaydi (agentId + state + productId)', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { productId: PRODUCT, agentId: AGENT, state: 'posted', limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where?.positions).toEqual({ some: { productId: PRODUCT } });
    expect(args?.where?.agentId).toBe(AGENT);
    expect(args?.where?.state).toBe('posted');
  });
});

/**
 * V4 (egasi, 2026-09-03): «mijozni tanladik, shu mijoz cheklaridagi ma'lum
 * tovarni topmoqchimiz» — mijoz chipi ostidagi matnli qidiruv.
 *
 * `productId` dan farqi MATN ekani: jonlida bir tovarning bir nechta
 * kartochkasi bo'ladi (2026-09-02 da o'lchandi: `05136 avvg 3x4 1x2.5`
 * mijozli cheklarda, `04878 avv 3x4*1x2.5` naqd cheklarda) — aniq kartochka
 * tanlansa kassir ikkinchisidagi chekni topolmaydi.
 */
describe('V4 — `GET /retail-sales?productSearch=`', () => {
  it('sxema `productSearch` ni QABUL qiladi', () => {
    expect(RetailSaleFilterSchema.parse({ productSearch: 'avvg 3x4' }).productSearch).toBe(
      'avvg 3x4',
    );
  });

  it('100 belgidan uzun matn RAD etiladi', () => {
    expect(() => RetailSaleFilterSchema.parse({ productSearch: 'a'.repeat(101) })).toThrow();
  });

  it('`where` ga tovar nomi/kodi/shtrix-kodi bo`yicha OR tushadi', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { productSearch: 'avvg', limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where?.positions).toEqual({
      some: {
        product: {
          OR: [
            { name: { contains: 'avvg', mode: 'insensitive' } },
            { code: { startsWith: 'avvg', mode: 'insensitive' } },
            { article: { startsWith: 'avvg', mode: 'insensitive' } },
            { barcodes: { has: 'avvg' } },
          ],
        },
      },
    });
  });

  it('MIJOZ bilan birga ishlaydi (egasi so`ragan asosiy holat)', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { agentId: AGENT, productSearch: 'izolenta', state: 'posted', limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where?.agentId).toBe(AGENT);
    expect(args?.where?.state).toBe('posted');
    expect(args?.where?.positions).toBeDefined();
  });

  /**
   * 🔴 TUZOQ QULFI: ikkalasi ham `where.positions` kalitiga yozadi. Alohida
   * spread qilinsa ikkinchisi birinchisini JIMGINA o'chirardi — so'rov
   * noto'g'ri natija qaytarardi va buni na typecheck, na boshqa test tutardi.
   */
  it('`productId` va `productSearch` BIRGA berilsa IKKALASI ham saqlanadi', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { productId: PRODUCT, productSearch: 'avvg', limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as
      | { where?: { positions?: { some?: Record<string, unknown> } } }
      | undefined;
    const some = args?.where?.positions?.some;
    expect(some?.productId).toBe(PRODUCT);
    expect(some?.product).toBeDefined();
  });

  it('bo`sh/probel matn filtr YASAMAYDI (butun ro`yxat qaytib qolmasin)', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { productSearch: '   ', limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where && 'positions' in args.where).toBe(false);
  });

  it('`productSearch` berilmasa `where` shakli o`zgarmaydi', async () => {
    const h = makeHarness();
    await h.svc.list(ACC, { productId: PRODUCT, limit: 5 });

    const args = h.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    expect(args?.where?.positions).toEqual({ some: { productId: PRODUCT } });
  });
});
