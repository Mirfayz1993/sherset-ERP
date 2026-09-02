'use client';

/**
 * «Zakazlar» rejimi (F7/F8) — jarayondagi mijoz zakazlari ro'yxati (holat
 * filtri serverga ketadi) + zakaz detali (tasdiqlash, to'lash).
 *
 * F1 (POS redizayn, 2026-08-14): ro'yxat JSX'i va `ZakazDetailPanel`
 * `page.tsx` dan XULQNI O'ZGARTIRMASDAN ko'chirildi. Ro'yxat so'rovi,
 * holat-filtri va tanlov sahifada QOLADI (mijoz kartasi ham
 * `setSelectedOrderId` orqali shu detalga yo'naltiradi); «To'lash» oqimi
 * (`payOrderMut`) ham sahifada — savat/chek yaratish o'sha yerning ishi.
 */

import { usePermissions } from '@/hooks/use-permissions';
import { api } from '@/lib/api-client';
import { useBcp47 } from '@/lib/i18n-format';
import { normalizeQtyDecimal } from '@/lib/pos/cart-math';
import { Button, formatMoney, useToast } from '@moysklad/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';

/**
 * POS'da ko'rinadigan zakaz holatlari — CustomerOrder FSM'ning boshlanish
 * qismi (`customer-order.service.ts#validateTransition`).
 *
 * 🔴 Bu YANGI holat-o'qi EMAS. CustomerOrder'da allaqachon ikkita bor:
 * FSM `state` va tenant sozlaydigan `statusId`. Uchinchisini qo'shish
 * chalkashtirardi, shuning uchun POS mavjud `state` ni o'qiydi va mavjud
 * transition endpointini chaqiradi.
 */
export const POS_ORDER_STATES = ['draft', 'confirmed', 'awaiting_payment'] as const;
export type PosOrderState = (typeof POS_ORDER_STATES)[number];

export interface OrderRow {
  id: string;
  name: string;
  moment: string;
  sumMinor: string;
  state: string;
  agent: { id: string; name: string } | null;
}

export interface OrderPosition {
  id: string;
  quantity: string;
  /** Rezerv qilingan miqdor — tasdiqlashdan keyin shu raqam ko'tariladi. */
  reservedQty: string;
  priceMinor: string;
  discount: string;
  product: { id: string; name: string; code: string | null; uom: string | null } | null;
}

export interface OrderDetail extends OrderRow {
  positions: OrderPosition[];
}

/**
 * Zakaz detali + `draft → confirmed` tasdiqlash.
 *
 * Tasdiqlash AYNAN `POST /customer-orders/:id/transitions/confirmed` ga
 * boradi — kiosk allowlist'da ochilgan yagona yozuv yo'li. Rezervni FE
 * QO'YMAYDI: server `confirmed` da uni o'zi qo'yadi
 * (`customer-order.service.ts` → `applyReservationInvariant('hold-remaining')`),
 * shuning uchun bu yerda `bulk-reserve` kabi ikkinchi chaqiruv YO'Q.
 */
