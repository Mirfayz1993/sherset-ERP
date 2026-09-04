/**
 * MK32 — `SalesScreen` savat + chegirma xarakteristik testlari
 * (kassa TZ §5.1/§5.2/§5.3, §11, §13.1).
 *
 * **Xulq O'ZGARTIRILMAYDI** — bu testlar hozirgi ekran nima qilayotganini
 * qulflaydi, shundan keyingina (MK33) fayl uch komponentga bo'linadi.
 *
 * Qamrov: setka · savatga qo'shish/takrorlash · qator-tahrir oynasi (miqdor/
 * narx/o'chirish) · tozalash · narx tasmalari (ZARAR / optomdan past) · tan narx
 * YO'Q holati · «tushirildi» · chek foydasi · chegirma (ochish, qo'llanishi,
 * qisilishi).
 *
 * F3 (POS redizayn, 2026-08-14, spec Q6): qatordagi −/+/✕ tugmalar OLIB
 * TASHLANDI — butun qator BITTA tugma bo'lib tahrir oynasini ochadi. ± xulqini
 * qulflagan eski testlar yangi niyat bilan qayta yozildi (pastda, izohlari bilan).
 */

import { api } from '@/lib/api-client';
import { noteServerDate } from '@/lib/clock';
import { scanFeedback } from '@/lib/pos/scan-feedback';
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { PRODUCT, PRODUCTS, at, norm, router, salesRoutes } from './harness';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/auth-store', () => ({
  // P3 — chek panelida qaytarish tugmasi kiosk uchun yashiriladi; sahifa
  // shu yordamchini import qiladi, dublyorda ham bo'lishi shart.
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
  // F11 — smena yopilganda sahifa Z-hisobotni ham chop yo'liga uzatadi.
  printZReportViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(salesRoutes()));
  // Qoralamalar localStorage'da saqlanadi — testlar bir-biriga oqmasin.
  window.localStorage.clear();
});

/** Ekranni ko'taradi va birinchi tovarni savatga qo'shadi. */
async function addFirstProduct(user: ReturnType<typeof userEvent.setup>) {
  const tiles = await screen.findAllByTestId('sotuv-product');
  await user.click(at(tiles, 0));
  return await screen.findByTestId('sotuv-cart-line');
}

/**
 * Savat qatorining narxini o'zgartiradi (major birlik).
 *
 * 2026-08-11 dan boshlab bu YAGONA yo'l: qatordagi 96px input olib tashlandi va
 * narxni bosish tahrir oynasini ochadi (egasining jonli sinovi — kassir aynan
 * narxga bosib oyna kutgan edi). Shuning uchun yordamchi ham oyna orqali
 * ishlaydi: shartnomalar (K-3, parse) o'zgarmadi, faqat kirish nuqtasi.
 */
async function setPrice(
  user: ReturnType<typeof userEvent.setup>,
  line: HTMLElement,
  value: string,
) {
  await user.click(within(line).getByTestId('sotuv-cart-price-edit'));
  const modal = await screen.findByTestId('pos-line-edit');
  await user.click(within(modal).getByTestId('pos-line-edit-price'));
  const input = within(modal).getByTestId('pos-line-edit-input');
  await user.clear(input);
  if (value !== '') await user.type(input, value);
  await user.click(within(modal).getByTestId('pos-line-edit-save'));
  await waitFor(() => expect(screen.queryByTestId('pos-line-edit')).not.toBeInTheDocument());
}

/**
 * Narx qo'yishga URINADI, lekin oynaning yopilishini kutmaydi — P12 dan keyin
 * 0 narx va poldan past narx RAD etiladi (oyna ochiq qoladi, sabab yoziladi).
 */
async function tryPrice(
  user: ReturnType<typeof userEvent.setup>,
  line: HTMLElement,
  value: string,
) {
  await user.click(within(line).getByTestId('sotuv-cart-price-edit'));
  const modal = await screen.findByTestId('pos-line-edit');
  await user.click(within(modal).getByTestId('pos-line-edit-price'));
  const input = within(modal).getByTestId('pos-line-edit-input');
  await user.clear(input);
  if (value !== '') await user.type(input, value);
  await user.click(within(modal).getByTestId('pos-line-edit-save'));
}

/** Qatordagi narx (F3: qator ichidagi span — bosish qator-tugmaga ko'tariladi). */
function priceText(line: HTMLElement): string {
  return norm(within(line).getByTestId('sotuv-cart-price-edit').textContent);
}

