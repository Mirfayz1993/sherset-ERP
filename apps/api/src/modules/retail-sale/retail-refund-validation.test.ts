import { describe, expect, it } from 'vitest';
import {
  type OriginalLine,
  type OriginalPricedLine,
  computeRefundSettlementCaps,
  isFullyRefunded,
  priceRefundFromOriginal,
  validateRefundAmount,
  validateRefundPositions,
  validateRefundSettlement,
} from './retail-refund-validation.js';

const sale: OriginalLine[] = [
  { productId: 'A', quantity: '3' },
  { productId: 'B', quantity: '1.5' },
];

describe('validateRefundPositions — enforces the documented subset contract', () => {
  it('accepts a valid subset (qty <= sold)', () => {
    expect(validateRefundPositions(sale, [{ productId: 'A', quantity: '2' }])).toBeNull();
    expect(
      validateRefundPositions(sale, [
        { productId: 'A', quantity: '3' },
        { productId: 'B', quantity: '1.5' },
      ]),
    ).toBeNull();
  });

  it('REJECTS over-refund: qty > sold (the §105 bug)', () => {
    expect(validateRefundPositions(sale, [{ productId: 'A', quantity: '4' }])).toMatch(
      /exceeds sold qty/,
    );
  });

  it('REJECTS split refund lines that COLLECTIVELY over-refund', () => {
    // 2 + 2 = 4 > 3 sold, even though each line < 3.
    expect(
      validateRefundPositions(sale, [
        { productId: 'A', quantity: '2' },
        { productId: 'A', quantity: '2' },
      ]),
    ).toMatch(/exceeds sold qty/);
  });

  it('accepts split refund lines that collectively stay within sold', () => {
    expect(
      validateRefundPositions(sale, [
        { productId: 'A', quantity: '1' },
        { productId: 'A', quantity: '2' },
      ]),
    ).toBeNull();
  });

  it('REJECTS a product never in the original sale', () => {
    expect(validateRefundPositions(sale, [{ productId: 'Z', quantity: '1' }])).toMatch(
      /not in the original sale/,
    );
  });

  it('REJECTS zero / negative refund qty', () => {
    expect(validateRefundPositions(sale, [{ productId: 'A', quantity: '0' }])).toMatch(
      /must be > 0/,
    );
  });

  it('aggregates original split lines (sold qty summed across lines)', () => {
    const split: OriginalLine[] = [
      { productId: 'A', quantity: '2' },
      { productId: 'A', quantity: '2' },
    ];
    expect(validateRefundPositions(split, [{ productId: 'A', quantity: '4' }])).toBeNull();
    expect(validateRefundPositions(split, [{ productId: 'A', quantity: '4.000001' }])).toMatch(
      /exceeds sold qty/,
    );
  });

  it('ignores null-product (service) original lines', () => {
    const withService: OriginalLine[] = [
      { productId: null, quantity: '1' },
      { productId: 'A', quantity: '2' },
    ];
    expect(validateRefundPositions(withService, [{ productId: 'A', quantity: '2' }])).toBeNull();
  });

  it('exact at the 6th decimal (Decimal(20,6) boundary)', () => {
    const s: OriginalLine[] = [{ productId: 'A', quantity: '1.000000' }];
    expect(validateRefundPositions(s, [{ productId: 'A', quantity: '1.000000' }])).toBeNull();
    expect(validateRefundPositions(s, [{ productId: 'A', quantity: '1.000001' }])).toMatch(
      /exceeds sold qty/,
    );
  });
});

describe('validateRefundAmount — cannot pay back more than refunded value', () => {
  it('accepts payout == refunded value', () => {
    expect(validateRefundAmount(1_000_00n, 600_00n, 400_00n)).toBeNull();
  });

  it('accepts payout < refunded value (partial cash settlement)', () => {
    expect(validateRefundAmount(1_000_00n, 500_00n, 0n)).toBeNull();
  });

  it('REJECTS payout > refunded value (over-refunded cash)', () => {
    expect(validateRefundAmount(1_000_00n, 800_00n, 300_00n)).toMatch(/exceeds refunded value/);
  });

  it('REJECTS negative cash/card', () => {
    expect(validateRefundAmount(1_000_00n, -1n, 0n)).toMatch(/non-negative/);
  });

  it('exact BigInt at the boundary (no off-by-one)', () => {
    expect(validateRefundAmount(100n, 50n, 51n)).toMatch(/exceeds refunded value/);
    expect(validateRefundAmount(100n, 50n, 50n)).toBeNull();
  });
});

