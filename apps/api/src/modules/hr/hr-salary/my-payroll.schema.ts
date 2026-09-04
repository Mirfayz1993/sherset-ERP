import { z } from 'zod';

/**
 * X6 — «Oyligim» so'rovi.
 *
 * Oy — YO'L PARAMETRI (`GET /hr/payroll/my/:yearMonth`), so'rov satri emas.
 * Ya'ni kontroller `@Query`/`@Body` ni UMUMAN o'qimaydi va `?employeeId=`
 * qayerga qo'yilsa ham hech qanday maydonni to'ldirmaydi (X2
 * `MyHistoryQuerySchema`, X3 `MyTasksQuerySchema`, X5 `MyKpiQuerySchema`
 * bilan bir shartnoma, faqat manba boshqa).
 *
 * 🔴 `employeeId` / `accountId` maydonlari ATAYLAB YO'Q — xodim so'rovda
 * KIMNI so'rashini tanlay olmaydi, u doim `user.sub`.
 *
 * Regex `HrSalaryController.parseYearMonth` dan QATTIQROQ: u `\d{4}-\d{2}`
 * ga rozi, ya'ni `2026-00` va `2026-13` ni ham o'tkazib yuborardi (keyin
 * `payroll-formula.util` da xom `Error` bo'lib chiqardi). Bu yerda oy
 * 01…12 bilan chegaralangan va rad javobi zod'niki.
 */
export const MyPayrollParamsSchema = z.object({
  yearMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "yearMonth 'YYYY-MM' formatida bo'lishi kerak"),
});
export type MyPayrollParams = z.infer<typeof MyPayrollParamsSchema>;
