import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.schema.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../permissions/require-permission.decorator.js';
import { CountSessionService } from './count-session.service.js';

/**
 * Sanash sessiyasi sirti — N-reja §5-N2. **Narxsiz** (`count-session.ts` dagi
 * `select` oq ro'yxati).
 *
 * Ruxsat: YANGI ruxsat KIRITILMADI (N-reja §5-N2.4). Sessiya — yacheyka
 * sanashning izi, ya'ni u AYNI amalga tayanadi:
 *   · ochish/yopish → `storecell:update` (sanashning o'zi ham shu ruxsat bilan:
 *     `PUT /admin/stores/:id/cells/:cellId/stock` — `store.controller.ts`);
 *   · ko'rish       → `storecell:view`.
 * `storekeeper` shabloni ikkalasini ham `ALL` bilan oladi
 * (`role-templates.ts`) ⇒ `role-templates.ts` ga TEGILMADI.
 */
@Controller('tsd/count-sessions')
@UseGuards(JwtAuthGuard)
export class CountSessionController {
  constructor(@Inject(CountSessionService) private readonly svc: CountSessionService) {}

  /** «Sanashni boshlash» — `{ storeId }`. Takroriy so'rov mavjudini qaytaradi. */
  @Post()
  @RequirePermission({ entity: 'storecell', action: 'update' })
  async open(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.svc.open(user.accountId, user.sub, body);
  }

  /** Ochiq sessiya + hisoblagichlar (`{ session: null }` — sessiya yo'q). */
  @Get('active')
  @RequirePermission({ entity: 'storecell', action: 'view' })
  async active(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.active(user.accountId, user.sub);
  }

  /** «Yopish» — `closedAt` + `state = 'counted'`. Qoldiqqa TEGMAYDI. */
  @Post(':id/close')
  @RequirePermission({ entity: 'storecell', action: 'update' })
  async close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.close(user.accountId, user.sub, id);
  }
}