function ZakazDetailPanel({
  orderId,
  onBack,
  onPay,
  paying,
}: {
  orderId: string;
  onBack: () => void;
  /** F8 — zakazni savatga yuklab chek yaratadi (`SalesScreen` bajaradi). */
  onPay: (order: OrderDetail) => void;
  paying: boolean;
}) {
  const t = useTranslations('pages.sotuv');
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const { data, isLoading } = useQuery<OrderDetail>({
    queryKey: ['pos-customer-order', orderId],
    queryFn: () => api.get(`/customer-orders/${orderId}`),
  });

  const confirmMut = useMutation({
    mutationFn: () => api.post(`/customer-orders/${orderId}/transitions/confirmed`, {}),
    onSuccess: () => {
      toast.success(t('orders_confirm_success'));
      qc.invalidateQueries({ queryKey: ['pos-customer-order', orderId] });
      qc.invalidateQueries({ queryKey: ['pos-customer-orders'] });
    },
    // Server xatosi (masalan «O'tkazilmaydi: cancelled → confirmed») kassirga
    // AYNAN ko'rsatiladi — jim yutilsa u tugmani qayta-qayta bosardi.
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--ms-text-muted)]">
        {t('loading')}
      </div>
    );
  }

  // Tugma FAQAT `draft` da: qolgan holatlarda server ham rad etadi
  // (`validateTransition`), ya'ni ko'rsatish yolg'on va'da bo'lardi.
  const canConfirm = data.state === 'draft' && can('customerorder', 'approve');
  /**
   * F8 — «To'lash» FAQAT to'lanadigan holatda.
   *
   * Ro'yxat serverdagi `ORDER_PAYABLE_STATES` bilan AYNI: `draft` da rezerv
   * hali tushmagan (avval «Tasdiqlash»), `paid`/`cancelled`/jo'natilganlarda
   * esa server 409/400 beradi. Tugmani ko'rsatib keyin rad etish — yolg'on
   * va'da; lekin bu FAQAT ekran qulfi, haqiqiy himoya serverda va tranzaksiya
   * ichida (`retail-sale.service.post()` → holat-shartli `updateMany`).
   */
  const canPay =
    (data.state === 'confirmed' || data.state === 'awaiting_payment') &&
    can('retailsale', 'create');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--ms-border)] px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ms-border)] text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[var(--ms-text-primary)]">{data.name}</div>
          <div className="truncate text-xs text-[var(--ms-text-muted)]">
            {data.agent?.name ?? t('orders_no_agent')}
            {' · '}
            {t(`orders_filter_${data.state === 'awaiting_payment' ? 'awaiting' : data.state}`, {})}
          </div>
        </div>
        <div className="shrink-0 text-right font-bold tabular-nums text-[var(--ms-text-primary)]">
          {formatMoney(BigInt(data.sumMinor))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-1.5 font-bold text-[10px] text-[var(--ms-text-muted)] uppercase tracking-widest">
          {t('orders_positions')}
        </p>
        <div className="flex flex-col gap-1.5">
          {data.positions.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-app)] px-3 py-2"
            >
              <div className="truncate font-medium text-[var(--ms-text-primary)] text-sm">
                {p.product?.name ?? '—'}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[var(--ms-text-muted)] text-xs">
                <span className="tabular-nums">
                  {normalizeQtyDecimal(p.quantity)} × {formatMoney(BigInt(p.priceMinor))}
                </span>
                <span>·</span>
                {/* Rezerv — F7 ning butun qiymati shu raqamda ko'rinadi:
                    tasdiqlashdan keyin u miqdorga tenglashadi. */}
                <span className="tabular-nums">
                  {t('orders_reserved')}: {normalizeQtyDecimal(p.reservedQty)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(canConfirm || canPay) && (
        <div className="shrink-0 border-t border-[var(--ms-border)] p-3">
          {canConfirm && (
            <Button
              className="h-12 w-full text-base"
              disabled={confirmMut.isPending}
              onClick={() => confirmMut.mutate()}
            >
              {t('orders_confirm')}
            </Button>
          )}
          {canPay && (
            <Button
              className="h-12 w-full text-base"
              data-test-id="sotuv-order-pay"
              disabled={paying}
              onClick={() => onPay(data)}
            >
              {t('orders_pay')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Zakazlar rejimi (ro'yxat + detal) ───────────────────────────────────────

interface ZakazlarModeProps {
  orders: OrderRow[];
  orderState: PosOrderState;
  setOrderState: Dispatch<SetStateAction<PosOrderState>>;
  /** Tanlangan zakaz — holat sahifada (mijoz kartasi ham shu yerga yo'naltiradi). */
  selectedOrderId: string | null;
  setSelectedOrderId: Dispatch<SetStateAction<string | null>>;
  /** F8 — zakazni savatga yuklab chek yaratadi (sahifadagi `payOrderMut`). */
  onPay: (order: OrderDetail) => void;
  paying: boolean;
}

export function ZakazlarMode({
  orders,
  orderState,
  setOrderState,
  selectedOrderId,
  setSelectedOrderId,
  onPay,
  paying,
}: ZakazlarModeProps) {
  const t = useTranslations('pages.sotuv');
  const bcp47 = useBcp47();

  // F4 (spec §5.3) — to'liq-ekran: chapda holat-filtri + ro'yxat (64px
  // qatorlar), o'ngda detal-panel. Detal ilgari ro'yxat O'RNIGA chizilardi;
  // endi yonma-yon — funksional 1:1 (filtr, tasdiqlash, to'lash o'sha).
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Chap: filtr + ro'yxat ── */}
      <div className="flex w-[400px] shrink-0 flex-col overflow-hidden border-[var(--ms-border)] border-r">
        {/* Holat filtri — har chip serverga boshqa `state` yuboradi. */}
        <div className="flex shrink-0 gap-1.5 border-[var(--ms-border)] border-b p-2">
          {POS_ORDER_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setOrderState(s)}
              className={`h-[48px] min-w-0 flex-1 rounded-lg border px-2 font-medium text-[15px] transition-colors ${
                orderState === s
                  ? 'border-[var(--ms-brand)] bg-[var(--ms-brand)] text-white'
                  : 'border-[var(--ms-border)] text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]'
              }`}
            >
              {t(`orders_filter_${s === 'awaiting_payment' ? 'awaiting' : s}`)}
            </button>
          ))}
        </div>
        {orders.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[var(--ms-text-muted)]">
            <ClipboardList className="h-10 w-10 opacity-30" />
            <p className="text-[16px]">{t('orders_empty')}</p>
            <p className="text-[14px]">{t('orders_empty_hint')}</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col divide-y divide-[var(--ms-border)] overflow-y-auto">
            {orders.map((o) => (
              <button
                type="button"
                key={o.id}
                onClick={() => setSelectedOrderId(o.id)}
                data-selected={selectedOrderId === o.id || undefined}
                className="flex min-h-[var(--pos-row-h)] w-full shrink-0 items-center gap-2 px-4 text-left hover:bg-[var(--ms-bg-hover)] active:bg-[var(--ms-bg-hover)] data-[selected]:bg-[var(--pos-brand)]/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[18px] text-[var(--ms-text-primary)]">
                    {o.name}
                  </div>
                  <div className="truncate text-[14px] text-[var(--ms-text-muted)]">
                    {o.agent?.name ?? t('orders_no_agent')}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold text-[18px] text-[var(--ms-text-primary)] tabular-nums">
                    {formatMoney(BigInt(o.sumMinor))}
                  </div>
                  <div className="text-[14px] text-[var(--ms-text-muted)] tabular-nums">
                    {new Date(o.moment).toLocaleDateString(bcp47, {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </div>
                </div>
                <span className="shrink-0 text-[14px] text-[var(--ms-text-muted)]">›</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── O'ng: detal-panel yoki tanlov-taklif ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedOrderId ? (
          <ZakazDetailPanel
            orderId={selectedOrderId}
            onBack={() => setSelectedOrderId(null)}
            onPay={onPay}
            paying={paying}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--ms-text-muted)]">
            <ClipboardList className="h-12 w-12 opacity-30" />
            <span className="text-[18px]">{t('orders_detail_placeholder')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
