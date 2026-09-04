/**
 * H5 (2026-08-24 split-kassa hodisasi) — soxta «mashq» qoldig'ini hisobdan
 * chiqarish rejasining SOF yadrosi. SQL/Prisma YO'Q: kirish — xom balans
 * qatorlari, chiqish — deterministik ijro rejasi. Butun mantiq DB'siz
 * unit-test bilan qulflanadi (apps/api/src/scripts/stock-baseline-cleanup-core.test.ts).
 *
 * MUAMMO: kassirlar mashqi uchun ~4428 tovarga 9 000–11 000 oralig'ida
 * YACHEYKASIZ qoldiq kiritilgan (jami ≈48,65 mln dona). Omborchi haqiqiy
 * sonni yacheykaga sanab yozadi, lekin soxta qoldiq ombor jamisida turaveradi
 * va kassa haqiqatni ko'rmaydi.
 *
 * ⚠️ IKKI QOIDA — ikkalasi ham hodisadan o'rganilgan:
 *
 * 1. **`StockByCell` ga TEGILMAYDI.** Faqat yacheykasiz ortiqcha kamayadi.
 *    Sabab: `stock.service.ts` ombor-darajali CHIQIMni yacheykalardan
 *    «katta-birinchi» avtomatik ayiradi — ya'ni oddiy chiqim yozsak endigina
 *    sanalgan yacheykani buzardi. Shuning uchun bu skript Stock qatorini
 *    O'ZI yozadi (`cellMode:'store-only'` semantikasi) va ledger'ga
 *    `cellId = null` beradi.
 *
 * 2. **IMZO-ORALIG'I** (`bandMin`/`bandMax`, default 9 000–11 000).
 *    «Ortiqchani o'chir» degan keng qoida haqiqiy tovarni ham yeb qo'yardi:
 *    ombor jamisi kamayishi bilan POS «yetarli emas» deb chekni yopmay
 *    qo'yadi — bu 2026-08-24 06:46 hodisasining aynan takrori bo'lardi.
 *    Soxta sonlar tor oraliqda ekani O'LCHANGAN, haqiqiy qoldiq unda deyarli
 *    uchramaydi ⇒ oraliq xavfsizlik to'ri. `--band-min 0 --band-max 0` bilan
 *    ONGLI ravishda o'chiriladi.
 */

import { formatDecimalScaled, parseDecimalScaled } from './warehouse-split-core.js';

const SCALE = 1_000_000n;

/** apps/api `decimal.ts#roundHalfUp` bilan AYNAN bir xil (packages/db app qatlamiga qaray olmaydi). */
function roundHalfUp(scaled: bigint, divisor: bigint): bigint {
  if (divisor === 0n) return scaled;
  const half = divisor / 2n;
  if (scaled >= 0n) return (scaled + half) / divisor;
  return -((-scaled + half) / divisor);
}

/** apps/api `decimal.ts#computePerUnitCost`. */
function perUnitCost(totalCostMinor: bigint, qtyMicro: bigint): bigint {
  if (qtyMicro <= 0n) return 0n;
  return roundHalfUp(totalCostMinor * SCALE, qtyMicro);
}

/**
 * apps/api `move-cost-basis.ts#computeTransferCost` bilan AYNAN bir arifmetika:
 * chiqim manbani BO'SHATSA butun `costBalanceMinor` ketadi (yaxlitlash qoldig'i
 * qty=0 qatorda osilib qolib, keyingi kirimning o'rtacha tannarxini buzmasin).
 */
export function writeOffCost(
  costBalanceMinor: bigint,
  qtyMicro: bigint,
  writeOffMicro: bigint,
): bigint {
  if (qtyMicro <= 0n || costBalanceMinor === 0n || writeOffMicro <= 0n) return 0n;
  if (writeOffMicro >= qtyMicro) return costBalanceMinor;
  return roundHalfUp(writeOffMicro * perUnitCost(costBalanceMinor, qtyMicro), SCALE);
}

// ---------------------------------------------------------------------------
// Kirish / chiqish
// ---------------------------------------------------------------------------

