'use client';

/**
 * F2 (POS redizayn) — 64px ko'k header (spec §3.1).
 *
 * Chapda SHERSET matn-logotipi (public/ da tayyor asset YO'Q — tekshirildi,
 * matn-logotip qalin oq, keng kerning bilan), o'rtada smena-chip (eski
 * «session strip» ma'lumotlari: kassir · yosh · savdo jami; `stale` → sariq),
 * o'ngda aloqa indikatori · soat · versiya-badge (F9, spec §3.1 — qobiqda) ·
 * `children` sloti (F6 oyna-tugmalari).
 *
 * `position: fixed` ATAYLAB ishlatilmaydi — desktop klaviatura-evristikasi
 * (`keyboardRoot`) «fixed ichida button»ni klaviatura ildizi deb qidiradi;
 * header oddiy flex-oqimda turadi (reja «Global cheklovlar»).
 *
 * Soat minutlik interval bilan yangilanadi; sekundlar ko'rsatilmaydi —
 * kassirga kerak emas, interval esa arzon qoladi.
 *
 * 🔴 Soat SERVER vaqtida (S-reja S1, 2026-09-04). Ilgari u qurilma soatidan
 * o'qilardi va kassa mashinasining vaqti adashsa ekranda ham xato chiqardi
 * (egasining shikoyati). Endi manba — `serverNow()`, mintaqa esa qat'iy
 * `POS_TZ`, ya'ni qurilmaning sozlamasi umuman so'ralmaydi.
 */

import { useServerClock } from '@/hooks/use-server-clock';
import { POS_TZ } from '@/lib/clock';
import { useBcp47 } from '@/lib/i18n-format';
import type { CurrentSession } from '@moysklad/contracts';
import { formatMoney } from '@moysklad/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PosRateChip } from './pos-rate-chip';
import { ShellVersionBadge } from './shell-version-badge';
import { WindowControls } from './window-controls';

export interface PosHeaderProps {
  session: CurrentSession;
  /** P4 — server bergan `openMinutes`dan sahifa hisoblagan matn (`formatShiftAge`). */
  shiftAge: string;
  /** `useServerLink()` — oxirgi so'rov network-darajada muvaffaqiyatlimi. */
  connectionOk: boolean;
  /** O'ng chet sloti — F6 oyna-tugmalari (va sahifaning CFD tugmasi) shu yerga. */
  children?: ReactNode;
}

/**
 * «HH:MM» — SERVER vaqti, `POS_TZ` mintaqasida.
 *
 * Lokal `useBcp47()` dan olinadi (Faza 3 konvensiyasi, `pos-bcp47-guard`
 * qo'riqchisi shuni talab qiladi). Chiqish ikki tilda AYNI: soat/daqiqa —
 * o'sha qo'riqchi hujjatlagan yagona haqiqiy no-op (`i18n-format.ts` jadvali,
 * Node va Chromium'da o'lchangan), ya'ni bu ulanish ko'rinishni o'zgartirmaydi.
 *
 * `hour12` ATAYLAB berilmaydi: `false` ba'zi ICU nusxalarida h24 ga tushib
 * yarim tunni «24:00» qilib yozadi; ikkala lokalimiz ham sukut bo'yicha h23.
 */
function useMinuteClock(): string {
  const bcp47 = useBcp47();
  // Minut boshiga tekislamaymiz — 30s qadam bilan eng ko'p yarim minut
  // kechikadi, kod esa sodda qoladi (drift-tekislash mantiqsiz murakkablik).
  const now = useServerClock(30_000);
  return now
    ? now.toLocaleTimeString(bcp47, {
        hour: '2-digit',
        minute: '2-digit',
        // Qurilmaning mintaqa sozlamasi so'ralmaydi (S1).
        timeZone: POS_TZ,
      })
    : '';
}

export function PosHeader({ session, shiftAge, connectionOk, children }: PosHeaderProps) {
  const t = useTranslations('pages.pos');
  const now = useMinuteClock();

  return (
    // 64px — px bilan ATAYLAB: ildiz font-size 12px (ERP zichligi), rem-asosli
    // `h-16` real 48px chiqadi va spec §3.1 balandligini buzadi.
    <header
      data-test-id="pos-header"
      className="flex h-[64px] shrink-0 items-center gap-4 bg-[var(--pos-brand)] px-4 text-[var(--pos-on-brand)]"
    >
      {/* SHERSET — matn-logotip (brend nomi, tarjima qilinmaydi — POS_ALLOWED). */}
      <span
        data-test-id="pos-header-logo"
        className="select-none font-extrabold text-[22px] tracking-[0.22em]"
      >
        SHERSET
      </span>

      {/* Smena-chip — eski «session strip» o'rnini bosadi (spec §3.1). */}
      <div
        data-test-id="pos-header-shift-chip"
        data-stale={session.stale ? 'true' : 'false'}
        className={`flex min-w-0 items-center gap-2.5 rounded-full px-4 py-2 text-[15px] ${
          session.stale
            ? 'bg-amber-400 font-semibold text-amber-950'
            : 'bg-white/15 text-[var(--pos-on-brand)]'
        }`}
      >
        <span className="truncate font-semibold">{session.cashier.name}</span>
        <span className="opacity-70">·</span>
        <span className="whitespace-nowrap">{t('header_shift_age', { age: shiftAge })}</span>
        <span className="opacity-70">·</span>
        <span className="whitespace-nowrap font-semibold tabular-nums">
          {t('header_sales', {
            n: session.salesCount,
            sum: formatMoney(BigInt(session.salesSumMinor)),
          })}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        {/* Dollar kursi (egasi, 2026-08-17). Kassir KO'RADI, egasi shu yerdan
            O'ZGARTIRADI — kiosk planshetdan ERP sozlamalari ochilmaydi. */}
        <PosRateChip />

        {/* Aloqa indikatori — nuqta doim turadi, matn faqat uzilganda
            (spec §3.1: «uzilsa qizil nuqta + banner»). */}
        <div
          data-test-id="pos-header-conn"
          data-ok={connectionOk ? 'true' : 'false'}
          title={connectionOk ? t('header_conn_ok') : t('header_conn_lost')}
          className="flex items-center gap-2"
        >
          <span
            className={`h-[12px] w-[12px] rounded-full ${
              connectionOk ? 'bg-emerald-400' : 'animate-pulse bg-red-500'
            }`}
          />
          {!connectionOk && (
            <span className="whitespace-nowrap rounded-md bg-red-500 px-2.5 py-1 font-bold text-[13px] text-white">
              {t('header_conn_lost')}
            </span>
          )}
        </div>

        {/* Soat — SERVER vaqtida (S1); testda skew bilan assert qilinadi. */}
        <span
          data-test-id="pos-header-clock"
          className="font-semibold text-[20px] tabular-nums tracking-wide"
        >
          {now}
        </span>

        {/* F9 — versiya-badge headerga singdirildi (spec §3.1; qobiqsiz null). */}
        <ShellVersionBadge variant="header" />

        {/* Sahifa sloti (CFD tugmasi va b.). */}
        {children}

        {/* F6 — oyna-tugmalari ENG o'ngda (faqat yangi exe qobig'ida chiziladi). */}
        <WindowControls />
      </div>
    </header>
  );
}
