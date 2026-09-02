/**
 * Retail refund (POS-return) guard — pure, exact qty/money validation.
 *
 * RefundRetailSaleSchema documents «Positions to refund. Must be a
 * subset of original positions.» — but retail-sale.service.refund()
 * never enforced it (documented-but-unenforced invariant; §105 latent
 * bug, same class as the §100 close() reconciliation bug). A client
 * could refund a product never sold, or more units than were sold,
 * producing wrong stock inflow + over-refunded cash.
 *
 * This pure module enforces exactly the documented contract. Quantities
 * are Decimal(20,6) strings compared in integer micro-units (×1e6);
 * money is tiyin BigInt. No floating point on a monetary/qty decision.
 * Returns an error message (string) or null — the service maps a
 * non-null to BadRequestException (keeps this pure & adversarially
 * testable, the §74/§101 pattern).
 */

export interface OriginalLine {
  productId: string | null;
  /** Decimal(20,6) string. */
  quantity: string;
}
export interface RequestedRefundLine {
  productId: string;
  /** Decimal(20,6) string. */
  quantity: string;
}

const MICRO = 1_000_000n;

/** Decimal(20,6) string → integer micro-units. Total + exact. */
function toMicro(decimal: string): bigint {
  const neg = decimal.trim().startsWith('-');
  const body = neg ? decimal.trim().slice(1) : decimal.trim();
  const [int = '0', frac = ''] = body.split('.');
  const micro = BigInt(int || '0') * MICRO + BigInt(`${frac}000000`.slice(0, 6) || '0');
  return neg ? -micro : micro;
}

/** Σ qty per product, in micro-units. Null-product (service) lines are skipped. */
function sumQtyByProduct(lines: ReadonlyArray<OriginalLine>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const l of lines) {
    if (l.productId == null) continue;
    out.set(l.productId, (out.get(l.productId) ?? 0n) + toMicro(l.quantity));
  }
  return out;
}

/**
 * Validate a refund request against the original posted sale's lines.
 * Returns null when valid, else a human-readable reason. Enforces:
 *  1. every refunded product was actually in the original sale;
 *  2. cumulative refunded qty per product ≤ originally sold qty
 *     (aggregated across original lines, so split lines are summed);
 *  3. refunded qty is strictly positive.
 *
 * `alreadyRefunded` — the lines of every EARLIER refund mirrored from this
 * receipt (SALES-05). The cap is on the running total, not on one request:
 * before this parameter existed the receipt was burned after the first
 * partial refund (flipped to 'refunded'), which is exactly why nobody
 * noticed a per-request cap was not enough.
 */
export function validateRefundPositions(
  original: OriginalLine[],
  requested: RequestedRefundLine[],
  alreadyRefunded: ReadonlyArray<OriginalLine> = [],
): string | null {
  const soldByProduct = sumQtyByProduct(original);
  const doneByProduct = sumQtyByProduct(alreadyRefunded);

  // Sum the request per product so multiple refund lines of the same
  // product cannot individually pass yet collectively over-refund.
  const wantByProduct = new Map<string, bigint>();
  for (const r of requested) {
    const q = toMicro(r.quantity);
    if (q <= 0n) {
      return `Refund quantity must be > 0 (product ${r.productId})`;
    }
    wantByProduct.set(r.productId, (wantByProduct.get(r.productId) ?? 0n) + q);
  }

  for (const [productId, want] of wantByProduct) {
    const sold = soldByProduct.get(productId);
    if (sold === undefined) {
      return `Product ${productId} was not in the original sale — cannot refund it`;
    }
    const cumulative = want + (doneByProduct.get(productId) ?? 0n);
    if (cumulative > sold) {
      return `Refund qty for product ${productId} exceeds sold qty (${
        Number(cumulative) / 1e6
      } > ${Number(sold) / 1e6})`;
    }
  }
  return null;
}

/**
 * Has every sold UNIT come back? Only then may the receipt close
 * ('posted' → 'refunded'); until then it stays open so the rest can still
 * be returned (SALES-05).
 *
 * Service lines (`productId === null`) are ignored: they carry no stock and
 * cannot be returned, so counting them would hold the receipt open forever.
 */
export function isFullyRefunded(
  original: OriginalLine[],
  refunded: ReadonlyArray<OriginalLine>,
): boolean {
  const sold = sumQtyByProduct(original);
  const back = sumQtyByProduct(refunded);
  for (const [productId, qty] of sold) {
    if ((back.get(productId) ?? 0n) < qty) return false;
  }
  return true;
}

