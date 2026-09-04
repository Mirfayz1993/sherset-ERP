'use client';

/**
 * «Navbat» rejimi — ikki ustunli kanban (F4, spec §5.2, Q3): chapda
 * «Yig'ilmoqda» (picking, sariq), o'ngda «Tayyor» (ready, yashil).
 *
 * F1 da bu fayl ikki alohida tab-blokni (`which` prop) ko'chirgan edi; F4
 * ularni bitta kanban ekraniga birlashtirdi. Server so'rovlari va amallar
 * (bekor qilish, tayyorlash, to'lovga tortish) avvalgidek sahifada —
 * bu komponent faqat ko'rinish.
 *
 * Karta tarkibi (spec §5.2): chek raqami (20px) · summa · mijoz · o'tgan
 * vaqt. Tugmalar: «To'lash» (F9: yorliq «To'lov»dan almashdi — reja/egasi
 * qarori) FAQAT tayyor kartada (server `post()` faqat
 * `ready` dan qabul qiladi); «Tasdiqlash» (kassir o'zi ready qiladi —
 * egasi 2026-08-11 yo'li, F4 uni OLIB TASHLAMAYDI) faqat yig'ilmoqda
 * kartada; «Bekor qilish» ikkalasida. O'lchamlar px'da (F2 qoidasi:
 * ildiz font 12px, rem-asosli klasslar 0.75× kichik chiqadi).
 */

import { useServerClock } from '@/hooks/use-server-clock';
import { formatMoney } from '@moysklad/ui';
import { CheckCircle, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SaleRow } from './pos-types';

interface NavbatModeProps {
  pickingSales: SaleRow[];
  readySales: SaleRow[];
  /** Chekni bekor qilish — tasdiq (raqam + summa bilan) sahifada. */
  cancelSale: (saleId: string, saleName: string, sumMinor: string) => void | Promise<void>;
  /** «Jarayonda» chekni kassir o'zi `ready` ga o'tkazishi (tasdiq sahifada). */
  markReady: (saleId: string, saleName: string) => void | Promise<void>;
  /** «Tayyor» chekni savatga tortib to'lov oynasini ochish. */
  loadReadyToCart: (saleId: string) => void | Promise<void>;
}

/**
 * 🔴 Kartalardagi «o'tgan vaqt» — SERVER soatida (S-reja S3).
 *
 * Ilgari bu yerda o'z 30s pulsi turardi (`useNowTick`, `Date.now()`). Xato
 * eng qattiq aynan shu joyda chiqardi: `sale.moment` SERVERniki, `now` esa
 * QURILMANIKI — ikkisining ayirmasi kassa soati adashgan qadar xato bo'lardi
 * («3 daqiqa oldin» yig'ilgan chek «3 soat 5 daqiqa» bo'lib turardi).
 * Endi puls `useServerClock` da (S1), ya'ni ikkala uchi ham server vaqti.
 *
 * `useServerClock` mount'gacha `null` qaytaradi (gidratatsiya qarori).
 * Kartada u paytda vaqt YOZILMAYDI — soxta «hozir» chiqarish kassirga
 * yolg'on ma'lumot berardi; bo'sh joy esa bir kadrdan keyin to'ladi.
 */
