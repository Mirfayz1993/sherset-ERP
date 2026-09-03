import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.schema.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../permissions/require-permission.decorator.js';
import { RetailSaleService } from './retail-sale.service.js';

@Controller('retail-sales')
@UseGuards(JwtAuthGuard)
export class RetailSaleController {
  constructor(@Inject(RetailSaleService) private readonly sales: RetailSaleService) {}

  @Get()
  @RequirePermission({ entity: 'retailsale', action: 'view' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, unknown>) {
    return this.sales.list(user.accountId, query);
  }

  /**
   * Z-report for a session. Must be declared before :id to avoid conflict.
   * Usage: GET /retail-sales/z-report?sessionId=<uuid>
   */
  @Get('z-report')
  @RequirePermission({ entity: 'retailsale', action: 'view' })
  async zReport(@CurrentUser() user: AuthenticatedUser, @Query('sessionId') sessionId: string) {
    return this.sales.zReport(user.accountId, sessionId);
  }

  /**
   * G2 — kontrol navbati: yig'ib bo'lingan (`picking` + hamma topshiriq yopiq)
   * cheklar, katta omborchi «To'liq»/«Tahrirlash» qiladi. `:id` dan OLDIN
   * turishi shart (marshrut to'qnashuvi — z-report bilan bir sabab).
   *
   * Ruxsat — alohida `retailcontrol` entity: `retailsale.view` bilan
   * qo'riqlasak oddiy omborchi (storekeeper) ham kontrolni ko'rardi, egasining
   * qoidasi esa aniq: kontrol FAQAT katta omborchida.
   */
  @Get('control-queue')
  @RequirePermission({ entity: 'retailcontrol', action: 'view' })
  async controlQueue(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.sales.controlQueue(user.accountId, query);
  }

  @Get(':id')
  @RequirePermission({ entity: 'retailsale', action: 'view' })
  async findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.findById(user.accountId, id);
  }

  @Post()
  @RequirePermission({ entity: 'retailsale', action: 'create' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.sales.create(user.accountId, body);
  }

  /**
   * SOTUVSIZ CHEK uchun kunlik raqam (2026-09-02, egasi).
   *
   * `:id` li POST marshrutlari ikki segmentli, bu esa bitta — to'qnashuv
   * yo'q, lekin o'qish uchun `create()` dan darhol keyin turadi.
   *
   * Ruxsat `create`: qog'ozga chek chiqarish — sotuv qilish huquqining bir
   * qismi. `view` bilan qo'riqlansa, faqat ko'rish huquqi bor xodim
   * hisoblagichni surib, kassirning kunlik ketma-ketligida teshik qoldirardi.
   */
  @Post('receipt-number')
  @RequirePermission({ entity: 'retailsale', action: 'create' })
  async receiptNumber(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.sales.allocateReceiptNumber(user.accountId, body);
  }

  @Patch(':id')
  @RequirePermission({ entity: 'retailsale', action: 'update' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sales.update(user.accountId, id, body);
  }

  @Post(':id/mark-ready')
  @RequirePermission({ entity: 'retailsale', action: 'update' })
  async markReady(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.markReady(user.accountId, id, user.sub);
  }

  /**
   * G2 — kontrol «To'liq»: `picking → ready` KATTA OMBORCHI qo'lidan.
   * `mark-ready` dan farqi — ruxsat (`retailcontrol.update`) va audit
   * (kim tekshirgani yoziladi). Kichik omborchining `mark-ready`i endi
   * flip qilmaydi (servis izohi) — zanjir: omborchilar → kontrol → kassir.
   */
  @Post(':id/control-approve')
  @RequirePermission({ entity: 'retailcontrol', action: 'update' })
  async controlApprove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.controlApprove(user.accountId, user.sub, id);
  }

  /**
   * G2 — kontrol tahriri: qator o'chirish / sonni kamaytirish, `picking`
   * holatida. `PATCH :id/edit` bilan ADASHTIRMANG — u to'langan (posted)
   * chekning pul qatlamini tahrirlaydi; bu esa yig'ilayotgan chek TARKIBINI.
   */
  @Patch(':id/control-edit')
  @RequirePermission({ entity: 'retailcontrol', action: 'update' })
  async controlEdit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sales.controlEdit(user.accountId, user.sub, id, body);
  }

  @Post(':id/send-to-picking')
  @RequirePermission({ entity: 'retailsale', action: 'update' })
  async sendToPicking(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.sendToPicking(user.accountId, id, user.sub, user.name);
  }

  @Post(':id/post')
  @RequirePermission({ entity: 'retailsale', action: 'approve' })
  async post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sales.post(user.accountId, user.sub, id, body);
  }

  @Post(':id/cancel')
  @RequirePermission({ entity: 'retailsale', action: 'approve' })
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.cancel(user.accountId, user.sub, id);
  }

  /**
   * P3 (2026-08-12) — qaytarish `retailsale.approve` DAN `salesreturn.create` GA
   * ko'chirildi (egasi qarori).
   *
   * Sabab: o'sha fazada kassirga `retailsale.approve` berildi — usiz u chekni
   * na to'lay, na bekor qila olardi. Lekin qaytarish AYNI ruxsatda o'tirardi,
   * ya'ni to'lovni ochish kassadan pul chiqarishni ham jimgina ochib yuborardi.
   * Egasi qarori: qaytarish menejer/admin ishi bo'lib qoladi.
   *
   * `salesreturn` — mavjud entity (yangi union a'zosi kiritilmadi) va amal
   * mazmunan to'g'ri: qaytarish chek MIRRORINI YARATADI. Xuddi shu entity'ni
   * `restock-task.controller` ham qaytarish yo'lida ishlatadi.
   */
  /**
   * To'langan chekni tahrirlash (mijoz + to'lov taqsimoti). Ruxsat `approve` —
   * `post`/`cancel` bilan bir darajada, chunki u pul va qarzga tegadi.
   */
  @Patch(':id/edit')
  @RequirePermission({ entity: 'retailsale', action: 'approve' })
  async editPosted(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sales.edit(user.accountId, user.sub, id, body);
  }

  /**
   * CHEK IZOHI (2026-08-19, egasi). Ruxsat `update` — `approve` EMAS: izoh
   * pulga ham, omborga ham, chek holatiga ham tegmaydi, ya'ni uni `post`
   * darajasidagi ruxsat ortiga yashirish kassirni o'z chekiga eslatma yozish
   * imkonidan mahrum qilardi. Iz `AuditLog` da (kim, qachon, eski → yangi).
   */
  @Patch(':id/comment')
  @RequirePermission({ entity: 'retailsale', action: 'update' })
  async updateComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sales.updateComment(user.accountId, user.sub, id, body);
  }

  @Post(':id/refund')
  @RequirePermission({ entity: 'salesreturn', action: 'create' })
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sales.refund(user.accountId, user.sub, id, body);
  }

  /**
   * F2 — «Отправил кладовщику» on a refund receipt: flags the receipt and
   * notifies the warehouse keeper (store's Владелец-сотрудник; fallback:
   * every other active employee) via 🔔 + SSE (FE adds the sound).
   */
  @Post(':id/send-to-warehouse')
  @RequirePermission({ entity: 'retailsale', action: 'update' })
  async sendToWarehouse(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.sendToWarehouse(user.accountId, user.sub, id);
  }
}
