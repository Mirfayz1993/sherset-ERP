import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.schema.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { MyHistoryQuerySchema, OptInSchema, PingSchema } from './attendance-geo.schema.js';
import { HrDavomatReportService } from './davomat-report.service.js';
import { HrDavomatStatusService } from './davomat-status.service.js';
import { HrPingIngestService } from './ping-ingest.service.js';

/**
 * Employee-self davomat endpoints (JwtAuthGuard only — employeeId = user.sub).
 * The PWA POSTs pings and renders status straight from the ping response.
 */
@Controller('hr/attendance')
@UseGuards(JwtAuthGuard)
export class HrDavomatPingController {
  constructor(
    @Inject(HrPingIngestService) private readonly ingest: HrPingIngestService,
    @Inject(HrDavomatStatusService) private readonly status: HrDavomatStatusService,
    @Inject(HrDavomatReportService) private readonly report: HrDavomatReportService,
  ) {}

  @Post('ping')
  async ping(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.ingest.ingest(user.accountId, user.sub, PingSchema.parse(body));
  }

  @Get('my/today')
  async myToday(@CurrentUser() user: AuthenticatedUser) {
    return this.status.myToday(user.accountId, user.sub);
  }

  /**
   * X2 — xodimning O'Z oylik davomat tarixi (mobil «Davomat» ekrani).
   *
   * 🔴 Kim so'ralayotgani FAQAT `user.sub` dan olinadi. So'rovdagi
   * `?employeeId=` (yoki boshqa har qanday notanish kalit) `MyHistoryQuerySchema`
   * da OLIB TASHLANADI — u bu yergacha yetib kelmaydi. Bu shart
   * `my-history.controller.test.ts` da qulflangan.
   */
  @Get('my/history')
  async myHistory(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const { yearMonth } = MyHistoryQuerySchema.parse(query ?? {});
    return this.report.myHistory(user.accountId, user.sub, yearMonth);
  }

  @Post('my/opt-in')
  async optIn(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.status.setOptIn(user.accountId, user.sub, OptInSchema.parse(body).optIn);
  }

  /** Instant self-service "Keldim" button — geofence-verified, no debounce wait. */
  @Post('my/check-in')
  async manualCheckIn(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.ingest.manualCheckIn(user.accountId, user.sub, PingSchema.parse(body));
  }

  /** Instant self-service "Ketyapman" button — closes today's open record immediately. */
  @Post('my/check-out')
  async manualCheckOut(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.ingest.manualCheckOut(user.accountId, user.sub, PingSchema.parse(body));
  }
}
