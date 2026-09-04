import { randomUUID } from 'node:crypto';
/**
 * F4 — ombor-split migratsiya CLI (2026-08-23 ombor-restrukturizatsiya rejasi).
 *
 * «Bitta Store» holatidan «har fizik ombor alohida Store» holatiga o'tkazadi:
 *   - yacheyka kodi prefiksi (NN-…) bo'yicha «Ombor NN» Store'larini yaratadi;
 *   - StoreCell + zonalarni (zona = stelaj, kodning 2-segmenti) o'z omboriga
 *     ko'chiradi; eski chalkash/bo'sh zonalar manba omborda o'chiriladi;
 *   - StockByCell qatorlari yacheykasi bilan birga ketadi;
 *   - har ko'chgan miqdor uchun Stock (ombor jami) siljiydi va ledger'ga
 *     (`stock_operations`, docType='warehouse_split') juft yozuv beriladi —
 *     manbadan chiqim, maqsadga kirim; JAMI o'zgarmasligi INVARIANT;
 *   - yacheykasiz qoldiq eski Store'da qoladi, Store «Taqsimlanmagan» deb
 *     qayta nomlanadi (id O'ZGARMAYDI — hujjatlar/sozlamalar buzilmaydi).
 *
 * Yuritish (packages/db ichidan):
 *   npx tsx scripts/warehouse-split.ts             # DRY-RUN (hech nima yozmaydi)
 *   npx tsx scripts/warehouse-split.ts --apply     # yozadi (faqat localhost)
 *   npx tsx scripts/warehouse-split.ts --verify    # invariant tekshiruvlar
 *   ... --apply --allow-remote                     # F5: jonli bazada, ONGLI ravishda
 *   ... --only 01                                  # M6/2: bir kechada BITTA ombor
 *   ... --i-know-what-i-am-doing                   # M6/1 qo'riqchisini chetlab o'tish
 *
 * 🔴 M6/1 QO'RIQCHI: `--apply` split'dan keyin kassa YETA OLMAYDIGAN qoldiq
 * qolsa RAD ETILADI (prioritetsiz yangi ombor · `__posPriority` yo'q ombor ·
 * BRAK ombori). Hisobot DRY-RUN da ham chiqadi.
 *
 * Idempotent: ikkinchi yugurishda reja bo'sh (yacheykalar allaqachon o'z
 * omborida) — hech qanday yozuv bo'lmaydi.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '../src/generated/index.js';
import {
  type ReachabilityReport,
  type SplitPlan,
  type TargetStoreState,
  UNALLOCATED_STORE_NAME,
  buildSplitPlan,
  checkPosReachability,
  countPieceMoves,
  filterPlanTo,
  formatDecimalScaled,
  parseDecimalScaled,
  storeNameFor,
  warehouseNosIn,
} from './warehouse-split-core.js';

// ---------------------------------------------------------------------------
// Env va himoya
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

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
    // .env yo'q — DATABASE_URL talab qilinadi (pastda xato beradi)
  }
}

function dbHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '?';
  }
}

const argv = process.argv.slice(2);
const args = new Set(argv);
const APPLY = args.has('--apply');
/**
 * M6/2 — «bir kechada BITTA ombor». `--only 01` yoki `--only 01,02`
 * (takrorlanishi ham mumkin). Bo'sh = HAMMASI (eski xulq bayt-baytga).
 */
const ONLY = new Set(
  argv
    .flatMap((a, i) => (a === '--only' ? (argv[i + 1] ?? '').split(',') : []))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.padStart(2, '0')),
);
const VERIFY_ONLY = args.has('--verify');
const ALLOW_REMOTE = args.has('--allow-remote');
/**
 * M6/1 — POS-yetuvchanlik qo'riqchisini ONGLI ravishda chetlab o'tish.
 * Bu flagsiz «split'dan keyin kassa yeta olmaydigan qoldiq» topilsa `--apply`
 * RAD ETILADI (2026-08-23 hodisasining takrorlanishini shu to'sib turadi).
 */
const FORCE_UNREACHABLE = args.has('--i-know-what-i-am-doing');

