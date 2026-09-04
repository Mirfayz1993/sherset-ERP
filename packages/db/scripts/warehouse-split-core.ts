/**
 * F4 (2026-08-23 ombor-restrukturizatsiya) — ombor-split rejasining SOF yadro
 * hisobi. SQL/Prisma YO'Q: kirish — xom qatorlar, chiqish — deterministik
 * ijro rejasi (`SplitPlan`). Shu tufayli butun mantiq unit-test bilan
 * qulflanadi (apps/api/src/scripts/warehouse-split-core.test.ts), CLI
 * (`warehouse-split.ts`) esa faqat o'qish/yozish qobig'i.
 *
 * Qoida (reja 3-bo'lim, maqsad-arxitektura):
 *   yacheyka kodi `NN-SS-QQ-OO` → NN = fizik ombor (Store «Ombor NN»),
 *   SS = stelaj (StoreZone nomi «SS»), qolgani kod ichida qoladi.
 *
 * Idempotentlik: reja FAQAT «yacheyka hozir turgan Store ≠ prefiksi ko'rsatgan
 * Store» juftliklardan quriladi. Split o'tgan bazada bunday juftlik qolmaydi
 * ⇒ ikkinchi yugurish bo'sh reja (no-op) beradi.
 *
 * Cost-basis: apps/api/shared/move-cost-basis.ts dagi computeTransferCost
 * bilan AYNAN bir xil arifmetika (o'rtacha tortilgan qiymat, manba bo'shaganda
 * qoldiq tiyinlar to'liq ketadi). packages/db app qatlamiga qaray olmagani
 * uchun mikro-birlik primitivlar shu yerda takrorlangan — manba:
 * apps/api/src/modules/shared/decimal.ts (o'zgartirsangiz ikkalasini birga).
 */

// ---------------------------------------------------------------------------
// Decimal(20,6) ↔ 1e6-scaled bigint (float YO'Q)
// ---------------------------------------------------------------------------

const SCALE = 1_000_000n;

export function parseDecimalScaled(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [intPart = '0', fracPart = ''] = body.split('.');
  const fracPadded = (fracPart + '000000').slice(0, 6);
  const scaled = BigInt(intPart) * SCALE + BigInt(fracPadded || '0');
  return negative ? -scaled : scaled;
}

export function formatDecimalScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  const fracStr = fracPart.toString().padStart(6, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + intPart.toString() + (fracStr ? `.${fracStr}` : '');
}

function roundHalfUp(scaled: bigint, divisor: bigint): bigint {
  if (divisor === 0n) return scaled;
  const half = divisor / 2n;
  if (scaled >= 0n) return (scaled + half) / divisor;
  return -((-scaled + half) / divisor);
}

/** qty × perUnitMinor, tiyinga yarim-yuqoriga yaxlitlab. */
function lineCost(qtyMicro: bigint, perUnitMinor: bigint): bigint {
  return roundHalfUp(qtyMicro * perUnitMinor, SCALE);
}

// ---------------------------------------------------------------------------
// Yacheyka kodi
// ---------------------------------------------------------------------------

export interface ParsedCellCode {
  /** 2 xonaga normallashgan ombor raqami: '1-…' ham '01' bo'ladi. */
  warehouseNo: string;
  /** Stelaj (2-segment) 2 xonaga normallashgan; segment bo'lmasa null. */
  stelaj: string | null;
}

/**
 * `01-02-03-04` → { warehouseNo: '01', stelaj: '02' }.
 * F1 dagi warehousePrefixOf bilan bir semantika (^\d+-), lekin 2 xonadan uzun
 * «prefiks» ombor emas (masalan `123-…`) — null, yacheyka joyida qoladi.
 */
export function parseCellCode(name: string): ParsedCellCode | null {
  const m = /^(\d{1,2})-(\d{1,2})?/.exec(name.trim());
  if (!m || !m[1]) return null;
  const no = Number(m[1]);
  if (no < 1) return null; // «00-…» ombor emas
  const warehouseNo = String(no).padStart(2, '0');
  const stelaj = m[2] ? String(Number(m[2])).padStart(2, '0') : null;
  return { warehouseNo, stelaj };
}