describe('SalesScreen — tovar setkasi', () => {
  it('P02 — tovar, sotuv narxi, qoldiq chiziladi; tan narx («Kelgan») KO‘RINMAYDI', async () => {
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    expect(tiles).toHaveLength(2);
    expect(norm(at(tiles, 0).textContent)).toContain('Kabel 2×2.5');
    expect(norm(at(tiles, 0).textContent)).toContain('10 000,00 сум');
    expect(norm(at(tiles, 0).textContent)).toContain('Qoldiq: 12 dona');
    // P02 (2026-08-13, egasi): «tovarni qidirganda qoldiq ko'rinishi kerak,
    // lekin kelgan narxi va optom narxi ko'rinmasligi kerak» — mijoz ko'zi
    // oldidagi ekranda tan narx ochiq turmasin. Eski niyat («Kelgan» setkada
    // HAM ko'rinadi, §5.2 izohi) shu kuni bekor qilindi. Hisob-mantiq
    // (narx-pol, foyda) bunga BOG'LIQ EMAS (`lib/pos/ui-flags.ts`).
    expect(within(at(tiles, 0)).queryByTestId('sotuv-grid-cost')).toBeNull();
  });

  it('P04 (2026-08-13) — mahsulot nomi POS shriftida va kattaroq', async () => {
    renderWithProviders(<SotuvPage />);

    // P04 (2026-08-13, egasi): «shriftlarni o'zgartirish kerak — mahsulot nomi
    // boshqa xildagi kattaroq shriftda». `font-pos` = `--pos-font-product`
    // (Segoe UI zanjiri, global --ms-font-sans'ga TEGILMAGAN).
    // F3 (spec §4): o'lcham endi px'da — 18px (`text-base` ildiz 12px da
    // 12px chiqib «kattaroq» degan niyatning o'zini buzardi); karta ≥56px.
    const tiles = await screen.findAllByTestId('sotuv-product');
    expect(at(tiles, 0).className).toContain('min-h-[var(--pos-touch-min)]');
    const name = at(tiles, 0).querySelector('.font-pos');
    expect(name, 'qidiruv kartasi nomi font-pos emas').not.toBeNull();
    expect(name?.className).toContain('text-[18px]');
    expect(norm(name?.textContent)).toContain('Kabel 2×2.5');
  });

  it('bo‘sh savat — «Savat bo‘sh» va «Omborchiga yuborish» bloklangan', async () => {
    renderWithProviders(<SotuvPage />);

    expect(await screen.findByText(/Savat bo.sh/)).toBeInTheDocument();
    expect(screen.getByTestId('sotuv-pay')).toBeDisabled();
    expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument();
  });

  /**
   * 2026-08-16 (kassirlar so'rovi): qidiruv natijalari tanlashdan keyin
   * TOZALANMAYDI — keyingi tovar nomi ko'pincha o'xshash bo'ladi. Matn
   * TO'LIQ BELGILANADI: yangi nom terilsa (yoki skaner o'qisa) eski matn
   * ustidan yoziladi — 2026-08-12 dagi teskari shikoyat («yangi harflar
   * eskisiga qo'shilardi») ham qaytmaydi.
   */
  it('qidiruvda Enter — birinchi topilgan tovarni qo‘shadi, matn QOLADI va belgilanadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await screen.findAllByTestId('sotuv-product');

    const search = screen.getByTestId('sotuv-search');
    await user.type(search, 'kab');
    // Yangi qidiruv kaliti — ro'yxat qayta yuklanguncha kutamiz.
    await waitFor(() => expect(screen.getAllByTestId('sotuv-product')).toHaveLength(2));
    await user.type(search, '{Enter}');

    const line = await screen.findByTestId('sotuv-cart-line');
    expect(norm(line.textContent)).toContain('Kabel 2×2.5');
    const input = search as HTMLInputElement;
    expect(input).toHaveValue('kab');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('kab'.length);
  });

  /**
   * Setkadan bosish yo'li ham xuddi shu shartnomada: matn qoladi, fokus
   * maydonga qaytadi (skaner uchun) va matn belgilanadi.
   */
  it('🔴 setkadan bosilganda matn qoladi, fokus qaytadi va belgilanadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await screen.findAllByTestId('sotuv-product');

    const search = screen.getByTestId('sotuv-search');
    await user.type(search, 'kab');
    await waitFor(() => expect(screen.getAllByTestId('sotuv-product')).toHaveLength(2));

    await user.click(at(screen.getAllByTestId('sotuv-product'), 0));

    expect(await screen.findByTestId('sotuv-cart-line')).toBeInTheDocument();
    const input = search as HTMLInputElement;
    expect(input).toHaveValue('kab');
    expect(input).toHaveFocus();
    expect(input.selectionEnd).toBe('kab'.length);
  });

  it('«Tozalash» (input ichida) — matn bo‘lganda chiqadi, bosilsa tozalaydi va fokus qoladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await screen.findAllByTestId('sotuv-product');

    // Matn yo'q — tugma ham yo'q.
    expect(screen.queryByTestId('sotuv-search-clear')).not.toBeInTheDocument();

    const search = screen.getByTestId('sotuv-search');
    await user.type(search, 'kab');
    await user.click(screen.getByTestId('sotuv-search-clear'));

    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.queryByTestId('sotuv-search-clear')).not.toBeInTheDocument();
  });
});

