/**
 * H2 (2026-08-24 split-kassa hodisasi) — JONLI HOLAT tekshirgichi.
 *
 * 🔒 FAQAT O'QISH. Bu skriptda birorta `create/update/delete/executeRaw` YO'Q va
 * hech qachon bo'lmasligi kerak — `--apply` flagi ham ataylab YO'Q. Shu sabab
 * jonli bazada istalgan payt, savdo ustida ham xavfsiz yugurtiriladi.
 *
 * Nima qiladi:
 *   1. jonli holatni o'lchaydi (omborlar, yacheyka/zona, qoldiq kesimi,
 *      POS kaskadi, ochiq smenalar, split holati);
 *   2. `docs/ops/jonli-holat.md` reyestri bilan solishtiradi;
 *   3. farq bo'lsa aniq ro'yxat chiqarib CHIQISH KODI 2 beradi.
 *
 * Eng muhim qatori — **«POS yeta olmaydigan qoldiq»**: 2026-08-24 06:46 da
 * kassani to'xtatgan holatning o'lchovi. BRAK ombori (G3) ataylab ISTISNO —
 * u yerdagi qoldiq POS uchun yopiq bo'lishi KERAK.
 *
 * Yuritish (packages/db ichidan):
 *   npx tsx scripts/warehouse-state.ts              # jadval + reyestr farqi
 *   npx tsx scripts/warehouse-state.ts --json       # mashina uchun
 *   npx tsx scripts/warehouse-state.ts --no-registry  # faqat o'lchov, farqsiz
 *
 * Deploy retseptida: ombor/qoldiq/kassaga tegadigan har deploy'dan KEYIN
 * yugurtiriladi va natijasi faza hisobotiga kiritiladi (F-reja qoida 13).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../src/generated/index.js';
import {
  type Drift,
  type WarehouseStateReport,
  buildWarehouseState,
  diffAgainstRegistry,
  exitCodeFor,
  parseRegistry,
  pieceStateDrifts,
} from './warehouse-state-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(HERE, '..', '..', '..', 'docs', 'ops', 'jonli-holat.md');

/** tsx .env yuklamaydi — packages/db/.env dan DATABASE_URL o'qiladi. */
function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  try {
    const raw = readFileSync(join(HERE, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*(?:#.*)?$/.exec(line);
      if (m?.[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? '').trim();
    }
  } catch {
    // .env yo'q — DATABASE_URL muhitda talab qilinadi
  }
}

function dbHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '?';
  }
}

const args = new Set(process.argv.slice(2));
const AS_JSON = args.has('--json');
const NO_REGISTRY = args.has('--no-registry');

loadEnv();
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL topilmadi (packages/db/.env yoki muhitda bo‘lishi kerak)');
  process.exit(1);
}
const host = dbHost(DB_URL);
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

const prisma = new PrismaClient({ log: ['error'] });

