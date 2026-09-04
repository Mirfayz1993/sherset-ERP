import type { Prisma } from '@moysklad/db';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { allocateDocumentNumber } from '../../prisma/document-number.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AttributeMetadataService } from '../attribute-metadata/attribute-metadata.service.js';
import { tashkentRangeBounds } from '../report/report-date-bounds.util.js';
import {
  compareDecimals,
  computeLineCost,
  computePerUnitCost,
  formatDecimalScaled,
  parseDecimalScaled,
  subtractDecimals,
} from '../shared/decimal.js';
import { resolveCreatorGroupId } from '../shared/group-stamp.js';
import { mapVersionedUpdateError } from '../shared/optimistic-lock.js';
import { PlacementSource, allocatePlacement, totalTakenMicro } from '../shared/pool-placement.js';
import { withSerializationRetry } from '../shared/serialization-retry.js';
import {
  intakeErrorMessage,
  matchQuantity,
  parsePieceEntry,
  quantityMismatchMessage,
} from '../stock-piece/piece-intake-core.js';
import { applyPieceRecount } from '../stock-piece/stock-piece-intake.service.js';
import { findPoolStore, sumAssignedByAssortment } from '../stock/pool-store.util.js';
import { type StockDelta, StockService } from '../stock/stock.service.js';
import { WebhookFireService } from '../webhook/webhook-fire.service.js';
import {
  type CreateInventoryInput,
  CreateInventorySchema,
  InventoryFillCandidatesSchema,
  type InventoryFilterInput,
  InventoryFilterSchema,
  InventoryPositionMetaSchema,
  InventoryTransitionSchema,
  type InventoryTransitionTarget,
  type UpdateInventoryInput,
  UpdateInventorySchema,
} from './inventory.schema.js';

/**
 * One recount line's variance + cost basis — EXACT, no float (STK-05).
 *
 * The old inline math ran every one of these through `Number()`:
 *   varianceQty  = String(Number(actual) - Number(expected))   → "0.19999999999999998"
 *                                                              → "1.0000000116860974e-7"
 *   unitCost     = Math.round(Number(costBalanceMinor) / Number(expected))
 *   varianceCost = BigInt(Math.round(variance × unitCost))
 * The first two land straight in a Decimal(20,6) column; the third silently
 * rounds any cost basis past 2^53 tiyin, breaking the post↔cancel zero-sum
 * that `cancel()` recomputes from the persisted snapshot.
 *
 * Contract (unchanged semantics, exact arithmetic):
 *   unitCostMinor  — the store's weighted average (costBalanceMinor ÷ basis)
 *                    when there IS a basis, else the product's buyPrice, else 0.
 *   varianceCostMinor — null when there is no basis at all (so applyDeltas
 *                    leaves costBalanceMinor untouched rather than writing 0 —
 *                    the retail-cost-freeze NULL contract).
 *   lineSumMinor   — actualQty × unitCost, the doc's «Сумма» contribution.
 *
 * basisQty (optional) — the qty the cost basis divides over. Store-level rows
 * omit it (basis = expectedQty, unchanged semantics). A CELL row's expectedQty
 * is the cell's StockByCell qty, but costBalanceMinor is STORE-level — dividing
 * by the cell qty would inflate the per-unit cost, so the caller passes the
 * store's Stock.qty here instead.
 */
export function computeVarianceLine(input: {
  expectedQty: string;
  actualQty: string;
  costBalanceMinor: bigint;
  buyPriceMinor: bigint;
  basisQty?: string;
}): {
  varianceQty: string;
  unitCostMinor: bigint;
  varianceCostMinor: bigint | null;
  lineSumMinor: bigint;
} {
  const varianceQty = subtractDecimals(input.actualQty, input.expectedQty);
  const basisQty = input.basisQty ?? input.expectedQty;
  const hasBasis = compareDecimals(basisQty, '0') > 0 && input.costBalanceMinor > 0n;
  const unitCostMinor = hasBasis
    ? computePerUnitCost(input.costBalanceMinor, basisQty)
    : input.buyPriceMinor;
  return {
    varianceQty,
    unitCostMinor,
    varianceCostMinor: unitCostMinor > 0n ? computeLineCost(varianceQty, unitCostMinor) : null,
    lineSumMinor: unitCostMinor > 0n ? computeLineCost(input.actualQty, unitCostMinor) : 0n,
  };
}

/**
 * cancel()'s exact reversal of one posted variance line — the negation of
 * what computeVarianceLine produced, recomputed from the SAME persisted
 * (varianceQty, costMinor) snapshot, so post→cancel nets to zero tiyin-for-
 * tiyin regardless of what stock did in between.
 */
export function reverseVarianceCost(varianceQty: string, unitCostMinor: bigint): bigint | null {
  if (unitCostMinor <= 0n) return null;
  return -computeLineCost(varianceQty, unitCostMinor);
}

/** `assertNotCountSession` rad etadigan amallar. */
export type CountSessionGuardedAction = 'post' | 'cancel' | 'update';

const COUNT_SESSION_REFUSAL: Record<CountSessionGuardedAction, string> = {
  post: 'Sanash sessiyasi post qilinmaydi: qoldiq allaqachon avto-hujjatlar bilan tenglashgan',
  cancel: 'Sanash sessiyasi bekor qilinmaydi: qoldiq allaqachon avto-hujjatlar bilan tenglashgan',
  update: 'Sanash sessiyasi tahrirlanmaydi: hujjat omborchining sanoq izi',
};

/**
 * 🔴 SANASH SESSIYASI QO'RIQCHISI (N-reja §2.1, §5-N1).
 *
 * `countSession = true` hujjat — omborchi TSD'da sanagan narsaning IZI, buyruq
 * EMAS: `setCellStock` qoldiqni sanoq PAYTIDA avto-Оприходование /
 * avto-Списание bilan allaqachon tenglashtirgan. Shu sababli:
 *
 *   · `post`   — `applyDeltas` farqni qoldiqqa IKKINCHI marta yozardi;
 *   · `cancel` — u ham `applyDeltas` chaqiradi, ya'ni HECH QACHON qo'llanmagan
 *                deltani «teskari» qilib qoldiqni buzardi;
 *   · `update` — `positions` berilganda `deleteMany` sanoq izini yo'q qilardi.
 *
 * Bayroq ATAYLAB haqiqiy ustunda (`inventories.count_session`), `attributes` da
 * EMAS — `validateAndNormalize` metadatasiz kalitni jimgina tashlab, birinchi
 * tahrirdayoq qo'riqchini o'chirib qo'yardi (§2.2).
 */
export function assertNotCountSession(
  doc: { countSession?: boolean | null },
  action: CountSessionGuardedAction,
): void {
  if (doc.countSession !== true) return;
  throw new BadRequestException(COUNT_SESSION_REFUSAL[action]);
}

