import { describe, expect, it } from 'vitest';
import {
  BRAK_STORE_KEY,
  type Registry,
  type StateCellRow,
  type StateStoreRow,
  UNASSIGNED_SOURCE_KEY,
  type WarehouseStateInput,
  buildWarehouseState,
  diffAgainstRegistry,
  exitCodeFor,
  parseRegistry,
  pieceStateDrifts,
  readPosPriority,
} from '../../../../packages/db/scripts/warehouse-state-core.js';

/**
 * H2 (2026-08-24 split-kassa hodisasi) — jonli holat yadrosining qulf-testlari.
 *
 * Bu testlarning maqsadi bitta: 06:46 hodisasining SHAKLI (tovar bor, lekin POS
 * unga yeta olmaydi) yadro tomonidan ALBATTA ushlanishi. Shuning uchun asosiy
 * keys hodisaning o'zi raqamlari bilan qayta tiklangan.
 */

const POOL = 'store-pool';
const W01 = 'store-01';
const W02 = 'store-02';

function store(id: string, name: string, attributes: unknown = {}): StateStoreRow {
  return { id, name, archived: false, attributes };
}

function cell(
  id: string,
  storeId: string,
  name: string,
  zoneId: string | null = null,
): StateCellRow {
  return { id, storeId, zoneId, name };
}

function input(over: Partial<WarehouseStateInput> = {}): WarehouseStateInput {
  return {
    stores: over.stores ?? [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 })],
    cells: over.cells ?? [],
    storeStock: over.storeStock ?? [],
    cellStock: over.cellStock ?? [],
    openSessions: over.openSessions ?? [{ storeId: POOL, sessions: 1 }],
  };
}

describe('readPosPriority — apps/api dagi kaskad qoidasi bilan bir xil', () => {
  it('faqat musbat butun son ma’noli', () => {
    expect(readPosPriority({ __posPriority: 1 })).toBe(1);
    expect(readPosPriority({ __posPriority: 7 })).toBe(7);
    expect(readPosPriority({ __posPriority: 0 })).toBeNull();
    expect(readPosPriority({ __posPriority: -1 })).toBeNull();
    expect(readPosPriority({ __posPriority: 1.5 })).toBeNull();
    expect(readPosPriority({ __posPriority: '1' })).toBeNull();
    expect(readPosPriority({})).toBeNull();
    expect(readPosPriority(null)).toBeNull();
    expect(readPosPriority([1])).toBeNull();
  });
});

