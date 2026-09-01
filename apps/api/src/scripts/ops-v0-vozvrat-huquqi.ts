#!/usr/bin/env tsx
/**
 * V0 — VOZVRAT HUQUQINI TORAYTIRISH
 * (reja: `docs/plans/2026-09-01-pos-vozvrat-oynasi.md` → V0; egasining S-V1
 * javobi 2026-09-01: huquq **Shavkat + Muxriddin + admin/egasi** da qoladi).
 *
 * NIMA QILADI:
 *   1. O'LCHAYDI: qaysi rollarda `salesreturn` bor, ularda kimlar o'tiradi,
 *      kimda xodim-darajali override bor (hisobot har doim chiqadi, DRY ham).
 *   2. `templateSlug='cashier'` rollardan **faqat `salesreturn.create`** ni
 *      olib tashlaydi (`view` QOLADI — ro'yxat ko'rinishi buzilmasin).
 *      ⚠️ FAQAT kassir-shablonli rollar: admin/owner/ofis rollariga TEGILMAYDI
 *      (ofisdagi «Xaridor qaytarishlari» moduli ishlayveradi).
 *   3. Shavkat va Muxriddinga xodim-override yozadi:
 *      `salesreturn.create = ALL` (MK26 qatlami — rol qatlamidan G'OLIB).
 *
 * NEGA ROLDAN OLIB, ODAMGA OVERRIDE: rol qatlamida qoldirsak har yangi kassir
 * avtomatik vozvrat huquqi bilan tug'iladi (default-allow). Endi default-deny:
 * yangi kassirga kerak bo'lsa egasi UI'da (xodim kartasi, MK26) o'zi ochadi.
 *
 * QAYTARISH: hisobotdagi «OLDIN» blokini saqlang — teskari amal:
 *   - rolga: PATCH /roles/:id ga o'sha matritsani qaytarish (yoki UI'da
 *     kassir shablonini qayta qo'llash — u `salesreturn.create` ni tiklaydi);
 *   - override: PUT /roles/employee/:id/permissions cells=[{...scope:null}].
 *
 * Ishga tushirish (box):
 *   cd /var/www/sherset-v2/apps/api && set -a && . ./.env && set +a && \
 *   ./node_modules/.bin/tsx src/scripts/ops-v0-vozvrat-huquqi.ts          # DRY
 *   …/ops-v0-vozvrat-huquqi.ts --apply                                    # yozadi
 */
import { PrismaClient } from '@moysklad/db';
import { JwtService } from '@nestjs/jwt';

const prisma = new PrismaClient();
const API_BASE = process.env.V0_API_BASE ?? 'http://localhost:4001/api/v1';
const APPLY = process.argv.includes('--apply');