loadEnv();
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL topilmadi (packages/db/.env yoki muhitda bo‘lishi kerak)');
  process.exit(1);
}
const host = dbHost(DB_URL);
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
if (APPLY && !isLocal && !ALLOW_REMOTE) {
  console.error(
    `XAVFSIZLIK: baza hosti «${host}» lokal emas. Jonli bazaga yozish F4 da TAQIQLANGAN.\n` +
      "F5 (jonli split) uchun ONGLI ravishda --allow-remote flagini qo'shing.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ log: ['error', 'warn'] });

const DOC_TYPE = 'warehouse_split';
const D = (s: string) => new Prisma.Decimal(s);

// ---------------------------------------------------------------------------
// O'qish
// ---------------------------------------------------------------------------

async function readAccountData(accountId: string) {
  const [stores, cells, stockByCell, stocks, pieces] = await Promise.all([
    prisma.store.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        archived: true,
        shared: true,
        allowNegativeStock: true,
        ownerId: true,
        groupId: true,
        code: true,
        // M6/1 — `__posPriority` / `__brakStore` qo'riqchi uchun (pastda).
        attributes: true,
      },
    }),
    prisma.storeCell.findMany({
      where: { accountId },
      select: { id: true, storeId: true, name: true, zoneId: true },
    }),
    prisma.stockByCell.findMany({
      where: { accountId },
      select: {
        storeId: true,
        cellId: true,
        assortmentKind: true,
        assortmentId: true,
        qty: true,
      },
    }),
    prisma.stock.findMany({
      where: { accountId },
      select: {
        storeId: true,
        assortmentKind: true,
        assortmentId: true,
        qty: true,
        costBalanceMinor: true,
      },
    }),
    // J1 — K-reja bo'lak reyestri. Yacheykasiz bo'laklar ham o'qiladi (yadro
    // ularni o'zi chetlab o'tadi), chunki «nega ko'chmadi?» savolining javobi
    // ham shu ma'lumotdan chiqadi.
    prisma.stockPiece.findMany({
      where: { accountId },
      select: {
        id: true,
        storeId: true,
        cellId: true,
        assortmentKind: true,
        assortmentId: true,
        status: true,
      },
    }),
  ]);
  return {
    stores,
    cells,
    stockByCell: stockByCell.map((r) => ({ ...r, qty: r.qty.toString() })),
    stocks: stocks.map((r) => ({ ...r, qty: r.qty.toString() })),
    pieces,
  };
}