describe('yetuvchanlik — 06:46 hodisasining shakli', () => {
  it('E5 — kaskadda bor, lekin birinchi EMAS ombor endi YETADI (G4-2a)', () => {
    // 🔴 BU TEST 2026-08-26 da TESKARISIGA O'ZGARTIRILDI (o'chirilmadi).
    // Aynan 2026-08-23 split holati: tovar «Ombor 02» ga ko'chgan. H2 yozilgan
    // paytda bu 2 949 007 dona SOTILMAS edi — kassa faqat kaskadning
    // birinchisidan ayirardi va aynan shu 06:46 da savdoni to'xtatdi.
    // G4-2a (`b4c27d24`) tasdiq-to'sig'ini olib tashladi: `resolveAllocStores`
    // prioriteti bor HAMMA omborni manba qiladi ⇒ bu qoldiq endi yetadi.
    // Eski xulqni saqlab qolsak skript deploy'dan keyin YOLG'ON QIZIL berardi
    // (dossier D1) va qoida 13 qo'riqchisi «bo'ri keldi» bo'lib qolardi.
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
        ],
        storeStock: [
          { storeId: POOL, qty: '49570000' },
          { storeId: W02, qty: '2949007' },
        ],
      }),
    );
    expect(report.unreachableQty).toBe('0');
    expect(report.unreachable).toHaveLength(0);
    expect(report.stores.find((s) => s.id === POOL)?.reach).toBe('reachable');
    expect(report.stores.find((s) => s.id === W02)?.reach).toBe('reachable');
  });

  it('kaskadda umuman yo‘q ombor — «outside_cascade» (hodisaning YANGI shakli)', () => {
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }), store(W01, 'Ombor 01')],
        storeStock: [{ storeId: W01, qty: '10' }],
      }),
    );
    expect(report.unreachable[0]?.reach).toBe('outside_cascade');
    expect(report.unreachableQty).toBe('10');
  });

  it('BRAK ombori ISTISNO — u ataylab yopiq, xavf emas', () => {
    // G3 hisobotidagi ogohlantirish: busiz birinchi brak qabulidan keyin
    // har deploy bloklanardi va signal «bo'ri keldi» bo'lib qolardi.
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store('store-brak', 'BRAK', { [BRAK_STORE_KEY]: true }),
        ],
        storeStock: [{ storeId: 'store-brak', qty: '500' }],
      }),
    );
    expect(report.unreachableQty).toBe('0');
    expect(report.unreachable).toHaveLength(0);
    expect(report.stores.find((s) => s.name === 'BRAK')?.reach).toBe('brak');
  });

  it('qoldig‘i 0 bo‘lgan yetib bo‘lmaydigan ombor shovqin qilmaydi', () => {
    // Hozirgi jonli holat: «Ombor 01» da prioritet YO'Q (R4), lekin u BO'SH.
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }), store(W01, 'Ombor 01')],
        storeStock: [{ storeId: POOL, qty: '100' }],
      }),
    );
    expect(report.unreachableQty).toBe('0');
    expect(report.unreachable).toHaveLength(0);
  });

  it('E5 — BRAK omboriga prioritet qo‘yilsa ham kaskadga KIRMAYDI', () => {
    // `resolveAllocStores` da `!s.isBrak` filtri bor. Bu yerda bo'lmasa,
    // tasodifan prioritet olgan BRAK ombori kaskad BOSHI bo'lib ko'rinardi va
    // ikki model ikki xil haqiqat aytardi (H2 hisobotidagi «takrorlangan
    // mantiq» ogohlantirishi aynan shu klass).
    const report = buildWarehouseState(
      input({
        stores: [
          store('store-brak', 'BRAK', { __posPriority: 1, [BRAK_STORE_KEY]: true }),
          store(POOL, 'Taqsimlanmagan', { __posPriority: 2 }),
        ],
        storeStock: [
          { storeId: 'store-brak', qty: '500' },
          { storeId: POOL, qty: '100' },
        ],
      }),
    );
    expect(report.cascade.map((c) => c.name)).toEqual(['Taqsimlanmagan']);
    expect(report.stores.find((s) => s.name === 'BRAK')?.reach).toBe('brak');
    expect(report.stores.find((s) => s.id === POOL)?.reach).toBe('reachable');
    expect(report.unreachableQty).toBe('0');
  });

  it('kaskad sozlanmagan bo‘lsa POS smena omboridan ishlaydi (F6 zaxira yo‘li)', () => {
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan'), store(W01, 'Ombor 01')],
        storeStock: [
          { storeId: POOL, qty: '100' },
          { storeId: W01, qty: '7' },
        ],
        openSessions: [{ storeId: POOL, sessions: 2 }],
      }),
    );
    expect(report.cascadeConfigured).toBe(false);
    expect(report.stores.find((s) => s.id === POOL)?.reach).toBe('reachable');
    expect(report.unreachableQty).toBe('7');
  });

  it('kaskad tartibi: prioritet ↑, tenglikda nom bo‘yicha', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(W02, 'Ombor 02', { __posPriority: 2 }),
          store('b', 'Bbb', { __posPriority: 1 }),
          store('a', 'Aaa', { __posPriority: 1 }),
        ],
      }),
    );
    expect(report.cascade.map((c) => c.name)).toEqual(['Aaa', 'Bbb', 'Ombor 02']);
    // TARTIB muhim (taqsimot uni o'qiydi), lekin YETUVCHANLIK uchun emas —
    // G4-2a dan keyin kaskaddagi HAMMASI «reachable».
    expect(report.stores.map((s) => s.reach)).toEqual(['reachable', 'reachable', 'reachable']);
  });

  it('E5/(b) — «Kassa oldidagi ombor» bayrog‘i o‘qiladi', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 2 }),
          store('store-07', 'Ombor 07', { __posPriority: 1, __posFrontStore: true }),
        ],
      }),
    );
    expect(report.stores.find((s) => s.id === 'store-07')?.isPosFront).toBe(true);
    expect(report.stores.find((s) => s.id === POOL)?.isPosFront).toBe(false);
  });
});

