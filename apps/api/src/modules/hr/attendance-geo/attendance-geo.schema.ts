import { z } from 'zod';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
});

export const OptInSchema = z.object({ optIn: z.boolean() });

export const WorkLocationSchema = z.object({
  name: z.string().trim().min(1).max(150),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(5000).default(150),
});

const DaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(TIME),
    endTime: z.string().regex(TIME),
    isDayOff: z.boolean(),
  })
  .refine((d) => d.isDayOff || d.startTime < d.endTime, {
    message: "Boshlanish tugashdan oldin bo'lishi kerak",
  });

export const ScheduleWeekSchema = z
  .object({ days: z.array(DaySchema).max(7) })
  .refine((o) => new Set(o.days.map((d) => d.weekday)).size === o.days.length, {
    message: 'weekday takrorlangan',
  });

export const AttendanceConfigSchema = z.object({
  workLocationId: z.string().uuid().nullable(),
  attendanceOptIn: z.boolean(),
  // Named-schedule assignment (TimePay Jadval). Optional so existing callers
  // that only set branch/opt-in leave it untouched; null clears it (→ weekday
  // fallback in resolveShift).
  scheduleId: z.string().uuid().nullable().optional(),
});

export const MonthlyReportFilterSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  employeeId: z.string().uuid().optional(),
});

/**
 * X2 — xodimning O'Z davomat tarixi (`GET /hr/attendance/my/history`).
 *
 * 🔴 `employeeId` maydoni ATAYLAB YO'Q: xodim kimning tarixini so'rashini
 * TANLAY OLMAYDI, manba har doim `user.sub`. Zod obyekti sukut bo'yicha
 * notanish kalitlarni OLIB TASHLAYDI, ya'ni `?employeeId=<o'zga>` jimgina
 * yo'qoladi (X-reja 0-bo'lim 7-qoidasi). Qo'riqchi test:
 * `my-history.controller.test.ts`.
 *
 * `yearMonth` berilmasa — joriy oy (servis Toshkent kalendaridan oladi).
 */
export const MyHistoryQuerySchema = z.object({
  yearMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Oy 'yyyy-MM' ko'rinishida bo'lishi kerak")
    .optional(),
});

export const DashboardQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Sana 'yyyy-MM-dd' formatida")
    .optional(),
});

export type PingInput = z.infer<typeof PingSchema>;
export type WorkLocationInput = z.infer<typeof WorkLocationSchema>;
export type ScheduleWeekInput = z.infer<typeof ScheduleWeekSchema>;
export type AttendanceConfigInput = z.infer<typeof AttendanceConfigSchema>;
export type MonthlyReportFilter = z.infer<typeof MonthlyReportFilterSchema>;
export type MyHistoryQuery = z.infer<typeof MyHistoryQuerySchema>;
