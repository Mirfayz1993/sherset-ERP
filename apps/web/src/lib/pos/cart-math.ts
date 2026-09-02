/**
 * POS savat matematikasi — sof funksiyalar (kassa TZ §5, B8 texnik qarzi).
 *
 * NEGA ALOHIDA FAYL: bu qoidalar `sotuv/page.tsx` (2000+ satr) ichida
 * yashaganda ularni sinash uchun butun POS ekranini render qilish kerak
 * bo'lardi — shuning uchun ular umuman sinalmagan edi. Pul hisobi esa
 * aynan sinalishi shart bo'lgan joy.
 *
 * Hamma summa **tiyin**da va `bigint`: `number` 2^53 dan keyin yaxlitlaydi
 * va bu chekда jimgina noto'g'ri jami beradi.
 */

import { computePositionTotal, scaleMinorByQty } from '@moysklad/money';

/**
 * Savat qatoridan hisob uchun kerakli minimal.
 *
 * ⚠️ `quantity` — `number | string`, va bu ATAYLAB (F8 audit tuzatishi).
 * Server sxemasi miqdorni `Decimal(20,6)` qabul qiladi
 * (`retail-sale.schema.ts`: `/^\d+(\.\d{1,6})?$/`), ya'ni og'irlik bilan
 * sotiladigan tovar savatda 1.5 kg bo'lishi MUMKIN. Ilgari bu yerda faqat
 * `number` turardi va jami `BigInt(l.quantity)` bilan hisoblanardi —
 * `BigInt(1.5)` **RangeError** otadi. React render'i ichida otilgan xato esa
 * butun POS ni oq ekranga aylantiradi: chek yo'q, pul yo'q, kassir sababini
 * bilmaydi. Zakaz pozitsiyalari ham kasr bo'lishi mumkin (F8), shuning uchun
 * miqdor endi hamma joyda DECIMAL-SATR sifatida yuritiladi.
 */
export interface CartLineLike {
  quantity: number | string;
  priceMinor: bigint;
}

/**
 * Savatdagi jami dona soni.
 *
 * Kasr miqdor (0.5 kg) bo'lsa natija ham kasr bo'ladi — bu faqat kassirga
 * ko'rsatiladigan «nechta pozitsiya» hisobi, pul hisobi emas.
 */
export function cartCount(lines: ReadonlyArray<{ quantity: number | string }>): number {
  let n = 0;
  for (const l of lines) {
    const q = typeof l.quantity === 'number' ? l.quantity : Number(l.quantity);
    if (Number.isFinite(q)) n += q;
  }
  return n;
}

/**
 * Chegirmasiz jami (tiyin).
 *
 * `scaleMinorByQty` — serverning `computePositionTotal` bilan AYNI fixed-point
 * yo'li (half-up, mikro-birlik), ya'ni ekrandagi jami chekdagidan farq
 * qilmaydi va kasr miqdor otilmaydi.
 */
export function cartTotalMinor(lines: ReadonlyArray<CartLineLike>): bigint {
  let sum = 0n;
  for (const l of lines)
    sum += scaleMinorByQty(l.priceMinor, normalizeQtyDecimal(String(l.quantity)));
  return sum;
}

/**
 * Miqdor-satrga `delta` qo'shadi va SATR qaytaradi (± tugmalari).
 *
 * Nega float emas: `0.1 + 0.2 = 0.30000000000000004` va u `Decimal(20,6)`
 * regexidan o'tmay 400 olardi. Hisob mikro-birlikda (10^6) — server
 * masshtabining o'zi. Manfiy natija `'0'` ga qisiladi: chaqiruvchi 0 li
 * qatorni savatdan olib tashlaydi.
 */
