import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ruMessages from '../../../messages/ru.json' with { type: 'json' };
import uzMessages from '../../../messages/uz.json' with { type: 'json' };
import { renderWithProviders as render } from '../../../test-utils';
import { MediaLayer, QueuePanel, splitDocNo } from '../page';

/**
 * Mijoz-ekran navbati (2026-09-01, egasining talabi).
 *
 * Bu testlar ikki narsani QULFLAYDI — ikkalasi ham egasining aniq qarori va
 * ikkalasi ham jimgina buzilishi mumkin:
 *
 *   1. Navbat kartasida SUMMA ko'rsatilmaydi. Ekran zalda turadi; yonidagi
 *      odam kimning qancha pul sarflaganini ko'rmasligi kerak. Kassirning
 *      `navbat-mode.tsx` ekranida summa BOR — kimdir «bir xil qilaylik» deb
 *      uni bu yerga ko'chirib qo'yishi oson.
 *   2. TAYYOR kartalar YIG'ILAYOTGANlardan oldin turadi. Mijoz ekranga aynan
 *      «tayyormi?» degan savol bilan qaraydi; tartib teskari bo'lsa u o'z
 *      buyurtmasini ro'yxat oxiridan qidiradi.
 */

const PICKING = [
  { id: 'p1', name: 'TRN-2026-02494' },
  { id: 'p2', name: 'TRN-2026-02496' },
];
const READY = [{ id: 'r1', name: 'TRN-2026-02491' }];

describe('splitDocNo — chek raqamini ajratish', () => {
  it("oxirgi bo'g'inni «dum» qilib ajratadi", () => {
    expect(splitDocNo('TRN-2026-02494')).toEqual({ prefix: 'TRN-2026-', tail: '02494' });
  });

  it("ajratgich yo'q bo'lsa butun satr dum bo'lib qoladi", () => {
    // Hech narsa YO'QOLMASLIGI kerak — raqam mijozning yagona identifikatori.
    expect(splitDocNo('02494')).toEqual({ prefix: '', tail: '02494' });
  });

  it("chiziq oxirida bo'lsa ham satr yo'qolmaydi", () => {
    expect(splitDocNo('TRN-')).toEqual({ prefix: '', tail: 'TRN-' });
  });
});