/** An original receipt line with the money the customer was actually charged. */
export interface OriginalPricedLine extends OriginalLine {
  /** Unit price before discount (tiyin) — informational, carried onto the mirror row. */
  priceMinor: bigint;
  /** Percent, Decimal string — informational, carried onto the mirror row. */
  discount: string;
  /** Line total AFTER discount (tiyin) — this is the money that moves. */
  sumMinor: bigint;
}

export interface PricedRefundRow {
  productId: string;
  /** Decimal(20,6) string, as requested. */
  quantity: string;
  priceMinor: bigint;
  discount: string;
  /** Refund value of this line (tiyin), derived from the ORIGINAL sum. */
  lineMinor: bigint;
}

export interface PricedRefund {
  rows: PricedRefundRow[];
  totalMinor: bigint;
}

/**
 * Price a refund **from the original receipt** — never from client input.
 *
 * SALES-01: refund() used to run the client's `priceMinor` through
 * `computePositions()` and then cap the payout against that same number, so
 * the cap was self-referential — a caller with `retailsale:approve` could
 * refund a 10 000 so'm item for 10 000 000 and MoneyService would hand the
 * cash over. The client no longer has any say in the money: each refunded
 * line is worth its share of what the customer actually paid.
 *
 * Per product, the original lines are aggregated (a receipt may list the same
 * product several times, possibly at different prices — mirroring
 * `validateRefundPositions`, which caps quantity per product, not per line):
 *
 *   lineMinor = ⌊ Σ(original sumMinor) × refundQty / Σ(original qty) ⌋
 *
 * Floor division is deliberate: summed over any set of refund lines whose
 * quantities stay within the sold quantity (which `validateRefundPositions`
 * guarantees), the result can only be ≤ the original sum — never above it.
 * The customer may lose up to one tiyin per line on a split partial refund;
 * paying out more than the receipt is the failure mode that matters.
 *
 * `priceMinor`/`discount` are copied from the product's first original line
 * for display/provenance only — they are not what the payout is computed from.
 */
export function priceRefundFromOriginal(
  original: OriginalPricedLine[],
  requested: RequestedRefundLine[],
): PricedRefund {
  const byProduct = new Map<
    string,
    { qtyMicro: bigint; sumMinor: bigint; priceMinor: bigint; discount: string }
  >();
  for (const o of original) {
    if (o.productId == null) continue;
    const agg = byProduct.get(o.productId);
    if (agg) {
      agg.qtyMicro += toMicro(o.quantity);
      agg.sumMinor += o.sumMinor;
    } else {
      byProduct.set(o.productId, {
        qtyMicro: toMicro(o.quantity),
        sumMinor: o.sumMinor,
        priceMinor: o.priceMinor,
        discount: o.discount,
      });
    }
  }

  let totalMinor = 0n;
  const rows = requested.map((r) => {
    const agg = byProduct.get(r.productId);
    // Unknown product / zero-qty original: worth nothing. `validateRefundPositions`
    // rejects the first case before we get here; pricing it at 0 means a future
    // caller that reorders the guards still cannot mint cash.
    const lineMinor =
      agg && agg.qtyMicro > 0n ? (agg.sumMinor * toMicro(r.quantity)) / agg.qtyMicro : 0n;
    totalMinor += lineMinor;
    return {
      productId: r.productId,
      quantity: r.quantity,
      priceMinor: agg?.priceMinor ?? 0n,
      discount: agg?.discount ?? '0',
      lineMinor,
    };
  });

  return { rows, totalMinor };
}

/**
 * Money guard: the cash+card paid back must not exceed the value of the
 * goods being refunded (you cannot hand back more money than the
 * refund is worth). All tiyin BigInt; refundSumMinor is computed from
 * the validated positions. Returns null when valid, else a reason.
 */
export function validateRefundAmount(
  refundSumMinor: bigint,
  cashReturnMinor: bigint,
  cardReturnMinor: bigint,
): string | null {
  if (cashReturnMinor < 0n || cardReturnMinor < 0n) {
    return 'Refund cash/card amounts must be non-negative';
  }
  if (cashReturnMinor + cardReturnMinor > refundSumMinor) {
    return `Refund payout ${(cashReturnMinor + cardReturnMinor).toString()} exceeds refunded value ${refundSumMinor.toString()}`;
  }
  return null;
}