/**
 * SALES-01 (CRITICAL) — the refund used to be priced from the CLIENT's
 * `priceMinor`, so `validateRefundAmount` capped the payout against a number
 * the attacker supplied. `priceRefundFromOriginal` removes the client from the
 * money path entirely: the refund value comes from the original receipt's own
 * (already discounted) `sumMinor`, prorated by the refunded quantity.
 *
 * Invariant this function must never break:
 *   Σ(refund lineMinor per product) ≤ Σ(original sumMinor per product)
 * — which, summed over products, is `Σ refund ≤ original.sumMinor`.
 */
describe('priceRefundFromOriginal — refund value comes from the ORIGINAL receipt', () => {
  const discounted: OriginalPricedLine[] = [
    // 1 000 000 tiyin × 1 dona, 10% chegirma → mijoz 900 000 to'lagan.
    { productId: 'A', quantity: '1', priceMinor: 1_000_000n, discount: '10', sumMinor: 900_000n },
  ];

  it('prices a full refund at the DISCOUNTED sum the customer actually paid (FE-01)', () => {
    const priced = priceRefundFromOriginal(discounted, [{ productId: 'A', quantity: '1' }]);
    expect(priced.totalMinor).toBe(900_000n);
    expect(priced.rows).toHaveLength(1);
    expect(priced.rows[0]?.lineMinor).toBe(900_000n);
  });

  it('carries the original priceMinor/discount onto the mirror row', () => {
    const priced = priceRefundFromOriginal(discounted, [{ productId: 'A', quantity: '1' }]);
    expect(priced.rows[0]?.priceMinor).toBe(1_000_000n);
    expect(priced.rows[0]?.discount).toBe('10');
    expect(priced.rows[0]?.quantity).toBe('1');
  });

  it('prorates a partial refund by quantity', () => {
    const ten: OriginalPricedLine[] = [
      { productId: 'A', quantity: '10', priceMinor: 100_000n, discount: '10', sumMinor: 900_000n },
    ];
    expect(priceRefundFromOriginal(ten, [{ productId: 'A', quantity: '3' }]).totalMinor).toBe(
      270_000n,
    );
  });

  it('aggregates original split lines of the SAME product at DIFFERENT prices', () => {
    // 1 dona 100 tiyinga + 1 dona 10 tiyinga sotilgan → jami 110.
    const mixed: OriginalPricedLine[] = [
      { productId: 'A', quantity: '1', priceMinor: 100n, discount: '0', sumMinor: 100n },
      { productId: 'A', quantity: '1', priceMinor: 10n, discount: '0', sumMinor: 10n },
    ];
    // Har birini alohida narxlash 200 berardi (first-line-wins) — jami 110 bo'lishi shart.
    expect(priceRefundFromOriginal(mixed, [{ productId: 'A', quantity: '2' }]).totalMinor).toBe(
      110n,
    );
  });

  it('never exceeds the original sum when rounding (floor, split lines)', () => {
    // 3 dona = 100 tiyin: har dona 33.33 — uchta 34 tiyin 102 berardi.
    const odd: OriginalPricedLine[] = [
      { productId: 'A', quantity: '3', priceMinor: 34n, discount: '0', sumMinor: 100n },
    ];
    const priced = priceRefundFromOriginal(odd, [
      { productId: 'A', quantity: '1' },
      { productId: 'A', quantity: '1' },
      { productId: 'A', quantity: '1' },
    ]);
    expect(priced.totalMinor).toBeLessThanOrEqual(100n);
    expect(priced.totalMinor).toBe(99n);
  });

  it('handles fractional (weighed) quantities exactly', () => {
    const weighed: OriginalPricedLine[] = [
      { productId: 'A', quantity: '1.5', priceMinor: 100n, discount: '0', sumMinor: 150n },
    ];
    expect(priceRefundFromOriginal(weighed, [{ productId: 'A', quantity: '0.5' }]).totalMinor).toBe(
      50n,
    );
  });

  it('prices a product missing from the original as 0 (never a payout)', () => {
    // validateRefundPositions rejects this first; belt-and-braces so a future
    // caller reordering the guards cannot turn it into free cash.
    const priced = priceRefundFromOriginal(discounted, [{ productId: 'Z', quantity: '1' }]);
    expect(priced.totalMinor).toBe(0n);
  });

  it('ignores null-product (service) original lines', () => {
    const withService: OriginalPricedLine[] = [
      { productId: null, quantity: '1', priceMinor: 500n, discount: '0', sumMinor: 500n },
      { productId: 'A', quantity: '2', priceMinor: 100n, discount: '0', sumMinor: 200n },
    ];
    expect(
      priceRefundFromOriginal(withService, [{ productId: 'A', quantity: '2' }]).totalMinor,
    ).toBe(200n);
  });
});

