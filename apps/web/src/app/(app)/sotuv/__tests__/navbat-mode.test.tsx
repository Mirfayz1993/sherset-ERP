/**
 * F4 (POS redizayn, 2026-08-14) — «Navbat» rejimi: ikki ustunli kanban
 * (spec §5.2, Q3). Qulflanadigan shartnomalar:
 *
 *  · ikki ustun bir VAQTDA ko'rinadi: chapda «Yig'ilmoqda» (picking),
 *    o'ngda «Tayyor» (ready) — eski ikki alohida tab niyati F2 da «Navbat»
 *    rejimiga birlashgan, F4 esa ularni kanban qildi;
 *  · «To'lash» tugmasi FAQAT tayyor kartada (server `post()` faqat `ready`
 *    dan qabul qiladi — yig'ilmagan chekka to'lov tugmasi yolg'on va'da);
 *    (F9, 2026-08-15: yorliq «To'lov»→«To'lash» — reja «TO'LASH» degan edi,
 *    F4 kosmetik deb qoldirgan, egasi F9'da almashtirishni tanladi);
 *  · «Tasdiqlash» (kassir o'zi ready qiladi, egasi 2026-08-11) FAQAT
 *    yig'ilmoqda kartada QOLADI — F4 bu yo'lni olib tashlamaydi;
 *  · bekor qilish tasdig'ida chek RAQAMI ham, SUMMASI ham ko'rinadi
 *    (kassir qaysi chekni o'chirayotganini ko'rib tursin) va tasdiq
 *    mavjud `cancel` endpointiga boradi;
 *  · kartada mijoz ismi va o'tgan vaqt ko'rinadi (spec §5.2 karta tarkibi).
 */

import { api } from '@/lib/api-client';
import { noteServerDate } from '@/lib/clock';
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { SALE_ROW, norm, router, salesRoutes } from './harness';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/auth-store', () => ({
  isKioskUser: () => false,
  useAuth: () => ({
    user: { id: 'u-1', name: 'Kassir Aliyev' },
    accessToken: 't',
    initialized: true,
  }),
  getAccessToken: () => 't',
  refresh: async () => false,
}));

vi.mock('@/lib/print-agent', () => ({
  hasNativePrinting: vi.fn(() => false),
  fetchAgentPrinters: vi.fn(async () => []),
  printReceiptViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
  printPickingViaAgent: vi.fn(async () => ({ handled: true, printed: 1, skipped: 0, errors: 0 })),
  printZReportViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
}));

/**
 * Yig'ilmoqda chek — moment YAQIN o'tmishda (5 daqiqa): «o'tgan vaqt»
 * ko'rsatkichi deterministik assert qilinsin (fixture'dagi qotgan sana
 * bilan «N kun» chiqib, test hech narsani isbotlamasdi).
 */
function PICKING_ROW() {
  return SALE_ROW({
    id: 's-p1',
    name: 'CHEK-00002',
    state: 'picking',
    sumMinor: '500000',
    agent: { id: 'cp-1', name: 'Usta Vali' },
    moment: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
}

function navbatRoutes() {
  return salesRoutes([
    { match: /^\/retail-sales\?.*state=ready/, value: { items: [SALE_ROW()] } },
    { match: /^\/retail-sales\?.*state=picking/, value: { items: [PICKING_ROW()] } },
  ]);
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(navbatRoutes()));
  vi.mocked(api.post).mockResolvedValue({});
});

async function openNavbat(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<SotuvPage />);
  await user.click(await screen.findByRole('button', { name: 'Navbat' }));
  const picking = await screen.findByTestId('navbat-col-picking');
  const ready = screen.getByTestId('navbat-col-ready');
  return { picking, ready };
}

