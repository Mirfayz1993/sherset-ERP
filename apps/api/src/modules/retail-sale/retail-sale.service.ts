import type { Prisma } from '@moysklad/db';
import { scaleMinorByQty } from '@moysklad/money';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { allocateDocumentNumber } from '../../prisma/document-number.js';
import { PrismaService } from '../../prisma/prisma.service.js';
// Kassa TZ §7.1 — qarzga sotish mijoz balansiga yoziladi (moysklad «Баланс»
// ishora konventsiyasi: musbat = mijoz bizga qarzdor).
import { CounterpartyBalanceService } from '../counterparty-balance/counterparty-balance.service.js';
// F8 — zakazni POS'dan to'lash. Zakaz holatini O'ZIMIZ o'zgartirmaymiz:
// `applyPayment` MAVJUD primitiv (cash-in / invoice-out ham shuni chaqiradi)
// va o'z ichida `confirmed|awaiting_payment → paid` o'tishini bajaradi.
import { CustomerOrderService } from '../customer-order/customer-order.service.js';
// Q2 (2026-08-25) — kassa qarzini UNDIRISH REYESTRIGA ulash. Sof qoidalar Q1'da
// yozilgan (`docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md` §2.2/§3):
// qator summasi chekning qarz ulushi EMAS, balki chek balansni musbat hududga
// qanchaga olib kirgani — ya'ni AVANSI bor mijozga qator umuman ochilmaydi.
// Q3 (2026-08-25) — SIMMETRIYA (invariant 2): balans `−` olganda chekdan
// tug'ilgan reyestr qatori ham AYNAN shuncha kamayadi, aks holda undirish
// ro'yxati qaytarilgan tovar uchun pul talab qilib turardi.
// Q4 (2026-08-25): muddat endi AKKAUNT SOZLAMASIDAN keladi
// (`CompanySettings.saleDebtTermDays`); sozlanmagan bo'lsa Q1 ning
// kod-defaulti (14 kun) qoladi — `resolveSaleDebtTermDays`.
import {
  DEBT_LEDGER_CURRENCY,
  DEFAULT_SALE_DEBT_TERM_DAYS,
  SALE_DEBT_SOURCE_DOC_TYPE,
  SALE_DEBT_TERM_DAYS_MAX,
  SALE_DEBT_TERM_DAYS_MIN,
  isSaleDebtTermDaysCorrupt,
  planSaleDebtDelta,
  planSaleDebtRow,
  receivablePortion,
  resolveSaleDebtTermDays,
  saleDebtDueAt,
  saleDebtMoveNoteText,
} from '../debt/sale-debt-registry.js';
// §109: loyalty accrual/reversal on POS sale/refund. Only loyalty's
// existing public API is called (computeEarnedPoints + createOperation);
// the loyalty module itself is NOT edited (DO NOT respected).
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { type MoneyDelta, MoneyService } from '../money/money.service.js';
// F2: «Отправил кладовщику» — in-app 🔔 + SSE push to the warehouse keeper.
import { NotificationService } from '../notification/notification.service.js';
// F6 (ombor restrukturizatsiyasi) — kassa kaskad dvigateli (sof modul):
// stok ombori endi smena omborida emas, `Store.attributes.__posPriority`
// bo'yicha tanlanadi (Q1: «Ombor 07» birinchi). Pul oqimi smena/kassada qoladi.
import { readBrakStore } from '../sales-return/sales-return-acceptance.js';
// Faza 18a (QAROR-A weighted-average, STK-02): the POS stock outflow is priced
// from the per-store locked balance with the same helpers Loss uses.
import {
  compareDecimals,
  computePerUnitCost,
  formatDecimalScaled,
  parseDecimalScaled,
} from '../shared/decimal.js';
import { resolveCreatorGroupId } from '../shared/group-stamp.js';
// Optimistic-lock (lost-update guard) for the draft field-edit update() path.
import { mapVersionedUpdateError } from '../shared/optimistic-lock.js';
// K4 — bo'lak reyestri: kassirning kelishuvi («150+30»), mijozga ketgan
// bo'laklarning to'lov paytida reyestrdan chiqishi va bekor qilishda
// bo'shatilishi. `stock_pieces` ga yozadigan kod SHU IKKI FUNKSIYADA
// (`stock-piece` moduli) — bu servis jadvalga o'zi tegmaydi.
import { formatPieceLengths } from '../stock-piece/piece-cut-core.js';
import {
  consumePiecesForSale,
  releasePiecesForSale,
} from '../stock-piece/stock-piece-cut.service.js';
import {
  type StockBalance,
  type StockDelta,
  StockService,
  netOutstandingReservations,
} from '../stock/stock.service.js';
import {
  CASHIER_EVENT,
  type CashierAuditEventInput,
  planCancelAuditEvent,
  planControlApproveAuditEvent,
  planControlEditAuditEvent,
  planCreditSaleAuditEvent,
  planPrepaySaleAuditEvent,
  planRefundAuditEvent,
  planSaleAuditEvents,
} from './cashier-audit.js';
import { computePositions } from './compute-positions.js';
// Kunlik chek raqami (kassir bo'yicha) — kalit shakli va Toshkent kun
// chegarasi sof modulda, testi bilan (`daily-receipt-number.test.ts`).
import { dailyReceiptSequenceKey } from './daily-receipt-number.js';
import {
  type FrozenPrices,
  type SalePricesJson,
  resolveWholesaleMinor,
  snapshotPricesByProduct,
} from './price-snapshot.js';
import {
  type AllocStore,
  type PositionAllocation,
  allocateForSale,
  buildShortfallMessage,
  collectPieceTracked,
  readPosFrontStore,
  resolveAllocStores,
  spreadAllocationsToPositions,
} from './retail-allocation.js';
// G2 — kontrol oqimi (sof qaror moduli): navbatga tushish sharti + tahrir
// rejasi (faqat kamaytirish) + kassirga boradigan bildirishnoma matni.
import {
  type ControlPositionBefore,
  controlEditNotificationBody,
  isControlReady,
  planControlEdit,
} from './retail-control.js';
import { planLoyaltyAccrual, planLoyaltyReversal } from './retail-loyalty.js';
// Faza 18a: refund returns EXACTLY the value the original sale's outflow
// booked (cumulative remainder over partial refunds; NULL mirror for legacy
// sales posted before the fix) — see retail-refund-cogs.test.ts.
import { buildRefundCostBasis, consumeRefundCost } from './retail-refund-cogs.js';
// Pure, adversarially-tested refund guards (§105 — enforces the
// schema's documented "subset of original positions" contract that
// refund() never checked: blocks over-refund of qty/products/cash).
import {
  computeRefundSettlementCaps,
  isFullyRefunded,
  priceRefundFromOriginal,
  validateRefundAmount,
  validateRefundPositions,
  validateRefundSettlement,
} from './retail-refund-validation.js';
// Yagona FSM o'tish jadvali — oldindan tekshiruv va tranzaksiya ichidagi CAS
// qo'riqchisi bir manbadan oziqlanadi (ajralib qolsa qo'riqchi tor/keng bo'ladi).
import { formatQty, parseQty, planReceiptEdit } from './retail-sale-edit-plan.js';
import { allowedFrom, canTransition, transitionRejection } from './retail-sale-fsm.js';
import {
  AllocateReceiptNumberSchema,
  ControlEditSchema,
  ControlQueueFilterSchema,
  CreateRetailSaleSchema,
  EditRetailSaleSchema,
  ORDER_PAYABLE_STATES,
  PostRetailSaleSchema,
  RefundRetailSaleSchema,
  RetailSaleFilterSchema,
  UpdateRetailSaleSchema,
  UpdateSaleCommentSchema,
  ZReportQuerySchema,
} from './retail-sale.schema.js';
import { type CascadeStore, orderCascadeStores, readPosPriority } from './retail-stock-cascade.js';
// Kassa TZ §6 — aralash to'lov qoidalari (sof, testlangan).
import {
  TENDER,
  computeTenders,
  legacyTotals,
  lineBaseMinor,
  lineCurrency,
  usdBaseMinor,
} from './retail-tenders.js';

/**
 * RetailSaleService — POS receipt CRUD + FSM.
 *
 * FSM rules (yagona jadval: `./retail-sale-fsm.ts`):
 *   draft → picking → ready           — omborchi zanjiri (send-to-picking / mark-ready)
 *   draft | ready → posted (post())   — session must be open; payment >= sumMinor
 *   draft | picking | ready → cancelled (cancel()) — no payment taken
 *   posted → refunded                 — creates a mirror RetailSale (negative)
 *
 * V1 deferred:
 *   - Stock cascades on post (TODO: deduct from session.storeId — same as WorkOrder V2 pattern)
 *   - MoneyOperation ledger writes on post (TODO: write CashDesk.balanceMinor delta inline once
 *     MoneyOperation schema is extended for 'retailsale' documentKind)
 *
 * V1 IMPLEMENTED:
 *   - CashDesk.balanceMinor incremented on post (cash portion only)
 *   - CashDesk.balanceMinor decremented on refund (cash portion)
 *   - Session aggregates (salesCount, salesSumMinor, returnsCount, returnsSumMinor) updated on post
 */

/**
 * Tovarning «uy» yacheykasi — climart tizimidan («01-02-03-05» satri).
 * Sherset'da bu 4 ta ustun edi (`locSklad/locPolka/...`); egasining qaroriga
 * ko'ra (2026-08-01) ular qaytarilmadi — bitta manzil tizimi qoladi.
 */
