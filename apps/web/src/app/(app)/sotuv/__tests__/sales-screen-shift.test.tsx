/**
 * MK32 — «Smena» yorlig'i: kassa operatsiyalari, qarz to'lovi oynasi,
 * kassadan chiqim oynasi va smena yopish (kassa TZ §7.2, §8.2–§8.5, §11).
 *
 * **Xulq O'ZGARTIRILMAYDI.** Qulflanayotgan shartnomalar:
 *  · naqd qarz to'lovi shu smenaga bog'lanadi (`retailShiftId`);
 *  · chiqim hujjatida faqat O'Z turiga tegishli maydon yuboriladi;
 *  · sanalmagan dollar `null` bo'lib QOLADI — 0 bilan aralashmaydi;
 *  · izoh maydoni FAQAT farq bo'lganda ko'rinadi.
 *
 * F5 (2026-08-14, spec §5.4 Q7): smena yopish bo'limi YOPIQ (blind) sanoqqa
 * o'tdi — o'sha bo'limning eski «kutilgan oldindan ko'rinadi» testlari yangi
 * niyat bilan qayta yozildi (sabab o'z describe'ida); farq≠0 da izoh endi
 * MAJBURIY.
 */

import { api } from '@/lib/api-client';
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { type Route, SALE_DETAIL, at, norm, router, salesRoutes } from './harness';

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
  // F11 — smena yopilganda sahifa Z-hisobotni ham chop yo'liga uzatadi.
  printZReportViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
  // Qarz to'lovi muvaffaqiyatida sahifa qarz-chekini ham chop yo'liga uzatadi
  // (`printDebtReceipt`); eksport mockda yo'qligi test TUGAGACH otiladigan
  // «Unhandled Rejection» edi (2026-08-16 to'liq-suite'da tutildi) — suite'ni
  // nondeterministik qizartiradigan yashirin manba.
  printDebtReceiptViaAgent: vi.fn(async () => ({ handled: true, ok: true })),
}));

const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const CASH_DESK_ID = '55555555-5555-4555-8555-555555555555';

const DEBT_SUMMARY = {
  counterparty: { id: 'cp-1', name: 'Usta Vali', phone: '+998 90 111 22 33' },
  // P1 — oyna endi `payableMinor` ni o'qiydi (server `debtPayable` bilan bir
  // formula). Bu fixture'da balans reyestrga TENG ⇒ adopsiya yo'q, ya'ni
  // smena/kassa wiring xulqi o'zgarmaydi.
  payableMinor: '5000000',
  adoptableMinor: '0',
  outstandingMinor: '5000000',
  openCount: 2,
  oldestAt: '2026-07-01T10:00:00.000Z',
  debts: [
    {
      id: 'd-1',
      name: 'QRZ-00001',
      totalMinor: '3000000',
      paidMinor: '0',
      outstandingMinor: '3000000',
      currency: 'UZS',
      orderAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'd-2',
      name: 'QRZ-00002',
      totalMinor: '2000000',
      paidMinor: '0',
      outstandingMinor: '2000000',
      currency: 'UZS',
      orderAt: '2026-07-20T10:00:00.000Z',
    },
  ],
};

