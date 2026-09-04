import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { HrTaskSendController } from './hr-task-send.controller.js';

/**
 * X3 — «xodim FAQAT o'z vazifalarini ko'radi» shartnomasining qulfi
 * (X-reja 0-bo'lim 7-qoidasi), X2 dagi `my-history.controller.test.ts` naqshi.
 *
 * Bu yerdagi testlar KONTROLLER darajasida: kim so'ralayotgani QAYERDAN
 * olinishini tekshiradi. Servis darajasidagi qulf (prisma `where` va
 * qamrovni bosib o'tmaslik regressi) — `hr-task-send.service.test.ts` da.
 *
 * Nima uchun ikki qavat: `/hr/tasks/logs` da AYNAN shu narsa buzilgan edi —
 * kontroller qamrov qo'yardi, servis esa so'rov parametridan uni qayta
 * yozardi. Endi kontroller kimni so'rashni tanlash IMKONINI bermaydi, servis
 * esa qamrov qo'yilgan bo'lsa parametrni e'tiborsiz qoldiradi.
 */

const me: AuthenticatedUser = {
  sub: 'xodim-1',
  accountId: 'acc-1',
  hrRoles: [],
  hrPermissions: [{ pageKey: 'tasks', section: null, accessLevel: 'own_only' }],
} as unknown as AuthenticatedUser;

function makeController() {
  const listMyTasks = vi.fn().mockResolvedValue({ rows: [], total: 0 });
  const listLogs = vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, limit: 50 });
  const ctrl = new HrTaskSendController({ listMyTasks, listLogs } as never);
  return { ctrl, listMyTasks, listLogs };
}

describe("GET /hr/tasks/my — o'z-o'ziga qat'iy bog'langan", () => {
  it("employeeId ni token'dan (user.sub) oladi", async () => {
    const { ctrl, listMyTasks } = makeController();
    await ctrl.my(me, {});

    expect(listMyTasks).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 50 });
  });

  it("🔴 ?employeeId= bilan O'ZGA xodimni so'rab bo'lmaydi — parametr e'tiborsiz", async () => {
    const { ctrl, listMyTasks } = makeController();
    await ctrl.my(me, { employeeId: 'boshqa-xodim' });

    // Ikkinchi argument — hamon token egasi; uchinchisida `employeeId` YO'Q
    // (zod obyekti notanish kalitni olib tashlaydi).
    expect(listMyTasks).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 50 });
    expect(listMyTasks).not.toHaveBeenCalledWith(
      expect.anything(),
      'boshqa-xodim',
      expect.anything(),
    );
  });

  it("🔴 accountId ham token'dan — so'rovdagi accountId e'tiborsiz", async () => {
    const { ctrl, listMyTasks } = makeController();
    await ctrl.my(me, { accountId: 'boshqa-akkaunt', employeeId: 'boshqa-xodim' });

    expect(listMyTasks).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 50 });
  });

  it("status va limit uzatiladi, limit sukut bo'yicha 50", async () => {
    const { ctrl, listMyTasks } = makeController();
    await ctrl.my(me, { status: 'sent', limit: '10' });

    expect(listMyTasks).toHaveBeenCalledWith('acc-1', 'xodim-1', { limit: 10, status: 'sent' });
  });

  it("noto'g'ri status/limit rad etiladi — servis chaqirilmaydi", async () => {
    const { ctrl, listMyTasks } = makeController();

    await expect(ctrl.my(me, { status: 'yo_q_status' })).rejects.toThrow();
    await expect(ctrl.my(me, { limit: '0' })).rejects.toThrow();
    await expect(ctrl.my(me, { limit: '201' })).rejects.toThrow();
    expect(listMyTasks).not.toHaveBeenCalled();
  });
});

describe("GET /hr/tasks/logs — qamrov ruxsat darajasi bo'yicha (X3)", () => {
  const withTasks = (accessLevel: string, hrRoles: string[] = []): AuthenticatedUser =>
    ({
      sub: 'xodim-1',
      accountId: 'acc-1',
      hrRoles,
      hrPermissions: [{ pageKey: 'tasks', section: null, accessLevel }],
    }) as unknown as AuthenticatedUser;

  it('admin — qamrovsiz (butun akkaunt)', async () => {
    const { ctrl, listLogs } = makeController();
    await ctrl.list(withTasks('full', ['admin']), {});

    expect(listLogs.mock.calls[0]![1]).toBeNull();
  });

  it("oddiy xodim — sukut bo'yicha O'ZIGA bog'lanadi", async () => {
    const { ctrl, listLogs } = makeController();
    await ctrl.list(withTasks('read'), {});

    expect(listLogs.mock.calls[0]![1]).toBe('xodim-1');
  });

  it("tasks:read — o'zga xodimni ATAYLAB so'rashi mumkin (menejer ekrani)", async () => {
    const { ctrl, listLogs } = makeController();
    await ctrl.list(withTasks('read'), { employeeId: '11111111-1111-4111-8111-111111111111' });

    expect(listLogs.mock.calls[0]![1]).toBeNull();
  });

  it("🔴 tasks:own_only — ?employeeId= bergani bilan qamrov O'ZIDA qoladi", async () => {
    const { ctrl, listLogs } = makeController();
    await ctrl.list(withTasks('own_only'), {
      employeeId: '11111111-1111-4111-8111-111111111111',
    });

    // Servis bu qamrovni qat'iy shift deb biladi — param u yerda ham
    // e'tiborsiz qoladi (`hr-task-send.service.test.ts` regressi).
    expect(listLogs.mock.calls[0]![1]).toBe('xodim-1');
  });

  it("🔴 `tasks` ruxsati umuman bo'lmagan xodimda ham qamrov o'zida qoladi", async () => {
    const { ctrl, listLogs } = makeController();
    const noPerm = {
      sub: 'xodim-1',
      accountId: 'acc-1',
      hrRoles: [],
      hrPermissions: [],
    } as unknown as AuthenticatedUser;
    await ctrl.list(noPerm, { employeeId: '11111111-1111-4111-8111-111111111111' });

    expect(listLogs.mock.calls[0]![1]).toBe('xodim-1');
  });

  it("🔴 boshqa sahifada `full` bo'lsa ham `tasks` ochilmaydi", async () => {
    const { ctrl, listLogs } = makeController();
    const other = {
      sub: 'xodim-1',
      accountId: 'acc-1',
      hrRoles: [],
      hrPermissions: [{ pageKey: 'oylik', section: null, accessLevel: 'full' }],
    } as unknown as AuthenticatedUser;
    await ctrl.list(other, { employeeId: '11111111-1111-4111-8111-111111111111' });

    expect(listLogs.mock.calls[0]![1]).toBe('xodim-1');
  });
});
