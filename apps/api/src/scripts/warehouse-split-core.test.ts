import { describe, expect, it } from 'vitest';
import {
  type CellRow,
  type SplitPlan,
  type StockByCellRow,
  type StockPieceRow,
  type StockRow,
  type StoreRow,
  type TargetStoreState,
  UNALLOCATED_STORE_NAME,
  buildSplitPlan,
  checkPosReachability,
  countPieceMoves,
  filterPlanTo,
  parseCellCode,
  storeNameFor,
  warehouseNosIn,
} from '../../../../packages/db/scripts/warehouse-split-core.js';

/**
 * F4 — ombor-split rejasining sof yadrosi (packages/db/scripts/
 * warehouse-split-core.ts) uchun qulf-testlar. Reja-invariantlar:
 * prefiks→ombor, zona=stelaj, cost o'rtacha-tortilgan va YO'QOLMAYDI,
 * ikkinchi yugurish no-op.
 */

const SRC = 'src-store';

function stores(extra: StoreRow[] = []): StoreRow[] {
  return [{ id: SRC, name: 'Ombor 2', archived: false }, ...extra];
}

function cell(id: string, name: string, storeId = SRC): CellRow {
  return { id, storeId, name, zoneId: null };
}

function sbc(cellId: string, qty: string, assortmentId = 'p1', storeId = SRC): StockByCellRow {
  return { storeId, cellId, assortmentKind: 'product', assortmentId, qty };
}

function stock(qty: string, cost: bigint, assortmentId = 'p1', storeId = SRC): StockRow {
  return { storeId, assortmentKind: 'product', assortmentId, qty, costBalanceMinor: cost };
}

describe('parseCellCode', () => {
  it('to‘liq kod: ombor + stelaj', () => {
    expect(parseCellCode('01-02-03-04')).toEqual({ warehouseNo: '01', stelaj: '02' });
  });
  it('1 xonali segmentlar 2 xonaga normallashadi', () => {
    expect(parseCellCode(' 1-2 ')).toEqual({ warehouseNo: '01', stelaj: '02' });
  });
  it('stelaj segmenti yo‘q bo‘lsa null', () => {
    expect(parseCellCode('03-')).toEqual({ warehouseNo: '03', stelaj: null });
  });
  it('nostandart nomlar ombor emas', () => {
    expect(parseCellCode('polka-7')).toBeNull();
    expect(parseCellCode('A1')).toBeNull();
    expect(parseCellCode('01')).toBeNull(); // defis yo'q
    expect(parseCellCode('00-01')).toBeNull(); // «00» ombor emas
    expect(parseCellCode('123-01')).toBeNull(); // 3 xonali prefiks ombor emas
  });
});

describe('buildSplitPlan — asosiy split', () => {
  const input = {
    stores: stores(),
    cells: [cell('c1', '01-01-01-01'), cell('c2', '01-02-01-01'), cell('c3', '02-01-01-01')],
    stockByCell: [sbc('c1', '4'), sbc('c2', '6'), sbc('c3', '5', 'p2')],
    stocks: [stock('10', 1000n), stock('7', 700n, 'p2')],
  };

  it('mavjud bo‘lmagan omborlar yaratish ro‘yxatiga tushadi', () => {
    const plan = buildSplitPlan(input);
    expect(plan.warehousesNeeded).toEqual(['01', '02']);
  });

  it('yacheykalar prefiksiga ko‘ra, zona = stelaj (2-segment)', () => {
    const plan = buildSplitPlan(input);
    expect(plan.cellMoves).toHaveLength(3);
    const byId = new Map(plan.cellMoves.map((m) => [m.cellId, m]));
    expect(byId.get('c1')).toMatchObject({ warehouseNo: '01', zoneName: '01', fromStoreId: SRC });
    expect(byId.get('c2')).toMatchObject({ warehouseNo: '01', zoneName: '02' });
    expect(byId.get('c3')).toMatchObject({ warehouseNo: '02', zoneName: '01' });
  });

  it('miqdorlar yacheykasi bilan ketadi, xulosa to‘g‘ri jamlanadi', () => {
    const plan = buildSplitPlan(input);
    expect(plan.qtyMoves).toHaveLength(3);
    const w1 = plan.summary.find((s) => s.warehouseNo === '01')!;
    expect(w1).toMatchObject({ cells: 2, zones: 2, sbcRows: 2, qty: '10' });
    const w2 = plan.summary.find((s) => s.warehouseNo === '02')!;
    expect(w2).toMatchObject({ cells: 1, zones: 1, sbcRows: 1, qty: '5' });
    expect(plan.sourceStoreIds).toEqual([SRC]);
    expect(plan.anomalies).toEqual([]);
  });

  it('manba to‘liq bo‘shaganda cost TO‘LIQ ketadi (tiyin qolmaydi)', () => {
    const plan = buildSplitPlan(input);
    const p1cost = plan.qtyMoves
      .filter((q) => q.assortmentId === 'p1')
      .reduce((a, q) => a + q.costMinor, 0n);
    expect(p1cost).toBe(1000n); // 4/10 → 400, qolgan 6 manbani bo'shatadi → 600
  });
});

