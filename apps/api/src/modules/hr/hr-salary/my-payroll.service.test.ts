import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HrPayrollService } from './hr-payroll.service.js';
import { MyPayrollService } from './my-payroll.service.js';

/**
 * X6 — «Oyligim» SERVIS qulfi. Kontroller/darvoza qulfi
 * `my-payroll.controller.test.ts` da.
 *
 * Bu yerdagi savol bitta: **so'rov nimani so'raydi va javob nimani
 * ko'chiradi.** Shuning uchun `MyPayrollService` haqiqiy `HrPayrollService`
 * ustida quriladi (mock EMAS) — `listMonthly` ning prisma `where` i
 * to'g'ridan-to'g'ri tekshiriladi. Kelajakda o'sha `where` ga `OR`/`in`
 * qo'shilsa test yiqiladi.
 */

function makePrisma() {
  return {
    client: {
      employee: { findFirst: vi.fn(), findMany: vi.fn() },
      employeeDailyKpi: { findMany: vi.fn() },
      employeeKpiCorrection: { findMany: vi.fn().mockResolvedValue([]) },
      hrKpiMonthlyScore: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      hrBonusFineLog: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
}

/** Saqlangan oylik qatori — hamma pul ustuni BigInt (baza shartnomasi). */
function scoreRow(over: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    accountId: 'acc-1',
    employeeId: 'xodim-1',
    yearMonth: '2026-09',
    totalSalesMinor: 20_000_000_00n,
    targetMinor: 20_000_000_00n,
    achievementPercent: '100.00',
    tierPayoutPercent: '100.00',
    kpiEarnedMinor: 2_000_000_00n,
    fixComponentMinor: 5_000_000_00n,
    bonusSumMinor: 300_00n,
    fineSumMinor: 100_00n,
    commissionMinor: 300_000_00n,
    finalSalaryMinor: 7_300_200_00n,
    acceptedDays: 22,
    pendingDays: 0,
    blockedSalesMinor: 0n,
    correctionIncreaseMinor: 0n,
    correctionDecreaseMinor: 0n,
    computedAt: new Date('2026-10-01T03:00:00.000Z'),
    // 🔴 Menejer jadvali uchun `listMonthly` bu relation'ni HAM o'qiydi.
    // Javobga tushmasligi pastda alohida tekshiriladi.
    employee: { id: 'xodim-1', name: 'Alisher' },
    ...over,
  };
}

function ledgerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'bf-1',
    kind: 'bonus',
    source: 'manual',
    amountMinor: 300_00n,
    reason: 'Oy yakuni',
    createdAt: new Date('2026-09-15T09:00:00.000Z'),
    ...over,
  };
}

