import { Prisma } from '@moysklad/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { DailyKpiState } from '../../manager/kpi/daily-kpi-fsm.js';
// TZ §3.4 — eskirgan kunlar tuzatmasi (sof modul, 17 test).
import { summarizeCorrections } from '../../manager/kpi/kpi-correction.js';
import { HrBonusFineService } from '../hr-bonus-fine/hr-bonus-fine.service.js';
import { HrSalaryService } from './hr-salary.service.js';
import {
  PAYROLL_SALES_METRIC_KEY,
  type PayrollAcceptanceResult,
  sumAcceptedSales,
} from './payroll-acceptance.util.js';
import {
  computeFinalSalaryMinor,
  monthBounds,
  monthInstantBounds,
  resolveFixComponentMinor,
} from './payroll-formula.util.js';
import {
  computeAchievementPercent,
  computeCommissionMinor,
  computeKpiEarnedMinor,
  lookupTierPayoutPercent,
} from './tier-lookup.util.js';

/**
 * Monthly payroll engine. For an employee + "YYYY-MM" it:
 *   1. Sums personal sales from the ACCEPTANCE store `EmployeeDailyKpi` —
 *      **only days the manager accepted** (4M.3 / M-Q8 blocking). Was
 *      `HrKpiDailyLog` until 2026-08-04; that table has no acceptance concept
 *      and its `date` label is a day behind, so it could not gate payment.
 *   2. Resolves achievement % vs the monthly target → KPI tier → payout %.
 *   3. kpiEarned = monthlyKpiBudget × payout%.
 *   4. commission = totalSales × commissionPercent%.
 *   5. bonus/fine sums from the ledger over the month window (P5a).
 *   6. fixComponent = employee base salary (Employee.salaryConfig).
 *   7. finalSalary = fix + kpi + bonus − fine + commission.
 * The HrKpiMonthlyScore row is upserted (idempotent recompute).
 *
 * Everything BigInt — see payroll-formula.util + tier-lookup.util.
 */
