'use client';

import { api } from '@/lib/api-client';
// S3 — «necha kun» qurilma soatidan EMAS, serverdan; hisob Toshkent kunida.
import { serverNow } from '@/lib/clock';
import { useBcp47 } from '@/lib/i18n-format';
import { formatAmountInput, parseAmountToMinor } from '@/lib/pos/parse-amount';
import { posDaysSince } from '@/lib/pos/pos-calendar';
import { formatForeignMajor } from '@/lib/pos/receipt-payments';
import { RATE_SCALE, convertByRateE8 } from '@moysklad/money';
import type { CurrencyCode } from '@moysklad/money/currencies';
import { Input, formatMoney, noAccidentalClose } from '@moysklad/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, DollarSign, Landmark, Monitor, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

interface CounterpartyRow {
  id: string;
  name: string;
  phone: string | null;
}

interface DebtRow {
  id: string;
  name: string;
  totalMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  currency: string;
  orderAt: string;
}

interface DebtSummary {
  counterparty: CounterpartyRow;
  /**
   * 🔴 P1 — POS QABUL QILA OLADIGAN summa: `max(reyestr qoldig'i, balans)`.
   * Ekran AYNAN shu sonni ko'rsatadi va ortiqcha-to'lov chegarasini ham
   * shundan oladi. Formula server bilan bitta (`debtPayable`) — ikkinchi
   * hisob-kitob manbai yaratilmaydi.
   */
  payableMinor: string;
  /** Shundan reyestrda yo'q, to'lov paytida reyestrga olib kiriladigan qism. */
  adoptableMinor: string;
  /** `Debt` reyestridagi ochiq qoldiq — pastdagi ro'yxat AYNAN shu. */
  outstandingMinor: string;
  openCount: number;
  oldestAt: string | null;
  debts: DebtRow[];
}

interface PayResult {
  batchId: string;
  receipt: {
    batchId: string;
    paidMinor: string;
    currency: string;
    /** F6 — mijoz bergan ASL summa (USD → sent); so'm to'lovda `null`. */
    originalMinor: string | null;
    /** F6 — chekka MUZLATILGAN kurs, kanonik ×10^8; so'm to'lovda `null`. */
    exchangeRate: string | null;
    method: string;
    lines: Array<{ debtName: string; amountMinor: string; closed: boolean }>;
    outstandingAfterMinor: string;
  };
  closedCount: number;
  /**
   * `true` — bu javob TAKROR (server oldingi chekni qaytardi, yangi pul
   * YOZILMADI). Tarmoq uzilgan urinishdan keyingi qayta bosishda shunday
   * bo'ladi. Ekran ikki holatni farqlamaydi — chek AYNI; bayroq faqat
   * diagnostika/kelajakdagi bildirishnoma uchun.
   */
  replayed: boolean;
}

/** `GET /exchange-rates/rate?currency=USD` javobi (kerakli qismi). */
interface UsdRateRow {
  date: string;
  currency: string;
  rate: string;
  /** Kanonik ×10^8 — payload'ga AYNAN shu ketadi (FE qayta hisoblamaydi). */
  rateMinor: string;
}

/** To'lov valyutasi — serverdagi `PosDebtPaymentSchema.currency` bilan bir xil. */
type PayCurrency = 'UZS' | 'USD';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Joriy smena — naqd to'lov shu smenaning «kutilgan naqd»iga kiradi (TZ §8.4). */
  sessionId: string;
  cashDeskId?: string | null;
  /** Kassa valyutasi — major→minor scale (FE-08). */
  currency?: CurrencyCode;
  /**
   * F9 — mijoz kartasidan «Qarzni to'lash» bosilganda oldindan tanlangan
   * mijoz. Berilsa qidiruv qadami O'TKAZIB YUBORILADI: kassir mijozni
   * kartada allaqachon topgan, uni ikkinchi marta qidirish xato kiritish
   * yo'lini ochardi (bir xil ismli ikkinchi mijozga to'lov).
   */
  initialAgent?: CounterpartyRow | null;
  onPaid?: (result: PayResult) => void;
}

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];

