'use client';

import { api } from '@/lib/api-client';
import { useBcp47 } from '@/lib/i18n-format';
import type { ListEnvelope } from '@moysklad/contracts';
import type { CurrencyCode } from '@moysklad/money/currencies';
import { Input, formatMoney, noAccidentalClose } from '@moysklad/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * F9 — POS MIJOZ KARTASI · **P2 (2026-08-12): bitta halol raqam + tarix.**
 *
 * Kassir bir joyda ko'radi: kim (telefon bo'yicha topiladi), qancha qarzi
 * bor, nima olgan, qanday zakazlari bor. Tez amallar (qarz to'lash, zakazni
 * ochish, chekni qayta chop etish) panelning O'ZIDA bajarilmaydi — ular
 * chaqiruvchiga callback bilan qaytadi. Sabab ataylab: bu panel savat,
 * miqdor, chegirma va to'lov mantig'iga UMUMAN tegmaydi.
 *
 * 🔴 NIMA O'ZGARDI VA NEGA. Ilgari bu yerda IKKI katta son yonma-yon turardi:
 * «Umumiy qarz» (`CounterpartyBalance`) va «Reyestrda» (`Debt` registri) —
 * chunki POS FIFO'si faqat ikkinchisini yopa olardi va farq uchun kassirga
 * ogohlantirish chiqardi. **P1 dan keyin bu ogohlantirish YOLG'ON**: to'lov
 * balansdan ham qabul qilinadi (adopsiya). Ikki raqamni qoldirish endi shunchaki
 * chalg'itish edi — mijoz ham, kassir ham qaysi biriga ishonishni bilmasdi.
 *
 * Endi ekranda BITTA son bor — `payableMinor`, ya'ni **server AYNAN shu
 * summagacha qabul qiladi** (bitta formula: `pos-customer-debt.ts#debtPayable`,
 * ekran ham, `POST /debts/pos/pay` ham o'shandan yuradi). «Halol» aynan shu
 * ma'noda: ekrandagi raqam = tizimning xulqi.
 *
 * 🔴 NULL ≠ 0 SAQLANADI, lekin boshqacha: balans qatori yo'qligi endi
 * raqamni «—» qilib yashirmaydi (kassirni harakatsiz qoldirardi) — u ALOHIDA
 * qator bo'lib OCHIQ aytiladi (`customer-card-balance-missing`).
 *
 * 🔴 TARIX (P2 ning ikkinchi yarmi) — `GET /debts/pos/history/:id`, manba
 * `CounterpartyBalanceEntry` jurnali, ya'ni asosiy raqam bilan BIR daftar.
 * Mijoz «men bunchalik qarzdor emasman» desa kassirning javobi shu ro'yxat.
 * Backfilldan oldin jurnalda 2 qator bor edi — ya'ni javob YO'Q edi.
 */

export interface CustomerCardRow {
  id: string;
  name: string;
  phone: string | null;
  description?: string | null;
  version?: number;
}

/** `GET /debts/pos/summary/:id` javobi (F9 · P1 da kengaytirilgan). */
interface DebtSummary {
  counterparty: CustomerCardRow;
  /**
   * 🔴 P1/P2 — EKRANDAGI YAGONA SON: POS shu summagacha qabul qiladi
   * (`max(reyestr, balans)`; manfiy balans qarz sifatida olinmaydi).
   */
  payableMinor: string;
  /**
   * 🔴 A3 — KARTA HOLATI: yagona yirik son QAYSI MA'NODA ko'rsatiladi.
   * Server bilan BITTA sof qoidadan (`pos-customer-debt.ts#customerStanding`)
   * chiqadi — ekran `balanceMinor` ning ishorasini QAYTA o'qimaydi.
   *
   * ⚠️ Ixtiyoriy: eski (A3 dan oldingi) server javobida bu maydon yo'q va
   * ekran o'sha holda AVVALGIDEK `payableMinor` ni chizadi.
   */
  standing?: {
    kind: 'debt' | 'prepaid' | 'settled' | 'unmeasured';
    amountMinor: string;
    /** Balans manfiy, lekin reyestrda ochiq qarz ham bor (ikki daftar zid). */
    conflicted: boolean;
  };
  /** `Debt` reyestri — POS FIFO'si yopadigan qism. */
  outstandingMinor: string;
  openCount: number;
  oldestAt: string | null;
  /** `CounterpartyBalance` — umumiy qarz. `null` = O'LCHANMAGAN. */
  balanceMinor: string | null;
  registryExceedsBalance: boolean;
  otherCurrencyBalances: Array<{ currency: string; balanceMinor: string }>;
}

/** `GET /debts/pos/history/:id` javobi (P2). */
interface DebtHistory {
  currency: string;
  /** Tarixiy boshlang'ich qoldiq; `null` = jurnalda `opening` qatori yo'q. */
  openingMinor: string | null;
  /** Jurnaldagi barcha qatorlar soni. */
  totalCount: number;
  hasMore: boolean;
  entries: Array<{
    at: string;
    docType: string;
    docId: string | null;
    /** Hujjat raqami; `null` = yorliq topilmadi (qator baribir chiqadi). */
    number: string | null;
    deltaMinor: string;
    increase: boolean;
  }>;
}

/**
 * Jurnalda uchraydigan hujjat turlari — YORLIQ uchun (saldoga aloqasi yo'q).
 * Ro'yxatda yo'q tur qator CHIZILISHINI to'xtatmaydi: u raqam/«—» bilan
 * chiqadi (server `counterparty-balance-doc-resolver.ts` bilan bir xil
 * degradatsiya qoidasi — «xato yorliq, yo'qolgan qator emas»).
 */
const KNOWN_DOC_TYPES = new Set([
  'retailsale',
  'debt',
  'debtpayment',
  'invoiceOut',
  'invoiceIn',
  'supply',
  'purchaseReturn',
  // G1 (2026-08-25 tuzatildi): `returnPayout` yorlig'i i18n'da G1 sessiyasida
  // qo'shilgan edi, lekin SHU ro'yxatga kirmagani uchun o'lik kalit bo'lib
  // qolgandi — vozvrat to'lovi qatorida yorliq o'rniga xom `returnPayout`
  // satri chiqardi. `salesReturn` (vozvratning O'ZI, to'lovning juftligi) ham
  // shu yerda yo'q edi — G1 hisobotining «ochiq qolganlar» bandi.
  'returnPayout',
  'salesReturn',
  'paymentIn',
  'paymentOut',
  'cashIn',
  'cashOut',
  'prepayment',
  'prepaymentReturn',
  // A1/A2/A3 (2026-08-25) — MIJOZ AVANSINING uch harakati. Ular BOSHQA-BOSHQA
  // hodisa va shu sababdan alohida yorliq oladi:
  //   · `customerPrepay`       — kassada avans QABUL qilindi (АВ-, pul kirdi);
  //   · `salePrepay`           — avansdan TO'LANDI (chek, yashiqqa tegmaydi);
  //   · `customerPrepayRefund` — avans NAQD QAYTARILDI (ВА-, pul chiqdi).
  // Ro'yxatga kirmasa qator baribir chizilardi, lekin yorliq o'rniga xom
  // `customerPrepay` satri ko'rinardi (G1 ning aynan shu sabab bilan
  // tuzatilgan `returnPayout` bandi).
  'customerPrepay',
  'salePrepay',
  'customerPrepayRefund',
  'adjustment',
]);

interface SaleRow {
  id: string;
  name: string;
  moment: string;
  sumMinor: string;
  state: string;
}

interface OrderRow {
  id: string;
  name: string;
  moment: string;
  sumMinor: string;
  state: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kassa valyutasi — balans AYNAN shu valyuta kesimida o'qiladi. */
  currency?: CurrencyCode;
  /** «Qarz to'lash» — chaqiruvchi qarz oynasini shu mijoz bilan ochadi. */
  onPayDebt: (cp: CustomerCardRow) => void;
  /** «Zakazni ochish» — chaqiruvchi «Zakazlar» tabiga o'tadi. */
  onOpenOrder: (orderId: string) => void;
  /** «Chekni qayta chop etish» — chaqiruvchi print-agentga yuboradi. */
  onReprintReceipt: (saleId: string) => void;
  /**
   * F7-tuzatish (2026-08-14): berilsa karta QIDIRUVSIZ shu mijoz bilan
   * ochiladi — Mijozlar panelida mijoz allaqachon tanlangan, qidiruv qadamini
   * takrorlash kassirni adashtirardi (`DebtPaymentDialog` bilan bir naqsh).
   */
  initialAgent?: CustomerCardRow | null;
}

/**
 * POS'da ko'rinadigan zakaz holatlari — `sotuv/page.tsx` dagi ro'yxat bilan
 * AYNAN bir xil (F7). Server bitta `state=` qabul qiladi, shuning uchun har
 * holat alohida so'raladi: bitta so'rovni `limit` bilan kesib, keyin FE'da
 * filtrlash «yangi zakaz ko'rinmay qoldi» bug'ini beradi.
 */
const POS_ORDER_STATES = ['draft', 'confirmed', 'awaiting_payment'] as const;

/**
 * FAZA 3 (2026-09-01): BCP-47 teg PARAMETR bo'lib keladi, ichkarida
 * `useBcp47()` chaqirilmaydi — bu modul darajasidagi SOF funksiya, hook
 * emas. Chaqiruvchi komponent tegni bir marta oladi va uzatadi.
 */
function fmtDate(iso: string | null | undefined, bcp47: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(bcp47, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export function CustomerCardPanel({
  open,
  onOpenChange,
  currency = 'UZS',
  onPayDebt,
  onOpenOrder,
  onReprintReceipt,
  initialAgent = null,
}: Props) {
  const t = useTranslations('pages.pos');
  const tDoc = useTranslations('pages.pos.customer_card_doc');
  const tCommon = useTranslations('common');
  const qc = useQueryClient();
  const bcp47 = useBcp47();

  const [search, setSearch] = useState('');
  const [agent, setAgent] = useState<CustomerCardRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Oyna yopilganda holat tozalanadi — keyingi mijoz oldingisining
  // ma'lumoti ustiga ochilmasin.
  useEffect(() => {
    if (!open) {
      setSearch('');
      setAgent(null);
      setEditing(false);
      setError(null);
    }
  }, [open]);

  // F7-tuzatish (2026-08-14): tanlangan mijoz bilan ochilganda qidiruv qadami
  // o'tkazib yuboriladi. Yopilganda yuqoridagi effekt tozalaydi; qayta
  // ochilishda yangi `initialAgent` qo'llanadi (`DebtPaymentDialog` naqshi).
  // «Mijozni almashtirish» tugmasi baribir ishlaydi — deps o'zgarmaguncha
  // effekt qayta yugurmaydi.
  useEffect(() => {
    if (open && initialAgent) {
      setAgent(initialAgent);
      setPhoneInput(initialAgent.phone ?? '');
      setCommentInput(initialAgent.description ?? '');
      setError(null);
    }
  }, [open, initialAgent]);

  const { data: cpData, isLoading: cpLoading } = useQuery<ListEnvelope<CustomerCardRow>>({
    queryKey: ['customer-card-search', search],
    queryFn: () => api.get(`/counterparties?search=${encodeURIComponent(search)}&limit=20`),
    enabled: open && !agent,
  });

  const { data: summary } = useQuery<DebtSummary>({
    // Valyuta kalitda: kassa valyutasi o'zgarsa boshqa qoldiq o'qiladi.
    queryKey: ['customer-card-debt', agent?.id, currency],
    queryFn: () => api.get(`/debts/pos/summary/${agent?.id}?currency=${currency}`),
    enabled: open && !!agent,
  });

  // P2 — tarix: asosiy raqam bilan BIR daftardan (balans jurnali).
  const { data: history } = useQuery<DebtHistory>({
    queryKey: ['customer-card-history', agent?.id, currency],
    queryFn: () => api.get(`/debts/pos/history/${agent?.id}?currency=${currency}`),
    enabled: open && !!agent,
  });

  const { data: salesData } = useQuery<ListEnvelope<SaleRow>>({
    queryKey: ['customer-card-sales', agent?.id],
    queryFn: () => api.get(`/retail-sales?agentId=${agent?.id}&limit=5&sortBy=moment&sortDir=desc`),
    enabled: open && !!agent,
  });

  // Har POS holati uchun alohida so'rov (yuqoridagi izohga qarang). Hooklar
  // SONI o'zgarmasligi shart (React #310) — shuning uchun ro'yxat konstanta
  // va uchtasi qo'lda yozilgan, siklda emas.
  const draftOrders = usePosOrders(open, agent?.id, POS_ORDER_STATES[0]);
  const confirmedOrders = usePosOrders(open, agent?.id, POS_ORDER_STATES[1]);
  const awaitingOrders = usePosOrders(open, agent?.id, POS_ORDER_STATES[2]);
  const orders: OrderRow[] = [
    ...(draftOrders.data?.items ?? []),
    ...(confirmedOrders.data?.items ?? []),
    ...(awaitingOrders.data?.items ?? []),
  ];

  const saveMut = useMutation({
    mutationFn: () => {
      // Bu xato `onError` orqali AYNAN shu ekranga chiqadi (`setError`), ya'ni
      // kassir ko'radigan matn — shuning uchun t() dan olinadi, literal emas.
      if (!agent) throw new Error(t('customer_card_not_selected'));
      // 🔴 TOR yo'l. Umumiy `PATCH /counterparties/:id` kiosk'da YOPIQ va
      // bu ekran unga hech qachon murojaat qilmasligi kerak.
      return api.patch<CustomerCardRow>(`/counterparties/${agent.id}/pos-contact`, {
        version: agent.version ?? 0,
        phone: phoneInput || null,
        description: commentInput || null,
      });
    },
    onSuccess: (row) => {
      setAgent(row);
      setEditing(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['customer-card-search'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  function selectAgent(row: CustomerCardRow) {
    setAgent(row);
    setPhoneInput(row.phone ?? '');
    setCommentInput(row.description ?? '');
    setError(null);
  }

  // 🔴 P2 — kassir ko'radigan YAGONA son. Server bilan bitta formuladan
  // (`debtPayable`) chiqadi, ya'ni ekran tizim xulqidan ajralib keta olmaydi.
  // 🔴 A3 — endi son SERVER HOLATIDAN chiqadi: `prepaid` bo'lsa u avans
  // summasi, aks holda avvalgidek `payableMinor`. Ekran ikkinchi formula
  // (`-balanceMinor`) yozmaydi — u bir kun server bilan ayrilardi.
  // Eski javobda `standing` bo'lmasa xulq AYNAN avvalgidek qoladi.
  const standing = summary?.standing ?? null;
  const isPrepaid = standing?.kind === 'prepaid';
  const payableMinor = standing ? standing.amountMinor : (summary?.payableMinor ?? null);
  // Balans qatori yo'qligi YASHIRILMAYDI (NULL ≠ 0) — lekin endi u raqamni
  // «—» qilib bloklamaydi, alohida qator bo'lib aytiladi.
  const balanceMissing = !!summary && summary.balanceMinor === null;

  return (
    /* 🔴 `modal={false}` ATAYLAB — sabab `rasmilashtirish-modal.tsx` dagi izohda
       (Radix modal rejimi qobiq ekran-klaviaturasini bosib qo'yardi). Tashqi
       bosishdan `noAccidentalClose` himoya qiladi; fon — o'z qatlamimiz. */
    <Dialog.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <div aria-hidden className="fixed inset-0 z-50 bg-black/40" />
        {/* Tasodifiy yopilish yo'q — faqat ✕ / «Yopish» tugmasi. */}
        <Dialog.Content
          {...noAccidentalClose}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(760px,95vw)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl bg-[var(--ms-bg-surface)] shadow-xl"
        >
          <div className="flex items-center justify-between border-[var(--ms-border)] border-b px-5 py-4">
            <Dialog.Title className="font-semibold text-[var(--ms-text-primary)] text-lg">
              {t('customer_card_title')}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1 text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
              aria-label={tCommon('close')}
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!agent && (
              <div className="flex flex-col gap-3">
                {/* 🔴 `inputMode="tel"` OLIB TASHLANDI (2026-08-15, monoblokda):
                    qobiq ekran-klaviaturasi `tel` rejimda FAQAT raqam panelini
                    chiqaradi — «Telefon YOKI ISM» qidiruvida harf yozib
                    bo'lmasdi. Matn rejimida raqam qatori baribir bor. */}
                <Input
                  type="text"
                  data-test-id="customer-card-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('customer_card_search_placeholder')}
                />
                {cpLoading && (
                  <p className="text-[var(--ms-text-muted)] text-sm">{t('searching')}</p>
                )}
                {!cpLoading && (cpData?.items.length ?? 0) === 0 && (
                  <p className="text-[var(--ms-text-muted)] text-sm">{t('debt_no_customers')}</p>
                )}
                <ul className="flex flex-col gap-1">
                  {(cpData?.items ?? []).map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        data-test-id={`customer-card-cp-${row.id}`}
                        onClick={() => selectAgent(row)}
                        className="flex w-full items-center justify-between rounded-lg border border-[var(--ms-border)] px-3 py-2 text-left text-sm hover:bg-[var(--ms-bg-hover)]"
                      >
                        <span className="font-medium">{row.name}</span>
                        <span className="text-[var(--ms-text-muted)]">{row.phone ?? '—'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {agent && (
              <div className="flex flex-col gap-4">
                {/* ── Sarlavha ─────────────────────────────────────────── */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ms-text-primary)] text-base">
                      {agent.name}
                    </p>
                    <p className="text-[var(--ms-text-muted)] text-sm">{agent.phone ?? '—'}</p>
                    {agent.description && (
                      <p className="text-[var(--ms-text-muted)] text-xs">{agent.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-test-id="customer-card-edit-open"
                      onClick={() => setEditing((v) => !v)}
                      className="rounded-lg border border-[var(--ms-border)] px-3 py-1.5 text-sm hover:bg-[var(--ms-bg-hover)]"
                    >
                      {t('customer_card_edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgent(null)}
                      className="rounded-lg border border-[var(--ms-border)] px-3 py-1.5 text-sm hover:bg-[var(--ms-bg-hover)]"
                    >
                      {t('change_customer')}
                    </button>
                  </div>
                </div>

                {/* ── Tahrir: FAQAT telefon va izoh (kiosk chegarasi) ──── */}
                {editing && (
                  <div className="flex flex-col gap-2 rounded-xl border border-[var(--ms-border)] p-3">
                    <label className="text-[var(--ms-text-muted)] text-xs" htmlFor="cc-phone">
                      {t('customer_card_phone')}
                    </label>
                    <Input
                      id="cc-phone"
                      type="text"
                      inputMode="tel"
                      data-test-id="customer-card-edit-phone"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                    />
                    <label className="text-[var(--ms-text-muted)] text-xs" htmlFor="cc-comment">
                      {t('customer_card_comment')}
                    </label>
                    <Input
                      id="cc-comment"
                      type="text"
                      data-test-id="customer-card-edit-comment"
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                    />
                    {error && <p className="text-red-600 text-xs">{error}</p>}
                    <button
                      type="button"
                      data-test-id="customer-card-edit-save"
                      onClick={() => saveMut.mutate()}
                      disabled={saveMut.isPending}
                      className="h-10 rounded-lg bg-[var(--ms-bg-brand)] font-semibold text-sm text-white disabled:opacity-40"
                    >
                      {tCommon('save')}
                    </button>
                  </div>
                )}

                {/* ── Qarz bloki: BITTA HALOL RAQAM (P2) ───────────────── */}
                <div
                  data-test-id="customer-card-debt"
                  className="rounded-xl border border-[var(--ms-border)] p-3"
                >
                  {/* 🔴 A3 — BITTA yirik son, IKKI ma'no. Ikkinchi raqam
                      qo'shilmaydi (P2 falsafasi): ishoraga qarab YORLIQ,
                      IZOH va RANG o'zgaradi. Ilgari avansi bor mijozda bu
                      yerda «0» turardi va kassir mijozning pulimiz
                      turganini bilmasdi (reja §1.3). */}
                  <p className="text-[var(--ms-text-muted)] text-xs">
                    {isPrepaid ? t('customer_card_prepaid') : t('customer_card_payable')}
                  </p>
                  <p
                    data-test-id="customer-card-payable"
                    data-standing={standing?.kind ?? 'legacy'}
                    className={`font-semibold text-2xl ${
                      isPrepaid ? 'text-emerald-700' : 'text-[var(--ms-text-primary)]'
                    }`}
                  >
                    {formatMoney(payableMinor, currency)}
                  </p>
                  <p className="text-[var(--ms-text-muted)] text-xs">
                    {isPrepaid ? t('customer_card_prepaid_hint') : t('customer_card_payable_hint')}
                  </p>

                  {balanceMissing && (
                    <p
                      data-test-id="customer-card-balance-missing"
                      className="mt-3 rounded-lg bg-[var(--ms-bg-hover)] px-3 py-2 text-[var(--ms-text-muted)] text-xs"
                    >
                      {t('customer_card_balance_missing')}
                    </p>
                  )}
                  {summary?.registryExceedsBalance && (
                    <p
                      data-test-id="customer-card-registry-exceeds"
                      className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 text-xs"
                    >
                      {t('customer_card_registry_exceeds')}
                    </p>
                  )}
                  {(summary?.otherCurrencyBalances.length ?? 0) > 0 && (
                    <p
                      data-test-id="customer-card-other-currency"
                      className="mt-2 text-[var(--ms-text-muted)] text-xs"
                    >
                      {t('customer_card_other_currency')}:{' '}
                      {(summary?.otherCurrencyBalances ?? [])
                        .map((b) => `${formatMoney(b.balanceMinor, b.currency)} ${b.currency}`)
                        .join(' · ')}
                    </p>
                  )}

                  <button
                    type="button"
                    data-test-id="customer-card-pay-debt"
                    onClick={() => onPayDebt(agent)}
                    className="mt-3 h-10 w-full rounded-lg border border-[var(--ms-border)] font-medium text-sm hover:bg-[var(--ms-bg-hover)]"
                  >
                    {t('customer_card_pay_debt')}
                  </button>
                </div>

                {/* ── Qarz tarixi: balans jurnalidan (P2) ──────────────── */}
                <div
                  data-test-id="customer-card-history"
                  className="rounded-xl border border-[var(--ms-border)] p-3"
                >
                  <p className="mb-2 font-semibold text-[var(--ms-text-muted)] text-xs uppercase tracking-widest">
                    {t('customer_card_history')}
                  </p>
                  {(history?.entries.length ?? 0) === 0 && history?.openingMinor == null && (
                    <p
                      data-test-id="customer-card-history-empty"
                      className="text-[var(--ms-text-muted)] text-sm"
                    >
                      {t('customer_card_history_empty')}
                    </p>
                  )}
                  <ul className="flex flex-col gap-1">
                    {(history?.entries ?? []).map((e) => (
                      <li
                        key={`${e.docType}-${e.docId ?? ''}-${e.at}`}
                        data-test-id={`customer-card-history-${e.docId ?? e.docType}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="font-medium">
                          {e.number ?? (KNOWN_DOC_TYPES.has(e.docType) ? tDoc(e.docType) : '—')}
                        </span>
                        <span className="text-[var(--ms-text-muted)] text-xs">
                          {KNOWN_DOC_TYPES.has(e.docType) ? tDoc(e.docType) : e.docType}
                        </span>
                        <span className="text-[var(--ms-text-muted)]">{fmtDate(e.at, bcp47)}</span>
                        {/* Belgi konvensiyasi serverdan keladi (`increase`) —
                            ekran uni QAYTA hisoblamaydi. */}
                        <span
                          className={
                            e.increase
                              ? 'font-medium text-[var(--ms-text-primary)]'
                              : 'font-medium text-emerald-700'
                          }
                        >
                          {e.increase ? '+' : '−'}
                          {formatMoney(e.deltaMinor.replace('-', ''), currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* 🔴 Boshlang'ich qoldiq — HARAKAT EMAS. U backfill kuni
                      yozilgan, ya'ni oddiy qator qilib chizilsa «bugun katta
                      qarz paydo bo'ldi» degan yolg'on chiqardi. */}
                  {history?.openingMinor != null && (
                    <p
                      data-test-id="customer-card-history-opening"
                      className="mt-2 flex items-center justify-between border-[var(--ms-border)] border-t pt-2 text-sm"
                    >
                      <span className="text-[var(--ms-text-muted)]">
                        {t('customer_card_history_opening')}
                      </span>
                      <span className="font-medium">
                        {formatMoney(history.openingMinor, currency)}
                      </span>
                    </p>
                  )}
                  {history?.hasMore && (
                    <p
                      data-test-id="customer-card-history-more"
                      className="mt-2 text-[var(--ms-text-muted)] text-xs"
                    >
                      {t('customer_card_history_more', { count: history.totalCount })}
                    </p>
                  )}
                </div>

                {/* ── Oxirgi xaridlar ──────────────────────────────────── */}
                <div className="rounded-xl border border-[var(--ms-border)] p-3">
                  <p className="mb-2 font-semibold text-[var(--ms-text-muted)] text-xs uppercase tracking-widest">
                    {t('customer_card_recent_sales')}
                  </p>
                  {(salesData?.items.length ?? 0) === 0 && (
                    <p className="text-[var(--ms-text-muted)] text-sm">
                      {t('customer_card_no_sales')}
                    </p>
                  )}
                  <ul className="flex flex-col gap-1">
                    {(salesData?.items ?? []).map((s) => (
                      <li
                        key={s.id}
                        data-test-id={`customer-card-sale-${s.id}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="text-[var(--ms-text-muted)]">
                          {fmtDate(s.moment, bcp47)}
                        </span>
                        <span className="font-medium">{formatMoney(s.sumMinor, currency)}</span>
                        <button
                          type="button"
                          data-test-id={`customer-card-reprint-${s.id}`}
                          onClick={() => onReprintReceipt(s.id)}
                          className="rounded-lg border border-[var(--ms-border)] px-2 py-1 text-xs hover:bg-[var(--ms-bg-hover)]"
                        >
                          {t('customer_card_reprint')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* ── Jarayondagi zakazlar (F7) ────────────────────────── */}
                <div className="rounded-xl border border-[var(--ms-border)] p-3">
                  <p className="mb-2 font-semibold text-[var(--ms-text-muted)] text-xs uppercase tracking-widest">
                    {t('customer_card_orders')}
                  </p>
                  {orders.length === 0 && (
                    <p className="text-[var(--ms-text-muted)] text-sm">
                      {t('customer_card_no_orders')}
                    </p>
                  )}
                  <ul className="flex flex-col gap-1">
                    {orders.map((o) => (
                      <li
                        key={o.id}
                        data-test-id={`customer-card-order-${o.id}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="font-medium">{o.name}</span>
                        <span className="text-[var(--ms-text-muted)]">
                          {fmtDate(o.moment, bcp47)}
                        </span>
                        <span className="font-medium">{formatMoney(o.sumMinor, currency)}</span>
                        <button
                          type="button"
                          data-test-id={`customer-card-open-order-${o.id}`}
                          onClick={() => onOpenOrder(o.id)}
                          className="rounded-lg border border-[var(--ms-border)] px-2 py-1 text-xs hover:bg-[var(--ms-bg-hover)]"
                        >
                          {t('customer_card_open_order')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Bitta POS holati uchun zakazlar so'rovi (hooklar soni barqaror qolsin). */
function usePosOrders(open: boolean, agentId: string | undefined, state: string) {
  return useQuery<ListEnvelope<OrderRow>>({
    queryKey: ['customer-card-orders', agentId, state],
    queryFn: () =>
      api.get(
        `/customer-orders?agentId=${agentId}&state=${state}&limit=20&sortBy=moment&sortDir=desc`,
      ),
    enabled: open && !!agentId,
  });
}