/**
 * SALES-05 — a partial refund used to burn the whole receipt: `refund()`
 * flipped it to 'refunded' and every later refund got a 400, so 9 of the 10
 * units a customer bought could never come back. The subset guard has to know
 * what EARLIER refunds already took, so the receipt can stay open until the
 * last unit is returned.
 */
describe('validateRefundPositions — cumulative across earlier refunds (SALES-05)', () => {
  it('accepts the remainder after an earlier partial refund', () => {
    expect(
      validateRefundPositions(
        sale,
        [{ productId: 'A', quantity: '1' }],
        [{ productId: 'A', quantity: '2' }],
      ),
    ).toBeNull();
  });

  it('REJECTS when this refund plus the earlier ones exceeds the sold qty', () => {
    expect(
      validateRefundPositions(
        sale,
        [{ productId: 'A', quantity: '2' }],
        [{ productId: 'A', quantity: '2' }],
      ),
    ).toMatch(/exceeds sold qty/);
  });

  it('REJECTS a second refund of an already fully-refunded product', () => {
    expect(
      validateRefundPositions(
        sale,
        [{ productId: 'A', quantity: '0.000001' }],
        [{ productId: 'A', quantity: '3' }],
      ),
    ).toMatch(/exceeds sold qty/);
  });

  it('earlier refunds of ANOTHER product do not consume this one', () => {
    expect(
      validateRefundPositions(
        sale,
        [{ productId: 'A', quantity: '3' }],
        [{ productId: 'B', quantity: '1.5' }],
      ),
    ).toBeNull();
  });
});

describe('isFullyRefunded — when the receipt may finally close', () => {
  it('false while any sold unit is still out', () => {
    expect(isFullyRefunded(sale, [{ productId: 'A', quantity: '3' }])).toBe(false);
  });

  it('true once every product line is covered', () => {
    expect(
      isFullyRefunded(sale, [
        { productId: 'A', quantity: '3' },
        { productId: 'B', quantity: '1.5' },
      ]),
    ).toBe(true);
  });

  it('service (null-product) lines never hold the receipt open', () => {
    const withService: OriginalLine[] = [
      { productId: null, quantity: '1' },
      { productId: 'A', quantity: '2' },
    ];
    expect(isFullyRefunded(withService, [{ productId: 'A', quantity: '2' }])).toBe(true);
  });

  it('sums split refunds of the same product', () => {
    expect(
      isFullyRefunded(
        [{ productId: 'A', quantity: '3' }],
        [
          { productId: 'A', quantity: '1' },
          { productId: 'A', quantity: '2' },
        ],
      ),
    ).toBe(true);
  });
});

/**
 * SALES-04 (HIGH) — a receipt sold on credit was refunded in CASH: the till
 * paid out money it never took, and the customer's debt stayed on their
 * balance (two losses from one return). Both caps are derived from how the
 * receipt was actually settled, CUMULATIVELY, so split refunds cannot drift
 * past either one.
 */