describe('SalesScreen — savat qatorlari', () => {
  it('tovarni bosish savatga qator qo‘shadi (kartochka narxi bilan)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    expect(priceText(line)).toBe('10 000,00 сум');
    expect(norm(line.textContent)).toContain('10 000,00 сум');
    // Jami + dona soni footerda.
    expect(norm(screen.getByText(/ta mahsulot/).textContent)).toBe('1 ta mahsulot');
  });

  it('P04 (2026-08-13) — savat qatoridagi nom ham POS shriftida va kattaroq', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    // Nom (`sotuv-cart-line-edit` — endi span, butun qator tugma bo'ldi, F3).
    // F3 (spec §4): o'lcham px'da — 18px (ildiz font 12px, rem-klasslar 0.75×
    // kichik chiqadi; F2 saboqi). Eski `text-base` asserti shu sababdan bekor.
    const name = within(line).getByTestId('sotuv-cart-line-edit');
    expect(name.className, 'savat qatori nomi font-pos emas').toContain('font-pos');
    expect(name.className).toContain('text-[18px]');
  });

  it('bir tovarni ikki marta bosish — YANGI qator emas, miqdor 2 bo‘ladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 0));

    const lines = screen.getAllByTestId('sotuv-cart-line');
    expect(lines).toHaveLength(1);
    // Qator summasi 2 × 10 000.
    expect(norm(at(lines, 0).textContent)).toContain('20 000,00 сум');
    expect(norm(screen.getByText(/ta mahsulot/).textContent)).toBe('2 ta mahsulot');
  });

  /**
   * F3 (spec Q6, 2026-08-14): qatordagi −/+/✕ tugmalar OLIB TASHLANDI —
   * sensorli monoblokda 24px nishonlar barmoq bilan xato bosilardi. Miqdor
   * endi FAQAT katta tahrir oynasida (numpad) o'zgaradi; «soni 0 = qator
   * o'chadi» xulqi oyna testlarida qulflangan. Eski niyat («−» qatorda turadi
   * va 1 dan pastda qatorni o'chiradi) shu qaror bilan bekor bo'ldi.
   */
  it('F3 — qator ICHIDA tugma yo‘q (−/+/✕ ketdi), qator O‘ZI tahrir-trigger', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    expect(line.tagName).toBe('BUTTON');
    expect(within(line).queryAllByRole('button')).toHaveLength(0);

    await user.click(line);
    expect(await screen.findByTestId('pos-line-edit')).toBeInTheDocument();
  });

  /**
   * F3: «✕» qatordan ketgan edi (Q6) — 2026-08-15 (egasi, monoblokda) KATTA
   * ✕ qaytdi: bitta tovarni o'chirish uchun oynani ochish yo'lini kassir
   * topolmadi. Nishon 56px (F3 shikoyatidagi 24px emas) va qator-tugmadan
   * TASHQARIDA (nested-button emas). Oynadagi «O'chirish» ham qoladi.
   */
  it('qator yonidagi ✕ FAQAT o‘sha qatorni o‘chiradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 1));
    expect(screen.getAllByTestId('sotuv-cart-line')).toHaveLength(2);

    await user.click(at(screen.getAllByTestId('sotuv-cart-line-remove'), 0));

    const lines = screen.getAllByTestId('sotuv-cart-line');
    expect(lines).toHaveLength(1);
    expect(norm(at(lines, 0).textContent)).toContain('Rozetka Legrand');
    // Oyna ochilib ketmadi — ✕ tahrir-triggerga ko'tarilmaydi.
    expect(screen.queryByTestId('pos-line-edit')).not.toBeInTheDocument();
  });

  it('o‘chirish tahrir oynasi orqali; «Tozalash» butun savatni bo‘shatadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 1));
    expect(screen.getAllByTestId('sotuv-cart-line')).toHaveLength(2);

    await user.click(at(screen.getAllByTestId('sotuv-cart-line'), 0));
    const modal = await screen.findByTestId('pos-line-edit');
    await user.click(within(modal).getByTestId('pos-line-edit-remove'));
    await waitFor(() => expect(screen.getAllByTestId('sotuv-cart-line')).toHaveLength(1));

    await user.click(screen.getByTestId('sotuv-cart-clear'));
    expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument();
  });

  // K-3 → P12 → 🔴 2026-08-16: cheklov OLIB TASHLANDI (egasining qarori).
  // Bo'sh maydon = 0 va u endi QABUL QILINADI — kassir bepulga ham sotadi.
  // Saqlanadigan invariant: ekranda ko'ringan qiymat savatga tushadi
  // (ESKI narx jimgina qolib ketmaydi — K-3 shartnomasi).
  it('narx BO‘SHATILSA — 0 saqlanadi (bepul sotishga ruxsat)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await tryPrice(user, line, '');

    expect(screen.queryByTestId('pos-line-edit-no-price')).not.toBeInTheDocument();
    expect(priceText(screen.getByTestId('sotuv-cart-line'))).toBe('0,00 сум');
  });

  it('narxga HARF yozilsa — 0 o‘qiladi va o‘sha 0 saqlanadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await tryPrice(user, line, 'abc');

    expect(priceText(screen.getByTestId('sotuv-cart-line'))).toBe('0,00 сум');
  });

  // F2 — narx parse'i YAGONA (`parseAmountToMinor`). Ilgari sahifa o'z
  // nusxasini yozardi (`Number.parseFloat × 100`) va u «12abc» dan jimgina
  // 12 ni sug'urib olardi: ekranda «12abc», chekka 1 200 tiyin. To'lov oynasi
  // esa allaqachon qat'iy parse ishlatardi — ikki maydon bir xil matnni ikki
  // xil tushunardi. Endi bittasi: buzuq kiritma = 0.
  it('🔴 narxga «12abc» — jimgina 12 so‘m EMAS (oynada 0 ko‘rinadi, saqlanmaydi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await tryPrice(user, line, '12abc');

    // Buzuq kiritma = 0 (12 EMAS). Cheklov olib tashlangani uchun bu 0 endi
    // saqlanadi — muhimi 12 so'm jimgina chekka ketmasligi.
    expect(priceText(screen.getByTestId('sotuv-cart-line'))).toBe('0,00 сум');
  });

  it('narxni tahrirlash qator summasini darhol siljitadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await setPrice(user, line, '9000');

    const after = screen.getByTestId('sotuv-cart-line');
    expect(priceText(after)).toBe('9 000,00 сум');
    expect(norm(after.textContent)).toContain('9 000,00 сум');
    // 9 000 > 8 000 (optom chegara) ⇒ tasma hamon `ok`.
    expect(after).toHaveAttribute('data-price-band', 'ok');
  });

  /**
   * Narx bosilganda TAHRIR OYNASI ochiladi (2026-08-11, egasining jonli
   * sinovi). Ilgari bu yerda 96px input turardi va sensorli monoblokda unga
   * aniq tegib bo'lmasdi; kassir narxga bosib oyna kutgan edi — kutgani
   * chiqmagan. Ikkinchi tahrir yo'li ATAYLAB olib tashlandi: bitta ekranda
   * bitta narx-tahrir yo'li.
   */
  it('narxni bosish tahrir oynasini ochadi (qatorda input QOLMADI)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    expect(within(line).queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(within(line).getByTestId('sotuv-cart-price-edit'));
    const modal = await screen.findByTestId('pos-line-edit');
    // Oyna aynan NARX maydonida ochilmaydi — kassir qaysi maydonni
    // tanlashini o'zi bosadi; muhimi oynaning ochilishi.
    expect(modal).toHaveTextContent('Kabel 2×2.5');
  });
});

