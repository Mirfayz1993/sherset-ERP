import { api } from '@/lib/api-client';
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { PRODUCTS, at, norm, router, salesRoutes } from './harness';

/**
 * 🔴 FAZA 1 BLOKLOVCHI TEKSHIRUVI (kassa ikki tilli, 2026-09-01).
 *
 * SAVOL: kassir savatda tovar turganda tilni almashtirsa — savat omon qoladimi?
 *
 * NEGA BU SAVOL UMUMAN BOR: savat oddiy React holati
 * (`sotuv/page.tsx:422` — `const [cart, setCart] = useState<CartLine[]>([])`).
 * U hech qayerga saqlanmaydi: server ham, `localStorage` ham bilmaydi (qoralama
 * FAQAT kassir `parkCart()` bosganda yoziladi). Ya'ni sahifa daraxti bir marta
 * uzilsa — mijoz oldida yig'ilgan savat YO'Q bo'ladi. Bu kassa uchun eng qimmat
 * regressiya sinfi, shuning uchun u kod bilan BIRGA qulflanadi.
 *
 * ⚠️ BU TEST NIMANI ISBOTLAYDI VA NIMANI ISBOTLAMAYDI — halol chegara:
 *   ISBOTLAYDI: til almashtirish yo'li savatni O'ZI buzmaydi — komponent
 *     `location.reload()` / `location.href` ga TEGMAYDI, `SotuvPage` qayta
 *     o'rnatilmaydi (unmount/remount), va almashtirishdan keyin savat qatorlari
 *     AYNAN o'sha holatda (nom, miqdor, jami) ekranda qoladi.
 *   ISBOTLAMAYDI: Next.js ish vaqtining `router.refresh()` semantikasi —
 *     bu yerda `useRouter` mock, ya'ni «refresh klient holatini saqlaydi»
 *     da'vosi Next hujjatidan olingan, shu testdan EMAS. Uni faqat jonli
 *     `.exe`/dev-serverda tasdiqlash mumkin (Faza 3 qabul mezoni).
 * Shu sababdan test o'z nomini ham shunga qarab tutadi: u KOMPONENT yo'lini
 * qulflaydi, freymvork xulqini emas.
 */

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
}));

const setLocale = vi.fn();
const routerRefresh = vi.fn();

vi.mock('@/app/actions/locale', () => ({ setLocale: (next: string) => setLocale(next) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(salesRoutes()));
  setLocale.mockReset().mockResolvedValue(undefined);
  routerRefresh.mockReset();
  window.localStorage.clear();
});

/** Savat qatorlarining o'qiladigan «suratini» oladi (nom + matn tarkibi). */
function cartSnapshot(): string[] {
  return screen.getAllByTestId('sotuv-cart-line').map((l) => norm(l.textContent));
}

describe('🔴 BLOKLOVCHI — til almashtirilganda savat omon qoladi', () => {
  it('2 qatorli savat til almashtirilgandan keyin AYNAN o`sha holatda qoladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    // ── 1. Savatga IKKI xil tovar ─────────────────────────────────────────
    const tiles = await screen.findAllByTestId('sotuv-product');
    await user.click(at(tiles, 0));
    await user.click(at(tiles, 1));

    await waitFor(() => expect(screen.getAllByTestId('sotuv-cart-line')).toHaveLength(2));
    const before = cartSnapshot();
    // Fikstura haqiqatan ikki XIL tovar bergani tasdiqlanadi — aks holda
    // «savat saqlandi» da'vosi bo'sh bo'lardi (bir xil ikki qator farqsiz).
    expect(at(before, 0)).toContain(at(PRODUCTS.items, 0).name);
    expect(at(before, 1)).toContain(at(PRODUCTS.items, 1).name);

    // ── 2. «Smena» sozlamalariga o'tib tilni almashtirish ──────────────────
    await user.click(await screen.findByTestId('pos-sidebar-item-smena'));

    const toggle = await screen.findByTestId('pos-locale-toggle');
    await user.click(within(toggle).getByTestId('pos-locale-ru'));

    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('ru'));
    expect(routerRefresh).toHaveBeenCalledTimes(1);

    // ── 3. Savatga qaytish — hech narsa yo'qolmagan bo'lishi kerak ────────
    await user.click(await screen.findByTestId('pos-sidebar-item-sotuv'));

    await waitFor(() => expect(screen.getAllByTestId('sotuv-cart-line')).toHaveLength(2));
    expect(cartSnapshot()).toEqual(before);
  });

  it('almashtirish yo`li sahifani TO`LIQ qayta yuklamaydi (reload/href tegilmaydi)', async () => {
    // To'liq reload savatni yo'qotardi — shuning uchun bu YO'LNING o'zi
    // qulflanadi, natijasi emas: kelajakda kimdir `location.reload()` qo'shsa
    // (masalan «ishonchli bo'lsin» deb) test darhol qizaradi.
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload, assign: vi.fn(), replace: vi.fn() },
    });

    try {
      const user = userEvent.setup();
      renderWithProviders(<SotuvPage />);

      const tiles = await screen.findAllByTestId('sotuv-product');
      await user.click(at(tiles, 0));
      await screen.findByTestId('sotuv-cart-line');

      await user.click(await screen.findByTestId('pos-sidebar-item-smena'));
      const toggle = await screen.findByTestId('pos-locale-toggle');
      await user.click(within(toggle).getByTestId('pos-locale-ru'));

      await waitFor(() => expect(setLocale).toHaveBeenCalledWith('ru'));
      expect(reload).not.toHaveBeenCalled();
      expect(window.location.assign).not.toHaveBeenCalled();
      expect(window.location.replace).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
