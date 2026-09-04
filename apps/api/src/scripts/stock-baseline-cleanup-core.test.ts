import { describe, expect, it } from 'vitest';
import {
  type BaselineRow,
  DEFAULT_BAND_MAX,
  DEFAULT_BAND_MIN,
  buildCleanupPlan,
  buildRevertPlan,
  writeOffCost,
} from '../../../../packages/db/scripts/stock-baseline-cleanup-core.js';

/**
 * H5 (2026-08-24 split-kassa hodisasi) — soxta «mashq» qoldig'ini hisobdan
 * chiqarish yadrosining qulf-testlari.
 *
 * Ikki invariant hamma narsadan muhim:
 *   · `StockByCell` (sanalgan yacheyka) HECH QACHON kamaymaydi — reja faqat
 *     yacheykasiz ortiqchani oladi, ya'ni `newQty >= assignedQty` DOIM;
 *   · imzo-oralig'idan tashqaridagi (haqiqiy) qoldiqqa TEGILMAYDI — busiz
 *     ombor jamisi tushib POS chekni yopmay qo'yardi (06:46 hodisasi shakli).
 */

const S = 'store-pool';

function row(over: Partial<BaselineRow> = {}): BaselineRow {
  return {
    storeId: S,
    storeName: 'Taqsimlanmagan',
    assortmentKind: 'product',
    assortmentId: 'p1',
    qty: '10000',
    reservedQty: '0',
    assignedQty: '40',
    costBalanceMinor: 0n,
    countedAt: '2026-08-25T18:00:00.000Z',
    ...over,
  };
}

describe('asosiy hisob', () => {
  it('foydalanuvchi keysi: 10 000 tahminiy, yacheykaga 40 sanaldi ⇒ 9960 o‘chadi', () => {
    const plan = buildCleanupPlan([row()]);
    expect(plan.lines).toHaveLength(1);
    const l = plan.lines[0];
    expect(l?.surplus).toBe('9960');
    expect(l?.writeOffQty).toBe('9960');
    expect(l?.newQty).toBe('40'); // aynan sanalgan son qoladi
    expect(l?.cappedByReserve).toBe(false);
  });

  it('🔴 sanalgan yacheyka qoldig‘i HECH QACHON kamaymaydi', () => {
    // Ko'p yacheykali tovar: 3 yacheykada 120, jami 10 000.
    const plan = buildCleanupPlan([row({ assignedQty: '120' })]);
    expect(plan.lines[0]?.newQty).toBe('120');
    expect(plan.lines[0]?.writeOffQty).toBe('9880');
  });

  it('ikkinchi yugurish NO-OP (idempotent)', () => {
    const first = buildCleanupPlan([row()]);
    const after = row({ qty: first.lines[0]?.newQty });
    const second = buildCleanupPlan([after]);
    expect(second.lines).toHaveLength(0);
    expect(second.skipped[0]?.reason).toBe('ortiqcha-yoq');
  });

  it('ortiqcha yo‘q bo‘lsa tegilmaydi', () => {
    const plan = buildCleanupPlan([row({ qty: '40', assignedQty: '40' })]);
    expect(plan.lines).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('ortiqcha-yoq');
  });

  it('Decimal kasrlari float‘siz ishlanadi', () => {
    const plan = buildCleanupPlan([row({ qty: '10000.5', assignedQty: '0.2' })]);
    expect(plan.lines[0]?.writeOffQty).toBe('10000.3');
    expect(plan.lines[0]?.newQty).toBe('0.2');
  });
});

describe('imzo-oralig‘i — haqiqiy tovarni himoya qiladi', () => {
  it('default oraliq 9000…11000', () => {
    expect(DEFAULT_BAND_MIN).toBe('9000');
    expect(DEFAULT_BAND_MAX).toBe('11000');
  });

  it('oraliqdan PAST ortiqcha (haqiqiy tovar) tegilmaydi', () => {
    // 500 dona yacheykasiz qoldiq — bu mashq soni emas, haqiqiy tovar.
    const plan = buildCleanupPlan([row({ qty: '540', assignedQty: '40' })]);
    expect(plan.lines).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('imzo-oraligidan-tashqarida');
  });

  it('oraliqdan YUQORI ortiqcha ham tegilmaydi', () => {
    const plan = buildCleanupPlan([row({ qty: '50040', assignedQty: '40' })]);
    expect(plan.lines).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('imzo-oraligidan-tashqarida');
  });

  it('chegaralar INKLYUZIV', () => {
    expect(buildCleanupPlan([row({ qty: '9040', assignedQty: '40' })]).lines).toHaveLength(1);
    expect(buildCleanupPlan([row({ qty: '11040', assignedQty: '40' })]).lines).toHaveLength(1);
    expect(buildCleanupPlan([row({ qty: '11041', assignedQty: '40' })]).lines).toHaveLength(0);
  });

  it('oraliqni ONGLI o‘chirish mumkin (null)', () => {
    const plan = buildCleanupPlan([row({ qty: '540', assignedQty: '40' })], {
      bandMin: null,
      bandMax: null,
    });
    expect(plan.lines[0]?.writeOffQty).toBe('500');
  });
});

