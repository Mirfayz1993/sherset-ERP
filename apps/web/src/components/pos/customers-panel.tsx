'use client';

import { api } from '@/lib/api-client';
import { POS_TZ } from '@/lib/clock';
import { useBcp47 } from '@/lib/i18n-format';
import { formatAmountInput, parseAmountToMinor } from '@/lib/pos/parse-amount';
import type { ListEnvelope } from '@moysklad/contracts';
import type { CurrencyCode } from '@moysklad/money/currencies';
import { Input, formatMoney, useToast } from '@moysklad/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Receipt, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CustomerCardRow } from './customer-card-panel';

/**
 * F7/P07 (2026-08-13, egasi) — o'ng paneldagi «Mijozlar» tabi (Cheklar va
 * Smena orasida): «mijoz qarzidan pul to'lasa yoki nimadir qaytarsa, qulay
 * ishlash».
 *
 * Yo'naltiruvchi amallar (panel o'zi hech narsa yozmaydi):
 * - qarz to'lash → `onPayDebt` (chaqiruvchi `DebtPaymentDialog`ni shu mijoz
 *   bilan ochadi — qidiruv qadami o'tkazib yuboriladi);
 * - tarix/telefon-tahrir → `onOpenCustomerCard` (`CustomerCardPanel`);
 * - qaytarish → `onOpenChek` (`ChekDetailPanel`, F6 oqimi).
 *
 * 🔴 «Panel FAQAT ko'rsatadi, pul amali bajarmaydi» degan ESKI DA'VO
 * BEKOR QILINDI. U F7/P07 da to'g'ri edi; keyin ikki pul yo'li shu yerga
 * qo'shildi va ular hujjat ham, daftar qatorini ham yozadi:
 * - **G1** (2026-08-24) — vozvrat pulini kassadan qaytarish
 *   (`POST /cashier-sessions/:id/customer-payout`, RKO cheki);
 * - **A1** (2026-08-25) — mijozdan AVANS qabul qilish
 *   (`POST /cashier-sessions/:id/customer-prepay`, PKO cheki). Pul kassa
 *   yashig'iga tushadi va mijoz balansi MANFIY tomonga suriladi («biz
 *   mijozga qarzdormiz»). ⚠️ Bu QARZ EMAS — undirish ro'yxatiga
 *   tushmaydi (reja invariant 4).
 * Ikkalasi ham ochiq SMENA talab qiladi: `sessionId` yo'q bo'lsa tugmalar
 * o'chiq (smenasiz pul-hujjat yozib bo'lmaydi).
 *
 * Ekrandagi qarz — BITTA HALOL RAQAM: `payableMinor` (server AYNAN shu
 * summagacha qabul qiladi; xotira `pos-customer-card-one-number`).
 * `balanceMinor === null` — O'LCHANMAGAN, 0 emas: alohida qator bo'lib
 * OCHIQ aytiladi, raqam yashirilmaydi.
 * 🔴 **A3** (2026-08-25) — manfiy balansdagi «0» BEKOR QILINDI. Ekran endi
 * server bergan HOLATDAN yuradi (`standing`: qarz / avans / tekis /
 * o'lchanmagan) va avansi bor mijozda «Avansi: N» ko'rsatadi. Shu yerdan
 * uchinchi pul yo'li ham ochildi: **avansni NAQD QAYTARISH**
 * (`POST /cashier-sessions/:id/customer-prepay-refund`, RKO cheki) — cap
 * mijozning mavjud avansi, qulf va tekshiruv SERVERDA.
 *
 * Barcha ishlatiladigan endpointlar kiosk-policy'da ochiq:
 * `GET /counterparties?search=`, `GET /debts/pos/summary/:id`,
 * `GET /retail-sales?agentId=`, `/cashier-sessions/*`.
 */

/** `GET /debts/pos/summary/:id` javobining bu panel o'qiydigan qismi. */
interface DebtSummaryLite {
  payableMinor: string;
  /** `CounterpartyBalance` qatori; `null` = O'LCHANMAGAN (0 EMAS). */
  balanceMinor: string | null;
  /**
   * 🔴 A3 — ekran holati (server bilan BITTA sof qoidadan). Ixtiyoriy:
   * eski javobda yo'q va ekran o'sha holda avvalgidek ishlaydi.
   */
  standing?: {
    kind: 'debt' | 'prepaid' | 'settled' | 'unmeasured';
    amountMinor: string;
    conflicted: boolean;
  };
}

