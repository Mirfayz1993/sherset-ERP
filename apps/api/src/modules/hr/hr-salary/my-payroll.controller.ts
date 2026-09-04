import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { HrPermissionGuard } from '../hr-auth/hr-permission.guard.js';
import { RequireHrPermission } from '../hr-auth/require-hr-permission.decorator.js';
import { MyPayrollParamsSchema } from './my-payroll.schema.js';
import { MyPayrollService } from './my-payroll.service.js';

/**
 * X6 — «Oyligim» (mobil ilova). Xodimning O'Z oylik hisobi.
 *
 * ## Darvoza: `oylik:own_only` (X5 dan FARQLI — sabab bilan)
 *
 * X5 da «Mening KPI'im» ATAYLAB `JwtAuthGuard` + qat'iy self bilan
 * ochilgan edi: `oylik` — OYLIK sahifasi, KPI esa menejer tomonda
 * `employees` ostida turadi, ya'ni KPI'ni `oylik` darvozasiga bog'lash
 * noto'g'ri xarita bo'lardi.
 *
 * Bu yerda xarita TO'G'RI keladi: bu AYNAN oylik sahifasining o'z-o'ziga
 * qamralgan ko'rinishi va `hr-permission-adapter` `oylik:own_only` ni
 * `hrsalary` + `view:OWN` ga xaritalaydi. X-reja X6 ham `own_only` ni
 * nomma-nom talab qiladi va qabul mezoni «`oylik` ruxsati umuman yo'q
 * xodim → 403» degan MANFIY testni majburiy qiladi. Ya'ni 403 bu yerda
 * nuqson emas, KUTILGAN xulq: pul raqami ochiq turadigan yo'l emas.
 *
 * ⚠️ Amaliy oqibat (X5 hisobotining eslatmasi): `seed-hr.ts` sahifa
 * qatorlarini faqat egalarga/adminlarga yozadi, qolganiga HR ekranidan
 * qo'lda beriladi. Jonlida har xodimga `oylik:own_only` qatori
 * berilmasa — plitka bor, ekran esa 403 ko'rsatadi (fail-closed). Bu
 * savol egasiga X6 hisobotida ochiq qo'yilgan; darvozani yumshatish
 * qarori X-rejaga zid bo'lgani uchun bu fazada QABUL QILINMADI.
 *
 * ⚠️ Yo'l `hr/payroll` prefiksini `HrSalaryController` bilan BO'LISHADI
 * (`@Get('payroll/:yearMonth')`), lekin segment soni boshqa:
 * `hr/payroll/my/:yearMonth` ≠ `hr/payroll/:yearMonth`. Fastify
 * `FST_ERR_DUPLICATED_ROUTE` faqat AYNI yo'lda chiqadi va `app-boot.test.ts`
 * buni qulflaydi (2026-08-05 hodisasi).
 */
@Controller('hr/payroll')
@UseGuards(JwtAuthGuard, HrPermissionGuard)
export class MyPayrollController {
  constructor(@Inject(MyPayrollService) private readonly svc: MyPayrollService) {}

  /**
   * O'z oyligi. 🔴 Kim so'ralayotgani FAQAT `user.sub` dan; kontroller
   * `@Query` ni ham, `@Body` ni ham O'QIMAYDI, ya'ni `?employeeId=` hech
   * qanday maydonni to'ldirmaydi (`my-payroll.controller.test.ts` manba
   * matnini ham tekshiradi).
   */
  @Get('my/:yearMonth')
  @RequireHrPermission('oylik', 'own_only')
  async my(@CurrentUser() user: AuthenticatedUser, @Param('yearMonth') yearMonth: string) {
    const params = MyPayrollParamsSchema.parse({ yearMonth });
    return this.svc.myMonthly(user.accountId, user.sub, params.yearMonth);
  }
}