describe('sanash mezoni', () => {
  it('sanalmagan tovarga TEGILMAYDI (kassa eski son bilan sotaveradi)', () => {
    const plan = buildCleanupPlan([row({ assignedQty: '0' })]);
    expect(plan.lines).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('sanalmagan');
  });

  it('requireCell:false bilan sanalmaganlar ham kiradi (ongli)', () => {
    const plan = buildCleanupPlan([row({ assignedQty: '0' })], { requireCell: false });
    expect(plan.lines[0]?.writeOffQty).toBe('10000');
  });

  it('--since: eski sanalganlar chetda qoladi', () => {
    const plan = buildCleanupPlan([row({ countedAt: '2026-08-20T10:00:00.000Z' })], {
      since: '2026-08-25',
    });
    expect(plan.skipped[0]?.reason).toBe('sanash-eski');
  });

  it('--since: sanasi yo‘q qator ham chetda qoladi', () => {
    const plan = buildCleanupPlan([row({ countedAt: null })], { since: '2026-08-25' });
    expect(plan.skipped[0]?.reason).toBe('sanash-eski');
  });

  it('--since: o‘sha sanadan keyin sanalgan kiradi', () => {
    const plan = buildCleanupPlan([row({ countedAt: '2026-08-26T09:00:00.000Z' })], {
      since: '2026-08-25',
    });
    expect(plan.lines).toHaveLength(1);
  });
});

describe('rezerv himoyasi', () => {
  it('rezervdan pastga tushmaydi — qisman o‘chadi', () => {
    // 10 000 jami, 40 yacheykada, 500 band ⇒ 500 gacha tushirish mumkin.
    const plan = buildCleanupPlan([row({ reservedQty: '500' })]);
    const l = plan.lines[0];
    expect(l?.writeOffQty).toBe('9500');
    expect(l?.newQty).toBe('500');
    expect(l?.cappedByReserve).toBe(true);
  });

  it('rezerv jamiga teng bo‘lsa umuman o‘chmaydi', () => {
    const plan = buildCleanupPlan([row({ reservedQty: '10000' })]);
    expect(plan.lines).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('rezerv-toosiq');
  });

  it('rezerv yacheykadan kichik bo‘lsa polni yacheyka belgilaydi', () => {
    const plan = buildCleanupPlan([row({ reservedQty: '10', assignedQty: '40' })]);
    expect(plan.lines[0]?.newQty).toBe('40');
  });
});

describe('tannarx (o‘rtacha tortilgan)', () => {
  it('qisman o‘chirishda proporsional kamayadi', () => {
    // 10 000 dona · 1 000 000 tiyin ⇒ dona 100 tiyin; 9960 dona ⇒ 996 000
    const plan = buildCleanupPlan([row({ costBalanceMinor: 1_000_000n })]);
    expect(plan.lines[0]?.costDeltaMinor).toBe(-996_000n);
  });

  it('qoldiqni BO‘SHATSA butun tannarx ketadi (tiyin osilib qolmaydi)', () => {
    // Yaxlitlash qoldig'i qty=0 qatorda qolsa keyingi kirimning o'rtachasini buzardi.
    const plan = buildCleanupPlan([row({ assignedQty: '0', costBalanceMinor: 999_999n })], {
      requireCell: false,
    });
    expect(plan.lines[0]?.writeOffQty).toBe('10000');
    expect(plan.lines[0]?.costDeltaMinor).toBe(-999_999n);
  });

  it('tannarx 0 bo‘lsa 0 qoladi', () => {
    expect(writeOffCost(0n, 1_000_000n, 500_000n)).toBe(0n);
    expect(writeOffCost(500n, 0n, 500_000n)).toBe(0n);
    expect(writeOffCost(500n, 1_000_000n, 0n)).toBe(0n);
  });
});

describe('jamlar va ko‘p qatorli reja', () => {
  it('bir necha tovar — jamlar to‘g‘ri', () => {
    const plan = buildCleanupPlan([
      row({ assortmentId: 'p1', costBalanceMinor: 1_000_000n }),
      row({ assortmentId: 'p2', qty: '10500', assignedQty: '500' }),
      row({ assortmentId: 'p3', qty: '540', assignedQty: '40' }), // oraliqdan tashqari
      row({ assortmentId: 'p4', assignedQty: '0' }), // sanalmagan
    ]);
    expect(plan.lines.map((l) => l.assortmentId)).toEqual(['p1', 'p2']);
    expect(plan.totals.products).toBe(2);
    expect(plan.totals.qty).toBe('19960'); // 9960 + 10000
    expect(plan.totals.costMinor).toBe(-996_000n);
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual([
      'imzo-oraligidan-tashqarida',
      'sanalmagan',
    ]);
  });
});