function cellOf(attrs: unknown): string {
  if (attrs && typeof attrs === 'object' && '__yacheyka' in attrs) {
    const v = (attrs as Record<string, unknown>).__yacheyka;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/** «01-02-03-05» → 1 (ombor raqami); kod yo'q/noraqamli bo'lsa null. */
function skladNoOf(cell: string): number | null {
  const first = cell.split('-')[0];
  const n = Number(first);
  return first !== '' && Number.isInteger(n) ? n : null;
}

@Injectable()
export class RetailSaleService {
  private readonly logger = new Logger(RetailSaleService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(MoneyService) private readonly money: MoneyService,
    @Inject(LoyaltyService) private readonly loyalty: LoyaltyService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    // Kassa TZ §7.1 — qarzga sotilgan qism mijozning umumiy balansiga tushadi.
    @Inject(CounterpartyBalanceService)
    private readonly counterpartyBalance: CounterpartyBalanceService,
    // F8 — chek zakazni yopadi. Modul `RetailSaleModule.imports` ga OSHKORA
    // qo'shildi (xotira: «@Global in'yeksiya qo'riqsiz» — hech bir test DI
    // grafini qurmaydi, `app-boot.test.ts` dan boshqa).
    @Inject(CustomerOrderService)
    private readonly customerOrders: CustomerOrderService,
  ) {}

  /**
   * F2 (user feature 2026-07-03) — «Отправил кладовщику» on a REFUND receipt.
   *
   * Guards: the receipt must be a refund mirror (refundedFromId set) and not
   * already sent (idempotent — the flag lives in attributes.__sentToWarehouse,
   * no schema migration). Recipients: the store's «Владелец-сотрудник» when
   * assigned; otherwise every other active employee of the account (the
   * cashier who pressed the button is never notified about their own send).
   * Notification fan-out is best-effort (NotificationService.emit swallows
   * failures) — the flag write is the source of truth.
   */
  async sendToWarehouse(accountId: string, userId: string, id: string) {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      include: {
        session: { include: { store: { select: { id: true, name: true, ownerId: true } } } },
        positions: { select: { quantity: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    if (!sale.refundedFromId) {
      throw new BadRequestException(
        'Bu chek vozvrat emas — omborga yuborish faqat vozvrat chekida',
      );
    }
    const attrs = (sale.attributes ?? {}) as Record<string, unknown>;
    if (attrs.__sentToWarehouse) {
      throw new BadRequestException('Bu vozvrat allaqachon omborchiga yuborilgan');
    }

    // Flag FIRST (source of truth), then fan out the notifications.
    const sentToWarehouse = { at: new Date().toISOString(), by: userId };
    await this.prisma.client.retailSale.update({
      where: { id, accountId },
      data: { attributes: { ...attrs, __sentToWarehouse: sentToWarehouse } },
    });

    // Recipients: store keeper (Владелец-сотрудник) → fallback every other
    // active employee. Never the sender themselves.
    const store = sale.session.store;
    let recipientIds: string[] = [];
    if (store?.ownerId && store.ownerId !== userId) {
      recipientIds = [store.ownerId];
    } else {
      const employees = await this.prisma.client.employee.findMany({
        where: { accountId, archived: false, NOT: { id: userId } },
        select: { id: true },
      });
      recipientIds = employees.map((e) => e.id);
    }

    const itemCount = sale.positions.length;
    const title = `Возврат ${sale.name} — примите товар на склад`;
    const body = `${store?.name ?? 'Склад'} · позиций: ${itemCount}`;
    await Promise.all(
      recipientIds.map((rid) =>
        this.notifications.emit(
          accountId,
          rid,
          'return_to_warehouse',
          title,
          body,
          'RetailSale',
          sale.id,
        ),
      ),
    );

    return { ok: true, sentToWarehouse, notified: recipientIds.length };
  }

  /**
   * §109 — accrue loyalty points for a posted sale. A SIDE-LEDGER:
   * runs AFTER the sale txn commits (a loyalty hiccup must not void a
   * sale the cashier already took money for). Skips anonymous sales /
   * no active program / 0 points (planLoyaltyAccrual). Idempotent —
   * never double-accrues for the same sale. Failures are LOGGED (never
   * silently swallowed — CLAUDE.md) but not rethrown (sale is valid;
   * points are reconcilable).
   */
  private async accrueLoyalty(
    accountId: string,
    userId: string,
    sale: { id: string; agentId: string | null; sumMinor: bigint },
  ): Promise<void> {
    try {
      if (!sale.agentId) return;
      const existing = await this.prisma.client.bonusOperation.findFirst({
        where: {
          accountId,
          parentEntity: 'retailsale',
          parentId: sale.id,
          transactionType: 'EARNING',
        },
        select: { id: true },
      });
      if (existing) return; // idempotent — already accrued
      const program = await this.prisma.client.bonusProgram.findFirst({
        where: { accountId, active: true, archived: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true, earnRateRulesJson: true },
      });
      const plan = planLoyaltyAccrual(
        { agentId: sale.agentId, program, saleSumMinor: sale.sumMinor },
        (p, amt) => this.loyalty.computeEarnedPoints(p, amt),
      );
      if (!plan) return;
      await this.loyalty.createOperation(accountId, userId, {
        agentId: plan.agentId,
        bonusProgramId: plan.bonusProgramId,
        transactionType: 'EARNING',
        categoryType: 'REGULAR',
        bonusValue: plan.points,
        parentEntity: 'retailsale',
        parentId: sale.id,
      });
    } catch (e) {
      this.logger.error(
        `Loyalty accrual failed for retailsale ${sale.id} (sale stands; points reconcilable): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * §109 — claw back the points earned by the original sale when it is
   * refunded. Reverses the EXACT recorded earned value (never recomputes
   * — a program-rule change must not alter the clawback; §105). SPENDING
   * / categoryType RETURN, linked to the refund. Same side-ledger,
   * logged-not-rethrown discipline as accrual.
   */
  /**
   * SALES-04 — whose debt did this receipt create?
   *
   * Normally the receipt itself says so (`agentId`, persisted by post()).
   * Receipts posted before that fix have it NULL even though the balance was
   * moved, because `/sotuv` sends the customer only in the post payload. The
   * SOLD_ON_CREDIT audit event is written inside the same transaction as the
   * balance delta, so it is the one faithful record of the debtor — a
   * fallback, never a substitute (a receipt with a customer never reads it).
   */
  private async resolveCreditDebtorId(
    accountId: string,
    original: { id: string; agentId: string | null },
    /**
     * A2 — AYNI qidiruv avans uchun ham kerak (`PAID_FROM_PREPAY`). Hodisa
     * turi parametr bo'ldi, chunki fallback mantig'i (chek qatori → audit
     * payload) ikkalasida ham AYNAN bir xil; nusxa yozilsa biri bir kun
     * eskirardi.
     */
    eventType: string = CASHIER_EVENT.soldOnCredit,
  ): Promise<string | null> {
    if (original.agentId) return original.agentId;
    const event = await this.prisma.client.cashierAuditEvent.findFirst({
      where: { accountId, docId: original.id, type: eventType },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    const payload = event?.payload;
    if (payload && typeof payload === 'object' && 'agentId' in payload) {
      const agentId = (payload as { agentId?: unknown }).agentId;
      if (typeof agentId === 'string' && agentId.length > 0) return agentId;
    }
    return null;
  }

  private async reverseLoyalty(
    accountId: string,
    userId: string,
    originalSaleId: string,
    refundSaleId: string,
    /** SALES-05 — the share this refund represents of the original receipt. */
    share: { refundSumMinor: bigint; originalSumMinor: bigint },
  ): Promise<void> {
    try {
      const earned = await this.prisma.client.bonusOperation.findFirst({
        where: {
          accountId,
          parentEntity: 'retailsale',
          parentId: originalSaleId,
          transactionType: 'EARNING',
        },
        select: { agentId: true, bonusProgramId: true, bonusValue: true },
      });
      const plan = planLoyaltyReversal(earned, share.refundSumMinor, share.originalSumMinor);
      if (!plan || !earned) return;
      const alreadyReversed = await this.prisma.client.bonusOperation.findFirst({
        where: {
          accountId,
          parentEntity: 'retailsale',
          parentId: refundSaleId,
          transactionType: 'SPENDING',
        },
        select: { id: true },
      });
      if (alreadyReversed) return; // idempotent
      await this.loyalty.createOperation(accountId, userId, {
        agentId: earned.agentId,
        bonusProgramId: earned.bonusProgramId ?? undefined,
        transactionType: 'SPENDING',
        categoryType: 'RETURN',
        bonusValue: -plan.points,
        parentEntity: 'retailsale',
        parentId: refundSaleId,
      });
    } catch (e) {
      this.logger.error(
        `Loyalty reversal failed for refund ${refundSaleId} of sale ${originalSaleId} (refund stands): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async list(accountId: string, rawFilter: unknown) {
    const filter = RetailSaleFilterSchema.parse(rawFilter);
    /**
     * V4 — chek POZITSIYASI bo'yicha filtr, BITTA joyda yig'iladi.
     *
     * 🔴 Nega birlashtirilgan: `productId` ham, `productSearch` ham `where`
     * ning AYNI `positions` kalitiga yozadi. Ikkalasi alohida spread qilinsa
     * ikkinchisi birinchisini JIMGINA o'chirardi (obyektda kalit bitta) va
     * so'rov noto'g'ri natija qaytarardi — typecheck ham, testlar ham buni
     * tutmasdi. Qo'riqchi: `retail-sale-product-filter.test.ts`.
     *
     * Semantika: `some` ⇒ chekda IKKALA shartga ham mos keladigan BITTA
     * pozitsiya bo'lishi kerak (ikki xil qatorga tarqalgan mos kelish emas).
     */
    const productToken = filter.productSearch?.trim();
    const positionFilter: Prisma.RetailSalePositionWhereInput = {
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(productToken
        ? {
            // Tovar qidiruvi (`product.repository.ts`) bilan AYNI qoida:
            // nom ichidan (trigram indeks), kod/artikul boshidan, shtrix-kod
            // aniq — kassir skaner bilan ham topa olsin.
            product: {
              OR: [
                { name: { contains: productToken, mode: 'insensitive' as const } },
                { code: { startsWith: productToken, mode: 'insensitive' as const } },
                { article: { startsWith: productToken, mode: 'insensitive' as const } },
                { barcodes: { has: productToken } },
              ],
            },
          }
        : {}),
    };
    const where: Prisma.RetailSaleWhereInput = {
      accountId,
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      // F9 — POS mijoz kartasi. Berilmasa `where` ga UMUMAN tushmaydi, ya'ni
      // mavjud ro'yxat sahifasining so'rov shakli o'zgarmaydi.
      ...(filter.agentId ? { agentId: filter.agentId } : {}),
      // V1/V4 — Vozvrat oynasi: tovar bo'yicha chek qidiruvi (yuqorida yig'ilgan).
      ...(Object.keys(positionFilter).length > 0 ? { positions: { some: positionFilter } } : {}),
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.dateFrom || filter.dateTo
        ? {
            moment: {
              ...(filter.dateFrom ? { gte: filter.dateFrom } : {}),
              ...(filter.dateTo ? { lte: filter.dateTo } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { agent: { name: { contains: filter.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    // G2 — omborchi paneli filtri: faqat shu xodimga biriktirilgan yig'ish
    // topshirig'i bor cheklar (assigneeOpen=true bo'lsa — faqat hali OCHIQ
    // topshiriqlilar). RestockTask polimorf (sourceType/sourceId), Prisma
    // relation yo'q — shuning uchun ikki bosqichli so'rov.
    if (filter.assigneeId) {
      const tasks = await this.prisma.client.restockTask.findMany({
        where: {
          accountId,
          type: 'picking',
          sourceType: 'retailsale',
          assigneeId: filter.assigneeId,
          ...(filter.assigneeOpen ? { status: { notIn: ['done', 'cancelled'] } } : {}),
        },
        select: { sourceId: true },
        distinct: ['sourceId'],
        // Ochiq navbat kichik; cheklov faqat himoya uchun (limit=500 max).
        take: 1000,
      });
      where.id = { in: tasks.map((t) => t.sourceId) };
    }

    const rows = await this.prisma.client.retailSale.findMany({
      where,
      orderBy: { [filter.sortBy]: filter.sortDir },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: {
        session: {
          select: {
            id: true,
            state: true,
            // currency drives the money-cell formatting on the list (the till
            // may not be UZS) — fetched so the FE never hard-codes a suffix.
            cashDesk: { select: { id: true, name: true, currency: true } },
            // Kassir nomi — POS «Cheklar» tabi har qatorda shuni chizadi
            // (`sotuv/page.tsx` → `sale.session.cashier.name`). U yo'q bo'lsa
            // sahifa error-boundary'ga yiqiladi; qo'riqchi:
            // retail-sale-list-contract.test.ts.
            cashier: { select: { id: true, name: true } },
          },
        },
        agent: { select: { id: true, name: true } },
        _count: { select: { positions: true } },
      },
    });

    const hasMore = rows.length > filter.limit;
    const items = hasMore ? rows.slice(0, filter.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
    const total = await this.prisma.client.retailSale.count({ where });
    return { items, nextCursor, total };
  }

  async findById(accountId: string, id: string) {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      include: {
        session: {
          include: {
            cashDesk: { select: { id: true, name: true, currency: true } },
            cashier: { select: { id: true, name: true } },
            store: { select: { id: true, name: true } },
            // `phone` — chek shapkasining IKKINCHI qatori (egasining namunasi
            // `chek.png`: do'kon nomi ostida telefon). Ilgari tanlanmasdi,
            // shuning uchun chekda telefon UMUMAN chiqmasdi.
            organization: { select: { id: true, name: true, legalTitle: true, phone: true } },
          },
        },
        // `phone` — chekdagi «Telefon:» qatori (kontragent raqami, 2026-08-31).
        agent: { select: { id: true, name: true, legalTitle: true, phone: true } },
        refundedFrom: { select: { id: true, name: true } },
        // Kassa TZ §6.1 — chekning to'lov qatlami. Uchala chek renderer'i
        // (ESC/POS matn · Electron HTML · `/print/retail-sale` React) endi
        // AYNAN shu qatorlardan o'qiydi: legacy `cashAmountMinor`/
        // `cardAmountMinor` ustunlaridan terminalni naqdsizdan, dollarni
        // so'mdan, qarzni esa umuman ajratib bo'lmaydi.
        payments: {
          select: {
            method: true,
            amountMinor: true,
            currency: true,
            rateMinor: true,
            amountBaseMinor: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        positions: {
          include: {
            // buyPrice + salePrices ride along so the POS can show cost / the
            // wholesale floor / live profit when the cashier pulls a picked
            // receipt back into the cart. Before post() the line's own
            // costMinor is still NULL — the card is the only source there.
            product: {
              select: {
                id: true,
                name: true,
                code: true,
                uom: true,
                buyPrice: true,
                // Tannarx valyutasi — dollarda kelgan tovarni POS «$… ≈ …сум»
                // (joriy kurs) ko'rinishida ko'rsatadi (2026-09-01, egasi).
                buyPriceCurrency: true,
                salePrices: true,
              },
            },
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    return sale;
  }

  async create(accountId: string, raw: unknown) {
    const parsed = CreateRetailSaleSchema.parse(raw);

    // Validate session is open
    const session = await this.prisma.client.cashierSession.findFirst({
      where: { id: parsed.sessionId, accountId },
    });
    if (!session) throw new NotFoundException(`CashierSession ${parsed.sessionId} not found`);
    if (session.state !== 'open') {
      throw new BadRequestException(`Session is ${session.state}. Cannot create sale.`);
    }

    // H4 record-scope: the cashier who opened the shift is the sale's creator.
    const creatorGroupId = await resolveCreatorGroupId(
      this.prisma.client,
      accountId,
      session.cashierId,
    );

    // F8 — zakaz bog'lanishi. Uch tekshiruv, uchtasi ham ATAYLAB shu yerda:
    //  (1) TENANT — FK faqat MAVJUDLIKNI tekshiradi, ya'ni begona akkauntning
    //      zakaz id'si chekka jimgina yozilib ketardi (`post()` dagi `agentId`
    //      tekshiruvi bilan bir klass);
    //  (2) DO'KON — rezervni chekka yutish `post()` da smena do'koni ustida
    //      qulflangan qatorlarga tegadi; boshqa do'kondagi hold qulfsiz
    //      o'zgarardi (deadlock/lost-update);
    //  (3) HOLAT — «allaqachon to'langan» zakazni savatga yuklab, kassirni
    //      to'lov oynasigacha olib borib, oxirida rad etish yomon UX.
    //      Yakuniy (poyga-chidamli) tekshiruv baribir `post()` ichida.
    if (parsed.customerOrderId) {
      const order = await this.prisma.client.customerOrder.findFirst({
        where: { id: parsed.customerOrderId, accountId, deletedAt: null },
        select: { id: true, state: true, storeId: true },
      });
      if (!order) {
        throw new NotFoundException(`CustomerOrder ${parsed.customerOrderId} not found`);
      }
      if (order.storeId !== session.storeId) {
        throw new BadRequestException(
          `Zakaz boshqa do'konga tegishli (zakaz: ${order.storeId}, smena: ${session.storeId})`,
        );
      }
      if (!(ORDER_PAYABLE_STATES as readonly string[]).includes(order.state)) {
        throw new BadRequestException(
          `Zakaz «${order.state}» holatida — POS'dan to'lanmaydi (kutilgan: ${ORDER_PAYABLE_STATES.join(', ')})`,
        );
      }
    }

    const name = await this.nextRetailSaleName(accountId);
    const positions = this.computePositions(parsed.positions);

    try {
      const created = await this.prisma.client.retailSale.create({
        data: {
          accountId,
          ownerId: session.cashierId,
          groupId: creatorGroupId,
          sessionId: parsed.sessionId,
          name,
          agentId: parsed.agentId ?? null,
          customerOrderId: parsed.customerOrderId ?? null,
          moment: parsed.moment ? new Date(parsed.moment) : new Date(),
          description: parsed.description ?? null,
          externalCode: parsed.externalCode ?? null,
          state: 'draft',
          sumMinor: positions.totalMinor,
          positions: {
            create: positions.rows.map((p, idx) => ({
              accountId,
              productId: p.productId,
              position: idx + 1,
              quantity: p.quantity,
              priceMinor: p.priceMinor,
              discount: p.discount,
              sumMinor: p.lineMinor,
              // K4 — kassirning bo'lak kelishuvi («150+30»). `computePositions`
              // faqat PUL hisobini qiladi, shuning uchun qiymat kirish
              // massividan INDEKS bo'yicha olinadi — `rows` uning 1:1 nusxasi.
              pieceLengths: formatPieceLengths(parsed.positions[idx]?.pieceLengths),
            })),
          },
        },
        include: {
          positions: {
            include: {
              product: { select: { id: true, name: true, code: true } },
            },
            orderBy: { position: 'asc' },
          },
        },
      });
      return created;
    } catch (e) {
      this.handlePrisma(e);
    }
  }

  async update(accountId: string, id: string, raw: unknown) {
    const parsed = UpdateRetailSaleSchema.parse(raw);

    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    if (sale.state !== 'draft') {
      throw new BadRequestException('Only draft sales can be edited');
    }

    const positions = parsed.positions ? this.computePositions(parsed.positions) : null;

    try {
      // Class A (optimistic-lock): the destructive position deleteMany + the
      // version-guarded header write run in ONE transaction. This fixes two
      // defects at once:
      //   (1) lost-update — a second user editing the same draft used to
      //       last-write-win, silently clobbering the first edit. The
      //       `version` filter now 409s the stale copy (OptimisticLockException).
      //   (2) data corruption — the position deleteMany + re-create used to
      //       run OUTSIDE any transaction, so a failure (or now a 409) after
      //       the delete but before the re-create left the receipt with ZERO
      //       positions. Folding both into the same tx makes the rewrite atomic
      //       with the version check: a stale-version miss (P2025) rolls the
      //       deleteMany back, so the positions are never lost.
      // sumMinor is computed up-front from the new positions, so there is no
      // second totals-only update (the supply two-step) — a single versioned
      // header update carries header fields + sumMinor + the nested re-create.
      return await this.prisma.client.$transaction(async (tx) => {
        if (positions) {
          await tx.retailSalePosition.deleteMany({
            where: { retailSaleId: id, accountId },
          });
        }
        return tx.retailSale.update({
          // `state: 'draft'` TX ICHIDA ham filtrlanadi: yuqoridagi holat
          // tekshiruvi eskirgan nusxa ustida, post() flip'i esa versionni
          // OSHIRMAYDI — ya'ni faqat version-filtr o'qish/saqlash oralig'ida
          // POSTED bo'lib qolgan (pul olingan, stok yechilgan) chekni qayta
          // yozilishdan SAQLAMASDI. Filtr mos kelmasa P2025 → quyidagi
          // mapVersionedUpdateError 409 (OPTIMISTIC_LOCK) qiladi — mavjud
          // optimistic-lock yo'li bilan bir uslub.
          where: { id, accountId, version: parsed.version, state: 'draft' },
          data: {
            ...(parsed.agentId !== undefined ? { agentId: parsed.agentId ?? null } : {}),
            ...(parsed.description !== undefined
              ? { description: parsed.description ?? null }
              : {}),
            ...(parsed.externalCode !== undefined
              ? { externalCode: parsed.externalCode ?? null }
              : {}),
            ...(positions
              ? {
                  sumMinor: positions.totalMinor,
                  positions: {
                    create: positions.rows.map((p, idx) => ({
                      accountId,
                      productId: p.productId,
                      position: idx + 1,
                      quantity: p.quantity,
                      priceMinor: p.priceMinor,
                      discount: p.discount,
                      sumMinor: p.lineMinor,
                      // K4 — kassirning bo'lak kelishuvi (yuqoridagi `create`
                      // bilan bir xil qoida: indeks bo'yicha, `rows` 1:1).
                      pieceLengths: formatPieceLengths(parsed.positions?.[idx]?.pieceLengths),
                    })),
                  },
                }
              : {}),
            version: { increment: 1 },
          },
          include: {
            positions: {
              include: {
                product: { select: { id: true, name: true, code: true } },
              },
              orderBy: { position: 'asc' },
            },
          },
        });
      });
    } catch (e) {
      // A P2025 after the findById existence check above means the version
      // filter missed — a concurrent write bumped the row — so map it to 409
      // (OPTIMISTIC_LOCK) FIRST, before any other Prisma handling (a generic
      // handler would otherwise surface it as a 404/500).
      mapVersionedUpdateError(e, 'RetailSale');
      this.handlePrisma(e);
    }
  }

  async post(accountId: string, userId: string, id: string, raw: unknown) {
    const parsed = PostRetailSaleSchema.parse(raw);

    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      include: {
        session: {
          select: {
            id: true,
            state: true,
            // Kunlik chek raqami HAR KASSIR uchun alohida sanaladi (2026-09-02,
            // egasi) — hisoblagich kaliti aynan shu ustundan quriladi.
            cashierId: true,
            cashDeskId: true,
            storeId: true,
            salesCount: true,
            salesSumMinor: true,
            store: { select: { allowNegativeStock: true } },
            cashDesk: { select: { currency: true } },
          },
        },
        positions: {
          // priceMinor + product name ride along for the audit events (kassa
          // TZ §9): the log has to say WHAT was sold and at what price, not
          // just that something was.
          select: {
            id: true,
            productId: true,
            quantity: true,
            priceMinor: true,
            // P12 — narx poli chegirmadan KEYINGI summani o'lchaydi; chegirmasiz
            // o'qilsa savat chegirmasi polni jimgina teshib o'tardi.
            discount: true,
            // K3 — `pieceTracked` shu yerdan keladi (`collectPieceTracked`):
            // bo'linadigan tovarda avto-taqsimot bo'linmaydi (K-reja 7.1).
            product: { select: { name: true, pieceTracked: true } },
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    // `ready` ham to'lanadi: omborchi yig'ib bo'lgan chek kassirga shu holatda
    // keladi (`sotuv/page.tsx` «Tayyor» ro'yxati → to'lov oynasi). Ilgari bu
    // yerda `!== 'draft'` turardi — butun yig'ish zanjiri to'lovda berkilardi.
    if (!canTransition(sale.state, 'post')) {
      throw new BadRequestException(transitionRejection(sale.state, 'post'));
    }
    if (sale.session.state !== 'open') {
      throw new BadRequestException(`Session is ${sale.session.state}. Cannot post sale.`);
    }

    // `expectedSumMinor` — kassir EKRANDA ko'rgan summa. Ilgari u qabul
    // qilinardi-yu hech qayerda solishtirilmasdi (sxema izohidagi «server
    // revalidates against DB sum» da'vosi yolg'on edi). Oqibati: chek yuklangan
    // va to'lov olingan on orasida hujjat o'zgarsa (boshqa foydalanuvchi
    // tahrirlasa), kassir ekrandagidan BOSHQA summaga pul olardi va buni hech
    // kim sezmasdi. Endi bu 409 — optimistik qulf bilan bir klass.
    if (BigInt(parsed.expectedSumMinor) !== sale.sumMinor) {
      throw new ConflictException(
        `Chek summasi o'zgargan: ekranda ${parsed.expectedSumMinor}, bazada ${sale.sumMinor.toString()}. Chekni qayta oching.`,
      );
    }

    const cashAmount = BigInt(parsed.cashAmountMinor);
    const cardAmount = BigInt(parsed.cardAmountMinor);
    const terminalAmount = BigInt(parsed.terminalAmountMinor);
    // Hisob raqamidan (bank o'tkazmasi) — yashiqqa tushmaydi, qaytim bermaydi.
    const accountAmount = BigInt(parsed.accountAmountMinor);
    const debtAmount = BigInt(parsed.debtAmountMinor);
    const total = sale.sumMinor;

    // Kassa TZ §6 — aralash to'lov (naqd · karta · terminal · qarz).
    // `/sotuv` to'lov oynasi to'rttasini ham ALLAQACHON yuborardi; server
    // ikkitasini bilardi va qolgani jimgina tashlanardi → terminal/qarz chek
    // 400 olardi. Qoidalar `retail-tenders.ts` da (sof, testlangan).
    // MK31 — dollar naqd. Kurs KANONIK ×10^8 va chekka MUZLATILADI (kurs
    // ertaga o'zgarsa bugungi chek qayta baholanmasin).
    const cashUsdAmount = BigInt(parsed.cashUsdAmountMinor);
    const usdRateE8 = parsed.usdRateMinor != null ? BigInt(parsed.usdRateMinor) : null;
    // A2 — mijozning AVANSIDAN qoplanadigan ulush. Pul yashiqqa KIRMAYDI:
    // u A1 yo'li bilan allaqachon kirgan va balansda manfiy bo'lib turibdi.
    const prepayAmount = BigInt(parsed.prepayAmountMinor);

    const pay = computeTenders({
      cashMinor: cashAmount,
      cardMinor: cardAmount,
      terminalMinor: terminalAmount,
      accountMinor: accountAmount,
      debtMinor: debtAmount,
      totalMinor: total,
      cashUsdMinor: cashUsdAmount,
      usdRateE8,
      prepayMinor: prepayAmount,
    });
    if (!pay.ok) {
      if (pay.reason === 'insufficient') {
        throw new BadRequestException(
          `Payment insufficient: paid ${pay.paidMinor.toString()} < total ${pay.totalMinor.toString()}`,
        );
      }
      if (pay.reason === 'debt-overpaid') {
        throw new BadRequestException(
          `Qarzli chekda to'lov + qarz JAMIga teng bo'lishi kerak: ${pay.paidMinor.toString()} ≠ ${pay.totalMinor.toString()}`,
        );
      }
      if (pay.reason === 'usd-rate-missing') {
        // TZ §6.2 — kurs topilmasa to'lov BLOKLANADI. Jim 1:1 qabul qilish
        // sentni tiyin deb o'qib, chekni haqiqiy summaning ~12 000 dan
        // biriga «to'liq to'langan» qilib yopardi.
        throw new BadRequestException(
          "Dollar to'lovi uchun kunlik kurs kerak (kurssiz to'lov qabul qilinmaydi)",
        );
      }
      if (pay.reason === 'prepay-overpaid') {
        // A2 / invariant 5 — avans QAYTIM BERMAYDI. Xabar kassirga AYNIQ son
        // bilan: nechta ortiqcha kiritgani va nechtasi sig'ishi.
        throw new BadRequestException(
          `Avansdan ${(pay.prepayMinor / 100n).toString()} so'm kiritildi, chekning qoldig'i esa ` +
            `atigi ${(pay.allowedMinor / 100n).toString()} so'm. Avansdan qaytim berilmaydi — ` +
            'summani kamaytiring.',
        );
      }
      if (pay.reason === 'change-exceeds-cash') {
        // TZ §6.2: qaytim faqat naqddan. Aks holda kassa mijozga bank pulidan
        // naqd qaytim berib, o'z kassasidan pul yo'qotadi.
        throw new BadRequestException(
          `Qaytim faqat naqddan beriladi: qaytim ${pay.changeMinor.toString()} > naqd ${pay.cashMinor.toString()}`,
        );
      }
      throw new BadRequestException('Payment amounts must be non-negative');
    }

    // Faza Q1: to'lov oynasidagi mijoz CHEKDAGIsiga ZID bo'lsa — 400.
    //
    // Ilgari `parsed.agentId` chekdagi mavjud `sale.agentId` dan USTUN turardi,
    // lekin chek qatori faqat u BO'SH bo'lganda yangilanardi. Ya'ni chekda A,
    // oynada B bo'lsa: qarz daftariga B yozilar, chek A ni ko'rsatar, qaytarish
    // esa `resolveCreditDebtorId` orqali A ni tanlab qarzni BOSHQA mijozdan
    // yechardi. Ikkalasi ham noto'g'ri saldo, hech bir gate ko'rmasdi.
    //
    // NEGA ustidan yozmaymiz: chek — huquqiy hujjat, to'lov oynasi uning
    // kontragentini JIMGINA almashtira olmasligi kerak (Faza 7/8 bo'ylab
    // quvilgan «jim divergensiya» klassining o'zi). Kassir chekni ochib
    // mijozni to'g'irlaydi — ma'lumot yo'qolmaydi.
    if (parsed.agentId && sale.agentId && parsed.agentId !== sale.agentId) {
      throw new BadRequestException(
        `Chekdagi mijoz to'lov oynasidagidan farq qiladi (chek: ${sale.agentId}, to'lov: ${parsed.agentId}). Chekni ochib mijozni to'g'rilang.`,
      );
    }

    // To'lov oynasidan kelgan mijoz TENANT ichida ekani tekshiriladi: FK
    // faqat mavjudlikni tekshiradi, ya'ni begona akkauntning counterparty
    // id'si chekka (qarz bo'lsa — qarz daftariga ham) jimgina yozilib
    // ketishi mumkin edi. Faqat yangi yoziladigan holatda so'raladi —
    // chekda allaqachon turgan mijoz create-yo'lida tekshirilgan hujjatning
    // o'zi.
    if (parsed.agentId && !sale.agentId) {
      const agent = await this.prisma.client.counterparty.findFirst({
        where: { id: parsed.agentId, accountId },
        select: { id: true },
      });
      if (!agent) {
        throw new BadRequestException(`Counterparty ${parsed.agentId} not found`);
      }
    }

    // Qarzga sotishda kontragent MAJBURIY — aks holda qarz kimningdir
    // balansiga emas, hech qayerga yozilgan bo'lardi (TZ §7.1).
    const debtAgentId = parsed.agentId ?? sale.agentId ?? null;
    if (debtAmount > 0n && !debtAgentId) {
      throw new BadRequestException('Qarzga sotish uchun mijoz tanlanishi shart');
    }
    // A2 — avans MIJOZNIKI. Mijozsiz «avansdan to'lov» hech kimning
    // balansidan yechilmagan bo'lardi, ya'ni chek bepulga yopilardi.
    if (prepayAmount > 0n && !debtAgentId) {
      throw new BadRequestException("Avansdan to'lash uchun mijoz tanlanishi shart");
    }
    // A2 / §2.3 chegarasi — USD avans bu rejada QURILMAGAN. A1 dollar
    // kassasida avans QABUL QILMAYDI, ya'ni dollar avansi tug'ilmaydi ham;
    // shunga qaramay bu yerda JIM o'tmaydi (400), aks holda kelajakda dollar
    // yashiq ochilganda avans so'm-daftariga jimgina aralashib ketardi.
    if (prepayAmount > 0n && sale.session.cashDesk.currency !== DEBT_LEDGER_CURRENCY) {
      throw new BadRequestException(
        `Avansdan to'lash faqat ${DEBT_LEDGER_CURRENCY} kassasida ishlaydi ` +
          `(bu kassa: ${sale.session.cashDesk.currency}).`,
      );
    }

    const change = pay.changeMinor;
    const legacy = legacyTotals(pay.lines);

    // Stock cascade: rows with a productId trigger an outflow. Service-only
    // positions (productId === null) are intentionally skipped — services
    // don't carry stock.
    const stockPositions = sale.positions.filter(
      (p): p is typeof p & { productId: string } => p.productId !== null,
    );
    const sessionStoreId = sale.session.storeId;
    // F6 (Q1) — STOK ombori endi KASKADDAN: prioriteti eng kichik ombor
    // («Ombor 07» = 1). Kaskad sozlanmagan bo'lsa smena ombori — eski xulq.
    // PUL oqimi (kassa yashigi, smena agregatlari) smenanikida QOLADI; faqat
    // tovar qaysi ombordan ayirilishi o'zgaradi. Tranzaksiyadan TASHQARIDA
    // o'qiladi (loadFrozenPrices bilan bir sabab): ombor sozlamasi chekning
    // consistency-to'plamiga kirmaydi va tx qisqa qolsin.
    const cascade = await this.resolveStockCascade(accountId);
    // G4 (Q1-v2) — taqsimot omborlari (kaskad + 07/BRAK belgilari). Kaskad
    // bilan BIR paytda, tranzaksiyadan tashqarida o'qiladi.
    const allocStores = await this.resolveAllocationStores(accountId);
    // K3 (7.1) — bo'linadigan tovarda taqsimot BO'LINMAYDI: mijozga uzluksiz
    // bo'lak kerak. Bayroq pozitsiya bilan birga keladi (qo'shimcha so'rov yo'q).
    const pieceTrackedIds = collectPieceTracked(stockPositions);
    const stockStore = cascade[0] ?? null;
    const storeId = stockStore?.id ?? sessionStoreId;
    const allowNegative = stockStore
      ? stockStore.allowNegativeStock
      : sale.session.store.allowNegativeStock;

    // Kassa TZ §5.3 — read the price snapshot BEFORE the transaction opens. The
    // product cards are not part of the sale's consistency set (nobody may edit
    // a card and expect a mid-flight receipt to follow), and keeping the read
    // outside keeps the money/stock transaction as short as possible.
    const frozen = await this.loadFrozenPrices(
      accountId,
      sale.positions.map((p) => p.productId),
    );

    // 🔴 2026-08-16, egasining qarori: KASSADA NARX CHEKLOVI YO'Q — kassir
    // istalgan narxda, shu jumladan BEPULGA sotadi. Ilgari bu yerda P12 narx
    // siyosati turardi (0-narx taqiqi + pol). U bayroq bilan emas, BUTUNLAY
    // olib tashlangan: o'chiq bayroq bir kun jimgina yoqilib chekni yana rad
    // etib qo'yishi mumkin edi. Shartnoma `retail-sale-price-floor.test.ts`
    // da qulflangan — 0 so'mlik qator ham `posted` ga yetadi.

    // Q2 — chek POST bo'lgan YAGONA on. Ilgari `postedAt: new Date()` flip'ning
    // ichida tug'ilardi; endi u qarz muddatini ham belgilaydi (`saleDebtDueAt`),
    // shuning uchun ikkala yozuv AYNAN bir instantdan chiqadi — chek yarim
    // tunda post bo'lsa muddat kuni ikki xil hisoblanib qolmasin.
    const postedAt = new Date();

    const posted = await this.prisma.client.$transaction(async (tx) => {
      // ── QOG'OZDAGI chek raqami: kassirning SHU KUNDAGI ketma-ket soni ──
      //
      // Egasi (2026-09-02): «120 ta sotuv bo'lsa keyingi chek 121», har kassir
      // uchun alohida. Atomik `increment` (`document_sequences`) — ikki kassa
      // parallel post qilsa ham bir raqam ikki chekka tushmaydi.
      //
      // 🔴 O'RNI MUHIM — flip'dan OLDIN va AYNI tranzaksiyada. Keyin qo'yilsa
      // ikkinchi yozuv kerak bo'lardi; tashqarida bo'lsa esa post yiqilganda
      // raqam yeb ketilardi (endi rollback hisoblagichni ham qaytaradi, ya'ni
      // kunlik ketma-ketlikda TESHIK qolmaydi).
      //
      // Instant `postedAt` — kun chegarasi (Asia/Tashkent) va `posted_at`
      // ustuni bir xil ondan chiqsin: yarim tunda post bo'lgan chek bazada
      // bir kunga, qog'ozda boshqa kunning raqamiga tushib qolmasin.
      const receiptNo = await allocateDocumentNumber(
        tx,
        accountId,
        dailyReceiptSequenceKey(sale.session.cashierId, postedAt),
        // Seed 0 — kalit har kun YANGI, ya'ni hisoblagich 1 dan boshlanadi.
        async () => 0,
      );

      // Atomic state guard: only a postable state ('draft' | 'ready') → 'posted'.
      // Two concurrent posts on the same receipt would otherwise both succeed
      // (both reads see the pre-state, both updates flip 'posted' → 'posted' as
      // a no-op) — but the cash inflow, session aggregates, and stock decrement
      // would fire twice. updateMany returns count=0 when the row state has
      // already moved. The IN-list comes from the same FSM table as the
      // pre-check above, so the guard can't drift narrower/wider than it.
      const flipResult = await tx.retailSale.updateMany({
        where: { id, accountId, state: { in: [...allowedFrom('post')] } },
        data: {
          state: 'posted',
          postedAt,
          // Chek raqami post onida MUZLAYDI: keyin bekor/qaytarish bo'lsa ham
          // mijoz qo'lidagi qog'oz bazadagi qator bilan bir xil qoladi.
          receiptNo,
          // To'lov oynasida tanlangan mijoz CHEKKA YOZILADI — qarzli
          // to'lovda ham (SALES-04: qaytarishda qarz kimniki ekani chekdan
          // o'qiladi), NAQD/KARTA to'lovda ham. Ilgari shart
          // `debtAmount > 0n` bilan tor edi: naqd to'lagan mijoz jimgina
          // tashlanardi — chekda `agentId` NULL qolib, loyalty ball
          // yozilmasdi (accrueLoyalty `sale.agentId` ga qaraydi).
          ...(parsed.agentId && !sale.agentId ? { agentId: parsed.agentId } : {}),
          // TZ §6.3 — bu ikki ustun endi to'lov qatorlaridan HISOBLANADI
          // (terminal `card` yig'indisiga kiradi: ikkalasi ham naqdsiz).
          // Ustunlar saqlanadi, chunki mavjud hisobotlar va moysklad-compat
          // ularni o'qiydi.
          ...legacy,
          changeMinor: change,
          // 🔴 P3 / §1.H — H12 (2026-08-12). Prodda o'lchandi: `payedSumMinor`
          // 17/17 chekda 0 edi — 84 600 so'm NAQD olingan `posted` chekda ham.
          // Sabab: bu ustunga RetailSale yo'lida hech kim YOZMAGAN (grep:
          // faqat `CustomerOrder` uchun o'qilardi). Ya'ni «to'landi» degan
          // raqam butun kassa bo'ylab yolg'on 0 turardi.
          //
          // Ma'nosi — repodagi QOLGAN HAMMA hujjat bilan bir xil shartnoma
          // (invoice/order/supply): `sumMinor − payedSumMinor` = shu hujjat
          // bo'yicha QOLGAN qarz. Shuning uchun formula `jami − qarz`:
          //   · to'liq to'langan chek     → payed = jami
          //   · qarzga qoldirilgan qism   → payed = jami − qarz
          //
          // ATAYLAB `pay.paidMinor` EMAS: u mijoz UZATGAN pul (qaytim ham
          // ichida). 32 000 so'mlik tovarga $2 bergan chek (prod ТРН-2026-00016,
          // qaytim 104.10 so'm) unda 32 104.10 «to'langan» bo'lib yozilardi va
          // hujjat o'z summasidan ko'p to'langan bo'lib ko'rinardi.
          //
          // 🔴 A2 (2026-08-25) — REJADAN ATAYLAB CHEKINISH: bu formula
          // AVANS uchun O'ZGARTIRILMADI, chunki u ALLAQACHON to'g'ri.
          // Reja «`total − debtAmount` formulasi shuni hisobga oladigan qilib
          // yangilanadi» degan edi; o'lchandi:
          //     total = naqd + dollar + karta + terminal + AVANS + qarz
          //   ⇒ total − qarz = to'langan HAMMA narsa, avans ham ichida.
          // Ya'ni avansdan to'langan chek o'z-o'zidan «TO'LIQ TO'LANGAN»
          // bo'lib yoziladi (A2 ning `DEBT` dan asosiy farqi). Formulaga
          // yangi a'zo qo'shilsa u IKKI MARTA sanalardi. Qo'riqchi test:
          // `retail-sale-prepay-tender.test.ts` → «payedSumMinor».
          payedSumMinor: total - debtAmount,
        },
      });
      if (flipResult.count === 0) {
        throw new ConflictException(
          `RetailSale ${id} state changed; post aborted (already posted?)`,
        );
      }

      // Faza Q1 (SALES-07) — SMENA CLAIM'i: agregat inkrementi endi SHARTLI.
      //
      // Yuqoridagi `sale.session.state !== 'open'` tekshiruvi tranzaksiyadan
      // TASHQARIDA o'qilgan (eskirgan) nusxa ustida ishlaydi. O'sha o'qish
      // bilan bu yer orasida `close()` yugursa, chek YOPILGAN smenaga post
      // bo'lardi: pul yashiqqa tushadi, `close()` esa uni allaqachon sanab
      // bo'lgan ⇒ smena naqdi hech qachon to'g'ri chiqmaydi va kassirga
      // tushuntirib bo'lmaydigan farq akti yoziladi.
      //
      // Shart `close()` ning flip'i bilan AYNI ustunda (`state`), ya'ni
      // Postgres qator-qulfi ikkalasini ketma-ketlashtiradi: kim ikkinchi
      // bo'lsa `count = 0` oladi. Qulf PUL/OMBOR kaskadidan OLDIN olinadi va
      // agregat inkrementi ATAYLAB shu yerga ko'chirildi — alohida shartsiz
      // `update` qolganida qulf va hisob ajralib, poyga oynasi qayta ochilardi.
      const sessionClaim = await tx.cashierSession.updateMany({
        where: { id: sale.sessionId, accountId, state: 'open' },
        data: {
          salesCount: { increment: 1 },
          salesSumMinor: { increment: total },
        },
      });
      if (sessionClaim.count === 0) {
        throw new ConflictException(
          `Smena ${sale.sessionId} yopilgan; chek rasmiylashtirilmadi. Yangi smena oching.`,
        );
      }

      // ── F8: zakaz to'lovi — IKKI MARTA TO'LASH HIMOYASI ──────────────────
      //
      // 🔴 Tekshiruv SERVERDA va TRANZAKSIYA ICHIDA. UI tugmasini yashirish
      // yetarli emas: ikki kassir (ikki kassa) bir zakazni bir vaqtda ochib
      // «To'lash» bosishi mumkin, va ikkalasi ham zakaz `confirmed` ekanini
      // KO'RADI.
      //
      // Qulf = holat-SHARTLI `updateMany`. Ikki parallel tranzaksiya bir
      // qatorga yozmoqchi bo'lganda Postgres ularni qator-qulfi bilan
      // ketma-ketlashtiradi; birinchisi commit bo'lgach ikkinchisi predikatni
      // QAYTA baholaydi (EvalPlanQual) va zakaz endi `paid` bo'lgani uchun
      // `count = 0` oladi ⇒ ConflictException ⇒ butun chek rollback (pul
      // olinmaydi, ombor yechilmaydi). Bu `retailSale`/`cashierSession`
      // claim'lari bilan AYNI naqsh.
      //
      // `data` ATAYLAB `version` inkrementi: bo'sh `data` bilan `updateMany`
      // qatorni umuman yozmaydi va qulf olmasdi. `version` esa moysklad
      // optimistik qulfi — zakazni parallel tahrirlayotgan nusxa 409 oladi,
      // ya'ni yozuv o'zi ham ma'noli.
      let releaseOrderReserve = false;
      if (sale.customerOrderId) {
        const claim = await tx.customerOrder.updateMany({
          where: {
            id: sale.customerOrderId,
            accountId,
            deletedAt: null,
            state: { in: [...ORDER_PAYABLE_STATES] },
          },
          data: { version: { increment: 1 } },
        });
        if (claim.count === 0) {
          throw new ConflictException(
            `Zakaz ${sale.customerOrderId} to'lanadigan holatda emas (allaqachon to'langan?) — chek rasmiylashtirilmadi.`,
          );
        }
        const order = await tx.customerOrder.findFirstOrThrow({
          where: { id: sale.customerOrderId, accountId },
          select: { sumMinor: true, payedSumMinor: true, storeId: true },
        });
        if (order.storeId !== sessionStoreId) {
          // `create()` da ham tekshirilgan; bu — hujjat yaratilgandan keyin
          // zakaz do'koni ko'chirilgan holat uchun. F6: taqqos SMENA ombori
          // bilan (zakaz rezervi o'sha yerda) — stok-kaskad ombori bilan emas.
          throw new BadRequestException(
            `Zakaz boshqa do'konga tegishli (zakaz: ${order.storeId}, smena: ${sessionStoreId})`,
          );
        }
        // Rezerv FAQAT zakaz TO'LIQ yopilganda yutiladi. Qisman to'lovda hold
        // joyida qoladi — aks holda to'lanmagan qoldiq uchun band qilingan
        // tovar bo'shab, boshqa mijozga sotilib ketardi.
        releaseOrderReserve = order.sumMinor > 0n && order.payedSumMinor + total >= order.sumMinor;
      }

      // Kassa TZ §5.3 — pin cost + base price onto the lines, inside the same
      // transaction as the state flip. If the stock or money cascade below
      // rolls back, the snapshot rolls back with it: a receipt is never left
      // holding frozen numbers for a sale that did not happen.
      // Grouped by product so a receipt with repeated products still costs one
      // statement per distinct product, not one per line.
      await this.freezePositionPrices(tx, accountId, id, sale.positions, frozen);

      // Kassa TZ §9 — narx erkinligi ISHLATILGAN bo'lsa, iz qoladi.
      // Chegaralar server tomonda hal qilinadi (yuqoridagi `frozen`), POS
      // aytganiga emas — auditni auditdan o'tayotgan odam yozmasligi kerak.
      await this.writeAuditEvents(
        tx,
        accountId,
        sale.sessionId,
        userId,
        planSaleAuditEvents(
          id,
          sale.positions
            .filter((p): p is typeof p & { productId: string } => p.productId !== null)
            .map((p) => {
              const snap = frozen.get(p.productId);
              return {
                productId: p.productId,
                productName: p.product?.name ?? null,
                quantity: String(p.quantity),
                priceMinor: p.priceMinor,
                costMinor: snap?.costMinor ?? null,
                basePriceMinor: snap?.basePriceMinor ?? null,
                wholesaleMinor: snap?.wholesaleMinor ?? null,
              };
            }),
        ),
      );

      // Stock cascade — same lock-then-assert-then-apply pattern as DemandService.post.
      if (stockPositions.length > 0) {
        const assortments = stockPositions.map((p) => ({
          kind: 'product' as const,
          id: p.productId,
        }));
        let balances = await this.stock.lockBalances(tx, accountId, storeId, assortments);

        // F6: rezervlar BOSHQA omborda yotgan bo'lishi mumkin — zakaz holdi
        // smena omborida, chekning picking holdi esa yozilgan paytdagi kaskad
        // omborida. `releaseReservationByDoc` shartnomasi (qulf SHU tx da)
        // buzilmasin: kaskad yoqilganda hold turishi mumkin bo'lgan boshqa
        // omborlar ham qulflanadi (deterministik sort — parallel postlar
        // deadlock qilmasin). Kaskadsiz o'rnatmada bu blok umuman yurmaydi —
        // eski yo'l bitta ham ortiqcha so'rov qilmaydi.
        // G4 — TAQSIMOT omborlari ham shu yerda qulflanadi: reja endi bitta
        // ombordan emas, kaskadning HAMMASIDAN quriladi. Qulfsiz o'qilgan
        // raqam bilan reja qurish ikki kassirga bir yacheykani sotib yuborardi.
        const planStores = resolveAllocStores(allocStores, storeId);
        if (cascade.length > 0 || planStores.length > 1) {
          const extraStoreIds = new Set<string>(planStores.map((st) => st.id));
          if (releaseOrderReserve && sale.customerOrderId) extraStoreIds.add(sessionStoreId);
          const holdRows = await tx.stockReservation.findMany({
            where: { accountId, docType: 'retailsale', docId: id },
            select: { storeId: true },
            distinct: ['storeId'],
          });
          for (const h of holdRows) extraStoreIds.add(h.storeId);
          extraStoreIds.delete(storeId);
          for (const sid of [...extraStoreIds].sort()) {
            await this.stock.lockBalances(tx, accountId, sid, assortments);
          }
        }

        // F8 — ZAKAZ REZERVI CHEKKA YUTILADI (`release_consume`).
        //
        // Tovar kassadan CHIQDI. Hold qolsa `reservedQty` qoldiqdan oshib
        // ketardi va do'konning «Dostupno» si abadiy manfiy bo'lib, o'sha
        // tovarni boshqa hech kimga sotib bo'lmasdi. Demand ham aynan shuni
        // qiladi (`adjustReservationForShipment(..., 'ship')` → `release_consume`).
        //
        // Tartib MUHIM: bo'shatish `assertAvailable` dan OLDIN. Aks holda
        // zakazning O'Z rezervi o'z sotuvini bloklardi — Demand'da bu snapshot
        // yamog'i bilan yopilgan (`demand.service.ts`: order's own hold
        // subtracted); bu yerda qulflangan qatorlarni QAYTA o'qiymiz, chunki
        // `releaseReservationByDoc` nechta bo'shatganini qaytarmaydi va
        // yamoqni qo'lda hisoblash uchinchi nusxa formula bo'lardi.
        //
        // `releaseReservationByDoc` shartnomasi: chaqiruvchi shu tx da
        // `lockBalances` qilgan bo'lishi SHART — yuqorida qilingan, va zakaz
        // do'koni smena do'koniga teng ekani tekshirilgan.
        if (releaseOrderReserve && sale.customerOrderId) {
          await this.stock.releaseReservationByDoc(
            tx,
            accountId,
            userId,
            'customerorder',
            sale.customerOrderId,
            'release_consume',
          );
          // Mirrorlar (`customer-order.service.delete()` bilan bir retsept) —
          // aks holda zakaz kartasi «rezervda 5» deb turaverardi.
          await tx.customerOrderPosition.updateMany({
            where: { customerOrderId: sale.customerOrderId, accountId },
            data: { reservedQty: 0 },
          });
          await tx.customerOrder.update({
            where: { id: sale.customerOrderId, accountId },
            data: { reservedSumMinor: 0n },
          });
          balances = await this.stock.lockBalances(tx, accountId, storeId, assortments);
        }

        // P3 (2026-08-12) — CHEKNING O'Z REZERVI YUTILADI.
        //
        // `send-to-picking` tovarni shu chek nomiga band qilgan (H5). To'lov —
        // tovarning jismonan chiqishi, ya'ni hold endi qoldiqning O'ZIGA
        // aylanadi: bo'shatilmasa `reservedQty` qoldiqdan oshib ketardi va
        // sotilgan tovar boshqa hech kimga «доступно» bo'lmasdi.
        //
        // Tartib zakaz shoxi bilan AYNI sababdan: `assertAvailable` dan OLDIN,
        // aks holda chekning O'Z rezervi o'z to'lovini bloklardi (yig'ilgan
        // chek kassada 409 olardi — H5 ni tuzatib, o'rniga battarini qo'yish).
        //
        // `draft` dan to'g'ridan-to'g'ri sotuvda yozuv yo'q ⇒ toza no-op
        // (`releaseReservationByDoc` `rows.length === 0` da darhol `false`
        // qaytaradi), shuning uchun shoxlanish kerak emas. Balanslar esa
        // FAQAT rostdan bo'shatilganda qayta o'qiladi — picking'siz sotuv
        // yo'li (POS «Sotish» tugmasi) bitta ham ortiqcha so'rov qilmaydi.
        const releasedOwnHold = await this.stock.releaseReservationByDoc(
          tx,
          accountId,
          userId,
          'retailsale',
          id,
          'release_consume',
        );
        if (releasedOwnHold) {
          balances = await this.stock.lockBalances(tx, accountId, storeId, assortments);
        }

        // G4 (Q1-v2) — KO'P OMBORLI AVTO-TAQSIMOT.
        //
        // Eski xulq (F6): yetmasa 400 «bosh omborchi tasdig'i kerak». Egasi uni
        // 2026-08-24 da BEKOR QILDI («omborchi ruxsati degan narsa yo'q») —
        // aynan o'sha to'siq 06:46 da kassani to'xtatib qo'ygan edi. Endi reja
        // TASHLANMAYDI, BAJARILADI: har ajratma o'z ombori va yacheykasidan.
        const balancesByStore = new Map<string, Map<string, StockBalance>>();
        for (const st of [...planStores].sort((a, b) => a.id.localeCompare(b.id))) {
          balancesByStore.set(
            st.id,
            st.id === storeId
              ? balances
              : await this.stock.lockBalances(tx, accountId, st.id, assortments),
          );
        }
        // 🔴 SAQLANGAN ajratma USTUVOR. `sendToPicking` tovarni AYNAN o'sha
        // ombor/yacheykada band qilgan va omborchi o'sha yerdan yig'gan.
        // Qayta rejalashtirish qulay ko'rinadi-yu, jismonan olingan joy bilan
        // hisobdan chiqarilgan joy bir-biriga mos kelmay qolardi — yacheyka
        // qoldig'i haqiqatdan uzilardi (butun G4 ning ma'nosi shunda).
        // Reja faqat saqlangan qatorlar YETMASA yoki eskirgan bo'lsa quriladi.
        const storedRows = await tx.retailSalePositionAllocation.findMany({
          where: { accountId, positionId: { in: stockPositions.map((p) => p.id) } },
          select: { positionId: true, storeId: true, cellId: true, qty: true },
        });
        const stored: PositionAllocation[] = storedRows.map((r) => ({
          positionId: r.positionId,
          assortmentId: stockPositions.find((p) => p.id === r.positionId)?.productId ?? '',
          storeId: r.storeId,
          cellId: r.cellId,
          qty: r.qty.toString(),
        }));
        const storedCovers =
          stored.length > 0 &&
          stored.every((a) => a.assortmentId !== '' && balancesByStore.has(a.storeId)) &&
          stockPositions.every((p) => {
            const sum = stored
              .filter((a) => a.positionId === p.id)
              .reduce((acc, a) => acc + parseDecimalScaled(a.qty), 0n);
            return sum === parseDecimalScaled(String(p.quantity));
          }) &&
          [
            ...stored
              .reduce((m, a) => {
                const key = `${a.storeId}|${a.assortmentId}`;
                m.set(key, (m.get(key) ?? 0n) + parseDecimalScaled(a.qty));
                return m;
              }, new Map<string, bigint>())
              .entries(),
          ].every(([key, need]) => {
            const [sid, pid] = key.split('|') as [string, string];
            const bal = balancesByStore.get(sid)?.get(pid);
            if (!bal) return false;
            const avail = parseDecimalScaled(bal.qty) - parseDecimalScaled(bal.reservedQty ?? '0');
            return avail >= need;
          });

        const { plan, perPosition } = storedCovers
          ? {
              plan: { allocations: [], shortfalls: [], rules: [], warnings: [] },
              perPosition: stored,
            }
          : await this.planAllocations(
              tx,
              accountId,
              planStores,
              stockPositions.map((p) => ({
                id: p.id,
                productId: p.productId,
                quantity: p.quantity,
              })),
              balancesByStore,
              storeId,
              pieceTrackedIds,
            );

        // Ma'lumot invarianti buzilgan (07 da bir tovar bir necha yacheykada) —
        // sotuv TO'XTAMAYDI, lekin ko'rinadi (hodisa saboqi IS-5).
        for (const w of plan.warnings) {
          this.logger.warn(
            `[alloc-invariant] ${w.code} sale=${id} product=${w.assortmentId} store=${w.storeId} cells=${w.cells}`,
          );
        }

        if (plan.shortfalls.length > 0) {
          if (!allowNegative) {
            throw new BadRequestException({
              error: 'InsufficientStock',
              message: buildShortfallMessage(plan.shortfalls),
              details: { shortages: plan.shortfalls },
            });
          }
          // `allowNegativeStock` yoqilgan omborda eski erkinlik saqlanadi:
          // qoplanmagan qism ASOSIY ombordan (yacheykasiz) ayiriladi.
          const allocatedByPosition = new Map<string, bigint>();
          for (const a of perPosition) {
            allocatedByPosition.set(
              a.positionId,
              (allocatedByPosition.get(a.positionId) ?? 0n) + parseDecimalScaled(a.qty),
            );
          }
          for (const p of stockPositions) {
            const need =
              parseDecimalScaled(String(p.quantity)) - (allocatedByPosition.get(p.id) ?? 0n);
            if (need <= 0n) continue;
            perPosition.push({
              positionId: p.id,
              assortmentId: p.productId,
              storeId,
              cellId: null,
              qty: formatDecimalScaled(need),
            });
          }
        }
        // Faza 18a (STK-02): price the outflow VALUE, not just the qty. The
        // old `costDeltaMinor: null` left Stock.costBalanceMinor untouched
        // while qty fell, so every POS sale inflated the store's per-unit
        // weighted average for all later consumers (Loss, Demand, reports).
        // The basis is the per-store locked balance's average — identical to
        // Loss — with the receipt's frozen buyPrice snapshot as the
        // valueless-stock fallback (a sale from empty stock still removes
        // value; NULL≠0 contract untouched, `frozen` misses simply cost 0).
        // Tannarx asosi HAR OMBORNING o'z o'rtachasi (ilgari bitta ombornikiga
        // tayanardi — ko'p omborli ayirishda bu boshqa ombor qiymatini yozardi).
        const deltas: StockDelta[] = perPosition.map((a) => {
          const bal = balancesByStore.get(a.storeId)?.get(a.assortmentId);
          const onHand = bal?.qty ?? '0';
          const costBal = bal?.costBalanceMinor ? BigInt(bal.costBalanceMinor) : 0n;
          const fallback = frozen.get(a.assortmentId)?.costMinor ?? 0n;
          const perUnit =
            costBal > 0n && compareDecimals(onHand, '0') > 0
              ? computePerUnitCost(costBal, onHand)
              : fallback;
          return {
            storeId: a.storeId,
            assortmentKind: 'product',
            assortmentId: a.assortmentId,
            qtyDelta: `-${a.qty}`,
            costDeltaMinor: -scaleMinorByQty(perUnit, a.qty),
            docType: 'retailsale',
            docId: id,
            docPositionId: a.positionId,
            reason: 'post' as const,
            cellId: a.cellId,
            // 🔴 Yacheykasiz ajratmada `store-only`: aks holda `applyDeltas`
            // chiqimni band yacheykalardan KATTA-BIRINCHI avtomat ayirardi va
            // omborchi endigina sanagan yacheykani buzardi (H5 hisoboti).
            cellMode: a.cellId ? ('auto' as const) : ('store-only' as const),
          };
        });
        await this.stock.applyDeltas(tx, accountId, userId, deltas);

        // Ajratmalarni SAQLASH — chek qaysi ombor/yacheykadan yopilganining izi
        // (hisobot, vozvrat va yig'ish topshirig'i uchun yagona haqiqat).
        await tx.retailSalePositionAllocation.deleteMany({
          where: { accountId, positionId: { in: stockPositions.map((p) => p.id) } },
        });
        if (perPosition.length > 0) {
          await tx.retailSalePositionAllocation.createMany({
            data: perPosition.map((a: PositionAllocation) => ({
              accountId,
              positionId: a.positionId,
              storeId: a.storeId,
              cellId: a.cellId,
              qty: a.qty,
            })),
          });
        }

        // K4/6-vazifa — MIJOZGA KETGAN BO'LAK REYESTRDAN CHIQADI.
        //
        // AYNAN shu tranzaksiyada, qoldiq ayirish bilan birga: qoldiq kamayib
        // bo'lak reyestrda qolsa (yoki teskarisi) sverka o'sha ondayoq yolg'on
        // farq berardi va omborchi yo'q muammoni qidirardi.
        //
        // Kesim bu yerda ham STOK-NEYTRAL bo'lib qoladi: bo'laklar `sold`
        // bo'ladi, qoldiqni esa YUQORIDAGI `applyDeltas` kamaytiradi — ya'ni
        // ikkalasi bir marta, bir joyda.
        //
        // 🔴 BAYROQ SHARTI ataylab: bo'linadigan tovarsiz chekda reyestrga
        // so'rov UMUMAN ketmaydi (K3 ning «bayroq o'chiq bo'lsa hech narsa
        // o'zgarmaydi» qoidasi). Jonlida bayroq hozircha hech qayerda
        // yoqilmagan ⇒ bu blok ishga tushmaydi. Chekka qo'shilgandan KEYIN
        // bayroq o'chirilgan (nodir) holatda bo'laklar band bo'lib qoladi —
        // sverka buni «ortiqcha» deb KO'RSATADI, jim yo'qotish yo'q.
        if (pieceTrackedIds.size > 0) {
          const pieceConsume = await consumePiecesForSale(
            tx,
            accountId,
            stockPositions.map((p) => ({ id: p.id, quantity: String(p.quantity) })),
          );
          // Nomuvofiqlik sotuvni TO'XTATMAYDI (to'lov paytida chekni rad
          // etish 2026-08-24 hodisasining aynan shakli bo'lardi) — KO'RINADI.
          for (const m of pieceConsume.mismatches) {
            this.logger.warn(
              `[piece-mismatch] sale=${id} position=${m.positionId} chek=${m.expected} bo'laklar=${m.pieces}`,
            );
          }
        }
      }

      // Kassa TZ §6.1 — har to'lov turi alohida qator. Bu Z-hisobotning
      // «to'lov turlari kesimida tushum» bandi uchun yagona manba (§8.5):
      // ikkita ustundan («naqd» va «naqdsiz») kanalni tiklab bo'lmaydi.
      if (pay.lines.length > 0) {
        await tx.retailSalePayment.createMany({
          data: pay.lines.map((l) => ({
            accountId,
            saleId: id,
            method: l.method,
            // ASL summa to'lov valyutasida (dollar → sent).
            amountMinor: l.amountMinor,
            // MK31: valyuta/kurs/base sof modulning YAGONA o'quvchilari
            // orqali olinadi — `?? 'UZS'` ni bu yerda takrorlash bir kun
            // dollar qatorini so'm deb yozib yuborardi.
            currency: lineCurrency(l) === 'UZS' ? sale.session.cashDesk.currency : lineCurrency(l),
            rateMinor: l.rateMinor ?? null,
            amountBaseMinor: lineBaseMinor(l),
          })),
        });
      }

      // Cash inflow: route through MoneyService so the ledger captures
      // both the materialized balance update and a MoneyOperation row
      // (audit trail) — atomic with the FSM flip and stock cascade.
      // Card/terminal portion is intentionally NOT booked yet — V2 requires a
      // BankAccount routing decision (which account to credit per
      // POS terminal). For now it lives in RetailSale.cardAmountMinor +
      // the RetailSalePayment rows above.
      //
      // ⚠️ QAYTIM CHEGIRILADI. Kassaga tushadigan pul — berilgan naqd MINUS
      // qaytim. Ilgari to'liq `cashAmount` yozilardi: 100 000 berib 90 000 lik
      // tovar olgan mijozga 10 000 qaytarilsa ham, kassa balansi 100 000 ga
      // o'sardi. Bu smena yopilishida (TZ §8.4 «farq akti») SOXTA KAMOMAD
      // beradi — kutilgan naqd haqiqiydan har qaytim summasicha ko'p bo'ladi.
      //
      // ⚠️ MK31 — DOLLAR NAQD BU DAFTARGA TUSHMAYDI. `CashDesk.balanceMinor`
      // BITTA valyutadagi qoldiq va `money.applyDeltas` boshqa valyutali
      // deltani rad etadi («Currency mismatch»). Dollarni so'mga o'girib
      // yozish yolg'on bo'lardi — yashiqda dollar yotibdi, so'm emas — va
      // so'm qoldig'ini buzardi. Shu sababdan dollar yashiq FAQAT smena
      // hisobida yuritiladi (§8.4: `CashierSession.*UsdMinor` + `CASH_USD`
      // to'lov qatorlari). QARZ (ochiq qayd): pul daftari va bank-balans
      // hisobotlari kassadagi dollarni KO'RSATMAYDI.
      //
      // Dollardan berilgan qaytim esa SO'M yashig'idan chiqadi, ya'ni bu
      // delta MANFIY bo'lishi mumkin — `> 0n` sharti uni jimgina yutib
      // yuborardi va yashiqdagi so'm haqiqatdan ko'p ko'rinardi.
      const cashToDrawer = cashAmount - change;
      if (cashToDrawer !== 0n) {
        const moneyDeltas: MoneyDelta[] = [
          {
            sourceKind: 'cash_desk',
            sourceId: sale.session.cashDeskId,
            deltaMinor: cashToDrawer,
            currency: sale.session.cashDesk.currency,
            documentKind: 'retailsale',
            documentId: id,
            description: `POS sale ${sale.name}`,
          },
        ];
        await this.money.applyDeltas(tx, accountId, moneyDeltas);
      }

      // ── A2 (2026-08-25) — AVANSDAN TO'LOV ──────────────────────────────
      //
      // 🔴 TARTIB MUHIM: bu blok QARZ blokidan OLDIN turadi va bu ATAYLAB.
      //
      // Q2 ning §2.2 KESISHUV QOIDASI reyestr qatorini «balansOldin» dan
      // hisoblaydi. Avansi 40k bo'lgan mijoz 100k lik chekni 40k avans + 60k
      // qarz bilan olsa, qarz reyestriga tushishi kerak bo'lgan summa AYNAN
      // 60k — chunki avans allaqachon SHU chekda yeyildi. Agar qarz bloki
      // avval yugursa, u balansni hamon −40k deb ko'rib qatorni 20k qilib
      // ochardi va 40k qarz undirish ro'yxatida KO'RINMAY qolardi (egasining
      // birinchi shikoyatining aynan qaytishi). Avans deltasi oldin
      // qo'llansa balans 0 ga keladi va §2.2 to'g'ri 60k beradi.
      //
      // 🔴 BALANS QULFI BU YERDA MAJBURIY (A1 dan farqi — A1 hisobotidagi
      // «chekinish 1»): u yerda hech qanday qaror balansga bog'liq emas edi,
      // bu yerda esa CAP bor (`prepay ≤ −balansOldin`). Qulfsiz ikki parallel
      // chek bir xil «avansim bor» ni ko'rib bitta avansni IKKI MARTA
      // sarflardi va mijozning balansi jimgina musbat — ya'ni QARZ — bo'lib
      // qolardi. Qulf tartibi P1/Q2/Q3 bilan AYNAN bir xil: BALANS → QARZLAR.
      // Pastdagi qarz bloki AYNI qatorni qayta qulflaydi — bir tranzaksiya
      // ichida bu no-op, deadlock yuzasi ochilmaydi.
      if (prepayAmount > 0n && debtAgentId) {
        const prepayBalanceBefore = await this.lockCounterpartyBalance(
          tx,
          accountId,
          debtAgentId,
          sale.session.cashDesk.currency,
        );
        // 🔴 `null` = O'LCHANMAGAN (balans qatori yo'q), «0» EMAS — lekin
        // AVANS uchun ikkalasi ham AYNI natija beradi: qatori yo'q mijozda
        // avans ham yo'q. Bu ehtiyotkor tomon: yo'q pulni sarflatmaymiz.
        const availableMinor =
          prepayBalanceBefore != null && prepayBalanceBefore < 0n ? -prepayBalanceBefore : 0n;
        if (prepayAmount > availableMinor) {
          // Invariant 5 — ortig'i JIMGINA QARZGA AYLANMAYDI. Xabar kassirga
          // aniq son bilan: mijozda nechta avans borligini o'sha zahoti aytadi.
          throw new BadRequestException(
            `Mijozning avansi atigi ${(availableMinor / 100n).toString()} so'm, ` +
              `${(prepayAmount / 100n).toString()} so'm ishlatib bo'lmaydi. ` +
              'Qolgan qismini naqd/karta bilan oling yoki qarzga yozing.',
          );
        }

        await this.counterpartyBalance.applyDelta(
          tx,
          accountId,
          debtAgentId,
          sale.session.cashDesk.currency,
          // Delta MUSBAT — `DEBT` tenderiniki bilan AYNAN bir xil. Farq faqat
          // natijaning ishorasida: bu yerda balans manfiy hududdan nolga
          // qarab suriladi (avans yeyiladi), qarz TUG'ILMAYDI.
          prepayAmount,
          {
            docType: 'salePrepay',
            docId: id,
            organizationId: sale.organizationId,
            // 🔴 `source` ATAYLAB BERILMAYDI (A1 bilan bir xil qaror).
            // Mijozga xabar `source` orqali ketadi va musbat delta
            // «🛒 Qarzga qo'shildi» matnini tanlardi — avansini sarflagan
            // mijozga «qarzingiz oshdi» deb yozish OCHIQ YOLG'ON bo'lardi
            // (u qarzdor emas, o'z pulini ishlatdi). Avans harakati mijozga
            // xabar sifatida A3 da ko'rib chiqiladi; hozircha JIM, va bu
            // jimlik shu yerda YOZMA qayd etilgan.
          },
        );

        const prepayBal = await tx.counterpartyBalance.findFirst({
          where: {
            accountId,
            counterpartyId: debtAgentId,
            currency: sale.session.cashDesk.currency,
          },
          select: { balanceMinor: true },
        });
        await this.writeAuditEvents(tx, accountId, sale.sessionId, userId, [
          planPrepaySaleAuditEvent(id, {
            agentId: debtAgentId,
            saleName: sale.name,
            prepayMinor: prepayAmount,
            totalMinor: total,
            balanceBeforeMinor: prepayBalanceBefore,
            newBalanceMinor: prepayBal?.balanceMinor ?? null,
          }),
        ]);
      }

      // Kassa TZ §7.1 — qarzga sotilgan qism MIJOZNING UMUMIY BALANSIGA
      // yoziladi. Ishora konventsiyasi moysklad «Баланс» bilan bir xil:
      // musbat = mijoz bizga qarzdor (`InvoiceOut.post` bilan bir xil yo'nalish).
      //
      // 🔴 «Bu yerda ATAYLAB `Debt` reyestriga (QRZ-…) YOZMAYMIZ» — BEKOR
      // QILINDI (Q2, 2026-08-25; reja:
      // `docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md`).
      //
      // ESKI MATN (tarix uchun saqlanadi, aks holda keyingi o'quvchi kodni
      // izohga qarab «tuzatib» qo'yadi): «reyestr — qo'lda ochiladigan,
      // hujjatsiz qarzlar uchun, va uning `create` yo'li ham AYNAN shu
      // balansga `+total` yozadi (2026-08-05). Ikkalasiga birdan yozilsa,
      // hujjatdan kelgan qarz IKKI MARTA sanalardi (xotira:
      // `debt-ledger-asymmetry`). Bitta daftar — bitta haqiqat.»
      //
      // NEGA O'ZGARDI (egasining shikoyati, 2026-08-25): «kassadan qo'shilgan
      // qarzdorliklar undirish bo'limida ko'rinmayapti». Undirish ro'yxati
      // (`manager/collection/debt-collection.service.ts`) FAQAT `Debt`
      // reyestridan o'qiydi, ya'ni chekdan berilgan qarz qo'ng'iroq jadvaliga,
      // eslatmaga va menejer navbatiga umuman tushmasdi.
      //
      // «IKKI MARTA SANASH» xavfi YO'QOLGANI — P1 (2026-08-11) adopsiya
      // naqshi bilan: qator `balanceAdopted = true` bilan tug'iladi va
      // `applyDelta` ni CHAQIRMAYDI. Ya'ni pul-daftar (balans) bu blokda
      // AYNAN BIR MARTA harakatlanadi (pastdagi yagona `applyDelta`), reyestr
      // qatori esa o'sha qarzni faqat KO'RINADIGAN qiladi. Simmetriya:
      // `debt.service.remove()` ham `balanceAdopted` qatoriga `−total`
      // yozmaydi, `recompute-counterparty-balances.ts` ham uni sanamaydi
      // (Q1 filtri).
      if (debtAmount > 0n && debtAgentId) {
        // 🔴 Q2 — BALANS QULFI `applyDelta` DAN OLDIN OLINADI.
        //
        // Reyestr qatorining summasi §2.2 KESISHUV QOIDASI bo'yicha
        // «balansOldin» dan hisoblanadi. Ikki parallel chek bir xil
        // «balansOldin» ni ko'rsa ikkalasi ham avans qoplaganini o'ylab qator
        // ochmasdi (yoki ikkalasi ham to'liq ochardi) — ya'ni qarz yana
        // ko'rinmas bo'lardi. `FOR UPDATE` ularni ketma-ketlashtiradi.
        //
        // QULF TARTIBI **BALANS → QARZLAR** — P1 (`pos-debt-payment.service.ts`
        // `lockBalance`) bilan AYNAN bir xil, aks holda ikki yo'l bir-birini
        // deadlock qilardi. (Bu blokda `debts` ga faqat INSERT bor, ya'ni
        // qarz-qatori qulfi olinmaydi; tartib baribir bir xil yo'nalishda.)
        //
        // ⚠️ Yashiq valyutasi qarz DAFTARI valyutasidan farq qilsa (MK31 —
        // dollar yashiq) qulf ham, qator ham olinmaydi: reyestr so'mda
        // yuritiladi, balans esa yashiq valyutasida yozilmoqda — ikkalasini
        // aralashtirish yolg'on qarz bo'lardi (§2.3 chegarasi).
        const debtRegistryCurrencyOk = sale.session.cashDesk.currency === DEBT_LEDGER_CURRENCY;
        const balanceBeforeMinor = debtRegistryCurrencyOk
          ? await this.lockCounterpartyBalance(
              tx,
              accountId,
              debtAgentId,
              sale.session.cashDesk.currency,
            )
          : null;

        await this.counterpartyBalance.applyDelta(
          tx,
          accountId,
          debtAgentId,
          sale.session.cashDesk.currency,
          debtAmount,
          {
            docType: 'retailsale',
            docId: id,
            organizationId: sale.organizationId,
            // Mijozga Telegram xabari shu `source` orqali ketadi. U OPTIONAL —
            // unutilsa typecheck jim o'tadi va xabar oqimi o'chib qoladi
            // (qo'riqchi: `counterparty-debt-notify/debt-source-wiring.test.ts`).
            source: 'retailsale',
          },
        );
        // Yangi balansni O'QIYMIZ va hodisaga yozamiz — «kimning qarzi tez
        // o'sadi» savoliga keyin javob berish uchun o'sha ondagi holat kerak.
        const bal = await tx.counterpartyBalance.findFirst({
          where: {
            accountId,
            counterpartyId: debtAgentId,
            currency: sale.session.cashDesk.currency,
          },
          select: { balanceMinor: true },
        });
        await this.writeAuditEvents(tx, accountId, sale.sessionId, userId, [
          planCreditSaleAuditEvent(id, {
            agentId: debtAgentId,
            saleName: sale.name,
            debtMinor: debtAmount,
            totalMinor: total,
            newBalanceMinor: bal?.balanceMinor ?? null,
          }),
        ]);

        // 🔴 Q2 — UNDIRISH REYESTRIGA qator. Balans deltasidan KEYIN va AYNAN
        // shu tranzaksiyada: chek rollback bo'lsa qator ham qolmaydi.
        if (debtRegistryCurrencyOk) {
          await this.writeSaleDebtRegistryRow(tx, accountId, userId, {
            saleId: id,
            saleName: sale.name,
            counterpartyId: debtAgentId,
            debtAmountMinor: debtAmount,
            balanceBeforeMinor,
            postedAt,
          });
        } else {
          // JIMGINA o'tmaydi (§2.3 chegarasi + reja Q2 vazifasi 1): qarz
          // balansga yozildi, lekin undirish ro'yxatida KO'RINMAYDI.
          this.logger.warn(
            `[Q2] ${sale.name}: yashiq valyutasi ${sale.session.cashDesk.currency} ≠ ` +
              `${DEBT_LEDGER_CURRENCY} — undirish reyestriga qator OCHILMADI. Qarz mijoz ` +
              'balansiga yozildi va faqat u yerda ko`rinadi (USD qarz — alohida ish).',
          );
        }
      }

      // Smena agregatlari (salesCount / salesSumMinor) yuqoridagi CLAIM bilan
      // BIRGA yozildi — qulf va hisob ajralmasin (Faza Q1).

      // ── F8: zakaz holati MAVJUD primitiv orqali o'zgaradi ────────────────
      //
      // 🔴 Bu yerda YANGI holat-o'qi ham, qo'lda yozilgan `state: 'paid'` ham
      // YO'Q. `CustomerOrderService.applyPayment` — cash-in va invoice-out
      // ham chaqiradigan mavjud yo'l: `payedSumMinor` ni oshiradi va
      // `confirmed|awaiting_payment|partially_shipped → paid` (to'liq
      // jo'natilgan bo'lsa → `closed`) o'tishini O'ZI qaror qiladi, audit
      // yozuvi bilan birga.
      //
      // QISMAN TO'LOV shu tanlovdan BEPUL keladi: chek zakaz jamini
      // qoplamasa, `fullyPaid` false bo'ladi va holat O'ZGARMAYDI —
      // zakaz `confirmed`/`awaiting_payment` da qolib, qoldig'i keyingi chek
      // bilan to'lanishi mumkin (yuqoridagi qulf predikati aynan shuni
      // ruxsat beradi).
      if (sale.customerOrderId) {
        await this.customerOrders.applyPayment(
          tx,
          accountId,
          userId,
          sale.customerOrderId,
          total,
          'apply',
        );
      }

      return tx.retailSale.findUniqueOrThrow({ where: { id, accountId } });
    });

    // §109: accrue loyalty points AFTER the sale txn commits.
    await this.accrueLoyalty(accountId, userId, {
      id: posted.id,
      agentId: posted.agentId ?? null,
      sumMinor: posted.sumMinor,
    });
    return posted;
  }

  /**
   * 🔴 Q3 — TEKSHIRILDI: `cancel()` UNDIRISH REYESTRIGA TEGMAYDI, va TEGMASLIGI
   * KERAK (reja `2026-08-25-kassa-qarzi-undirish-reyestri.md`, Q3 vazifa 3).
   *
   * DALIL: bekor qilish faqat `CANCELLABLE = ['draft','picking','ready']`
   * holatlaridan yuradi (`retail-sale-fsm.ts`) — ya'ni chek hali POST
   * QILINMAGAN. Qarz esa (balansda ham, reyestrda ham) FAQAT `post()` da
   * tug'iladi: `if (debtAmount > 0n && debtAgentId)` bloki. Post qilinmagan
   * chekda `debtAmount` yozilmagan, `Debt` qatori yo'q ⇒ harakatlantiradigan
   * narsa yo'q. Post qilingan chekni «bekor qilish» yo'li — `refund()`.
   *
   * ⚠️ Agar kelajakda `CANCELLABLE` ga `'posted'` qo'shilsa bu premise
   * BUZILADI va bu yerga reyestr qatorini yopish kerak bo'ladi. Shuning
   * uchun u qo'riqchi test bilan qulflangan
   * (`retail-sale-debt-registry-symmetry.test.ts` — «cancel posted'ga
   * tegmaydi»).
   */
  async cancel(accountId: string, userId: string, id: string) {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      // name/sumMinor/positions feed the audit event (kassa TZ §9): a cancel
      // has to record WHAT was thrown away, not merely that something was.
      select: {
        id: true,
        state: true,
        name: true,
        sessionId: true,
        sumMinor: true,
        // P3 — rezervni bo'shatish uchun do'kon KERAK, va u `send-to-picking`
        // rezerv yozgan joy bilan AYNI manbadan olinadi (smena do'koni).
        session: { select: { storeId: true } },
        positions: {
          select: {
            productId: true,
            quantity: true,
            // K4 — bo'linadigan tovar bayrog'i POZITSIYA bilan birga keladi
            // (K3 naqshi: alohida so'rov YO'Q). Faqat shu bayroq bo'lsa
            // bo'lak reyestriga tegiladi.
            product: { select: { pieceTracked: true } },
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    // Yig'ilayotgan (`picking`) va yig'ilgan (`ready`) cheklar ham bekor
    // qilinadi — TZ §4 diagrammasi. Ilgari `!== 'draft'` edi: mijoz ketib
    // qolsa chek hech qachon yopilmasdi (post ham, cancel ham rad etardi).
    if (!canTransition(sale.state, 'cancel')) {
      throw new BadRequestException(transitionRejection(sale.state, 'cancel'));
    }

    // F6: hold yozilgan paytdagi kaskad omborini bilish uchun (quyida qulf
    // hold HAQIQATAN turgan omborlarga olinadi).
    const cascade = await this.resolveStockCascade(accountId);

    // Atomic state guard: pre-posted holatlardan → 'cancelled'. Without this, a
    // cancel that races with a post() would silently overwrite 'posted' to
    // 'cancelled' while the cashDesk inflow and session aggregates remain —
    // leaving money in the till against a cancelled receipt.
    // The audit event shares the transaction with the flip: whoever wins the
    // race is the one who gets logged, and a lost race logs nothing.
    await this.prisma.client.$transaction(async (tx) => {
      const flipResult = await tx.retailSale.updateMany({
        where: { id, accountId, state: { in: [...allowedFrom('cancel')] } },
        data: { state: 'cancelled' },
      });
      if (flipResult.count === 0) {
        throw new ConflictException(
          `RetailSale ${id} state changed; cancel aborted (already posted?)`,
        );
      }

      // P3 (2026-08-12) — YIG'ISH REZERVI BO'SHATILADI.
      //
      // Bekor qilingan chek tovarni band ushlab turolmaydi: mijoz ketdi,
      // tovar javonda. Bo'shatilmasa hold ABADIY qolardi — uni yechadigan
      // hujjat endi yo'q (bekor qilingan chekni na post, na qayta cancel
      // qilib bo'ladi) va o'sha tovar hech kimga sotilmasdi.
      //
      // Flip bilan BIR tranzaksiyada: ajralsa, oradagi xato «chek bekor,
      // tovar band» holatini qoldirardi. `releaseReservationByDoc`
      // idempotent (net ≤ 0 → no-op), ya'ni rezervsiz `draft` chekni bekor
      // qilish ham, takroriy bekor ham `reservedQty` ni manfiyga tushirmaydi.
      const cancelStock = sale.positions.filter(
        (p): p is typeof p & { productId: string } => p.productId !== null,
      );
      if (cancelStock.length > 0) {
        const products = cancelStock.map((p) => ({ kind: 'product' as const, id: p.productId }));
        // `releaseReservationByDoc` shartnomasi — qulf SHU tx da. F6: hold
        // yozilgan paytdagi KASKAD omborida turadi (smena omborida emas) —
        // qulf hold HAQIQATAN turgan omborlarga olinadi (deterministik sort).
        // Kaskadsiz o'rnatmada eski yo'l (smena ombori) baytma-bayt saqlangan.
        if (cascade.length > 0) {
          const holdRows = await tx.stockReservation.findMany({
            where: { accountId, docType: 'retailsale', docId: id },
            select: { storeId: true },
            distinct: ['storeId'],
          });
          for (const sid of [...new Set(holdRows.map((h) => h.storeId))].sort()) {
            await this.stock.lockBalances(tx, accountId, sid, products);
          }
        } else {
          await this.stock.lockBalances(tx, accountId, sale.session.storeId, products);
        }
        await this.stock.releaseReservationByDoc(
          tx,
          accountId,
          userId,
          'retailsale',
          id,
          'release_cancel',
        );
      }

      // K4 — MIJOZ VOZ KECHDI: kesilgan bo'lak OMBORDA QOLADI.
      //
      // 🔴 Bu rezervdan TUBDAN farq qiladi. Rezerv — hisob yozuvi, u
      // bo'shatiladi. Bo'lak esa JISMONIY haqiqat: kabel allaqachon kesilgan
      // va uni qaytarib ulab bo'lmaydi. Shuning uchun 180 m yorlig'i bilan
      // javonda turaveradi va ertaga boshqa mijozga ketadi (K-reja 2-bo'lim).
      // Qoldiq bir grammga ham o'zgarmaydi — kesim uni hech qachon
      // o'zgartirmagan edi (STOK-NEYTRAL).
      //
      // Uziladigan yagona narsa — «mijoz oldida turibdi» bog'lanishi, aks
      // holda bo'lak abadiy band bo'lib qolardi va uni hech kim sotolmasdi
      // (rezervning abadiy hold muammosining bo'lak shakli).
      // Bayroq sharti — `post()` dagi bilan AYNI sabab: bo'linadigan tovarsiz
      // chekda reyestrga so'rov umuman ketmaydi.
      if (sale.positions.some((p) => p.product?.pieceTracked === true)) {
        await releasePiecesForSale(tx, accountId, id);
      }

      await this.writeAuditEvents(tx, accountId, sale.sessionId, userId, [
        planCancelAuditEvent(id, {
          // The stage BEFORE the flip — «cancelled a ready receipt» means the
          // warehouse already picked the goods and has to put them back.
          stage: sale.state,
          name: sale.name,
          sumMinor: sale.sumMinor,
          lines: sale.positions.map((p) => ({
            productId: p.productId,
            quantity: String(p.quantity),
          })),
        }),
      ]);
    });

    // Omborchining ochiq yig'ish topshiriqlari yopiladi — aks holda bekor
    // qilingan chekning vazifasi panelda «pending» bo'lib qolardi va omborchi
    // yo'q sotuv uchun tovar yig'ib yurardi. `done` EMAS ('yig'ib bo'lindi'
    // degan yolg'on bo'lardi) — alohida `cancelled` holat.
    // Best-effort: chek allaqachon bekor qilingan, topshiriq tozalashdagi
    // xato uni orqaga qaytarmasligi kerak.
    if (sale.state === 'picking' || sale.state === 'ready') {
      await this.prisma.client.restockTask
        .updateMany({
          where: {
            accountId,
            sourceId: id,
            sourceType: 'retailsale',
            type: 'picking',
            status: { notIn: ['done', 'cancelled'] },
          },
          data: { status: 'cancelled' },
        })
        .catch((e) => {
          this.logger.error(
            `cancel[${id}]: picking-task cleanup failed: ${e instanceof Error ? e.message : e}`,
          );
        });
    }

    return this.prisma.client.retailSale.findUniqueOrThrow({ where: { id, accountId } });
  }

  /**
   * SOTUVSIZ CHEK uchun kunlik raqam — kassirning shu kundagi keyingisi.
   *
   * Sotuvsiz chek (proforma, 2026-08-16) serverda hujjat YARATMAYDI, shuning
   * uchun raqami hech qayerda saqlanmaydi: bu yo'l faqat hisoblagichni
   * suradi va sonni qaytaradi. Ya'ni chiqarilgan har bir qog'oz — haqiqiy
   * sotuv cheki ham, sotuvsiz chek ham — kassirning kunlik ketma-ketligida
   * O'Z raqamini oladi va ikkitasiga bir raqam tushmaydi.
   *
   * 🔴 Qayta chop etishda YANGI raqam chiqadi (haqiqiy chekda esa muzlagan
   * raqam qaytadi). Bu ATAYLAB: sotuvsiz chek hujjat emas — egasining oqimi
   * «chipni och → o'zgartir → yana chiqar», ya'ni har bosilgan varaq alohida
   * qog'oz. Aks holda hisoblagich bo'yicha nima muzlashini saqlaydigan joy
   * kerak bo'lardi — u esa aynan «hujjat yaratmaydi» qoidasini buzardi.
   *
   * Smena yopiq bo'lsa — 400: yopilgan smenaga chek chiqarish, hatto sotuvsiz
   * bo'lsa ham, Z-hisobot bilan qog'ozni ajratib yuboradi.
   */
  async allocateReceiptNumber(accountId: string, raw: unknown): Promise<{ number: number }> {
    const parsed = AllocateReceiptNumberSchema.parse(raw);
    const session = await this.prisma.client.cashierSession.findFirst({
      where: { id: parsed.sessionId, accountId },
      select: { cashierId: true, state: true },
    });
    if (!session) throw new NotFoundException(`CashierSession ${parsed.sessionId} not found`);
    if (session.state !== 'open') {
      throw new BadRequestException(`Session is ${session.state}. Cannot issue a receipt number.`);
    }

    const number = await allocateDocumentNumber(
      this.prisma.client,
      accountId,
      dailyReceiptSequenceKey(session.cashierId, new Date()),
      // Seed 0 — kalit har kun YANGI, hisoblagich 1 dan boshlanadi (post() bilan bir xil).
      async () => 0,
    );
    return { number };
  }

  /**
   * TO'LANGAN CHEKNI TAHRIRLASH — 1-bosqich: mijoz va to'lov taqsimoti.
   *
   * NEGA «sof farq» (`retail-sale-edit-plan.ts`): daftarlar delta bilan
   * ishlaydi, shuning uchun to'liq unpost+repost SHART EMAS va xavfli ham.
   * Chek raqami (`name`) O'ZGARMAYDI — u unique, va aynan shu sabab
   * «qaytarish + yangi chek» yo'li raqamni saqlay olmaydi.
   *
   * 🔴 TOVAR TARKIBI BU BOSQICHDA O'ZGARMAYDI: u tan narx (COGS) hisobini
   * talab qiladi va uni shoshib yozish marja ma'lumotini JIM buzadi. Reja
   * moduli tovar farqini hisoblaydi; bu yerda u bo'lsa aniq xabar bilan
   * rad etiladi (foydalanuvchi qaytarishdan foydalanadi).
   *
   * Pul harakati JORIY ochiq smenaga yoziladi — `refund()` bilan bir naqsh
   * (F6, 2026-08-13): asl smena yopiq bo'lishi mumkin va uning Z-hisoboti
   * allaqachon chiqarilgan.
   */
  /**
   * CHEK IZOHI (2026-08-19, egasi: «kassada har bir chekka izoh ham qo'shish
   * funksiyasini qilish kerak»).
   *
   * ATAYLAB tor yo'l — `update()` faqat `draft` chekni qabul qiladi (pul
   * olingan, ombor yechilgan chekni qayta yozishdan saqlaydigan qulf), izoh esa
   * summa/ombor/holat/to'lovga UMUMAN tegmaydigan metama'lumot. Shu sababli
   * qulfni yumshatish o'rniga FAQAT shu maydonni yozadigan alohida metod:
   * chekning istalgan holatida ishlaydi va boshqa hech nimani o'zgartira
   * olmaydi (`data` da bitta maydon bor).
   *
   * · optimistik qulf `version` bilan — ikki kishi bir vaqtda yozsa
   *   ikkinchisi 409 oladi, jimgina ustiga yozmaydi;
   * · har o'zgarish `AuditLog` ga tushadi: kim, qachon, ESKI matn → YANGI
   *   matn (kassir ham tahrirlay olgani uchun iz qolishi SHART);
   * · o'chirilgan chek tahrirlanmaydi.
   */
  async updateComment(accountId: string, userId: string, saleId: string, raw: unknown) {
    const parsed = UpdateSaleCommentSchema.parse(raw);
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id: saleId, accountId, deletedAt: null },
      select: { id: true, name: true, version: true, description: true },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${saleId} not found`);

    // Matn o'zgarmagan bo'lsa — YOZILMAYDI: aks holda har ochib-yopish
    // jurnalga bo'sh «o'zgardi» qatorini qo'shib, izni o'qib bo'lmas qilardi.
    if ((sale.description ?? null) === parsed.description) return sale;

    try {
      const updated = await this.prisma.client.retailSale.update({
        where: { id: saleId, accountId, version: parsed.version },
        data: { description: parsed.description },
        select: { id: true, name: true, version: true, description: true },
      });
      await this.prisma.client.auditLog.create({
        data: {
          accountId,
          userId,
          entity: 'retailsale',
          entityId: saleId,
          action: 'comment_change',
          fieldChanges: {
            description: { before: sale.description ?? null, after: parsed.description },
          },
        },
      });
      return updated;
    } catch (e) {
      mapVersionedUpdateError(e, 'RetailSale');
      throw e;
    }
  }

  async edit(accountId: string, userId: string, saleId: string, raw: unknown) {
    const parsed = EditRetailSaleSchema.parse(raw);
    const paidMinor = BigInt(parsed.paidMinor);
    const debtMinor = BigInt(parsed.debtMinor);

    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id: saleId, accountId },
      select: {
        id: true,
        name: true,
        state: true,
        version: true,
        agentId: true,
        sumMinor: true,
        payedSumMinor: true,
        refundedFromId: true,
        positions: { select: { productId: true, quantity: true, sumMinor: true } },
        // A2 — tahrir qo'riqchisi uchun (pastdagi izoh).
        payments: { select: { method: true } },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${saleId} not found`);
    if (sale.state !== 'posted') {
      throw new BadRequestException(
        `Faqat to'langan chek tahrirlanadi (hozir: ${sale.state}). To'lanmagan chek uchun oddiy tahrir bor.`,
      );
    }
    if (sale.refundedFromId) {
      throw new BadRequestException(
        `${sale.name} — vozvrat cheki. Vozvrat chekini tahrirlab bo'lmaydi — asl chekni tahrirlang.`,
      );
    }

    // 🔴 A2 QO'RIQCHISI — AVANSDAN to'langan chek tahrirlanmaydi.
    //
    // `planReceiptEdit` ning butun pul mantig'i BITTA soddalashtirishga
    // tayanadi: `cashDeltaMinor = yangi payed − eski payed`, ya'ni «to'langan
    // hamma narsa NAQD» deb qaraladi va farq kassa yashig'iga yoziladi.
    // Avansdan to'langan chekda bu yashiqqa hech qachon KIRMAGAN pulni
    // chiqarib yuborardi (R1 hodisasining aynan sinfi) — mijozning balansi
    // esa joyida qolardi.
    //
    // Tahrirni TO'G'RI qilish uchun `planReceiptEdit` ga kanal-kesimi kerak
    // (naqd/karta/avans/qarz alohida) — bu A2 hajmidan tashqarida va ochiq
    // chegara sifatida hisobotda qayd etilgan. Shu sababdan JIM emas, 400:
    // kassir tuzatishni vozvrat orqali qiladi.
    //
    // ⚠️ Bu chegara faqat A2 dan KEYIN yozilgan cheklarga tegadi — eski
    // cheklarda `PREPAY` qatori umuman yo'q, ya'ni mavjud tahrir oqimi bir
    // bayt ham o'zgarmaydi.
    if (sale.payments.some((p) => p.method === TENDER.prepay)) {
      throw new BadRequestException(
        `${sale.name} — chek mijozning avansidan to'langan, uni tahrirlab bo'lmaydi. ` +
          'Tovarni qaytaring (vozvrat) va yangi chek rasmiylashtiring.',
      );
    }

    // Qaytarilgan miqdorlar — tahrir ulardan pastga tusha olmaydi.
    const priorRefunds = await this.prisma.client.retailSale.findMany({
      where: { accountId, refundedFromId: saleId },
      select: { positions: { select: { productId: true, quantity: true } } },
    });
    const refundedQty: Record<string, string> = {};
    for (const r of priorRefunds) {
      for (const p of r.positions) {
        if (!p.productId) continue;
        const prev = parseQty(refundedQty[p.productId] ?? '0') ?? 0n;
        refundedQty[p.productId] = formatQty(prev + (parseQty(String(p.quantity)) ?? 0n));
      }
    }

    const positions = sale.positions
      .filter((p): p is typeof p & { productId: string } => p.productId !== null)
      .map((p) => ({
        productId: p.productId,
        quantity: String(p.quantity),
        sumMinor: p.sumMinor,
      }));

    const plan = planReceiptEdit(
      {
        positions,
        paidMinor: sale.payedSumMinor,
        debtMinor: sale.sumMinor - sale.payedSumMinor,
        agentId: sale.agentId,
        refundedQty,
      },
      {
        // 1-bosqich: tovar tarkibi o'zgarmaydi — mavjudi uzatiladi.
        positions,
        paidMinor,
        debtMinor,
        agentId: parsed.agentId === undefined ? sale.agentId : parsed.agentId,
      },
    );

    if (plan.refusals.length > 0) throw new BadRequestException(plan.refusals.join('; '));
    if (plan.stockDeltas.length > 0) {
      // Mudofaa: 1-bosqichda tovar o'zgarmasligi kerak. Bu yerga tushish —
      // chaqiruvchi shartnomani buzgani, jimgina qo'llamaymiz.
      throw new BadRequestException(
        "Tovar tarkibini tahrirlash hali qo'llab-quvvatlanmaydi — buning uchun qaytarishdan foydalaning.",
      );
    }
    if (plan.noop) return { ok: true, changed: false };

    const newAgentId = parsed.agentId === undefined ? sale.agentId : parsed.agentId;

    // Pul JORIY ochiq smenaga (F6 naqshi).
    const currentSession = await this.prisma.client.cashierSession.findFirst({
      where: { accountId, cashierId: userId, state: 'open' },
      select: { id: true, cashDeskId: true, cashDesk: { select: { currency: true } } },
    });
    if (plan.cashDeltaMinor !== 0n && !currentSession) {
      throw new BadRequestException(
        "Pul o'zgarishi uchun ochiq smena kerak — smenani oching va qayta urinib ko'ring.",
      );
    }

    // Q3 — «hozir» bir marta (Q2 ning `postedAt` qarori bilan bir xil sabab).
    const editedAt = new Date();

    await this.prisma.client.$transaction(async (tx) => {
      const flip = await tx.retailSale.updateMany({
        where: { id: saleId, accountId, version: sale.version, state: 'posted' },
        data: {
          agentId: newAgentId,
          payedSumMinor: paidMinor,
          version: { increment: 1 },
        },
      });
      if (flip.count === 0) {
        throw new ConflictException(
          `${sale.name} boshqa joyda o'zgardi — sahifani yangilab qayta urinib ko'ring.`,
        );
      }

      if (plan.cashDeltaMinor !== 0n && currentSession) {
        await this.money.applyDeltas(tx, accountId, [
          {
            sourceKind: 'cash_desk',
            sourceId: currentSession.cashDeskId,
            deltaMinor: plan.cashDeltaMinor,
            currency: currentSession.cashDesk.currency,
            documentKind: 'retailsale',
            documentId: saleId,
            description: `Chek tahriri: ${sale.name}`,
          },
        ]);
      }

      // 🔴 MIJOZ ALMASHGANDA sof farq YETARLI EMAS — eskisidan to'liq yechib,
      // yangisiga to'liq yozamiz, aks holda qarz noto'g'ri odamda qolardi.
      const currency = currentSession?.cashDesk.currency ?? 'UZS';
      const oldDebt = sale.sumMinor - sale.payedSumMinor;

      // 🔴 Q3 — BALANS QULFI `applyDelta` DAN OLDIN (Q2/P1 bilan AYNAN bir
      // tartib: BALANS → QARZLAR). Reyestr qatorining yangi summasi §2.2
      // kesishuv qoidasi bo'yicha «balansOldin» dan hisoblanadi, ya'ni uni
      // qulfsiz o'qish ikki parallel tahrirda ikki xil qarorga olib kelardi.
      //
      // Ikki kontragent qulflanishi mumkin (mijoz almashgan holat) —
      // shuning uchun tartib DETERMINISTIK (id bo'yicha saralangan), aks
      // holda mijozlarni bir-biriga almashtiruvchi ikki tahrir deadlock
      // qilardi. Bu `lockOpenDebts` ning `ORDER BY` sabog'i.
      const registryCurrencyOk = currency === DEBT_LEDGER_CURRENCY;
      const balanceBefore = new Map<string, bigint | null>();
      if (registryCurrencyOk) {
        const lockIds = [...new Set([sale.agentId, newAgentId].filter((v) => v !== null))].sort();
        for (const cpId of lockIds) {
          balanceBefore.set(
            cpId,
            await this.lockCounterpartyBalance(tx, accountId, cpId, currency),
          );
        }
      }

      if (plan.agentChanged) {
        if (sale.agentId && oldDebt !== 0n) {
          await this.counterpartyBalance.applyDelta(
            tx,
            accountId,
            sale.agentId,
            currency,
            -oldDebt,
            {
              docType: 'retailsale',
              docId: saleId,
              organizationId: null,
              source: 'retailsale',
            },
          );
        }
        if (newAgentId && debtMinor !== 0n) {
          await this.counterpartyBalance.applyDelta(
            tx,
            accountId,
            newAgentId,
            currency,
            debtMinor,
            {
              docType: 'retailsale',
              docId: saleId,
              organizationId: null,
              source: 'retailsale',
            },
          );
        }
      } else if (plan.balanceDeltaMinor !== 0n && newAgentId) {
        await this.counterpartyBalance.applyDelta(
          tx,
          accountId,
          newAgentId,
          currency,
          plan.balanceDeltaMinor,
          { docType: 'retailsale', docId: saleId, organizationId: null, source: 'retailsale' },
        );
      }

      // 🔴 Q3 — REYESTR QATORI BALANS BILAN BIRGA (invariant 2), balans
      // deltalaridan KEYIN va AYNAN shu tranzaksiyada.
      if (registryCurrencyOk) {
        // §2.2 kesishuv qoidasi QAYTA qo'llanadi: mijozning avansi bo'lsa
        // tahrirdan keyin ham qarz tug'ilmasligi kerak. Qoida chekning O'Z
        // ulushidan OLDINGI balansdan yuradi — ya'ni shu chekning qarzi
        // balansdan chiqarib tashlanadi (aks holda u ikki marta sanalardi).
        const preReceiptBalance = (cpId: string, receiptShare: bigint): bigint | null => {
          const b = balanceBefore.get(cpId);
          return b === undefined || b === null ? null : b - receiptShare;
        };
        const nextTotal = newAgentId
          ? receivablePortion(
              // Mijoz almashgan bo'lsa yangi mijozda bu chekdan qarz YO'Q edi.
              preReceiptBalance(newAgentId, plan.agentChanged ? 0n : oldDebt),
              debtMinor,
            )
          : 0n;

        const outcome = await this.moveSaleDebtRegistryRow(tx, accountId, userId, {
          saleId,
          saleName: sale.name,
          currency,
          now: editedAt,
          reason: 'edit',
          mode: 'absolute',
          totalMinor: nextTotal,
          ...(plan.agentChanged ? { retargetToId: newAgentId } : {}),
        });

        // Qator YO'Q edi (Q2 dan oldingi chek, yoki avans qoplagani uchun
        // ochilmagan), tahrirdan keyin esa qarz BOR — Q2 yozuvchisi qayta
        // ishlatiladi. Usiz tahrirdan tug'ilgan qarz yana ko'rinmas bo'lardi,
        // ya'ni egasining shikoyati tahrir yo'li orqali qaytardi.
        if (outcome === 'missing' && newAgentId && nextTotal > 0n) {
          await this.writeSaleDebtRegistryRow(tx, accountId, userId, {
            saleId,
            saleName: sale.name,
            counterpartyId: newAgentId,
            debtAmountMinor: debtMinor,
            balanceBeforeMinor: preReceiptBalance(newAgentId, plan.agentChanged ? 0n : oldDebt),
            postedAt: editedAt,
          });
        }
      }
    });

    return { ok: true, changed: true };
  }

  async refund(accountId: string, userId: string, originalSaleId: string, raw: unknown) {
    const parsed = RefundRetailSaleSchema.parse(raw);

    const original = await this.prisma.client.retailSale.findFirst({
      where: { id: originalSaleId, accountId },
      include: {
        session: {
          select: {
            id: true,
            state: true,
            cashDeskId: true,
            storeId: true,
            cashDesk: { select: { currency: true } },
          },
        },
        // §105: needed to enforce the documented "subset of original
        // positions" contract (over-refund guard).
        // The frozen snapshot rides along so the mirror receipt reverses the
        // SAME cost the original was sold against (kassa TZ §5.3) — re-reading
        // the product card here would book a refund at today's cost and leave a
        // phantom profit behind whenever the card changed in between.
        positions: {
          select: {
            productId: true,
            quantity: true,
            costMinor: true,
            basePriceMinor: true,
            // SALES-01: the refund is PRICED from these — the client's
            // priceMinor is informational only (see priceRefundFromOriginal).
            priceMinor: true,
            discount: true,
            sumMinor: true,
          },
        },
        // SALES-04: how the receipt was actually settled. A DEBT row means
        // the till took no money for that share — refunding it in cash pays
        // out money that never arrived AND leaves the debt standing.
        // P5 — `amountBaseMinor` HAM kerak: `CASH_USD` qatorida `amountMinor`
        // SENTDA turadi, uni tiyin deb qo'shish naqd cap'ini ~12 000× kichik
        // ko'rsatib, dollar chekni qaytarib bo'lmaydigan qilardi.
        // `rateMinor` — dollar qatorining MUZLATILGAN kursi: qaytarishda
        // aynan shu ishlatiladi (joriy kurs bilan hisoblash do'konga
        // kurs-farqi foyda/zararini yasab qo'yardi).
        payments: {
          select: {
            method: true,
            amountMinor: true,
            amountBaseMinor: true,
            rateMinor: true,
          },
        },
      },
    });
    if (!original) throw new NotFoundException(`RetailSale ${originalSaleId} not found`);
    if (original.state !== 'posted') {
      throw new BadRequestException(`Can only refund a posted sale (current: ${original.state})`);
    }
    // Vozvrat zanjiri qulfi: mirror chek ham `state:'posted'` bilan tug'iladi
    // va unda to'lov qatorlari YO'Q — quyidagi settlement-hisob uni «qarz
    // ulushi 0» deb o'qib butun summani naqdga ochadi. Bu guard bo'lmasa
    // mirror'ni qayta-qayta refund qilib kassadan cheksiz pul (va omborga
    // cheksiz stok) olish mumkin edi. Qaytarish faqat ASL chekdan yuradi.
    if (original.refundedFromId) {
      throw new BadRequestException(
        `${original.name} — vozvrat cheki. Vozvrat chekini qaytarib bo'lmaydi — asl chekni qaytaring.`,
      );
    }
    // F6 (2026-08-13, egasi) — «kassir ISTALGAN chekka qaytarish qila oladi».
    // Eski precheck (2026-08-10: «asl chek smenasi ochiq bo'lishi shart»,
    // `original.session.state !== 'open'` → 400) ONGLI ravishda OLIB TASHLANDI:
    // qaytarish endi asl smenaga emas, QAYTARUVCHI KASSIRNING JORIY OCHIQ
    // SMENASIGA rasmiylashadi (mirror sessionId, hisoblagichlar, naqd chiqim —
    // hammasi quyida shu smenaga bog'lanadi; Z-hisobot sessionId bo'yicha
    // agregatlagani uchun avtomatik to'g'ri). Bu nusxa tranzaksiyadan
    // TASHQARIDA o'qilgan (eskirgan) — atomik claim quyida, tx ichida.
    const currentSession = await this.prisma.client.cashierSession.findFirst({
      where: { accountId, cashierId: userId, state: 'open' },
      select: {
        id: true,
        cashDeskId: true,
        storeId: true,
        cashDesk: { select: { currency: true } },
      },
    });
    if (!currentSession) {
      throw new ConflictException("Ochiq smena yo'q — qaytarish uchun avval smena oching.");
    }

    // F6: qaytgan tovar STOK-KASKAD omboriga kiradi — sotuv qaysi ombordan
    // ayirsa (Q1: «Ombor 07»), qaytish ham o'sha yerga (mijoz tovarni
    // jismonan do'konga olib keladi). Kaskad sozlanmagan bo'lsa — joriy
    // smena ombori (eski xulq).
    const refundCascade = await this.resolveStockCascade(accountId);
    const refundStoreId = refundCascade[0]?.id ?? currentSession.storeId;

    // SALES-05: what earlier refunds of this receipt already took. Before this,
    // the first partial refund flipped the receipt to 'refunded' and the other
    // nine units of a ten-unit sale could never come back — so no cumulative
    // bookkeeping was needed, and none existed. Cancelled mirrors are excluded:
    // they returned nothing.
    const priorRefunds = await this.prisma.client.retailSale.findMany({
      where: {
        accountId,
        refundedFromId: original.id,
        state: { in: ['posted', 'refunded'] },
      },
      select: {
        id: true,
        sumMinor: true,
        cashAmountMinor: true,
        cardAmountMinor: true,
        debtReturnMinor: true,
        positions: { select: { productId: true, quantity: true } },
        // Dollar qaytarish mirror chekning `CASH_USD` to'lov qatorida turadi
        // (smenaning dollar hisobi ham AYNI qatorni o'qiydi) — kümülativ
        // dollar cap'i uchun shu yerdan yig'iladi.
        payments: { select: { method: true, amountMinor: true } },
      },
    });
    const priorLines = priorRefunds.flatMap((r) =>
      r.positions.map((p) => ({ productId: p.productId, quantity: String(p.quantity) })),
    );
    const priorTotals = priorRefunds.reduce(
      (acc, r) => ({
        sumMinor: acc.sumMinor + r.sumMinor,
        moneyMinor: acc.moneyMinor + r.cashAmountMinor + r.cardAmountMinor,
        // P5 — NAQD alohida sanaladi: kanal cap'i ham kümülativ bo'lishi kerak,
        // aks holda chekni bo'lib-bo'lib qaytarish yo'li bilan yashiqdan
        // olinmagan pulni chiqarish mumkin bo'lardi.
        cashMinor: acc.cashMinor + r.cashAmountMinor,
        debtMinor: acc.debtMinor + r.debtReturnMinor,
        // SENTDA — so'm jamlariga QO'SHILMAYDI (ikkalasi ham bigint,
        // aralashtirilsa typecheck ko'rmaydi).
        // `?? []` — dollar qatori yo'q mirror (bu o'zgarishdan OLDIN
        // yaratilgan qaytarishlar) 0 beradi, yiqilmaydi.
        usdMinor:
          acc.usdMinor +
          (r.payments ?? [])
            .filter((p) => p.method === TENDER.cashUsd)
            .reduce((a, p) => a + p.amountMinor, 0n),
        // A2 — avvalgi qaytarishlar mijozning balansiga allaqachon
        // qaytargan avans. Manba `PREPAY` qatori (dollar bilan AYNI naqsh):
        // mirror chekda alohida USTUN ochilmadi, chunki `RetailSalePayment`
        // allaqachon «bu chek qanday hisob-kitob qilingan» daftari va
        // migratsiyasiz kengayadi.
        prepayMinor:
          acc.prepayMinor +
          (r.payments ?? [])
            .filter((p) => p.method === TENDER.prepay)
            .reduce((a, p) => a + p.amountMinor, 0n),
      }),
      { sumMinor: 0n, moneyMinor: 0n, cashMinor: 0n, debtMinor: 0n, usdMinor: 0n, prepayMinor: 0n },
    );

    // §105 over-refund guard: refunded products/qty must be a subset of
    // the original sale (the schema documents this; refund() never
    // enforced it → wrong stock inflow + over-refunded cash). SALES-05: the
    // cap is on this refund PLUS every earlier one.
    const posError = validateRefundPositions(
      original.positions.map((p) => ({
        productId: p.productId,
        quantity: String(p.quantity),
      })),
      parsed.positions.map((p) => ({ productId: p.productId, quantity: p.quantity })),
      priorLines,
    );
    if (posError) throw new BadRequestException(posError);

    // SALES-01: price the refund from the ORIGINAL receipt, never from the
    // request. Running the client's `priceMinor` through computePositions()
    // made the payout cap self-referential — a cashier could refund a
    // 10 000 so'm item for 10 000 000 and every guard below still passed.
    // `discount` is already baked into the original `sumMinor`, which also
    // closes FE-01 (refunding a discounted receipt at the list price).
    const refundPositions = priceRefundFromOriginal(
      original.positions.map((p) => ({
        productId: p.productId,
        quantity: String(p.quantity),
        priceMinor: p.priceMinor,
        discount: String(p.discount),
        sumMinor: p.sumMinor,
      })),
      parsed.positions.map((p) => ({ productId: p.productId, quantity: p.quantity })),
    );

    const cashReturn = BigInt(parsed.cashAmountMinor);
    const cardReturn = BigInt(parsed.cardAmountMinor);
    /** Dollar qaytarish — SENTDA. So'm jamlariga hech qachon qo'shilmaydi. */
    const usdReturn = BigInt(parsed.cashUsdReturnMinor);
    /**
     * Dollar qatorining ASL chekdagi muzlatilgan kursi. Joriy kursni olish
     * XATO bo'lardi: kurs o'zgargan bo'lsa qaytarish do'konga foyda/zarar
     * yasab qo'yardi — mijoz qancha bergan bo'lsa, shuncha qaytadi.
     */
    const usdRateMinor =
      original.payments.find((p) => p.method === TENDER.cashUsd && p.rateMinor != null)
        ?.rateMinor ?? null;
    /**
     * Dollar qaytarishning SO'M ekvivalenti — muzlatilgan kurs bilan, yagona
     * `usdBaseMinor` formulasidan (nusxa yozilsa bir kun ikkisi ayrilardi).
     * Kurs yo'q bo'lsa 0: bu holat cap tekshiruvidan KEYIN taqiqlanadi
     * (tartib muhim — dollar qatori umuman yo'q chekda kassir «kurs
     * yozilmagan» degan chalg'ituvchi xabar emas, «dollar olinmagan» ni
     * ko'rishi kerak).
     */
    const usdReturnBaseMinor =
      usdReturn > 0n && usdRateMinor != null ? usdBaseMinor(usdReturn, usdRateMinor) : 0n;

    // §105: cannot pay back more money than the refunded goods are
    // worth. Now that `refundPositions.totalMinor` is derived from the
    // original receipt, this cap is a real bound: Σ refund ≤ original.sumMinor.
    const amtError = validateRefundAmount(refundPositions.totalMinor, cashReturn, cardReturn);
    if (amtError) throw new BadRequestException(amtError);

    // SALES-04: split the refund between the till and the customer's account
    // the way the receipt itself was settled. `validateRefundAmount` above only
    // knows what the goods are worth — it cannot tell that the customer never
    // handed any money over.
    const originalDebtMinor = original.payments
      .filter((p) => p.method === TENDER.debt)
      .reduce((a, p) => a + p.amountMinor, 0n);
    // P5 — YASHIQ olgan ulush. Prodda o'lchandi (R1, 2026-08-12): 100% KARTA
    // bilan to'langan chek `cashAmountMinor = jami` bilan qaytarilib **201**
    // oldi va kassa qoldig'i 85 357,21 → 85 157,21 so'mga tushdi. Ya'ni bank
    // orqali kelgan pul naqd bo'lib chiqib ketdi (bankdagi qismini terminal
    // orqali ham qaytarish kerak ⇒ ikki karra to'lov).
    //
    // `amountBaseMinor` o'qiladi, `amountMinor` EMAS — `CASH_USD` qatorida
    // ikkinchisi SENTDA (MK31). Dollar naqd-o'xshash deb sanaladi: pul
    // yashiqda va uning qaytimi allaqachon so'mda beriladi (§6.2).
    //
    // 🔴 NULL ≠ 0: to'lov qatorlari UMUMAN yo'q chek — kassa TZ §6.1 dan
    // OLDINGI hujjat (prodda o'lchandi: eski posted cheklarda 0 qator).
    // Uni «naqd olinmagan» deb o'qish butun tarixiy chekni naqd
    // qaytarilmaydigan qilardi, ya'ni o'lchanmaganlik taqiqqa aylanardi.
    //
    // 🔴 2026-08-17 (egasi qarori): `CASH_USD` bu yerdan CHIQARILDI. Ilgari u
    // so'm ekvivalentida «naqd-o'xshash» sanalardi va dollarda to'langan chek
    // to'liq SO'M bilan qaytarilib ketardi. Prodda o'lchandi
    // (ТРН-2026-00318 → ТРН-2026-00323): so'm yashig'iga 4 690 000 kirgan,
    // 5 890 000 chiqib ketgan ⇒ so'm kassasi 1 200 000 ga kamaydi, mijozning
    // $100 esa yashiqda qoldi va smena dollar hisobi kamaymadi. Endi dollar
    // o'z bucket'ida qaytariladi (`usdReturn`, sent).
    const originalCashLikeMinor =
      original.payments.length === 0
        ? null
        : original.payments
            .filter((p) => p.method === TENDER.cashUzs)
            .reduce((a, p) => a + p.amountBaseMinor, 0n);
    // ⚠️ Mutant-tekshirilgan: BU qatorning o'zi hozir kuzatilmaydi — dollarni
    // yana «naqd-o'xshash» qilib qo'ysak ham testlar YASHIL qoladi, chunki
    // haqiqiy qulf `moneyMax` (dollar bazasi pul ulushidan chiqarilishi,
    // `originalUsdBaseMinor`). Bu filtr shunga QARAMAY so'm-only qoldirildi:
    // semantik to'g'ri va karta aralashgan holatda ikkinchi qatlam bo'ladi.
    // Dollar: SENTDA (`amountMinor`) — mijoz jismonan bergan pul.
    const originalCashUsdMinor =
      original.payments.length === 0
        ? null
        : original.payments
            .filter((p) => p.method === TENDER.cashUsd)
            .reduce((a, p) => a + p.amountMinor, 0n);
    // Dollarning so'm ekvivalenti — SO'M pul ulushidan chiqarib tashlash uchun
    // (aks holda dollar ulushi karta orqali so'mda chiqib ketishi mumkin edi).
    const originalUsdBaseMinor = original.payments
      .filter((p) => p.method === TENDER.cashUsd)
      .reduce((a, p) => a + p.amountBaseMinor, 0n);
    // A2 — chekning AVANSDAN qoplangan ulushi. `originalDebtMinor` bilan
    // AYNI naqsh: to'lov qatorlaridan o'qiladi, qayta hisoblanmaydi.
    const originalPrepayMinor = original.payments
      .filter((p) => p.method === TENDER.prepay)
      .reduce((a, p) => a + p.amountMinor, 0n);
    const caps = computeRefundSettlementCaps({
      originalSumMinor: original.sumMinor,
      originalDebtMinor,
      originalPrepayMinor,
      priorPrepayReturnedMinor: priorTotals.prepayMinor,
      originalCashLikeMinor,
      originalCashUsdMinor,
      originalUsdBaseMinor,
      priorUsdReturnedMinor: priorTotals.usdMinor,
      priorRefundedSumMinor: priorTotals.sumMinor,
      priorMoneyReturnedMinor: priorTotals.moneyMinor,
      priorCashReturnedMinor: priorTotals.cashMinor,
      priorDebtReturnedMinor: priorTotals.debtMinor,
      refundSumMinor: refundPositions.totalMinor,
    });
    // Omitted → settle the credit share automatically (schema comment): the
    // POS sends nothing today, and «goods came back, debt stayed» is the very
    // bug being fixed. An explicit value is still capped.
    const debtReturn =
      parsed.debtReturnMinor === undefined ? caps.debtMaxMinor : BigInt(parsed.debtReturnMinor);
    // A2 — `debtReturnMinor` bilan AYNI qoida: berilmasa server o'zi to'liq
    // ulushni qaytaradi. POS bu maydonni yubormaydi, «tovar qaytdi-yu avans
    // sarflangan bo'lib qolaverdi» esa aynan tuzatilayotgan yo'qotish.
    const prepayReturn =
      parsed.prepayReturnMinor === undefined
        ? caps.prepayMaxMinor
        : BigInt(parsed.prepayReturnMinor);
    const settleError = validateRefundSettlement(
      caps,
      cashReturn,
      cardReturn,
      debtReturn,
      usdReturn,
      prepayReturn,
      // V3 — kassir kanalni o'zi tanlagan bo'lsa kanal cap'i o'tkaziladi
      // (jami cap emas). Qarang: `RefundRetailSaleSchema.channelOverride`.
      { channelOverride: parsed.channelOverride },
    );
    if (settleError) throw new BadRequestException(settleError);
    // Cap o'tdi, ya'ni chekda dollar HAQIQATAN olingan — lekin kursi
    // yozilmagan bo'lsa so'm ekvivalentini to'qib chiqarmaymiz.
    if (usdReturn > 0n && usdRateMinor == null) {
      throw new BadRequestException(
        `${original.name} — chekda dollar to'lovining kursi yozilmagan, dollar qaytarib bo'lmaydi. So'mda qaytaring.`,
      );
    }

    // The debtor is whoever the credit was booked against on post() — which is
    // why post() now persists that counterparty onto the receipt. Receipts sold
    // BEFORE that fix carry agentId = null (the POS only ever sent the customer
    // in the post payload), so the debtor is recovered from the SOLD_ON_CREDIT
    // audit event, written in the same transaction as the balance delta. Without
    // this every credit receipt already in the database would be unrefundable.
    const debtorId = debtReturn > 0n ? await this.resolveCreditDebtorId(accountId, original) : null;
    // A2 — avansni KIMGA qaytaramiz. Chek qatoridagi mijoz, u bo'sh bo'lsa
    // `PAID_FROM_PREPAY` hodisasidan (qarz yo'li bilan AYNI naqsh).
    const prepayPayerId =
      prepayReturn > 0n
        ? await this.resolveCreditDebtorId(accountId, original, CASHIER_EVENT.paidFromPrepay)
        : null;
    if (prepayReturn > 0n && !prepayPayerId) {
      throw new BadRequestException(
        `Chek avansdan to'langan, lekin mijoz biriktirilmagan — avansni qaytarib bo'lmaydi (${original.name}). Qaytarishni davom ettirish uchun prepayReturnMinor=0 yuboring.`,
      );
    }
    if (debtReturn > 0n && !debtorId) {
      throw new BadRequestException(
        `Chek qarzga sotilgan, lekin mijoz biriktirilmagan — qarzni qaytarib bo'lmaydi (${original.name}). Qaytarishni davom ettirish uchun debtReturnMinor=0 yuboring va qarzni qo'lda tuzating.`,
      );
    }

    const name = await this.nextRetailSaleName(accountId);

    // Original snapshot, keyed by product. First occurrence wins when a receipt
    // listed the same product on several lines — the refund is validated
    // against the aggregated quantity, so it has no single line to point back
    // at, and the frozen numbers are per-product anyway.
    const originalFrozen = new Map<
      string,
      { costMinor: bigint | null; basePriceMinor: bigint | null }
    >();
    for (const p of original.positions) {
      if (p.productId && !originalFrozen.has(p.productId)) {
        originalFrozen.set(p.productId, {
          costMinor: p.costMinor,
          basePriceMinor: p.basePriceMinor,
        });
      }
    }

    // H4 record-scope: the refund document is created by the acting user.
    const creatorGroupId = await resolveCreatorGroupId(this.prisma.client, accountId, userId);

    // SALES-05: the receipt only closes when the LAST sold unit is back. While
    // units are still out it stays 'posted' so the rest can be returned.
    const fullyRefunded = isFullyRefunded(
      original.positions.map((p) => ({ productId: p.productId, quantity: String(p.quantity) })),
      [
        ...priorLines,
        ...parsed.positions.map((p) => ({ productId: p.productId, quantity: p.quantity })),
      ],
    );

    // Q3 — «hozir» TRANZAKSIYADAN OLDIN bir marta olinadi (Q2 ning `postedAt`
    // qarori bilan bir xil sabab): bu bitta instant mirror chekning sanasi
    // ham, reyestr qatorining `closedAt` i ham bo'ladi. Ikki alohida
    // `new Date()` yarim tunda ikki xil kalendar kuni berib, chek sanasi bilan
    // qarz yozuvini bir-biriga zid qilib qo'yishi mumkin edi.
    const refundedAt = new Date();

    const refunded = await this.prisma.client.$transaction(async (tx) => {
      // Atomic state guard. The old guard was `state: 'posted' → 'refunded'`:
      // the flip itself served as the mutex, so a second concurrent refund got
      // count=0. A partial refund no longer flips the state, so the mutex moved
      // onto the receipt's optimistic-lock `version` — otherwise two concurrent
      // refunds would both read the same (stale) list of earlier refunds and
      // each pay out the full remaining value.
      const flipResult = await tx.retailSale.updateMany({
        where: { id: original.id, accountId, state: 'posted', version: original.version },
        data: { ...(fullyRefunded ? { state: 'refunded' } : {}), version: { increment: 1 } },
      });
      if (flipResult.count === 0) {
        throw new ConflictException(
          `RetailSale ${original.id} state changed; refund aborted (already refunded?)`,
        );
      }

      const refundSale = await tx.retailSale.create({
        data: {
          accountId,
          ownerId: userId,
          groupId: creatorGroupId,
          // F6: mirror JORIY smenaga — asl chek smenasi yopiq bo'lishi mumkin.
          sessionId: currentSession.id,
          name,
          agentId: original.agentId ?? null,
          moment: refundedAt,
          description: parsed.description ?? `Refund for ${original.name}`,
          state: 'posted',
          postedAt: refundedAt,
          sumMinor: refundPositions.totalMinor,
          cashAmountMinor: cashReturn,
          cardAmountMinor: cardReturn,
          // H12 — mirrorda ham AYNI shartnoma: `sumMinor − payedSumMinor` =
          // shu hujjat bo'yicha hali yopilmagan qism.
          //
          // Bu yerda `totalMinor` DEB YOZIB BO'LMAYDI: qaytarish hisob-kitobi
          // qisman bo'lishi mumkin — `validateRefundSettlement` faqat YUQORI
          // chegara qo'yadi (naqd+karta ≤ olingan pul, qarz-yechim ≤ olingan
          // qarz), pastdan tenglikni talab qilmaydi. Tovari qaytarilgan-u puli
          // hali berilmagan qaytarish qonuniy holat, va u «to'liq to'langan»
          // bo'lib yozilmasligi kerak.
          // Dollar ulushi ham «yopilgan» hisoblanadi: uning so'm ekvivalenti
          // (asl chekning MUZLATILGAN kursi bilan) qo'shiladi — aks holda
          // dollar qaytarilgan chek abadiy «to'liq yopilmagan» ko'rinardi.
          // A2: avansga qaytarilgan ulush ham «yopilgan» — mijozning puli
          // unga (balansiga) qaytdi. Qo'shilmasa avansdan to'langan chekning
          // vozvrati abadiy «to'liq yopilmagan» bo'lib ko'rinardi (dollar
          // ulushi bilan AYNI sabab).
          payedSumMinor: cashReturn + cardReturn + debtReturn + usdReturnBaseMinor + prepayReturn,
          // SALES-04: the credit share this return wrote off. Persisted (not
          // recomputed) because the cumulative caps of every LATER partial
          // refund are measured against it.
          debtReturnMinor: debtReturn,
          refundedFromId: original.id,
          positions: {
            create: refundPositions.rows.map((p, idx) => ({
              accountId,
              productId: p.productId,
              position: idx + 1,
              quantity: p.quantity,
              priceMinor: p.priceMinor,
              discount: p.discount,
              sumMinor: p.lineMinor,
              // Inherited, not re-read — see the select comment above.
              costMinor: originalFrozen.get(p.productId)?.costMinor ?? null,
              basePriceMinor: originalFrozen.get(p.productId)?.basePriceMinor ?? null,
            })),
          },
        },
      });

      // Dollar qaytarish qatori (2026-08-17). Smenaning DOLLAR hisobi
      // (`collectUsdCashInputs` → `returnsUsdMinor`) aynan mirror chekning
      // `CASH_USD` qatorini o'qiydi — bu qator bo'lmasa dollar hech qachon
      // yashiqdan «chiqmagan» bo'lib qolardi (bug'ning aynan o'zi).
      // So'm qatori ATAYLAB yozilmaydi: so'm oqimi `cashAmountMinor` ustuni +
      // pul daftari orqali yuradi va u allaqachon to'g'ri ishlaydi; ikkinchi
      // manba qo'shish Z-hisobotning to'lov-turlari kesimini ikkilantirardi.
      if (usdReturn > 0n && usdRateMinor != null) {
        await tx.retailSalePayment.create({
          data: {
            accountId,
            saleId: refundSale.id,
            method: TENDER.cashUsd,
            amountMinor: usdReturn,
            currency: 'USD',
            rateMinor: usdRateMinor,
            amountBaseMinor: usdReturnBaseMinor,
          },
        });
      }

      // A2 — AVANS qaytarish qatori. Dollar qatori bilan AYNI sabab:
      // KÜMÜLATIV cap (`priorPrepayReturnedMinor`) aynan shu qatorlardan
      // o'qiladi, ya'ni qator bo'lmasa chekni bo'lib-bo'lib qaytarish yo'li
      // bilan bitta avansni bir necha marta qaytarib olish mumkin bo'lardi.
      // Mirror chekda alohida USTUN ochilmadi — migratsiyasiz kengayadigan
      // yagona daftar `RetailSalePayment` (Q1/A1 dagi «yangi jadval EMAS»
      // qarori bilan bir intizom).
      if (prepayReturn > 0n) {
        await tx.retailSalePayment.create({
          data: {
            accountId,
            saleId: refundSale.id,
            method: TENDER.prepay,
            amountMinor: prepayReturn,
            // ⚠️ ASL chek kassasining valyutasi, JORIY smenaniki EMAS: avans
            // balansi o'sha valyutada yozilgan va pastdagi `applyDelta` ham
            // aynan o'shani ishlatadi. Ikkisi ajralsa qaytarish boshqa
            // valyutadagi balansga tushib, avans jimgina yo'qolardi.
            currency: original.session.cashDesk.currency,
            amountBaseMinor: prepayReturn,
          },
        });
      }

      // Kassa TZ §9 — qaytarish erkin (Q11), shuning uchun iz qoladi.
      // `docId` = OYNA chek: pul aynan o'sha hujjat orqali harakat qiladi;
      // asl chek payload ichida. F6: iz ham JORIY smena jurnaliga — qaytarish
      // amali shu smenada sodir bo'ldi, asl (ehtimol yopiq) smenada emas.
      await this.writeAuditEvents(tx, accountId, currentSession.id, userId, [
        planRefundAuditEvent(refundSale.id, {
          originalId: original.id,
          originalName: original.name,
          sumMinor: refundPositions.totalMinor,
          cashMinor: cashReturn,
          cardMinor: cardReturn,
          lines: refundPositions.rows.map((p) => ({
            productId: p.productId,
            quantity: String(p.quantity),
            priceMinor: p.priceMinor,
          })),
        }),
      ]);

      // Stock cascade — restore quantities back to session.storeId. Only
      // rows with productId trigger inflow; service-only positions are
      // skipped consistent with post().
      const refundStockRows = refundPositions.rows.filter(
        (p): p is typeof p & { productId: string } => Boolean(p.productId),
      );
      if (refundStockRows.length > 0) {
        // Re-fetch the refund sale's positions to learn their freshly-assigned
        // ids (needed for StockOperation.docPositionId provenance).
        const persistedPositions = await tx.retailSalePosition.findMany({
          where: { retailSaleId: refundSale.id, accountId },
          select: { id: true, productId: true, quantity: true, position: true },
          orderBy: { position: 'asc' },
        });
        // Faza 18a (STK-02): return EXACTLY the value the original outflow
        // booked — read back from the sale's own StockOperation rows, net of
        // earlier partial refunds (cumulative remainder → the refund series
        // is zero-sum against the original). Legacy sales (posted before the
        // fix) booked NULL on the way out, so their refunds book NULL too.
        const [originalPostOps, priorRefundOps] = await Promise.all([
          tx.stockOperation.findMany({
            where: { accountId, docType: 'retailsale', docId: original.id, reason: 'post' },
            select: { assortmentId: true, qtyDelta: true, costDeltaMinor: true },
          }),
          priorRefunds.length > 0
            ? tx.stockOperation.findMany({
                where: {
                  accountId,
                  docType: 'retailsale',
                  docId: { in: priorRefunds.map((r) => r.id) },
                  reason: 'unpost',
                },
                select: { assortmentId: true, qtyDelta: true, costDeltaMinor: true },
              })
            : Promise.resolve([]),
        ]);
        const costBasis = buildRefundCostBasis(
          originalPostOps.map((op) => ({ ...op, qtyDelta: String(op.qtyDelta) })),
          priorRefundOps.map((op) => ({ ...op, qtyDelta: String(op.qtyDelta) })),
        );
        const deltas: StockDelta[] = persistedPositions
          .filter((p): p is typeof p & { productId: string } => p.productId !== null)
          .map((p) => ({
            // F6 (2026-08-13): tovar JORIY smenaning do'koniga qaytadi —
            // kassir jismonan shu yerda. F6 (restrukturizatsiya, 2026-08-23):
            // kaskad yoqilganda esa STOK-KASKAD omboriga (sotuv ayirgan
            // ombor) — aks holda sotuv 07 dan ayirilib, qaytish boshqa
            // omborga tushar va 07 qoldig'i asta-sekin kamayib borardi.
            storeId: refundStoreId,
            assortmentKind: 'product',
            assortmentId: p.productId,
            qtyDelta: String(p.quantity), // positive — inflow back to stock
            costDeltaMinor: consumeRefundCost(costBasis, p.productId, String(p.quantity)),
            docType: 'retailsale',
            docId: refundSale.id,
            docPositionId: p.id,
            // 'unpost' = reversing a prior outflow. The ledger reason enum is
            // intentionally narrow; we reuse the same vocabulary other modules
            // (Demand/Supply) use for cancel/refund flows.
            reason: 'unpost',
          }));
        await this.stock.applyDeltas(tx, accountId, userId, deltas);
      }

      // Cash outflow: route through MoneyService for the ledger entry
      // (negative deltaMinor) + balance update with overdraft guard.
      if (cashReturn > 0n) {
        // F6: naqd qaytim JORIY smena kassasidan — pul jismonan shu yashiqdan
        // chiqadi; asl smena kassasi (boshqa yashiq bo'lsa) hisobiga yozish
        // uni sanoqda kamaytirib yuborardi.
        const refundDeltas: MoneyDelta[] = [
          {
            sourceKind: 'cash_desk',
            sourceId: currentSession.cashDeskId,
            deltaMinor: -cashReturn,
            currency: currentSession.cashDesk.currency,
            documentKind: 'retailsale',
            documentId: refundSale.id,
            description: `POS refund for ${original.name}`,
          },
        ];
        await this.money.applyDeltas(tx, accountId, refundDeltas);
      }

      // ── A2 — AVANSGA QAYTARISH ─────────────────────────────────────────
      //
      // Pul KASSADAN CHIQMAYDI: mijozning avansi tiklanadi (−700k → −1 000k).
      // `post()` dagi `+prepayAmount` ning AYNAN teskarisi.
      //
      // 🔴 QARZ BLOKIDAN OLDIN — qulf tartibi uchun. Qarz bloki avval
      // balansni (`applyDelta` upsert), so'ng `debts` qatorini
      // (`moveSaleDebtRegistryRow` → `FOR UPDATE`) qulflaydi. Agar avans
      // deltasi undan KEYIN tursa, biz QARZLAR → BALANS tartibida qulf
      // olgan bo'lardik va ikki parallel vozvrat bir-birini deadlock
      // qilardi. Tartib butun repoda BITTA: **BALANS → QARZLAR**.
      //
      // 🔴 Reyestrga TEGILMAYDI (invariant 4): avans qarz emas, undan
      // hech qachon `Debt` qatori tug'ilmagan — demak harakatlantiradigan
      // qator ham yo'q. Q3 ning bloki ataylab `if (debtReturn > 0n && …)`
      // ichida turibdi, ya'ni ikki yo'l tabiiy ajralgan.
      if (prepayReturn > 0n && prepayPayerId) {
        await this.counterpartyBalance.applyDelta(
          tx,
          accountId,
          prepayPayerId,
          original.session.cashDesk.currency,
          -prepayReturn,
          {
            docType: 'salePrepay',
            docId: refundSale.id,
            organizationId: original.organizationId,
            // `source` YO'Q — `post()` dagi bilan AYNI sabab: manfiy delta
            // «↩️ Qarzingizdan ayirildi» xabarini tanlardi, mijoz esa
            // qarzdor emas edi (u o'z avansini qaytarib oldi).
          },
        );
      }

      // SALES-04 — qarz hisobidan yopilgan ulush: pul kassadan chiqmaydi,
      // mijozning balansidagi qarz kamayadi. post() dagi +debtAmount ning
      // aynan teskarisi (musbat = mijoz qarzdor konventsiyasi), shu bilan
      // «tovar qaytdi, qarz qolaverdi» ikki tomonlama yo'qotish yopiladi.
      if (debtReturn > 0n && debtorId) {
        await this.counterpartyBalance.applyDelta(
          tx,
          accountId,
          debtorId,
          original.session.cashDesk.currency,
          -debtReturn,
          {
            docType: 'retailsale',
            docId: refundSale.id,
            organizationId: original.organizationId,
            // Delta MANFIY ⇒ mijozga «↩️ Qarzingizdan ayirildi» ketadi. Bu
            // ataylab: qaytarish jim qolsa, mijozdagi oxirgi xabar «qarzga
            // qo'shildi» bo'lib qolardi va raqami haqiqatdan uzilardi.
            source: 'retailsale',
          },
        );

        // 🔴 Q3 — REYESTR QATORI BALANS BILAN BIRGA HARAKATLANADI (invariant 2).
        //
        // Balans yuqorida `−debtReturn` oldi; qator joyida qolsa undirish
        // ro'yxati QAYTARILGAN tovar uchun pul talab qilib turardi va mijozga
        // eslatma ketardi. Delta AYNAN teng: chek qarz ulushining qoldig'i
        // `debtReturn` ga kamayadi (`oldRemaining → newRemaining`).
        //
        // Qulf tartibi BALANS → QARZLAR: yuqoridagi `applyDelta` balans
        // qatorini `upsert` bilan allaqachon qulflab bo'ldi.
        const debtRemainingBefore = originalDebtMinor - priorTotals.debtMinor;
        await this.moveSaleDebtRegistryRow(tx, accountId, userId, {
          saleId: original.id,
          saleName: original.name,
          currency: original.session.cashDesk.currency,
          now: refundedAt,
          reason: 'refund',
          mode: 'delta',
          oldRemainingMinor: debtRemainingBefore,
          newRemainingMinor: debtRemainingBefore - debtReturn,
        });
      }

      // SMENA CLAIM'i — post() dagi SALES-07 bilan bir naqsh, F6'dan keyin
      // JORIY smenada. Yuqoridagi `currentSession` tranzaksiyadan TASHQARIDA
      // o'qilgan (eskirgan) nusxa; o'sha o'qish bilan bu yer orasida `close()`
      // yugursa, qaytarish YOPILGAN smenaga tushardi: pul yashiqdan chiqadi,
      // `close()` esa uni sanamagan ⇒ smena naqdi hech qachon to'g'ri
      // chiqmaydi. Shart `close()` flip'i bilan AYNI ustunda (`state`) —
      // Postgres qator-qulfi ikkalasini ketma-ketlashtiradi, ikkinchi kelgan
      // `count = 0` oladi va BUTUN qaytarish (pul/ombor/balans kaskadi bilan)
      // orqaga qaytadi. Hisoblagichlar ham shu smenada — Z-hisobot (sessionId
      // agregatlari) mirror bilan bir joyda turadi.
      const sessionClaim = await tx.cashierSession.updateMany({
        where: { id: currentSession.id, accountId, state: 'open' },
        data: {
          returnsCount: { increment: 1 },
          returnsSumMinor: { increment: refundPositions.totalMinor },
        },
      });
      if (sessionClaim.count === 0) {
        throw new ConflictException(
          `Smena ${currentSession.id} yopilib qoldi; qaytarish rasmiylashtirilmadi. Yangi smena oching.`,
        );
      }

      return refundSale;
    });

    // §109: claw back the original sale's earned points AFTER the refund txn
    // commits. Reverses the recorded value (§105 — never recomputed), prorated
    // by the refunded share (SALES-05).
    await this.reverseLoyalty(accountId, userId, original.id, refunded.id, {
      refundSumMinor: refundPositions.totalMinor,
      originalSumMinor: original.sumMinor,
    });
    return refunded;
  }

  async zReport(accountId: string, rawSessionId: string) {
    // Controller query'ni xom holda uzatadi — noto'g'ri uuid ilgari Prisma
    // P2023 bilan 500 bo'lardi; endi ZodError → global filtr → 400.
    const { sessionId } = ZReportQuerySchema.parse({ sessionId: rawSessionId });
    const session = await this.prisma.client.cashierSession.findFirst({
      where: { id: sessionId, accountId },
      include: {
        cashier: { select: { id: true, name: true } },
        cashDesk: { select: { id: true, name: true, currency: true } },
        store: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
    if (!session) throw new NotFoundException(`CashierSession ${sessionId} not found`);

    const [salesAgg, returnsAgg] = await Promise.all([
      this.prisma.client.retailSale.aggregate({
        where: {
          accountId,
          sessionId,
          // Faza Q1 (SALES-06): `refunded` HAM sotuv. Faza 7 dan keyin to'liq
          // qaytarilgan chek `refunded` bo'lib qoladi — u faqat `posted` bilan
          // qidirilsa sotuvlar jamidan TUSHIB qolar, oyna cheki esa quyidagi
          // `returnsAgg` da baribir ayirilardi ⇒ netSum bir qaytarishni IKKI
          // marta hisobga olib manfiy chiqardi (kassir «bugun zarar» ko'rardi).
          state: { in: ['posted', 'refunded'] },
          refundedFromId: null,
        },
        _sum: {
          sumMinor: true,
          cashAmountMinor: true,
          cardAmountMinor: true,
          // `cashAmountMinor` — mijoz BERGAN naqd; yashiqqa `cash − change`
          // tushadi (money-ledger ham shuni yozadi). Qaytim so'ralmasa
          // quyidagi ayirma uchun manba yo'q.
          changeMinor: true,
        },
        _count: { id: true },
      }),
      this.prisma.client.retailSale.aggregate({
        where: {
          accountId,
          sessionId,
          state: 'posted',
          refundedFromId: { not: null },
        },
        _sum: {
          sumMinor: true,
          cashAmountMinor: true,
          cardAmountMinor: true,
        },
        _count: { id: true },
      }),
    ]);

    return {
      session: {
        id: session.id,
        state: session.state,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        cashier: session.cashier,
        cashDesk: session.cashDesk,
        store: session.store,
        organization: session.organization,
        openingCashMinor: session.openingCashMinor.toString(),
        closingCashMinor: session.closingCashMinor?.toString() ?? null,
        expectedCashMinor: session.expectedCashMinor?.toString() ?? null,
        discrepancyMinor: session.discrepancyMinor?.toString() ?? null,
      },
      salesCount: salesAgg._count.id,
      salesSumMinor: (salesAgg._sum.sumMinor ?? 0n).toString(),
      // Yashiqdagi HAQIQIY naqd: berilgan naqd MINUS qaytim (to'g'ri formula
      // `cashier-session.service.ts` dagi bilan bir xil). Qaytim ayirilmasa
      // Z-hisobot naqdi har qaytim summasicha ko'p ko'rinardi.
      cashSalesMinor: (
        (salesAgg._sum.cashAmountMinor ?? 0n) - (salesAgg._sum.changeMinor ?? 0n)
      ).toString(),
      cardSalesMinor: (salesAgg._sum.cardAmountMinor ?? 0n).toString(),
      returnsCount: returnsAgg._count.id,
      returnsSumMinor: (returnsAgg._sum.sumMinor ?? 0n).toString(),
      cashReturnsMinor: (returnsAgg._sum.cashAmountMinor ?? 0n).toString(),
      cardReturnsMinor: (returnsAgg._sum.cardAmountMinor ?? 0n).toString(),
      netSumMinor: ((salesAgg._sum.sumMinor ?? 0n) - (returnsAgg._sum.sumMinor ?? 0n)).toString(),
    };
  }

  // ---- Private helpers ----

  // Pure compute-positions logic lives in `./compute-positions.ts` so the
  // BigInt-precision invariants are unit-testable without mocking Prisma.
  private computePositions = computePositions;

  /**
   * Q2 — kontragentning QARZ-valyutasidagi balans qatorini QULFLAB o'qiydi.
   *
   * 🔴 `null` = qator YO'Q (**o'lchanmagan**), «0» EMAS. Balans qatori faqat
   * birinchi `applyDelta` da tug'iladi, ya'ni undan oldingi qarzlari bo'lgan
   * mijozda qator umuman bo'lmasligi mumkin. Farq §2.2 kesishuv qoidasida
   * qaror o'zgartiradi (`null` ⇒ to'liq summaga qator + `DebtNote` da qayd).
   *
   * NEGA raw SQL: Prisma'da qator-qulfi yo'q, `findFirst` esa snapshot beradi.
   * Naqsh AYNAN `pos-debt-payment.service.ts#lockBalance` niki — ikki yo'l bir
   * xil qulfni bir xil tartibda oladi, shuning uchun deadlock qilmaydi.
   *
   * Qator yo'q bo'lsa qulf ham yo'q (`FOR UPDATE` hech nimani ushlamaydi) —
   * bu qabul qilingan chegara: u holda ikki parallel chek ham to'liq qator
   * ochadi, ya'ni qarz KO'RINADI (xato tomoni ehtiyotkor).
   */
  private async lockCounterpartyBalance(
    tx: Prisma.TransactionClient,
    accountId: string,
    counterpartyId: string,
    currency: string,
  ): Promise<bigint | null> {
    const rows = await tx.$queryRaw<Array<{ balance_minor: bigint }>>`
      SELECT balance_minor
      FROM counterparty_balances
      WHERE account_id = ${accountId}::uuid
        AND counterparty_id = ${counterpartyId}::uuid
        AND currency = ${currency}
      FOR UPDATE
    `;
    const row = rows[0];
    return row === undefined ? null : BigInt(row.balance_minor);
  }

  /**
   * Q4 — kassa qarzi muddati (kun) akkaunt sozlamasidan.
   *
   * Sozlama yozilmagan bo'lsa (`CompanySettings` qatori YO'Q yoki ustun
   * `null`) — Q1 ning kod-defaulti (14 kun), ya'ni Q2/Q3 xulqi bir tiyin ham
   * o'zgarmaydi. Chiqarish qoidasi sof modulda
   * (`sale-debt-registry.ts#resolveSaleDebtTermDays`), bu yerda faqat I/O.
   *
   * ⚠️ **QULF OLINMAYDI va olinmasligi kerak.** Bu — sozlama, pul emas:
   * u yerdagi qiymat qarz summasini ham, balansni ham belgilamaydi, faqat
   * yangi qatorning `nextContactAt` sanasini beradi. Qulf olinsa u
   * BALANS → QARZLAR tartibiga uchinchi ishtirokchi qo'shardi (deadlock
   * yuzasi), foydasi esa nol (A1 hisobotidagi «chekinish 1» bilan bir xil
   * dalil).
   *
   * ⚠️ Yaroqsiz qiymat (faqat qo'lda SQL bilan yozilishi mumkin — yozuv
   * yo'li `UpdateCompanySettingsSchema` bilan yopilgan) JIM o'tmaydi:
   * default olinadi va ogohlantirish logi yoziladi. Chekni 500 bilan
   * yiqitish — kassani to'xtatish demakdir.
   */
  private async readSaleDebtTermDays(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<number> {
    const settings = await tx.companySettings.findUnique({
      where: { accountId },
      select: { saleDebtTermDays: true },
    });
    const raw = settings?.saleDebtTermDays ?? null;
    if (isSaleDebtTermDaysCorrupt(raw)) {
      this.logger.warn(
        `[Q4] company_settings.sale_debt_term_days = ${raw} — YAROQSIZ qiymat ` +
          `(butun, ${SALE_DEBT_TERM_DAYS_MIN}…${SALE_DEBT_TERM_DAYS_MAX} oralig'ida bo'lishi ` +
          `kerak). Default ${DEFAULT_SALE_DEBT_TERM_DAYS} kun olindi.`,
      );
    }
    return resolveSaleDebtTermDays(raw);
  }

  /**
   * Q2 — POS chekidan tug'ilgan `Debt` reyestr qatorini yozadi.
   *
   * Chaqiruvchi `post()` ning qarz bloki, balans deltasidan KEYIN, AYNAN o'sha
   * tranzaksiyada. Qoidalarning HAMMASI Q1 ning sof modulida
   * (`debt/sale-debt-registry.ts`) — bu yerda faqat I/O.
   *
   * INVARIANTLAR (reja §3):
   *  1. `applyDelta` bu yerdan CHAQIRILMAYDI — `balanceAdopted: true` (qarz
   *     balansda allaqachon bor; qo'shsak ikki karra sanalardi);
   *  4. `planSaleDebtRow` `null` qaytarsa qator UMUMAN OCHILMAYDI — mijozning
   *     AVANSI chek qarzini to'liq qopladi, ya'ni qarz TUG'ILMAGAN. Bunday
   *     mijoz undirish ro'yxatiga tushmaydi va unga eslatma ketmaydi;
   *  3. IDEMPOTENTLIK — `@@unique(accountId, sourceDocType, sourceDocId)`.
   *
   * ⚠️ NEGA `create` EMAS, `createMany({ skipDuplicates })`: unique konflikt
   * `create` da `P2002` bo'lib chiqadi va uni TUTIB davom etib bo'lmaydi —
   * Postgres tranzaksiyani ABORT holatiga o'tkazadi, ya'ni chekning qolgan
   * yozuvlari («zakaz to'lovi», yakuniy `findUniqueOrThrow`) `25P02` bilan
   * yiqilardi va MUVAFFAQIYATLI chek 500 bo'lardi. `skipDuplicates` esa
   * `ON CONFLICT DO NOTHING` — xato ham, abort ham yo'q.
   */
  private async writeSaleDebtRegistryRow(
    tx: Prisma.TransactionClient,
    accountId: string,
    userId: string,
    input: {
      saleId: string;
      saleName: string;
      counterpartyId: string;
      debtAmountMinor: bigint;
      /** `applyDelta` DAN OLDIN, `FOR UPDATE` bilan o'qilgan. `null` = o'lchanmagan. */
      balanceBeforeMinor: bigint | null;
      postedAt: Date;
    },
  ): Promise<void> {
    // Q4 — muddat akkaunt sozlamasidan (sozlanmagan bo'lsa 14 kun).
    const termDays = await this.readSaleDebtTermDays(tx, accountId);
    const plan = planSaleDebtRow(
      {
        saleName: input.saleName,
        debtAmountMinor: input.debtAmountMinor,
        balanceBeforeMinor: input.balanceBeforeMinor,
        termDays,
      },
      input.postedAt,
    );
    if (!plan) {
      // Invariant 4 — AVANS qarz emas. Bu normal xulq, xato emas; lekin jim
      // ham qolmaydi: «nega bu chek undirish ro'yxatida yo'q?» savoliga javob.
      this.logger.log(
        `[Q2] ${input.saleName}: chek qarzi (${input.debtAmountMinor}) mijozning AVANSIDAN ` +
          'to`liq qoplandi — undirish reyestriga qator OCHILMADI (invariant 4).',
      );
      return;
    }

    // Idempotentlik, 1-qatlam: mavjud qatorni oldindan topsak hujjat raqamini
    // ham behuda sarflamaymiz (`QRZ-` ketma-ketligida teshik qolmaydi).
    const existing = await tx.debt.findFirst({
      where: {
        accountId,
        sourceDocType: SALE_DEBT_SOURCE_DOC_TYPE,
        sourceDocId: input.saleId,
      },
      select: { id: true, name: true },
    });
    if (existing) {
      this.logger.warn(
        `[Q2] ${input.saleName}: reyestr qatori allaqachon bor (${existing.name}) — ` +
          'ikkinchisi ochilmadi (idempotentlik).',
      );
      return;
    }

    // Raqam `document_sequences` orqali — race-safe (`adoptBalanceDebt` naqshi).
    const year = input.postedAt.getFullYear();
    const prefix = `QRZ-${year}-`;
    const seq = await allocateDocumentNumber(tx, accountId, prefix, async () => {
      const last = await tx.debt.findFirst({
        where: { accountId, name: { startsWith: prefix } },
        orderBy: { name: 'desc' },
        select: { name: true },
      });
      return last ? Number.parseInt(last.name.slice(prefix.length), 10) || 0 : 0;
    });

    // Idempotentlik, 2-qatlam: `ON CONFLICT DO NOTHING` (yuqoridagi izoh).
    const created = await tx.debt.createMany({
      data: [
        {
          accountId,
          counterpartyId: input.counterpartyId,
          name: `${prefix}${String(seq).padStart(5, '0')}`,
          totalMinor: plan.totalMinor,
          paidMinor: 0n,
          currency: DEBT_LEDGER_CURRENCY,
          status: 'unpaid',
          // 🔴 Invariant 1 — balansga QAYTA yozilmaydi.
          balanceAdopted: plan.balanceAdopted,
          // 🔴 NULL EMAS — muddatsiz qator undirish ro'yxatida `no_due_date`
          // chelagida qolib, eslatma cron'i uni umuman ko'rmasdi.
          nextContactAt: plan.nextContactAt,
          sourceDocType: SALE_DEBT_SOURCE_DOC_TYPE,
          sourceDocId: input.saleId,
          // Chekni post qilgan KASSIR — §3.9 kunlik kassir hisoboti shundan.
          ownerId: userId,
          issuedById: userId,
          comment: plan.comment,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) {
      this.logger.warn(
        `[Q2] ${input.saleName}: reyestr qatori poygada allaqachon ochilgan — ikkinchisi yozilmadi.`,
      );
      return;
    }

    // `createMany` id qaytarmaydi — izoh uchun qatorni MANBA bo'yicha o'qiymiz.
    const debt = await tx.debt.findFirstOrThrow({
      where: {
        accountId,
        sourceDocType: SALE_DEBT_SOURCE_DOC_TYPE,
        sourceDocId: input.saleId,
      },
      select: { id: true },
    });
    await tx.debtNote.create({
      data: {
        accountId,
        debtId: debt.id,
        // AYNAN `plan.noteText` — avans qoplagan qism va «balans o'lchanmagan»
        // qaydi allaqachon uning ichida (Q1 sof moduli). Bu yerda qayta matn
        // yozilsa ikki manba ikki xil gapirardi.
        text: plan.noteText,
        authorId: userId,
        authorRole: 'cashier',
        kind: 'debt_issue',
      },
    });
  }

  /**
   * Q3 — chekdan tug'ilgan reyestr qatorini BALANS BILAN SIMMETRIK
   * harakatlantirish (`refund()` / `edit()`), invariant 2.
   *
   * MUAMMO: Q2 dan keyin qarzga sotilgan chek `Debt` reyestriga qator ochadi.
   * Tovar qaytarilsa balansdan `−debtReturn` yoziladi, lekin qator joyida
   * qolsa undirish ro'yxati QAYTARILGAN tovar uchun pul talab qilib turardi
   * (va mijozga eslatma ketardi). Ya'ni ikki daftar bir-biridan uzilardi.
   *
   * 🔴 BU YERDAN `applyDelta` CHAQIRILMAYDI. Qator `balanceAdopted = true` —
   * balansni chekning O'Z yo'li (`refund()` dagi `−debtReturn`,
   * `edit()` dagi delta) harakatlantiradi. Ikkalasi ham yozsa qarz IKKI
   * MARTA kamayardi. Bu Q2 yozuvchisining aynan ko'zgusi va kod-shakl testi
   * bilan qulflangan.
   *
   * ⚠️ QULF TARTIBI **BALANS → QARZLAR** (P1/Q2 bilan bir xil): chaqiruvchi
   * avval `applyDelta` (u balans qatorini `upsert` bilan qulflaydi), keyin
   * bu metod `debts … FOR UPDATE` oladi. Teskari tartibda POS FIFO to'lovi
   * bilan deadlock bo'lardi.
   *
   * ⚠️ Qator TOPILMASA (Q2 dan OLDIN post qilingan eski chek, yoki avans
   * qoplagani uchun umuman ochilmagan chek) — bu XATO EMAS: balans baribir
   * o'z deltasini oladi, mavjud xulq buzilmaydi. Lekin JIM ham qolmaydi:
   * ogohlantirish logi + chaqiruvchiga qaytadigan natija (`missing`).
   */
  private async moveSaleDebtRegistryRow(
    tx: Prisma.TransactionClient,
    accountId: string,
    userId: string,
    input: {
      saleId: string;
      saleName: string;
      /** Balans yozilgan valyuta — reyestr faqat `DEBT_LEDGER_CURRENCY` da. */
      currency: string;
      /** «Hozir» — muddat va yopilish sanasi uchun (sof modul argumenti). */
      now: Date;
      reason: 'refund' | 'edit';
    } & (
      | {
          /** NISBIY harakat: chek qarz ulushining eski va yangi qoldig'i. */
          mode: 'delta';
          oldRemainingMinor: bigint;
          newRemainingMinor: bigint;
        }
      | {
          /** MUTLAQ summa: tahrirdan keyingi qator qiymati (§2.2 qo'llangan). */
          mode: 'absolute';
          totalMinor: bigint;
          /**
           * Qator SHU mijozga ko'chirilsin (`edit()` da mijoz almashganda).
           * `undefined` ⇒ mijoz o'zgarmagan.
           */
          retargetToId?: string | null;
        }
    ),
  ): Promise<'skipped_currency' | 'missing' | 'noop' | 'moved' | 'retarget_blocked'> {
    // §2.3 chegarasi — USD yashiq chekida Q2 qator OCHMAGAN, demak
    // harakatlantiradigan narsa ham yo'q (bu kutilgan holat, xato emas).
    if (input.currency !== DEBT_LEDGER_CURRENCY) return 'skipped_currency';

    // Qatorni QULFLAB olamiz: POS FIFO to'lovi (`pos-debt-payment`) shu
    // tranzaksiya bilan poyga qilsa `paidMinor` oramizda o'zgarib ketardi va
    // «to'langandan pastga tushmasin» chegarasi eskirgan songa qo'llanardi.
    // `ORDER BY id` — barqaror qulflash tartibi (`lockOpenDebts` odati).
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM debts
      WHERE account_id = ${accountId}::uuid
        AND source_doc_type = ${SALE_DEBT_SOURCE_DOC_TYPE}
        AND source_doc_id = ${input.saleId}::uuid
        AND deleted_at IS NULL
      ORDER BY id ASC
      FOR UPDATE
    `;
    const lockedId = locked[0]?.id;
    if (lockedId === undefined) {
      this.logger.warn(
        `[Q3] ${input.saleName}: chekdan tug\`ilgan reyestr qatori TOPILMADI ` +
          `(${input.reason}) — balans o\`z deltasini oldi, reyestrda harakat yo\`q. ` +
          'Sabab: chek Q2 dan OLDIN post qilingan yoki qarzni AVANS qoplagan.',
      );
      return 'missing';
    }

    const row = await tx.debt.findFirstOrThrow({
      where: { id: lockedId, accountId },
      select: {
        id: true,
        name: true,
        totalMinor: true,
        paidMinor: true,
        status: true,
        counterpartyId: true,
        nextContactAt: true,
      },
    });

    // Mijoz almashishi — FAQAT `absolute` rejimida (tahrir).
    const retargetToId = input.mode === 'absolute' ? input.retargetToId : undefined;
    const wantsRetarget =
      retargetToId !== undefined && (retargetToId ?? null) !== row.counterpartyId;
    // 🔴 To'lov tushgan qatorni KO'CHIRIB bo'lmaydi: `DebtPayment` qatorlari
    // ESKI mijozning pulini bildiradi va ular qator bilan birga ko'chardi —
    // ya'ni bir mijozning to'lovi boshqasining tarixiga yozilardi. Bunday
    // qator eski mijozda YOPILADI, yangi mijozning qarzi esa balansda
    // ko'rinadi va u kassaga to'lov qilganda P1 adopsiyasi orqali reyestrga
    // kiradi (mavjud, jonlida sinalgan yo'l).
    const retargetBlocked = wantsRetarget && row.paidMinor > 0n;

    const plan = planSaleDebtDelta({
      totalMinor: row.totalMinor,
      paidMinor: row.paidMinor,
      oldRemainingMinor: input.mode === 'delta' ? input.oldRemainingMinor : row.totalMinor,
      newRemainingMinor:
        input.mode === 'delta'
          ? input.newRemainingMinor
          : retargetBlocked
            ? 0n // eski mijozda yopiladi (yuqoridagi izoh)
            : input.totalMinor,
    });

    const movesCounterparty = wantsRetarget && !retargetBlocked;
    if (plan.deltaMinor === 0n && plan.status === row.status && !movesCounterparty) {
      return 'noop';
    }

    // ⚠️ ESKI QIYMATLAR `update` DAN OLDIN OLINADI. Prisma `findFirstOrThrow`
    // yangi obyekt qaytaradi, lekin bunga TAYANMAYMIZ: izoh matni «qatorning
    // OLDINGI holati» haqida gapiradi va yozuv tartibi o'zgarsa u jimgina
    // yangi holatni aytib qo'yardi (testda aynan shu tutildi).
    const previousTotalMinor = row.totalMinor;
    const previousCounterpartyId = row.counterpartyId;

    // Qayta OCHILGAN qator muddatsiz qolmasin (Q1 ning 2-shartnomasi:
    // muddatsiz qator undirish ro'yxatida `no_due_date` chelagida qolib,
    // eslatma cron'i uni umuman ko'rmasdi).
    const reopened = !plan.closed && row.nextContactAt === null;
    // Q4 — qayta ochilgan qatorning muddati ham AKKAUNT SOZLAMASIDAN
    // (Q2 yozuvchisi bilan bitta manba). Sozlama faqat shu tarmoqda kerak,
    // shuning uchun o'qish ham faqat shu yerda — har vozvratda emas.
    const reopenTermDays = reopened ? await this.readSaleDebtTermDays(tx, accountId) : undefined;
    await tx.debt.update({
      where: { id: row.id },
      data: {
        totalMinor: plan.nextTotalMinor,
        status: plan.status,
        // §3.6 — `debt-recalc.ts` bilan AYNAN bir xil odat.
        closedAt: plan.closed ? input.now : null,
        ...(plan.closed
          ? { nextContactAt: null }
          : reopened
            ? { nextContactAt: saleDebtDueAt(input.now, reopenTermDays) }
            : {}),
        ...(movesCounterparty && retargetToId ? { counterpartyId: retargetToId } : {}),
      },
    });

    await tx.debtNote.create({
      data: {
        accountId,
        debtId: row.id,
        // AYNAN sof modulning matni — Q2 ning `plan.noteText` odati.
        text: saleDebtMoveNoteText({
          saleName: input.saleName,
          reason: input.reason,
          previousTotalMinor,
          plan,
          retargetedFromId: wantsRetarget ? previousCounterpartyId : undefined,
          retargetBlocked,
        }),
        authorId: userId,
        authorRole: 'cashier',
        kind: 'debt_issue',
      },
    });

    if (retargetBlocked) {
      this.logger.warn(
        `[Q3] ${input.saleName}: chek mijozi almashtirildi, lekin reyestr qatori ` +
          `${row.name} da to\`lov bor — qator KO\`CHIRILMADI, eski mijozda yopildi.`,
      );
      return 'retarget_blocked';
    }
    return 'moved';
  }

  /**
   * F6 — kassaning STOK kaskadi (Q1). Prioriteti (`attributes.__posPriority`)
   * qo'yilgan omborlar, kichik raqam birinchi ("Ombor 07" = 1 bo'ladi).
   * BO'SH ro'yxat = kaskad sozlanmagan — kassa eski yo'l bilan (smena ombori)
   * ishlaydi, ya'ni sozlamasiz o'rnatmalarda xulq BAYT-BABAYT o'zgarmaydi.
   * Do'kon soni kichik (7–10) — to'liq o'qib JS'da saralash arzon.
   */
  private async resolveStockCascade(accountId: string): Promise<CascadeStore[]> {
    const stores = await this.prisma.client.store.findMany({
      where: { accountId, archived: false },
      select: { id: true, name: true, allowNegativeStock: true, attributes: true },
    });
    return orderCascadeStores(stores);
  }

  /**
   * G4 — taqsimot uchun omborlar (kaskad + BRAK/07 belgilari).
   * `resolveStockCascade` bilan BIR so'rov shaklida, lekin sof dvigatel
   * kutgan ko'rinishda: prioritet + `__posFrontStore` + `__brakStore`.
   */
  private async resolveAllocationStores(accountId: string): Promise<AllocStore[]> {
    const stores = await this.prisma.client.store.findMany({
      where: { accountId, archived: false },
      select: { id: true, name: true, attributes: true },
    });
    return stores.map((st) => ({
      id: st.id,
      name: st.name,
      posPriority: readPosPriority(st.attributes),
      isPosFront: readPosFrontStore(st.attributes),
      isBrak: readBrakStore(st.attributes),
    }));
  }

  /**
   * G4 — chek pozitsiyalarini omborlar/yacheykalar bo'yicha taqsimlaydi.
   *
   * TRANZAKSIYA ICHIDA, balanslar QULFLANGANDAN keyin chaqiriladi: aks holda
   * reja eskirgan raqamlarga qurilib, ikki kassir bir yacheykani ikki marta
   * sotib yuborardi. `available` = qulflangan `qty − reservedQty`.
   */
  private async planAllocations(
    tx: Prisma.TransactionClient,
    accountId: string,
    allocStores: readonly AllocStore[],
    positions: ReadonlyArray<{ id: string; productId: string; quantity: unknown }>,
    balancesByStore: ReadonlyMap<string, Map<string, StockBalance>>,
    fallbackStoreId: string,
    /** K3 (7.1) — bo'linadigan tovarlar; bo'sh to'plam = eski xulq. */
    pieceTracked: ReadonlySet<string> = new Set(),
  ) {
    const productIds = [...new Set(positions.map((p) => p.productId))];
    const storeIds = allocStores.map((st) => st.id);
    const cellRows =
      storeIds.length === 0 || productIds.length === 0
        ? []
        : await tx.stockByCell.findMany({
            where: {
              accountId,
              storeId: { in: storeIds },
              assortmentKind: 'product',
              assortmentId: { in: productIds },
              qty: { gt: 0 },
            },
            select: {
              storeId: true,
              cellId: true,
              assortmentId: true,
              qty: true,
              // `vitrina` — taqsimotda oxirgi chora (retail-allocation VITRINA izohi).
              cell: { select: { name: true, vitrina: true } },
            },
          });

    const cellsByProduct = new Map<
      string,
      Array<{ storeId: string; cellId: string; cellName: string; qty: string; vitrina: boolean }>
    >();
    for (const r of cellRows) {
      const list = cellsByProduct.get(r.assortmentId) ?? [];
      list.push({
        storeId: r.storeId,
        cellId: r.cellId,
        cellName: r.cell?.name ?? '',
        qty: r.qty.toString(),
        vitrina: r.cell?.vitrina === true,
      });
      cellsByProduct.set(r.assortmentId, list);
    }

    const availableByProduct = new Map<string, Array<{ storeId: string; available: string }>>();
    for (const productId of productIds) {
      const rows: Array<{ storeId: string; available: string }> = [];
      for (const st of allocStores) {
        const bal = balancesByStore.get(st.id)?.get(productId);
        if (!bal) continue;
        const avail = parseDecimalScaled(bal.qty) - parseDecimalScaled(bal.reservedQty ?? '0');
        if (avail > 0n) rows.push({ storeId: st.id, available: formatDecimalScaled(avail) });
      }
      availableByProduct.set(productId, rows);
    }

    const plan = allocateForSale({
      requests: positions.map((p) => ({
        assortmentId: p.productId,
        requested: String(p.quantity),
      })),
      stores: allocStores,
      cellsByProduct,
      availableByProduct,
      fallbackStoreId,
      pieceTracked,
    });

    return {
      plan,
      perPosition: spreadAllocationsToPositions(
        plan.allocations,
        positions.map((p) => ({
          id: p.id,
          assortmentId: p.productId,
          quantity: String(p.quantity),
        })),
      ),
    };
  }

  /**
   * ❌ F6 ning `assertAvailableCascade` metodi 2026-08-25 da OLIB TASHLANDI.
   *
   * U yetmagan miqdorni 400 xato ichida qaytarib, «bosh omborchi tasdig'i
   * kerak» der edi (Q1 aniqlashtiruvi). Egasi bu qoidani 2026-08-24 da BEKOR
   * QILDI («omborchi ruxsati degan narsa yo'q») — aynan o'sha to'siq 06:46 da
   * kassani to'xtatib qo'ygan edi. O'rniga `planAllocations` reja QURADI va
   * `post()`/`sendToPicking` uni BAJARADI; yetarlilik ajratmaning o'zi bilan
   * kafolatlanadi (ajratma qulflangan `qty − rezerv` dan oshmaydi).
   *
   * Sof modul `retail-stock-cascade.ts` (F6) o'z o'rnida qoladi: undan
   * `orderCascadeStores`/`readPosPriority` hamon ishlatiladi. Faqat
   * `allocateAcrossStores` ning ishlab turgan chaqiruvchisi qolmadi — uni
   * o'chirish alohida tozalash ishi (G4 to'liq o'tirgach).
   */

  /**
   * Kassa TZ §5.3 + §9 — read each product's three prices off the card:
   * cost and the retail tier (frozen onto the line by `post()`), plus the
   * wholesale floor (not frozen — it only decides whether an audit event is
   * raised; see `resolveWholesaleMinor`).
   *
   * Read on the SERVER, never taken from the request: the POS reporting its own
   * «this was below cost» flag would let the audited party write their own audit
   * trail (kassa TZ §9).
   *
   * Products that no longer exist, and service-only lines (`productId === null`),
   * simply get no entry: the caller writes NULL, which the reports read as
   * «tan narx yig'ilmagan». A missing card must never post as zero cost.
   */
  private async loadFrozenPrices(
    accountId: string,
    productIds: ReadonlyArray<string | null>,
  ): Promise<Map<string, FrozenPrices & { wholesaleMinor: bigint | null }>> {
    const ids = [...new Set(productIds.filter((p): p is string => p !== null))];
    if (ids.length === 0) return new Map();
    const [products, priceTypes] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { accountId, id: { in: ids } },
        select: { id: true, name: true, buyPrice: true, salePrices: true },
      }),
      // Wholesale = the first non-default tier by position, matching what the
      // POS screen shows as «Min» (`usePriceTypeIds` in the web sale-price lib).
      // Both ends must agree, or the cashier is warned about one floor while
      // the audit log records another.
      this.prisma.client.priceType.findMany({
        where: { accountId, archived: false },
        orderBy: { position: 'asc' },
        select: { id: true, isDefault: true },
      }),
    ]);
    const defaultTypeId = priceTypes.find((t) => t.isDefault)?.id ?? priceTypes[0]?.id ?? null;
    const wholesaleTypeId = priceTypes.find((t) => t.id !== defaultTypeId)?.id ?? null;

    const frozen = snapshotPricesByProduct(
      products.map((p) => ({
        id: p.id,
        buyPrice: p.buyPrice,
        salePrices: p.salePrices as SalePricesJson,
      })),
      defaultTypeId,
    );
    return new Map(
      products.map((p) => [
        p.id,
        {
          ...(frozen.get(p.id) ?? { costMinor: null, basePriceMinor: null }),
          wholesaleMinor: resolveWholesaleMinor(p.salePrices as SalePricesJson, wholesaleTypeId),
        },
      ]),
    );
  }

  /**
   * Kassa TZ §9 — append cashier audit events.
   *
   * Runs INSIDE the caller's transaction, deliberately. The alternative (fire
   * and forget after commit, the way loyalty accrual works) would allow a
   * posted receipt with no trace, and «a sale nobody can see» is precisely the
   * failure this table exists to prevent. The cost of the choice is that a
   * failed insert rolls the sale back — acceptable, because these are plain
   * inserts with no constraints beyond the FKs, so the only realistic failure
   * is a database that could not have committed the sale either.
   */
  private async writeAuditEvents(
    tx: Prisma.TransactionClient,
    accountId: string,
    sessionId: string,
    employeeId: string,
    events: ReadonlyArray<CashierAuditEventInput>,
  ): Promise<void> {
    if (events.length === 0) return;
    await tx.cashierAuditEvent.createMany({
      data: events.map((e) => ({
        accountId,
        sessionId,
        employeeId,
        type: e.type,
        docId: e.docId,
        payload: e.payload as Prisma.InputJsonValue,
      })),
    });
  }

  /**
   * Write the snapshot onto the receipt's lines. Grouped by product id so a
   * receipt listing the same product twice still issues one statement per
   * distinct product. Lines whose product resolved to nothing are left NULL.
   */
  private async freezePositionPrices(
    tx: Prisma.TransactionClient,
    accountId: string,
    retailSaleId: string,
    positions: ReadonlyArray<{ productId: string | null }>,
    frozen: Map<string, FrozenPrices>,
  ): Promise<void> {
    const productIds = [...new Set(positions.map((p) => p.productId))].filter(
      (p): p is string => p !== null,
    );
    for (const productId of productIds) {
      const snap = frozen.get(productId);
      if (!snap || (snap.costMinor == null && snap.basePriceMinor == null)) continue;
      await tx.retailSalePosition.updateMany({
        where: { retailSaleId, accountId, productId },
        data: { costMinor: snap.costMinor, basePriceMinor: snap.basePriceMinor },
      });
    }
  }

  private async nextRetailSaleName(accountId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `ТРН-${year}-`;
    const n = await allocateDocumentNumber(this.prisma.client, accountId, prefix, async () => {
      const last = await this.prisma.client.retailSale.findFirst({
        where: { accountId, name: { startsWith: prefix } },
        orderBy: { name: 'desc' },
        select: { name: true },
      });
      return last ? Number.parseInt(last.name.slice(prefix.length), 10) || 0 : 0;
    });
    return `${prefix}${String(n).padStart(5, '0')}`;
  }

  private handlePrisma(e: unknown): never {
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code: string }).code === 'P2002'
    ) {
      throw new ConflictException('Duplicate name or unique constraint violation');
    }
    throw e;
  }

  /**
   * `draft → picking` — chek omborchiga yig'ishga ketadi.
   *
   * 🔴 P3 (2026-08-12, §1.H — H5) — BU YERDA TOVAR REZERV QILINADI.
   *
   * Ilgari bu metod FAQAT holat flipi edi (+ topshiriq yaratish): yig'ilayotgan
   * chek ombor qoldig'iga umuman tegmasdi. Oqibati o'lchangan bo'shliq —
   * ikkinchi kassa oxirgi donani sotib yuborishi mumkin edi. Minus qoldiq
   * CHIQMASDI (`post()` da `assertAvailable` bor), lekin xato eng yomon
   * joyga — MIJOZ OLDIDA, tovar allaqachon yig'ilgandan keyingi TO'LOV
   * lahzasiga — surilardi. Egasi qarori (2026-08-12): rezerv qilinsin.
   *
   * Uch bo'g'in bitta hujjat bo'yicha (zakaz bilan AYNI mexanizm):
   *   `send-to-picking` → `reserve`          (shu yer)
   *   `cancel`          → `release_cancel`   (`cancel()`)
   *   `post`            → `release_consume`  (`post()`, `assertAvailable` dan OLDIN)
   *
   * `draft` dan to'g'ridan-to'g'ri sotuvda (P3 «Sotish» yo'li) rezerv umuman
   * bo'lmaydi — `releaseReservationByDoc` esa yozuvi yo'q hujjatda toza
   * no-op, ya'ni ikkala yo'l bir xil kod bilan yopiladi.
   */
  async sendToPicking(accountId: string, id: string, userId: string, userName: string) {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      select: {
        id: true,
        state: true,
        // Rezerv do'koni — chekning O'ZINIKI EMAS, SMENANIKI. `post()` ombor
        // kaskadini aynan `session.storeId` ga yozadi (o'sha faylning
        // `storeId` o'zgaruvchisi), chek `storeId` esa prodda NULL bo'lib
        // yotibdi (17/17 chekda). Ikki xil manbadan olsak, rezerv bir
        // do'konga tushib, yechim boshqasidan bo'lardi — hech qachon
        // bo'shamaydigan hold.
        session: { select: { storeId: true, store: { select: { allowNegativeStock: true } } } },
        positions: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            // K3 (7.1) — bo'linadigan tovar bayrog'i (`collectPieceTracked`).
            product: { select: { pieceTracked: true } },
          },
        },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    if (!canTransition(sale.state, 'send-to-picking')) {
      throw new BadRequestException(transitionRejection(sale.state, 'send-to-picking'));
    }

    // F6: rezerv do'koni ham STOK-KASKAD ombori — `post()` ayirishni qaysi
    // ombordan qilsa, hold ham O'SHA yerda turishi kerak (aks holda rezerv
    // bir omborda, yechim boshqasida — hech qachon bo'shamaydigan hold,
    // aynan shu metod tarixidagi xatoning yangi shakli). Kaskad sozlanmagan
    // bo'lsa — smena ombori (eski xulq, izoh quyida saqlangan).
    const cascade = await this.resolveStockCascade(accountId);
    // G4 — rezerv ham AJRATMA bo'yicha: post() qaysi ombordan ayirsa, hold
    // ham o'sha yerda turishi kerak (aks holda hech qachon bo'shamaydigan hold).
    const allocStores = await this.resolveAllocationStores(accountId);
    const stockStore = cascade[0] ?? null;
    const storeId = stockStore?.id ?? sale.session.storeId;
    const allowNegative = stockStore
      ? stockStore.allowNegativeStock
      : sale.session.store.allowNegativeStock;
    const stockPositions = sale.positions.filter(
      (p): p is typeof p & { productId: string; id: string } => p.productId !== null,
    );
    // K3 (7.1) — bo'linadigan tovarda rezerv ham BO'LINMAYDI: post() nima
    // qilsa, rezerv ham shuni qilishi kerak (aks holda hold bir omborda,
    // yechim boshqasida qolardi).
    const pieceTrackedIds = collectPieceTracked(stockPositions);

    // Flip va rezerv BITTA tranzaksiyada. Ajralsa ikki yoriq ochilardi:
    // flip o'tib rezerv yiqilsa — chek yig'ishda-yu tovar band emas; rezerv
    // o'tib flip yiqilsa — tovar abadiy band, uni bo'shatadigan hujjat yo'q.
    await this.prisma.client.$transaction(async (tx) => {
      // `lockBalances` — `applyReservationDeltas` shartnomasi (kommentida
      // ochiq yozilgan): chaqiruvchi SHU tx da qulflashi SHART, aks holda
      // ikki parallel rezerv `reservedQty` ni lost-update qiladi.
      const assortments = stockPositions.map((p) => ({
        kind: 'product' as const,
        id: p.productId,
      }));
      // G4 — taqsimot omborlarining HAMMASI qulflanadi (deterministik tartib):
      // reja qulflanmagan raqamga qurilsa ikki kassir bir yacheykani band qilardi.
      const planStores = resolveAllocStores(allocStores, storeId);
      const balancesByStore = new Map<string, Map<string, StockBalance>>();
      if (stockPositions.length > 0) {
        for (const st of [...planStores].sort((a, b) => a.id.localeCompare(b.id))) {
          balancesByStore.set(
            st.id,
            await this.stock.lockBalances(tx, accountId, st.id, assortments),
          );
        }
      }

      // Yetarlilik AYNAN shu yerda tekshiriladi — rezervning butun ma'nosi
      // shu: xato mijoz oldida emas, savat bosilgan lahzada chiqsin.
      // `assertAvailable` «доступно = qoldiq − rezerv» ni hisoblaydi, ya'ni
      // boshqa kassaning ochiq cheki ham hisobga olinadi.
      // G4 (Q1-v2) — yetarlilik qarorini TAQSIMOT qiladi: tovar qaysi
      // ombor/yacheykada bo'lsa, o'sha yerdan band qilinadi. Eski «bosh
      // omborchi tasdig'i kerak» to'sig'i egasi tomonidan BEKOR QILINGAN.
      let perPosition: PositionAllocation[] = [];
      if (stockPositions.length > 0) {
        const planned = await this.planAllocations(
          tx,
          accountId,
          planStores,
          stockPositions.map((p) => ({
            id: p.id,
            productId: p.productId,
            quantity: p.quantity,
          })),
          balancesByStore,
          storeId,
          pieceTrackedIds,
        );
        perPosition = planned.perPosition;
        for (const w of planned.plan.warnings) {
          this.logger.warn(
            `[alloc-invariant] ${w.code} sale=${id} product=${w.assortmentId} store=${w.storeId} cells=${w.cells}`,
          );
        }
        if (planned.plan.shortfalls.length > 0 && !allowNegative) {
          // Rezervning butun ma'nosi shu: xato mijoz oldida emas, savat
          // bosilgan lahzada chiqsin.
          throw new BadRequestException({
            error: 'InsufficientStock',
            message: buildShortfallMessage(planned.plan.shortfalls),
            details: { shortages: planned.plan.shortfalls },
          });
        }
        if (planned.plan.shortfalls.length > 0) {
          const byPos = new Map<string, bigint>();
          for (const a of perPosition) {
            byPos.set(a.positionId, (byPos.get(a.positionId) ?? 0n) + parseDecimalScaled(a.qty));
          }
          for (const p of stockPositions) {
            const need = parseDecimalScaled(String(p.quantity)) - (byPos.get(p.id) ?? 0n);
            if (need > 0n) {
              perPosition.push({
                positionId: p.id,
                assortmentId: p.productId,
                storeId,
                cellId: null,
                qty: formatDecimalScaled(need),
              });
            }
          }
        }
      }

      const result = await tx.retailSale.updateMany({
        where: { id, accountId, state: { in: [...allowedFrom('send-to-picking')] } },
        data: { state: 'picking' },
      });
      if (result.count === 0) {
        throw new ConflictException('Sale state changed; send-to-picking aborted');
      }

      if (perPosition.length > 0) {
        await this.stock.applyReservationDeltas(
          tx,
          accountId,
          userId,
          perPosition.map((a) => ({
            storeId: a.storeId,
            assortmentKind: 'product',
            assortmentId: a.assortmentId,
            qtyDelta: a.qty,
            docType: 'retailsale',
            docId: id,
            reason: 'reserve' as const,
          })),
        );
        // Ajratma SAQLANADI: omborchi shu yacheykadan yig'adi va `post()`
        // aynan shu qatorlardan ayiradi (aks holda yig'ilgan joy bilan
        // hisobdan chiqarilgan joy bir-biriga mos kelmasdi).
        await tx.retailSalePositionAllocation.deleteMany({
          where: { accountId, positionId: { in: stockPositions.map((p) => p.id) } },
        });
        await tx.retailSalePositionAllocation.createMany({
          data: perPosition.map((a) => ({
            accountId,
            positionId: a.positionId,
            storeId: a.storeId,
            cellId: a.cellId,
            qty: a.qty,
          })),
        });
      }
    });
    // Create per-sklad picking tasks for each configured warehouse keeper.
    // Best-effort: a failure here must not roll back the state change.
    this.createPickingTasksForSale(accountId, id, userId, userName).catch((e) => {
      this.logger.error(
        `createPickingTasksForSale failed for retailsale ${id}: ${e instanceof Error ? e.message : e}`,
      );
    });
    return this.prisma.client.retailSale.findUniqueOrThrow({
      where: { id },
      include: {
        positions: {
          include: { product: { select: { id: true, name: true, code: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  private async createPickingTasksForSale(
    accountId: string,
    saleId: string,
    userId: string,
    userName: string,
  ): Promise<void> {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id: saleId, accountId },
      select: {
        name: true,
        storeId: true,
        store: { select: { name: true } },
        // P3 — chek `storeId`i prodda 17/17 hollarda NULL (POS uni
        // to'ldirmaydi; `post()` ombor kaskadini SMENA do'koniga yozadi).
        // Zaxirasiz yig'ish topshirig'i do'konsiz chiqardi — omborchi
        // panelida «qaysi do'kondan yig'ay?» degan bo'sh ustun.
        session: { select: { storeId: true, store: { select: { name: true } } } },
        positions: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                attributes: true,
              },
            },
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!sale || sale.positions.length === 0) {
      this.logger.warn(`createPickingTasks[${saleId}]: sale not found or no positions`);
      return;
    }

    const keepers = await this.prisma.client.skladKeeper.findMany({ where: { accountId } });
    if (keepers.length === 0) {
      this.logger.warn(`createPickingTasks[${saleId}]: no skladKeeper mappings found`);
      return;
    }
    const keeperBySklad = new Map(keepers.map((k) => [k.skladNo, k]));

    // Pozitsiyalar ombor raqami bo'yicha guruhlanadi (yacheyka kodining 1-bo'lagi).
    // Yacheykasi yo'q tovarlar NULL_SKLAD=-1 guruhiga, u birinchi omborchiga.
    const NULL_SKLAD = -1;
    type Pos = (typeof sale.positions)[number];
    const groups = new Map<number, Pos[]>();
    for (const pos of sale.positions) {
      // climart: manzil tovarda `attributes.__yacheyka` satri («01-02-03-05»);
      // ombor raqami = birinchi bo'lak (sherset'dagi `locSklad` ekvivalenti).
      const sklad = (pos.product ? skladNoOf(cellOf(pos.product.attributes)) : null) ?? NULL_SKLAD;
      if (sklad === NULL_SKLAD) {
        this.logger.warn(
          `createPickingTasks[${saleId}]: product ${pos.productId} yacheykasi yo'q - zaxira guruh`,
        );
      }
      const bucket = groups.get(sklad);
      if (bucket) bucket.push(pos);
      else groups.set(sklad, [pos]);
    }
    this.logger.log(
      `createPickingTasks[${saleId}]: grouped into sklads: ${[...groups.keys()].join(', ')}, keepers: ${[...keeperBySklad.keys()].join(', ')}`,
    );

    const storeId = sale.storeId ?? sale.session?.storeId ?? null;
    const storeName = sale.store?.name ?? sale.session?.store?.name ?? null;
    // Yacheykasiz tovarlar uchun zaxira omborchi: birinchi sozlangani.
    const fallbackKeeper = keepers[0];

    for (const [skladNo, entries] of groups) {
      const keeper = skladNo === NULL_SKLAD ? fallbackKeeper : keeperBySklad.get(skladNo);
      if (!keeper) continue;

      const task = await this.prisma.client.restockTask.create({
        data: {
          accountId,
          type: 'picking',
          skladNo,
          sourceType: 'retailsale',
          sourceId: saleId,
          sourceName: sale.name,
          storeId,
          storeName,
          assigneeId: keeper.employeeId,
          assigneeName: keeper.employeeName,
          createdById: userId,
          createdByName: userName,
          status: 'pending',
          lines: {
            create: entries.map((pos, i) => {
              const p = pos.product;
              const bin = p ? cellOf(p.attributes) : '';
              return {
                accountId,
                productId: pos.productId ?? null,
                productName: p?.name ?? '—',
                quantity: pos.quantity,
                binLocation: bin || null,
                position: i,
                // K4 — qator QAYSI chek pozitsiyasidan chiqqani. Busiz kesim
                // oqimi pozitsiyani `(chek, tovar)` juftligidan TAXMIN
                // qilardi: kassir bitta tovarni chekka ikki qator qilib
                // qo'ysa bo'lak noto'g'ri qatorga biriktirilardi.
                positionId: pos.id,
              };
            }),
          },
        },
      });

      await this.notifications
        .emit(
          accountId,
          keeper.employeeId,
          'picking_assigned',
          "Yig'ish vazifasi",
          `${entries.length} ta mahsulot${sale.name ? ` — ${sale.name}` : ''}`,
          'RestockTask',
          task.id,
        )
        .catch(() => {});
    }
  }

  async markReady(accountId: string, id: string, userId: string) {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      select: { id: true, state: true },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    if (!canTransition(sale.state, 'mark-ready')) {
      throw new BadRequestException(transitionRejection(sale.state, 'mark-ready'));
    }

    // Does THIS omborchi own a picking task for this sale?
    const myTaskCount = await this.prisma.client.restockTask.count({
      where: {
        accountId,
        sourceId: id,
        sourceType: 'retailsale',
        type: 'picking',
        assigneeId: userId,
      },
    });

    if (myTaskCount > 0) {
      // Per-warehouse: close only the caller's own zone.
      await this.prisma.client.restockTask.updateMany({
        where: {
          accountId,
          sourceId: id,
          sourceType: 'retailsale',
          type: 'picking',
          assigneeId: userId,
          status: { notIn: ['done', 'cancelled'] },
        },
        data: { status: 'done' },
      });
      // 🔴 G2 (egasi, 2026-08-23): kichik omborchining «tayyor»i endi chekni
      // `ready` ga O'TKAZMAYDI — hatto oxirgi topshiriq yopilganda ham. Hamma
      // topshiriq yopilgach chek KATTA OMBORCHI KONTROL NAVBATIGA tushadi
      // (`controlQueue`), va faqat uning «To'liq»i (`controlApprove`) yoki
      // kassirning o'z «tayyor» tugmasi (pastdagi zaxira yo'l) flip qiladi.
      // Ilgari oxirgi omborchi flip qilardi — kontrol bosqichi chetlab o'tilardi.
      return this.prisma.client.retailSale.findUniqueOrThrow({ where: { id } });
    }

    // No keeper-assigned task for this user → legacy behaviour: close everything
    // and flip. Bu KASSIRNING zaxira yo'li (egasi, 2026-08-11): omborchi
    // belgilamasa/tovar qo'lma-qo'l berilsa chek «Jarayonda» da qotib qolmasin.
    await this.prisma.client.restockTask.updateMany({
      where: {
        accountId,
        sourceId: id,
        sourceType: 'retailsale',
        type: 'picking',
        status: { notIn: ['done', 'cancelled'] },
      },
      data: { status: 'done' },
    });

    // Flip to 'ready' (atomic guard against a racing post/cancel).
    const result = await this.prisma.client.retailSale.updateMany({
      where: { id, accountId, state: 'picking' },
      data: { state: 'ready' },
    });
    if (result.count === 0) {
      throw new ConflictException('Sale state changed; mark-ready aborted');
    }
    return this.prisma.client.retailSale.findUniqueOrThrow({ where: { id } });
  }

  // ─── G2 — kontrol oqimi ───────────────────────────────────────────────────

  /**
   * Kontrol navbati: `picking` holatidagi, HAMMA yig'ish topshiriqlari yopilgan
   * cheklar (FIFO — eng eski birinchi). Qisman yopilgani navbatga TUSHMAYDI
   * (omborchi hali yig'moqda); topshiriqsiz chek ham TUSHMAYDI (sabab sof
   * modulda — `isControlReady` izohi).
   */
  async controlQueue(accountId: string, rawFilter: unknown) {
    const filter = ControlQueueFilterSchema.parse(rawFilter ?? {});
    const sales = await this.prisma.client.retailSale.findMany({
      where: { accountId, state: 'picking' },
      orderBy: { moment: 'asc' },
      // Navbatdan ko'ra kengroq o'qiladi: filtrlash (topshiriq holati) DB'da
      // emas, sof modulda — `picking` cheklar soni kichik (ochiq smena ishi).
      take: Math.max(filter.limit * 4, 200),
      include: {
        session: {
          select: {
            id: true,
            cashDesk: { select: { id: true, name: true, currency: true } },
            cashier: { select: { id: true, name: true } },
          },
        },
        agent: { select: { id: true, name: true } },
        _count: { select: { positions: true } },
      },
    });
    if (sales.length === 0) return { items: [] };

    const tasks = await this.prisma.client.restockTask.findMany({
      where: {
        accountId,
        type: 'picking',
        sourceType: 'retailsale',
        sourceId: { in: sales.map((s) => s.id) },
      },
      select: {
        sourceId: true,
        status: true,
        skladNo: true,
        assigneeName: true,
        // G6 — omborchi «javonda topolmadim» degan qatorlar. Kontrol
        // AYNAN shularni chekdan chiqaradi yoki kamaytiradi (`control-edit`),
        // ya'ni ular navbat kartasida KO'RINISHI shart: aks holda katta
        // omborchi to'liq bo'lmagan chekni «To'liq» deb yuborardi va kassir
        // mijozdan yo'q tovar uchun pul olardi.
        lines: {
          where: { shortageQty: { not: null } },
          select: { productName: true, quantity: true, shortageQty: true, shortageNote: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    const bySale = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const bucket = bySale.get(t.sourceId);
      if (bucket) bucket.push(t);
      else bySale.set(t.sourceId, [t]);
    }

    const items = sales
      .filter((s) => isControlReady(bySale.get(s.id) ?? []))
      .slice(0, filter.limit)
      .map((s) => ({
        ...s,
        // Kontrol kartasida «qaysi skladlar yig'di» ko'rinadi.
        pickingTasks: (bySale.get(s.id) ?? []).map((t) => ({
          skladNo: t.skladNo,
          assigneeName: t.assigneeName,
          status: t.status,
        })),
        // G6 — yetishmovchilik (topshiriqlar bo'ylab yig'ilgan, additiv maydon).
        shortages: (bySale.get(s.id) ?? []).flatMap((t) =>
          t.lines.map((l) => ({
            productName: l.productName,
            quantity: l.quantity.toString(),
            shortageQty: l.shortageQty?.toString() ?? '0',
            note: l.shortageNote,
          })),
        ),
      }));
    return { items };
  }

  /**
   * Kontrol «To'liq» — katta omborchi chekni ko'z bilan tekshirib tasdiqladi:
   * `picking → ready`, KIM tekshirgani auditda, kassirga `sale_ready` SSE.
   */
  async controlApprove(accountId: string, userId: string, id: string) {
    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      select: {
        id: true,
        name: true,
        state: true,
        sumMinor: true,
        sessionId: true,
        session: { select: { cashierId: true } },
        positions: { select: { productId: true, quantity: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    if (!canTransition(sale.state, 'mark-ready')) {
      throw new BadRequestException(transitionRejection(sale.state, 'mark-ready'));
    }

    // Ochiq topshiriq bor chek tasdiqlanMAYDI — omborchi hali yig'moqda.
    // (Navbat buni ko'rsatmaydi ham; bu to'g'ridan-to'g'ri API chaqiruviga
    // qarshi qo'riqchi.) Omborchi kelmay qolgan chek uchun kassirning o'z
    // «tayyor» tugmasi bor — kontrol majburan o'tkazish nuqtasi emas.
    const openTasks = await this.prisma.client.restockTask.count({
      where: {
        accountId,
        sourceId: id,
        sourceType: 'retailsale',
        type: 'picking',
        status: { notIn: ['done', 'cancelled'] },
      },
    });
    if (openTasks > 0) {
      throw new BadRequestException(
        `${sale.name}: ${openTasks} ta yig'ish topshirig'i hali ochiq — omborchi tugatishini kuting`,
      );
    }

    await this.prisma.client.$transaction(async (tx) => {
      const flip = await tx.retailSale.updateMany({
        where: { id, accountId, state: 'picking' },
        data: { state: 'ready' },
      });
      if (flip.count === 0) {
        throw new ConflictException('Sale state changed; control-approve aborted');
      }
      // Kim tekshirgani — flip bilan BIR tranzaksiyada (poygada yutgan yoziladi).
      await this.writeAuditEvents(tx, accountId, sale.sessionId, userId, [
        planControlApproveAuditEvent(id, {
          name: sale.name,
          sumMinor: sale.sumMinor,
          lines: sale.positions.map((p) => ({
            productId: p.productId,
            quantity: String(p.quantity),
          })),
        }),
      ]);
    });

    // Kassirga jonli signal — POS `ready` ro'yxatini darhol yangilaydi.
    // Best-effort (emit o'zi xatoni yutadi): bildirishnoma yiqilsa ham chek
    // allaqachon `ready` va 8s poll baribir yetkazadi.
    if (sale.session?.cashierId) {
      await this.notifications.emit(
        accountId,
        sale.session.cashierId,
        'sale_ready',
        'Chek tayyor',
        `${sale.name} — kontroldan o'tdi, to'lash mumkin`,
        'RetailSale',
        id,
      );
    }
    return this.prisma.client.retailSale.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Kontrol tahriri — katta omborchi yig'ilgan chek tarkibini haqiqatga
   * moslaydi: qator o'chirish / sonni KAMAYTIRISH (qoida sof modulda).
   *
   * FAQAT `picking` holatida: `ready` dan keyin tahrir yo'q (kassir allaqachon
   * to'lov oynasini ochgan bo'lishi mumkin), `posted` uchun alohida `edit()`
   * (pul daftarlariga tegadigan boshqa klass) bor.
   *
   * Rezerv ham KAMAYADI: `send-to-picking` har pozitsiyani band qilgan edi —
   * qator qisqarganda hold ham qisqarmasa, o'sha tovar to'lovgacha boshqa
   * kassaga «band» bo'lib turaverardi.
   */
  async controlEdit(accountId: string, userId: string, id: string, raw: unknown) {
    const parsed = ControlEditSchema.parse(raw);

    const sale = await this.prisma.client.retailSale.findFirst({
      where: { id, accountId },
      select: {
        id: true,
        name: true,
        state: true,
        version: true,
        sumMinor: true,
        sessionId: true,
        session: { select: { cashierId: true } },
        positions: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            priceMinor: true,
            discount: true,
            sumMinor: true,
            product: { select: { name: true } },
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!sale) throw new NotFoundException(`RetailSale ${id} not found`);
    if (sale.state !== 'picking') {
      throw new BadRequestException(
        `Kontrol tahriri faqat yig'ilayotgan (picking) chekka — hozir: ${sale.state}. «Tayyor» chek uchun avval kassir bilan kelishing (post/cancel).`,
      );
    }

    const before: ControlPositionBefore[] = sale.positions.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: p.product?.name ?? null,
      quantity: String(p.quantity),
      priceMinor: p.priceMinor,
      discount: String(p.discount ?? '0'),
      sumMinor: p.sumMinor,
    }));
    const plan = planControlEdit(before, parsed.positions);
    if (plan.refusals.length > 0) throw new BadRequestException(plan.refusals.join('; '));
    if (plan.noop) return { ok: true, changed: false };

    await this.prisma.client.$transaction(async (tx) => {
      // Optimistik qulf + holat qo'riqchisi BIR filtrda: kassir ayni damda
      // post/cancel qilgan yoki boshqa kontrolchi tahrirlagan bo'lsa — 409.
      const flip = await tx.retailSale.updateMany({
        where: { id, accountId, version: parsed.version, state: 'picking' },
        data: { sumMinor: plan.newSumMinor, version: { increment: 1 } },
      });
      if (flip.count === 0) {
        throw new ConflictException(
          `${sale.name} boshqa joyda o'zgardi — sahifani yangilab qayta urinib ko'ring.`,
        );
      }

      for (const k of plan.keeps) {
        if (!k.changed) continue;
        await tx.retailSalePosition.updateMany({
          where: { id: k.id, accountId, retailSaleId: id },
          data: { quantity: k.quantity, sumMinor: k.sumMinor },
        });
      }
      if (plan.removed.length > 0) {
        await tx.retailSalePosition.deleteMany({
          where: { id: { in: plan.removed.map((r) => r.id) }, accountId, retailSaleId: id },
        });
      }

      // Rezerv-bo'shatish: hold HAQIQATAN turgan (store × product) qatorlar
      // bo'yicha, har mahsulotning kamaygan miqdori net-qoldiqdan oshmagan
      // holda taqsimlanadi (cancel() dagi bilan bir intizom: qulf avval,
      // deterministik store tartibi, idempotent cap).
      if (plan.releaseByProduct.length > 0) {
        const rows = await tx.stockReservation.findMany({
          where: { accountId, docType: 'retailsale', docId: id },
          select: { storeId: true, assortmentKind: true, assortmentId: true, qtyDelta: true },
        });
        const nets = netOutstandingReservations(
          rows.map((r) => ({
            storeId: r.storeId,
            assortmentKind: r.assortmentKind,
            assortmentId: r.assortmentId,
            qtyDelta: r.qtyDelta.toString(),
          })),
        );
        const releaseDeltas: Array<{
          storeId: string;
          assortmentKind: string;
          assortmentId: string;
          qtyDelta: string;
          docType: string;
          docId: string;
          reason: 'release_manual';
        }> = [];
        for (const rel of plan.releaseByProduct) {
          let remaining = parseQty(rel.qty) ?? 0n;
          const productNets = nets
            .filter((n) => n.assortmentId === rel.productId)
            .sort((a, b) => a.storeId.localeCompare(b.storeId));
          for (const n of productNets) {
            if (remaining <= 0n) break;
            const avail = parseQty(n.net) ?? 0n;
            if (avail <= 0n) continue;
            const take = remaining < avail ? remaining : avail;
            releaseDeltas.push({
              storeId: n.storeId,
              assortmentKind: n.assortmentKind,
              assortmentId: rel.productId,
              qtyDelta: `-${formatQty(take)}`,
              docType: 'retailsale',
              docId: id,
              reason: 'release_manual',
            });
            remaining -= take;
          }
          // remaining > 0n bo'lsa — bu mahsulotga rezerv umuman yozilmagan
          // (masalan picking'gacha yaratilgan eski chek); jim o'tamiz,
          // `releaseReservationByDoc` dagi «net ≤ 0 → no-op» intizomi bilan bir.
        }
        if (releaseDeltas.length > 0) {
          const products = [...new Set(releaseDeltas.map((d) => d.assortmentId))].map((pid) => ({
            kind: 'product' as const,
            id: pid,
          }));
          for (const sid of [...new Set(releaseDeltas.map((d) => d.storeId))].sort()) {
            await this.stock.lockBalances(tx, accountId, sid, products);
          }
          await this.stock.applyReservationDeltas(tx, accountId, userId, releaseDeltas);
        }
      }

      // Kim tahrirlagani — chek tarixida (flip bilan bir tranzaksiyada).
      await this.writeAuditEvents(tx, accountId, sale.sessionId, userId, [
        planControlEditAuditEvent(id, {
          name: sale.name,
          oldSumMinor: sale.sumMinor,
          newSumMinor: plan.newSumMinor,
          removed: plan.removed.map((r) => ({
            productId: r.productId,
            productName: r.productName,
            quantity: r.quantity,
          })),
          changed: plan.keeps
            .filter((k) => k.changed)
            .map((k) => ({
              productId: k.productId,
              productName: k.productName,
              oldQuantity: k.oldQuantity,
              quantity: k.quantity,
            })),
        }),
      ]);
    });

    // Kassirga jonli signal — POS ochiq qoralama/kutish chekni qayta yuklaydi
    // va toast'da AYNAN qaysi qatorlar o'zgarganini ko'radi (reja G2.3).
    if (sale.session?.cashierId) {
      await this.notifications.emit(
        accountId,
        sale.session.cashierId,
        'sale_edited',
        `Chek tahrirlandi — ${sale.name}`,
        controlEditNotificationBody(plan),
        'RetailSale',
        id,
      );
    }
    return { ok: true, changed: true };
  }
}
