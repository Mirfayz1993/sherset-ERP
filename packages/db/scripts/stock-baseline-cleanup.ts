/**
 * H5 (2026-08-24 split-kassa hodisasi) — soxta «mashq» qoldig'ini bosqichma-bosqich
 * hisobdan chiqarish CLI.
 *
 * Egasi bilan kelishilgan usul: sanash davom etadi; sanab bo'lingan tovarlarning
 * YACHEYKASIZ ortiqchasi muntazam (kechasi) hisobdan chiqariladi. Hali sanalmagan
 * tovar kassada eski son bilan sotilaveradi — savdo TO'XTAMAYDI.
 *
 * Yuritish (packages/db ichidan):
 *   npx tsx scripts/stock-baseline-cleanup.ts                    # DRY-RUN (default)
 *   npx tsx scripts/stock-baseline-cleanup.ts --apply            # lokal bazaga yozadi
 *   npx tsx scripts/stock-baseline-cleanup.ts --apply --allow-remote   # JONLI baza
 *   npx tsx scripts/stock-baseline-cleanup.ts --since 2026-08-25 # o'sha sanadan keyin sanalganlar
 *   npx tsx scripts/stock-baseline-cleanup.ts --band-min 0 --band-max 0   # oraliqni O'CHIRISH (ongli)
 *   npx tsx scripts/stock-baseline-cleanup.ts --revert <docId> --apply --allow-remote
 *
 * 🔴 QACHON: FAQAT savdo tugagach (ish soatidan tashqari). Kunduzi ombor jamisini
 * pasaytirish kassani to'xtatishi mumkin (F-reja qoida 13). Ertasi ertalab,
 * savdo boshlanishidan OLDIN: `warehouse-state.ts` + bitta sinov sotuv.
 *
 * Qaytarish (qoida 12): har yugurish BITTA `docId` yozadi va u chiqishda
 * ko'rsatiladi. `--revert <docId>` o'sha yugurishni AYNAN qaytaradi.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '../src/generated/index.js';
import {
  type BaselineRow,
  type CleanupOptions,
  type CleanupPlan,
  DEFAULT_BAND_MAX,
  DEFAULT_BAND_MIN,
  type SkipReason,
  WRITE_OFF_DOC_TYPE,
  WRITE_OFF_REVERT_DOC_TYPE,
  buildCleanupPlan,
  buildRevertPlan,
} from './stock-baseline-cleanup-core.js';

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

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
function optValue(name: string): string | null {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : null;
}

const APPLY = flags.has('--apply');
const ALLOW_REMOTE = flags.has('--allow-remote');
const AS_JSON = flags.has('--json');
const REVERT_DOC = optValue('--revert');
const SINCE = optValue('--since');
const BAND_MIN = optValue('--band-min') ?? DEFAULT_BAND_MIN;
const BAND_MAX = optValue('--band-max') ?? DEFAULT_BAND_MAX;
/** `--band-min 0 --band-max 0` = oraliqni ONGLI ravishda o'chirish. */
const BAND_OFF = BAND_MIN === '0' && BAND_MAX === '0';

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
    `XAVFSIZLIK: baza hosti «${host}» lokal emas. Jonli bazaga yozish uchun ONGLI ravishda --allow-remote flagini qo'shing (va FAQAT savdo tugagach yuriting).`,
  );
  process.exit(1);
}

const prisma = new PrismaClient({ log: ['error', 'warn'] });
const D = (s: string) => new Prisma.Decimal(s);

const OPTIONS: CleanupOptions = {
  bandMin: BAND_OFF ? null : BAND_MIN,
  bandMax: BAND_OFF ? null : BAND_MAX,
  since: SINCE,
  requireCell: true,
};

// ---------------------------------------------------------------------------
// O'qish
// ---------------------------------------------------------------------------