/** Ombor raqamidan Store nomi — bitta joyda, hisobot/UI bir xil ko'rsin. */
export function storeNameFor(warehouseNo: string): string {
  return `Ombor ${warehouseNo}`;
}

/** Yacheykasiz qoldiq qoladigan eski Store'ning yangi nomi (reja F4.1). */
export const UNALLOCATED_STORE_NAME = 'Taqsimlanmagan';

// ---------------------------------------------------------------------------
// Kirish qatorlari (CLI Prisma'dan o'qib beradi)
// ---------------------------------------------------------------------------

export interface CellRow {
  id: string;
  storeId: string;
  name: string;
  zoneId: string | null;
}

export interface StoreRow {
  id: string;
  name: string;
  archived: boolean;
}

export interface StockByCellRow {
  storeId: string;
  cellId: string;
  assortmentKind: string;
  assortmentId: string;
  /** Decimal string. */
  qty: string;
}

export interface StockRow {
  storeId: string;
  assortmentKind: string;
  assortmentId: string;
  qty: string;
  costBalanceMinor: bigint;
}

/**
 * K-reja bo'lak reyestrining qatori (`stock_pieces`) — J1 (T1 qarzi).
 *
 * 🔴 NEGA REJAGA KIRDI. Bo'lak — JISMONIY narsa va u turgan yacheyka bilan
 * birga ko'chadi. Yacheykani ko'chirib bo'lagini eski omborda qoldirsak
 * `stock_pieces.store_id ≠ store_cells.store_id` bo'ladi va K1 sverkasi
 * («Σ faol bo'lak === StockByCell.qty») ikkala omborda ham buziladi: eskisida
 * qoldiqsiz bo'lak, yangisida bo'laksiz qoldiq. Reyestr BO'SH paytda bu
 * ko'rinmaydi — to'lgan kunidan boshlab har split shuni yozib ketardi.
 */
export interface StockPieceRow {
  id: string;
  storeId: string;
  /** NULL = ombor hovuzidagi (yacheykasiz) bo'lak — split unga TEGMAYDI. */
  cellId: string | null;
  assortmentKind: string;
  assortmentId: string;
  /** `active` | `consumed` — ikkalasi ham ko'chadi (pastdagi izohga qarang). */
  status: string;
}

// ---------------------------------------------------------------------------
// Reja (chiqish)
// ---------------------------------------------------------------------------

export interface CellMovePlan {
  cellId: string;
  cellName: string;
  fromStoreId: string;
  /** Maqsad ombor raqami — Store id'si CLI'da hal bo'ladi (bor/yaratiladi). */
  warehouseNo: string;
  /** Maqsad zonasi nomi (stelaj, «SS») yoki null. */
  zoneName: string | null;
}

/** Bitta (yacheyka × assortiment) uchun ledger juftligi + Stock siljishi. */
export interface QtyMovePlan {
  cellId: string;
  cellName: string;
  fromStoreId: string;
  warehouseNo: string;
  assortmentKind: string;
  assortmentId: string;
  /** Imzoli Decimal string — StockByCell qatoridagi qty aynan shu. */
  qty: string;
  /** Ko'chib o'tayotgan qiymat (tiyin); manfiy bo'lmaydi. */
  costMinor: bigint;
}

/**
 * Bitta bo'lakning ko'chishi — yacheykasi bilan birga, AYNI tranzaksiyada.
 *
 * `consumed` bo'laklar ham ko'chadi: ular o'sha yacheykaga bog'langan tarix
 * qatorlari va joyida qoldirilsa `piece.storeId ≠ cell.storeId` degan YANGI
 * nomuvofiqlik klassi tug'ilardi (V1 invariantining bo'lak varianti).
 * Sverkaga faqat `active` kiradi — shuning uchun hisobotda ikkalasi ALOHIDA
 * sanaladi.
 */
export interface PieceMovePlan {
  pieceId: string;
  cellId: string;
  cellName: string;
  fromStoreId: string;
  warehouseNo: string;
  status: string;
}

