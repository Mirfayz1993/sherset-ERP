import { describe, expect, it, vi } from 'vitest';
import { StockService } from '../stock/stock.service.js';
import type { RecordCountInput } from '../tsd/count-session.service.js';
import { StoreAddressService } from './store-address.service.js';

/**
 * N-reja §5-N2 — `setCellStock` ILGAGI: sanoq izi sessiyaga qo'shiladi.
 *
 * Bu fayl uchta shartnomani qulflaydi:
 *
 *  1. 🔴 **Sanoq yo'li sessiyaga BOG'LIQ EMAS.** Iz yozilmasa (sessiya yo'q)
 *     ham, iz XATO bersa ham — sanoqning o'zi muvaffaqiyatli qaytadi va
 *     avto-hujjat AVVALGIDEK yoziladi.
 *  2. Iz qatoridagi sonlar `stock_by_cell` dan hisoblangan haqiqiy sonlar va
 *     javobdagi (`previousQty` / `qty`) AYNI stringlar — `mode: 'add'` da ham.
 *  3. 🔴 Iz **APPEND**: hujjat `update()` orqali TEGILMAYDI (u qatorlarni
 *     `deleteMany` qilardi) va qoldiqqa hech narsa yozilmaydi.
 */

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const CALL = { assortmentId: PRODUCT };

function makeService(
  currentQty: number | null,
  opts?: { recordThrows?: Error; docId?: string | null },
) {
  const recorded: RecordCountInput[] = [];
  /** 🔴 Sanoq izi bilan bog'liq HAR qanday hujjat-tahriri shu yerga tushadi. */
  const inventoryTouches: string[] = [];

  const client = {
    store: { findFirst: vi.fn(async () => ({ id: 'store-1' })), findMany: vi.fn(async () => []) },
    storeCell: { findFirst: vi.fn(async () => ({ id: 'cell-1', name: '02-01-01-04' })) },
    product: { findFirst: vi.fn(async () => ({ id: PRODUCT, buyPrice: 1000n })) },
    organization: { findFirst: vi.fn(async () => ({ id: 'org-1' })) },
    stockByCell: {
      findFirst: vi.fn(async () => (currentQty === null ? null : { qty: currentQty })),
      upsert: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async () => []),
    },
    stock: { upsert: vi.fn(async () => ({})) },
    stockOperation: { createMany: vi.fn(async () => ({ count: 0 })) },
    inventory: {
      update: vi.fn(async () => {
        inventoryTouches.push('inventory.update');
        return {};
      }),
    },
    inventoryPosition: {
      deleteMany: vi.fn(async () => {
        inventoryTouches.push('inventoryPosition.deleteMany');
        return { count: 0 };
      }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(client)),
  };
  const doc = { id: opts?.docId === undefined ? 'doc-1' : opts.docId, name: 'ENT-1' };
  const enters = { create: vi.fn(async () => doc) };
  const losses = { create: vi.fn(async () => ({ id: 'doc-9', name: 'LOS-1' })) };
  const stock = new StockService({ client: {} } as never);
  const countSessions = {
    recordCount: vi.fn(async (input: RecordCountInput) => {
      if (opts?.recordThrows) throw opts.recordThrows;
      recorded.push(input);
      return { recorded: true };
    }),
  };
  const svc = new StoreAddressService(
    { client } as never,
    enters as never,
    losses as never,
    stock as never,
    countSessions as never,
  );
  return { svc, client, recorded, countSessions, inventoryTouches, enters, losses };
}

