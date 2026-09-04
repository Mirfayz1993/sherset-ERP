import { Inject, Injectable } from '@nestjs/common';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { HR_TZ, startOfLocalDay, tashkentWeekday, toLocalIso } from '../hr-shared/tz.util.js';
import { aggregateEmployeeDay } from './attendance-dashboard.util.js';
import type { MonthlyReportFilter } from './attendance-geo.schema.js';
import { type MonthlyRow, computeMonthlyAttendance } from './monthly-report.util.js';
import { SCHEDULE_SELECT, toResolvedSchedule } from './prisma-schedule.util.js';
import { resolveShift } from './resolve-shift.util.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AttendanceDashboardRow {
  employeeId: string;
  employee: { id: string; name: string; department: string | null };
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  branches: string[];
  isWorkday: boolean;
  hasRecord: boolean;
  isAtWork: boolean;
}

export interface AttendanceDashboard {
  date: string;
  counts: { all: number; atWork: number; late: number; absent: number };
  rows: AttendanceDashboardRow[];
}

export interface MonthlyEmployeeReport {
  employeeId: string;
  name: string;
  rows: MonthlyRow[];
  presentDays: number;
  lateDays: number;
  absentDays: number;
  dayOffDays: number;
  lateMinutesTotal: number;
}

/**
 * X2 — xodim O'ZI ko'radigan bir kun.
 *
 * ⚠️ `checkInTime`/`checkOutTime` — LOKAL `HH:mm` matni (Toshkent), Date EMAS.
 * `my/today` da ular to'liq sana-vaqt bo'ladi; bu yerda esa ekranda kun
 * qatori sifatida chiqadi va oyning barcha kunlari uchun bir xil qisqa
 * ko'rinish kerak. Maydon nomlari X-rejadagi shartnomadan olingan.
 *
 * 🔴 `lateMinutes` — `null` ≠ 0 (0-bo'lim 8-qoidasi): yozuv yo'q kunda
 * «kechikmagan» deb ko'rsatish YOLG'ON bo'lardi, shuning uchun `null`
 * («—» chiqadi), 0 esa «keldi va kechikmadi» degani.
 */
export interface MyHistoryDay {
  date: string; // yyyy-MM-dd (Toshkent)
  checkInTime: string | null; // 'HH:mm' lokal — null = o'sha kun yozuvi yo'q
  checkOutTime: string | null; // 'HH:mm' lokal — null = yopilmagan yoki yozuv yo'q
  lateMinutes: number | null; // null = yozuv yo'q; 0 = keldi, kechikmadi
  isDayOff: boolean;
  autoClosed: boolean; // kunni tungi kron yopgan (ketish ko'rinmagan)
  status: MonthlyRow['status'];
}

export interface MyHistoryResult {
  yearMonth: string;
  days: MyHistoryDay[];
  totals: {
    presentDays: number;
    lateDays: number;
    absentDays: number;
    dayOffDays: number;
    lateMinutesTotal: number;
  };
}

const EMPTY_TOTALS: MyHistoryResult['totals'] = {
  presentDays: 0,
  lateDays: 0,
  absentDays: 0,
  dayOffDays: 0,
  lateMinutesTotal: 0,
};

/** 'yyyy-MM' → oyning [boshlanish, tugash) chegarasi (Toshkent kalendari). */
function monthRange(yearMonth: string): { monthStart: Date; monthEnd: Date } {
  const y = Number(yearMonth.slice(0, 4));
  const m = Number(yearMonth.slice(5, 7));
  const nextYm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return {
    monthStart: fromZonedTime(`${yearMonth}-01T00:00:00`, HR_TZ),
    monthEnd: fromZonedTime(`${nextYm}-01T00:00:00`, HR_TZ),
  };
}

const WEEK_SELECT = {
  select: { weekday: true, startTime: true, endTime: true, isDayOff: true },
} as const;

