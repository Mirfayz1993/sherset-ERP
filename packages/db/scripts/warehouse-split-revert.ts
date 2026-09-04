/**
 * Ombor-split'ni QAYTARISH — bitta ombordagi yacheykalar va qoldiqni kassa
 * hovuziga («Taqsimlanmagan») qaytaradi.
 *
 * 🔴 NEGA (prod hodisasi, 2026-08-24): 2026-08-23 dagi jonli split yacheyka
 * kodi prefiksi bo'yicha 273 tovarning qoldig'ini «Ombor 02» ga ko'chirdi.
 * Kassa esa (F6 kaskadi bo'yicha, egasining Q1 qarori) tovarni FAQAT prioritet
 * ombordan ayiradi va boshqa ombordagi qoldiqni AVTOMATIK olmaydi — bosh
 * omborchi tasdig'i (G4) orqali ko'chirilishi kerak, G4 esa hali qurilmagan.
 * Natijada kassir ekranda ~11 000 dona ko'rib turib chekni yopolmasdi.
 *
 * Bu skript — o'sha «tasdiqdan keyingi ko'chirish» ni OMMAVIY bajaradi:
 * yacheykalar va ularning qoldig'i kassa omboriga qaytadi. Split IDEMPOTENT,
 * ya'ni G4 tayyor bo'lgach `warehouse-split.ts` qayta yugurtirilsa hammasi
 * o'z omboriga qaytadi (yacheyka kodi o'zgarmaydi — reja shu kod bo'yicha
 * quriladi).
 *
 * Yuritish (packages/db ichidan):
 *   npx tsx scripts/warehouse-split-revert.ts --from "Ombor 02"              # DRY-RUN
 *   npx tsx scripts/warehouse-split-revert.ts --from "Ombor 02" --apply --allow-remote
 *
 * Invariant (tranzaksiya ichida tekshiriladi, buzilsa ROLLBACK):
 *   har tovar bo'yicha JAMI qoldiq va JAMI tan-narx qiymati O'ZGARMAYDI —
 *   faqat ombor kesimi siljiydi.
 *
 * ⚠️ KELIB CHIQISHI (2026-08-24, H0): bu fayl hodisa paytida to'g'ridan-to'g'ri
 * VPS'da yozilib (06:45) o'sha yerda yugurtirilgan (06:46) va git'ga
 * KIRITILMAGAN edi — ya'ni keyingi tozalashda yo'qolib ketishi mumkin edi.
 * Repoga MANTIQI O'ZGARTIRILMAGAN holda kiritildi (faqat biome formatlashi:
 * import tartibi + qator o'rami). Jonli yugurish izi: ledger
 * `warehouse_split_revert`, 546 qator, Σqty=0.
 * To'liq hodisa tahlili: `docs/plans/2026-08-24-split-kassa-hodisasi.md`.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '../src/generated/index.js';
import {
  UNALLOCATED_STORE_NAME,
  formatDecimalScaled,
  parseDecimalScaled,
} from './warehouse-split-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  try {
    const raw = readFileSync(join(HERE, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*(?:#.*)?$/.exec(line);
      if (m?.[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? '').trim();
    }
  } catch {
    /* .env yo'q — pastda xato beradi */
  }
}
loadEnv();

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const ALLOW_REMOTE = args.has('--allow-remote');
const fromIdx = process.argv.indexOf('--from');
const FROM_NAME = fromIdx > -1 ? process.argv[fromIdx + 1] : undefined;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL yo‘q');
if (!FROM_NAME) throw new Error('--from "Ombor 02" ko‘rsatilishi shart');

function dbHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '?';
  }
}
const HOST = dbHost(DB_URL);
if (APPLY && HOST !== 'localhost' && HOST !== '127.0.0.1' && !ALLOW_REMOTE) {
  throw new Error(`Masofaviy baza (${HOST}) — --allow-remote SHART`);
}