describe('NavbatMode — ikki ustunli kanban (F4)', () => {
  it('ikki ustun bir vaqtda: chapda yig‘ilmoqda, o‘ngda tayyor kartalar', async () => {
    const user = userEvent.setup();
    const { picking, ready } = await openNavbat(user);

    expect(await within(picking).findByText('CHEK-00002')).toBeInTheDocument();
    expect(await within(ready).findByText('CHEK-00001')).toBeInTheDocument();
    // Karta o'z ustunidan tashqarida TAKRORLANMAYDI.
    expect(within(picking).queryByText('CHEK-00001')).not.toBeInTheDocument();
    expect(within(ready).queryByText('CHEK-00002')).not.toBeInTheDocument();
  });

  it('kartada summa · mijoz · o‘tgan vaqt ko‘rinadi', async () => {
    const user = userEvent.setup();
    const { picking } = await openNavbat(user);

    const card = (await within(picking).findByText('CHEK-00002')).closest(
      '[data-test-id="navbat-card"]',
    ) as HTMLElement;
    expect(card).not.toBeNull();
    expect(norm(card.textContent)).toContain('5 000,00');
    expect(norm(card.textContent)).toContain('Usta Vali');
    expect(norm(card.textContent)).toContain('5 daq');
  });

  it('«To‘lov» FAQAT tayyor kartada; yig‘ilmoqdada «Tasdiqlash» qoladi', async () => {
    const user = userEvent.setup();
    const { picking, ready } = await openNavbat(user);
    await within(ready).findByText('CHEK-00001');

    expect(within(ready).getByRole('button', { name: /To.lash/ })).toBeInTheDocument();
    expect(within(picking).queryByRole('button', { name: /To.lash/ })).not.toBeInTheDocument();
    // Egasi 2026-08-11 yo'li: kassir yig'ilmoqda chekni o'zi «Tayyor» qila oladi.
    expect(within(picking).getByRole('button', { name: 'Tasdiqlash' })).toBeInTheDocument();
    expect(within(ready).queryByRole('button', { name: 'Tasdiqlash' })).not.toBeInTheDocument();
  });

  it('bekor tasdig‘ida chek raqami VA summasi; tasdiq mavjud cancel yo‘liga boradi', async () => {
    const user = userEvent.setup();
    const { ready } = await openNavbat(user);
    await within(ready).findByText('CHEK-00001');

    await user.click(within(ready).getByRole('button', { name: 'Bekor qilish' }));
    const dialog = await screen.findByRole('dialog');
    expect(norm(dialog.textContent)).toContain('CHEK-00001');
    expect(norm(dialog.textContent)).toContain('20 000,00');

    // Tasdiq tugmasi kartadagi «Bekor qilish»dan FARQLI nomlanadi — bitta
    // dialogda ikki bir xil «Bekor qilish» kassirni adashtirardi.
    await user.click(within(dialog).getByRole('button', { name: 'Chekni bekor qilish' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/retail-sales/s-1/cancel', {}));
  });

  it('bo‘sh ustun o‘z bo‘sh-holat matnini ko‘rsatadi (ikkinchisi yashirilmaydi)', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        salesRoutes([{ match: /^\/retail-sales\?.*state=ready/, value: { items: [SALE_ROW()] } }]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await user.click(await screen.findByRole('button', { name: 'Navbat' }));

    const picking = await screen.findByTestId('navbat-col-picking');
    const ready = screen.getByTestId('navbat-col-ready');
    expect(await within(picking).findByText("Hozircha jarayonda savdo yo'q")).toBeInTheDocument();
    expect(await within(ready).findByText('CHEK-00001')).toBeInTheDocument();
  });
});

/**
 * S3 (kassa vaqti) — «O'TGAN VAQT» IKKI UCHI HAM SERVERNIKI.
 *
 * Bu kartadagi eng nozik hisob: `sale.moment` SERVERdan keladi, `now` esa
 * ilgari QURILMAdan olinardi. Ikki manba ayirmasi kassa soati adashgan qadar
 * xato berardi — «hozirgina» yig'ilgan chek «3 soat» bo'lib turardi va kassir
 * mijozga shu raqamni aytardi. Skew qo'yilgach ikkala uch ham server vaqti.
 */
describe('NavbatMode — «o`tgan vaqt» server soatida (S3)', () => {
  afterEach(() => {
    // Skew modul darajasida yashaydi — keyingi testlarga oqib ketmasin.
    noteServerDate({ headers: new Headers({ Date: new Date().toUTCString() }) } as Response);
    window.localStorage.clear();
  });

  it('qurilma soati 3 soat OLDINDA bo`lsa ham «5 daq» chiqadi, «3 soat» EMAS', async () => {
    // Server qurilmadan 3 soat orqada. `Date` sarlavhasi sekundgacha
    // yaxlitlanadi, shuning uchun `moment` AYNAN o'sha yaxlitlangan qiymatdan
    // sanaladi — aks holda test chegarada 4/5 daqiqa orasida tebranardi.
    const header = new Date(Date.now() - 3 * 60 * 60 * 1_000).toUTCString();
    const serverMs = Date.parse(header);
    noteServerDate({ headers: new Headers({ Date: header }) } as Response);

    vi.mocked(api.get).mockImplementation(
      router(
        salesRoutes([
          { match: /^\/retail-sales\?.*state=ready/, value: { items: [] } },
          {
            match: /^\/retail-sales\?.*state=picking/,
            value: {
              items: [
                SALE_ROW({
                  id: 's-skew',
                  name: 'CHEK-00009',
                  state: 'picking',
                  agent: null,
                  // Server vaqtida 5 daqiqa oldin yig'ila boshlagan.
                  moment: new Date(serverMs - 5 * 60_000).toISOString(),
                }),
              ],
            },
          },
        ]),
      ),
    );

    const user = userEvent.setup();
    const { picking } = await openNavbat(user);
    const card = (await within(picking).findByText('CHEK-00009')).closest(
      '[data-test-id="navbat-card"]',
    ) as HTMLElement;

    expect(norm(card.textContent)).toContain('5 daq');
    // 🔴 Tuzatishdan OLDIN aynan shu chiqardi: «3 soat 5 daq».
    expect(norm(card.textContent)).not.toContain('soat');
  });
});