export function addQtyDecimal(qty: string, delta: number): string {
  const base = qtyToMicro(qty);
  const step = Number.isFinite(delta) ? BigInt(Math.round(delta * 1e6)) : 0n;
  const next = base + step;
  if (next <= 0n) return '0';
  const int = next / 1_000_000n;
  const frac = (next % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac === '' ? int.toString() : `${int}.${frac}`;
}

/**
 * Savatning tan narx jami — `Σ tan × miqdor`, kasr miqdorni qo'llab.
 *
 * `@moysklad/money` dagi `sumCostMinor` ning miqdori `bigint`, ya'ni u kasr
 * miqdorni umuman ifodalay olmaydi. `complete` shartnomasi esa AYNAN
 * o'sha: bitta qatorning tan narxi noma'lum bo'lsa jami TO'LIQ EMAS deb
 * belgilanadi va u qator hech narsa qo'shmaydi — nolni tan narx deb sanash
 * 100% marja yolg'onini beradi (NULL ≠ 0, kassa TZ §5.3).
 */
export function cartCostMinor(
  lines: ReadonlyArray<{ costMinor: bigint | null; quantity: number | string }>,
): { costMinor: bigint; complete: boolean } {
  let costMinor = 0n;
  let complete = true;
  for (const l of lines) {
    if (l.costMinor == null) {
      complete = false;
      continue;
    }
    costMinor += scaleMinorByQty(l.costMinor, normalizeQtyDecimal(String(l.quantity)));
  }
  return { costMinor, complete };
}

/**
 * Savat qatorining tushumi (tiyin) — `narx × miqdor`, half-up.
 *
 * `@moysklad/money` da to'g'ridan-to'g'ri ekvivalenti yo'q: u yerdagi qator
 * formulalari miqdorni `bigint` oladi va kasr miqdorni (1.5 kg) ifodalay
 * olmaydi. Shuning uchun bu uchtasi shu yerda — sof va sinalgan holda —
 * turadi; sahifada `(narx − tan) × soni` ni QAYTA YOZISH taqiqlangan
 * (`__tests__/pos-cart-profit.test.ts`).
 */
export function cartLineRevenueMinor(line: CartLineLike): bigint {
  return scaleMinorByQty(line.priceMinor, normalizeQtyDecimal(String(line.quantity)));
}

/**
 * Qator foydasi (tiyin) — `(narx − tan narx) × miqdor`.
 *
 * Tan narx NULL bo'lsa natija ham **NULL**, 0 EMAS: nol tan narx 100% marja
 * beradi va bu savat aynan ko'rsatmaslik uchun bor raqam (kassa TZ §5.3).
 */
export function cartLineProfitMinor(line: {
  priceMinor: bigint;
  costMinor: bigint | null;
  quantity: number | string;
}): bigint | null {
  if (line.costMinor == null) return null;
  return scaleMinorByQty(
    line.priceMinor - line.costMinor,
    normalizeQtyDecimal(String(line.quantity)),
  );
}

/**
 * «Kassir qancha tushirib berdi» (tiyin) — `(kartochka narxi − sotilgan) × miqdor`.
 * Kartochka narxi noma'lum bo'lsa NULL — yo'q raqam ogohlantirish sababi emas.
 */
export function cartLineMarkdownMinor(line: {
  basePriceMinor: bigint | null;
  priceMinor: bigint;
  quantity: number | string;
}): bigint | null {
  if (line.basePriceMinor == null) return null;
  return scaleMinorByQty(
    line.basePriceMinor - line.priceMinor,
    normalizeQtyDecimal(String(line.quantity)),
  );
}

/**
 * Chek darajasidagi foiz chegirmasi.
 *
 * ⚠️ Yaxlitlash **pastga** (bigint bo'linishi) — ya'ni chegirma bir tiyinga
 * KAM bo'lishi mumkin. Bu ataylab: yuqoriga yaxlitlash mijozga har chekda
 * bir tiyin ortiqcha berardi va smena yakunida kamomad ko'rinardi.
 *
 * `percent` chegaradan tashqarida bo'lsa (0..100) — qisiladi: manfiy
 * chegirma «ustama» bo'lib qolardi, 100 dan katta esa manfiy jami berardi.
 */
export function applyDiscountMinor(totalMinor: bigint, percent: number): bigint {
  if (!Number.isFinite(percent) || percent <= 0) return totalMinor;
  const p = BigInt(Math.min(Math.floor(percent), 100));
  return totalMinor - (totalMinor * p) / 100n;
}

/**
 * Tiyin-satr → `bigint`, «berilmagan» holatini `null` sifatida SAQLAB.
 *
 * Ataylab `?? 0n` EMAS: nol tan narx «bu bizga tekin tushgan» degani va
 * 100% marja beradi — savat aynan shu yolg'on raqamni ko'rsatmaslik uchun
 * bor (kassa TZ §5.3).
 */
export function toMinorOrNull(value: string | null | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Qator-darajasidagi chegirmasi bor savat qatori (retail POS). */
export interface DiscountedCartLine {
  /** Miqdor — son yoki Decimal(20,6) satri. */
  quantity: number | string;
  /** Bir dona narxi (tiyin). */
  priceMinor: bigint;
  /** Qator chegirmasi, foiz 0..100 (4 kasr xonagacha). */
  discount: number | string;
}

/**
 * Bitta savat qatorining jami (tiyin) — **server formulasi bilan bir xil**.
 *
 * FE-01: ilgari retail POS `BigInt(Math.round(qty * Number(priceMinor) *
 * (1 - discount / 100)))` hisoblardi. Bu IEEE-754 float; server esa
 * `computePositionTotal` (BigInt fixed-point, half-up) bilan qayta hisoblab
 * `expectedSumMinor` bilan QAT'IY tenglikni tekshiradi va farq bo'lsa chekni
 * RAD ETADI. Misol: 115 tiyin × 1, −10% → float 103, server 104.
 *
 * Miqdor/foiz normalizatsiyadan o'tadi (`normalizeQtyDecimal`) — aks holda
 * eksponent ko'rinishdagi son (`1e-7`) `computePositionTotal` ichida
 * `BigInt()` bilan otilardi.
 */
export function discountedLineTotalMinor(line: DiscountedCartLine): bigint {
  return computePositionTotal(
    {
      quantity: normalizeQtyDecimal(String(line.quantity)),
      priceMinor: line.priceMinor.toString(),
      discount: normalizeDecimalString(String(line.discount), 4),
      vat: null,
    },
    false,
    false,
  ).totalMinor;
}

/**
 * Savat jami — qator-ba-qator (server ham aynan shunday: har qatorni
 * alohida yaxlitlab qo'shadi, jamiga bir marta emas).
 */
export function discountedCartTotalMinor(lines: ReadonlyArray<DiscountedCartLine>): bigint {
  let sum = 0n;
  for (const l of lines) sum += discountedLineTotalMinor(l);
  return sum;
}

/**
 * Decimal-satrni server sxemasi qabul qiladigan kanonik shaklga keltiradi.
 *
 * Buzuq/eksponent/bo'sh qiymat → `'0'`: `String(number)` chegaraviy
 * qiymatlarda `'1e-7'` beradi va server regexi (`^\d+(\.\d{1,N})?$`) uni
 * 400 bilan rad etadi — bu yerda u jimgina nolga aylanadi, chunki nol
 * miqdor keyingi filtrda tushib qoladi.
 */
function normalizeDecimalString(raw: string, maxDecimals: number): string {
  const s = raw.trim();
  if (!/^\d*(?:\.\d*)?$/.test(s) || s === '' || s === '.') return '0';
  const [intPart = '', fracPart = ''] = s.split('.');
  const int = intPart.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracPart.slice(0, maxDecimals).replace(/0+$/, '');
  return frac === '' ? int : `${int}.${frac}`;
}

/** Miqdor-satr → server sxemasi (`Decimal(20,6)`) qabul qiladigan shakl. */
export function normalizeQtyDecimal(raw: string): string {
  return normalizeDecimalString(raw, 6);
}

/**
 * Qaytarish maydonining kiritmasini [0..maxQty] oralig'iga qisadi,
 * **satr sifatida**.
 *
 * FE-02: maydon `number` saqlaganda kassir kasr miqdor kirita OLMASDI —
 * «1.» yozilishi bilan `Number('1.')` = 1 bo'lib nuqta o'chib ketardi,
 * ya'ni og'irlik bilan sotilgan tovarni qisman qaytarib bo'lmasdi.
 * Shuning uchun yozilayotgan oraliq holat (`'1.'`, `''`) SAQLANADI va
 * faqat so'rov yuborishdan oldin normalizatsiya qilinadi.
 */
export function clampReturnQty(raw: string, maxQty: string): string {
  const s = raw.trim();
  if (s === '') return '';
  if (s.startsWith('-')) return '0';
  if (!/^\d*(?:\.\d*)?$/.test(s)) return '';
  const max = Number(maxQty);
  const n = Number(s === '.' ? '0' : s);
  if (!Number.isFinite(n) || !Number.isFinite(max)) return s;
  return n > max ? maxQty : s;
}

/** Qaytarish uchun asl chek qatoridan kerakli minimal. */
export interface RefundableLine {
  /** Asl sotilgan miqdor — Decimal(20,6) satri. */
  quantity: string;
  /** Asl qator summasi CHEGIRMADAN KEYIN (tiyin-satr) — server saqlagan raqam. */
  sumMinor: string;
  /** Qaytarilayotgan miqdor (maydon satr saqlaydi — FE-02). */
  returnQty: number | string;
}

/** Miqdor (satr yoki son) → mikro-birlik bigint. `BigInt(1.5)` otilishini yopadi. */
function qtyToMicro(qty: string | number): bigint {
  const n = typeof qty === 'number' ? qty : Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1e6));
}