/** Monthly attendance report (schedule x attendance) + today's live board. */
@Injectable()
export class HrDavomatReportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async monthly(
    accountId: string,
    filter: MonthlyReportFilter,
  ): Promise<{ yearMonth: string; employees: MonthlyEmployeeReport[] }> {
    const { yearMonth, employeeId } = filter;
    const { monthStart, monthEnd } = monthRange(yearMonth);
    const todayLocalDate = formatInTimeZone(new Date(), HR_TZ, 'yyyy-MM-dd');

    const employees = await this.prisma.client.employee.findMany({
      where: {
        accountId,
        archived: false,
        ...(employeeId ? { id: employeeId } : { attendanceOptIn: true }),
      },
      select: {
        id: true,
        name: true,
        workSchedules: WEEK_SELECT,
      },
      orderBy: { name: 'asc' },
    });

    const out: MonthlyEmployeeReport[] = [];
    for (const emp of employees) {
      const attendance = await this.prisma.client.hrAttendance.findMany({
        where: {
          accountId,
          employeeId: emp.id,
          deletedAt: null,
          checkInTime: { gte: monthStart, lt: monthEnd },
        },
        select: { checkInTime: true, checkOutTime: true, lateMinutes: true },
        orderBy: { checkInTime: 'asc' },
      });
      const agg = computeMonthlyAttendance({
        yearMonth,
        week: emp.workSchedules,
        attendance,
        tz: HR_TZ,
        todayLocalDate,
      });
      out.push({
        employeeId: emp.id,
        name: emp.name,
        rows: agg.rows,
        presentDays: agg.presentDays,
        lateDays: agg.lateDays,
        absentDays: agg.absentDays,
        dayOffDays: agg.dayOffDays,
        lateMinutesTotal: agg.rows.reduce((a, r) => a + r.lateMinutes, 0),
      });
    }
    return { yearMonth, employees: out };
  }

  /**
   * X2 — xodimning O'Z oylik davomat tarixi (`GET /hr/attendance/my/history`).
   *
   * 🔴 XAVFSIZLIK: `employeeId` FAQAT `user.sub` dan keladi (kontroller uni
   * so'rov parametridan OLMAYDI), qidiruv esa ustiga `accountId` bilan ham
   * chegaralangan. Ya'ni boshqa xodimni (yoki boshqa akkauntni) so'rashning
   * YO'LI YO'Q. `monthly()` ga TEGILMADI — u menejer hisoboti va u yerda
   * `employeeId` filtri ATAYLAB tanlanadigan (`employees:read` ostida).
   *
   * Hisob mantig'i qayta yozilmagan: kun/holat/jamlar `computeMonthlyAttendance`
   * dan (menejer hisoboti bilan BIR XIL manba), bu metod ustiga faqat
   * `autoClosed` ni va halol-raqam (`null` ≠ 0) qoidasini qo'yadi.
   */
  async myHistory(
    accountId: string,
    employeeId: string,
    yearMonth?: string,
  ): Promise<MyHistoryResult> {
    const todayLocalDate = formatInTimeZone(new Date(), HR_TZ, 'yyyy-MM-dd');
    const ym = yearMonth ?? todayLocalDate.slice(0, 7);

    const emp = await this.prisma.client.employee.findFirst({
      where: { id: employeeId, accountId },
      select: { id: true, workSchedules: WEEK_SELECT },
    });
    // Xodim bu akkauntda topilmadi — bo'sh tarix. Bo'sh jadval bilan hisoblab
    // yuborish oyni butunlay «dam olish» qilib ko'rsatardi, bu esa yolg'on.
    if (!emp) return { yearMonth: ym, days: [], totals: { ...EMPTY_TOTALS } };

    const { monthStart, monthEnd } = monthRange(ym);
    const attendance = await this.prisma.client.hrAttendance.findMany({
      where: {
        accountId,
        employeeId,
        deletedAt: null,
        checkInTime: { gte: monthStart, lt: monthEnd },
      },
      select: {
        checkInTime: true,
        checkOutTime: true,
        lateMinutes: true,
        autoClosed: true,
      },
      orderBy: { checkInTime: 'asc' },
    });

    const agg = computeMonthlyAttendance({
      yearMonth: ym,
      week: emp.workSchedules,
      attendance,
      tz: HR_TZ,
      todayLocalDate,
    });

    // `computeMonthlyAttendance` kunning BIRINCHI kelishini oladi; `autoClosed`
    // ni ham aynan o'sha yozuvdan olamiz, aks holda ikki yozuvli kunda bayroq
    // boshqa qatordan kelib qolardi.
    const autoClosedByDate = new Map<string, boolean>();
    for (const a of attendance) {
      const d = formatInTimeZone(a.checkInTime, HR_TZ, 'yyyy-MM-dd');
      if (!autoClosedByDate.has(d)) autoClosedByDate.set(d, a.autoClosed);
    }

    return {
      yearMonth: ym,
      days: agg.rows.map((r) => ({
        date: r.date,
        checkInTime: r.checkIn,
        checkOutTime: r.checkOut,
        lateMinutes: r.checkIn === null ? null : r.lateMinutes,
        isDayOff: r.status === 'dayoff',
        autoClosed: autoClosedByDate.get(r.date) ?? false,
        status: r.status,
      })),
      totals: {
        presentDays: agg.presentDays,
        lateDays: agg.lateDays,
        absentDays: agg.absentDays,
        dayOffDays: agg.dayOffDays,
        lateMinutesTotal: agg.rows.reduce((a, r) => a + r.lateMinutes, 0),
      },
    };
  }

  /** Today's board: present (with status) + scheduled-but-absent opted-in employees. */
  async live(accountId: string) {
    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const weekday = tashkentWeekday(now);

    const records = await this.prisma.client.hrAttendance.findMany({
      where: { accountId, deletedAt: null, checkInTime: { gte: dayStart, lt: dayEnd } },
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { checkInTime: 'asc' },
    });
    const presentIds = new Set(records.map((r) => r.employeeId));

    const scheduled = await this.prisma.client.employeeWorkSchedule.findMany({
      where: {
        accountId,
        weekday,
        isDayOff: false,
        employee: { attendanceOptIn: true, archived: false },
      },
      select: { employee: { select: { id: true, name: true } } },
    });
    const absent = scheduled
      .filter((s) => !presentIds.has(s.employee.id))
      .map((s) => ({ employeeId: s.employee.id, name: s.employee.name }));

    return {
      present: records.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        name: r.employee.name,
        checkInTime: r.checkInTime,
        checkOutTime: r.checkOutTime,
        lateMinutes: r.lateMinutes,
        source: r.source,
        autoClosed: r.autoClosed,
        status: r.checkOutTime ? ('left' as const) : ('at_work' as const),
      })),
      absent,
    };
  }

  /**
   * TimePay "Xodimlar boshqaruv paneli" — per-date attendance board.
   * Cohort = active, opt-in employees. For each, resolveShift() yields the
   * owed shift (named HrSchedule or the weekday fallback), then
   * aggregateEmployeeDay() folds that day's HrAttendance rows into
   * Kirish/Chiqish/Qo'shimcha/Jami. Counts are independent (TimePay parity),
   * so `all` need not equal atWork+late+absent (rest-day rows sit outside all
   * three). See spec §5.3.
   */
  async dashboard(accountId: string, dateStr?: string): Promise<AttendanceDashboard> {
    const now = new Date();
    const todayLocalDate = formatInTimeZone(now, HR_TZ, 'yyyy-MM-dd');
    const localDate = dateStr ?? todayLocalDate;
    const isToday = localDate === todayLocalDate;
    const dayStart = fromZonedTime(`${localDate}T00:00:00`, HR_TZ);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    const employees = await this.prisma.client.employee.findMany({
      where: { accountId, archived: false, attendanceOptIn: true },
      select: {
        id: true,
        name: true,
        department: true,
        workLocation: { select: { id: true, name: true } },
        workSchedules: WEEK_SELECT,
        schedule: { select: SCHEDULE_SELECT },
      },
      orderBy: { name: 'asc' },
    });

    const records = await this.prisma.client.hrAttendance.findMany({
      where: { accountId, deletedAt: null, checkInTime: { gte: dayStart, lt: dayEnd } },
      select: {
        employeeId: true,
        checkInTime: true,
        checkOutTime: true,
        lateMinutes: true,
        workLocationId: true,
      },
      orderBy: { checkInTime: 'asc' },
    });
    const byEmp = new Map<string, typeof records>();
    for (const r of records) {
      const list = byEmp.get(r.employeeId);
      if (list) list.push(r);
      else byEmp.set(r.employeeId, [r]);
    }

    // Branch-name lookup (HrAttendance.workLocationId is a raw FK, no relation).
    const branchIds = [
      ...new Set(records.map((r) => r.workLocationId).filter((v): v is string => !!v)),
    ];
    const locs = branchIds.length
      ? await this.prisma.client.hrWorkLocation.findMany({
          where: { accountId, id: { in: branchIds } },
          select: { id: true, name: true },
        })
      : [];
    const branchName = new Map(locs.map((l) => [l.id, l.name]));

    const rows: AttendanceDashboardRow[] = employees.map((emp) => {
      const shift = resolveShift({
        date: localDate,
        tz: HR_TZ,
        schedule: emp.schedule ? toResolvedSchedule(emp.schedule) : null,
        weekFallback: emp.workSchedules,
      });
      const empRows = byEmp.get(emp.id) ?? [];
      const agg = aggregateEmployeeDay({
        rows: empRows.map((r) => ({
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          lateMinutes: r.lateMinutes,
        })),
        shift,
        tz: HR_TZ,
        localDate,
        now,
        isToday,
      });
      const branchSet = new Set<string>();
      for (const r of empRows) {
        const n = r.workLocationId ? branchName.get(r.workLocationId) : undefined;
        if (n) branchSet.add(n);
      }
      if (emp.workLocation) branchSet.add(emp.workLocation.name);
      return {
        employeeId: emp.id,
        employee: { id: emp.id, name: emp.name, department: emp.department },
        checkIn: agg.checkIn ? toLocalIso(agg.checkIn) : null,
        checkOut: agg.checkOut ? toLocalIso(agg.checkOut) : null,
        lateMinutes: agg.lateMinutes,
        overtimeMinutes: agg.overtimeMinutes,
        totalMinutes: agg.totalMinutes,
        branches: [...branchSet],
        isWorkday: shift.isWorkday,
        hasRecord: empRows.length > 0,
        isAtWork: agg.isAtWork,
      };
    });

    return {
      date: localDate,
      counts: {
        all: rows.length,
        atWork: rows.filter((r) => r.isAtWork).length,
        late: rows.filter((r) => r.hasRecord && r.lateMinutes > 0).length,
        absent: rows.filter((r) => !r.hasRecord && r.isWorkday).length,
      },
      rows,
    };
  }
}