describe('SalesScreen — narx tasmalari (kassa TZ §5.2)', () => {
  it('kartochka narxida — tasma `ok`, ogohlantirish YO‘Q', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    expect(line).toHaveAttribute('data-price-band', 'ok');
    expect(within(line).queryByTestId('sotuv-cart-loss')).not.toBeInTheDocument();
    expect(within(line).queryByText('optomdan past')).not.toBeInTheDocument();
    // Kartochka narxida sotilgan qatorga «tushirildi» yozilmaydi.
    expect(within(line).queryByTestId('sotuv-cart-markdown')).not.toBeInTheDocument();
  });

  it('optom chegaradan past narx — sariq tasma + «tushirildi» summasi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await setPrice(user, line, '7000');

    const after = screen.getByTestId('sotuv-cart-line');
    expect(after).toHaveAttribute('data-price-band', 'below-wholesale');
    expect(within(after).getByText('optomdan past')).toBeInTheDocument();
    expect(within(after).queryByTestId('sotuv-cart-loss')).not.toBeInTheDocument();
    // Kartochka narxidan 3 000 pastga tushirilgan.
    expect(norm(within(after).getByTestId('sotuv-cart-markdown').textContent)).toBe(
      '−3 000,00 сум tushirildi',
    );
  });

  it('🔴 2026-08-16 — tan narxdan past narx SAQLANADI (pol olib tashlandi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await tryPrice(user, line, '5000'); // ilgarigi pol 6 000

    // P12 qulfi egasining 2026-08-16 qarori bilan o'chirildi: qizil «rad
    // etildi» banneri ham chizilmaydi, narx savatga tushadi.
    expect(screen.queryByTestId('pos-line-edit-floor-blocked')).not.toBeInTheDocument();
    const after = screen.getByTestId('sotuv-cart-line');
    expect(priceText(after)).toBe('5 000,00 сум');
    // Marja RAQAMI hamon ekranda yo'q (`ui-flags.ts` qarori o'zgarmadi).
    expect(within(after).queryByTestId('sotuv-cart-profit')).not.toBeInTheDocument();
  });

  it('tan narx kartochkada YO‘Q — tasma `ok` qoladi (ogohlantirish EMAS)', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        salesRoutes([
          { match: /^\/products\?/, value: { items: [PRODUCT({ buyPrice: null })], total: 1 } },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    // Tan narx yo'qligi ogohlantirish EMAS — u shunchaki noma'lum
    // (NULL ≠ 0; hisob-kitob shartnomasi `pos-cart-profit.test.ts` da).
    expect(line).toHaveAttribute('data-price-band', 'ok');
    expect(within(line).queryByTestId('sotuv-cart-loss')).not.toBeInTheDocument();
  });
});

/**
 * MARJA EKRANDA KO'RSATILMAYDI — egasining qarori (2026-08-11, monoblok
 * jonli ishga tushgandan keyin): kassir yoniga kelgan mijoz «Tan: 14 375» va
 * «Foyda: +5 525 (27,8%)» yozuvlarini o'qiy olardi.
 *
 * Bu test NIYATNI qulflaydi, implementatsiyani emas: raqamlar qayerda
 * hisoblanishi muhim emas, EKRANDA bo'lmasligi muhim. Hisob-kitobning o'zi
 * ataylab saqlanib qoldi (`lib/pos/ui-flags.ts` izohi) — ZARAR tasmasi va
 * `pos-cart-profit.test.ts` qo'riqchisi o'shanga tayanadi.
 */