/**
 * Qaytariladigan naqd (tiyin) — asl chek qatorining CHEGIRMALI summasidan
 * proporsional.
 *
 * FE-01: ilgari `priceMinor × qty` hisoblanardi, ya'ni chegirma e'tiborsiz
 * qolardi va kassa mijoz to'lamagan pulni qaytarardi. Endi baza — server
 * saqlagan `sumMinor` (chegirma ichida).
 *
 * ⚠️ Yaxlitlash **pastga** — ataylab va server bilan bir xil
 * (`priceRefundFromOriginal`): FE ko'rsatgan summa server qabul qiladigan
 * chegaradan oshsa, so'rov 400 bilan rad etilardi.
 */
export function refundPayoutMinor(lines: ReadonlyArray<RefundableLine>): bigint {
  let sum = 0n;
  for (const l of lines) {
    const soldMicro = qtyToMicro(l.quantity);
    const backMicro = qtyToMicro(l.returnQty);
    if (soldMicro <= 0n || backMicro <= 0n) continue;
    sum += (BigInt(l.sumMinor) * backMicro) / soldMicro;
  }
  return sum;
}

/**
 * Chekning QARZ ulushi (tiyin) — `RetailSalePayment` qatorlaridan.
 *
 * Ilgari FE bu raqamni umuman bilmasdi: chek detali to'lov qatorlarini
 * qaytarmasdi. Natijada qarzga sotilgan chek POS'dan qaytarilmasdi (quyiga
 * qara). Qatorlar yo'q eski chek — 0, ya'ni to'liq pulli deb qaraladi
 * (aynan avvalgi xulq).
 */
