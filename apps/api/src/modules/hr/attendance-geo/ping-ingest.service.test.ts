import { afterEach, describe, expect, it, vi } from 'vitest';
import { HrPingIngestService } from './ping-ingest.service.js';

interface MakeOpts {
  attendanceOptIn?: boolean;
  workLocationId?: string | null;
  /** HR-2: nomli (siklik/erkin) HrSchedule — berilmasa hafta-kuni fallback. */
  schedule?: unknown;
  workSchedules?: { weekday: number; startTime: string; endTime: string; isDayOff: boolean }[];
  /**
   * X8: `resolveAllowedLocations` qaytaradigan ro'yxat — asosiy filial +
   * `HrEmployeeBranch`. Berilmasa: asosiy filial bor bo'lsa faqat o'sha,
   * yo'q bo'lsa BO'SH ro'yxat (biriktirilgan joy yo'q ⇒ `no_location`).
   */
  locations?: { id: string; lat: number; lng: number; radiusMeters: number }[];
}

/** Asosiy filial — eski mock'dagi koordinatalar (INSIDE aynan shu nuqta). */
const WL1 = { id: 'wl1', lat: 41.311, lng: 69.24, radiusMeters: 150 };

/**
 * Hafta-kuni fallback: HAR KUN 09:00–18:00 (eski `employeeWorkSchedule.findUnique`
 * mock'i aynan shuni qaytarardi — qaysi kun bo'lishidan qat'i nazar).
 */
const EVERY_WEEKDAY_9_TO_18 = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '18:00',
  isDayOff: false,
}));

function makePrisma(opts: MakeOpts = {}) {
  const {
    attendanceOptIn = true,
    workLocationId = 'wl1',
    schedule = null,
    workSchedules = EVERY_WEEKDAY_9_TO_18,
    locations = workLocationId ? [{ ...WL1, id: workLocationId }] : [],
  } = opts;
  return {
    client: {
      employee: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ attendanceOptIn, workLocationId, schedule, workSchedules }),
      },
      hrWorkLocation: {
        findMany: vi.fn().mockResolvedValue(locations),
      },
      hrLocationPing: {
        findFirst: vi.fn().mockResolvedValue(null), // last ping today (jumpFilter prev)
        findMany: vi.fn().mockResolvedValue([]), // recent samples (desc)
        create: vi.fn().mockResolvedValue({}),
      },
      hrAttendance: {
        findFirst: vi.fn().mockResolvedValue(null), // open record today
        create: vi.fn().mockResolvedValue({
          id: 'att-new',
          checkInTime: new Date(),
          checkOutTime: null,
          lateMinutes: 10,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      employeeWorkSchedule: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ startTime: '09:00', endTime: '18:00', isDayOff: false }),
      },
    },
  };
}

const INSIDE = { lat: 41.311, lng: 69.24, accuracy: 10 };
const OUTSIDE = { lat: 41.35, lng: 69.24, accuracy: 10 };

afterEach(() => vi.useRealTimers());