export interface SplitAnomaly {
  kind:
    | 'unparsed-cell' // kod NN- bilan boshlanmaydi — joyida qoladi
    | 'target-name-clash' // maqsad omborda shu nomli BOSHQA yacheyka bor
    | 'negative-cell-qty' // StockByCell qty < 0 — imzoli ko'chadi, halol
    | 'cell-exceeds-stock' // Σyacheyka > Stock.qty — manba Stock manfiyga ketadi
    | 'piece-store-mismatch'; // bo'lak ombori yacheykasinikiga teng emas (split OLDIN ham buzuq edi)
  detail: string;
}

export interface WarehouseSummaryRow {
  warehouseNo: string;
  cells: number;
  zones: number;
  sbcRows: number;
  /** Σ qty (Decimal string, imzoli). */
  qty: string;
  costMinor: bigint;
  /** Shu omborga ko'chadigan bo'laklar (barcha holatlar). */
  pieces: number;
  /** Ulardan `active` — sverkaga kiradiganlari. */
  activePieces: number;
}

export interface SplitPlan {
  /** Yaratilishi kerak bo'lgan (hali yo'q) omborlar raqamlari, tartibda. */
  warehousesNeeded: string[];
  cellMoves: CellMovePlan[];
  qtyMoves: QtyMovePlan[];
  /** K-reja bo'lak reyestri — yacheyka bilan birga ko'chadiganlar (J1). */
  pieceMoves: PieceMovePlan[];
  /** Ko'chishda qatnashgan manba Store id'lari (rename nomzodlari). */
  sourceStoreIds: string[];
  summary: WarehouseSummaryRow[];
  anomalies: SplitAnomaly[];
}

/** Faol / jami bo'lak sanog'i — hisobot qatorlari bitta joydan chiqsin. */
export function countPieceMoves(moves: readonly PieceMovePlan[]): {
  total: number;
  active: number;
} {
  let active = 0;
  for (const m of moves) if (m.status === 'active') active += 1;
  return { total: moves.length, active };
}

/**
 * Reja quruvchi. Deterministik: kirish tartibidan qat'i nazar chiqish
 * (ombor raqami, yacheyka nomi) bo'yicha saralangan.
 *
 * Maqsad-Store aniqlash: nomi `Ombor NN` bo'lgan arxivlanmagan Store bo'lsa —
 * o'sha (id'si `existingStores` orqali CLI'га ma'lum); bo'lmasa yaratiladi.
 * Yacheyka allaqachon o'z omborida bo'lsa — reja unga TEGMAYDI (idempotentlik).
 */
