import { randomUUID } from 'node:crypto';
import { Prisma } from '@moysklad/db';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EnterService } from '../enter/enter.service.js';
import { LossService } from '../loss/loss.service.js';
import { assertCellStockEmpty } from '../shared/cell-stock-guard.js';
import { formatDecimalScaled, parseDecimalScaled, subtractDecimals } from '../shared/decimal.js';
import { PlacementSource, allocatePlacement, totalTakenMicro } from '../shared/pool-placement.js';
import { findPoolStore, sumAssignedByAssortment } from '../stock/pool-store.util.js';
import { StockService } from '../stock/stock.service.js';
import type { CountSessionAutoDoc } from '../tsd/count-session.js';
import { CountSessionService } from '../tsd/count-session.service.js';
import {
  CellRangeError,
  type CellRangeSpec,
  type ExpandedCell,
  expandCellRange,
  expandWarehouseNumbering,
} from './cell-range.util.js';
import {
  AssignProductsSchema,
  BulkCreateCellsSchema,
  CellBarcodeLookupSchema,
  CreateCellSchema,
  CreateZoneSchema,
  SetCellStockSchema,
  UpdateCellSchema,
  UpdateZoneSchema,
  WarehouseNumberingSchema,
} from './store-address.schema.js';

/**
 * StoreAddressService — CRUD for warehouse address storage (Адресное хранение):
 * Zones (Зоны) + Cells (Ячейки), both scoped to one warehouse.
 *
 * Tenancy: every query is filtered by `accountId`; mutating endpoints first prove
 * the parent store belongs to the caller (assertStore). Cascade: deleting a store
 * drops its zones+cells (FK onDelete: Cascade); deleting a zone SetNull-s its
 * cells back to the «Без зоны хранения» bucket (FK onDelete: SetNull) — never
 * deletes the cells.
 *
 * Cell status (Свободна/Занята) and per-zone free/occupied counts ARE computed in
 * `getAddressStorage`: a cell counts as «Занята» when it holds counted stock
 * (`StockByCell.qty > 0`) OR when a product is bound to it as its home cell
 * (`attributes.__yacheyka`) — the same union the cell detail «Ko'rish» lists.
 */
@Injectable()
export class StoreAddressService {
  private readonly logger = new Logger(StoreAddressService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // «Umumiy sanash» true-up: the counted cell qty posts an auto Enter/Loss so
    // document-derived product stock follows (climart 2026-07-26 feature port).
    @Inject(EnterService) private readonly enters: EnterService,
    @Inject(LossService) private readonly losses: LossService,
    // F7 — sanashda hovuz/o'z-qoldiqdan joylashtirish (applyDeltas/lockBalances).
    @Inject(StockService) private readonly stock: StockService,
    // N-reja §5-N2 — sanash sessiyasining IZ qatlami. Faqat `recordCount`
    // chaqiriladi va u qoldiqqa TEGMAYDI (`count-session.service.ts`).
    @Inject(CountSessionService) private readonly countSessions: CountSessionService,
  ) {}

  // -------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------