describe('SalesScreen — marja ekranda ko‘rsatilmaydi', () => {
  it('qatorda ham, footerda ham tan narx va foyda YO‘Q', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0)); // 10 000 narx / 6 000 tan
    await user.click(at(tiles, 1)); // 5 000 narx / 3 000 tan

    const line = at(screen.getAllByTestId('sotuv-cart-line'), 0);
    expect(within(line).queryByTestId('sotuv-cart-cost')).not.toBeInTheDocument();
    expect(within(line).queryByTestId('sotuv-cart-profit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sotuv-cart-total-profit')).not.toBeInTheDocument();
    // Matn darajasida ham: «Foyda» so'zi savat ekranida umuman chiqmaydi.
    expect(screen.queryByText(/Foyda/)).not.toBeInTheDocument();
  });

  it('tahrir oynasida tannarx «***» ostida — raqam sukutda YOPIQ, bosilganda ochiladi (2026-09-01)', async () => {
    // Egasining yangi qarori (2026-09-01): oynada «Tannarx: ***» doim turadi —
    // optom yozuvi oldida — lekin RAQAM yulduzcha bosilgunicha chiqmaydi.
    // Mijoz ko'zi himoyasi (2026-08-11/13) shu maska bilan saqlanadi.
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    await user.click(within(line).getByTestId('sotuv-cart-price-edit'));
    const modal = await screen.findByTestId('pos-line-edit');

    const cost = within(modal).getByTestId('pos-line-edit-cost');
    expect(norm(cost.textContent)).toContain('***');
    // Tan narx raqami (kartochkada 6 000) sukutda KO'RINMAYDI.
    expect(norm(cost.textContent)).not.toContain('6 000');

    await user.click(within(modal).getByTestId('pos-line-edit-cost-toggle'));
    expect(norm(within(modal).getByTestId('pos-line-edit-cost').textContent)).toContain('6 000,00');
  });
});

describe('SalesScreen — chek chegirmasi', () => {
  it('jami summani ikki marta bosish chegirma maydonini ochadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument();
    await user.dblClick(screen.getByTitle('Chegirma uchun ikki marta bosing'));
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument();
  });

  it('chegirma qo‘llanadi: eski summa chizib tashlanadi, yangisi ko‘rsatiladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.dblClick(screen.getByTitle('Chegirma uchun ikki marta bosing'));
    await user.type(screen.getByPlaceholderText('0'), '10');

    const block = screen.getByTitle('Chegirma uchun ikki marta bosing');
    expect(norm(block.textContent)).toContain('10 000,00 сум'); // chizib tashlangan asl
    expect(norm(block.textContent)).toContain('9 000,00 сум'); // to'lanadigan
    expect(norm(block.textContent)).toContain('−10% chegirma');
  });

  it('chegirma QATOR summasiga tegmaydi — faqat chek jamiga (hozirgi xulq)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    const line = await addFirstProduct(user);

    await user.dblClick(screen.getByTitle('Chegirma uchun ikki marta bosing'));
    await user.type(screen.getByPlaceholderText('0'), '10');

    // Qator hamon 10 000 (chegirma pozitsiyaga so'rovda yoziladi, ekranda emas).
    expect(norm(line.textContent)).toContain('10 000,00 сум');
    // Chegirmali jami esa footerda: 9 000.
    expect(norm(screen.getByTitle('Chegirma uchun ikki marta bosing').textContent)).toContain(
      '9 000,00 сум',
    );
  });

  it('100 dan katta chegirma 100 ga QISILADI (manfiy jami bo‘lmaydi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.dblClick(screen.getByTitle('Chegirma uchun ikki marta bosing'));
    await user.type(screen.getByPlaceholderText('0'), '150');

    const block = screen.getByTitle('Chegirma uchun ikki marta bosing');
    expect(norm(block.textContent)).toContain('−100% chegirma');
    expect(norm(block.textContent)).toContain('0,00 сум');
  });

  it('Enter maydonni yopadi, chegirma esa SAQLANADI', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.dblClick(screen.getByTitle('Chegirma uchun ikki marta bosing'));
    const input = screen.getByPlaceholderText('0');
    await user.type(input, '10{Enter}');

    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument());
    expect(norm(screen.getByTitle('Chegirma uchun ikki marta bosing').textContent)).toContain(
      '−10% chegirma',
    );
  });
});