describe('computeRefundSettlementCaps — payout bounded by what was actually taken (SALES-04)', () => {
  const base = {
    priorRefundedSumMinor: 0n,
    priorMoneyReturnedMinor: 0n,
    // P5: eski bloklarda chek TO'LIQ NAQD deb qaraladi — o'sha paytdagi
    // yagona holat shu edi, ya'ni naqd cap pul cap bilan ustma-ust tushadi.
    priorCashReturnedMinor: 0n,
    priorDebtReturnedMinor: 0n,
  };

  it('a 100% credit receipt pays back NO money — the whole value clears the debt', () => {
    expect(
      computeRefundSettlementCaps({
        ...base,
        originalSumMinor: 100_000n,
        originalDebtMinor: 100_000n,
        originalCashLikeMinor: 0n,
        refundSumMinor: 100_000n,
      }),
    ).toEqual({
      moneyMaxMinor: 0n,
      cashMaxMinor: 0n,
      debtMaxMinor: 100_000n,
      usdMaxMinor: 0n,
      prepayMaxMinor: 0n,
    });
  });

  it('a cash receipt pays the full refund value back in money', () => {
    expect(
      computeRefundSettlementCaps({
        ...base,
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 100_000n,
        refundSumMinor: 100_000n,
      }),
    ).toEqual({
      moneyMaxMinor: 100_000n,
      cashMaxMinor: 100_000n,
      debtMaxMinor: 0n,
      usdMaxMinor: 0n,
      prepayMaxMinor: 0n,
    });
  });

  it('splits the caps in the proportion the receipt was settled', () => {
    // 100 000 chek: 40 000 naqd + 60 000 qarz. Yarmi qaytarilyapti.
    expect(
      computeRefundSettlementCaps({
        ...base,
        originalSumMinor: 100_000n,
        originalDebtMinor: 60_000n,
        originalCashLikeMinor: 40_000n,
        refundSumMinor: 50_000n,
      }),
    ).toEqual({
      moneyMaxMinor: 20_000n,
      cashMaxMinor: 20_000n,
      debtMaxMinor: 30_000n,
      usdMaxMinor: 0n,
      prepayMaxMinor: 0n,
    });
  });

  it('subtracts what earlier refunds already returned', () => {
    expect(
      computeRefundSettlementCaps({
        originalSumMinor: 100_000n,
        originalDebtMinor: 60_000n,
        originalCashLikeMinor: 40_000n,
        priorRefundedSumMinor: 50_000n,
        priorMoneyReturnedMinor: 20_000n,
        priorCashReturnedMinor: 20_000n,
        priorDebtReturnedMinor: 30_000n,
        refundSumMinor: 50_000n,
      }),
    ).toEqual({
      moneyMaxMinor: 20_000n,
      cashMaxMinor: 20_000n,
      debtMaxMinor: 30_000n,
      usdMaxMinor: 0n,
      prepayMaxMinor: 0n,
    });
  });

  it('rounding never lets the cumulative money paid out exceed the money taken', () => {
    // 100 tiyinlik chek, 50 qarzga; 3 tiyindan 33 marta qaytariladi.
    let priorRefunded = 0n;
    let priorMoney = 0n;
    for (let i = 0; i < 33; i++) {
      const caps = computeRefundSettlementCaps({
        originalSumMinor: 100n,
        originalDebtMinor: 50n,
        originalCashLikeMinor: 50n,
        priorRefundedSumMinor: priorRefunded,
        priorMoneyReturnedMinor: priorMoney,
        priorCashReturnedMinor: priorMoney,
        priorDebtReturnedMinor: 0n,
        refundSumMinor: 3n,
      });
      priorMoney += caps.moneyMaxMinor;
      priorRefunded += 3n;
    }
    expect(priorMoney).toBeLessThanOrEqual(50n);
  });

  it('rounding never lets the cumulative debt write-down exceed the credit taken', () => {
    let priorRefunded = 0n;
    let priorDebt = 0n;
    for (let i = 0; i < 33; i++) {
      const caps = computeRefundSettlementCaps({
        originalSumMinor: 100n,
        originalDebtMinor: 50n,
        originalCashLikeMinor: 50n,
        priorRefundedSumMinor: priorRefunded,
        priorMoneyReturnedMinor: 0n,
        priorCashReturnedMinor: 0n,
        priorDebtReturnedMinor: priorDebt,
        refundSumMinor: 3n,
      });
      priorDebt += caps.debtMaxMinor;
      priorRefunded += 3n;
    }
    expect(priorDebt).toBeLessThanOrEqual(50n);
  });

  it('a fully-consumed cap goes to 0, never negative', () => {
    expect(
      computeRefundSettlementCaps({
        originalSumMinor: 100_000n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 100_000n,
        priorRefundedSumMinor: 100_000n,
        priorMoneyReturnedMinor: 100_000n,
        priorCashReturnedMinor: 100_000n,
        priorDebtReturnedMinor: 0n,
        refundSumMinor: 0n,
      }),
    ).toEqual({
      moneyMaxMinor: 0n,
      cashMaxMinor: 0n,
      debtMaxMinor: 0n,
      usdMaxMinor: 0n,
      prepayMaxMinor: 0n,
    });
  });

  it('a zero-value receipt yields zero caps (no division by zero)', () => {
    expect(
      computeRefundSettlementCaps({
        ...base,
        originalSumMinor: 0n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 0n,
        refundSumMinor: 0n,
      }),
    ).toEqual({
      moneyMaxMinor: 0n,
      cashMaxMinor: 0n,
      debtMaxMinor: 0n,
      usdMaxMinor: 0n,
      prepayMaxMinor: 0n,
    });
  });

  it('a debt bigger than the receipt (corrupt data) cannot mint a money cap', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100n,
      originalDebtMinor: 500n,
      originalCashLikeMinor: 0n,
      refundSumMinor: 100n,
    });
    expect(caps.moneyMaxMinor).toBe(0n);
    expect(caps.debtMaxMinor).toBe(100n);
  });
});

