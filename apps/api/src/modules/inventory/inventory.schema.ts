import { z } from 'zod';
import { csvUuid } from '../shared/csv.js';

/**
 * `counted` — N-reja §5-N2: YOPILGAN sanash sessiyasi. `posted` EMAS va hech
 * qachon bo'lmaydi: qoldiq `setCellStock` yozgan avto-hujjatlar bilan
 * ALLAQACHON tenglashgan (§2.1 qo'riqchisi `post` ni 400 bilan rad etadi).
 *
 * Bu yerga qo'shilishining sababi FAQAT ro'yxat filtri: `InventoryFilterSchema`
 * shu enumdan foydalanadi va usiz web `?state=counted` bilan sessiyalarni
 * ajratib ololmasdi. `InventoryTransitionSchema` esa ATAYLAB tegilmadi —
 * `counted` ga o'tish API orqali EMAS, faqat sessiyani yopish yo'li bilan
 * yoziladi (`count-session.service.ts`).
 */
export const InventoryStateSchema = z.enum(['draft', 'posted', 'cancelled', 'counted']);
export type InventoryState = z.infer<typeof InventoryStateSchema>;

export const InventoryTransitionSchema = z.enum(['post', 'cancel']);
export type InventoryTransitionTarget = z.infer<typeof InventoryTransitionSchema>;

/**
 * Inventory position input — user records actualQty (physical count).
 * expectedQty is snapshot at post time from Stock, not input.
 */
export const InventoryPositionInputSchema = z.object({
  assortmentKind: z.enum(['product']).default('product'),
  assortmentId: z.string().uuid(),
  actualQty: z.coerce.string().regex(/^\d+(\.\d{1,6})?$/, 'actualQty must be non-negative'),
  // moysklad «Ячейка» — per-cell recount row. `cellId` = counted StoreCell
  // (validated against the doc's store); `cell` = denormalized «Зона / Ячейка»
  // label. On a cell row expectedQty is snapshot from StockByCell at post time
  // and the variance delta carries cellId (Stock + StockByCell move together).
  cellId: z.string().uuid().nullish(),
  cell: z.string().max(255).nullish(),
  // K5 (bo'linadigan tovar) — omborchi SANAGAN bo'lak tarkibi:
  // «250x3 + BLK-000041:200 + ?:150» (butun rulonlar × soni, mavjud bo'laklar
  // yorlig'i bo'yicha, yangilari «?» bilan). Faqat `pieceTracked` tovarlarda
  // ma'noli; post paytida bo'lak reyestri shu tarkibga TENGLASHTIRILADI.
  // Σ tarkib === actualQty bo'lishi SHART (`matchQuantity`), aks holda reyestr
  // va qoldiq post bo'lgan zahoti bir-biriga zid bo'lardi.
  pieceEntry: z.string().max(4000).nullish(),
});
export type InventoryPositionInput = z.infer<typeof InventoryPositionInputSchema>;

export const CreateInventorySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  // moysklad parity — Проект (internal stock doc: no counterparty → no Договор).
  projectId: z.string().uuid().nullish(),
  moment: z.coerce.date().optional(),
  description: z.string().max(4000).nullish(),
  // moysklad parity (§17) — universal «Внешний код» (col exists, no migration).
  externalCode: z.string().max(50).nullish(),
  positions: z.array(InventoryPositionInputSchema),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type CreateInventoryInput = z.infer<typeof CreateInventorySchema>;

export const UpdateInventorySchema = CreateInventorySchema.partial().extend({
  positions: z.array(InventoryPositionInputSchema).optional(),
  version: z.number().int().nonnegative(),
});
export type UpdateInventoryInput = z.infer<typeof UpdateInventorySchema>;

const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

