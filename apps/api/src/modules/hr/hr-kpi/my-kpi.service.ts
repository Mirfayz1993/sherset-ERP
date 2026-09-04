import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  BUILT_IN_CATALOG,
  type KpiMetricDef,
  type MetricCatalog,
  metricDef,
  perHourValue,
} from '../../manager/kpi/kpi-metrics.js';
import { myAttentionSignals, resolveScore, scoreMyDay } from './my-kpi-view.util.js';
import type { MyKpiQuery } from './my-kpi.schema.js';

/**
 * X5 — «Mening KPI'im»: xodimning O'Z kunlik KPI kartalari.
 *
 * 🔴 QAT'IY SELF-SCOPE. `employeeId` FAQAT chaqiruvchidan (`user.sub`)
 * keladi va prisma `where` da `accountId` bilan birga QAT'IY turadi —
 * boshqa xodimni qamrab oladigan «yumshoq» filtr (OR / in / undefined)
 * yo'q. Buni `my-kpi.service.test.ts` kalitlar ro'yxati bilan qulflaydi.
 *
 * 🔴 BOSHQA XODIM MAYDONLARI JAVOBGA UMUMAN TUSHMAYDI: `select` da
 * `employee` ham, `acceptedById` (qabul qilgan menejer) ham, jurnal
 * (`events` — menejer izohlari) ham YO'Q. Ekranga faqat kunning O'Z
 * raqamlari chiqadi.
 *
 * `manager/kpi` servislariga TEGILMAYDI (X-reja X5 sharti) — bu yengil
 * o'quvchi o'z so'rovini o'zi yozadi, ball esa umumiy sof moduldan
 * (`kpi-score.ts`) hisoblanadi.
 */
@Injectable()
export class MyKpiService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listMine(accountId: string, employeeId: string, query: MyKpiQuery) {
    const rows = await this.prisma.client.employeeDailyKpi.findMany({
      // 🔴 Ikkala kalit ham token'dan. Bu yerga so'rov parametri KIRMAYDI.
      where: { accountId, employeeId },
      orderBy: { date: 'desc' },
      take: query.limit,
      select: DAY_SELECT,
    });

    const catalog = await this.catalogFor(accountId);

    const days = rows.map((r) => {
      const live = scoreMyDay(r, catalog);
      const { score, scoreFrozen, scoreIsFinal } = resolveScore(r.scorePercent, live);
      return {
        id: r.id,
        date: r.date,
        state: r.state,
        dataComplete: r.dataComplete,
        /** NULL = davomat yozuvi yo'q (0 EMAS — «ishlamadi» degani emas). */
        workedMinutes: r.workedMinutes,
        /**
         * Kompozit ball. NULL = hech narsa ballanmadi (profil/maqsad/og'irlik
         * yo'q) — bu «0%» EMAS va ekranda «—» bo'lib chiqadi.
         */
        score,
        /** Qabul lahzasida MUZLATILGAN ball; NULL = kun hali qabul qilinmagan. */
        scoreFrozen,
        /** `false` — raqam hali o'zgarishi mumkin (kun qabul qilinmagan). */
        scoreIsFinal,
        coverage:
          scoreFrozen != null && r.scoreCoverage != null ? Number(r.scoreCoverage) : live.coverage,
        weightScored: live.weightScored,
        weightTotal: live.weightTotal,
        hasProfile: r.profileVersion != null,
        profileVersion: r.profileVersion?.version ?? null,
        staleAt: r.staleAt,
        acceptedAt: r.acceptedAt,
        stateChangedAt: r.stateChangedAt,
        computedAt: r.computedAt,
        attentionSignals: myAttentionSignals(r),
        metrics: this.mapMetrics(live, catalog, r.workedMinutes),
      };
    });

