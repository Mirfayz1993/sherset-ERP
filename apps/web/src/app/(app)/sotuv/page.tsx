'use client';

// F2 — POS-qamrovli tema tokenlari (`.pos-theme` ildiz klassi ostida).
import './pos-theme.css';

import { type ChekDetailPosition, CheklarMode } from '@/app/(app)/sotuv/_components/cheklar-mode';
import { NavbatMode } from '@/app/(app)/sotuv/_components/navbat-mode';
import type { CartLine, SaleRow, UnresolvedSaleRow } from '@/app/(app)/sotuv/_components/pos-types';
import { SmenaMode } from '@/app/(app)/sotuv/_components/smena-mode';
import { SavatPanel, SotuvSearchGrid } from '@/app/(app)/sotuv/_components/sotuv-mode';
import { usePrintOutcome } from '@/app/(app)/sotuv/_components/use-print-outcome';
import { VozvratMode } from '@/app/(app)/sotuv/_components/vozvrat-mode';
import {
  type OrderDetail,
  type OrderRow,
  type PosOrderState,
  ZakazlarMode,
} from '@/app/(app)/sotuv/_components/zakazlar-mode';
import { CartLineEditModal } from '@/components/pos/cart-line-edit-modal';
import { CashOutDialog } from '@/components/pos/cash-out-dialog';
import { CashierSelectScreen } from '@/components/pos/cashier-select-screen';
import type { CustomerCardRow } from '@/components/pos/customer-card-panel';
import { CustomerCardPanel } from '@/components/pos/customer-card-panel';
import { CustomersPanel } from '@/components/pos/customers-panel';
import { DebtPaymentDialog } from '@/components/pos/debt-payment-dialog';
import { PosHeader } from '@/components/pos/pos-header';
import { type PosMode, PosSidebar } from '@/components/pos/pos-sidebar';
import { RasmiyashtirishModal } from '@/components/pos/rasmilashtirish-modal';
import { useServerLink } from '@/components/pos/use-server-link';
import { useDestructiveMutation } from '@/hooks/use-destructive-mutation';
import { useFillViewport } from '@/hooks/use-fill-viewport';
import { usePermissions } from '@/hooks/use-permissions';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
// S2/S3 — chek sanasi va qoralama vaqti qurilma soatidan EMAS, serverdan.
import { POS_TZ, serverNow } from '@/lib/clock';
import { useBcp47 } from '@/lib/i18n-format';
import { isPosWorkstation } from '@/lib/pos-device';
import {
  CART_DRAFTS_STORAGE_KEY,
  type CartDraft,
  newDraftId,
  parseCartDrafts,
  serializeCartDrafts,
} from '@/lib/pos/cart-drafts';
// B8 — savat matematikasi sof modulda (20 test). Ilgari bu qoidalar shu
// faylda edi va ularni sinash uchun butun POS ekranini render qilish
// kerak bo'lardi, shuning uchun ular umuman sinalmagan edi.
import {
  addQtyDecimal,
  cartCostMinor,
  cartTotalMinor,
  discountedCartTotalMinor,
  normalizeQtyDecimal,
  revenueBaseMinor,
  cartCount as sumCartCount,
  toMinorOrNull,
} from '@/lib/pos/cart-math';
// Smena yopish sanog'i uchun xavfsiz pul-parse (buzuq kiritma → 0n, crash emas).
import { parseAmountToMinor } from '@/lib/pos/parse-amount';
import { cartToProformaReceipt } from '@/lib/pos/receipt-proforma-model';
import { scanFeedback } from '@/lib/pos/scan-feedback';
import {
  printDebtReceiptViaAgent,
  printPickingViaAgent,
  printProformaReceiptViaAgent,
  printReceiptViaAgent,
  printZReportViaAgent,
} from '@/lib/print-agent';
import {
  resolveDefaultSalePrice,
  resolveDefaultSalePriceOrZero,
  resolveWholesaleSalePrice,
  toBaseMinor,
  useCurrencyRates,
  usePriceTypeIds,
} from '@/lib/sale-price';
// P4 — smena yoshini matnga aylantirish (chegara mantiqi SERVERDA).
import { formatShiftAge } from '@/lib/shift-age';
import { useZReceiptLabels } from '@/lib/use-z-receipt-labels';
import type {
  CurrentSession,
  ListEnvelope as ListResponse,
  PosProductRow as ProductRow,
} from '@moysklad/contracts';
import { Money, marginPercent } from '@moysklad/money';
import { isCurrencyCode } from '@moysklad/money/currencies';
import { Button, Input, formatMoney, useConfirm, useToast } from '@moysklad/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// `formatUsd` — F1 da smena bloki bilan birga `_components/smena-mode.tsx` ga ko'chdi.

/**
 * Qidiruv debounce oynasi (ms). Qo'lda terishda oraliq prefikslar uchun so'rov
 * ketmaydi — do'kon internetida har harfga bitta tarmoq-aylanma qimmat edi
 * (2026-08-16 diagnoz). Skaner/Enter bu oynani KUTMAYDI — `onSearchEnter`
 * flush qilib so'rovni darhol otadi.
 */
const SEARCH_DEBOUNCE_MS = 250;

// ── Types ──────────────────────────────────────────────────────────────────
//
// The API payload types come from `@moysklad/contracts` (audit `FE-12`). This
// page and `/retail` both hand-declared `CurrentSession` for the SAME endpoint
// and disagreed: here `cashDesk`/`store` were nullable, in `/retail` they were
// required. Ground truth settles it — `CashierSession.cashDeskId`/`.storeId`
// are NOT NULL columns and `findCurrentForCashier` includes both relations
// unconditionally, so they are always present and `/retail` was the accurate
// one. The defensive `?.` reads kept below are now redundant rather than
// load-bearing; they are left in place because removing them changes render
// paths for no behavioural gain.
//
// `CartLine` — sahifaning o'z UI holati; F1 da `_components/pos-types.ts` ga
// ko'chdi (savat paneli ham o'qiydi), izohi o'sha yerda.

// ── Open Shift Form ─────────────────────────────────────────────────────────

interface MineResponse {
  smena: {
    id: string;
    name: string;
    schedule: { name: string; startTime: string; endTime: string };
    organization: { id: string; name: string };
  } | null;
  withinShift: boolean;
}

function OpenShiftForm() {
  const tRetail = useTranslations('pages.retail');
  const t = useTranslations('pages.sotuv');
  const qc = useQueryClient();
  const { toast } = useToast();

  const [reason, setReason] = useState('');
  // 2026-08-16 (egasi: «har smena 0 dan») — yashiqdagi boshlang'ich naqd
  // endi shaklda so'raladi. Bo'sh = 0 (yashiq bo'shatilgan, smena 0 dan
  // boshlanadi); pul qolgan bo'lsa kassir borini yozadi — yopishdagi
  // «oldingi smenalar qo'shilib ketyapti» soxta farqi shu bilan yo'qoladi.
  const [openingCash, setOpeningCash] = useState('');
  const [openingCashUsd, setOpeningCashUsd] = useState('');

  const { data: mine, isLoading } = useQuery<MineResponse>({
    queryKey: ['smena-mine'],
    queryFn: () => api.get<MineResponse>('/admin/smenas/mine'),
  });

  const openMut = useMutation({
    mutationFn: (body: object) => api.post('/admin/smenas/open-session', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cashier-session-current'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const handleOpen = () => {
    if (!mine?.smena) return;
    // 2026-08-16 (egasi qarori): vaqtdan tashqari SABAB IXTIYORIY — ikki
    // bosqichli «avval bos, keyin sabab» to'sig'i olib tashlandi. Server ham
    // endi sababsiz qabul qiladi (audit §9 baribir yoziladi).
    openMut.mutate({
      smenaId: mine.smena.id,
      openingCashMinor: parseAmountToMinor(openingCash).toString(),
      openingCashUsdMinor: parseAmountToMinor(openingCashUsd, 'USD').toString(),
      ...(reason.trim() ? { outOfShiftReason: reason.trim() } : {}),
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto mt-16 max-w-sm text-center text-[var(--ms-text-muted)] text-sm">
        {t('loading')}
      </div>
    );
  }

  // Kassirga smena biriktirilmagan
  if (!mine?.smena) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-2xl bg-[var(--ms-bg-surface)] p-6 shadow-lg text-center">
        <h2 className="mb-2 font-semibold text-[var(--ms-text-primary)] text-xl">
          {t('shift_none_title')}
        </h2>
        <p className="text-sm text-[var(--ms-text-muted)]">
          {t('shift_none_hint')}
          <br />
          <a
            href="/settings/smena"
            className="text-[var(--ms-text-brand)] underline mt-1 inline-block"
          >
            {t('shift_manage_link')}
          </a>
        </p>
      </div>
    );
  }

  const { smena, withinShift } = mine;

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl bg-[var(--ms-bg-surface)] p-6 shadow-lg">
      <h2 className="mb-1 font-semibold text-[var(--ms-text-primary)] text-xl">
        {tRetail('open_shift_title')}
      </h2>

      {/* Smena ma'lumotlari */}
      <div className="mt-4 mb-5 rounded-xl bg-[var(--ms-bg-app)] p-4 flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-[var(--ms-text-muted)]">{t('shift_field')}</span>
          <span className="font-medium">{smena.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--ms-text-muted)]">{t('work_time')}</span>
          <span
            className={withinShift ? 'text-green-600 font-medium' : 'text-orange-500 font-medium'}
          >
            {smena.schedule.startTime}–{smena.schedule.endTime}
            {withinShift ? ' ✓' : ` ${t('out_of_hours')}`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--ms-text-muted)]">{t('organization')}</span>
          <span>{smena.organization.name}</span>
        </div>
      </div>

      {/* Yashiqdagi boshlang'ich naqd (2026-08-16): bo'sh = 0. Sensorli
          nishon uchun balandroq maydonlar (kassa ekrani). */}
      <div className="mb-4 flex flex-col gap-3">
        <div>
          <label
            htmlFor="open-shift-cash"
            className="mb-1 block text-[var(--ms-text-muted)] text-sm"
          >
            {t('opening_cash_label')}
          </label>
          <Input
            id="open-shift-cash"
            data-test-id="open-shift-cash"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            className="h-12 text-base"
          />
        </div>
        <div>
          <label
            htmlFor="open-shift-cash-usd"
            className="mb-1 block text-[var(--ms-text-muted)] text-sm"
          >
            {t('opening_cash_usd_label')}
          </label>
          <Input
            id="open-shift-cash-usd"
            data-test-id="open-shift-cash-usd"
            value={openingCashUsd}
            onChange={(e) => setOpeningCashUsd(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            className="h-12 text-base"
          />
        </div>
      </div>

      {/* Vaqtdan tashqari — sabab IXTIYORIY (2026-08-16, egasi qarori).
          Maydon darhol ko'rinadi, bo'sh qoldirsa ham ochiladi; yozilgani
          §9 audit-jurnalida menejer hisobotiga tushadi. */}
      {!withinShift && (
        <div className="mb-4">
          <p className="text-sm text-orange-600 mb-2">
            {t('out_of_hours_optional_hint', {
              from: smena.schedule.startTime,
              to: smena.schedule.endTime,
            })}
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reason_placeholder')}
          />
        </div>
      )}

      {/* 2026-08-16: tugma hech qachon bloklanmaydi — sabab ixtiyoriy,
          naqd maydonlari bo'sh bo'lsa 0 deb ketadi. */}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={openMut.isPending}
        onClick={handleOpen}
      >
        {t('shift_open_btn')}
      </Button>
    </div>
  );
}

// ChekDetailPanel + usePrintOutcome — F1 da `_components/cheklar-mode.tsx` /
// `_components/use-print-outcome.ts` ga, zakaz tiplari + ZakazDetailPanel —
// `_components/zakazlar-mode.tsx` ga ko'chdi (xulq o'zgarmagan).

// ── Z-hisobot chop etish (F11) ───────────────────────────────────────────────

/**
 * Z-hisobotni chop etish — chek bilan AYNI yo'l: agent/Electron chek
 * printeriga jim bosadi, aks holda brauzer popup'i (`?auto=1`) ochiladi.
 *
 * Ikki chaqiruvchi bor (ochiq smenadagi tugma va yopilgandan keyingi
 * tugma), shuning uchun yo'l bitta hookda — ikki joyda ayri yozilsa,
 * biri fallback'ni unutib qo'yardi.
 */