describe('SalesScreen — savat va tovar ro‘yxati bog‘lanishi', () => {
  it('ikkinchi tovar ALOHIDA qator bo‘ladi va jami ikkalasini qo‘shadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 1));

    const lines = screen.getAllByTestId('sotuv-cart-line');
    expect(lines).toHaveLength(2);
    expect(norm(at(lines, 1).textContent)).toContain('Rozetka Legrand');
    expect(norm(screen.getByTitle('Chegirma uchun ikki marta bosing').textContent)).toContain(
      '15 000,00 сум',
    );
  });

  it('P02 — savat qatorida «Optom» KO‘RINMAYDI (tahrir oynasida qoladi — F3)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    // P02 (2026-08-13, egasi): optom narx ham mijoz ko'zi oldida ochiq
    // turmasin — u FAQAT qator-tahrir oynasida qoladi (egasining aniq
    // talabi, F3 qamrovi). Eski niyat (P12: qatorda «Optom» ko'rsatiladi,
    // «sotuv narxi — maxfiy emas» degan asos) shu kuni bekor qilindi.
    expect(within(line).queryByTestId('sotuv-cart-min')).toBeNull();
    // Tan narx avvalgidek yo'q (marja ekranda ko'rsatilmaydi, 2026-08-11).
    expect(within(line).queryByTestId('sotuv-cart-cost')).not.toBeInTheDocument();
    // Qoldiq kartochkadan olinadi — bu QOLADI (egasi aynan shuni so'ragan).
    expect(norm(line.textContent)).toContain('Qolgan: 12');
  });

  // F2 (POS redizayn): «Savat» tab'i yo'q — savat Sotuv rejimining doimiy
  // paneli, soni esa sidebar'dagi «Sotuv» bo'limi badge'ida (eski niyat:
  // tab-yorlig'idagi rozetka; sidebar tab-bar o'rnini oldi, spec §3.2).
  it('savatdagi tovarlar soni sidebar «Sotuv» badge‘ida ko‘rinadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 1));

    const sotuvItem = screen.getByTestId('pos-sidebar-item-sotuv');
    expect(within(sotuvItem).getByText('3')).toBeInTheDocument();
  });
});

/**
 * F2 — sensorli monoblok uchun savat qatori tahrir oynasi.
 *
 * Oynaning O'Z xulqi `components/pos/__tests__/cart-line-edit-modal.test.tsx`
 * da qulflangan; bu yerda qulflanadigan narsa — SAHIFA bilan ulanishi: qator
 * qanday ochadi va oynaning natijasi savatga qanday qo'llanadi.
 *
 * F3 (spec Q6): qatordagi −/+ tugmalar ham olib tashlandi — endi miqdor va
 * narxning YAGONA tahrir yo'li shu oyna (butun qator uni ochadi). Eski holat
 * («soni uchun ikki yo'l bor, narx uchun bitta») shu qaror bilan bekor bo'ldi.
 * `sotuv-cart-line-edit`/`sotuv-cart-price-edit` endi qator ichidagi SPAN'lar —
 * bosish qator-tugmaga ko'tarilib (bubbling) o'sha oynani ochadi.
 */
describe('SalesScreen — savat qatori tahrir oynasi (F2)', () => {
  /** Qator nomini bosib oynani ochadi. */
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    const line = await addFirstProduct(user);
    await user.click(within(line).getByTestId('sotuv-cart-line-edit'));
    return await screen.findByTestId('pos-line-edit');
  }

  /** Oyna numpadini bosadi (sahifada boshqa raqamlar ham bor). */
  async function tap(user: ReturnType<typeof userEvent.setup>, ...keys: string[]) {
    const pad = screen.getByTestId('pos-line-edit');
    for (const k of keys) await user.click(within(pad).getByRole('button', { name: k }));
  }

  it('qator nomini bosish oynani joriy soni va narx bilan ochadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const modal = await openEditor(user);
    expect(modal).toHaveTextContent('Kabel 2×2.5');
    expect(norm(within(modal).getByTestId('pos-line-edit-qty').textContent)).toContain('1');
    expect(norm(within(modal).getByTestId('pos-line-edit-price').textContent)).toContain(
      '10 000,00',
    );
  });

  it('oynada soni kiritilib saqlansa savat qatori yangilanadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await openEditor(user);
    await tap(user, '1', '2');
    await user.click(screen.getByTestId('pos-line-edit-save'));

    await waitFor(() => expect(screen.queryByTestId('pos-line-edit')).not.toBeInTheDocument());
    const line = screen.getByTestId('sotuv-cart-line');
    expect(within(line).getByTestId('sotuv-cart-qty')).toHaveTextContent('12');
    // 12 × 10 000 = 120 000
    expect(norm(line.textContent)).toContain('120 000,00');
  });

  it('oynada kasr miqdor (1.5) savatga SATR bo‘lib tushadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await openEditor(user);
    await tap(user, '1', '.', '5');
    await user.click(screen.getByTestId('pos-line-edit-save'));

    const line = await screen.findByTestId('sotuv-cart-line');
    expect(within(line).getByTestId('sotuv-cart-qty')).toHaveTextContent('1.5');
    // 1.5 × 10 000 = 15 000 — `BigInt(1.5)` otilmaydi.
    expect(norm(line.textContent)).toContain('15 000,00');
  });

  it('oynada narx tushirilsa savatga qo‘llanadi (tasma ham siljiydi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await openEditor(user);
    await user.click(screen.getByTestId('pos-line-edit-price'));
    // 7 000: optom chegaradan (8 000) past, lekin poldan (6 000) yuqori —
    // P12 dan keyin savatga tushadigan eng past oraliq shu (poldan pastga
    // tushirish endi qulflangan, `sales-screen-price-floor.test.tsx`).
    await tap(user, '7', '0', '0', '0');
    await user.click(screen.getByTestId('pos-line-edit-save'));

    const line = await screen.findByTestId('sotuv-cart-line');
    expect(priceText(line)).toBe('7 000,00 сум');
    expect(line).toHaveAttribute('data-price-band', 'below-wholesale');
  });

  it('oynadagi «O‘chirish» qatorni savatdan olib tashlaydi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await openEditor(user);
    await user.click(screen.getByTestId('pos-line-edit-remove'));

    await waitFor(() => expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument());
    expect(screen.queryByTestId('pos-line-edit')).not.toBeInTheDocument();
  });

  // F3: «savatdagi „−“ bilan bir xil» taqqoslama bekor — «−» endi yo'q,
  // 0-miqdor esa qatorni o'chirishning oynadagi yo'li bo'lib qoldi.
  it('oynada soni 0 qilinsa qator o‘chadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await openEditor(user);
    await tap(user, '0');
    await user.click(screen.getByTestId('pos-line-edit-save'));

    await waitFor(() => expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument());
  });
});