describe('qaytarish rejasi (qoida 12)', () => {
  it('ledger yozuvining AYNAN teskarisi', () => {
    const revert = buildRevertPlan([
      {
        storeId: S,
        assortmentKind: 'product',
        assortmentId: 'p1',
        qtyDelta: '-9960',
        costDeltaMinor: -996_000n,
      },
    ]);
    expect(revert).toEqual([
      {
        storeId: S,
        assortmentKind: 'product',
        assortmentId: 'p1',
        qtyDelta: '9960',
        costDeltaMinor: 996_000n,
      },
    ]);
  });

  it('bir tovarning bir necha yozuvi jamlanadi', () => {
    const revert = buildRevertPlan([
      {
        storeId: S,
        assortmentKind: 'product',
        assortmentId: 'p1',
        qtyDelta: '-10',
        costDeltaMinor: -5n,
      },
      {
        storeId: S,
        assortmentKind: 'product',
        assortmentId: 'p1',
        qtyDelta: '-2.5',
        costDeltaMinor: -1n,
      },
    ]);
    expect(revert).toHaveLength(1);
    expect(revert[0]?.qtyDelta).toBe('12.5');
    expect(revert[0]?.costDeltaMinor).toBe(6n);
  });

  it('tannarxi null yozuv 0 sifatida qaytadi', () => {
    const revert = buildRevertPlan([
      {
        storeId: S,
        assortmentKind: 'product',
        assortmentId: 'p1',
        qtyDelta: '-10',
        costDeltaMinor: null,
      },
    ]);
    expect(revert[0]?.costDeltaMinor).toBe(0n);
  });

  it('sikl nol yig‘indi: reja → ledger → qaytarish = boshlang‘ich holat', () => {
    const start = row({ costBalanceMinor: 1_000_000n });
    const plan = buildCleanupPlan([start]);
    const l = plan.lines[0];
    if (!l) throw new Error('reja bo‘sh');
    const revert = buildRevertPlan([
      {
        storeId: l.storeId,
        assortmentKind: l.assortmentKind,
        assortmentId: l.assortmentId,
        qtyDelta: `-${l.writeOffQty}`,
        costDeltaMinor: l.costDeltaMinor,
      },
    ]);
    expect(revert[0]?.qtyDelta).toBe('9960');
    expect(Number(l.newQty) + Number(revert[0]?.qtyDelta)).toBe(Number(start.qty));
    expect(l.costDeltaMinor + (revert[0]?.costDeltaMinor ?? 0n)).toBe(0n);
  });
});

/**
 * J1 — bo'lak hisobi yuritiladigan tovar RAD ETILADI (K-reja 7.4 / T1 qarzi).
 *
 * Bu skript `Stock.qty` ni kamaytiradi va `stock_pieces` ga TEGMAYDI. Bayroqli
 * tovarda «Σ faol bo'lak === miqdor» invarianti (K-reja 3-bo'lim) shu bilan
 * darhol buzilardi va K5 ommaviy kiritish oqimi 400 bilan yiqilardi.
 */
describe('bo‘lak hisobi — RAD ETISH (J1)', () => {
  it('🔴 bayroqli tovar hisobdan chiqarilmaydi, sababi NOM bilan ko‘rinadi', () => {
    const plan = buildCleanupPlan([row({ pieceTracked: true })]);
    expect(plan.lines).toEqual([]);
    expect(plan.skipped).toEqual([
      { storeId: S, assortmentId: 'p1', reason: 'bolak-hisobi', surplus: '9960' },
    ]);
    expect(plan.totals).toEqual({ products: 0, qty: '0', costMinor: 0n });
  });

  it('🔴 rad etish HAMMA boshqa filtrdan OLDIN — «ortiqchasi yo‘q» deb yashirinmaydi', () => {
    // Ortiqchasi yo'q (qty === assignedQty): eski mantiqda «ortiqcha-yoq»
    // bo'lardi va operator skript bu tovarga TEGMASLIGINI bilmasdi.
    const plan = buildCleanupPlan([row({ pieceTracked: true, qty: '40' })]);
    expect(plan.skipped[0]?.reason).toBe('bolak-hisobi');
  });

  it('imzo-oralig‘i o‘chirilgan bo‘lsa ham rad etish kuchda qoladi', () => {
    const plan = buildCleanupPlan([row({ pieceTracked: true })], { bandMin: null, bandMax: null });
    expect(plan.lines).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('bolak-hisobi');
  });

  it('bayroq o‘chiq / berilmagan tovarda xulq AYNAN avvalgidek', () => {
    const off = buildCleanupPlan([row({ pieceTracked: false })]);
    const absent = buildCleanupPlan([row()]);
    expect(off.lines).toEqual(absent.lines);
    expect(off.lines[0]?.writeOffQty).toBe('9960');
  });

  it('bir necha qatordan faqat bayroqlisi tushib qoladi', () => {
    const plan = buildCleanupPlan([
      row({ assortmentId: 'p1' }),
      row({ assortmentId: 'p2', pieceTracked: true }),
    ]);
    expect(plan.lines.map((l) => l.assortmentId)).toEqual(['p1']);
    expect(plan.skipped.map((s) => s.assortmentId)).toEqual(['p2']);
  });
});