export function saleDebtMinor(
  payments: ReadonlyArray<{ method: string; amountBaseMinor: string }> | null | undefined,
): bigint {
  let sum = 0n;
  for (const p of payments ?? []) {
    if (p.method !== 'DEBT') continue;
    try {
      sum += BigInt(p.amountBaseMinor);
    } catch {
      // Buzuq qiymat pul yaratmasin.
    }
  }
  return sum;
}

/**
 * Qaytarishda KASSADAN chiqadigan naqd ulushi (tiyin).
 *
 * AUDIT (2026-08-11): qarzga sotilgan chekni POS'dan qaytarib bo'lmasdi —
 * ekran har doim to'liq naqd so'rardi, server esa
 * `validateRefundSettlement` bilan «payout > moneyMaxMinor» deb 400 berardi.
 * Sabab oddiy: qarzga olingan tovar uchun kassa PUL OLMAGAN, uni naqd
 * qaytarish — kassadan pul yo'qotish (va qarz balansda qolaverardi).
 *
 * Formula serverning `computeRefundSettlementCaps` idagi `moneyCap` bilan
 * AYNAN bir xil: `⌊(sum − debt) × R / sum⌋`, yaxlitlash pastga. Qarz ulushi
 * ATAYLAB yuborilmaydi — server uni o'zi hisoblaydi (`debtReturnMinor`
 * berilmaganda auto-split), shunda ketma-ket qisman qaytarishlarda
 * yaxlitlash serverning kümülativ bazasidan ketadi va tiyin sürüklanmaydi.
 */
