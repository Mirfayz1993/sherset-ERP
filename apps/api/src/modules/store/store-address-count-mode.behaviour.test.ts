import { describe, expect, it, vi } from 'vitest';
import { StockService } from '../stock/stock.service.js';
import { StoreAddressService } from './store-address.service.js';

/**
 * TZ v3 §2.1 vs §2.2.3 — sanashning IKKI semantikasi bitta endpointda:
 *
 *   · oddiy rejim (`mode:'set'`, default) — MUTLAQ: yacheyka qoldig'i aynan
 *     kiritilgan songa tenglashtiriladi (inventarizatsiya);
 *   · «Umumiy sanash» (`mode:'add'`) — QO'SHILADI: 26 + 100 = 126, avto-
 *     «Оприходование» AYNAN qo'shilgan miqdorga (100) yoziladi, 126 ga emas.
 *
 * Delta serverda hisoblanadi (FE «hozirgi» ni o'qib mutlaq qiymat yubormaydi) —
 * ikki omborchi bir vaqtda sanaganda yo'qolgan-yangilanish bo'lmasin.
 */
interface Captured {
  enters: Array<{ quantity: string; cellId: string | undefined }>;
  losses: Array<{ quantity: string; cellId: string | undefined }>;
}

function makeService(
  currentQty: number | null,
  opts?: {
    /** F7: hovuz-ombor va uning lockBalances qatori (qty, cost). */
    pool?: { id: string; qty: string; cost: string };
    /** F7: o'z omborning lockBalances qty/cost va Σyacheyka. */
    own?: { qty: string; cost: string; assigned: string };
  },
) {
  const captured: Captured = { enters: [], losses: [] };
  const ledger: Array<{
    storeId: string;
    cellId: string | null;
    qtyDelta: unknown;
    costDeltaMinor: bigint | null;
    docType: string;
  }> = [];
  const lockRow = (storeId: string, qty: string, cost: string) => ({
    account_id: 'acc-1',
    store_id: storeId,
    assortment_kind: 'product',
    assortment_id: '11111111-1111-4111-8111-111111111111',
    qty,
    reserved_qty: '0',
    cost_balance_minor: cost,
  });
  const client = {
    store: {
      findFirst: vi.fn(async () => ({ id: 'store-1' })),
      // findPoolStore: hovuz belgilangan bo'lsa bitta qator.
      findMany: vi.fn(async () =>
        opts?.pool ? [{ id: opts.pool.id, name: 'Taqsimlanmagan' }] : [],
      ),
    },
    storeCell: { findFirst: vi.fn(async () => ({ id: 'cell-1', name: '01-01-01-01' })) },
    product: { findFirst: vi.fn(async () => ({ id: 'prod-1', buyPrice: 1000n })) },
    organization: { findFirst: vi.fn(async () => ({ id: 'org-1' })) },
    stockByCell: {
      findFirst: vi.fn(async () => (currentQty === null ? null : { qty: currentQty })),
      upsert: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async (args: { where: { storeId: string } }) =>
        args.where.storeId === 'store-1' && opts?.own
          ? [
              {
                assortmentKind: 'product',
                assortmentId: '11111111-1111-4111-8111-111111111111',
                _sum: { qty: { toString: () => opts.own?.assigned ?? '0' } },
              },
            ]
          : [],
      ),
    },
    stock: { upsert: vi.fn(async () => ({})) },
    stockOperation: {
      createMany: vi.fn(async (args: { data: typeof ledger }) => {
        ledger.push(...args.data);
        return { count: args.data.length };
      }),
    },
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => {
      const storeId = String(values[1]);
      if (storeId === 'store-1' && opts?.own) {
        return [lockRow('store-1', opts.own.qty, opts.own.cost)];
      }
      if (opts?.pool && storeId === opts.pool.id) {
        return [lockRow(opts.pool.id, opts.pool.qty, opts.pool.cost)];
      }
      return [];
    }),
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(client)),
  };
  const enters = {
    create: vi.fn(
      async (_a: string, _u: string, doc: { positions: Array<Record<string, unknown>> }) => {
        const p = doc.positions[0] as { quantity: string; cellId?: string };
        captured.enters.push({ quantity: p.quantity, cellId: p.cellId });
        return { name: 'ENT-1' };
      },
    ),
  };
  const losses = {
    create: vi.fn(
      async (_a: string, _u: string, doc: { positions: Array<Record<string, unknown>> }) => {
        const p = doc.positions[0] as { quantity: string; cellId?: string };
        captured.losses.push({ quantity: p.quantity, cellId: p.cellId });
        return { name: 'LOS-1' };
      },
    ),
  };
  const stock = new StockService({ client: {} } as never);
  // N2 — sanoq izi qatlami. Bu fayl AVVALGI xulqni (avto-hujjat semantikasi)
  // qulflaydi, shuning uchun ilgak «sessiya yo'q» deb javob beradi: sanoq
  // yo'li sessiyasiz AVVALGIDEK ishlashi shu testlar bilan ham isbotlanadi.
  const countSessions = { recordCount: vi.fn(async () => ({ recorded: false })) };
  const svc = new StoreAddressService(
    { client } as never,
    enters as never,
    losses as never,
    stock as never,
    countSessions as never,
  );
  return { svc, captured, client, ledger, countSessions };
}

