/**
 * F11 — `/sotuv` dan Z-hisobotni chop etish.
 *
 * Qulflanadigan shartnomalar:
 *  · «Smena» yorlig'ida chop tugmasi bor va u AYNAN joriy smenaning id'si
 *    bilan chaqiriladi;
 *  · chop yo'li chekникиdek: agent/Electron → popup fallback
 *    (`/print/z-report/<id>?auto=1`), agent hal qilsa popup OCHILMAYDI;
 *  · smena yopilgandan keyin ham chop tugmasi qoladi — smena yopilishi
 *    bilan ekran «smena ochish» holatiga qaytadi va Z-hisobotga yo'l
 *    yo'qolib qolmasin.
 */

import { api } from '@/lib/api-client';
import { printZReportViaAgent } from '@/lib/print-agent';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { type Route, router, salesRoutes } from './harness';

// FAZA 1 (kassa ikki tilli, 2026-09-01) — «Smena» ekrani endi `PosLocaleToggle`
// ni ham chizadi, u esa `useRouter()` chaqiradi. Testda App Router konteksti
// YO'Q ⇒ dublyorsiz butun sahifa «invariant expected app router to be mounted»
// bilan yiqiladi (ekran bo'sh qoladi va sabab hech qayerda ko'rinmaydi).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
  printZReportViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
}));

const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function shiftRoutes(over: Route[] = []): Route[] {
  return salesRoutes([
    ...over,
    { match: /\/z-report$/, value: { expectedCashMinor: '5000000', expectedUsdCashMinor: '0' } },
    { match: /^\/expense-items/, value: { items: [] } },
    { match: /^\/cashier-sessions\/cash-out-recipients$/, value: [] },
    { match: /^\/counterparties\?/, value: { items: [] } },
    // Smena yopilgach ekran «smena ochish» formasiga qaytadi — u shu
    // marshrutni so'raydi.
    { match: /^\/admin\/smenas\/mine$/, value: { smena: null, withinShift: false } },
  ]);
}

const POST_ROUTES: Route[] = [{ match: /\/close$/, value: { ok: true } }];

async function openShiftTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Smena/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(router(shiftRoutes()));
  vi.mocked(api.post).mockImplementation(router(POST_ROUTES));
  vi.mocked(printZReportViaAgent).mockResolvedValue({ handled: true, ok: true });
  window.open = vi.fn();
});

describe('«Smena» yorlig‘idagi Z-hisobot chop tugmasi', () => {
  it('joriy smenaning id‘si bilan chop yo‘liga uzatiladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('print-z-report'));
    await waitFor(() => expect(printZReportViaAgent).toHaveBeenCalled());
    expect(vi.mocked(printZReportViaAgent).mock.calls[0]?.[0]).toBe(SESSION_ID);
  });

  it('agent chop etsa — brauzer popup‘i OCHILMAYDI', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('print-z-report'));
    await waitFor(() => expect(printZReportViaAgent).toHaveBeenCalled());
    expect(window.open).not.toHaveBeenCalled();
  });

  it('agent yo‘q bo‘lsa — `/print/z-report/<id>?auto=1` popup‘i ochiladi', async () => {
    vi.mocked(printZReportViaAgent).mockResolvedValue({ handled: false, ok: false });
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('print-z-report'));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(vi.mocked(window.open).mock.calls[0]?.[0]).toBe(`/print/z-report/${SESSION_ID}?auto=1`);
  });
});

describe('Smena yopilgandan keyin', () => {
  it('yopilgan smenaning Z-hisobotini chop etish yo‘li QOLADI', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByRole('button', { name: 'Smenani yopish' }));
    // F5 (blind sanoq): kutilgan endi sanoq bosqichida ko'rinmaydi — sanoq
    // teriladi va «Davom etish» bilan review'ga o'tiladi, tasdiq o'sha yerda.
    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '50000');
    await user.click(screen.getByTestId('close-continue'));

    // Smena yopilgach ekran «smena ochish» holatiga qaytadi — shu paytda
    // ham chop tugmasi ko'rinib turishi kerak.
    vi.mocked(api.get).mockImplementation(
      router(shiftRoutes([{ match: /^\/cashier-sessions\/current$/, value: null }])),
    );
    await user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));

    const btn = await screen.findByTestId('print-closed-z-report');
    await user.click(btn);
    await waitFor(() => expect(printZReportViaAgent).toHaveBeenCalled());
    expect(vi.mocked(printZReportViaAgent).mock.calls.at(-1)?.[0]).toBe(SESSION_ID);
  });
});
