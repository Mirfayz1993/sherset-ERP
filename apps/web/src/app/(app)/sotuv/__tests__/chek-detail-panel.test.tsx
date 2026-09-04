/**
 * MK32 — «Cheklar» ro'yxati + `ChekDetailPanel` (qaytarish) xarakteristik
 * testlari (kassa TZ §6.3, §11, §13.1).
 *
 * **Xulq O'ZGARTIRILMAYDI.** Eng qimmat shartnoma shu yerda: qaytariladigan
 * naqd asl chekning **CHEGIRMALI** qator summasidan proporsional olinadi
 * (`priceMinor × qty` EMAS — u mijoz to'lamagan pulni qaytarardi, FE-01), va
 * ekranda ko'rinadigan raqam so'rovga ketadigani bilan bir xil formuladan
 * chiqadi.
 */

import { api } from '@/lib/api-client';
import { printReceiptViaAgent } from '@/lib/print-agent';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SotuvPage from '../page';
import { type Route, SALE_DETAIL, SALE_ROW, at, norm, router, salesRoutes } from './harness';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

/**
 * P3 — kiosk (kassir) rejimini testdan boshqarish uchun mutable bayroq.
 * `vi.mock` modul darajasida ko'tariladi, shuning uchun holat shu yerda
 * turadi va har test uni o'zi qo'yadi (`beforeEach` da nolga qaytariladi).
 */
const authState = { kiosk: false };