describe('split holati — yacheyka prefiksi ↔ ombor', () => {
  it('hammasi bitta omborda, prefiks mos emas ⇒ «qaytarilgan»', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W01, 'Ombor 01'),
          store(W02, 'Ombor 02'),
        ],
        cells: [cell('c1', POOL, '01-04-02-13'), cell('c2', POOL, '02-01-01-01')],
      }),
    );
    expect(report.split.state).toBe('qaytarilgan');
    expect(report.split.mismatched).toBe(2);
    expect(report.split.matched).toBe(0);
    expect(report.split.missingStores).toEqual([]);
  });

  it('har yacheyka o‘z omborida ⇒ «bajarilgan»', () => {
    const report = buildWarehouseState(
      input({
        stores: [store(W01, 'Ombor 01'), store(W02, 'Ombor 02', { __posPriority: 1 })],
        cells: [cell('c1', W01, '01-04-02-13'), cell('c2', W02, '02-01-01-01')],
        openSessions: [{ storeId: W02, sessions: 1 }],
      }),
    );
    expect(report.split.state).toBe('bajarilgan');
    expect(report.split.mismatched).toBe(0);
  });

  it('aralash ⇒ «qisman», yetishmayotgan ombor nomi ko‘rinadi', () => {
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }), store(W01, 'Ombor 01')],
        cells: [
          cell('c1', W01, '01-04-02-13'), // mos
          cell('c2', POOL, '07-01-01-01'), // «Ombor 07» hali yo'q
        ],
      }),
    );
    expect(report.split.state).toBe('qisman');
    expect(report.split.missingStores).toEqual(['Ombor 07']);
  });

  it('kodi o‘qilmaydigan yacheykalar alohida sanaladi va holatga ta’sir qilmaydi', () => {
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 })],
        cells: [cell('c1', POOL, 'ESKI-JAVON')],
      }),
    );
    expect(report.split.unparsed).toBe(1);
    expect(report.split.state).toBe('bajarilgan'); // mos emas qatori yo'q
  });
});

describe('ombor kesimi — yacheykasiz qoldiq va zonalar', () => {
  it('yacheykasiz qoldiq = ombor jamisi − yacheykalardagi', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1, [UNASSIGNED_SOURCE_KEY]: true }),
        ],
        cells: [cell('c1', POOL, '01-01-01-01', 'z1'), cell('c2', POOL, '01-01-01-02')],
        storeStock: [{ storeId: POOL, qty: '52513521' }],
        cellStock: [{ storeId: POOL, qty: '2948688' }],
      }),
    );
    const s = report.stores[0];
    expect(s?.unassignedQty).toBe('49564833');
    expect(s?.cells).toBe(2);
    expect(s?.zones).toBe(1);
    expect(s?.cellsWithoutZone).toBe(1);
    expect(s?.isUnassignedSource).toBe(true);
  });

  it('Decimal(20,6) kasrlari float’siz yig‘iladi', () => {
    const report = buildWarehouseState(
      input({
        storeStock: [
          { storeId: POOL, qty: '0.1' },
          { storeId: POOL, qty: '0.2' },
        ],
      }),
    );
    expect(report.stores[0]?.storeQty).toBe('0.3');
  });
});