export function refundCashShareMinor(i: {
  /** Asl chek summasi (tiyin). */
  originalSumMinor: bigint;
  /** Shu chekning qarzga qoldirilgan qismi (tiyin). */
  originalDebtMinor: bigint;
  /** Hozir qaytarilayotgan qiymat (tiyin) — `refundPayoutMinor` natijasi. */
  refundSumMinor: bigint;
}): bigint {
  const sum = i.originalSumMinor > 0n ? i.originalSumMinor : 0n;
  if (sum === 0n) return 0n;
  // Buzuq/legacy ma'lumot (qarz jamidan katta) yo'qdan naqd YARATMASIN —
  // server ham aynan shu qisishni qiladi.
  const debt =
    i.originalDebtMinor < 0n ? 0n : i.originalDebtMinor > sum ? sum : i.originalDebtMinor;
  const money = sum - debt;
  const refunded = i.refundSumMinor < 0n ? 0n : i.refundSumMinor > sum ? sum : i.refundSumMinor;
  return (money * refunded) / sum;
}

/**
 * Chekning YASHIQ olgan ulushi (tiyin) — `CASH_UZS` + `CASH_USD`.
 *
 * `amountBaseMinor` o'qiladi, `amountMinor` EMAS: dollar qatorida ikkinchisi
 * SENTDA turadi (MK31) va uni tiyin deb qo'shish ulushni ~12 000× kichik
 * ko'rsatardi.
 *
 * `null` = **O'LCHANMAGAN** (chek detali to'lov qatorlarini bermagan yoki
 * eski chekda ular umuman yo'q), `0n` = o'lchandi va naqd olinmagan. Ikkalasi
 * bir xil emas: birinchisida eski xulq (hammasi naqd) saqlanadi, aks holda
 * tarixiy cheklar POS'dan qaytarilmay qolardi.
 */
export function saleCashLikeMinor(
  payments: ReadonlyArray<{ method: string; amountBaseMinor: string }> | null | undefined,
): bigint | null {
  if (!payments || payments.length === 0) return null;
  let sum = 0n;
  for (const p of payments) {
    // 🔴 2026-08-17: `CASH_USD` BU YERDAN CHIQARILDI (egasi qarori, prodda
    // o'lchangan yo'qotishdan keyin). Dollar so'm ekvivalentida «naqd-o'xshash»
    // sanalgani uchun dollarli chek to'liq SO'MDA qaytarilib ketardi:
    // ТРН-2026-00318 (4 690 000 so'm + $100) → 5 890 000 so'm chiqdi ⇒ so'm
    // kassasi 1 200 000 ga kamaydi, $100 yashiqda qoldi. Dollar endi
    // `saleCashUsdMinor` orqali, O'Z birligida qaytariladi.
    if (p.method !== 'CASH_UZS') continue;
    try {
      sum += BigInt(p.amountBaseMinor);
    } catch {
      // Buzuq qiymat pul yaratmasin.
    }
  }
  return sum;
}

/**
 * Chek DOLLARDA olgan pul — **SENTDA** (`CASH_USD.amountMinor`).
 *
 * So'm yig'indilariga hech qachon qo'shilmaydi: ikkalasi ham `bigint`,
 * aralashtirilsa typecheck ko'rmaydi va kassa 12 000× xato hisoblardi.
 * `null` = o'lchanmagan (to'lov qatorlari yo'q eski chek) ⇒ dollar
 * qaytarish taklif qilinmaydi.
 */
export function saleCashUsdMinor(
  payments: ReadonlyArray<{ method: string; amountMinor: string }> | null | undefined,
): bigint | null {
  if (!payments || payments.length === 0) return null;
  let cents = 0n;
  for (const p of payments) {
    if (p.method !== 'CASH_USD') continue;
    try {
      cents += BigInt(p.amountMinor);
    } catch {
      // Buzuq qiymat pul yaratmasin.
    }
  }
  return cents;
}