describe('HrPingIngestService.ingest', () => {
  it('rejects accuracy>100 without persisting', async () => {
    const prisma = makePrisma();
    const svc = new HrPingIngestService(prisma as never, { emit: vi.fn() } as never);
    const r = await svc.ingest('acc', 'emp', { lat: 41.311, lng: 69.24, accuracy: 250 });
    expect(r).toMatchObject({ accepted: false, reason: 'accuracy' });
    expect(prisma.client.hrLocationPing.create).not.toHaveBeenCalled();
  });

  it('benign when not opted in', async () => {
    const prisma = makePrisma({ attendanceOptIn: false });
    const svc = new HrPingIngestService(prisma as never, { emit: vi.fn() } as never);
    const r = await svc.ingest('acc', 'emp', INSIDE);
    expect(r).toMatchObject({ accepted: false, reason: 'not_opted_in' });
    expect(prisma.client.hrLocationPing.create).not.toHaveBeenCalled();
  });

  it('benign when no work-location assigned', async () => {
    const prisma = makePrisma({ workLocationId: null });
    const svc = new HrPingIngestService(prisma as never, { emit: vi.fn() } as never);
    const r = await svc.ingest('acc', 'emp', INSIDE);
    expect(r).toMatchObject({ accepted: false, reason: 'no_location' });
  });

  it('creates auto_gps check-in on KELDI with lateMinutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00')); // 10 min after 09:00 start
    const prisma = makePrisma();
    // two inside samples (desc) -> reversed to ascending -> last 2 all inside -> KELDI
    prisma.client.hrLocationPing.findMany.mockResolvedValue([
      { inside: true, createdAt: new Date('2026-07-27T09:10:00+05:00') },
      { inside: true, createdAt: new Date('2026-07-27T09:09:00+05:00') },
    ]);
    const emitter = { emit: vi.fn() };
    const svc = new HrPingIngestService(prisma as never, emitter as never);
    const r = await svc.ingest('acc', 'emp', INSIDE);

    expect(r.decision).toBe('KELDI');
    expect(prisma.client.hrLocationPing.create).toHaveBeenCalled();
    const createArg = prisma.client.hrAttendance.create.mock.calls[0]?.[0] as {
      data: { source: string; lateMinutes: number; checkInLat: number };
    };
    expect(createArg.data.source).toBe('auto_gps');
    expect(createArg.data.lateMinutes).toBe(10);
    expect(createArg.data.checkInLat).toBe(INSIDE.lat);
    // Auto-GPS check-in emits the domain event (director notifier / auto-fine).
    expect(emitter.emit).toHaveBeenCalledWith(
      'hr.attendance.checked_in',
      expect.objectContaining({
        accountId: 'acc',
        employeeId: 'emp',
        attendanceId: 'att-new',
        lateMinutes: 10,
      }),
    );
  });

  it('closes open record on KETDI via atomic updateMany', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-27T18:30:00+05:00');
    vi.setSystemTime(now);
    const prisma = makePrisma();
    prisma.client.hrAttendance.findFirst.mockResolvedValue({
      id: 'att1',
      checkInTime: new Date('2026-07-27T09:00:00+05:00'),
      lateMinutes: 0,
    });
    // trailing continuous outside run >= 3 min (desc order from the service query)
    prisma.client.hrLocationPing.findMany.mockResolvedValue([
      { inside: false, createdAt: new Date('2026-07-27T18:29:00+05:00') },
      { inside: false, createdAt: new Date('2026-07-27T18:25:00+05:00') },
      { inside: true, createdAt: new Date('2026-07-27T18:10:00+05:00') },
    ]);
    const emitter = { emit: vi.fn() };
    const svc = new HrPingIngestService(prisma as never, emitter as never);
    const r = await svc.ingest('acc', 'emp', OUTSIDE);

    expect(r.decision).toBe('KETDI');
    expect(r.status).toBe('left');
    const updArg = prisma.client.hrAttendance.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; checkOutTime: null };
      data: { checkOutTime: Date };
    };
    expect(updArg.where).toMatchObject({ id: 'att1', checkOutTime: null });
    expect(updArg.data.checkOutTime).toBeInstanceOf(Date);
    // Auto-GPS check-out emits the domain event only when the atomic close won.
    expect(emitter.emit).toHaveBeenCalledWith(
      'hr.attendance.checked_out',
      expect.objectContaining({ accountId: 'acc', employeeId: 'emp', attendanceId: 'att1' }),
    );
  });
});

describe('HrPingIngestService.manualCheckIn (instant button)', () => {
  it('marks KELDI immediately on a single inside reading (no debounce)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00'));
    const prisma = makePrisma();
    const r = await new HrPingIngestService(
      prisma as never,
      { emit: vi.fn() } as never,
    ).manualCheckIn('acc', 'emp', INSIDE);
    expect(r).toMatchObject({ ok: true, reason: null, status: 'at_work' });
    expect(prisma.client.hrAttendance.create).toHaveBeenCalled();
  });

  it('rejects when outside the geofence', async () => {
    const prisma = makePrisma();
    const r = await new HrPingIngestService(
      prisma as never,
      { emit: vi.fn() } as never,
    ).manualCheckIn('acc', 'emp', OUTSIDE);
    expect(r).toMatchObject({ ok: false, reason: 'outside' });
    expect(prisma.client.hrAttendance.create).not.toHaveBeenCalled();
  });

  it('is idempotent when already checked in today', async () => {
    const prisma = makePrisma();
    prisma.client.hrAttendance.findFirst.mockResolvedValue({
      checkInTime: new Date('2026-07-27T09:00:00+05:00'),
      lateMinutes: 5,
    });
    const r = await new HrPingIngestService(
      prisma as never,
      { emit: vi.fn() } as never,
    ).manualCheckIn('acc', 'emp', INSIDE);
    expect(r).toMatchObject({ ok: true, reason: 'already_open', status: 'at_work' });
    expect(prisma.client.hrAttendance.create).not.toHaveBeenCalled();
  });

  it('benign when not opted in', async () => {
    const prisma = makePrisma({ attendanceOptIn: false });
    const r = await new HrPingIngestService(
      prisma as never,
      { emit: vi.fn() } as never,
    ).manualCheckIn('acc', 'emp', INSIDE);
    expect(r).toMatchObject({ ok: false, reason: 'not_opted_in' });
  });
});

