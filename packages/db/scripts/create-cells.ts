/**
 * Yetishmayotgan yacheykalarni yaratish — TANLANGAN stelajlar uchun.
 *
 * 🔴 NEGA (2026-08-24, egasining topshirig'i): omborda javonlarga yorliqlar
 * yopishtirilgan va tovarlar ularga biriktirilgan, LEKIN o'sha yacheykalar
 * tizimda hech qachon yaratilmagan. Birinchi omborda faqat `01-04-…` stelaji
 * bor; `01-01`, `01-02`, `01-03`, `01-05` stelajlari yo'q — shuning uchun
 * omborchi yorliqni skanerlaganda «Kod topilmadi» chiqadi.
 *
 * F3 ning `POST /admin/stores/:id/warehouse-numbering` endpointi bir omborning
 * HAMMA stelajini ketma-ket (1..N) yaratadi — ya'ni o'rtadagi mavjud stelajni
 * (04) o'tkazib bo'lmaydi va uning uchun ham to'g'ri to'rtburchak talab qilinadi.
 * Bu skript esa AYNAN kerakli stelajlarni yaratadi, boshqasiga tegmaydi.
 *
 * Nomlash F3 bilan AYNAN bir xil (`cell-range.util.ts` → `expandWarehouseNumbering`):
 *   `{ombor}-{stelaj}-{qavat}-{orin}`, har segment 2 xonaga to'ldiriladi.
 * Yozish yo'li ham o'sha naqsh: `createMany({ skipDuplicates: true })` —
 * idempotent, qayta yugurtirilsa yangi yozuv bo'lmaydi.
 *
 * Yuritish (packages/db ichidan):
 *   npx tsx scripts/create-cells.ts --store "Taqsimlanmagan" --ombor 1 \
 *     --stelaj 1:3x9 --stelaj 2:4x44 --stelaj 3:4x25 --stelaj 5:3x33
 *                                                   # DRY-RUN (hech nima yozmaydi)
 *   ... --apply --allow-remote                      # jonli bazaga yozadi
 *   ... --revert --apply --allow-remote             # QAYTARISH (faqat BO'SH yacheykalar)
 *
 * `--zones` berilsa har stelaj uchun `NN-SS` zonasi ham yaratiladi va yacheyka
 * unga bog'lanadi. SUKUT — zonasiz: hozir hovuz-omborda («Taqsimlanmagan»)
 * yacheykalar zonasiz turibdi (split qaytarilganda `zoneId` tozalangan), split
 * qayta yugurtirilganda esa zona kodning 2-segmentidan qayta hosil bo'ladi.
 *
 * 🔴 AKKAUNT BO'YICHA DUBLIKAT OGOHLANTIRISHI: yacheyka nomi faqat ombor
 * ICHIDA unikal (`@@unique([storeId, name])`), skaner qidiruvi esa AKKAUNT
 * bo'yicha ishlaydi (`lookupCellByBarcode`). Ya'ni bir nom ikki omborda bo'lsa
 * skaner «qaysi biri?» deb chalkashadi. Skript bunday holatni yozishdan OLDIN
 * topadi va `--apply` ni RAD ETADI (`--allow-duplicates` bilan ongli ravishda
 * bosib o'tish mumkin).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../src/generated/index.js';

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
    // .env yo'q — pastda xato beradi
  }
}
loadEnv();

// ---------------------------------------------------------------------------
// Argumentlar
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
function opt(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
}
function optAll(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1] as string);
  }
  return out;
}

const APPLY = has('--apply');
const ALLOW_REMOTE = has('--allow-remote');
const REVERT = has('--revert');
const WITH_ZONES = has('--zones');
const ALLOW_DUPLICATES = has('--allow-duplicates');

const STORE_NAME = opt('--store');
const OMBOR_RAW = opt('--ombor');

/** F3 bilan bir xil chegaralar (`cell-range.util.ts`). */
const MAX_SEGMENT = 99;
const MAX_TOTAL = 5000;

interface StelajSpec {
  stelaj: number;
  qavatlar: number;
  orinlar: number;
}

/** `2:4x44` → { stelaj: 2, qavatlar: 4, orinlar: 44 } */
function parseStelaj(raw: string): StelajSpec {
  const m = /^(\d{1,2}):(\d{1,2})x(\d{1,2})$/.exec(raw.trim());
  if (!m)
    throw new Error(`«--stelaj ${raw}» noto'g'ri. Namuna: --stelaj 2:4x44 (stelaj:qavatXo'rin)`);
  const [, s, q, o] = m as unknown as [string, string, string, string];
  const spec = { stelaj: Number(s), qavatlar: Number(q), orinlar: Number(o) };
  for (const [key, v] of Object.entries(spec)) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_SEGMENT) {
      throw new Error(`«--stelaj ${raw}»: ${key} 1–${MAX_SEGMENT} oralig'ida bo'lsin`);
    }
  }
  return spec;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** F3 `expandWarehouseNumbering` bilan AYNAN bir xil nomlash. */