export function buildSplitPlan(input: {
  cells: CellRow[];
  stores: StoreRow[];
  stockByCell: StockByCellRow[];
  stocks: StockRow[];
  /**
   * K-reja bo'lak reyestri (J1). ATAYLAB IXTIYORIY: reyestr bo'lmagan (yoki
   * hali migratsiya berilmagan) bazada skript avvalgidek ishlashi kerak —
   * bo'lak hisobi yo'qligi split'ni to'xtatadigan sabab emas.
   */
  pieces?: readonly StockPieceRow[];
}): SplitPlan {
  const anomalies: SplitAnomaly[] = [];

  // Nomi bo'yicha maqsad Store'lar (arxivlanmaganlar).
  const storeByName = new Map<string, StoreRow>();
  for (const s of input.stores) {
    if (!s.archived) storeByName.set(s.name, s);
  }
  const storeById = new Map(input.stores.map((s) => [s.id, s]));

  // Maqsad ombordagi mavjud yacheyka nomlari (name-clash guard).
  const cellNamesByStore = new Map<string, Set<string>>();
  for (const c of input.cells) {
    let set = cellNamesByStore.get(c.storeId);
    if (!set) {
      set = new Set();
      cellNamesByStore.set(c.storeId, set);
    }
    set.add(c.name);
  }

  // 1) Yacheyka ko'chishlari.
  const cellMoves: CellMovePlan[] = [];
  const movingCellIds = new Set<string>();
  const warehousesNeededSet = new Set<string>();
  const sourceStoreIds = new Set<string>();
  // Bir maqsad omborga KETAYOTGAN nomlar — ikki manba Store'da bir xil nomli
  // yacheyka bo'lsa (unique faqat store ichida) ikkinchisi to'qnashadi.
  const claimedNames = new Map<string, Set<string>>();
  for (const cell of [...input.cells].sort((a, b) => a.name.localeCompare(b.name))) {
    const parsed = parseCellCode(cell.name);
    if (!parsed) {
      anomalies.push({
        kind: 'unparsed-cell',
        detail: `yacheyka «${cell.name}» (${cell.id}) — kod NN- formatida emas, joyida qoladi`,
      });
      continue;
    }
    const targetName = storeNameFor(parsed.warehouseNo);
    const target = storeByName.get(targetName);
    if (target && target.id === cell.storeId) continue; // allaqachon o'z omborida
    let claimed = claimedNames.get(parsed.warehouseNo);
    if (!claimed) {
      claimed = new Set();
      claimedNames.set(parsed.warehouseNo, claimed);
    }
    const clash =
      claimed.has(cell.name) || (target ? cellNamesByStore.get(target.id)?.has(cell.name) : false);
    if (clash) {
      anomalies.push({
        kind: 'target-name-clash',
        detail: `yacheyka «${cell.name}»: «${targetName}» omborida shu nomli boshqa yacheyka bor — joyida qoladi, qo'lda hal qilinadi`,
      });
      continue;
    }
    claimed.add(cell.name);
    if (!target) warehousesNeededSet.add(parsed.warehouseNo);
    sourceStoreIds.add(cell.storeId);
    movingCellIds.add(cell.id);
    cellMoves.push({
      cellId: cell.id,
      cellName: cell.name,
      fromStoreId: cell.storeId,
      warehouseNo: parsed.warehouseNo,
      zoneName: parsed.stelaj,
    });
  }
  const moveByCellId = new Map(cellMoves.map((m) => [m.cellId, m]));

  // 2) Miqdor ko'chishlari — yacheykasi bilan birga ketadigan StockByCell
  //    qatorlari. Cost sequential: har (manba Store, assortiment) bo'yicha
  //    qoldiq qty/cost yuritiladi, har qator o'z ulushini oladi; oxirgi birlik
  //    manbani bo'shatsa qoldiq tiyin to'liq ketadi (move-cost-basis semantikasi).
  const stockByKey = new Map<string, StockRow>();
  for (const s of input.stocks) {
    stockByKey.set(`${s.storeId}|${s.assortmentKind}|${s.assortmentId}`, s);
  }

  // Har (manba, assortiment) uchun yuruvchi qoldiq (qtyMicro, costMinor).
  const running = new Map<string, { qtyMicro: bigint; costMinor: bigint }>();
  // Σyacheyka > Stock tekshiruvi uchun ko'chayotgan jami (per manba-assortiment).
  const movingTotals = new Map<string, bigint>();

  const sbcMoving = input.stockByCell
    .filter((r) => movingCellIds.has(r.cellId))
    .sort((a, b) => {
      const ma = moveByCellId.get(a.cellId)!;
      const mb = moveByCellId.get(b.cellId)!;
      return (
        ma.warehouseNo.localeCompare(mb.warehouseNo) ||
        ma.cellName.localeCompare(mb.cellName) ||
        a.assortmentKind.localeCompare(b.assortmentKind) ||
        a.assortmentId.localeCompare(b.assortmentId)
      );
    });

  const qtyMoves: QtyMovePlan[] = [];
  for (const row of sbcMoving) {
    const move = moveByCellId.get(row.cellId)!;
    const qtyMicro = parseDecimalScaled(row.qty);
    if (qtyMicro === 0n) continue; // bo'sh qator — yacheyka bilan jim ko'chadi
    if (qtyMicro < 0n) {
      anomalies.push({
        kind: 'negative-cell-qty',
        detail: `«${move.cellName}» ${row.assortmentKind}:${row.assortmentId} qty=${row.qty} < 0 — imzoli ko'chirildi`,
      });
    }

    const key = `${row.storeId}|${row.assortmentKind}|${row.assortmentId}`;
    let run = running.get(key);
    if (!run) {
      const stock = stockByKey.get(key);
      run = {
        qtyMicro: stock ? parseDecimalScaled(stock.qty) : 0n,
        costMinor: stock ? stock.costBalanceMinor : 0n,
      };
      running.set(key, run);
    }
    movingTotals.set(key, (movingTotals.get(key) ?? 0n) + qtyMicro);

    let costMinor = 0n;
    if (qtyMicro > 0n && run.qtyMicro > 0n && run.costMinor !== 0n) {
      if (qtyMicro >= run.qtyMicro) {
        costMinor = run.costMinor; // manba bo'shadi — qoldiq tiyin to'liq ketadi
      } else {
        const perUnit = roundHalfUp(run.costMinor * SCALE, run.qtyMicro);
        costMinor = lineCost(qtyMicro, perUnit);
        if (costMinor > run.costMinor) costMinor = run.costMinor;
      }
    }
    run.qtyMicro -= qtyMicro;
    run.costMinor -= costMinor;

    qtyMoves.push({
      cellId: row.cellId,
      cellName: move.cellName,
      fromStoreId: row.storeId,
      warehouseNo: move.warehouseNo,
      assortmentKind: row.assortmentKind,
      assortmentId: row.assortmentId,
      qty: row.qty,
      costMinor,
    });
  }

  // Σyacheyka > Stock — manba Stock manfiyga ketadi (halol, lekin ko'rinsin).
  for (const [key, movingMicro] of movingTotals) {
    const stock = stockByKey.get(key);
    const haveMicro = stock ? parseDecimalScaled(stock.qty) : 0n;
    if (movingMicro > haveMicro) {
      const [storeId, kind, id] = key.split('|');
      const storeName = storeById.get(storeId ?? '')?.name ?? storeId;
      anomalies.push({
        kind: 'cell-exceeds-stock',
        detail:
          `«${storeName}» ${kind}:${id}: yacheykalardagi ${formatDecimalScaled(movingMicro)} > ` +
          `ombor qoldig'i ${formatDecimalScaled(haveMicro)} — manba Stock manfiy bo'ladi`,
      });
    }
  }

  // 2b) Bo'lak reyestri — yacheykasi bilan birga ketadigan `stock_pieces`
  //     qatorlari (J1). Yacheykasiz (`cellId = null`) bo'laklar hovuzda
  //     QOLADI: ular yacheykaga bog'lanmagan qoldiqning jismoniy ko'rinishi va
  //     o'sha qoldiq ham «Taqsimlanmagan» da qoladi (F4 dizayni).
  const pieceMoves: PieceMovePlan[] = [];
  for (const piece of [...(input.pieces ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!piece.cellId) continue;
    const move = moveByCellId.get(piece.cellId);
    if (!move) continue; // yacheykasi ko'chmayapti — bo'lak ham joyida
    if (piece.storeId !== move.fromStoreId) {
      // Yacheyka bir omborda, bo'lagi boshqasida — split bunga SABAB emas,
      // lekin jim tuzatib ketmaydi ham: ko'chadi va ANOMALIYA sifatida
      // ko'rinadi (aks holda «qayerdan keldi?» degan savol javobsiz qolardi).
      anomalies.push({
        kind: 'piece-store-mismatch',
        detail:
          `bo'lak ${piece.id} («${move.cellName}» yacheykasida) ombori ` +
          `${piece.storeId}, yacheykasiniki esa ${move.fromStoreId} — ` +
          `${storeNameFor(move.warehouseNo)} ga ko'chiriladi`,
      });
    }
    pieceMoves.push({
      pieceId: piece.id,
      cellId: piece.cellId,
      cellName: move.cellName,
      fromStoreId: piece.storeId,
      warehouseNo: move.warehouseNo,
      status: piece.status,
    });
  }

  // 3) Xulosa (ombor kesimida).
  const summaryMap = new Map<string, WarehouseSummaryRow & { qtyMicro: bigint }>();
  for (const m of cellMoves) {
    let row = summaryMap.get(m.warehouseNo);
    if (!row) {
      row = {
        warehouseNo: m.warehouseNo,
        cells: 0,
        zones: 0,
        sbcRows: 0,
        qty: '0',
        qtyMicro: 0n,
        costMinor: 0n,
        pieces: 0,
        activePieces: 0,
      };
      summaryMap.set(m.warehouseNo, row);
    }
    row.cells += 1;
  }
  const zoneSets = new Map<string, Set<string>>();
  for (const m of cellMoves) {
    if (!m.zoneName) continue;
    let set = zoneSets.get(m.warehouseNo);
    if (!set) {
      set = new Set();
      zoneSets.set(m.warehouseNo, set);
    }
    set.add(m.zoneName);
  }
  for (const [no, set] of zoneSets) summaryMap.get(no)!.zones = set.size;
  for (const q of qtyMoves) {
    const row = summaryMap.get(q.warehouseNo)!;
    row.sbcRows += 1;
    row.qtyMicro += parseDecimalScaled(q.qty);
    row.costMinor += q.costMinor;
  }
  for (const p of pieceMoves) {
    const row = summaryMap.get(p.warehouseNo)!;
    row.pieces += 1;
    if (p.status === 'active') row.activePieces += 1;
  }
  const summary = [...summaryMap.values()]
    .sort((a, b) => a.warehouseNo.localeCompare(b.warehouseNo))
    .map(({ qtyMicro, ...row }) => ({ ...row, qty: formatDecimalScaled(qtyMicro) }));

  return {
    warehousesNeeded: [...warehousesNeededSet].sort(),
    cellMoves,
    qtyMoves,
    pieceMoves,
    sourceStoreIds: [...sourceStoreIds].sort(),
    summary,
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// POS-yetuvchanlik qo'riqchisi (M-reja M6, vazifa 1)
// ---------------------------------------------------------------------------

/**
 * 🔴 NEGA BU BOR (2026-08-23 hodisasi, `docs/plans/2026-08-24-split-kassa-hodisasi.md`).
 *
 * Split yacheykani va uning qoldig'ini kod prefiksi bo'yicha «Ombor NN» ga
 * ko'chiradi. Kassa esa tovarni FAQAT `__posPriority` bor va BRAK bo'lmagan
 * omborlardan ko'radi (`retail-allocation.resolveAllocStores`). Ya'ni qoldiq
 * prioritetsiz omborga tushsa — kassir ekranda sonni ko'rib turib chekni
 * YOPOLMAYDI. 2026-08-23 da aynan shu bo'lgan: 273 tovar «Ombor 02» ga ketgan,
 * ertasi kuni savdo 46 daqiqa to'xtagan.
 *
 * UCHTA yo'l bilan tushib qolish mumkin — uchalasi ham shu yerda ushlanadi:
 *   1. `yangi-ombor`   — ombor hali yo'q. `warehouse-split.ts` uni
 *      `prisma.store.create` bilan `attributes` SIZ yaratadi ⇒ prioritetsiz
 *      tug'iladi. (Aynan shu «mina» edi.)
 *   2. `prioritet-yoq` — ombor bor, lekin `__posPriority` qo'yilmagan.
 *   3. `brak-ombori`   — nomi mos keldi-yu, u BRAK ombori (`__brakStore`).
 *      Masalan `99-…` prefiksli yacheyka «Ombor 99» ga tushadi va BRAK kaskadga
 *      ATAYLAB kirmaydi ⇒ qoldiq sotilmay qoladi.
 *
 * Sof funksiya: Prisma yo'q. Chaqiruvchi `Store.attributes` ni o'zi o'qib beradi.
 */
export type UnreachableReason = 'yangi-ombor' | 'prioritet-yoq' | 'brak-ombori';

export interface UnreachableRow {
  warehouseNo: string;
  storeName: string;
  reason: UnreachableReason;
  /** Shu omborga ko'chadigan Σ qty (imzoli Decimal string). */
  qty: string;
  cells: number;
}

export interface ReachabilityReport {
  rows: UnreachableRow[];
  /** Σ qty barcha yetib bo'lmaydigan omborlar bo'yicha. `'0'` ⇒ split xavfsiz. */
  totalQty: string;
  /** Qoldiqsiz bo'lsa ham prioritetsiz tug'iladigan omborlar (kelajak tuzog'i). */
  emptyButUnreachable: string[];
}

/** Maqsad ombor holati — CLI `Store.attributes` dan o'qib beradi. */
export interface TargetStoreState {
  posPriority: number | null;
  isBrak: boolean;
}

/**
 * Split rejasidan «POS yeta olmaydigan qoldiq» ni hisoblaydi.
 *
 * `targetStores` — ombor NOMI bo'yicha (`storeNameFor(no)`), chunki
 * `warehouse-split.ts` maqsadni aynan nom bilan qidiradi. Xaritada yo'q nom =
 * yaratiladigan yangi ombor.
 */
export function checkPosReachability(
  plan: SplitPlan,
  targetStores: ReadonlyMap<string, TargetStoreState>,
): ReachabilityReport {
  const qtyByNo = new Map<string, bigint>();
  for (const q of plan.qtyMoves)
    qtyByNo.set(q.warehouseNo, (qtyByNo.get(q.warehouseNo) ?? 0n) + parseDecimalScaled(q.qty));
  const cellsByNo = new Map<string, number>();
  for (const m of plan.cellMoves)
    cellsByNo.set(m.warehouseNo, (cellsByNo.get(m.warehouseNo) ?? 0) + 1);

  const rows: UnreachableRow[] = [];
  const emptyButUnreachable: string[] = [];
  let totalMicro = 0n;

  for (const no of [...cellsByNo.keys()].sort()) {
    const storeName = storeNameFor(no);
    const state = targetStores.get(storeName);
    let reason: UnreachableReason | null = null;
    if (!state) reason = 'yangi-ombor';
    else if (state.isBrak) reason = 'brak-ombori';
    else if (state.posPriority === null) reason = 'prioritet-yoq';
    if (!reason) continue;

    const micro = qtyByNo.get(no) ?? 0n;
    if (micro === 0n) {
      // Qoldiq ko'chmasa bugun uzilish yo'q — lekin ombor prioritetsiz tug'iladi
      // va unga tushgan BIRINCHI tovar sotilmay qoladi. Jim o'tkazib bo'lmaydi.
      emptyButUnreachable.push(storeName);
      continue;
    }
    totalMicro += micro;
    rows.push({
      warehouseNo: no,
      storeName,
      reason,
      qty: formatDecimalScaled(micro),
      cells: cellsByNo.get(no) ?? 0,
    });
  }

  return { rows, totalQty: formatDecimalScaled(totalMicro), emptyButUnreachable };
}

// ---------------------------------------------------------------------------
// Bosqichma-bosqich split (M-reja M6, vazifa 2)
// ---------------------------------------------------------------------------

/**
 * Rejani BITTA (yoki bir nechta) ombor bilan cheklaydi.
 *
 * 🔴 NEGA. M6 «bir kechada BITTA ombor» deb talab qiladi: 2026-08-23 da
 * hammasi bir zarbada ko'chirilgan va nosozlik ertasi kuni, savdo boshlangach
 * ma'lum bo'lgan. Bitta ombor ko'chsa — smoke ham, qaytarish ham bitta
 * `warehouse-split-revert.ts --from "Ombor NN"` bilan cheklanadi va ta'sir
 * doirasi kichik qoladi.
 *
 * `sourceStoreIds` ham QAYTA hisoblanadi (faqat qolgan ko'chishlar manbalari) —
 * aks holda CLI tegilmagan omborni ham «Taqsimlanmagan» deb qayta nomlash /
 * zona tozalash nomzodiga qo'shib yuborardi.
 */
export function filterPlanTo(plan: SplitPlan, onlyNos: ReadonlySet<string>): SplitPlan {
  if (onlyNos.size === 0) return plan;
  const cellMoves = plan.cellMoves.filter((m) => onlyNos.has(m.warehouseNo));
  const qtyMoves = plan.qtyMoves.filter((m) => onlyNos.has(m.warehouseNo));
  return {
    warehousesNeeded: plan.warehousesNeeded.filter((no) => onlyNos.has(no)),
    cellMoves,
    qtyMoves,
    // Bo'laklar ham ombor bo'yicha kesiladi — aks holda `--only 01` da
    // «bir kechada BITTA ombor» qoidasi buzilib, tegilmagan ombor bo'laklari
    // ham yozuvga tushardi.
    pieceMoves: plan.pieceMoves.filter((m) => onlyNos.has(m.warehouseNo)),
    sourceStoreIds: [...new Set(cellMoves.map((m) => m.fromStoreId))].sort(),
    summary: plan.summary.filter((s) => onlyNos.has(s.warehouseNo)),
    anomalies: plan.anomalies,
  };
}

/** Rejadagi ombor raqamlari (tartiblangan) — `--only` uchun ko'rsatma. */
export function warehouseNosIn(plan: SplitPlan): string[] {
  return [...new Set(plan.cellMoves.map((m) => m.warehouseNo))].sort();
}
