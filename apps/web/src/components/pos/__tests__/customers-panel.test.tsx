import { CustomersPanel } from '@/components/pos/customers-panel';
import { api } from '@/lib/api-client';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F7/P07 (2026-08-13, egasi) — o'ng paneldagi «Mijozlar» bo'limi.
 *
 * Kassir smena davomida mijoz qarzidan pul qabul qilsa yoki mijoz nimadir
 * qaytarsa — savatga tegmasdan, bitta tab ichida ishlaydi: qidiruv →
 * BITTA HALOL RAQAM (`payableMinor` — server AYNAN shu summagacha qabul
 * qiladi, xotira `pos-customer-card-one-number`) → uch amal (qarz to'lash /
 * mijoz kartasi / cheklari). Panel o'zi HECH QANDAY pul amalini bajarmaydi —
 * hammasi callback orqali mavjud modallarga ketadi (`DebtPaymentDialog`,
 * `CustomerCardPanel`, `ChekDetailPanel` — F6 qaytarish oqimi bilan).
 *
 * Yangi backend YO'Q (reja taqig'i): /counterparties, /debts/pos/summary,
 * /retail-sales?agentId= — hammasi mavjud, kiosk-policy'da ochiq.
 */

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const CP = { id: 'cp-1', name: 'Usta Vali', phone: '+998901112233' };

/** `GET /debts/pos/summary/:id` — F9 shakli (customer-card bilan bir xil). */
const SUMMARY = {
  counterparty: CP,
  payableMinor: '125000000',
  outstandingMinor: '0',
  openCount: 0,
  oldestAt: null,
  balanceMinor: '125000000',
  registryExceedsBalance: false,
  otherCurrencyBalances: [],
};

const CHEKS = {
  items: [
    {
      id: 's-1',
      name: 'CHEK-00001',
      moment: '2026-08-09T05:30:00.000Z',
      sumMinor: '1800000',
      state: 'posted',
    },
  ],
  total: 1,
};

/** NBSP (formatMoney ming-ajratgichi) bilan birga barcha bo'shliqni yeydi. */
function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/[\s  ]/g, '');
}

/** G1 — `GET /cashier-sessions/unpaid-returns?agentId=` bo'sh sukut. */
const NO_UNPAID = { items: [], totalRemainingMinor: '0' };

/** G1 — qisman to'langan + valyutali vozvratli javob. */
const UNPAID = {
  items: [
    {
      id: 'r-1',
      name: 'ВП-2026-00007',
      moment: '2026-08-23T09:00:00.000Z',
      currency: 'UZS',
      sumMinor: '50000000',
      payedSumMinor: '10000000',
      remainingMinor: '40000000',
      payable: true,
    },
    {
      id: 'r-2',
      name: 'ВП-2026-00008',
      moment: '2026-08-23T10:00:00.000Z',
      currency: 'USD',
      sumMinor: '70000',
      payedSumMinor: '0',
      remainingMinor: '70000',
      payable: false,
    },
  ],
  totalRemainingMinor: '40000000',
};

function routes(
  summary: Record<string, unknown> = SUMMARY,
  unpaid: Record<string, unknown> = NO_UNPAID,
) {
  return async (path: string) => {
    if (path.startsWith('/counterparties')) return { items: [CP] };
    if (path.startsWith('/debts/pos/summary')) return summary;
    if (path.startsWith('/retail-sales')) return CHEKS;
    if (path.startsWith('/cashier-sessions/unpaid-returns')) return unpaid;
    throw new Error(`kutilmagan so'rov: ${path}`);
  };
}

function renderPanel() {
  const onOpenCustomerCard = vi.fn();
  const onPayDebt = vi.fn();
  const onOpenChek = vi.fn();
  renderWithProviders(
    <CustomersPanel
      sessionId="sess-1"
      onOpenCustomerCard={onOpenCustomerCard}
      onPayDebt={onPayDebt}
      onOpenChek={onOpenChek}
    />,
  );
  return { onOpenCustomerCard, onPayDebt, onOpenChek };
}

async function pickCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByTestId('pos-customers-result'))[0] as HTMLElement);
  await screen.findByTestId('pos-customers-debt');
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(routes());
});