/** Butun akkaunt bo'yicha (kind,id) → {qtyMicro, costMinor, reservedMicro}. */
async function snapshotTotals(accountId: string) {
  const rows = await prisma.stock.findMany({
    where: { accountId },
    select: {
      assortmentKind: true,
      assortmentId: true,
      qty: true,
      reservedQty: true,
      costBalanceMinor: true,
    },
  });
  const map = new Map<string, { qty: bigint; cost: bigint; reserved: bigint }>();
  for (const r of rows) {
    const key = `${r.assortmentKind}|${r.assortmentId}`;
    const cur = map.get(key) ?? { qty: 0n, cost: 0n, reserved: 0n };
    cur.qty += parseDecimalScaled(r.qty.toString());
    cur.cost += r.costBalanceMinor;
    cur.reserved += parseDecimalScaled(r.reservedQty.toString());
    map.set(key, cur);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Hisobot chiqarish
// ---------------------------------------------------------------------------

function printPlan(accountId: string, plan: SplitPlan, storeNames: Map<string, string>): void {
  console.log(`\n=== Akkaunt ${accountId} — split rejasi ===`);
  if (plan.cellMoves.length === 0) {
    console.log('Ko‘chiriladigan yacheyka YO‘Q — bu akkaunt uchun split no-op.');
  } else {
    console.log(
      `Yaratiladigan omborlar: ${
        plan.warehousesNeeded.length
          ? plan.warehousesNeeded.map(storeNameFor).join(', ')
          : '(hammasi mavjud)'
      }`,
    );
    console.log('Ombor kesimi (yacheyka / zona / qator / dona / qiymat so‘mda):');
    for (const s of plan.summary) {
      const sum = (s.costMinor / 100n).toString();
      console.log(
        `  ${storeNameFor(s.warehouseNo)}: ${s.cells} yacheyka, ${s.zones} zona, ` +
          `${s.sbcRows} qator, ${s.qty} dona, ${sum} so‘m tannarx`,
      );
    }
    const totalQty = plan.summary.reduce((a, s) => a + parseDecimalScaled(s.qty), 0n);
    const totalCost = plan.summary.reduce((a, s) => a + s.costMinor, 0n);
    console.log(
      `  JAMI: ${plan.cellMoves.length} yacheyka, ${plan.qtyMoves.length} qator, ` +
        `${formatDecimalScaled(totalQty)} dona, ${(totalCost / 100n).toString()} so‘m`,
    );
    console.log(
      `Manba omborlar: ${plan.sourceStoreIds
        .map((id) => `«${storeNames.get(id) ?? id}»`)
        .join(', ')} → «${UNALLOCATED_STORE_NAME}» deb qayta nomlanadi`,
    );
  }
  // J1 — bo'lak reyestri qatori HAR DOIM chiqadi (0 bo'lsa ham): reyestr
  // bo'shligini KO'RSATISH ham natija, uni jim o'tkazib yuborish esa aynan
  // T1 qarzining ildizi edi.
  const pieces = countPieceMoves(plan.pieceMoves);
  console.log(
    `Bo‘lak reyestri (K-reja): ${pieces.total} bo‘lak ko‘chadi (faol ${pieces.active})` +
      (pieces.total > 0
        ? ` — ${plan.summary
            .filter((s) => s.pieces > 0)
            .map((s) => `${storeNameFor(s.warehouseNo)}: ${s.pieces} (faol ${s.activePieces})`)
            .join(', ')}`
        : ''),
  );
  if (plan.anomalies.length) {
    console.log(`Anomaliyalar (${plan.anomalies.length}):`);
    for (const a of plan.anomalies) console.log(`  [${a.kind}] ${a.detail}`);
  }
}

// ---------------------------------------------------------------------------
// M6/1 — POS-yetuvchanlik qo'riqchisi
// ---------------------------------------------------------------------------

/**
 * `Store.attributes` → maqsad ombor holati (ombor NOMI bo'yicha).
 *
 * Kalitlar `apps/api` dagi `readPosPriority` / `readBrakStore` bilan AYNI
 * qat'iylikda o'qiladi — aks holda qo'riqchi kassadan boshqa javob berardi va
 * «yashil» chiqib turib savdoni to'xtatgan bo'lardi.
 */
function targetStoreStates(
  stores: Awaited<ReturnType<typeof readAccountData>>['stores'],
): Map<string, TargetStoreState> {
  const out = new Map<string, TargetStoreState>();
  for (const s of stores) {
    if (s.archived) continue;
    const attrs =
      s.attributes && typeof s.attributes === 'object' && !Array.isArray(s.attributes)
        ? (s.attributes as Record<string, unknown>)
        : {};
    const pp = attrs.__posPriority;
    out.set(s.name, {
      posPriority: typeof pp === 'number' && Number.isInteger(pp) && pp > 0 ? pp : null,
      isBrak: attrs.__brakStore === true,
    });
  }
  return out;
}

/** Qo'riqchi hisoboti. `false` qaytsa `--apply` davom etmasligi kerak. */
function printReachability(report: ReachabilityReport): boolean {
  if (report.emptyButUnreachable.length > 0) {
    console.log(
      `\n⚠ Prioritetsiz tug‘iladigan (hozircha qoldiqsiz) ombor: ${report.emptyButUnreachable.join(
        ', ',
      )} — unga tushgan BIRINCHI tovar sotilmaydi.`,
    );
  }
  if (report.rows.length === 0) {
    console.log('\nPOS yeta olmaydigan qoldiq: 0 — split kassa uchun xavfsiz.');
    return true;
  }
  console.log(`\n🔴 SPLIT’DAN KEYIN POS YETA OLMAYDIGAN QOLDIQ: ${report.totalQty} dona`);
  for (const r of report.rows) {
    console.log(`  ${r.storeName}: ${r.qty} dona, ${r.cells} yacheyka — sabab: ${r.reason}`);
  }
  console.log(
    '  Kassa faqat `__posPriority` bor va BRAK bo‘lmagan omborni ko‘radi\n' +
      '  (retail-allocation.resolveAllocStores). 2026-08-23 da aynan shu savdoni 46 daqiqa to‘xtatgan.\n' +
      '  DAVO: o‘sha omborni UI da yarating/oching, POS prioritetini qo‘ying, so‘ng skriptni QAYTA yuriting.',
  );
  return false;
}

// ---------------------------------------------------------------------------
// Qo'llash
// ---------------------------------------------------------------------------

async function applyPlan(
  accountId: string,
  plan: SplitPlan,
  stores: Awaited<ReturnType<typeof readAccountData>>['stores'],
): Promise<void> {
  if (plan.cellMoves.length === 0) return;
  const storeByName = new Map(stores.filter((s) => !s.archived).map((s) => [s.name, s]));
  const storeById = new Map(stores.map((s) => [s.id, s]));
  // Sozlamalar namunasi — asosiy manba ombor (eng ko'p yacheyka yo'qotayotgani).
  const srcCounts = new Map<string, number>();
  for (const m of plan.cellMoves)
    srcCounts.set(m.fromStoreId, (srcCounts.get(m.fromStoreId) ?? 0) + 1);
  const mainSourceId = [...srcCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const mainSource = storeById.get(mainSourceId)!;

  // 1) Kerakli Store'lar (tranzaksiyadan tashqari — har biri kichik yozuv).
  const targetIdByNo = new Map<string, string>();
  for (const no of new Set(plan.cellMoves.map((m) => m.warehouseNo))) {
    const name = storeNameFor(no);
    const existing = storeByName.get(name);
    if (existing) {
      targetIdByNo.set(no, existing.id);
      continue;
    }
    const codeTaken = stores.some((s) => s.code === no);
    const created = await prisma.store.create({
      data: {
        accountId,
        name,
        code: codeTaken ? null : no,
        shared: mainSource.shared,
        allowNegativeStock: mainSource.allowNegativeStock,
        ownerId: mainSource.ownerId,
        groupId: mainSource.groupId,
        description: `F4 ombor-split (${DOC_TYPE}) yaratdi`,
      },
      select: { id: true },
    });
    targetIdByNo.set(no, created.id);
    console.log(`+ Store «${name}» yaratildi (${created.id})`);
  }

  // 2) Har ombor — alohida tranzaksiya (atomar, lekin qulf qisqa).
  for (const no of [...new Set(plan.cellMoves.map((m) => m.warehouseNo))].sort()) {
    const targetId = targetIdByNo.get(no)!;
    const cellMoves = plan.cellMoves.filter((m) => m.warehouseNo === no);
    const qtyMoves = plan.qtyMoves.filter((m) => m.warehouseNo === no);
    const piecesForThisWarehouse = plan.pieceMoves.filter((m) => m.warehouseNo === no);
    const docId = randomUUID();

    await prisma.$transaction(
      async (tx) => {
        // 2a) Zonalar (zona = stelaj, nomi «SS»).
        const zoneIdByName = new Map<string, string>();
        for (const zoneName of [
          ...new Set(cellMoves.map((m) => m.zoneName).filter(Boolean)),
        ] as string[]) {
          const zone = await tx.storeZone.upsert({
            where: { storeId_name: { storeId: targetId, name: zoneName } },
            create: {
              accountId,
              storeId: targetId,
              name: zoneName,
              sortOrder: Number(zoneName),
            },
            update: {},
            select: { id: true },
          });
          zoneIdByName.set(zoneName, zone.id);
        }

        // 2b) Yacheykalar + ularning StockByCell qatorlari.
        for (const m of cellMoves) {
          await tx.storeCell.update({
            where: { id: m.cellId },
            data: {
              storeId: targetId,
              zoneId: m.zoneName ? (zoneIdByName.get(m.zoneName) ?? null) : null,
            },
          });
          await tx.stockByCell.updateMany({
            where: { accountId, cellId: m.cellId, storeId: m.fromStoreId },
            data: { storeId: targetId },
          });
        }

        // 2b) K-reja bo'lak reyestri — AYNI tranzaksiyada (J1). Yacheyka bir
        //     omborda, bo'lagi boshqasida qolsa sverka ikkala tomonda ham
        //     farq berardi. `id` bo'yicha yoziladi: reja qaysi qatorlarni
        //     ko'chirishini o'zi hal qilgan (yacheykasizlar TEGILMAYDI).
        if (piecesForThisWarehouse.length > 0) {
          const res = await tx.stockPiece.updateMany({
            where: { accountId, id: { in: piecesForThisWarehouse.map((p) => p.pieceId) } },
            data: { storeId: targetId },
          });
          if (res.count !== piecesForThisWarehouse.length) {
            throw new Error(
              `Bo‘lak ko‘chishi to‘liq emas: kutilgan ${piecesForThisWarehouse.length}, ` +
                `yozildi ${res.count} — ROLLBACK`,
            );
          }
        }

        // 2c) Stock siljishlari — (manba, assortiment) bo'yicha jamlangan.
        const agg = new Map<
          string,
          { fromStoreId: string; kind: string; id: string; qty: bigint; cost: bigint }
        >();
        for (const q of qtyMoves) {
          const key = `${q.fromStoreId}|${q.assortmentKind}|${q.assortmentId}`;
          const cur = agg.get(key) ?? {
            fromStoreId: q.fromStoreId,
            kind: q.assortmentKind,
            id: q.assortmentId,
            qty: 0n,
            cost: 0n,
          };
          cur.qty += parseDecimalScaled(q.qty);
          cur.cost += q.costMinor;
          agg.set(key, cur);
        }
        for (const a of agg.values()) {
          const qtyStr = formatDecimalScaled(a.qty);
          await tx.stock.upsert({
            where: {
              accountId_storeId_assortmentKind_assortmentId: {
                accountId,
                storeId: a.fromStoreId,
                assortmentKind: a.kind,
                assortmentId: a.id,
              },
            },
            create: {
              accountId,
              storeId: a.fromStoreId,
              assortmentKind: a.kind,
              assortmentId: a.id,
              qty: D(formatDecimalScaled(-a.qty)),
              costBalanceMinor: -a.cost,
            },
            update: {
              qty: { decrement: D(qtyStr) },
              costBalanceMinor: { decrement: a.cost },
            },
          });
          await tx.stock.upsert({
            where: {
              accountId_storeId_assortmentKind_assortmentId: {
                accountId,
                storeId: targetId,
                assortmentKind: a.kind,
                assortmentId: a.id,
              },
            },
            create: {
              accountId,
              storeId: targetId,
              assortmentKind: a.kind,
              assortmentId: a.id,
              qty: D(qtyStr),
              costBalanceMinor: a.cost,
            },
            update: {
              qty: { increment: D(qtyStr) },
              costBalanceMinor: { increment: a.cost },
            },
          });
        }

        // 2d) Ledger — halol juft yozuv, yacheyka darajasida.
        await tx.stockOperation.createMany({
          data: qtyMoves.flatMap((q) => [
            {
              accountId,
              storeId: q.fromStoreId,
              assortmentKind: q.assortmentKind,
              assortmentId: q.assortmentId,
              cellId: q.cellId,
              qtyDelta: D(formatDecimalScaled(-parseDecimalScaled(q.qty))),
              costDeltaMinor: -q.costMinor,
              docType: DOC_TYPE,
              docId,
              reason: 'post',
              createdById: null,
            },
            {
              accountId,
              storeId: targetId,
              assortmentKind: q.assortmentKind,
              assortmentId: q.assortmentId,
              cellId: q.cellId,
              qtyDelta: D(q.qty),
              costDeltaMinor: q.costMinor,
              docType: DOC_TYPE,
              docId,
              reason: 'post',
              createdById: null,
            },
          ]),
        });
      },
      { isolationLevel: 'Serializable', timeout: 180_000 },
    );
    console.log(
      `✓ ${storeNameFor(no)}: ${cellMoves.length} yacheyka, ${qtyMoves.length} qator, ` +
        `${piecesForThisWarehouse.length} bo‘lak ko‘chdi (docId ${docId})`,
    );
  }

  // 3) Manba omborlarni «Taqsimlanmagan» deb qayta nomlash + bo'sh zonalarni
  //    tozalash. Crash-resilient: nomzodlar = shu yugurish manbalari ∪ ledger'da
  //    split-chiqimi bor Store'lar.
  const ledgerSources = await prisma.stockOperation.findMany({
    where: { accountId, docType: DOC_TYPE, qtyDelta: { lt: 0 } },
    select: { storeId: true },
    distinct: ['storeId'],
  });
  const candidates = new Set([...plan.sourceStoreIds, ...ledgerSources.map((r) => r.storeId)]);
  for (const storeId of candidates) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    });
    if (!store) continue;
    if (/^Ombor \d{2}$/.test(store.name) || store.name === UNALLOCATED_STORE_NAME) continue;
    await prisma.store.update({
      where: { id: storeId },
      data: { name: UNALLOCATED_STORE_NAME },
    });
    console.log(
      `✎ Store «${store.name}» → «${UNALLOCATED_STORE_NAME}» (id o‘zgarmadi: ${storeId})`,
    );
  }
  for (const storeId of candidates) {
    const emptyZones = await prisma.storeZone.findMany({
      where: { storeId, cells: { none: {} } },
      select: { id: true, name: true },
    });
    if (emptyZones.length) {
      await prisma.storeZone.deleteMany({ where: { id: { in: emptyZones.map((z) => z.id) } } });
      console.log(
        `🧹 «${storeById.get(storeId)?.name ?? storeId}»: ${emptyZones.length} bo‘sh zona o‘chirildi`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Invariant tekshiruvlar
// ---------------------------------------------------------------------------

async function verify(accountId: string): Promise<boolean> {
  let ok = true;
  console.log(`\n--- Invariantlar (akkaunt ${accountId}) ---`);

  // V1: har StockByCell qatorining storeId'si o'z yacheykasining storeId'siga teng.
  const mismatch = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n
    FROM stock_by_cell sbc JOIN store_cells c ON c.id = sbc.cell_id
    WHERE sbc.account_id = ${accountId}::uuid AND sbc.store_id <> c.store_id`;
  const v1 = mismatch[0]?.n ?? 0n;
  console.log(`V1 sbc.storeId == cell.storeId: ${v1 === 0n ? 'OK' : `XATO (${v1} qator)`}`);
  if (v1 !== 0n) ok = false;

  // V2: warehouse_split ledger har assortiment bo'yicha nolga yig'iladi (qty ham cost ham).
  const unbalanced = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM (
      SELECT assortment_kind, assortment_id
      FROM stock_operations
      WHERE account_id = ${accountId}::uuid AND doc_type = ${DOC_TYPE}
      GROUP BY 1, 2
      HAVING sum(qty_delta) <> 0 OR coalesce(sum(cost_delta_minor), 0) <> 0
    ) t`;
  const v2 = unbalanced[0]?.n ?? 0n;
  console.log(`V2 split-ledger Σ==0 (qty, cost): ${v2 === 0n ? 'OK' : `XATO (${v2} assortiment)`}`);
  if (v2 !== 0n) ok = false;

  // V3: «Ombor NN» store'larda Σyacheyka == Stock.qty (yangi omborlarda faqat
  //     yacheykali qoldiq bor); boshqa store'larda Σyacheyka ≤ Stock (axborot).
  const v3rows = await prisma.$queryRaw<Array<{ name: string; bad: bigint }>>`
    SELECT s.name, count(*)::bigint AS bad FROM (
      SELECT sbc.store_id, sbc.assortment_kind, sbc.assortment_id, sum(sbc.qty) AS cell_qty
      FROM stock_by_cell sbc
      WHERE sbc.account_id = ${accountId}::uuid
      GROUP BY 1, 2, 3
    ) g
    JOIN stores s ON s.id = g.store_id
    LEFT JOIN stocks st ON st.account_id = ${accountId}::uuid
      AND st.store_id = g.store_id
      AND st.assortment_kind = g.assortment_kind AND st.assortment_id = g.assortment_id
    WHERE s.name ~ '^Ombor [0-9]{2}$' AND g.cell_qty <> coalesce(st.qty, 0)
    GROUP BY s.name`;
  if (v3rows.length === 0) console.log('V3 «Ombor NN»da Σyacheyka == Stock: OK');
  else {
    ok = false;
    for (const r of v3rows) console.log(`V3 XATO: «${r.name}» — ${r.bad} assortimentda farq`);
  }

  // V4 (J1): yacheykali bo'lakning ombori — o'z yacheykasiniki. V1 ning bo'lak
  // varianti. Buzilsa K1 sverkasi eski omborda «yo'qolgan», yangisida
  // «ortiqcha» beradi va farqning sababi hech qayerdan ko'rinmaydi.
  const pieceMismatch = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n
    FROM stock_pieces p JOIN store_cells c ON c.id = p.cell_id
    WHERE p.account_id = ${accountId}::uuid AND p.store_id <> c.store_id`;
  const v4 = pieceMismatch[0]?.n ?? 0n;
  console.log(`V4 piece.storeId == cell.storeId: ${v4 === 0n ? 'OK' : `XATO (${v4} bo‘lak)`}`);
  if (v4 !== 0n) ok = false;

  return ok;
}

function compareSnapshots(
  before: Map<string, { qty: bigint; cost: bigint; reserved: bigint }>,
  after: Map<string, { qty: bigint; cost: bigint; reserved: bigint }>,
): boolean {
  let ok = true;
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const b = before.get(key) ?? { qty: 0n, cost: 0n, reserved: 0n };
    const a = after.get(key) ?? { qty: 0n, cost: 0n, reserved: 0n };
    if (b.qty !== a.qty || b.cost !== a.cost || b.reserved !== a.reserved) {
      ok = false;
      console.log(
        `V0 XATO ${key}: qty ${formatDecimalScaled(b.qty)}→${formatDecimalScaled(a.qty)}, ` +
          `cost ${b.cost}→${a.cost}, rezerv ${formatDecimalScaled(b.reserved)}→${formatDecimalScaled(a.reserved)}`,
      );
    }
  }
  console.log(
    `V0 JAMI qoldiq/qiymat/rezerv o‘zgarmadi (${keys.size} assortiment): ${ok ? 'OK' : 'XATO'}`,
  );
  return ok;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Baza: ${host} (${isLocal ? 'lokal' : 'MASOFAVIY'}) — rejim: ${
      VERIFY_ONLY ? 'VERIFY' : APPLY ? 'APPLY' : 'DRY-RUN'
    }`,
  );

  const accounts = await prisma.store.findMany({
    select: { accountId: true },
    distinct: ['accountId'],
  });

  let allOk = true;
  for (const { accountId } of accounts) {
    if (VERIFY_ONLY) {
      if (!(await verify(accountId))) allOk = false;
      continue;
    }

    const data = await readAccountData(accountId);
    const fullPlan = buildSplitPlan(data);
    // M6/2 — «bir kechada BITTA ombor». `--only` siz xulq o'zgarmaydi.
    const plan = filterPlanTo(fullPlan, ONLY);
    if (ONLY.size > 0) {
      console.log(
        `\n--only: ${[...ONLY].sort().map(storeNameFor).join(', ')} ` +
          `(rejadagi hammasi: ${warehouseNosIn(fullPlan).map(storeNameFor).join(', ') || '—'})`,
      );
    }
    const storeNames = new Map(data.stores.map((s) => [s.id, s.name]));
    printPlan(accountId, plan, storeNames);

    // M6/1 — qo'riqchi DRY-RUN da ham chiqadi: reja ko'rilayotgan paytda
    // «bu split kassani to'xtatadimi?» degan savol javobsiz qolmasin.
    const reachable = printReachability(checkPosReachability(plan, targetStoreStates(data.stores)));

    if (!APPLY) continue;
    if (plan.cellMoves.length === 0) {
      console.log('APPLY: qiladigan ish yo‘q (no-op).');
      continue;
    }
    if (!reachable && !FORCE_UNREACHABLE) {
      console.error(
        '\nAPPLY RAD ETILDI: split qoldiqni kassa yeta olmaydigan omborga ko‘chirardi.\n' +
          'Omborga POS prioriteti qo‘yilgach qayta yuriting, yoki oqibatini bilib turib\n' +
          '--i-know-what-i-am-doing flagini qo‘shing.',
      );
      allOk = false;
      continue;
    }
    if (!reachable) {
      console.log('⚠ --i-know-what-i-am-doing: qo‘riqchi ONGLI ravishda chetlab o‘tildi.');
    }

    const before = await snapshotTotals(accountId);
    await applyPlan(accountId, plan, data.stores);
    const after = await snapshotTotals(accountId);
    if (!compareSnapshots(before, after)) allOk = false;
    if (!(await verify(accountId))) allOk = false;

    // Idempotentlik isboti: qayta qurilgan reja bo'sh bo'lishi shart.
    // `--only` da faqat KO'CHIRILGAN omborlar bo'yicha — tegilmagan omborlar
    // rejada qolishi TABIIY (ular keyingi kecha ko'chadi).
    const again = filterPlanTo(buildSplitPlan(await readAccountData(accountId)), ONLY);
    const idem = again.cellMoves.length === 0 && again.qtyMoves.length === 0;
    console.log(`Idempotentlik (qayta reja bo‘sh): ${idem ? 'OK' : 'XATO'}`);
    if (!idem) allOk = false;
  }

  await prisma.$disconnect();
  if (!allOk) {
    console.error('\nYAKUN: invariantlarda XATO bor — yuqoridagi qatorlarni ko‘ring.');
    process.exit(2);
  }
  console.log('\nYAKUN: OK');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
