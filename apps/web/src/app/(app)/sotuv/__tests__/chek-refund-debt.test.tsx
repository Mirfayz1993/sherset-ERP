import { api } from '@/lib/api-client';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { type Route, SALE_DETAIL, SALE_ROW, at, norm, router, salesRoutes } from './harness';

/**
 * F5 (audit 2026-08-11) — QARZGA sotilgan chekni POS'dan qaytarish.
 *
 * Ilgari MUMKIN EMAS edi: ekran har doim to'liq naqd so'rardi
 * (`cashAmountMinor` = butun qiymat), server esa `validateRefundSettlement`
 * bilan «payout kassa olgan puldan ko'p» deb 400 qaytarardi (xom inglizcha
 * matn). Kassir qarzli chekni umuman qaytara olmasdi.
 *
 * Endi ekran chekning qarz ulushini `payments` qatorlaridan o'qiydi va
 * serverning `moneyCap` formulasi bilan naqd ulushini yuboradi; qarz
 * ulushini ATAYLAB yubormaydi — server auto-split qiladi.
 */

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
}));

const LIST_ROW = SALE_ROW({
  state: 'posted',
  sumMinor: '1800000',
  agent: { id: 'cp-1', name: 'Usta Vali' },
});

/** 18 000 so'mlik chek: 6 000 naqd olingan, 12 000 qarzga qoldirilgan. */
const PART_DEBT = [
  {
    method: 'CASH_UZS',
    amountMinor: '600000',
    currency: 'UZS',
    rateMinor: null,
    amountBaseMinor: '600000',
  },
  {
    method: 'DEBT',
    amountMinor: '1200000',
    currency: 'UZS',
    rateMinor: null,
    amountBaseMinor: '1200000',
  },
];

function chekRoutes(detail: Record<string, unknown> = {}): Route[] {
  return salesRoutes([
    { match: /limit=100/, value: { items: [LIST_ROW], total: 1 } },
    { match: /^\/retail-sales\/[^/?]+$/, value: SALE_DETAIL(detail) },
  ]);
}

async function openRefund(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
  await user.click(await screen.findByRole('button', { name: /Usta Vali/ }));
  await screen.findByText('CHEK-00001');
  await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
  // 2026-09-01: rejim endi 0 bilan ochiladi (chek-detail-panel.test.tsx da
  // qulflangan) — bu fayl TO'LIQ qaytarish summalarini sinaydi, shuning uchun
  // «Hammasini qaytarish» bosiladi.
  await user.click(screen.getByTestId('pos-refund-fill-all'));
}

function refundQtyInputs(): HTMLElement[] {
  return screen.getAllByRole('textbox').filter((el) => el.getAttribute('inputmode') === 'decimal');
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ ok: true });
  window.open = vi.fn();
});

describe('ChekDetailPanel — qarzli chekni qaytarish', () => {
  it('naqd ulushi chek QANDAY yopilganidan kelib chiqadi (18 000 dan 6 000)', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: PART_DEBT })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    expect(norm(footer.textContent)).toContain('6 000,00 сум');
  });

  it('qarzdan yechiladigan qism kassirga KO‘RSATILADI', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: PART_DEBT })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const row = screen.getByText('Qarzdan yechiladi').parentElement as HTMLElement;
    expect(norm(row.textContent)).toContain('12 000,00 сум');
  });

  it('so‘rovda naqd = kassa olgan pul; qarz ulushi YUBORILMAYDI (server auto-split)', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: PART_DEBT })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    await user.click(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/retail-sales/s-1/refund', {
      positions: [{ productId: 'p-1', quantity: '2' }],
      cashAmountMinor: '600000',
      cardAmountMinor: '0',
      cashUsdReturnMinor: '0',
      description: 'POS qaytarish',
    });
  });

  it('TO‘LIQ qarzli chekda naqd 0 — tugma baribir ISHLAYDI', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        chekRoutes({
          payments: [
            {
              method: 'DEBT',
              amountMinor: '1800000',
              currency: 'UZS',
              rateMinor: null,
              amountBaseMinor: '1800000',
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const btn = screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ });
    // Ilgari bu holat imkonsiz edi: naqd 18 000 yuborilar va server 400 berardi.
    expect(btn).toBeEnabled();
    await user.click(btn);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body.cashAmountMinor).toBe('0');
  });

  it('qisman qaytarishda naqd ham proporsional kamayadi', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: PART_DEBT })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const input = at(refundQtyInputs(), 0);
    await user.clear(input);
    await user.type(input, '1');

    // 9 000 qaytariladi ⇒ naqd ulushi 6 000 × 9 000 / 18 000 = 3 000.
    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    expect(norm(footer.textContent)).toContain('3 000,00 сум');
  });

  it('to‘lov qatorlari yo‘q ESKI chekda xulq o‘zgarmaydi (hammasi naqd)', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes()));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    expect(norm(footer.textContent)).toContain('18 000,00 сум');
    expect(screen.queryByText('Qarzdan yechiladi')).not.toBeInTheDocument();
  });
});

