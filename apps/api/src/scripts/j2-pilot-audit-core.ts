/**
 * J2 (bo'lak hisobini jonli ishga tushirish) — «bayroq gigienasi + pilot
 * doirasi» ning SOF yadrosi. Prisma yo'q, SQL yo'q, HTTP yo'q: faqat hisob.
 * Reja: `docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md` → J2.
 *
 * Ikkita savolga javob beradi va ikkalasi ham TESTdan o'tishi shart, chunki
 * ular jonli bazaga yoziladigan qarorni belgilaydi:
 *
 *   1. **«Manba nechta?»** — `pieceTracked = true` tovarda avto-taqsimotning
 *      3-holati (bo'lish) O'CHADI (K-reja 7.1, `retail-allocation.ts`). Ya'ni
 *      chek FAQAT bitta manba butun miqdorni qoplasa o'tadi. Manba = (ombor ×
 *      yacheyka) bo'g'ini, ombordagi YACHEYKASIZ qoldiq esa alohida
 *      psevdo-manba (`retail-allocation.ts` dagi `buildSources` bilan bir xil
 *      sanoq). 🔴 Shuning uchun «manbasi 1 dan ko'p» tovar pilotga
 *      KIRITILMAYDI — bayroq yoqilgan zahoti uning cheki 400 olardi.
 *
 *   2. **«Bayroq nega o'chadi?»** — sabab hisobotda ISM bilan chiqadi
 *      (`birlik-metr-emas` · `reyestr-bosh` · `reyestr-tolgan`), chunki
 *      o'chirish JONLI xulqni qaytaradi va «kimdir o'chirib qo'ydi» degan
 *      hujjatsiz o'zgarish 2026-08-24 hodisasining ayni sinfi.
 *
 * 🔷 Bu modul HECH NARSA yozmaydi. Yozadigan yagona joy — `POST
 * /stock-pieces/flag` marshruti (UI aynan o'sha tugmani bosadi).
 */

import { parseDecimalScaled } from '../modules/shared/decimal.js';

// ---------------------------------------------------------------------------
// 1. Kirish shakllari (Prisma qatorlarining KESIMI, Prisma turi EMAS)
// ---------------------------------------------------------------------------

export interface J2Store {
  id: string;
  name: string;
  /** `Store.attributes.__posPriority`. null = POS kaskadida EMAS. */
  posPriority: number | null;
  /** `Store.attributes.__brakStore` — manba bo'lolmaydi (G3/E4). */
  isBrak: boolean;
}

/** `stocks` qatori — ombor darajasidagi qoldiq. */
export interface J2StockRow {
  storeId: string;
  qty: string;
  reservedQty: string;
}

/** `stock_by_cell` qatori — yacheyka kesimi. */
export interface J2CellRow {
  storeId: string;
  cellId: string;
  cellName: string | null;
  qty: string;
}

/** Bitta manba: yacheyka yoki ombordagi YACHEYKASIZ hovuz (`cellId = null`). */
export interface J2Source {
  storeId: string;
  storeName: string;
  cellId: string | null;
  cellName: string | null;
  /** Decimal(20,6) matn. */
  qty: string;
  /** POS kaskadida (prioriteti bor va BRAK emas) — ya'ni kassa yeta oladi. */
  reachable: boolean;
}

export interface J2SourceReport {
  sources: J2Source[];
  /** Kassa yeta oladigan manbalar soni — 7.1 istisnosi AYNAN shuni sanaydi. */
  reachableCount: number;
  /** Kassa yeta OLMAYDIGAN qoldiq (BRAK yoki kaskaddan tashqari ombor). */
  unreachableQty: string;
  /** Barcha omborlardagi jami qoldiq. */
  totalQty: string;
  /** Eng katta yeta oladigan manba (uzluksiz sotilishi mumkin bo'lgan tom). */
  largestReachableQty: string;
  /**
   * 🔴 Yacheykalar yig'indisi ombor qoldig'idan KATTA bo'lgan omborlar.
   * Jim o'tkazib yuborilmaydi: bu ma'lumot nosozligi va u sverkani ham,
   * taqsimotni ham yolg'on qiladi.
   */
  overCelledStores: string[];
}

// ---------------------------------------------------------------------------
// 2. Manbalarni qurish
// ---------------------------------------------------------------------------

const ZERO = 0n;