describe('reyestr — parse', () => {
  const md = [
    '# sarlavha',
    'matn',
    '```json',
    '{"split":"qaytarilgan","posSessionStore":"Taqsimlanmagan","stores":[{"name":"Taqsimlanmagan","posPriority":1}]}',
    '```',
    'yana matn',
  ].join('\n');

  it('md ichidagi json blokini o‘qiydi', () => {
    const r = parseRegistry(md);
    expect(r.split).toBe('qaytarilgan');
    expect(r.posSessionStore).toBe('Taqsimlanmagan');
    expect(r.stores).toHaveLength(1);
  });

  it('blok yo‘q / maydon yo‘q bo‘lsa OCHIQ yiqiladi (jimgina 0 emas)', () => {
    expect(() => parseRegistry('json bloki yo‘q')).toThrow(/json bloki topilmadi/);
    expect(() => parseRegistry('```json\n{"split":"x"}\n```')).toThrow(/stores/);
    expect(() => parseRegistry('```json\n{"stores":[]}\n```')).toThrow(/posSessionStore/);
  });
});

describe('reyestr bilan solishtirish', () => {
  const registry: Registry = {
    split: 'qaytarilgan',
    posSessionStore: 'Taqsimlanmagan',
    allowUnreachableQty: '0',
    stores: [
      { name: 'Taqsimlanmagan', posPriority: 1, brak: false },
      { name: 'Ombor 02', posPriority: 2 },
    ],
  };

  const okReport = () =>
    buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
        storeStock: [{ storeId: POOL, qty: '100' }],
      }),
    );

  it('mos holatda farq yo‘q, chiqish kodi 0', () => {
    const drifts = diffAgainstRegistry(okReport(), registry);
    expect(drifts).toEqual([]);
    expect(exitCodeFor(drifts)).toBe(0);
  });

  it('prioritet o‘zgarsa xato beradi', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 3 }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    expect(drifts.map((d) => d.code)).toContain('prioritet');
    expect(exitCodeFor(drifts)).toBe(2);
  });

  it('reyestrdagi ombor yo‘qolsa xato', () => {
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 })],
        cells: [cell('c1', POOL, '01-04-02-13')],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    expect(drifts.map((d) => d.code)).toContain('ombor-yoq');
  });

  it('yangi ombor faqat OGOHLANTIRISH beradi (kodni 2 ga o‘zgartirmaydi)', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
          store('store-brak', 'BRAK', { [BRAK_STORE_KEY]: true }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    expect(drifts.map((d) => d.code)).toEqual(['reyestrda-yoq']);
    expect(exitCodeFor(drifts)).toBe(0);
  });

  it('🔴 06:46 hodisasining YANGI shakli: kaskadsiz ombordagi qoldiq ⇒ kod 2', () => {
    // E5 — hodisaning mexanizmi o'zgardi, XAVFI QOLDI: G4-2a dan keyin tovarni
    // kassadan uzib qo'yish uchun uni kaskadda BO'LMAGAN omborga qo'yish kerak
    // (prioritetsiz). Detektor aynan shuni ushlashi shart.
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
          store(W01, 'Ombor 01'),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
        storeStock: [{ storeId: W01, qty: '2949007' }],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    const hit = drifts.find((d) => d.code === 'yetib-bolmaydigan-qoldiq');
    expect(hit?.severity).toBe('xato');
    expect(hit?.message).toContain('2949007');
    expect(hit?.message).toContain('kaskadda umuman yoq');
    expect(exitCodeFor(drifts)).toBe(2);
  });

  it('POS smena ombori kaskadda UMUMAN bo‘lmasa xato (E5 — qayta ta’riflandi)', () => {
    // Ilgari shart «kaskad boshi bo'lishi» edi; G4-2a dan keyin tartib
    // yetuvchanlikka ta'sir qilmaydi, shuning uchun haqiqiy xato — smena
    // ombori kaskadda UMUMAN yo'qligi (undagi qoldiq sotilmay qoladi).
    const report = buildWarehouseState(
      input({
        stores: [store(POOL, 'Taqsimlanmagan'), store(W02, 'Ombor 02', { __posPriority: 1 })],
        cells: [cell('c1', POOL, '01-04-02-13')],
      }),
    );
    const drifts = diffAgainstRegistry(report, {
      ...registry,
      stores: [
        { name: 'Taqsimlanmagan', posPriority: null },
        { name: 'Ombor 02', posPriority: 1 },
      ],
    });
    expect(drifts.map((d) => d.code)).toContain('pos-ombori-yetib-bolmaydi');
    expect(exitCodeFor(drifts)).toBe(2);
  });

  it('E5 — POS ombori kaskad boshi bo‘lmasa ham endi XATO EMAS', () => {
    // Aynan yuqoridagi testning ko'zgusi: pp=2 bo'lgan smena ombori G4-2a dan
    // keyin mutlaqo normal. Eski qoida saqlanganda skript har deploy'da
    // yolg'on qizil berardi.
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 2 }),
          store(W02, 'Ombor 02', { __posPriority: 1 }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
        storeStock: [{ storeId: POOL, qty: '100' }],
      }),
    );
    const drifts = diffAgainstRegistry(report, {
      ...registry,
      stores: [
        { name: 'Taqsimlanmagan', posPriority: 2 },
        { name: 'Ombor 02', posPriority: 1 },
      ],
    });
    expect(drifts.map((d) => d.code)).not.toContain('pos-ombori-yetib-bolmaydi');
    expect(exitCodeFor(drifts)).toBe(0);
  });

  it('E5/(b) — reyestrda e’lon qilinmagan «Kassa oldidagi ombor» bayrog‘i xato', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1, __posFrontStore: true }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
        storeStock: [{ storeId: POOL, qty: '100' }],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    expect(drifts.map((d) => d.code)).toContain('kassa-oldidagi-ombor-reyestrda-yoq');
    expect(exitCodeFor(drifts)).toBe(2);
  });

  it('E5/(b) — reyestr kutgan bayroq jonlida yo‘q bo‘lsa ham xato', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
        storeStock: [{ storeId: POOL, qty: '100' }],
      }),
    );
    const drifts = diffAgainstRegistry(report, {
      ...registry,
      stores: [
        { name: 'Taqsimlanmagan', posPriority: 1, brak: false },
        { name: 'Ombor 02', posPriority: 2, posFront: true },
      ],
    });
    const hit = drifts.find((d) => d.code === 'kassa-oldidagi-ombor');
    expect(hit?.severity).toBe('xato');
    expect(exitCodeFor(drifts)).toBe(2);
  });

  it('boshqa omborda ochiq smena — ogohlantirish', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
        ],
        cells: [cell('c1', POOL, '01-04-02-13')],
        openSessions: [
          { storeId: POOL, sessions: 1 },
          { storeId: W02, sessions: 1 },
        ],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    expect(drifts.map((d) => d.code)).toContain('smena-boshqa-omborda');
    expect(exitCodeFor(drifts)).toBe(0);
  });

  it('split holati o‘zgarsa xato (drift ko‘rinadi — IS-7 ning yopilishi)', () => {
    const report = buildWarehouseState(
      input({
        stores: [
          store(POOL, 'Taqsimlanmagan', { __posPriority: 1 }),
          store(W02, 'Ombor 02', { __posPriority: 2 }),
        ],
        cells: [cell('c1', W02, '02-01-01-01')],
      }),
    );
    const drifts = diffAgainstRegistry(report, registry);
    const hit = drifts.find((d) => d.code === 'split-holati');
    expect(hit?.message).toContain('bajarilgan');
    expect(exitCodeFor(drifts)).toBe(2);
  });
});