describe('buildSplitPlan — cost arifmetikasi', () => {
  it('teng bo‘linmaydigan cost yaxlitlanadi, JAMI saqlanadi', () => {
    // 3 dona / 100 tiyin, 3 ta 1 donalik yacheyka: 33+33+34 = 100.
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', '01-01-01-01'), cell('c2', '01-01-01-02'), cell('c3', '01-01-01-03')],
      stockByCell: [sbc('c1', '1'), sbc('c2', '1'), sbc('c3', '1')],
      stocks: [stock('3', 100n)],
    });
    const costs = plan.qtyMoves.map((q) => q.costMinor);
    expect(costs.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(costs.every((c) => c === 33n || c === 34n)).toBe(true);
  });

  it('qisman ko‘chishda qoldiq cost manbada qoladi', () => {
    // 10 dona / 1001 tiyin, yacheykada faqat 5 → per-unit 100, ketadi 500.
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', '01-01-01-01')],
      stockByCell: [sbc('c1', '5')],
      stocks: [stock('10', 1001n)],
    });
    expect(plan.qtyMoves[0]!.costMinor).toBe(500n);
  });

  it('Stock qatori yo‘q assortimentda cost 0, miqdor baribir ko‘chadi', () => {
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', '01-01-01-01')],
      stockByCell: [sbc('c1', '5')],
      stocks: [],
    });
    expect(plan.qtyMoves[0]!).toMatchObject({ qty: '5', costMinor: 0n });
    expect(plan.anomalies.map((a) => a.kind)).toContain('cell-exceeds-stock');
  });
});

describe('buildSplitPlan — idempotentlik va chetki holatlar', () => {
  it('yacheyka allaqachon o‘z omborida — reja bo‘sh (no-op)', () => {
    const plan = buildSplitPlan({
      stores: stores([{ id: 'w1', name: 'Ombor 01', archived: false }]),
      cells: [cell('c1', '01-01-01-01', 'w1')],
      stockByCell: [sbc('c1', '5', 'p1', 'w1')],
      stocks: [stock('5', 100n, 'p1', 'w1')],
    });
    expect(plan.cellMoves).toEqual([]);
    expect(plan.qtyMoves).toEqual([]);
    expect(plan.warehousesNeeded).toEqual([]);
    expect(plan.sourceStoreIds).toEqual([]);
  });

  it('arxivlangan «Ombor NN» maqsad emas — yangi Store kerak bo‘ladi', () => {
    const plan = buildSplitPlan({
      stores: stores([{ id: 'w1', name: 'Ombor 01', archived: true }]),
      cells: [cell('c1', '01-01-01-01')],
      stockByCell: [],
      stocks: [],
    });
    expect(plan.warehousesNeeded).toEqual(['01']);
  });

  it('nostandart nomli yacheyka joyida qoladi (anomaliya bilan)', () => {
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', 'polka-7')],
      stockByCell: [sbc('c1', '9')],
      stocks: [stock('9', 0n)],
    });
    expect(plan.cellMoves).toEqual([]);
    expect(plan.anomalies).toEqual([expect.objectContaining({ kind: 'unparsed-cell' })]);
  });

  it('maqsad ombordagi nom to‘qnashuvi — yacheyka joyida qoladi', () => {
    const plan = buildSplitPlan({
      stores: stores([{ id: 'w1', name: 'Ombor 01', archived: false }]),
      cells: [cell('x', '01-01-01-01', 'w1'), cell('c1', '01-01-01-01')],
      stockByCell: [],
      stocks: [],
    });
    expect(plan.cellMoves).toEqual([]);
    expect(plan.anomalies).toEqual([expect.objectContaining({ kind: 'target-name-clash' })]);
  });

  it('ikki manbadan bir maqsad omborga BIR XIL nom — ikkinchisi to‘qnashuv', () => {
    const plan = buildSplitPlan({
      stores: stores([{ id: 'src2', name: 'Boshqa', archived: false }]),
      cells: [cell('c1', '01-01-01-01', SRC), cell('c2', '01-01-01-01', 'src2')],
      stockByCell: [],
      stocks: [],
    });
    expect(plan.cellMoves).toHaveLength(1);
    expect(plan.anomalies).toEqual([expect.objectContaining({ kind: 'target-name-clash' })]);
  });

  it('manfiy yacheyka-qoldiq imzoli ko‘chadi va anomaliya beradi', () => {
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', '01-01-01-01')],
      stockByCell: [sbc('c1', '-2')],
      stocks: [stock('3', 0n)],
    });
    expect(plan.qtyMoves[0]!).toMatchObject({ qty: '-2', costMinor: 0n });
    expect(plan.anomalies.map((a) => a.kind)).toContain('negative-cell-qty');
  });

  it('nol qoldiqli qator qtyMove bermaydi, yacheyka baribir ko‘chadi', () => {
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', '01-01-01-01')],
      stockByCell: [sbc('c1', '0')],
      stocks: [],
    });
    expect(plan.cellMoves).toHaveLength(1);
    expect(plan.qtyMoves).toEqual([]);
  });

  it('Σyacheyka > Stock — anomaliya, cost jami Stock qiymatidan oshmaydi', () => {
    const plan = buildSplitPlan({
      stores: stores(),
      cells: [cell('c1', '01-01-01-01'), cell('c2', '01-01-01-02')],
      stockByCell: [sbc('c1', '8'), sbc('c2', '7')], // 15 > 10
      stocks: [stock('10', 1000n)],
    });
    const total = plan.qtyMoves.reduce((a, q) => a + q.costMinor, 0n);
    expect(total).toBe(1000n);
    expect(plan.anomalies.map((a) => a.kind)).toContain('cell-exceeds-stock');
  });
});