function fmt(scaled: bigint): string {
  const negative = scaled < ZERO;
  const abs = negative ? -scaled : scaled;
  const int = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/**
 * Bitta tovarning manbalari — `retail-allocation.ts` ning `buildSources`
 * bilan AYNI sanoq: har yacheyka bitta manba, ombordagi qolgan (yacheykasiz)
 * qoldiq esa BITTA psevdo-manba.
 *
 * ⚠️ ATAYLAB `qty` bo'yicha sanaladi, `qty − reservedQty` bo'yicha emas.
 * Rezerv soatlab o'zgaradi; pilot doirasi esa tovarning JISMONIY tarqoqligi
 * haqida — u o'zgarmaydi. Rezerv alohida ustunda ko'rsatiladi.
 */
export function buildPieceSources(
  stores: readonly J2Store[],
  stock: readonly J2StockRow[],
  cells: readonly J2CellRow[],
): J2SourceReport {
  const byId = new Map(stores.map((s) => [s.id, s]));
  const sources: J2Source[] = [];
  const overCelledStores: string[] = [];
  let total = ZERO;
  let unreachable = ZERO;

  for (const row of stock) {
    const store = byId.get(row.storeId);
    const storeName = store?.name ?? row.storeId;
    const reachable = store ? store.posPriority !== null && !store.isBrak : false;
    const storeQty = parseDecimalScaled(row.qty);
    total += storeQty;
    if (!reachable) unreachable += storeQty;
    if (storeQty <= ZERO) continue;

    const own = cells.filter((c) => c.storeId === row.storeId);
    let celled = ZERO;
    for (const cell of own) {
      const qty = parseDecimalScaled(cell.qty);
      if (qty <= ZERO) continue;
      celled += qty;
      sources.push({
        storeId: row.storeId,
        storeName,
        cellId: cell.cellId,
        cellName: cell.cellName,
        qty: fmt(qty),
        reachable,
      });
    }

    const remainder = storeQty - celled;
    if (remainder > ZERO) {
      sources.push({
        storeId: row.storeId,
        storeName,
        cellId: null,
        cellName: null,
        qty: fmt(remainder),
        reachable,
      });
    } else if (remainder < ZERO) {
      overCelledStores.push(storeName);
    }
  }

  sources.sort(
    (a, b) =>
      Number(b.reachable) - Number(a.reachable) ||
      (parseDecimalScaled(b.qty) > parseDecimalScaled(a.qty) ? 1 : -1),
  );

  const reachableSources = sources.filter((s) => s.reachable);
  const largest = reachableSources.reduce(
    (max, s) => (parseDecimalScaled(s.qty) > max ? parseDecimalScaled(s.qty) : max),
    ZERO,
  );

  return {
    sources,
    reachableCount: reachableSources.length,
    unreachableQty: fmt(unreachable),
    totalQty: fmt(total),
    largestReachableQty: fmt(largest),
    overCelledStores: [...new Set(overCelledStores)],
  };
}

// ---------------------------------------------------------------------------
// 3. Bayroq gigienasi (J2 vazifa 1–2)
// ---------------------------------------------------------------------------

export interface J2FlaggedRow {
  id: string;
  name: string;
  uom: string | null;
  meterUom: boolean;
  /** Reyestrdagi FAOL bo'laklar soni. */
  activePieces: number;
}

export type J2FlagOffReason =
  /** Birligi metr EMAS — bayroq XATO qo'yilgan (J2/1, `Vesta ramka 2X`). */
  | 'birlik-metr-emas'
  /** Metr, lekin reyestri bo'sh — bo'sh reyestr + cheklangan taqsimot = foydasi yo'q, xavfi bor (J-reja 3.2). */
  | 'reyestr-bosh'
  /** 🔴 Reyestri TO'LGAN — bu tovarda bayroq o'chirilsa J3 ishi ko'rinmay qoladi. */
  | 'reyestr-tolgan';

export interface J2FlagOffPlan {
  id: string;
  name: string;
  reason: J2FlagOffReason;
  /** Sabab avtomatik o'chirishga YETARLIMI (`reyestr-tolgan` — yo'q). */
  safe: boolean;
}

/**
 * 🔴 `reyestr-tolgan` ATAYLAB «xavfsiz emas» deb belgilanadi. Bayroqni
 * o'chirish jismoniy zarar qilmaydi (reyestr joyida qoladi), lekin J3
 * omborchining sanoq ishi bekorga ketgandek ko'rinadi va bu QAROR
 * odamniki bo'lishi kerak — skript o'zi qilmaydi (`--force` talab etiladi).
 */
export function planFlagOff(rows: readonly J2FlaggedRow[]): J2FlagOffPlan[] {
  return rows.map((row) => {
    if (!row.meterUom) {
      return { id: row.id, name: row.name, reason: 'birlik-metr-emas' as const, safe: true };
    }
    if (row.activePieces > 0) {
      return { id: row.id, name: row.name, reason: 'reyestr-tolgan' as const, safe: false };
    }
    return { id: row.id, name: row.name, reason: 'reyestr-bosh' as const, safe: true };
  });
}

// ---------------------------------------------------------------------------
// 4. Pilot nomzodlari (J2 vazifa 3–4)
// ---------------------------------------------------------------------------

export interface J2CandidateInput {
  id: string;
  name: string;
  code: string | null;
  uom: string | null;
  meterUom: boolean;
  /** Papka yo'li (`pathName`) — guruh shu yerdan o'qiladi. */
  folder: string;
  pieceTracked: boolean;
  decidedAt: string | null;
  activePieces: number;
  /** Oxirgi 30 kunda nechta CHEKda sotilgan (`posted`). */
  receipts30: number;
  /** Oxirgi 30 kunda sotilgan jami miqdor. */
  qty30: string;
  sources: J2SourceReport;
}

export type J2Blocker =
  /** 🔴 7.1 istisnosi chekni yiqitadi — manba bittadan ko'p. */
  | 'manba-1-dan-kop'
  /** Kassa yeta oladigan qoldiq YO'Q — sinaladigan narsa yo'q. */
  | 'qoldiq-yoq'
  /** Birligi metr emas — bo'lak hisobi bu tovarga tegishli emas. */
  | 'birlik-metr-emas';

export interface J2Candidate extends J2CandidateInput {
  blockers: J2Blocker[];
  eligible: boolean;
}

/**
 * Nomzodni baholash. 🔴 Bu funksiya PILOTNI TANLAMAYDI — u faqat
 * «kiritish MUMKIN emas» degan qat'iy to'siqlarni sanaydi. Ro'yxatni
 * egasi tanlaydi (J2 vazifa 4: «Pilot ro'yxatini O'ZING tanlama»).
 */
export function evaluateCandidate(row: J2CandidateInput): J2Candidate {
  const blockers: J2Blocker[] = [];
  if (!row.meterUom) blockers.push('birlik-metr-emas');
  if (row.sources.reachableCount === 0 || parseDecimalScaled(row.sources.totalQty) <= ZERO) {
    blockers.push('qoldiq-yoq');
  }
  if (row.sources.reachableCount > 1) blockers.push('manba-1-dan-kop');
  return { ...row, blockers, eligible: blockers.length === 0 };
}

/**
 * Saralash: avval eng KO'P sotiladigani (J2 mezoni «eng ko'p sotiladigan»),
 * so'ng miqdori, so'ng nomi. To'siqlilar ham ro'yxatda QOLADI — ular
 * «qoldig'i bitta manbaga yig'ilsa kiradi» degan variantni ko'rsatadi
 * (J2 vazifa 3 ning oxirgi jumlasi).
 */
export function rankCandidates(rows: readonly J2Candidate[]): J2Candidate[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.receipts30 - a.receipts30 ||
      (parseDecimalScaled(b.qty30) > parseDecimalScaled(a.qty30) ? 1 : -1) ||
      a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// 5. Guruh kesimi (J2 vazifa 3 — «guruh bo'yicha»)
// ---------------------------------------------------------------------------

export interface J2GroupSummary {
  folder: string;
  products: number;
  /** Kassa yeta oladigan manbasi AYNAN bitta bo'lganlar. */
  singleSource: number;
  /** Oxirgi 30 kunda hech bo'lmasa bir marta sotilganlar. */
  sold30: number;
  totalQty: string;
}

export function summarizeGroups(rows: readonly J2Candidate[]): J2GroupSummary[] {
  const map = new Map<
    string,
    { products: number; singleSource: number; sold30: number; qty: bigint }
  >();
  for (const row of rows) {
    const key = row.folder || '(papkasiz)';
    const acc = map.get(key) ?? { products: 0, singleSource: 0, sold30: 0, qty: ZERO };
    acc.products += 1;
    if (row.sources.reachableCount === 1) acc.singleSource += 1;
    if (row.receipts30 > 0) acc.sold30 += 1;
    acc.qty += parseDecimalScaled(row.sources.totalQty);
    map.set(key, acc);
  }
  return [...map.entries()]
    .map(([folder, a]) => ({
      folder,
      products: a.products,
      singleSource: a.singleSource,
      sold30: a.sold30,
      totalQty: fmt(a.qty),
    }))
    .sort((a, b) => b.products - a.products || a.folder.localeCompare(b.folder));
}
