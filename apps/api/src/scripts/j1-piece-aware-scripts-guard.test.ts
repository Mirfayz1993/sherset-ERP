/**
 * J1 (K-reja bo'lak hisobini jonli ishga tushirish) — `packages/db` ombor
 * skriptlarining KOD-SHAKL qo'riqchisi.
 *
 * 🔴 NEGA BU FAYL BOR. T1 qarzi (`docs/ops/2026-08-30-deploy-3-kecha.md:338`,
 * K-reja 7.4) aynan shundan tug'ilgan edi: to'rtala skript ham `stock_pieces`
 * degan tushunchani UMUMAN ko'rmasdi va buni hech narsa o'lchamasdi. Skriptni
 * testda yugurtirib bo'lmaydi (jonli baza kerak), lekin uning SHAKLI —
 * hisobotda qaysi qator chiqishi va yozuv qaysi tranzaksiyada bo'lishi —
 * matndan o'lchanadi. Naqsh: `q5-backfill-scripts-guard.test.ts` — izohlar
 * olib tashlangan holda skanerlash, chunki izohdagi so'z DALIL EMAS.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Blok va satr izohlarini olib tashlaydi — da'vo KODda bo'lishi shart. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DB = '../../../../packages/db/scripts/';
const SPLIT = read(`${DB}warehouse-split.ts`);
const SPLIT_CODE = stripComments(SPLIT);
const REVERT = read(`${DB}warehouse-split-revert.ts`);
const REVERT_CODE = stripComments(REVERT);
const CLEANUP = read(`${DB}stock-baseline-cleanup.ts`);
const CLEANUP_CODE = stripComments(CLEANUP);
const CELLS = read(`${DB}create-cells.ts`);
const CELLS_CODE = stripComments(CELLS);
const STATE = read(`${DB}warehouse-state.ts`);
const STATE_CODE = stripComments(STATE);

describe('J1 — hamma ombor skripti bo‘lak reyestrini KO‘RADI', () => {
  it('🔴 reyestrga TEGADIGAN uchtasi `stockPiece` ni ko‘radi (T1 qarzining o‘lchovi)', () => {
    for (const [name, code] of [
      ['warehouse-split', SPLIT_CODE],
      ['warehouse-split-revert', REVERT_CODE],
      ['create-cells', CELLS_CODE],
      ['warehouse-state', STATE_CODE],
    ] as const) {
      expect(code, `${name} bo‘lak reyestrini ko‘rmaydi`).toContain('stockPiece');
    }
  });

  it('🔴 `stock-baseline-cleanup` reyestrga TEGMAYDI — u BAYROQNI ko‘radi', () => {
    // Bu skript qoldiqni kamaytiradi; bo'lak hisobi yuritiladigan tovarda
    // to'g'ri xulq — reyestrni «tuzatish» EMAS, umuman RAD ETISH.
    expect(CLEANUP_CODE).toContain('pieceTracked');
    expect(CLEANUP_CODE).not.toContain('stockPiece');
  });

  it('🔴 hisobot qatori HAR DOIM chiqadi — shartga o‘ralmagan', () => {
    // Reyestr bo'sh bo'lsa ham qator BO'LISHI kerak: «o'lchandi va 0» bilan
    // «umuman o'lchanmadi» ni ajratish J1 ning qabul mezoni.
    for (const [name, code] of [
      ['warehouse-split', SPLIT_CODE],
      ['warehouse-split-revert', REVERT_CODE],
      ['stock-baseline-cleanup', CLEANUP_CODE],
      ['create-cells', CELLS_CODE],
    ] as const) {
      expect(code, `${name} da bo‘lak qatori yo‘q`).toMatch(/Bo.lak reyestri \(K-reja\)/);
    }
    expect(STATE_CODE).toContain('BO‘LAK REYESTRI (K-reja)');
  });
});

describe('warehouse-split — bo‘lak yacheykasi bilan AYNI tranzaksiyada ko‘chadi', () => {
  it('🔴 `stockPiece.updateMany` `$transaction` ICHIDA (`tx.` bilan)', () => {
    expect(SPLIT_CODE).toContain('tx.stockPiece.updateMany');
    expect(SPLIT_CODE).not.toContain('prisma.stockPiece.updateMany');
  });

  it('🔴 to‘liq bo‘lmagan ko‘chish ROLLBACK qiladi (jimgina yarim yozilmaydi)', () => {
    const block = SPLIT_CODE.slice(SPLIT_CODE.indexOf('tx.stockPiece.updateMany'));
    expect(block.slice(0, 500)).toContain('throw new Error');
  });

  it('reja bo‘laklarni O‘ZI hal qiladi — CLI `id` ro‘yxati bilan yozadi', () => {
    expect(SPLIT_CODE).toContain('plan.pieceMoves');
    expect(SPLIT_CODE).toMatch(/id: \{ in: piecesForThisWarehouse\.map/);
  });

  it('🔴 V4 invarianti bor: `piece.storeId == cell.storeId`', () => {
    expect(SPLIT_CODE).toContain('p.store_id <> c.store_id');
    expect(SPLIT_CODE).toContain('V4');
  });
});

describe('warehouse-split-revert — ombor bo‘shashi bo‘laklarga ham tegishli', () => {
  it('🔴 manba ombordagi HAMMA bo‘lak ko‘chadi (`cellId` shartsiz — hovuz ham)', () => {
    expect(REVERT_CODE).toContain('tx.stockPiece.updateMany');
    const call = REVERT_CODE.slice(REVERT_CODE.indexOf('tx.stockPiece.updateMany'));
    const where = call.slice(0, 250);
    expect(where).toContain('storeId: source.id');
    expect(where).not.toContain('cellId');
  });

  it('🔴 tranzaksiya oxirida manbada bo‘lak QOLMAGANI tekshiriladi', () => {
    expect(REVERT_CODE).toContain('tx.stockPiece.count');
    expect(REVERT_CODE).toMatch(/leftPieces[\s\S]{0,200}throw new Error/);
  });
});

describe('stock-baseline-cleanup — bo‘lak hisobi RAD ETILADI', () => {
  it('🔴 bayroq DRY paytida o‘qiladi', () => {
    expect(CLEANUP_CODE).toContain('pieceTracked: true');
    expect(CLEANUP_CODE).toContain('trackedIds');
  });

  it('🔴 bayroq TRANZAKSIYA ICHIDA qayta o‘qiladi (DRY↔APPLY orasidagi poyga)', () => {
    expect(CLEANUP_CODE).toContain('tx.product.findUnique');
    expect(CLEANUP_CODE).toMatch(/pieceTracked: flagged/);
  });

  it('rad etish sababi hisobotda NOM bilan ko‘rinadi', () => {
    expect(CLEANUP_CODE).toContain("'bolak-hisobi'");
    expect(CLEANUP).toMatch(/bo.lak hisobi yuritiladi/);
  });
});

describe('create-cells --revert — bo‘lagi bor yacheyka O‘CHMAYDI', () => {
  it('🔴 «ishlatilgan» ro‘yxatiga faol bo‘laklar qo‘shilgan', () => {
    expect(CELLS_CODE).toMatch(/stockPiece\.findMany\(\{[\s\S]{0,160}status: 'active'/);
    // `used` to'plamiga AYNAN kirishi shart — aks holda o'qib qo'yib,
    // o'chirishni baribir davom ettirardi.
    expect(CELLS_CODE).toMatch(/\[sbc, links, inv, loss, enter, supply, pret, sret, dem, pieces\]/);
  });
});

describe('warehouse-state — bo‘lak bandi qo‘shildi, lekin FAQAT O‘QISH qoldi', () => {
  it('🔴 hech qanday yozuv yo‘q (`--apply` ataylab yo‘q)', () => {
    for (const forbidden of [
      '.create(',
      '.createMany(',
      '.update(',
      '.updateMany(',
      '.upsert(',
      '.delete(',
      '.deleteMany(',
      '$executeRaw',
      '--apply',
    ]) {
      expect(STATE_CODE, `warehouse-state.ts da «${forbidden}» bo‘lmasligi kerak`).not.toContain(
        forbidden,
      );
    }
  });

  it('bo‘laklar `groupBy` bilan o‘qiladi (reyestr to‘lganda qator-ma-qator yuklamasin)', () => {
    expect(STATE_CODE).toContain('prisma.stockPiece.groupBy');
    expect(STATE_CODE).not.toContain('prisma.stockPiece.findMany');
  });

  it('🔴 bayroqli tovar bo‘lmasa qoldiq so‘rovi UMUMAN ketmaydi', () => {
    expect(STATE_CODE).toMatch(/trackedIds\.length\s*\?/);
  });

  it('🔴 bo‘lak driftlari reyestrdan MUSTAQIL (`--no-registry` da ham chiqadi)', () => {
    expect(STATE_CODE).toContain('pieceStateDrifts(report)');
    expect(STATE_CODE).toMatch(/registry \|\| drifts\.length > 0/);
  });
});