describe('validateRefundSettlement — enforces both caps', () => {
  const caps = { moneyMaxMinor: 40_000n, cashMaxMinor: 40_000n, debtMaxMinor: 60_000n };

  it('accepts a settlement inside both caps', () => {
    expect(validateRefundSettlement(caps, 30_000n, 10_000n, 60_000n)).toBeNull();
  });

  it('REJECTS cash+card above the money actually taken (SALES-04)', () => {
    // 2026-08-17: xabar o'zbekchaga o'tdi — bu yo'l endi kassir ko'radigan
    // holat (dollarli chekni so'mda qaytarish urinishi).
    expect(validateRefundSettlement(caps, 40_000n, 1n, 0n)).toMatch(/so'm pul olgan/);
  });

  it('REJECTS writing off more debt than the receipt put on the account', () => {
    expect(validateRefundSettlement(caps, 0n, 0n, 60_001n)).toMatch(/credit taken/);
  });

  it('REJECTS a negative debt return (a refund that ADDS debt)', () => {
    expect(validateRefundSettlement(caps, 0n, 0n, -1n)).toMatch(/non-negative/);
  });

  it('exact at both boundaries (no off-by-one)', () => {
    expect(validateRefundSettlement(caps, 40_000n, 0n, 60_000n)).toBeNull();
  });
});

/**
 * P5 (2026-08-12) — 🔴 NAQD ULUSHI CAP'i. Jonli prod probe (R1):
 * 100% KARTA bilan to'langan chek `cashAmountMinor = jami` bilan qaytarildi
 * va **201** oldi — kassa qoldig'i 85 357,21 → 85 157,21 so'm. Ya'ni yashiq
 * hech qachon olmagan 200 so'mni chiqarib yubordi (bank pulini esa terminal
 * orqali alohida qaytarish kerak ⇒ ikki karra to'lov).
 *
 * Sabab: `moneyMaxMinor` FAQAT «pul vs qarz» ni ajratardi, «naqd vs naqdsiz»
 * ni EMAS. SALES-04 qarz tomonini yopgan edi, kanal tomoni ochiq qolgan.
 *
 * MK31: `CASH_USD` naqd-o'xshash deb sanaladi (dollar yashiqqa TUSHGAN,
 * qaytimi ham doim so'mda beriladi — `retail-tenders.ts` §6.2). Ya'ni dollar
 * chek so'mda qaytariladi va bu qiymat jihatidan neytral; karta/terminal esa
 * yashiqqa UMUMAN tushmagan.
 */
describe('P5 — naqd cap: yashiq olmagan pulni qaytara olmaydi', () => {
  const base = {
    priorRefundedSumMinor: 0n,
    priorMoneyReturnedMinor: 0n,
    priorCashReturnedMinor: 0n,
    priorDebtReturnedMinor: 0n,
  };

  it('🔴 100% KARTA cheki: naqd cap = 0 (pul cap esa to`liq)', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: 0n,
      refundSumMinor: 100_000n,
    });
    expect(caps.cashMaxMinor).toBe(0n);
    expect(caps.moneyMaxMinor).toBe(100_000n);
  });

  it('100% NAQD cheki: naqd cap = pul cap', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: 100_000n,
      refundSumMinor: 100_000n,
    });
    expect(caps.cashMaxMinor).toBe(100_000n);
    expect(caps.moneyMaxMinor).toBe(100_000n);
  });

  it('ARALASH (naqd+karta) chekda naqd cap proporsional', () => {
    // 100 000 chek: 30 000 naqd + 70 000 karta. Yarmi qaytarilyapti.
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: 30_000n,
      refundSumMinor: 50_000n,
    });
    expect(caps.cashMaxMinor).toBe(15_000n);
    expect(caps.moneyMaxMinor).toBe(50_000n);
  });

  it('naqd cap HECH QACHON pul cap`dan oshmaydi (qarzli aralash chek)', () => {
    // 100 000: 40 000 naqd + 60 000 qarz. Naqd ulushi pul ulushiga teng.
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 60_000n,
      originalCashLikeMinor: 40_000n,
      refundSumMinor: 100_000n,
    });
    expect(caps.cashMaxMinor).toBe(40_000n);
    expect(caps.moneyMaxMinor).toBe(40_000n);
    expect(caps.cashMaxMinor).toBeLessThanOrEqual(caps.moneyMaxMinor);
  });

  it('buzuq ma`lumot: naqd ulushi jamidan katta bo`lsa qisiladi', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: 500n,
      refundSumMinor: 100n,
    });
    expect(caps.cashMaxMinor).toBe(100n);
  });

  it('avvalgi qaytarishlarning NAQDi ayiriladi (qisman qaytarish zanjiri)', () => {
    const caps = computeRefundSettlementCaps({
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: 100_000n,
      priorRefundedSumMinor: 50_000n,
      priorMoneyReturnedMinor: 50_000n,
      priorCashReturnedMinor: 50_000n,
      priorDebtReturnedMinor: 0n,
      refundSumMinor: 50_000n,
    });
    expect(caps.cashMaxMinor).toBe(50_000n);
  });

  it('yaxlitlash kümülativ naqdni olingan naqddan oshirmaydi', () => {
    let priorRefunded = 0n;
    let priorCash = 0n;
    for (let i = 0; i < 33; i++) {
      const caps = computeRefundSettlementCaps({
        originalSumMinor: 100n,
        originalDebtMinor: 0n,
        originalCashLikeMinor: 50n,
        priorRefundedSumMinor: priorRefunded,
        priorMoneyReturnedMinor: 0n,
        priorCashReturnedMinor: priorCash,
        priorDebtReturnedMinor: 0n,
        refundSumMinor: 3n,
      });
      priorCash += caps.cashMaxMinor;
      priorRefunded += 3n;
    }
    expect(priorCash).toBeLessThanOrEqual(50n);
  });

  it('🔴 validate: naqd cap`dan oshgan naqd RAD etiladi (R1 hodisasi)', () => {
    const caps = { moneyMaxMinor: 100_000n, cashMaxMinor: 0n, debtMaxMinor: 0n };
    expect(validateRefundSettlement(caps, 100_000n, 0n, 0n)).toMatch(/naqd/i);
  });

  it('validate: o`sha summa KARTA qatoriga yozilsa qabul qilinadi', () => {
    const caps = { moneyMaxMinor: 100_000n, cashMaxMinor: 0n, debtMaxMinor: 0n };
    expect(validateRefundSettlement(caps, 0n, 100_000n, 0n)).toBeNull();
  });

  it('validate: naqd cap chegarasida (off-by-one yo`q)', () => {
    const caps = { moneyMaxMinor: 100_000n, cashMaxMinor: 30_000n, debtMaxMinor: 0n };
    expect(validateRefundSettlement(caps, 30_000n, 70_000n, 0n)).toBeNull();
    expect(validateRefundSettlement(caps, 30_001n, 69_999n, 0n)).toMatch(/naqd/i);
  });
});