function shiftRoutes(over: Route[] = []): Route[] {
  return salesRoutes([
    ...over,
    {
      match: /\/z-report$/,
      value: {
        expectedCashMinor: '5000000',
        expectedUsdCashMinor: '0',
        // «Kassada bo'lishi kerak» summasining tarkibi — smena kartasidagi
        // «Qarz to'lovlari (naqd)» qatorining manbai (egasi, 2026-08-19).
        cashBreakdown: {
          openingMinor: '1000000',
          salesCashMinor: '1500000',
          debtCashMinor: '2500000',
          drawerInMinor: '0',
          drawerOutMinor: '0',
          returnsCashMinor: '0',
          sumMinor: '5000000',
        },
      },
    },
    { match: /^\/expense-items/, value: { items: [{ id: 'ei-1', name: 'Ijara' }] } },
    {
      match: /^\/cashier-sessions\/cash-out-recipients$/,
      value: [{ id: 'r-1', name: 'Direktor' }],
    },
    {
      match: /^\/counterparties\?/,
      // `tags`/`companyType` SHART: to'lov oynasi (Rasmiyashtirish) mijoz
      // qatorini chizishda `tags.includes(...)` o'qiydi — F5 ro'yxatidagi
      // «To'lov» shu oynani ochadi.
      value: {
        items: [
          {
            id: 'cp-1',
            name: 'Usta Vali',
            phone: '+998 90 111 22 33',
            tags: [],
            companyType: 'individual',
          },
        ],
      },
    },
    { match: /^\/debts\/pos\/summary\//, value: DEBT_SUMMARY },
  ]);
}

const POST_ROUTES: Route[] = [
  // F5 — yakunlanmagan chekni bekor qilish (ro'yxat kartasidagi tugma).
  { match: /\/cancel$/, value: { ok: true } },
  { match: /\/drawer-(in|out)$/, value: { ok: true } },
  {
    match: /\/cash-out$/,
    value: { id: 'co-1', name: 'RKO-00001', kind: 'expense', sumMinor: '5000000', auditTypes: [] },
  },
  { match: /^\/debts\/pos\/pay$/, value: { batchId: 'b-1', closedCount: 1, receipt: {} } },
  { match: /\/close$/, value: { ok: true } },
];

/** «Smena» yorlig'iga o'tadi. */
async function openShiftTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Smena/ }));
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(shiftRoutes()));
  vi.mocked(api.post).mockImplementation(router(POST_ROUTES));
  // Chek/PKO chiqarish oynasi — testda ochilmasin.
  window.open = vi.fn();
});

describe('Smena yorlig‘i — ma‘lumot', () => {
  it('kassir, ombor, kassa va smena yig‘indisi ko‘rinadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    expect(screen.getAllByText('Kassir Aliyev').length).toBeGreaterThan(0);
    expect(screen.getByText('Asosiy kassa')).toBeInTheDocument();
    expect(norm(screen.getByText(/3 ta ·/).textContent)).toBe('3 ta · 1 500,00 сум');
    expect(screen.getByRole('link', { name: /Z-hisobot/ })).toHaveAttribute(
      'href',
      `/retail/sessions/${SESSION_ID}`,
    );
  });
});

/**
 * 🔴 Egasi, 2026-08-19 (chek №EA8E779A): kassir naqd qarz to‘lovini qabul
 * qildi — pul yashiqqa tushdi, smenaga bog‘landi va kutilgan naqd
 * formulasiga ham KIRDI, lekin kassa ekranida smena bo‘yicha faqat
 * «Sotuvlar» summasi turardi: qabul qilingan qarz puli hech qayerda
 * ko‘rinmasdi. Endi alohida qator bor.
 *
 * Kutilgan naqd JAMISI bu kartada ATAYLAB yo‘q — yopish sanog‘i yopiq
 * (F5/Q7): kassir kutilgan raqamni sanoqdan oldin ko‘rmasligi kerak.
 */
describe('Smena yorlig‘i — qabul qilingan naqd qarz to‘lovi', () => {
  it('🔴 «Qarz to‘lovlari (naqd)» qatori summasi bilan ko‘rinadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    const row = await screen.findByTestId('smena-debt-cash');
    expect(norm(row.textContent)).toContain('25 000,00');
  });

  it('kutilgan naqd JAMISI kartada CHIZILMAYDI (yopiq sanoq buzilmaydi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await screen.findByTestId('smena-debt-cash');
    // 5 000 000 tiyin = «50 000,00» — kutilgan naqd; kartada bo‘lmasligi shart.
    expect(screen.queryByText(/50 000,00/)).not.toBeInTheDocument();
  });

  it('eski API javobida tarkib bo‘lmasa qator chizilmaydi (oq ekran EMAS)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(
      router([
        {
          match: /\/z-report$/,
          value: { expectedCashMinor: '5000000', expectedUsdCashMinor: '0' },
        },
        ...shiftRoutes(),
      ]),
    );
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    expect(screen.getAllByText('Kassir Aliyev').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('smena-debt-cash')).not.toBeInTheDocument();
  });
});