/**
 * F3 — skaner-javob (spec §5.1): savatga tushganda «bip» + qator bir lahza
 * yashil yonadi; hech narsa topilmasa past ton (xabar allaqachon bor edi).
 * Tovushning O'Z shartnomasi `lib/pos/scan-feedback.test.ts` da — bu yerda
 * faqat ULANISH qulflanadi (happy-dom'da AudioContext yo'q, modul jim no-op;
 * spy chaqiruv faktini ko'radi).
 */
describe('SalesScreen — skaner-javob (F3)', () => {
  it('savatga qo‘shilganda ok() chalinadi va qator flash oladi', async () => {
    const okSpy = vi.spyOn(scanFeedback, 'ok');
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    const line = await addFirstProduct(user);
    expect(okSpy).toHaveBeenCalledTimes(1);
    expect(line).toHaveAttribute('data-flash', 'true');
  });

  it('qidiruv hech narsa topmasa notFound() chalinadi (xabar bilan birga)', async () => {
    // F5 (2026-08-14): SOAT MUZLATILADI (faqat `Date`; taymerlar real qoladi —
    // react-query/userEvent ishlashda davom etadi). Dedup oynasi (800ms)
    // `Date.now()` dan o'qiladi; real soat bilan «aynan 1 marta» asserti
    // MASHINA TEZLIGIGA bog'liq edi: band mashinada ikki prefiks-so'rov
    // 800ms dan uzoq oraliqda kelib, dizayn BO'YICHA ikkinchi bip chalinardi
    // va test yolg'ondan qizarardi. Muzlatilgan soatda barcha prefikslar
    // bitta oynaga tushadi — dedup shartnomasi deterministik qulflanadi.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const missSpy = vi.spyOn(scanFeedback, 'notFound');
      const user = userEvent.setup();
      renderWithProviders(<SotuvPage />);
      await screen.findAllByTestId('sotuv-product');

      vi.mocked(api.get).mockImplementation(
        router(salesRoutes([{ match: /^\/products\?/, value: { items: [], total: 0 } }])),
      );
      await user.type(screen.getByTestId('sotuv-search'), 'yoq-tovar');

      expect(await screen.findByText('Topilmadi')).toBeInTheDocument();
      // Dedup (bir so'rov = bir marta, 800ms oynasi) tufayli aynan 1 marta.
      await waitFor(() => expect(missSpy).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });
});

/** PRODUCTS fikstura ikki tovarli — testlar shunga tayanadi. */
it('fikstura tekshiruvi: setkada aynan ikki tovar bor', () => {
  expect(PRODUCTS.items).toHaveLength(2);
});

/**
 * QORALAMA (hold order) — 2026-08-16, egasi so'rovi: kassir savatni chetga
 * olib ikkinchi mijozga xizmat ko'rsatadi. Holat `localStorage`da
 * (`lib/pos/cart-drafts.ts` — serializatsiya o'z testlarida qulflangan);
 * bu yerda EKRAN oqimi: park → chip → tiklash/almashish/o'chirish.
 */
describe('SalesScreen — qoralama (hold order)', () => {
  it('savat bo‘sh — «Qoralama» tugmasi ham, chip qatori ham yo‘q', async () => {
    renderWithProviders(<SotuvPage />);
    await screen.findAllByTestId('sotuv-product');

    expect(screen.queryByTestId('sotuv-cart-park')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sotuv-drafts')).not.toBeInTheDocument();
  });

  it('park — savat bo‘shaydi, chip chiqadi (soni + summa), localStorage yoziladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-cart-park'));

    // Savat bo'shadi, tugma yo'qoldi (park qilinadigan narsa qolmadi).
    expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sotuv-cart-park')).not.toBeInTheDocument();

    // Chip: 1 tovar + server-formula summasi.
    const chip = screen.getByTestId('sotuv-cart-draft');
    expect(norm(chip.textContent)).toContain('1 tovar');
    expect(norm(chip.textContent)).toContain('10 000,00 сум');

    // Sahifa yangilansa yo'qolmasin — localStorage'da turibdi.
    expect(window.localStorage.getItem('sherset.pos.drafts')).toContain('Kabel');
  });

  it('chip bosilsa savat QAYTADI (narx/miqdor bilan) va chip yo‘qoladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-cart-park'));
    await user.click(screen.getByTestId('sotuv-cart-draft'));

    const line = await screen.findByTestId('sotuv-cart-line');
    expect(norm(line.textContent)).toContain('Kabel 2×2.5');
    expect(norm(line.textContent)).toContain('10 000,00 сум');
    expect(screen.queryByTestId('sotuv-drafts')).not.toBeInTheDocument();
  });

  it('🔴 savatda tovar TURGANDA tiklash — joriy savat avval AVTOMATIK qoralanadi (almashish)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    // A: Kabel → park.
    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(screen.getByTestId('sotuv-cart-park'));

    // B: Rozetka savatda turganda A chipini bosamiz.
    await user.click(at(screen.getAllByTestId('sotuv-product'), 1));
    await user.click(screen.getByTestId('sotuv-cart-draft'));

    // Savatda A (Kabel); B (Rozetka) yo'qolmadi — u endi qoralamada.
    const lines = screen.getAllByTestId('sotuv-cart-line');
    expect(lines).toHaveLength(1);
    expect(norm(at(lines, 0).textContent)).toContain('Kabel 2×2.5');
    const chips = screen.getAllByTestId('sotuv-cart-draft');
    expect(chips).toHaveLength(1);
    expect(norm(at(chips, 0).textContent)).toContain('1 tovar');
  });

  it('chipdagi ✕ — qoralamani o‘chiradi, savatga tegmaydi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-cart-park'));
    await user.click(screen.getByTestId('sotuv-cart-draft-delete'));

    expect(screen.queryByTestId('sotuv-drafts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument();
  });

  it('chek chegirmasi qoralama bilan birga saqlanadi va tiklashda qaytadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    // 10% chegirma (summa ustiga ikki bosish → inline input).
    await user.dblClick(screen.getByTitle('Chegirma uchun ikki marta bosing'));
    await user.type(screen.getByPlaceholderText('0'), '10');
    await user.keyboard('{Enter}');
    expect(norm(screen.getByText(/9 000,00/).textContent)).toContain('9 000,00 сум');

    await user.click(screen.getByTestId('sotuv-cart-park'));
    // Chip summasi chegirmali (server formulasi bilan).
    expect(norm(screen.getByTestId('sotuv-cart-draft').textContent)).toContain('9 000,00 сум');
    // Yangi (bo'sh) savat chegirmasiz boshlanadi.

    await user.click(screen.getByTestId('sotuv-cart-draft'));
    // Tiklangan savatda chegirma qaytdi.
    expect(norm(screen.getByText(/−10% chegirma/).textContent)).toContain('−10%');
  });
});