async function readAccount(accountId: string): Promise<WarehouseStateReport> {
  const [stores, cells, storeStock, cellStock, sessions, trackedProducts, pieceBuckets] =
    await Promise.all([
      prisma.store.findMany({
        where: { accountId },
        select: { id: true, name: true, archived: true, attributes: true },
      }),
      prisma.storeCell.findMany({
        where: { accountId },
        select: { id: true, storeId: true, zoneId: true, name: true },
      }),
      prisma.stock.groupBy({
        by: ['storeId'],
        where: { accountId },
        _sum: { qty: true },
      }),
      prisma.stockByCell.groupBy({
        by: ['storeId'],
        where: { accountId },
        _sum: { qty: true },
      }),
      prisma.cashierSession.groupBy({
        by: ['storeId'],
        where: { accountId, state: 'open' },
        _count: { _all: true },
      }),
      // J1 — K-reja bo'lak sverkasi. Ikkalasi ham FAQAT O'QISH.
      prisma.product.findMany({
        where: { accountId, pieceTracked: true },
        select: { id: true, name: true },
      }),
      // `groupBy` ATAYLAB `findMany` o'rniga: reyestr to'lganda ham so'rov
      // bo'g'inlar soni bilan chegaralanadi, qatorlar soni bilan emas.
      prisma.stockPiece.groupBy({
        by: ['storeId', 'cellId', 'assortmentKind', 'assortmentId'],
        where: { accountId, status: 'active' },
        _sum: { length: true },
        _count: { _all: true },
      }),
    ]);

  // Bayroqli tovarlarning qoldiq kesimi — DOIRASI bayroq bilan CHEGARALANGAN
  // (bayroq yo'q ⇒ so'rov ham yo'q). Sverka faqat shu tovarlar uchun ma'noli.
  const trackedIds = trackedProducts.map((p) => p.id);
  const [trackedStoreStock, trackedCellStock] = trackedIds.length
    ? await Promise.all([
        prisma.stock.findMany({
          where: { accountId, assortmentKind: 'product', assortmentId: { in: trackedIds } },
          select: { storeId: true, assortmentKind: true, assortmentId: true, qty: true },
        }),
        prisma.stockByCell.findMany({
          where: { accountId, assortmentKind: 'product', assortmentId: { in: trackedIds } },
          select: {
            storeId: true,
            cellId: true,
            assortmentKind: true,
            assortmentId: true,
            qty: true,
          },
        }),
      ])
    : [[], []];

  return buildWarehouseState({
    stores,
    cells,
    storeStock: storeStock.map((r) => ({ storeId: r.storeId, qty: (r._sum.qty ?? 0).toString() })),
    cellStock: cellStock.map((r) => ({ storeId: r.storeId, qty: (r._sum.qty ?? 0).toString() })),
    openSessions: sessions.map((r) => ({ storeId: r.storeId, sessions: r._count._all })),
    trackedProducts,
    pieceBuckets: pieceBuckets.map((r) => ({
      storeId: r.storeId,
      cellId: r.cellId,
      assortmentKind: r.assortmentKind,
      assortmentId: r.assortmentId,
      qty: (r._sum.length ?? 0).toString(),
      pieces: r._count._all,
    })),
    trackedStoreStock: trackedStoreStock.map((r) => ({ ...r, qty: r.qty.toString() })),
    trackedCellStock: trackedCellStock.map((r) => ({ ...r, qty: r.qty.toString() })),
  });
}

// E5 — `needs_approval` yorlig'i («tasdiq kerak (G4 yo'q!)») OLIB TASHLANDI:
// G4-2a tasdiq-to'sig'ini o'chirdi, POS endi kaskadning hammasiga o'zi yetadi.
function reachLabel(reach: string): string {
  switch (reach) {
    case 'reachable':
      return 'POS SOTADI';
    case 'outside_cascade':
      return 'kaskadda YO‘Q';
    default:
      return 'BRAK (ataylab yopiq)';
  }
}

function printReport(accountId: string, report: WarehouseStateReport): void {
  console.log(`\n=== Akkaunt ${accountId} — jonli ombor holati ===`);
  console.log(
    [
      'Ombor',
      'pp',
      'yach.',
      'zona',
      'zonasiz',
      'ombor qoldiq',
      'yacheykada',
      'yacheykasiz',
      'smena',
      'POS',
    ].join(' | '),
  );
  for (const s of report.stores) {
    console.log(
      [
        s.name +
          (s.archived ? ' (arxiv)' : '') +
          (s.isUnassignedSource ? ' [hovuz]' : '') +
          // E5/(b) — «Kassa oldidagi ombor» taqsimot tartibini o'zgartiradi
          // (yolg'iz qoplasa birinchi, bo'linishda oxirgi), shuning uchun u
          // jadvalda KO'RINISHI kerak: bayroq jimgina yo'qolsa 07 bo'shab qoladi.
          (s.isPosFront ? ' [kassa oldi]' : ''),
        s.posPriority === null ? '—' : String(s.posPriority),
        String(s.cells),
        String(s.zones),
        String(s.cellsWithoutZone),
        s.storeQty,
        s.cellQty,
        s.unassignedQty,
        String(s.openSessions),
        reachLabel(s.reach),
      ].join(' | '),
    );
  }
  console.log(
    `\nJAMI: yacheyka ${report.totals.cells}, ombor qoldiq ${report.totals.storeQty}, ` +
      `yacheykalarda ${report.totals.cellQty}`,
  );
  console.log(
    `Kaskad: ${
      report.cascadeConfigured
        ? report.cascade.map((c) => `${c.posPriority}:${c.name}`).join(' → ')
        : 'SOZLANMAGAN (POS smena omboridan ishlaydi)'
    }`,
  );
  console.log(
    `Split: ${report.split.state} (mos ${report.split.matched}, mos emas ${report.split.mismatched}, ` +
      `kod o‘qilmadi ${report.split.unparsed}` +
      (report.split.missingStores.length
        ? `, yetishmayotgan ombor: ${report.split.missingStores.join(', ')}`
        : '') +
      ')',
  );
  console.log(`\n🔴 POS YETA OLMAYDIGAN QOLDIQ: ${report.unreachableQty} dona`);
  for (const u of report.unreachable) {
    console.log(`   · ${u.storeName}: ${u.qty} (${reachLabel(u.reach)})`);
  }
  printPieces(report);
}

