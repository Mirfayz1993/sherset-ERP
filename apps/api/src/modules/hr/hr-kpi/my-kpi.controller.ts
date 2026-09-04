import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { MyKpiQuerySchema } from './my-kpi.schema.js';
import { MyKpiService } from './my-kpi.service.js';

/**
 * X5 — «Mening KPI'im» (mobil ilova). Xodimning O'Z kunlik KPI kartalari.
 *
 * ## Nega FAQAT `JwtAuthGuard`, nega `@RequireHrPermission('oylik','own_only')` EMAS
 *
 * X-reja X5 ikkala variantni ham ruxsat berib, `hr-permission-adapter` bilan
 * solishtirib tanlashni so'raydi. Tanlov — qat'iy self, sabablari:
 *
 *  1. **`oylik` — OYLIK sahifasi, KPI emas.** Adapter (`hr-permission-adapter.ts`)
 *     `oylik` ni `hrsalary` entity'siga xaritalaydi, `own_only` esa
 *     `view:OWN` ga. Ya'ni KPI'ni shu darvoza ostiga qo'yish «o'z KPI'ingni
 *     ko'rish» huquqini «o'z OYLIGINGNI ko'rish» huquqiga bog'lab qo'yardi:
 *     kelajakda oylik ko'rinishi o'zgartirilsa KPI ham jimgina o'zgarardi.
 *     Menejer tomonda KPI `employees` sahifasi ostida turibdi, `oylik` ostida
 *     emas (`manager-kpi.controller.ts`).
 *  2. **HR sahifa-ruxsatlari oddiy xodimda YO'Q.** `seed-hr.ts` sahifa
 *     qatorlarini FAQAT egalarga/adminlarga yozadi, qolganiga esa HR
 *     ekranidan qo'lda beriladi. `oylik:own_only` talab qilinsa, o'sha qator
 *     berilmagan har bir xodim o'z KPI'sini 403 bilan ko'rmasdi — plitka
 *     bor-u ekran o'lik bo'lardi.
 *  3. **Bu qaror shu domenda ALLAQACHON qabul qilingan.**
 *     `manager/kpi/days/:id/explain` da `@RequireHrPermission` ATAYLAB yo'q
 *     (kontroller izohi): oddiy xodimda `employees:read` bo'lmaydi, lekin u
 *     O'Z kuniga tushuntirish bera olishi SHART. O'z kunini O'QISH undan ham
 *     yumshoqroq amal.
 *  4. **Naqsh: `hr/attendance/my/*` va `driver-tracking` self-yo'llari** —
 *     hammasi `JwtAuthGuard` + `user.sub`, X2 va X4 shu bo'yicha qilingan.
 *
 * Xavfsizlik shu bilan zaiflashmaydi: darvoza emas, QAMROV himoya qiladi —
 * `employeeId` so'rovdan olinmaydi (`MyKpiQuerySchema` da bunday maydon yo'q)
 * va servis `where` i `accountId` + `employeeId` bilan qat'iy yopilgan.
 *
 * ⚠️ Yo'l `hr/kpi` prefiksini `HrKpiController` bilan BO'LISHADI, lekin
 * segment boshqa (`my` ≠ `daily`/`snapshot`) — Fastify `FST_ERR_DUPLICATED_ROUTE`
 * faqat AYNI yo'lda chiqadi (`manager-kpi.controller.ts` dagi 2026-08-05
 * hodisasi).
 */
@Controller('hr/kpi')
@UseGuards(JwtAuthGuard)
export class MyKpiController {
  constructor(@Inject(MyKpiService) private readonly svc: MyKpiService) {}

  /**
   * Oxirgi kunlar (sukut 30). 🔴 Kim so'ralayotgani FAQAT `user.sub` dan;
   * `?employeeId=` / `?accountId=` sxemada YO'Q va bu yergacha yetib
   * kelmaydi (`my-kpi.controller.test.ts` qulflaydi).
   */
  @Get('my')
  async my(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const q = MyKpiQuerySchema.parse(query ?? {});
    return this.svc.listMine(user.accountId, user.sub, q);
  }
}