async function readRows(accountId: string): Promise<BaselineRow[]> {
  const [stores, stocks, cells, tracked] = await Promise.all([
    prisma.store.findMany({ where: { accountId }, select: { id: true, name: true } }),
    prisma.stock.findMany({
      where: { accountId },
      select: {
        storeId: true,
        assortmentKind: true,
        assortmentId: true,
        qty: true,
        reservedQty: true,
        costBalanceMinor: true,
      },
    }),
    prisma.stockByCell.groupBy({
      by: ['storeId', 'assortmentKind', 'assortmentId'],
      where: { accountId },
      _sum: { qty: true },
      _max: { updatedAt: true },
    }),
    // J1 — bo'lak hisobi yuritiladigan tovarlar. Bayroq FAQAT `Product` da
    // bo'ladi (variantlar bo'lak hisobidan tashqarida — K1 hisoboti).
    prisma.product.findMany({
      where: { accountId, pieceTracked: true },
      select: { id: true },
    }),
  ]);

  const trackedIds = new Set(tracked.map((p) => p.id));
  const storeNames = new Map(stores.map((s) => [s.id, s.name]));
  const key = (s: string, k: string, a: string) => `${s}|${k}|${a}`;
  const byCell = new Map(
    cells.map((c) => [
      key(c.storeId, c.assortmentKind, c.assortmentId),
      { qty: (c._sum.qty ?? 0).toString(), at: c._max.updatedAt?.toISOString() ?? null },
    ]),
  );

  return stocks.map((s) => {
    const hit = byCell.get(key(s.storeId, s.assortmentKind, s.assortmentId));
    return {
      storeId: s.storeId,
      storeName: storeNames.get(s.storeId) ?? '?',
      assortmentKind: s.assortmentKind,
      assortmentId: s.assortmentId,
      qty: s.qty.toString(),
      reservedQty: s.reservedQty.toString(),
      assignedQty: hit?.qty ?? '0',
      costBalanceMinor: BigInt(s.costBalanceMinor),
      countedAt: hit?.at ?? null,
      pieceTracked: s.assortmentKind === 'product' && trackedIds.has(s.assortmentId),
    };
  });
}

async function productNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.product.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------
// Chiqarish
// ---------------------------------------------------------------------------

const SKIP_LABEL: Record<SkipReason, string> = {
  'bolak-hisobi':
    'bo‘lak hisobi yuritiladi — qoldiqni BU SKRIPT kamaytira olmaydi (tuzatish inventarizatsiya orqali)',
  'ortiqcha-yoq': 'ortiqcha yo‘q',
  sanalmagan: 'hali sanalmagan (yacheykasi yo‘q)',
  'imzo-oraligidan-tashqarida': 'imzo-oralig‘idan tashqarida',
  'sanash-eski': '--since dan oldin sanalgan',
  'rezerv-toosiq': 'rezerv to‘sib turibdi',
};

async function printPlan(accountId: string, plan: CleanupPlan): Promise<void> {
  const names = await productNames(plan.lines.map((l) => l.assortmentId));
  console.log(`\n=== Akkaunt ${accountId} — soxta qoldiqni hisobdan chiqarish rejasi ===`);
  console.log(
    `Imzo-oralig‘i: ${BAND_OFF ? 'O‘CHIRILGAN (--band-min 0 --band-max 0)' : `${BAND_MIN}…${BAND_MAX}`}` +
      `${SINCE ? ` · faqat ${SINCE} dan keyin sanalganlar` : ''}`,
  );
  if (plan.lines.length === 0) {
    console.log('Qiladigan ish yo‘q (no-op).');
  } else {
    console.log('Ombor | Tovar | jami | yacheykada | rezerv | o‘chadi | qoladi');
    for (const l of plan.lines) {
      console.log(
        [
          l.storeName,
          names.get(l.assortmentId) ?? l.assortmentId,
          l.qty,
          l.assignedQty,
          l.reservedQty,
          l.writeOffQty + (l.cappedByReserve ? ' (rezerv bilan cheklandi)' : ''),
          l.newQty,
        ].join(' | '),
      );
    }
  }
  const bySkip = new Map<SkipReason, number>();
  for (const s of plan.skipped) bySkip.set(s.reason, (bySkip.get(s.reason) ?? 0) + 1);
  console.log(
    `\nJAMI: ${plan.totals.products} tovar · ${plan.totals.qty} dona · ` +
      `tannarx ${plan.totals.costMinor} tiyin`,
  );
  console.log(
    `Tegilmadi: ${[...bySkip.entries()].map(([r, n]) => `${SKIP_LABEL[r]} ${n}`).join(', ') || '—'}`,
  );
  // J1 — qator HAR DOIM chiqadi (0 bo'lsa ham): «bo'lak hisobi yuritiladigan
  // tovarga tegilmadi» degan fakt hisobotda ko'rinmasa, operator uni bilmasdi.
  console.log(
    `Bo‘lak reyestri (K-reja): ${bySkip.get('bolak-hisobi') ?? 0} qator RAD ETILDI ` +
      '(bo‘lak hisobi yuritiladigan tovar — qoldiq faqat inventarizatsiya bilan tuzatiladi)',
  );
}

