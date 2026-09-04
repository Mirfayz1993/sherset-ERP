/**
 * J2 yadrosining testlari — `j2-pilot-audit-core.ts`.
 *
 * 🔴 NEGA BU FAYL BOR. Bu yadro JONLI bazaga yoziladigan qarorni belgilaydi
 * (qaysi bayroq o'chadi) va pilot doirasini (qaysi tovar chekni yiqitmaydi).
 * «Manba nechta?» degan savolga bir bo'g'in xato javob bersa, bayroq
 * yoqilgan zahoti kassa `no-single-source` bilan 400 qaytarardi — ya'ni
 * 2026-08-24 hodisasining ayni sinfi.
 */
import { describe, expect, it } from 'vitest';

import {
  type J2CandidateInput,
  type J2CellRow,
  type J2StockRow,
  type J2Store,
  buildPieceSources,
  evaluateCandidate,
  planFlagOff,
  rankCandidates,
  summarizeGroups,
} from './j2-pilot-audit-core.js';

const STORES: J2Store[] = [
  { id: 'front', name: 'Ombor 07', posPriority: 1, isBrak: false },
  { id: 's1', name: 'Ombor 01', posPriority: 2, isBrak: false },
  { id: 'pool', name: 'Taqsimlanmagan', posPriority: 8, isBrak: false },
  { id: 'brak', name: 'Ombor 99', posPriority: 9, isBrak: true },
  { id: 'off', name: 'Arxiv', posPriority: null, isBrak: false },
];

const stock = (rows: Array<[string, string]>): J2StockRow[] =>
  rows.map(([storeId, qty]) => ({ storeId, qty, reservedQty: '0' }));

const cell = (storeId: string, cellId: string, qty: string): J2CellRow => ({
  storeId,
  cellId,
  cellName: cellId.toUpperCase(),
  qty,
});

describe('buildPieceSources — 7.1 istisnosi AYNAN shu sanoqqa qaraydi', () => {
  it("yacheykasiz hovuz BITTA psevdo-manba bo'ladi (jonli holat: metrli qoldiqning deyarli hammasi hovuzda)", () => {
    const r = buildPieceSources(STORES, stock([['pool', '11000']]), []);
    expect(r.reachableCount).toBe(1);
    expect(r.sources).toEqual([
      {
        storeId: 'pool',
        storeName: 'Taqsimlanmagan',
        cellId: null,
        cellName: null,
        qty: '11000',
        reachable: true,
      },
    ]);
    expect(r.totalQty).toBe('11000');
    expect(r.largestReachableQty).toBe('11000');
  });

  it('har yacheyka ALOHIDA manba, ombordagi qoldiq esa yana bitta', () => {
    const r = buildPieceSources(STORES, stock([['s1', '450']]), [
      cell('s1', 'a', '250'),
      cell('s1', 'b', '100'),
    ]);
    // 250 (A) + 100 (B) + 100 (yacheykasiz qoldiq) = 3 manba
    expect(r.reachableCount).toBe(3);
    expect(r.sources.map((s) => s.qty)).toEqual(['250', '100', '100']);
    expect(r.largestReachableQty).toBe('250');
  });

  it("qoldig'i NOL yacheyka manba EMAS", () => {
    const r = buildPieceSources(STORES, stock([['s1', '250']]), [
      cell('s1', 'a', '250'),
      cell('s1', 'b', '0'),
    ]);
    expect(r.reachableCount).toBe(1);
  });

  it('🔴 BRAK va kaskaddan tashqari ombor manba SANALMAYDI, lekin qoldig‘i KO‘RINADI', () => {
    const r = buildPieceSources(
      STORES,
      stock([
        ['brak', '500'],
        ['off', '300'],
      ]),
      [],
    );
    expect(r.reachableCount).toBe(0);
    expect(r.unreachableQty).toBe('800');
    expect(r.totalQty).toBe('800');
    expect(r.sources).toHaveLength(2);
    expect(r.sources.every((s) => !s.reachable)).toBe(true);
  });

  it('🔴 yacheykalar ombor qoldig‘idan KO‘P bo‘lsa — jim o‘tkazilmaydi', () => {
    const r = buildPieceSources(STORES, stock([['s1', '100']]), [cell('s1', 'a', '250')]);
    expect(r.overCelledStores).toEqual(['Ombor 01']);
    // Manfiy qoldiq psevdo-manba YARATMAYDI.
    expect(r.reachableCount).toBe(1);
  });

  it('kasrli uzunlik AYNAN saqlanadi (Decimal(20,6), suzuvchi nuqta YO‘Q)', () => {
    const r = buildPieceSources(STORES, stock([['pool', '6931250.575']]), []);
    expect(r.totalQty).toBe('6931250.575');
  });

  it('ikki omborda turgan tovar — ikki manba (chek yiqiladi)', () => {
    const r = buildPieceSources(
      STORES,
      stock([
        ['front', '10'],
        ['pool', '90'],
      ]),
      [],
    );
    expect(r.reachableCount).toBe(2);
  });
});