export interface RefundSettlementInput {
  /** The original receipt's total (tiyin). */
  originalSumMinor: bigint;
  /** The part of it left on the customer's account — Σ RetailSalePayment(DEBT). */
  originalDebtMinor: bigint;
  /**
   * P5 — the part of the receipt the DRAWER physically took (tiyin, so'm
   * equivalent): Σ `CASH_UZS` + Σ `CASH_USD.amountBaseMinor`. Card/terminal
   * money never reached the drawer, so it must never leave it.
   *
   * MK31 — why `CASH_USD` counts as cash-like: the dollars ARE in the drawer
   * and change for them is already paid in so'm (`retail-tenders.ts` §6.2),
   * i.e. the till is the exchange point. Refunding a dollar receipt in so'm
   * at the frozen rate is value-neutral; refunding a CARD receipt in cash is
   * not — the bank still holds that money.
   *
   * 🔴 `null` = **O'LCHANMAGAN**, `0n` = «naqd olinmagan». Ikkalasi bir xil
   * EMAS. `RetailSalePayment` qatorlari kassa TZ §6.1 dan beri yoziladi;
   * undan OLDINGI cheklarda ular umuman yo'q (prodda o'lchandi: eski posted
   * cheklarda 0 qator). Ularni `0n` deb o'qisak butun tarixiy chek naqd
   * qaytarilmaydigan bo'lib qolardi — o'lchanmaganlik taqiqqa aylanmasin.
   */
  originalCashLikeMinor: bigint | null;
  /**
   * Σ `CASH_USD.amountMinor` — SENTDA (dollar naqd, mijoz JISMONAN bergan pul).
   *
   * 🔴 2026-08-17 (egasi qarori, prodda o'lchangan yo'qotishdan keyin): dollar
   * ulushi endi so'm cap'iga KIRMAYDI. Ilgari `CASH_USD` «naqd-o'xshash» deb
   * so'm ekvivalentida sanalardi va shu sabab dollarda to'langan chek to'liq
   * SO'M bilan qaytarilib ketardi. Prodda o'lchandi (ТРН-2026-00318 →
   * ТРН-2026-00323): so'm yashig'iga 4 690 000 kirgan, undan 5 890 000 chiqib
   * ketgan ⇒ so'm kassasi 1 200 000 so'mga kamaydi, mijozning $100 esa
   * yashiqda qolib ketdi va smenaning dollar hisobi hech qachon kamaymadi.
   * Endi dollar O'Z BUCKET'ida: `usdMaxMinor` (sent) alohida cheklanadi.
   *
   * `null` = o'lchanmagan (to'lov qatorlari yo'q eski chek) ⇒ dollar cap'i
   * QO'YILMAYDI va dollar qaytarish yo'li ochilmaydi (0).
   */
  originalCashUsdMinor?: bigint | null;
  /**
   * `CASH_USD` ning SO'M ekvivalenti (tiyin) — pul ulushidan CHIQARIB
   * tashlash uchun. Busiz kassir dollar ulushini KARTA orqali so'mda
   * qaytarib yuborishi mumkin edi (naqd cap'i to'sadi, `moneyMax` esa yo'q).
   */
  originalUsdBaseMinor?: bigint;
  /** Σ SENT — bu chekdan avvalgi qaytarishlar allaqachon bergan dollar. */
  priorUsdReturnedMinor?: bigint;
  /**
   * A2 (2026-08-25) — Σ `PREPAY` to'lov qatorlari: chekning mijoz AVANSIDAN
   * qoplangan ulushi.
   *
   * 🔴 NEGA U SO'M PUL ULUSHIDAN CHIQARILADI: avans puli kassa yashig'iga
   * bu chek orqali KIRMAGAN (u A1 yo'li bilan, boshqa hujjat va ehtimol
   * boshqa smena bilan kirgan). Bu qismni `moneyMax` ichida qoldirsak,
   * avansdan to'langan chek NAQD qaytarilib, yashiqdan hech qachon shu chek
   * uchun kirmagan pul chiqib ketardi — bu R1 (100% karta cheki naqd
   * qaytarildi, prodda o'lchangan) va 2026-08-17 (dollar cheki so'mda
   * qaytarildi) hodisalarining AYNAN uchinchi nusxasi bo'lardi.
   *
   * Avans ulushi o'z bucket'ida qaytadi: `prepayMaxMinor` → mijozning
   * BALANSIGA (`−prepayReturn`), naqd emas.
   *
   * Ixtiyoriy ⇒ uzatmagan chaqiruvchilar uchun 0 (mavjud xulq o'zgarmaydi).
   */
  originalPrepayMinor?: bigint;
  /** Σ — bu chekdan avvalgi qaytarishlar allaqachon balansga qaytargan avans. */
  priorPrepayReturnedMinor?: bigint;
  /** Σ value of the refunds already mirrored from this receipt. */
  priorRefundedSumMinor: bigint;
  /** Σ cash+card those earlier refunds already paid back. */
  priorMoneyReturnedMinor: bigint;
  /** Σ CASH those earlier refunds already took out of the drawer. */
  priorCashReturnedMinor: bigint;
  /** Σ debt those earlier refunds already wrote down. */
  priorDebtReturnedMinor: bigint;
  /** Value of the refund being made now (from `priceRefundFromOriginal`). */
  refundSumMinor: bigint;
}