// ---------------------------------------------------------------------------
// Yozish
// ---------------------------------------------------------------------------

async function applyPlan(accountId: string, plan: CleanupPlan, docId: string): Promise<number> {
  let written = 0;
  for (const l of plan.lines) {
    // Har satr O'Z tranzaksiyasida: kechasi yuradi, lekin savdo baribir
    // ochiq bo'lishi mumkin ⇒ balansni tranzaksiya ICHIDA qayta o'qib,
    // rejani o'sha tovar uchun QAYTA quramiz. Eskirgan raqam bilan yozish
    // qoldiqni yacheykalar yig'indisidan past tushirib yuborishi mumkin edi.
    const ok = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.stock.findUnique({
          where: {
            accountId_storeId_assortmentKind_assortmentId: {
              accountId,
              storeId: l.storeId,
              assortmentKind: l.assortmentKind,
              assortmentId: l.assortmentId,
            },
          },
          select: { qty: true, reservedQty: true, costBalanceMinor: true },
        });
        if (!fresh) return false;
        // 🔴 J1 — bayroq DRY va APPLY orasida yoqilgan bo'lishi mumkin (K6
        //    kartochkasidagi bitta tugma, deploy talab qilmaydi). Bayroqni
        //    tranzaksiya ICHIDA qayta o'qiymiz — aks holda skript endigina
        //    bo'lak hisobiga o'tgan tovarning qoldig'ini kamaytirib qo'yardi.
        const flagged =
          l.assortmentKind === 'product'
            ? ((
                await tx.product.findUnique({
                  where: { id: l.assortmentId },
                  select: { pieceTracked: true },
                })
              )?.pieceTracked ?? false)
            : false;
        const cellSum = await tx.stockByCell.aggregate({
          where: {
            accountId,
            storeId: l.storeId,
            assortmentKind: l.assortmentKind,
            assortmentId: l.assortmentId,
          },
          _sum: { qty: true },
        });
        const again = buildCleanupPlan(
          [
            {
              storeId: l.storeId,
              storeName: l.storeName,
              assortmentKind: l.assortmentKind,
              assortmentId: l.assortmentId,
              qty: fresh.qty.toString(),
              reservedQty: fresh.reservedQty.toString(),
              assignedQty: (cellSum._sum.qty ?? 0).toString(),
              costBalanceMinor: BigInt(fresh.costBalanceMinor),
              countedAt: null,
              pieceTracked: flagged,
            },
          ],
          // Qayta qurishda `--since` NI QO'LLAMAYMIZ: satr allaqachon saralangan,
          // bu yerda faqat miqdor/rezerv chegaralari qayta tekshiriladi.
          { ...OPTIONS, since: null },
        );
        const line = again.lines[0];
        if (!line) return false;

        await tx.stock.update({
          where: {
            accountId_storeId_assortmentKind_assortmentId: {
              accountId,
              storeId: line.storeId,
              assortmentKind: line.assortmentKind,
              assortmentId: line.assortmentId,
            },
          },
          data: {
            qty: { decrement: D(line.writeOffQty) },
            costBalanceMinor: { increment: line.costDeltaMinor },
          },
        });
        await tx.stockOperation.create({
          data: {
            accountId,
            storeId: line.storeId,
            assortmentKind: line.assortmentKind,
            assortmentId: line.assortmentId,
            // 🔴 cellId = null — StockByCell'ga TEGILMAYDI (yuqoridagi 1-qoida).
            cellId: null,
            qtyDelta: D(`-${line.writeOffQty}`),
            costDeltaMinor: line.costDeltaMinor,
            docType: WRITE_OFF_DOC_TYPE,
            docId,
            reason: 'post',
          },
        });
        return true;
      },
      { isolationLevel: 'Serializable', timeout: 20000 },
    );
    if (ok) written += 1;
  }
  return written;
}

