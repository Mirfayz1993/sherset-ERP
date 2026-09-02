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
});
