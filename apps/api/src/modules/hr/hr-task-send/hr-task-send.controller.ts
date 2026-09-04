import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { HrPermissionGuard } from '../hr-auth/hr-permission.guard.js';
import { RequireHrPermission } from '../hr-auth/require-hr-permission.decorator.js';
import {
  AnswerTaskSchema,
  DispatchTemplateSchema,
  ListLogsFilterSchema,
  MyTasksQuerySchema,
} from './hr-task-send.schema.js';
import { HrTaskSendService } from './hr-task-send.service.js';

/**
 * Xodim O'ZGA odamning vazifalarini so'ray oladimi?
 *
 * `own_only` — YO'Q, `read`/`full` — HA (`hr-permission.guard.ts` dagi
 * `ACCESS_RANK` bilan bir xil ma'no). Admin roli hamma HR sahifasidan o'tadi,
 * shuning uchun u ham HA.
 *
 * 🔴 Bu qaror AYNAN shu yerda — servisda EMAS. Servis `scopeEmployeeId` ni
 * qat'iy shift deb biladi va uni hech qanday query-param bosib o'tolmaydi
 * (X3 tuzatishi); kimga qamrov qo'yilishini esa ruxsat darajasi hal qiladi.
 */
function mayReadOthersTasks(user: AuthenticatedUser): boolean {
  if (user.hrRoles?.includes('admin')) return true;
  const perm = user.hrPermissions?.find((p) => p.pageKey === 'tasks' && p.section === null);
  return perm?.accessLevel === 'read' || perm?.accessLevel === 'full';
}

@Controller('hr/tasks')
@UseGuards(JwtAuthGuard, HrPermissionGuard)
export class HrTaskSendController {
  constructor(@Inject(HrTaskSendService) private readonly svc: HrTaskSendService) {}

  /** Admin manually triggers a template. */
  @Post('send')
  @RequireHrPermission('tasks', 'full')
  async send(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = DispatchTemplateSchema.parse(body);
    return this.svc.dispatch(user.accountId, input);
  }

  /** Xodim javob beradi. Service enforces own-task ownership. */
  @Post('logs/:id/answer')
  @RequireHrPermission('tasks', 'own_only')
  async answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = AnswerTaskSchema.parse(body);
    return this.svc.recordAnswer(user.accountId, id, user.sub, input);
  }

  /**
   * «Ishlarim» — xodimning O'Z vazifalari (X3).
   *
   * `own_only` yetadi: bu ekran har bir xodimga ochiq. `employeeId` bu yo'lda
   * UMUMAN yo'q — `MyTasksQuerySchema` uni tashlab yuboradi, xodim esa doim
   * `user.sub`.
   */
  @Get('my')
  @RequireHrPermission('tasks', 'own_only')
  async my(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const q = MyTasksQuerySchema.parse(query ?? {});
    return this.svc.listMyTasks(user.accountId, user.sub, q);
  }

  /**
   * Vazifa jurnali.
   *
   * Sukut bo'yicha QAMROV TOR — xodim o'zinikini ko'radi. Admin butun
   * akkauntni ko'radi. O'ZGA xodimni `?employeeId=` bilan so'rash faqat
   * `tasks:read`+ da mumkin (`mayReadOthersTasks`); qamrov qo'yilgan
   * chaqiruvda esa param servisda E'TIBORSIZ qoladi — X3 gacha aynan shu
   * param qamrovni bosib o'tardi.
   */
  @Get('logs')
  @RequireHrPermission('tasks', 'read')
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const filter = ListLogsFilterSchema.parse(query);
    const isAdmin = user.hrRoles?.includes('admin') ?? false;
    const asksForSomeoneElse = !!filter.employeeId && mayReadOthersTasks(user);
    const scope = isAdmin || asksForSomeoneElse ? null : user.sub;
    return this.svc.listLogs(user.accountId, scope, filter);
  }
}
