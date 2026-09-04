import type { Prisma } from '@moysklad/db';
import { DAILY_KPI_STATE } from '../../manager/kpi/daily-kpi-fsm.js';
import { BUILT_IN_CATALOG, type MetricCatalog } from '../../manager/kpi/kpi-metrics.js';
import { type DayScore, type ScoreMetricInput, scoreDay } from '../../manager/kpi/kpi-score.js';

/**
 * X5 — «Mening KPI'im» ning SOF qatlami (DB yo'q, soat yo'q).
 *
 * NEGA ALOHIDA MODUL: X-reja «`manager/kpi` kodiga TEGMA» deydi, ya'ni
 * `daily-kpi-acceptance.service.ts` dagi xususiy (`private`) yordamchilarni
 * eksport qilib bo'lmaydi. Shu sababli muhr qoidasi va e'tibor signallari
 * shu yerda QAYTA yoziladi — lekin BALL FORMULASI qayta yozilmaydi: u
 * `kpi-score.ts` dan (`scoreDay`) chaqiriladi, chunki 1.4 dagi «yetti joyda
 * uch xil foiz» hodisasi aynan shunday boshlangan edi.
 *
 * 🔴 Takrorlanish RO'YXATGA OLINGAN: e'tibor signallari ro'yxati menejer
 * servisidagi `ALERT_METRICS` bilan bir xil bo'lishi shart va buni
 * `my-kpi-view.util.test.ts` MEXANIK tekshiradi (manba matnini o'qib
 * solishtiradi). Menejer ro'yxati o'zgarsa test yiqiladi va kimdir ikkisini
 * qayta yarashtiradi. X7 ga eslatma: bu ikki nusxani bitta sof modulga
 * chiqarish kerak.
 */

/** Ekranga chiqadigan bitta ko'rsatkich qatori (DB shakli, qisqartirilgan). */
export interface MyKpiMetricRow {
  metricKey: string;
  autoValue: bigint | null;
  adjustValue: bigint | null;
  complete: boolean;
  /** O'sha kunga MUHRLANGAN maqsad (KPI-03). NULL = maqsad yo'q. */
  targetValue: bigint | null;
  /** NULL = MUHR YO'Q → profil maqsadiga tushiladi. */
  targetSource: string | null;
  /** O'sha kunga MUHRLANGAN og'irlik (KPI-05). NULL = og'irlik qo'yilmagan. */
  weightApplied: Prisma.Decimal | number | null;
  /** NULL = MUHR YO'Q → profil og'irligiga tushiladi. */
  weightSource: string | null;
}

/** Profil versiyasidagi og'irlik/maqsad — muhrsiz qatorlar uchun zaxira. */
export interface MyKpiProfileMetric {
  weight: Prisma.Decimal | number;
  target: bigint | null;
  metricDef: { key: string };
}

export interface MyKpiScorableDay {
  state: string;
  dataComplete: boolean;
  metrics: readonly MyKpiMetricRow[];
  profileVersion: { metrics: readonly MyKpiProfileMetric[] } | null;
}

/**
 * Shu kun uchun amaldagi maqsad — MUHR ustun, profil zaxira.
 *
 * `targetSource != null` = kun hisoblanganda maqsad muhrlangan; keyingi tahrir
 * bu kunga tegmaydi. `targetSource == null` = KPI-03 migratsiyasidan OLDIN
 * hisoblangan qator — u hech qachon muhrlanmagan, shuning uchun profil
 * versiyasidan o'qiladi. Ikkalasini `targetValue == null` bilan farqlab
 * bo'lmaydi: muhrlangan «maqsad yo'q» ham NULL beradi (NULL ≠ 0).
 */
export function sealedTarget(
  metric: Pick<MyKpiMetricRow, 'targetValue' | 'targetSource'>,
  profileTarget: bigint | null | undefined,
): bigint | null {
  if (metric.targetSource != null) return metric.targetValue ?? null;
  return profileTarget ?? null;
}