describe('setCellStock — sanash sessiyasiga IZ (N2 ilgagi)', () => {
  it('`mode: set` — mutlaq sanoq: expected/actual/variance `stock_by_cell` bilan mos', async () => {
    const { svc, recorded } = makeService(40);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '25' },
      'user-1',
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      accountId: 'acc-1',
      userId: 'user-1',
      storeId: 'store-1',
      cellId: 'cell-1',
      cellName: '02-01-01-04',
      assortmentId: PRODUCT,
      expectedQty: '40',
      actualQty: '25',
      varianceQty: '-15',
    });
    // Javobdagi sonlar bilan BAYT-BAYTGA bir xil: hisobot va ekran zid bo'lmasin.
    expect(recorded[0].expectedQty).toBe(res.previousQty);
    expect(recorded[0].actualQty).toBe(res.qty);
  });

  it('🔴 `mode: add` — qatorda ham MUTLAQ sonlar, farq esa aynan kiritilgan delta', async () => {
    const { svc, recorded, enters } = makeService(26);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '100', mode: 'add' },
      'user-1',
    );

    // Avto-hujjat AYNAN 100 ga yoziladi (mavjud xulq — o'zgarmadi)...
    expect(enters.create).toHaveBeenCalledTimes(1);
    // ...izda esa 26 → 126 va farq 100: hisobot ikkala rejimda BIR XIL o'qiladi.
    expect(recorded[0]).toMatchObject({
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
    });
    expect(res.qty).toBe('126');
    expect(res.previousQty).toBe('26');
  });

  it('avto-hujjat izi qatorga tushadi (tur + id + DENORMAL nom)', async () => {
    const { svc, recorded } = makeService(0);
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '10' }, 'user-1');
    expect(recorded[0].autoDoc).toEqual({ type: 'enter', id: 'doc-1', name: 'ENT-1' });
  });

  it('kamomad — avto-Списание izi (`loss`)', async () => {
    const { svc, recorded } = makeService(10);
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '4' }, 'user-1');
    expect(recorded[0].varianceQty).toBe('-6');
    expect(recorded[0].autoDoc).toEqual({ type: 'loss', id: 'doc-9', name: 'LOS-1' });
  });

  it('hujjat `id` bermasa ham iz yoziladi (`id: null`, nom qoladi)', async () => {
    const { svc, recorded } = makeService(0, { docId: null });
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '10' }, 'user-1');
    expect(recorded[0].autoDoc).toEqual({ type: 'enter', id: null, name: 'ENT-1' });
  });

  it('farq NOL bo`lsa ham iz yoziladi — «sanadim, hammasi joyida» (avto-hujjat yo`q)', async () => {
    const { svc, recorded, enters, losses } = makeService(7);
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '7' }, 'user-1');
    expect(enters.create).not.toHaveBeenCalled();
    expect(losses.create).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({
      expectedQty: '7',
      actualQty: '7',
      varianceQty: '0',
      autoDoc: null,
    });
  });

  it('K5 — `pieceEntry` HOZIRCHA `null`: `setCellStock` sirtida bunday kirish yo`q', async () => {
    // Bu ATAYLAB yozilgan: `SetCellStockSchema` da `pieceEntry` maydoni yo'q
    // va hech bir klient uni yubormaydi (TSD'da tarkib kiritish ekrani yo'q —
    // K-reja). Kirish paydo bo'lganda shu da'vo qizaradi va ilgak yangilanadi.
    const { svc, recorded } = makeService(0);
    await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '3', pieceEntry: '250x3' },
      'user-1',
    );
    expect(recorded[0].pieceEntry).toBeNull();
  });

  it('🔴 APPEND: hujjat `update()` / qator `deleteMany` HECH QACHON chaqirilmaydi', async () => {
    const { svc, inventoryTouches } = makeService(40);
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '25' }, 'user-1');
    expect(inventoryTouches).toEqual([]);
  });
});

describe('🔴 sanoq yo`li sessiyaga BOG`LIQ EMAS', () => {
  it('iz yozish XATO bersa ham sanoq muvaffaqiyatli qaytadi va hujjat yozilgan qoladi', async () => {
    const { svc, enters } = makeService(26, { recordThrows: new Error('baza yiqildi') });
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '100', mode: 'add' },
      'user-1',
    );
    // Sanoq javobi to'liq va avvalgidek.
    expect(res).toMatchObject({
      cellId: 'cell-1',
      assortmentId: PRODUCT,
      qty: '126',
      previousQty: '26',
      mode: 'add',
      stockDoc: { type: 'enter', name: 'ENT-1' },
    });
    // Avto-tenglash hujjati yozilgan — iz xatosi uni bekor QILMAYDI.
    expect(enters.create).toHaveBeenCalledTimes(1);
  });

  it('ilgak amalning ENG OXIRIDA turadi — avto-hujjat allaqachon yozilgan bo`ladi', async () => {
    const { svc, enters, countSessions } = makeService(0);
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '10' }, 'user-1');
    const enterOrder = enters.create.mock.invocationCallOrder[0];
    const recordOrder = countSessions.recordCount.mock.invocationCallOrder[0];
    expect(enterOrder).toBeLessThan(recordOrder);
  });

  it('`userId` yo`q (fon/skript konteksti) — ilgak umuman chaqirilmaydi', async () => {
    const { svc, countSessions } = makeService(5);
    const res = await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '9' });
    expect(countSessions.recordCount).not.toHaveBeenCalled();
    expect(res.qty).toBe('9');
  });
});