export interface RefundSettlementCaps {
  /** Most cash+card this refund may pay out. */
  moneyMaxMinor: bigint;
  /**
   * P5 — most CASH this refund may take out of the drawer. Always
   * ≤ `moneyMaxMinor`; the remainder (if any) must go back through the
   * non-cash channel (`cardReturnMinor`).
   */
  cashMaxMinor: bigint;
  /** Most debt this refund may write off the customer's balance. */
  debtMaxMinor: bigint;
  /**
   * Eng ko'p qaytarilishi mumkin bo'lgan DOLLAR — SENTDA (2026-08-17).
   * So'm jamlarига HECH QACHON qo'shilmaydi: ikkalasi ham `bigint`, shuning
   * uchun aralashtirish typecheck'dan jim o'tib ketardi ([[ShiftUsdCashInputs]]
   * bilan bir xil sabab). O'lchanmagan chekda 0.
   */
  usdMaxMinor: bigint;
  /**
   * A2 — bu qaytarish mijozning BALANSIGA qaytara oladigan eng katta avans
   * ulushi. `moneyMaxMinor` ga QO'SHILMAYDI: pul yashiqdan chiqmaydi.
   */
  prepayMaxMinor: bigint;
}

const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);

/**
 * How much of a refund may leave the till, and how much must instead come
 * off the customer's debt (SALES-04).
 *
 * A receipt sold on credit took no money, so refunding it in cash hands out
 * money that was never received — and the debt it created stayed on the
 * balance: the customer got the goods' value in cash AND kept owing for
 * them. The caps therefore mirror how the receipt was actually settled:
 *
 *   moneyCap(R) = ⌊ (sum − debt) × R / sum ⌋      R = TOTAL refunded value
 *   debtCap(R)  = R − moneyCap(R)                 (clamped to the debt taken)
 *
 * Both are computed on the CUMULATIVE refunded value and then reduced by
 * what earlier refunds already returned. That is what makes split refunds
 * safe: rounding is re-evaluated against the running total each time
 * instead of accumulating a tiyin of drift per refund, and at R = sum the
 * two caps add up to exactly what the customer paid and owed.
 */