function usePrintZReport() {
  const labels = useZReceiptLabels();
  const finishPrint = usePrintOutcome();
  return useCallback(
    async (sessionId: string) => {
      const outcome = await printZReportViaAgent(sessionId, labels);
      await finishPrint(outcome, {
        url: `/print/z-report/${sessionId}?auto=1`,
        features: 'width=420,height=760',
      });
    },
    [labels, finishPrint],
  );
}

// ── Sales screen ─────────────────────────────────────────────────────────────

function SalesScreen({
  session,
  onShiftClosed,
}: {
  session: CurrentSession;
  /** Smena yopilgach id'ni yuqoriga uzatadi — ekran «smena ochish»ga
   *  qaytadi va Z-hisobotga yo'l shu id orqali saqlanib qoladi. */
  onShiftClosed: (sessionId: string) => void;
}) {
  const t = useTranslations('pages.sotuv');
  const tCommon = useTranslations('common');
  const bcp47 = useBcp47();
  // P4 — smena yoshi. `openMinutes` ni SERVER beradi (chegara MK13
  // registrida), ekran faqat matnga aylantiradi.
  const shiftAge = formatShiftAge(session.openMinutes, t);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { runDestructive } = useDestructiveMutation();
  const finishPrint = usePrintOutcome();

  // Tan narx BUTUN sahifada ko'rinadi — setkada ham, savatda ham.
  //
  // Ilgari setkadagi «Kelgan» faqat egaga ko'rinardi. Kassa TZ §5.2 savat
  // qatoriga tan narx / optom chegara / jonli foydani chiqargach (2026-08-02,
  // to'lqin 1.1), o'sha gate HIMOYA QILMAY qo'ydi: kassir tovarni bir marta
  // bosib savatga qo'shsa, o'sha raqamni baribir ko'radi. Ishlamaydigan
  // cheklovni saqlash undan ham yomoni — u «bu raqam sir» deb o'rgatadi va
  // ikki soniyadan keyin o'zi ko'rsatadi.
  //
  // Egasining modeli buni allaqachon hal qilgan: «kassirga ishonch + keyingi
  // nazorat» (TZ §5 «Boshqaruvchi falsafa»). Narxni erkin qo'yadigan kassir
  // nima berayotganini ko'rishi KERAK; nazorat esa keyin — audit jurnali va
  // menejer analitikasi orqali (to'lqin 1.3).

  // Real PriceType ids so the cart reads the same tiers the server freezes at
  // post() — the retail tier for the starting price, the «Оптовая цена» tier
  // for the negotiated floor.
  const { defaultId: defaultPriceTypeId, wholesaleId: wholesalePriceTypeId } = usePriceTypeIds();
  // Valyuta kurslari — narx yozuvi `currencyCode` bilan saqlangan bo'lsa
  // resolver uni JORIY kurs bilan bazaga o'giradi. Kurslarsiz bunday narx
  // `null`/`'0'` bo'lib ekrandan YO'QOLADI (ataylab: xom sonni ko'rsatish
  // «10 dollar = 10 so'm» xatosini qaytaradi). Hook komponent boshida —
  // erta return'lar oldida (hook-tartibi buzilishi React #310 bilan prodni
  // yiqitgan).
  const rates = useCurrencyRates();

  const printZReport = usePrintZReport();

  // F2 — eski `tab` unioni `PosMode`ga ko'chdi: 'savat'→'sotuv' (savat endi
  // Sotuv rejimining doimiy qismi), 'jarayonda'/'tayyor'→'navbat' (bitta
  // ekran, F4 kanban qiladi). Rejimlar TO'LIQ EKRAN (spec Q2).
  const [mode, setMode] = useState<PosMode>('sotuv');

  // F2 — sidebar holati. `localStorage` faqat foydalanuvchi qo'l bilan
  // almashtirganda yoziladi; saqlanmagan bo'lsa tor ekran avto-yig'adi
  // (spec §3.2). SSR'da `window` yo'q — kengaygan deb boshlaymiz (sahifa
  // baribir sessiya so'rovi kelguncha chizilmaydi, mismatch bo'lmaydi).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = window.localStorage.getItem('sherset.pos.sidebar');
      if (stored === 'collapsed') return true;
      if (stored === 'expanded') return false;
    } catch {
      /* localStorage yopiq (private mode) — sukut qiymat */
    }
    return window.innerWidth < 1280;
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('sherset.pos.sidebar', next ? 'collapsed' : 'expanded');
      } catch {
        /* saqlanmasa ham ishlayveradi */
      }
      return next;
    });
  }, []);

  // F2 — aloqa indikatori: mavjud polling oqimini kuzatadi, yangi so'rov yo'q.
  const connectionOk = useServerLink();
  const [search, setSearch] = useState('');
  // 2026-08-16 (sekin-qidiruv diagnozi): so'rov HAR tugma-bosishda emas, matn
  // tinchigach ketadi. `debouncedSearch` — so'rovga boradigan (kechiktirilgan)
  // nusxa; Enter/skaner uni kutmaydi (`onSearchEnter` flush qiladi).
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    if (search === debouncedSearch) return undefined;
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);
  // Qidiruv maydoni savatga qo'shilgandan keyin tozalanadi VA fokusni
  // qaytaradi (`addToCart`) — shu ref o'sha fokus uchun.
  const searchRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartLine[]>([]);

  // ── QORALAMA (hold order, 2026-08-16 egasi so'rovi) ────────────────────────
  // Kassir savatni chetga olib ikkinchi mijozga xizmat ko'rsatadi. Ro'yxat
  // `localStorage`da — sahifa yangilansa yo'qolmaydi. Serializatsiya (bigint!)
  // va fail-safe parse `lib/pos/cart-drafts.ts` da (o'z testlari bilan).
  // Parse `CartDraftLine` qaytaradi — `CartLine` bilan strukturaviy mos va
  // replacer NOMA'LUM maydonlarni ham roundtrip qiladi, ya'ni bu cast xavfsiz.
  const [cartDrafts, setCartDrafts] = useState<CartDraft<CartLine>[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return parseCartDrafts(
        window.localStorage.getItem(CART_DRAFTS_STORAGE_KEY),
      ) as CartDraft<CartLine>[];
    } catch {
      return []; // localStorage yopiq (private mode) — qoralamasiz ishlayveradi
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(CART_DRAFTS_STORAGE_KEY, serializeCartDrafts(cartDrafts));
    } catch {
      /* saqlanmasa ham joriy sessiyada ishlaydi */
    }
  }, [cartDrafts]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [discountPct, setDiscountPct] = useState(0);
  const [discountEditing, setDiscountEditing] = useState(false);

  // ── MIJOZ-EKRAN (televizor) ────────────────────────────────────────────────
  // Kassir O'ZI boshqaradi (avtomat EMAS): tugma yoki F9.
  //  • Sherset dasturi (Electron) — native 2-oyna, HDMI ekranда fullscreen (IPC).
  //  • Oddiy brauzer (Chrome) — yangi brauzer oynasi (window.open); uni televizorga
  //    sudrab F11 bilan fullscreen qilinadi. Savat BroadcastChannel bilan sinxron.
  const [cfdOpen, setCfdOpen] = useState(false);

  // Mijoz-ekranga yuboriladigan savat (bigint IPC/postMessage'da uzatilmaydi → string).
  const cfdPayload = useMemo(
    () => ({
      lines: cart.map((l) => ({
        productId: l.productId,
        name: l.productName,
        // Miqdor SATR bo'lib ketadi (`Decimal(20,6)`) — mijoz-ekran uni
        // `BigInt()` ga bermasligi kerak edi; `customer-display/page.tsx`
        // shu bilan birga tuzatildi (kasr miqdor u yerda ham RangeError otardi).
        quantity: normalizeQtyDecimal(l.quantity),
        priceMinor: String(l.priceMinor),
      })),
      discountPct,
    }),
    [cart, discountPct],
  );
  const cfdPayloadRef = useRef(cfdPayload);
  cfdPayloadRef.current = cfdPayload;

  // Brauzer mijoz-oynasi bilan aloqa kanali (bir marta). Mijoz-oyna ochilganda
  // «cfd-ready» yuboradi — biz joriy savatni qaytaramiz (dastlabki holat uchun).
  const cfdChannelRef = useRef<BroadcastChannel | null>(null);
  const cfdWindowRef = useRef<Window | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('sherset-cart');
    ch.onmessage = (e) => {
      if (e.data?.type === 'cfd-ready')
        ch.postMessage({ type: 'cart', payload: cfdPayloadRef.current });
    };
    cfdChannelRef.current = ch;
    return () => {
      ch.close();
      cfdChannelRef.current = null;
    };
  }, []);

  // Dastur ichида bo'lsak — mijoz-oyna allaqachon ochiqmi (holatni tikla).
  useEffect(() => {
    window.electronAPI
      ?.customerDisplayStatus?.()
      .then((s) => setCfdOpen(!!s?.open))
      .catch(() => {});
  }, []);

  const toggleCfd = useCallback(async () => {
    // (a) Sherset dasturi — native 2-oyna.
    if (window.electronAPI?.toggleCustomerDisplay) {
      try {
        const r = await window.electronAPI.toggleCustomerDisplay();
        if (r?.error) toast.error(r.error);
        setCfdOpen(!!r?.open);
      } catch {
        /* IPC xatosi — jim, kassa ishi to'xtamasin */
      }
      return;
    }
    // (b) Brauzer — yangi oyna. Ochiq bo'lsa — yopamiz.
    if (cfdWindowRef.current && !cfdWindowRef.current.closed) {
      cfdWindowRef.current.close();
      cfdWindowRef.current = null;
      setCfdOpen(false);
      return;
    }
    const w = window.open('/customer-display', 'sherset-cfd', 'width=1280,height=720');
    if (!w) {
      toast.error(t('cfd_popup_blocked'));
      return;
    }
    cfdWindowRef.current = w;
    setCfdOpen(true);
    // Oyna yuklanguncha joriy savatni bir necha marta yuboramiz (handshake zaxirasi).
    for (const ms of [400, 900, 1600]) {
      setTimeout(
        () => cfdChannelRef.current?.postMessage({ type: 'cart', payload: cfdPayloadRef.current }),
        ms,
      );
    }
  }, [toast, t]);

  // Smena tab — drawer + close shift
  const tillCurrency = isCurrencyCode(session.cashDesk?.currency)
    ? session.cashDesk!.currency
    : 'UZS';
  const [drawerMode, setDrawerMode] = useState<'in' | 'out' | null>(null);
  const [debtPayOpen, setDebtPayOpen] = useState(false);
  // F9 — mijoz kartasi. Panel alohida faylda (`customer-card-panel.tsx`);
  // bu yerda faqat holat va uch callback.
  const [customerCardOpen, setCustomerCardOpen] = useState(false);
  // F7-tuzatish (2026-08-14): Mijozlar panelidan karta TANLANGAN mijoz bilan
  // ochiladi (qidiruv qadamisiz); Smena tabidagi tugma esa null qoldiradi —
  // u yerda mijoz hali tanlanmagan, qidiruvdan boshlanadi.
  const [customerCardAgent, setCustomerCardAgent] = useState<CustomerCardRow | null>(null);
  const [debtPayAgent, setDebtPayAgent] = useState<CustomerCardRow | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [drawerAmount, setDrawerAmount] = useState('');
  const [drawerComment, setDrawerComment] = useState('');
  const [closingCash, setClosingCash] = useState('');
  // MK31 — sanalgan DOLLAR (§8.4 «UZS va USD alohida»). Bo'sh satr =
  // «sanalmagan»: server uni `null` deb qabul qiladi va 0 bilan
  // aralashtirmaydi.
  const [closingCashUsd, setClosingCashUsd] = useState('');
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [varianceNote, setVarianceNote] = useState('');

  const {
    data: products,
    isLoading,
    isFetching,
  } = useQuery<ListResponse<ProductRow>>({
    queryKey: ['products-sotuv', debouncedSearch],
    // `signal` — kalit o'zgarganda (yangi matn) eskirgan so'rov bekor bo'ladi;
    // sekin internetda ulanish-slotlarni band qilib navbat hosil qilmasin.
    queryFn: ({ signal }) =>
      api.get<ListResponse<ProductRow>>(
        `/products?search=${encodeURIComponent(debouncedSearch)}&limit=48`,
        { signal },
      ),
    // Yangi qidiruvda setka ESKI natijani ushlab turadi (spinner o'rniga) —
    // «har harfda Yuklanmoqda…» sekinlik shikoyatining asosiy ko'rinishi edi.
    // Eskirgan-natija-ustidan-Enter xavfi `searchSettled` bilan yopilgan
    // (pastda) — Enter faqat JORIY matn natijasiga ishlaydi.
    placeholderData: keepPreviousData,
    /**
     * P12 — TOVAR KARTASI → POS zanjiri. Kassa ekrani kun bo'yi OCHIQ turadi
     * (kiosk), global sozlama esa `staleTime: 30s` + `refetchOnWindowFocus:
     * false` — ya'ni so'rov qayta yugurmasdi va egasi kartada narxni
     * o'zgartirsa POS uni faqat sahifa qayta yuklangandan (yoki qidiruv matni
     * o'zgargandan) keyin ko'rardi. Narx poli shu narxlarga tayanadi, ya'ni
     * eskirgan kesh «minimal» ni ham eskirtirardi.
     *
     * 48 qatorlik so'rov — daqiqada bir marta arzon; savatga ta'sir qilmaydi
     * (savat qatorlari o'z nusxasini tashiydi).
     */
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // `SaleRow` — F1 da `_components/pos-types.ts` ga ko'chdi (cheklar/navbat
  // rejim-komponentlari ham o'qiydi); `SaleDetail` faqat shu sahifaniki.
  interface SaleDetail extends SaleRow {
    cashAmountMinor: string;
    cardAmountMinor: string;
    terminalAmountMinor: string;
    positions: Array<{
      id: string;
      quantity: string;
      priceMinor: string;
      sumMinor: string;
      discount: string;
      // Frozen at post() — NULL while the receipt is still draft/picking/ready.
      costMinor: string | null;
      basePriceMinor: string | null;
      product: {
        id: string;
        name: string;
        code: string | null;
        buyPrice: string | null;
        buyPriceCurrency?: string | null;
        salePrices?: Array<{ priceTypeId: string; value: string }> | null;
      };
    }>;
  }

  const [selectedChekId, setSelectedChekId] = useState<string | null>(null);

  // F6.C (2026-08-13) — «istalgan chekni TOPISH»: bo'sh qidiruv = joriy smena
  // (eski xulq); matn kiritilsa so'rov `search=` bilan BARCHA smenalar
  // bo'ylab ketadi (`sessionId`siz) — backend chek nomi + kontragent nomi
  // bo'yicha qidiradi (`RetailSaleFilterSchema.search`).
  const [chekSearch, setChekSearch] = useState('');
  const chekQuery = chekSearch.trim();

  const { data: cheklar } = useQuery<{ items: SaleRow[]; total: number }>({
    queryKey: ['retail-sales-session', session.id, chekQuery],
    queryFn: () =>
      chekQuery
        ? api.get(`/retail-sales?search=${encodeURIComponent(chekQuery)}&limit=50`)
        : api.get(`/retail-sales?sessionId=${session.id}&limit=100`),
    enabled: mode === 'cheklar',
  });

  // Ready state sales — polling every 8s so kassir sees when omborchi marks tayyor
  const { data: readySalesData } = useQuery<{ items: SaleRow[] }>({
    queryKey: ['retail-sales-ready', session.id],
    queryFn: () => api.get(`/retail-sales?sessionId=${session.id}&state=ready&limit=20`),
    refetchInterval: 8000,
  });
  const readySales = readySalesData?.items ?? [];

  // Picking (jarayonda) state sales — omborchi hozir yig'ayotgan savdolar.
  // Polled so the kassir sees live what the warehouse worker is collecting.
  const { data: pickingSalesData } = useQuery<{ items: SaleRow[] }>({
    queryKey: ['retail-sales-picking', session.id],
    queryFn: () => api.get(`/retail-sales?sessionId=${session.id}&state=picking&limit=20`),
    refetchInterval: 8000,
  });
  const pickingSales = pickingSalesData?.items ?? [];

  // F5 — smenani yopishga to'sqinlik qiluvchi cheklar (draft|picking|ready)
  // STRUKTURA sifatida. Mezon serverda `close()` bilan yagona yordamchida —
  // FE o'zi «bloklovchimi?» deb hisoblamaydi (aks holda ikki mezon ajralib
  // ketardi). `draft` bu ro'yxatda BOR — u boshqa hech qaysi rejimda
  // ko'rinmasdi («ko'rinmas bloklovchi»). 8s polling — navbat so'rovlari
  // bilan bir ohangda (boshqa terminal/omborchi holatni o'zgartirishi mumkin).
  const { data: unresolvedData } = useQuery<{ sales: UnresolvedSaleRow[] }>({
    queryKey: ['cashier-session-unresolved', session.id],
    queryFn: () => api.get(`/cashier-sessions/${session.id}/unresolved`),
    enabled: mode === 'smena',
    refetchInterval: 8000,
  });
  const unresolvedSales = unresolvedData?.sales ?? [];

  // ── ZAKAZLAR (F7) ──────────────────────────────────────────────────────────
  // Holat filtri SERVERGA ketadi (`state=`), FE saralamaydi: aks holda
  // `limit` chegarasi «yangi» zakazlarni yopiq zakazlar bilan to'ldirib
  // yuborardi va kassir kutayotgan zakazni umuman ko'rmasdi.
  //
  // `storeId` ham SERVER filtri — kassir o'z do'konining zakazini ko'radi.
  const { can: canDo } = usePermissions();
  const canSeeOrders = canDo('customerorder', 'view');
  // V2 (egasi, 2026-09-01) — Vozvrat rejimi faqat qaytarish huquqi borga
  // (Shavkat va b.); server qulfi `POST /retail-sales/:id/refund` da.
  const canRefund = canDo('salesreturn', 'create');
  const [orderState, setOrderState] = useState<PosOrderState>('draft');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const { data: ordersData } = useQuery<ListResponse<OrderRow>>({
    queryKey: ['pos-customer-orders', orderState, session.store?.id ?? null],
    queryFn: () =>
      api.get(
        `/customer-orders?state=${orderState}&storeId=${session.store?.id ?? ''}&limit=50&sortBy=moment&sortDir=desc`,
      ),
    enabled: mode === 'zakazlar' && canSeeOrders,
  });
  const orders = ordersData?.items ?? [];

  // Ready sale selected for payment
  const [payingSale, setPayingSale] = useState<{ id: string; sumMinor: bigint } | null>(null);
  /**
   * F8 — savat AYNAN shu zakazni yopmoqda.
   *
   * Bu bo'sh bo'lmasa savat QULFLANADI (narx/miqdor tahriri va qator o'chirish
   * yo'q). Sabab: chek serverda zakazga bog'lanadi va CHEK SUMMASI zakazga
   * to'lov sifatida tushadi (`CustomerOrderService.applyPayment`). Kassir
   * narxni tushirsa yoki qator o'chirsa, zakaz JIMGINA «to'liq to'lanmagan»
   * bo'lib qolardi: pul olingan, tovar ketgan, zakaz esa hamon `confirmed`.
   * Kelishilgan narxni o'zgartirish — zakaz hujjatining ishi, kassaning emas.
   */
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const cartLocked = payingOrderId != null;

  const cartCount = sumCartCount(cart);
  const cartTotal = cartTotalMinor(cart);
  /**
   * Chegirmali jami — **server formulasi** (AUDIT tuzatishi).
   *
   * Ilgari bu yerda `applyDiscountMinor(cartTotal, discountPct)` turardi:
   * chegirma JAMIga bir marta va pastga yaxlitlab qo'llanardi. Server esa
   * har qatorni ALOHIDA half-up yaxlitlaydi (`computePositionTotal`) va
   * `post()` da `expectedSumMinor` ni QAT'IY tenglik bilan tekshiradi.
   * Ikkalasi tiyinda ayriladi — o'lchangan misol: 3 × 115 tiyin, −10% →
   * ekran 311, server 312 (`cart-math.test.ts` da qulflangan). Ya'ni kassir
   * ko'rgan raqam chekdagi raqam emas edi, va chekka o'sha farq bilan
   * yuborilgan `expectedSumMinor` 409 bilan qaytardi.
   */
  const discountedTotal = discountedCartTotalMinor(
    cart.map((l) => ({ quantity: l.quantity, priceMinor: l.priceMinor, discount: discountPct })),
  );

  // Chek bo'yicha foyda (kassa TZ §5.2) — profit is taken off the DISCOUNTED
  // total, since that is the money the till actually receives. `complete` goes
  // false as soon as one line has no cost on its card; the footer then says so
  // instead of showing a total that silently counts that line as pure profit.
  // `cartCostMinor` — `@moysklad/money` dagi `sumCostMinor` ning kasr-miqdorli
  // varianti (u `bigint` miqdor talab qiladi, ya'ni 1.5 kg ni ifodalay olmaydi).
  // `complete` shartnomasi o'zgarmagan: NULL tan narx qo'shilmaydi va jami
  // «to'liq emas» deb belgilanadi (NULL ≠ 0).
  // 🔴 2026-08-16, egasining qarori: KASSADA NARX CHEKLOVI YO'Q — kassir
  // istalgan narxda, shu jumladan BEPULGA sotadi. Ilgari bu yerda
  // `pricePolicyBlock` turardi va u «To'lash / Sotish / Omborchiga
  // yuborish» tugmalarini o'chirardi. Bayroq bilan o'chirilgan emas, BUTUNLAY olib
  // tashlangan — o'chiq bayroq jimgina yoqilib qulfni qaytarishi mumkin edi.
  // Serverda ham hech qanday narx tekshiruvi qolmadi
  // (`retail-sale.service.ts` → `post()`).

  const cartCost = cartCostMinor(cart);
  // Foyda asosi = kassa HAQIQATAN oladigan pul. Mavjud chekni to'layotgan
  // bo'lsak (omborchidan qaytgan «Tayyor» chek) — bu serverning o'z `sumMinor`i,
  // qayta hisoblangan raqam emas: server qator-ba-qator yaxlitlagan, biz esa
  // jamiga foiz qo'llaymiz, ikkalasi tiyinda farq qilishi mumkin.
  const revenueMinor = revenueBaseMinor(payingSale?.sumMinor, discountedTotal);
  const cartProfitMinor = cartCost.complete ? revenueMinor - cartCost.costMinor : null;
  const cartMarginPct = marginPercent(cartProfitMinor, revenueMinor);

  // The three numbers a cart line carries off the product card (kassa TZ §5.1):
  // cost floor, wholesale floor, retail starting price.
  const cardPrices = useCallback(
    (
      buyPrice: string | null | undefined,
      buyPriceCurrency: string | null | undefined,
      salePrices: ProductRow['salePrices'],
    ): Pick<
      CartLine,
      'costMinor' | 'wholesaleMinor' | 'basePriceMinor' | 'costCurrency' | 'costOriginalMinor'
    > => {
      // Dollarda kelgan tovar (2026-09-01, egasi): tannarx sotuv narxlari
      // bilan BIR XIL shartnomada JORIY kurs orqali bazaga o'giriladi
      // (`toBaseMinor`: kursi noma'lum → null, xom son EMAS). Asl summa +
      // valyuta alohida olib yuriladi — qator oynasi «$… ≈ …сум» ko'rsatadi.
      const foreign =
        buyPriceCurrency != null && rates.base != null && buyPriceCurrency !== rates.base;
      return {
        costMinor: toMinorOrNull(toBaseMinor(buyPrice ?? undefined, buyPriceCurrency, rates)),
        costCurrency: foreign ? buyPriceCurrency : null,
        costOriginalMinor: foreign ? toMinorOrNull(buyPrice) : null,
        wholesaleMinor: toMinorOrNull(
          resolveWholesaleSalePrice(salePrices, wholesalePriceTypeId, rates),
        ),
        basePriceMinor: toMinorOrNull(
          resolveDefaultSalePrice(salePrices, defaultPriceTypeId, rates),
        ),
      };
    },
    // `rates` — kurslar asinxron keladi; usiz muzlatilgan callback valyutali
    // narxni butun smena davomida «yo'q» deb o'qirdi.
    [defaultPriceTypeId, wholesalePriceTypeId, rates],
  );

  // F3 — skaner-javob flash'i: qo'shilgan qator 600ms yashil yonadi. `seq`
  // ketma-ket skanlarda taymerni QAYTA boshlatadi (holat qiymati o'zgarmasa
  // effekt qayta ishlamasdi).
  const [cartFlash, setCartFlash] = useState<{ productId: string; seq: number } | null>(null);
  useEffect(() => {
    if (!cartFlash) return;
    const timer = setTimeout(() => setCartFlash(null), 600);
    return () => clearTimeout(timer);
  }, [cartFlash]);

  const addToCart = useCallback(
    (product: ProductRow) => {
      setCart((prev) => {
        const existing = prev.find((l) => l.productId === product.id);
        if (existing) {
          return prev.map((l) =>
            l.productId === product.id ? { ...l, quantity: addQtyDecimal(l.quantity, 1) } : l,
          );
        }
        const minor = BigInt(
          resolveDefaultSalePriceOrZero(product.salePrices, defaultPriceTypeId, rates),
        );
        return [
          ...prev,
          {
            productId: product.id,
            productName: product.name,
            quantity: '1',
            priceMinor: minor,
            priceStr: (Number(minor) / 100).toString(),
            availableStock: product.stock != null ? Number(product.stock.available) : undefined,
            // K3 — bo'linadigan tovar bayrog'i tovar kartochkasidan ko'chadi
            // (`GET /products` qatorida keladi). Faqat shu tovarlarda qator
            // oynasida bo'lak paneli ochiladi.
            pieceTracked: product.pieceTracked === true,
            ...cardPrices(product.buyPrice, product.buyPriceCurrency, product.salePrices),
          },
        ];
      });
      // Qidiruv matni endi TOZALANMAYDI (kassirlar so'rovi, 2026-08-16):
      // keyingi tovar nomi ko'pincha shu qidiruvga o'xshash bo'ladi, natijalar
      // «Tozalash» bosilguncha turadi. Buning o'rniga fokus qaytadi va matn
      // TO'LIQ BELGILANADI — kassir yangi nom tersa (yoki skaner o'qisa) eski
      // matn ustidan yoziladi. Bu 2026-08-12 dagi teskari shikoyatni («yangi
      // harflar eskisining ustiga qo'shilardi») qaytarmaydi: ikkala talab ham
      // shu select() bilan qanoatlanadi. Har qo'shish yo'lida bir xil (Enter ·
      // setkadan bosish · skaner) — shuning uchun aynan shu yerda.
      searchRef.current?.focus();
      searchRef.current?.select();
      // F3 — skaner-javob (spec §5.1): bip + qo'shilgan qator bir lahza yashil.
      // Aynan shu yerda — bu barcha qo'shish yo'llarining yagona kirish nuqtasi.
      scanFeedback.ok();
      setCartFlash((f) => ({ productId: product.id, seq: (f?.seq ?? 0) + 1 }));
    },
    [cardPrices, defaultPriceTypeId, rates],
  );

  // ── Qidiruv «tinchidi»mi + Enter/skaner oqimi (2026-08-16) ────────────────
  // `searchSettled` — ekrandagi natijalar AYNAN joriy matnniki: debounce ham
  // o'tgan, so'rov ham tugagan. Bu ikkita iste'molchi uchun kontrakt:
  //  • Enter — `keepPreviousData` bilan setkada ESKI natija turishi mumkin;
  //    unga Enter berish noto'g'ri tovarni (masalan, skaner o'qigan shtrix
  //    o'rniga oldingi ro'yxat birinchisini) savatga qo'shib yuborardi.
  //  • «Topilmadi» ovozi — eski natija ko'rinib turganda chalinmasin.
  const searchSettled = search === debouncedSearch && !isFetching;

  // Skaner matnni terib DARHOL Enter yuboradi — natija hali yo'q. Enter
  // YO'QOLMAYDI: matn eslab qolinadi, debounce flush qilinadi (so'rov darhol
  // ketadi) va natija kelgach quyidagi effekt birinchisini qo'shadi. Kassir
  // bu orada boshqa matn tersa — eskirgan Enter bekor (ref-taqqoslash).
  const pendingEnterRef = useRef<string | null>(null);
  const onSearchEnter = useCallback(() => {
    if (searchSettled) {
      const first = products?.items?.[0];
      if (first) addToCart(first);
      return;
    }
    pendingEnterRef.current = search;
    setDebouncedSearch(search);
  }, [searchSettled, products, addToCart, search]);

  useEffect(() => {
    const pending = pendingEnterRef.current;
    if (pending == null || !searchSettled) return;
    pendingEnterRef.current = null;
    // Enter'dan keyin matn o'zgargan bo'lsa — bu javob endi unga tegishli emas.
    if (pending !== search) return;
    const first = products?.items?.[0];
    if (first) addToCart(first);
  }, [searchSettled, search, products, addToCart]);

  // Savat har o'zgarganda mijoz-ekranga uzatamiz — ikkala yo'l bilan:
  //  • Electron IPC (pushCart) — dastur ichidagi native 2-oyna,
  //  • BroadcastChannel — brauzerdagi mijoz-oyna (window.open).
  useEffect(() => {
    window.electronAPI?.pushCart?.(cfdPayload);
    cfdChannelRef.current?.postMessage({ type: 'cart', payload: cfdPayload });
  }, [cfdPayload]);

  // F3 (spec Q6): qatordagi −/+ tugmalar bilan birga `updateQty` ham ketdi —
  // miqdorning yagona tahrir yo'li endi qator-oynasi (`applyLineEdit`).
  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  // ── Qoralama amallari ──────────────────────────────────────────────────────
  // Park — joriy savat (+chek chegirmasi) ro'yxatga tushadi, savat bo'shaydi.
  // Zakazga bog'langan (qulflangan) savat va to'lanayotgan tayyor chek
  // qoralamaga OLINMAYDI: bog'lanish (payingOrderId/payingSale) qoralamada
  // saqlanmaydi va tiklashda chek summasi zakazsiz «oddiy savdo» bo'lib
  // ketardi — pul olingan, zakaz esa to'lanmagan qolardi (F8 sababi bilan bir).
  const parkCart = useCallback(() => {
    if (cart.length === 0 || cartLocked || payingSale != null) return;
    setCartDrafts((prev) => [
      ...prev,
      { id: newDraftId(), createdAt: serverNow().getTime(), discountPct, lines: cart },
    ]);
    setCart([]);
    setDiscountPct(0);
    setDiscountEditing(false);
    setCartComment('');
    toast.success(t('draft_saved'));
  }, [cart, cartLocked, payingSale, discountPct, toast, t]);

  // TO'LANGAN CHEKNI «TAHRIRLASH» = SAVATGA NUSXALASH (2026-08-16, egasi).
  // Chekning o'zi O'ZGARMAYDI (buxgalteriya/ombor — buning uchun qaytarish
  // bor): pozitsiyalar savatga ko'chadi, kassir o'zgartirib yangi sotuv
  // qiladi yoki sotuvsiz chek chiqaradi. Joriy savat bo'sh bo'lmasa avval
  // avto-qoralamaga olinadi (restoreDraft naqshi — hech nima yo'qolmaydi).
  const copyChekToCart = useCallback(
    (positions: ChekDetailPosition[]) => {
      if (cartLocked || payingSale != null) {
        toast.error(t('chek_copy_blocked'));
        return;
      }
      if (positions.length === 0) return;
      if (cart.length > 0) {
        setCartDrafts((prev) => [
          ...prev,
          { id: newDraftId(), createdAt: serverNow().getTime(), discountPct, lines: cart },
        ]);
      }
      setCart(
        positions.map((p) => ({
          productId: p.product.id,
          productName: p.product.name,
          quantity: p.quantity,
          // Chekdagi BIRLIK narxi (chegirma foizi ko'chirilmaydi — kassir
          // baribir o'zgartirgani ochyapti).
          priceMinor: BigInt(p.priceMinor),
          priceStr: (Number(p.priceMinor) / 100).toString(),
          ...cardPrices(
            p.product.buyPrice ?? null,
            p.product.buyPriceCurrency ?? null,
            (p.product.salePrices ?? []) as never,
          ),
        })),
      );
      setDiscountPct(0);
      setDiscountEditing(false);
      setSelectedChekId(null);
      setMode('sotuv');
      toast.success(t('chek_copied'));
    },
    [cart, cartLocked, payingSale, discountPct, cardPrices, toast, t],
  );

  // SOTUVSIZ CHEK (2026-08-16, egasi): savatdan chek — sotuv/hujjat YO'Q,
  // serverga hech nima yozilmaydi. Muvaffaqiyatda savat qoralamaga o'tadi —
  // «chekni o'zgartirish» = chipni ochish → o'zgartirish → yana chiqarish.
  //
  // Chek RAQAMI (2026-09-02, egasi) — kassirning shu kundagi ketma-ket soni,
  // haqiqiy sotuv cheki bilan AYNI hisoblagichdan (`document_sequences`).
  // Ilgari u soatdan yasalardi (`CHEK-112159` = 11:21:59) va mijoz uchun
  // hech qanday ma'no bermasdi.
  const printProforma = useCallback(async () => {
    if (cart.length === 0 || cartLocked || payingSale != null) return;
    // 🔴 VAQT SERVERNIKI (S-reja S2). Qog'ozdagi sana kassa mashinasining
    // soatiga bog'liq bo'lmasin — u adashsa mijozning qo'lida XATO SANALI
    // chek qolardi. `serverNow()` — HTTP `Date` sarlavhasidan tekislangan
    // vaqt; YANGI so'rov qo'shilmaydi va bu qiymat serverga YUBORILMAYDI
    // (proforma hech qanday hujjat yaratmaydi — faqat qog'ozga chiqadi).
    const now = serverNow();
    // 🔴 So'rov yiqilsa chek TO'XTAMAYDI — eski vaqt-raqami zaxira bo'lib
    // qoladi. Tarmoq uzilgani uchun mijozni qog'ozsiz qoldirish yomonroq
    // natija; raqam takrorlanmasligini vaqt kafolatlaydi.
    let number: string;
    try {
      const allocated = await api.post<{ number: number }>('/retail-sales/receipt-number', {
        sessionId: session.id,
      });
      number = String(allocated.number);
    } catch {
      const two = (n: number) => n.toString().padStart(2, '0');
      number = `CHEK-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
    }
    const input = cartToProformaReceipt(cart, discountPct, {
      number,
      moment: now.toISOString(),
      cashierName: session.cashier.name,
      organization: { name: session.organization.name },
      // Sotuvsiz chekda ham izoh chiqadi — u ham chek (2026-08-19).
      comment: cartComment,
    });
    const r = await printProformaReceiptViaAgent(input);
    if (!r.handled || !r.ok) {
      toast.error(t('proforma_failed'));
      return;
    }
    // Chekning o'zi — kassirga «chiqdi» signali; qoralama toast'i parkdan keladi.
    parkCart();
  }, [cart, discountPct, cartLocked, payingSale, session, parkCart, toast, t]);

  // Tiklash — chip bosilganda. Savatda tovar bo'lsa u AVVAL avtomatik
  // qoralamaga olinadi (almashish): kassir hech qachon «tiklasam savatim
  // o'chib ketadimi?» deb o'ylamasin.
  const restoreDraft = useCallback(
    (draftId: string) => {
      if (cartLocked || payingSale != null) return;
      const draft = cartDrafts.find((d) => d.id === draftId);
      if (!draft) return;
      const rest = cartDrafts.filter((d) => d.id !== draftId);
      if (cart.length > 0) {
        rest.push({ id: newDraftId(), createdAt: serverNow().getTime(), discountPct, lines: cart });
      }
      setCartDrafts(rest);
      setCart(draft.lines);
      setDiscountPct(draft.discountPct);
      setDiscountEditing(false);
    },
    [cartDrafts, cart, cartLocked, payingSale, discountPct],
  );

  const deleteDraft = useCallback((draftId: string) => {
    setCartDrafts((prev) => prev.filter((d) => d.id !== draftId));
  }, []);

  // Chipda ko'rinadigan qiymatlar. Summa — SERVER formulasi bilan
  // (`discountedCartTotalMinor`, har qator alohida half-up): chipdagi raqam
  // tiklangandan keyin footerda chiqadigan raqam bilan AYNAN teng bo'lsin.
  //
  // Vaqt (S-reja S3): `createdAt` SERVER soatida yoziladi (`serverNow()`) va
  // `Asia/Tashkent` da chiziladi. Lokal (`bcp47`) — kassirning tili, mintaqa
  // esa QAT'IY: ikkisi boshqa-boshqa qaror.
  const draftChips = useMemo(
    () =>
      cartDrafts.map((d) => ({
        id: d.id,
        timeLabel: new Date(d.createdAt).toLocaleTimeString(bcp47, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: POS_TZ,
        }),
        count: d.lines.length,
        totalMinor: discountedCartTotalMinor(
          d.lines.map((l) => ({
            quantity: l.quantity,
            priceMinor: l.priceMinor,
            discount: d.discountPct,
          })),
        ),
      })),
    [cartDrafts, bcp47],
  );

  /**
   * Savat qatorining narxi — endi FAQAT tahrir oynasi orqali o'zgaradi.
   *
   * 2026-08-11 (egasining jonli sinovi): kassir monoblokda narx maydoniga
   * tegdi va katta oyna ochilishini kutdi — ochilmadi, chunki oyna faqat
   * QATOR NOMIga ulangan edi. Qatordagi 96px input barmoq uchun baribir
   * yaramas edi (F2 muammosining o'zi), ya'ni ikki xil tahrir yo'lini
   * saqlashning ma'nosi yo'q: narx bosilganda ham o'sha oyna ochiladi.
   *
   * Parse shu bilan BITTA joyda qoldi (`parseAmountToMinor`, oynaning ichida).
   * Ilgari bu yerda o'z nusxasi turardi (`Number.parseFloat(...) × 100`) va u
   * to'lov oynasidan uch joyda ayrilardi (o'lchangan): `«12abc»` → 1 200 tiyin,
   * `«.5»` → 50, `«15,000.50»` → 1 500; `× 100` esa QATTIQ scale edi.
   *
   * K-3 shartnomasi o'zgarmadi (oyna qo'llaydi): parse muvaffaqiyatsiz
   * (bo'sh satr, harf) → `0n`, ESKI narx EMAS.
   */
  // ── F2 — savat qatori tahrir oynasi (sensorli monoblok) ───────────────────
  // Oyna savatning O'ZIDA saqlanmaydi: `editingProductId` bo'yicha JONLI
  // topiladi, ya'ni oyna ochiq turganda savat qatori o'zgarsa (masalan
  // zakazdan yuklansa) oyna eski nusxani ko'rsatmaydi. Qator yo'qolsa —
  // `editingLine` `null` bo'ladi va oyna o'zi yopiladi.
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const editingLine = cart.find((l) => l.productId === editingProductId) ?? null;

  const applyLineEdit = useCallback(
    (
      productId: string,
      next: {
        quantity: string;
        priceStr: string;
        priceMinor: bigint;
        /** K3 — kassir kelishgan bo'lak tarkibi (`['150','30']`). */
        pieceLengths?: string[];
      },
    ) => {
      setCart((prev) =>
        prev.map((l) =>
          l.productId === productId
            ? {
                ...l,
                quantity: next.quantity,
                priceStr: next.priceStr,
                priceMinor: next.priceMinor,
                pieceLengths: next.pieceLengths,
              }
            : l,
        ),
      );
      setEditingProductId(null);
    },
    [],
  );

  // Savat darajasidagi chegirma (`discountPct`) har bir pozitsiyaga foiz sifatida
  // yoziladi — shunda backend chegirmali `sumMinor`'ni saqlaydi va chek «Chegirma»
  // qatorini ko'rsata oladi (aks holda chegirma faqat ekranda qolib, yo'qolardi).
  /**
   * CHEK IZOHI (2026-08-19, egasi: «har bir chekka izoh»). Savatga yoziladi va
   * chek yaratilganda `description` bo'lib serverga ketadi — «Sotish»,
   * «Omborchiga yuborish» va «Sotuvsiz chek» yo'llarining UCHALASIDA ham
   * (bittasida unutilsa, kassir yozgan izoh jimgina yo'qolardi).
   * Savat tozalanganda izoh ham tozalanadi.
   */
  const [cartComment, setCartComment] = useState('');
  /** Serverga ketadigan shakl: bo'sh izoh — maydonsiz (null yozilmasin). */
  const commentPatch = () => (cartComment.trim() ? { description: cartComment.trim() } : {});

  const positions = () =>
    cart.map((l) => ({
      productId: l.productId,
      quantity: normalizeQtyDecimal(l.quantity),
      priceMinor: l.priceMinor.toString(),
      discount: discountPct > 0 ? String(discountPct) : '0',
      // K4 — kassirning mijoz bilan kelishgan bo'lak tarkibi («150 + 30»)
      // endi CHEKKA ketadi va omborchining yig'ish topshirig'ida ko'rinadi.
      // K3 da u faqat savatda yashardi (K3 hisobotining «ASOSIY qarz» bandi).
      // Bo'linmagan qatorda yuborilmaydi — server ham 2 tadan kamini
      // saqlamaydi (`formatPieceLengths`).
      ...(l.pieceLengths && l.pieceLengths.length > 1 ? { pieceLengths: l.pieceLengths } : {}),
    }));

  const onSold = (saleId: string) => {
    setPayingSale(null);
    // F8 — zakaz bog'lanishi ham uziladi, aks holda keyingi savat qulflangan
    // qolardi va zakaz ro'yxati eski holatni ko'rsatardi.
    if (payingOrderId) {
      qc.invalidateQueries({ queryKey: ['pos-customer-orders'] });
      qc.invalidateQueries({ queryKey: ['pos-customer-order', payingOrderId] });
    }
    setPayingOrderId(null);
    setCheckoutOpen(false);
    // «Tayyor» chek to'langach savat va chegirma TOZALANADI — aks holda
    // `loadReadyToCart` yuklagan pozitsiyalar savatda qolib, keyingi
    // «Omborchiga yuborish» xuddi shu chekni DUBLIKAT sotuv qilib yaratardi
    // (solishtir: `sendToPickingMut.onSuccess` ham shunday tozalaydi).
    setCart([]);
    setDiscountPct(0);
    setCartComment('');
    qc.invalidateQueries({ queryKey: ['cashier-session-current'] });
    qc.invalidateQueries({ queryKey: ['products-sotuv'] });
    qc.invalidateQueries({ queryKey: ['retail-sales-session', session.id] });
    qc.invalidateQueries({ queryKey: ['retail-sales-ready', session.id] });
    qc.invalidateQueries({ queryKey: ['retail-sales-picking', session.id] });
    // F5 — to'langan chek yakunlanmagan-ro'yxatdan chiqadi (smena ekrani).
    qc.invalidateQueries({ queryKey: ['cashier-session-unresolved', session.id] });
    toast.success(t('success_sold'));
    void printCustomerReceipt(saleId);
  };

  // Print the customer receipt straight to the configured receipt printer via
  // the local agent (one action, correct thermal size — like the omborchi
  // sheet). Falls back to the browser popup when the agent/printer isn't set up.
  const printCustomerReceipt = useCallback(
    async (saleId: string) => {
      const outcome = await printReceiptViaAgent(saleId);
      await finishPrint(outcome, { url: `/print/retail-sale/${saleId}?auto=1` });
    },
    [finishPrint],
  );

  // Qarz to'lovi cheki — tovar cheki bilan AYNI yo'l (2026-08-16, egasi):
  // qobiq/agent tirik bo'lsa to'lov tasdiqlanishi bilan OYNASIZ chop etiladi.
  // Ilgari bu yerda `window.open('/print/debt-payment/…?auto=1')` turardi va
  // kassa.exe'da chek alohida oynada EKRANGA chiqardi.
  const printDebtReceipt = useCallback(
    async (batchId: string) => {
      const outcome = await printDebtReceiptViaAgent(batchId);
      await finishPrint(outcome, { url: `/print/debt-payment/${batchId}?auto=1` });
    },
    [finishPrint],
  );

  // When omborchi marks a sale "Tayyor", the kassir pulls it into the cart:
  // its positions load into the Savat view (read-only echo) and the payment
  // sheet opens against that existing ready sale.
  const loadReadyToCart = useCallback(
    async (saleId: string) => {
      try {
        const d = await api.get<SaleDetail>(`/retail-sales/${saleId}`);
        setCart(
          d.positions.map((p) => {
            const live = cardPrices(
              p.product.buyPrice,
              p.product.buyPriceCurrency,
              p.product.salePrices,
            );
            return {
              productId: p.product.id,
              productName: p.product.name,
              // Miqdor SATR bo'lib qoladi — `Number(...)` qilib qaytib
              // `BigInt(...)` ga berish aynan RangeError yo'li edi.
              quantity: normalizeQtyDecimal(String(p.quantity)),
              priceMinor: BigInt(p.priceMinor),
              priceStr: (Number(p.priceMinor) / 100).toString(),
              availableStock: undefined,
              // A ready receipt is not posted yet, so its own snapshot is still
              // NULL — fall back to the live card. Once a receipt IS posted the
              // frozen value wins, so re-opening it never re-prices history.
              costMinor: toMinorOrNull(p.costMinor) ?? live.costMinor,
              basePriceMinor: toMinorOrNull(p.basePriceMinor) ?? live.basePriceMinor,
              wholesaleMinor: live.wholesaleMinor,
              // Dollarda kelgan tovarning asl tannarxi — «$… ≈ …» ko'rinishi
              // uchun kartochkadan (muzlatilgan costMinor bunga ta'sir qilmaydi).
              costCurrency: live.costCurrency,
              costOriginalMinor: live.costOriginalMinor,
            };
          }),
        );
        // Saqlangan chegirmani TIKLAYMIZ. Aks holda savat chekni yolg'on
        // ko'rsatadi: qatorlar chegirmasiz narxda qayta yuklanadi-yu, chek esa
        // chegirmali summaga to'lanadi. Brauzer-QA da (2026-08-02) aynan shu
        // ko'rindi — savat «29 000», to'lov oynasi «26 100», va savat foydasi
        // «+4 200» deganda hisobot to'g'ri «+1 300» derdi. Kassir pul olayotgan
        // ondagi foyda raqami noto'g'ri bo'lishi mumkin emas.
        // Savat chegirmasi hamma qatorga BIR XIL foiz sifatida yoziladi
        // (`positions()` shunday yuboradi), shuning uchun qatorlar bir xil
        // bo'lsagina tiklanadi; aralash bo'lsa 0 qoladi va jami — sotuvning
        // o'z `sumMinor`i orqali baribir to'g'ri chiqadi.
        const discounts = new Set(d.positions.map((p) => String(p.discount ?? '0')));
        const uniform = discounts.size === 1 ? Number([...discounts][0]) : Number.NaN;
        setDiscountPct(Number.isFinite(uniform) && uniform > 0 ? uniform : 0);
        setPayingSale({ id: d.id, sumMinor: BigInt(d.sumMinor) });
        setMode('sotuv');
        setCheckoutOpen(true);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('load_error'));
      }
    },
    [toast, cardPrices, t],
  );

  /**
   * F8 — ZAKAZNI TO'LASH: zakaz → savat → chek (`customerOrderId` bilan) →
   * mavjud to'lov oynasi.
   *
   * Nega chek DARHOL yaratiladi (`send-to-picking` orqali EMAS):
   * `send-to-picking` omborga yig'ish varaqasini chiqaradi va ombor
   * qoldig'iga UMUMAN tegmaydi (`retail-sale.service.sendToPicking` —
   * faqat holat flipi + `RestockTask`). Zakaz esa allaqachon tasdiqlangan va
   * REZERV QILINGAN — tovar band. Ya'ni yig'ish zanjiri bu yerda ikkinchi
   * marta bajariladigan ish bo'lardi. Chek — tovar chiqimi hujjati, va
   * `post()` rezervni o'sha tranzaksiyada yutadi.
   *
   * Chek `draft` holatida yaratiladi va darhol to'lanadi: `post()` FSM'i
   * `draft` dan to'lovni ALLAQACHON qabul qiladi (`allowedFrom('post')`).
   */
  const payOrderMut = useMutation({
    mutationFn: async (order: OrderDetail) => {
      const lines = order.positions.filter((p) => p.product != null);
      if (lines.length === 0) throw new Error(t('orders_pay_no_positions'));
      const sale = await api.post<{ id: string; sumMinor?: string }>('/retail-sales', {
        sessionId: session.id,
        // Mijoz chekka tushadi — qarz/loyalty aynan shu maydondan o'qiydi.
        ...(order.agent ? { agentId: order.agent.id } : {}),
        customerOrderId: order.id,
        positions: lines.map((p) => ({
          // biome-ignore lint/style/noNonNullAssertion: filtered above
          productId: p.product!.id,
          quantity: normalizeQtyDecimal(p.quantity),
          priceMinor: String(p.priceMinor),
          discount: String(p.discount ?? '0'),
        })),
      });
      // Summa SERVERNIKI, zakazniki emas: `post()` `expectedSumMinor` ni
      // chek `sumMinor`i bilan QAT'IY solishtiradi va farq bo'lsa 409 beradi.
      // Server qator-ba-qator yaxlitlaydi — zakaz jamisi bir tiyinga
      // ayrilishi mumkin (aynan shu faza tuzatgan chegirma farqi klassi).
      return { saleId: sale.id, sumMinor: sale.sumMinor ?? order.sumMinor, order, lines };
    },
    onSuccess: ({ saleId, sumMinor, order, lines }) => {
      setCart(
        lines.map((p) => ({
          // biome-ignore lint/style/noNonNullAssertion: filtered above
          productId: p.product!.id,
          // biome-ignore lint/style/noNonNullAssertion: filtered above
          productName: p.product!.name,
          quantity: normalizeQtyDecimal(p.quantity),
          priceMinor: BigInt(p.priceMinor),
          priceStr: (Number(p.priceMinor) / 100).toString(),
          availableStock: undefined,
          // Zakaz pozitsiyasi tovar kartochkasining narx qatlamlarini OLIB
          // KELMAYDI (`/customer-orders/:id` faqat id/nom/kod/uom qaytaradi).
          // NULL — «yig'ilmagan», 0 EMAS: savat «—» ko'rsatadi va foyda
          // hisoblanmaydi. Nolni tan narx deb sanash 100% marja yolg'oni
          // bo'lardi (kassa TZ §5.3).
          costMinor: null,
          wholesaleMinor: null,
          basePriceMinor: null,
        })),
      );
      // Chegirma qator darajasida allaqachon zakazdan ketdi — savat
      // darajasidagi foizni QAYTA qo'llash uni ikki marta hisoblardi.
      setDiscountPct(0);
      setPayingOrderId(order.id);
      setPayingSale({ id: saleId, sumMinor: BigInt(sumMinor) });
      setSelectedOrderId(null);
      setMode('sotuv');
      setCheckoutOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * P3 — TO'G'RIDAN-TO'G'RI SOTISH (yig'ishsiz). Egasi qarori, 2026-08-12.
   *
   * MUAMMO (o'lchangan): savatning YAGONA tugmasi «Omborchiga yuborish» edi,
   * ya'ni har sotuv omborchi zanjiridan o'tishi SHART edi. Prodda esa
   * `sklad_keepers` = 0 qator — yig'ish topshirig'i umuman yaratilmasdi va
   * chek «Jarayonda» da qolardi. Kichik xarid (bitta rozetka) uchun ham
   * omborchi kutish real savdoni to'xtatadi.
   *
   * Chek `draft` da yaratiladi va DARHOL to'lov oynasi ochiladi: `post()`
   * FSM'i `draft` dan to'lovni allaqachon qabul qiladi (`allowedFrom('post')`),
   * `send-to-picking` esa CHETLAB o'tiladi — ya'ni na yig'ish varaqasi, na
   * rezerv yozuvi (tovar shu ondayoq `post()` da qoldiqdan chiqadi, oraliq
   * hold ma'nosiz bo'lardi).
   *
   * Savat ATAYLAB TOZALANMAYDI: to'lov oynasi bekor qilinsa kassir savatini
   * yo'qotmasligi kerak. Tozalash `onSold` da — chek rostdan to'langanda.
   */
  const directSellMut = useMutation({
    mutationFn: async () => {
      const draft = await api.post<{ id: string; sumMinor?: string }>('/retail-sales', {
        sessionId: session.id,
        positions: positions(),
        ...commentPatch(),
      });
      // Summa SERVERNIKI: `post()` `expectedSumMinor` ni chek `sumMinor`i
      // bilan QAT'IY solishtiradi va farq bo'lsa 409 beradi. Server qator-
      // ba-qator yaxlitlaydi, ya'ni ekrandagi jami bir tiyinga ayrilishi
      // mumkin (F8 yo'lida aynan shu klass tuzatilgan).
      //
      // `?? '0'` bilan yumshatib bo'LMAYDI: 0 summa to'lov oynasini bo'sh
      // chek bilan ochib, keyin 409 berardi — kassir sababini tushunmasdi.
      if (draft.sumMinor == null) throw new Error(t('load_error'));
      return { id: draft.id, sumMinor: BigInt(draft.sumMinor) };
    },
    onSuccess: (draft) => {
      setPayingSale(draft);
      setCheckoutOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Step 1: "Rasmilashtirish" → create draft → send to picking → print picking sheet
  const sendToPickingMut = useMutation({
    mutationFn: async () => {
      const draft = await api.post<{ id: string }>('/retail-sales', {
        sessionId: session.id,
        positions: positions(),
        ...commentPatch(),
      });
      await api.post(`/retail-sales/${draft.id}/send-to-picking`, {});
      return draft.id;
    },
    onSuccess: async (saleId) => {
      setCart([]);
      setDiscountPct(0);
      setDiscountEditing(false);
      setCartComment('');
      qc.invalidateQueries({ queryKey: ['retail-sales-ready', session.id] });
      qc.invalidateQueries({ queryKey: ['retail-sales-picking', session.id] });
      toast.success(t('sent_to_picker'));
      // Per-warehouse routing via the local print-agent: each sklad's sheet goes
      // to its own mapped printer (Settings → Sklad-keepers). Biriktirilmagan
      // ombor (va yacheykasiz guruh) qurilmaning Windows SUKUT printeriga
      // chiqadi — sozlash qadami majburiy emas (2026-08-16, prod nosozligi).
      // Brauzer-zaxira faqat chop qatlami umuman bo'lmasa ishlaydi.
      const outcome = await printPickingViaAgent(saleId);
      if (outcome.handled) {
        if (outcome.printed > 0) {
          toast.success(
            t('print_ok_count', { printers: outcome.printed }) +
              (outcome.skipped > 0 ? ` ${t('print_skipped_count', { n: outcome.skipped })}` : ''),
          );
        }
        if (outcome.errors > 0) toast.error(t('print_error_count', { n: outcome.errors }));
      } else {
        // Yacheykali chek — chek bilan ayni qaror: qobiqda popup OCHILMAYDI
        // (u ayni so'rovni qaytaradi ⇒ ayni xato), kassir sababni toastdan
        // ko'radi; oddiy brauzerda esa popup yagona chop yo'li.
        await finishPrint(
          { handled: false, ok: false, reason: outcome.reason },
          {
            url: `/print/picking/${saleId}?source=retailsale&auto=1`,
            features: 'width=520,height=800,noopener',
          },
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Yig'ilayotgan / yig'ilgan chekni bekor qilish (mijoz ketib qolsa).
  // Backend `cancel` 2026-08-02 dan `picking`/`ready` ni ham qabul qiladi va
  // omborchining ochiq yig'ish topshiriqlarini yopadi — usiz bunday chek na
  // to'lanardi, na bekor qilinardi (abadiy osilib qolardi).
  // F4: tasdiq matnida chek raqami BILAN summa ko'rinadi (spec §5.2 —
  // kassir qaysi chekni qancha pulga o'chirayotganini ko'rib tursin);
  // tasdiq tugmasi kartadagi «Bekor qilish»dan farqli nomlanadi (dialogda
  // ikki bir xil yozuvli tugma kassirni adashtirardi).
  const cancelSale = useCallback(
    async (saleId: string, saleName: string, sumMinor: string) => {
      const ok = await runDestructive({
        title: t('cancel_sale_confirm', {
          name: saleName,
          sum: formatMoney(BigInt(sumMinor)),
        }),
        confirmLabel: t('cancel_sale_confirm_label'),
        successMessage: t('cancel_sale_success'),
        run: () => api.post(`/retail-sales/${saleId}/cancel`, {}),
      });
      if (ok) {
        qc.invalidateQueries({ queryKey: ['retail-sales-ready', session.id] });
        qc.invalidateQueries({ queryKey: ['retail-sales-picking', session.id] });
        // F5 — bekor qilingan chek yakunlanmagan-ro'yxatdan ham chiqadi.
        qc.invalidateQueries({ queryKey: ['cashier-session-unresolved', session.id] });
      }
    },
    [runDestructive, qc, session.id, t],
  );

  /**
   * «Jarayonda» dagi chekni kassirning O'ZI tasdiqlashi (`picking → ready`).
   *
   * NEGA KERAK (egasi, 2026-08-11): bu o'tishni faqat omborchi qilardi. Omborchi
   * belgilamasa — masalan tovarni qo'lma-qo'l berib yuborsa yoki ombor terminali
   * band bo'lsa — chek «Jarayonda» da abadiy osilib qolardi: to'lash mumkin
   * emas (to'lov faqat `ready` dan), bekor qilishdan boshqa yo'l yo'q edi.
   *
   * `runDestructive` ATAYLAB ishlatilmadi — u qizil «o'chirish» ohangini
   * majburlaydi va bu ijobiy amal. Lekin tasdiqsiz ham qo'yilmadi: «Bekor
   * qilish» tugmasi yonida turadi va noto'g'ri bosilsa kassir yig'ilmagan
   * tovarga pul olib qo'yardi.
   */
  const markReady = useCallback(
    async (saleId: string, saleName: string) => {
      const ok = await confirm({
        title: t('mark_ready_confirm', { name: saleName }),
        description: t('mark_ready_hint'),
        confirmLabel: t('mark_ready'),
        cancelLabel: tCommon('cancel'),
      });
      if (!ok) return;
      try {
        await api.post(`/retail-sales/${saleId}/mark-ready`, {});
        toast.success(t('mark_ready_success'));
        qc.invalidateQueries({ queryKey: ['retail-sales-ready', session.id] });
        qc.invalidateQueries({ queryKey: ['retail-sales-picking', session.id] });
      } catch (e) {
        // Server rad etsa (masalan omborchi allaqachon holatni o'zgartirgan)
        // xabar KASSIRGA ko'rinsin — jim yutilsa tugma «ishlamayapti» bo'lardi.
        toast.error(e instanceof Error ? e.message : t('mark_ready_error'));
      }
    },
    [confirm, toast, qc, session.id, t, tCommon],
  );

  // Step 2: Pay a ready sale (after omborchi marks tayyor)
  const payReadySaleMut = useMutation({
    mutationFn: async (payment: {
      cashAmountMinor: bigint;
      cardAmountMinor: bigint;
      terminalAmountMinor: bigint;
      /** Hisob raqamidan (bank o'tkazmasi) — yashiqqa tushmaydi. */
      accountAmountMinor: bigint;
      debtAmountMinor: bigint;
      cashUsdAmountMinor: bigint;
      /** A2 — mijozning avansidan qoplanadigan ulush. */
      prepayAmountMinor: bigint;
      usdRateMinor: string | null;
      agentId?: string;
    }) => {
      if (!payingSale) throw new Error(t('no_sale_selected'));
      await api.post(`/retail-sales/${payingSale.id}/post`, {
        cashAmountMinor: payment.cashAmountMinor.toString(),
        cardAmountMinor: payment.cardAmountMinor.toString(),
        terminalAmountMinor: payment.terminalAmountMinor.toString(),
        debtAmountMinor: payment.debtAmountMinor.toString(),
        // Hisob raqamidan — FAQAT noldan katta bo'lganda qo'shiladi (sxemada
        // `.default('0')`, eski payload shakli o'zgarmaydi — avans bilan AYNI).
        ...(payment.accountAmountMinor > 0n
          ? { accountAmountMinor: payment.accountAmountMinor.toString() }
          : {}),
        // A2 — avans ulushi FAQAT noldan katta bo'lganda qo'shiladi. Sxemada
        // `.default('0')`, ya'ni payload shakli eski klientlar uchun
        // o'zgarmaydi (dollar maydonlaridagi bilan AYNI qaror).
        ...(payment.prepayAmountMinor > 0n
          ? { prepayAmountMinor: payment.prepayAmountMinor.toString() }
          : {}),
        // MK31 — dollar naqd SENTDA, kurs esa KANONIK ×10^8 satr (oynada
        // serverdan olingan, qayta hisoblanmagan). Ikkalasi FAQAT dollar
        // berilganda qo'shiladi: sxemada ikkisi ham `.default('0')` /
        // `optional`, ya'ni eski payload shakli buzilmaydi.
        ...(payment.cashUsdAmountMinor > 0n && payment.usdRateMinor
          ? {
              cashUsdAmountMinor: payment.cashUsdAmountMinor.toString(),
              usdRateMinor: payment.usdRateMinor,
            }
          : {}),
        expectedSumMinor: payingSale.sumMinor.toString(),
        ...(payment.agentId ? { agentId: payment.agentId } : {}),
      });
      return payingSale.id;
    },
    onSuccess: (saleId) => onSold(saleId),
    onError: (e: Error) => toast.error(e.message),
  });

  const drawerMut = useMutation({
    mutationFn: () => {
      if (!(Number(drawerAmount) > 0)) throw new Error(t('amount_must_be_positive'));
      const sumMinor = Money.fromMajor(drawerAmount, tillCurrency).toMinor().toString();
      const path = drawerMode === 'in' ? 'drawer-in' : 'drawer-out';
      return api.post(`/cashier-sessions/${session.id}/${path}`, {
        sumMinor,
        description: drawerComment.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashier-session-current'] });
      setDrawerMode(null);
      setDrawerAmount('');
      setDrawerComment('');
      toast.success(drawerMode === 'in' ? t('drawer_in_done') : t('drawer_out_done'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Kutilgan naqd — smena yopilishidan OLDIN.
   *
   * Server ham hisoblaydi (yagona haqiqat), lekin kassir tasdiqlashdan
   * oldin raqamni ko'rishi kerak: farqni faqat menejer ertaga ko'rsa,
   * sababini hech kim eslamaydi.
   */
  /**
   * BITTA so'rov ikki iste'molchiga: yopish formasi preview'i va smena
   * kartasidagi «Qarz to'lovlari (naqd)» qatori. Ikki alohida `queryKey`
   * bir xil endpointni ikki marta chaqirardi.
   *
   * 🔴 Egasi, 2026-08-19 (chek №EA8E779A): kassir qabul qilgan naqd qarz
   * puli ekranda HECH QAYERDA ko'rinmasdi — smena bo'yicha faqat «Sotuvlar»
   * summasi turardi. Endi karta `cashBreakdown.debtCashMinor` ni chizadi.
   *
   * Kutilgan naqd JAMISI kartaga BERILMAYDI: yopish sanog'i ataylab YOPIQ
   * (F5/Q7) — kassir sanoqdan oldin kutilgan raqamni ko'rsa, sanoqni unga
   * moslab yozardi. Jami faqat `review` bosqichida chiqadi.
   */
  const { data: closePreview } = useQuery<{
    expectedCashMinor: string;
    expectedUsdCashMinor: string;
    cashBreakdown?: { debtCashMinor: string };
  }>({
    queryKey: ['z-report-preview', session.id],
    queryFn: () => api.get(`/cashier-sessions/${session.id}/z-report`),
    enabled: showCloseForm || mode === 'smena',
  });
  // `cashBreakdown?` ATAYLAB ixtiyoriy: deploy oralig'ida yangi ekran eski
  // API'ga tushishi mumkin — maydonsiz javobda `BigInt(undefined)` butun
  // kassa sahifasini oq ekranga aylantirardi. Yo'q bo'lsa qator chizilmaydi.
  const debtCashMinor = closePreview?.cashBreakdown
    ? BigInt(closePreview.cashBreakdown.debtCashMinor)
    : null;
  const expectedCash = closePreview ? BigInt(closePreview.expectedCashMinor) : null;
  // Sanoq XAVFSIZ parse qilinadi: `type="number"` inputi `e` harfini
  // o'tkazadi («5e3») va `Money.fromMajor` render tanasida otilib butun
  // sahifani yiqitardi. `parseAmountToMinor` buzuq kiritmani 0n deb qaytaradi
  // — kassir farq qatorida darhol ko'radi, crash o'rniga.
  const countedCash =
    closingCash.trim() === '' ? null : parseAmountToMinor(closingCash, tillCurrency);
  const closeVariance =
    expectedCash === null || countedCash === null ? null : countedCash - expectedCash;

  // Dollar maydoni FAQAT smenada dollar oqimi bo'lganda ko'rinadi: dollarsiz
  // kassada u har yopishda ortiqcha savol bo'lardi va kassir uni e'tiborsiz
  // qoldirishga o'rganib qolardi (izoh maydoni bilan bir xil qoida).
  // Oqim bo'lsa server sanoqni MAJBURIY qiladi — maydonsiz yopib bo'lmaydi.
  const expectedCashUsd = closePreview ? BigInt(closePreview.expectedUsdCashMinor) : null;
  const usdInPlay = expectedCashUsd !== null && expectedCashUsd !== 0n;
  // Yuqoridagi so'm sanog'i bilan bir xil sabab: buzuq kiritma → 0n, crash emas.
  const countedCashUsd =
    closingCashUsd.trim() === '' ? null : parseAmountToMinor(closingCashUsd, 'USD');
  const closeVarianceUsd =
    expectedCashUsd === null || countedCashUsd === null ? null : countedCashUsd - expectedCashUsd;

  const closeMut = useMutation({
    mutationFn: () =>
      api.post(`/cashier-sessions/${session.id}/close`, {
        // Ekranda farq qanday sanoqdan hisoblangan bo'lsa, serverga ham AYNAN
        // o'sha qiymat ketadi (bo'sh maydon avvalgidek 0 deb yuboriladi).
        closingCashMinor: (countedCash ?? 0n).toString(),
        // Sanalmagan dollar UZATILMAYDI (0 emas): `null` va `0` server
        // uchun boshqa-boshqa ma'no — «sanalmagan» va «sanadim, yo'q».
        ...(countedCashUsd !== null ? { closingCashUsdMinor: countedCashUsd.toString() } : {}),
        // Farq bo'lsa akt yoziladi va izoh o'sha aktga tushadi (TZ §8.4).
        // Kassir sababni ayni damda yozadi — ertaga eslay olmaydi.
        varianceNote: varianceNote.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashier-session-current'] });
      toast.success(
        closeVariance === null || closeVariance === 0n
          ? t('shift_closed')
          : t('shift_closed_with_variance'),
      );
      setVarianceNote('');
      setClosingCashUsd('');
      // Yopilgan smenaning id'si — Z-hisobot chop tugmasi uchun. Ekran shu
      // zahoti «smena ochish» formasiga qaytadi, id esa yuqorida saqlanadi.
      onShiftClosed(session.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--ms-bg-app)]">
      {/* F2 — 64px ko'k header (spec §3.1). O'ng slotda CFD tugmasi (spec
          §5.1: boshqaruv header'da qoladi); F6 oyna-tugmalari ham shu slotga
          qo'shiladi. Eski CFD-satr va tab-bar o'chirildi (sidebar almashtirdi). */}
      <PosHeader session={session} shiftAge={shiftAge} connectionOk={connectionOk}>
        <button
          type="button"
          onClick={toggleCfd}
          data-test-id="pos-cfd-toggle"
          title={t('cfd_title')}
          className={`flex h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-3 font-semibold text-sm transition-colors ${
            cfdOpen
              ? 'bg-emerald-500 text-white hover:bg-emerald-600'
              : 'bg-white/15 text-[var(--pos-on-brand)] hover:bg-white/25'
          }`}
        >
          {cfdOpen ? `🟢 ${t('cfd_on')}` : `📺 ${t('cfd_off')}`}
        </button>
      </PosHeader>

      <div className="flex min-h-0 flex-1">
        <PosSidebar
          mode={mode}
          onModeChange={setMode}
          badges={{ savat: cartCount, navbat: pickingSales.length + readySales.length }}
          canSeeOrders={canSeeOrders}
          canRefund={canRefund}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
        />

        {/* Ish maydoni — tanlangan rejim TO'LIQ enda (spec Q2). Rejim ichlari
            hali eski ko'rinishda — F3–F5 yangilaydi. */}
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* ── SOTUV ── setka + savat (savat endi doimiy panel, tab emas) ── */}
          {mode === 'sotuv' && (
            <>
              <SotuvSearchGrid
                session={session}
                shiftAge={shiftAge}
                search={search}
                setSearch={setSearch}
                searchRef={searchRef}
                products={products}
                isLoading={isLoading}
                searchSettled={searchSettled}
                onSearchEnter={onSearchEnter}
                addToCart={addToCart}
              />
              <div
                data-test-id="pos-savat-panel"
                className="flex w-[600px] shrink-0 flex-col overflow-hidden border-[var(--ms-border)] border-l bg-[var(--ms-bg-surface)]"
              >
                <SavatPanel
                  cart={cart}
                  cartLocked={cartLocked}
                  canPark={cart.length > 0 && !cartLocked && payingSale == null}
                  onPark={parkCart}
                  drafts={draftChips}
                  draftsLocked={cartLocked || payingSale != null}
                  onRestoreDraft={restoreDraft}
                  onDeleteDraft={deleteDraft}
                  cartComment={cartComment}
                  setCartComment={setCartComment}
                  onClearCart={() => {
                    setCart([]);
                    setCartComment('');
                    // F8 — savatni tozalash zakaz/chek bog'lanishini ham uzadi:
                    // aks holda bo'sh-u QULFLANGAN savat qolib, kassir undan
                    // chiqolmasdi.
                    setPayingOrderId(null);
                    setPayingSale(null);
                  }}
                  onRemoveLine={removeFromCart}
                  setEditingProductId={setEditingProductId}
                  flashProductId={cartFlash?.productId ?? null}
                  discountPct={discountPct}
                  setDiscountPct={setDiscountPct}
                  discountEditing={discountEditing}
                  setDiscountEditing={setDiscountEditing}
                  cartCount={cartCount}
                  cartTotal={cartTotal}
                  discountedTotal={discountedTotal}
                  cartProfitMinor={cartProfitMinor}
                  cartMarginPct={cartMarginPct}
                  directSellPending={directSellMut.isPending}
                  onDirectSell={() => directSellMut.mutate()}
                  sendToPickingPending={sendToPickingMut.isPending}
                  onSendToPicking={() => sendToPickingMut.mutate()}
                  onPrintProforma={
                    cartLocked || payingSale != null ? null : () => void printProforma()
                  }
                />
              </div>
            </>
          )}

          {/* ── NAVBAT ── ikki ustunli kanban (F4): Yig'ilmoqda · Tayyor ── */}
          {mode === 'navbat' && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--ms-bg-app)]">
              <NavbatMode
                pickingSales={pickingSales}
                readySales={readySales}
                cancelSale={cancelSale}
                markReady={markReady}
                loadReadyToCart={loadReadyToCart}
              />
            </div>
          )}

          {/* ── ZAKAZLAR ── jarayondagi mijoz zakazlari ── */}
          {mode === 'zakazlar' && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--ms-bg-surface)]">
              <ZakazlarMode
                orders={orders}
                orderState={orderState}
                setOrderState={setOrderState}
                selectedOrderId={selectedOrderId}
                setSelectedOrderId={setSelectedOrderId}
                onPay={(order) => payOrderMut.mutate(order)}
                paying={payOrderMut.isPending}
              />
            </div>
          )}

          {/* ── CHEKLAR ── */}
          {mode === 'cheklar' && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--ms-bg-surface)]">
              <CheklarMode
                cheklar={cheklar}
                chekSearch={chekSearch}
                setChekSearch={setChekSearch}
                selectedChekId={selectedChekId}
                setSelectedChekId={setSelectedChekId}
                onCopyToCart={copyChekToCart}
              />
            </div>
          )}

          {/* ── VOZVRAT (V2) ── chekni tovar/mijoz bo'yicha topib qaytarish;
              yon panelda `canRefund` bilan yashiringan, rejim o'z so'rovlarini
              o'zi olib yuradi (CustomersPanel naqshi). */}
          {mode === 'vozvrat' && (
            <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-[var(--ms-bg-surface)]">
              <VozvratMode onCopyToCart={copyChekToCart} />
            </div>
          )}

          {/* ── MIJOZLAR (F7) ── panel faqat yo'naltiradi: uch callback
              mavjud modal/panellarga ulanadi, pul amali panelda YO'Q. */}
          {mode === 'mijozlar' && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--ms-bg-surface)]">
              <CustomersPanel
                currency={tillCurrency}
                sessionId={session.id}
                onOpenCustomerCard={(cp) => {
                  // F7-tuzatish: karta tanlangan mijoz bilan ochiladi (qidiruvsiz).
                  setCustomerCardAgent(cp);
                  setCustomerCardOpen(true);
                }}
                onPayDebt={(cp) => {
                  setDebtPayAgent(cp);
                  setDebtPayOpen(true);
                }}
                onOpenChek={(saleId) => {
                  // Mavjud ChekDetailPanel «Cheklar» rejimida yashaydi — o'sha
                  // yerga o'tamiz; F6 qaytarish oqimi o'z joyida ishlayveradi.
                  setSelectedChekId(saleId);
                  setMode('cheklar');
                }}
              />
            </div>
          )}

          {/* ── SMENA ── */}
          {mode === 'smena' && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--ms-bg-surface)]">
              <SmenaMode
                session={session}
                debtCashMinor={debtCashMinor}
                printZReport={printZReport}
                drawerMode={drawerMode}
                setDrawerMode={setDrawerMode}
                drawerAmount={drawerAmount}
                setDrawerAmount={setDrawerAmount}
                drawerComment={drawerComment}
                setDrawerComment={setDrawerComment}
                drawerPending={drawerMut.isPending}
                onDrawerSubmit={() => drawerMut.mutate()}
                onOpenCustomerCard={() => {
                  // Bu yerda mijoz hali tanlanmagan — qidiruvdan boshlanadi.
                  setCustomerCardAgent(null);
                  setCustomerCardOpen(true);
                }}
                onOpenDebtPay={() => {
                  setDebtPayAgent(null);
                  setDebtPayOpen(true);
                }}
                onOpenCashOut={() => setCashOutOpen(true)}
                unresolvedSales={unresolvedSales}
                onPayUnresolved={loadReadyToCart}
                cancelSale={cancelSale}
                showCloseForm={showCloseForm}
                setShowCloseForm={setShowCloseForm}
                closingCash={closingCash}
                setClosingCash={setClosingCash}
                closingCashUsd={closingCashUsd}
                setClosingCashUsd={setClosingCashUsd}
                usdInPlay={usdInPlay}
                expectedCash={expectedCash}
                closeVariance={closeVariance}
                expectedCashUsd={expectedCashUsd}
                closeVarianceUsd={closeVarianceUsd}
                countedCash={countedCash}
                countedCashUsd={countedCashUsd}
                varianceNote={varianceNote}
                setVarianceNote={setVarianceNote}
                closePending={closeMut.isPending}
                onCloseShift={() => closeMut.mutate()}
              />
            </div>
          )}
        </main>
      </div>

      {/* K06 versiya-belgisi endi PosHeader ichida (F9, spec §3.1) —
          suzuvchi nusxa olib tashlandi, dublikat bo'lmasin. */}
      <CashOutDialog
        open={cashOutOpen}
        onOpenChange={setCashOutOpen}
        sessionId={session.id}
        currency={tillCurrency}
        onDone={(doc) => {
          // `CASH_OVERDRAWN` — yashiqda yo'q pul chiqarildi. Server to'xtatmaydi
          // (Q10), lekin kassir buni BILISHI kerak: aks holda farq faqat smena
          // yopilganda chiqib, sababi unutilgan bo'lardi.
          if (doc.auditTypes.includes('CASH_OVERDRAWN')) {
            toast.error(t('cash_overdrawn_warning'));
          } else {
            toast.success(t('document_created', { name: doc.name }));
          }
          window.open(`/print/cash-out/${doc.id}?auto=1`, '_blank');
        }}
      />

      {/* F9 — mijoz kartasi. Butun mantiq alohida faylda; bu yerda faqat
          uch callback: qarz oynasini shu mijoz bilan ochish, zakazlar
          tabiga o'tish, chekni qayta chop etish. */}
      <CustomerCardPanel
        open={customerCardOpen}
        onOpenChange={setCustomerCardOpen}
        currency={tillCurrency}
        initialAgent={customerCardAgent}
        onPayDebt={(cp) => {
          setCustomerCardOpen(false);
          setDebtPayAgent(cp);
          setDebtPayOpen(true);
        }}
        onOpenOrder={(orderId) => {
          setCustomerCardOpen(false);
          setSelectedOrderId(orderId);
          setMode('zakazlar');
        }}
        onReprintReceipt={(saleId) => {
          setCustomerCardOpen(false);
          void printCustomerReceipt(saleId);
        }}
      />

      <DebtPaymentDialog
        open={debtPayOpen}
        onOpenChange={setDebtPayOpen}
        sessionId={session.id}
        cashDeskId={session.cashDesk?.id ?? null}
        currency={tillCurrency}
        initialAgent={debtPayAgent}
        onPaid={(result) => {
          toast.success(
            result.closedCount > 0
              ? t('debt_paid_with_closed', { n: result.closedCount })
              : t('debt_paid'),
          );
          // Qarz cheki — kassa TZ §7.2/5-qadam. Tovar cheki bilan AYNI yo'l:
          // jim chop, zaxira-popup faqat qobiq/agent o'lik bo'lsa (2026-08-16).
          void printDebtReceipt(result.batchId);
        }}
      />

      <RasmiyashtirishModal
        open={checkoutOpen}
        onOpenChange={(o) => {
          setCheckoutOpen(o);
          if (!o) {
            setPayingSale(null);
            setPayingOrderId(null);
          }
        }}
        sumMinor={payingSale ? payingSale.sumMinor : discountedTotal}
        currency={tillCurrency}
        onConfirm={(p) => payReadySaleMut.mutate(p)}
        loading={payReadySaleMut.isPending}
      />

      {/* F2 — savat qatorining katta tahrir oynasi (sensorli monoblok).
          `readOnly` zakaz qulfini takrorlaydi: qulf faqat qator ichidagi
          tugmalarda qolsa, oyna uni chetlab o'tadigan ikkinchi yo'l bo'lardi. */}
      <CartLineEditModal
        line={editingLine}
        currency={tillCurrency}
        readOnly={cartLocked}
        onClose={() => setEditingProductId(null)}
        onSave={(next) => {
          if (editingLine) applyLineEdit(editingLine.productId, next);
        }}
        onRemove={() => {
          if (editingLine) removeFromCart(editingLine.productId);
          setEditingProductId(null);
        }}
      />
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function SotuvPage() {
  const t = useTranslations('pages.sotuv');
  const tCommon = useTranslations('common');
  const { user } = useAuth();

  const { data: session, isLoading } = useQuery<CurrentSession | null>({
    queryKey: ['cashier-session-current'],
    queryFn: () => api.get<CurrentSession | null>('/cashier-sessions/current'),
    enabled: !!user,
  });

  // DIQQAT: hook erta `return`dan YUQORIDA — pastga qo'yilsa React #310
  // («Rendered more hooks…») butun sahifani yiqitadi (2026-08-01 saboqi).
  const { ref: shellRef, height: shellHeight, remeasure } = useFillViewport<HTMLDivElement>();
  // F2 da o'lchandi: birinchi mount'da sahifa hali «loading» bo'lib, `ref`
  // bog'lanmagan — o'lchov ishlamay balandlik `100dvh` fallback'da qolardi
  // (qobiq navbar+subnav bo'yi ~99px oshib, sidebar'ning pastki «Smena»
  // tugmasi fold ostida yashirinardi). Sessiya kelib qobiq chizilgach qayta
  // o'lchaymiz. Hook ham erta `return`dan YUQORIDA (React #310).
  useEffect(() => {
    if (session) remeasure();
  }, [session, remeasure]);
  // F11 — yopilgan smenaning Z-hisobotini chop etish yo'li. Holat AYNAN shu
  // yerda turadi: `SalesScreen` smena yopilishi bilan unmount bo'ladi, ya'ni
  // ichkarida saqlangan id o'sha zahoti yo'qolardi.
  const [closedSessionId, setClosedSessionId] = useState<string | null>(null);
  const printZReport = usePrintZReport();

  // F8 — kassir almashtirish: faqat smena YOPIQ ekranda (ochiq sessiyada
  // SmenaMode'dagi tugma nofaol, izoh «avval yoping»). Hook'lar erta
  // `return`dan YUQORIDA (React #310). Ish-o'rni bayrog'i effektda —
  // SSR/hydration xavfsiz (kassa-kirish naqshi).
  const [showCashierSelect, setShowCashierSelect] = useState(false);
  const [workstation, setWorkstation] = useState(false);
  useEffect(() => {
    setWorkstation(isPosWorkstation());
  }, []);

  if (!user || isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--ms-text-muted)] text-sm">
        {tCommon('loading')}
      </div>
    );
  }

  if (!session) {
    // F8 — kassir-tanlash ekrani ochilish formasini ALMASHTIRADI (overlay
    // emas): kassir bir paytda bitta oqim ko'radi. Muvaffaqiyatda kesh
    // komponent ichida invalidatsiyalangan — yangi kassirning `smena-mine`si
    // qayta so'raladi; eski kassirning yopiq-smena Z-hisobot tugmasi
    // tozalanadi (u endi boshqa shaxs hujjati).
    if (showCashierSelect) {
      return (
        <div className="pos-theme flex min-h-[70vh] flex-col p-4">
          <CashierSelectScreen
            onSwitched={() => {
              setShowCashierSelect(false);
              setClosedSessionId(null);
            }}
            onCancel={() => setShowCashierSelect(false)}
          />
        </div>
      );
    }
    return (
      <div className="p-4">
        {/* Endi yopilgan smena — Z-hisobot qog'ozi hali chiqarilmagan
            bo'lishi mumkin. Yo'l shu yerda qoladi, aks holda kassir uni
            faqat `/retail/sessions` ro'yxatidan topardi. */}
        {closedSessionId && (
          <button
            type="button"
            onClick={() => void printZReport(closedSessionId)}
            data-test-id="print-closed-z-report"
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)] px-4 py-3 text-left font-medium text-[var(--ms-text-primary)] text-sm hover:bg-[var(--ms-bg-hover)]"
          >
            <span>{t('print_z_report')}</span>
            <span className="text-[var(--ms-text-muted)]">🖨</span>
          </button>
        )}
        <OpenShiftForm />
        {/* F8 (spec §8) — smena yopiq: shu qurilmada BOSHQA kassir o'z PIN'i
            bilan ishga tushishi mumkin. SmenaMode'dagi nofaol tugma bilan
            BIR XIL yorliq — kassir yopishdan keyin xuddi shu nomni qidiradi. */}
        {workstation && (
          <button
            type="button"
            data-test-id="pos-switch-cashier-open"
            onClick={() => setShowCashierSelect(true)}
            className="mx-auto mt-6 flex h-[56px] w-full max-w-sm items-center justify-center rounded-xl border border-[var(--ms-border)] font-semibold text-[16px] text-[var(--ms-text-primary)] hover:bg-[var(--ms-bg-hover)]"
          >
            {t('switch_cashier')}
          </button>
        )}
      </div>
    );
  }

  return (
    // Balandlik O'LCHANADI, qat'iy raqam emas — `hooks/use-fill-viewport.ts` ga
    // qara. Avval `calc(100dvh-58px)` edi (faqat navbar), climart'da esa subnav
    // ham bor → qobiq ~46px uzun bo'lib JAMI + to'lov tugmasi ekrandan chiqib
    // ketardi.
    // F2 — `.pos-theme` ildizda: POS tokenlari faqat shu daraxtga tegadi.
    // Eski «SOTUV» sarlavha-satri o'chirildi — o'rnini SHERSET header oldi
    // (u `SalesScreen` ichida, chunki smena-chip sessiyani talab qiladi).
    <div ref={shellRef} className="pos-theme flex flex-col" style={{ height: shellHeight }}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SalesScreen session={session} onShiftClosed={setClosedSessionId} />
      </div>
    </div>
  );
}
