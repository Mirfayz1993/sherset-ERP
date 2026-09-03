import { renderWithProviders, screen, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION, router, salesRoutes } from './harness';

/**
 * SMENA EKRANIDA QAYTARISH KO'RINISHI (2026-08-17, egasi: «chekni qaytarish
 * qilgandan keyin summasi qaytmayapti»).
 *
 * 🔴 O'LCHANGAN: server `returnsCount`/`returnsSumMinor` ni ALLAQACHON
 * yuborardi (prod javobi: `returnsCount: 1`, `returnsSumMinor: '7300000'`),
 * lekin shartnomada e'lon qilinmagani uchun ekran ularni ISHLATMASDI —
 * kassir qaytarishdan keyin smena jamida hech qanday o'zgarish ko'rmasdi.
 */

// FAZA 1 (kassa ikki tilli, 2026-09-01) — «Smena» ekrani endi `PosLocaleToggle`
// ni ham chizadi, u esa `useRouter()` chaqiradi. Testda App Router konteksti
// YO'Q ⇒ dublyorsiz butun sahifa «invariant expected app router to be mounted»
// bilan yiqiladi (ekran bo'sh qoladi va sabab hech qayerda ko'rinmaydi).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

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
}));
const { api } = await import('@/lib/api-client');
const SotuvPage = (await import('../page')).default;

async function openSmena(session: ReturnType<typeof SESSION>) {
  // Smena marshruti umumiy ro'yxatdan OLDIN turishi kerak (router birinchi
  // mos kelganini oladi).
  vi.mocked(api.get).mockImplementation(
    router(salesRoutes([{ match: /^\/cashier-sessions\/current$/, value: session }])),
  );
  renderWithProviders(<SotuvPage />);
  const btn = await screen.findByTestId('pos-sidebar-item-smena');
  btn.click();
}

beforeEach(() => vi.clearAllMocks());

describe('Smena ekrani — qaytarish qatori', () => {
  it('qaytarish BO`LSA qator va SOF tushum ko`rinadi', async () => {
    await openSmena(
      SESSION({
        salesCount: 7,
        salesSumMinor: '3271900000',
        returnsCount: 1,
        returnsSumMinor: '7300000',
      }),
    );

    await waitFor(() => expect(screen.getByTestId('smena-returns-row')).toBeInTheDocument());
    // Sof tushum = 3 271 900 000 − 7 300 000 = 3 264 600 000
    const net = screen.getByTestId('smena-net-row');
    expect(net.textContent?.replace(/\u00a0/g, ' ')).toContain('32 646 000');
  });

  it('qaytarish YO`Q bo`lsa qator umuman chiqmaydi (nol qator chalg`itmasin)', async () => {
    await openSmena(SESSION({ returnsCount: 0, returnsSumMinor: '0' }));

    await waitFor(() => expect(screen.getByTestId('pos-sidebar-item-smena')).toBeInTheDocument());
    expect(screen.queryByTestId('smena-returns-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('smena-net-row')).not.toBeInTheDocument();
  });
});
