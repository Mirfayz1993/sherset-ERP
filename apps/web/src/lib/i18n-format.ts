'use client';

import { type Locale, defaultLocale, isLocale } from '@/i18n/config';
import { useLocale } from 'next-intl';

/**
 * FAZA 3 (kassa ikki tilli, 2026-09-01) — SANA/VAQT formati tilga bog'lanadi.
 *
 * `Locale` (i18n kaliti: `uz` | `ru`) → BCP-47 teg (`Intl` locale identifikatori).
 * Ikkisi BOSHQA narsa: birinchisi bandl nomi, ikkinchisi ICU'ga beriladigan
 * format identifikatori. Ilgari kassada 13 joyda BCP-47 teg QATTIQ `'uz-UZ'`
 * yozilgan edi — kassir tilni RU ga o'tkazganda ham sana o'zbekcha chiqardi.
 *
 * ── 🔴 O'LCHANGAN FARQ — VA NEGA REJA §1.3 JADVALIGA ISHONMA
 *
 * Reja §1.3 «son va vaqt bir xil, faqat sana farq qiladi» deydi. Bu Node ICU'da
 * to'g'ri, KIOSKDA (Electron = Chromium) esa NOTO'G'RI. Ikkalasi ham o'lchandi
 * (2026-09-02; Node v24.13.1 / ICU 78.2, Chromium 152) — kassir Chromium'ni
 * ko'radi, Node'ni emas:
 *
 *   | qiymat                        | Node uz-UZ  | Chromium uz-UZ | ru-RU (ikkisida ham) |
 *   | 1234567 .toLocaleString()     | 1 234 567   | 1,234,567      | 1 234 567 (U+00A0)   |
 *   | {day,month,year: '2-digit'}   | 01/09/26    | 26-09-01       | 01.09.26             |
 *   | {hour,minute: '2-digit'}      | 14:05       | 14:05          | 14:05                |
 *
 * Ya'ni kioskda `uz-UZ`:
 *   · sanani YIL-OLDIN yozadi (`26-09-01`), `ru-RU` esa `01.09.26`;
 *   · sonni VERGUL bilan guruhlaydi (`1,234,567`), `ru-RU` esa ingichka
 *     probel bilan (`1 234 567`) — ya'ni SON o'zgarishi vizual no-op EMAS.
 * Vaqt yagona haqiqiy no-op.
 *
 * Shu sababdan son chaqiruvi (`sotuv-mode.tsx` — qoldiq MIQDORI, pul emas) ham
 * shu helper'dan o'tadi: RU rejimida u endi yonidagi `formatMoney` bilan bir xil
 * ajratgichni oladi, UZ rejimida esa hech nima o'zgarmaydi.
 *
 * ── 🔴 BU HELPER PUL UCHUN EMAS (reja §2.5)
 *
 * `formatMoney` (`packages/design-system/src/lib/format.ts:40`) va
 * `components/pos/pos-rate-chip.tsx:43` ATAYLAB `'ru-RU'` da qotirilgan —
 * moysklad pul-pariteti (ingichka probel + vergul: `64 000,00`). Ular lokalga
 * bog'lansa pul ko'rinishi tilga qarab o'zgarardi va ICU versiyasiga bog'liq
 * bo'lib qolardi. Bu helper'ni pul chiqishiga ulash = REGRESSIYA.
 */
export const BCP47: Record<Locale, string> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
};

/**
 * Joriy til uchun BCP-47 teg.
 *
 * `useLocale()` `string` qaytaradi (next-intl bizning `Locale` birlashmamizni
 * bilmaydi), shuning uchun `isLocale` bilan toraytiriladi. Noma'lum qiymatda —
 * `defaultLocale` (`uz`) tegi: ekranda «undefined locale» xatosi emas, ishlaydigan
 * format chiqsin. Bu fallback JIM emas — u `i18n/config.ts` dagi bir xil
 * default bilan bitta manbadan keladi, ya'ni til qo'shilganda bu yerda hech
 * nima o'zgarmaydi (`Record<Locale, …>` tipi yangi tilni MAJBURLAYDI).
 */
export function useBcp47(): string {
  const locale = useLocale();
  return BCP47[isLocale(locale) ? locale : defaultLocale];
}
