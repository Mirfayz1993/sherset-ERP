import { api } from '@/lib/api-client';
import { renderWithProviders, screen } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrintCashOutPage from '../../cash-out/[docId]/page';
import PrintCashInPage from './page';

/**
 * S-reja S4 — PKO/RKO SANASI do'kon mintaqasida bosiladi.
 *
 * Nega aynan bu ikki sahifa uchun alohida test: ular QOG'OZ hujjat. Xato sana
 * ekranda tuzatiladi, qog'ozda esa mijozning qo'lida qoladi — S-rejaning eng
 * qimmat xato sinfi (§5 S2 bilan bir mantiq, faqat u chek edi, bu — kassa
 * orderi).
 *
 * 🔴 SINOV MASHINASINING O'Z TZ'i `Asia/Tashkent`. Ya'ni `timeZone: POS_TZ`
 * qo'shilgani oddiy testda KO'RINMAYDI: tuzatishsiz ham natija bir xil chiqadi
 * va test yolg'on-yashil bo'lardi. Shuning uchun mintaqa ataylab siljitiladi
 * (S2/S3 hisobotlaridagi naqsh) — tuzatish orqaga qaytarilsa bu test qizaradi.
 */

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ docId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }),
  useSearchParams: () => new URLSearchParams(''),
}));

/**
 * `2026-09-01T00:30:00Z` — Toshkentda **1-sentabr 05:30**, Honoluluda esa
 * hali **31-avgust 14:30**. Ya'ni bu instantda mintaqa nafaqat soatni,
 * KUN va OYni ham siljitadi: mintaqasiz shablon qog'ozga «31.08.2026» ni
 * bosardi.
 */
const CREATED_AT = '2026-09-01T00:30:00.000Z';

const COMMON = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'PKO-1',
  sumMinor: '5000000',
  currency: 'UZS',
  description: null,
  createdAt: CREATED_AT,
  agent: null,
  owner: { id: 'u-1', name: 'Kassir Aliyev' },
  organization: { name: 'Sherset MChJ', legalTitle: null },
  retailShift: null,
};

const CASH_IN = { ...COMMON, kind: 'topup' };
const CASH_OUT = { ...COMMON, name: 'RKO-1', kind: 'withdraw', recipient: null, salesReturn: null };

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

/** «Sana» qatorining QIYMAT katakchasi — shablonning o'zi ikki `<span>`. */
async function findDateRow(): Promise<string> {
  const label = await screen.findByText('Sana');
  return label.parentElement?.textContent?.replace('Sana', '') ?? '';
}

describe('PKO/RKO sanasi — qurilma MINTAQASI so`ralmaydi (S4)', () => {
  it.each([
    ['PKO (kirim)', CASH_IN, PrintCashInPage],
    ['RKO (chiqim)', CASH_OUT, PrintCashOutPage],
  ])('%s — sana do`kon mintaqasida bosiladi', async (_label, doc, Page) => {
    vi.stubEnv('TZ', 'Pacific/Honolulu'); // UTC−10
    try {
      vi.mocked(api.get).mockResolvedValue(doc);
      renderWithProviders(<Page />);

      // Ajratgichga (`/` yoki `.`) BOG'LANMAYDI — u ICU nusxasining ishi va
      // bu fazaning mavzusi emas. Qulflanadigan narsa — KUN va SOAT.
      const date = await findDateRow();
      expect(date).toMatch(/01\D09\D2026/); // Toshkent kuni
      expect(date).toContain('05:30'); // Toshkent soati
      expect(date).not.toMatch(/31\D08\D2026/); // Honolulu (oldingi KUN)
      expect(date).not.toContain('14:30'); // Honolulu soati
    } finally {
      vi.unstubAllEnvs();
    }
  });

  /**
   * 🔴 TZ shu yerda ATAYLAB `Asia/Tashkent` ga QO'YILADI, «stub'siz qoldirib»
   * mashinaning o'zinikiga tayanilmaydi. O'lchandi (S4 anti-vakuum bosqichi):
   * `vi.unstubAllEnvs()` boshda O'RNATILMAGAN `TZ` ni tiklamaydi — Node
   * yuqoridagi testdan qolgan mintaqada qolib ketadi. Ya'ni bu test o'zi
   * «Toshkentda» deb atalib, aslida Honoluluda yugurardi.
   */
  it('mashina Toshkentda bo`lganda ham natija AYNI (regressiya yo`q)', async () => {
    vi.stubEnv('TZ', 'Asia/Tashkent');
    try {
      vi.mocked(api.get).mockResolvedValue(CASH_IN);
      renderWithProviders(<PrintCashInPage />);
      const date = await findDateRow();
      expect(date).toMatch(/01\D09\D2026/);
      expect(date).toContain('05:30');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
