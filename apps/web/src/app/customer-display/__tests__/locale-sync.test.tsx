import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHookWithProviders } from '../../../test-utils';
import { useLocaleSync } from '../page';

/**
 * Mijoz-ekran kassa tiliga ergashishi (FAZA 2).
 *
 * Bu testlar MEXANIZMNI emas, QO'RIQCHILARNI qulflaydi. Sabab: mijoz-ekran
 * zalda, mijozning ko'z oldida turadi — u yerdagi reload SIKLI eng yomon
 * nosozlik bo'lardi (ekran 2 soniyada bir o'chib-yonadi va hech kim sababini
 * bilmaydi). Shuning uchun «reload chaqirildi» dan ko'ra «ikkinchi marta
 * chaqirilmadi» muhimroq.
 *
 * Render tili — `renderHookWithProviders` doim `uz` beradi (test-utils);
 * o'zgaruvchisi esa cookie. Aynan jonli holat: sahifa bir til bilan render
 * bo'lgan, cookie esa kassir tomonidan keyin o'zgartirilgan.
 */

const POLL_MS = 2000;

/** Bir necha turni o'tkazadi (interval `LOCALE_POLL_MS` bilan yuradi). */
function ticks(n = 1) {
  act(() => {
    vi.advanceTimersByTime(POLL_MS * n);
  });
}

function setCookie(value: string | null) {
  // happy-dom cookie'ni haqiqiy jar sifatida saqlaydi: o'chirish uchun muddati
  // o'tgan sana qo'yiladi (aks holda oldingi testning qiymati qolib ketardi).
  document.cookie =
    value === null
      ? 'NEXT_LOCALE=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
      : `NEXT_LOCALE=${value}; path=/`;
}

let reload: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  vi.useFakeTimers();
  setCookie(null);
  window.sessionStorage.clear();
  reload = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.useRealTimers();
  setCookie(null);
  window.sessionStorage.clear();
});

describe('useLocaleSync — mijoz-ekran tilga ergashadi', () => {
  it("cookie boshqa tilni ko'rsatsa sahifa BIR MARTA qayta yuklanadi", () => {
    setCookie('ru'); // render `uz`, kassir `ru` ga o'tkazdi
    renderHookWithProviders(() => useLocaleSync());

    ticks();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keyingi turlarda BOSHQA qayta yuklamaydi (sikl qo`riqchisi)', () => {
    // Jonlidagi eng xavfli holat: reload bo'ldi, lekin server baribir eski
    // tilni berdi (kesh, eskirgan RSC javobi…). Belgisiz bu ekran cheksiz
    // qayta yuklanardi — mijozning ko'z oldida.
    setCookie('ru');
    renderHookWithProviders(() => useLocaleSync());

    ticks();
    expect(reload).toHaveBeenCalledTimes(1);

    ticks(5); // sahifa hamon `uz` da render bo'lib turibdi
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('cfd.localeReloadFor')).toBe('ru');
  });

  it('cookie render tili bilan mos bo`lsa hech qachon yuklamaydi', () => {
    setCookie('uz'); // render ham `uz`
    renderHookWithProviders(() => useLocaleSync());

    ticks(5);
    expect(reload).not.toHaveBeenCalled();
  });

  it('cookie buzuq bo`lsa hech qachon yuklamaydi', () => {
    // Tekshiruvsiz bu AYNAN cheksiz siklga olib borardi: 'xx' hech qachon
    // render tiliga teng bo'lmaydi, ya'ni har tur reload chaqirardi.
    setCookie('xx');
    renderHookWithProviders(() => useLocaleSync());

    ticks(5);
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('cfd.localeReloadFor')).toBeNull();
  });

  it('til qaytib mos kelsa belgi tozalanadi va keyingi o`zgarish yana ishlaydi', () => {
    // Belgi tozalanmasa: kassir `ru` ga o'tib, keyin `uz` ga qaytib, yana
    // `ru` bosganda ekran BOSHQA ergashmasdi — jimgina eski tilda qolardi.
    setCookie('ru');
    renderHookWithProviders(() => useLocaleSync());

    ticks();
    expect(reload).toHaveBeenCalledTimes(1);

    setCookie('uz'); // render bilan mos ⇒ belgi tozalanadi
    ticks();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('cfd.localeReloadFor')).toBeNull();

    setCookie('ru'); // kassir yana almashtirdi
    ticks();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