describe('MyPayrollService.myMonthly', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: MyPayrollService;

  beforeEach(() => {
    prisma = makePrisma();
    const payroll = new HrPayrollService(
      prisma as never,
      { getResolved: vi.fn() } as never,
      { aggregateRaw: vi.fn() } as never,
    );
    svc = new MyPayrollService(prisma as never, payroll);
  });

  // ── Qamrov ────────────────────────────────────────────────────────────────

  it('🔴 oylik `where` ida FAQAT accountId + yearMonth + employeeId bor', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([scoreRow()]);
    await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    const args = prisma.client.hrKpiMonthlyScore.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    // Kalitlar ro'yxati QAT'IY: `OR`/`in`/`NOT` qo'shilsa test yiqiladi.
    expect(Object.keys(args.where).sort()).toEqual(['accountId', 'employeeId', 'yearMonth']);
    expect(args.where).toEqual({
      accountId: 'acc-1',
      employeeId: 'xodim-1',
      yearMonth: '2026-09',
    });
  });

  it('🔴 bonus/jarima `where` ida FAQAT accountId + employeeId + createdAt bor', async () => {
    await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    const args = prisma.client.hrBonusFineLog.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(Object.keys(args.where).sort()).toEqual(['accountId', 'createdAt', 'employeeId']);
    expect(args.where.accountId).toBe('acc-1');
    expect(args.where.employeeId).toBe('xodim-1');
  });

  it("🔴 bonus/jarima `select` ida boshqa odamning izi YO'Q", async () => {
    await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    const args = prisma.client.hrBonusFineLog.findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    expect(Object.keys(args.select).sort()).toEqual([
      'amountMinor',
      'createdAt',
      'id',
      'kind',
      'reason',
      'source',
    ]);
    for (const forbidden of ['employee', 'employeeName', 'createdBy', 'createdById']) {
      expect(args.select).not.toHaveProperty(forbidden);
    }
  });

  it('bonus/jarima oynasi oylik dvigateli bilan AYNI (Toshkent instantlari)', async () => {
    await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    const args = prisma.client.hrBonusFineLog.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date; lte: Date } };
    };
    // 1-sentabr 00:00 Toshkent = 31-avgust 19:00 UTC (HR-7/8).
    expect(args.where.createdAt.gte.toISOString()).toBe('2026-08-31T19:00:00.000Z');
    // Oxirgi lahza — keyingi oy boshlanishidan 1 ms oldin.
    expect(args.where.createdAt.lte.toISOString()).toBe('2026-09-30T18:59:59.999Z');
  });

  it("🔴 boshqa akkaunt xodimi — o'z akkaunti bo'yicha so'raydi, qator topilmaydi", async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([]);
    const out = await svc.myMonthly('acc-2', 'xodim-1', '2026-09');

    const args = prisma.client.hrKpiMonthlyScore.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.accountId).toBe('acc-2');
    expect(out.status).toBe('not_computed');
    expect(out.finalSalaryMinor).toBeNull();
  });

  it("🔴 bo'sh employeeId → 403 va bazaga so'rov UMUMAN ketmaydi", async () => {
    await expect(svc.myMonthly('acc-1', '', '2026-09')).rejects.toThrow();
    await expect(svc.myMonthly('', 'xodim-1', '2026-09')).rejects.toThrow();
    expect(prisma.client.hrKpiMonthlyScore.findMany).not.toHaveBeenCalled();
    expect(prisma.client.hrBonusFineLog.findMany).not.toHaveBeenCalled();
  });

  it('🔴 qamrov buzilsa (o`zga xodim qatori qaytsa) so`rov 403 bilan yiqiladi', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([
      scoreRow({ employeeId: 'boshqa-xodim' }),
    ]);
    await expect(svc.myMonthly('acc-1', 'xodim-1', '2026-09')).rejects.toThrow();
  });

  it('🔴 qamrov buzilsa (o`zga AKKAUNT qatori qaytsa) ham 403', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([
      { ...scoreRow(), accountId: 'boshqa-akkaunt' },
    ]);
    await expect(svc.myMonthly('acc-1', 'xodim-1', '2026-09')).rejects.toThrow();
  });

  it('🔴 bittadan ko`p qator qaytsa 403 — birinchisini JIMGINA olmaymiz', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([scoreRow(), scoreRow()]);
    await expect(svc.myMonthly('acc-1', 'xodim-1', '2026-09')).rejects.toThrow();
  });

  // ── Javob maydonlari ──────────────────────────────────────────────────────

  it("🔴 javobda xodim ismi ham, `employee` relation'i ham YO'Q", async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([scoreRow()]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    const text = JSON.stringify(out);
    expect(text).not.toContain('Alisher');
    expect(text).not.toContain('employee');
    expect(out).not.toHaveProperty('employee');
  });

  it('javobning yuqori kalitlari qat`iy', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([scoreRow()]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(Object.keys(out).sort()).toEqual([
      'components',
      'computedAt',
      'finalSalaryMinor',
      'ledger',
      'sales',
      'status',
      'yearMonth',
    ]);
  });

  it('tarkib va sotuv raqamlari MATN (BigInt) bo`lib chiqadi', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([scoreRow()]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.finalSalaryMinor).toBe('730020000');
    expect(out.components).toEqual({
      fixComponentMinor: '500000000',
      kpiEarnedMinor: '200000000',
      bonusSumMinor: '30000',
      fineSumMinor: '10000',
      commissionMinor: '30000000',
      correctionIncreaseMinor: '0',
      correctionDecreaseMinor: '0',
    });
    expect(out.sales).toEqual({
      totalSalesMinor: '2000000000',
      targetMinor: '2000000000',
      achievementPercent: 100,
      tierPayoutPercent: 100,
      acceptedDays: 22,
      pendingDays: 0,
      blockedSalesMinor: '0',
    });
  });

  it('`Long` chegarasidan katta summa ham to`g`ri chiqadi', async () => {
    const huge = 9_223_372_036_854_775_807n * 2n;
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([
      scoreRow({ finalSalaryMinor: huge }),
    ]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.finalSalaryMinor).toBe('18446744073709551614');
  });

  // ── Halol raqamlar (X-reja 8-qoidasi) ─────────────────────────────────────

  it('🔴 hisoblanmagan oy: `null` ≠ 0 — summalar UMUMAN chiqmaydi', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.status).toBe('not_computed');
    expect(out.finalSalaryMinor).toBeNull();
    expect(out.components).toBeNull();
    expect(out.sales).toBeNull();
    expect(out.computedAt).toBeNull();
    // Bonus/jarima ro'yxati esa hisobdan MUSTAQIL — oy hisoblanmagan bo'lsa
    // ham yozuvlar bazada turishi mumkin.
    expect(out.ledger.rows).toEqual([]);
  });

  it('qabul kutayotgan kun bo`lsa holat `partial` (hisob CHALA)', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([
      scoreRow({ pendingDays: 3, blockedSalesMinor: 500_000_00n }),
    ]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.status).toBe('partial');
    expect(out.sales?.pendingDays).toBe(3);
    // Bloklangan sotuv YASHIRILMAYDI — «nega oylik kam» degan savobning javobi.
    expect(out.sales?.blockedSalesMinor).toBe('50000000');
  });

  it('hamma kun qabul qilingan bo`lsa holat `computed`', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([scoreRow({ pendingDays: 0 })]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.status).toBe('computed');
  });

  it('buzuq foiz `null` bo`ladi, 0 EMAS', async () => {
    prisma.client.hrKpiMonthlyScore.findMany.mockResolvedValue([
      scoreRow({ achievementPercent: null, tierPayoutPercent: 'xxx' }),
    ]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.sales?.achievementPercent).toBeNull();
    expect(out.sales?.tierPayoutPercent).toBeNull();
  });

  // ── Bonus/jarima ro'yxati ─────────────────────────────────────────────────

  it('bonus va jarima ALOHIDA sanaladi (qo`shilmaydi)', async () => {
    prisma.client.hrBonusFineLog.findMany.mockResolvedValue([
      ledgerRow({ id: 'b1', kind: 'bonus', amountMinor: 300_00n }),
      ledgerRow({ id: 'f1', kind: 'fine', amountMinor: 100_00n, source: 'auto_late' }),
      ledgerRow({ id: 'b2', kind: 'bonus', amountMinor: 50_00n }),
    ]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.ledger.bonusMinor).toBe('35000');
    expect(out.ledger.fineMinor).toBe('10000');
    expect(out.ledger.rows).toHaveLength(3);
  });

  it('ro`yxat qatorida faqat summa, sabab va sana bor', async () => {
    prisma.client.hrBonusFineLog.findMany.mockResolvedValue([ledgerRow()]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(Object.keys(out.ledger.rows[0] ?? {}).sort()).toEqual([
      'amountMinor',
      'createdAt',
      'id',
      'kind',
      'reason',
      'source',
    ]);
    expect(out.ledger.rows[0]?.amountMinor).toBe('30000');
  });

  it('sababsiz yozuvda `reason` `null` bo`lib qoladi (bo`sh matn emas)', async () => {
    prisma.client.hrBonusFineLog.findMany.mockResolvedValue([ledgerRow({ reason: null })]);
    const out = await svc.myMonthly('acc-1', 'xodim-1', '2026-09');

    expect(out.ledger.rows[0]?.reason).toBeNull();
  });
});
