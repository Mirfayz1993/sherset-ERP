import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { HR_EVENT } from '../hr-shared/hr-events.types.js';
import { HR_TZ, startOfLocalDay } from '../hr-shared/tz.util.js';
import { pickInsideLocation, resolveAllowedLocations } from './allowed-locations.util.js';
import type { PingInput } from './attendance-geo.schema.js';
import {
  type AttendanceDecision,
  type InsideSample,
  decideAttendance,
} from './attendance-reducer.util.js';
import { jumpFilter } from './jump-filter.util.js';
import {
  type PrismaScheduleShape,
  SCHEDULE_SELECT,
  toResolvedSchedule,
} from './prisma-schedule.util.js';
import { lateMinutesForShift, resolveShift } from './resolve-shift.util.js';

/** Authoritative status the PWA renders from each accepted ping. */
export type DavomatLiveStatus = 'not_arrived' | 'at_work' | 'left';

export interface PingResult {
  accepted: boolean;
  reason: 'accuracy' | 'jump' | 'not_opted_in' | 'no_location' | null;
  inside: boolean;
  status: DavomatLiveStatus;
  decision: AttendanceDecision;
  attendance: { checkInTime: Date; checkOutTime: Date | null; lateMinutes: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCURACY_LIMIT_M = 100;

/**
 * HR-2 — check-in yo'llari uchun xodim + UNING SMENASI bitta so'rovda.
 *
 * Ilgari bu yerda faqat `attendanceOptIn`/`workLocationId` olinar, kechikish
 * esa `employeeWorkSchedule.findUnique` (hafta-kuni jadvali) dan hisoblanardi.
 * Nomli SIKLIK/ERKIN `HrSchedule` biriktirilgan xodimda o'sha jadval mos
 * kelmaydi ⇒ kechikish (va undan kelib chiqadigan avto-jarima) noto'g'ri
 * bo'lardi. Endi manba `resolveShift` — `hr-attendance.service.checkIn` bilan
 * BIR XIL (§5.1 «yagona sanksiyalangan manba»).
 */
const CHECKIN_EMPLOYEE_SELECT = {
  attendanceOptIn: true,
  workLocationId: true,
  schedule: { select: SCHEDULE_SELECT },
  workSchedules: {
    select: { weekday: true, startTime: true, endTime: true, isDayOff: true },
  },
} as const;

interface CheckInEmployee {
  attendanceOptIn: boolean;
  workLocationId: string | null;
  schedule: PrismaScheduleShape | null;
  workSchedules: { weekday: number; startTime: string; endTime: string; isDayOff: boolean }[];
}

/** Kechikish = xodimning O'SHA KUNGA tegishli smenasi bo'yicha (siklik/erkin/hafta-kuni). */
function lateMinutesFor(emp: CheckInEmployee, at: Date): number {
  const shift = resolveShift({
    date: formatInTimeZone(at, HR_TZ, 'yyyy-MM-dd'),
    tz: HR_TZ,
    schedule: emp.schedule ? toResolvedSchedule(emp.schedule) : null,
    weekFallback: emp.workSchedules ?? null,
  });
  return lateMinutesForShift(at, shift, HR_TZ);
}

const benign = (reason: PingResult['reason']): PingResult => ({
  accepted: false,
  reason,
  inside: false,
  status: 'not_arrived',
  decision: 'NONE',
  attendance: null,
});

/** Result of the instant self-service "Keldim"/"Ketyapman" buttons. */
export interface ManualMarkResult {
  ok: boolean;
  reason:
    | 'accuracy'
    | 'outside'
    | 'not_opted_in'
    | 'no_location'
    | 'already_open'
    | 'no_open_record'
    | null;
  status: DavomatLiveStatus;
  attendance: { checkInTime: Date; checkOutTime: Date | null; lateMinutes: number } | null;
}

const manualBenign = (reason: ManualMarkResult['reason']): ManualMarkResult => ({
  ok: false,
  reason,
  status: 'not_arrived',
  attendance: null,
});

/**
 * Ingests one GPS ping, runs the geofence anti-cheat gates + per-day KELDI/KETDI
 * state machine, and applies the resulting attendance transition. Returns the
 * authoritative live status for the employee PWA.
 */
@Injectable()
export class HrPingIngestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async ingest(accountId: string, employeeId: string, dto: PingInput): Promise<PingResult> {
    // 1. Opt-in + assigned work-location gate (benign — never 500).
    const emp = (await this.prisma.client.employee.findFirst({
      where: { id: employeeId, accountId },
      select: CHECKIN_EMPLOYEE_SELECT,
    })) as CheckInEmployee | null;
    if (!emp || !emp.attendanceOptIn) return benign('not_opted_in');

    // 2. Accuracy gate — unreliable pings never touch the state machine (no persist).
    if (dto.accuracy > ACCURACY_LIMIT_M) return benign('accuracy');

    // X8 — asosiy filial + `HrEmployeeBranch` dagi qo'shimcha filiallar.
    // Birortasi ham yo'q (yoki hammasi arxivlangan) bo'lsa — `no_location`.
    const allowed = await resolveAllowedLocations(
      this.prisma,
      accountId,
      employeeId,
      emp.workLocationId,
    );
    if (allowed.length === 0) return benign('no_location');

    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    // 3. Jump filter vs the last stored ping today (anti-teleport).
    const lastPing = await this.prisma.client.hrLocationPing.findFirst({
      where: { accountId, employeeId, createdAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { createdAt: 'desc' },
      select: { lat: true, lng: true, createdAt: true },
    });
    const prevPoint = lastPing
      ? { lat: lastPing.lat, lng: lastPing.lng, at: lastPing.createdAt }
      : null;
    if (!jumpFilter(prevPoint, { lat: dto.lat, lng: dto.lng, at: now })) return benign('jump');

    // 4. Geofence test + persist the ping (audit + state-machine source).
    // X8 — ruxsat etilgan joylardan BIRORTASIGA tushsa `inside`; yozuvga aynan
    // MOS KELGAN joy yoziladi (ilgari doim `emp.workLocationId` yozilardi, ya'ni
    // menejer paneli boshqa omborga borgan xodimni noto'g'ri filialda ko'rsatardi).
    const match = pickInsideLocation(
      { lat: dto.lat, lng: dto.lng, accuracy: dto.accuracy },
      allowed,
    );
    const inside = match !== null;
    await this.prisma.client.hrLocationPing.create({
      data: {
        accountId,
        employeeId,
        lat: dto.lat,
        lng: dto.lng,
        accuracy: Math.round(dto.accuracy),
        inside,
      },
    });

    // 5. Build the recent-sample window (last ~12 pings, ascending) + open record.
    const recentDesc = await this.prisma.client.hrLocationPing.findMany({
      where: { accountId, employeeId, createdAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { inside: true, createdAt: true },
    });
    const samples: InsideSample[] = recentDesc
      .slice()
      .reverse()
      .map((p) => ({ inside: p.inside, at: p.createdAt }));

    const openRecord = await this.prisma.client.hrAttendance.findFirst({
      where: {
        accountId,
        employeeId,
        deletedAt: null,
        checkInTime: { gte: dayStart, lt: dayEnd },
        checkOutTime: null,
      },
      orderBy: { checkInTime: 'desc' },
      select: { id: true, checkInTime: true, lateMinutes: true },
    });

    const decision = decideAttendance({ samples, hasOpenRecord: !!openRecord, now });

    // 6. Apply the transition.
    let attendance: PingResult['attendance'] = openRecord
      ? {
          checkInTime: openRecord.checkInTime,
          checkOutTime: null,
          lateMinutes: openRecord.lateMinutes,
        }
      : null;

    if (decision === 'KELDI') {
      const lateMinutes = lateMinutesFor(emp, now);
      const created = await this.prisma.client.hrAttendance.create({
        data: {
          accountId,
          employeeId,
          checkInTime: now,
          checkInLat: dto.lat,
          checkInLng: dto.lng,
          checkInAccuracy: Math.round(dto.accuracy),
          source: 'auto_gps',
          // KELDI qarori oxirgi namuna ICHKARIDA bo'lgandagina chiqadi (o'sha
          // namuna — hozirgi ping), ya'ni bu yerda `match` doim bor; asosiy
          // filial faqat himoya uchun zaxira.
          workLocationId: match?.location.id ?? emp.workLocationId,
          lateMinutes,
        },
        select: { id: true, checkInTime: true, checkOutTime: true, lateMinutes: true },
      });
      attendance = created;
      this.emitCheckedIn(accountId, created.id, employeeId, now, lateMinutes);
    } else if (decision === 'KETDI' && openRecord) {
      // Atomic close — only one worker wins the race (mirror hr-deadline-expire).
      const closed = await this.prisma.client.hrAttendance.updateMany({
        where: { id: openRecord.id, checkOutTime: null, deletedAt: null },
        data: { checkOutTime: now, checkOutLat: dto.lat, checkOutLng: dto.lng },
      });
      attendance = {
        checkInTime: openRecord.checkInTime,
        checkOutTime: now,
        lateMinutes: openRecord.lateMinutes,
      };
      // Only emit if this worker actually won the atomic close (count>0),
      // so a lost race does not double-notify the director.
      if (closed.count > 0) {
        this.emitCheckedOut(accountId, openRecord.id, employeeId, now);
      }
    }

    const status: DavomatLiveStatus = attendance
      ? attendance.checkOutTime
        ? 'left'
        : 'at_work'
      : 'not_arrived';

    return { accepted: true, reason: null, inside, status, decision, attendance };
  }

  /**
   * Instant self-service "Keldim" button — same anti-cheat gates as ingest()
   * (opt-in/location/accuracy/geofence) but skips the 2-consecutive-ping
   * debounce: a single verified-inside reading marks KELDI immediately.
   * Idempotent — pressing again while already checked in returns the
   * existing open record instead of erroring.
   */
  async manualCheckIn(
    accountId: string,
    employeeId: string,
    dto: PingInput,
  ): Promise<ManualMarkResult> {
    const emp = (await this.prisma.client.employee.findFirst({
      where: { id: employeeId, accountId },
      select: CHECKIN_EMPLOYEE_SELECT,
    })) as CheckInEmployee | null;
    if (!emp || !emp.attendanceOptIn) return manualBenign('not_opted_in');
    if (dto.accuracy > ACCURACY_LIMIT_M) return manualBenign('accuracy');

    // X8 — `ingest()` bilan AYNI ro'yxat: asosiy filial + `HrEmployeeBranch`.
    const allowed = await resolveAllowedLocations(
      this.prisma,
      accountId,
      employeeId,
      emp.workLocationId,
    );
    if (allowed.length === 0) return manualBenign('no_location');

    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    const openRecord = await this.prisma.client.hrAttendance.findFirst({
      where: {
        accountId,
        employeeId,
        deletedAt: null,
        checkInTime: { gte: dayStart, lt: dayEnd },
        checkOutTime: null,
      },
      orderBy: { checkInTime: 'desc' },
      select: { checkInTime: true, lateMinutes: true },
    });
    if (openRecord) {
      return {
        ok: true,
        reason: 'already_open',
        status: 'at_work',
        attendance: { ...openRecord, checkOutTime: null },
      };
    }

    const match = pickInsideLocation(
      { lat: dto.lat, lng: dto.lng, accuracy: dto.accuracy },
      allowed,
    );
    if (!match) return manualBenign('outside');

    await this.prisma.client.hrLocationPing.create({
      data: {
        accountId,
        employeeId,
        lat: dto.lat,
        lng: dto.lng,
        accuracy: Math.round(dto.accuracy),
        inside: true,
      },
    });

    const lateMinutes = lateMinutesFor(emp, now);
    const created = await this.prisma.client.hrAttendance.create({
      data: {
        accountId,
        employeeId,
        checkInTime: now,
        checkInLat: dto.lat,
        checkInLng: dto.lng,
        checkInAccuracy: Math.round(dto.accuracy),
        source: 'auto_gps',
        // X8 — «Keldim» bosilgan joy (asosiy filial bo'lmasligi ham mumkin).
        workLocationId: match.location.id,
        lateMinutes,
      },
      select: { id: true, checkInTime: true, checkOutTime: true, lateMinutes: true },
    });
    this.emitCheckedIn(accountId, created.id, employeeId, now, lateMinutes);

    return { ok: true, reason: null, status: 'at_work', attendance: created };
  }

  /**
   * Instant self-service "Ketyapman" button — closes today's open record
   * immediately (no 3-min-outside debounce). Location is not gated (an
   * employee may legitimately press this while already walking out), but
   * coordinates are still recorded for the audit trail when available.
   */
  async manualCheckOut(
    accountId: string,
    employeeId: string,
    dto: PingInput,
  ): Promise<ManualMarkResult> {
    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    const openRecord = await this.prisma.client.hrAttendance.findFirst({
      where: {
        accountId,
        employeeId,
        deletedAt: null,
        checkInTime: { gte: dayStart, lt: dayEnd },
        checkOutTime: null,
      },
      orderBy: { checkInTime: 'desc' },
      select: { id: true, checkInTime: true, lateMinutes: true },
    });
    if (!openRecord) return manualBenign('no_open_record');

    const closed = await this.prisma.client.hrAttendance.updateMany({
      where: { id: openRecord.id, checkOutTime: null, deletedAt: null },
      data: { checkOutTime: now, checkOutLat: dto.lat, checkOutLng: dto.lng },
    });
    if (closed.count > 0) {
      this.emitCheckedOut(accountId, openRecord.id, employeeId, now);
    }

    return {
      ok: true,
      reason: null,
      status: 'left',
      attendance: {
        checkInTime: openRecord.checkInTime,
        checkOutTime: now,
        lateMinutes: openRecord.lateMinutes,
      },
    };
  }

  /** Out-of-band domain event → director Telegram notifier + auto-fine. */
  private emitCheckedIn(
    accountId: string,
    attendanceId: string,
    employeeId: string,
    at: Date,
    lateMinutes: number,
  ): void {
    this.events.emit(HR_EVENT.HR_ATTENDANCE_CHECKED_IN, {
      accountId,
      attendanceId,
      employeeId,
      at,
      lateMinutes,
    });
  }

  private emitCheckedOut(
    accountId: string,
    attendanceId: string,
    employeeId: string,
    at: Date,
  ): void {
    this.events.emit(HR_EVENT.HR_ATTENDANCE_CHECKED_OUT, {
      accountId,
      attendanceId,
      employeeId,
      at,
    });
  }
}
