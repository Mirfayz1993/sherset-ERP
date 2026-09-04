import { describe, expect, it, vi } from 'vitest';
import { MyKpiService } from './my-kpi.service.js';

/**
 * X5 — «Mening KPI'im» servisi. Ikki narsa sinaladi:
 *   1. **Qamrov qulfi** (X-reja 0-bo'lim 7-qoidasi): so'rov FAQAT
 *      `accountId` + `employeeId` bilan chegaralanadi va javobga boshqa
 *      odamning maydonlari TUSHMAYDI.
 *   2. **Halol raqamlar** (8-qoida): `score: null ≠ 0`, o'lchanmagan
 *      ko'rsatkich nolga aylanmaydi, muzlagan ball jonlisidan ustun.
 */

interface DayRow {
  id: string;
  date: Date;
  state: string;
  dataComplete: boolean;
  workedMinutes: number | null;
  scorePercent: number | null;
  scoreCoverage: number | null;
  staleAt: Date | null;
  acceptedAt: Date | null;
  stateChangedAt: Date | null;
  computedAt: Date;
  metrics: Array<Record<string, unknown>>;
  profileVersion: { version: number; metrics: Array<Record<string, unknown>> } | null;
}

function day(over: Partial<DayRow> = {}): DayRow {
  return {
    id: 'kun-1',
    date: new Date('2026-09-03T00:00:00.000Z'),
    state: 'computed',
    dataComplete: true,
    workedMinutes: 480,
    scorePercent: null,
    scoreCoverage: null,
    staleAt: null,
    acceptedAt: null,
    stateChangedAt: null,
    computedAt: new Date('2026-09-03T18:30:00.000Z'),
    metrics: [],
    profileVersion: null,
    ...over,
  };
}

function scoredMetric(over: Record<string, unknown> = {}) {
  return {
    metricKey: 'cash_revenue',
    autoValue: 1_000n,
    adjustValue: null,
    complete: true,
    targetValue: 1_000n,
    targetSource: 'employee_target',
    weightApplied: 1,
    weightSource: 'profile',
    ...over,
  };
}

function makePrisma(days: DayRow[] = [], custom: Array<Record<string, unknown>> = []) {
  return {
    client: {
      employeeDailyKpi: { findMany: vi.fn().mockResolvedValue(days) },
      kpiMetricDef: { findMany: vi.fn().mockResolvedValue(custom) },
    },
  };
}

function svcOf(prisma: ReturnType<typeof makePrisma>) {
  return new MyKpiService(prisma as never);
}

// ── MANFIY: own-only qamrov shartnomasi ─────────────────────────────────────

describe("MyKpiService.listMine — qat'iy self-scope", () => {
  it("🔴 so'rov FAQAT accountId + employeeId bilan chegaralanadi", async () => {
    const prisma = makePrisma([day()]);
    await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const arg = prisma.client.employeeDailyKpi.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ accountId: 'acc-1', employeeId: 'men' });
    // Boshqa xodimni qamrab oladigan «yumshoq» filtr (OR/in/undefined)
    // BO'LMASIN — kelajakda qo'shilsa shu test yiqiladi.
    expect(Object.keys(arg.where)).toEqual(['accountId', 'employeeId']);
    expect(arg.take).toBe(30);
  });

  it("🔴 javob `select` ida BOSHQA ODAM izlari yo'q (employee, acceptedById, events)", async () => {
    const prisma = makePrisma([day()]);
    await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const select = prisma.client.employeeDailyKpi.findMany.mock.calls[0]?.[0]?.select;
    for (const forbidden of [
      'employee',
      'acceptedById',
      'events',
      'corrections',
      'bonusFineLogs',
      'account',
    ]) {
      expect(select, `select ichida ${forbidden} bo'lmasin`).not.toHaveProperty(forbidden);
    }
  });

  it("🔴 javob obyektida boshqa xodim maydonlari yo'q", async () => {
    const prisma = makePrisma([day({ metrics: [scoredMetric()] })]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const d = out.days[0];
    expect(d).not.toHaveProperty('employee');
    expect(d).not.toHaveProperty('employeeId');
    expect(d).not.toHaveProperty('acceptedById');
    expect(d).not.toHaveProperty('events');
  });

  it("boshqa akkaunt/xodim so'ralsa (qator yo'q) — bo'sh ro'yxat, xato emas", async () => {
    const prisma = makePrisma([]);
    const out = await svcOf(prisma).listMine('acc-1', 'begona', { limit: 30 });

    expect(out).toEqual({ limit: 30, total: 0, days: [] });
  });

  it("katalog ham FAQAT o'z akkauntidan o'qiladi", async () => {
    const prisma = makePrisma([day()], [{ key: 'custom_x' }]);
    await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const where = prisma.client.kpiMetricDef.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ accountId: 'acc-1', source: 'manual', archived: false });
  });
});

// ── Halol raqamlar ──────────────────────────────────────────────────────────

