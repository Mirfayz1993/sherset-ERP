import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { MyKpiController } from './my-kpi.controller.js';

/**
 * X5 — «xodim FAQAT o'zini ko'radi» shartnomasining KONTROLLER qulfi
 * (X-reja 0-bo'lim 7-qoidasi; X2 `my-history.controller.test.ts` naqshi).
 *
 * Bu yerda: kim so'ralayotgani QAYERDAN olinadi. Servis darajasidagi qulf
 * (prisma `where`, javob maydonlari) — `my-kpi.service.test.ts` da.
 */

const me: AuthenticatedUser = {
  sub: 'xodim-1',
  accountId: 'acc-1',
} as AuthenticatedUser;

function makeController() {
  const listMine = vi.fn().mockResolvedValue({ limit: 30, total: 0, days: [] });
  return { ctrl: new MyKpiController({ listMine } as never), listMine };
}

describe("GET /hr/kpi/my — o'z-o'ziga qat'iy bog'langan", () => {
  it("employeeId ni token'dan (user.sub) oladi", async () => {
    const { ctrl, listMine } = makeController();
    await ctrl.my(me, {});

    expect(listMine).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 30 });
  });

  it("🔴 ?employeeId= bilan O'ZGA xodimni so'rab bo'lmaydi — parametr e'tiborsiz", async () => {
    const { ctrl, listMine } = makeController();
    await ctrl.my(me, { employeeId: 'boshqa-xodim', limit: 10 });

    // Uchinchi argument — FAQAT limit; ikkinchisi hamon token egasi.
    expect(listMine).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 10 });
    expect(listMine).not.toHaveBeenCalledWith(expect.anything(), 'boshqa-xodim', expect.anything());
  });

  it("🔴 ?accountId= ham e'tiborsiz — akkaunt ham token'dan", async () => {
    const { ctrl, listMine } = makeController();
    await ctrl.my(me, { accountId: 'boshqa-akkaunt', employeeId: 'boshqa-xodim' });

    expect(listMine).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 30 });
  });

  it("🔴 sxemada `employeeId` maydoni UMUMAN yo'q — zod uni tashlab yuboradi", async () => {
    const { ctrl, listMine } = makeController();
    await ctrl.my(me, { employeeId: 'boshqa-xodim' });

    const passed = listMine.mock.calls[0]?.[2];
    expect(passed).not.toHaveProperty('employeeId');
    expect(Object.keys(passed as object)).toEqual(['limit']);
  });

  it("so'rovsiz (undefined) chaqiruvda sukut limit — 30", async () => {
    const { ctrl, listMine } = makeController();
    await ctrl.my(me, undefined);

    expect(listMine).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 30 });
  });

  it("noto'g'ri limit rad etiladi (0, manfiy, 91, matn)", async () => {
    const { ctrl, listMine } = makeController();

    await expect(ctrl.my(me, { limit: 0 })).rejects.toThrow();
    await expect(ctrl.my(me, { limit: -1 })).rejects.toThrow();
    await expect(ctrl.my(me, { limit: 91 })).rejects.toThrow();
    await expect(ctrl.my(me, { limit: 'ko`p' })).rejects.toThrow();
    expect(listMine).not.toHaveBeenCalled();
  });

  /**
   * 🔴 DARVOZA QULFI. `@RequireHrPermission` bu yo'lda ATAYLAB yo'q
   * (sabab kontroller izohida: `oylik` — oylik sahifasi, KPI emas; HR
   * sahifa-ruxsati oddiy xodimda umuman bo'lmaydi). Ammo `JwtAuthGuard`
   * YO'QOLSA yo'l butunlay ochilib qolardi — 2026-08-10 hodisasi
   * (`pos-endpoint-guards.test.ts`) aynan shu klass. Shuning uchun manba
   * matni tekshiriladi.
   */
  it('kontroller `JwtAuthGuard` bilan yopilgan', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/modules/hr/hr-kpi/my-kpi.controller.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(src).toMatch(/@UseGuards\(\s*JwtAuthGuard\s*\)/);
    // O'z qamrovini bosib o'tadigan parametr kontrollerda o'qilmaydi.
    expect(src).not.toMatch(/employeeId/);
  });
});