describe('nomlash', () => {
  it('Store nomi «Ombor NN», taqsimlanmagan nom barqaror', () => {
    expect(storeNameFor('03')).toBe('Ombor 03');
    expect(UNALLOCATED_STORE_NAME).toBe('Taqsimlanmagan');
  });
});

// ---------------------------------------------------------------------------
// M6/1 — POS-yetuvchanlik qo'riqchisi
// ---------------------------------------------------------------------------

describe('checkPosReachability — split kassani to‘xtatib qo‘yadimi?', () => {
  const plan = (rows: Array<{ no: string; qty: string }>): SplitPlan => ({
    warehousesNeeded: [],
    cellMoves: rows.map((r, i) => ({
      cellId: `c${i}`,
      cellName: `${r.no}-01-01-01`,
      fromStoreId: SRC,
      warehouseNo: r.no,
      zoneName: '01',
    })),
    qtyMoves: rows.map((r, i) => ({
      cellId: `c${i}`,
      cellName: `${r.no}-01-01-01`,
      fromStoreId: SRC,
      warehouseNo: r.no,
      assortmentKind: 'product',
      assortmentId: 'p1',
      qty: r.qty,
      costMinor: 0n,
    })),
    sourceStoreIds: [SRC],
    summary: [],
    anomalies: [],
  });

  const ok = (pp: number): TargetStoreState => ({ posPriority: pp, isBrak: false });

  it('prioritetli omborlarga ko‘chsa — yeta olmaydigan qoldiq 0', () => {
    const r = checkPosReachability(plan([{ no: '01', qty: '10' }]), new Map([['Ombor 01', ok(2)]]));
    expect(r.rows).toEqual([]);
    expect(r.totalQty).toBe('0');
  });

  it('🔴 ombor hali YO‘Q — skript uni prioritetsiz yaratardi (2026-08-23 minasi)', () => {
    const r = checkPosReachability(plan([{ no: '08', qty: '11000' }]), new Map());
    expect(r.rows).toEqual([
      { warehouseNo: '08', storeName: 'Ombor 08', reason: 'yangi-ombor', qty: '11000', cells: 1 },
    ]);
    expect(r.totalQty).toBe('11000');
  });

  it('🔴 ombor bor, lekin __posPriority yo‘q', () => {
    const r = checkPosReachability(
      plan([{ no: '03', qty: '5' }]),
      new Map([['Ombor 03', { posPriority: null, isBrak: false }]]),
    );
    expect(r.rows[0]?.reason).toBe('prioritet-yoq');
    expect(r.totalQty).toBe('5');
  });

  it('🔴 `99-` prefiksli yacheyka BRAK omboriga tushadi — kaskadga ataylab kirmaydi', () => {
    const r = checkPosReachability(
      plan([{ no: '99', qty: '7' }]),
      new Map([['Ombor 99', { posPriority: null, isBrak: true }]]),
    );
    expect(r.rows[0]?.reason).toBe('brak-ombori');
  });

  it('qoldiqsiz prioritetsiz ombor — RAD ETMAYDI, lekin ogohlantiradi', () => {
    const r = checkPosReachability(plan([{ no: '08', qty: '0' }]), new Map());
    expect(r.rows).toEqual([]);
    expect(r.totalQty).toBe('0');
    expect(r.emptyButUnreachable).toEqual(['Ombor 08']);
  });

  it('aralash: faqat yetib bo‘lmaydiganlar yig‘iladi', () => {
    const r = checkPosReachability(
      plan([
        { no: '01', qty: '100' },
        { no: '08', qty: '20' },
        { no: '99', qty: '3' },
      ]),
      new Map([
        ['Ombor 01', ok(2)],
        ['Ombor 99', { posPriority: null, isBrak: true }],
      ]),
    );
    expect(r.rows.map((x) => x.warehouseNo)).toEqual(['08', '99']);
    expect(r.totalQty).toBe('23');
  });
});

