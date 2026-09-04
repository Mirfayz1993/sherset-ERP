import { z } from 'zod';

/**
 * X5 — «Mening KPI'im» so'rovi.
 *
 * 🔴 `employeeId` maydoni ATAYLAB YO'Q (X2 `MyHistoryQuerySchema` va X3
 * `MyTasksQuerySchema` naqshi): zod obyekti notanish kalitlarni olib
 * tashlaydi, ya'ni `?employeeId=<o'zga>` kontrollergacha YETIB BORMAYDI.
 * Xodim so'rovda KIMNI so'rashini tanlay olmaydi — u doim `user.sub`.
 *
 * `accountId` ham shu sababdan yo'q.
 *
 * Chegara 90 kun: ekran oxirgi kunlar trendini ko'rsatadi, arxiv emas.
 * Sukut 30 — reja aytgan qiymat.
 */
export const MyKpiQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(90).default(30),
});
export type MyKpiQuery = z.infer<typeof MyKpiQuerySchema>;
