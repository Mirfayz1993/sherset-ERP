/**
 * F2 (POS redizayn) — 64px ko'k header (spec §3.1).
 *
 * Qulflanayotgan shartnomalar:
 *  · SHERSET matn-logotipi ko'rinadi (public/ da tayyor asset yo'q — tekshirildi);
 *  · smena-chip: kassir ismi + smena yoshi + savdo soni·summasi;
 *  · `stale` da chip sariq holatga o'tadi (`data-stale` bayrog'i);
 *  · `connectionOk=false` da qizil indikator + «aloqa yo'q» matni;
 *  · o'ng chetdagi `children` sloti chiziladi (F6 oyna-tugmalari shu yerga);
 *  · header `position: fixed` EMAS (desktop klaviatura-evristikasi buzilmasin).
 *
 * Soat ILGARI assert qilinmasdi («minutlik interval real vaqtga bog'liq,
 * flaky bo'lardi»). S1 dan keyin u SERVER vaqtidan o'qiladi — ya'ni testda
 * to'liq deterministik va soxta soat + soxta `Date` sarlavhasi bilan
 * qulflanadi (fayl oxiridagi blok).
 */

import { noteServerDate } from '@/lib/clock';
import ruMessages from '@/messages/ru.json' with { type: 'json' };
import { renderWithProviders, screen, waitFor, within } from '@/test-utils';
import type { CurrentSession } from '@moysklad/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosHeader, type PosHeaderProps } from '../pos-header';

function SESSION(over: Partial<CurrentSession> = {}): CurrentSession {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    state: 'open',
    openedAt: '2026-08-09T04:00:00.000Z',
    cashier: { id: 'u-1', name: 'Kassir Aliyev' },
    cashDesk: { id: 'cd-1', name: 'Asosiy kassa', currency: 'UZS' },
    store: { id: 'st-1', name: 'Markaziy do‘kon' },
    organization: { id: 'o-1', name: 'Sherset MChJ' },
    salesCount: 3,
    salesSumMinor: '150000',
    openingCashMinor: '0',
    openMinutes: 180,
    staleWarnHours: 12,
    stale: false,
    ...over,
  } as CurrentSession;
}

/** `formatMoney` ming ajratgichi — uzilmas bo'shliq; taqqoslashda normallashtiriladi. */
const norm = (s: string | null | undefined) => (s ?? '').replace(/[   ]/g, ' ');

function renderHeader(over: Partial<PosHeaderProps> = {}, children?: React.ReactNode) {
  const props: PosHeaderProps = {
    session: SESSION(),
    shiftAge: '3 soat',
    connectionOk: true,
    ...over,
  };
  renderWithProviders(<PosHeader {...props}>{children}</PosHeader>);
  return props;
}

describe('PosHeader — logotip va smena-chip', () => {
  it('SHERSET matn-logotipi ko‘rinadi', () => {
    renderHeader();
    expect(screen.getByTestId('pos-header-logo')).toHaveTextContent('SHERSET');
  });

  it('smena-chip: kassir ismi, yoshi va savdo jami', () => {
    renderHeader();
    const chip = screen.getByTestId('pos-header-shift-chip');
    expect(within(chip).getByText('Kassir Aliyev')).toBeInTheDocument();
    expect(norm(chip.textContent)).toContain('3 soat');
    // «savdo» so'zi ATAYLAB: smena-mode'dagi «3 ta · …» yozuvi bilan matn
    // to'qnashmasin — MK32 testi uni `getByText(/3 ta ·/)` bilan yakka topadi.
    expect(norm(chip.textContent)).toContain('3 ta savdo · 1 500,00 сум');
  });

  it('`stale` da chip sariq holatga o‘tadi', () => {
    renderHeader({ session: SESSION({ stale: true }) });
    expect(screen.getByTestId('pos-header-shift-chip')).toHaveAttribute('data-stale', 'true');
  });

  it('yangi smenada chip sariq EMAS', () => {
    renderHeader();
    expect(screen.getByTestId('pos-header-shift-chip')).toHaveAttribute('data-stale', 'false');
  });
});

describe('PosHeader — aloqa indikatori', () => {
  it('`connectionOk=false` da qizil holat + «aloqa yo‘q» matni', () => {
    renderHeader({ connectionOk: false });
    const ind = screen.getByTestId('pos-header-conn');
    expect(ind).toHaveAttribute('data-ok', 'false');
    expect(screen.getByText("Server bilan aloqa yo'q")).toBeInTheDocument();
  });

  it('aloqa bor holatda «aloqa yo‘q» matni chizilmaydi', () => {
    renderHeader({ connectionOk: true });
    expect(screen.getByTestId('pos-header-conn')).toHaveAttribute('data-ok', 'true');
    expect(screen.queryByText("Server bilan aloqa yo'q")).not.toBeInTheDocument();
  });
});