describe('planFlagOff — sabab ISM bilan chiqadi', () => {
  const row = (over: Partial<Parameters<typeof planFlagOff>[0][number]>) => ({
    id: 'p',
    name: 'Tovar',
    uom: 'м',
    meterUom: true,
    activePieces: 0,
    ...over,
  });

  it("birligi metr emas ⇒ `birlik-metr-emas`, o'chirish XAVFSIZ (J2/1, «Vesta ramka 2X»)", () => {
    const [plan] = planFlagOff([row({ uom: 'шт', meterUom: false })]);
    expect(plan).toMatchObject({ reason: 'birlik-metr-emas', safe: true });
  });

  it("metr + reyestri bo'sh ⇒ `reyestr-bosh`, o'chirish XAVFSIZ (J2/2)", () => {
    const [plan] = planFlagOff([row({})]);
    expect(plan).toMatchObject({ reason: 'reyestr-bosh', safe: true });
  });

  it("🔴 reyestri TO'LGAN tovarni skript O'ZI o'chirmaydi — qaror odamniki", () => {
    const [plan] = planFlagOff([row({ activePieces: 3 })]);
    expect(plan).toMatchObject({ reason: 'reyestr-tolgan', safe: false });
  });

  it('birligi metr EMAS + reyestri to‘lgan ⇒ baribir `birlik-metr-emas` (birlik ustun)', () => {
    // Birlik xatosi ma'lumot xatosi emas: «шт» tovarda bo'lak hisobi
    // umuman ma'nosiz, reyestrda nima turgani bundan o'zgarmaydi.
    const [plan] = planFlagOff([row({ uom: 'шт', meterUom: false, activePieces: 2 })]);
    expect(plan.reason).toBe('birlik-metr-emas');
  });
});

describe('evaluateCandidate — to‘siqlar', () => {
  const base = (over: Partial<J2CandidateInput> = {}): J2CandidateInput => ({
    id: 'p',
    name: 'Kabel',
    code: null,
    uom: 'м',
    meterUom: true,
    folder: 'Uz kabel',
    pieceTracked: false,
    decidedAt: null,
    activePieces: 0,
    receipts30: 5,
    qty30: '120',
    sources: buildPieceSources(STORES, stock([['pool', '1000']]), []),
    ...over,
  });

  it('manbasi 1 va qoldig‘i bor ⇒ kiritilishi MUMKIN', () => {
    const c = evaluateCandidate(base());
    expect(c.eligible).toBe(true);
    expect(c.blockers).toEqual([]);
  });

  it('🔴 manbasi 1 dan ko‘p ⇒ KIRMAYDI (7.1 chekni yiqitardi)', () => {
    const c = evaluateCandidate(
      base({
        sources: buildPieceSources(
          STORES,
          stock([
            ['front', '10'],
            ['pool', '90'],
          ]),
          [],
        ),
      }),
    );
    expect(c.eligible).toBe(false);
    expect(c.blockers).toContain('manba-1-dan-kop');
  });

  it('kassa yeta oladigan qoldiq yo‘q ⇒ KIRMAYDI', () => {
    const c = evaluateCandidate({
      ...base(),
      sources: buildPieceSources(STORES, stock([['brak', '500']]), []),
    });
    expect(c.blockers).toContain('qoldiq-yoq');
  });

  it('qoldig‘i 0 tovar ⇒ KIRMAYDI (jonlidagi «Uz vvgng  5x25»)', () => {
    const c = evaluateCandidate({
      ...base(),
      sources: buildPieceSources(STORES, stock([['pool', '0']]), []),
    });
    expect(c.eligible).toBe(false);
    expect(c.blockers).toContain('qoldiq-yoq');
  });

  it('birligi metr emas ⇒ KIRMAYDI', () => {
    const c = evaluateCandidate(base({ meterUom: false, uom: 'шт' }));
    expect(c.blockers).toContain('birlik-metr-emas');
  });
});