export function computeRefundSettlementCaps(i: RefundSettlementInput): RefundSettlementCaps {
  const originalSum = i.originalSumMinor > 0n ? i.originalSumMinor : 0n;
  // Corrupt/legacy data (debt recorded above the receipt total) must never
  // produce a money cap out of thin air — clamp before subtracting.
  const debt = clamp(i.originalDebtMinor, 0n, originalSum);
  // 2026-08-17: dollar ulushi SO'M pul ulushidan chiqariladi — u o'z
  // bucket'ida (`usdMaxMinor`, sent) qaytariladi. Clamp: buzuq ma'lumot
  // (dollar bazasi chek jamidan katta) manfiy pul ulushi yasamasin.
  const usdBase = clamp(i.originalUsdBaseMinor ?? 0n, 0n, originalSum - debt);
  // A2 — avans ulushi ham pul ulushidan chiqariladi (yuqoridagi izoh).
  const prepay = clamp(i.originalPrepayMinor ?? 0n, 0n, originalSum - debt - usdBase);
  const money = originalSum - debt - usdBase - prepay;

  const refundedTotal = clamp(
    (i.priorRefundedSumMinor > 0n ? i.priorRefundedSumMinor : 0n) +
      (i.refundSumMinor > 0n ? i.refundSumMinor : 0n),
    0n,
    originalSum,
  );

  const moneyCapTotal = originalSum === 0n ? 0n : (money * refundedTotal) / originalSum;
  // A2 — avans ulushi PROPORSIONAL hisoblanadi (pul ulushi bilan bir xil
  // formula), qarz esa ATAYLAB qoldiqni oladi.
  //
  // 🔴 Nega avans ham proporsional, qarz esa qoldiq: bo'lish tiyin
  // yaxlitlashi beradi va uchta chelakdan BITTASI yaxlitlash qoldig'ini
  // yutishi kerak — aks holda uch cap'ning yig'indisi qaytarilgan qiymatdan
  // kam bo'lib, har qisman qaytarishda bir tiyin osilib qolardi. Qoldiqni
  // qarz oladi, chunki uning cap'i (`debt`) bilan baribir kesiladi.
  //
  // ⚠️ ORQAGA MOSLIK: avanssiz chekda `prepayCapTotal = 0` ⇒ formula
  // avvalgisi bilan AYNAN bir xil qoladi (mavjud testlar buni qulflaydi).
  const prepayCapTotal =
    originalSum === 0n ? 0n : clamp((prepay * refundedTotal) / originalSum, 0n, prepay);
  const debtCapTotal = clamp(refundedTotal - moneyCapTotal - prepayCapTotal, 0n, debt);

  // P5 — the drawer's own ceiling, on the SAME cumulative base so split
  // refunds cannot drift past it. Clamped into [0, money] first: corrupt data
  // (cash-like recorded above the receipt total, or above the money share of
  // a credit receipt) must not mint a cash cap larger than the money cap.
  //
  // `null` (o'lchanmagan — to'lov qatorlari yo'q eski chek) ⇒ kanal cap'i
  // QO'YILMAYDI, ya'ni AVVALGI xulq: `cashMax = moneyMax`.
  const cashCapTotal =
    i.originalCashLikeMinor == null
      ? moneyCapTotal
      : originalSum === 0n
        ? 0n
        : (clamp(i.originalCashLikeMinor, 0n, money) * refundedTotal) / originalSum;

  // Dollar cap'i — AYNI kümülativ bazada (qisman qaytarishlar zanjirida
  // drift bo'lmasin), lekin SENTDA va so'm jamlariga qo'shilmasdan.
  const usdCapTotal =
    i.originalCashUsdMinor == null || originalSum === 0n
      ? 0n
      : (clamp(i.originalCashUsdMinor, 0n, i.originalCashUsdMinor) * refundedTotal) / originalSum;

  const moneyMaxMinor = moneyCapTotal - i.priorMoneyReturnedMinor;
  const cashMaxMinor =
    i.originalCashLikeMinor == null ? moneyMaxMinor : cashCapTotal - i.priorCashReturnedMinor;
  const debtMaxMinor = debtCapTotal - i.priorDebtReturnedMinor;
  const usdMaxMinor = usdCapTotal - (i.priorUsdReturnedMinor ?? 0n);
  const prepayMaxMinor = prepayCapTotal - (i.priorPrepayReturnedMinor ?? 0n);
  return {
    moneyMaxMinor: moneyMaxMinor > 0n ? moneyMaxMinor : 0n,
    cashMaxMinor: cashMaxMinor > 0n ? cashMaxMinor : 0n,
    debtMaxMinor: debtMaxMinor > 0n ? debtMaxMinor : 0n,
    usdMaxMinor: usdMaxMinor > 0n ? usdMaxMinor : 0n,
    prepayMaxMinor: prepayMaxMinor > 0n ? prepayMaxMinor : 0n,
  };
}

/**
 * Money guard #2 (SALES-04): the settlement must fit inside BOTH caps —
 * you cannot pay back money the till never took, and you cannot write off
 * more credit than the receipt put on the account.
 * Returns null when valid, else a reason.
 */