/** A3 — `POST /cashier-sessions/:id/customer-prepay-refund` javobi. */
interface PrepayRefundDoc {
  id: string;
  name: string;
  sumMinor: string;
  /** Qaytargandan KEYIN mijozda qolgan avans. */
  remainingPrepayMinor: string;
  auditTypes: string[];
}

/** `GET /counterparty-debt-receipts/:id/preview` — mijozga ketadigan matn. */
interface DebtReceiptPreview {
  messages: string[];
  canSend: boolean;
  reason: string | null;
  phone: string | null;
}

interface ChekRow {
  id: string;
  name: string;
  moment: string;
  sumMinor: string;
  state: string;
}

/** `GET /cashier-sessions/unpaid-returns?agentId=` — G1 bloki. */
interface UnpaidReturnRow {
  id: string;
  name: string;
  moment: string;
  currency: string;
  sumMinor: string;
  payedSumMinor: string;
  remainingMinor: string;
  /** `false` — valyutali vozvrat: ko'rinadi, lekin kassadan to'lab bo'lmaydi. */
  payable: boolean;
}

interface UnpaidReturnsPayload {
  items: UnpaidReturnRow[];
  totalRemainingMinor: string;
}

interface PayoutDoc {
  id: string;
  name: string;
  sumMinor: string;
  remainingMinor: string;
  auditTypes: string[];
}

/** A1 — `POST /cashier-sessions/:id/customer-prepay` javobi. */
interface PrepayDoc {
  id: string;
  name: string;
  sumMinor: string;
  /** Hujjatdan KEYINGI saldo; `null` = balans O'LCHANMAGAN edi (0 EMAS). */
  balanceAfterMinor: string | null;
}

interface Props {
  /** Kassa valyutasi — qarz AYNAN shu valyuta kesimida o'qiladi. */
  currency?: CurrencyCode;
  /**
   * G1 — ochiq smena id'si: vozvrat pulini qaytarish `POST
   * /cashier-sessions/:id/customer-payout` shu smenadan chiqadi. `null` —
   * to'lash tugmalari o'chiq (smenasiz pul berib bo'lmaydi).
   */
  sessionId?: string | null;
  /** «Mijoz kartasi» — chaqiruvchi `CustomerCardPanel`ni ochadi. */
  onOpenCustomerCard: (agent: CustomerCardRow) => void;
  /** «Qarzni to'lash» — chaqiruvchi qarz oynasini shu mijoz bilan ochadi. */
  onPayDebt: (agent: CustomerCardRow) => void;
  /** Chek bosildi — chaqiruvchi `ChekDetailPanel`ni ochadi (F6 qaytarish). */
  onOpenChek: (saleId: string) => void;
}