/**
 * Shu kun uchun amaldagi og'irlik — MUHR ustun, profil zaxira (KPI-05).
 *
 * Muhrlangan `null` = «o'sha kuni og'irlik qo'yilmagan edi» va profilga
 * QAYTILMAYDI: aks holda menejer ataylab ballsiz qoldirgan ko'rsatkich
 * jimgina ballanardi.
 */
export function sealedWeight(
  metric: Pick<MyKpiMetricRow, 'weightApplied' | 'weightSource'>,
  profileWeight: number | undefined,
): number | null {
  if (metric.weightSource != null) {
    return metric.weightApplied == null ? null : Number(metric.weightApplied);
  }
  return profileWeight ?? null;
}

/**
 * Kun qatorini `kpi-score.ts` ga uzatadi. Formula bu yerda TAKRORLANMAYDI.
 */
export function scoreMyDay(
  day: MyKpiScorableDay,
  catalog: MetricCatalog = BUILT_IN_CATALOG,
): DayScore {
  const cfg = new Map(
    (day.profileVersion?.metrics ?? []).map((pm) => [
      pm.metricDef.key,
      { weight: Number(pm.weight), target: pm.target },
    ]),
  );
  const inputs: ScoreMetricInput[] = day.metrics.map((m) => ({
    metricKey: m.metricKey,
    autoValue: m.autoValue,
    adjustValue: m.adjustValue,
    target: sealedTarget(m, cfg.get(m.metricKey)?.target),
    weight: sealedWeight(m, cfg.get(m.metricKey)?.weight),
    complete: m.complete,
  }));
  return scoreDay(inputs, catalog);
}

/**
 * E'tibor signallari — kartada KO'RINADIGAN sabab, yashirin ball emas.
 *
 * 🔴 Ro'yxat menejer navbatidagi `ALERT_METRICS` bilan AYNAN bir xil
 * (`daily-kpi-acceptance.service.ts`). Xodim va menejer bir kunga qarab
 * boshqa-boshqa signal ko'rsa, «nega meni chaqirishdi» savoli javobsiz
 * qolardi.
 */
export const MY_KPI_ALERT_METRICS = [
  'till_variance_abs',
  'below_cost_count',
  'cancel_count',
  'refund_count',
  'late_minutes',
] as const;

export function myAttentionSignals(day: {
  state: string;
  dataComplete: boolean;
  metrics: ReadonlyArray<{ metricKey: string; autoValue: bigint | null }>;
}): string[] {
  const out: string[] = [];
  if (day.state === DAILY_KPI_STATE.stale) out.push('stale');
  if (day.state === DAILY_KPI_STATE.escalated) out.push('escalated');
  if (day.state === DAILY_KPI_STATE.rejected) out.push('rejected');
  if (!day.dataComplete) out.push('data_incomplete');
  for (const key of MY_KPI_ALERT_METRICS) {
    const v = day.metrics.find((m) => m.metricKey === key)?.autoValue ?? null;
    // NULL ≠ 0: o'lchanmagan ko'rsatkich signal BERMAYDI.
    if (v != null && v > 0n) out.push(key);
  }
  return out;
}

/**
 * Kun balli MUZLAGANMI (qabul lahzasida yozilgan).
 *
 * Muzlagan kunda `scorePercent` ustun turadi — jonli qayta hisoblangani EMAS:
 * aks holda ekrandagi raqam va to'langan oylik bir-biriga zid bo'lardi
 * (og'irlik keyin o'zgargan bo'lishi mumkin). Menejer navbati ham shu
 * qoidada.
 */
export function resolveScore(
  frozen: Prisma.Decimal | number | null,
  live: DayScore,
): { score: number | null; scoreFrozen: number | null; scoreIsFinal: boolean } {
  const f = frozen == null ? null : Number(frozen);
  return { score: f ?? live.score, scoreFrozen: f, scoreIsFinal: f != null };
}
