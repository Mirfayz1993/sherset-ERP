/**
 * SOTUVSIZ CHEK — «Chek chiqarish» tugmasi (2026-08-16, egasi so'rovi).
 *
 * Shartnoma:
 *  · tugma savat panelida; savat bo'sh yoki narx-xatosi (pol/narx yo'q)
 *    bo'lsa BLOKLANADI — «Sotish» bilan bir xil qoidalar;
 *  · bosilganda HECH QANDAY sotuv/hujjat yaratilmaydi (api.post chaqirilmaydi),
 *    chek savatdan yig'ilib chop yo'liga ketadi;
 * *  · chop etilgach savat avtomatik QORALAMA chipiga o'tadi — «har bir chekni
 *    o'zgartirish» = chipni ochib, o'zgartirib, yana chiqarish;
 *  · chek RAQAMI (2026-09-02, egasi) — kassirning shu kundagi ketma-ket soni,
 *    `POST /retail-sales/receipt-number` dan. Bu hujjat YARATMAYDI: faqat
 *    haqiqiy sotuv cheki bilan AYNI hisoblagichni suradi.
 */

import { api } from '@/lib/api-client';
import { printProformaReceiptViaAgent } from '@/lib/print-agent';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { PRODUCT, PRODUCTS, norm, router, salesRoutes } from './harness';

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
  printDebtReceiptViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
  printProformaReceiptViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(salesRoutes()));
  // Chop-spy testlar orasida tozalanadi — chaqiruv soni oqib o'tmasin.
  vi.mocked(printProformaReceiptViaAgent).mockClear();
  window.localStorage.clear();
});

async function addFirstProduct(user: ReturnType<typeof userEvent.setup>) {
  const tiles = await screen.findAllByTestId('sotuv-product');
  const first = tiles[0];
  if (!first) throw new Error('tovar kartasi topilmadi');
  await user.click(first);
  return await screen.findByTestId('sotuv-cart-line');
}