/**
 * Idempotentlik kaliti uchun uuid v4.
 *
 * 🔴 NEGA BARE `crypto.randomUUID()` EMAS: u FAQAT secure-context'da (HTTPS
 * yoki localhost) mavjud. Kassa qobig'i server manzili sifatida `http://` ni
 * ATAYLAB qabul qiladi (`desktop/device-store.js` — `normalizeServerUrl`
 * `http:` va `https:` ikkalasiga ham ruxsat beradi), ya'ni LAN IP orqali
 * ochilgan monoblokda `crypto.randomUUID` `undefined` bo'ladi. Bare chaqiruv
 * `useState` initsializatorida OTILARDI va butun «Qarz to'lovi» oynasi
 * yiqilardi — bu takroriy to'lovdan ham YOMON natija: kassir qarz to'lovini
 * umuman qabul qila olmasdi.
 *
 * Zaxira yo'l HAQIQIY v4 yasaydi (versiya/variant bitlari bilan): server
 * `z.string().uuid()` bilan tekshiradi, ya'ni «taxminan uuid» ko'rinishdagi
 * satr 400 bilan rad etilardi va himoya jimgina o'chib qolardi.
 */
function newRequestId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  if (typeof c?.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    for (let i = 0; i < 16; i += 1) bytes[i] = buf[i] ?? 0;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // versiya 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10x
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * FAZA 3 (2026-09-01): BCP-47 teg PARAMETR — modul darajasidagi sof
 * funksiyada hook chaqirib bo'lmaydi (`customer-card-panel.tsx` bilan bir naqsh).
 */
function fmtDate(iso: string | null, bcp47: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(bcp47, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Eng eski qarzdan bugungacha necha kun — kassir «qancha eski» ekanini ko'rsin.
 *
 * 🔴 S-reja S3: ilgari bu yerda `Date.now() − iso` 86 400 000 ga bo'linardi —
 * ikki nuqson bilan. (1) Qurilma soati adashsa kun soni ham adashardi.
 * (2) Bu KALENDAR kun emas, 24 soatlik bo'lak edi: kecha 23:50 da yozilgan
 * qarz bugun ertalab hamon «0 kun» bo'lib turardi. Endi ikkalasi ham yopiq —
 * vaqt `serverNow()` dan, hisob esa Toshkent kalendar kunlari bo'yicha
 * (`posDaysSince`, serverning qarz reyestri bilan AYNI formula).
 */
function daysSince(iso: string | null): number | null {
  return posDaysSince(iso, serverNow());
}

/**
 * POS «Qarz to'lovi» oynasi (kassa TZ §7.2).
 *
 * Kassir mijozni topadi → qoldiqni KO'RADI (jami, eng eski qarz sanasi,
 * qarzlar ro'yxati) → summa kiritadi → tasdiqlaydi. Qaysi `QRZ-` hujjatga
 * tushishini tanlamaydi: server eng eskisidan FIFO bo'yicha taqsimlaydi.
 *
 * NEGA qoldiq ko'rsatiladi: faqat summa maydonini berish kassirni ko'r-ko'rona
 * kiritishga majbur qilardi — mijoz «hammasini yopaman» desa qancha ekanini
 * bilmasdi. «Hammasi» tugmasi ham shuning uchun bor.
 *
 * ⚠️ Ortiqcha to'lovni server RAD etadi (qaytim naqddan beriladi, §6.2), shuning
 * uchun tugma bu yerda ham oldindan bloklanadi — kassir xatoni bosgandan KEYIN
 * emas, OLDIN ko'rsin.
 */
export function DebtPaymentDialog({
  open,
  onOpenChange,
  sessionId,
  cashDeskId,
  currency = 'UZS',
  initialAgent = null,
  onPaid,
}: Props) {
  const qc = useQueryClient();
  const bcp47 = useBcp47();
  const t = useTranslations('pages.pos');
  const tCommon = useTranslations('common');
  const [search, setSearch] = useState('');
  const [agent, setAgent] = useState<CounterpartyRow | null>(null);
  const [amountInput, setAmountInput] = useState('');
  /**
   * To'lov KANALI — sotuv oynasidagi kartochkalar bilan BIR lug'at (2026-08-31,
   * egasi: ikki oynaning dizayni va usul to'plami farq qilardi). `cashUsd`
   * alohida kanal EMAS — serverga `method:'cash' + currency:'USD'` bo'lib
   * ketadi (F6 shartnomasi o'zgarmadi); qolganlari nomi bilan ketadi.
   */
  const [tender, setTender] = useState<'cash' | 'cashUsd' | 'card' | 'terminal' | 'account'>(
    'cash',
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * 🔴 IDEMPOTENTLIK kaliti — shu to'lov urinishi davomida O'ZGARMAYDI.
   *
   * Monoblokda tranzaksiya commit bo'lib javob tarmoqda yo'qolsa, kassir
   * «Failed to fetch» ko'rib tugmani qayta bosadi. AYNI kalit bilan kelgan
   * ikkinchi so'rovga server yangi to'lov YOZMAYDI — birinchi chekni
   * qaytaradi. Kalitsiz esa yashiqqa ikkinchi kirim tushib, smenaning
   * «kutilgan naqd»i ikki barobar oshardi (yopishda soxta kamomad).
   *
   * `useState` initsializatori LAZY (`() => …`) — har render'da yangi uuid
   * tug'ilsa retry butun ma'nosini yo'qotardi. `reset()` uni yangilaydi, ya'ni
   * keyingi to'lov o'z kalitini oladi.
   */
  const [requestId, setRequestId] = useState(() => newRequestId());

  const { data: cpData, isLoading: cpLoading } = useQuery<{ items: CounterpartyRow[] }>({
    queryKey: ['cp-debt-search', search],
    queryFn: () => api.get(`/counterparties?search=${encodeURIComponent(search)}&limit=20`),
    enabled: open && !agent,
  });

  const { data: summary, isLoading: sumLoading } = useQuery<DebtSummary>({
    queryKey: ['debt-pos-summary', agent?.id],
    queryFn: () => api.get(`/debts/pos/summary/${agent?.id}`),
    enabled: open && !!agent,
  });

  /**
   * F6 — kunlik dollar kursi SERVERDAN. 🔴 Kassir uni QO'LDA kiritmaydi
   * (`rasmilashtirish-modal.tsx` bilan bir xil naqsh va bir xil so'rov).
   *
   * `retry: false` — kurs YO'Q kun normal holat (CBU dam olish kunlarida
   * e'lon qilmaydi; carry-forward server tomonda).
   */
  const { data: usdRate, isLoading: usdRateLoading } = useQuery<UsdRateRow>({
    queryKey: ['pos-usd-rate'],
    queryFn: () => api.get<UsdRateRow>('/exchange-rates/rate?currency=USD'),
    enabled: open,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const usdRateE8 = usdRate?.rateMinor ? BigInt(usdRate.rateMinor) : null;
  /** Kurs yo'q ⇒ dollar tanlovi yopiq. Jim 1:1 ga tushish TAQIQ (TZ §6.2). */
  const usdBlocked = usdRateE8 == null || usdRateE8 <= 0n;
  const isUsd = tender === 'cashUsd';
  const payCurrency: PayCurrency = isUsd ? 'USD' : 'UZS';
  /** Serverga ketadigan usul — `PosDebtPaymentSchema.method` lug'ati. */
  const method = isUsd ? 'cash' : tender;

  /**
   * 🔴 P1 — `payableMinor`, `outstandingMinor` EMAS. Reyestr prodda bo'sh
   * bo'lgani uchun eski son bilan ekran «Qarz yo'q» derdi va tasdiqlash
   * tugmasi umuman chizilmasdi — kassada berilgan qarzni kassada to'lash
   * yo'li yo'q edi (`pos-debt-two-ledger-split`).
   */
  const outstanding = BigInt(summary?.payableMinor ?? '0');
  /** Reyestrda yo'q, balansdan olinadigan qism — pastda ochiq ko'rsatiladi. */
  const adoptable = BigInt(summary?.adoptableMinor ?? '0');
  // FE-09: yagona pul-parse. Ilgari bu yerda lokal `toMinor` yashardi —
  // float orqali yaxlitlardi va valyuta scale'ini qattiq 100 deb olardi.
  //
  // F6: dollar ALOHIDA valyutada parse qilinadi (sent ≠ tiyin). `amountMinor`
  // serverga AYNAN shu ko'rinishda ketadi — so'mga o'girishni SERVER qiladi.
  const amountMinor = parseAmountToMinor(amountInput, isUsd ? 'USD' : currency);
  /**
   * So'm ekvivalenti — FAQAT ko'rsatish va ortiqcha-to'lov chegarasi uchun.
   * Formula server bilan bitta (`convertByRateE8` ≡ `usdCentsToSomTiyin`);
   * payload'ga bu qiymat YUBORILMAYDI (ikki manba bo'lmasin).
   */
  const somMinor =
    isUsd && usdRateE8 != null ? convertByRateE8(amountMinor, usdRateE8) : isUsd ? 0n : amountMinor;
  const overpay = somMinor > outstanding ? somMinor - outstanding : 0n;
  const canConfirm =
    amountMinor > 0n &&
    somMinor > 0n &&
    overpay === 0n &&
    outstanding > 0n &&
    !(isUsd && usdBlocked);

  /**
   * «Hammasi» tugmasi qiymati.
   *
   * 🔴 Dollarda PASTGA yaxlitlanadi: 1 sent ≈ 124 tiyin, ya'ni so'mdagi
   * qarzni dollar bilan tiyin-ba-tiyin yopib bo'lmaydi. Yuqoriga yaxlitlansa
   * server ortiqcha to'lovni RAD etardi (qaytim faqat naqddan, §6.2) —
   * kassir tushunarsiz 400 olardi. Yopilmay qolgan qoldiq esa OCHIQ
   * ko'rsatiladi (pastdagi izoh), jimgina yo'qolmaydi.
   */
  const payAllMinor =
    isUsd && usdRateE8 != null && usdRateE8 > 0n
      ? (outstanding * RATE_SCALE) / usdRateE8
      : isUsd
        ? 0n
        : outstanding;
  const payAllInput = formatAmountInput(payAllMinor, isUsd ? 'USD' : currency);
  /** «Hammasi» bosilganda yopilmay qoladigan so'm (dollar granulyarligi). */
  const payAllResidual =
    isUsd && usdRateE8 != null && usdRateE8 > 0n
      ? outstanding - convertByRateE8(payAllMinor, usdRateE8)
      : 0n;

  const payMut = useMutation<PayResult>({
    mutationFn: () =>
      api.post<PayResult>('/debts/pos/pay', {
        counterpartyId: agent?.id,
        // 🔴 To'lov VALYUTASINING minor birligida (UZS → tiyin, USD → sent).
        amountMinor: amountMinor.toString(),
        currency: payCurrency,
        // Kurs MUZLATILADI — serverdan olingan satr aynan qaytariladi.
        ...(isUsd && usdRate?.rateMinor ? { exchangeRate: usdRate.rateMinor } : {}),
        method,
        cashDeskId: cashDeskId ?? null,
        retailShiftId: sessionId,
        // Takroriy bosishda AYNI qiymat ketadi — server ikkinchi to'lovni
        // yozmaydi (`pos_debt_payment_requests` unique qulfi).
        clientRequestId: requestId,
      }),
    onSuccess: (result) => {
      // Smena yig'indilari o'zgardi: naqd to'lov «kutilgan naqd»ga kiradi.
      qc.invalidateQueries({ queryKey: ['cashier-session-current'] });
      qc.invalidateQueries({ queryKey: ['debt-pos-summary'] });
      // «Mijozlar» paneli va mijoz kartasi O'Z kalitlari bilan o'qiydi —
      // ular ham yangilanmasa, to'langan qarz ekranda ESKI raqam bo'lib
      // qolardi (2026-08-15, jonli brauzerda o'lchandi: balans 0, panel 80k).
      qc.invalidateQueries({ queryKey: ['pos-customers-debt'] });
      qc.invalidateQueries({ queryKey: ['customer-card-debt'] });
      qc.invalidateQueries({ queryKey: ['customer-card-history'] });
      onPaid?.(result);
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : t('debt_error'));
    },
  });

  const reset = useCallback(() => {
    setSearch('');
    setAgent(null);
    setAmountInput('');
    setTender('cash');
    setError(null);
    // Yangi urinish = YANGI kalit. Aks holda keyingi (haqiqiy, boshqa) to'lov
    // eski kalit bilan ketib, server uni «takror» deb rad etardi va pul
    // JIMGINA yozilmasdan qolardi.
    setRequestId(newRequestId());
  }, []);

  /**
   * Kanal almashtirilganda VALYUTA o'zgarsa kiritilgan summa TOZALANADI:
   * «100» so'mda 100 so'm, dollarda $100 — bir xil raqam ikki xil pul.
   * Tozalamasak kassir bir bosishda summani ~12 000× oshirib yuborardi.
   * So'm-kanallar orasida (naqd↔karta↔terminal↔hisob) summa SAQLANADI —
   * kassir usulini almashtirib qayta termasin.
   */
  const selectTender = useCallback(
    (next: 'cash' | 'cashUsd' | 'card' | 'terminal' | 'account') => {
      if (isUsd !== (next === 'cashUsd')) setAmountInput('');
      setTender(next);
      setError(null);
    },
    [isUsd],
  );

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  /**
   * F9 — oldindan tanlangan mijozni OCHILGANDA o'rnatadi. `reset()` faqat
   * yopilishda yuguradi, ya'ni bu effekt uning ustidan yozmaydi; oyna
   * yopilib qayta ochilganda esa yangi `initialAgent` qo'llanadi.
   */
  useEffect(() => {
    if (open && initialAgent) setAgent(initialAgent);
  }, [open, initialAgent]);

  const handleDigit = useCallback((d: string) => {
    setError(null);
    setAmountInput((prev) => {
      const next = prev + d;
      return next.length > 12 ? prev : next;
    });
  }, []);

  const oldestDays = daysSince(summary?.oldestAt ?? null);

  /**
   * Kanal kartochkalarining rang-lug'ati — `rasmilashtirish-modal.tsx` dagi
   * FIELD_COLORS bilan AYNAN bir palitra (2026-08-31: ikki oyna bir dizayn).
   */
  const TENDER_STYLE = {
    cash: {
      sel: 'border-emerald-400 bg-emerald-50',
      hov: 'hover:border-emerald-200',
      icon: 'bg-emerald-500',
      dot: 'bg-emerald-500',
      border: 'border-emerald-400',
    },
    cashUsd: {
      sel: 'border-teal-400 bg-teal-50',
      hov: 'hover:border-teal-200',
      icon: 'bg-teal-500',
      dot: 'bg-teal-500',
      border: 'border-teal-400',
    },
    card: {
      sel: 'border-blue-400 bg-blue-50',
      hov: 'hover:border-blue-200',
      icon: 'bg-blue-500',
      dot: 'bg-blue-500',
      border: 'border-blue-400',
    },
    terminal: {
      sel: 'border-purple-400 bg-purple-50',
      hov: 'hover:border-purple-200',
      icon: 'bg-purple-500',
      dot: 'bg-purple-500',
      border: 'border-purple-400',
    },
    account: {
      sel: 'border-indigo-400 bg-indigo-50',
      hov: 'hover:border-indigo-200',
      icon: 'bg-indigo-500',
      dot: 'bg-indigo-500',
      border: 'border-indigo-400',
    },
  } as const;

  const TENDER_LABEL = {
    cash: t('cash'),
    cashUsd: t('cash_usd'),
    card: t('card'),
    terminal: t('terminal'),
    account: t('account'),
  } as const;

  const TENDER_ICON = {
    cash: Banknote,
    cashUsd: DollarSign,
    card: CreditCard,
    terminal: Monitor,
    account: Landmark,
  } as const;

  /** Ekrandagi kiritilgan summa — tanlangan kanal valyutasida formatlangan. */
  const amountDisplay = amountInput
    ? isUsd
      ? formatForeignMajor(amountMinor, 'USD')
      : formatMoney(amountMinor)
    : '0';

  const style = TENDER_STYLE[tender];

  return (
    /* 🔴 `modal={false}` ATAYLAB — sabab `rasmilashtirish-modal.tsx` dagi izohda
       (Radix modal rejimi qobiq ekran-klaviaturasini bosib qo'yardi). Tashqi
       bosishdan `noAccidentalClose` himoya qiladi; fon — o'z qatlamimiz. */
    <Dialog.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <div aria-hidden className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        {/* K-1: tavsif matni ataylab yo'q — Radix'ning rasmiy opt-out'i
            (`aria-describedby={undefined}`) console warning'ni o'chiradi. */}
        <Dialog.Content
          {...noAccidentalClose}
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[min(96vw,57rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[var(--ms-bg-surface)] shadow-2xl outline-none flex flex-col max-h-[92dvh]"
        >
          {/* Header — sotuv (Rasmiylashtirish) oynasi bilan BIR shakl. */}
          <div className="shrink-0 bg-[var(--ms-bg-app)] px-6 py-4 border-b border-[var(--ms-border)] rounded-t-2xl">
            <div className="flex items-start justify-between">
              <div>
                <Dialog.Title className="text-[10px] font-bold uppercase tracking-widest text-[var(--ms-text-muted)]">
                  {t('debt_title')}
                </Dialog.Title>
                <div className="mt-0.5 text-3xl font-bold tabular-nums text-[var(--ms-text-primary)] leading-none">
                  {agent && !sumLoading ? formatMoney(outstanding) : '—'}
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={tCommon('close')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {!agent ? (
            /* ── 1-qadam: mijoz ─────────────────────────────────────────── */
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-3">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('debt_search_placeholder')}
                  autoFocus
                />
                {cpLoading && (
                  <p className="text-[var(--ms-text-muted)] text-sm">{t('searching')}</p>
                )}
                <div className="flex flex-col gap-1">
                  {(cpData?.items ?? []).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setAgent(row)}
                      data-test-id={`debt-pay-cp-${row.id}`}
                      className="flex flex-col rounded-lg border border-[var(--ms-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--ms-bg-hover)]"
                    >
                      <span className="font-medium text-[var(--ms-text-primary)] text-sm">
                        {row.name}
                      </span>
                      {row.phone && (
                        <span className="text-[var(--ms-text-muted)] text-xs">{row.phone}</span>
                      )}
                    </button>
                  ))}
                  {!cpLoading && (cpData?.items ?? []).length === 0 && (
                    <p className="py-6 text-center text-[var(--ms-text-muted)] text-sm">
                      {t('debt_no_customers')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : sumLoading || outstanding === 0n ? (
            /* ── Qarz yo'q / yuklanmoqda — numpad hali kerak emas ────────── */
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-[var(--ms-text-primary)] truncate">
                      {agent.name}
                    </div>
                    {agent.phone && (
                      <div className="text-xs text-[var(--ms-text-muted)]">{agent.phone}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAgent(null);
                      setAmountInput('');
                    }}
                    className="shrink-0 text-xs text-[var(--ms-brand)] hover:underline"
                  >
                    {t('change_customer')}
                  </button>
                </div>
                {sumLoading ? (
                  <p className="text-[var(--ms-text-muted)] text-sm">{t('debt_loading')}</p>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4 text-center">
                    <p className="font-semibold text-emerald-800 text-sm">{t('debt_none_title')}</p>
                    <p className="mt-1 text-emerald-700 text-xs">{t('debt_none_hint')}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Ikki ustun: chapda kontekst+kanal, o'ngda numpad (sotuv
                 oynasi bilan BIR maket) ─────────────────────────────────── */
            <div className="flex flex-1 min-h-0">
              {/* LEFT */}
              <div className="flex w-[30rem] shrink-0 flex-col border-r border-[var(--ms-border)]">
                <div className="flex-1 overflow-y-auto flex flex-col [&>*]:shrink-0">
                  {/* Mijoz */}
                  <div className="px-4 pt-4 pb-3 border-b border-[var(--ms-border)]">
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-[var(--ms-text-primary)] truncate">
                          {agent.name}
                        </div>
                        {agent.phone && (
                          <div className="text-xs text-[var(--ms-text-muted)]">{agent.phone}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAgent(null);
                          setAmountInput('');
                        }}
                        className="shrink-0 text-xs text-[var(--ms-brand)] hover:underline"
                      >
                        {t('change_customer')}
                      </button>
                    </div>
                  </div>

                  {/* Qoldiq konteksti */}
                  <div className="px-4 pt-3">
                    <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                      <div className="text-orange-700 text-xs">{t('debt_total')}</div>
                      <div
                        className="font-bold text-2xl text-orange-900 tabular-nums"
                        data-test-id="debt-pay-outstanding"
                      >
                        {formatMoney(outstanding)}
                      </div>
                      <div className="mt-1 text-orange-700 text-xs">
                        {t('debt_meta', {
                          count: summary?.openCount ?? 0,
                          date: fmtDate(summary?.oldestAt ?? null, bcp47),
                        })}
                        {oldestDays !== null &&
                          oldestDays > 0 &&
                          ` (${t('debt_days', { days: oldestDays })})`}
                      </div>
                    </div>

                    {/* Qarzlar ro'yxati — qaysi biri qachon ochilgani ko'rinsin. */}
                    <div className="mt-2 flex max-h-28 flex-col gap-1 overflow-y-auto [&>*]:shrink-0">
                      {/* P1 — reyestrda `QRZ-` qatori yo'q, lekin balansda qarz
                          bor holat. Jimgina umumiy songa qo'shib qo'yish
                          kassirga «bu pul qayerdan» degan savolni javobsiz
                          qoldirardi. */}
                      {adoptable > 0n && (
                        <div
                          data-test-id="debt-pay-from-balance"
                          className="flex items-center justify-between rounded-lg border border-[var(--ms-border)] border-dashed px-3 py-1.5 text-xs"
                        >
                          <span className="text-[var(--ms-text-muted)]">
                            {t('debt_from_balance')}
                          </span>
                          <span className="font-medium tabular-nums">{formatMoney(adoptable)}</span>
                        </div>
                      )}
                      {(summary?.debts ?? []).map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between rounded-lg border border-[var(--ms-border)] px-3 py-1.5 text-xs"
                        >
                          <span className="text-[var(--ms-text-muted)]">
                            {d.name} · {fmtDate(d.orderAt, bcp47)}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatMoney(BigInt(d.outstandingMinor))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* To'lov kanali — sotuv oynasidagi kartochkalar bilan bir
                      lug'at va bir palitra. Tanlangan kartada kiritilgan summa
                      ko'rinadi; USD server sxemasiga `cash + USD` bo'lib ketadi. */}
                  <div className="flex flex-col gap-2 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ms-text-muted)]">
                      {t('payment_method')}
                    </p>
                    {(['cash', 'cashUsd', 'card', 'terminal', 'account'] as const).map((k) => {
                      const Icon = TENDER_ICON[k];
                      const st = TENDER_STYLE[k];
                      const selected = tender === k;
                      const disabled = k === 'cashUsd' && usdBlocked;
                      const testId =
                        k === 'cashUsd'
                          ? 'debt-pay-currency-usd'
                          : k === 'cash'
                            ? 'debt-pay-method-cash'
                            : `debt-pay-method-${k}`;
                      return (
                        <button
                          key={k}
                          type="button"
                          data-test-id={testId}
                          disabled={disabled}
                          onClick={() => selectTender(k)}
                          className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                            selected
                              ? st.sel
                              : `border-[var(--ms-border)] bg-[var(--ms-bg-app)] ${st.hov}`
                          }`}
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? st.icon : 'bg-[var(--ms-bg-input)]'}`}
                          >
                            <Icon
                              className={`h-4 w-4 ${selected ? 'text-white' : 'text-[var(--ms-text-muted)]'}`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ms-text-muted)]">
                              {TENDER_LABEL[k]}
                            </div>
                            <div
                              className={`font-bold tabular-nums leading-tight text-sm ${selected && amountMinor > 0n ? 'text-[var(--ms-text-primary)]' : 'text-[var(--ms-text-muted)]'}`}
                            >
                              {selected && amountMinor > 0n ? amountDisplay : '—'}
                            </div>
                            {/* So'm ekvivalenti — SERVER formulasi bilan, JONLI. */}
                            {k === 'cashUsd' && selected && amountMinor > 0n && (
                              <div
                                data-test-id="debt-usd-equivalent"
                                className="text-[10px] tabular-nums text-[var(--ms-text-muted)]"
                              >
                                ≈ {formatMoney(somMinor)}
                              </div>
                            )}
                          </div>
                          {selected && (
                            <div className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
                          )}
                        </button>
                      );
                    })}

                    {/* Kurs holati — sana bilan (carry-forward tufayli bugungi
                        bo'lmasligi mumkin) yoki bloklash sababi. */}
                    {usdBlocked ? (
                      usdRateLoading ? null : (
                        <p
                          data-test-id="debt-usd-rate-missing"
                          className="-mt-1 font-medium text-[10px] text-orange-500"
                        >
                          {t('usd_rate_missing')}
                        </p>
                      )
                    ) : (
                      <p
                        data-test-id="debt-usd-rate"
                        className="-mt-1 text-[10px] text-[var(--ms-text-muted)] tabular-nums"
                      >
                        {t('usd_rate_hint', {
                          rate: usdRate?.rate ?? '',
                          date: usdRate?.date ?? '',
                        })}
                      </p>
                    )}
                  </div>

                  {/* Ogohlantirishlar — pastga suriladi */}
                  <div className="mt-auto px-4 pb-4 flex flex-col gap-2">
                    {isUsd && payAllResidual > 0n && (
                      <p
                        data-test-id="debt-usd-residual"
                        className="text-[11px] text-[var(--ms-text-muted)]"
                      >
                        {t('debt_usd_residual', { sum: formatMoney(payAllResidual) })}
                      </p>
                    )}
                    {overpay > 0n && (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 text-xs">
                        {t('debt_overpay', { sum: formatMoney(overpay) })}
                      </p>
                    )}
                    {error && (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 text-xs">{error}</p>
                    )}
                  </div>
                </div>

                {/* Confirm — pinned at bottom, never scrolls */}
                <div className="shrink-0 p-4 border-t border-[var(--ms-border)]">
                  <button
                    type="button"
                    onClick={() => payMut.mutate()}
                    disabled={!canConfirm || payMut.isPending}
                    data-test-id="debt-pay-confirm"
                    className="h-12 w-full rounded-xl bg-emerald-500 font-bold text-sm text-white shadow-md transition-all hover:bg-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {payMut.isPending ? '...' : `✓ ${t('debt_submit')}`}
                  </button>
                </div>
              </div>

              {/* RIGHT — numpad panel (sotuv oynasi bilan bir maket). Summa
                  maydoni HAQIQIY input EMAS — kassa qobig'ida ekran-klaviatura
                  o'z numpadimizni bosib qo'yardi (`rasmilashtirish-modal.tsx`
                  dagi izoh); kiritish yo'li FAQAT shu numpad. */}
              <div className="flex flex-1 flex-col gap-2 p-4 bg-[var(--ms-bg-app)]">
                <div
                  className={`rounded-xl border-2 px-4 py-2 transition-colors ${style.border} bg-white`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--ms-text-muted)] mb-0.5">
                    {t('pay_amount')} · {TENDER_LABEL[tender]}
                  </div>
                  <div
                    data-test-id="debt-pay-amount"
                    className={`w-full text-2xl font-bold tabular-nums leading-none ${
                      amountInput
                        ? 'text-[var(--ms-text-primary)]'
                        : 'font-normal text-lg text-[var(--ms-text-muted)]'
                    }`}
                  >
                    {amountDisplay}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    data-test-id="debt-pay-all"
                    onClick={() => setAmountInput(payAllInput)}
                    className="flex-1 rounded-xl border-2 border-dashed border-[var(--ms-border)] bg-white py-2 text-sm font-bold text-[var(--ms-text-primary)] hover:border-[var(--ms-brand)] hover:bg-[var(--ms-bg-hover)] transition-colors"
                  >
                    {t('debt_pay_all', {
                      sum: isUsd
                        ? formatForeignMajor(payAllMinor, 'USD')
                        : formatMoney(outstanding),
                    })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountInput('')}
                    className="rounded-xl border-2 border-dashed border-[var(--ms-border)] bg-white px-3 py-2 text-sm font-bold text-[var(--ms-text-primary)] hover:border-[var(--ms-brand)] hover:bg-[var(--ms-bg-hover)] transition-colors"
                  >
                    {t('clear')}
                  </button>
                </div>

                {/* Numpad — grows to fill remaining space */}
                <div className="grid grid-cols-3 grid-rows-4 gap-1.5 flex-1">
                  {NUMPAD_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() =>
                        k === '⌫' ? setAmountInput((p) => p.slice(0, -1)) : handleDigit(k)
                      }
                      className={`rounded-xl border font-semibold text-xl transition-all active:scale-95 ${
                        k === '⌫'
                          ? 'border-[var(--ms-border)] bg-[var(--ms-bg-input)] text-[var(--ms-text-muted)] hover:bg-red-50 hover:text-red-500 hover:border-red-200'
                          : 'border-[var(--ms-border)] bg-white text-[var(--ms-text-primary)] hover:bg-[var(--ms-bg-hover)] shadow-sm'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