/**
 * P5 — 🔴 NULL ≠ 0. `RetailSalePayment` qatorlari kassa TZ §6.1 dan beri
 * yoziladi; undan OLDINGI cheklarda ular UMUMAN yo'q (prodda o'lchandi).
 * `0n` deb o'qilsa butun tarixiy chek naqd qaytarilmaydigan bo'lib qolardi.
 */
describe('P5 — naqd ulushi O`LCHANMAGAN bo`lsa kanal cap`i qo`yilmaydi', () => {
  const base = {
    priorRefundedSumMinor: 0n,
    priorMoneyReturnedMinor: 0n,
    priorCashReturnedMinor: 0n,
    priorDebtReturnedMinor: 0n,
  };

  it('null ⇒ naqd cap = pul cap (avvalgi xulq, regressiya yo`q)', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: null,
      refundSumMinor: 100_000n,
    });
    expect(caps.cashMaxMinor).toBe(100_000n);
    expect(caps.moneyMaxMinor).toBe(100_000n);
  });

  it('null qarzli chekda ham pul cap`dan oshmaydi', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 60_000n,
      originalCashLikeMinor: null,
      refundSumMinor: 100_000n,
    });
    expect(caps.cashMaxMinor).toBe(40_000n);
    expect(caps.moneyMaxMinor).toBe(40_000n);
  });

  it('🔴 `0n` esa TAQIQ — «o`lchandi va naqd olinmagan» degani', () => {
    const caps = computeRefundSettlementCaps({
      ...base,
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: 0n,
      refundSumMinor: 100_000n,
    });
    expect(caps.cashMaxMinor).toBe(0n);
  });

  it('null + avvalgi qaytarishlar: pul cap bilan bir xil kamayadi', () => {
    const caps = computeRefundSettlementCaps({
      originalSumMinor: 100_000n,
      originalDebtMinor: 0n,
      originalCashLikeMinor: null,
      priorRefundedSumMinor: 50_000n,
      priorMoneyReturnedMinor: 50_000n,
      priorCashReturnedMinor: 50_000n,
      priorDebtReturnedMinor: 0n,
      refundSumMinor: 50_000n,
    });
    expect(caps.cashMaxMinor).toBe(50_000n);
    expect(caps.moneyMaxMinor).toBe(50_000n);
  });
});