describe('haqiqiy reyestr fayli (docs/ops/jonli-holat.md)', () => {
  it('parse bo‘ladi va hozirgi jonli holatni ifodalaydi', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', '..', '..', '..', 'docs', 'ops', 'jonli-holat.md');
    const registry = parseRegistry(readFileSync(path, 'utf8'));
    // 🟢 `bajarilgan` (2026-08-31): ombor-split egasining qarori bilan jonlida
    // yuritildi — 1 244 yacheyka o'z omborlariga ko'chdi, `warehouse-state.ts`
    // o'lchovi: mos 1 271, mos emas 0, POS yeta olmaydigan qoldiq 0. To'liq iz
    // reyestr jurnalida (2026-08-31 qatori). Bu qiymat o'zgarsa jonli holat ham
    // o'zgargan bo'lishi SHART — gate aynan shuni qulflaydi.
    expect(registry.split).toBe('bajarilgan');
    expect(registry.posSessionStore).toBe('Taqsimlanmagan');
    expect(registry.allowUnreachableQty).toBe('0');
    // E5 — reyestrdagi POS ombori KASKADDA bo'lishi SHART (ilgari «boshi
    // bo'lishi shart» edi; G4-2a dan keyin tartib yetuvchanlikni belgilamaydi,
    // lekin kaskadda umuman bo'lmasa undagi qoldiq sotilmay qoladi).
    const posStore = registry.stores.find((s) => s.name === registry.posSessionStore);
    expect(posStore?.posPriority).not.toBeNull();
    expect(posStore?.posPriority).not.toBeUndefined();
  });

  /**
   * M1 (2026-08-30) — KANONIK KASKAD reyestrda QULFLANADI.
   *
   * Tartib egasining S-M1 javobi: «Ombor 07 kassaga eng yaqin, qolganlari
   * raqam bo'yicha», `Taqsimlanmagan` esa ENG OXIRIDA (u hovuz, ombor emas).
   * Bu ro'yxat o'zgarsa jonli kaskad ham o'zgargan bo'lishi SHART — aks holda
   * `warehouse-state.ts` jonlida `prioritet` xatosi beradi va chiqish kodi 2.
   */
  it('M1 — kanonik kaskad tartibi va BRAK ning kaskaddan tashqarida qolishi', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', '..', '..', '..', 'docs', 'ops', 'jonli-holat.md');
    const registry = parseRegistry(readFileSync(path, 'utf8'));

    const kaskad = registry.stores
      .filter((s) => s.posPriority != null)
      .sort((a, b) => (a.posPriority as number) - (b.posPriority as number))
      .map((s) => s.name);
    expect(kaskad).toEqual([
      'Ombor 07',
      'Ombor 01',
      'Ombor 02',
      'Ombor 03',
      'Ombor 04',
      'Ombor 05',
      'Ombor 06',
      'Taqsimlanmagan',
    ]);

    // Prioritetlar 1…8 — bo'shliqsiz va TAKRORSIZ. Takror bo'lsa kaskad
    // «teng prioritet» shoxiga tushib nom bo'yicha tartiblanardi va egasining
    // «eng yaqin ombor» qarori jimgina buzilardi.
    const pp = registry.stores
      .map((s) => s.posPriority)
      .filter((p): p is number => p != null)
      .sort((a, b) => a - b);
    expect(pp).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // BRAK — kaskaddan TASHQARIDA (G3): reyestrda prioriteti YO'Q.
    const brak = registry.stores.find((s) => s.brak === true);
    expect(brak?.name).toBe('Ombor 99');
    expect(brak?.posPriority ?? null).toBeNull();
  });
});

