import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KpiMetricDef, MetricCatalog } from '../../manager/kpi/kpi-metrics.js';
import type { DayScore } from '../../manager/kpi/kpi-score.js';
import {
  MY_KPI_ALERT_METRICS,
  type MyKpiMetricRow,
  myAttentionSignals,
  resolveScore,
  scoreMyDay,
  sealedTarget,
  sealedWeight,
} from './my-kpi-view.util.js';

/**
 * X5 — «Mening KPI'im» sof qatlamining testlari.
 *
 * Ball FORMULASI bu yerda sinalmaydi — u `kpi-score.test.ts` da. Bu yerda
 * faqat X5 ning O'Z qarorlari: muhr (seal) qoidasi, signallar ro'yxati va
 * muzlagan/jonli ball tanlovi.
 */

function metric(over: Partial<MyKpiMetricRow> = {}): MyKpiMetricRow {
  return {
    metricKey: 'cash_revenue',
    autoValue: null,
    adjustValue: null,
    complete: true,
    targetValue: null,
    targetSource: null,
    weightApplied: null,
    weightSource: null,
    ...over,
  };
}

describe('sealedTarget — muhr ustun, profil zaxira (KPI-03)', () => {
  it('muhrlangan maqsad ustun turadi (profildagi keyingi tahrir kunga tegmaydi)', () => {
    const m = metric({ targetValue: 500n, targetSource: 'employee_target' });
    expect(sealedTarget(m, 999n)).toBe(500n);
  });

  it("🔴 muhrlangan «maqsad yo'q» profilga QAYTMAYDI — natija null", () => {
    // `targetSource` bor, `targetValue` null = «o'sha kuni maqsad yo'q edi».
    const m = metric({ targetValue: null, targetSource: 'none' });
    expect(sealedTarget(m, 999n)).toBeNull();
  });

  it('muhrsiz (migratsiyadan oldingi) qator profil maqsadiga tushadi', () => {
    const m = metric({ targetValue: null, targetSource: null });
    expect(sealedTarget(m, 777n)).toBe(777n);
  });

  it("muhrsiz qator + profil ham yo'q → null (0 EMAS)", () => {
    expect(sealedTarget(metric(), undefined)).toBeNull();
    expect(sealedTarget(metric(), null)).toBeNull();
  });
});

describe('sealedWeight — muhr ustun, profil zaxira (KPI-05)', () => {
  it("muhrlangan og'irlik ustun turadi", () => {
    const m = metric({ weightApplied: 2.5, weightSource: 'profile' });
    expect(sealedWeight(m, 9)).toBe(2.5);
  });

  it("🔴 muhrlangan null og'irlik profilga QAYTMAYDI — ataylab ballsiz qator ballanmasin", () => {
    const m = metric({ weightApplied: null, weightSource: 'none' });
    expect(sealedWeight(m, 9)).toBeNull();
  });

  it("muhrsiz qator profil og'irligiga tushadi; profil ham yo'q bo'lsa null", () => {
    expect(sealedWeight(metric(), 3)).toBe(3);
    expect(sealedWeight(metric(), undefined)).toBeNull();
  });

  it('Decimal-ga o‘xshash obyekt ham songa o‘giriladi', () => {
    const decimalish = { toString: () => '1.5' } as unknown as number;
    const m = metric({ weightApplied: decimalish, weightSource: 'profile' });
    expect(sealedWeight(m, 9)).toBe(1.5);
  });
});