/**
 * J1 — bo'lak sverkasi bandi. Qatorlar HAR DOIM chiqadi (hammasi 0 bo'lsa
 * ham): «o'lchandi va 0» bilan «umuman o'lchanmadi» ni ajratish shu
 * skriptning butun ma'nosi (IS-7).
 */
function printPieces(report: WarehouseStateReport): void {
  const p = report.pieces;
  console.log(
    `\nBO‘LAK REYESTRI (K-reja): bayroqli tovar ${p.trackedProducts} · ` +
      `faol bo‘lak ${p.activePieces} · farqli tovar ${p.diffProducts} ` +
      `(${p.diffBuckets} bo‘g‘in, jami ${p.diffQty})`,
  );
  if (p.piecesWithoutFlag > 0) {
    console.log(`   · bayroqsiz tovarda bo‘lak bor: ${p.piecesWithoutFlag}`);
  }
  if (p.flaggedWithoutRegistry > 0) {
    console.log(`   · bayroq YOQILGAN, reyestri bo‘sh (qoldig‘i bor): ${p.flaggedWithoutRegistry}`);
  }
  for (const r of p.rows) {
    console.log(
      `   · ${r.storeName}${r.cellName ? `/${r.cellName}` : ' (yacheykasiz)'} — ` +
        `${r.productName ?? r.assortmentId}: qoldiq ${r.stockQty}, reyestr ${r.registryQty}, ` +
        `farq ${r.diffQty} (${r.pieces} bo‘lak)`,
    );
  }
  if (p.truncated > 0) console.log(`   · … va yana ${p.truncated} bo‘g‘in ko‘rsatilmadi`);
}

function printDrifts(drifts: readonly Drift[]): void {
  if (drifts.length === 0) {
    console.log('\n✅ Reyestrga MOS — farq yo‘q.');
    return;
  }
  console.log('\n⚠️  FARQLAR (jonli holat reyestri + bo‘lak sverkasi):');
  for (const d of drifts) {
    console.log(`   [${d.severity}] ${d.code}: ${d.message}`);
  }
}

async function main(): Promise<void> {
  console.log(`Baza: ${host} (${isLocal ? 'lokal' : 'MASOFAVIY'}) — rejim: FAQAT O‘QISH`);

  const accounts = await prisma.store.findMany({
    select: { accountId: true },
    distinct: ['accountId'],
  });

  const registry = NO_REGISTRY ? null : parseRegistry(readFileSync(REGISTRY_PATH, 'utf8'));
  const payload: Array<{ accountId: string; report: WarehouseStateReport; drifts: Drift[] }> = [];

  for (const { accountId } of accounts) {
    const report = await readAccount(accountId);
    // J1 — bo'lak driftlari reyestrdan MUSTAQIL: ular `docs/ops/jonli-holat.md`
    // da e'lon qilinmaydi (bo'lak — TOVAR xossasi, ombor holati emas), lekin
    // `--no-registry` da ham ko'rinishi kerak. Hammasi `ogohlantirish` ⇒
    // chiqish kodiga TA'SIR QILMAYDI (`exitCodeFor` faqat `xato` ni sanaydi).
    const drifts = [
      ...(registry ? diffAgainstRegistry(report, registry) : []),
      ...pieceStateDrifts(report),
    ];
    payload.push({ accountId, report, drifts });
    if (!AS_JSON) {
      printReport(accountId, report);
      if (registry || drifts.length > 0) printDrifts(drifts);
    }
  }

  if (AS_JSON) console.log(JSON.stringify(payload, null, 2));

  const code = exitCodeFor(payload.flatMap((p) => p.drifts));
  if (code !== 0) {
    console.error('\nJonli holat reyestrdan CHETDA — chiqish kodi 2.');
  }
  process.exitCode = code;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