/**
 * J1 — bo'lak sverkasi bandi (K-reja T1 qarzi).
 *
 * Ikki narsa hamma narsadan muhim:
 *   · sverka IKKI QATLAMLI — yacheykali bo'g'in `StockByCell` bilan,
 *     yacheykasiz bo'g'in `Stock − Σ StockByCell` bilan (K1 semantikasi);
 *   · driftlar HECH QACHON `xato` emas — kassa to'xtamasligi K-rejaning
 *     asosiy qarori, chiqish kodi 2 esa deploy'ni to'xtatadi.
 */
describe('bo‘lak sverkasi (J1)', () => {
  const CELL = 'cell-1';
  const P = 'prod-kabel';

  // ⚠️ Yuqoridagi `input()` yordamchisi maydonlarni BITTALAB ko'chiradi va
  // bo'lak kirishlarini tushirib qoldirardi — shuning uchun bu yerda obyekt
  // to'g'ridan-to'g'ri quriladi.
  function pieceInput(over: Partial<WarehouseStateInput> = {}): WarehouseStateInput {
    return {
      stores: [store(POOL, 'Taqsimlanmagan', { __posPriority: 1 })],
      cells: [cell(CELL, POOL, '01-01-01-01')],
      storeStock: [],
      cellStock: [],
      openSessions: [{ storeId: POOL, sessions: 1 }],
      ...over,
    };
  }

  it('bayroq yo‘q ⇒ band bo‘sh, lekin BOR (0 bilan «o‘lchanmadi» ajratiladi)', () => {
    const r = buildWarehouseState(pieceInput());
    expect(r.pieces).toMatchObject({
      trackedProducts: 0,
      activePieces: 0,
      diffProducts: 0,
      diffBuckets: 0,
      diffQty: '0',
    });
    expect(pieceStateDrifts(r)).toEqual([]);
  });

  it('reyestr qoldiqqa AYNAN teng ⇒ farq yo‘q', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [{ id: P, name: 'UzKabel VVG 2x2.5' }],
        trackedStoreStock: [
          { storeId: POOL, assortmentKind: 'product', assortmentId: P, qty: '1220' },
        ],
        trackedCellStock: [
          { storeId: POOL, cellId: CELL, assortmentKind: 'product', assortmentId: P, qty: '1220' },
        ],
        pieceBuckets: [
          {
            storeId: POOL,
            cellId: CELL,
            assortmentKind: 'product',
            assortmentId: P,
            qty: '1220',
            pieces: 7,
          },
        ],
      }),
    );
    expect(r.pieces.activePieces).toBe(7);
    expect(r.pieces.diffBuckets).toBe(0);
    expect(r.pieces.diffQty).toBe('0');
    expect(pieceStateDrifts(r)).toEqual([]);
  });

  it('🔴 yacheykasiz bo‘g‘in = ombor jamisi − yacheykalardagi (ikkinchi qatlam)', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [{ id: P, name: 'UzKabel' }],
        // 1000 ombor jamisi, shundan 400 yacheykada ⇒ 600 hovuzda.
        trackedStoreStock: [
          { storeId: POOL, assortmentKind: 'product', assortmentId: P, qty: '1000' },
        ],
        trackedCellStock: [
          { storeId: POOL, cellId: CELL, assortmentKind: 'product', assortmentId: P, qty: '400' },
        ],
        pieceBuckets: [
          {
            storeId: POOL,
            cellId: CELL,
            assortmentKind: 'product',
            assortmentId: P,
            qty: '400',
            pieces: 2,
          },
          {
            storeId: POOL,
            cellId: null,
            assortmentKind: 'product',
            assortmentId: P,
            qty: '600',
            pieces: 3,
          },
        ],
      }),
    );
    expect(r.pieces.diffBuckets).toBe(0);
    expect(r.pieces.stockQty).toBe('1000');
    expect(r.pieces.registryQty).toBe('1000');
  });

  it('farq chiqsa qator ko‘rinadi va DRIFT beradi — lekin OGOHLANTIRISH', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [{ id: P, name: 'UzKabel' }],
        trackedStoreStock: [
          { storeId: POOL, assortmentKind: 'product', assortmentId: P, qty: '1220' },
        ],
        trackedCellStock: [
          { storeId: POOL, cellId: CELL, assortmentKind: 'product', assortmentId: P, qty: '1220' },
        ],
        pieceBuckets: [
          {
            storeId: POOL,
            cellId: CELL,
            assortmentKind: 'product',
            assortmentId: P,
            qty: '1000',
            pieces: 5,
          },
        ],
      }),
    );
    expect(r.pieces.diffProducts).toBe(1);
    expect(r.pieces.diffBuckets).toBe(1);
    expect(r.pieces.diffQty).toBe('-220');
    expect(r.pieces.rows[0]).toMatchObject({
      productName: 'UzKabel',
      cellName: '01-01-01-01',
      stockQty: '1220',
      registryQty: '1000',
      diffQty: '-220',
      pieces: 5,
    });
    const drifts = pieceStateDrifts(r);
    expect(drifts.map((d) => d.code)).toContain('bolak-sverkasi');
    expect(drifts.every((d) => d.severity === 'ogohlantirish')).toBe(true);
    // 🔴 J1 qabul mezoni: chiqish kodi O'ZGARMAYDI.
    expect(exitCodeFor(drifts)).toBe(0);
  });

  it('🔴 bayroq YOQILGAN, reyestr BO‘SH (bugungi jonli holat) ⇒ alohida drift', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [{ id: P, name: 'Azia Avvg 3x25' }],
        trackedStoreStock: [
          { storeId: POOL, assortmentKind: 'product', assortmentId: P, qty: '10586' },
        ],
        trackedCellStock: [],
        pieceBuckets: [],
      }),
    );
    expect(r.pieces.flaggedWithoutRegistry).toBe(1);
    expect(pieceStateDrifts(r).map((d) => d.code)).toEqual(
      expect.arrayContaining(['bolak-reyestri-bosh', 'bolak-sverkasi']),
    );
    expect(exitCodeFor(pieceStateDrifts(r))).toBe(0);
  });

  it('bayroqsiz tovarda bo‘lak bo‘lsa — `pieces-without-flag` juftligi', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [],
        pieceBuckets: [
          {
            storeId: POOL,
            cellId: CELL,
            assortmentKind: 'product',
            assortmentId: 'boshqa-tovar',
            qty: '250',
            pieces: 1,
          },
        ],
      }),
    );
    expect(r.pieces.piecesWithoutFlag).toBe(1);
    expect(r.pieces.activePieces).toBe(1);
    // Bayroqsiz tovar sverkaga KIRMAYDI — farq sifatida sanalmaydi.
    expect(r.pieces.diffBuckets).toBe(0);
    expect(pieceStateDrifts(r).map((d) => d.code)).toEqual(['bolak-bayroqsiz']);
  });

  it('variantlar bo‘lak hisobidan TASHQARIDA (bayroq faqat `Product` da)', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [{ id: P, name: 'UzKabel' }],
        pieceBuckets: [
          {
            storeId: POOL,
            cellId: CELL,
            assortmentKind: 'variant',
            assortmentId: P,
            qty: '100',
            pieces: 1,
          },
        ],
      }),
    );
    expect(r.pieces.piecesWithoutFlag).toBe(1);
    expect(r.pieces.diffBuckets).toBe(0);
  });

  it('Decimal(20,6) kasrlari float’siz solishtiriladi', () => {
    const r = buildWarehouseState(
      pieceInput({
        trackedProducts: [{ id: P, name: 'UzKabel' }],
        trackedStoreStock: [
          { storeId: POOL, assortmentKind: 'product', assortmentId: P, qty: '0.3' },
        ],
        trackedCellStock: [],
        pieceBuckets: [
          {
            storeId: POOL,
            cellId: null,
            assortmentKind: 'product',
            assortmentId: P,
            qty: '0.1',
            pieces: 1,
          },
        ],
      }),
    );
    expect(r.pieces.diffQty).toBe('-0.2');
  });
});