describe('HrPingIngestService.manualCheckOut (instant button)', () => {
  it('closes the open record immediately, no location gate', async () => {
    const prisma = makePrisma();
    prisma.client.hrAttendance.findFirst.mockResolvedValue({
      id: 'att1',
      checkInTime: new Date('2026-07-27T09:00:00+05:00'),
      lateMinutes: 0,
    });
    const r = await new HrPingIngestService(
      prisma as never,
      { emit: vi.fn() } as never,
    ).manualCheckOut('acc', 'emp', OUTSIDE);
    expect(r).toMatchObject({ ok: true, reason: null, status: 'left' });
    const updArg = prisma.client.hrAttendance.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; checkOutTime: null };
    };
    expect(updArg.where).toMatchObject({ id: 'att1', checkOutTime: null });
  });

  it('errors when no open record exists', async () => {
    const prisma = makePrisma();
    const r = await new HrPingIngestService(
      prisma as never,
      { emit: vi.fn() } as never,
    ).manualCheckOut('acc', 'emp', INSIDE);
    expect(r).toMatchObject({ ok: false, reason: 'no_open_record' });
  });
});

/**
 * HR-2 — GPS check-in `resolveShift`'siz kechikish hisoblardi.
 *
 * `ingest()` KELDI yo'li ham, `manualCheckIn()` ham to'g'ridan-to'g'ri
 * `employeeWorkSchedule.findUnique` (hafta-kuni jadvali) ni o'qib
 * `computeLateMinutes` chaqirardi. Nomli SIKLIK (`flexible`) yoki ERKIN
 * (`free`) `HrSchedule` biriktirilgan xodim uchun bu jadval bo'sh/boshqa —
 * ya'ni kechikish noto'g'ri (ko'pincha 0, ba'zan soatlab ortiqcha) yozilardi
 * va shu raqamdan avto-jarima kelib chiqardi. To'g'ri manba — `resolveShift`
 * (`hr-attendance.service.checkIn` allaqachon shundan foydalanadi).
 */