    return { limit: query.limit, total: days.length, days };
  }

  /**
   * Ko'rsatkich qatorlari — ballangani TEPADA, keyin kalit bo'yicha
   * (tartib qat'iy: ro'yxat har yuklanishda bir joyda tursin).
   *
   * Katalogda YO'Q kalit ham chiqadi (`unknown_metric`) — jimgina tashlab
   * yuborilsa xodim o'z kunidagi o'lchovni umuman ko'rmay qolardi.
   */
  private mapMetrics(
    live: ReturnType<typeof scoreMyDay>,
    catalog: MetricCatalog,
    workedMinutes: number | null,
  ) {
    return live.metrics
      .map((m) => {
        const def: KpiMetricDef | undefined = metricDef(m.metricKey, catalog);
        return {
          key: m.metricKey,
          labelUz: def?.labelUz ?? m.metricKey,
          labelRu: def?.labelRu ?? m.metricKey,
          unit: def?.unit ?? null,
          direction: def?.direction ?? null,
          perHour: def?.perHour ?? false,
          /** Tizim hisoblagani. NULL = O'LCHANMAGAN (0 EMAS). */
          autoValue: m.autoValue?.toString() ?? null,
          /** Menejer tuzatmasi. NULL = tuzatilmagan. */
          adjustValue: m.adjustValue?.toString() ?? null,
          /** Ballga kirgan qiymat: tuzatma ?? avtomat. */
          value: m.fact?.toString() ?? null,
          adjusted: m.adjusted,
          target: m.target?.toString() ?? null,
          weight: m.weight,
          achievementPercent: m.achievementPercent,
          contributionPercent: m.contributionPercent,
          complete: m.complete,
          scored: m.scored,
          /** Ballga NEGA kirmagani — ochiq aytiladi, jimgina 0 emas. */
          skipReason: m.skipReason,
          perHourValue:
            def?.perHour === true
              ? (perHourValue(m.fact, workedMinutes)?.toString() ?? null)
              : null,
        };
      })
      .sort((a, b) => Number(b.scored) - Number(a.scored) || a.key.localeCompare(b.key));
  }

  /**
   * Hisobning katalogi: built-in + hisob O'ZI yaratgan ko'rsatkichlar.
   *
   * `KpiMetricCatalogService` ni in'yeksiya qilmadim ATAYLAB: u
   * `ManagerModule` da va eksport qilinmagan, uni eksportga chiqarish esa
   * `manager/kpi` ga tegish bo'lardi (X5 sharti). O'qish bu yerda bitta
   * qatorli so'rov — arxivlanmagan `manual` ta'riflar.
   */
  private async catalogFor(accountId: string): Promise<MetricCatalog> {
    const custom = await this.prisma.client.kpiMetricDef.findMany({
      where: { accountId, source: 'manual', archived: false },
      orderBy: { createdAt: 'asc' },
      select: {
        key: true,
        labelUz: true,
        labelRu: true,
        unit: true,
        direction: true,
        source: true,
        perHour: true,
      },
    });
    if (custom.length === 0) return BUILT_IN_CATALOG;
    const merged = new Map<string, KpiMetricDef>(BUILT_IN_CATALOG);
    for (const row of custom) merged.set(row.key, row as KpiMetricDef);
    return merged;
  }
}

/**
 * Kun qatoridan O'QILADIGAN maydonlar.
 *
 * 🔴 `employee`, `acceptedById`, `events`, `corrections`, `bonusFineLogs`
 * ATAYLAB YO'Q — ular boshqa odamlarning izi (kim qabul qildi, qanday izoh
 * yozdi) yoki pul zanjiri. Xodim ekraniga faqat kunning o'z o'lchovi chiqadi.
 * Bu ro'yxat testda qat'iy tekshiriladi.
 */
const DAY_SELECT = {
  id: true,
  date: true,
  state: true,
  dataComplete: true,
  workedMinutes: true,
  scorePercent: true,
  scoreCoverage: true,
  staleAt: true,
  acceptedAt: true,
  stateChangedAt: true,
  computedAt: true,
  metrics: {
    select: {
      metricKey: true,
      autoValue: true,
      adjustValue: true,
      complete: true,
      targetValue: true,
      targetSource: true,
      weightApplied: true,
      weightSource: true,
    },
    orderBy: { metricKey: 'asc' },
  },
  profileVersion: {
    select: {
      version: true,
      metrics: { select: { weight: true, target: true, metricDef: { select: { key: true } } } },
    },
  },
} as const;