describe('Smena yorlig‘i — kassa kirim/chiqim', () => {
  it('«Kirim» maydonlarni ochadi; summa 0 ekan tasdiq BLOKLANGAN', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    expect(screen.queryByPlaceholderText(/Summa \(so.m\)/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Kirim$/ }));
    expect(screen.getByPlaceholderText(/Summa \(so.m\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kirim tasdiqlash' })).toBeDisabled();
  });

  it('kirim summasi va izohi bilan yuboriladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByRole('button', { name: /Kirim$/ }));
    await user.type(screen.getByPlaceholderText(/Summa \(so.m\)/), '50000');
    await user.type(screen.getByPlaceholderText(/Izoh/), 'Boshlang‘ich pul');
    await user.click(screen.getByRole('button', { name: 'Kirim tasdiqlash' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/drawer-in`, {
      sumMinor: '5000000',
      description: 'Boshlang‘ich pul',
    });
  });

  it('chiqim — izohsiz `description: undefined` bilan ketadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByRole('button', { name: /Chiqim$/ }));
    await user.type(screen.getByPlaceholderText(/Summa \(so.m\)/), '20000');
    await user.click(screen.getByRole('button', { name: 'Chiqim tasdiqlash' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/drawer-out`, {
      sumMinor: '2000000',
      description: undefined,
    });
  });

  it('ochiq turgan tugmani qayta bosish maydonlarni yopadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByRole('button', { name: /Kirim$/ }));
    await user.click(screen.getByRole('button', { name: /Kirim$/ }));
    expect(screen.queryByPlaceholderText(/Summa \(so.m\)/)).not.toBeInTheDocument();
  });
});

describe('Qarz to‘lovi oynasi (kassa TZ §7.2)', () => {
  it('mijoz tanlangach qoldiq ko‘rinadi va «Hammasi» summani to‘ldiradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('pos-debt-pay-open'));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('debt-pay-cp-cp-1'));

    expect(norm((await within(dialog).findByTestId('debt-pay-outstanding')).textContent)).toBe(
      '50 000,00 сум',
    );
    expect(norm(dialog.textContent)).toContain('2 ta qarz');

    await user.click(within(dialog).getByRole('button', { name: /Hammasi/ }));
    expect(norm(within(dialog).getByTestId('debt-pay-amount').textContent)).toBe('50 000,00 сум');
  });

  it('to‘lov shu SMENAGA va kassaga bog‘lanib yuboriladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('pos-debt-pay-open'));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('debt-pay-cp-cp-1'));
    await user.click(await within(dialog).findByRole('button', { name: /Hammasi/ }));
    await user.click(within(dialog).getByTestId('debt-pay-confirm'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/debts/pos/pay', {
      counterpartyId: 'cp-1',
      amountMinor: '5000000',
      // F6: valyuta endi HAR DOIM oshkor ketadi (server default'iga tayanmaydi);
      // so'm to'lovda kurs YUBORILMAYDI.
      currency: 'UZS',
      method: 'cash',
      cashDeskId: CASH_DESK_ID,
      retailShiftId: SESSION_ID,
      // IDEMPOTENTLIK kaliti (Faza 3) — har urinishda YANGI uuid, shuning
      // uchun qiymat emas, SHAKLI pinlanadi. Kalitning o'zi bo'lmasa takroriy
      // bosish ikkinchi to'lovni yozardi, shuning uchun `expect.any(String)`
      // emas — aynan uuid shakli talab qilinadi.
      clientRequestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
  });

  it('qarzdan ORTIQ summa — ogohlantirish va tasdiq bloklanadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('pos-debt-pay-open'));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('debt-pay-cp-cp-1'));
    await user.click(await within(dialog).findByRole('button', { name: /Hammasi/ }));
    // 50 000 → 500 000: qarzdan 10 barobar ko'p.
    await user.click(within(dialog).getByRole('button', { name: '0' }));

    expect(within(dialog).getByText(/ko.p\. Qaytimni kassadan bering/)).toBeInTheDocument();
    expect(within(dialog).getByTestId('debt-pay-confirm')).toBeDisabled();
  });
});

