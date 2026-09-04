import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { HrPayrollService } from './hr-payroll.service.js';
import { monthInstantBounds } from './payroll-formula.util.js';

/**
 * X6 — «Oyligim»: xodimning O'Z oylik hisobi (mobil ilova).
 *
 * 🔴 UCH QAVATLI QAMROV. Bu X-rejaning eng qattiq xavfsizlik yo'li: bir
 * xodim boshqasining oyligini ko'rishi jiddiy hodisa, shuning uchun himoya
 * bitta joyga tayanmaydi:
 *
 *   1. **Darvoza** — `@RequireHrPermission('oylik','own_only')`
 *      (`my-payroll.controller.ts`). `oylik` sahifasi qatori bo'lmagan
 *      xodim 403 oladi.
 *   2. **So'rov** — `employeeId` FAQAT `user.sub` dan keladi va prisma
 *      `where` ida `accountId` bilan birga QAT'IY turadi. So'rov satri bu
 *      yergacha yetib kelmaydi (oy — yo'l parametri, sxemada boshqa maydon
 *      yo'q).
 *   3. **Javob** — o'qilgan qator YANA solishtiriladi (`assertOwn`) va
 *      javobga faqat sanoqli maydon ko'chiriladi. Xodim ismi ham,
 *      `employee` relation'i ham, jarimani KIM yozgani ham javobga
 *      TUSHMAYDI.
 *
 * 🔴 HALOL RAQAMLAR (X-reja 8-qoidasi): oy hisoblanmagan bo'lsa summalar
 * `null` bo'ladi, `0` EMAS. «0 so'm oylik» bilan «hali hisoblanmagan» ni
 * aralashtirish — xodim uchun eng og'ir yolg'on.
 */
@Injectable()
export class MyPayrollService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HrPayrollService) private readonly payroll: HrPayrollService,
  ) {}

  async myMonthly(accountId: string, employeeId: string, yearMonth: string) {
    // Bo'sh `employeeId` prisma'da «filtr yo'q» ga aylanib, butun ro'yxatni
    // ochib yuborardi. Bu yerda u faqat token'dan keladi, ya'ni bo'sh bo'lishi
    // MUMKIN emas — lekin shartnoma ochiq yozib qo'yiladi (fail-closed).
    if (!employeeId || !accountId) {
      throw new ForbiddenException('Oylik faqat o`z xodim yozuvi uchun ochiladi');
    }

    const rows = await this.payroll.listMonthly(accountId, yearMonth, employeeId);
    this.assertOwn(rows, accountId, employeeId);

    const row = rows[0] ?? null;
    const ledger = await this.myLedger(accountId, employeeId, yearMonth);

    return {
      yearMonth,
      /**
       * `not_computed` — oy uchun qator YO'Q (hali hisoblanmagan).
       * `partial`      — qator bor, lekin qabul kutayotgan kunlar bor
       *                  ⇒ raqam CHALA va o'zgarishi mumkin.
       * `computed`     — hamma kun qabul qilingan.
       */
      status: row === null ? 'not_computed' : row.pendingDays > 0 ? 'partial' : 'computed',
      computedAt: row?.computedAt ?? null,
      /** 🔴 NULL = hisoblanmagan oy. «0 so'm» EMAS. */
      finalSalaryMinor: row === null ? null : row.finalSalaryMinor.toString(),
      components:
        row === null
          ? null
          : {
              fixComponentMinor: row.fixComponentMinor.toString(),
              kpiEarnedMinor: row.kpiEarnedMinor.toString(),
              bonusSumMinor: row.bonusSumMinor.toString(),
              fineSumMinor: row.fineSumMinor.toString(),
              commissionMinor: row.commissionMinor.toString(),
              /** §3.4 — eskirgan kunlar tuzatmasi. Ikkalasi ALOHIDA. */
              correctionIncreaseMinor: row.correctionIncreaseMinor.toString(),
              correctionDecreaseMinor: row.correctionDecreaseMinor.toString(),
            },
      sales:
        row === null
          ? null
          : {
              totalSalesMinor: row.totalSalesMinor.toString(),
              targetMinor: row.targetMinor.toString(),
              achievementPercent: toNumber(row.achievementPercent),
              tierPayoutPercent: toNumber(row.tierPayoutPercent),
              acceptedDays: row.acceptedDays,
              /** > 0 bo'lsa hisob CHALA — yashirilmaydi (TZ §4.4). */
              pendingDays: row.pendingDays,
              /** Qabul qilinmagani uchun hisobga KIRMAGAN sotuv. */
              blockedSalesMinor: row.blockedSalesMinor.toString(),
            },
      ledger,
    };
  }

  /**
   * O'z bonus/jarima yozuvlari — oy oynasi oylik dvigateli bilan AYNI
   * (`monthInstantBounds`, `gte start … lte endExclusive−1ms`). Boshqa oyna
   * olinsa ro'yxatdagi qatorlar yig'indisi `bonusSumMinor` ga to'g'ri
   * kelmasdi va xodim «ro'yxat boshqa, jami boshqa» degan tushuntirib
   * bo'lmaydigan holatga tushardi.
   *
   * 🔴 `select` da `employee`, `employeeName`, `createdBy`, `createdById`
   * YO'Q: jarimani kim yozgani — boshqa odamning izi. Ekranga faqat
   * summa, sabab va sana chiqadi.
   */
  private async myLedger(accountId: string, employeeId: string, yearMonth: string) {
    const { start, endExclusive } = monthInstantBounds(yearMonth);
    const rows = await this.prisma.client.hrBonusFineLog.findMany({
      // 🔴 Ikkala kalit ham token'dan; so'rov parametri bu yerga kirmaydi.
      where: {
        accountId,
        employeeId,
        createdAt: { gte: start, lte: new Date(endExclusive.getTime() - 1) },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        source: true,
        amountMinor: true,
        reason: true,
        createdAt: true,
      },
    });

    let bonusMinor = 0n;
    let fineMinor = 0n;
    for (const r of rows) {
      if (r.kind === 'bonus') bonusMinor += r.amountMinor;
      else fineMinor += r.amountMinor;
    }

    return {
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        source: r.source,
        amountMinor: r.amountMinor.toString(),
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      /** Ro'yxatdagi qatorlarning JONLI yig'indisi (saqlangan raqam emas). */
      bonusMinor: bonusMinor.toString(),
      fineMinor: fineMinor.toString(),
    };
  }

  /**
   * 🔴 UCHINCHI QAVAT. Filtr ishlagan bo'lsa bu hech qachon otmaydi —
   * aynan shuning uchun turibdi: `listMonthly` ning qamrovi kelajakda
   * buzilsa (masalan kimdir `where` ga `OR` qo'shsa) ekran JIMGINA o'zga
   * xodimning oyligini ko'rsatib qo'ymaydi, so'rov 403 bilan yiqiladi.
   */
  private assertOwn(
    rows: Array<{ accountId: string; employeeId: string }>,
    accountId: string,
    employeeId: string,
  ): void {
    const foreign = rows.find((r) => r.employeeId !== employeeId || r.accountId !== accountId);
    if (foreign || rows.length > 1) {
      throw new ForbiddenException('Oylik qamrovi buzildi — so`rov rad etildi');
    }
  }
}

/** Prisma `Decimal` → son. `null`/buzuq → `null` (0 EMAS). */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}
