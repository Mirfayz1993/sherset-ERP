import { PosLocaleToggle } from '@/components/pos/pos-locale-toggle';
import { locales } from '@/i18n/config';
import uz from '@/messages/uz.json';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FAZA 1 (kassa ikki tilli, 2026-09-01) — kioskdagi til almashtirgich.
 *
 * NIMA QULFLANADI (har biri aniq bug-klass):
 *  1. Tugmalar `locales` massividan chiziladi — qattiq `['uz','ru']` EMAS.
 *     Uchinchi til qo'shilganda kod o'zgarmasin.
 *  2. `<select>` YO'Q — kassada klaviatura yo'q, native select sensorda noqulay.
 *  3. Xato ushlanadi. Mavjud `components/locale-switcher.tsx` da `catch` yo'q;
 *     tarmoq uzilgan kassada bu ushlanmagan rad etish (unhandled rejection)
 *     bo'lardi va kassir hech qanday belgi ko'rmasdi.
 *  4. Xatodan keyin holat AVVALGICHA qoladi — tugmalar «ru bosildi» deb
 *     yolg'on ko'rsatmaydi.
 *  5. Band paytida IKKALA tugma `disabled` — ikki marta bosish yo'q.
 *
 * Server action mock qilinadi: `app/actions/locale.ts` da `'use server'` +
 * `next/headers` bor, uni happy-dom'da haqiqiy ishga tushirib bo'lmaydi.
 * Test tekshiradigan shartnoma esa aynan CHAQIRUV — «to'g'ri til uzatildimi,
 * xato qaytsa nima bo'ladi».
 */

const setLocale = vi.fn();
const refresh = vi.fn();

vi.mock('@/app/actions/locale', () => ({ setLocale: (next: string) => setLocale(next) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const btn = (code: string) => screen.getByTestId(`pos-locale-${code}`) as HTMLButtonElement;

beforeEach(() => {
  setLocale.mockReset().mockResolvedValue(undefined);
  refresh.mockReset();
});

describe('PosLocaleToggle — kioskda til almashtirish', () => {
  it('har bir sozlangan til uchun bitta KATTA tugma chizadi (select emas)', () => {
    renderWithProviders(<PosLocaleToggle />);

    const root = screen.getByTestId('pos-locale-toggle');
    expect(root.querySelector('select')).toBeNull();

    const buttons = [...root.querySelectorAll('button')];
    // `locales` ga uchinchi til qo'shilsa bu son o'zi-o'zidan o'sadi —
    // test qattiq 2 raqamini QULFLAMAYDI.
    expect(buttons).toHaveLength(locales.length);
    for (const code of locales) expect(btn(code)).toBeInTheDocument();

    // Sensor mezoni: balandlik POS token'idan keladi, ixtiyoriy piksel emas.
    for (const b of buttons) expect(b.className).toContain('h-[var(--pos-touch-min)]');
  });

  it('joriy til aria-pressed bilan belgilanadi, qolgani emas', () => {
    // `renderWithProviders` uz bandlida, `locale="uz"` bilan render qiladi.
    renderWithProviders(<PosLocaleToggle />);

    expect(btn('uz')).toHaveAttribute('aria-pressed', 'true');
    expect(btn('ru')).toHaveAttribute('aria-pressed', 'false');
  });

  it('boshqa tilni bosish setLocale + router.refresh chaqiradi (reload EMAS)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PosLocaleToggle />);

    await user.click(btn('ru'));

    await waitFor(() => expect(setLocale).toHaveBeenCalledTimes(1));
    expect(setLocale).toHaveBeenCalledWith('ru');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('joriy tilni bosish HECH NARSA qilmaydi (behuda refresh yo`q)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PosLocaleToggle />);

    await user.click(btn('uz'));

    expect(setLocale).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('so`rov ketayotganda IKKALA tugma disabled — ikkinchi bosish o`tmaydi', async () => {
    let release: (() => void) | undefined;
    setLocale.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PosLocaleToggle />);

    await user.click(btn('ru'));

    await waitFor(() => expect(btn('ru')).toBeDisabled());
    expect(btn('uz')).toBeDisabled();
    expect(btn('ru')).toHaveAttribute('aria-busy', 'true');

    // Ikkinchi bosish — hech qanday yangi chaqiruv bo'lmasligi kerak.
    await user.click(btn('ru'));
    expect(setLocale).toHaveBeenCalledTimes(1);

    release?.();
    await waitFor(() => expect(btn('ru')).toBeEnabled());
  });

  it('🔴 setLocale otilsa: toast chiqadi, tugmalar avvalgi holatga qaytadi', async () => {
    // Kassa uchun REAL holat — tarmoq uzilishi. `locale-switcher.tsx` da bu
    // ushlanmagan rad etish bo'lardi (u yerda `catch` YO'Q).
    setLocale.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderWithProviders(<PosLocaleToggle />);

    await user.click(btn('ru'));

    // Toast matni uz bandlidan — kalit MAVJUDLIGI ham shu yerda qulflanadi.
    expect(await screen.findByText(uz.pages.pos.locale_change_failed)).toBeVisible();

    // Sahifa yangilanmaydi va holat sakramaydi: `uz` hamon faol.
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(btn('ru')).toBeEnabled());
    expect(btn('uz')).toHaveAttribute('aria-pressed', 'true');
    expect(btn('ru')).toHaveAttribute('aria-pressed', 'false');
    expect(btn('ru')).toHaveAttribute('aria-busy', 'false');
  });
});