describe('Kassadan chiqim oynasi (kassa TZ §8.2/§8.3)', () => {
  /** Numpad orqali summa teradi. */
  async function numpad(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    digits: string,
  ) {
    for (const d of digits) {
      await user.click(within(dialog).getByRole('button', { name: d }));
    }
  }

  it('modda tanlanmaguncha tasdiq BLOKLANGAN', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('pos-cash-out-open'));
    const dialog = await screen.findByRole('dialog');
    await numpad(user, dialog, '50000');

    expect(norm(within(dialog).getByTestId('cash-out-amount').textContent)).toBe('50 000,00 сум');
    expect(within(dialog).getByTestId('cash-out-confirm')).toBeDisabled();
  });

  it('xarajat — faqat `expenseItemId` yuboriladi, `recipientId` null', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('pos-cash-out-open'));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('cash-out-pick-ei-1'));
    await numpad(user, dialog, '50000');
    await user.click(within(dialog).getByTestId('cash-out-confirm'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/cash-out`, {
      kind: 'expense',
      sumMinor: '5000000',
      expenseItemId: 'ei-1',
      recipientId: null,
      description: null,
    });
  });

  it('inkassatsiya — ro‘yxat qabul qiluvchilarga almashadi va `recipientId` ketadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await user.click(screen.getByTestId('pos-cash-out-open'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByTestId('cash-out-kind-collection'));
    await user.click(await within(dialog).findByTestId('cash-out-pick-r-1'));
    await numpad(user, dialog, '50000');
    await user.click(within(dialog).getByTestId('cash-out-confirm'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/cash-out`, {
      kind: 'collection',
      sumMinor: '5000000',
      expenseItemId: null,
      recipientId: 'r-1',
      description: null,
    });
  });
});

/**
 * F5 (spec §5.4, Q7 — egasi qarori): smena yopish sanog'i endi YOPIQ (blind).
 *
 * ESKI NIYAT BEKOR: «kutilgan naqd TASDIQLASHDAN OLDIN ko'rsatiladi» degan
 * testlar shu yerda turardi — kassir sanashdan oldin kutilgan raqamni ko'rib,
 * sanoqni RAQAMGA MOSLAB yozishi mumkin edi (kamomad hech qachon ko'rinmasdi).
 * Yangi shartnoma: `counting` bosqichida kutilgan summa DOM'da YO'Q; kutilgan
 * va farq faqat `review` da chiqadi; farq≠0 bo'lsa izoh MAJBURIY; review'dan
 * sanoqni «to'g'irlab qo'yish»ga qaytish YO'Q (faqat butun oqimni bekor
 * qilish). Server o'zgarmagan — u baribir o'zi hisoblaydi.
 */
