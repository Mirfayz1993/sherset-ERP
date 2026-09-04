import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HrDavomatReportService } from './davomat-report.service.js';

// all-workday week so the attended date is a work day regardless of calendar
const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '18:00',
  isDayOff: false,
}));

describe('HrDavomatReportService.monthly', () => {
  it('aggregates a past month per employee via computeMonthlyAttendance', async () => {
    const prisma = {
      client: {
        employee: {
          findMany: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Ali', workSchedules: week }]),
        },
        hrAttendance: {
          findMany: vi.fn().mockResolvedValue([
            {
              checkInTime: new Date('2026-06-15T09:20:00+05:00'),
              checkOutTime: new Date('2026-06-15T18:00:00+05:00'),
              lateMinutes: 20,
            },
          ]),
        },
      },
    };
    const svc = new HrDavomatReportService(prisma as never);
    const r = await svc.monthly('acc', { yearMonth: '2026-06' });

    expect(r.employees).toHaveLength(1);
    expect(r.employees[0]?.name).toBe('Ali');
    expect(r.employees[0]?.rows).toHaveLength(30); // June has 30 days
    expect(r.employees[0]?.lateMinutesTotal).toBe(20);
    expect(r.employees[0]?.lateDays).toBe(1);
  });
});

// ── X2 — xodimning O'Z tarixi (`GET /hr/attendance/my/history`) ─────────────

// yakshanba dam olish, qolgani ish kuni. 2026-06-01 — dushanba, 2026-06-07 — yakshanba.
const weekSundayOff = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '18:00',
  isDayOff: weekday === 0,
}));

function makeHistoryPrisma(args: {
  emp: unknown;
  attendance?: unknown[];
}) {
  return {
    client: {
      employee: { findFirst: vi.fn().mockResolvedValue(args.emp) },
      hrAttendance: { findMany: vi.fn().mockResolvedValue(args.attendance ?? []) },
    },
  };
}

const ME = { id: 'me', workSchedules: weekSundayOff };