/**
 * Dollar to'lovining SO'M ekvivalenti (tiyin) — `CASH_USD.amountBaseMinor`.
 *
 * So'm pul ulushidan chiqarish uchun kerak: server ham
 * `money = sum − debt − usdBase` qiladi. Ikkalasi bir formulada bo'lmasa POS
 * serverning cap'iga urilib qaytarishni bloklardi.
 */
export function saleUsdBaseMinor(
  payments: ReadonlyArray<{ method: string; amountBaseMinor: string }> | null | undefined,
): bigint {
  if (!payments || payments.length === 0) return 0n;
  let sum = 0n;
  for (const p of payments) {
    if (p.method !== 'CASH_USD') continue;
    try {
      sum += BigInt(p.amountBaseMinor);
    } catch {
      // Buzuq qiymat pul yaratmasin.
    }
  }
  return sum;
}

/**
 * Qaytarishni KANAL bo'yicha bo'lish — naqd (yashiqdan) va naqdsiz
 * (karta/terminal orqali).
 *
 * 🔴 NEGA (P5, prodda o'lchangan): ilgari POS butun pul ulushini `cash`
 * qatoriga yozardi. 100% KARTA bilan to'langan chek shu payloadda qaytarilib
 * **201** oldi va kassa qoldig'i 200 so'mga tushdi — yashiq hech qachon
 * olmagan pulni chiqarib yubordi (bankdagi qismini terminal orqali ham
 * qaytarish kerak ⇒ ikki karra to'lov). Server endi buni rad etadi
 * (`computeRefundSettlementCaps.cashMaxMinor`), ya'ni bu bo'linishsiz POS
 * karta chekini UMUMAN qaytara olmasdi.
 *
 * Formulalar serverning cap'lari bilan AYNAN bir xil (yaxlitlash ham pastga):
 *   naqd  = ⌊cashLike × R / sum⌋
 *   karta = ⌊(sum − debt) × R / sum⌋ − naqd
 * Shuning uchun `cash ≤ cashMax` va `cash + card ≤ moneyMax` — ikkala
 * server qo'riqchisi ham chegarada o'tadi.
 */
export function refundTenderSplit(i: {
  originalSumMinor: bigint;
  originalDebtMinor: bigint;
  /** `saleCashLikeMinor` natijasi; `null` = o'lchanmagan ⇒ eski xulq (naqd). */
  originalCashLikeMinor: bigint | null;
  /**
   * `saleCashUsdMinor` natijasi — SENT. Dollar ulushi so'm kanallariga
   * QO'SHILMAYDI: u `cashUsdReturnMinor` bo'lib alohida ketadi.
   */
  originalCashUsdMinor?: bigint | null;
  /** Dollarning SO'M ekvivalenti (tiyin) — so'm pul ulushidan chiqarish uchun. */
  originalUsdBaseMinor?: bigint;
  refundSumMinor: bigint;
}): { cashMinor: bigint; cardMinor: bigint; usdMinor: bigint } {
  // Dollar ulushi so'm pul ulushidan CHIQARILADI — server ham aynan shunday
  // (`money = sum − debt − usdBase`), aks holda POS serverning `moneyMax`
  // qo'riqchisiga urilib qaytarib bo'lmasdi.
  const usdBase =
    i.originalUsdBaseMinor && i.originalUsdBaseMinor > 0n ? i.originalUsdBaseMinor : 0n;
  const moneyMinor = refundCashShareMinor({
    originalSumMinor: i.originalSumMinor,
    originalDebtMinor: i.originalDebtMinor + usdBase,
    refundSumMinor: i.refundSumMinor,
  });

  const sumForUsd = i.originalSumMinor > 0n ? i.originalSumMinor : 0n;
  const refundedForUsd =
    i.refundSumMinor < 0n ? 0n : i.refundSumMinor > sumForUsd ? sumForUsd : i.refundSumMinor;
  // Dollar ham proporsional (qisman qaytarishda) — server bilan bir formula.
  const usdMinor =
    i.originalCashUsdMinor == null || sumForUsd === 0n || i.originalCashUsdMinor <= 0n
      ? 0n
      : (i.originalCashUsdMinor * refundedForUsd) / sumForUsd;

  if (i.originalCashLikeMinor == null) return { cashMinor: moneyMinor, cardMinor: 0n, usdMinor };

  const sum = i.originalSumMinor > 0n ? i.originalSumMinor : 0n;
  if (sum === 0n) return { cashMinor: 0n, cardMinor: 0n, usdMinor };
  const refunded = i.refundSumMinor < 0n ? 0n : i.refundSumMinor > sum ? sum : i.refundSumMinor;
  // Server ham AYNAN shu qisishni qiladi: naqd ulushi pul ulushidan katta
  // bo'lolmaydi (qaytim tufayli `amountBaseMinor` chek jamidan oshishi mumkin).
  const cashLikeRaw = i.originalCashLikeMinor < 0n ? 0n : i.originalCashLikeMinor;
  const debt =
    i.originalDebtMinor < 0n ? 0n : i.originalDebtMinor > sum ? sum : i.originalDebtMinor;
  // Qisish bazasi PUL ulushi — dollar bazasi ham chiqarilgan holda (server
  // `clamp(cashLike, 0, money)` qiladi, `money` esa usdBase'siz).
  const moneyShare = sum - debt - usdBase > 0n ? sum - debt - usdBase : 0n;
  const cashLike = cashLikeRaw > moneyShare ? moneyShare : cashLikeRaw;

  const cashMinor = (cashLike * refunded) / sum;
  const cardMinor = moneyMinor - cashMinor;
  return { cashMinor, cardMinor: cardMinor > 0n ? cardMinor : 0n, usdMinor };
}

