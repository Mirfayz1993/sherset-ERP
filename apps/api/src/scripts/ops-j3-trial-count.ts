#!/usr/bin/env tsx
/**
 * J3 — SINOV SANOG'I (omborchi profilidan, jonli oqimni sanoqdan OLDIN isbotlash)
 * Reja: `docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md` → J3.
 *
 * NIMA QILADI:
 *   1. **O'LCHAYDI** (DRY ham, APPLY ham): pilot tovarining jonli qoldig'i,
 *      reyestrdagi faol qatorlari, bayrog'i va sanoqni bajaradigan xodimning
 *      `piecetracking` huquqlari.
 *   2. `--apply` bilan **OLTI QADAMLI SINOV ZANJIRINI** yuritadi — SQL EMAS,
 *      UI aynan bosadigan marshrutlar orqali, **omborchi tokeni ostida**:
 *        butun rulon qo'shish → bo'lak qo'shish (yorliq) → yorliqni
 *        skanerlash → begona kodni skanerlash (RAD etilishi shart, 7.3) →
 *        ikkala qatorni «tugadi» qilish.
 *      Har qadamdan keyin sverka O'LCHANADI va `j3-trial-core.ts` da
 *      OLDINDAN yozilgan kutilma bilan solishtiriladi.
 *   3. Oxirida `Stock.qty` qayta o'qiladi — **stok-neytrallik** jonlida
 *      o'lchanadi (K2 poydevori: reyestrga yozish qoldiqqa tegmaydi).
 *
 * 🔴 BU HAQIQIY SANOQ EMAS. J3 ning 1–2-vazifalari (omborchining jismoniy
 * sanog'i) SHU SKRIPT BILAN BAJARILMAYDI va bajarilmasligi kerak: reyestrga
 * faqat omborchi SANAGAN son kiritiladi (J-reja qoida 5). Skript kiritadigan
 * 250 m va 37,5 m — SINOV qatorlari va ular o'sha yugurishning oxirida
 * `consumed` qilinadi.
 *
 * 🔴 BAYROQQA TEGMAYDI. `/stock-pieces/flag` marshruti bu skriptda YO'Q —
 * bayroqni yoqish J4 ning ishi (J3 prompti taqiqlaydi).
 *
 * ⚠️ `close` qator O'CHIRMAYDI, `consumed` qiladi (K2 da `DELETE` ataylab
 * yo'q). Ya'ni sinovdan keyin `stock_pieces` da IKKI iz abadiy qoladi va
 * bittasi `BLK-` yorlig'ini band qiladi. Bu KUTILGAN natija, nuqson emas.
 *
 * Ishga tushirish (box):
 *   cd /var/www/sherset-v2/apps/api && set -a && . ./.env && set +a && \
 *   ./node_modules/.bin/tsx src/scripts/ops-j3-trial-count.ts              # DRY
 *   …/ops-j3-trial-count.ts --apply                                        # sinov yuradi
 *   …/ops-j3-trial-count.ts --apply --product="Uz punp 2x2.5"              # boshqa tovar
 *   …/ops-j3-trial-count.ts --apply --cleanup                              # uzilgan sinov izini yopish
 *
 * Env: `J3_API_BASE` (default `http://localhost:4001/api/v1`), `JWT_SECRET`.
 */
import { PrismaClient } from '@moysklad/db';
import { JwtService } from '@nestjs/jwt';

import {
  CLOSE_BODY,
  type TrialBaseline,
  type TrialStep,
  expectAfter,
  isRestored,
  matches,
  planTrial,
  stockVerdict,
} from './j3-trial-core.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
/**
 * Uzilib qolgan sinovning izini yopish rejimi. FAQAT `close` marshrutini
 * chaqiradi — qator o'chirilmaydi, qoldiqqa tegilmaydi (J-reja qoida 12).
 */
const CLEANUP = process.argv.includes('--cleanup');
const API = process.env.J3_API_BASE ?? 'http://localhost:4001/api/v1';

const argOf = (name: string, fallback: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : fallback;
};

/** Pilot-A ro'yxatining birinchi tovari (egasi 2026-09-04 da tanladi). */
const PRODUCT_NAME = argOf('product', 'Uz apunp 2x4');
const STORE_NAME = argOf('store', 'Taqsimlanmagan');
/** Sanoqni bajaradigan xodim — «Katta omborchi» roli (J3, egasining tanlovi). */
const ACTOR = argOf('actor', 'Muxriddin');

const prisma = new PrismaClient();