describe('Smena yopish — YOPIQ (blind) sanoq (F5, spec §5.4 Q7)', () => {
  /** Sanoq bosqichini ochadi va preview so'rovi KETGANini kutadi. */
  async function openCounting(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Smenani yopish' }));
    // Kutilgan-naqd so'rovi allaqachon JS xotirasida — quyidagi DOM-assertlar
    // «hali kelmagani uchun ko'rinmayapti» degan bo'sh holatni tekshirmasin.
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/z-report`),
    );
  }

  it('sanoq bosqichida kutilgan summa DOM‘da YO‘Q (blind — Q7 yadrosi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    expect(screen.queryByText('Kutilgan naqd')).not.toBeInTheDocument();
    expect(screen.queryByText(/50 000,00/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('close-variance')).not.toBeInTheDocument();
  });

  it('«Davom etish» sanoq kiritilmaguncha bloklangan', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    expect(screen.getByTestId('close-continue')).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '45000');
    expect(screen.getByTestId('close-continue')).toBeEnabled();
  });

  it('numpad sanoq maydoniga yozadi (sensorli kiritish)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: '000' }));
    expect(screen.getByPlaceholderText(/Kassadagi naqd pul/)).toHaveValue(45000);
  });

  it('review: Sanadingiz · Kutilgan · Farq; farq≠0 → izoh MAJBURIY', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '45000');
    await user.click(screen.getByTestId('close-continue'));

    expect(norm(screen.getByText('Sanadingiz').parentElement?.textContent)).toBe(
      'Sanadingiz45 000,00 сум',
    );
    expect(norm(screen.getByText('Kutilgan naqd').parentElement?.textContent)).toBe(
      'Kutilgan naqd50 000,00 сум',
    );
    expect(norm(screen.getByTestId('close-variance').textContent)).toBe('Kamomad-5 000,00 сум');

    // Farq bor — izohsiz yopib BO'LMAYDI (ilgari izoh ixtiyoriy edi; blind
    // oqimda farq sababi ayni damda yozilishi shart, ertaga hech kim eslamaydi).
    expect(screen.getByTestId('close-variance-note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toBeDisabled();
    await user.type(screen.getByTestId('close-variance-note'), 'qaytim xato berildi');
    expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/close`, {
      closingCashMinor: '4500000',
      varianceNote: 'qaytim xato berildi',
    });
  });

  it('farq yo‘q — izoh so‘ralmaydi va close darhol mumkin', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '50000');
    await user.click(screen.getByTestId('close-continue'));

    expect(norm(screen.getByTestId('close-variance').textContent)).toBe("Farq yo'q0");
    expect(screen.queryByTestId('close-variance-note')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/close`, {
      closingCashMinor: '5000000',
      varianceNote: null,
    });
  });

  it('review‘dan sanoqqa QAYTIB BO‘LMAYDI — faqat «Bekor» (sanoq tozalanadi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '45000');
    await user.click(screen.getByTestId('close-continue'));

    // Review'da sanoq maydoni ham, «Davom etish» ham YO'Q — farqni ko'rib
    // raqamni «to'g'irlab qo'yish» yo'li yopiq (Q7).
    expect(screen.queryByPlaceholderText(/Kassadagi naqd pul/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('close-continue')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('close-cancel'));

    // Oqim boshiga qaytdi: tugma qayta ko'rinadi, sanoq BO'SH boshlanadi.
    expect(screen.getByRole('button', { name: 'Smenani yopish' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Smenani yopish' }));
    expect(screen.getByPlaceholderText(/Kassadagi naqd pul/)).toHaveValue(null);
    expect(api.post).not.toHaveBeenCalledWith(
      `/cashier-sessions/${SESSION_ID}/close`,
      expect.anything(),
    );
  });

  it('dollar oqimi YO‘Q smenada dollar maydoni chizilmaydi va so‘rovda ham yo‘q', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    expect(screen.queryByTestId('close-cash-usd')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '50000');
    await user.click(screen.getByTestId('close-continue'));
    await user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/close`, {
      closingCashMinor: '5000000',
      varianceNote: null,
    });
  });

  it('dollar BOR: sanoqda maydon bor, kutilgan dollar KO‘RINMAYDI; review‘da sentda farq', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        shiftRoutes([
          {
            match: /\/z-report$/,
            value: { expectedCashMinor: '5000000', expectedUsdCashMinor: '10000' },
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await user.click(screen.getByRole('button', { name: 'Smenani yopish' }));

    // Dollar maydoni sanoq bosqichida BOR (usdInPlay — mavjud shart)…
    expect(await screen.findByTestId('close-cash-usd')).toBeInTheDocument();
    // …lekin kutilgan dollar (blind!) KO'RINMAYDI.
    expect(screen.queryByText('Kutilgan dollar')).not.toBeInTheDocument();

    await user.type(screen.getByTestId('close-cash-usd'), '90');
    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '50000');
    await user.click(screen.getByTestId('close-continue'));

    // K-2 shartnomasi saqlangan: minus `$` dan OLDIN («-$10.00»).
    expect(screen.getByText('Kutilgan dollar').parentElement?.textContent).toContain('$100.00');
    expect(norm(screen.getByTestId('close-variance-usd').textContent)).toBe('Kamomad-$10.00');

    // Dollar farqi ham izohni MAJBURIY qiladi.
    expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toBeDisabled();
    await user.type(screen.getByTestId('close-variance-note'), '10$ yo‘qoldi');
    await user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(`/cashier-sessions/${SESSION_ID}/close`, {
      closingCashMinor: '5000000',
      closingCashUsdMinor: '9000',
      varianceNote: '10$ yo‘qoldi',
    });
  });

  // 2026-08-16 prod-hodisa: kassir dollar maydonini BO'SH qoldirib «Davom
  // etish»ga o'tdi — review'da esa input ham, sanoqqa qaytish ham yo'q (Q7),
  // server 400 «sanalgan dollarni kiriting» deb 5 marta rad etdi. Kassir
  // «kiritadigan joy yo'q» holatida qolib ketdi. Shartnoma: server dollar
  // sanog'ini MAJBURIY qilgan holatda FE ham review'ga sanoqsiz O'TKAZMAYDI.
  it('dollar BOR, sanalmagan — «Davom etish» BLOKLANGAN va sabab ko‘rinadi', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        shiftRoutes([
          {
            match: /\/z-report$/,
            value: { expectedCashMinor: '5000000', expectedUsdCashMinor: '100' },
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await user.click(screen.getByRole('button', { name: 'Smenani yopish' }));
    expect(await screen.findByTestId('close-cash-usd')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '50000');
    // So'm sanaldi, dollar YO'Q — tugma yopiq, sabab yozuvi ko'rinadi.
    expect(screen.getByTestId('close-continue')).toBeDisabled();
    expect(screen.getByTestId('close-usd-required')).toBeInTheDocument();

    // «Sanadim, dollar qolmagan» = 0 ham qabul (null bilan aralashmaydi).
    await user.type(screen.getByTestId('close-cash-usd'), '0');
    expect(screen.getByTestId('close-continue')).toBeEnabled();
    expect(screen.queryByTestId('close-usd-required')).not.toBeInTheDocument();
  });

  // Xuddi shu hodisaning ikkinchi qirrasi: preview hali KELMAGAN payt
  // usdInPlay noma'lum — kassir tez terib «Davom etish»ni bossa, dollar
  // maydoni ko'rinmasdan review'ga o'tib qolardi. Preview kelmaguncha
  // davom etish yopiq (kutilgan summa baribir DOM'da YO'Q — blind buzilmaydi).
  it('preview kelmaguncha «Davom etish» ochilmaydi', async () => {
    vi.mocked(api.get).mockImplementation(
      router(shiftRoutes([{ match: /\/z-report$/, value: () => new Promise(() => {}) }])),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);
    await openCounting(user);

    await user.type(screen.getByPlaceholderText(/Kassadagi naqd pul/), '50000');
    expect(screen.getByTestId('close-continue')).toBeDisabled();
  });
});

/**
 * F5 (spec §5.4) — yakunlanmagan cheklar STRUKTURALI ro'yxati.
 *
 * Ilgari bu ro'yxat faqat close 400-xabarining MATNIDA yashardi; `draft`
 * chek esa POS'ning hech qaysi bo'limida ko'rinmasdi — «ko'rinmas bloklovchi»
 * shu edi. Endi «Smena» ekranida har chek karta: raqam · bosqich · summa +
 * amal tugmalari. To'lash faqat `ready` da (server `post()` faqat ready'dan);
 * bekor — mavjud `cancelSale` yo'li (tasdiq raqam+summa bilan). Server
 * qoidalari O'ZGARMAGAN — UI ro'yxat bo'sh bo'lgandagina yopishni ochadi,
 * lekin serverga baribir ishonadi (400 kelsa toast).
 */
describe('Yakunlanmagan cheklar ro‘yxati (F5, spec §5.4)', () => {
  const UNRESOLVED = {
    sales: [
      { id: 'u-d', name: 'ТРН-00001', state: 'draft', sumMinor: '1000000' },
      { id: 'u-p', name: 'ТРН-00002', state: 'picking', sumMinor: '2000000' },
      { id: 'u-r', name: 'ТРН-00003', state: 'ready', sumMinor: '3000000' },
    ],
  };

  function unresolvedRoutes(): Route[] {
    return shiftRoutes([
      { match: /\/unresolved$/, value: UNRESOLVED },
      {
        match: /^\/retail-sales\/u-r$/,
        value: SALE_DETAIL({ id: 'u-r', name: 'ТРН-00003', state: 'ready', sumMinor: '3000000' }),
      },
    ]);
  }

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(router(unresolvedRoutes()));
  });

  it('uch bosqich kartasi ko‘rinadi — DRAFT HAM (ilgari hech qaysi tabda yo‘q edi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    const cards = await screen.findAllByTestId('smena-unresolved-card');
    expect(cards).toHaveLength(3);

    const draft = at(cards, 0);
    expect(norm(draft.textContent)).toContain('ТРН-00001');
    expect(norm(draft.textContent)).toContain('Savatda');
    expect(norm(draft.textContent)).toContain('10 000,00');
    expect(norm(at(cards, 1).textContent)).toContain('Yig‘ilmoqda'.replace('‘', "'"));
    expect(norm(at(cards, 2).textContent)).toContain('Yig‘ilgan'.replace('‘', "'"));
  });

  it('draft va picking kartada FAQAT bekor; ready kartada To‘lov HAM bor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    const cards = await screen.findAllByTestId('smena-unresolved-card');
    // draft — to'lab bo'lmaydi (`post()` faqat ready'dan) — faqat bekor.
    expect(within(at(cards, 0)).queryByRole('button', { name: /To.lash/ })).toBeNull();
    expect(within(at(cards, 0)).getByRole('button', { name: 'Bekor qilish' })).toBeInTheDocument();
    // picking — hali yig'ilmagan — faqat bekor.
    expect(within(at(cards, 1)).queryByRole('button', { name: /To.lash/ })).toBeNull();
    expect(within(at(cards, 1)).getByRole('button', { name: 'Bekor qilish' })).toBeInTheDocument();
    // ready — ikkalasi ham.
    expect(within(at(cards, 2)).getByRole('button', { name: /To.lash/ })).toBeInTheDocument();
    expect(within(at(cards, 2)).getByRole('button', { name: 'Bekor qilish' })).toBeInTheDocument();
  });

  it('ready «To‘lov» MAVJUD to‘lov yo‘lini ochadi (chek savatga yuklanadi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    const cards = await screen.findAllByTestId('smena-unresolved-card');
    await user.click(within(at(cards, 2)).getByRole('button', { name: /To.lash/ }));

    // `loadReadyToCart` yo'li: chek detali o'qiladi va to'lov oynasi ochiladi.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/retail-sales/u-r'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('bekor — mavjud cancelSale: tasdiqda raqam+summa, POST /cancel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    const cards = await screen.findAllByTestId('smena-unresolved-card');
    await user.click(within(at(cards, 0)).getByRole('button', { name: 'Bekor qilish' }));

    const dialog = await screen.findByRole('dialog');
    expect(norm(dialog.textContent)).toContain('ТРН-00001');
    expect(norm(dialog.textContent)).toContain('10 000,00');
    await user.click(within(dialog).getByRole('button', { name: 'Chekni bekor qilish' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/retail-sales/u-d/cancel', {}));
  });

  it('ro‘yxat bo‘sh bo‘lmaganda «Smenani yopish» BLOKLANGAN (sabab yozuvi bilan)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    await screen.findAllByTestId('smena-unresolved-card');
    expect(screen.getByRole('button', { name: 'Smenani yopish' })).toBeDisabled();
    expect(screen.getByText(/avval ularni yoping/)).toBeInTheDocument();
  });

  it('ro‘yxat bo‘sh — blok chizilmaydi, yopish ochiq', async () => {
    // Default marshrutlar: `/unresolved` → { sales: [] }.
    vi.mocked(api.get).mockImplementation(router(shiftRoutes()));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    expect(screen.queryByTestId('smena-unresolved-card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Smenani yopish' })).toBeEnabled();
  });
});

