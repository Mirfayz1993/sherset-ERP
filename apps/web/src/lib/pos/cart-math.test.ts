import { describe, expect, it } from 'vitest';
import {
  addQtyDecimal,
  applyDiscountMinor,
  applyRefundTenderChoice,
  cartCostMinor,
  cartCount,
  cartLineMarkdownMinor,
  cartLineProfitMinor,
  cartLineRevenueMinor,
  cartTotalMinor,
  clampReturnQty,
  discountedCartTotalMinor,
  discountedLineTotalMinor,
  normalizeQtyDecimal,
  refundCashShareMinor,
  refundPayoutMinor,
  refundTenderSplit,
  revenueBaseMinor,
  saleCashLikeMinor,
  saleCashUsdMinor,
  saleDebtMinor,
  toMinorOrNull,
} from './cart-math';

describe('cartCount', () => {
  it('dona sonini qo`shadi', () => {
    expect(cartCount([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
  });

  it('bo`sh savat 0', () => {
    expect(cartCount([])).toBe(0);
  });
});

describe('cartTotalMinor', () => {
  it('narx × miqdor yig`indisi', () => {
    expect(
      cartTotalMinor([
        { quantity: 2, priceMinor: 150_000n },
        { quantity: 1, priceMinor: 99_900n },
      ]),
    ).toBe(399_900n);
  });

  it('bo`sh savat 0n', () => {
    expect(cartTotalMinor([])).toBe(0n);
  });

  it('2^53 dan katta jamida aniq (number bo`lsa yaxlitlanardi)', () => {
    const big = 9_007_199_254_740_993n;
    expect(cartTotalMinor([{ quantity: 2, priceMinor: big }])).toBe(big * 2n);
  });
});

describe('applyDiscountMinor', () => {
  it('foizni jamidan ayiradi', () => {
    expect(applyDiscountMinor(100_000n, 10)).toBe(90_000n);
  });

  it('chegirmasiz jami o`zgarmaydi', () => {
    expect(applyDiscountMinor(100_000n, 0)).toBe(100_000n);
  });

  it('yaxlitlash PASTGA — chegirma bir tiyinga kam bo`lishi mumkin', () => {
    // 333 * 10 / 100 = 33.3 → 33. Chegirma 33, jami 300.
    // Yuqoriga yaxlitlansa mijozga har chekda bir tiyin ortiqcha ketardi
    // va smena yakunida kamomad ko'rinardi.
    expect(applyDiscountMinor(333n, 10)).toBe(300n);
  });

  it('manfiy foiz e`tiborsiz (ustama bo`lib qolmasin)', () => {
    expect(applyDiscountMinor(100_000n, -20)).toBe(100_000n);
  });

  it('100 dan katta foiz qisiladi (manfiy jami bo`lmasin)', () => {
    expect(applyDiscountMinor(100_000n, 150)).toBe(0n);
  });

  it('100% chegirma nol beradi', () => {
    expect(applyDiscountMinor(100_000n, 100)).toBe(0n);
  });

  it('kasrli foiz pastga qisqartiriladi', () => {
    expect(applyDiscountMinor(100_000n, 10.9)).toBe(90_000n);
  });

  it('NaN e`tiborsiz', () => {
    expect(applyDiscountMinor(100_000n, Number.NaN)).toBe(100_000n);
  });
});

describe('toMinorOrNull — NULL ≠ 0 shartnomasi', () => {
  it('tiyin-satrni bigint qiladi', () => {
    expect(toMinorOrNull('12345')).toBe(12_345n);
  });

  it('null va bo`sh satr → null (0 EMAS)', () => {
    // `?? 0n` bo'lsa nol tan narx «tekin tushgan» degani bo'lib,
    // savat 100% marja ko'rsatardi.
    expect(toMinorOrNull(null)).toBeNull();
    expect(toMinorOrNull(undefined)).toBeNull();
    expect(toMinorOrNull('')).toBeNull();
  });

  it('buzuq qiymat → null, otilmaydi', () => {
    expect(toMinorOrNull('12.5')).toBeNull();
    expect(toMinorOrNull('abc')).toBeNull();
  });

  it('haqiqiy nol → 0n (bu «berilmagan» EMAS)', () => {
    expect(toMinorOrNull('0')).toBe(0n);
  });
});

describe('revenueBaseMinor', () => {
  it('mavjud chek bo`lsa SERVER summasi olinadi', () => {
    // Server qator-ba-qator yaxlitlagan; biz jamiga foiz qo'llaymiz —
    // chekda ko'rinadigan raqam serverniki bo'lishi kerak.
    expect(revenueBaseMinor(499_999n, 500_000n)).toBe(499_999n);
  });

  it('yangi savatda chegirmali jami olinadi', () => {
    expect(revenueBaseMinor(null, 500_000n)).toBe(500_000n);
    expect(revenueBaseMinor(undefined, 500_000n)).toBe(500_000n);
  });

  it('server summasi 0n bo`lsa ham U olinadi (null emas)', () => {
    expect(revenueBaseMinor(0n, 500_000n)).toBe(0n);
  });
});

/**
 * FE-01 (CRITICAL) — qaytariladigan naqd asl chekning CHEGIRMALI qator
 * summasidan hisoblanadi.
 *
 * Eski kod `priceMinor × qty` qilardi: 10% chegirma bilan sotilgan chekda
 * mijoz 900 000 to'lagan, kassa esa 1 000 000 qaytarardi — har chegirmali
 * qaytarishda kassa chegirma foizicha pul yo'qotardi. SALES-01 tuzatilgach
 * server bunday so'rovni umuman rad etadi (400), ya'ni bu formula
 * tuzatilmasa chegirmali chekni qaytarib BO'LMAY qoladi.
 *
 * Yaxlitlash pastga — server (`priceRefundFromOriginal`) bilan bir xil,
 * shunda FE ko'rsatgan summa server qabul qiladigan summadan oshmaydi.
 */
describe('refundPayoutMinor', () => {
  it('to`liq qaytarishda CHEGIRMALI summa (ro`yxat narxi EMAS)', () => {
    // 1 dona × 1 000 000, −10% → mijoz 900 000 to'lagan.
    expect(refundPayoutMinor([{ quantity: '1', sumMinor: '900000', returnQty: 1 }])).toBe(900_000n);
  });

  it('qisman qaytarishda proporsional', () => {
    expect(refundPayoutMinor([{ quantity: '10', sumMinor: '900000', returnQty: 3 }])).toBe(
      270_000n,
    );
  });

  it('qaytarilmayotgan qator 0 beradi', () => {
    expect(refundPayoutMinor([{ quantity: '10', sumMinor: '900000', returnQty: 0 }])).toBe(0n);
  });

  it('bir nechta qatorni qo`shadi', () => {
    expect(
      refundPayoutMinor([
        { quantity: '2', sumMinor: '200', returnQty: 1 },
        { quantity: '1', sumMinor: '500', returnQty: 1 },
      ]),
    ).toBe(600n);
  });

  it('yaxlitlash PASTGA — asl summadan oshmaydi', () => {
    // 3 dona = 100 tiyin; har dona 33.33 → 33 (34 emas).
    expect(refundPayoutMinor([{ quantity: '3', sumMinor: '100', returnQty: 1 }])).toBe(33n);
    expect(refundPayoutMinor([{ quantity: '3', sumMinor: '100', returnQty: 3 }])).toBe(100n);
  });

  it('kasr (og`irlik) miqdorda otilmaydi va to`g`ri hisoblaydi', () => {
    // BigInt(1.5) TypeError berardi (FE-02 klassi) — mikro-birlik shuni yopadi.
    expect(refundPayoutMinor([{ quantity: '1.5', sumMinor: '150', returnQty: 0.5 }])).toBe(50n);
  });

  it('nol miqdorli asl qator 0 beradi (bo`lish xatosi yo`q)', () => {
    expect(refundPayoutMinor([{ quantity: '0', sumMinor: '100', returnQty: 1 }])).toBe(0n);
  });

  it('satr ko`rinishidagi qaytarish miqdorini ham qabul qiladi', () => {
    // FE-02: maydon endi decimal SATR saqlaydi (number emas) — shartnoma
    // kengaydi, aks holda `String(number)` orqali «1e-7» kabi qiymat
    // serverga ketardi.
    expect(refundPayoutMinor([{ quantity: '1.5', sumMinor: '150', returnQty: '0.5' }])).toBe(50n);
  });
});

/**
 * FE-01 (web-arch) — retail savat jami SERVER formulasi bilan bir xil.
 *
 * Eski `BigInt(Math.round(qty * Number(priceMinor) * (1 - discount / 100)))`
 * IEEE-754 float edi; server esa `computePositionTotal` (BigInt, half-up)
 * bilan qayta hisoblab `expectedSumMinor` bilan QAT'IY tenglikni tekshiradi
 * va farq bo'lsa chekni RAD ETADI (`retail-sale.service.ts` — 400).
 */
describe('discountedLineTotalMinor', () => {
  it('chegirmali qatorda server bilan bir xil tiyin beradi', () => {
    // 115 tiyin × 1 dona, −10%:
    //   float:  Math.round(115 * 0.9) = Math.round(103.49999999999999) = 103
    //   server: roundHalfUp(103_500_000, 1e6) = 104
    // Ya'ni eski formula bilan bu chek serverda rad etilardi.
    expect(discountedLineTotalMinor({ quantity: 1, priceMinor: 115n, discount: 10 })).toBe(104n);
  });

  it('chegirmasiz qator narx × miqdor', () => {
    expect(discountedLineTotalMinor({ quantity: 3, priceMinor: 150_000n, discount: 0 })).toBe(
      450_000n,
    );
  });

  it('kasr miqdor (og`irlik) 6 xonagacha aniq', () => {
    expect(
      discountedLineTotalMinor({ quantity: '0.0004', priceMinor: 250_000n, discount: 0 }),
    ).toBe(100n);
  });

  it('2^53 dan katta narxda aniq (float yaxlitlardi)', () => {
    const big = 9_007_199_254_740_993n;
    expect(discountedLineTotalMinor({ quantity: 2, priceMinor: big, discount: 0 })).toBe(big * 2n);
  });

  it('kasrli chegirma foizi (4 xonagacha) qo`llanadi', () => {
    expect(discountedLineTotalMinor({ quantity: 1, priceMinor: 1000n, discount: 33.33 })).toBe(
      667n,
    );
  });

  it('100% chegirma nol beradi', () => {
    expect(discountedLineTotalMinor({ quantity: 2, priceMinor: 1000n, discount: 100 })).toBe(0n);
  });
});

describe('discountedCartTotalMinor', () => {
  it('qator jamilarining yig`indisi (server ham qator-ba-qator yaxlitlaydi)', () => {
    expect(
      discountedCartTotalMinor([
        { quantity: 1, priceMinor: 115n, discount: 10 },
        { quantity: 1, priceMinor: 115n, discount: 10 },
      ]),
    ).toBe(208n);
  });

  it('bo`sh savat 0n', () => {
    expect(discountedCartTotalMinor([])).toBe(0n);
  });
});

/**
 * FE-02 — qaytariladigan miqdor maydoni.
 *
 * `Record<string, number>` bo'lganda kassir kasr miqdor kirita OLMASDI:
 * «1.» yozilishi bilan `Number('1.')` = 1 bo'lib nuqta o'chib ketardi
 * (og'irlik bilan sotilgan tovarni qisman qaytarib bo'lmaydi), va
 * `String(number)` chegaraviy qiymatlarda eksponent («1e-7») berardi —
 * server sxemasi (`^\d+(\.\d{1,6})?$`) uni rad etadi.
 */
describe('clampReturnQty', () => {
  it('yozilayotgan nuqtani saqlaydi', () => {
    expect(clampReturnQty('1.', '3')).toBe('1.');
  });

  it('kasr miqdorni saqlaydi', () => {
    expect(clampReturnQty('1.5', '3')).toBe('1.5');
  });

  it('sotilgan miqdordan oshsa qisiladi', () => {
    expect(clampReturnQty('5', '3')).toBe('3');
  });

  it('kasrli chegara ham hurmat qilinadi', () => {
    expect(clampReturnQty('3.6', '3.5')).toBe('3.5');
    expect(clampReturnQty('3.5', '3.5')).toBe('3.5');
  });

  it('manfiy qiymat 0 ga qisiladi', () => {
    expect(clampReturnQty('-1', '3')).toBe('0');
  });

  it('bo`sh maydon bo`sh qoladi (0 ga majburlamaydi)', () => {
    expect(clampReturnQty('', '3')).toBe('');
  });

  it('raqam bo`lmagan kiritma qabul qilinmaydi', () => {
    expect(clampReturnQty('abc', '3')).toBe('');
    expect(clampReturnQty('1e5', '3')).toBe('');
  });
});

describe('normalizeQtyDecimal', () => {
  it('yakuniy nuqtani olib tashlaydi', () => {
    expect(normalizeQtyDecimal('1.')).toBe('1');
  });

  it('nuqtadan boshlangan kiritmani to`ldiradi', () => {
    expect(normalizeQtyDecimal('.5')).toBe('0.5');
  });

  it('boshidagi nollarni tozalaydi', () => {
    expect(normalizeQtyDecimal('0002')).toBe('2');
  });

  it('oxiridagi nollarni tozalaydi', () => {
    expect(normalizeQtyDecimal('1.5000')).toBe('1.5');
    expect(normalizeQtyDecimal('2.000')).toBe('2');
  });

  it('server chegarasi — 6 kasr xona', () => {
    // Sxema: `^\d+(\.\d{1,6})?$` — 7-xona bilan so'rov 400 bilan qaytardi.
    expect(normalizeQtyDecimal('1.1234567')).toBe('1.123456');
  });

  it('bo`sh/buzuq → «0» (eksponent serverga ketmaydi)', () => {
    expect(normalizeQtyDecimal('')).toBe('0');
    expect(normalizeQtyDecimal('abc')).toBe('0');
    expect(normalizeQtyDecimal('1e-7')).toBe('0');
  });
});

/**
 * F5 (audit 2026-08-11) — QARZLI chekni POS'dan qaytarish.
 *
 * Hozirgacha mumkin EMAS edi: `sotuv/page.tsx` refundda har doim to'liq naqd
 * so'rardi (`cashAmountMinor` = butun qiymat), server esa
 * `retail-refund-validation.ts` `moneyMaxMinor` bilan «kassa bu tovar uchun
 * bunchalik pul OLMAGAN» deb 400 berardi (xom inglizcha matn bilan). Ya'ni
 * qarzga sotilgan chekni kassir umuman qaytara olmasdi.
 *
 * Formula serverning `computeRefundSettlementCaps` idagi `moneyCap` ning
 * AYNAN o'zi: `⌊(sum − debt) × R / sum⌋`. Qolgani (qarz ulushi) ataylab
 * yuborilmaydi — server uni o'zi hisoblaydi (auto-split), shunda qisman
 * qaytarishlarda yaxlitlash serverning kümülativ bazasidan ketadi.
 */
describe('refundCashShareMinor', () => {
  it('qarzsiz chek — hammasi naqd (xulq o`zgarmagan)', () => {
    expect(
      refundCashShareMinor({
        originalSumMinor: 900_000n,
        originalDebtMinor: 0n,
        refundSumMinor: 900_000n,
      }),
    ).toBe(900_000n);
  });

  it('to`liq qarzli chek — naqd NOL (kassa pul olmagan)', () => {
    expect(
      refundCashShareMinor({
        originalSumMinor: 900_000n,
        originalDebtMinor: 900_000n,
        refundSumMinor: 900_000n,
      }),
    ).toBe(0n);
  });

  it('qisman qarz — naqd ulushi proporsional', () => {
    // 100 000 dan 60 000 qarzga: kassa 40 000 olgan. To'liq qaytarishda 40 000.
    expect(
      refundCashShareMinor({
        originalSumMinor: 100_000n,
        originalDebtMinor: 60_000n,
        refundSumMinor: 100_000n,
      }),
    ).toBe(40_000n);
  });

  it('qisman qaytarishda ham proporsional', () => {
    // Yarmi qaytarilsa kassa olgan pulning yarmi: 40 000 × 50 000 / 100 000.
    expect(
      refundCashShareMinor({
        originalSumMinor: 100_000n,
        originalDebtMinor: 60_000n,
        refundSumMinor: 50_000n,
      }),
    ).toBe(20_000n);
  });

  it('yaxlitlash PASTGA — server chegarasidan oshmaydi', () => {
    // 100 dan 1 qarz ⇒ money 99; R = 1 ⇒ 99 × 1 / 100 = 0.99 → 0.
    expect(
      refundCashShareMinor({ originalSumMinor: 100n, originalDebtMinor: 1n, refundSumMinor: 1n }),
    ).toBe(0n);
  });

  it('buzuq ma`lumot (qarz jamidan katta) naqd yaratmaydi', () => {
    expect(
      refundCashShareMinor({
        originalSumMinor: 100_000n,
        originalDebtMinor: 200_000n,
        refundSumMinor: 100_000n,
      }),
    ).toBe(0n);
  });

  it('nol summali chek bo`lishga urinmaydi', () => {
    expect(
      refundCashShareMinor({ originalSumMinor: 0n, originalDebtMinor: 0n, refundSumMinor: 500n }),
    ).toBe(0n);
  });

  it('qaytarilgan qiymat chek summasidan oshsa — qisiladi', () => {
    expect(
      refundCashShareMinor({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        refundSumMinor: 150_000n,
      }),
    ).toBe(100_000n);
  });
});

/**
 * Chekning qarz ulushi — `RetailSalePayment` qatorlaridan. Ilgari FE bu
 * raqamni umuman bilmasdi (detal javobida to'lov qatorlari yo'q edi).
 */
describe('saleDebtMinor', () => {
  it('DEBT qatorlarini qo`shadi, boshqasini e`tiborsiz qoldiradi', () => {
    expect(
      saleDebtMinor([
        { method: 'CASH_UZS', amountBaseMinor: '40000' },
        { method: 'DEBT', amountBaseMinor: '60000' },
      ]),
    ).toBe(60_000n);
  });

  it('to`lov qatorlari yo`q eski chekda 0 (naqd deb qaraladi)', () => {
    expect(saleDebtMinor(undefined)).toBe(0n);
    expect(saleDebtMinor([])).toBe(0n);
  });
});

// ── F8 (AUDIT) — kasr miqdor: `BigInt(1.5)` RangeError bug-klassi ───────────
//
// Server sxemasi `quantity` ni `Decimal(20,6)` sifatida qabul qiladi
// (`retail-sale.schema.ts` → `/^\d+(\.\d{1,6})?$/`), ya'ni og'irlik bilan
// sotiladigan tovar savatga 1.5 kg bo'lib tushishi MUMKIN. Savat matematikasi
// esa `BigInt(l.quantity)` yozardi — `BigInt(1.5)` **RangeError** otadi va
// React render'i ichida otilgan xato butun POS ni oq ekranga aylantiradi
// (chek yo'q, pul yo'q, kassir nima bo'lganini bilmaydi).
//
// Zakaz pozitsiyalari ham kasr bo'lishi mumkin — F8 aynan shu yuklovchini
// qo'shadi, shuning uchun tuzatish shu fazada.

describe('F8 — kasr miqdor savat matematikasini yiqitmaydi', () => {
  it('cartTotalMinor kasr miqdorda ham hisoblaydi (ilgari RangeError)', () => {
    expect(cartTotalMinor([{ quantity: '1.5', priceMinor: 100_000n }])).toBe(150_000n);
  });

  it('cartTotalMinor kasr `number` da ham yiqilmaydi', () => {
    expect(cartTotalMinor([{ quantity: 1.5, priceMinor: 100_000n }])).toBe(150_000n);
  });

  it('cartCount kasr miqdorni SATRdan ham o`qiydi', () => {
    expect(cartCount([{ quantity: '1.5' }, { quantity: '2' }])).toBe(3.5);
  });

  it('cartTotalMinor yaxlitlashi server bilan bir xil (half-up)', () => {
    // 0.333 × 115 tiyin = 38.295 → 38
    expect(cartTotalMinor([{ quantity: '0.333', priceMinor: 115n }])).toBe(38n);
    // 0.5 × 115 = 57.5 → 58 (half-up, pastga EMAS)
    expect(cartTotalMinor([{ quantity: '0.5', priceMinor: 115n }])).toBe(58n);
  });
});

describe('F8 — addQtyDecimal (± tugmalari kasr miqdorni buzmaydi)', () => {
  it('butun sonlarga oddiy qo`shadi', () => {
    expect(addQtyDecimal('2', 1)).toBe('3');
    expect(addQtyDecimal('2', -1)).toBe('1');
  });

  it('kasr miqdorni SAQLAYDI (1.5 + 1 = 2.5, float artefaktisiz)', () => {
    expect(addQtyDecimal('1.5', 1)).toBe('2.5');
  });

  it('0.1 + 0.2 float artefakti YO`Q', () => {
    expect(addQtyDecimal('0.1', 0.2)).toBe('0.3');
  });

  it('manfiyga tushmaydi — 0 qaytadi (chaqiruvchi qatorni o`chiradi)', () => {
    expect(addQtyDecimal('0.5', -1)).toBe('0');
  });

  it('buzuq kiritma 0 (crash emas)', () => {
    expect(addQtyDecimal('abc', 1)).toBe('1');
  });
});

describe('F8 — cartCostMinor (tan narx × kasr miqdor, NULL≠0)', () => {
  it('kasr miqdorda tan narxni yaxlitlaydi', () => {
    expect(cartCostMinor([{ costMinor: 100_000n, quantity: '1.5' }])).toEqual({
      costMinor: 150_000n,
      complete: true,
    });
  });

  it('bitta qator tan narxsiz bo`lsa `complete` false va u QO`SHILMAYDI', () => {
    expect(
      cartCostMinor([
        { costMinor: 100_000n, quantity: '1' },
        { costMinor: null, quantity: '2' },
      ]),
    ).toEqual({ costMinor: 100_000n, complete: false });
  });
});

// ── F8 (AUDIT) — savat footeri ↔ server chegirmasi ──────────────────────────
//
// Sahifa JAMIga bir marta floor-chegirma qo'llardi, server esa HAR QATORNI
// alohida half-up yaxlitlaydi. Natija: ekranda bir raqam, chekda boshqasi.
// Bu test farqni O'LCHAYDI va `discountedCartTotalMinor` server bilan
// mos ekanini qulflaydi.
describe('F8 — chegirma: jamiga bir marta ≠ qator-ba-qator', () => {
  const lines = [
    { quantity: 1, priceMinor: 115n, discount: 10 },
    { quantity: 1, priceMinor: 115n, discount: 10 },
    { quantity: 1, priceMinor: 115n, discount: 10 },
  ];

  it('eski (sahifa) formulasi va server formulasi 1 tiyin farq qiladi', () => {
    const legacy = applyDiscountMinor(cartTotalMinor(lines), 10);
    const serverLike = discountedCartTotalMinor(lines);
    expect(legacy).toBe(311n); // 345 − floor(34.5) = 345 − 34
    expect(serverLike).toBe(312n); // 3 × round_half_up(103.5) = 3 × 104
    expect(serverLike - legacy).toBe(1n);
  });
});

// ── F8 — qator formulalari kasr miqdorni qo'llaydi ──────────────────────────
//
// `@moysklad/money` dagi `lineProfitMinor` / `markdownMinor` miqdorni `bigint`
// oladi, ya'ni 1.5 kg ni umuman ifodalay olmaydi. Sahifada `(narx − tan) × soni`
// ni QAYTA YOZISH taqiqlangan (`__tests__/pos-cart-profit.test.ts` qo'riqchisi:
// «formulalar umumiy paketdan keladi») — shuning uchun ular shu yerda, sof va
// sinalgan holda turadi.
describe('F8 — savat qatori formulalari (kasr miqdor)', () => {
  it('cartLineRevenueMinor: narx × miqdor, half-up', () => {
    expect(cartLineRevenueMinor({ priceMinor: 100_000n, quantity: '1.5' })).toBe(150_000n);
    expect(cartLineRevenueMinor({ priceMinor: 115n, quantity: '0.5' })).toBe(58n);
  });

  it('cartLineProfitMinor: (narx − tan) × miqdor', () => {
    expect(cartLineProfitMinor({ priceMinor: 100_000n, costMinor: 60_000n, quantity: '1.5' })).toBe(
      60_000n,
    );
  });

  it('cartLineProfitMinor: tan narx NULL bo`lsa NULL (0 EMAS)', () => {
    // `?? 0n` bo'lsa qator 100% foyda ko'rsatardi — kassa TZ §5.3.
    expect(
      cartLineProfitMinor({ priceMinor: 100_000n, costMinor: null, quantity: '1' }),
    ).toBeNull();
  });

  it('cartLineProfitMinor: zararda MANFIY (yaxlitlash nolga qarab emas)', () => {
    expect(cartLineProfitMinor({ priceMinor: 100n, costMinor: 115n, quantity: '0.5' })).toBe(-8n);
  });

  it('cartLineMarkdownMinor: (kartochka narxi − sotilgan narx) × miqdor', () => {
    expect(
      cartLineMarkdownMinor({ basePriceMinor: 100_000n, priceMinor: 90_000n, quantity: '2.5' }),
    ).toBe(25_000n);
  });

  it('cartLineMarkdownMinor: kartochka narxi NULL bo`lsa NULL', () => {
    expect(
      cartLineMarkdownMinor({ basePriceMinor: null, priceMinor: 90_000n, quantity: '1' }),
    ).toBeNull();
  });
});

/**
 * P5 (2026-08-12) — qaytarishni KANAL bo'yicha bo'lish.
 *
 * Prodda o'lchandi (R1): 100% KARTA cheki naqd qaytarilib yashiq olmagan
 * pulni chiqarib yubordi. Server endi buni rad etadi (`cashMaxMinor`), ya'ni
 * POS eski payloadni yuborsa (`cash = butun pul ulushi, card = 0`) KARTA
 * chekini umuman qaytarib bo'lmay qolardi — ekran ham bo'lishi kerak.
 */
describe('refundTenderSplit — naqd/naqdsiz ulushlar (P5)', () => {
  it('100% NAQD chek: hammasi naqd', () => {
    expect(
      refundTenderSplit({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 100_000n,
        refundSumMinor: 100_000n,
      }),
    ).toEqual({ cashMinor: 100_000n, cardMinor: 0n, usdMinor: 0n });
  });

  it('🔴 100% KARTA chek: naqd 0, hammasi karta qatoriga', () => {
    expect(
      refundTenderSplit({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 0n,
        refundSumMinor: 100_000n,
      }),
    ).toEqual({ cashMinor: 0n, cardMinor: 100_000n, usdMinor: 0n });
  });

  it('ARALASH chek: har kanal o`z ulushida', () => {
    // 100 000 = 30 000 naqd + 70 000 karta; yarmi qaytarilyapti ⇒
    // naqd 15 000, karta 35 000 (jami 50 000 = pul ulushi).
    expect(
      refundTenderSplit({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 30_000n,
        refundSumMinor: 50_000n,
      }),
    ).toEqual({ cashMinor: 15_000n, cardMinor: 35_000n, usdMinor: 0n });
  });

  it('QARZLI chek: qarz ulushi ikkala kanalga ham tushmaydi', () => {
    // 100 000: 40 000 naqd + 60 000 qarz ⇒ pul ulushi 40 000, hammasi naqd.
    expect(
      refundTenderSplit({
        originalSumMinor: 100_000n,
        originalDebtMinor: 60_000n,
        originalCashLikeMinor: 40_000n,
        refundSumMinor: 100_000n,
      }),
    ).toEqual({ cashMinor: 40_000n, cardMinor: 0n, usdMinor: 0n });
  });

  it('yig`indi HECH QACHON `refundCashShareMinor` (pul ulushi) dan oshmaydi', () => {
    for (const cashLike of [0n, 1n, 33_333n, 70_000n, 100_000n]) {
      const money = refundCashShareMinor({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        refundSumMinor: 33_333n,
      });
      const split = refundTenderSplit({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: cashLike,
        refundSumMinor: 33_333n,
      });
      expect(split.cashMinor + split.cardMinor).toBeLessThanOrEqual(money);
      expect(split.cashMinor).toBeGreaterThanOrEqual(0n);
      expect(split.cardMinor).toBeGreaterThanOrEqual(0n);
    }
  });

  it('nol chek: bo`lish yo`q, nolga bo`linish ham yo`q', () => {
    expect(
      refundTenderSplit({
        originalSumMinor: 0n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 0n,
        refundSumMinor: 500n,
      }),
    ).toEqual({ cashMinor: 0n, cardMinor: 0n, usdMinor: 0n });
  });

  it('to`lov qatorlari YO`Q eski chek: eski xulq — hammasi naqd', () => {
    // `saleCashLikeMinor(undefined)` = 0 bo'lsa karta qatoriga tushib
    // ketardi; eski cheklar naqd deb qaraladi (`saleDebtMinor` bilan bir xil
    // zaxira qoida) — aks holda tarixiy chek qaytarilmay qolardi.
    expect(saleCashLikeMinor(null)).toBeNull();
    expect(
      refundTenderSplit({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: null,
        refundSumMinor: 100_000n,
      }),
    ).toEqual({ cashMinor: 100_000n, cardMinor: 0n, usdMinor: 0n });
  });
});

describe('saleCashLikeMinor — yashiq olgan ulush (P5)', () => {
  it('FAQAT `CASH_UZS` ni qo`shadi — dollar CHIQARILDI (2026-08-17)', () => {
    // Shartnoma egasi qarori bilan o'zgardi: dollar so'm cap'iga kirmaydi,
    // aks holda dollarli chek to'liq so'mda qaytarilib kassa kamayardi
    // (prodda o'lchandi: ТРН-2026-00318 → 1 200 000 so'm yo'qotish).
    expect(
      saleCashLikeMinor([
        { method: 'CASH_UZS', amountBaseMinor: '30000' },
        { method: 'CASH_USD', amountBaseMinor: '23869' },
        { method: 'CARD', amountBaseMinor: '10000' },
        { method: 'TERMINAL', amountBaseMinor: '10000' },
        { method: 'DEBT', amountBaseMinor: '5000' },
      ]),
    ).toBe(30_000n);
  });

  it('dollar ulushi SENTDA alohida o`qiladi (`saleCashUsdMinor`)', () => {
    expect(
      saleCashUsdMinor([
        { method: 'CASH_UZS', amountMinor: '30000' },
        { method: 'CASH_USD', amountMinor: '200' },
        { method: 'CARD', amountMinor: '10000' },
      ]),
    ).toBe(200n);
  });

  it('dollar qatori yo`q chekda 0, qatorlar umuman yo`q bo`lsa null', () => {
    expect(saleCashUsdMinor([{ method: 'CASH_UZS', amountMinor: '1' }])).toBe(0n);
    expect(saleCashUsdMinor([])).toBeNull();
    expect(saleCashUsdMinor(null)).toBeNull();
  });

  it('faqat naqdsiz chek: 0 (null EMAS — qatorlar BOR)', () => {
    expect(saleCashLikeMinor([{ method: 'CARD', amountBaseMinor: '10000' }])).toBe(0n);
  });

  it('qatorlar yo`q / noma`lum: null = O`LCHANMAGAN', () => {
    expect(saleCashLikeMinor(undefined)).toBeNull();
    expect(saleCashLikeMinor([])).toBeNull();
  });

  it('buzuq qiymat pul YARATMAYDI', () => {
    expect(saleCashLikeMinor([{ method: 'CASH_UZS', amountBaseMinor: 'xx' }])).toBe(0n);
  });
});

/**
 * V3 (egasi, 2026-09-02): «pul qaytarganda naqd/karta tanlash imkoni bo'lsin».
 * Kanal tanlovi SO'M ulushini bitta kanalga yig'adi; dollar va qarz tegilmaydi.
 */
describe('applyRefundTenderChoice', () => {
  const split = { cashMinor: 30_000n, cardMinor: 70_000n, usdMinor: 500n };

  it('`auto` — taqsimot o`z holicha (sukut xulq o`zgarmaydi)', () => {
    expect(applyRefundTenderChoice(split, 'auto')).toEqual(split);
  });

  it('`cash` — butun so`m ulushi naqdga yig`iladi', () => {
    expect(applyRefundTenderChoice(split, 'cash')).toEqual({
      cashMinor: 100_000n,
      cardMinor: 0n,
      usdMinor: 500n,
    });
  });

  it('`card` — butun so`m ulushi kartaga yig`iladi', () => {
    expect(applyRefundTenderChoice(split, 'card')).toEqual({
      cashMinor: 0n,
      cardMinor: 100_000n,
      usdMinor: 500n,
    });
  });

  it('DOLLAR ulushi hech qachon so`m kanaliga qo`shilmaydi (MK31)', () => {
    for (const c of ['auto', 'cash', 'card'] as const) {
      expect(applyRefundTenderChoice(split, c).usdMinor).toBe(500n);
    }
  });

  it('so`m jami HAR QANDAY tanlovda saqlanadi (pul yo`qdan paydo bo`lmaydi)', () => {
    for (const c of ['auto', 'cash', 'card'] as const) {
      const r = applyRefundTenderChoice(split, c);
      expect(r.cashMinor + r.cardMinor).toBe(100_000n);
    }
  });

  it('100% KARTA chekini NAQDGA o`tkazish (egasi so`ragan asosiy holat)', () => {
    const kartaChek = { cashMinor: 0n, cardMinor: 23_000n, usdMinor: 0n };
    expect(applyRefundTenderChoice(kartaChek, 'cash')).toEqual({
      cashMinor: 23_000n,
      cardMinor: 0n,
      usdMinor: 0n,
    });
  });
});