// ---------------------------------------------------------------------------
// M6/2 — bosqichma-bosqich split (`--only`)
// ---------------------------------------------------------------------------

describe('filterPlanTo — bir kechada BITTA ombor', () => {
  const cells: CellRow[] = [
    { id: 'a', storeId: SRC, name: '01-01-01-01', zoneId: null },
    { id: 'b', storeId: SRC, name: '02-01-01-01', zoneId: null },
    { id: 'c', storeId: SRC, name: '03-01-01-01', zoneId: null },
  ];
  const sbc: StockByCellRow[] = cells.map((c) => ({
    storeId: SRC,
    cellId: c.id,
    assortmentKind: 'product',
    assortmentId: 'p1',
    qty: '10',
  }));
  const stk: StockRow[] = [
    {
      storeId: SRC,
      assortmentKind: 'product',
      assortmentId: 'p1',
      qty: '30',
      costBalanceMinor: 0n,
    },
  ];
  const full = () => buildSplitPlan({ cells, stores: stores(), stockByCell: sbc, stocks: stk });

  it('bo‘sh to‘plam — reja O‘ZGARMAYDI (eski xulq)', () => {
    const p = full();
    expect(filterPlanTo(p, new Set())).toBe(p);
  });

  it('bitta ombor tanlansa faqat o‘sha ko‘chadi', () => {
    const p = filterPlanTo(full(), new Set(['02']));
    expect(warehouseNosIn(p)).toEqual(['02']);
    expect(p.qtyMoves).toHaveLength(1);
    expect(p.summary.map((s) => s.warehouseNo)).toEqual(['02']);
  });

  it('bir nechta ombor tanlansa hammasi qoladi', () => {
    expect(warehouseNosIn(filterPlanTo(full(), new Set(['01', '03'])))).toEqual(['01', '03']);
  });

  it('sourceStoreIds qolgan ko‘chishlardan QAYTA hisoblanadi', () => {
    const p = filterPlanTo(full(), new Set(['01']));
    expect(p.sourceStoreIds).toEqual([SRC]);
    expect(filterPlanTo(full(), new Set(['77'])).sourceStoreIds).toEqual([]);
  });

  it('rejada yo‘q ombor tanlansa — bo‘sh reja (no-op), xato emas', () => {
    const p = filterPlanTo(full(), new Set(['77']));
    expect(p.cellMoves).toEqual([]);
    expect(p.qtyMoves).toEqual([]);
  });

  it('warehouseNosIn to‘liq rejadagi omborlarni tartibda beradi', () => {
    expect(warehouseNosIn(full())).toEqual(['01', '02', '03']);
  });
});

/**
 * J1 — K-reja bo'lak reyestri split rejasiga qo'shildi (T1 qarzi).
 *
 * Invariant: bo'lak JISMONIY narsa — yacheykasi ko'chsa u ham ko'chadi,
 * yacheykasi joyida qolsa u ham qoladi. Buzilsa `stock_pieces.store_id` va
 * `store_cells.store_id` ajralib ketadi va K1 sverkasi ikkala omborda ham
 * yolg'on farq beradi.
 */
