'use client';

/**
 * «Sotuv» rejimi — chap panel (qidiruv + tovar setkasi) va savat paneli
 * (Sotuv rejimining doimiy o'ng paneli).
 *
 * F1 (POS redizayn, 2026-08-14): JSX `page.tsx` dan XULQNI O'ZGARTIRMASDAN
 * ko'chirildi. Savat holati, so'rovlar va mutatsiyalar sahifada QOLADI —
 * bu fayl faqat chizadi; qator ichidagi sof hisob-kitoblar (band, foyda,
 * markdown) esa avvalgidek YAGONA manbadan (`cart-math` / `@moysklad/money`)
 * keladi.
 *
 * F3 (spec §5.1, Q6): sensorli qayta qurish — savat qatori butun-qator
 * tahrir-trigger (± yo'q), o'lchamlar px'da (spec §4 shkalasi), eski
 * smena-strip olib tashlandi (ma'lumot PosHeader chip'ida).
 */

import { useBcp47 } from '@/lib/i18n-format';
import {
  cartLineMarkdownMinor,
  cartLineProfitMinor,
  cartLineRevenueMinor,
  normalizeQtyDecimal,
} from '@/lib/pos/cart-math';
import { scanFeedback } from '@/lib/pos/scan-feedback';
// Ekranga nima chiqishi (hisob-kitobga tegmaydi) — izohi shu faylda.
import {
  SHOW_COST_IN_SEARCH,
  SHOW_MARGIN_ON_SCREEN,
  SHOW_WHOLESALE_IN_CART,
} from '@/lib/pos/ui-flags';
import { resolveDefaultSalePrice, useCurrencyRates, usePriceTypeIds } from '@/lib/sale-price';
import type {
  CurrentSession,
  ListEnvelope as ListResponse,
  PosProductRow as ProductRow,
} from '@moysklad/contracts';
import { classifyPrice, formatPercent, marginPercent, priceFloorMinor } from '@moysklad/money';
import { Alert, Button, Input, Textarea, formatMoney } from '@moysklad/ui';
import { Search, ShoppingCart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { CartLine } from './pos-types';

// ── Chap panel: qidiruv + tovar setkasi ─────────────────────────────────────

interface SotuvSearchGridProps {
  session: CurrentSession;
  /** P4 — smena yoshi matni (`formatShiftAge` sahifada hisoblanadi). */
  shiftAge: string;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  /** Savatga qo'shilgandan keyin fokus shu maydonga qaytadi (`addToCart`). */
  searchRef: RefObject<HTMLInputElement | null>;
  products: ListResponse<ProductRow> | undefined;
  isLoading: boolean;
  /**
   * Natijalar AYNAN joriy matnniki (debounce o'tgan + so'rov tugagan) —
   * sahifa hisoblaydi. `keepPreviousData` tufayli setkada eski natija turishi
   * mumkin; «Topilmadi» ovozi shunga chalinib ketmasin.
   */
  searchSettled: boolean;
  /**
   * Enter/skaner — sahifada: natija tinchigan bo'lsa birinchisini qo'shadi,
   * bo'lmasa so'rovni flush qilib natija kelgach qo'shadi (Enter yo'qolmaydi,
   * eski ro'yxatdan noto'g'ri tovar ham qo'shilmaydi).
   */
  onSearchEnter: () => void;
  addToCart: (product: ProductRow) => void;
}

export function SotuvSearchGrid({
  session,
  shiftAge,
  search,
  setSearch,
  searchRef,
  products,
  isLoading,
  searchSettled,
  onSearchEnter,
  addToCart,
}: SotuvSearchGridProps) {
  const t = useTranslations('pages.sotuv');
  const bcp47 = useBcp47();
  // Narx qavati id'si SHART: usiz resolver `salePrices[0]` ga tushadi va u
  // yozilish tartibi bo'yicha «Оптовая» bo'lishi mumkin (2026-08-23 auditi).
  const { defaultId } = usePriceTypeIds();
  // Valyuta kurslari SHART: narx `currencyCode` bilan saqlangan bo'lsa
  // resolver uni joriy kurs bilan bazaga o'giradi, kurslarsiz esa `null`
  // qaytaradi va setkada narx o'rniga «—» chiqadi.
  const rates = useCurrencyRates();

  // F3 — skaner-javob (spec §5.1): qidiruv/skan hech narsa topmasa PAST ton.
  // Xabar («not_found») allaqachon setkada turadi — bu faqat OVOZ qatlami.
  // 2026-08-16: `searchSettled` sharti — natija JORIY matnniki bo'lgandagina
  // (debounce + keepPreviousData bilan endi oraliq prefikslar so'ralmaydi,
  // eski natija esa yangi matn uchun «topilmadi» degani emas). Dedup (bir
  // matn = bir marta; 800ms oynasi) himoya sifatida qoladi.
  const lastMissRef = useRef<{ q: string; at: number } | null>(null);
  const missNow = searchSettled && search.trim() !== '' && (products?.items.length ?? 0) === 0;
  useEffect(() => {
    if (!missNow) {
      if (search.trim() === '') lastMissRef.current = null;
      return;
    }
    const q = search.trim();
    const now = Date.now();
    const last = lastMissRef.current;
    if (last && (last.q === q || now - last.at < 800)) return;
    lastMissRef.current = { q, at: now };
    scanFeedback.notFound();
  }, [missNow, search]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
      {/* P4 — «unutilgan smena» ogohlantirishi.
          Bayroqni SERVER qo'yadi (`stale`): chegara MK13 registrida turadi,
          ekran uni bilmaydi. Avto-yopish YO'Q — sanoqsiz yopilgan smena
          kassa hisobini yolg'onlashtiradi (egasi qarori, 2026-08-12). */}
      {session.stale && (
        <Alert
          tone="warning"
          title={t('shift_stale_title', { age: shiftAge })}
          data-test-id="sotuv-shift-stale"
        >
          {t('shift_stale_action')}
        </Alert>
      )}

      {/* F3: eski smena-strip OLIB TASHLANDI — kassir ismi/yoshi/savdo jami
          endi PosHeader smena-chip'ida (F2, spec §3.1); shu yerda turgani
          ma'lumot dublikati edi. `stale` ogohlantirishi (yuqorida) qoladi —
          u ma'lumot emas, HARAKAT talab qiladigan signal. */}

      {/* Search / barcode — 2026-08-16 (egasi): bo'yi 2× (44→88px, sensorli
          nishon), matn 20px. Natijalar tanlashdan keyin TOZALANMAYDI (matn
          `addToCart`da select bo'ladi) — ochiq tozalash yo'li shu «Tozalash»
          tugmasi. U matn bor bo'lgandagina chiziladi. */}
      <Input
        ref={searchRef}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            // Maydon matni `addToCart`da to'liq belgilanadi (tozalanmaydi).
            // Qo'shish mantiqi sahifada (`onSearchEnter`): natija hali
            // tinchimagan bo'lsa Enter yo'qolmaydi — flush + kutib qo'shish.
            onSearchEnter();
          }
        }}
        placeholder={t('search_placeholder')}
        data-test-id="sotuv-search"
        leading={<Search className="h-6 w-6" />}
        trailing={
          search !== '' ? (
            <button
              type="button"
              data-test-id="sotuv-search-clear"
              onClick={() => {
                setSearch('');
                searchRef.current?.focus();
              }}
              // Fokus maydonda qolsin (OSK yopilib-ochilmasin) — savat
              // «Tozalash»idan farqli, bu faqat matnni o'chiradi.
              onMouseDown={(e) => e.preventDefault()}
              className="flex h-[56px] items-center rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)] px-5 font-medium text-[16px] text-[var(--ms-text-muted)] transition-colors hover:bg-[var(--ms-bg-hover)] hover:text-[var(--ms-text-primary)] active:scale-[0.98]"
            >
              {t('clear')}
            </button>
          ) : undefined
        }
        className="h-[88px] rounded-xl pr-[150px] text-[20px] shadow-sm"
      />

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-[var(--ms-text-muted)] text-sm">{t('loading')}</div>
        ) : (products?.items.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-[var(--ms-text-muted)] text-sm">
            {t('not_found')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {products?.items.map((p) => {
              const sale = resolveDefaultSalePrice(p.salePrices, defaultId, rates);
              const onHand = Number(p.stock?.onHand ?? '0');
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => addToCart(p)}
                  data-test-id="sotuv-product"
                  className="flex min-h-[var(--pos-touch-min)] flex-col items-start rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)] p-4 text-left shadow-sm transition-colors hover:bg-[var(--ms-bg-hover)] active:scale-[0.99]"
                >
                  {/* P04 (2026-08-13, egasi): mahsulot nomi boshqa xildagi
                      kattaroq shriftda — font-pos (Segoe UI zanjiri).
                      F3 (spec §4): o'lchamlar px'da — ildiz font 12px,
                      rem-klasslar 0.75× kichik chiqadi (F2 saboqi). */}
                  <span className="font-pos font-semibold text-[18px] text-[var(--ms-text-primary)]">
                    {p.name}
                  </span>
                  <span className="mt-1 font-bold text-[18px] text-[var(--ms-text-destructive)]">
                    {sale != null ? formatMoney(BigInt(sale)) : '—'}
                  </span>
                  <span className="mt-1 text-[14px]">
                    <span
                      className={
                        onHand <= 0
                          ? 'text-[var(--ms-text-destructive)]'
                          : 'text-[var(--ms-text-muted)]'
                      }
                    >
                      {t('stock')}: {onHand.toLocaleString(bcp47)} {t('pieces')}
                    </span>
                    {/* «Kelgan» — ekranda KO'RSATILMAYDI (P02, 2026-08-13,
                        egasi): mijoz ko'zi oldida tan narx ochiq turmasin.
                        Markup bayroq bilan to'silgan (`lib/pos/ui-flags.ts`). */}
                    {SHOW_COST_IN_SEARCH && p.buyPrice != null && (
                      <span data-test-id="sotuv-grid-cost" className="text-[var(--ms-text-muted)]">
                        {' '}
                        · {t('cost')}: {formatMoney(BigInt(p.buyPrice))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Savat paneli («Savat» tab tarkibi) ──────────────────────────────────────

interface SavatPanelProps {
  cart: CartLine[];
  /** F8 — zakazga bog'langan savat: tahrir/o'chirish yo'q (sabab sahifada). */
  cartLocked: boolean;
  /** Savatni tozalash — zakaz/chek bog'lanishini ham uzadi (sahifada). */
  onClearCart: () => void;
  /**
   * CHEK IZOHI (2026-08-19, egasi: «har bir chekka izoh»). Savat bilan birga
   * yashaydi va chek yaratilganda serverga `description` bo'lib ketadi.
   */
  cartComment: string;
  setCartComment: Dispatch<SetStateAction<string>>;
  /** Bitta qatorni o'chirish (egasi so'rovi, 2026-08-15): «Tozalash» hammasini
   *  olib tashlaydi, bitta tovarni esa faqat qator-oynasi ichidan o'chirish
   *  mumkin edi — kassir bu yo'lni topolmadi. Endi har qatorda ochiq ✕ bor. */
  onRemoveLine: (productId: string) => void;
  // ── Qoralama (hold order, 2026-08-16 egasi so'rovi) ────────────────────────
  // Savat chetga olinadi, ikkinchi mijozga xizmat davom etadi. Holat va
  // saqlash sahifada (`cart-drafts.ts`) — panel faqat chizadi.
  /** Park mumkinmi — bo'sh/qulflangan/to'lanayotgan savat qoralanmaydi. */
  canPark: boolean;
  onPark: () => void;
  /** Chip qiymatlari sahifada tayyorlanadi (summa — server formulasi bilan). */
  drafts: Array<{ id: string; timeLabel: string; count: number; totalMinor: bigint }>;
  /** Qulflangan savat ustida tiklash yo'q (almashish bog'lanishni uzardi). */
  draftsLocked: boolean;
  onRestoreDraft: (draftId: string) => void;
  onDeleteDraft: (draftId: string) => void;
  setEditingProductId: Dispatch<SetStateAction<string | null>>;
  /** F3 — skaner-javob: hozirgina qo'shilgan qator (600ms yashil flash). */
  flashProductId: string | null;
  discountPct: number;
  setDiscountPct: Dispatch<SetStateAction<number>>;
  discountEditing: boolean;
  setDiscountEditing: Dispatch<SetStateAction<boolean>>;
  cartCount: number;
  cartTotal: bigint;
  discountedTotal: bigint;
  cartProfitMinor: bigint | null;
  cartMarginPct: ReturnType<typeof marginPercent>;
  directSellPending: boolean;
  onDirectSell: () => void;
  sendToPickingPending: boolean;
  onSendToPicking: () => void;
  /**
   * SOTUVSIZ CHEK (2026-08-16, egasi): savatdan chek chiqarish — sotuv
   * yaratilmaydi, chop etilgach savat qoralamaga o'tadi («chekni
   * o'zgartirish» yo'li). `null` = tugma chizilmaydi (qulflangan/to'lanayotgan
   * savat — u yerda hujjat allaqachon bor).
   */
  onPrintProforma: (() => void) | null;
}

export function SavatPanel({
  cart,
  cartLocked,
  onClearCart,
  cartComment,
  setCartComment,
  onRemoveLine,
  canPark,
  onPark,
  drafts,
  draftsLocked,
  onRestoreDraft,
  onDeleteDraft,
  setEditingProductId,
  flashProductId,
  discountPct,
  setDiscountPct,
  discountEditing,
  setDiscountEditing,
  cartCount,
  cartTotal,
  discountedTotal,
  cartProfitMinor,
  cartMarginPct,
  directSellPending,
  onDirectSell,
  onPrintProforma,
  sendToPickingPending,
  onSendToPicking,
}: SavatPanelProps) {
  const t = useTranslations('pages.sotuv');
  const tCommon = useTranslations('common');
  /** Izoh maydoni ochiqmi — chegirma inputi bilan AYNI naqsh (inline, Radix
   *  dialog EMAS: qobiq ekran-klaviaturasi bilan muammosiz ishlashi uchun). */
  const [commentEditing, setCommentEditing] = useState(false);

  return (
    <>
      {/* 2026-08-16 (egasi): header 2× baland (~37→72px), tugmalar barmoq
          o'lchamida. «Qoralama» — savatni chetga olib ikkinchi mijozga xizmat. */}
      <div className="flex h-[72px] shrink-0 items-center gap-2 border-[var(--ms-border)] border-b px-4">
        <span className="font-semibold text-[18px] text-[var(--ms-text-muted)]">
          {t('cart_title')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {canPark && (
            <button
              type="button"
              onClick={onPark}
              data-test-id="sotuv-cart-park"
              className="flex h-[52px] items-center rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)] px-5 font-medium text-[16px] text-[var(--ms-text-primary)] transition-colors hover:bg-[var(--ms-bg-hover)] active:scale-[0.98]"
            >
              {t('draft_hold')}
            </button>
          )}
          {cart.length > 0 && (
            <Button
              variant="link"
              className="text-[16px]"
              onClick={onClearCart}
              data-test-id="sotuv-cart-clear"
            >
              {t('clear')}
            </Button>
          )}
        </div>
      </div>

      {/* Qoralama chiplari — bor bo'lsagina chiziladi. Chip = vaqt · N tovar ·
          summa; bosish savatga qaytaradi (joriy savat bo'sh bo'lmasa u avval
          avtomatik qoralamaga olinadi — sahifadagi `restoreDraft`). */}
      {drafts.length > 0 && (
        <div
          data-test-id="sotuv-drafts"
          className="flex shrink-0 gap-2 overflow-x-auto border-[var(--ms-border)] border-b bg-[var(--ms-bg-app)] px-4 py-2"
        >
          {drafts.map((d) => (
            <div
              key={d.id}
              className="flex shrink-0 items-stretch overflow-hidden rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)]"
            >
              <button
                type="button"
                data-test-id="sotuv-cart-draft"
                onClick={() => onRestoreDraft(d.id)}
                disabled={draftsLocked}
                title={t('draft_restore')}
                className="px-4 py-1.5 text-left transition-colors hover:bg-[var(--ms-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="block text-[13px] text-[var(--ms-text-muted)]">
                  {d.timeLabel} · {t('items_count', { n: d.count })}
                </span>
                <span className="block font-semibold text-[16px] tabular-nums text-[var(--ms-text-primary)]">
                  {formatMoney(d.totalMinor)}
                </span>
                {/* 2026-08-16 (egasi): «tahrirlash yo'q-ku» — chip tahrir
                    yo'li ekani endi OCHIQ yozilgan (vaqt+summa yolg'iz o'zi
                    buni bildirmasdi). */}
                <span className="block text-[12px] text-[var(--ms-text-brand)]">
                  ✎ {t('draft_edit')}
                </span>
              </button>
              <button
                type="button"
                data-test-id="sotuv-cart-draft-delete"
                aria-label={t('draft_delete')}
                onClick={() => onDeleteDraft(d.id)}
                className="flex w-[44px] items-center justify-center border-[var(--ms-border)] border-l text-[16px] text-[var(--ms-text-muted)] transition-colors hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-[var(--ms-text-muted)]">
            <ShoppingCart className="h-8 w-8 opacity-40" />
            <span className="font-medium text-sm">{t('cart_empty_title')}</span>
            <span className="text-xs">{t('cart_empty_hint')}</span>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--ms-border)]">
            {cart.map((line) => {
              // Kassa TZ §5.2 — the row's own profit is taken at the price
              // the cashier typed (the cart-level discount is a separate,
              // footer-level figure), so editing the price moves this number
              // immediately and visibly.
              // P12 — tasma POLga nisbatan (tan narxga emas): karta
              // narxining o'zi tan narxdan past bo'lgan tovarlarda
              // (prodda 46 ta) o'z narxida sotish RUXSAT etilgan, ya'ni
              // ularni qizil «zarar» deb belgilash yolg'on signal edi.
              const lineFloor = priceFloorMinor({
                costMinor: line.costMinor,
                basePriceMinor: line.basePriceMinor,
              });
              const band = classifyPrice({
                priceMinor: line.priceMinor,
                costMinor: lineFloor,
                wholesaleMinor: line.wholesaleMinor,
              });
              // 🔴 Ilgari `BigInt(line.quantity)` edi — kasr miqdorda
              // RangeError otib butun sahifani oq ekranga aylantirardi.
              // Formulalar sahifada QAYTA YOZILMAYDI: ular
              // `lib/pos/cart-math.ts` da, sof va sinalgan holda
              // (`@moysklad/money` variantlari `bigint` miqdor talab
              // qiladi, ya'ni 1.5 kg ni ifodalay olmaydi).
              const qty = normalizeQtyDecimal(line.quantity);
              const lineRevenue = cartLineRevenueMinor(line);
              const lineProfit = cartLineProfitMinor(line);
              const linePct = marginPercent(lineProfit, lineRevenue);
              // «Kassir qancha tushirib berdi» (kassa TZ §5.3) — shown only
              // when the cashier actually went below the card price; a sale
              // at or above it needs no annotation.
              const markdown = cartLineMarkdownMinor(line);
              // F3 — skaner-javob: hozirgina qo'shilgan qator yashil yonadi.
              // ZARAR/optom tasmalarining fonini flash BOSMAYDI (ular nazorat
              // signali) — u yerda faqat yashil halqa ko'rinadi.
              const flashing = line.productId === flashProductId;
              return (
                /* F3 (spec Q6, 2026-08-14): QATOR — katta tahrir-trigger,
                   bosilsa mavjud tahrir oynasi (`cart-line-edit-modal`)
                   ochiladi. −/+ mikro-tugmalar olib tashlangan: sensorli
                   monoblokda 24px nishonlar xato bosilardi. 2026-08-15
                   (egasi): qator yonida KATTA ✕ qaytdi — bitta tovarni
                   o'chirish uchun oynani ochish shart emas; nishon 56px,
                   ya'ni F3 shikoyatidagi mayda tugma emas. Qulflangan
                   savatda (zakaz bog'langan) ✕ chizilmaydi, oyna esa FAQAT
                   KO'RISH rejimida ochiladi — qulfni sahifadagi `readOnly`
                   prop takrorlaydi. */
                <div key={line.productId} className="flex items-stretch">
                  <button
                    type="button"
                    data-test-id="sotuv-cart-line"
                    data-price-band={band}
                    onClick={() => setEditingProductId(line.productId)}
                    title={t('line_edit_open')}
                    data-flash={flashing ? 'true' : undefined}
                    className={`block min-w-0 flex-1 min-h-[var(--pos-row-h)] px-3 py-2 text-left transition-colors ${
                      flashing ? 'ring-2 ring-inset ring-emerald-400 ' : ''
                    }${
                      band === 'loss'
                        ? 'bg-red-50 hover:bg-red-100'
                        : band === 'below-wholesale'
                          ? 'bg-amber-50 hover:bg-amber-100'
                          : flashing
                            ? 'bg-emerald-50'
                            : cartLocked
                              ? ''
                              : 'hover:bg-[var(--ms-bg-hover)]'
                    }`}
                  >
                    {/* Qator 1: nom + qator jamisi (spec §4: 18px) */}
                    <div className="flex items-baseline gap-3">
                      <span
                        data-test-id="sotuv-cart-line-edit"
                        className="min-w-0 flex-1 truncate font-pos font-semibold text-[18px] text-[var(--ms-text-primary)]"
                      >
                        {line.productName}
                      </span>
                      <span className="shrink-0 font-semibold text-[18px] tabular-nums text-[var(--ms-text-primary)]">
                        {formatMoney(lineRevenue)}
                      </span>
                    </div>

                    {/* Qator 2: miqdor × narx + qolgan/tan/optom (kassa TZ §5.2) */}
                    <div className="mt-1 flex items-center gap-3">
                      <span className="flex items-center gap-1.5 text-[16px] text-[var(--ms-text-muted)] tabular-nums">
                        <span data-test-id="sotuv-cart-qty">{qty}</span>
                        {/* K3 — kassir mijoz bilan kelishgan bo'lak tarkibi
                            («180 (150 + 30)»). Miqdorga TEGMAYDI: yig'indisi
                            aynan o'sha `qty`. Omborchi buni chekda ko'rib
                            qaysi bo'laklarni kesishini biladi. */}
                        {line.pieceLengths && line.pieceLengths.length > 1 && (
                          <span
                            data-test-id="sotuv-cart-pieces"
                            className="text-[14px] text-amber-700"
                          >
                            ({line.pieceLengths.join(' + ')})
                          </span>
                        )}
                        <span>×</span>
                        <span data-test-id="sotuv-cart-price-edit">
                          {formatMoney(line.priceMinor)}
                        </span>
                      </span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-1.5 text-[14px] text-[var(--ms-text-muted)]">
                        {line.availableStock !== undefined && (
                          <span>
                            {t('cart_remaining')}:{' '}
                            <span
                              className={
                                line.availableStock <= 0
                                  ? 'text-red-500 font-medium'
                                  : 'tabular-nums'
                              }
                            >
                              {line.availableStock}
                            </span>
                          </span>
                        )}
                        {/* Tan narx — ekranda KO'RSATILMAYDI (egasining
                          qarori): mijoz kassir yoniga kelganda marja
                          ochiq turardi. Hisob-kitob joyida
                          (`lib/pos/ui-flags.ts` izohiga qara). */}
                        {SHOW_MARGIN_ON_SCREEN && (
                          <span data-test-id="sotuv-cart-cost">
                            · {t('cart_cost')}:{' '}
                            <span className="tabular-nums">
                              {line.costMinor != null ? formatMoney(line.costMinor) : '—'}
                            </span>
                          </span>
                        )}
                        {/* «Optom» — savat qatorida KO'RSATILMAYDI (P02,
                          2026-08-13, egasi): faqat qator-tahrir oynasida
                          qoladi (F3). Bayroq — `lib/pos/ui-flags.ts`. */}
                        {SHOW_WHOLESALE_IN_CART && line.wholesaleMinor != null && (
                          <span data-test-id="sotuv-cart-min">
                            · {t('cart_min')}:{' '}
                            <span className="tabular-nums">{formatMoney(line.wholesaleMinor)}</span>
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Qator 3: chegara ogohlantirishi + qator foydasi (shartli) */}
                    {(line.priceMinor <= 0n ||
                      band !== 'ok' ||
                      (markdown != null && markdown > 0n) ||
                      SHOW_MARGIN_ON_SCREEN) && (
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        {/* Narxsiz qator JIM qolmaydi: prodda 488 tovarda
                          chakana narx yo'q va ular savatga 0 so'm bilan
                          tushadi. Bu — MA'LUMOT, qulf EMAS (2026-08-16 dan
                          bepulga sotish ruxsat etilgan), shuning uchun rang
                          qizil «xato» emas, sariq ogohlantirish. */}
                        {line.priceMinor <= 0n && (
                          <span
                            data-test-id="sotuv-cart-no-price"
                            className="rounded bg-amber-500 px-1.5 py-0.5 font-bold text-[10px] text-white"
                          >
                            {t('cart_no_price')}
                          </span>
                        )}
                        {band === 'loss' && (
                          <span
                            data-test-id="sotuv-cart-loss"
                            className="rounded bg-red-600 px-1.5 py-0.5 font-bold text-[10px] text-white uppercase tracking-wide"
                          >
                            {t('cart_loss')}
                          </span>
                        )}
                        {band === 'below-wholesale' && (
                          <span className="rounded bg-amber-500 px-1.5 py-0.5 font-semibold text-[10px] text-white">
                            {t('cart_below_wholesale')}
                          </span>
                        )}
                        {markdown != null && markdown > 0n && (
                          <span
                            data-test-id="sotuv-cart-markdown"
                            className="text-[var(--ms-text-muted)] tabular-nums"
                          >
                            −{formatMoney(markdown)} {t('cart_markdown')}
                          </span>
                        )}
                        {/* Qator foydasi — ekranda KO'RSATILMAYDI (yuqoridagi
                          tan narx bilan bir qaror). ZARAR va «optomdan past»
                          tasmalari qoladi: ular raqam emas, NAZORAT. */}
                        {SHOW_MARGIN_ON_SCREEN && (
                          <span
                            data-test-id="sotuv-cart-profit"
                            className={`ml-auto tabular-nums ${
                              lineProfit == null
                                ? 'text-[var(--ms-text-muted)]'
                                : lineProfit < 0n
                                  ? 'font-semibold text-red-600'
                                  : 'font-medium text-emerald-600'
                            }`}
                          >
                            {t('cart_profit')}:{' '}
                            {lineProfit == null ? (
                              // Tan narx kartochkada yo'q — «0 foyda» EMAS, «noma'lum».
                              <span title={t('cart_cost_missing')}>—</span>
                            ) : (
                              <>
                                {lineProfit > 0n ? '+' : ''}
                                {formatMoney(lineProfit)}
                                {linePct != null && ` (${formatPercent(linePct)})`}
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                  {!cartLocked && (
                    <button
                      type="button"
                      data-test-id="sotuv-cart-line-remove"
                      aria-label={`${tCommon('delete')}: ${line.productName}`}
                      onClick={() => onRemoveLine(line.productId)}
                      className="flex w-[56px] shrink-0 items-center justify-center border-[var(--ms-border)] border-l text-[20px] text-[var(--ms-text-muted)] transition-colors hover:bg-red-50 hover:text-red-600 active:bg-red-100"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — mijoz turi + Rasmilashtirish */}
      <div className="shrink-0 border-[var(--ms-border)] border-t bg-[var(--ms-bg-surface)] px-4 pt-4 pb-5">
        {/* Jami summa — ikki marta bosib chegirma */}
        <div className="mb-4 text-center">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--ms-text-muted)]">
            {t('total')}
          </p>

          {/* Summa — ikki marta bosish chegirmani ochadi */}
          <div
            className="cursor-default select-none"
            onDoubleClick={() => setDiscountEditing((v) => !v)}
            title={t('discount_dblclick_hint')}
          >
            {discountPct > 0 && (
              <p className="text-[14px] tabular-nums text-[var(--ms-text-muted)] line-through">
                {formatMoney(cartTotal)}
              </p>
            )}
            {/* F3 (spec §4): jami summa 36–40px qalin — 1 metrdan o'qilsin.
                px'da ataylab (`text-3xl` ildiz 12px da bor-yo'g'i 22.5px edi). */}
            <p
              className={`font-bold tabular-nums leading-none text-[38px] ${discountPct > 0 ? 'text-emerald-600' : 'text-[var(--ms-text-primary)]'}`}
            >
              {formatMoney(discountedTotal)}
            </p>
            {discountPct > 0 && (
              <p className="mt-0.5 text-xs font-medium text-emerald-600">
                {t('discount_applied', { pct: discountPct })}
              </p>
            )}
          </div>

          {cartCount > 0 && (
            <p className="mt-1 text-xs text-[var(--ms-text-muted)]">
              {t('products_count', { n: cartCount })}
            </p>
          )}

          {/* Chek bo'yicha foyda — ekranda KO'RSATILMAYDI (egasining
              qarori, `lib/pos/ui-flags.ts`). Bu eng ko'zga tashlanadigan
              raqam edi: mijoz to'lov paytida ekranga qarasa marjani
              o'qib olardi. */}
          {SHOW_MARGIN_ON_SCREEN && cartCount > 0 && (
            <p
              data-test-id="sotuv-cart-total-profit"
              className={`mt-1 text-xs tabular-nums ${
                cartProfitMinor == null
                  ? 'text-[var(--ms-text-muted)]'
                  : cartProfitMinor < 0n
                    ? 'font-semibold text-red-600'
                    : 'font-medium text-emerald-600'
              }`}
            >
              {t('cart_total_profit')}:{' '}
              {cartProfitMinor == null ? (
                t('cart_cost_missing')
              ) : (
                <>
                  {cartProfitMinor > 0n ? '+' : ''}
                  {formatMoney(cartProfitMinor)}
                  {cartMarginPct != null && ` (${formatPercent(cartMarginPct)})`}
                </>
              )}
            </p>
          )}

          {/* Inline chegirma input */}
          {discountEditing && (
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="text-xs text-[var(--ms-text-muted)]">{t('discount')}:</span>
              <div className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5">
                <input
                  type="number"
                  min="0"
                  max="100"
                  // biome-ignore lint/a11y/noAutofocus: intentional POS focus — cashier types the discount percent immediately when this popover opens.
                  autoFocus
                  value={discountPct === 0 ? '' : discountPct}
                  onChange={(e) =>
                    setDiscountPct(
                      Math.min(100, Math.max(0, Number.parseInt(e.target.value, 10) || 0)),
                    )
                  }
                  onBlur={() => setDiscountEditing(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setDiscountEditing(false)}
                  placeholder="0"
                  className="w-10 bg-transparent text-center text-sm font-bold text-emerald-700 outline-none"
                />
                <span className="text-sm font-bold text-emerald-600">%</span>
              </div>
              {discountPct > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDiscountPct(0);
                    setDiscountEditing(false);
                  }}
                  className="text-xs text-[var(--ms-text-muted)] hover:text-red-500"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── CHEK IZOHI (2026-08-19, egasi: «har bir chekka izoh») ──
            Inline, chegirma naqshi bilan bir xil. Yozilgan izoh chekda
            «Izoh:» qatori bo'lib chiqadi va chek kartochkasida ko'rinadi. */}
        {cart.length > 0 && (
          <div className="mb-2">
            {commentEditing ? (
              <div className="flex items-start gap-2 rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-app)] px-3 py-2">
                <Textarea
                  // biome-ignore lint/a11y/noAutofocus: POS oqimi — kassir tugmani bosgach darhol yozadi.
                  autoFocus
                  rows={2}
                  maxLength={400}
                  value={cartComment}
                  onChange={(e) => setCartComment(e.target.value)}
                  onBlur={() => setCommentEditing(false)}
                  placeholder={t('cart_comment_placeholder')}
                  data-test-id="sotuv-comment-input"
                  className="w-full resize-none border-0 bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setCommentEditing(false)}
                  className="shrink-0 rounded-lg px-2 py-1 font-bold text-emerald-600 text-sm hover:bg-emerald-50"
                >
                  ✓
                </button>
              </div>
            ) : cartComment.trim() ? (
              <button
                type="button"
                onClick={() => setCommentEditing(true)}
                data-test-id="sotuv-comment-text"
                className="flex w-full items-start gap-2 rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-app)] px-3 py-2 text-left text-[13px] text-[var(--ms-text-primary)] hover:bg-[var(--ms-bg-hover)]"
              >
                <span className="shrink-0 text-[var(--ms-text-muted)]">✎</span>
                <span className="line-clamp-2 break-words">{cartComment}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCommentEditing(true)}
                data-test-id="sotuv-comment-add"
                className="flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[var(--ms-border)] border-dashed bg-transparent font-medium text-[13px] text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
              >
                ✎ {t('cart_comment_add')}
              </button>
            )}
          </div>
        )}

        {/* SOTUVSIZ CHEK (2026-08-16, egasi): sotuv YARATILMAYDI — savatdan
            chek chiqadi, savat qoralamaga o'tadi. Narx-siyosat quli AYNI:
            0-narx/pol buzilishi buni ham bloklaydi (chek narx-hujjatdek
            ko'ringani uchun undagi narx ham qoidaga bo'ysunadi). */}
        {onPrintProforma != null && (
          <button
            type="button"
            onClick={onPrintProforma}
            disabled={cart.length === 0}
            data-test-id="sotuv-proforma"
            className="mb-2 flex h-[var(--pos-touch-min)] w-full items-center justify-center gap-2 rounded-2xl border border-[var(--ms-border)] bg-[var(--ms-bg-surface)] font-semibold text-[16px] text-[var(--ms-text-primary)] shadow-sm transition-all hover:bg-[var(--ms-bg-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('proforma_btn')}
          </button>
        )}

        {/* P3 — TO'G'RIDAN-TO'G'RI SOTISH (yig'ishsiz, darhol to'lov).
            Yuqorida turadi va to'q rangda: kichik xaridda ASOSIY yo'l shu.
            «Omborchiga yuborish» pastda, ochiqroq rangda — katta zakaz
            uchun qoladi. Ikkalasi ham AYNI narx-siyosat qulfi ostida
            (P12): 0 narx yoki poldan past narx ikkalasini ham bloklaydi,
            aks holda yangi tugma qulfni chetlab o'tish yo'li bo'lardi.
            F3 (spec §4): asosiy tugma 72px, ikkilamchisi 56px
            (`--pos-touch-min`), yozuv 18px — hammasi px'da (ildiz font
            12px, rem-klasslar 0.75× kichik chiqadi — F2 saboqi). */}
        <button
          type="button"
          onClick={onDirectSell}
          disabled={cart.length === 0 || directSellPending}
          data-test-id="sotuv-sell-direct"
          className="mb-2 flex h-[72px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 font-semibold text-[18px] text-white shadow-lg transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {directSellPending ? (
            <span className="flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {t('sending')}
            </span>
          ) : (
            <>
              <span>{t('sell_direct')}</span>
              <span className="font-normal text-emerald-100 text-xs">{t('sell_direct_hint')}</span>
            </>
          )}
        </button>

        {/* Omborchiga yuborish */}
        <button
          type="button"
          onClick={onSendToPicking}
          disabled={cart.length === 0 || sendToPickingPending}
          data-test-id="sotuv-pay"
          className="flex h-[var(--pos-touch-min)] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 font-semibold text-[18px] text-white shadow-lg transition-all hover:bg-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sendToPickingPending ? (
            <span className="flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {t('sending')}
            </span>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              {t('send_to_picker')}
            </>
          )}
        </button>
      </div>
    </>
  );
}