export interface BaselineRow {
  storeId: string;
  storeName: string;
  assortmentKind: string;
  assortmentId: string;
  /** `Stock.qty` — ombor jamisi (Decimal(20,6) satr). */
  qty: string;
  /** `Stock.reservedQty` — band qilingan miqdor. */
  reservedQty: string;
  /** Σ `StockByCell.qty` shu omborda (Decimal(20,6) satr). */
  assignedQty: string;
  costBalanceMinor: bigint;
  /** Shu (ombor × tovar) bo'yicha eng oxirgi yacheyka-yozuvi vaqti (ISO). */
  countedAt?: string | null;
  /**
   * K-reja `Product.pieceTracked` — «bo'lak hisobi yuritilsin» (J1).
   *
   * 🔴 UCHINCHI QOIDA (yuqoridagi ikkitasi ustiga). Bunday tovarda ombor
   * jamisi `stock_pieces` dagi jismoniy bo'laklar yig'indisiga QULFLANGAN
   * (K-reja 3-bo'lim invarianti). Bu skript esa qoldiqni kamaytiradi va
   * reyestrga TEGMAYDI ⇒ «Σ faol bo'lak === miqdor» darhol buzilardi va K5
   * ning ommaviy kiritish oqimi 400 bilan yiqilardi. Kamaytirishning to'g'ri
   * yo'li — inventarizatsiya: u ikkala tomonni BIRGA yozadi.
   */
  pieceTracked?: boolean;
}

export interface CleanupOptions {
  /** Imzo-oralig'i (ortiqcha shu oraliqda bo'lsa). `null` = oraliq YO'Q (ongli). */
  bandMin?: string | null;
  bandMax?: string | null;
  /** Faqat shu sanadan keyin sanalgan tovarlar (ISO). */
  since?: string | null;
  /** Faqat kamida bitta yacheykali qatori bor tovarlar (default: ha). */
  requireCell?: boolean;
}

export type SkipReason =
  | 'bolak-hisobi'
  | 'ortiqcha-yoq'
  | 'sanalmagan'
  | 'imzo-oraligidan-tashqarida'
  | 'sanash-eski'
  | 'rezerv-toosiq';

export interface CleanupLine {
  storeId: string;
  storeName: string;
  assortmentKind: string;
  assortmentId: string;
  qty: string;
  assignedQty: string;
  reservedQty: string;
  /** qty − assignedQty */
  surplus: string;
  /** Amalda o'chiriladigan miqdor (rezerv bilan cheklangan bo'lishi mumkin). */
  writeOffQty: string;
  /** Manfiy — Stock.costBalanceMinor shuncha kamayadi. */
  costDeltaMinor: bigint;
  /** O'chirilgandan keyingi ombor jamisi. */
  newQty: string;
  /** Rezerv sabab ortiqchaning hammasi o'chmadi. */
  cappedByReserve: boolean;
}

export interface CleanupSkip {
  storeId: string;
  assortmentId: string;
  reason: SkipReason;
  surplus: string;
}

export interface CleanupPlan {
  lines: CleanupLine[];
  skipped: CleanupSkip[];
  totals: { products: number; qty: string; costMinor: bigint };
}

export const DEFAULT_BAND_MIN = '9000';
export const DEFAULT_BAND_MAX = '11000';

/**
 * Reja quruvchi. Tartib MUHIM: arzon filtrlar oldin, rezerv chekloviga
 * yetganda satr allaqachon «nomzod» bo'ladi (skip sabablari chalkashmasin).
 */