@Injectable()
export class HrPayrollService {
  private readonly logger = new Logger(HrPayrollService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HrSalaryService) private readonly salary: HrSalaryService,
    @Inject(HrBonusFineService) private readonly bonusFine: HrBonusFineService,
  ) {}

  async computeMonthly(accountId: string, employeeId: string, yearMonth: string) {
    // İKKI XIL oy chegarasi — ataylab (HR-7/8):
    //   • `monthBounds`        → YORLIQ chegarasi (UTC yarim tun). Faqat
    //     `localDateOnly` bilan yozilgan DATE ustunlari uchun
    //     (`EmployeeDailyKpi.date`). U yerda Toshkentga surish oyning
    //     1-kunini tashlab yuborardi.
    //   • `monthInstantBounds` → HAQIQIY instant chegarasi (Toshkent yarim
    //     tuni). `HrBonusFineLog.createdAt` kabi timestamp ustunlari uchun:
    //     1-avgust 02:00 mahalliy jarima UTC'da 31-iyul 21:00 bo'lgani uchun
    //     eski oyna uni IYULGA hisoblardi.
    const { start, endExclusive } = monthBounds(yearMonth);
    const instant = monthInstantBounds(yearMonth);
    const config = await this.salary.getResolved(accountId);

    const employee = await this.prisma.client.employee.findFirst({
      where: { id: employeeId, accountId },
      // `salaryMinor` — xodim kartochkasi yozadigan USTUN (HR-1). `salaryConfig`
      // JSON'i esa ixtiyoriy override bo'lib qoldi.
      select: { id: true, salaryConfig: true, salaryMinor: true },
    });
    if (!employee) {
      throw new Error(`Employee ${employeeId} not found in account`);
    }

    // 1. Total sales for the month — from the ACCEPTANCE store (4M.3, M-Q8).
    //
    // Manba `HrKpiDailyLog` dan `EmployeeDailyKpi` ga ko'chdi (TZ §9 dagi
    // tartibning 2-qadami). Ikki sabab:
    //   a) eski jadvalda QABUL tushunchasi umuman yo'q — menejer ko'rmagan kun
    //      ham oylikka tushib ketardi, ya'ni M-Q8 bloklashni amalga oshirib
    //      bo'lmasdi;
    //   b) eski jadvalning `date` yorlig'i bir kun orqada (`tz.util` izohi),
    //      shuning uchun ikkalasini sana bo'yicha bog'lash har kunni siljitardi.
    // Yangi omborda holat ham, sana ham, tuzatma ham BIR qatorda.
    const acceptance = await this.acceptedSales(accountId, employeeId, start, endExclusive);
    const totalSalesMinor = acceptance.totalSalesMinor;

    // 2-3. achievement → tier → kpi earned
    const achievement = computeAchievementPercent(totalSalesMinor, config.monthlySalesTargetMinor);
    const tierPayoutPercent = lookupTierPayoutPercent(achievement, config.kpiTiers);
    const kpiEarnedMinor = computeKpiEarnedMinor(config.monthlyKpiBudgetMinor, tierPayoutPercent);

    // 4. commission
    const commissionMinor = computeCommissionMinor(totalSalesMinor, config.commissionPercent);

    // 5. bonus / fine ledger sums (createdAt in month window — Toshkent instantlari)
    const { bonusMinor, fineMinor } = await this.bonusFine.aggregateRaw(
      accountId,
      employeeId,
      instant.start,
      new Date(instant.endExclusive.getTime() - 1),
    );

    // 6. fix component = per-employee base salary (ustun; JSON = override)
    const fixComponentMinor = resolveFixComponentMinor(employee);

    // 6b. Eskirgan kunlar tuzatmasi (§3.4) — SHU davrga tegishlilari.
    //
    // Filtr `period` bo'yicha, kun sanasi bo'yicha EMAS: iyul kunining
    // avgustda topilgan xatosi AVGUST oyligiga kiradi, chunki iyul
    // allaqachon to'langan va yopilgan.
    const correctionRows = await this.prisma.client.employeeKpiCorrection.findMany({
      where: { accountId, employeeId, period: yearMonth },
      select: { diffMinor: true, direction: true },
    });
    const corrections = summarizeCorrections(correctionRows);

    // 7. final
    const finalSalaryMinor = computeFinalSalaryMinor({
      fixComponentMinor,
      kpiEarnedMinor,
      bonusSumMinor: bonusMinor,
      fineSumMinor: fineMinor,
      commissionMinor,
      correctionNetMinor: corrections.netMinor,
    });

    const row = await this.prisma.client.hrKpiMonthlyScore.upsert({
      where: {
        accountId_employeeId_yearMonth: { accountId, employeeId, yearMonth },
      },
      create: {
        accountId,
        employeeId,
        yearMonth,
        totalSalesMinor,
        targetMinor: config.monthlySalesTargetMinor,
        achievementPercent: new Prisma.Decimal(achievement),
        tierPayoutPercent: new Prisma.Decimal(tierPayoutPercent),
        kpiEarnedMinor,
        fixComponentMinor,
        bonusSumMinor: bonusMinor,
        fineSumMinor: fineMinor,
        commissionMinor,
        finalSalaryMinor,
        acceptedDays: acceptance.acceptedDays,
        pendingDays: acceptance.pendingDays,
        blockedSalesMinor: acceptance.blockedSalesMinor,
        correctionIncreaseMinor: corrections.increaseMinor,
        correctionDecreaseMinor: corrections.decreaseMinor,
      },
      update: {
        totalSalesMinor,
        targetMinor: config.monthlySalesTargetMinor,
        achievementPercent: new Prisma.Decimal(achievement),
        tierPayoutPercent: new Prisma.Decimal(tierPayoutPercent),
        kpiEarnedMinor,
        fixComponentMinor,
        bonusSumMinor: bonusMinor,
        fineSumMinor: fineMinor,
        commissionMinor,
        finalSalaryMinor,
        acceptedDays: acceptance.acceptedDays,
        pendingDays: acceptance.pendingDays,
        blockedSalesMinor: acceptance.blockedSalesMinor,
        correctionIncreaseMinor: corrections.increaseMinor,
        correctionDecreaseMinor: corrections.decreaseMinor,
        computedAt: new Date(),
      },
    });
    return row;
  }

  /**
   * Oyning kunlarini qabul omboridan o'qib, oylikka kiradiganini ajratadi.
   *
   * Qoida SHU YERDA EMAS — `payroll-acceptance.util.ts` da (sof modul), u esa
   * «qaysi holat to'lanadi» degan savolni `daily-kpi-fsm.countsTowardPayroll()`
   * dan so'raydi. Ya'ni ro'yxat butun kod bazasida BITTA joyda.
   */
  private async acceptedSales(
    accountId: string,
    employeeId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<PayrollAcceptanceResult> {
    const days = await this.prisma.client.employeeDailyKpi.findMany({
      where: { accountId, employeeId, date: { gte: start, lt: endExclusive } },
      select: {
        state: true,
        metrics: {
          where: { metricKey: PAYROLL_SALES_METRIC_KEY },
          select: { autoValue: true, adjustValue: true },
        },
      },
    });

    return sumAcceptedSales(
      days.map((d) => ({
        state: d.state as DailyKpiState,
        autoSalesMinor: d.metrics[0]?.autoValue ?? null,
        adjustSalesMinor: d.metrics[0]?.adjustValue ?? null,
      })),
    );
  }

  /** Recompute the whole roster for a month. Returns rows written. */
  async computeMonthlyAll(accountId: string, yearMonth: string): Promise<{ written: number }> {
    const employees = await this.prisma.client.employee.findMany({
      where: { accountId, archived: false },
      select: { id: true },
    });
    let written = 0;
    for (const emp of employees) {
      try {
        await this.computeMonthly(accountId, emp.id, yearMonth);
        written++;
      } catch (e) {
        this.logger.error(
          `Payroll compute failed acc=${accountId} emp=${emp.id} ${yearMonth}: ${(e as Error).message}`,
        );
      }
    }
    return { written };
  }

  /**
   * Read the stored monthly scores for the Oylik table.
   *
   * `employeeId` berilmasa — butun ro'yxat (menejer «Oylik» jadvali, eski
   * xulq o'zgarmadi). Berilsa — FAQAT o'sha xodimning qatori: X6 dagi
   * «Oyligim» ekrani shu yo'ldan o'qiydi.
   *
   * 🔴 Filtr `undefined` bilan CHAQIRILMAYDI. Prisma'da `employeeId: undefined`
   * «filtr yo'q» degani, ya'ni bitta `undefined` butun ro'yxatni ochib
   * yuborardi. Shuning uchun kalit shartli SPREAD bilan qo'yiladi va
   * chaqiruvchi (`MyPayrollService`) qiymatning bo'sh emasligini o'zi
   * tekshiradi — ikkalasi ham testlar bilan qulflangan.
   */
  async listMonthly(accountId: string, yearMonth: string, employeeId?: string) {
    return this.prisma.client.hrKpiMonthlyScore.findMany({
      where: {
        accountId,
        yearMonth,
        ...(employeeId !== undefined ? { employeeId } : {}),
      },
      orderBy: { finalSalaryMinor: 'desc' },
      include: { employee: { select: { id: true, name: true } } },
    });
  }
}
