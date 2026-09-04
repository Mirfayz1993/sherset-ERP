#!/usr/bin/env tsx
/**
 * J2 — BAYROQ GIGIENASI + PILOT DOIRASINI O'LCHASH
 * Reja: `docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md` → J2.
 *
 * NIMA QILADI:
 *   1. **O'LCHAYDI** (DRY ham, APPLY ham — hisobot HAR DOIM chiqadi):
 *      · `piece_tracked = true` tovarlarning JONLI ro'yxati (J1 da 6 ta edi;
 *        bayroq yoqish davom etayotgani uchun ro'yxat QAYTA o'lchanadi);
 *      · har biri uchun: qoldiq, **nechta manbadan** iborat (ombor ×
 *        yacheyka + yacheykasiz hovuz), reyestrdagi faol bo'laklar, qaror
 *        kim/qachon qo'yilgani, oxirgi 30 kunda nechta chekda sotilgani;
 *      · `stock_pieces` reyestrining jonli hajmi.
 *   2. **PILOT NOMZODLARINI** guruh (papka) bo'yicha ko'rsatadi — sukut
 *      bo'yicha nomi «kabel» bo'lgan papkalar (`--group=` bilan o'zgaradi).
 *      🔴 **Manbasi 1 dan ko'p tovar «KIRMAYDI» deb belgilanadi**: bayroq
 *      yoqilgan zahoti 7.1 istisnosi (`retail-allocation.ts`) uning chekini
 *      `no-single-source` bilan yiqitardi.
 *   3. `--apply` bilan bayroqlarni O'CHIRADI — **SQL EMAS**, UI aynan
 *      bosadigan marshrut orqali: `POST /stock-pieces/flag`
 *      (`piecetracking.update`). Bir bayt ham to'g'ridan-to'g'ri yozilmaydi.
 *
 * 🔴 SKRIPT PILOT RO'YXATINI TANLAMAYDI. U faqat o'lchovni va qat'iy
 * to'siqlarni ko'rsatadi; 5–8 tovarlik ro'yxatni EGASI tanlaydi (J2/4).
 *
 * 🔴 `--apply` FAQAT bayroqni o'chiradi (`pieceTracked: false`). Yoqish yo'li
 * ATAYLAB YO'Q: yoqish jonli kassa xulqini o'zgartiradi va u J4 ning ishi,
 * ko'z bilan ko'rilib, bittalab bosiladi.
 *
 * ⚠️ Marshrut qarorni ham MUHRLAYDI (`piece_tracked_decided_at`) — ya'ni
 * o'chirilgan tovar «Hal qilinmagan» ro'yxatidan CHIQADI. Bu UI tugmasining
 * xulqi va uni chetlab o'tish SQL talab qilardi (taqiqlangan). J4 da bayroq
 * qaytarilganda qaror muhri yangilanadi.
 *
 * Ishga tushirish (box):
 *   cd /var/www/sherset-v2/apps/api && set -a && . ./.env && set +a && \
 *   ./node_modules/.bin/tsx src/scripts/ops-j2-piece-pilot-audit.ts        # DRY
 *   …/ops-j2-piece-pilot-audit.ts --apply                                  # bayroq o'chadi
 *   …/ops-j2-piece-pilot-audit.ts --group=kabel --group=shlang             # boshqa papka
 *   …/ops-j2-piece-pilot-audit.ts --apply --force                          # reyestri TO'LGANini ham
 *
 * Env: `J2_API_BASE` (default `http://localhost:4001/api/v1`), `JWT_SECRET`.
 */
import { PrismaClient } from '@moysklad/db';
import { JwtService } from '@nestjs/jwt';

import { readPosPriority } from '../modules/retail-sale/retail-stock-cascade.js';
import { readBrakStore } from '../modules/sales-return/sales-return-acceptance.js';
import { isMeterUom } from '../modules/stock-piece/piece-flag-policy.js';
import {
  type J2Candidate,
  type J2CellRow,
  type J2StockRow,
  type J2Store,
  buildPieceSources,
  evaluateCandidate,
  planFlagOff,
  rankCandidates,
  summarizeGroups,
} from './j2-pilot-audit-core.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const API = process.env.J2_API_BASE ?? 'http://localhost:4001/api/v1';
const GROUPS = process.argv
  .filter((a) => a.startsWith('--group='))
  .map((a) => a.slice('--group='.length).trim().toLowerCase())
  .filter((a) => a.length > 0);