/**
 * InventoryService — physical recount with variance handling.
 *
 * post() contract:
 *   1. For each position: snapshot expectedQty from current Stock row
 *   2. Compute varianceQty = actualQty - expectedQty (signed)
 *   3. Emit one StockOperation per position to ALIGN Stock to actualQty:
 *        - If variance > 0 (surplus): +qty with docType='inventory_surplus'
 *        - If variance < 0 (shortage): -qty with docType='inventory_shortage'
 *        - If variance = 0: skip
 *   4. Persist expectedQty + varianceQty on InventoryPosition for audit
 *   5. Audit 'inventory.posted' with total surplus/shortage counts
 *
 * Unlike other docs, Inventory does NOT have 'unpost' — once reconciled,
 * the physical count is the truth. To revert, cancel (which emits opposite
 * deltas).
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(AttributeMetadataService) private readonly attrs: AttributeMetadataService,
    @Inject(WebhookFireService) private readonly webhookFire: WebhookFireService,
  ) {}

  async list(accountId: string, rawFilter: unknown) {
    const filter = InventoryFilterSchema.parse(rawFilter);
    const where = this.buildListWhere(accountId, filter);

    // moysklad parity: relational sort for organization / store (the
    // list-view exposes these column headers as sortable). Mirror
    // move.service.ts / supply.service.ts buildListWhere orderBy.
    const orderBy =
      filter.sortBy === 'organization'
        ? { organization: { name: filter.sortDir } }
        : filter.sortBy === 'store'
          ? { store: { name: filter.sortDir } }
          : { [filter.sortBy]: filter.sortDir };

    const rows = await this.prisma.client.inventory.findMany({
      where,
      orderBy,
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: {
        organization: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        _count: { select: { positions: true } },
      },
    });
    const hasMore = rows.length > filter.limit;
    const items = hasMore ? rows.slice(0, filter.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
    const total = await this.prisma.client.inventory.count({ where });
    return { items, nextCursor, total };
  }

  /**
   * Shared WHERE builder for `list` (and any future aggregate that reuses
   * the active filter set). Extracted to mirror move.service.ts so the
   * Inventory filter panel reaches moysklad «Инвентаризации» parity
   * (~10 backed fields) without two-place drift. Preserves the accountId
   * tenant guard + deletedAt/includeDeleted soft-delete handling.
   *
   * NOTE: Inventory is an internal warehouse doc — it has NO agentId,
   * agentAccountId, contractId, organizationAccountId, or salesChannelId
   * (no counterparty). DO NOT add those clauses. `sumMinor` IS exposed
   * (schema.prisma:5913 — "Sum of (counted_qty × cost) — populated when
   * the recount is finalised").
   */
  private buildListWhere(
    accountId: string,
    filter: InventoryFilterInput,
  ): Prisma.InventoryWhereInput {
    const momentRange =
      filter.momentFrom || filter.momentTo
        ? {
            moment: tashkentRangeBounds(filter.momentFrom, filter.momentTo),
          }
        : {};
    const updatedRange =
      filter.updatedFrom || filter.updatedTo
        ? {
            updatedAt: tashkentRangeBounds(filter.updatedFrom, filter.updatedTo),
          }
        : {};
    const sumRange =
      filter.sumMinorFrom !== undefined || filter.sumMinorTo !== undefined
        ? {
            sumMinor: {
              ...(filter.sumMinorFrom !== undefined ? { gte: BigInt(filter.sumMinorFrom) } : {}),
              ...(filter.sumMinorTo !== undefined ? { lte: BigInt(filter.sumMinorTo) } : {}),
            },
          }
        : {};

    return {
      accountId,
      ...(filter.includeDeleted ? {} : { deletedAt: null }),
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.organizationIds ? { organizationId: { in: filter.organizationIds } } : {}),
      ...(filter.storeId ? { storeId: filter.storeId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.groupId ? { groupId: filter.groupId } : {}),
      ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
      ...(filter.applicable !== undefined ? { applicable: filter.applicable } : {}),
      ...(filter.printed !== undefined ? { printed: filter.printed } : {}),
      ...(filter.published !== undefined ? { published: filter.published } : {}),
      ...momentRange,
      ...updatedRange,
      ...sumRange,
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { description: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  /**
   * Grid enrichment for the Инвентаризация editor (owner report 2026-07-14
   * band 3): per-assortment catalog fields (in-grid «Фильтр»), the store's
   * «Расчетный остаток» + per-unit cost («Цена»), and the StockByCell rows
   * («Остатки по ячейке» tab). Per-unit cost = weighted-average basis
   * (costBalanceMinor / qty) with a buyPrice fallback — the same source
   * LossService books write-offs from.
   */
  async positionMeta(accountId: string, raw: unknown) {
    const r = InventoryPositionMetaSchema.safeParse(raw);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(', '));
    const { storeId, assortmentIds } = r.data;
    await this.ensureStore(accountId, storeId);
    if (assortmentIds.length === 0) return { items: [] };

    const [products, stocks, cellStocks, cells] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { accountId, id: { in: assortmentIds } },
        select: {
          id: true,
          name: true,
          code: true,
          article: true,
          description: true,
          uom: true,
          barcodes: true,
          buyPrice: true,
          supplierId: true,
          productFolderId: true,
          // K5 — bo'lak hisobi yuritiladigan tovarda sanoq gridi «tarkib»
          // maydonini ochadi (bayroq o'chiq bo'lsa ekran bir bayt ham
          // o'zgarmaydi). Mavjud so'rovga QO'SHILGAN maydon — yangi so'rov yo'q.
          pieceTracked: true,
          supplier: { select: { name: true } },
          productFolder: { select: { name: true } },
        },
      }),
      this.prisma.client.stock.findMany({
        where: {
          accountId,
          storeId,
          assortmentKind: 'product',
          assortmentId: { in: assortmentIds },
        },
        select: { assortmentId: true, qty: true, costBalanceMinor: true },
      }),
      this.prisma.client.stockByCell.findMany({
        where: {
          accountId,
          storeId,
          assortmentKind: 'product',
          assortmentId: { in: assortmentIds },
          qty: { not: 0 },
        },
        select: { assortmentId: true, cellId: true, qty: true },
      }),
      this.prisma.client.storeCell.findMany({
        where: { accountId, storeId },
        select: { id: true, name: true },
      }),
    ]);

    // K5 — bayrog'i YOQILGAN tovarlarning joriy reyestri (ekran «hozir nima
    // yozilgan» ni ko'rsatib, omborchiga tayyor tarkibni beradi — u faqat
    // farqni tuzatadi). Bayroqli tovar bo'lmasa so'rov UMUMAN ketmaydi
    // (K3 `stock-piece-availability` dagi bilan AYNI qoida).
    const trackedIds = products.filter((p) => p.pieceTracked).map((p) => p.id);
    const registryPieces =
      trackedIds.length > 0
        ? await this.prisma.client.stockPiece.findMany({
            where: {
              accountId,
              storeId,
              assortmentKind: 'product',
              assortmentId: { in: trackedIds },
              status: 'active',
            },
            select: { assortmentId: true, cellId: true, length: true, whole: true, label: true },
          })
        : [];
    const piecesByAssortment = new Map<
      string,
      Array<{ cellId: string | null; length: string; whole: boolean; label: string | null }>
    >();
    for (const row of registryPieces) {
      const list = piecesByAssortment.get(row.assortmentId) ?? [];
      list.push({
        cellId: row.cellId,
        length: row.length.toString(),
        whole: row.whole,
        label: row.label,
      });
      piecesByAssortment.set(row.assortmentId, list);
    }

    const stockByAssortment = new Map(stocks.map((s) => [s.assortmentId, s]));
    const cellName = new Map(cells.map((c) => [c.id, c.name]));
    const cellsByAssortment = new Map<
      string,
      Array<{ cellId: string; name: string; qty: string }>
    >();
    for (const row of cellStocks) {
      const list = cellsByAssortment.get(row.assortmentId) ?? [];
      list.push({
        cellId: row.cellId,
        name: cellName.get(row.cellId) ?? row.cellId,
        qty: row.qty.toString(),
      });
      cellsByAssortment.set(row.assortmentId, list);
    }

    return {
      items: products.map((p) => {
        const stock = stockByAssortment.get(p.id);
        const qtyNum = stock ? Number(stock.qty) : 0;
        // Weighted-average per-unit cost (tiyin); buyPrice fallback when the
        // store holds no qty (or no cost basis was ever booked).
        const unitCostMinor =
          stock && qtyNum > 0 && stock.costBalanceMinor > 0n
            ? String(Math.round(Number(stock.costBalanceMinor) / qtyNum))
            : p.buyPrice !== null
              ? p.buyPrice.toString()
              : null;
        return {
          assortmentId: p.id,
          name: p.name,
          code: p.code,
          article: p.article,
          description: p.description,
          uom: p.uom,
          barcodes: p.barcodes,
          supplierId: p.supplierId,
          supplierName: p.supplier?.name ?? null,
          folderId: p.productFolderId,
          folderName: p.productFolder?.name ?? null,
          stockQty: stock ? stock.qty.toString() : '0',
          unitCostMinor,
          cells: cellsByAssortment.get(p.id) ?? [],
          // K5 — bo'lak hisobi: bayroq va joriy reyestr (bayroq o'chiq bo'lsa
          // `false` + bo'sh massiv, ya'ni ekranda hech narsa o'zgarmaydi).
          pieceTracked: p.pieceTracked,
          pieces: piecesByAssortment.get(p.id) ?? [],
        };
      }),
    };
  }

  /**
   * Candidate id list for the grid fill actions («Дополнить из остатков» /
   * «Дополнить из номенклатуры»). The append itself happens client-side in
   * the unsaved grid (moysklad behaviour — «Сохранить» persists).
   */
  async fillCandidates(accountId: string, raw: unknown) {
    const r = InventoryFillCandidatesSchema.safeParse(raw);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(', '));
    const { storeId, source, productId, folderId } = r.data;
    await this.ensureStore(accountId, storeId);

    if (source === 'stock') {
      const rows = await this.prisma.client.stock.findMany({
        where: { accountId, storeId, assortmentKind: 'product', qty: { not: 0 } },
        select: { assortmentId: true, qty: true },
      });
      if (rows.length === 0) return { items: [] };
      // Drop rows whose product was soft-deleted (stale Stock rows survive).
      const live = await this.prisma.client.product.findMany({
        where: { accountId, id: { in: rows.map((x) => x.assortmentId) }, deletedAt: null },
        select: { id: true },
      });
      const liveIds = new Set(live.map((p) => p.id));
      return {
        items: rows
          .filter((x) => liveIds.has(x.assortmentId))
          .map((x) => ({ assortmentId: x.assortmentId, qty: x.qty.toString() })),
      };
    }

    // source === 'assortment' — a product / a folder SUBTREE / the entire catalog.
    let folderIds: string[] | undefined;
    if (folderId) {
      const folders = await this.prisma.client.productFolder.findMany({
        where: { accountId },
        select: { id: true, parentId: true },
      });
      const children = new Map<string | null, string[]>();
      for (const f of folders) {
        const list = children.get(f.parentId) ?? [];
        list.push(f.id);
        children.set(f.parentId, list);
      }
      folderIds = [];
      const queue = [folderId];
      while (queue.length) {
        const cur = queue.pop();
        if (!cur || folderIds.includes(cur)) continue;
        folderIds.push(cur);
        queue.push(...(children.get(cur) ?? []));
      }
    }
    const products = await this.prisma.client.product.findMany({
      where: {
        accountId,
        deletedAt: null,
        archived: false,
        // Услуги/комплекты не инвентаризируются — товары only (positions'
        // assortmentKind enum is ['product']).
        kind: 'product',
        ...(productId ? { id: productId } : {}),
        ...(folderIds ? { productFolderId: { in: folderIds } } : {}),
      },
      select: { id: true },
    });
    if (products.length === 0) return { items: [] };
    const stocks = await this.prisma.client.stock.findMany({
      where: {
        accountId,
        storeId,
        assortmentKind: 'product',
        assortmentId: { in: products.map((p) => p.id) },
      },
      select: { assortmentId: true, qty: true },
    });
    const qtyById = new Map(stocks.map((s) => [s.assortmentId, s.qty.toString()]));
    return {
      items: products.map((p) => ({ assortmentId: p.id, qty: qtyById.get(p.id) ?? '0' })),
    };
  }

  private async ensureStore(accountId: string, storeId: string): Promise<void> {
    const store = await this.prisma.client.store.findFirst({
      where: { id: storeId, accountId },
      select: { id: true },
    });
    if (!store) throw new BadRequestException('Ombor topilmadi');
  }

  async findById(accountId: string, id: string) {
    const inv = await this.prisma.client.inventory.findFirst({
      where: { id, accountId, deletedAt: null },
      include: {
        organization: true,
        store: true,
        project: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true } },
        positions: {
          include: { product: { select: { id: true, name: true, code: true, uom: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!inv) throw new NotFoundException(`Inventory ${id} not found`);
    return inv;
  }

  async create(accountId: string, userId: string, raw: unknown) {
    const parsed = this.parseCreate(raw);
    await this.ensureRefs(accountId, parsed.organizationId, parsed.storeId);
    await this.stock.assertCellsInStore(
      accountId,
      parsed.storeId,
      parsed.positions.map((p) => p.cellId),
    );
    this.assertPieceEntries(parsed.positions);

    const name = await this.nextName(accountId);
    const attributes = await this.attrs.validateAndNormalize(
      accountId,
      'Inventory',
      parsed.attributes,
    );
    const creatorGroupId = await resolveCreatorGroupId(this.prisma.client, accountId, userId);
    try {
      const created = await this.prisma.client.inventory.create({
        data: {
          accountId,
          ownerId: userId,
          groupId: creatorGroupId,
          name,
          organizationId: parsed.organizationId,
          storeId: parsed.storeId,
          projectId: parsed.projectId ?? null,
          externalCode: parsed.externalCode ?? null,
          moment: parsed.moment ? new Date(parsed.moment) : new Date(),
          description: parsed.description,
          attributes: attributes as Prisma.InputJsonValue,
          state: 'draft',
          positions: {
            create: parsed.positions.map((p, idx) => ({
              accountId,
              position: idx + 1,
              assortmentKind: p.assortmentKind,
              assortmentId: p.assortmentId,
              productId: p.assortmentKind === 'product' ? p.assortmentId : null,
              expectedQty: '0',
              actualQty: p.actualQty,
              varianceQty: '0',
              cellId: p.cellId ?? null,
              cell: p.cell ?? null,
              pieceEntry: p.pieceEntry ?? null,
            })),
          },
        },
      });
      await this.logAudit(accountId, userId, 'create', created.id, null);
      this.webhookFire.fireForEvent(accountId, 'inventory', 'CREATE', created.id);
      return created;
    } catch (e) {
      this.handlePrisma(e);
    }
  }

  async update(accountId: string, userId: string, id: string, raw: unknown) {
    const parsed = this.parseUpdate(raw);
    const existing = await this.findById(accountId, id);
    // 🔴 N-reja §5-N1: sanash sessiyasi web'dan TAHRIRLANMAYDI. Sabab mexanik —
    // quyidagi `$transaction` `positions` berilganda `deleteMany` qiladi, ya'ni
    // omborchi TSD'da yozgan sanoq izi (kim, qaysi yacheyka, tizimda nechta edi,
    // qaysi avto-hujjat) bir tahrirda BUTUNLAY o'chib ketardi. Iz — bu rejaning
    // yagona mahsuloti, uni tiklab bo'lmaydi.
    assertNotCountSession(existing, 'update');
    if (existing.applicable) {
      throw new BadRequestException("Provedeno inventory'ni o'zgartirib bo'lmaydi");
    }
    const data: Prisma.InventoryUpdateInput = {};
    if (parsed.description !== undefined) data.description = parsed.description;
    if (parsed.moment !== undefined) data.moment = new Date(parsed.moment);
    if (parsed.organizationId) data.organization = { connect: { id: parsed.organizationId } };
    if (parsed.storeId) data.store = { connect: { id: parsed.storeId } };
    if (parsed.projectId !== undefined) {
      data.project = parsed.projectId
        ? { connect: { id: parsed.projectId } }
        : { disconnect: true };
    }
    if (parsed.externalCode !== undefined) data.externalCode = parsed.externalCode;
    if (parsed.attributes !== undefined) {
      const validated = await this.attrs.validateAndNormalize(
        accountId,
        'Inventory',
        parsed.attributes,
      );
      data.attributes = validated as Prisma.InputJsonValue;
    }

    if (parsed.positions !== undefined) {
      // Cell rows must point at cells of the doc's (possibly re-picked) store.
      await this.stock.assertCellsInStore(
        accountId,
        parsed.storeId ?? existing.storeId,
        parsed.positions.map((p) => p.cellId),
      );
      this.assertPieceEntries(parsed.positions);
      // The destructive deleteMany is deferred into the $transaction below so a
      // version conflict (409) rolls back the delete instead of leaving the
      // count-lines destroyed (Class A — data corruption guard).
      data.positions = {
        create: parsed.positions.map((p, idx) => ({
          accountId,
          position: idx + 1,
          assortmentKind: p.assortmentKind,
          assortmentId: p.assortmentId,
          productId: p.assortmentKind === 'product' ? p.assortmentId : null,
          expectedQty: '0',
          actualQty: p.actualQty,
          varianceQty: '0',
          cellId: p.cellId ?? null,
          cell: p.cell ?? null,
          pieceEntry: p.pieceEntry ?? null,
        })),
      };
    }

    try {
      // Class A: child-row replacement (deleteMany) + the version-guarded header
      // update run in ONE transaction. If the optimistic-lock version filter
      // misses (concurrent edit), the update touches zero rows → P2025 → the
      // deleteMany rolls back, so the count-lines are NOT lost. There is no
      // two-step totals write here — exactly ONE versioned update.
      const updated = await this.prisma.client.$transaction(async (tx) => {
        if (parsed.positions !== undefined) {
          await tx.inventoryPosition.deleteMany({ where: { inventoryId: id, accountId } });
        }
        return tx.inventory.update({
          where: { id, accountId, version: parsed.version },
          data: { ...data, version: { increment: 1 } },
        });
      });
      await this.logAudit(accountId, userId, 'update', id, null);
      this.webhookFire.fireForEvent(accountId, 'inventory', 'UPDATE', id);
      return updated;
    } catch (e) {
      mapVersionedUpdateError(e, 'Inventory');
      this.handlePrisma(e);
    }
  }

  async transition(accountId: string, userId: string, id: string, targetRaw: unknown) {
    const r = InventoryTransitionSchema.safeParse(targetRaw);
    if (!r.success) {
      throw new BadRequestException(
        `Notog'ri transition: ${String(targetRaw)}. Ruxsat: post | cancel`,
      );
    }
    const target: InventoryTransitionTarget = r.data;
    // Serializable konfliktida (40001) AVTOMAT qayta urinish — o'lchangan:
    // 20 qoldiqqa 10 parallel post yuborilganda atigi 2 tasi o'tardi, 8 tasi
    // xom baza xatosi bilan yiqilardi.
    //
    // ⚠️ `findById` HAR URINISHDA qaytadan chaqiriladi (closure ichida). Bu
    // MAJBURIY: yakuniy `update` holat sharti bilan yozmaydi (`where: { id }`),
    // shuning uchun eski `existing` bilan qayta urinilsa, raqib tranzaksiya
    // allaqachon post qilgan hujjat IKKINCHI marta post bo'lib, qoldiqni ikki
    // marta harakatlantirardi. Qayta o'qilgan holat `draft` bo'lmasa, post()
    // biznes-xatosi bilan to'xtaydi va u qayta urinilmaydi.
    const result = await withSerializationRetry(async () => {
      const existing = await this.findById(accountId, id);
      // 🔴 IKKI KARRA QO'LLASHDAN QO'RIQCHI (N-reja §2.1) — bu rejaning o'zagi.
      //
      // Sanash sessiyasining qatorlari `setCellStock` qoldiqni ALLAQACHON
      // tenglashtirgandan KEYIN yoziladi (avto-Оприходование / avto-Списание
      // o'sha zahoti chiqadi). Ya'ni sessiya hujjati — IZ, buyruq emas.
      // `post` ham (`applyDeltas` — post() ichida), `cancel` ham
      // (`applyDeltas` — cancel() ichida) o'sha farqni qoldiqqa IKKINCHI marta
      // yozardi: aynan «361 885 soxta son» sinfidagi hodisa, faqat kattaroq
      // miqyosda. Shuning uchun taqiq ikkala yo'nalishga ham qo'yiladi va
      // ikkalasining ham YAGONA kirish nuqtasi — mana shu joy.
      //
      // Biznes-xatosi ⇒ `withSerializationRetry` uni qayta urinmaydi
      // (u faqat 40001 serializatsiya konfliktini qayta uradi).
      assertNotCountSession(existing, target);
      return target === 'post'
        ? this.post(accountId, userId, id, existing)
        : this.cancel(accountId, userId, id, existing);
    });
    this.webhookFire.fireForEvent(accountId, 'inventory', 'UPDATE', id, ['state']);
    return result;
  }

  async delete(accountId: string, userId: string, id: string) {
    const inv = await this.findById(accountId, id);
    if (inv.applicable || inv.state !== 'draft') {
      throw new BadRequestException("Faqat 'draft' holatidagini o'chirish mumkin");
    }
    await this.prisma.client.inventory.update({
      where: { id, accountId },
      data: { deletedAt: new Date() },
    });
    await this.logAudit(accountId, userId, 'delete', id, null);
    this.webhookFire.fireForEvent(accountId, 'inventory', 'DELETE', id);
    return { ok: true };
  }

  /**
   * Mirrors moysklad's "Скопировать". For Inventory we duplicate just the
   * product list (positions); the new draft will compute fresh expectedQty
   * from current stock when posted, and actualQty starts at 0 for re-counting.
   */
  async clone(accountId: string, userId: string, id: string) {
    const source = await this.prisma.client.inventory.findFirst({
      where: { id, accountId, deletedAt: null },
      include: { positions: { orderBy: { position: 'asc' } } },
    });
    if (!source) {
      throw new BadRequestException('Inventarizatsiya topilmadi');
    }
    const name = await this.nextName(accountId);
    const creatorGroupId = await resolveCreatorGroupId(this.prisma.client, accountId, userId);
    const created = await this.prisma.client.inventory.create({
      data: {
        accountId,
        ownerId: userId,
        groupId: creatorGroupId,
        name,
        organizationId: source.organizationId,
        storeId: source.storeId,
        projectId: source.projectId,
        externalCode: source.externalCode,
        moment: new Date(),
        description: source.description,
        // §61: moysklad «Скопировать» preserves custom-field values
        // (доп. поля) — clone() dropped them (cash/payment clone
        // already preserve them; §39 lossless-clone precedent).
        attributes: (source.attributes ?? {}) as Prisma.InputJsonValue,
        state: 'draft',
        applicable: false,
        // 🔴 N-reja §5-N1: sessiya bayrog'i KO'CHIRILMAYDI (oshkora `false`,
        // ustun defaultiga tayanmasdan — niyat kodda ko'rinib tursin). Nusxa —
        // ODDIY qoralama: unda `actualQty = 0`, ya'ni u sanoq izi emas va
        // omborchi uni post qilib qoldiqni tenglashtirishi KERAK. Bayroq
        // ko'chsa nusxa hech qachon post bo'lmaydigan «o'lik» hujjat bo'lardi.
        // `countedBy` / `closedAt` / `confirmedBy` / `confirmedAt` ham shu
        // sababdan ko'chmaydi — ular MANBA sessiyaning izi.
        countSession: false,
        positions: {
          create: source.positions.map((p) => ({
            accountId,
            position: p.position,
            assortmentKind: p.assortmentKind,
            assortmentId: p.assortmentId,
            productId: p.productId,
            expectedQty: p.expectedQty,
            actualQty: 0,
            varianceQty: p.expectedQty.negated(),
            costMinor: p.costMinor,
            cellId: p.cellId,
            cell: p.cell,
            // K5 — `pieceEntry` ATAYLAB nusxalanmaydi: nusxa `actualQty = 0`
            // bilan keladi (sanoq boshidan yoziladi), tarkib esa eski
            // miqdorniki bo'lardi va Σ tekshiruvidan o'tmasdi.
          })),
        },
      },
    });
    await this.logAudit(accountId, userId, 'clone', created.id, { sourceId: id });
    this.webhookFire.fireForEvent(accountId, 'inventory', 'CREATE', created.id);
    return created;
  }

  // =====================================================================
  private async post(
    accountId: string,
    userId: string,
    id: string,
    existing: Awaited<ReturnType<InventoryService['findById']>>,
  ) {
    if (existing.state !== 'draft') {
      throw new BadRequestException(`Only draft → posted (current: ${existing.state})`);
    }
    // Owner 2026-07-08: «Проведено» toggles freely — an empty doc may be posted
    // (0 positions ⇒ 0 stock delta; moysklad allows it). No position precondition.

    // buyPrice fallback for the per-unit cost snapshot (products with no
    // stock/cost basis at the store) — one query outside the position loop.
    //
    // K5: `pieceTracked` bayrog'i AYNI SO'ROVDA o'qiladi (K3 naqshi —
    // qo'shimcha so'rov YO'Q). Bayroq o'chiq tovarda bo'lak reyestriga
    // UMUMAN tegilmaydi, ya'ni bugungi jonli xulq bir bayt ham o'zgarmaydi.
    const productRows = await this.prisma.client.product.findMany({
      where: {
        accountId,
        id: { in: existing.positions.map((p) => p.assortmentId) },
      },
      select: { id: true, buyPrice: true, pieceTracked: true },
    });
    const buyPriceById = new Map<string, bigint | null>(productRows.map((p) => [p.id, p.buyPrice]));
    const pieceTrackedIds = new Set(productRows.filter((p) => p.pieceTracked).map((p) => p.id));

    return this.prisma.client.$transaction(
      async (tx) => {
        const deltas: StockDelta[] = [];
        let surplusCount = 0;
        let shortageCount = 0;
        let placedCount = 0;
        let sumMinor = 0n;
        // K5 — bo'lak reyestri hizalanishining yig'ma natijasi (audit + javob).
        const recount = {
          kept: 0,
          adjusted: 0,
          created: 0,
          closed: 0,
          labels: [] as string[],
          unknownLabels: [] as string[],
        };

        // F7 — yacheykaga sanalgan ORTIQCHA avval joylashtirish manbalaridan
        // (o'z omborining yacheykasiz qoldig'i → hovuz-ombor) ko'chiriladi;
        // faqat qoplanmagani haqiqiy inventory_surplus bo'ladi. Hovuz
        // belgilanmagan akkauntda manba-ro'yxat bo'sh emas, lekin o'z-ombor
        // qoldig'i ham 0 bo'lsa xulq ESKI bilan bayt-ba-bayt bir xil.
        const placementSources = await this.buildPlacementSources(
          tx,
          accountId,
          existing.storeId,
          existing.positions,
        );

        for (const p of existing.positions) {
          // Snapshot expected qty from current Stock row
          const stockRow = await tx.stock.findFirst({
            where: {
              accountId,
              storeId: existing.storeId,
              assortmentKind: p.assortmentKind,
              assortmentId: p.assortmentId,
            },
            select: { qty: true, costBalanceMinor: true },
          });
          const storeQty = stockRow?.qty?.toString() ?? '0';
          // CELL row: the counter recounted ONE cell, so expected is that cell's
          // StockByCell qty (the store total still holds the un-celled remainder).
          // Store-level row keeps the pre-cell behaviour byte-for-byte.
          let expectedQty = storeQty;
          if (p.cellId) {
            const cellRow = await tx.stockByCell.findUnique({
              where: {
                accountId_storeId_cellId_assortmentKind_assortmentId: {
                  accountId,
                  storeId: existing.storeId,
                  cellId: p.cellId,
                  assortmentKind: p.assortmentKind,
                  assortmentId: p.assortmentId,
                },
              },
              select: { qty: true },
            });
            expectedQty = cellRow?.qty?.toString() ?? '0';
          }
          const actualQty = String(p.actualQty);

          // Per-unit cost snapshot («Цена» column + doc «Итого»/sumMinor):
          // weighted-average basis (costBalanceMinor / qty) with a buyPrice
          // fallback — mirrors the Loss editor's себестоимость preview.
          //
          // Cost delta for the variance — MUST move the cost basis in lock-step
          // with qty, exactly like Loss/Enter do. Passing null (the old bug) kept
          // costBalanceMinor frozen while qty changed → the weighted-average
          // per-unit cost (costBalanceMinor / qty) was corrupted on EVERY recount
          // (e.g. 10 units @1000 recounted to 5 ⇒ 5000/5 = 1000 stays right ONLY
          // if cost also drops by 5×1000; without it 10000/5 = 2000, doubled).
          // varianceQty carries the sign (surplus + / shortage −); surplus enters
          // at the current weighted-average so the average is unshifted, shortage
          // leaves at that same average. All of it exact BigInt (STK-05).
          const {
            varianceQty: varianceStr,
            unitCostMinor,
            varianceCostMinor,
            lineSumMinor,
          } = computeVarianceLine({
            expectedQty,
            actualQty,
            costBalanceMinor: stockRow?.costBalanceMinor ?? 0n,
            buyPriceMinor: buyPriceById.get(p.assortmentId) ?? 0n,
            // Cell row: the store-level cost basis divides over the STORE qty,
            // not the single cell's expected (see computeVarianceLine docblock).
            basisQty: p.cellId ? storeQty : undefined,
          });
          sumMinor += lineSumMinor;
          const varianceSign = compareDecimals(varianceStr, '0');

          // Persist snapshot + variance on position
          await tx.inventoryPosition.update({
            where: { id: p.id },
            data: {
              expectedQty,
              varianceQty: varianceStr,
              costMinor: unitCostMinor > 0n ? unitCostMinor : null,
            },
          });

          // Only emit a delta if there's variance. A cell row carries cellId so
          // applyDeltas mirrors the store delta on that exact StockByCell row
          // (surplus increments it, shortage decrements it) instead of the
          // auto-deduct/home-cell inference used for store-level rows.
          if (varianceSign > 0) {
            surplusCount++;
            // F7 — yacheykali ortiqcha: avval manbalardan (o'z qoldiq → hovuz)
            // «inventory_placement» juftliklari bilan ko'chadi. Manba tomoni
            // yacheykasiz remainder ⇒ cellMode 'store-only' (avto-inferensiya
            // band yacheykani talamasin); maqsad tomoni sanalgan yacheykaga.
            // Hovuzdan kelganda tannarx ham ko'chadi (move-cost-basis).
            let surplusStr = varianceStr;
            if (p.cellId) {
              const sources = placementSources.get(`${p.assortmentKind}|${p.assortmentId}`) ?? [];
              const takes = allocatePlacement(sources, parseDecimalScaled(varianceStr));
              for (const t of takes) {
                placedCount++;
                deltas.push({
                  storeId: t.storeId,
                  assortmentKind: p.assortmentKind,
                  assortmentId: p.assortmentId,
                  cellId: null,
                  cellMode: 'store-only',
                  qtyDelta: `-${t.qty}`,
                  costDeltaMinor: t.crossStore ? -t.costMinor : null,
                  docType: 'inventory_placement',
                  docId: id,
                  docPositionId: p.id,
                  reason: 'post',
                });
                deltas.push({
                  storeId: existing.storeId,
                  assortmentKind: p.assortmentKind,
                  assortmentId: p.assortmentId,
                  cellId: p.cellId,
                  qtyDelta: t.qty,
                  costDeltaMinor: t.crossStore ? t.costMinor : null,
                  docType: 'inventory_placement',
                  docId: id,
                  docPositionId: p.id,
                  reason: 'post',
                });
              }
              surplusStr = subtractDecimals(
                varianceStr,
                formatDecimalScaled(totalTakenMicro(takes)),
              );
            }
            if (compareDecimals(surplusStr, '0') > 0) {
              deltas.push({
                storeId: existing.storeId,
                assortmentKind: p.assortmentKind,
                assortmentId: p.assortmentId,
                cellId: p.cellId ?? null,
                // Qoplanmagan qism uchun tannarx ham qisqargan miqdorga mos —
                // to'liq varianceCostMinor emas (u joylashgan qismni ham o'z
                // ichiga olardi va ombor cost-asosini shishirardi).
                qtyDelta: surplusStr,
                costDeltaMinor:
                  unitCostMinor > 0n ? computeLineCost(surplusStr, unitCostMinor) : null,
                docType: 'inventory_surplus',
                docId: id,
                docPositionId: p.id,
                reason: 'post',
              });
            }
          } else if (varianceSign < 0) {
            shortageCount++;
            deltas.push({
              storeId: existing.storeId,
              assortmentKind: p.assortmentKind,
              assortmentId: p.assortmentId,
              cellId: p.cellId ?? null,
              qtyDelta: varianceStr, // already negative
              costDeltaMinor: varianceCostMinor, // negative — mirrors qty outflow
              docType: 'inventory_shortage',
              docId: id,
              docPositionId: p.id,
              reason: 'post',
            });
          }
        }

        if (deltas.length > 0) {
          await this.stock.applyDeltas(tx, accountId, userId, deltas);
        }

        // ── K5 — bo'lak reyestrini sanoq natijasiga tenglashtirish ─────────
        //
        // 🔴 Qoldiq deltalari bilan BIR TRANZAKSIYADA (yuqorida). Sabab:
        // qoldiq to'g'rilanib reyestr eski qolsa (yoki teskarisi) sverka o'sha
        // zahoti YOLG'ON farq berardi va omborchi qaysi biriga ishonishini
        // bilmasdi. Ikkalasi birga o'tadi yoki ikkalasi ham o'tmaydi.
        //
        // Faqat bayrog'i YOQILGAN tovarda va faqat tarkib KIRITILGAN qatorda.
        // Ikkalasi ham bo'lmasa bu blok umuman ishlamaydi ⇒ bugungi jonli
        // xulq (bayroq hech qayerda yoqilmagan) bir bayt ham o'zgarmaydi.
        for (const p of existing.positions) {
          if (!p.pieceEntry || !pieceTrackedIds.has(p.assortmentId)) continue;
          const entry = this.parsePieceEntryOrThrow(p.pieceEntry, String(p.actualQty));
          const outcome = await applyPieceRecount(
            tx,
            {
              accountId,
              storeId: existing.storeId,
              cellId: p.cellId ?? null,
              assortmentKind: p.assortmentKind,
              assortmentId: p.assortmentId,
            },
            entry,
          );
          recount.kept += outcome.kept;
          recount.adjusted += outcome.adjusted;
          recount.created += outcome.created;
          recount.closed += outcome.closed;
          recount.labels.push(...outcome.labels);
          recount.unknownLabels.push(...outcome.unknownLabels);
        }

        // Atomic state-claim — transition ONLY if still 'draft'. A concurrent
        // post/cancel that already moved the doc gets count=0, we throw, and the
        // whole tx (incl. the stock deltas applied above) rolls back — so stock
        // can never end up adjusted on a doc someone else already cancelled.
        // sumMinor = Σ(actualQty × per-unit cost) — feeds the list «Сумма»
        // column + the editor «Итого» after posting.
        const claimed = await tx.inventory.updateMany({
          where: { id, accountId, state: 'draft' },
          data: { state: 'posted', applicable: true, postedAt: new Date(), sumMinor },
        });
        if (claimed.count === 0) {
          throw new BadRequestException("Holat o'zgardi — hujjatni qayta oching");
        }
        const updated = await tx.inventory.findFirstOrThrow({ where: { id, accountId } });
        await tx.auditLog.create({
          data: {
            accountId,
            userId,
            entity: 'Inventory',
            entityId: id,
            action: 'transition:posted',
            fieldChanges: {
              from: { before: 'draft', after: 'posted' },
              surplusPositions: surplusCount,
              shortagePositions: shortageCount,
              // F7: nechta manba-bo'lak joylashtirish sifatida ko'chdi.
              placementTakes: placedCount,
              // K5: bo'lak reyestri qanday hizalandi (0 lar — bayroq o'chiq).
              pieceRecount: {
                kept: recount.kept,
                adjusted: recount.adjusted,
                created: recount.created,
                closed: recount.closed,
              },
            } as Prisma.InputJsonValue,
          },
        });
        // `pieceRecount` ADDITIV maydon: bosilishi kerak bo'lgan yorliqlarni
        // ekran shundan oladi (kesim oqimidagi yorliq oynasi bilan bir naqsh).
        // Bayroq o'chiq bo'lsa hammasi nol va ro'yxatlar bo'sh.
        return { ...updated, pieceRecount: recount };
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
  }

  private async cancel(
    accountId: string,
    userId: string,
    id: string,
    existing: Awaited<ReturnType<InventoryService['findById']>>,
  ) {
    if (existing.state === 'cancelled') throw new BadRequestException('Oldin cancel qilingan');
    return this.prisma.client.$transaction(async (tx) => {
      // Atomic state-claim FIRST — only one caller wins the transition. A
      // concurrent second cancel (or a post racing this) gets count=0 and aborts
      // BEFORE reversing any delta, so the variance can never be reversed twice
      // (which would double-adjust stock).
      const claimed = await tx.inventory.updateMany({
        where: { id, accountId, state: { not: 'cancelled' } },
        data: { state: 'cancelled', applicable: false },
      });
      if (claimed.count === 0) throw new BadRequestException('Oldin cancel qilingan');

      const wasApplicable = existing.applicable;
      if (wasApplicable) {
        // Reverse the variance deltas we applied on post — EXACTLY negating both
        // the qty and the cost we moved. The cost delta must be the negative of
        // what post applied (round(varianceNum × unitCost)); we recompute it from
        // the persisted varianceQty + costMinor snapshot so it's bit-for-bit the
        // reversal. Passing null (the old bug) left costBalanceMinor decremented
        // by the sale/loss basis but never restored on cancel → drift.
        const deltas: StockDelta[] = [];

        // F7 — post joylashtirish (inventory_placement) juftliklarini yozgan
        // bo'lsa, ularni LEDGERDAN o'qib aynan teskarilaymiz: hovuz/o'z-qoldiq
        // tomoni qaytadi, sanalgan yacheyka bo'shaydi, tannarx bit-ba-bit
        // qaytadi. Snapshot-asosli surplus teskarisi esa joylashgan qismga
        // QISQARADI — aks holda variance ikki marta (placement + surplus)
        // qaytarilib qoldiqni buzardi.
        const placementRows = await tx.stockOperation.findMany({
          where: { accountId, docId: id, docType: 'inventory_placement', reason: 'post' },
          select: {
            storeId: true,
            assortmentKind: true,
            assortmentId: true,
            cellId: true,
            qtyDelta: true,
            costDeltaMinor: true,
            docPositionId: true,
          },
        });
        const placedByPosition = new Map<string, bigint>();
        for (const r of placementRows) {
          const micro = parseDecimalScaled(r.qtyDelta.toString());
          // Musbat tomon — sanalgan yacheykaga kirgan qism (doc ombori).
          if (micro > 0n && r.docPositionId) {
            placedByPosition.set(
              r.docPositionId,
              (placedByPosition.get(r.docPositionId) ?? 0n) + micro,
            );
          }
          deltas.push({
            storeId: r.storeId,
            assortmentKind: r.assortmentKind,
            assortmentId: r.assortmentId,
            cellId: r.cellId,
            // Yacheykasiz (manba) tomonining qaytishi ham store-only: hovuzga
            // qaytgan tovar uy-yacheyka inferensiyasiga tushmasin.
            ...(r.cellId ? {} : { cellMode: 'store-only' as const }),
            qtyDelta: subtractDecimals('0', r.qtyDelta.toString()),
            costDeltaMinor: r.costDeltaMinor == null ? null : -r.costDeltaMinor,
            docType: 'inventory_placement',
            docId: id,
            docPositionId: r.docPositionId,
            reason: 'cancel',
          });
        }

        for (const p of existing.positions) {
          const varianceQty = String(p.varianceQty);
          const placedMicro = placedByPosition.get(p.id) ?? 0n;
          // Joylashgan qism placement-negatsiyada qaytdi; surplus sifatida
          // faqat qoplanmagan qism yozilgan edi — shuni teskarilaymiz.
          const reverseQty =
            placedMicro > 0n
              ? formatDecimalScaled(parseDecimalScaled(varianceQty) - placedMicro)
              : varianceQty;
          if (compareDecimals(reverseQty, '0') === 0) continue;
          const unitCost = p.costMinor ?? 0n;
          deltas.push({
            storeId: existing.storeId,
            assortmentKind: p.assortmentKind,
            assortmentId: p.assortmentId,
            // Cell row reverses on the SAME cell it adjusted at post time.
            cellId: p.cellId ?? null,
            qtyDelta: subtractDecimals('0', reverseQty), // reverse sign, exact
            costDeltaMinor: reverseVarianceCost(reverseQty, unitCost),
            docType: 'inventory_cancel',
            docId: id,
            docPositionId: p.id,
            reason: 'cancel',
          });
        }
        if (deltas.length > 0) {
          await this.stock.applyDeltas(tx, accountId, userId, deltas);
        }
      }
      const updated = await tx.inventory.findFirstOrThrow({ where: { id, accountId } });
      await tx.auditLog.create({
        data: {
          accountId,
          userId,
          entity: 'Inventory',
          entityId: id,
          action: 'transition:cancelled',
          fieldChanges: {
            from: { before: existing.state, after: 'cancelled' },
          } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  /**
   * F7 — yacheykali qatorlar uchun joylashtirish manbalari, tovar kesimida.
   * Tartib: (1) hujjat omborining O'Z yacheykasiz qoldig'i (Stock − Σyacheyka −
   * rezerv; masalan Move bilan kelib hali joylashtirilmagan tovar) — store
   * jami o'zgarmaydi; (2) `__unassignedSource` hovuz-ombori — haqiqiy
   * omborlararo transfer (tannarx bilan). Ikkala manba ham `lockBalances`
   * bilan qulflanadi (store id tartibida — deadlock oldini olish), shuning
   * uchun parallel POS-sotuv/joylashtirish bir tovarni ikki marta ololmaydi.
   * Hovuz yo'q va o'z-qoldiq 0 bo'lsa take'lar bo'sh ⇒ eski xulq saqlanadi.
   */
  private async buildPlacementSources(
    tx: Prisma.TransactionClient,
    accountId: string,
    storeId: string,
    positions: Array<{ assortmentKind: string; assortmentId: string; cellId: string | null }>,
  ): Promise<Map<string, PlacementSource[]>> {
    const out = new Map<string, PlacementSource[]>();
    const cellPositions = positions.filter((p) => p.cellId);
    if (cellPositions.length === 0) return out;

    const seen = new Set<string>();
    const assorts: Array<{ kind: string; id: string }> = [];
    for (const p of cellPositions) {
      const key = `${p.assortmentKind}|${p.assortmentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      assorts.push({ kind: p.assortmentKind, id: p.assortmentId });
    }

    const pool = await findPoolStore(tx, accountId, { excludeStoreId: storeId });
    const storesToLock = [storeId, ...(pool ? [pool.id] : [])].sort();
    const balByStore = new Map<string, Awaited<ReturnType<StockService['lockBalances']>>>();
    for (const sid of storesToLock) {
      balByStore.set(sid, await this.stock.lockBalances(tx, accountId, sid, assorts));
    }
    const ownAssigned = await sumAssignedByAssortment(tx, accountId, storeId, assorts);
    const poolAssigned = pool
      ? await sumAssignedByAssortment(tx, accountId, pool.id, assorts)
      : new Map<string, string>();

    for (const a of assorts) {
      const key = `${a.kind}|${a.id}`;
      const sources: PlacementSource[] = [];
      const own = balByStore.get(storeId)?.get(a.id);
      sources.push(
        new PlacementSource({
          storeId,
          qty: own?.qty ?? '0',
          assignedQty: ownAssigned.get(key) ?? '0',
          reservedQty: own?.reservedQty ?? '0',
          costBalanceMinor: own?.costBalanceMinor ? BigInt(own.costBalanceMinor) : 0n,
          crossStore: false,
        }),
      );
      if (pool) {
        const pb = balByStore.get(pool.id)?.get(a.id);
        if (pb) {
          sources.push(
            new PlacementSource({
              storeId: pool.id,
              qty: pb.qty,
              assignedQty: poolAssigned.get(key) ?? '0',
              reservedQty: pb.reservedQty,
              costBalanceMinor: pb.costBalanceMinor ? BigInt(pb.costBalanceMinor) : 0n,
              crossStore: true,
            }),
          );
        }
      }
      out.set(key, sources);
    }
    return out;
  }

  // =====================================================================
  // K5 — bo'lak tarkibi (`pieceEntry`)
  // =====================================================================

  /**
   * Kiritilgan tarkibni o'qiydi va uni qator MIQDORIGA solishtiradi.
   *
   * Ikkalasi ham SHU YERDA, bitta joyda: `create`/`update` erta signal berish
   * uchun chaqiradi (omborchi hujjatni saqlashda darhol ko'radi), `post` esa
   * himoya qavati sifatida — qator hujjat saqlangandan keyin ham
   * o'zgartirilgan bo'lishi mumkin emas, lekin post reyestrga YOZADI va
   * yozishdan oldin tekshirmaslik 2026-08-24 sinfidagi xato bo'lardi.
   */
  private parsePieceEntryOrThrow(raw: string, quantity: string) {
    const { entry, error, groupIndex } = parsePieceEntry(raw);
    if (!entry) throw new BadRequestException(intakeErrorMessage(error ?? 'bad-group', groupIndex));
    if (matchQuantity(entry.total, quantity) !== 'exact') {
      throw new BadRequestException(quantityMismatchMessage(entry.total, quantity));
    }
    return entry;
  }

  /**
   * Hujjatdagi HAMMA `pieceEntry` li qatorni tekshiradi.
   *
   * 🔴 Bayroqdan QAT'I NAZAR: tarkib kiritilgan bo'lsa u to'g'ri bo'lishi
   * kerak. Bayroq esa post paytida hal qiladi — yozish yo'liga faqat
   * `pieceTracked` tovar kiradi. Ya'ni bayroq o'chiq tovarda noto'g'ri matn
   * ham 400 oladi (jimgina saqlanib, keyin bayroq yoqilganda «post
   * qilinmayapti» bo'lib chiqishidan yaxshiroq).
   */
  private assertPieceEntries(
    positions: ReadonlyArray<{ actualQty: string; pieceEntry?: string | null }>,
  ): void {
    for (const p of positions) {
      if (!p.pieceEntry) continue;
      this.parsePieceEntryOrThrow(p.pieceEntry, p.actualQty);
    }
  }

  private parseCreate(raw: unknown): CreateInventoryInput {
    const r = CreateInventorySchema.safeParse(raw);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(', '));
    return r.data;
  }
  private parseUpdate(raw: unknown): UpdateInventoryInput {
    const r = UpdateInventorySchema.safeParse(raw);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(', '));
    return r.data;
  }

  private async ensureRefs(
    accountId: string,
    organizationId: string,
    storeId: string,
  ): Promise<void> {
    const [org, store] = await Promise.all([
      this.prisma.client.organization.findFirst({ where: { id: organizationId, accountId } }),
      this.prisma.client.store.findFirst({ where: { id: storeId, accountId } }),
    ]);
    if (!org) throw new BadRequestException('Tashkilot topilmadi');
    if (!store) throw new BadRequestException('Ombor topilmadi');
  }

  private async nextName(accountId: string): Promise<string> {
    const n = await allocateDocumentNumber(this.prisma.client, accountId, 'inventory', async () => {
      // moysklad-parity: plain 5-digit zero-padded «Номер» (no prefix). Seed = highest
      // TRAILING number across all names (handles legacy prefixed + new plain) → continues.
      const rows = await this.prisma.client.inventory.findMany({
        where: { accountId },
        select: { name: true },
      });
      let max = 0;
      for (const r of rows) {
        const m = r.name.match(/\d+$/);
        if (m) max = Math.max(max, Number.parseInt(m[0], 10) || 0);
      }
      return max;
    });
    return String(n).padStart(5, '0');
  }

  private async logAudit(
    accountId: string,
    userId: string,
    action: string,
    entityId: string,
    fieldChanges: Record<string, unknown> | null,
  ): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        accountId,
        userId,
        entity: 'Inventory',
        entityId,
        action,
        fieldChanges: fieldChanges as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private handlePrisma(e: unknown): never {
    const err = e as { code?: string; meta?: { target?: string[] } };
    if (err.code === 'P2002') {
      throw new ConflictException(
        `Bu qiymat bilan inventory mavjud: ${err.meta?.target?.join(', ')}`,
      );
    }
    throw e as Error;
  }
}