const CALL = { assortmentId: '11111111-1111-4111-8111-111111111111' };

describe('setCellStock — sanash semantikasi', () => {
  it('mode berilmasa MUTLAQ yozadi (eski xulq saqlanadi)', async () => {
    const { svc, captured } = makeService(26);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '100' },
      'user-1',
    );
    // 26 → 100: farq 74 ta kirim
    expect(captured.enters).toEqual([{ quantity: '74', cellId: 'cell-1' }]);
    expect(res.qty).toBe('100');
    expect(res.previousQty).toBe('26');
  });

  it("mode:'add' — QO'SHADI va hujjat AYNAN qo'shilgan miqdorga yoziladi", async () => {
    const { svc, captured } = makeService(26);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '100', mode: 'add' },
      'user-1',
    );
    expect(captured.enters).toEqual([{ quantity: '100', cellId: 'cell-1' }]);
    expect(res.qty).toBe('126');
    expect(res.previousQty).toBe('26');
  });

  it("mode:'add' bo'sh yacheykada ham ishlaydi (0 + 100 = 100)", async () => {
    const { svc, captured } = makeService(null);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '100', mode: 'add' },
      'user-1',
    );
    expect(captured.enters).toEqual([{ quantity: '100', cellId: 'cell-1' }]);
    expect(res.qty).toBe('100');
  });

  it("mode:'set' kamaytirsa Списание yoziladi (kirim emas)", async () => {
    const { svc, captured } = makeService(26);
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '10' }, 'user-1');
    expect(captured.losses).toEqual([{ quantity: '16', cellId: 'cell-1' }]);
    expect(captured.enters).toEqual([]);
  });

  it("mode:'add' + qty 0 — hech qanday hujjat yozilmaydi", async () => {
    const { svc, captured } = makeService(26);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '0', mode: 'add' },
      'user-1',
    );
    expect(captured.enters).toEqual([]);
    expect(captured.losses).toEqual([]);
    expect(res.qty).toBe('26');
  });

  /**
   * DEGENERAT YO'L (hujjat yozilmaydi: `userId` yo'q ⇒ `willPostDoc=false`) —
   * bu shoxda per-cell qoldiq TO'G'RIDAN-TO'G'RI yoziladi. `add` rejimida u ham
   * YAKUNIY qiymatni (26+100=126) yozishi shart; kiritilgan sonni (100) yozsa
   * qo'shish jimgina mutlaq yozuvga aylanadi va qoldiq kamayib ketadi.
   */
  it("mode:'add' hujjatsiz yo'lda ham YAKUNIY qoldiqni yozadi (26+100=126)", async () => {
    const { svc, captured, client } = makeService(26);
    const res = await svc.setCellStock('acc-1', 'store-1', 'cell-1', {
      ...CALL,
      qty: '100',
      mode: 'add',
    });
    expect(captured.enters).toEqual([]);
    expect(client.stockByCell.upsert).toHaveBeenCalledTimes(1);
    const args = client.stockByCell.upsert.mock.calls[0]?.[0] as unknown as {
      create: { qty: string };
      update: { qty: string };
    };
    expect(args.create.qty).toBe('126');
    expect(args.update.qty).toBe('126');
    expect(res.qty).toBe('126');
  });

  /**
   * Degenerat yo'lning nol-shoxi `finalQty` ga qarab qaror qilishi kerak:
   * `set` + qty 0 (hujjatsiz) ⇒ qator O'CHADI. `add` + qty 0 esa yakuniy
   * qoldiqni (26) saqlab qoladi — yuqoridagi test buni ushlaydi.
   */
  it("mode:'set' + qty 0 hujjatsiz yo'lda qatorni o'chiradi", async () => {
    const { svc, client } = makeService(26);
    const res = await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '0' });
    expect(client.stockByCell.deleteMany).toHaveBeenCalledTimes(1);
    expect(client.stockByCell.upsert).not.toHaveBeenCalled();
    expect(res.qty).toBe('0');
  });
});