describe('scoreMyDay — formula qayta yozilmaydi, muhr esa qo‘llanadi', () => {
  const day = (metrics: MyKpiMetricRow[], profile?: Array<[string, number, bigint | null]>) => ({
    state: 'computed',
    dataComplete: true,
    metrics,
    profileVersion: profile
      ? {
          metrics: profile.map(([key, weight, target]) => ({
            weight,
            target,
            metricDef: { key },
          })),
        }
      : null,
  });

  it("muhrlangan maqsad/og'irlik bilan ball hisoblanadi", () => {
    const s = scoreMyDay(
      day([
        metric({
          metricKey: 'cash_revenue',
          autoValue: 1_000n,
          targetValue: 1_000n,
          targetSource: 'employee_target',
          weightApplied: 1,
          weightSource: 'profile',
        }),
      ]),
    );
    expect(s.score).toBe(100);
    expect(s.metrics[0]?.scored).toBe(true);
  });

  it("🔴 o'lchanmagan ko'rsatkich NOLGA aylanmaydi — ballga kirmaydi", () => {
    const s = scoreMyDay(
      day([
        metric({
          metricKey: 'cash_revenue',
          autoValue: null,
          targetValue: 1_000n,
          targetSource: 'employee_target',
          weightApplied: 1,
          weightSource: 'profile',
        }),
      ]),
    );
    expect(s.score).toBeNull();
    expect(s.metrics[0]?.skipReason).toBe('unmeasured');
  });

  it('🔴 hech narsa ballanmasa score = null (0 EMAS)', () => {
    const s = scoreMyDay(day([metric({ autoValue: 5n })]));
    expect(s.score).toBeNull();
    expect(s.coverage).toBeNull();
  });

  it('menejer tuzatmasi g‘olib, avtomat qiymat esa saqlanadi', () => {
    const s = scoreMyDay(
      day([
        metric({
          metricKey: 'cash_revenue',
          autoValue: 500n,
          adjustValue: 1_000n,
          targetValue: 1_000n,
          targetSource: 'employee_target',
          weightApplied: 1,
          weightSource: 'profile',
        }),
      ]),
    );
    expect(s.metrics[0]?.fact).toBe(1_000n);
    expect(s.metrics[0]?.autoValue).toBe(500n);
    expect(s.metrics[0]?.adjusted).toBe(true);
    expect(s.score).toBe(100);
  });

  it('muhrsiz qator profil versiyasidan o‘qiydi (eski kunlar balli o‘zgarmaydi)', () => {
    const s = scoreMyDay(
      day(
        [metric({ metricKey: 'cash_revenue', autoValue: 2_000n })],
        [['cash_revenue', 1, 1_000n]],
      ),
    );
    expect(s.score).toBe(150); // cap = 150%
    expect(s.metrics[0]?.achievementPercent).toBe(200);
  });

  it("hisobning O'Z ko'rsatkichi katalogdan kelsa ballanadi (built-in'da yo'q kalit)", () => {
    const custom: KpiMetricDef = {
      key: 'custom_ustoz_bahosi',
      labelUz: 'Ustoz bahosi',
      labelRu: 'Оценка наставника',
      unit: 'count',
      direction: 'higher_better',
      source: 'manual',
      perHour: false,
    };
    const catalog: MetricCatalog = new Map([[custom.key, custom]]);
    const row = metric({
      metricKey: custom.key,
      autoValue: 8n,
      targetValue: 10n,
      targetSource: 'employee_target',
      weightApplied: 1,
      weightSource: 'profile',
    });

    expect(scoreMyDay(day([row]), catalog).metrics[0]?.scored).toBe(true);
    // Katalogsiz o'sha kalit «noma'lum» bo'lib ballanmaydi — ya'ni katalogni
    // uzatish SHART (servis uni har doim uzatadi).
    expect(scoreMyDay(day([row])).metrics[0]?.skipReason).toBe('unknown_metric');
  });
});