export function validateRefundSettlement(
  caps: RefundSettlementCaps,
  cashReturnMinor: bigint,
  cardReturnMinor: bigint,
  debtReturnMinor: bigint,
  /** Dollar qaytarish — SENTDA. Uzatilmasa 0 (eski chaqiruvchilar). */
  usdReturnMinor = 0n,
  /** A2 — mijozning balansiga qaytariladigan avans ulushi. Uzatilmasa 0. */
  prepayReturnMinor = 0n,
  /**
   * V3 (egasi, 2026-09-02: «pul qaytarganda naqd/karta tanlash imkoni
   * bo'lsin»). `channelOverride` = kassir kanalni O'ZI tanladi ⇒ KANAL cap'i
   * (`cashMaxMinor`) tekshirilmaydi: karta bilan to'langan chekni naqd
   * qaytarish mumkin bo'ladi.
   *
   * 🔴 JAMI cap (`moneyMaxMinor`) BEKOR QILINMAYDI — kassa olganidan ko'p pul
   * qaytarish, qarz/avans ulushini naqdga aylantirish hamon TAQIQ. Bayroq
   * pulni «yo'qdan» yaratmaydi, faqat qaysi kanaldan chiqishini kassirga
   * qoldiradi. Sukut `false` ⇒ P5/R1 himoyasi (avtomatik hisoblangan
   * noto'g'ri taqsimot) boshqa hamma chaqiruvchi uchun O'Z KUCHIDA.
   */
  opts: { channelOverride?: boolean } = {},
): string | null {
  if (cashReturnMinor < 0n || cardReturnMinor < 0n || debtReturnMinor < 0n) {
    return 'Refund cash/card/debt amounts must be non-negative';
  }
  if (usdReturnMinor < 0n) return 'Refund USD amount must be non-negative';
  if (prepayReturnMinor < 0n) return 'Refund prepay amount must be non-negative';
  // A2 — chek qancha avansdan to'langan bo'lsa, shuncha avans qaytadi.
  // Ortiqchasi mijozga «yo'qdan avans» yasab berardi.
  if (prepayReturnMinor > caps.prepayMaxMinor) {
    return (
      `Avansga qaytarish ${(prepayReturnMinor / 100n).toString()} so'm — bu chekning ` +
      `atigi ${(caps.prepayMaxMinor / 100n).toString()} so'mi avansdan to'langan.`
    );
  }
  // 🔴 Dollar cap'i (2026-08-17, prodda o'lchangan yo'qotish): kassa bu chek
  // uchun olgan dollardan ko'p dollar chiqarib bo'lmaydi. Xabar kassirga
  // ko'rinadi — nima qilish kerakligi bilan.
  if (usdReturnMinor > caps.usdMaxMinor) {
    return (
      `Dollar qaytarish $${(usdReturnMinor / 100n).toString()} — kassa bu chek uchun ` +
      `atigi $${(caps.usdMaxMinor / 100n).toString()} dollar olgan. Qolgan qismini so'mda qaytaring.`
    );
  }
  const payout = cashReturnMinor + cardReturnMinor;
  if (payout > caps.moneyMaxMinor) {
    // 2026-08-17: bu yo'l endi KASSIR uchun ham yetib keladigan holat bo'ldi
    // (dollarda to'langan chek so'mda qaytarilmoqchi bo'lsa) — shuning uchun
    // xabar o'zbekcha va nima qilish kerakligi bilan. Ilgari inglizcha edi.
    const hint =
      caps.usdMaxMinor > 0n
        ? ` Bu chekning $${(caps.usdMaxMinor / 100n).toString()} qismi DOLLARDA to'langan — uni «dollarda qaytarish» maydoniga kiriting.`
        : '';
    return (
      `Qaytarish ${(payout / 100n).toString()} so'm — kassa bu chek uchun atigi ` +
      `${(caps.moneyMaxMinor / 100n).toString()} so'm pul olgan.${hint}`
    );
  }
  // P5 — kanal cap'i. Prodda o'lchandi (R1): 100% KARTA cheki naqd qaytarilib
  // yashiqdan hech qachon kirmagan pul chiqib ketdi. Xabar KASSIRGA
  // ko'rinadi, shuning uchun o'zbekcha va nima qilish kerakligi bilan.
  //
  // V3: kassir kanalni ATAYLAB tanlagan bo'lsa bu cap o'tkazib yuboriladi —
  // R1 hodisasi AVTOMATIK taqsimotning xatosi edi, qo'lda tanlov esa
  // ongli qaror (yashiq shu summaga kam chiqadi, bu kutilgan).
  if (!opts.channelOverride && cashReturnMinor > caps.cashMaxMinor) {
    return (
      `Naqd qaytarish ${(cashReturnMinor / 100n).toString()} so'm — kassa bu chek uchun ` +
      `atigi ${(caps.cashMaxMinor / 100n).toString()} so'm naqd olgan. Qolgan qismi karta/terminal ` +
      'orqali kelgan: uni o‘sha kanal orqali qaytaring (naqd qatorini kamaytiring).'
    );
  }
  if (debtReturnMinor > caps.debtMaxMinor) {
    return `Debt write-down ${debtReturnMinor.toString()} exceeds the credit taken on these goods (${caps.debtMaxMinor.toString()})`;
  }
  return null;
}