describe('HrDavomatReportService.myHistory', () => {
  beforeEach(() => {
    // Sanani qotiramiz: «joriy oy» sukut qiymati va o'tgan oy kesimi
    // soatga bog'lanib qolmasin.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:00:00+05:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o'z oyini kunma-kun qaytaradi (kelgan kun to'g'ri, kelmagan kun absent)", async () => {
    const prisma = makeHistoryPrisma({
      emp: ME,
      attendance: [
        {
          checkInTime: new Date('2026-06-15T09:20:00+05:00'),
          checkOutTime: new Date('2026-06-15T18:05:00+05:00'),
          lateMinutes: 20,
          autoClosed: false,
        },
      ],
    });
    const r = await new HrDavomatReportService(prisma as never).myHistory('acc', 'me', '2026-06');

    expect(r.yearMonth).toBe('2026-06');
    expect(r.days).toHaveLength(30); // iyunda 30 kun, oy o'tib ketgan ⇒ kesilmaydi
    const attended = r.days.find((d) => d.date === '2026-06-15');
    expect(attended).toEqual({
      date: '2026-06-15',
      checkInTime: '09:20',
      checkOutTime: '18:05',
      lateMinutes: 20,
      isDayOff: false,
      autoClosed: false,
      status: 'late',
    });
    expect(r.totals).toEqual({
      presentDays: 1,
      lateDays: 1,
      absentDays: 25, // 30 kun − 1 kelgan − 4 yakshanba (7, 14, 21, 28)
      dayOffDays: 4,
      lateMinutesTotal: 20,
    });
  });

  it('kelmagan kunda lateMinutes = null (0 EMAS) — halol raqamlar shartnomasi', async () => {
    const prisma = makeHistoryPrisma({ emp: ME });
    const r = await new HrDavomatReportService(prisma as never).myHistory('acc', 'me', '2026-06');

    const absent = r.days.find((d) => d.date === '2026-06-16');
    expect(absent?.status).toBe('absent');
    expect(absent?.lateMinutes).toBeNull();
    expect(absent?.checkInTime).toBeNull();
    expect(absent?.checkOutTime).toBeNull();

    // dam olish kuni ham «kechikmagan» deb ko'rsatilmaydi
    const dayoff = r.days.find((d) => d.date === '2026-06-07');
    expect(dayoff?.status).toBe('dayoff');
    expect(dayoff?.isDayOff).toBe(true);
    expect(dayoff?.lateMinutes).toBeNull();
  });

  it('kelib kechikmagan kunda lateMinutes = 0 (null EMAS)', async () => {
    const prisma = makeHistoryPrisma({
      emp: ME,
      attendance: [
        {
          checkInTime: new Date('2026-06-15T08:50:00+05:00'),
          checkOutTime: null,
          lateMinutes: 0,
          autoClosed: false,
        },
      ],
    });
    const r = await new HrDavomatReportService(prisma as never).myHistory('acc', 'me', '2026-06');

    const d = r.days.find((x) => x.date === '2026-06-15');
    expect(d?.lateMinutes).toBe(0);
    expect(d?.status).toBe('present');
    expect(d?.checkOutTime).toBeNull(); // ochiq qolgan yozuv
  });

  it("autoClosed bayrog'i FAQAT o'sha kunga tushadi", async () => {
    const prisma = makeHistoryPrisma({
      emp: ME,
      attendance: [
        {
          checkInTime: new Date('2026-06-15T09:00:00+05:00'),
          checkOutTime: new Date('2026-06-15T23:59:00+05:00'),
          lateMinutes: 0,
          autoClosed: true,
        },
        {
          checkInTime: new Date('2026-06-16T09:00:00+05:00'),
          checkOutTime: new Date('2026-06-16T18:00:00+05:00'),
          lateMinutes: 0,
          autoClosed: false,
        },
      ],
    });
    const r = await new HrDavomatReportService(prisma as never).myHistory('acc', 'me', '2026-06');

    expect(r.days.find((d) => d.date === '2026-06-15')?.autoClosed).toBe(true);
    expect(r.days.find((d) => d.date === '2026-06-16')?.autoClosed).toBe(false);
    expect(r.days.find((d) => d.date === '2026-06-17')?.autoClosed).toBe(false);
  });

  it('yearMonth berilmasa — joriy oy, kelajak kunlar chizilmaydi', async () => {
    const prisma = makeHistoryPrisma({ emp: ME });
    const r = await new HrDavomatReportService(prisma as never).myHistory('acc', 'me');

    expect(r.yearMonth).toBe('2026-09');
    expect(r.days.at(-1)?.date).toBe('2026-09-04'); // bugundan keyingi kunlar yo'q
  });

  // ── MANFIY: own-only shartnomasi (0-bo'lim 7-qoidasi) ────────────────────

  it("🔴 so'rovlar FAQAT chaqiruvchining employeeId + accountId bilan chegaralanadi", async () => {
    const prisma = makeHistoryPrisma({ emp: ME });
    await new HrDavomatReportService(prisma as never).myHistory('acc', 'me', '2026-06');

    expect(prisma.client.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'me', accountId: 'acc' } }),
    );
    const where = prisma.client.hrAttendance.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ accountId: 'acc', employeeId: 'me', deletedAt: null });
    // Boshqa xodimni qamrab oladigan «yumshoq» filtr (OR/in/undefined) BO'LMASIN.
    expect(Object.keys(where)).toEqual(['accountId', 'employeeId', 'deletedAt', 'checkInTime']);
  });

  it("🔴 boshqa akkauntning xodimi so'ralsa — bo'sh tarix, yozuvlar o'qilmaydi", async () => {
    // Boshqa akkauntda turgan (yoki umuman yo'q) xodim `findFirst` da null beradi.
    const prisma = makeHistoryPrisma({ emp: null });
    const r = await new HrDavomatReportService(prisma as never).myHistory(
      'acc',
      'boshqa-xodim',
      '2026-06',
    );

    expect(r.days).toEqual([]);
    expect(r.totals).toEqual({
      presentDays: 0,
      lateDays: 0,
      absentDays: 0,
      dayOffDays: 0,
      lateMinutesTotal: 0,
    });
    // Eng muhimi: davomat jadvaliga UMUMAN so'rov ketmaydi.
    expect(prisma.client.hrAttendance.findMany).not.toHaveBeenCalled();
  });
});