describe('QueuePanel', () => {
  it("navbat bo'sh bo'lsa umuman chizilmaydi", () => {
    // Bo'sh sarlavha ham, ajratuvchi chiziq ham qolmasligi kerak — savat
    // butun balandlikni olsin. (Konteynerning o'zi bo'sh EMAS: `render`
    // toast/confirm provider'larini ham chizadi — shuning uchun tekshiruv
    // panelning O'Z elementlari bo'yicha.)
    render(<QueuePanel picking={[]} ready={[]} parked={[]} />);
    expect(screen.queryAllByTestId('cfd-queue-card')).toHaveLength(0);
    expect(screen.queryByText(uzMessages.pages.customer_display.queue_title)).toBeNull();
  });

  it('tayyor va yig’ilayotgan buyurtmalarni ko’rsatadi', () => {
    render(<QueuePanel picking={PICKING} ready={READY} parked={[]} />);
    const cards = screen.getAllByTestId('cfd-queue-card');
    expect(cards).toHaveLength(3);
  });

  it('TAYYOR kartalar birinchi turadi', () => {
    render(<QueuePanel picking={PICKING} ready={READY} parked={[]} />);
    const states = screen.getAllByTestId('cfd-queue-card').map((el) => el.dataset.state);
    expect(states).toEqual(['ready', 'picking', 'picking']);
  });

  it('🔴 kartada SUMMA ko’rsatilmaydi', () => {
    render(<QueuePanel picking={PICKING} ready={READY} parked={[]} />);
    for (const card of screen.getAllByTestId('cfd-queue-card')) {
      const text = card.textContent ?? '';
      // Pul birligi yoki ming-ajratgichli raqam = summa sizib chiqqan.
      expect(text).not.toMatch(/so'm|сум|UZS/i);
      expect(text).not.toMatch(/\d[\s ]\d{3}/);
    }
  });
});

describe('QueuePanel — «otlojit» (qoralama) kartalari', () => {
  // 2026-09-01: egasi «otlojit qildim, ekranda chiqmadi» dedi — qoralama
  // serverga bormaydi (localStorage'da), navbat so'rovlari uni ko'rmasdi.
  // Endi parked prop orqali keladi. Bu testlar o'sha xulqni QULFLAYDI.
  const AT = new Date(2026, 8, 1, 5, 1).getTime(); // 05:01

  it('qoralama kartasi park VAQTI bilan chiqadi', () => {
    render(<QueuePanel picking={[]} ready={[]} parked={[AT]} />);
    const cards = screen.getAllByTestId('cfd-queue-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.dataset.state).toBe('hold');
    expect(cards[0]?.textContent).toContain('05:01');
  });

  it("tartib: TAYYOR → yig'ilyapti → qoralama", () => {
    render(<QueuePanel picking={PICKING} ready={READY} parked={[AT]} />);
    const states = screen.getAllByTestId('cfd-queue-card').map((el) => el.dataset.state);
    expect(states).toEqual(['ready', 'picking', 'picking', 'hold']);
  });

  it('🔴 qoralama kartasida ham SUMMA yo’q', () => {
    render(<QueuePanel picking={[]} ready={[]} parked={[AT]} />);
    const text = screen.getAllByTestId('cfd-queue-card')[0]?.textContent ?? '';
    expect(text).not.toMatch(/so'm|сум|UZS/i);
    expect(text).not.toMatch(/\d[\s ]\d{3}/);
  });
});

describe('i18n — mijoz-ekran kalitlari', () => {
  // Ekran ikki tilda ishlaydi (egasi: «tilni kassir tanlaydi»). Kalit bir
  // tilda yetishmasa next-intl render paytida otiladi va mijoz-ekran OQ
  // bo'lib qoladi — shuning uchun ikkala bandl ham tekshiriladi.
  const KEYS = [
    'cart_empty',
    'discount',
    'items_count',
    'queue_hold',
    'queue_picking',
    'queue_ready',
    'queue_title',
    'total',
    'welcome',
  ];

  it.each([
    ['uz', uzMessages.pages.customer_display],
    ['ru', ruMessages.pages.customer_display],
  ] as const)('%s bandlida barcha kalitlar bor', (lang, ns) => {
    const bag: Record<string, string> = ns;
    for (const key of KEYS) {
      expect(bag[key], `${lang}: ${key}`).toBeTruthy();
    }
  });
});

/**
 * MEDIA — rolik KESILMASLIGI qulflandi (egasi, 2026-09-01: «videolar katta,
 * mahsulotlar videolari to'liq ko'rinmayapti»).
 *
 * Nega qo'riqchi kerak: barcha mahsulot roliklari 1280x720 (16:9), media
 * qutisi esa 960x~734 (~4:3). `objectFit: cover` da rolik balandlikka
 * to'ladi va enidan 26.4% KESILADI — mahsulotning chap/o'ng chekkalari,
 * izoh matnlari va spetsifikatsiya jadvali ekranga tushmaydi. Bu jimgina
 * qaytishi juda oson: `cover` «media chetlarigacha to'lsin» degan eski
 * talabga (u ham egasiniki) mos ko'rinadi va bir so'z bilan almashadi.
 *
 * Shu fayl tarixida layout regressiyasi allaqachon bir marta jonli
 * televizorga chiqqan (`docs/ops/2026-09-01-deploy-cfd-layout-fix.md`) —
 * shuning uchun bu yerda ko'rinish qarori testda turadi, izohda emas.
 */
describe('MediaLayer — rolik kesilmaydi', () => {
  const noop = () => {};
  const props = {
    pid: 'p-1',
    name: 'Termoregulyator',
    on: true,
    active: true,
    onReady: noop,
    onVideoMeta: noop,
    onVideoError: noop,
    onEnded: noop,
  };

  it('🔴 mahsulot roligi `contain` bilan chiziladi — `cover` EMAS', () => {
    const { container } = render(<MediaLayer {...props} imageUrl={null} state={undefined} />);
    const video = container.querySelector<HTMLVideoElement>('video[src="/media/videos/p-1.mp4"]');
    expect(video, 'mahsulot roligi chizilmadi').not.toBeNull();
    expect(video?.style.objectFit).toBe('contain');
  });

  it('🔴 brend-rolik ham `contain` — SHERSET yozuvining chetlari kesilmasin', () => {
    // Rolik yo'q (`state: 'no'`) va rasm ham yo'q ⇒ zanjirning oxirgi bo'g'ini.
    const { container } = render(<MediaLayer {...props} imageUrl={null} state="no" />);
    const video = container.querySelector<HTMLVideoElement>('video[src="/brand/sherset-loop.mp4"]');
    expect(video, 'brend-rolik chizilmadi').not.toBeNull();
    expect(video?.style.objectFit).toBe('contain');
  });

  it('rasm zanjirda roliksiz holatda ishlatiladi va u ham `contain`', () => {
    const { container } = render(
      <MediaLayer {...props} imageUrl="https://example.test/a.jpg" state="no" />,
    );
    const img = container.querySelector<HTMLImageElement>('img');
    expect(img?.style.objectFit).toBe('contain');
  });
});