/**
 * V3 (egasi, 2026-09-02): «pul qaytarganda naqd/karta tanlash imkoni bo'lsin».
 *
 * `refundTenderSplit` chek QANDAY to'langanidan kelib chiqib taqsimlaydi —
 * karta bilan to'langan chekda naqd 0 chiqadi. Kassir esa mijoz bilan
 * kelishib naqd berishi (yoki aksincha) kerak bo'lishi mumkin.
 *
 * Bu funksiya SO'M pul ulushini (naqd + karta) bitta tanlangan kanalga
 * yig'adi. `auto` — hisoblangan taqsimot o'z holicha (sukut xulq, hech narsa
 * o'zgarmaydi).
 *
 * 🔴 DOLLAR ULUSHIGA TEGILMAYDI: u boshqa BIRLIK (sent), o'z cap'i bilan
 * qaytadi — so'm kanallariga qo'shilsa MK31 dagi yo'qotish qaytarilardi.
 * Qarz ulushi ham tegilmaydi: u pul emas, serverning auto-split'i yozadi.
 */
export type RefundTenderChoice = 'auto' | 'cash' | 'card';

export function applyRefundTenderChoice(
  split: { cashMinor: bigint; cardMinor: bigint; usdMinor: bigint },
  choice: RefundTenderChoice,
): { cashMinor: bigint; cardMinor: bigint; usdMinor: bigint } {
  if (choice === 'auto') return split;
  const moneyMinor = split.cashMinor + split.cardMinor;
  return choice === 'cash'
    ? { cashMinor: moneyMinor, cardMinor: 0n, usdMinor: split.usdMinor }
    : { cashMinor: 0n, cardMinor: moneyMinor, usdMinor: split.usdMinor };
}

/**
 * Foyda bazasi — kassa HAQIQATAN oladigan pul.
 *
 * Mavjud chekni to'layotgan bo'lsak (omborchidan qaytgan «Tayyor» chek)
 * bu serverning o'z `sumMinor`i, qayta hisoblangan raqam EMAS: server
 * qator-ba-qator yaxlitlagan, biz esa jamiga foiz qo'llaymiz — ikkalasi
 * tiyinda farq qilishi mumkin va chekda ko'rinadigan raqam serverniki
 * bo'lishi kerak.
 */
export function revenueBaseMinor(
  postedSaleSumMinor: bigint | null | undefined,
  discountedTotalMinor: bigint,
): bigint {
  return postedSaleSumMinor ?? discountedTotalMinor;
}