function expand(ombor: number, specs: StelajSpec[]): Array<{ name: string; zoneName: string }> {
  const nn = pad2(ombor);
  const out: Array<{ name: string; zoneName: string }> = [];
  for (const s of specs) {
    const ss = pad2(s.stelaj);
    for (let q = 1; q <= s.qavatlar; q += 1) {
      for (let o = 1; o <= s.orinlar; o += 1) {
        out.push({ name: `${nn}-${ss}-${pad2(q)}-${pad2(o)}`, zoneName: `${nn}-${ss}` });
      }
    }
  }
  return out;
}

function dbHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '?';
  }
}

// ---------------------------------------------------------------------------

const prisma = new PrismaClient({ log: ['error', 'warn'] });

async function main(): Promise<void> {
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) throw new Error('DATABASE_URL topilmadi (packages/db/.env yoki muhitda)');
  if (!STORE_NAME) throw new Error('--store "Taqsimlanmagan" ko\'rsatilishi shart');
  if (!OMBOR_RAW || !/^\d{1,2}$/.test(OMBOR_RAW.trim())) {
    throw new Error("--ombor 1–2 xonali son bo'lishi kerak (masalan --ombor 1)");
  }
  const ombor = Number(OMBOR_RAW.trim());
  if (ombor < 1) throw new Error('Ombor raqami 01 dan boshlanadi');

  const stelajRaw = optAll('--stelaj');
  if (stelajRaw.length === 0) throw new Error('Kamida bitta --stelaj SS:QxO kerak');
  const specs = stelajRaw.map(parseStelaj);
  const dupStelaj = specs.map((s) => s.stelaj).filter((v, i, a) => a.indexOf(v) !== i);
  if (dupStelaj.length) throw new Error(`Stelaj takrorlangan: ${dupStelaj.join(', ')}`);

  const host = dbHost(DB_URL);
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (APPLY && !isLocal && !ALLOW_REMOTE) {
    throw new Error(`XAVFSIZLIK: «${host}» lokal emas — ongli ravishda --allow-remote qo'shing`);
  }

  const expanded = expand(ombor, specs);
  if (expanded.length > MAX_TOTAL) {
    throw new Error(`${expanded.length} ta yacheyka chiqadi, chegara ${MAX_TOTAL}`);
  }

  const store = await prisma.store.findFirst({
    where: { name: STORE_NAME },
    select: { id: true, name: true, accountId: true },
  });
  if (!store) throw new Error(`«${STORE_NAME}» ombori topilmadi`);
  const { accountId } = store;

  console.log(
    `Baza: ${host} (${isLocal ? 'lokal' : 'MASOFAVIY'}) — rejim: ${
      REVERT ? 'REVERT' : APPLY ? 'APPLY' : 'DRY-RUN'
    }`,
  );
  console.log(`Ombor: «${store.name}» (${store.id})`);
  console.log(
    `Stelajlar: ${specs
      .map(
        (s) =>
          `${pad2(s.stelaj)} (${s.qavatlar} qavat × ${s.orinlar} o'rin = ${s.qavatlar * s.orinlar})`,
      )
      .join(', ')}`,
  );
  console.log(`Jami reja: ${expanded.length} yacheyka`);

  const names = expanded.map((c) => c.name);
  const existingHere = await prisma.storeCell.findMany({
    where: { accountId, storeId: store.id, name: { in: names } },
    select: { id: true, name: true },
  });
  const haveHere = new Set(existingHere.map((r) => r.name));

  // ── REVERT ────────────────────────────────────────────────────────────────
  if (REVERT) {
    const ids = existingHere.map((r) => r.id);
    if (ids.length === 0) {
      console.log('Qaytariladigan yacheyka yo‘q (reja bo‘yicha hech biri mavjud emas).');
      return;
    }
    // FAQAT butunlay bo'sh va hech qayerda ishlatilmagan yacheykalar o'chadi.
    //
    // 🔴 J1 — `stock_pieces` shu ro'yxatda YO'Q edi. FK esa `ON DELETE SET NULL`
    //    (K1: «yacheyka o'chsa bo'lak ombor darajasiga TUSHADI, yo'qolmaydi»)
    //    ⇒ bo'lagi bor yacheyka JIMGINA o'chib ketardi va omborchi jismonan
    //    turgan rulonni yorlig'i bo'yicha topa olmay qolardi. Faqat `active`
    //    to'sadi: `consumed` — tarix qatori, u yacheykani abadiy qulflab
    //    qo'ymasligi kerak (`stock_operations` shu ro'yxatda bo'lmagani bilan
    //    bir sabab).
    const [sbc, links, inv, loss, enter, supply, pret, sret, dem, pieces] = await Promise.all([
      prisma.stockByCell.findMany({ where: { cellId: { in: ids } }, select: { cellId: true } }),
      prisma.productCellLink.findMany({ where: { cellId: { in: ids } }, select: { cellId: true } }),
      prisma.inventoryPosition.findMany({
        where: { cellId: { in: ids } },
        select: { cellId: true },
      }),
      prisma.lossPosition.findMany({ where: { cellId: { in: ids } }, select: { cellId: true } }),
      prisma.enterPosition.findMany({ where: { cellId: { in: ids } }, select: { cellId: true } }),
      prisma.supplyPosition.findMany({ where: { cellId: { in: ids } }, select: { cellId: true } }),
      prisma.purchaseReturnPosition.findMany({
        where: { cellId: { in: ids } },
        select: { cellId: true },
      }),
      prisma.salesReturnPosition.findMany({
        where: { cellId: { in: ids } },
        select: { cellId: true },
      }),
      prisma.demandPosition.findMany({ where: { cellId: { in: ids } }, select: { cellId: true } }),
      prisma.stockPiece.findMany({
        where: { cellId: { in: ids }, status: 'active' },
        select: { cellId: true },
      }),
    ]);
    const used = new Set(
      [sbc, links, inv, loss, enter, supply, pret, sret, dem, pieces]
        .flat()
        .map((r) => r.cellId as string),
    );
    const pieceCells = new Set(pieces.map((r) => r.cellId as string));
    const deletable = existingHere.filter((r) => !used.has(r.id));
    console.log(
      `Mavjud: ${existingHere.length} · ishlatilgan (saqlanadi): ${used.size} · o‘chiriladi: ${deletable.length}`,
    );
    // J1 — qator HAR DOIM chiqadi (0 bo'lsa ham).
    console.log(
      `Bo‘lak reyestri (K-reja): ${pieces.length} faol bo‘lak · ` +
        `${pieceCells.size} yacheyka SHU SABAB saqlanadi`,
    );
    if (!APPLY) {
      console.log('\nDRY-RUN — hech nima o‘chirilmadi. Qo‘llash: --revert --apply --allow-remote');
      return;
    }
    const res = await prisma.storeCell.deleteMany({
      where: { id: { in: deletable.map((r) => r.id) } },
    });
    console.log(`✓ ${res.count} ta bo‘sh yacheyka o‘chirildi.`);
    return;
  }

  // ── DUBLIKAT TEKSHIRUVI (akkaunt bo'yicha) ────────────────────────────────
  const missingNames = names.filter((n) => !haveHere.has(n));
  const elsewhere = await prisma.storeCell.findMany({
    where: { accountId, name: { in: missingNames }, storeId: { not: store.id } },
    select: { name: true, store: { select: { name: true } } },
    take: 20,
  });

  const sample = missingNames.length ? ` · namuna: ${missingNames.slice(0, 5).join(', ')}` : '';
  console.log(
    `Mavjud (shu omborda): ${haveHere.size} · YARATILADI: ${missingNames.length}${sample}`,
  );

  if (elsewhere.length > 0) {
    console.log(
      '\n🔴 DUBLIKAT XAVFI — quyidagi nomlar BOSHQA omborda ham bor (skaner chalkashadi):',
    );
    for (const r of elsewhere) console.log(`   ${r.name} → «${r.store.name}»`);
    if (!ALLOW_DUPLICATES) {
      console.log(
        '\nYaratish TO‘XTATILDI. Avval o‘sha yacheykalarni bitta omborga yig‘ing ' +
          '(masalan warehouse-split-revert.ts) yoki ongli ravishda --allow-duplicates qo‘shing.',
      );
      process.exitCode = 2;
      return;
    }
  }

  if (missingNames.length === 0) {
    console.log('Hammasi allaqachon mavjud — qiladigan ish yo‘q (idempotent).');
    return;
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — hech nima yozilmadi. Qo‘llash: --apply --allow-remote');
    return;
  }

  const missing = expanded.filter((c) => !haveHere.has(c.name));
  const result = await prisma.$transaction(async (tx) => {
    let zoneIdByName = new Map<string, string>();
    let zonesCreated = 0;
    if (WITH_ZONES) {
      const needed = [...new Set(missing.map((c) => c.zoneName))];
      const zr = await tx.storeZone.createMany({
        data: needed.map((name) => ({ accountId, storeId: store.id, name })),
        skipDuplicates: true,
      });
      zonesCreated = zr.count;
      const rows = await tx.storeZone.findMany({
        where: { accountId, storeId: store.id, name: { in: needed } },
        select: { id: true, name: true },
      });
      zoneIdByName = new Map(rows.map((z) => [z.name, z.id]));
    }
    const cr = await tx.storeCell.createMany({
      data: missing.map((c) => ({
        accountId,
        storeId: store.id,
        name: c.name,
        zoneId: WITH_ZONES ? (zoneIdByName.get(c.zoneName) ?? null) : null,
      })),
      // Parallel sessiya o'sha nomni yaratib qo'ysa ham yiqilmaymiz —
      // DB darajasidagi @@unique([storeId, name]) ga tayanamiz.
      skipDuplicates: true,
    });
    return { created: cr.count, zonesCreated };
  });

  const zoneNote = WITH_ZONES ? ` · ${result.zonesCreated} zona` : ' · zonasiz';
  console.log(`✓ Yaratildi: ${result.created} yacheyka${zoneNote}`);

  const after = await prisma.storeCell.count({ where: { accountId, storeId: store.id } });
  console.log(`«${store.name}» dagi jami yacheyka: ${after}`);
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