function formatElapsed(
  t: ReturnType<typeof useTranslations<'pages.sotuv'>>,
  moment: string,
  now: number,
): string {
  const min = Math.floor(Math.max(0, now - new Date(moment).getTime()) / 60_000);
  if (min < 1) return t('navbat_elapsed_now');
  if (min < 60) return t('navbat_elapsed_min', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('navbat_elapsed_hm', { h, m: min % 60 });
  return t('navbat_elapsed_day', { d: Math.floor(h / 24) });
}

function NavbatCard({
  sale,
  tone,
  now,
  cancelSale,
  markReady,
  loadReadyToCart,
}: {
  sale: SaleRow;
  tone: 'picking' | 'ready';
  /** `null` — soat hali o'lchanmagan (mount'gacha): vaqt umuman chizilmaydi. */
  now: number | null;
} & Pick<NavbatModeProps, 'cancelSale' | 'markReady' | 'loadReadyToCart'>) {
  const t = useTranslations('pages.sotuv');
  const border = tone === 'picking' ? 'border-amber-300' : 'border-emerald-300';
  const elapsed = now == null ? null : formatElapsed(t, sale.moment, now);
  return (
    <div
      data-test-id="navbat-card"
      className={`flex flex-col gap-2 rounded-2xl border ${border} bg-[var(--ms-bg-surface)] p-3 shadow-sm`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[20px] font-bold text-[var(--ms-text-primary)]">
          {sale.name}
        </span>
        <span className="shrink-0 text-[20px] font-semibold tabular-nums text-[var(--ms-text-primary)]">
          {formatMoney(BigInt(sale.sumMinor))}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] text-[var(--ms-text-muted)]">
        {/* Ajratuvchi nuqta o'zidan OLDINGI bo'lak chizilgandagina qo'yiladi —
            vaqt hali o'lchanmagan bir kadrda osilib qolgan «·» chiqmasin. */}
        {sale.agent && <span className="truncate">{sale.agent.name}</span>}
        {sale.agent && elapsed != null && <span>·</span>}
        {elapsed != null && <span className="tabular-nums">{elapsed}</span>}
        {sale._count?.positions != null && (
          <>
            {(sale.agent != null || elapsed != null) && <span>·</span>}
            <span>{t('positions_count', { n: sale._count.positions })}</span>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => cancelSale(sale.id, sale.name, sale.sumMinor)}
          className={`flex h-[var(--pos-touch-min)] shrink-0 items-center rounded-xl border ${border} px-4 text-[16px] font-semibold text-[var(--ms-text-muted)] transition-all hover:bg-[var(--ms-bg-hover)] active:scale-95`}
        >
          {t('cancel_sale')}
        </button>
        {tone === 'picking' ? (
          <button
            type="button"
            onClick={() => markReady(sale.id, sale.name)}
            className="flex h-[var(--pos-touch-min)] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[18px] font-bold text-white transition-all hover:bg-amber-600 active:scale-95"
          >
            <CheckCircle className="h-5 w-5 shrink-0" />
            {t('mark_ready')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => loadReadyToCart(sale.id)}
            className="flex h-[var(--pos-touch-min)] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-[18px] font-bold text-white transition-all hover:bg-emerald-600 active:scale-95"
          >
            💳 {t('pay')}
          </button>
        )}
      </div>
    </div>
  );
}

export function NavbatMode({
  pickingSales,
  readySales,
  cancelSale,
  markReady,
  loadReadyToCart,
}: NavbatModeProps) {
  const t = useTranslations('pages.sotuv');
  // Umumiy 30s puls — har karta o'z intervalini ochmasin (navbatda o'nlab
  // karta bo'lishi mumkin). Manba SERVER soati (S1 `useServerClock`).
  const now = useServerClock(30_000)?.getTime() ?? null;
  const actions = { cancelSale, markReady, loadReadyToCart };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
      {/* ── Yig'ilmoqda (picking) ── */}
      <section
        data-test-id="navbat-col-picking"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/60"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-amber-200 px-4 py-3">
          <Clock className="h-5 w-5 text-amber-500" />
          <span className="text-[18px] font-bold text-amber-800">{t('navbat_col_picking')}</span>
          <span className="ml-auto rounded-full bg-amber-200 px-3 py-0.5 text-[14px] font-bold tabular-nums text-amber-800">
            {pickingSales.length}
          </span>
        </header>
        {pickingSales.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-[var(--ms-text-muted)]">
            <Clock className="h-10 w-10 opacity-30" />
            <p className="text-[16px]">{t('picking_empty_title')}</p>
            <p className="text-[14px]">{t('picking_empty_hint')}</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 [&>*]:shrink-0">
            {pickingSales.map((s) => (
              <NavbatCard key={s.id} sale={s} tone="picking" now={now} {...actions} />
            ))}
          </div>
        )}
      </section>

      {/* ── Tayyor (ready) ── */}
      <section
        data-test-id="navbat-col-ready"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-emerald-200 px-4 py-3">
          <CheckCircle className="h-5 w-5 text-emerald-600" />
          <span className="text-[18px] font-bold text-emerald-800">{t('navbat_col_ready')}</span>
          <span className="ml-auto rounded-full bg-emerald-200 px-3 py-0.5 text-[14px] font-bold tabular-nums text-emerald-800">
            {readySales.length}
          </span>
        </header>
        {readySales.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-[var(--ms-text-muted)]">
            <CheckCircle className="h-10 w-10 opacity-30" />
            <p className="text-[16px]">{t('ready_empty_title')}</p>
            <p className="text-[14px]">{t('ready_empty_hint')}</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 [&>*]:shrink-0">
            {readySales.map((s) => (
              <NavbatCard key={s.id} sale={s} tone="ready" now={now} {...actions} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