describe('CustomersPanel — qidiruv', () => {
  it('natija ro‘yxati nom + telefon bilan chiqadi', async () => {
    renderPanel();

    const rows = await screen.findAllByTestId('pos-customers-result');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Usta Vali');
    expect(rows[0]?.textContent).toContain('+998901112233');
  });

  it('kiritilgan matn so‘rovga `search=` bilan ketadi', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByTestId('pos-customers-search'), 'Vali');
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.startsWith('/counterparties?') && u.includes('search=Vali'))).toBe(
        true,
      );
    });
  });
});

describe('CustomersPanel — tanlangan mijoz kartochkasi', () => {
  it('summary chaqiriladi va qarz (payableMinor) ko‘rinadi', async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    expect(api.get).toHaveBeenCalledWith('/debts/pos/summary/cp-1?currency=UZS');
    expect(squash(screen.getByTestId('pos-customers-debt').textContent)).toContain('1250000');
  });

  it('`balanceMinor: null` — «o‘lchanmagan» qatori OCHIQ aytiladi (NULL ≠ 0)', async () => {
    vi.mocked(api.get).mockImplementation(routes({ ...SUMMARY, balanceMinor: null }));
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    expect(screen.getByTestId('pos-customers-balance-missing')).toBeInTheDocument();
  });
});

describe('CustomersPanel — uch amal-tugma', () => {
  it('«Qarzni to‘lash» — onPayDebt tanlangan mijoz bilan', async () => {
    const user = userEvent.setup();
    const { onPayDebt } = renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-pay'));
    expect(onPayDebt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cp-1', name: 'Usta Vali' }),
    );
  });

  it('«Mijoz kartasi» — onOpenCustomerCard tanlangan mijoz bilan', async () => {
    const user = userEvent.setup();
    const { onOpenCustomerCard } = renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-card'));
    expect(onOpenCustomerCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cp-1', name: 'Usta Vali' }),
    );
  });

  it('«Cheklari» — so‘rov `agentId=` bilan ketadi, chek bosilsa onOpenChek(saleId)', async () => {
    const user = userEvent.setup();
    const { onOpenChek } = renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-cheks'));
    const chekRow = await screen.findByTestId('pos-customers-chek');
    const urls = vi.mocked(api.get).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('/retail-sales?') && u.includes('agentId=cp-1'))).toBe(
      true,
    );

    await user.click(chekRow);
    expect(onOpenChek).toHaveBeenCalledWith('s-1');
  });

  it('«O‘zgartirish» — qidiruvga qaytadi (oldingi mijoz ma‘lumoti bilan aralashmasin)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-change'));
    expect(await screen.findByTestId('pos-customers-search')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-customers-debt')).toBeNull();
  });
});

/**
 * S-reja S4 — chek ro'yxatidagi sana/soat QURILMA mintaqasida chizilmaydi.
 *
 * Bu panel kassirning «mijoz nima sotib olgan edi?» degan savoliga javob
 * beradi va F6 qaytarish oqimi shu ro'yxatdan boshlanadi. Mintaqasi adashgan
 * mashinada chek butunlay boshqa KUNda ko'rinardi — kassir mijozning chekini
 * topa olmasdi.
 *
 * 🔴 Sinov mashinasining o'z TZ'i `Asia/Tashkent`, ya'ni tuzatish oddiy testda
 * KO'RINMAYDI. Mintaqa ataylab siljitiladi (S2/S3 naqshi): `timeZone: POS_TZ`
 * olib tashlansa bu test qizaradi, qolganlari yashil qolardi.
 */
