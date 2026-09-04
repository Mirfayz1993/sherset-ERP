import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { HrPermissionGuard } from '../hr-auth/hr-permission.guard.js';
import { MyPayrollController } from './my-payroll.controller.js';

/**
 * X6 — «xodim FAQAT o'z oyligini ko'radi» shartnomasining KONTROLLER va
 * DARVOZA qulfi (X-reja 0-bo'lim 7-qoidasi; X2 `my-history.controller.test.ts`,
 * X3 `my-tasks.controller.test.ts`, X5 `my-kpi.controller.test.ts` naqshi).
 *
 * Bu yerda: (a) kim so'ralayotgani QAYERDAN olinadi, (b) `oylik` darvozasi
 * HAQIQATAN yopiqmi. Servis darajasidagi qulf (prisma `where`, javob
 * maydonlari, boshqa akkaunt) — `my-payroll.service.test.ts` da.
 *
 * 🔴 Darvoza testi haqiqiy `HrPermissionGuard` va haqiqiy `Reflector` bilan
 * yuritiladi, metadata esa kontroller metodining O'ZIDAN o'qiladi. Ya'ni
 * `@RequireHrPermission` dekoratori olib tashlansa yoki darajasi
 * bo'shatilsa test yiqiladi — 2026-08-10 dagi «dekorator bezakka aylandi»
 * klassining oldi shu bilan olinadi.
 */

const me: AuthenticatedUser = {
  sub: 'xodim-1',
  accountId: 'acc-1',
} as AuthenticatedUser;

function makeController() {
  const myMonthly = vi.fn().mockResolvedValue({ yearMonth: '2026-09', status: 'not_computed' });
  return { ctrl: new MyPayrollController({ myMonthly } as never), myMonthly };
}

function controllerSource(): string {
  return readFileSync(
    join(process.cwd(), 'src/modules/hr/hr-salary/my-payroll.controller.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe("GET /hr/payroll/my/:yearMonth — o'z-o'ziga qat'iy bog'langan", () => {
  it("accountId va employeeId ni token'dan (user.accountId / user.sub) oladi", async () => {
    const { ctrl, myMonthly } = makeController();
    await ctrl.my(me, '2026-09');

    expect(myMonthly).toHaveBeenCalledWith('acc-1', 'xodim-1', '2026-09');
  });

  it("🔴 kontrollerda `employeeId` so'zi UMUMAN yo'q — o'zgani so'rash yo'li yopiq", () => {
    expect(controllerSource()).not.toMatch(/employeeId/);
  });

  it("🔴 kontroller `@Query` ni ham, `@Body` ni ham o'qimaydi", () => {
    const src = controllerSource();
    // Oy — YO'L parametri. So'rov satri o'qilmasa `?employeeId=` qayerga
    // qo'yilsa ham hech qanday maydonni to'ldira olmaydi.
    expect(src).not.toMatch(/@Query\(/);
    expect(src).not.toMatch(/@Body\(/);
    expect(src).toMatch(/@Param\(\s*'yearMonth'\s*\)/);
  });

  it('🔴 darvoza dekoratorlari manbada turibdi', () => {
    const src = controllerSource();
    expect(src).toMatch(/@UseGuards\(\s*JwtAuthGuard\s*,\s*HrPermissionGuard\s*\)/);
    expect(src).toMatch(/@RequireHrPermission\(\s*'oylik'\s*,\s*'own_only'\s*\)/);
  });

  it("noto'g'ri yearMonth rad etiladi (13-oy, 0-oy, kun bilan, qisqa, bo'sh, yo'l)", async () => {
    const { ctrl, myMonthly } = makeController();

    await expect(ctrl.my(me, '2026-13')).rejects.toThrow();
    await expect(ctrl.my(me, '2026-00')).rejects.toThrow();
    await expect(ctrl.my(me, '2026-09-01')).rejects.toThrow();
    await expect(ctrl.my(me, '2026-9')).rejects.toThrow();
    await expect(ctrl.my(me, '')).rejects.toThrow();
    await expect(ctrl.my(me, '../2026-09')).rejects.toThrow();
    expect(myMonthly).not.toHaveBeenCalled();
  });

  it("to'g'ri oy o'tadi (chegaralar: 01 va 12)", async () => {
    const { ctrl, myMonthly } = makeController();
    await ctrl.my(me, '2026-01');
    await ctrl.my(me, '2026-12');

    expect(myMonthly).toHaveBeenNthCalledWith(1, 'acc-1', 'xodim-1', '2026-01');
    expect(myMonthly).toHaveBeenNthCalledWith(2, 'acc-1', 'xodim-1', '2026-12');
  });
});

// ── Darvoza: `oylik:own_only` ────────────────────────────────────────────────

/** Metadata KONTROLLER METODIDAN o'qiladi — dekorator yo'qolsa test yiqiladi. */
function makeGuard() {
  const resolveScope = vi.fn().mockResolvedValue('NO');
  return {
    guard: new HrPermissionGuard(new Reflector(), { resolveScope } as never),
    resolveScope,
  };
}

function ctxFor(user: unknown): ExecutionContext {
  return {
    getHandler: () => MyPayrollController.prototype.my,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function user(over: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    sub: 'xodim-1',
    accountId: 'acc-1',
    hrRoles: [],
    hrPermissions: [],
    ...over,
  } as AuthenticatedUser;
}

function perm(pageKey: string, accessLevel: string) {
  return { pageKey, section: null, accessLevel } as never;
}

describe('darvoza — `oylik:own_only`', () => {
  it("🔴 `oylik` ruxsati UMUMAN yo'q xodim → 403", async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctxFor(user({})))).rejects.toThrow(/oylik/);
  });

  it('`oylik:own_only` yetadi', async () => {
    const { guard } = makeGuard();
    const ctx = ctxFor(user({ hrPermissions: [perm('oylik', 'own_only')] }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('`oylik:read` va `oylik:full` ham yetadi (daraja yuqoriroq)', async () => {
    const { guard } = makeGuard();
    await expect(
      guard.canActivate(ctxFor(user({ hrPermissions: [perm('oylik', 'read')] }))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctxFor(user({ hrPermissions: [perm('oylik', 'full')] }))),
    ).resolves.toBe(true);
  });

  it("🔴 BOSHQA sahifada `full` bo'lsa ham `oylik` ochilmaydi", async () => {
    const { guard, resolveScope } = makeGuard();
    const ctx = ctxFor(user({ hrPermissions: [perm('employees', 'full'), perm('tasks', 'full')] }));
    await expect(guard.canActivate(ctx)).rejects.toThrow(/oylik/);
    // `employees` fallback'i FAQAT `employees` sahifasi uchun — bu yo'lda
    // core-RBAC qamrovi umuman so'ralmasligi kerak.
    expect(resolveScope).not.toHaveBeenCalled();
  });

  it('admin roli o`tadi (guard shartnomasi)', async () => {
    const { guard } = makeGuard();
    const ctx = ctxFor(user({ hrRoles: ['admin'] }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("token'siz so'rov → 403", async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toThrow();
  });

  it("🔴 dekorator HAQIQATAN metodda — metadata o'qib tekshiriladi", () => {
    const required = new Reflector().get('hr_permission', MyPayrollController.prototype.my);
    expect(required).toEqual({ page: 'oylik', access: 'own_only', section: undefined });
  });
});