describe('MyKpiService.listMine — halol raqamlar shartnomasi', () => {
  it("ballanadigan kun to'g'ri hisoblanadi va tartib sana bo'yicha kamayadi", async () => {
    const prisma = makePrisma([day({ metrics: [scoredMetric()] })]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    expect(prisma.client.employeeDailyKpi.findMany.mock.calls[0]?.[0]?.orderBy).toEqual({
      date: 'desc',
    });
    expect(out.days[0]?.score).toBe(100);
    expect(out.days[0]?.scoreIsFinal).toBe(false);
    expect(out.days[0]?.metrics[0]?.scored).toBe(true);
  });

  it('🔴 hech narsa ballanmagan kunda score = null (0 EMAS)', async () => {
    const prisma = makePrisma([
      day({ metrics: [scoredMetric({ weightApplied: null, weightSource: 'none' })] }),
    ]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    expect(out.days[0]?.score).toBeNull();
    expect(out.days[0]?.coverage).toBeNull();
    expect(out.days[0]?.metrics[0]?.skipReason).toBe('no_weight');
  });

  it("🔴 o'lchanmagan ko'rsatkich `autoValue: null` bo'lib qoladi, 0 ga aylanmaydi", async () => {
    const prisma = makePrisma([day({ metrics: [scoredMetric({ autoValue: null })] })]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const m = out.days[0]?.metrics[0];
    expect(m?.autoValue).toBeNull();
    expect(m?.value).toBeNull();
    expect(m?.skipReason).toBe('unmeasured');
    expect(m?.achievementPercent).toBeNull();
  });

  it('🔴 muzlagan ball jonli hisobdan USTUN va `scoreIsFinal: true`', async () => {
    const prisma = makePrisma([
      day({
        state: 'accepted',
        scorePercent: 88,
        scoreCoverage: 0.75,
        metrics: [scoredMetric()], // jonli hisob 100% berardi
      }),
    ]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    expect(out.days[0]?.score).toBe(88);
    expect(out.days[0]?.scoreFrozen).toBe(88);
    expect(out.days[0]?.scoreIsFinal).toBe(true);
    expect(out.days[0]?.coverage).toBe(0.75);
  });

  it("workedMinutes null bo'lsa soatlik qiymat ham null (nolga bo'linmaydi)", async () => {
    const prisma = makePrisma([day({ workedMinutes: null, metrics: [scoredMetric()] })]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    expect(out.days[0]?.workedMinutes).toBeNull();
    expect(out.days[0]?.metrics[0]?.perHourValue).toBeNull();
  });

  it("soatlik qiymat FAQAT `perHour` ko'rsatkichda hisoblanadi", async () => {
    const prisma = makePrisma([
      day({
        workedMinutes: 60,
        metrics: [
          scoredMetric({ metricKey: 'cash_revenue', autoValue: 1_000n }), // perHour = true
          scoredMetric({ metricKey: 'late_minutes', autoValue: 10n }), // perHour = false
        ],
      }),
    ]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const byKey = new Map(out.days[0]?.metrics.map((m) => [m.key, m]));
    expect(byKey.get('cash_revenue')?.perHourValue).toBe('1000');
    expect(byKey.get('late_minutes')?.perHourValue).toBeNull();
  });

  it("e'tibor signallari kartaga chiqadi", async () => {
    const prisma = makePrisma([
      day({
        state: 'rejected',
        dataComplete: false,
        metrics: [scoredMetric({ metricKey: 'late_minutes', autoValue: 25n })],
      }),
    ]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    expect(out.days[0]?.attentionSignals).toEqual(['rejected', 'data_incomplete', 'late_minutes']);
  });

  it("hisobning O'Z ko'rsatkichi katalogdan yorliq oladi (jimgina tushib qolmaydi)", async () => {
    const prisma = makePrisma(
      [
        day({
          metrics: [scoredMetric({ metricKey: 'custom_ustoz', autoValue: 8n, targetValue: 10n })],
        }),
      ],
      [
        {
          key: 'custom_ustoz',
          labelUz: 'Ustoz bahosi',
          labelRu: 'Оценка наставника',
          unit: 'count',
          direction: 'higher_better',
          source: 'manual',
          perHour: false,
        },
      ],
    );
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const m = out.days[0]?.metrics[0];
    expect(m?.labelUz).toBe('Ustoz bahosi');
    expect(m?.scored).toBe(true);
    expect(m?.achievementPercent).toBe(80);
  });

  it("katalogda YO'Q kalit ham qatorda qoladi (xom kalit bilan)", async () => {
    const prisma = makePrisma([day({ metrics: [scoredMetric({ metricKey: 'notanish_kalit' })] })]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    const m = out.days[0]?.metrics[0];
    expect(m?.key).toBe('notanish_kalit');
    expect(m?.labelUz).toBe('notanish_kalit');
    expect(m?.unit).toBeNull();
    expect(m?.skipReason).toBe('unknown_metric');
  });

  it("ko'rsatkich tartibi qat'iy: ballangani tepada, keyin kalit bo'yicha", async () => {
    const prisma = makePrisma([
      day({
        metrics: [
          scoredMetric({ metricKey: 'receipt_count', weightApplied: null, weightSource: 'none' }),
          scoredMetric({ metricKey: 'gross_profit' }),
          scoredMetric({ metricKey: 'cash_revenue' }),
        ],
      }),
    ]);
    const out = await svcOf(prisma).listMine('acc-1', 'men', { limit: 30 });

    expect(out.days[0]?.metrics.map((m) => m.key)).toEqual([
      'cash_revenue',
      'gross_profit',
      'receipt_count',
    ]);
  });
});