export function buildCleanupPlan(
  rows: readonly BaselineRow[],
  options: CleanupOptions = {},
): CleanupPlan {
  const requireCell = options.requireCell !== false;
  const bandMin = options.bandMin === undefined ? DEFAULT_BAND_MIN : options.bandMin;
  const bandMax = options.bandMax === undefined ? DEFAULT_BAND_MAX : options.bandMax;
  const bandMinMicro = bandMin === null ? null : parseDecimalScaled(bandMin);
  const bandMaxMicro = bandMax === null ? null : parseDecimalScaled(bandMax);
  const sinceMs = options.since ? Date.parse(options.since) : null;

  const lines: CleanupLine[] = [];
  const skipped: CleanupSkip[] = [];
  let totalQty = 0n;
  let totalCost = 0n;

  for (const r of rows) {
    const qty = parseDecimalScaled(r.qty);
    const assigned = parseDecimalScaled(r.assignedQty);
    const reserved = parseDecimalScaled(r.reservedQty);
    const surplus = qty - assigned;
    const surplusStr = formatDecimalScaled(surplus);
    const skip = (reason: SkipReason) =>
      skipped.push({
        storeId: r.storeId,
        assortmentId: r.assortmentId,
        reason,
        surplus: surplusStr,
      });

    // 🔴 J1 — bo'lak hisobi RAD ETISH, filtr emas: shuning uchun u eng
    //    boshda turadi. «Ortiqchasi yo'q» deb o'tkazib yuborilsa bayroq
    //    yoqilgan tovar hisobotda umuman ko'rinmasdi va operator skript
    //    unga TEGMASLIGINI hech qayerdan bilmasdi.
    if (r.pieceTracked) {
      skip('bolak-hisobi');
      continue;
    }
    if (surplus <= 0n) {
      skip('ortiqcha-yoq');
      continue;
    }
    if (requireCell && assigned <= 0n) {
      // Sanalmagan tovar — kassa uni eski son bilan sotaveradi (egasining
      // «bosqichma-bosqich» qarori). Bunga TEGILMAYDI.
      skip('sanalmagan');
      continue;
    }
    if (sinceMs !== null) {
      const at = r.countedAt ? Date.parse(r.countedAt) : Number.NaN;
      if (!Number.isFinite(at) || at < sinceMs) {
        skip('sanash-eski');
        continue;
      }
    }
    if (bandMinMicro !== null && surplus < bandMinMicro) {
      skip('imzo-oraligidan-tashqarida');
      continue;
    }
    if (bandMaxMicro !== null && surplus > bandMaxMicro) {
      skip('imzo-oraligidan-tashqarida');
      continue;
    }

    // Pol: qoldiq NA yacheykalar yig'indisidan, NA rezervdan past tushmaydi.
    const floor = assigned > reserved ? assigned : reserved;
    const maxWriteOff = qty - floor;
    if (maxWriteOff <= 0n) {
      skip('rezerv-toosiq');
      continue;
    }
    const writeOff = surplus < maxWriteOff ? surplus : maxWriteOff;
    const costDelta = -writeOffCost(r.costBalanceMinor, qty, writeOff);

    lines.push({
      storeId: r.storeId,
      storeName: r.storeName,
      assortmentKind: r.assortmentKind,
      assortmentId: r.assortmentId,
      qty: r.qty,
      assignedQty: r.assignedQty,
      reservedQty: r.reservedQty,
      surplus: surplusStr,
      writeOffQty: formatDecimalScaled(writeOff),
      costDeltaMinor: costDelta,
      newQty: formatDecimalScaled(qty - writeOff),
      cappedByReserve: writeOff < surplus,
    });
    totalQty += writeOff;
    totalCost += costDelta;
  }

  return {
    lines,
    skipped,
    totals: { products: lines.length, qty: formatDecimalScaled(totalQty), costMinor: totalCost },
  };
}

// ---------------------------------------------------------------------------
// Qaytarish (qoida 12 — teskarisi O'SHA skriptda)
// ---------------------------------------------------------------------------

/** Ledger qatori (`stock_operations`) — qaytarish uchun kerakli maydonlar. */
export interface WriteOffLedgerRow {
  storeId: string;
  assortmentKind: string;
  assortmentId: string;
  /** Manfiy (chiqim) — qaytarishda teskarisi qo'llanadi. */
  qtyDelta: string;
  costDeltaMinor: bigint | null;
}

export interface RevertLine {
  storeId: string;
  assortmentKind: string;
  assortmentId: string;
  /** Musbat — Stock.qty shuncha ortadi. */
  qtyDelta: string;
  costDeltaMinor: bigint;
}

/**
 * Qaytarish rejasi: ledger yozuvlarining AYNAN teskarisi, (ombor × tovar)
 * kesimida jamlangan. Yaxlitlash qayta hisoblanmaydi — o'sha paytda YOZILGAN
 * qiymat qaytariladi, ya'ni sikl konstruksiya bo'yicha nol yig'indi
 * (`baseCostMinor` naqshi, MovePosition izohi).
 */
export function buildRevertPlan(rows: readonly WriteOffLedgerRow[]): RevertLine[] {
  const agg = new Map<string, RevertLine>();
  for (const r of rows) {
    const key = `${r.storeId}|${r.assortmentKind}|${r.assortmentId}`;
    const cur = agg.get(key);
    const qty = -parseDecimalScaled(r.qtyDelta);
    const cost = -(r.costDeltaMinor ?? 0n);
    if (cur) {
      cur.qtyDelta = formatDecimalScaled(parseDecimalScaled(cur.qtyDelta) + qty);
      cur.costDeltaMinor += cost;
    } else {
      agg.set(key, {
        storeId: r.storeId,
        assortmentKind: r.assortmentKind,
        assortmentId: r.assortmentId,
        qtyDelta: formatDecimalScaled(qty),
        costDeltaMinor: cost,
      });
    }
  }
  return [...agg.values()];
}

export const WRITE_OFF_DOC_TYPE = 'stock_baseline_writeoff';
export const WRITE_OFF_REVERT_DOC_TYPE = 'stock_baseline_writeoff_revert';