describe('Chek chiqarish (sotuvsiz) — tugma va oqim', () => {
  it('savat bo‘sh — tugma bloklangan', async () => {
    renderWithProviders(<SotuvPage />);
    await screen.findAllByTestId('sotuv-product');

    expect(screen.getByTestId('sotuv-proforma')).toBeDisabled();
  });

  it('bosilganda sotuv YARATILMAYDI, chek savatdan chop yo‘liga ketadi, savat chipga o‘tadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-proforma'));

    await waitFor(() => expect(printProformaReceiptViaAgent).toHaveBeenCalledTimes(1));
    // Chek savatdagi tovardan yig'ilgan.
    const input = vi.mocked(printProformaReceiptViaAgent).mock.calls[0]?.[0] as {
      positions: Array<{ product: { name: string } | null; sumMinor: string }>;
      sumMinor: string;
    };
    expect(input.positions[0]?.product?.name).toBe('Kabel 2×2.5');
    expect(input.sumMinor).toBe('1000000');

    // HECH QANDAY hujjat yaratilmagan. Yagona POST — kunlik chek RAQAMI
    // (2026-09-02): u hisoblagichni suradi, sotuv/hujjat yozmaydi.
    expect(vi.mocked(api.post).mock.calls.map((c) => c[0])).toEqual([
      '/retail-sales/receipt-number',
    ]);

    // Savat bo'shadi va qoralama chipi paydo bo'ldi («chekni o'zgartirish» yo'li).
    await waitFor(() => expect(screen.queryByTestId('sotuv-cart-line')).not.toBeInTheDocument());
    expect(screen.getByTestId('sotuv-cart-draft')).toBeInTheDocument();
  });

  it('chiqarilgan chek chipida OCHIQ «Tahrirlash» yozuvi bor; bosilsa savatga qaytadi', async () => {
    // 2026-08-16 (egasi): «tahrirlash yo'q-ku» — chip bor edi, lekin yozuvsiz
    // (faqat vaqt+summa) kassir uni tahrir yo'li deb bilmasdi. Endi ochiq yozuv.
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-proforma'));

    const chip = await screen.findByTestId('sotuv-cart-draft');
    expect(norm(chip.textContent)).toContain('Tahrirlash');

    await user.click(chip);
    expect(await screen.findByTestId('sotuv-cart-line')).toBeInTheDocument();
    expect(screen.queryByTestId('sotuv-cart-draft')).not.toBeInTheDocument();
  });

  it('🔴 narxsiz tovar (0 so‘m) savatda — tugma OCHIQ (2026-08-16: cheklov yo‘q)', async () => {
    // Narxi yo'q tovar: salePrices bo'sh → qator 0 so'm. Ilgari bu tugmani
    // bloklardi; egasining qarori bilan 0 so'mlik chek ham chiqariladi.
    vi.mocked(api.get).mockImplementation(
      router(
        salesRoutes([
          {
            match: /^\/products\?/,
            value: {
              items: [
                PRODUCT({ id: 'p-free', name: 'Narxsiz tovar', salePrices: [] }),
                ...PRODUCTS.items,
              ],
              total: 3,
            },
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    expect(screen.getByTestId('sotuv-proforma')).not.toBeDisabled();
  });
});

describe('Chek raqami — kassirning kunlik ketma-ketligi (2026-09-02)', () => {
  it('serverdan kelgan raqam chekka TUSHADI («SAVDO CHEKI № 121»)', async () => {
    vi.mocked(api.post).mockResolvedValue({ number: 121 });
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-proforma'));

    await waitFor(() => expect(printProformaReceiptViaAgent).toHaveBeenCalledTimes(1));
    const input = vi.mocked(printProformaReceiptViaAgent).mock.calls[0]?.[0] as { name: string };
    expect(input.name).toBe('121');
  });

  it('so`rov YIQILSA chek baribir chiqadi — vaqt-raqami zaxira', async () => {
    // 🔴 Tarmoq uzilgani uchun mijozni qog'ozsiz qoldirish yomonroq natija.
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await addFirstProduct(user);

    await user.click(screen.getByTestId('sotuv-proforma'));

    await waitFor(() => expect(printProformaReceiptViaAgent).toHaveBeenCalledTimes(1));
    const input = vi.mocked(printProformaReceiptViaAgent).mock.calls[0]?.[0] as { name: string };
    expect(input.name).toMatch(/^CHEK-\d{6}$/);
  });

  /**
   * S-reja S4 — zaxira raqamning MINTAQASI.
   *
   * Vaqt MANBASI S2 da `serverNow()` bo'lgan, lekin raqam hamon
   * `now.getHours()` bilan — ya'ni QURILMA mintaqasida — yasalardi. Endi
   * do'kon (Toshkent) devor-soatida.
   *
   * 🔴 SHAKL QULFI birga turadi: `CHEK-` + AYNAN 6 raqam. Bu IDENTIFIKATOR,
   * uning formati va takrorlanmaslik kafolati bu fazada O'ZGARMASLIGI kerak
   * edi — shuning uchun mintaqa da'vosi bilan bir testda tekshiriladi.
   */
  it('zaxira raqam Toshkent soatida yasaladi (shakl O`ZGARMAYDI)', async () => {
    // `vi.setSystemTime` bu yerda ISHLATILMAYDI: sahifa react-query polling'i
    // bilan keladi va soxta taymer oqimni qotirib qo'yadi (o'lchandi — test
    // 5 s da timeout bo'ldi). O'rniga chaqiruv REAL vaqt oynasi ichida ushlanadi
    // va kutilgan qiymatlar shu oynadan MUSTAQIL formula bilan yasaladi.
    const two = (n: number) => n.toString().padStart(2, '0');
    /** Toshkent (UTC+5) devor-soati — `posTimeDigits` dan MUSTAQIL hisob. */
    const tashkentDigits = (ms: number) => {
      const d = new Date(ms + 5 * 60 * 60 * 1_000);
      return `${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
    };
    /** Qurilma mintaqasidagi ko'rinish — tuzatishdan OLDINGI xulq. */
    const deviceDigits = (ms: number) => {
      const d = new Date(ms);
      return `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    };
    const windowOf = (from: number, to: number, f: (ms: number) => string) => {
      const out = new Set<string>();
      for (let t = from - 1_000; t <= to + 1_000; t += 250) out.add(f(t));
      return out;
    };

    vi.stubEnv('TZ', 'Pacific/Honolulu'); // UTC−10, Toshkentdan 15 soat orqada
    try {
      vi.mocked(api.post).mockRejectedValue(new Error('network'));
      const user = userEvent.setup();
      renderWithProviders(<SotuvPage />);
      await addFirstProduct(user);

      const before = Date.now();
      await user.click(screen.getByTestId('sotuv-proforma'));
      await waitFor(() => expect(printProformaReceiptViaAgent).toHaveBeenCalledTimes(1));
      const after = Date.now();

      const input = vi.mocked(printProformaReceiptViaAgent).mock.calls[0]?.[0] as { name: string };
      expect(input.name).toMatch(/^CHEK-\d{6}$/); // 🔴 SHAKL — o'sha-o'sha
      const digits = input.name.slice('CHEK-'.length);
      expect(windowOf(before, after, tashkentDigits), 'Toshkent soati emas').toContain(digits);
      expect(windowOf(before, after, deviceDigits), 'qurilma soati chiqdi').not.toContain(digits);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