vi.mock('@/lib/auth-store', () => ({
  // P3 — chek panelida qaytarish tugmasi kiosk uchun yashiriladi; sahifa
  // shu yordamchini import qiladi, dublyorda ham bo'lishi shart.
  isKioskUser: () => authState.kiosk,
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

const LIST_ROW = SALE_ROW({
  state: 'posted',
  sumMinor: '1800000',
  agent: { id: 'cp-1', name: 'Usta Vali' },
});

function chekRoutes(detail: Record<string, unknown> = {}, over: Route[] = []): Route[] {
  return salesRoutes([
    ...over,
    { match: /limit=100/, value: { items: [LIST_ROW], total: 1 } },
    { match: /^\/retail-sales\/[^/?]+$/, value: SALE_DETAIL(detail) },
  ]);
}

/** «Cheklar» yorlig'ini ochib, birinchi chekni tanlaydi. */
async function openChekDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
  await user.click(await screen.findByRole('button', { name: /Usta Vali/ }));
  return await screen.findByText('CHEK-00001');
}

/** Qaytarish miqdori maydonlari (boshqa qidiruv maydonlaridan farqlanadi).
 *  F2: chap setka endi faqat Sotuv rejimida — Cheklar rejimida (detal ochiq)
 *  sahifada umuman textbox qolmasligi mumkin, shuning uchun `queryAll`
 *  (`getAll` nol topilganda otilib, «0 ta» assertni ishlatib bo'lmasdi). */
function refundQtyInputs(): HTMLElement[] {
  return screen
    .queryAllByRole('textbox')
    .filter((el) => el.getAttribute('inputmode') === 'decimal');
}

beforeEach(() => {
  authState.kiosk = false;
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(router(chekRoutes()));
  vi.mocked(api.post).mockResolvedValue({ ok: true });
  vi.mocked(printReceiptViaAgent).mockClear();
  window.open = vi.fn();
});

describe('Cheklar ro‘yxati', () => {
  it('smenada chek yo‘q bo‘lsa — bo‘shlik matni', async () => {
    vi.mocked(api.get).mockImplementation(
      router(salesRoutes([{ match: /limit=100/, value: { items: [], total: 0 } }])),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
    expect(await screen.findByText(/Bu smenada hali sotuv yo.q/)).toBeInTheDocument();
  });

  it('server `session.cashier` yubormasa ham ro‘yxat yiqilmaydi (2026-08-10 hodisasi)', async () => {
    // Prod'da `list()` include'ida `cashier` yo'q edi ⇒ `cashier.name` o'qish
    // butun sahifani error-boundary'ga tashlardi. Ildiz server tomonda
    // tuzatildi; bu — FE ning ikkinchi qatlami (ism yo'q, ekran tirik).
    const noCashier = SALE_ROW({
      state: 'posted',
      sumMinor: '1800000',
      agent: { id: 'cp-1', name: 'Usta Vali' },
      session: { cashDesk: { name: 'Asosiy kassa', currency: 'UZS' } },
    });
    vi.mocked(api.get).mockImplementation(
      router(salesRoutes([{ match: /limit=100/, value: { items: [noCashier], total: 1 } }])),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
    const row = await screen.findByRole('button', { name: /Usta Vali/ });
    expect(norm(row.textContent)).toContain('18 000,00 сум');
  });

  it('chek qatori summa, kassir, mijoz va pozitsiyalar sonini ko‘rsatadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
    const row = await screen.findByRole('button', { name: /Usta Vali/ });
    expect(norm(row.textContent)).toContain('18 000,00 сум');
    expect(norm(row.textContent)).toContain('Kassir Aliyev');
    expect(norm(row.textContent)).toContain('2 tovar');
  });
});

/**
 * S-reja S4 — cheklar RO'YXATI va DETAL sarlavhasidagi vaqt qurilma
 * mintaqasida chizilmaydi (`cheklar-mode.tsx` ning ikkala nuqtasi).
 *
 * Nega muhim: kassir chekni «qachon bo'lgan edi» bo'yicha topadi, F6
 * qaytarish esa aynan shu ro'yxatdan boshlanadi. Mintaqasi adashgan mashinada
 * chek boshqa KUNda ko'rinardi — sotuvning o'zi bazada to'g'ri turgan holda.
 *
 * 🔴 Sinov mashinasining o'z TZ'i `Asia/Tashkent`, ya'ni tuzatish oddiy testda
 * KO'RINMAYDI: `timeZone` bo'lmasa ham natija bir xil chiqardi. Mintaqa
 * ataylab siljitiladi (S2/S3 hisobotlaridagi naqsh).
 */
describe('Cheklar — S4 vaqt do‘kon mintaqasida', () => {
  // Fikstura `moment` = 2026-08-09T05:30:00Z.
  //   Toshkent (UTC+5):  09.08, 10:30
  //   Honolulu (UTC−10): 08.08, 19:30 — KUN ham boshqa.
  it('ro‘yxat qatorining SOATI Toshkentda (qurilma mintaqasida emas)', async () => {
    vi.stubEnv('TZ', 'Pacific/Honolulu');
    try {
      const user = userEvent.setup();
      renderWithProviders(<SotuvPage />);

      await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
      const row = await screen.findByRole('button', { name: /Usta Vali/ });
      expect(row.textContent).toContain('10:30');
      expect(row.textContent).not.toContain('19:30');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('detal sarlavhasining SANA+SOATi Toshkentda', async () => {
    vi.stubEnv('TZ', 'Pacific/Honolulu');
    try {
      const user = userEvent.setup();
      renderWithProviders(<SotuvPage />);
      const title = await openChekDetail(user);

      // Sarlavha bloki: chek raqami + sana qatori bitta ota-elementda.
      const text = title.parentElement?.textContent ?? '';
      // Ajratgichga bog'lanmaydi (ICU nusxasining ishi) — KUN va SOAT qulflanadi.
      expect(text).toMatch(/09\D08/); // Toshkent kuni
      expect(text).toContain('10:30'); // Toshkent soati
      expect(text).not.toMatch(/08\D08/); // Honolulu kuni
      expect(text).not.toContain('19:30'); // Honolulu soati
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('ChekDetailPanel — ko‘rinish', () => {
  it('chek raqami, holati, kassir, do‘kon va mijoz chiziladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    // 2026-08-17: holat nishoni RO'YXAT qatorida ham chiqadi (egasi so'ragan),
    // ya'ni matn ikki joyda. Bu da'vo DETAL panelidagisini tekshiradi —
    // `getByText` ikki mos kelishda otiladi va nima uchun ekani ko'rinmasdi.
    const badges = screen.getAllByTestId('chek-state-badge');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges.some((b) => (b.textContent ?? '').includes("To'langan"))).toBe(true);
    expect(screen.getByText('Markaziy do‘kon')).toBeInTheDocument();
    // Mijoz nomi detalda ham turadi.
    expect(screen.getAllByText('Usta Vali').length).toBeGreaterThan(0);
  });

  it('pozitsiya qatori miqdor × narx va qator chegirmasini ko‘rsatadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    // Tovar nomi chap ustundagi setkada ham bor — «Tovarlar» kartasi ichida
    // qidiramiz (V2: sarlavha endi flex-qator, matndan karta topilmaydi).
    const card = screen.getByTestId('chek-positions-card');
    expect(norm(card.textContent)).toContain('Kabel 2×2.5');
    expect(norm(card.textContent)).toContain('18 000,00 сум'); // chegirmali qator summasi
    expect(norm(card.textContent)).toContain('2 × 10 000,00 сум');
    expect(norm(card.textContent)).toContain('−10%');
  });

  it('to‘lov taqsimoti: nol bo‘lgan usul KO‘RSATILMAYDI', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    expect(screen.getByText('Naqd')).toBeInTheDocument();
    expect(screen.getByText('Karta')).toBeInTheDocument();
    // `terminalAmountMinor: '0'` — qator umuman chizilmaydi.
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument();
    expect(screen.getByText('Jami')).toBeInTheDocument();
  });

  it('«Chek» tugmasi agent orqali chop etadi (brauzer oynasi ochilmaydi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: /Chek$/ }));
    await waitFor(() => expect(printReceiptViaAgent).toHaveBeenCalledWith('s-1'));
    expect(window.open).not.toHaveBeenCalled();
  });

  it('«‹» tugmasi ro‘yxatga qaytaradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '‹' }));
    expect(screen.queryByText('CHEK-00001')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Usta Vali/ })).toBeInTheDocument();
  });

  it('to‘lanmagan chekda «Qaytarish» tugmasi YO‘Q', async () => {
    vi.mocked(api.get).mockImplementation(router(chekRoutes({ state: 'ready' })));
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    // «Tayyor» so'zi yorliqda ham bor — holat detal SARLAVHASIDA ekanini tekshiramiz.
    const header = screen.getByText('CHEK-00001').parentElement as HTMLElement;
    expect(norm(header.textContent)).toContain('Tayyor');
    expect(screen.queryByRole('button', { name: '↩ Qaytarish' })).not.toBeInTheDocument();
  });
});

/**
 * F6 (egasi qarori, 2026-08-13) — QAYTARISH KIOSKDA HAM OCHIQ.
 *
 * Tarix: 2026-08-12 (P3) da egasi «kassadan pul chiqishi menejer qarori»
 * degan edi — tugma kioskda yashirilgan va bu yerda «ko'rinmaydi» deb
 * qulflangan edi. 2026-08-13 da egasi o'sha qarorni BEKOR qildi: «kassir
 * istalgan chekga vozvrat qilishi kerak». Server tomonda kassirga
 * `salesreturn.view/create` berildi (role-templates F6); bu yerda EKRAN
 * tomoni: `!isKiosk` sharti olib tashlandi — tugma endi hammaga ko'rinadi.
 */
describe('ChekDetailPanel — qaytarish KIOSKDA HAM OCHIQ (F6)', () => {
  it('kiosk rejimida «Qaytarish» tugmasi KO‘RINADI (2026-08-12 yashirish bekor)', async () => {
    authState.kiosk = true;
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    expect(screen.getByRole('button', { name: '↩ Qaytarish' })).toBeInTheDocument();
  });

  it('to‘liq rejimda (menejer/admin) tugma JOYIDA', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    expect(screen.getByRole('button', { name: '↩ Qaytarish' })).toBeInTheDocument();
  });

  it('kioskda chekning qolgan qismi (chop etish) ISHLAYDI — panel o‘chirilmaydi', async () => {
    authState.kiosk = true;
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    expect(screen.getByText('CHEK-00001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🖨 Chek' })).toBeInTheDocument();
  });
});

/**
 * F6.C — «istalgan chekni TOPISH»: Cheklar tabida qidiruv. Bo'sh qidiruv =
 * joriy smena cheklari (eski xulq); matn kiritilsa so'rov `search=` bilan
 * BARCHA smenalar bo'ylab ketadi (`sessionId`siz) — backend
 * `RetailSaleFilterSchema.search` chek nomi + kontragent nomi bo'yicha
 * qidiradi.
 */
describe('Cheklar tabida qidiruv (F6)', () => {
  it('qidiruv maydoni bor va bo‘shligida joriy smena ro‘yxati turadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
    expect(await screen.findByTestId('sotuv-chek-search')).toBeInTheDocument();
    // Sukut — smena so'rovi (limit=100, sessionId bilan) natijasi.
    expect(await screen.findByRole('button', { name: /Usta Vali/ })).toBeInTheDocument();
  });

  it('matn kiritilsa so‘rov `search=` bilan va `sessionId`SIZ ketadi', async () => {
    const found = SALE_ROW({
      id: 's-9',
      name: 'CHEK-00777',
      state: 'posted',
      sumMinor: '500000',
      agent: { id: 'cp-2', name: 'Eski Mijoz' },
    });
    vi.mocked(api.get).mockImplementation(
      router(chekRoutes({}, [{ match: /search=/, value: { items: [found], total: 1 } }])),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);

    await user.click(await screen.findByRole('button', { name: /^Cheklar/ }));
    await user.type(await screen.findByTestId('sotuv-chek-search'), '777');

    // Natija barcha-smenalar qidiruvidan keladi.
    expect(await screen.findByRole('button', { name: /Eski Mijoz/ })).toBeInTheDocument();
    // Chap ustundagi tovar qidiruvi (`/products?search=`) ham `search=`
    // ishlatadi — faqat chek so'rovlarini olamiz.
    const searchCalls = vi
      .mocked(api.get)
      .mock.calls.map((c) => String(c[0]))
      .filter((u) => u.startsWith('/retail-sales?') && u.includes('search='));
    expect(searchCalls.length).toBeGreaterThan(0);
    for (const u of searchCalls) {
      expect(u).not.toContain('sessionId=');
    }
  });
});

describe('ChekDetailPanel — qaytarish', () => {
  // 2026-09-01 (kassir shikoyati, egasi tasdig'i): rejim endi 0 BILAN ochiladi —
  // ilgari to'liq son bilan ochilardi va bitta tovarni qaytarish uchun qolgan
  // hammasini qo'lda 0 ga tushirish kerak edi (bexosdan to'liq vozvrat xavfi).
  it('qaytarish rejimi 0 bilan ochiladi — tasdiq BLOKLANGAN', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));

    const inputs = refundQtyInputs();
    expect(inputs).toHaveLength(1);
    expect(at(inputs, 0)).toHaveValue('0');
    expect(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ })).toBeDisabled();
  });

  it('«Hammasini qaytarish» to‘liq miqdorni to‘ldiradi va summa CHEGIRMALIdan olinadi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    await user.click(screen.getByTestId('pos-refund-fill-all'));

    expect(at(refundQtyInputs(), 0)).toHaveValue('2');
    // 2 dona to'liq qaytsa — chegirmali qator summasi (18 000), 20 000 EMAS.
    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    expect(norm(footer.textContent)).toContain('18 000,00 сум');
  });

  it('qatordagi «/ N» tugmasi o‘sha qatorni to‘liq soniga to‘ldiradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    await user.click(screen.getByRole('button', { name: '/ 2' }));

    expect(at(refundQtyInputs(), 0)).toHaveValue('2');
  });

  it('qisman qaytarish summani proporsional kamaytiradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    const input = at(refundQtyInputs(), 0);
    await user.clear(input);
    await user.type(input, '1');

    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    expect(norm(footer.textContent)).toContain('9 000,00 сум');
  });

  it('sotilganidan KO‘P miqdor kiritib bo‘lmaydi — sotilganiga qisiladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    const input = at(refundQtyInputs(), 0);
    await user.clear(input);
    await user.type(input, '5');

    expect(input).toHaveValue('2');
  });

  it('miqdor bo‘sh — tasdiq tugmasi BLOKLANGAN (nol summa yuborilmaydi)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    await user.clear(at(refundQtyInputs(), 0));

    expect(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('tasdiqlash — normallashtirilgan miqdor va EKRANDAGI summa yuboriladi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    // V2 xulqi: 0 dan boshlanadi — to'liq qaytarish endi bitta tugma.
    await user.click(screen.getByTestId('pos-refund-fill-all'));
    await user.click(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/retail-sales/s-1/refund', {
      positions: [{ productId: 'p-1', quantity: '2' }],
      cashAmountMinor: '1800000',
      cardAmountMinor: '0',
      cashUsdReturnMinor: '0',
      // ⚠️ i18n-emas, ATAYLAB: hujjat izohi kassir tiliga bog‘lanmaydi.
      description: 'POS qaytarish',
    });
  });

  it('«Bekor qilish» qaytarish rejimidan chiqaradi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    expect(refundQtyInputs()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Bekor qilish' }));
    expect(refundQtyInputs()).toHaveLength(0);
    expect(screen.getByRole('button', { name: '↩ Qaytarish' })).toBeInTheDocument();
  });

  it('kasr miqdor yozib bo‘ladi — oraliq «1.» holati SAQLANADI (FE-02)', async () => {
    vi.mocked(api.get).mockImplementation(
      router(
        chekRoutes({
          positions: [
            {
              ...SALE_DETAIL().positions[0],
              quantity: '2.5',
              sumMinor: '2250000',
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SotuvPage />);
    await openChekDetail(user);

    await user.click(screen.getByRole('button', { name: '↩ Qaytarish' }));
    const input = at(refundQtyInputs(), 0);
    await user.clear(input);
    await user.type(input, '1.');

    // Nuqta o'chib ketmaydi — og'irlik bilan sotilgan tovar qisman qaytadi.
    expect(input).toHaveValue('1.');

    await user.type(input, '5');
    expect(input).toHaveValue('1.5');
    const footer = screen.getByText('Qaytariladigan summa (naqd)').parentElement as HTMLElement;
    // 22 500 × 1.5 / 2.5 = 13 500.
    expect(norm(footer.textContent)).toContain('13 500,00 сум');
  });
});