describe('PosHeader — qobiq shartnomalari', () => {
  it('o‘ng chetdagi children sloti chiziladi (F6 oyna-tugmalari joyi)', () => {
    renderHeader({}, <button type="button" data-test-id="f6-slot-probe" />);
    expect(screen.getByTestId('f6-slot-probe')).toBeInTheDocument();
  });

  it('header `position: fixed` ishlatmaydi (klaviatura-evristika sharti)', () => {
    renderHeader();
    const header = screen.getByTestId('pos-header');
    expect(header.className).not.toMatch(/(^|\s)fixed(\s|$)/);
    expect(header.style.position).not.toBe('fixed');
  });
});

// F9 (2026-08-15) — spec §3.1: versiya-badge endi headerning O'ZIDA
// (F2/F6 chala-ishi yopildi; sahifadagi suzuvchi nusxa olib tashlangan).
describe('PosHeader — versiya-badge headerda (F9, spec §3.1)', () => {
  afterEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('qobiqda badge header ICHIDA chiziladi (fixed emas)', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      isSherset: true,
      version: '1.8.0',
    };
    renderHeader();
    const header = screen.getByTestId('pos-header');
    await waitFor(() =>
      expect(within(header).getByTestId('shell-version-badge')).toBeInTheDocument(),
    );
    expect(within(header).getByTestId('shell-version-badge').className).not.toMatch(
      /(^|\s)fixed(\s|$)/,
    );
  });

  it('brauzerda (qobiqsiz) headerda badge yo`q — joy band qilinmaydi', () => {
    renderHeader();
    expect(screen.queryByTestId('shell-version-badge')).not.toBeInTheDocument();
  });
});

// S1 (2026-09-04) — egasining shikoyati: «kassada vaqt qurilma vaqti bilan
// ishlayapti va qurilmada vaqt xato bo'lsa xato ko'rsatmoqda».
describe('PosHeader — soat SERVER vaqtida (S1)', () => {
  /** Kassa mashinasining ADASHGAN soati. */
  const DEVICE = new Date('2026-09-04T10:00:00.000Z');
  /** Serverning to'g'ri soati — qurilmadan 3 soat oldinda. */
  const SERVER_MS = DEVICE.getTime() + 3 * 60 * 60 * 1_000;

  afterEach(() => {
    // Skew modul darajasida yashaydi — keyingi testlarga oqib ketmasin.
    noteServerDate({ headers: new Headers({ Date: new Date().toUTCString() }) } as Response);
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('qurilma soati 3 soat orqada bo`lsa ham server soatini ko`rsatadi', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    noteServerDate({
      headers: new Headers({ Date: new Date(SERVER_MS).toUTCString() }),
    } as Response);

    renderHeader();

    // 13:00 UTC = 18:00 Asia/Tashkent. Qurilma vaqti bo'lganda 15:00 chiqardi.
    expect(screen.getByTestId('pos-header-clock')).toHaveTextContent('18:00');
    expect(screen.getByTestId('pos-header-clock')).not.toHaveTextContent('15:00');
  });

  it('qurilmaning MINTAQASI ham so`ralmaydi (`Asia/Tashkent` qat`iy)', () => {
    vi.useFakeTimers();
    // Skew yo'q — faqat mintaqa tekshiriladi: 23:30 UTC = ertasi kun 04:30
    // Toshkentda. Sinov mashinasining TZ'i qanday bo'lishidan qat'i nazar.
    vi.setSystemTime(new Date('2026-09-04T23:30:00.000Z'));

    renderHeader();

    expect(screen.getByTestId('pos-header-clock')).toHaveTextContent('04:30');
  });
});

// S5 (2026-09-04) — ogohlantirish chipi. S1–S4 dan keyin kassa buzuq soatga
// dasturiy jihatdan immunitetli, LEKIN buzuq mashina jim qolardi: hech kim
// uni tuzatmasdi. Chip uni ko'rinadigan qiladi.
describe('PosHeader — qurilma soati ogohlantirishi (S5)', () => {
  const DEVICE = new Date('2026-09-04T10:00:00.000Z');
  const MIN = 60_000;

  /** Skew'ni ANIQ qiymatga qo'yadi (musbat = qurilma orqada). */
  function setSkew(ms: number) {
    noteServerDate({
      headers: new Headers({ Date: new Date(DEVICE.getTime() + ms).toUTCString() }),
    } as Response);
  }

  afterEach(() => {
    // Skew modul darajasida yashaydi — keyingi testlarga oqib ketmasin.
    noteServerDate({ headers: new Headers({ Date: new Date().toUTCString() }) } as Response);
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('chegara OSTIDA chip chizilmaydi (soat ishonchli — shovqin qilinmaydi)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    setSkew(90_000); // 1,5 daqiqa — 2 daqiqalik chegaradan past

    renderHeader();

    expect(screen.queryByTestId('pos-header-clock-chip')).not.toBeInTheDocument();
  });

  it('soati IDEAL mashinada ham chip yo`q (o`lchandi, skew = 0)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    setSkew(0);

    renderHeader();

    expect(screen.queryByTestId('pos-header-clock-chip')).not.toBeInTheDocument();
    // Ammo soat baribir chiziladi — «o'lchandi» holati.
    expect(screen.getByTestId('pos-header-clock')).toHaveTextContent('15:00');
  });

  it('chegara USTIDA sariq chip + YO`NALISH: qurilma orqada', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    setSkew(5 * MIN);

    renderHeader();

    const chip = screen.getByTestId('pos-header-clock-chip');
    expect(chip).toHaveAttribute('data-state', 'behind');
    expect(chip).toHaveTextContent('Qurilma vaqti ~5 daqiqa orqada');
    // Sariq — smena-chipning `stale` uslubi; yangi rang tizimi yo'q.
    expect(chip.className).toContain('bg-amber-400');
  });

  it('qurilma OLDINDA bo`lsa yo`nalish teskari yoziladi', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    setSkew(-7 * MIN);

    renderHeader();

    const chip = screen.getByTestId('pos-header-clock-chip');
    expect(chip).toHaveAttribute('data-state', 'ahead');
    expect(chip).toHaveTextContent('Qurilma vaqti ~7 daqiqa oldinda');
  });

  it('katta farq SOATLARDA yoziladi («180 daqiqa» emas — mintaqa/RTC belgisi)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    setSkew(3 * 60 * MIN); // jonli smoke stsenariysi: soat 3 soatga siljitilgan

    renderHeader();

    const chip = screen.getByTestId('pos-header-clock-chip');
    expect(chip).toHaveTextContent('Qurilma vaqti ~3 soat orqada');
    expect(chip).not.toHaveTextContent('180');
  });

  it('ru tilida ham chiqadi (i18n ikki til — `pnpm i18n:gate` sharti)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE);
    setSkew(5 * MIN);

    renderWithProviders(<PosHeader session={SESSION()} shiftAge="3 soat" connectionOk={true} />, {
      messages: ruMessages as Record<string, unknown>,
    });

    expect(screen.getByTestId('pos-header-clock-chip')).toHaveTextContent(
      'Время устройства отстаёт на ~5 мин',
    );
  });
});