describe('rankCandidates — avval kiritilishi mumkin bo‘lgani, so‘ng eng ko‘p sotilgani', () => {
  const mk = (name: string, receipts30: number, eligible: boolean): J2CandidateInput => ({
    id: name,
    name,
    code: null,
    uom: 'м',
    meterUom: true,
    folder: 'Uz kabel',
    pieceTracked: false,
    decidedAt: null,
    activePieces: 0,
    receipts30,
    qty30: '1',
    sources: eligible
      ? buildPieceSources(STORES, stock([['pool', '100']]), [])
      : buildPieceSources(
          STORES,
          stock([
            ['front', '10'],
            ['pool', '90'],
          ]),
          [],
        ),
  });

  it('saralash tartibi qulflangan', () => {
    const rows = [mk('A', 1, true), mk('B', 99, false), mk('C', 7, true)].map(evaluateCandidate);
    expect(rankCandidates(rows).map((r) => r.name)).toEqual(['C', 'A', 'B']);
  });

  it('skript RO‘YXATNI TANLAMAYDI — saralash kesmaydi, hammasini qaytaradi', () => {
    const rows = [mk('A', 1, true), mk('B', 2, false)].map(evaluateCandidate);
    expect(rankCandidates(rows)).toHaveLength(2);
  });
});

describe('summarizeGroups — guruh kesimi (J2 vazifa 3)', () => {
  it('papka bo‘yicha tovar/manba=1/30k sotilgan/jami qoldiq', () => {
    const mk = (folder: string, receipts30: number, single: boolean): J2CandidateInput => ({
      id: `${folder}-${receipts30}-${single}`,
      name: 'x',
      code: null,
      uom: 'м',
      meterUom: true,
      folder,
      pieceTracked: false,
      decidedAt: null,
      activePieces: 0,
      receipts30,
      qty30: '0',
      sources: single
        ? buildPieceSources(STORES, stock([['pool', '100']]), [])
        : buildPieceSources(
            STORES,
            stock([
              ['front', '40'],
              ['pool', '60'],
            ]),
            [],
          ),
    });
    const rows = [mk('Uz kabel', 3, true), mk('Uz kabel', 0, false), mk('Azia kabel', 1, true)].map(
      evaluateCandidate,
    );

    expect(summarizeGroups(rows)).toEqual([
      { folder: 'Uz kabel', products: 2, singleSource: 1, sold30: 1, totalQty: '200' },
      { folder: 'Azia kabel', products: 1, singleSource: 1, sold30: 1, totalQty: '100' },
    ]);
  });

  it('papkasiz tovar yo‘qolmaydi', () => {
    const row = evaluateCandidate({
      id: 'x',
      name: 'x',
      code: null,
      uom: 'м',
      meterUom: true,
      folder: '',
      pieceTracked: false,
      decidedAt: null,
      activePieces: 0,
      receipts30: 0,
      qty30: '0',
      sources: buildPieceSources(STORES, stock([['pool', '5']]), []),
    });
    expect(summarizeGroups([row])[0]?.folder).toBe('(papkasiz)');
  });
});
