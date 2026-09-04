/**
 * S1 (kassa vaqti) — `lib/clock.ts` xulq shartnomasi.
 *
 * Bu yerda qulflanayotgan narsa: kassa mashinasining soati adashgan bo'lsa ham
 * `serverNow()` SERVER vaqtini qaytaradi va bu qiymat sakramaydi, keshdan
 * buzilmaydi, oflayn ko'tarilishda yo'qolmaydi.
 *
 * Modul holati (skew) modul darajasida yashaydi, shuning uchun har test
 * `vi.resetModules()` bilan TOZA nusxa oladi — aks holda testlar bir-birining
 * skew'ini meros qilib olardi va yolg'on-yashil bo'lardi.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Qurilmaning (soati adashgan) vaqti — barcha testlar shundan boshlanadi. */
const DEVICE = new Date('2026-09-04T10:00:00.000Z');

/** Faqat `headers` kerak — `noteServerDate` boshqa hech nimaga tegmaydi. */
function RES(headers: Record<string, string>): Response {
  return { headers: new Headers(headers) } as unknown as Response;
}

/** HTTP `Date` sarlavhasi shakli (RFC 7231) — sekundgacha yaxlitlangan. */
const httpDate = (ms: number): string => new Date(ms).toUTCString();

async function freshClock() {
  vi.resetModules();
  return await import('./clock');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DEVICE);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('serverNow — server vaqti, qurilma soati emas', () => {
  it('skew yo`q holatda qurilma vaqtini qaytaradi (bugungi xulq buzilmaydi)', async () => {
    const clock = await freshClock();
    expect(clock.clockSkewMs()).toBe(0);
    expect(clock.serverNow().getTime()).toBe(DEVICE.getTime());
  });

  it('qurilma soati 3 soat orqada bo`lsa `Date` sarlavhasi uni tuzatadi', async () => {
    const clock = await freshClock();
    const serverMs = DEVICE.getTime() + 3 * 60 * 60 * 1_000;

    clock.noteServerDate(RES({ Date: httpDate(serverMs) }));

    expect(clock.clockSkewMs()).toBe(3 * 60 * 60 * 1_000);
    expect(clock.serverNow().getTime()).toBe(serverMs);
  });

  it('qurilma soati oldinda bo`lsa skew MANFIY bo`ladi', async () => {
    const clock = await freshClock();
    const serverMs = DEVICE.getTime() - 2 * 60 * 60 * 1_000;

    clock.noteServerDate(RES({ Date: httpDate(serverMs) }));

    expect(clock.serverNow().getTime()).toBe(serverMs);
  });

  it('qurilma soati yurganda `serverNow` ham yuradi (qotib qolmaydi)', async () => {
    const clock = await freshClock();
    clock.noteServerDate(RES({ Date: httpDate(DEVICE.getTime() + 3_600_000) }));

    vi.setSystemTime(DEVICE.getTime() + 60_000);

    expect(clock.serverNow().getTime()).toBe(DEVICE.getTime() + 3_600_000 + 60_000);
  });
});

describe('noteServerDate — ishonchsiz manbalarni rad etadi', () => {
  it('`Date` sarlavhasi bo`lmasa skew o`zgarmaydi', async () => {
    const clock = await freshClock();
    clock.noteServerDate(RES({}));
    expect(clock.clockSkewMs()).toBe(0);
  });

  it('`Date` o`qib bo`lmasa skew o`zgarmaydi', async () => {
    const clock = await freshClock();
    clock.noteServerDate(RES({ Date: 'kecha kechqurun' }));
    expect(clock.clockSkewMs()).toBe(0);
  });

  it('🔴 keshlangan javob (`Age` bor) skew`ni ORQAGA tortmaydi', async () => {
    const clock = await freshClock();
    const serverMs = DEVICE.getTime() + 3_600_000;
    clock.noteServerDate(RES({ Date: httpDate(serverMs) }));

    // Keshdan kelgan, 10 daqiqa eskirgan javob.
    clock.noteServerDate(RES({ Date: httpDate(serverMs - 600_000), Age: '600' }));

    expect(clock.serverNow().getTime()).toBe(serverMs);
  });

  it('aqldan tashqari qiymat (10 yildan katta) rad etiladi', async () => {
    const clock = await freshClock();
    const absurd = DEVICE.getTime() + 20 * 365 * 24 * 60 * 60 * 1_000;
    clock.noteServerDate(RES({ Date: httpDate(absurd) }));
    expect(clock.clockSkewMs()).toBe(0);
  });

  it('sarlavhalar o`qilmasa ham OTMAYDI (savdo so`rovi yiqilmasin)', async () => {
    const clock = await freshClock();
    const broken = {
      headers: {
        get() {
          throw new Error('headers yo`q');
        },
      },
    } as unknown as Response;

    expect(() => clock.noteServerDate(broken)).not.toThrow();
    expect(clock.clockSkewMs()).toBe(0);
  });
});

describe('jitter filtri — soat sakramaydi', () => {
  it('1500 ms dan kichik farq YOZILMAYDI', async () => {
    const clock = await freshClock();
    const serverMs = DEVICE.getTime() + 3_600_000;
    clock.noteServerDate(RES({ Date: httpDate(serverMs) }));

    // `Date` sekundgacha yaxlitlangani uchun ketma-ket o'lchov ±1 s tebranadi.
    clock.noteServerDate(RES({ Date: httpDate(serverMs + 1_000) }));

    expect(clock.clockSkewMs()).toBe(3_600_000);
  });

  it('haqiqiy siljish (1500 ms dan katta) yoziladi', async () => {
    const clock = await freshClock();
    clock.noteServerDate(RES({ Date: httpDate(DEVICE.getTime() + 3_600_000) }));
    clock.noteServerDate(RES({ Date: httpDate(DEVICE.getTime() + 3_600_000 + 5_000) }));

    expect(clock.clockSkewMs()).toBe(3_605_000);
  });
});

describe('oflayn davomiylik — `localStorage`', () => {
  it('skew saqlanadi va keyingi ko`tarilishda tiklanadi', async () => {
    const first = await freshClock();
    first.noteServerDate(RES({ Date: httpDate(DEVICE.getTime() + 3_600_000) }));
    expect(first.clockSkewMs()).toBe(3_600_000);

    // Qurilma qayta yuklandi (yangi modul nusxasi), tarmoq esa yo'q —
    // hech qanday `Date` sarlavhasi kelmaydi.
    const afterReboot = await freshClock();

    expect(afterReboot.clockSkewMs()).toBe(3_600_000);
    expect(afterReboot.serverNow().getTime()).toBe(DEVICE.getTime() + 3_600_000);
  });

  it('buzilgan saqlangan qiymat e`tiborsiz qoldiriladi', async () => {
    window.localStorage.setItem('pos.clock.skew-ms', 'yo`q');
    const clock = await freshClock();
    expect(clock.clockSkewMs()).toBe(0);
  });

  it('hech qachon ulanmagan qurilmada skew 0 (regressiya emas)', async () => {
    const clock = await freshClock();
    expect(clock.serverNow().getTime()).toBe(DEVICE.getTime());
  });
});

describe('POS_TZ', () => {
  it('kassa mintaqasi qat`iy `Asia/Tashkent`', async () => {
    const clock = await freshClock();
    expect(clock.POS_TZ).toBe('Asia/Tashkent');
  });
});