const prisma = new PrismaClient({ log: ['error', 'warn'] });
const DOC_TYPE = 'warehouse_split_revert';
const D = (s: string) => new Prisma.Decimal(s);

async function main(): Promise<void> {
  const [source, target] = await Promise.all([
    prisma.store.findFirst({
      where: { name: FROM_NAME },
      select: { id: true, name: true, accountId: true },
    }),
    prisma.store.findFirst({
      where: { name: UNALLOCATED_STORE_NAME },
      select: { id: true, name: true },
    }),
  ]);
  if (!source) throw new Error(`«${FROM_NAME}» ombori topilmadi`);
  if (!target) throw new Error(`«${UNALLOCATED_STORE_NAME}» ombori topilmadi`);
  const accountId = source.accountId;

  const [cells, stocks, sbc, pieces] = await Promise.all([
    prisma.storeCell.findMany({ where: { storeId: source.id }, select: { id: true } }),
    prisma.stock.findMany({
      where: { accountId, storeId: source.id },
      select: { assortmentKind: true, assortmentId: true, qty: true, costBalanceMinor: true },
    }),
    prisma.stockByCell.findMany({
      where: { accountId, storeId: source.id },
      select: { cellId: true, assortmentKind: true, assortmentId: true, qty: true },
    }),
    // J1 — K-reja bo'lak reyestri. Bu skript butun OMBORNI bo'shatadi, ya'ni
    // forward split'dan farqli o'laroq YACHEYKASIZ (`cellId IS NULL`) bo'laklar
    // ham ko'chadi: hovuz qoldig'i ketayotgan bo'lsa uning jismoniy tarkibi
    // ham ketishi shart, aks holda bo'lak bo'shatilgan omborda osilib qolardi.
    prisma.stockPiece.groupBy({
      by: ['status'],
      where: { accountId, storeId: source.id },
      _count: { _all: true },
    }),
  ]);
  const pieceTotal = pieces.reduce((a, r) => a + r._count._all, 0);
  const pieceActive = pieces.find((r) => r.status === 'active')?._count._all ?? 0;

  const moving = stocks.filter(
    (s) => parseDecimalScaled(s.qty.toString()) !== 0n || s.costBalanceMinor !== 0n,
  );
  const totalQty = moving.reduce((a, s) => a + parseDecimalScaled(s.qty.toString()), 0n);
  const totalCost = moving.reduce((a, s) => a + s.costBalanceMinor, 0n);

  console.log(`Manba : «${source.name}» (${source.id})`);
  console.log(`Maqsad: «${target.name}» (${target.id})`);
  console.log(`Yacheyka: ${cells.length} · StockByCell qator: ${sbc.length}`);
  console.log(
    `Ko‘chadi: ${moving.length} tovar · ${formatDecimalScaled(totalQty)} dona · ` +
      `${totalCost.toString()} tiyin tan narx`,
  );
  // J1 — qator HAR DOIM chiqadi (0 bo'lsa ham).
  console.log(`Bo‘lak reyestri (K-reja): ${pieceTotal} bo‘lak ko‘chadi (faol ${pieceActive})`);
  if (!APPLY) {
    console.log('\nDRY-RUN — hech nima yozilmadi. Qo‘llash uchun: --apply --allow-remote');
    return;
  }

  const docId = randomUUID();
  await prisma.$transaction(
    async (tx) => {
      // 1) Yacheykalar kassa omboriga. `zoneId` bo‘shatiladi: hovuzda stelaj
      //    tuzilmasi yo‘q, split qayta yugurtirilganda esa zona yacheyka
      //    KODIDAN qayta hosil bo‘ladi (forward skript shunday quradi).
      await tx.storeCell.updateMany({
        where: { storeId: source.id },
        data: { storeId: target.id, zoneId: null },
      });
      await tx.stockByCell.updateMany({
        where: { accountId, storeId: source.id },
        data: { storeId: target.id },
      });
      // 1b) Bo'lak reyestri — yacheykalilar ham, hovuzdagilar ham (J1).
      //     `cellId` GA TEGILMAYDI: yacheykaning o'zi maqsad omborga ko'chdi,
      //     ya'ni bog'lanish to'g'ri qoladi (`zoneId` esa yuqorida yacheykada
      //     tozalandi — bo'lakda zona tushunchasi umuman yo'q).
      await tx.stockPiece.updateMany({
        where: { accountId, storeId: source.id },
        data: { storeId: target.id },
      });

      // 2) Ombor jamilari: manbadan chiqim, maqsadga kirim.
      for (const s of moving) {
        const qtyStr = s.qty.toString();
        await tx.stock.update({
          where: {
            accountId_storeId_assortmentKind_assortmentId: {
              accountId,
              storeId: source.id,
              assortmentKind: s.assortmentKind,
              assortmentId: s.assortmentId,
            },
          },
          data: {
            qty: { decrement: D(qtyStr) },
            costBalanceMinor: { decrement: s.costBalanceMinor },
          },
        });
        await tx.stock.upsert({
          where: {
            accountId_storeId_assortmentKind_assortmentId: {
              accountId,
              storeId: target.id,
              assortmentKind: s.assortmentKind,
              assortmentId: s.assortmentId,
            },
          },
          create: {
            accountId,
            storeId: target.id,
            assortmentKind: s.assortmentKind,
            assortmentId: s.assortmentId,
            qty: D(qtyStr),
            costBalanceMinor: s.costBalanceMinor,
          },
          update: {
            qty: { increment: D(qtyStr) },
            costBalanceMinor: { increment: s.costBalanceMinor },
          },
        });
      }

      // 3) Ledger — halol juft yozuv (split bilan ayni shakl).
      await tx.stockOperation.createMany({
        data: moving.flatMap((s) => [
          {
            accountId,
            storeId: source.id,
            assortmentKind: s.assortmentKind,
            assortmentId: s.assortmentId,
            qtyDelta: D(formatDecimalScaled(-parseDecimalScaled(s.qty.toString()))),
            costDeltaMinor: -s.costBalanceMinor,
            docType: DOC_TYPE,
            docId,
            reason: 'post',
            createdById: null,
          },
          {
            accountId,
            storeId: target.id,
            assortmentKind: s.assortmentKind,
            assortmentId: s.assortmentId,
            qtyDelta: D(s.qty.toString()),
            costDeltaMinor: s.costBalanceMinor,
            docType: DOC_TYPE,
            docId,
            reason: 'post',
            createdById: null,
          },
        ]),
      });

      // 4) INVARIANT — manba ombor butunlay bo‘shashi SHART.
      const left = await tx.stock.aggregate({
        where: { accountId, storeId: source.id },
        _sum: { qty: true, costBalanceMinor: true },
      });
      const leftQty = parseDecimalScaled((left._sum.qty ?? new Prisma.Decimal(0)).toString());
      const leftCost = left._sum.costBalanceMinor ?? 0n;
      if (leftQty !== 0n || leftCost !== 0n) {
        throw new Error(
          `INVARIANT BUZILDI: manbada ${formatDecimalScaled(leftQty)} dona / ${leftCost} tiyin qoldi — ROLLBACK`,
        );
      }
      // J1 — bo'lak reyestri ham bo'shashi SHART. Qoldiq ketib bo'lak qolsa
      // K1 sverkasi bo'shatilgan omborda «ortiqcha» deb qizil berardi.
      const leftPieces = await tx.stockPiece.count({ where: { accountId, storeId: source.id } });
      if (leftPieces !== 0) {
        throw new Error(`INVARIANT BUZILDI: manbada ${leftPieces} bo‘lak qoldi — ROLLBACK`);
      }
    },
    { isolationLevel: 'Serializable', timeout: 180_000 },
  );

  console.log(
    `✓ Qaytarildi (docId ${docId}) · ${pieceTotal} bo‘lak ham ko‘chdi. ` +
      'Kassa endi shu tovarlarni sotadi.',
  );
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
