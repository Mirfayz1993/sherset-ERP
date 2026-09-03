import { api } from '@/lib/api-client';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { type Route, SALE_ROW, router, salesRoutes } from './harness';

/**
 * VOZVRAT OYNASI (V2/V4) — bu rejimning BIRINCHI komponent testi.
 *
 * V4 (egasi, 2026-09-03): «mijozni tanladik va shu mijozdagi ma'lum tovarni
 * topmoqchimiz» — mijoz chipi ostidagi tovar-filtri. Serverga MATN
 * (`productSearch`) bo'lib ketadi, aniq kartochka ID'si emas: jonlida bir
 * tovarning bir nechta kartochkasi bo'ladi (2026-09-02 da o'lchandi) va aniq
 * kartochka tanlansa kassir ikkinchisidagi chekni topolmaydi.
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
}));

const AGENT = { id: 'cp-1', name: 'rustam elek / elyor aka', phone: '+998901112233' };

/** Mijozning ikki cheki; tovar filtri qo'yilganda faqat bittasi qoladi. */
const AGENT_SALES = {
  items: [
    SALE_ROW({
      id: 's-1',
      name: 'CHEK-00001',
      state: 'posted',
      sumMinor: '449000000',
      agent: AGENT,
    }),
    SALE_ROW({ id: 's-2', name: 'CHEK-00002', state: 'posted', sumMinor: '120000', agent: AGENT }),
  ],
  total: 2,
};

const FILTERED_SALES = {
  items: [
    SALE_ROW({ id: 's-2', name: 'CHEK-00002', state: 'posted', sumMinor: '120000', agent: AGENT }),
  ],
  total: 1,
};

function vozvratRoutes(over: Route[] = []): Route[] {
  return salesRoutes([
    ...over,
    { match: /^\/counterparties\?/, value: { items: [AGENT], total: 1 } },
    // Tovar filtri BILAN — umumiy `agentId` marshrutidan OLDIN turishi shart.
    { match: /^\/retail-sales\?.*productSearch=/, value: FILTERED_SALES },
    { match: /^\/retail-sales\?.*agentId=/, value: AGENT_SALES },
  ]);
}

/** Vozvrat rejimini ochib, «Mijoz» tabidan mijozni tanlaydi. */
async function pickAgent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Vozvrat' }));
  await user.click(screen.getByTestId('pos-vozvrat-tab-agent'));
  await user.type(screen.getByTestId('pos-vozvrat-search'), 'rustam');
  await user.click(await screen.findByRole('button', { name: /rustam elek/ }));
}

/** So'nggi `/retail-sales?` so'rovlari (boshqa POS so'rovlaridan ajratilgan). */
function saleCalls(): string[] {
  return vi
    .mocked(api.get)
    .mock.calls.map((c) => String(c[0]))
    .filter((u) => u.startsWith('/retail-sales?'));
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(vozvratRoutes()));
  vi.mocked(api.post).mockResolvedValue({ ok: true });
  window.open = vi.fn();
});

describe('Vozvrat oynasi — mijoz cheklari ichidan tovar qidirish (V4)', () => {
  it('mijoz tanlangach tovar-filtri maydoni PAYDO bo`ladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    expect(await screen.findByTestId('pos-vozvrat-product-filter')).toBeInTheDocument();
  });

  it('mijoz tanlanmaguncha tovar-filtri YO`Q', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: 'Vozvrat' }));
    await user.click(screen.getByTestId('pos-vozvrat-tab-agent'));

    expect(screen.queryByTestId('pos-vozvrat-product-filter')).not.toBeInTheDocument();
  });

  it('TOVAR tabida bu maydon umuman chizilmaydi (tovar allaqachon tanlangan)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: 'Vozvrat' }));
    // Sukut — «Tovar» tabi.
    expect(screen.queryByTestId('pos-vozvrat-product-filter')).not.toBeInTheDocument();
  });

  it('🔴 ASOSIY HOLAT: matn yozilsa so`rovga `productSearch` MIJOZ bilan BIRGA ketadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    await user.type(await screen.findByTestId('pos-vozvrat-product-filter'), 'izolenta');

    await waitFor(() => {
      expect(saleCalls().some((u) => u.includes('productSearch=izolenta'))).toBe(true);
    });
    const withFilter = saleCalls().find((u) => u.includes('productSearch='));
    // Mijoz filtri YO'QOLMAYDI — ikkalasi birga ketadi.
    expect(withFilter).toContain('agentId=cp-1');
    expect(withFilter).toContain('state=posted');
  });

  it('filtr natijani TORAYTIRADI (2 chekdan 1 tasi qoladi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    // Ro'yxat qatori chek RAQAMINI ko'rsatmaydi (summa + sana) — qatorlar
    // soni bo'yicha o'lchaymiz.
    await waitFor(() => expect(screen.getAllByTestId('pos-vozvrat-chek-row')).toHaveLength(2));

    await user.type(await screen.findByTestId('pos-vozvrat-product-filter'), 'izolenta');

    await waitFor(() => expect(screen.getAllByTestId('pos-vozvrat-chek-row')).toHaveLength(1));
  });

  it('maydon bo`sh bo`lsa `productSearch` YUBORILMAYDI (eski xulq)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    await waitFor(() => expect(saleCalls().some((u) => u.includes('agentId=cp-1'))).toBe(true));
    expect(saleCalls().some((u) => u.includes('productSearch='))).toBe(false);
  });

  it('✕ tugmasi filtrni tozalaydi va to`liq ro`yxat qaytadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    await user.type(await screen.findByTestId('pos-vozvrat-product-filter'), 'izolenta');
    await waitFor(() => expect(screen.getAllByTestId('pos-vozvrat-chek-row')).toHaveLength(1));

    await user.click(screen.getByTestId('pos-vozvrat-product-filter-clear'));
    await waitFor(() => expect(screen.getAllByTestId('pos-vozvrat-chek-row')).toHaveLength(2));
  });

  it('mijoz chipi o`chirilsa filtr ham tozalanadi (keyingi mijozga o`tib ketmasin)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    const input = await screen.findByTestId('pos-vozvrat-product-filter');
    await user.type(input, 'izolenta');
    await user.click(screen.getByTestId('pos-vozvrat-clear-filter'));

    // Chip ketdi ⇒ maydon ham ketdi; qayta mijoz tanlaganda BO'SH keladi.
    expect(screen.queryByTestId('pos-vozvrat-product-filter')).not.toBeInTheDocument();
    await user.type(screen.getByTestId('pos-vozvrat-search'), 'rustam');
    await user.click(await screen.findByRole('button', { name: /rustam elek/ }));
    expect(await screen.findByTestId('pos-vozvrat-product-filter')).toHaveValue('');
  });

  it('topilmasa SABABI aytiladi (mijozda chek yo`q emas — shu tovar yo`q)', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        vozvratRoutes([
          { match: /^\/retail-sales\?.*productSearch=/, value: { items: [], total: 0 } },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await pickAgent(user);

    await user.type(await screen.findByTestId('pos-vozvrat-product-filter'), 'yoq-tovar');

    expect(
      await screen.findByText("Bu mijozda shunday tovar bo'lgan chek topilmadi"),
    ).toBeInTheDocument();
  });
});