/**
 * F8 (spec §8) — «Kassirni almashtirish» Smena ekranida. Almashinuv har doim
 * TOZA nuqtada: sessiya OCHIQ ekan tugma faol emas («avval smenani yoping»
 * izohi) — haqiqiy almashinuv smena yopilgandan keyingi ekranda (`Boshqa
 * kassir`, open-shift-form testlarida). Bo'lim faqat kassa ish o'rnida
 * (`isPosWorkstation`): oddiy admin-brauzerda chizilmaydi.
 */
describe('Kassirni almashtirish (F8) — smena OCHIQ holatda bloklangan', () => {
  const DEVICE = { deviceId: 'dev-1', deviceSecret: 'sec-1', name: 'Kassa-1' };

  it('kassa ish o‘rnida: tugma DISABLED + «avval smenani yoping» izohi', async () => {
    localStorage.setItem('sherset.pos-device', JSON.stringify(DEVICE));
    try {
      const user = userEvent.setup();
      renderWithProviders(<SotuvPage />);
      await openShiftTab(user);

      const btn = await screen.findByRole('button', { name: 'Kassirni almashtirish' });
      expect(btn).toBeDisabled();
      expect(screen.getByText(/avval smenani yoping/i)).toBeInTheDocument();
    } finally {
      localStorage.removeItem('sherset.pos-device');
    }
  });

  it('oddiy brauzerda (ish o‘rni emas) bo‘lim umuman chizilmaydi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openShiftTab(user);

    expect(screen.queryByRole('button', { name: 'Kassirni almashtirish' })).not.toBeInTheDocument();
  });
});