export function CustomersPanel({
  currency = 'UZS',
  sessionId = null,
  onOpenCustomerCard,
  onPayDebt,
  onOpenChek,
}: Props) {
  const t = useTranslations('pages.pos');
  const bcp47 = useBcp47();

  const [search, setSearch] = useState('');
  const [agent, setAgent] = useState<CustomerCardRow | null>(null);
  const [cheksOpen, setCheksOpen] = useState(false);
  /**
   * «Hisob-kitob cheki» — mijozning BUTUN hisobi Telegramga (egasi,
   * 2026-08-16). Panel naqshi «Cheklari» bilan bir xil: modal EMAS, ichki
   * ochiluvchi blok — qobiqda Radix modali ekran-klaviaturasini o'ldiradi
   * (xotira: `radix-modal-kills-shell-osk`) va sensorli ekranda ichki blok
   * qulayroq.
   */
  const [receiptOpen, setReceiptOpen] = useState(false);
  /**
   * G1 — to'lanayotgan vozvrat: `id` + summa maydoni (default — qolgan
   * qaytim TO'LIQ; qisman to'lash mumkin, cap server tomonda).
   */
  const [payingReturnId, setPayingReturnId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  /**
   * A1 — mijozdan AVANS qabul qilish bloki. Naqsh «Hisob-kitob cheki» va
   * G1 to'lovi bilan bir xil: modal EMAS, ichki ochiluvchi blok (qobiqda
   * Radix modali ekran-klaviaturasini o'ldiradi — xotira
   * `radix-modal-kills-shell-osk`).
   *
   * Default summa YO'Q va bo'lishi ham kerak emas: avansda «qolgani
   * qancha» degan manba yo'q, mijoz qancha bersa shuncha yoziladi.
   */
  const [prepayOpen, setPrepayOpen] = useState(false);
  const [prepayAmount, setPrepayAmount] = useState('');
  /**
   * A3 — avansni NAQD QAYTARISH bloki. A1 bilan bir xil naqsh, teskari
   * ishora. Farqi: bu yerda «qolgani qancha» degan MANBA bor (mijozning
   * avansi), shuning uchun summa maydoni o'sha son bilan TO'LADI —
   * G1 vozvrat to'lovi qanday qilsa, shunday.
   */
  const [prepayRefundOpen, setPrepayRefundOpen] = useState(false);
  const [prepayRefundAmount, setPrepayRefundAmount] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cpData, isLoading: cpLoading } = useQuery<ListEnvelope<CustomerCardRow>>({
    queryKey: ['pos-customers-search', search],
    queryFn: () => api.get(`/counterparties?search=${encodeURIComponent(search)}&limit=20`),
    enabled: !agent,
  });

  const { data: summary } = useQuery<DebtSummaryLite>({
    // Valyuta kalitda: kassa valyutasi o'zgarsa boshqa qoldiq o'qiladi.
    queryKey: ['pos-customers-debt', agent?.id, currency],
    queryFn: () => api.get(`/debts/pos/summary/${agent?.id}?currency=${currency}`),
    enabled: !!agent,
  });

  const { data: cheks } = useQuery<ListEnvelope<ChekRow>>({
    queryKey: ['pos-customers-cheks', agent?.id],
    queryFn: () =>
      api.get(`/retail-sales?agentId=${agent?.id}&limit=50&sortBy=moment&sortDir=desc`),
    enabled: !!agent && cheksOpen,
  });

  // Matn SERVERDAN keladi — mijoz ko'radigan xabarning O'ZI. Bu yerda ikkinchi
  // format nusxasi YO'Q: bo'lsa, u eskirib haqiqatdan ajralib qolardi.
  const receiptPreview = useQuery<DebtReceiptPreview>({
    queryKey: ['pos-debt-receipt-preview', agent?.id],
    queryFn: () => api.get(`/counterparty-debt-receipts/${agent?.id}/preview`),
    enabled: !!agent && receiptOpen,
    staleTime: 0,
  });

  // G1 — mijozning to'lanmagan vozvratlari (post bo'lgan SalesReturn'lar).
  const { data: unpaidReturns } = useQuery<UnpaidReturnsPayload>({
    queryKey: ['pos-unpaid-returns', agent?.id],
    queryFn: () => api.get(`/cashier-sessions/unpaid-returns?agentId=${agent?.id}`),
    enabled: !!agent,
  });

  const payReturn = useMutation({
    mutationFn: (args: { salesReturnId: string; sumMinor: bigint }) =>
      api.post<PayoutDoc>(`/cashier-sessions/${sessionId}/customer-payout`, {
        salesReturnId: args.salesReturnId,
        sumMinor: args.sumMinor.toString(),
      }),
    onSuccess: (doc) => {
      setPayingReturnId(null);
      setPayoutAmount('');
      // Blok va qarz-raqami yangilansin — pul chiqdi, balans surildi.
      queryClient.invalidateQueries({ queryKey: ['pos-unpaid-returns', agent?.id] });
      queryClient.invalidateQueries({ queryKey: ['pos-customers-debt', agent?.id] });
      if (doc.auditTypes.includes('CASH_OVERDRAWN')) {
        // Yashiqda kutilgandan ko'p pul chiqdi — server to'xtatmadi (Q10),
        // lekin kassir BILISHI kerak (cash-out oqimi bilan bir xil signal).
        toast.error(t('unpaid_returns_overdrawn'));
      } else {
        toast.success(t('unpaid_returns_paid', { name: doc.name }));
      }
      // Chek — mijoz imzo qo'yadigan qog'oz (RKO sahifasining payout varianti).
      window.open(`/print/cash-out/${doc.id}?auto=1`, '_blank');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * A1 — avansni qabul qilish. Pul kassa yashig'iga tushadi, mijoz balansi
   * MANFIY tomonga suriladi. Muvaffaqiyatda PKO cheki bosiladi (mijoz imzo
   * qo'yadigan qog'oz) va mijozning raqami yangilanadi.
   */
  const takePrepay = useMutation({
    mutationFn: (sumMinor: bigint) =>
      api.post<PrepayDoc>(`/cashier-sessions/${sessionId}/customer-prepay`, {
        counterpartyId: agent?.id,
        sumMinor: sumMinor.toString(),
      }),
    onSuccess: (doc) => {
      setPrepayOpen(false);
      setPrepayAmount('');
      // Mijoz kartasidagi raqam va qarz bloki yangilansin — balans surildi.
      queryClient.invalidateQueries({ queryKey: ['pos-customers-debt', agent?.id] });
      toast.success(t('prepay_taken', { name: doc.name }));
      // PKO cheki — mijoz imzo qo'yadigan qog'oz (RKO sahifasining kirim
      // varianti).
      window.open(`/print/cash-in/${doc.id}?auto=1`, '_blank');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * A3 — avansni naqd qaytarish. Kassa `−summa`, mijoz balansi `+summa`.
   * Muvaffaqiyatda RKO cheki bosiladi (mijoz imzo qo'yadigan qog'oz).
   */
  const refundPrepay = useMutation({
    mutationFn: (sumMinor: bigint) =>
      api.post<PrepayRefundDoc>(`/cashier-sessions/${sessionId}/customer-prepay-refund`, {
        counterpartyId: agent?.id,
        sumMinor: sumMinor.toString(),
      }),
    onSuccess: (doc) => {
      setPrepayRefundOpen(false);
      setPrepayRefundAmount('');
      queryClient.invalidateQueries({ queryKey: ['pos-customers-debt', agent?.id] });
      if (doc.auditTypes.includes('CASH_OVERDRAWN')) {
        // Yashiqda kutilgandan ko'p pul chiqdi — server to'xtatmadi (Q10),
        // lekin kassir BILISHI kerak (G1 bilan AYNI signal).
        toast.error(t('unpaid_returns_overdrawn'));
      } else {
        toast.success(t('prepay_refunded', { name: doc.name }));
      }
      window.open(`/print/cash-out/${doc.id}?auto=1`, '_blank');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendReceipt = useMutation({
    mutationFn: () =>
      api.post<{ queued: number }>(`/counterparty-debt-receipts/${agent?.id}/send`, {}),
    onSuccess: (r) => {
      setReceiptOpen(false);
      toast.success(t('debt_receipt_queued', { n: r?.queued ?? 1 }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function selectAgent(row: CustomerCardRow) {
    setAgent(row);
    // Oldingi mijozning ochiq bloklari yangisiga «meros» qolmasin.
    setCheksOpen(false);
    setReceiptOpen(false);
    setPayingReturnId(null);
    setPayoutAmount('');
    setPrepayOpen(false);
    setPrepayAmount('');
    setPrepayRefundOpen(false);
    setPrepayRefundAmount('');
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* F4 — faqat O'LCHAM-pass (spec §5.3/§4): qatorlar 64px, tugmalar
          ≥56px, shriftlar px-shkala; to'liq-ekranda o'qilishi uchun kontent
          640px ustunga yig'ilgan. Mantiq/DOM-tuzilma o'zgarmagan. */}
      {!agent && (
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2 p-3">
          {/* 🔴 `inputMode="tel"` OLIB TASHLANDI (2026-08-15, monoblokda):
              qobiq ekran-klaviaturasi `tel` rejimda FAQAT raqam panelini
              chiqaradi — «Telefon YOKI ISM» qidiruvida harf yozib bo'lmasdi.
              Matn rejimida raqam qatori baribir bor. */}
          <Input
            type="text"
            data-test-id="pos-customers-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('customer_card_search_placeholder')}
            className="h-[48px] text-[16px]"
          />
          {cpLoading && <p className="text-[16px] text-[var(--ms-text-muted)]">{t('searching')}</p>}
          {!cpLoading && (cpData?.items.length ?? 0) === 0 && (
            <p className="text-[16px] text-[var(--ms-text-muted)]">{t('debt_no_customers')}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {(cpData?.items ?? []).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-test-id="pos-customers-result"
                  onClick={() => selectAgent(row)}
                  className="flex min-h-[var(--pos-row-h)] w-full items-center justify-between gap-3 rounded-xl border border-[var(--ms-border)] px-4 text-left hover:bg-[var(--ms-bg-hover)] active:bg-[var(--ms-bg-hover)]"
                >
                  <span className="truncate font-medium text-[18px]">{row.name}</span>
                  <span className="shrink-0 text-[14px] text-[var(--ms-text-muted)]">
                    {row.phone ?? '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {agent && (
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 p-3">
          {/* ── Sarlavha ───────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-[20px] text-[var(--ms-text-primary)]">
                {agent.name}
              </p>
              <p className="text-[16px] text-[var(--ms-text-muted)]">{agent.phone ?? '—'}</p>
            </div>
            <button
              type="button"
              data-test-id="pos-customers-change"
              onClick={() => setAgent(null)}
              className="h-[48px] shrink-0 rounded-lg border border-[var(--ms-border)] px-4 text-[16px] hover:bg-[var(--ms-bg-hover)]"
            >
              {t('change_customer')}
            </button>
          </div>

          {/* ── Qarz: BITTA HALOL RAQAM ────────────────────────────────── */}
          {!summary ? (
            <p className="text-[16px] text-[var(--ms-text-muted)]">{t('debt_loading')}</p>
          ) : (
            <div
              data-test-id="pos-customers-debt"
              className="rounded-xl border border-[var(--ms-border)] p-4"
            >
              {/* 🔴 A3 — BITTA yirik son, IKKI ma'no (karta paneli bilan
                  AYNI qoida). Manba — serverning `standing` holati; eski
                  javobda u yo'q va ekran avvalgidek `payableMinor` ni
                  chizadi. */}
              <p className="text-[14px] text-[var(--ms-text-muted)]">
                {summary.standing?.kind === 'prepaid'
                  ? t('customer_card_prepaid')
                  : t('customer_card_payable')}
              </p>
              <p
                data-test-id="pos-customers-amount"
                data-standing={summary.standing?.kind ?? 'legacy'}
                className={`font-semibold text-[32px] tabular-nums ${
                  summary.standing?.kind === 'prepaid'
                    ? 'text-emerald-700'
                    : 'text-[var(--ms-text-primary)]'
                }`}
              >
                {formatMoney(summary.standing?.amountMinor ?? summary.payableMinor, currency)}
              </p>
              <p className="text-[14px] text-[var(--ms-text-muted)]">
                {summary.standing?.kind === 'prepaid'
                  ? t('customer_card_prepaid_hint')
                  : t('customer_card_payable_hint')}
              </p>
              {summary.balanceMinor === null && (
                <p
                  data-test-id="pos-customers-balance-missing"
                  className="mt-2 rounded-lg bg-[var(--ms-bg-hover)] px-3 py-2 text-[14px] text-[var(--ms-text-muted)]"
                >
                  {t('customer_card_balance_missing')}
                </p>
              )}
            </div>
          )}

          {/* ── G1: To'lanmagan vozvratlar — qaytim kassadan beriladi ──── */}
          {(unpaidReturns?.items.length ?? 0) > 0 && (
            <div
              data-test-id="pos-unpaid-returns"
              className="rounded-xl border border-[var(--ms-border)] p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium text-[16px]">
                  <Undo2 className="h-5 w-5 shrink-0 text-[var(--ms-text-muted)]" />
                  {t('unpaid_returns_title')}
                </p>
                <p
                  data-test-id="pos-unpaid-returns-total"
                  className="shrink-0 font-semibold text-[18px] tabular-nums"
                >
                  {formatMoney(unpaidReturns?.totalRemainingMinor ?? '0', currency)}
                </p>
              </div>
              <div className="flex flex-col divide-y divide-[var(--ms-border)]">
                {(unpaidReturns?.items ?? []).map((r) => (
                  <div key={r.id} className="flex flex-col gap-2 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[16px]">{r.name}</p>
                        <p className="text-[13px] text-[var(--ms-text-muted)]">
                          {new Date(r.moment).toLocaleDateString(bcp47, {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            // Qaytarish sanasi — do'kon mintaqasida (S4).
                            timeZone: POS_TZ,
                          })}
                          {r.payedSumMinor !== '0' &&
                            ` · ${t('unpaid_returns_partially_paid', {
                              sum: formatMoney(r.payedSumMinor, currency),
                            })}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-semibold text-[16px] tabular-nums">
                          {formatMoney(r.remainingMinor, r.currency as CurrencyCode)}
                        </span>
                        {r.payable ? (
                          <button
                            type="button"
                            data-test-id="pos-unpaid-returns-pay"
                            disabled={!sessionId}
                            onClick={() => {
                              // Qayta bosish blokni yopadi; ochilganda summa
                              // maydoni QOLGAN qaytim bilan to'ladi.
                              setPayingReturnId((cur) => (cur === r.id ? null : r.id));
                              setPayoutAmount(
                                formatAmountInput(BigInt(r.remainingMinor), currency),
                              );
                            }}
                            className="h-[44px] rounded-lg bg-[var(--ms-bg-brand)] px-4 font-semibold text-[15px] text-white disabled:opacity-50"
                          >
                            {t('unpaid_returns_pay')}
                          </button>
                        ) : (
                          <span className="text-[13px] text-[var(--ms-text-muted)]">
                            {t('unpaid_returns_foreign_currency')}
                          </span>
                        )}
                      </div>
                    </div>
                    {payingReturnId === r.id && (
                      <div
                        data-test-id="pos-unpaid-returns-confirm"
                        className="flex items-center gap-2"
                      >
                        <Input
                          type="text"
                          inputMode="decimal"
                          data-test-id="pos-unpaid-returns-amount"
                          value={payoutAmount}
                          onChange={(e) => setPayoutAmount(e.target.value)}
                          className="h-[44px] flex-1 text-[16px] tabular-nums"
                        />
                        <button
                          type="button"
                          data-test-id="pos-unpaid-returns-submit"
                          disabled={
                            payReturn.isPending ||
                            parseAmountToMinor(payoutAmount, currency) <= 0n ||
                            parseAmountToMinor(payoutAmount, currency) > BigInt(r.remainingMinor)
                          }
                          onClick={() =>
                            payReturn.mutate({
                              salesReturnId: r.id,
                              sumMinor: parseAmountToMinor(payoutAmount, currency),
                            })
                          }
                          className="h-[44px] shrink-0 rounded-lg bg-[var(--ms-bg-brand)] px-4 font-semibold text-[15px] text-white disabled:opacity-50"
                        >
                          {t('unpaid_returns_confirm')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Uch amal ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-test-id="pos-customers-pay"
              onClick={() => onPayDebt(agent)}
              className="h-[var(--pos-touch-min)] rounded-xl bg-[var(--ms-bg-brand)] font-semibold text-[18px] text-white active:scale-[0.99]"
            >
              {t('customer_card_pay_debt')}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                data-test-id="pos-customers-card"
                onClick={() => onOpenCustomerCard(agent)}
                className="h-[var(--pos-touch-min)] flex-1 rounded-xl border border-[var(--ms-border)] text-[16px] hover:bg-[var(--ms-bg-hover)]"
              >
                {t('customer_card_title')}
              </button>
              <button
                type="button"
                data-test-id="pos-customers-cheks"
                onClick={() => setCheksOpen((v) => !v)}
                className={`h-[var(--pos-touch-min)] flex-1 rounded-xl border text-[16px] ${
                  cheksOpen
                    ? 'border-[var(--ms-text-brand)] text-[var(--ms-text-brand)]'
                    : 'border-[var(--ms-border)] hover:bg-[var(--ms-bg-hover)]'
                }`}
              >
                {t('customers_cheks')}
              </button>
            </div>
            <button
              type="button"
              data-test-id="pos-customers-debt-receipt"
              onClick={() => setReceiptOpen((v) => !v)}
              className={`h-[var(--pos-touch-min)] rounded-xl border text-[16px] ${
                receiptOpen
                  ? 'border-[var(--ms-text-brand)] text-[var(--ms-text-brand)]'
                  : 'border-[var(--ms-border)] hover:bg-[var(--ms-bg-hover)]'
              }`}
            >
              {t('debt_receipt_btn')}
            </button>
            {/* ── A1: AVANS QABUL QILISH ─────────────────────────────────
                Smenasiz pul qabul qilib bo'lmaydi (hujjat smenaga
                bog'lanadi va kutilgan naqdga kiradi) — `sessionId` yo'q
                bo'lsa tugma o'chiq, G1 to'lovi bilan bir xil qoida. */}
            <button
              type="button"
              data-test-id="pos-customers-prepay"
              disabled={!sessionId}
              onClick={() => {
                setPrepayOpen((v) => !v);
                setPrepayAmount('');
              }}
              className={`h-[var(--pos-touch-min)] rounded-xl border text-[16px] disabled:opacity-50 ${
                prepayOpen
                  ? 'border-[var(--ms-text-brand)] text-[var(--ms-text-brand)]'
                  : 'border-[var(--ms-border)] hover:bg-[var(--ms-bg-hover)]'
              }`}
            >
              {t('prepay_btn')}
            </button>
            {/* ── A3: AVANSNI QAYTARISH ─────────────────────────────────
                Tugma FAQAT avansi bor mijozda ko'rinadi — avansi yo'q
                mijozda u har doim 400 beradigan tugma bo'lardi. Smenasiz
                o'chiq (A1/G1 bilan AYNI qoida: hujjat smenaga bog'lanadi
                va kutilgan naqddan chiqadi). */}
            {summary?.standing?.kind === 'prepaid' && (
              <button
                type="button"
                data-test-id="pos-customers-prepay-refund"
                disabled={!sessionId}
                onClick={() => {
                  setPrepayRefundOpen((v) => !v);
                  // Maydon QOLGAN avans bilan to'ladi (G1 naqshi): kassir
                  // ko'pincha hammasini qaytaradi.
                  setPrepayRefundAmount(
                    formatAmountInput(BigInt(summary.standing?.amountMinor ?? '0'), currency),
                  );
                }}
                className={`h-[var(--pos-touch-min)] rounded-xl border text-[16px] disabled:opacity-50 ${
                  prepayRefundOpen
                    ? 'border-[var(--ms-text-brand)] text-[var(--ms-text-brand)]'
                    : 'border-[var(--ms-border)] hover:bg-[var(--ms-bg-hover)]'
                }`}
              >
                {t('prepay_refund_btn')}
              </button>
            )}
          </div>

          {/* ── A3: qaytariladigan summa ───────────────────────────────── */}
          {prepayRefundOpen && summary?.standing?.kind === 'prepaid' && (
            <div
              data-test-id="pos-prepay-refund"
              className="flex flex-col gap-2 rounded-xl border border-[var(--ms-border)] p-3"
            >
              <p className="text-[14px] text-[var(--ms-text-muted)]">
                {t('prepay_refund_hint', {
                  amount: formatMoney(summary.standing.amountMinor, currency),
                })}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  data-test-id="pos-prepay-refund-amount"
                  value={prepayRefundAmount}
                  onChange={(e) => setPrepayRefundAmount(e.target.value)}
                  className="h-[48px] flex-1 text-[18px] tabular-nums"
                />
                <button
                  type="button"
                  data-test-id="pos-prepay-refund-submit"
                  disabled={
                    refundPrepay.isPending ||
                    parseAmountToMinor(prepayRefundAmount, currency) <= 0n ||
                    // Cap ekranda ham, serverda ham bor — lekin HAQIQIY
                    // qaror serverniki (u balansni qulflab o'qiydi).
                    parseAmountToMinor(prepayRefundAmount, currency) >
                      BigInt(summary.standing.amountMinor)
                  }
                  onClick={() =>
                    refundPrepay.mutate(parseAmountToMinor(prepayRefundAmount, currency))
                  }
                  className="h-[48px] shrink-0 rounded-lg bg-[var(--ms-bg-brand)] px-5 font-semibold text-[16px] text-white disabled:opacity-50"
                >
                  {t('prepay_refund_confirm')}
                </button>
              </div>
            </div>
          )}

          {/* ── A1: avans summasi ──────────────────────────────────────── */}
          {prepayOpen && (
            <div
              data-test-id="pos-prepay"
              className="flex flex-col gap-2 rounded-xl border border-[var(--ms-border)] p-3"
            >
              <p className="text-[14px] text-[var(--ms-text-muted)]">{t('prepay_hint')}</p>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  data-test-id="pos-prepay-amount"
                  value={prepayAmount}
                  onChange={(e) => setPrepayAmount(e.target.value)}
                  placeholder={t('prepay_amount_placeholder')}
                  className="h-[48px] flex-1 text-[18px] tabular-nums"
                />
                <button
                  type="button"
                  data-test-id="pos-prepay-submit"
                  disabled={
                    takePrepay.isPending || parseAmountToMinor(prepayAmount, currency) <= 0n
                  }
                  onClick={() => takePrepay.mutate(parseAmountToMinor(prepayAmount, currency))}
                  className="h-[48px] shrink-0 rounded-lg bg-[var(--ms-bg-brand)] px-5 font-semibold text-[16px] text-white disabled:opacity-50"
                >
                  {t('prepay_confirm')}
                </button>
              </div>
            </div>
          )}

          {/* ── Hisob-kitob cheki: KO'RIB CHIQIB, keyin yuborish ────────── */}
          {receiptOpen && (
            <div
              data-test-id="pos-debt-receipt"
              className="flex flex-col gap-2 rounded-xl border border-[var(--ms-border)] p-3"
            >
              {receiptPreview.isLoading && (
                <p className="text-[16px] text-[var(--ms-text-muted)]">
                  {t('debt_receipt_loading')}
                </p>
              )}
              {receiptPreview.error && (
                <p className="text-[16px] text-[var(--ms-text-destructive)]">
                  {(receiptPreview.error as Error).message}
                </p>
              )}
              {receiptPreview.data && (
                <>
                  {/* Yuborib bo'lmasa SABAB ko'rinadi — «tugma ishlamadi»
                      eng qimmat shikoyat (telefon yo'q / raqam ulanmagan). */}
                  {!receiptPreview.data.canSend && receiptPreview.data.reason && (
                    <p
                      data-test-id="pos-debt-receipt-reason"
                      className="rounded-lg bg-amber-50 px-3 py-2 text-[15px] text-amber-800"
                    >
                      {receiptPreview.data.reason}
                    </p>
                  )}
                  {receiptPreview.data.messages.map((m, i) => (
                    <pre
                      // biome-ignore lint/suspicious/noArrayIndexKey: bo'laklar tartibli va o'zgarmaydi
                      key={i}
                      className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--ms-bg-hover)] p-3 text-[14px] leading-relaxed"
                    >
                      {m}
                    </pre>
                  ))}
                  <button
                    type="button"
                    data-test-id="pos-debt-receipt-send"
                    disabled={!receiptPreview.data.canSend || sendReceipt.isPending}
                    onClick={() => sendReceipt.mutate()}
                    className="h-[var(--pos-touch-min)] rounded-xl bg-[var(--ms-bg-brand)] font-semibold text-[17px] text-white disabled:opacity-50"
                  >
                    {t('debt_receipt_send')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Cheklari (F6 qaytarish shu yerdan ochiladi) ────────────── */}
          {cheksOpen &&
            (!cheks || cheks.items.length === 0 ? (
              <p className="text-[16px] text-[var(--ms-text-muted)]">
                {t('customer_card_no_sales')}
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--ms-border)] rounded-xl border border-[var(--ms-border)]">
                {cheks.items.map((sale) => (
                  <button
                    type="button"
                    key={sale.id}
                    data-test-id="pos-customers-chek"
                    onClick={() => onOpenChek(sale.id)}
                    className="flex min-h-[var(--pos-row-h)] w-full items-center gap-3 px-4 text-left hover:bg-[var(--ms-bg-hover)] active:bg-[var(--ms-bg-hover)]"
                  >
                    <Receipt className="h-5 w-5 shrink-0 text-[var(--ms-text-muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-[18px] text-[var(--ms-text-primary)]">
                          {sale.name}
                        </span>
                        <span className="shrink-0 font-semibold text-[18px] tabular-nums">
                          {formatMoney(sale.sumMinor, currency)}
                        </span>
                      </div>
                      <span className="text-[14px] text-[var(--ms-text-muted)]">
                        {new Date(sale.moment).toLocaleDateString(bcp47, {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          // Sana va soat BITTA `moment` dan chiziladi —
                          // ikkalasi ham do'kon mintaqasida bo'lsin, aks holda
                          // ular o'zaro ham nomuvofiq bo'lardi (S4).
                          timeZone: POS_TZ,
                        })}{' '}
                        {new Date(sale.moment).toLocaleTimeString(bcp47, {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: POS_TZ,
                        })}
                      </span>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--ms-text-muted)]" />
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