/**
 * S3 (kassa vaqti) — QORALAMA CHIPIDAGI VAQT.
 *
 * Chip vaqti kassirga «qaysi savat qachon qo'yilgan» ni aytadi: navbatda uch
 * qoralama turganda u yagona ajratuvchi belgi. Ilgari u ikki marta qurilmaga
 * bog'langan edi — soati (`Date.now()`) ham, mintaqasi ham. Bu test to'rt
 * kombinatsiyadan FAQAT bittasini o'tkazadi: server soati + Toshkent mintaqasi.
 */
describe('SalesScreen — qoralama vaqti server soatida (S3)', () => {
  /** Qurilma: 23:50 (Toshkent) · 08:50 (Honolulu) — soati ham, mintaqasi ham xato. */
  const DEVICE = new Date('2026-08-15T18:50:00.000Z');
  /** Server: 20 daqiqa oldinda — Toshkentda allaqachon 00:10, ERTASI kun. */
  const SERVER = new Date('2026-08-15T19:10:00.000Z');

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    // Skew modul darajasida yashaydi — keyingi testlarga oqib ketmasin.
    noteServerDate({ headers: new Headers({ Date: new Date().toUTCString() }) } as Response);
    window.localStorage.clear();
  });

  it('chip vaqti = server soati + `Asia/Tashkent` (qurilmaniki EMAS)', async () => {
    // 🔴 FAQAT `Date` soxtalashtiriladi: `setTimeout`/`setInterval` HAQIQIY
    // qoladi, aks holda testing-library'ning `waitFor`i va `userEvent` osilib
    // qolardi (vitest soxta taymerlarini RTL tanimaydi).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DEVICE);
    vi.stubEnv('TZ', 'Pacific/Honolulu');
    noteServerDate({ headers: new Headers({ Date: SERVER.toUTCString() }) } as Response);

    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);
    await user.click(screen.getByTestId('sotuv-cart-park'));

    const chip = norm(screen.getByTestId('sotuv-cart-draft').textContent);
    // Server soati + Toshkent — YAGONA to'g'ri javob.
    expect(chip).toContain('00:10');
    // Qolgan uch kombinatsiya — har biri o'z nuqsoni bilan:
    expect(chip).not.toContain('09:10'); // server soati, lekin qurilma mintaqasi
    expect(chip).not.toContain('23:50'); // Toshkent, lekin qurilma soati
    expect(chip).not.toContain('08:50'); // qurilma soati + qurilma mintaqasi
  });
});