describe('myAttentionSignals — ko‘rinadigan sabab, yashirin ball emas', () => {
  const base = { state: 'computed', dataComplete: true, metrics: [] as const };

  it('holat signallari: stale · escalated · rejected', () => {
    expect(myAttentionSignals({ ...base, state: 'stale' })).toContain('stale');
    expect(myAttentionSignals({ ...base, state: 'escalated' })).toContain('escalated');
    expect(myAttentionSignals({ ...base, state: 'rejected' })).toContain('rejected');
  });

  it('qabul qilingan/kutilayotgan kun holat signali BERMAYDI', () => {
    expect(myAttentionSignals({ ...base, state: 'accepted' })).toEqual([]);
    expect(myAttentionSignals({ ...base, state: 'pending' })).toEqual([]);
  });

  it("chala ma'lumot alohida signal", () => {
    expect(myAttentionSignals({ ...base, dataComplete: false })).toEqual(['data_incomplete']);
  });

  it("noldan katta ogohlantiruvchi ko'rsatkich signal beradi (tartib ro'yxatniki)", () => {
    const signals = myAttentionSignals({
      ...base,
      metrics: [
        { metricKey: 'late_minutes', autoValue: 12n },
        { metricKey: 'cancel_count', autoValue: 1n },
      ],
    });
    // Tartib kelgan qatorlar tartibi EMAS, `MY_KPI_ALERT_METRICS` tartibi —
    // shunda ro'yxat har yuklanishda bir joyda turadi.
    expect(signals).toEqual(['cancel_count', 'late_minutes']);
  });

  it("🔴 NULL ≠ 0: o'lchanmagan ko'rsatkich signal BERMAYDI, nol ham bermaydi", () => {
    expect(
      myAttentionSignals({
        ...base,
        metrics: [
          { metricKey: 'late_minutes', autoValue: null },
          { metricKey: 'till_variance_abs', autoValue: 0n },
        ],
      }),
    ).toEqual([]);
  });

  it('manfiy qiymat ham signal bermaydi', () => {
    expect(
      myAttentionSignals({
        ...base,
        metrics: [{ metricKey: 'till_variance_abs', autoValue: -5n }],
      }),
    ).toEqual([]);
  });

  /**
   * 🔴 TAKRORLANISH QULFI. X5 «`manager/kpi` kodiga TEGMA» sharti tufayli
   * signallar ro'yxati ikki joyda turibdi. Menejer navbatidagi ro'yxat
   * o'zgarsa xodim va menejer BIR KUNGA qarab boshqa-boshqa signal ko'rardi —
   * shuning uchun ro'yxat manba matnidan o'qib solishtiriladi.
   */
  it('menejer navbatidagi ALERT_METRICS bilan AYNAN bir xil', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/modules/manager/kpi/daily-kpi-acceptance.service.ts'),
      'utf8',
    );
    const block = /const ALERT_METRICS = \[([\s\S]*?)\] as const;/.exec(src)?.[1];
    expect(block, 'manager ALERT_METRICS ro`yxati topilmadi').toBeTruthy();
    const managerKeys = [...(block ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(managerKeys.length).toBeGreaterThan(0);
    expect([...MY_KPI_ALERT_METRICS]).toEqual(managerKeys);
  });
});

describe('resolveScore — muzlagan ball ustun', () => {
  const live = { score: 42, coverage: 0.5 } as DayScore;

  it("qabul qilingan kunda MUZLAGAN ball ko'rsatiladi, jonli hisob emas", () => {
    expect(resolveScore(88, live)).toEqual({
      score: 88,
      scoreFrozen: 88,
      scoreIsFinal: true,
    });
  });

  it('muzlamagan kunda jonli ball, lekin `scoreIsFinal: false`', () => {
    expect(resolveScore(null, live)).toEqual({
      score: 42,
      scoreFrozen: null,
      scoreIsFinal: false,
    });
  });

  it("🔴 jonli ball ham null bo'lsa natija null — 0 ga aylanmaydi", () => {
    expect(resolveScore(null, { score: null } as DayScore)).toEqual({
      score: null,
      scoreFrozen: null,
      scoreIsFinal: false,
    });
  });

  it('muzlagan 0 — haqiqiy nol, «hisoblanmadi» EMAS', () => {
    expect(resolveScore(0, live)).toEqual({ score: 0, scoreFrozen: 0, scoreIsFinal: true });
  });
});