describe('HR-2 — kechikish resolveShift orqali hisoblanadi', () => {
  /** 4 kunlik sikl: Kun 1–2 ish (08:00), Kun 3–4 dam. Anchor = 2026-07-27. */
  const CYCLIC = {
    type: 'flexible',
    startDate: new Date('2026-07-27T00:00:00.000Z'),
    cycleDays: 4,
    calcOvertime: false,
    extendedWorkMin: 0,
    days: [
      {
        dayIndex: 1,
        isWorkday: true,
        startTime: '08:00',
        endTime: '17:00',
        breakStart: null,
        breakEnd: null,
      },
      {
        dayIndex: 2,
        isWorkday: true,
        startTime: '08:00',
        endTime: '17:00',
        breakStart: null,
        breakEnd: null,
      },
      {
        dayIndex: 3,
        isWorkday: false,
        startTime: null,
        endTime: null,
        breakStart: null,
        breakEnd: null,
      },
      {
        dayIndex: 4,
        isWorkday: false,
        startTime: null,
        endTime: null,
        breakStart: null,
        breakEnd: null,
      },
    ],
  };

  const FREE = {
    type: 'free',
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    cycleDays: 1,
    calcOvertime: false,
    extendedWorkMin: 0,
    days: [],
  };

  /** Ikkita ketma-ket «ichkarida» namuna → KELDI qarori. */
  function keldi(prisma: ReturnType<typeof makePrisma>, at: string) {
    prisma.client.hrLocationPing.findMany.mockResolvedValue([
      { inside: true, createdAt: new Date(at) },
      { inside: true, createdAt: new Date(at) },
    ]);
  }

  function lateOf(prisma: ReturnType<typeof makePrisma>): number {
    const arg = prisma.client.hrAttendance.create.mock.calls[0]?.[0] as {
      data: { lateMinutes: number };
    };
    return arg.data.lateMinutes;
  }

  it('ingest(): siklik jadval 08:00 — 09:10 kelish = 70 daqiqa (hafta-kuni 09:00 EMAS)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00')); // sikl Kun 1
    const prisma = makePrisma({ schedule: CYCLIC });
    keldi(prisma, '2026-07-27T09:10:00+05:00');
    await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
      'acc',
      'emp',
      INSIDE,
    );
    // Eski kod hafta-kuni 09:00 dan hisoblab 10 berardi.
    expect(lateOf(prisma)).toBe(70);
  });

  it('ingest(): siklik jadvalning DAM kunida kechikish 0', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T09:10:00+05:00')); // sikl Kun 3 = dam
    const prisma = makePrisma({ schedule: CYCLIC });
    keldi(prisma, '2026-07-29T09:10:00+05:00');
    await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
      'acc',
      'emp',
      INSIDE,
    );
    expect(lateOf(prisma)).toBe(0);
  });

  it('ingest(): ERKIN jadval hech qachon kech emas', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T15:00:00+05:00'));
    const prisma = makePrisma({ schedule: FREE });
    keldi(prisma, '2026-07-27T15:00:00+05:00');
    await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
      'acc',
      'emp',
      INSIDE,
    );
    expect(lateOf(prisma)).toBe(0);
  });

  it('manualCheckIn(): siklik jadval 08:00 — 09:10 kelish = 70 daqiqa', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00'));
    const prisma = makePrisma({ schedule: CYCLIC });
    const emitter = { emit: vi.fn() };
    await new HrPingIngestService(prisma as never, emitter as never).manualCheckIn(
      'acc',
      'emp',
      INSIDE,
    );
    expect(lateOf(prisma)).toBe(70);
    // Avto-jarima aynan shu raqamdan kelib chiqadi — hodisada ham to'g'ri bo'lsin.
    expect(emitter.emit).toHaveBeenCalledWith(
      'hr.attendance.checked_in',
      expect.objectContaining({ lateMinutes: 70 }),
    );
  });

  it('jadvalsiz xodim hafta-kuni fallback bilan ishlaydi (regressiya yo`q)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00'));
    const prisma = makePrisma(); // schedule = null
    keldi(prisma, '2026-07-27T09:10:00+05:00');
    await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
      'acc',
      'emp',
      INSIDE,
    );
    expect(lateOf(prisma)).toBe(10);
  });

  it('eskirgan `employeeWorkSchedule.findUnique` yo`li UMUMAN chaqirilmaydi', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00'));
    const prisma = makePrisma({ schedule: CYCLIC });
    keldi(prisma, '2026-07-27T09:10:00+05:00');
    await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
      'acc',
      'emp',
      INSIDE,
    );
    expect(prisma.client.employeeWorkSchedule.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * X8 — geofence xodimga BIRIKTIRILGAN hamma ish joyiga solishtiriladi.
 *
 * Ilgari ikkala yo'l ham faqat `emp.workLocationId` ga qarardi: boshqa
 * omborga ish bilan borgan xodim «Keldim» bosganda `outside` olardi va hech
 * qanday yozuv YARATILMASDI — o'sha kun oylik tarixda «kelmadi» bo'lib
 * qolardi. Endi ruxsat etilgan joylardan BIRORTASIGA tushsa `inside`, va
 * yozuvga AYNAN MOS KELGAN joy yoziladi (aks holda menejer paneli xodimni
 * noto'g'ri filialda ko'rsatardi).
 */
describe('X8 — biriktirilgan hamma ish joyi bo`yicha geofence', () => {
  /** Asosiy filial — INSIDE nuqtasi; qo'shimcha filial — OUTSIDE nuqtasi (~4,3 km). */
  const TWO_BRANCHES = [
    { id: 'wl1', lat: 41.311, lng: 69.24, radiusMeters: 150 },
    { id: 'wl-branch', lat: 41.35, lng: 69.24, radiusMeters: 150 },
  ];
  const FAR = { lat: 41.5, lng: 69.9, accuracy: 10 };

  /** Ikkita ketma-ket namuna → KELDI qarori (`ingest` yo'li uchun). */
  function keldi(prisma: ReturnType<typeof makePrisma>) {
    prisma.client.hrLocationPing.findMany.mockResolvedValue([
      { inside: true, createdAt: new Date() },
      { inside: true, createdAt: new Date() },
    ]);
  }

  function createdData(prisma: ReturnType<typeof makePrisma>) {
    return (
      prisma.client.hrAttendance.create.mock.calls[0]?.[0] as {
        data: { workLocationId: string | null };
      }
    ).data;
  }

  describe('manualCheckIn («Keldim» tugmasi)', () => {
    it('🟢 QO`SHIMCHA filialda «Keldim» ishlaydi va yozuvga O`SHA filial yoziladi', async () => {
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      const r = await new HrPingIngestService(
        prisma as never,
        { emit: vi.fn() } as never,
      ).manualCheckIn('acc', 'emp', OUTSIDE); // = wl-branch koordinatasi

      expect(r).toMatchObject({ ok: true, reason: null, status: 'at_work' });
      // 🔴 Asosiy filial (`wl1`) EMAS — aynan kirilgan joy.
      expect(createdData(prisma).workLocationId).toBe('wl-branch');
    });

    it('asosiy filialda yozuv asosiy filialga yoziladi (regressiya yo`q)', async () => {
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).manualCheckIn(
        'acc',
        'emp',
        INSIDE,
      );
      expect(createdData(prisma).workLocationId).toBe('wl1');
    });

    it('birorta ham ruxsat etilgan joyga tushmasa — `outside` (xulq o`zgarmadi)', async () => {
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      const r = await new HrPingIngestService(
        prisma as never,
        { emit: vi.fn() } as never,
      ).manualCheckIn('acc', 'emp', FAR);

      expect(r).toMatchObject({ ok: false, reason: 'outside' });
      expect(prisma.client.hrAttendance.create).not.toHaveBeenCalled();
      expect(prisma.client.hrLocationPing.create).not.toHaveBeenCalled();
    });

    it('biriktirilgan joy YO`Q (yoki hammasi arxivlangan) — `no_location`', async () => {
      const prisma = makePrisma({ locations: [] });
      const r = await new HrPingIngestService(
        prisma as never,
        { emit: vi.fn() } as never,
      ).manualCheckIn('acc', 'emp', INSIDE);

      expect(r).toMatchObject({ ok: false, reason: 'no_location' });
      expect(prisma.client.hrAttendance.create).not.toHaveBeenCalled();
    });

    it('so`rov akkaunt + xodim bilan chegaralangan (asosiy filial + biriktiruv)', async () => {
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).manualCheckIn(
        'acc',
        'emp',
        INSIDE,
      );
      const where = (
        prisma.client.hrWorkLocation.findMany.mock.calls[0]?.[0] as {
          where: { accountId: string; archived: boolean; OR: unknown[] };
        }
      ).where;
      expect(where.accountId).toBe('acc');
      expect(where.archived).toBe(false);
      expect(where.OR).toEqual([
        { id: 'wl1' },
        { branchEmployees: { some: { employeeId: 'emp', accountId: 'acc' } } },
      ]);
    });
  });

  describe('ingest (avtomatik ping)', () => {
    it('🟢 QO`SHIMCHA filialdagi ping `inside`, KELDI yozuvi O`SHA filialga', async () => {
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      keldi(prisma);
      const r = await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
        'acc',
        'emp',
        OUTSIDE, // = wl-branch koordinatasi
      );

      expect(r).toMatchObject({ accepted: true, inside: true, decision: 'KELDI' });
      expect(createdData(prisma).workLocationId).toBe('wl-branch');
      // Ping ham `inside: true` bo'lib saqlanadi — holat mashinasi shundan o'qiydi.
      const ping = prisma.client.hrLocationPing.create.mock.calls[0]?.[0] as {
        data: { inside: boolean };
      };
      expect(ping.data.inside).toBe(true);
    });

    it('birorta joyga tushmagan ping `inside: false` bo`lib saqlanadi', async () => {
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      const r = await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
        'acc',
        'emp',
        FAR,
      );

      expect(r).toMatchObject({ accepted: true, inside: false });
      const ping = prisma.client.hrLocationPing.create.mock.calls[0]?.[0] as {
        data: { inside: boolean };
      };
      expect(ping.data.inside).toBe(false);
    });

    it('biriktirilgan joy yo`q — `no_location`, ping SAQLANMAYDI', async () => {
      const prisma = makePrisma({ locations: [] });
      const r = await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
        'acc',
        'emp',
        INSIDE,
      );

      expect(r).toMatchObject({ accepted: false, reason: 'no_location' });
      expect(prisma.client.hrLocationPing.create).not.toHaveBeenCalled();
    });

    it('kechikish hisobi joydan MUSTAQIL — qo`shimcha filialda ham o`z smenasi bo`yicha', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-27T09:10:00+05:00'));
      const prisma = makePrisma({ locations: TWO_BRANCHES });
      keldi(prisma);
      await new HrPingIngestService(prisma as never, { emit: vi.fn() } as never).ingest(
        'acc',
        'emp',
        OUTSIDE,
      );
      // Hafta-kuni jadvali 09:00 ⇒ 10 daqiqa; filial almashishi buni o'zgartirmaydi.
      const data = createdData(prisma) as unknown as { lateMinutes: number };
      expect(data.lateMinutes).toBe(10);
    });
  });
});
