'use client';

import { setLocale } from '@/app/actions/locale';
import { type Locale, localeMeta, locales } from '@/i18n/config';
import { useToast } from '@moysklad/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * FAZA 1 (kassa ikki tilli, 2026-09-01) — kioskda til almashtirgich.
 *
 * NEGA YANGI KOMPONENT, `LocaleSwitcher` EMAS: `.exe` ichida layout HAR DOIM
 * kiosk shoxiga tushadi (`app/(app)/layout.tsx:752` — `isShersetShell()`), ya'ni
 * `AppShell` umuman chizilmaydi. `LocaleSwitcher` esa `AppShell` ning
 * `topRightExtras` ichida yashaydi ⇒ kassa qurilmasida u RENDER BO'LMAYDI va
 * kassir tilni umuman o'zgartira olmaydi. Bu — shu fazaning yagona sababi.
 *
 * NEGA `<select>` EMAS, ikkita katta tugma: kassada klaviatura yo'q, native
 * select esa sensorli ekranda noqulay (ochilgan ro'yxat barmoq ostida qoladi).
 * Balandlik `--pos-touch-min` — butun kassa yuzasi bilan bir xil sensor mezoni.
 *
 * NEGA `locales` massividan chiziladi, `['uz','ru']` qattiq yozilmaydi: uchinchi
 * til qo'shilganda `i18n/config.ts` dan boshqa hech nima o'zgarmasin. Nomlar
 * `localeMeta[l].nativeLabel` dan — til nomi DOIM o'z tilida yoziladi, ya'ni
 * joriy locale'ga bog'liq emas (RU bandlida ham `uz` = "O'zbek").
 *
 * 🔴 XATO ISHLOVI ATAYLAB BOR. Mavjud `components/locale-switcher.tsx:22-27` da
 * `catch` YO'Q — tarmoq uzilsa `await setLocale(...)` otiladi va uni hech kim
 * ushlamaydi (web navbar uchun bu chidasa ham, kassa uchun tarmoq uzilishi REAL
 * kundalik holat). Shu sababdan bu yerda `try/catch` + toast bor, va tugmalar
 * o'zidan-o'zi avvalgi holatga qaytadi: yagona haqiqat manbai `useLocale()`,
 * ya'ni MUVAFFAQIYATSIZ urinish hech qanday holatni o'zgartirmaydi.
 */
export function PosLocaleToggle() {
  const current = useLocale() as Locale;
  const t = useTranslations('pages.pos');
  const { toast } = useToast();
  const router = useRouter();

  /**
   * Qaysi tilga o'tilmoqda (`null` = bo'sh turibdi). Bir maydonda IKKI narsa:
   * «band» bayrog'i (ikkala tugma `disabled` ⇒ ikki marta bosish yo'q) va
   * «qaysi tugma kutmoqda» ko'rsatkichi. Ikki alohida `useState` bo'lsa ular
   * bir-biridan ajrab qolishi mumkin edi (band, lekin nishon `null`).
   */
  const [pending, setPending] = useState<Locale | null>(null);

  const pick = async (next: Locale) => {
    if (pending !== null || next === current) return;
    setPending(next);
    try {
      await setLocale(next);
      // 🔴 `router.refresh()` — TO'LIQ reload EMAS. Savat oddiy React holati
      // (`sotuv/page.tsx:422` `useState<CartLine[]>([])`), reload uni yo'qotardi.
      // Sahifa daraxti saqlanadi, faqat server render qayta olinadi.
      router.refresh();
    } catch {
      // Sabab ko'rsatilmaydi (server action xatosi kassirga ma'nosiz) — lekin
      // JIM ham qolinmaydi: tugma bosildi, til o'zgarmadi, kassir buni bilishi
      // kerak, aks holda u tugmani qayta-qayta bosadi.
      toast.error(t('locale_change_failed'));
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      data-test-id="pos-locale-toggle"
      className="rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)] p-4"
    >
      {/* Ko'rinadigan sarlavha — `role="group"` + `aria-label` ATAYLAB YO'Q:
          biome `useSemanticElements` uni `<fieldset>` ga majburlaydi (form
          elementlari uchun), bu yerda esa forma yo'q. Guruh nomi shu matndan
          o'qiladi, har tugma esa o'z nomi + `aria-pressed` ni o'zi tashiydi. */}
      <p className="mb-3 font-semibold text-[var(--ms-text-muted)] text-xs uppercase tracking-widest">
        {t('language')}
      </p>
      <div className="flex gap-2">
        {locales.map((l) => {
          const active = l === current;
          return (
            <button
              key={l}
              type="button"
              data-test-id={`pos-locale-${l}`}
              // `aria-pressed` HAQIQATNI aytadi — `current`, «kutilayotgan
              // nishon» emas. Muvaffaqiyatsiz urinishda ekran o'qigich yolg'on
              // holatda qolmasligi kerak; kutish esa vizual (`aria-busy`).
              aria-pressed={active}
              aria-busy={pending === l}
              disabled={pending !== null}
              onClick={() => void pick(l)}
              className={`flex h-[var(--pos-touch-min)] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border font-semibold text-[18px] transition-all active:scale-95 disabled:opacity-60 ${
                active
                  ? 'border-[var(--ms-brand-500)] bg-[var(--ms-brand-500)] text-white'
                  : 'border-[var(--ms-border)] text-[var(--ms-text-primary)] hover:bg-[var(--ms-bg-hover)]'
              }`}
            >
              <span aria-hidden="true">{localeMeta[l].flag}</span>
              {localeMeta[l].nativeLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