/**
 * POST /inventories/position-meta — grid enrichment for the Инвентаризация
 * editor (owner report 2026-07-14 band 3). Body (POST, not GET query) because
 * a «Дополнить из номенклатуры» fill can push thousands of assortment ids —
 * far past safe URL length. Returns per-product: catalog fields (drives the
 * in-grid «Фильтр»), the store's «Расчетный остаток», per-unit cost («Цена»)
 * and the StockByCell breakdown («Остатки по ячейке» tab).
 */
export const InventoryPositionMetaSchema = z.object({
  storeId: z.string().uuid(),
  assortmentIds: z.array(z.string().uuid()).max(5000),
});
export type InventoryPositionMetaInput = z.infer<typeof InventoryPositionMetaSchema>;

/**
 * GET /inventories/fill-candidates — id list for the two grid fill actions:
 *   source=stock       → «Дополнить из остатков» (every product with a non-zero
 *                        calculated balance at the store)
 *   source=assortment  → «Дополнить из номенклатуры» (a product / a folder
 *                        subtree / the ENTIRE catalog when neither id is given —
 *                        moysklad: «будет добавлен весь справочник номенклатуры»)
 * The fill itself is client-side grid state (moysklad appends rows to the
 * unsaved grid; «Сохранить» persists) — this endpoint only supplies ids + qty.
 */
export const InventoryFillCandidatesSchema = z.object({
  storeId: z.string().uuid(),
  source: z.enum(['stock', 'assortment']),
  productId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
});
export type InventoryFillCandidatesInput = z.infer<typeof InventoryFillCandidatesSchema>;

export const InventoryFilterSchema = z.object({
  state: InventoryStateSchema.optional(),
  organizationId: z.string().uuid().optional(),
  organizationIds: csvUuid.optional(),
  /** «Склад» — Inventory.storeId. */
  storeId: z.string().uuid().optional(),
  /** «Проект» — Inventory.projectId. */
  projectId: z.string().uuid().optional(),
  /** «Владелец-отдел» — Inventory.groupId. */
  groupId: z.string().uuid().optional(),
  /** «Владелец-сотрудник» — Inventory.ownerId. */
  ownerId: z.string().uuid().optional(),
  /** «Проведено» — Inventory.applicable flag. */
  applicable: boolFromString.optional(),
  /** «Напечатано» — Inventory.printed flag. */
  printed: boolFromString.optional(),
  /** «Отправлено» — Inventory.published flag. */
  published: boolFromString.optional(),
  search: z.string().max(100).optional(),
  includeDeleted: boolFromString.optional(),
  momentFrom: z.string().optional(),
  momentTo: z.string().optional(),
  /**
   * «Когда изменен» — moysklad parity. Filters on `updatedAt` between the
   * two ISO dates (mirror momentFrom/To).
   */
  updatedFrom: z.string().optional(),
  updatedTo: z.string().optional(),
  /**
   * «Сумма» — Inventory DOES carry a `sumMinor` column (schema.prisma
   * 5913: "Sum of (counted_qty × cost) — populated when the recount is
   * finalised"). Backed → exposed.
   */
  sumMinorFrom: z.coerce.number().int().nonnegative().optional(),
  sumMinorTo: z.coerce.number().int().nonnegative().optional(),
  // NOTE: «Кто изменил» (modifiedById) is SKIPPED — the Inventory model
  // has no `updatedById` column (only `ownerId` / `groupId`), so there is
  // no backed way to filter "last modified by". Surfacing it would
  // require a schema migration outside this panel-parity task. Physical
  // recount also has NO agentId / contractId / agentAccountId /
  // organizationAccountId / salesChannelId (N/A — no counterparty), so
  // those filters are absent.
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
  // moysklad parity — relational sort for organization / store exposed by
  // the list-view column headers (handled by
  // InventoryService.buildListWhere's orderBy special-case). `sumMinor`
  // added since the column is backed.
  sortBy: z.enum(['moment', 'name', 'sumMinor', 'organization', 'store']).default('moment'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type InventoryFilterInput = z.infer<typeof InventoryFilterSchema>;