  private async assertStore(accountId: string, storeId: string): Promise<void> {
    const store = await this.prisma.client.store.findFirst({
      where: { id: storeId, accountId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException(`Store ${storeId} not found`);
  }

  /** Verify a zone exists in THIS store (prevents cross-store zone assignment). */
  private async assertZoneInStore(
    accountId: string,
    storeId: string,
    zoneId: string,
  ): Promise<void> {
    const zone = await this.prisma.client.storeZone.findFirst({
      where: { id: zoneId, storeId, accountId },
      select: { id: true },
    });
    if (!zone) {
      throw new BadRequestException('Tanlangan zona bu omborga tegishli emas');
    }
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  /**
   * Full address-storage snapshot for the warehouse card + the doc cell-picker.
   * Zones carry real Всего/Свободно/Занято counts; each cell carries its resolved
   * `zoneName`, an `occupied` flag (holds any stock), and — when `assortmentId` is
   * passed — `productQty` (this product's qty in the cell, drives «С этим товаром»).
   * Occupancy is derived from StockByCell (Phase 4); cells that never received a
   * cell-tagged movement read as «Свободна» (the forward-looking model).
   */
  async getAddressStorage(
    accountId: string,
    storeId: string,
    opts?: { assortmentKind?: string; assortmentId?: string },
  ) {
    await this.assertStore(accountId, storeId);
    const assortmentKind = opts?.assortmentKind ?? 'product';
    const wantProduct = !!opts?.assortmentId;
    const [zones, cells, occupiedRows, productRows] = await Promise.all([
      this.prisma.client.storeZone.findMany({
        where: { accountId, storeId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.client.storeCell.findMany({
        where: { accountId, storeId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      // «Занята» — distinct cellIds that hold ANY stock (qty>0).
      this.prisma.client.stockByCell.findMany({
        where: { accountId, storeId, qty: { gt: 0 } },
        select: { cellId: true },
        distinct: ['cellId'],
      }),
      // «С этим товаром» — this product's per-cell qty (only when asked).
      wantProduct
        ? this.prisma.client.stockByCell.findMany({
            where: {
              accountId,
              storeId,
              assortmentKind,
              assortmentId: opts?.assortmentId,
              qty: { gt: 0 },
            },
            select: { cellId: true, qty: true },
          })
        : Promise.resolve([] as Array<{ cellId: string; qty: unknown }>),
    ]);

    const occupied = new Set(occupiedRows.map((r) => r.cellId));

    // A cell is «Занята» not only when it holds counted stock, but also when a
    // product is BOUND to it as its home cell (`attributes.__yacheyka` = cell
    // name) even before any count — exactly what the cell detail «Ko'rish»
    // (`getCellStock`) already lists. Without this the two surfaces disagree:
    // the owner fills a cell (binds a product), the list still shows «Свободна»,
    // yet «Ko'rish» shows the product (reported 2026-08-03). Match `getCellStock`
    // semantics precisely: non-deleted products, exact cell-name match, product
    // kind only. One DISTINCT query returns just the occupied cell names.
    const boundNameRows = await this.prisma.client.$queryRaw<Array<{ name: string | null }>>`
      SELECT DISTINCT attributes->>'__yacheyka' AS name
      FROM products
      WHERE account_id = ${accountId}::uuid
        AND deleted_at IS NULL
        AND attributes->>'__yacheyka' IS NOT NULL
    `;
    const boundCellNames = new Set(
      boundNameRows.map((r) => r.name).filter((n): n is string => !!n),
    );
    for (const c of cells) {
      if (boundCellNames.has(c.name)) occupied.add(c.id);
    }
    // Multi-bin (2026-08-06): a product may ALSO be bound to a cell via
    // ProductCellLink (any cell beyond its single `__yacheyka` home cache) —
    // that must count as «Занята» too, matched by cellId (no name collision
    // risk across warehouses, unlike the legacy string above).
    const linkedRows = await this.prisma.client.productCellLink.findMany({
      where: { accountId, cellId: { in: cells.map((c) => c.id) } },
      select: { cellId: true },
      distinct: ['cellId'],
    });
    for (const r of linkedRows) occupied.add(r.cellId);

    const productQtyByCell = new Map(productRows.map((r) => [r.cellId, String(r.qty)]));
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));

    const cellsOut = cells.map((c) => ({
      ...c,
      zoneName: c.zoneId ? (zoneName.get(c.zoneId) ?? null) : null,
      occupied: occupied.has(c.id),
      productQty: wantProduct ? (productQtyByCell.get(c.id) ?? null) : null,
    }));

    // Per-zone Всего / Занято / Свободно (and the «Без зоны хранения» bucket roll-up
    // is computed FE-side from zoneless cells).
    const totalByZone = new Map<string, number>();
    const occByZone = new Map<string, number>();
    for (const c of cellsOut) {
      if (!c.zoneId) continue;
      totalByZone.set(c.zoneId, (totalByZone.get(c.zoneId) ?? 0) + 1);
      if (c.occupied) occByZone.set(c.zoneId, (occByZone.get(c.zoneId) ?? 0) + 1);
    }

    return {
      zones: zones.map((z) => {
        const cellCount = totalByZone.get(z.id) ?? 0;
        const occupiedCount = occByZone.get(z.id) ?? 0;
        return { ...z, cellCount, occupiedCount, freeCount: cellCount - occupiedCount };
      }),
      cells: cellsOut,
    };
  }

  /**
   * «🖨 Этикетка» (F1) — everything currently stored in ONE cell, with the
   * assortment identity the label needs (name + code + first barcode). Kinds:
   * 'variant' resolves from Variant, everything else from Product (the same
   * split ensureAssortmentsInTenant uses). Rows whose assortment row vanished
   * (hard-deleted product) fall back to the raw id so the label still prints.
   */
  async getCellStock(accountId: string, storeId: string, cellId: string) {
    await this.assertStore(accountId, storeId);
    const cell = await this.prisma.client.storeCell.findFirst({
      where: { id: cellId, storeId, accountId },
      select: { id: true, name: true, barcode: true },
    });
    if (!cell) throw new NotFoundException(`Cell ${cellId} not found`);

    const rows = await this.prisma.client.stockByCell.findMany({
      where: { accountId, storeId, cellId, qty: { gt: 0 } },
      select: { assortmentKind: true, assortmentId: true, qty: true },
    });

    // Owner 2026-07-21 «Ko'rish»: the cell view lists EVERY product that lives
    // here — counted stock rows AND bound products that have no count yet
    // (they render with qty 0, ready for «Sanash»). Multi-bin (2026-08-06):
    // "bound" = the legacy single `__yacheyka` home cache OR a ProductCellLink
    // row (a product can now be bound to several cells at once).
    const linkedIds = await this.prisma.client.productCellLink.findMany({
      where: { accountId, cellId },
      select: { productId: true },
    });
    const bound = await this.prisma.client.product.findMany({
      // deletedAt: soft-deleted product must not resurface in the cell view —
      // stale __yacheyka attributes linger on deleted rows (climart 2026-07-26:
      // bulk count picked a dead id and the save 404'd).
      where: {
        accountId,
        deletedAt: null,
        OR: [
          { attributes: { path: ['__yacheyka'], equals: cell.name } },
          { id: { in: linkedIds.map((l) => l.productId) } },
        ],
      },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    const stockedIds = new Set(rows.map((r) => r.assortmentId));
    for (const b of bound) {
      if (!stockedIds.has(b.id)) {
        rows.push({
          assortmentKind: 'product',
          assortmentId: b.id,
          qty: new Prisma.Decimal(0),
        });
      }
    }

    const productIds = rows
      .filter((r) => r.assortmentKind !== 'variant')
      .map((r) => r.assortmentId);
    const variantIds = rows
      .filter((r) => r.assortmentKind === 'variant')
      .map((r) => r.assortmentId);
    type Info = {
      id: string;
      name: string;
      code: string | null;
      barcodes: string[];
      description?: string | null;
      images?: Array<{ id: string }>;
    };
    const [products, variants] = await Promise.all([
      productIds.length
        ? this.prisma.client.product.findMany({
            // deletedAt: stale StockByCell rows can point at soft-deleted products —
            // those must not surface in the count/view flows (climart 2026-07-26).
            where: { id: { in: productIds }, accountId, deletedAt: null },
            select: {
              id: true,
              name: true,
              code: true,
              barcodes: true,
              description: true,
              // Main image id only — thumbnails render via GET /images/:id/raw.
              images: {
                orderBy: [{ isMain: 'desc' }, { position: 'asc' }],
                take: 1,
                select: { id: true },
              },
            },
          })
        : Promise.resolve([] as Info[]),
      variantIds.length
        ? this.prisma.client.variant.findMany({
            where: { id: { in: variantIds }, accountId },
            select: { id: true, name: true, code: true, barcodes: true },
          })
        : Promise.resolve([] as Info[]),
    ]);
    const byId = new Map(
      [...products, ...variants].map((p: Info) => [
        p.id,
        {
          name: p.name,
          code: p.code,
          barcode: p.barcodes?.[0] ?? null,
          description: p.description ?? null,
          mainImageId: p.images?.[0]?.id ?? null,
        },
      ]),
    );

    return {
      cell,
      // Rows whose assortment no longer resolves (soft/hard-deleted product) are
      // DROPPED — a dead id in the count flow produced 404 saves (climart 2026-07-26);
      // a ghost row on a label helps nobody either.
      items: rows
        .filter((r) => byId.has(r.assortmentId))
        .map((r) => {
          const info = byId.get(r.assortmentId);
          return {
            assortmentKind: r.assortmentKind,
            assortmentId: r.assortmentId,
            name: info?.name ?? r.assortmentId,
            code: info?.code ?? null,
            barcode: info?.barcode ?? null,
            description: info?.description ?? null,
            mainImageId: info?.mainImageId ?? null,
            qty: r.qty.toString(),
          };
        }),
    };
  }

  /**
   * Scan flow (owner 2026-07-19): resolve a CELL by its printed barcode,
   * account-wide. One hit → the cell (+ store/zone names) with everything a
   * phone needs to show «what lives here»: the bound products (home-cell
   * labels) and the document-derived per-cell stock. Zero hits → empty list;
   * several hits (the same code stuck on two shelves) → the summaries only,
   * so the UI can tell the user the label is ambiguous instead of guessing.
   */
  async lookupCellByBarcode(accountId: string, rawQuery: unknown) {
    const { code } = this.parse(CellBarcodeLookupSchema, rawQuery);
    // Printed labels encode `barcode || name` (cell-label-print), so a label
    // from a cell with no explicit barcode carries its NAME — match both.
    const cells = await this.prisma.client.storeCell.findMany({
      where: { accountId, OR: [{ barcode: code }, { name: code }] },
      select: {
        id: true,
        name: true,
        barcode: true,
        storeId: true,
        store: { select: { name: true } },
        zone: { select: { name: true } },
      },
      take: 5,
    });
    const summaries = cells.map((c) => ({
      id: c.id,
      name: c.name,
      barcode: c.barcode,
      storeId: c.storeId,
      storeName: c.store.name,
      zoneName: c.zone?.name ?? null,
    }));
    const single = cells.length === 1 ? cells[0] : undefined;
    if (!single) return { cells: summaries, products: [], stock: [] };
    const [products, stock] = await Promise.all([
      this.getCellProducts(accountId, single.storeId, single.id),
      this.getCellStock(accountId, single.storeId, single.id),
    ]);
    return { cells: summaries, products: products.items, stock: stock.items };
  }

  // -------------------------------------------------------------------
  // «Добавить товар в ячейку» — product ↔ cell assignment (user 2026-07-06)
  //
  // A product's home cell lives in Product.attributes.__yacheyka (cell CODE) +
  // __polka (zone name) — the SAME binding the product card's «Полка»/«Ячейка»
  // pickers write, so assigning from either side keeps both views consistent.
  // It is a location LABEL, NOT a stock quantity: real per-cell quantity stays
  // document-derived (StockByCell), so this can never create an accounting lie.
  // -------------------------------------------------------------------

  /** Resolve a cell in THIS store (with its zone name) or 404. */
  private async cellWithZone(accountId: string, storeId: string, cellId: string) {
    const cell = await this.prisma.client.storeCell.findFirst({
      where: { id: cellId, storeId, accountId },
      select: { id: true, name: true, zone: { select: { name: true } } },
    });
    if (!cell) throw new NotFoundException(`Cell ${cellId} not found`);
    return cell;
  }

  /**
   * Products bound to this cell — «в этой ячейке». Multi-bin (2026-08-06):
   * union of the legacy single `__yacheyka` home cache (name match) and any
   * ProductCellLink row (cellId match) — a product can now be bound to
   * several cells, so this is no longer a single home-cell lookup.
   */
  async getCellProducts(accountId: string, storeId: string, cellId: string) {
    await this.assertStore(accountId, storeId);
    const cell = await this.cellWithZone(accountId, storeId, cellId);
    const linkedIds = await this.prisma.client.productCellLink.findMany({
      where: { accountId, cellId },
      select: { productId: true },
    });
    const products = await this.prisma.client.product.findMany({
      where: {
        accountId,
        // N-reja §5-N2 (5-vazifa; T-reja T6 dan qolgan qarz): yumshoq
        // o'chirilgan tovar bu ro'yxatga TUSHMASLIGI kerak. Qo'shni
        // `getCellStock` da bu filtr BOR edi, bu yerda YO'Q — ya'ni ikki
        // endpoint bir xil savolga («shu yacheykada nima bor?») ikki xil
        // javob berardi va web'ning «Ko'rish» ekranida o'lik tovar
        // ko'rinardi (`__yacheyka` atributi o'chirilgan qatorda ham qoladi).
        deletedAt: null,
        OR: [
          { attributes: { path: ['__yacheyka'], equals: cell.name } },
          { id: { in: linkedIds.map((l) => l.productId) } },
        ],
      },
      select: { id: true, name: true, code: true, barcodes: true, archived: true },
      orderBy: { name: 'asc' },
    });
    return {
      items: products.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        barcode: p.barcodes?.[0] ?? null,
        archived: p.archived,
      })),
    };
  }

  /**
   * «Sanash» (owner 2026-07-21) — record the PHYSICAL count of one product in
   * one cell. Owner-custom addressing feature: per-cell counts are hand-counted
   * bin contents; store-level totals stay document-derived.
   *
   * TZ v3 — IKKI semantika, `mode` bilan tanlanadi:
   *   · `set` (default, eski xulq) — MUTLAQ: yacheyka qoldig'i aynan `qty` ga
   *     tenglashadi (inventarizatsiya / oddiy rejim);
   *   · `add` («Umumiy sanash», §2.2.3) — `qty` mavjud qoldiqqa QO'SHILADI va
   *     avto-hujjat AYNAN `qty` ga yoziladi (126 ga emas).
   * Delta serverda hisoblanadi — FE «hozirgi» qoldiqni o'qib mutlaq qiymat
   * yubormaydi, shuning uchun ikki omborchi bir vaqtda sanasa ham yo'qolgan-
   * yangilanish bo'lmaydi.
   */
  async setCellStock(
    accountId: string,
    storeId: string,
    cellId: string,
    raw: unknown,
    userId?: string,
  ) {
    await this.assertStore(accountId, storeId);
    const cell = await this.prisma.client.storeCell.findFirst({
      where: { id: cellId, storeId, accountId },
      select: { id: true, name: true },
    });
    if (!cell) throw new NotFoundException();
    const { assortmentId, qty, mode } = this.parse(SetCellStockSchema, raw);
    const product = await this.prisma.client.product.findFirst({
      where: { id: assortmentId, accountId, deletedAt: null },
      select: { id: true, buyPrice: true },
    });
    if (!product) throw new NotFoundException();

    // Owner 2026-07-26 («Umumiy sanash» spec, band 2): the counted amount must
    // BECOME the product's real remainder that sales/returns see. The count is
    // therefore a true-up: the cell-level delta posts an auto Оприходование
    // (delta>0) or Списание (delta<0) so the document-derived stock follows.
    const before = await this.prisma.client.stockByCell.findFirst({
      where: { accountId, storeId, cellId, assortmentKind: 'product', assortmentId },
      select: { qty: true },
    });
    const oldQty = Number(before?.qty ?? 0);
    // TZ v3: `add` — kiritilgan son AYNAN delta (qo'shiladi); `set` — mutlaq
    // sanoq, delta = farq. Yakuniy qoldiq ikkalasida ham `finalQty`.
    const delta = mode === 'add' ? Number(qty) : Number(qty) - oldQty;
    const finalQty = oldQty + delta;

    // Store-level true-up hujjati (avto Оприходование/Списание) SANALGAN yacheyka
    // `cellId`'ini olib boradi ⇒ applyDeltas StockByCell[cellId]'ni AYNAN `delta`ga
    // siljitadi va u `finalQty` ga tushadi. Ikki rejimda `finalQty` ikki xil narsa:
    //   · `set`  — `oldQty + (qty − oldQty) = qty`, ya'ni kiritilgan MUTLAQ sanoq;
    //   · `add`  — `oldQty + qty`, ya'ni kiritilgan son QOLDIQQA QO'SHILADI
    //              (26 + 100 = 126; hujjatga esa aynan `delta`=100 yoziladi).
    // Hujjat — YAGONA per-cell yozuvchi: to'g'ridan-to'g'ri StockByCell.upsert
    // QILMAYMIZ.
    //
    // ⚠️ 2026-07-29 drift-fix: ilgari cell to'g'ridan-to'g'ri absolyut yozilar,
    // KEYIN cellId'siz hujjat post qilinardi — applyDeltas o'sha (yoki uy-)yacheykani
    // IKKINCHI marta siljitardi (KIRIMda uy-cell +delta, CHIQIMda band-cell auto-
    // yechish) ⇒ Σ StockByCell store jamidan oshib/kamayib ketardi (fantom «Занята»).
    // Hujjatni cellId bilan yuborish ikki-yozuvni ildizdan yopadi.
    const org =
      delta !== 0 && userId
        ? await this.prisma.client.organization.findFirst({
            where: { accountId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
        : null;
    const willPostDoc = delta !== 0 && !!userId && !!org;

    if (!willPostDoc) {
      // Degenerat yo'l (delta=0, yoki userId/org konteksti yo'q): store-darajani
      // ergashtiradigan hujjat yo'q ⇒ per-cell balansni to'g'ridan-to'g'ri yozamiz.
      // ⚠️ Bu yerda YAKUNIY qoldiq (`finalQty`) yoziladi, kiritilgan `qty` emas —
      // aks holda `add` rejimi hujjatsiz shoxda jimgina MUTLAQ yozuvga aylanardi
      // (26 + 100 ⇒ 100). Nol-shox ham `finalQty` ga qaraydi: `add` + qty 0
      // qatorni o'chirmasligi kerak.
      if (finalQty === 0) {
        await this.prisma.client.stockByCell.deleteMany({
          where: { accountId, storeId, cellId, assortmentKind: 'product', assortmentId },
        });
      } else {
        await this.prisma.client.stockByCell.upsert({
          where: {
            accountId_storeId_cellId_assortmentKind_assortmentId: {
              accountId,
              storeId,
              cellId,
              assortmentKind: 'product',
              assortmentId,
            },
          },
          create: {
            accountId,
            storeId,
            cellId,
            assortmentKind: 'product',
            assortmentId,
            qty: String(finalQty),
          },
          update: { qty: String(finalQty) },
        });
      }
    }

    let stockDoc: { type: 'enter' | 'loss'; name: string } | null = null;
    // N-reja §5-N2 — sanoq izi qatoriga yoziladigan avto-hujjat (DENORMAL:
    // `id` bilan birga NOMI ham, hujjat keyinchalik o'chirilsa ham bosh
    // omborchi qog'ozdagi raqamni ko'rsin). Javobdagi `stockDoc` shakli
    // O'ZGARMADI — bu alohida o'zgaruvchi.
    let autoDoc: CountSessionAutoDoc | null = null;
    let placedQty = '0';
    if (willPostDoc && org && userId) {
      const note = `Sanash (yacheyka ${cell.name}) — avto-tenglash`;
      if (delta > 0) {
        // F7 — sanalgan ORTIQCHA avval joylashtirish manbalaridan ko'chadi:
        // (1) shu omborning yacheykasiz qoldig'i, (2) `__unassignedSource`
        // hovuz-ombori (Taqsimlanmagan). Faqat qoplanmagan qism avto-
        // Оприходование bo'ladi — hovuz belgilanmagan va o'z-qoldiq 0 bo'lsa
        // xulq eski bilan bir xil (butun delta Enter).
        placedQty = await this.placeCountedFromSources(
          accountId,
          userId,
          storeId,
          cellId,
          assortmentId,
          String(delta),
        );
        const enterQty = subtractDecimals(String(delta), placedQty);
        if (parseDecimalScaled(enterQty) > 0n) {
          const doc = (await this.enters.create(accountId, userId, {
            organizationId: org.id,
            storeId,
            applicable: true,
            description: note,
            positions: [
              {
                assortmentId,
                quantity: enterQty,
                costMinor: product.buyPrice?.toString() ?? '0',
                // Sanalgan yacheyka — hujjat shu yacheykaga aynan shu deltani yozadi.
                cellId,
                cell: cell.name,
              },
            ],
          })) as { id?: string; name?: string };
          stockDoc = { type: 'enter', name: doc?.name ?? '' };
          autoDoc = { type: 'enter', id: doc?.id ?? null, name: doc?.name ?? '' };
        }
      } else {
        const doc = (await this.losses.create(accountId, userId, {
          organizationId: org.id,
          storeId,
          applicable: true,
          description: note,
          positions: [{ assortmentId, quantity: String(-delta), cellId, cell: cell.name }],
        })) as { id?: string; name?: string };
        stockDoc = { type: 'loss', name: doc?.name ?? '' };
        autoDoc = { type: 'loss', id: doc?.id ?? null, name: doc?.name ?? '' };
      }
    }
    // 🔴 N-reja §5-N2 ILGAGI — sanoq IZI. Uch qattiq qoida:
    //
    //  1. **Sanoq yo'li sessiyaga BOG'LIQ EMAS.** Ilgak amalning ENG OXIRIDA,
    //     qoldiq allaqachon tenglashgandan keyin turadi va `try/catch` bilan
    //     o'ralgan: iz yozilmasa ham omborchining sanog'i muvaffaqiyatli
    //     qaytadi. Iz qatlami HECH QACHON omborchini bloklamaydi.
    //  2. **APPEND**, `InventoryService.update()` EMAS — u `positions`
    //     berilganda `deleteMany` qiladi va butun izni o'chirardi.
    //  3. **Sonlar javobdagi AYNI stringlar:** `expectedQty` = `previousQty`,
    //     `actualQty` = `qty`, `varianceQty` = server hisoblagan `delta`.
    //     `mode: 'add'` da ham shu — qatorda MUTLAQ sonlar turadi (26 → 126,
    //     farq 100), ya'ni hisobot ikkala rejimda bir xil o'qiladi.
    if (userId) {
      try {
        await this.countSessions.recordCount({
          accountId,
          userId,
          storeId,
          cellId,
          cellName: cell.name,
          assortmentId,
          expectedQty: String(oldQty),
          actualQty: String(finalQty),
          varianceQty: String(delta),
          // K5 — `setCellStock` sirtida bo'lak tarkibi kirishi HOZIRCHA YO'Q
          // (`SetCellStockSchema` da `pieceEntry` maydoni yo'q va hech bir
          // klient yubormaydi: TSD'da tarkib kiritish ekrani yo'q, u WEB'dagi
          // inventarizatsiya orqali kiritiladi — K-reja). Kirish paydo
          // bo'lganda AYNAN shu joyda uzatiladi va qatorga tushadi.
          pieceEntry: null,
          autoDoc,
        });
      } catch (e) {
        // Ikkinchi qavat: `recordCount` ning o'zi ham xato chiqarmaydi.
        this.logger.error(
          `Sanash izi yozilmadi (cell=${cellId}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // `qty` — YAKUNIY qoldiq (ikkala rejimda ham), `previousQty` — sanashdan
    // oldingi qoldiq. Additiv: eski iste'molchilar faqat `qty` ni o'qiydi.
    return {
      cellId,
      assortmentId,
      qty: String(finalQty),
      previousQty: String(oldQty),
      mode,
      stockDoc,
      // F7: sanalgan deltaning joylashtirish sifatida ko'chgan qismi (additiv).
      placedQty,
    };
  }

  /**
   * F7 — sanalgan deltani joylashtirish manbalaridan yacheykaga ko'chiradi:
   * tartib (1) shu omborning o'z yacheykasiz qoldig'i (store jami o'zgarmaydi),
   * (2) hovuz-ombor (haqiqiy transfer, tannarx bilan). Juft deltalar
   * `cell_place` docType bilan (place() bilan bir semantika), bitta docId.
   * Qaytadi: ko'chgan miqdor (Decimal string) — qolganini chaqiruvchi
   * avto-Оприходование qiladi.
   */
  private async placeCountedFromSources(
    accountId: string,
    userId: string,
    storeId: string,
    cellId: string,
    assortmentId: string,
    qtyStr: string,
  ): Promise<string> {
    const pool = await findPoolStore(this.prisma.client, accountId, { excludeStoreId: storeId });
    const docId = randomUUID();
    let placedMicro = 0n;
    await this.prisma.client.$transaction(
      async (tx) => {
        const storeIds = pool ? [storeId, pool.id] : [storeId];
        const balByStore = new Map<string, Awaited<ReturnType<StockService['lockBalances']>>>();
        for (const sid of [...storeIds].sort()) {
          balByStore.set(
            sid,
            await this.stock.lockBalances(tx, accountId, sid, [
              { kind: 'product', id: assortmentId },
            ]),
          );
        }
        const sources: PlacementSource[] = [];
        for (const sid of storeIds) {
          const bal = balByStore.get(sid)?.get(assortmentId);
          const assigned = await sumAssignedByAssortment(tx, accountId, sid, [
            { kind: 'product', id: assortmentId },
          ]);
          sources.push(
            new PlacementSource({
              storeId: sid,
              qty: bal?.qty ?? '0',
              assignedQty: assigned.get(`product|${assortmentId}`) ?? '0',
              reservedQty: bal?.reservedQty ?? '0',
              costBalanceMinor: bal?.costBalanceMinor ? BigInt(bal.costBalanceMinor) : 0n,
              crossStore: sid !== storeId,
            }),
          );
        }
        const takes = allocatePlacement(sources, parseDecimalScaled(qtyStr));
        placedMicro = totalTakenMicro(takes);
        if (takes.length === 0) return;
        const deltas = takes.flatMap((t) => [
          {
            storeId: t.storeId,
            assortmentKind: 'product',
            assortmentId,
            cellId: null,
            cellMode: 'store-only' as const,
            qtyDelta: `-${t.qty}`,
            costDeltaMinor: t.crossStore ? -t.costMinor : null,
            docType: 'cell_place',
            docId,
            reason: 'post' as const,
          },
          {
            storeId,
            assortmentKind: 'product',
            assortmentId,
            cellId,
            qtyDelta: t.qty,
            costDeltaMinor: t.crossStore ? t.costMinor : null,
            docType: 'cell_place',
            docId,
            reason: 'post' as const,
          },
        ]);
        await this.stock.applyDeltas(tx, accountId, userId, deltas);
      },
      { isolationLevel: 'Serializable', timeout: 20000 },
    );
    return formatDecimalScaled(placedMicro);
  }

  /**
   * Assign products to this cell — ADDS a ProductCellLink row for each
   * (multi-bin, 2026-08-06). Never moves/overwrites: a product already bound
   * elsewhere keeps that binding too, so one product can now sit in several
   * cells and one cell can hold several products (both directions were
   * blocked before — binding used to overwrite the product's single
   * `__yacheyka` home cache, silently unbinding it from wherever it was).
   * The first-ever bind ALSO seeds `__yacheyka`/`__polka` (never overwritten
   * again after that) — old readers (labels, pick-list, the product form's
   * Полка/Ячейка pickers) keep working off that single cache.
   */
  async assignProducts(accountId: string, storeId: string, cellId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const cell = await this.cellWithZone(accountId, storeId, cellId);
    const { productIds } = this.parse(AssignProductsSchema, raw);
    const products = await this.prisma.client.product.findMany({
      where: { accountId, id: { in: productIds } },
      select: { id: true, attributes: true },
    });
    const polka = cell.zone?.name ?? '';
    for (const p of products) {
      const base =
        p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes)
          ? (p.attributes as Record<string, unknown>)
          : {};
      // Multi-bin membership row — idempotent (unique on productId+cellId).
      await this.prisma.client.productCellLink.upsert({
        where: { productId_cellId: { productId: p.id, cellId } },
        create: { accountId, productId: p.id, cellId },
        update: {},
      });
      // Seed the home-cell cache ONLY when the product has none yet — never
      // overwrite an existing one (that used to be the bug: a second bind
      // silently moved the product OUT of its first cell).
      const current = typeof base.__yacheyka === 'string' ? base.__yacheyka.trim() : '';
      if (!current) {
        const attrs: Record<string, unknown> = { ...base, __yacheyka: cell.name, __polka: polka };
        await this.prisma.client.product.update({
          where: { id: p.id },
          data: { attributes: attrs as Prisma.InputJsonValue },
        });
      }
    }
    // Report any ids that didn't resolve (deleted / other tenant) — silently skipped.
    return { assigned: products.length, requested: productIds.length };
  }

  /**
   * Remove a product from this cell — deletes its ProductCellLink row (if
   * any) and, when this cell IS the product's `__yacheyka` home cache,
   * clears that too (multi-bin, 2026-08-06: the two used to be one and the
   * same; now a product can have other links left after this call).
   *
   * ⚠️ QOLDIQ QULFI (egasi, 2026-08-11 · Q1). Chiqarish faqat BOG'LANISHNI
   * uzadi — `StockByCell` qatoriga TEGMAYDI. Yacheykada shu mahsulotdan
   * hisoblangan qoldiq bor holda chiqarilsa, ikki sirt bir-biriga zid gapira
   * boshlardi (`getCellStock` tovarni ko'rsatadi, `getCellProducts` yo'q
   * deydi) va keyingi «Umumiy sanash» (`mode:'add'`) FANTOM qoldiq ustiga
   * qo'shardi. Egasining qarori: hujjatsiz stok o'zgarmaydi ⇒ avto-«Списание»
   * YOZILMAYDI, amal RAD ETILADI (409) va foydalanuvchiga yo'l ko'rsatiladi.
   *
   * Qoida `shared/cell-stock-guard.ts` da yashaydi — bu yo'l YAGONA emas:
   * `ProductCellMoveService.rebind` (`POST /products/:id/cell-rebind`) ham
   * `ProductCellLink` ni o'chiradi va u ham shu qulfdan o'tadi (review
   * 2026-08-11 Critical). Qulf + o'chirish BITTA serializable tranzaksiyada:
   * aks holda tekshiruv bilan o'chirish orasida boshqa sessiya sanoq yozib
   * ulgurardi.
   *
   * Qamrov chegarasi (VARIANT qoldig'i tekshirilmaydi) — sabab va oqibati
   * `cell-stock-guard.ts` docblock'ida oshkora yozilgan.
   */
  async unassignProduct(accountId: string, storeId: string, cellId: string, productId: string) {
    await this.assertStore(accountId, storeId);
    const cell = await this.cellWithZone(accountId, storeId, cellId);
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, accountId },
      select: { id: true, attributes: true },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    const base =
      product.attributes &&
      typeof product.attributes === 'object' &&
      !Array.isArray(product.attributes)
        ? (product.attributes as Record<string, unknown>)
        : {};
    const isHome = base.__yacheyka === cell.name;
    const linksRemoved = await this.prisma.client.$transaction(
      async (tx) => {
        await assertCellStockEmpty(tx, {
          accountId,
          storeId,
          cellId,
          cellName: cell.name,
          productId,
        });
        const { count } = await tx.productCellLink.deleteMany({
          where: { accountId, productId, cellId },
        });
        if (isHome) {
          const { __yacheyka: _y, __polka: _p, ...rest } = base;
          await tx.product.update({
            where: { id: product.id },
            data: { attributes: rest as Prisma.InputJsonValue },
          });
        }
        return count;
      },
      { isolationLevel: 'Serializable', timeout: 20000 },
    );
    if (!isHome && linksRemoved === 0) return { unassigned: false };
    return { unassigned: true };
  }

  /**
   * «Привязать к ячейке, если не задана» — bind ONE product's home cell to this
   * cell ONLY when it has none yet. Used by document editors: picking a «Ячейка»
   * for a cell-less product assigns it, but an existing binding is NEVER
   * overwritten (the account chose "bind only when empty"). Idempotent — a
   * product that already has a __yacheyka is left untouched (no-op result).
   */
  async bindProductIfEmpty(accountId: string, storeId: string, cellId: string, productId: string) {
    await this.assertStore(accountId, storeId);
    const cell = await this.cellWithZone(accountId, storeId, cellId);
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, accountId },
      select: { id: true, attributes: true },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    const base =
      product.attributes &&
      typeof product.attributes === 'object' &&
      !Array.isArray(product.attributes)
        ? (product.attributes as Record<string, unknown>)
        : {};
    const current = typeof base.__yacheyka === 'string' ? base.__yacheyka.trim() : '';
    // Already has a home cell → never overwrite; report it so the caller no-ops.
    if (current) return { bound: false, alreadyBound: true };
    const attrs: Record<string, unknown> = {
      ...base,
      __yacheyka: cell.name,
      __polka: cell.zone?.name ?? '',
    };
    await this.prisma.client.product.update({
      where: { id: product.id },
      data: { attributes: attrs as Prisma.InputJsonValue },
    });
    // Multi-bin (2026-08-06): keep the link table in sync so this bind shows
    // up in getCellProducts/getCellStock/getAddressStorage the same way a
    // manual assignProducts bind does.
    await this.prisma.client.productCellLink.upsert({
      where: { productId_cellId: { productId: product.id, cellId } },
      create: { accountId, productId: product.id, cellId },
      update: {},
    });
    return { bound: true, yacheyka: cell.name, polka: cell.zone?.name ?? '' };
  }

  // -------------------------------------------------------------------
  // Zone (Зона) CRUD
  // -------------------------------------------------------------------

  async createZone(accountId: string, storeId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const data = this.parse(CreateZoneSchema, raw);
    await this.assertZoneNameFree(accountId, storeId, data.name);
    try {
      return await this.prisma.client.storeZone.create({
        data: { accountId, storeId, name: data.name, sortOrder: data.sortOrder ?? 0 },
      });
    } catch (e) {
      this.rethrowDuplicate(e, 'zona');
      throw e;
    }
  }

  async updateZone(accountId: string, storeId: string, zoneId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const existing = await this.prisma.client.storeZone.findFirst({
      where: { id: zoneId, storeId, accountId },
    });
    if (!existing) throw new NotFoundException(`Zone ${zoneId} not found`);
    const data = this.parse(UpdateZoneSchema, raw);
    if (data.name !== undefined && data.name !== existing.name) {
      await this.assertZoneNameFree(accountId, storeId, data.name, zoneId);
    }
    const patch: Prisma.StoreZoneUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    try {
      return await this.prisma.client.storeZone.update({ where: { id: zoneId }, data: patch });
    } catch (e) {
      this.rethrowDuplicate(e, 'zona');
      throw e;
    }
  }

  /** Delete a zone. Its cells are SetNull-ed to «Без зоны» by the FK (not deleted). */
  async deleteZone(accountId: string, storeId: string, zoneId: string) {
    await this.assertStore(accountId, storeId);
    const existing = await this.prisma.client.storeZone.findFirst({
      where: { id: zoneId, storeId, accountId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Zone ${zoneId} not found`);
    await this.prisma.client.storeZone.delete({ where: { id: zoneId } });
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // Cell (Ячейка) CRUD
  // -------------------------------------------------------------------

  async createCell(accountId: string, storeId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const data = this.parse(CreateCellSchema, raw);
    if (data.zoneId) await this.assertZoneInStore(accountId, storeId, data.zoneId);
    await this.assertCellNameFree(accountId, storeId, data.name);
    try {
      return await this.prisma.client.storeCell.create({
        data: {
          accountId,
          storeId,
          zoneId: data.zoneId ?? null,
          name: data.name,
          barcode: data.barcode ?? null,
          sortOrder: data.sortOrder ?? 0,
          vitrina: data.vitrina ?? false,
        },
      });
    } catch (e) {
      this.rethrowDuplicate(e, 'yacheyka');
      throw e;
    }
  }

  /**
   * «Diapazon bo'yicha yaratish» — retseptni yoyib, YETISHMAYOTGAN yacheykalarni
   * yaratadi. Mavjud nomlar o'tkazib yuboriladi (idempotent: generator ombor
   * kengayganda qayta ishlatiladi).
   *
   * `dryRun: true` da yozuv qadami o'tkazib yuboriladi, qolgan hamma hisob AYNAN
   * bir xil bajariladi — shuning uchun oldindan ko'rish haqiqiy natijadan farq
   * qila olmaydi.
   */
  async bulkCreateCells(accountId: string, storeId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const input = this.parse(BulkCreateCellsSchema, raw);

    // Zod FAQAT shakl/tipni tekshiradi (`from: -3`, `pad: 9` undan O'TADI) —
    // semantik qoidalar `expandCellRange` da. Uning `CellRangeError`i oddiy
    // foydalanuvchi yozuv xatosi, shuning uchun majburan 400 ga aylantiriladi;
    // boshqa turdagi xato esa yutilmaydi — qayta tashlanadi (500 haqiqiy bug).
    let expanded: ReturnType<typeof expandCellRange>;
    try {
      expanded = expandCellRange(input satisfies CellRangeSpec);
    } catch (e) {
      if (e instanceof CellRangeError) throw new BadRequestException(e.message);
      throw e;
    }

    return this.createMissingCells(accountId, storeId, expanded, input.dryRun);
  }

  /**
   * F3 — «Yangi ombor raqamlashtirish»: ombor raqami + har stelaj uchun
   * qavat/o'rin soni → `NN-SS-QQ-OO` yacheykalar, zona = stelaj (`NN-SS`).
   * Yozish qadami `bulkCreateCells` bilan BITTA (`createMissingCells`) —
   * idempotentlik va dryRun kafolatlari o'sha yerda, ikki nusxada emas.
   */
  async numberWarehouse(accountId: string, storeId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const input = this.parse(WarehouseNumberingSchema, raw);

    let expanded: ExpandedCell[];
    try {
      expanded = expandWarehouseNumbering(input);
    } catch (e) {
      if (e instanceof CellRangeError) throw new BadRequestException(e.message);
      throw e;
    }

    return this.createMissingCells(accountId, storeId, expanded, input.dryRun);
  }

  /**
   * Yoyilgan ro'yxatdan YETISHMAYOTGAN yacheyka/zonalarni yaratadi (yoki
   * `dryRun` da faqat sanaydi). `bulkCreateCells` va `numberWarehouse` uchun
   * yagona yozish yo'li — hisob va yozuv ajralib ketmasin.
   */
  private async createMissingCells(
    accountId: string,
    storeId: string,
    expanded: ExpandedCell[],
    dryRun: boolean,
  ) {
    const names = expanded.map((c) => c.name);
    const existingRows = await this.prisma.client.storeCell.findMany({
      where: { accountId, storeId, name: { in: names } },
      select: { name: true },
    });
    const existing = new Set(existingRows.map((r) => r.name));
    const missing = expanded.filter((c) => !existing.has(c.name));

    const neededZones = [
      ...new Set(missing.map((c) => c.zoneName).filter((z): z is string => !!z)),
    ];
    const existingZones = await this.prisma.client.storeZone.findMany({
      where: { accountId, storeId, name: { in: neededZones } },
      select: { name: true },
    });
    const haveZone = new Set(existingZones.map((z) => z.name));
    const zonesToCreate = neededZones.filter((z) => !haveZone.has(z));

    const base = {
      total: expanded.length,
      toCreate: missing.length,
      existing: existing.size,
      zonesToCreate,
      sample: missing.slice(0, 10).map((c) => c.name),
    };
    if (dryRun) return { ...base, created: 0, zonesCreated: 0 };

    return this.prisma.client.$transaction(async (tx) => {
      // Zonalar: `createZone()` bu yerda ISHLATILMAYDI — u `this.prisma.client`
      // ga bog'langan (tranzaksiyaga moslashmagan), ya'ni uni chaqirish zonalarni
      // tranzaksiyadan tashqarida yozardi va yaratish yiqilganda yetim qoldirardi.
      //
      // `zonesCreated` HAQIQIY `count` dan olinadi, `zonesToCreate.length` dan
      // EMAS — yacheykalardagi bilan bir xil sabab: parallel so'rov o'sha zona
      // nomini orada yaratib ulgursa, `skipDuplicates` uni jimgina o'tkazadi va
      // oldindan hisoblangan son YOLG'ON chiqardi. Bu taskning invarianti —
      // qaytgan sonlar haqiqiy DB natijasini aks ettirishi shart.
      const zoneRes =
        zonesToCreate.length > 0
          ? await tx.storeZone.createMany({
              data: zonesToCreate.map((name) => ({ accountId, storeId, name })),
              skipDuplicates: true,
            })
          : { count: 0 };
      const zoneRows = await tx.storeZone.findMany({
        where: { accountId, storeId, name: { in: neededZones } },
        select: { id: true, name: true },
      });
      const zoneIdByName = new Map(zoneRows.map((z) => [z.name, z.id]));

      const res = await tx.storeCell.createMany({
        data: missing.map((c) => ({
          accountId,
          storeId,
          name: c.name,
          zoneId: c.zoneName ? (zoneIdByName.get(c.zoneName) ?? null) : null,
        })),
        // Parallel sessiya o'sha nomni yaratib qo'ysa ham yiqilmaymiz —
        // DB darajasidagi @@unique([storeId, name]) ga tayanamiz.
        skipDuplicates: true,
      });

      return { ...base, created: res.count, zonesCreated: zoneRes.count };
    });
  }

  async updateCell(accountId: string, storeId: string, cellId: string, raw: unknown) {
    await this.assertStore(accountId, storeId);
    const existing = await this.prisma.client.storeCell.findFirst({
      where: { id: cellId, storeId, accountId },
    });
    if (!existing) throw new NotFoundException(`Cell ${cellId} not found`);
    const data = this.parse(UpdateCellSchema, raw);
    if (data.name !== undefined && data.name !== existing.name) {
      await this.assertCellNameFree(accountId, storeId, data.name, cellId);
    }
    // Tri-state zoneId: undefined leaves it; null clears it; uuid reassigns (verified).
    if (data.zoneId) await this.assertZoneInStore(accountId, storeId, data.zoneId);

    const patch: Prisma.StoreCellUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.barcode !== undefined) patch.barcode = data.barcode;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.vitrina !== undefined) patch.vitrina = data.vitrina;
    if (data.zoneId !== undefined) {
      patch.zone = data.zoneId === null ? { disconnect: true } : { connect: { id: data.zoneId } };
    }
    try {
      return await this.prisma.client.storeCell.update({ where: { id: cellId }, data: patch });
    } catch (e) {
      this.rethrowDuplicate(e, 'yacheyka');
      throw e;
    }
  }

  async deleteCell(accountId: string, storeId: string, cellId: string) {
    await this.assertStore(accountId, storeId);
    const existing = await this.prisma.client.storeCell.findFirst({
      where: { id: cellId, storeId, accountId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Cell ${cellId} not found`);
    // A cell holding stock cannot be deleted (parity «нельзя удалить непустую ячейку»;
    // the StockByCell FK is ON DELETE RESTRICT — we check first for a friendly message).
    const stocked = await this.prisma.client.stockByCell.count({
      where: { accountId, storeId, cellId, qty: { gt: 0 } },
    });
    if (stocked > 0) {
      throw new BadRequestException("Yacheykada tovar qoldig'i bor — avval boshqasiga ko'chiring");
    }
    // Purge residual EMPTY StockByCell rows (qty = 0) — an emptied cell keeps a
    // zero-qty materialized row (outflow decrements to 0 without deleting it), and
    // the RESTRICT FK would otherwise reject the delete with a raw 500 even though
    // the cell holds nothing. A zero row carries no stock (absence == zero), so
    // dropping it is loss-free. Both in one tx so the cell can't gain stock
    // between the purge and the delete.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.stockByCell.deleteMany({ where: { accountId, storeId, cellId, qty: { lte: 0 } } });
      await tx.storeCell.delete({ where: { id: cellId } });
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
    const r = schema.safeParse(raw);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(', '));
    return r.data;
  }

  private async assertZoneNameFree(
    accountId: string,
    storeId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const dup = await this.prisma.client.storeZone.findFirst({
      where: { accountId, storeId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`«${name}» nomli zona allaqachon mavjud`);
  }

  private async assertCellNameFree(
    accountId: string,
    storeId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const dup = await this.prisma.client.storeCell.findFirst({
      where: { accountId, storeId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`«${name}» nomli yacheyka allaqachon mavjud`);
  }

  /** Map a Prisma unique-constraint race (P2002) to a friendly message. */
  private rethrowDuplicate(e: unknown, kind: 'zona' | 'yacheyka'): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new BadRequestException(`Bu nomli ${kind} allaqachon mavjud`);
    }
  }
}