/** Egasining S-V1 javobi (2026-09-01): huquq shu xodimlarda qoladi. */
const KEEP_NAMES = ['shavkat', 'muxriddin'] as const;

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const acc = await prisma.account.findFirstOrThrow({ select: { id: true, name: true } });
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET topilmadi (apps/api/.env ni source qiling)');
  const admin = await prisma.employee.findFirstOrThrow({
    where: { accountId: acc.id },
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

  console.log('════════ V0 · VOZVRAT HUQUQI ════════');
  console.log(`Rejim:   ${APPLY ? 'APPLY (yoziladi)' : 'DRY (hech nima yozilmaydi)'}`);
  console.log(`Akkaunt: ${acc.name} · token: ${admin.name}`);
  console.log();

  // ── 1. OLDIN: rol qatlami ────────────────────────────────────────────────
  const roles = await prisma.role.findMany({
    where: { accountId: acc.id },
    select: {
      id: true,
      name: true,
      templateSlug: true,
      version: true,
      permissions: { select: { entity: true, action: true, scope: true } },
      employees: { select: { employee: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  console.log('── OLDIN: `salesreturn` bor rollar (qaytarish uchun saqlang) ──');
  const cashierRolesWithCreate: typeof roles = [];
  for (const r of roles) {
    const sr = r.permissions.filter((p) => p.entity === 'salesreturn' && p.scope !== 'NO');
    if (sr.length === 0) continue;
    const cells = sr.map((p) => `${p.action}:${p.scope}`).join(' ');
    const members = r.employees.map((e) => e.employee.name).join(', ') || '(boʻsh)';
    console.log(`   ${r.name} [${r.templateSlug ?? 'shablonsiz'}] · ${cells}`);
    console.log(`      xodimlar: ${members}`);
    if (r.templateSlug === 'cashier' && sr.some((p) => p.action === 'create')) {
      cashierRolesWithCreate.push(r);
    }
  }
  console.log();

  // ── 1b. OLDIN: mavjud override'lar ───────────────────────────────────────
  const overrides = await prisma.employeePermission.findMany({
    where: { accountId: acc.id, entity: 'salesreturn' },
    select: { employeeId: true, action: true, scope: true, employee: { select: { name: true } } },
  });
  console.log('── OLDIN: `salesreturn` boʻyicha xodim-overrideʻlar ──');
  if (overrides.length === 0) console.log('   (yoʻq)');
  for (const o of overrides) console.log(`   ${o.employee.name}: ${o.action}=${o.scope}`);
  console.log();

  // ── 2. Kassir rollaridan `salesreturn.create` ni olib tashlash ───────────
  console.log('── QADAM 2: kassir-shablonli rollardan `salesreturn.create` ──');
  if (cashierRolesWithCreate.length === 0) {
    console.log('   SKIP — kassir rollarida `salesreturn.create` topilmadi');
  }
  for (const r of cashierRolesWithCreate) {
    // PATCH TO'LIQ matritsani kutadi (diff emas) — bitta katakcha olib
    // tashlangan holda qayta yuboriladi; `version` optimistik qulf.
    const nextMatrix = r.permissions
      .filter((p) => !(p.entity === 'salesreturn' && p.action === 'create'))
      .map((p) => ({ entity: p.entity, action: p.action, scope: p.scope }));
    console.log(
      `   ${r.name}: ${r.permissions.length} katak -> ${nextMatrix.length} (salesreturn.create olib tashlanadi, view qoladi)`,
    );
    if (APPLY) {
      await call(token, 'PATCH', `/roles/${r.id}`, {
        permissions: nextMatrix,
        version: r.version,
      });
      console.log('   OK       yozildi');
    } else {
      console.log(
        `   DRY      PATCH /roles/${r.id} { permissions: ${nextMatrix.length}, version: ${r.version} }`,
      );
    }
  }
  console.log();

  // ── 3. Shavkat + Muxriddin: override `salesreturn.create = ALL` ──────────
  console.log('── QADAM 3: saqlanadigan xodimlarga override ──');
  for (const wanted of KEEP_NAMES) {
    const hits = await prisma.employee.findMany({
      where: { accountId: acc.id, name: { contains: wanted, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (hits.length === 0) {
      console.log(`   🔴 «${wanted}» nomli xodim TOPILMADI — qo'lda tekshiring (kiril yozuvi?)`);
      continue;
    }
    if (hits.length > 1) {
      console.log(
        `   🔴 «${wanted}» bir nechta xodimga mos: ${hits.map((h) => h.name).join(' | ')} — qo'lda aniqlashtiring`,
      );
      continue;
    }
    const emp = hits[0];
    if (!emp) continue;
    console.log(`   ${emp.name}: salesreturn.create = ALL (override, MK26)`);
    if (APPLY) {
      await call(token, 'PUT', `/roles/employee/${emp.id}/permissions`, {
        cells: [
          {
            entity: 'salesreturn',
            action: 'create',
            scope: 'ALL',
            note: 'V0 vozvrat huquqi — egasi 2026-09-01',
          },
        ],
      });
      console.log('   OK       yozildi');
    } else {
      console.log(`   DRY      PUT /roles/employee/${emp.id}/permissions`);
    }
  }
  console.log();

  // ── 4. KEYIN: kimda amalda vozvrat huquqi qoladi (nazorat kesimi) ────────
  // Amaldagi ruxsat = rol qatlami MAX(scope), override bo'lsa u G'OLIB.
  console.log('── KEYIN (hisob-kitob): kimda `salesreturn.create` amalda qoladi ──');
  const employees = await prisma.employee.findMany({
    where: { accountId: acc.id },
    select: {
      id: true,
      name: true,
      roles: {
        select: { role: { select: { name: true, templateSlug: true, permissions: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });
  const grantsCreate = (p: { entity: string; action: string; scope: string }) =>
    p.entity === 'salesreturn' && p.action === 'create' && p.scope !== 'NO';
  for (const emp of employees) {
    const hasNow = emp.roles.some((r) => r.role.permissions.some(grantsCreate));
    // APPLY'dan keyingi model: kassir rollari endi create bermaydi; override
    // (mavjudi yoki shu skript yozadigani) rol qatlamidan G'OLIB.
    const fromRolesAfter = emp.roles
      .filter((r) => r.role.templateSlug !== 'cashier')
      .some((r) => r.role.permissions.some(grantsCreate));
    const override =
      overrides.find((o) => o.employeeId === emp.id && o.action === 'create') ??
      (KEEP_NAMES.some((w) => emp.name.toLowerCase().includes(w)) ? { scope: 'ALL' } : null);
    const hasAfter = override ? override.scope !== 'NO' : fromRolesAfter;
    if (hasNow || hasAfter) {
      const sabab = override
        ? '(override)'
        : fromRolesAfter
          ? '(kassir boʻlmagan rol)'
          : '(faqat kassir roli edi)';
      console.log(`   ${emp.name.padEnd(24)} ${hasAfter ? '✅ QOLADI' : '⛔ YOʻQOLADI'} ${sabab}`);
    }
  }

  console.log();
  if (!APPLY) console.log('DRY — `--apply` berilmadi, hech nima yozilmadi.');
  console.log(
    '⚠️ Kassirlar ochiq POS oynasini bir marta yangilagach tugma yoʻqoladi ' +
      '(permissions-me keshi 5 daq). Server qulfi darhol kuchda.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