/**
 * P5 (2026-08-12) — KARTA/TERMINAL bilan to'langan chekni qaytarish.
 *
 * Prodda o'lchandi (R1): bunday chek NAQD qaytarilib kassa qoldig'i 200
 * so'mga tushdi — yashiq hech qachon olmagan pulni chiqarib yubordi. Server
 * endi rad etadi, ya'ni ekran ham bo'linishi SHART: aks holda kassir karta
 * chekini umuman qaytara olmasdi (400 ga urilardi).
 */
const CARD_ONLY = [
  {
    method: 'CARD',
    amountMinor: '1800000',
    currency: 'UZS',
    rateMinor: null,
    amountBaseMinor: '1800000',
  },
];

/** 18 000: 6 000 naqd + 12 000 terminal. */
const CASH_PLUS_TERMINAL = [
  {
    method: 'CASH_UZS',
    amountMinor: '600000',
    currency: 'UZS',
    rateMinor: null,
    amountBaseMinor: '600000',
  },
  {
    method: 'TERMINAL',
    amountMinor: '1200000',
    currency: 'UZS',
    rateMinor: null,
    amountBaseMinor: '1200000',
  },
];

describe('ChekDetailPanel — karta/terminal chekini qaytarish (P5)', () => {
  it('100% KARTA chek: naqd 0, hammasi karta qatorida yuboriladi', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: CARD_ONLY })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    await user.click(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/retail-sales/s-1/refund', {
      positions: [{ productId: 'p-1', quantity: '2' }],
      cashAmountMinor: '0',
      cardAmountMinor: '1800000',
      cashUsdReturnMinor: '0',
      description: 'POS qaytarish',
    });
  });

  it('kassirga «naqd berilmaydi» deb OCHIQ aytiladi', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: CARD_ONLY })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const row = screen.getByTestId('pos-refund-card-share');
    expect(norm(row.textContent)).toContain('18 000,00 сум');
    expect(screen.getByText(/Naqd berilmaydi/)).toBeInTheDocument();
    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    expect(norm(footer.textContent)).toContain('0,00');
  });

  it('ARALASH (naqd + terminal) chek har kanalga o‘z ulushida bo‘linadi', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: CASH_PLUS_TERMINAL })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    await user.click(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body.cashAmountMinor).toBe('600000');
    expect(body.cardAmountMinor).toBe('1200000');
  });

  it('naqd chekda karta qatori UMUMAN ko‘rinmaydi (yolg‘on signal yo‘q)', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: PART_DEBT })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    expect(screen.queryByTestId('pos-refund-card-share')).not.toBeInTheDocument();
  });
});

/**
 * DOLLAR ulushi bo'lgan chekni qaytarish (2026-08-17, prodda o'lchangan
 * yo'qotishdan keyin).
 *
 * 🔴 Ilgari POS dollar ulushini SO'M naqd qatoriga qo'shib yuborardi va
 * kassa so'm bilan to'lab, dollarni yashiqda ushlab qolardi (ТРН-2026-00318:
 * 1 200 000 so'm yo'qotish). Endi dollar `cashUsdReturnMinor` bo'lib, SENTDA,
 * alohida ketadi va so'm qatori faqat so'mda olingan pulni o'z ichiga oladi.
 */
describe('dollarli chekni qaytarish — dollar dollarda ketadi', () => {
  // 18 000 so'mlik chek: 6 000 so'm naqd + $1.00 (kurs 12 000 ⇒ 12 000 so'm).
  const USD_MIX = [
    {
      method: 'CASH_UZS',
      amountMinor: '600000',
      currency: 'UZS',
      rateMinor: null,
      amountBaseMinor: '600000',
    },
    {
      method: 'CASH_USD',
      amountMinor: '100',
      currency: 'USD',
      rateMinor: '1200000000000',
      amountBaseMinor: '1200000',
    },
  ];

  it('so`m qatori faqat SO`MDA olingan pul, dollar alohida SENTDA', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: USD_MIX })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    await user.click(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    expect(api.post).toHaveBeenCalledWith('/retail-sales/s-1/refund', {
      positions: [{ productId: 'p-1', quantity: '2' }],
      // 🔴 Bu yerda 1 800 000 (to'liq summa) TURSA — aynan prodda pul
      // yo'qotgan xato qaytgan bo'ladi.
      cashAmountMinor: '600000',
      cardAmountMinor: '0',
      cashUsdReturnMinor: '100',
      description: 'POS qaytarish',
    });
  });

  it('kassirga dollar qatori KO`RSATILADI (nima qaytarishini bilsin)', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ payments: USD_MIX })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openRefund(user);

    const row = screen.getByTestId('pos-refund-usd-share');
    expect(row.textContent).toContain('$1.00');
  });
});