/**
 * V3 (egasi, 2026-09-02): «pul qaytarganda naqd/karta tanlash imkoni bo'lsin».
 *
 * Kassir kanalni O'ZI tanlaganda KANAL cap'i (P5) o'tkazib yuboriladi — R1
 * hodisasi AVTOMATIK taqsimotning xatosi edi, qo'lda tanlov esa ongli qaror.
 * JAMI cap (`moneyMaxMinor`) esa BEKOR QILINMAYDI: kassa olganidan ko'p pul
 * chiqmaydi, qarz/avans ulushi naqdga aylanmaydi.
 */
describe('V3 — kanal tanlash (channelOverride)', () => {
  // 100% KARTA chek: kanal cap 0, jami cap to'liq.
  const kartaChek = {
    moneyMaxMinor: 40_000n,
    cashMaxMinor: 0n,
    debtMaxMinor: 0n,
    usdMaxMinor: 0n,
    prepayMaxMinor: 0n,
  };

  it('bayroqSIZ: karta chekini naqd qaytarish RAD etiladi (P5 kuchida)', () => {
    expect(validateRefundSettlement(kartaChek, 40_000n, 0n, 0n)).toMatch(/naqd olgan/);
  });

  it('bayroq bilan: karta chekini NAQD qaytarish mumkin', () => {
    expect(
      validateRefundSettlement(kartaChek, 40_000n, 0n, 0n, 0n, 0n, { channelOverride: true }),
    ).toBeNull();
  });

  it('bayroq JAMI capni buzmaydi — olganidan ko`p pul chiqmaydi', () => {
    expect(
      validateRefundSettlement(kartaChek, 40_001n, 0n, 0n, 0n, 0n, { channelOverride: true }),
    ).toMatch(/so'm pul olgan/);
  });

  it('bayroq QARZ capini buzmaydi', () => {
    expect(
      validateRefundSettlement(kartaChek, 0n, 0n, 1n, 0n, 0n, { channelOverride: true }),
    ).toMatch(/credit taken/);
  });

  it('bayroq qarzli chekda pulni «yo`qdan» yaratmaydi', () => {
    // To'liq QARZGA sotilgan chek: kassa pul olmagan ⇒ jami cap 0.
    const qarzChek = { ...kartaChek, moneyMaxMinor: 0n, debtMaxMinor: 40_000n };
    expect(
      validateRefundSettlement(qarzChek, 1n, 0n, 0n, 0n, 0n, { channelOverride: true }),
    ).toMatch(/so'm pul olgan/);
  });

  it('bayroq DOLLAR capini buzmaydi', () => {
    expect(
      validateRefundSettlement(kartaChek, 0n, 0n, 0n, 1n, 0n, { channelOverride: true }),
    ).toMatch(/dollar olgan/);
  });

  it('sukut (bayroq berilmasa) — eski xulq, kanal cap kuchida', () => {
    expect(validateRefundSettlement(kartaChek, 1n, 0n, 0n, 0n, 0n, {})).toMatch(/naqd olgan/);
  });
});