describe('CustomersPanel — S4 sana/soat do‘kon mintaqasida', () => {
  // Fixture `moment` = 2026-08-09T05:30:00Z.
  //   Toshkent (UTC+5):  09.08.26, 10:30
  //   Honolulu (UTC−10): 08.08.26, 19:30 — KUN ham boshqa.
  it('chek qatorida Toshkent kuni va soati chiqadi, qurilma mintaqasi emas', async () => {
    vi.stubEnv('TZ', 'Pacific/Honolulu');
    try {
      const user = userEvent.setup();
      renderPanel();
      await pickCustomer(user);
      await user.click(screen.getByTestId('pos-customers-cheks'));

      const text = (await screen.findByTestId('pos-customers-chek')).textContent ?? '';
      // Ajratgichga bog'lanmaydi (ICU nusxasining ishi) — KUN va SOAT qulflanadi.
      expect(text).toMatch(/09\D08\D26/); // Toshkent kuni
      expect(text).toContain('10:30'); // Toshkent soati
      expect(text).not.toMatch(/08\D08\D26/); // Honolulu kuni
      expect(text).not.toContain('19:30'); // Honolulu soati
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('CustomersPanel — G1 to‘lanmagan vozvratlar', () => {
  it('vozvrat yo‘q mijozda blok UMUMAN chiqmaydi', async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);
    expect(screen.queryByTestId('pos-unpaid-returns')).toBeNull();
  });

  it('ro‘yxat + jami qaytim ko‘rinadi; valyutali qatorda To‘lash tugmasi YO‘Q', async () => {
    vi.mocked(api.get).mockImplementation(routes(SUMMARY, UNPAID));
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    const block = await screen.findByTestId('pos-unpaid-returns');
    expect(block.textContent).toContain('ВП-2026-00007');
    expect(block.textContent).toContain('ВП-2026-00008');
    // Jami — faqat so'm vozvratlarning qolgani (400 000,00).
    expect(squash(screen.getByTestId('pos-unpaid-returns-total').textContent)).toContain('400000');
    // payable=true bitta qator ⇒ bitta To'lash tugmasi.
    expect(screen.getAllByTestId('pos-unpaid-returns-pay')).toHaveLength(1);
  });

  it('To‘lash → summa (default: qolgan qaytim) → POST customer-payout + chek chop', async () => {
    vi.mocked(api.get).mockImplementation(routes(SUMMARY, UNPAID));
    vi.mocked(api.post).mockResolvedValue({
      id: 'doc-1',
      name: 'ВВ-2026-00001',
      sumMinor: '40000000',
      remainingMinor: '0',
      auditTypes: ['RETURN_PAYOUT'],
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    await user.click((await screen.findAllByTestId('pos-unpaid-returns-pay'))[0] as HTMLElement);
    // Maydon qolgan qaytim bilan to'lgan (400 000 so'm).
    const amount = await screen.findByTestId('pos-unpaid-returns-amount');
    expect((amount as HTMLInputElement).value).toBe('400000');

    await user.click(screen.getByTestId('pos-unpaid-returns-submit'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/cashier-sessions/sess-1/customer-payout', {
        salesReturnId: 'r-1',
        sumMinor: '40000000',
      });
    });
    // Chek — RKO sahifasining payout varianti, imzo uchun.
    expect(openSpy).toHaveBeenCalledWith('/print/cash-out/doc-1?auto=1', '_blank');
    openSpy.mockRestore();
  });

  it('QISMAN: summa qo‘lda kamaytirilsa aynan shu summa ketadi; ortiq summa bloklanadi', async () => {
    vi.mocked(api.get).mockImplementation(routes(SUMMARY, UNPAID));
    vi.mocked(api.post).mockResolvedValue({
      id: 'doc-2',
      name: 'ВВ-2026-00002',
      sumMinor: '10000000',
      remainingMinor: '30000000',
      auditTypes: ['RETURN_PAYOUT'],
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    await user.click((await screen.findAllByTestId('pos-unpaid-returns-pay'))[0] as HTMLElement);
    const amount = await screen.findByTestId('pos-unpaid-returns-amount');

    // Qolgan qaytimdan ORTIQ — tugma o'chiq (cap serverda ham bor, lekin
    // kassirga darhol ko'rinishi kerak).
    await user.clear(amount);
    await user.type(amount, '500000');
    expect(screen.getByTestId('pos-unpaid-returns-submit')).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, '100000');
    await user.click(screen.getByTestId('pos-unpaid-returns-submit'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/cashier-sessions/sess-1/customer-payout', {
        salesReturnId: 'r-1',
        sumMinor: '10000000',
      });
    });
    openSpy.mockRestore();
  });
});

/**
 * A1 (2026-08-25) — kassada MIJOZDAN AVANS qabul qilish.
 *
 * Egasining shikoyati: «mijozlar oldindan pul berib qo'yishadi, keyin tovar
 * olishadi — shu mijozlar bilan ishlay olmayapmiz». Kassirning yagona yo'li
 * shu blok: mijozni tanlaydi → summa → PKO cheki chiqadi.
 *
 * ⚠️ Smenasiz pul-hujjat yozib bo'lmaydi (hujjat smenaga bog'lanadi va
 * kutilgan naqdga kiradi) — tugma o'chiq bo'lishi SHART.
 */
describe('CustomersPanel — A1 avans qabul qilish', () => {
  it('tugma bor, lekin blok BOSILMAGUNCHA yopiq', async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    expect(screen.getByTestId('pos-customers-prepay')).toBeEnabled();
    expect(screen.queryByTestId('pos-prepay')).toBeNull();

    await user.click(screen.getByTestId('pos-customers-prepay'));
    expect(await screen.findByTestId('pos-prepay')).toBeInTheDocument();
  });

  it('SMENASIZ tugma o‘chiq — smenasiz pul-hujjat yozib bo‘lmaydi', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CustomersPanel
        sessionId={null}
        onOpenCustomerCard={vi.fn()}
        onPayDebt={vi.fn()}
        onOpenChek={vi.fn()}
      />,
    );
    await pickCustomer(user);
    expect(screen.getByTestId('pos-customers-prepay')).toBeDisabled();
  });

  it('bo‘sh/nol summada tasdiqlash tugmasi o‘chiq (default summa YO‘Q)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);
    await user.click(screen.getByTestId('pos-customers-prepay'));

    const amount = await screen.findByTestId('pos-prepay-amount');
    // Avansda «qolgani qancha» manbasi yo'q — maydon BO'SH ochiladi.
    expect((amount as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('pos-prepay-submit')).toBeDisabled();

    await user.type(amount, '0');
    expect(screen.getByTestId('pos-prepay-submit')).toBeDisabled();
  });

  it('summa → POST customer-prepay + PKO cheki chop etiladi', async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: 'in-1',
      name: 'АВ-2026-00001',
      sumMinor: '100000000',
      balanceAfterMinor: '-100000000',
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-prepay'));
    await user.type(await screen.findByTestId('pos-prepay-amount'), '1000000');
    await user.click(screen.getByTestId('pos-prepay-submit'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/cashier-sessions/sess-1/customer-prepay', {
        counterpartyId: 'cp-1',
        sumMinor: '100000000',
      });
    });
    // PKO cheki — mijoz imzo qo'yadigan qog'oz (RKO sahifasining kirim varianti).
    expect(openSpy).toHaveBeenCalledWith('/print/cash-in/in-1?auto=1', '_blank');
    // Muvaffaqiyatdan keyin blok yopiladi (ikkinchi marta tasodifan
    // yuborilmasin).
    await waitFor(() => expect(screen.queryByTestId('pos-prepay')).toBeNull());
    openSpy.mockRestore();
  });

  it('🔴 avans QARZ EMAS — hech qanday /debts so‘rovi yoki POST ketmaydi', async () => {
    // `beforeEach` faqat `api.get` ni tozalaydi; bu yerda POST chaqiruvlari
    // SONI o'lchanadi, shuning uchun tarix alohida tozalanadi.
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({
      id: 'in-2',
      name: 'АВ-2026-00002',
      sumMinor: '50000000',
      balanceAfterMinor: '-50000000',
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-prepay'));
    await user.type(await screen.findByTestId('pos-prepay-amount'), '500000');
    await user.click(screen.getByTestId('pos-prepay-submit'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    // Yagona POST — avans yo'li. `/debts` ga bir marta ham yozilmadi
    // (reja invariant 4 ning FE tomondagi ko'zgusi).
    const posted = vi.mocked(api.post).mock.calls.map((c) => String(c[0]));
    expect(posted).toEqual(['/cashier-sessions/sess-1/customer-prepay']);
    expect(posted.some((u) => u.startsWith('/debts'))).toBe(false);
    openSpy.mockRestore();
  });

  it('mijoz almashtirilsa avans bloki YOPILADI (oldingi mijozga yozilmasin)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickCustomer(user);
    await user.click(screen.getByTestId('pos-customers-prepay'));
    await screen.findByTestId('pos-prepay');

    await user.click(screen.getByTestId('pos-customers-change'));
    await user.click((await screen.findAllByTestId('pos-customers-result'))[0] as HTMLElement);
    await screen.findByTestId('pos-customers-debt');
    expect(screen.queryByTestId('pos-prepay')).toBeNull();
  });
});

/**
 * A3 (2026-08-25) — AVANSNI NAQD QAYTARISH bloki + avans holatining
 * ko'rinishi.
 *
 * NON-VACUOUS: A3 gacha manfiy balansda panel `payableMinor: '0'` ni chizardi
 * («qarzi yo'q») va qaytarish tugmasi UMUMAN yo'q edi — kassir mijozning
 * pulini qaytara olmasdi (A1 hisobotining STORNO qarori: tuzatish admin
 * ekranlaridan ikki hujjat bilan qilinardi).
 */
const PREPAID = {
  ...SUMMARY,
  payableMinor: '0',
  balanceMinor: '-10000000',
  standing: { kind: 'prepaid', amountMinor: '10000000', conflicted: false },
};

describe('CustomersPanel — A3 avans holati va qaytarish', () => {
  it('avansi bor mijozda AVANS summasi va «Avansi» yorlig`i chiqadi', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(routes(PREPAID));
    renderPanel();
    await pickCustomer(user);

    const amount = screen.getByTestId('pos-customers-amount');
    expect(amount).toHaveAttribute('data-standing', 'prepaid');
    // 100 000 so'm (10 000 000 tiyin) — serverning «0» i EMAS.
    expect(squash(amount.textContent)).toContain('100000,00');
  });

  it('qarzdor mijozda tugma ham, blok ham YO`Q (regressiya yo`q)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(
      routes({
        ...SUMMARY,
        standing: { kind: 'debt', amountMinor: '125000000', conflicted: false },
      }),
    );
    renderPanel();
    await pickCustomer(user);

    expect(screen.queryByTestId('pos-customers-prepay-refund')).toBeNull();
    expect(screen.getByTestId('pos-customers-amount')).toHaveAttribute('data-standing', 'debt');
  });

  it('blok ochilganda summa QOLGAN avans bilan to`ladi', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(routes(PREPAID));
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-prepay-refund'));
    const input = (await screen.findByTestId('pos-prepay-refund-amount')) as HTMLInputElement;
    expect(squash(input.value)).toBe('100000');
  });

  it('qaytarish POST + RKO cheki, blok yopiladi', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(routes(PREPAID));
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({
      id: 'out-1',
      name: 'BA-2026-00001',
      sumMinor: '10000000',
      remainingPrepayMinor: '0',
      auditTypes: ['PREPAY_REFUND'],
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-prepay-refund'));
    await user.click(await screen.findByTestId('pos-prepay-refund-submit'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/cashier-sessions/sess-1/customer-prepay-refund', {
        counterpartyId: 'cp-1',
        sumMinor: '10000000',
      });
    });
    // RKO cheki — mijoz imzo qo'yadigan qog'oz (avans qaytarilganini tasdiqlaydi).
    expect(openSpy).toHaveBeenCalledWith('/print/cash-out/out-1?auto=1', '_blank');
    await waitFor(() => expect(screen.queryByTestId('pos-prepay-refund')).toBeNull());
    openSpy.mockRestore();
  });

  it('🔴 avansdan ORTIQ summada tugma o`chiq (server cap`ining ekran ko`zgusi)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(routes(PREPAID));
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-prepay-refund'));
    const input = await screen.findByTestId('pos-prepay-refund-amount');
    await user.clear(input);
    await user.type(input, '200000');
    expect(screen.getByTestId('pos-prepay-refund-submit')).toBeDisabled();

    // Chegaradagi qiymat esa o'tadi.
    await user.clear(input);
    await user.type(input, '100000');
    expect(screen.getByTestId('pos-prepay-refund-submit')).not.toBeDisabled();
  });

  it('🔴 avans QARZ EMAS — qaytarishda ham `/debts` ga POST ketmaydi', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(routes(PREPAID));
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({
      id: 'out-1',
      name: 'BA-2026-00001',
      sumMinor: '10000000',
      remainingPrepayMinor: '0',
      auditTypes: ['PREPAY_REFUND'],
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel();
    await pickCustomer(user);

    await user.click(screen.getByTestId('pos-customers-prepay-refund'));
    await user.click(await screen.findByTestId('pos-prepay-refund-submit'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const posted = vi.mocked(api.post).mock.calls.map((c) => String(c[0]));
    expect(posted).toEqual(['/cashier-sessions/sess-1/customer-prepay-refund']);
    openSpy.mockRestore();
  });

  it('mijoz almashtirilsa qaytarish bloki YOPILADI', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(routes(PREPAID));
    renderPanel();
    await pickCustomer(user);
    await user.click(screen.getByTestId('pos-customers-prepay-refund'));
    await screen.findByTestId('pos-prepay-refund');

    await user.click(screen.getByTestId('pos-customers-change'));
    await user.click((await screen.findAllByTestId('pos-customers-result'))[0] as HTMLElement);
    await screen.findByTestId('pos-customers-debt');
    expect(screen.queryByTestId('pos-prepay-refund')).toBeNull();
  });
});