/** Sukut: K-Q10 «avval FAQAT kabel guruhi». */
const GROUP_NEEDLES = GROUPS.length > 0 ? GROUPS : ['kabel'];
/** Nomzodlar jadvalining chegarasi — jim kesish YO'Q, kesilgani yoziladi. */
const CANDIDATE_LIMIT = 30;
const DAYS = 30;

const prisma = new PrismaClient();

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const pad = (s: string, n: number) =>
  s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

function num(value: string): string {
  const [int = '0', frac] = value.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped}.${frac}` : grouped;
}

async function main() {
  const acc = await prisma.account.findFirstOrThrow({ select: { id: true, name: true } });
  const accountId = acc.id;

  console.log('════════ J2 · BAYROQ GIGIENASI + PILOT DOIRASI ════════');
  console.log(
    `Rejim:   ${APPLY ? `APPLY (bayroq O'CHADI)${FORCE ? ' + FORCE' : ''}` : 'DRY (hech nima yozilmaydi)'}`,
  );
  console.log(`Akkaunt: ${acc.name}`);
  console.log(`Guruh filtri (papka nomi ichida): ${GROUP_NEEDLES.join(' · ')}`);
  console.log(`Vaqt:    ${new Date().toISOString()}`);
  console.log();

  // ── 0. Omborlar (POS kaskadi) ────────────────────────────────────────────
  // ⚠️ ARXIVLANGAN ombor ham O'QILADI (filtrsiz), lekin manba BO'LOLMAYDI:
  // kassa kaskadi `archived: false` bilan quriladi (`retail-sale.service.ts`).
  // Filtrlab tashlasak undagi qoldiq hisobotdan JIMGINA yo'qolardi.
  const storeRows = await prisma.store.findMany({
    where: { accountId },
    select: { id: true, name: true, archived: true, attributes: true },
  });
  const stores: J2Store[] = storeRows.map((s) => ({
    id: s.id,
    name: s.archived ? `${s.name} (arxiv)` : s.name,
    posPriority: s.archived ? null : readPosPriority(s.attributes),
    isBrak: readBrakStore(s.attributes),
  }));
  const cascade = stores.filter((s) => s.posPriority !== null && !s.isBrak);
  console.log(
    `Omborlar: ${stores.length} · POS kaskadida ${cascade.length} (${cascade
      .sort((a, b) => (a.posPriority ?? 0) - (b.posPriority ?? 0))
      .map((s) => s.name)
      .join(' → ')})`,
  );

  // ── 1. Reyestrning jonli hajmi ───────────────────────────────────────────
  const pieceGroups = await prisma.stockPiece.groupBy({
    by: ['assortmentId', 'status'],
    where: { accountId },
    _count: { _all: true },
  });
  const activePieceByProduct = new Map<string, number>();
  let piecesTotal = 0;
  let piecesActive = 0;
  for (const g of pieceGroups) {
    piecesTotal += g._count._all;
    if (g.status === 'active') {
      piecesActive += g._count._all;
      activePieceByProduct.set(g.assortmentId, g._count._all);
    }
  }
  console.log(`Bo'lak reyestri (stock_pieces): jami ${piecesTotal} qator · faol ${piecesActive}`);
  console.log();

  // ── 2. Tovarlar: bayroqlilar + metr birlikdagilar ────────────────────────
  const products = await prisma.product.findMany({
    where: { accountId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      uom: true,
      pathName: true,
      pieceTracked: true,
      pieceTrackedDecidedAt: true,
      pieceTrackedDecidedBy: { select: { name: true } },
    },
  });
  const flagged = products.filter((p) => p.pieceTracked);
  const meters = products.filter((p) => isMeterUom(p.uom));
  const folderOf = (p: (typeof products)[number]) => (p.pathName ?? '').trim() || '(papkasiz)';
  const inGroup = (p: (typeof products)[number]) => {
    const hay = `${p.pathName ?? ''} ${p.name}`.toLowerCase();
    return GROUP_NEEDLES.some((n) => hay.includes(n));
  };

  // Nomzodlar: guruhdagi metr tovarlar + bayroqlilar (ular ham ko'rinsin).
  const scope = [...new Set([...flagged, ...meters.filter(inGroup)])];
  const scopeIds = scope.map((p) => p.id);

  // ── 3. Qoldiq (ombor + yacheyka) ─────────────────────────────────────────
  const stockRows = await prisma.stock.findMany({
    where: { accountId, assortmentKind: 'product', assortmentId: { in: scopeIds } },
    select: { assortmentId: true, storeId: true, qty: true, reservedQty: true },
  });
  const cellRows = await prisma.stockByCell.findMany({
    where: { accountId, assortmentKind: 'product', assortmentId: { in: scopeIds } },
    select: {
      assortmentId: true,
      storeId: true,
      cellId: true,
      qty: true,
      cell: { select: { name: true } },
    },
  });
  const stockBy = new Map<string, J2StockRow[]>();
  for (const r of stockRows) {
    const list = stockBy.get(r.assortmentId) ?? [];
    list.push({ storeId: r.storeId, qty: r.qty.toString(), reservedQty: r.reservedQty.toString() });
    stockBy.set(r.assortmentId, list);
  }
  const cellBy = new Map<string, J2CellRow[]>();
  for (const r of cellRows) {
    const list = cellBy.get(r.assortmentId) ?? [];
    list.push({
      storeId: r.storeId,
      cellId: r.cellId,
      cellName: r.cell?.name ?? null,
      qty: r.qty.toString(),
    });
    cellBy.set(r.assortmentId, list);
  }

  // ── 4. Oxirgi 30 kun savdosi (posted cheklar) ────────────────────────────
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const soldRows = await prisma.retailSalePosition.findMany({
    where: {
      accountId,
      productId: { in: scopeIds },
      retailSale: { state: 'posted', postedAt: { gte: since } },
    },
    select: { productId: true, retailSaleId: true, quantity: true },
  });
  const receiptsBy = new Map<string, Set<string>>();
  const qtyBy = new Map<string, number>();
  for (const r of soldRows) {
    if (!r.productId) continue;
    const set = receiptsBy.get(r.productId) ?? new Set<string>();
    set.add(r.retailSaleId);
    receiptsBy.set(r.productId, set);
    qtyBy.set(r.productId, (qtyBy.get(r.productId) ?? 0) + Number(r.quantity));
  }

  const build = (p: (typeof products)[number]): J2Candidate =>
    evaluateCandidate({
      id: p.id,
      name: p.name,
      code: p.code,
      uom: p.uom,
      meterUom: isMeterUom(p.uom),
      folder: folderOf(p),
      pieceTracked: p.pieceTracked,
      decidedAt: p.pieceTrackedDecidedAt?.toISOString() ?? null,
      activePieces: activePieceByProduct.get(p.id) ?? 0,
      receipts30: receiptsBy.get(p.id)?.size ?? 0,
      qty30: (qtyBy.get(p.id) ?? 0).toString(),
      sources: buildPieceSources(stores, stockBy.get(p.id) ?? [], cellBy.get(p.id) ?? []),
    });

  // =========================================================================
  // 1-BO'LIM — HOZIRGI HOLAT: bayroqli tovarlar
  // =========================================================================
  console.log('── 1. HOZIRGI HOLAT: `piece_tracked = true` tovarlar ──');
  console.log(
    `   Jami: ${flagged.length} ta (J-reja §1 «4 ta» deb yozgan, J1 «6 ta» deb o'lchagan)`,
  );
  console.log();
  if (flagged.length > 0) {
    console.log(
      `   ${pad('Tovar', 26)} ${pad('Birlik', 7)} ${padL('Qoldiq', 14)} ${padL('Manba', 6)} ${padL('Bo‘lak', 6)} ${padL('30k chek', 9)}  Qaror`,
    );
    for (const p of flagged.map(build).sort((a, b) => a.name.localeCompare(b.name))) {
      const decided = p.decidedAt ? `${p.decidedAt.slice(0, 16).replace('T', ' ')}` : 'QAROR YO‘Q';
      const who = flagged.find((f) => f.id === p.id)?.pieceTrackedDecidedBy?.name ?? '—';
      const bad = p.meterUom ? '' : ' 🔴 metr EMAS';
      console.log(
        `   ${pad(p.name, 26)} ${pad(p.uom ?? '—', 7)} ${padL(num(p.sources.totalQty), 14)} ${padL(String(p.sources.reachableCount), 6)} ${padL(String(p.activePieces), 6)} ${padL(String(p.receipts30), 9)}  ${decided} · ${who}${bad}`,
      );
      if (p.sources.reachableCount > 1) {
        for (const s of p.sources.sources) {
          console.log(
            `      · ${s.reachable ? '  ' : '🚫'} ${s.storeName} / ${s.cellName ?? '(yacheykasiz)'} = ${num(s.qty)}`,
          );
        }
      }
      if (p.sources.overCelledStores.length > 0) {
        console.log(
          `      🔴 yacheykalar yig‘indisi ombor qoldig‘idan KATTA: ${p.sources.overCelledStores.join(', ')}`,
        );
      }
    }
  } else {
    console.log('   (yo‘q — bayroq hech qayerda yoqilmagan)');
  }
  console.log();

  // =========================================================================
  // 2-BO'LIM — GIGIENA: qaysi bayroq nega o'chadi
  // =========================================================================
  console.log('── 2. GIGIENA: o‘chiriladigan bayroqlar (J2 vazifa 1–2) ──');
  const offPlan = planFlagOff(
    flagged.map((p) => ({
      id: p.id,
      name: p.name,
      uom: p.uom,
      meterUom: isMeterUom(p.uom),
      activePieces: activePieceByProduct.get(p.id) ?? 0,
    })),
  );
  const REASON_TEXT: Record<string, string> = {
    'birlik-metr-emas': 'birligi metr EMAS — bayroq XATO qo‘yilgan (J2/1)',
    'reyestr-bosh':
      "reyestri bo'sh — bo'sh reyestr + cheklangan taqsimot = foydasi yo'q, xavfi bor (J-reja 3.2)",
    'reyestr-tolgan': "🔴 reyestri TO'LGAN — QAROR odamniki, skript o'zi o'chirmaydi (`--force`)",
  };
  if (offPlan.length === 0) console.log('   (o‘chiriladigan bayroq yo‘q)');
  for (const row of offPlan) {
    const mark = row.safe ? 'O‘CHADI ' : FORCE ? 'O‘CHADI*' : 'QOLADI  ';
    console.log(`   ${mark} ${pad(row.name, 26)} ${REASON_TEXT[row.reason]}`);
  }
  const toApply = offPlan.filter((r) => r.safe || FORCE);
  console.log();
  console.log(
    `   ⇒ ${toApply.length} ta bayroq o‘chadi, ${offPlan.length - toApply.length} ta qoladi.`,
  );
  console.log();

  // =========================================================================
  // 3-BO'LIM — PILOT NOMZODLARI
  // =========================================================================
  const candidates = rankCandidates(meters.filter(inGroup).map(build));
  console.log(
    `── 3. PILOT NOMZODLARI (birligi metr, papka/nom ichida «${GROUP_NEEDLES.join('» yoki «')}») ──`,
  );
  console.log(
    `   Katalogdagi metr tovarlar: ${meters.length} · guruh filtriga tushgani: ${candidates.length}`,
  );
  // 🔴 «Metr» sonini SQL emas, `isMeterUom` beradi (K6 qarori: `Product.uom`
  // erkin matn). Ro'yxat ATAYLAB TOR va YOPIQ — `мм`/`м2`/`м3`/`мл` metr EMAS.
  // Shuning uchun bu son «uom LIKE 'м%'» bilan MOS TUSHMAYDI va farqi jimgina
  // qolmasligi kerak: qaysi yozuv tanilmagani ISM bilan chiqadi.
  const meterish = new Map<string, number>();
  for (const p of products) {
    const raw = (p.uom ?? '').trim();
    if (!raw || isMeterUom(raw)) continue;
    if (/^[мm]/i.test(raw)) meterish.set(raw, (meterish.get(raw) ?? 0) + 1);
  }
  console.log(
    `   «м/m» bilan boshlanadigan, lekin metr DEB TANILMAGAN birliklar: ${
      meterish.size === 0
        ? '(yo‘q — tanish ro‘yxati hamma yozuvni qamragan)'
        : [...meterish.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([u, n]) => `«${u}» ${n}`)
            .join(' · ')
    }`,
  );
  // ⚠️ J-reja §1 «632 ta «м» tovar» deb yozgan. Farq qayerdan kelgani JIM
  // qolmasin: yuqoridagi son TIRIK tovarlarniki (`deleted_at IS NULL`).
  const deleted = await prisma.product.findMany({
    where: { accountId, deletedAt: { not: null } },
    select: { uom: true },
  });
  const deletedMeters = deleted.filter((p) => isMeterUom(p.uom)).length;
  const allProducts = await prisma.product.count({ where: { accountId } });
  console.log(
    `   Solishtirish uchun: akkauntda jami tovar ${allProducts} · o‘chirilgani ${deleted.length} (shundan metr ${deletedMeters}) ⇒ metr JAMI ${meters.length + deletedMeters}, tiriklari ${meters.length}.`,
  );
  console.log();
  console.log('   Guruh kesimi:');
  console.log(
    `   ${pad('Papka', 34)} ${padL('Tovar', 6)} ${padL('Manba=1', 8)} ${padL('30k sotilgan', 13)} ${padL('Jami qoldiq', 16)}`,
  );
  for (const g of summarizeGroups(candidates)) {
    console.log(
      `   ${pad(g.folder, 34)} ${padL(String(g.products), 6)} ${padL(String(g.singleSource), 8)} ${padL(String(g.sold30), 13)} ${padL(num(g.totalQty), 16)}`,
    );
  }
  console.log();

  const eligible = candidates.filter((c) => c.eligible);
  console.log(
    `   Kiritilishi MUMKIN (manbasi AYNAN 1 va qoldig‘i bor): ${eligible.length} · to‘sig‘i bor: ${candidates.length - eligible.length}`,
  );
  console.log();
  console.log(
    `   ${pad('Tovar', 30)} ${pad('Papka', 20)} ${padL('Qoldiq', 13)} ${padL('Manba', 6)} ${padL('Eng katta', 13)} ${padL('30k chek', 9)} ${padL('30k mikd.', 11)}  Holat`,
  );
  const shown = candidates.slice(0, CANDIDATE_LIMIT);
  for (const c of shown) {
    const status = c.eligible ? '✔ mumkin' : `✘ ${c.blockers.join(', ')}`;
    console.log(
      `   ${pad(c.name, 30)} ${pad(c.folder, 20)} ${padL(num(c.sources.totalQty), 13)} ${padL(String(c.sources.reachableCount), 6)} ${padL(num(c.sources.largestReachableQty), 13)} ${padL(String(c.receipts30), 9)} ${padL(num(c.qty30), 11)}  ${status}`,
    );
  }
  if (candidates.length > shown.length) {
    console.log(
      `   … yana ${candidates.length - shown.length} ta ko‘rsatilmadi (chegara ${CANDIDATE_LIMIT}).`,
    );
  }
  console.log();
  console.log('   🔴 RO‘YXATNI SKRIPT TANLAMAYDI. 5–8 tovarni EGASI tanlaydi (J2 vazifa 4).');
  console.log();

  // =========================================================================
  // 4-BO'LIM — YOZISH (faqat --apply)
  // =========================================================================
  console.log('── 4. BAYROQNI O‘CHIRISH ──');
  if (toApply.length === 0) {
    console.log('   (o‘chiriladigan yo‘q)');
  } else if (!APPLY) {
    for (const row of toApply) {
      console.log(
        `   DRY  POST /stock-pieces/flag { assortmentId: ${row.id}, pieceTracked: false }  · ${row.name}`,
      );
    }
    console.log('   (hech nima yozilmadi — `--apply` bering)');
  } else {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET topilmadi (apps/api/.env ni source qiling)');
    const admin = await prisma.employee.findFirstOrThrow({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        accountId: true,
        email: true,
        name: true,
        username: true,
        hrRoles: true,
        isChecker: true,
      },
    });
    const token = new JwtService({ secret }).sign(
      {
        sub: admin.id,
        accountId: admin.accountId,
        email: admin.email,
        name: admin.name,
        username: admin.username,
        hrRoles: admin.hrRoles,
        isChecker: admin.isChecker,
        uiMode: 'full',
        hrPermissions: [],
      },
      { expiresIn: '30m' },
    );
    console.log(`   Token: ${admin.name} (${admin.username ?? admin.email ?? admin.id})`);
    for (const row of toApply) {
      const res = await call(token, 'POST', '/stock-pieces/flag', {
        assortmentId: row.id,
        pieceTracked: false,
      });
      console.log(
        `   OK   ${pad(row.name, 26)} pieceTracked=${res?.pieceTracked} · qaror muhri ${res?.decidedAt ?? '—'}`,
      );
    }
  }
  console.log();

  // =========================================================================
  // 5-BO'LIM — QABUL MEZONI
  // =========================================================================
  const after = APPLY
    ? await prisma.product.count({ where: { accountId, deletedAt: null, pieceTracked: true } })
    : flagged.length - toApply.length;
  console.log('── 5. QABUL MEZONI (J2) ──');
  console.log(
    `   1) jonlida \`piece_tracked = true\` soni 0        : ${after === 0 ? '✔' : '✘'} (${APPLY ? 'o‘lchandi' : 'bashorat'} ${after})`,
  );
  console.log(
    `   2) audit skripti nomzodlarni manba soni bilan ko‘rsatdi : ✔ (3-bo‘lim, ${candidates.length} qator)`,
  );
  console.log(
    '   3) egasi 5–8 tovarlik ro‘yxatni tasdiqlagan          : hisobotda (skript qaror qilmaydi)',
  );
  console.log();
  console.log('════════ TUGADI ════════');
}

main()
  .catch((e) => {
    console.error('XATO:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