interface CallResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<CallResult> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

const pad = (s: string, n: number) =>
  s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
const mark = (ok: boolean) => (ok ? '✔' : '✘');

function num(value: string): string {
  const [int = '0', frac] = value.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped},${frac}` : grouped;
}

/** Javobdan (ombor × tovar) sverkasini olish. */
function totalsOf(body: unknown): { registryQty: string; activePieces: number; diffQty: string } {
  const view = (body as { view?: { totals?: Record<string, unknown> } })?.view?.totals;
  return {
    registryQty: String(view?.registryQty ?? '0'),
    activePieces: Number(view?.activePieces ?? 0),
    diffQty: String(view?.diffQty ?? '0'),
  };
}

/** Javobdagi FAOL qatorlardan yorliqli bo'lak va yorliqsiz rulon ID larini yig'ish. */
function idsOf(body: unknown): {
  pieces: Array<{ id: string; label: string | null }>;
  whole: string[];
} {
  const cells =
    (
      body as {
        view?: {
          cells?: Array<{
            pieces?: Array<{ id: string; label: string | null }>;
            wholeGroups?: Array<{ pieceIds?: string[] }>;
          }>;
        };
      }
    )?.view?.cells ?? [];
  const pieces: Array<{ id: string; label: string | null }> = [];
  const whole: string[] = [];
  for (const cell of cells) {
    for (const p of cell.pieces ?? []) pieces.push({ id: p.id, label: p.label });
    for (const g of cell.wholeGroups ?? []) whole.push(...(g.pieceIds ?? []));
  }
  return { pieces, whole };
}

async function main() {
  const acc = await prisma.account.findFirstOrThrow({ select: { id: true, name: true } });
  const accountId = acc.id;

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(
    `  J3 — SINOV SANOG'I${APPLY ? '  ·  --apply (JONLIGA YOZADI)' : '  ·  DRY (yozilmaydi)'}`,
  );
  console.log(`  Akkaunt: ${acc.name}  ·  API: ${API}`);
  console.log('════════════════════════════════════════════════════════════════════════');

  // =========================================================================
  // 1-BO'LIM — DOIRA VA IJROCHI
  // =========================================================================
  console.log('');
  console.log("1-BO'LIM — DOIRA VA IJROCHI");
  console.log('');

  const store = await prisma.store.findFirstOrThrow({
    where: { accountId, name: STORE_NAME },
    select: { id: true, name: true },
  });
  const product = await prisma.product.findFirstOrThrow({
    where: { accountId, name: PRODUCT_NAME, deletedAt: null },
    select: { id: true, name: true, uom: true, pieceTracked: true },
  });

  const actor = await prisma.employee.findFirstOrThrow({
    where: {
      accountId,
      OR: [{ name: ACTOR }, { email: ACTOR }, { username: ACTOR }],
    },
    select: {
      id: true,
      accountId: true,
      email: true,
      name: true,
      username: true,
      hrRoles: true,
      isChecker: true,
      roles: { select: { role: { select: { id: true, name: true } } } },
    },
  });

  const grants = await prisma.rolePermission.findMany({
    where: {
      entity: 'piecetracking',
      roleId: { in: actor.roles.map((r) => r.role.id) },
    },
    select: { action: true, scope: true, roleId: true },
  });
  const canWrite = ['create', 'update'].every((a) =>
    grants.some((g) => g.action === a && g.scope !== 'NO'),
  );

  console.log(`   Ombor:   ${store.name}`);
  console.log(`   Tovar:   ${product.name}  ·  birlik «${product.uom ?? '—'}»`);
  console.log(`   Bayroq:  pieceTracked = ${product.pieceTracked}`);
  console.log(`   Ijrochi: ${actor.name} (${actor.username ?? actor.email})`);
  console.log(`            rollar: ${actor.roles.map((r) => r.role.name).join(', ') || '—'}`);
  console.log(
    `            piecetracking: ${
      grants.length === 0 ? "YO'Q" : [...new Set(grants.map((g) => g.action))].sort().join(' ')
    }  ${mark(canWrite)}`,
  );

  if (!canWrite) {
    throw new Error(
      `${actor.name} da piecetracking create+update YO'Q — sinov o'sha profildan yurita olmaydi`,
    );
  }

  // 🔴 Bayroq yoqiq bo'lsa sinov jonli KASSA xulqiga tegadi (7.1 istisnosi) —
  // J3 ning butun tartibi «avval ma'lumot, keyin xulq» bo'lgani uchun to'xtaydi.
  if (product.pieceTracked && !FORCE) {
    throw new Error(
      `${product.name} da bayroq YOQIQ — sinov kassa xulqiga tegadi. J4 ning ishi (--force bilan majburlanadi)`,
    );
  }

  // =========================================================================
  // 2-BO'LIM — BOSHLANG'ICH O'LCHOV
  // =========================================================================
  console.log('');
  console.log("2-BO'LIM — BOSHLANG'ICH O'LCHOV (jonlidan)");
  console.log('');

  const stockRow = await prisma.stock.findFirst({
    where: { accountId, storeId: store.id, assortmentKind: 'product', assortmentId: product.id },
    select: { qty: true, reservedQty: true },
  });
  const activeBefore = await prisma.stockPiece.count({
    where: { accountId, storeId: store.id, assortmentId: product.id, status: 'active' },
  });
  const allBefore = await prisma.stockPiece.count({
    where: { accountId, assortmentId: product.id },
  });
  const registryBefore = await prisma.stockPiece.aggregate({
    where: { accountId, storeId: store.id, assortmentId: product.id, status: 'active' },
    _sum: { length: true },
  });

  const baseline: TrialBaseline = {
    stockQty: (stockRow?.qty ?? 0).toString(),
    registryQty: (registryBefore._sum.length ?? 0).toString(),
    activePieces: activeBefore,
  };

  console.log(`   Stock.qty ................ ${padL(num(baseline.stockQty), 14)}`);
  console.log(
    `   Rezerv ................... ${padL(num((stockRow?.reservedQty ?? 0).toString()), 14)}`,
  );
  console.log(`   Reyestr (faol Σ) ......... ${padL(num(baseline.registryQty), 14)}`);
  console.log(
    `   Reyestr qatorlari ........ ${padL(String(activeBefore), 14)} faol · ${allBefore} jami`,
  );

  // Reyestri to'lgan tovarda sinov qilish ma'nosiz: kutilma boshqacha bo'ladi
  // va eng yomoni — omborchining haqiqiy sanog'i ustiga soxta qator qo'shilardi.
  // `--cleanup` bu to'siqdan ozod: u AYNAN o'sha faol qatorlarni yopish uchun bor.
  if (!CLEANUP && activeBefore > 0 && !FORCE) {
    throw new Error(
      `Reyestrda ${activeBefore} ta FAOL qator bor — sinov haqiqiy sanoq ustiga yozardi (--force bilan majburlanadi)`,
    );
  }

  // =========================================================================
  // 3-BO'LIM — SINOV ZANJIRI VA KUTILMALAR
  // =========================================================================
  const steps = planTrial({ storeId: store.id, assortmentId: product.id });

  console.log('');
  if (CLEANUP) {
    console.log("3-BO'LIM — TOZALASH (qoida 12 ning qaytarish yo'li)");
    console.log('');
    console.log(
      `   Doiradagi ${activeBefore} ta FAOL qator «tugadi» qilinadi — qoldiqqa TEGILMAYDI.`,
    );
  } else {
    console.log("3-BO'LIM — SINOV ZANJIRI (kutilmalar OLDINDAN yozilgan)");
    console.log('');
    console.log(`   ${pad('#', 3)}${pad('QADAM', 58)}${padL('KUTILGAN Σ', 12)}${padL('FARQ', 12)}`);
    steps.forEach((step, i) => {
      const exp = expectAfter(baseline, steps, i);
      console.log(
        `   ${pad(String(i + 1), 3)}${pad(step.title, 58)}${padL(num(exp.registryQty), 12)}${padL(num(exp.diffQty), 12)}`,
      );
    });
  }

  if (!APPLY) {
    console.log('');
    console.log("   ── DRY: quyidagi so'rovlar YUBORILMADI ──");
    if (CLEANUP) {
      console.log(`   POST /stock-pieces/<faol qator>/close  ×${activeBefore}`);
    } else {
      for (const step of steps) {
        console.log(`   ${step.method} ${step.path}`);
        if (step.body) console.log(`        ${JSON.stringify(step.body)}`);
      }
    }
    console.log('');
    console.log('   Hech nima yozilmadi. Yugurtirish uchun: --apply');
    console.log('');
    return;
  }

  // =========================================================================
  // 4-BO'LIM — YUGURISH (omborchi tokeni ostida)
  // =========================================================================
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET topilmadi (apps/api/.env ni source qiling)');

  const token = new JwtService({ secret }).sign(
    {
      sub: actor.id,
      accountId: actor.accountId,
      email: actor.email,
      name: actor.name,
      username: actor.username,
      hrRoles: actor.hrRoles,
      isChecker: actor.isChecker,
      uiMode: 'full',
      hrPermissions: [],
    },
    { expiresIn: '30m' },
  );

  console.log('');
  console.log(`4-BO'LIM — YUGURISH  ·  token: ${actor.name} (${actor.username ?? actor.email})`);
  console.log('');

  const scopePath = `/stock-pieces?storeId=${store.id}&assortmentId=${product.id}`;

  // -------------------------------------------------------------------------
  // TOZALASH REJIMI — uzilib qolgan sinovning izini yopadi (qoida 12).
  //
  // 🔴 Faqat `close` chaqiriladi: qator O'CHIRILMAYDI, qoldiqqa TEGILMAYDI.
  // Bu J-reja J3 ning «qaytarish yo'li» bandining aynan o'zi.
  // -------------------------------------------------------------------------
  if (CLEANUP) {
    const listed = await call(token, 'GET', scopePath);
    const ids = idsOf(listed.body);
    const targets = [
      ...ids.pieces.map((p) => ({ id: p.id, label: p.label ?? '—' })),
      ...ids.whole.map((id) => ({ id, label: '(butun rulon)' })),
    ];
    let closed = 0;
    for (const t of targets) {
      const res = await call(token, 'POST', `/stock-pieces/${t.id}/close`, CLOSE_BODY);
      console.log(`   ${mark(res.ok)} ${pad(t.label, 20)} ${res.status}`);
      if (res.ok) closed += 1;
    }
    const recheck = await call(token, 'GET', scopePath);
    const after = totalsOf(recheck.body);
    console.log('');
    console.log(`   Yopildi: ${closed}/${targets.length}`);
    console.log(
      `   Reyestr Σ: ${num(after.registryQty)} · faol qatorlar: ${after.activePieces} · farq ${num(after.diffQty)}`,
    );
    const stockNowC = (
      (
        await prisma.stock.findFirst({
          where: {
            accountId,
            storeId: store.id,
            assortmentKind: 'product',
            assortmentId: product.id,
          },
          select: { qty: true },
        })
      )?.qty ?? 0
    ).toString();
    console.log(
      `   Stock.qty: ${num(stockNowC)} (oldin ${num(baseline.stockQty)}) → ${stockVerdict(baseline.stockQty, stockNowC)}`,
    );
    console.log('');
    if (after.activePieces !== 0) process.exitCode = 1;
    return;
  }
  let wholeId: string | null = null;
  let pieceId: string | null = null;
  let issuedLabel: string | null = null;
  const results: Array<{ step: TrialStep; ok: boolean; note: string }> = [];

  for (const [i, step] of steps.entries()) {
    const path = step.path
      .replace(':label', issuedLabel ?? 'BLK-000000')
      .replace(':pieceId', pieceId ?? '00000000-0000-0000-0000-000000000000')
      .replace(':wholeId', wholeId ?? '00000000-0000-0000-0000-000000000000');

    const res = await call(token, step.method, path, step.body);

    // 7.3 sinovi: begona kod RAD etilishi SHART.
    if (step.expectFailure) {
      const ok = !res.ok && res.status === 400;
      results.push({
        step,
        ok,
        note: ok
          ? `RAD etildi (${res.status}) — bo'lak skaneri tovar makoniga tushmaydi`
          : `🔴 KUTILMAGAN: status ${res.status}`,
      });
      console.log(`   ${pad(String(i + 1), 3)}${pad(step.title, 58)} ${mark(ok)}  ${res.status}`);
      continue;
    }

    if (!res.ok) {
      results.push({
        step,
        ok: false,
        note: `🔴 ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`,
      });
      console.log(`   ${pad(String(i + 1), 3)}${pad(step.title, 58)} ✘  ${res.status}`);
      console.log(`        ${JSON.stringify(res.body).slice(0, 300)}`);
      break;
    }

    // Yaratilgan qatorlarning ID lari — yopish qadamlari shulardan foydalanadi.
    if (step.key === 'create-whole') {
      wholeId = idsOf(res.body).whole[0] ?? null;
    }
    if (step.key === 'create-piece') {
      const created = idsOf(res.body).pieces[0];
      pieceId = created?.id ?? null;
      issuedLabel = created?.label ?? (res.body as { labels?: string[] })?.labels?.[0] ?? null;
    }

    // Skaner qadami: AYNAN o'sha bo'lak ochilganini tekshiramiz (7.3).
    if (step.key === 'lookup-label') {
      const found = (res.body as { piece?: { id?: string; label?: string } })?.piece;
      const ok = found?.id === pieceId && found?.label === issuedLabel;
      results.push({
        step,
        ok,
        note: ok
          ? `${issuedLabel} → aynan o'sha bo'lak`
          : `🔴 boshqa qator qaytdi: ${found?.label}`,
      });
      console.log(
        `   ${pad(String(i + 1), 3)}${pad(step.title, 58)} ${mark(ok)}  ${issuedLabel ?? '—'}`,
      );
      continue;
    }

    // Har yozish qadamidan keyin sverka O'LCHANADI va kutilma bilan solishtiriladi.
    const exp = expectAfter(baseline, steps, i);
    const got = totalsOf(res.body);
    const ok = matches(exp.registryQty, got.registryQty) && exp.activePieces === got.activePieces;
    results.push({
      step,
      ok,
      note: ok
        ? `Σ ${num(got.registryQty)} · farq ${num(got.diffQty)}`
        : `🔴 kutilgan Σ ${num(exp.registryQty)}, o'lchangan ${num(got.registryQty)}`,
    });
    console.log(
      `   ${pad(String(i + 1), 3)}${pad(step.title, 58)} ${mark(ok)}  Σ ${padL(num(got.registryQty), 9)} · farq ${num(got.diffQty)}`,
    );
  }

  // =========================================================================
  // 5-BO'LIM — QAYTGANLIK VA STOK-NEYTRALLIK
  // =========================================================================
  console.log('');
  console.log("5-BO'LIM — QAYTGANLIK VA STOK-NEYTRALLIK");
  console.log('');

  const finalRes = await call(token, 'GET', scopePath);
  const finalTotals = totalsOf(finalRes.body);
  const restored = isRestored(baseline, {
    registryQty: finalTotals.registryQty,
    activePieces: finalTotals.activePieces,
    diffQty: finalTotals.diffQty,
  });

  const stockAfter = await prisma.stock.findFirst({
    where: { accountId, storeId: store.id, assortmentKind: 'product', assortmentId: product.id },
    select: { qty: true },
  });
  const stockNow = (stockAfter?.qty ?? 0).toString();
  const neutral = stockVerdict(baseline.stockQty, stockNow);

  const allAfter = await prisma.stockPiece.count({
    where: { accountId, assortmentId: product.id },
  });

  console.log(
    `   Reyestr Σ (yakuniy) ...... ${padL(num(finalTotals.registryQty), 14)}  (boshlang'ich ${num(baseline.registryQty)})`,
  );
  console.log(
    `   Faol qatorlar ............ ${padL(String(finalTotals.activePieces), 14)}  (boshlang'ich ${baseline.activePieces})`,
  );
  console.log(`   Boshlang'ich holat qaytdi  ${mark(restored)}`);
  console.log(
    `   Stock.qty ................ ${padL(num(stockNow), 14)}  (oldin ${num(baseline.stockQty)}) → ${neutral} ${mark(neutral === 'neytral')}`,
  );
  console.log(
    `   stock_pieces izlari ...... ${padL(String(allAfter), 14)}  (oldin ${allBefore}) — «consumed», ATAYLAB o'chirilmaydi`,
  );
  if (issuedLabel) {
    console.log(
      `   Band bo'lgan yorliq ...... ${issuedLabel}  ⇒ haqiqiy sanoq keyingi raqamdan boshlanadi`,
    );
  }

  // =========================================================================
  // 6-BO'LIM — QABUL MEZONI
  // =========================================================================
  console.log('');
  console.log("6-BO'LIM — SINOV HUKMI");
  console.log('');
  for (const [i, r] of results.entries()) {
    console.log(`   ${mark(r.ok)} ${pad(String(i + 1) + '. ' + r.step.title, 60)} ${r.note}`);
  }
  const allOk = results.length === steps.length && results.every((r) => r.ok);
  console.log('');
  console.log(`   ZANJIR: ${results.filter((r) => r.ok).length}/${steps.length}  ${mark(allOk)}`);
  console.log(
    `   QAYTGANLIK: ${mark(restored)}    STOK-NEYTRALLIK: ${mark(neutral === 'neytral')}`,
  );
  console.log('');

  if (!allOk || !restored) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('');
    console.error(`🔴 XATO: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