describe('bo‘lak reyestri — yacheyka bilan birga ko‘chadi (J1)', () => {
  const CELL_MOVING = 'c-moving';
  const CELL_STAYING = 'c-staying';

  function piece(
    id: string,
    cellId: string | null,
    over: Partial<StockPieceRow> = {},
  ): StockPieceRow {
    return {
      id,
      storeId: SRC,
      cellId,
      assortmentKind: 'product',
      assortmentId: 'p1',
      status: 'active',
      ...over,
    };
  }

  /** `01-…` yacheyka ko'chadi; `02-…` esa allaqachon «Ombor 02» da — qoladi. */
  const W02 = 'store-w02';
  function plan(pieces: StockPieceRow[]) {
    return buildSplitPlan({
      cells: [cell(CELL_MOVING, '01-01-01-01'), cell(CELL_STAYING, '02-01-01-01', W02)],
      stores: stores([{ id: W02, name: 'Ombor 02', archived: false }]),
      stockByCell: [],
      stocks: [],
      pieces,
    });
  }

  it('ko‘chayotgan yacheykadagi bo‘lak rejaga tushadi', () => {
    const p = plan([piece('pc-1', CELL_MOVING)]);
    expect(p.pieceMoves).toEqual([
      {
        pieceId: 'pc-1',
        cellId: CELL_MOVING,
        cellName: '01-01-01-01',
        fromStoreId: SRC,
        warehouseNo: '01',
        status: 'active',
      },
    ]);
  });

  it('🔴 YACHEYKASIZ bo‘lak hovuzda QOLADI (qoldig‘i ham qoladi)', () => {
    expect(plan([piece('pc-pool', null)]).pieceMoves).toEqual([]);
  });

  it('ko‘chmaydigan yacheykadagi bo‘lakka TEGILMAYDI', () => {
    expect(plan([piece('pc-2', CELL_STAYING, { storeId: W02 })]).pieceMoves).toEqual([]);
  });

  it('🔴 `consumed` bo‘lak ham ko‘chadi, lekin FAOL sanog‘iga kirmaydi', () => {
    const p = plan([
      piece('pc-a', CELL_MOVING),
      piece('pc-b', CELL_MOVING, { status: 'consumed' }),
    ]);
    expect(p.pieceMoves).toHaveLength(2);
    expect(countPieceMoves(p.pieceMoves)).toEqual({ total: 2, active: 1 });
    expect(p.summary[0]).toMatchObject({ warehouseNo: '01', pieces: 2, activePieces: 1 });
  });

  it('bo‘lak ombori yacheykasinikiga teng bo‘lmasa — ko‘chadi VA anomaliya beradi', () => {
    const p = plan([piece('pc-x', CELL_MOVING, { storeId: 'boshqa-ombor' })]);
    expect(p.pieceMoves).toHaveLength(1);
    expect(p.anomalies.map((a) => a.kind)).toContain('piece-store-mismatch');
  });

  it('bo‘laklar berilmasa reja avvalgidek quriladi (ixtiyoriy kirish)', () => {
    const p = buildSplitPlan({
      cells: [cell(CELL_MOVING, '01-01-01-01')],
      stores: stores(),
      stockByCell: [],
      stocks: [],
    });
    expect(p.pieceMoves).toEqual([]);
    expect(p.cellMoves).toHaveLength(1);
    expect(p.summary[0]).toMatchObject({ pieces: 0, activePieces: 0 });
  });

  it('reja deterministik: kirish tartibi natijani o‘zgartirmaydi', () => {
    const a = plan([piece('pc-b', CELL_MOVING), piece('pc-a', CELL_MOVING)]);
    const b = plan([piece('pc-a', CELL_MOVING), piece('pc-b', CELL_MOVING)]);
    expect(a.pieceMoves.map((m) => m.pieceId)).toEqual(['pc-a', 'pc-b']);
    expect(a.pieceMoves).toEqual(b.pieceMoves);
  });

  it('🔴 `--only` bo‘laklarni ham kesadi (bir kechada BITTA ombor)', () => {
    const p = buildSplitPlan({
      cells: [cell('c1', '01-01-01-01'), cell('c2', '03-01-01-01')],
      stores: stores(),
      stockByCell: [],
      stocks: [],
      pieces: [piece('pc-01', 'c1'), piece('pc-03', 'c2')],
    });
    expect(p.pieceMoves).toHaveLength(2);
    const only01 = filterPlanTo(p, new Set(['01']));
    expect(only01.pieceMoves.map((m) => m.pieceId)).toEqual(['pc-01']);
  });
});