async function revert(accountId: string, docId: string): Promise<void> {
  const rows = await prisma.stockOperation.findMany({
    where: { accountId, docType: WRITE_OFF_DOC_TYPE, docId },
    select: {
      storeId: true,
      assortmentKind: true,
      assortmentId: true,
      qtyDelta: true,
      costDeltaMinor: true,
    },
  });
  if (rows.length === 0) {
    console.log(`Bu docId bo‘yicha yozuv topilmadi: ${docId}`);
    return;
  }
  const already = await prisma.stockOperation.count({
    where: { accountId, docType: WRITE_OFF_REVERT_DOC_TYPE, docId },
  });
  if (already > 0) {
    console.error(`RAD ETILDI: ${docId} allaqachon qaytarilgan (${already} yozuv).`);
    process.exitCode = 1;
    return;
  }

  const plan = buildRevertPlan(
    rows.map((r) => ({
      storeId: r.storeId,
      assortmentKind: r.assortmentKind,
      assortmentId: r.assortmentId,
      qtyDelta: r.qtyDelta.toString(),
      costDeltaMinor: r.costDeltaMinor === null ? null : BigInt(r.costDeltaMinor),
    })),
  );
  console.log(`\n=== QAYTARISH: ${docId} — ${plan.length} qator ===`);
  for (const l of plan) {
    console.log(`${l.storeId} | ${l.assortmentId} | +${l.qtyDelta} | ${l.costDeltaMinor} tiyin`);
  }
  if (!APPLY) {
    console.log('\nDRY-RUN — hech nima yozilmadi. Yozish uchun --apply qo‘shing.');
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      for (const l of plan) {
        await tx.stock.update({
          where: {
            accountId_storeId_assortmentKind_assortmentId: {
              accountId,
              storeId: l.storeId,
              assortmentKind: l.assortmentKind,
              assortmentId: l.assortmentId,
            },
          },
          data: {
            qty: { increment: D(l.qtyDelta) },
            costBalanceMinor: { increment: l.costDeltaMinor },
          },
        });
        await tx.stockOperation.create({
          data: {
            accountId,
            storeId: l.storeId,
            assortmentKind: l.assortmentKind,
            assortmentId: l.assortmentId,
            cellId: null,
            qtyDelta: D(l.qtyDelta),
            costDeltaMinor: l.costDeltaMinor,
            docType: WRITE_OFF_REVERT_DOC_TYPE,
            docId,
            reason: 'cancel',
          },
        });
      }
    },
    { isolationLevel: 'Serializable', timeout: 60000 },
  );
  console.log(`QAYTARILDI: ${plan.length} qator tiklandi.`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Baza: ${host} (${isLocal ? 'lokal' : 'MASOFAVIY'}) — rejim: ${
      REVERT_DOC ? 'QAYTARISH' : APPLY ? 'APPLY' : 'DRY-RUN'
    }`,
  );

  const accounts = await prisma.store.findMany({
    select: { accountId: true },
    distinct: ['accountId'],
  });

  for (const { accountId } of accounts) {
    if (REVERT_DOC) {
      await revert(accountId, REVERT_DOC);
      continue;
    }

    const plan = buildCleanupPlan(await readRows(accountId), OPTIONS);
    if (AS_JSON) {
      console.log(
        JSON.stringify(
          {
            accountId,
            ...plan,
            totals: { ...plan.totals, costMinor: plan.totals.costMinor.toString() },
          },
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        ),
      );
    } else {
      await printPlan(accountId, plan);
    }

    if (!APPLY) {
      console.log('\nDRY-RUN — hech nima yozilmadi. Yozish uchun --apply qo‘shing.');
      continue;
    }
    if (plan.lines.length === 0) continue;

    const docId = randomUUID();
    const written = await applyPlan(accountId, plan, docId);
    console.log(`\nYOZILDI: ${written}/${plan.lines.length} tovar.`);
    console.log('🔑 QAYTARISH BUYRUG‘I (saqlab qo‘ying):');
    console.log(
      `   npx tsx scripts/stock-baseline-cleanup.ts --revert ${docId} --apply${
        isLocal ? '' : ' --allow-remote'
      }`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