// 🔴 O'LCHANMAGAN holat — S5 ning eng nozik qarori.
// `clockSkewMs()` hech qachon ulanmagan mashinada ham `0` qaytaradi, ya'ni
// «chegara ostida = jim» qoidasi uni «hammasi joyida» qilib ko'rsatardi
// (YOLG'ON YASHIL). Chip S1/S3 tamoyiliga bo'ysunadi: o'lchanmagan qiymat
// ishonchli deb chizilmaydi.
//
// Skew modul darajasida yashaydi, shuning uchun bu blok `vi.resetModules()`
// bilan TOZA nusxa oladi (`lib/clock.test.ts` naqshi) — yuqoridagi testlar
// modulni allaqachon «o'lchangan» holatga qo'ygan.
describe('PosHeader — skew hali O`LCHANMAGAN (S5)', () => {
  afterEach(() => {
    vi.doUnmock('@/hooks/use-server-clock');
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('hech qachon ulanmagan mashinada NEYTRAL «tekshirilmadi» chizadi, sariq EMAS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:00:00.000Z'));
    window.localStorage.clear();
    // 🔴 Tarmoq YOPILADI. Stsenariy aynan «server bilan hech gaplashmagan
    // qurilma», header ichidagi `PosRateChip` esa haqiqiy `authedFetch`
    // qiladi — javob kelsa `noteServerDate` skew'ni O'LCHANGAN qilib
    // qo'yardi va test o'z stsenariysini yo'qotardi. (Lokal mashinada port
    // bo'sh bo'lgani uchun so'rov o'zi yiqilardi va bu yashirin qolgan edi;
    // serverda o'sha portda BOSHQA ilova javob berib testni qizartirdi.)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('tarmoq yo`q'))),
    );
    vi.resetModules();
    const { PosHeader: FreshHeader } = await import('../pos-header');

    renderWithProviders(<FreshHeader session={SESSION()} shiftAge="3 soat" connectionOk={false} />);

    const chip = screen.getByTestId('pos-header-clock-chip');
    expect(chip).toHaveAttribute('data-state', 'unverified');
    expect(chip).toHaveTextContent('Vaqt tekshirilmadi');
    expect(chip.className).not.toContain('bg-amber-400');
  });

  it('mount`gacha (soat hali yo`q) chip UMUMAN chizilmaydi', async () => {
    vi.resetModules();
    // `useServerClock` mount'gacha `null` qaytaradi (S1 qarori) — o'sha kadr.
    vi.doMock('@/hooks/use-server-clock', () => ({ useServerClock: () => null }));
    const { PosHeader: PendingHeader } = await import('../pos-header');

    renderWithProviders(
      <PendingHeader session={SESSION()} shiftAge="3 soat" connectionOk={true} />,
    );

    expect(screen.getByTestId('pos-header-clock')).toHaveTextContent('');
    expect(screen.queryByTestId('pos-header-clock-chip')).not.toBeInTheDocument();
  });
});