describe('setCellStock — F7 joylashtirish (hovuzdan avto-ko`chirish)', () => {
  it("hovuz to'liq qoplasa: Enter YO'Q, cell_place juftligi cost bilan", async () => {
    const { svc, captured, ledger } = makeService(0, {
      pool: { id: 'pool-1', qty: '10', cost: '1000' },
    });
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '4', mode: 'add' },
      'user-1',
    );
    expect(captured.enters).toEqual([]);
    expect(res.placedQty).toBe('4');
    expect(res.stockDoc).toBeNull();
    expect(ledger.map((l) => [l.docType, l.storeId, String(l.qtyDelta), l.costDeltaMinor])).toEqual(
      [
        ['cell_place', 'pool-1', '-4', -400n],
        ['cell_place', 'store-1', '4', 400n],
      ],
    );
    expect(ledger[1]?.cellId).toBe('cell-1');
  });

  it('hovuz qisman qoplasa: qolgan qismgina Enter bo`ladi', async () => {
    const { captured, res } = await (async () => {
      const w = makeService(0, { pool: { id: 'pool-1', qty: '3', cost: '0' } });
      const r = await w.svc.setCellStock(
        'acc-1',
        'store-1',
        'cell-1',
        { ...CALL, qty: '10', mode: 'add' },
        'user-1',
      );
      return { ...w, res: r };
    })();
    expect(res.placedQty).toBe('3');
    expect(captured.enters).toEqual([{ quantity: '7', cellId: 'cell-1' }]);
    expect(res.stockDoc).toEqual({ type: 'enter', name: 'ENT-1' });
  });

  it("o'z omborning yacheykasiz qoldig'i hovuzdan OLDIN ishlatiladi", async () => {
    const { svc, ledger, captured } = makeService(0, {
      own: { qty: '100', cost: '0', assigned: '95' },
      pool: { id: 'pool-1', qty: '50', cost: '0' },
    });
    await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '5', mode: 'add' },
      'user-1',
    );
    // remainder 5 o'z ombordan — hovuzga TEGILMAYDI, Enter yo'q
    expect(ledger.map((l) => [l.docType, l.storeId, String(l.qtyDelta)])).toEqual([
      ['cell_place', 'store-1', '-5'],
      ['cell_place', 'store-1', '5'],
    ]);
    expect(ledger[0]?.costDeltaMinor).toBeNull();
    expect(captured.enters).toEqual([]);
  });

  it('hovuz belgilanmagan akkauntda eski xulq: butun delta Enter', async () => {
    const { svc, captured, ledger } = makeService(0);
    const res = await svc.setCellStock(
      'acc-1',
      'store-1',
      'cell-1',
      { ...CALL, qty: '4', mode: 'add' },
      'user-1',
    );
    expect(res.placedQty).toBe('0');
    expect(ledger).toEqual([]);
    expect(captured.enters).toEqual([{ quantity: '4', cellId: 'cell-1' }]);
  });

  it('kamaytirish (Loss) yo`li joylashtirishga tegmaydi', async () => {
    const { svc, captured, ledger } = makeService(26, {
      pool: { id: 'pool-1', qty: '50', cost: '0' },
    });
    await svc.setCellStock('acc-1', 'store-1', 'cell-1', { ...CALL, qty: '10' }, 'user-1');
    expect(ledger).toEqual([]);
    expect(captured.losses).toEqual([{ quantity: '16', cellId: 'cell-1' }]);
  });
});
