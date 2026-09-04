import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { HrDavomatPingController } from './ping.controller.js';

/**
 * X2 — «xodim FAQAT o'zini ko'radi» shartnomasining qulfi
 * (X-reja 0-bo'lim 7-qoidasi).
 *
 * Bu yerdagi testlar KONTROLLER darajasida: kim so'ralayotgani qayerdan
 * olinishini tekshiradi. Servis darajasidagi qulf (prisma `where`) —
 * `davomat-report.service.test.ts` da.
 *
 * Nima uchun bu muhim: `hr-task-send.service.ts` da AYNAN shu naqsh buzilgan —
 * so'rov parametridagi `employeeId` o'z-o'ziga qo'yilgan chegarani qayta yozib
 * yuborardi (X3 da tuzatiladi). Shu xato bu yerda takrorlanmasin.
 */

const me: AuthenticatedUser = {
  sub: 'xodim-1',
  accountId: 'acc-1',
} as AuthenticatedUser;

function makeController() {
  const myHistory = vi.fn().mockResolvedValue({ yearMonth: '2026-06', days: [], totals: {} });
  const ctrl = new HrDavomatPingController(
    {} as never, // ingest — bu testda ishlatilmaydi
    {} as never, // status — bu testda ishlatilmaydi
    { myHistory } as never,
  );
  return { ctrl, myHistory };
}

describe("GET /hr/attendance/my/history — o'z-o'ziga qat'iy bog'langan", () => {
  it("employeeId ni token'dan (user.sub) oladi", async () => {
    const { ctrl, myHistory } = makeController();
    await ctrl.myHistory(me, { yearMonth: '2026-06' });

    expect(myHistory).toHaveBeenCalledWith('acc-1', 'xodim-1', '2026-06');
  });

  it("🔴 ?employeeId= bilan O'ZGA xodimni so'rab bo'lmaydi — parametr e'tiborsiz", async () => {
    const { ctrl, myHistory } = makeController();
    await ctrl.myHistory(me, { yearMonth: '2026-06', employeeId: 'boshqa-xodim' });

    // Uchinchi argument — FAQAT yearMonth; ikkinchisi — hamon token egasi.
    expect(myHistory).toHaveBeenCalledWith('acc-1', 'xodim-1', '2026-06');
    expect(myHistory).not.toHaveBeenCalledWith(
      expect.anything(),
      'boshqa-xodim',
      expect.anything(),
    );
  });

  it("🔴 accountId ham token'dan — so'rovdagi accountId e'tiborsiz", async () => {
    const { ctrl, myHistory } = makeController();
    await ctrl.myHistory(me, { accountId: 'boshqa-akkaunt', employeeId: 'boshqa-xodim' });

    expect(myHistory).toHaveBeenCalledWith('acc-1', 'xodim-1', undefined);
  });

  it('yearMonth berilmasa undefined uzatiladi (servis joriy oyni oladi)', async () => {
    const { ctrl, myHistory } = makeController();
    await ctrl.myHistory(me, {});

    expect(myHistory).toHaveBeenCalledWith('acc-1', 'xodim-1', undefined);
  });

  it("noto'g'ri yearMonth rad etiladi (13-oy, kun bilan, bo'sh matn)", async () => {
    const { ctrl, myHistory } = makeController();

    await expect(ctrl.myHistory(me, { yearMonth: '2026-13' })).rejects.toThrow();
    await expect(ctrl.myHistory(me, { yearMonth: '2026-06-15' })).rejects.toThrow();
    await expect(ctrl.myHistory(me, { yearMonth: '' })).rejects.toThrow();
    expect(myHistory).not.toHaveBeenCalled();
  });
});
