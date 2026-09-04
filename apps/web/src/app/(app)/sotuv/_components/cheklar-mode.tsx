'use client';

/**
 * «Cheklar» rejimi — joriy smena cheklari ro'yxati (F6.C: matn kiritilsa
 * BARCHA smenalar bo'ylab qidiruv) + chek detali (qayta chop, qaytarish).
 *
 * F1 (POS redizayn, 2026-08-14): ro'yxat JSX'i va `ChekDetailPanel`
 * `page.tsx` dan XULQNI O'ZGARTIRMASDAN ko'chirildi. Ro'yxat so'rovi va
 * tanlov-holati sahifada QOLADI (Mijozlar paneli ham `setSelectedChekId`
 * orqali shu detalga yo'naltiradi); ChekDetailPanel esa ilgari qanday
 * bo'lsa shunday — o'z so'rov/mutatsiyalarini O'ZI olib yuradi.
 */

import { usePermissions } from '@/hooks/use-permissions';
import { api } from '@/lib/api-client';
import { POS_TZ } from '@/lib/clock';
import { useBcp47 } from '@/lib/i18n-format';
import {
  type RefundTenderChoice,
  applyRefundTenderChoice,
  clampReturnQty,
  normalizeQtyDecimal,
  refundPayoutMinor,
  refundTenderSplit,
  saleCashLikeMinor,
  saleCashUsdMinor,
  saleDebtMinor,
  saleUsdBaseMinor,
} from '@/lib/pos/cart-math';
import { printReceiptViaAgent } from '@/lib/print-agent';
import { Textarea, formatMoney, useConfirm, useToast } from '@moysklad/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type Dispatch, type SetStateAction, useState } from 'react';
import type { SaleRow } from './pos-types';
import { usePrintOutcome } from './use-print-outcome';

// ── Chek detail panel ────────────────────────────────────────────────────────

interface ChekDetailPosition {
  id: string;
  quantity: string;
  priceMinor: string;
  sumMinor: string;
  discount: string;
  product: {
    id: string;
    name: string;
    code: string | null;
    /** Savatga nusxalashda narx-pol/foyda uchun (server `findById` yuboradi). */
    buyPrice?: string | null;
    /** Tannarx valyutasi — dollarda kelgan tovar «$… ≈ …» bo'lib ko'rinsin. */
    buyPriceCurrency?: string | null;
    salePrices?: Array<{ priceTypeId: string; value: string }> | null;
  };
}

/** Sahifaga eksport — «Savatga nusxalash» mapping'i o'sha yerda. */
export type { ChekDetailPosition };
interface ChekDetailData {
  id: string;
  /** Optimistik qulf — tahrir so'roviga AYNAN shu qiymat uzatiladi (409 qo'riqchisi). */
  version: number;
  name: string;
  moment: string;
  state: string;
  sumMinor: string;
  cashAmountMinor: string;
  cardAmountMinor: string;
  terminalAmountMinor: string;
  /**
   * Chek QANDAY yopilgani (`RetailSalePayment`). Qaytarishda naqd ulushi
   * shundan chiqadi — qarzga olingan tovar uchun kassa pul olmagan.
   */
  // `amountMinor` — to'lov valyutasidagi ASL summa (dollar qatorida SENT).
  // Server detal endpointi uni QAYTARADI (`retail-sale.service.ts` findOne
  // select: method/amountMinor/currency/rateMinor/amountBaseMinor) — tip
  // ilgari toroygan edi, shuning uchun dollar sentini o'qib bo'lmasdi.
  payments?: Array<{ method: string; amountMinor: string; amountBaseMinor: string }> | null;
  /** Chek izohi (2026-08-19, egasi). Chekda «Izoh:» qatori bo'lib chiqadi. */
  description?: string | null;
  agent: { id: string; name: string } | null;
  session: {
    cashier: { id: string; name: string };
    cashDesk: { name: string; currency: string } | null;
    store: { name: string } | null;
  };
  positions: ChekDetailPosition[];
}

/**
 * Bekor qilish mumkin bo'lgan holatlar — server `retail-sale-fsm.ts`
 * (`allowedFrom('cancel')`) bilan AYNI ro'yxat. Ikki joyda ikki ro'yxat
 * bo'lsa tugma ko'rinib turib 400 qaytarardi.
 */
const CANCELLABLE_STATES = ['draft', 'picking', 'ready'];

/**
 * Chek holati NISHONI — ro'yxat va detal-panel uchun YAGONA ta'rif
 * (egasi, 2026-08-17: «har bir chekni oldida statusini yozib qo'y»).
 *
 * 🔴 NEGA KERAK: ro'yxatda holat UMUMAN ko'rinmasdi — 31 000 so'mlik
 * «Qoralama» ham, to'langan chek ham, bekor qilingani ham bir xil ko'rinardi.
 * Kassir xato kiritilgan chekni ajratib olishi uchun detalni ochishi shart
 * edi (egasi bugun aynan shu ikki chekni ko'rsatib «olib tashla» degan).
 *
 * Ranglar SEMANTIK: yashil = pul olindi · sariq = hali tugamagan · ko'k =
 * omborchi zanjirida · kulrang = o'lik (bekor) · qizil = qaytarilgan.
 * Ilgari detal panelida shu qaror inline ternar bilan yozilgan edi va
 * ro'yxatda umuman yo'q edi — ikki nusxa bo'lmasligi uchun bitta joyga
 * chiqarildi.
 */
const STATE_TONE: Record<string, string> = {
  posted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  picking: 'bg-sky-50 text-sky-700 border-sky-200',
  ready: 'bg-sky-50 text-sky-700 border-sky-200',
  cancelled: 'bg-[var(--ms-bg-app)] text-[var(--ms-text-muted)] border-[var(--ms-border)]',
  refunded: 'bg-rose-50 text-rose-700 border-rose-200',
};

/** «O'lik» cheklar — sotuv sifatida o'qilmasligi kerak (summa xiralashadi). */
const DEAD_STATES = ['cancelled', 'refunded'];

/** Tarjima kalitlari bitta joyda — ro'yxat va detal bir xil so'zni ko'rsatadi. */
function chekStateLabels(t: (k: string) => string): Record<string, string> {
  return {
    posted: t('state_posted'),
    draft: t('state_draft'),
    picking: t('state_picking'),
    ready: t('state_ready'),
    cancelled: t('state_cancelled'),
    refunded: t('state_refunded'),
  };
}

function ChekStateBadge({ state, label }: { state: string; label: string }) {
  return (
    <span
      data-test-id="chek-state-badge"
      data-state={state}
      className={`shrink-0 rounded-md border px-1.5 py-0.5 font-medium text-[12px] leading-none ${
        STATE_TONE[state] ??
        'bg-[var(--ms-bg-app)] text-[var(--ms-text-muted)] border-[var(--ms-border)]'
      }`}
    >
      {label}
    </span>
  );
}

/**
 * EKSPORT (V2, 2026-09-01): Vozvrat rejimi (`vozvrat-mode.tsx`) ham shu
 * panelni ochadi — qaytarish oqimi BITTA joyda qoladi, nusxa taqiqlanadi.
 */
export function ChekDetailPanel({
  saleId,
  onBack,
  onCopyToCart,
}: {
  saleId: string;
  onBack: () => void;
  onCopyToCart: (positions: ChekDetailPosition[]) => void;
}) {
  const t = useTranslations('pages.sotuv');
  const tCommon = useTranslations('common');
  const bcp47 = useBcp47();
  const { data, isLoading } = useQuery<ChekDetailData>({
    queryKey: ['retail-sale-detail', saleId],
    queryFn: () => api.get(`/retail-sales/${saleId}`),
  });

  const qc = useQueryClient();
  const { toast } = useToast();
  const finishPrint = usePrintOutcome();
  // V2 (egasi, 2026-09-01): qaytarish faqat `salesreturn.create` borga.
  // Ilgari tugma HAMMAGA ko'rinardi — huquqsiz kassir bosib 403 yerdi.
  // Haqiqiy qulf serverda (refund marshruti); bu faqat UX.
  const { can } = usePermissions();
  const canRefund = can('salesreturn', 'create');
  const [returnMode, setReturnMode] = useState(false);
  // positionId → qaytariladigan miqdor, **decimal SATR** (defolt — 0, qarang
  // `startReturn`). FE-02: `number` bo'lganda kassir kasr miqdor kirita
  // olmasdi — «1.» yozilishi bilan nuqta o'chib ketardi, ya'ni og'irlik
  // bilan sotilgan tovarni qisman qaytarib bo'lmasdi.
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  /**
   * V3 (egasi, 2026-09-02) — pul qaysi kanaldan qaytadi. `auto` = chek qanday
   * to'langan bo'lsa shunday (sukut, eski xulq); kassir bosgan zahoti butun
   * so'm ulushi tanlangan kanalga o'tadi va so'rovga `channelOverride`
   * yuboriladi (server kanal cap'ini o'tkazadi, JAMI cap o'z kuchida).
   */
  const [tenderChoice, setTenderChoice] = useState<RefundTenderChoice>('auto');

  const { confirm } = useConfirm();

  /**
   * 🔴 «NAQD kiritilgan, QARZ bo'lishi kerak» (egasi, 2026-08-17).
   *
   * Server yo'li `PATCH /retail-sales/:id/edit` 2026-08-16 dan BOR edi, lekin
   * butun web ilovada unga bironta chaqiruv YO'Q edi — ya'ni xato to'lov
   * turini tuzatishning UMUMAN yo'li yo'q edi (o'lchandi: `grep /edit`).
   *
   * Bu blok FAQAT pul taqsimotini ko'chiradi (naqd ⇄ qarz) va kerak bo'lsa
   * mijozni biriktiradi. Tovar tarkibi ATAYLAB tegilmaydi — serverning o'zi
   * uni rad etadi («qaytarishdan foydalaning»), chunki tovar o'zgarishi ombor
   * va tan narxni qayta yozishni talab qiladi.
   *
   * Modal EMAS — ichki blok (qobiqda Radix modali ekran-klaviaturasini
   * o'ldiradi; qaytarish bloki bilan bir naqsh).
   */
  /**
   * CHEK IZOHI (2026-08-19, egasi: «har bir chekka izoh»). Yopilgan chekda ham
   * tahrirlanadi — server tor yo'l bilan (`PATCH :id/comment`) faqat shu
   * maydonni yozadi, pul/ombor/holatga tegmaydi va har o'zgarish `AuditLog`
   * ga tushadi (kim, qachon, eski → yangi).
   */
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  /** Qarzga yoziladigan qism (tiyin, satr) — naqd = jami − shu. */
  const [editDebtMinor, setEditDebtMinor] = useState('0');
  const [editAgent, setEditAgent] = useState<{ id: string; name: string } | null>(null);
  const [agentSearch, setAgentSearch] = useState('');

  const agentOptions = useQuery<{ items: Array<{ id: string; name: string; phone?: string }> }>({
    queryKey: ['chek-edit-agents', agentSearch],
    queryFn: () => api.get(`/counterparties?search=${encodeURIComponent(agentSearch)}&limit=8`),
    enabled: editOpen && agentSearch.trim().length > 0,
  });

  const editMut = useMutation({
    mutationFn: (body: {
      version: number;
      paidMinor: string;
      debtMinor: string;
      agentId?: string;
    }) => api.patch(`/retail-sales/${saleId}/edit`, body),
    onSuccess: () => {
      toast.success(t('chek_edit_success'));
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ['retail-sale-detail', saleId] });
      qc.invalidateQueries({ queryKey: ['retail-sales-session'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commentMut = useMutation({
    mutationFn: (body: { version: number; description: string | null }) =>
      api.patch(`/retail-sales/${saleId}/comment`, body),
    onSuccess: () => {
      toast.success(t('chek_comment_saved'));
      setCommentOpen(false);
      qc.invalidateQueries({ queryKey: ['retail-sale-detail', saleId] });
      qc.invalidateQueries({ queryKey: ['retail-sales-session'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * ❌ NOTO'G'RI KIRITILGAN CHEKNI BEKOR QILISH (egasi, 2026-08-16).
   *
   * 🔴 MUAMMO (jonli): kassa ro'yxatida `draft` («Qoralama») chek qolib
   * ketsa, uni olib tashlashning HECH QANDAY yo'li yo'q edi — panelda faqat
   * chop, savatga nusxalash va `posted` uchun qaytarish bor edi. Natijada
   * xato kiritilgan chek smena ro'yxatini abadiy iflos qilardi.
   *
   * Bekor qilish — O'CHIRISH EMAS: hujjat `cancelled` holatiga o'tadi
   * (audit izi qoladi), rezerv bo'shaydi, omborchining ochiq yig'ish
   * topshiriqlari yopiladi. Server FSM'i faqat `draft|picking|ready` dan
   * ruxsat beradi — ya'ni TO'LANGAN chek bu yo'l bilan yo'qolmaydi, unga
   * faqat QAYTARISH (pul harakati bilan) qo'llanadi.
   */
  const cancelMut = useMutation({
    mutationFn: () => api.post(`/retail-sales/${saleId}/cancel`, {}),
    onSuccess: () => {
      toast.success(t('cancel_sale_success'));
      qc.invalidateQueries({ queryKey: ['retail-sale-detail', saleId] });
      qc.invalidateQueries({ queryKey: ['retail-sales-session'] });
      onBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refundMut = useMutation({
    mutationFn: async () => {
      const refundLines = (data?.positions ?? []).filter(
        (p) => normalizeQtyDecimal(returnQty[p.id] ?? '') !== '0',
      );
      if (refundLines.length === 0) throw new Error(t('refund_no_lines'));
      const positions = refundLines.map((p) => ({
        productId: p.product.id,
        // Server sxemasi `^\d+(\.\d{1,6})?$` — «1.» yoki eksponent shakl 400 berardi.
        quantity: normalizeQtyDecimal(returnQty[p.id] ?? ''),
      }));
      // FE-01: naqd asl chekning CHEGIRMALI qator summasidan proporsional —
      // `priceMinor × qty` mijoz to'lamagan pulni qaytarardi. Server ham
      // aynan shu bazadan hisoblaydi va oshib ketsa 400 beradi.
      const refundValue = refundPayoutMinor(
        refundLines.map((p) => ({
          quantity: p.quantity,
          sumMinor: p.sumMinor,
          returnQty: normalizeQtyDecimal(returnQty[p.id] ?? ''),
        })),
      );
      // AUDIT: qarzga sotilgan chekda kassa PUL OLMAGAN — to'liq naqd
      // so'rasak server `moneyMaxMinor` bilan 400 berardi va bunday chekni
      // POS'dan umuman qaytarib bo'lmasdi. Qarz ulushi (`debtReturnMinor`)
      // ATAYLAB yuborilmaydi: server uni o'zi hisoblaydi (auto-split).
      //
      // P5: pul ulushi endi KANAL bo'yicha ham bo'linadi — yashiq olgani
      // naqd, bank orqali kelgani karta qatoriga. Aks holda karta/terminal
      // chek serverning `cashMaxMinor` qo'riqchisiga urilib qaytarilmasdi.
      //
      // V3: kassir kanalni tanlagan bo'lsa (`tenderChoice`) butun so'm ulushi
      // o'sha kanalga yig'iladi va `channelOverride` yuboriladi.
      const split = applyRefundTenderChoice(
        refundTenderSplit({
          originalSumMinor: BigInt(data?.sumMinor ?? '0'),
          originalDebtMinor: saleDebtMinor(data?.payments),
          originalCashLikeMinor: saleCashLikeMinor(data?.payments),
          // 2026-08-17: dollar ulushi O'Z birligida (sent) qaytadi. Busiz server
          // `moneyMax` qo'riqchisi dollarli chekni RAD etadi — ya'ni bu qator
          // bo'lmasa dollarli chekni POS'dan umuman qaytarib bo'lmaydi.
          originalCashUsdMinor: saleCashUsdMinor(data?.payments),
          originalUsdBaseMinor: saleUsdBaseMinor(data?.payments),
          refundSumMinor: refundValue,
        }),
        tenderChoice,
      );
      await api.post(`/retail-sales/${saleId}/refund`, {
        positions,
        cashAmountMinor: split.cashMinor.toString(),
        cardAmountMinor: split.cardMinor.toString(),
        cashUsdReturnMinor: split.usdMinor.toString(),
        // V3 — kassir kanalni O'ZI tanladi: server KANAL cap'ini o'tkazadi
        // (JAMI cap emas — olganidan ko'p pul baribir chiqmaydi).
        ...(tenderChoice === 'auto' ? {} : { channelOverride: true }),
        // ⚠️ i18n-emas, ATAYLAB: bu hujjatning DB'da saqlanadigan izohi, ekran
        // matni emas. Kassirning tiliga bog'lasak bir xil hujjat kim yaratganiga
        // qarab turlicha yozilib qolardi (hisobot/qidiruv buziladi).
        description: 'POS qaytarish',
      });
    },
    onSuccess: () => {
      toast.success(t('refund_success'));
      setReturnMode(false);
      setReturnQty({});
      setTenderChoice('auto');
      qc.invalidateQueries({ queryKey: ['retail-sale-detail', saleId] });
      qc.invalidateQueries({ queryKey: ['retail-sales-session'] });
      // V2 — Vozvrat rejimi ro'yxati ham yangilansin (to'liq qaytarilgan chek
      // `posted` dan chiqadi va ro'yxatdan yo'qolishi kerak).
      qc.invalidateQueries({ queryKey: ['pos-vozvrat-cheklar'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Qaytarish 0 dan boshlanadi (2026-09-01, kassir shikoyati): avval har
   * qator TO'LIQ soni bilan ochilardi — bitta tovarni qaytarish uchun qolgan
   * hammasini qo'lda 0 ga tushirish kerak edi va bexosdan to'liq vozvrat
   * o'tkazib yuborish xavfi bor edi. To'liq qaytarish uchun «Hammasini
   * qaytarish» tugmasi va qatordagi «/ N» bosiladi.
   */
  const startReturn = () => {
    setReturnQty(Object.fromEntries((data?.positions ?? []).map((p) => [p.id, '0'])));
    setTenderChoice('auto');
    setReturnMode(true);
  };

  const fillAllReturn = () => {
    setReturnQty(
      Object.fromEntries(
        (data?.positions ?? []).map((p) => [p.id, normalizeQtyDecimal(p.quantity)]),
      ),
    );
  };

  if (isLoading || !data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--ms-text-muted)]">
        {t('loading')}
      </div>
    );
  }

  const cash = BigInt(data.cashAmountMinor ?? '0');
  const card = BigInt(data.cardAmountMinor ?? '0');
  const terminal = BigInt(data.terminalAmountMinor ?? '0');
  const stateLabel = chekStateLabels(t);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
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
          <div className="text-xs text-[var(--ms-text-muted)]">
            {new Date(data.moment).toLocaleString(bcp47, {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              // Server `moment`i do'kon mintaqasida o'qiladi (S-reja S4) —
              // qurilma TZ'i adashsa chek sanasi kunga siljib ko'rinardi.
              timeZone: POS_TZ,
            })}
            {' · '}
            <ChekStateBadge state={data.state} label={stateLabel[data.state] ?? data.state} />
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            // Same routing as a fresh sale: agent → configured receipt printer,
            // else the browser popup (qobiqda esa — ogohlantirish).
            const outcome = await printReceiptViaAgent(data.id);
            await finishPrint(outcome, { url: `/print/retail-sale/${data.id}?auto=1` });
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ms-border)] px-3 text-xs font-medium text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
        >
          🖨 {t('receipt')}
        </button>
        {/* «TAHRIRLASH» = SAVATGA NUSXALASH (2026-08-16, egasi). To'langan
            chekning O'ZI o'zgartirilmaydi (buxgalteriya/ombor buziladi —
            buning uchun qaytarish bor): pozitsiyalar savatga ko'chadi,
            kassir o'zgartirib yangi sotuv qiladi yoki sotuvsiz chek
            chiqaradi. Asl chekka yozuv so'rovi KETMAYDI. */}
        <button
          type="button"
          data-test-id="chek-copy-to-cart"
          onClick={() => onCopyToCart(data.positions)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ms-border)] px-3 font-medium text-[var(--ms-text-brand)] text-xs hover:bg-[var(--ms-bg-hover)]"
        >
          ✎ {t('chek_copy_to_cart')}
        </button>
        {/* F6 (egasi qarori, 2026-08-13) — QAYTARISH KIOSKDA HAM OCHIQ.
            2026-08-12 dagi «kassadan pul chiqishi menejer qarori» yashirishi
            (`!isKiosk` sharti) egasi tomonidan BEKOR qilindi: «kassir
            istalgan chekga vozvrat qilishi kerak». Server tomonda kassirga
            `salesreturn.view/create` berildi (role-templates F6) — tugma
            endi 403 bermaydi. ⚠️ Haqiqiy qulf avvalgidek serverdagi ruxsat
            matritsasida (`retail-sale-lifecycle-permissions.test.ts`). */}
        {/* Bekor qilish FAQAT to'lanmagan holatlarda — server FSM'i bilan
            AYNI ro'yxat (`draft|picking|ready`). To'langan chekda bu tugma
            YO'Q: u yerda pul harakati bor, yagona to'g'ri yo'l — qaytarish. */}
        {CANCELLABLE_STATES.includes(data.state) && (
          <button
            type="button"
            data-test-id="chek-cancel"
            disabled={cancelMut.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: t('cancel_sale_confirm', {
                  name: data.name,
                  sum: formatMoney(BigInt(data.sumMinor ?? '0')),
                }),
                confirmLabel: t('cancel_sale_confirm_label'),
                tone: 'destructive',
              });
              if (ok) cancelMut.mutate();
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ms-destructive-500)] px-3 font-medium text-[var(--ms-destructive-500)] text-xs hover:bg-[var(--ms-bg-hover)]"
          >
            ✕ {tCommon('delete')}
          </button>
        )}
        {/* «Naqd/qarz» ni tuzatish — faqat to'langan chekda (server ham
            shunday: `edit()` `state !== 'posted'` ni rad etadi). */}
        {data.state === 'posted' && !returnMode && (
          <button
            type="button"
            data-test-id="chek-edit-open"
            onClick={() => {
              // Ochilganda joriy taqsimot ko'rsatiladi: qarz = jami − to'langan.
              setEditDebtMinor(String(saleDebtMinor(data.payments)));
              setEditAgent(data.agent);
              setAgentSearch('');
              setEditOpen((v) => !v);
            }}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 font-medium text-xs ${
              editOpen
                ? 'border-[var(--ms-text-brand)] text-[var(--ms-text-brand)]'
                : 'border-[var(--ms-border)] hover:bg-[var(--ms-bg-hover)]'
            }`}
          >
            ✎ {t('chek_edit')}
          </button>
        )}
        {/* IZOH — chekning har qanday holatida (izoh pulga tegmaydi). */}
        {!returnMode && (
          <button
            type="button"
            data-test-id="chek-comment-open"
            onClick={() => {
              setCommentDraft(data.description ?? '');
              setCommentOpen((v) => !v);
            }}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 font-medium text-xs ${
              commentOpen
                ? 'border-[var(--ms-text-brand)] text-[var(--ms-text-brand)]'
                : 'border-[var(--ms-border)] hover:bg-[var(--ms-bg-hover)]'
            }`}
          >
            ✎ {t('chek_comment')}
          </button>
        )}
        {data.state === 'posted' &&
          canRefund &&
          (returnMode ? (
            <button
              type="button"
              onClick={() => setReturnMode(false)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ms-border)] px-3 text-xs font-medium text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
            >
              {tCommon('cancel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={startReturn}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ms-destructive-500)] px-3 text-xs font-bold text-white hover:opacity-90"
            >
              ↩ {t('refund')}
            </button>
          ))}
      </div>

      {/* 🔴 `[&>*]:shrink-0` SHART (2026-08-17, egasi: «chekni scrol qilib
          bo'lmayapti»). Brauzerda o'lchandi: scroll konteyneri `flex flex-col`
          bo'lgani uchun farzandlar sukut bo'yicha `flex-shrink: 1` bilan
          QISILARDI — pozitsiyalar bloki 71,7px dan 4,3px ga ezilib,
          `scrollHeight === clientHeight` bo'lib qolardi, ya'ni oshib chiqmagani
          uchun SCROLL UMUMAN paydo bo'lmasdi. Farzandlar qisilmasa kontent
          tabiiy balandligini oladi (186 → 254px) va panel scroll bo'ladi. */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 [&>*]:shrink-0">
        {/* ── CHEK IZOHI ────────────────────────────────────────────────
            Modal EMAS — ichki blok (qobiqda Radix modali ekran-klaviaturasini
            o'ldiradi; tahrir/qaytarish bloklari bilan bir naqsh). */}
        {commentOpen ? (
          <div
            data-test-id="chek-comment-panel"
            className="flex flex-col gap-2 rounded-xl border border-[var(--ms-text-brand)] p-3"
          >
            <p className="text-[var(--ms-text-muted)] text-xs">{t('chek_comment_hint')}</p>
            <Textarea
              rows={3}
              maxLength={400}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              data-test-id="chek-comment-input"
              className="w-full resize-none text-[14px]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCommentOpen(false)}
                className="h-9 flex-1 rounded-lg border border-[var(--ms-border)] text-xs hover:bg-[var(--ms-bg-hover)]"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                data-test-id="chek-comment-save"
                disabled={commentMut.isPending}
                onClick={() =>
                  commentMut.mutate({
                    version: data.version,
                    // Bo'sh matn — izohni OLIB TASHLASH (server ham `null` ga
                    // tushiradi): chekda bo'sh «Izoh:» qatori qolmasin.
                    description: commentDraft.trim() ? commentDraft.trim() : null,
                  })
                }
                className="h-9 flex-1 rounded-lg bg-[var(--ms-text-brand)] font-bold text-white text-xs disabled:opacity-50"
              >
                {tCommon('save')}
              </button>
            </div>
          </div>
        ) : (
          data.description?.trim() && (
            <div
              data-test-id="chek-comment-text"
              className="rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-app)] px-3 py-2 text-[13px]"
            >
              <span className="text-[var(--ms-text-muted)]">{t('chek_comment')}: </span>
              <span className="break-words">{data.description}</span>
            </div>
          )
        )}

        {/* ── «Naqd ⇄ qarz» tuzatish bloki ─────────────────────────────── */}
        {editOpen && data.state === 'posted' && (
          <div
            data-test-id="chek-edit-panel"
            className="flex flex-col gap-3 rounded-xl border border-[var(--ms-text-brand)] p-3"
          >
            <p className="text-[var(--ms-text-muted)] text-xs">{t('chek_edit_hint')}</p>

            <div className="flex gap-2">
              <button
                type="button"
                data-test-id="chek-edit-all-debt"
                onClick={() => setEditDebtMinor(data.sumMinor)}
                className="h-9 flex-1 rounded-lg border border-[var(--ms-border)] text-xs hover:bg-[var(--ms-bg-hover)]"
              >
                {t('chek_edit_all_debt')}
              </button>
              <button
                type="button"
                data-test-id="chek-edit-all-cash"
                onClick={() => setEditDebtMinor('0')}
                className="h-9 flex-1 rounded-lg border border-[var(--ms-border)] text-xs hover:bg-[var(--ms-bg-hover)]"
              >
                {t('chek_edit_all_cash')}
              </button>
            </div>

            {/* Yig'iladigan uch raqam — kassir o'zi tekshira oladi. */}
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--ms-text-muted)]">{t('chek_edit_total')}</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(BigInt(data.sumMinor))}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ms-text-muted)]">{t('chek_edit_debt')}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  data-test-id="chek-edit-debt-input"
                  value={editDebtMinor}
                  onChange={(e) => setEditDebtMinor(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-9 w-40 rounded-lg border border-[var(--ms-border)] px-2 text-right text-sm tabular-nums outline-none focus:border-[var(--ms-primary-500)]"
                />
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--ms-text-muted)]">{t('chek_edit_paid')}</span>
                <span className="tabular-nums" data-test-id="chek-edit-paid-value">
                  {formatMoney(BigInt(data.sumMinor) - BigInt(editDebtMinor || '0'))}
                </span>
              </div>
            </div>

            {/* Qarz KIMGA yozilishi kerak — qarz > 0 bo'lsa mijoz SHART
                (serverning `planReceiptEdit` qo'riqchisi ham shunday). */}
            {BigInt(editDebtMinor || '0') > 0n && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[var(--ms-text-muted)] text-xs">
                  {t('chek_edit_customer')}
                </span>
                {editAgent ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--ms-bg-app)] px-2 py-1.5 text-sm">
                    <span className="truncate font-medium">{editAgent.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditAgent(null)}
                      className="shrink-0 text-[var(--ms-text-muted)] text-xs hover:underline"
                    >
                      {tCommon('cancel')}
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      data-test-id="chek-edit-agent-search"
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      placeholder={t('chek_edit_customer_search')}
                      className="h-9 rounded-lg border border-[var(--ms-border)] px-2 text-sm outline-none focus:border-[var(--ms-primary-500)]"
                    />
                    {(agentOptions.data?.items ?? []).map((cp) => (
                      <button
                        key={cp.id}
                        type="button"
                        data-test-id="chek-edit-agent-option"
                        onClick={() => setEditAgent({ id: cp.id, name: cp.name })}
                        className="h-9 truncate rounded-lg border border-[var(--ms-border)] px-2 text-left text-sm hover:bg-[var(--ms-bg-hover)]"
                      >
                        {cp.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              data-test-id="chek-edit-save"
              disabled={
                editMut.isPending ||
                BigInt(editDebtMinor || '0') > BigInt(data.sumMinor) ||
                (BigInt(editDebtMinor || '0') > 0n && !editAgent)
              }
              onClick={() =>
                editMut.mutate({
                  version: data.version,
                  debtMinor: editDebtMinor || '0',
                  paidMinor: String(BigInt(data.sumMinor) - BigInt(editDebtMinor || '0')),
                  ...(editAgent ? { agentId: editAgent.id } : {}),
                })
              }
              className="h-10 rounded-lg bg-[var(--ms-bg-brand)] font-semibold text-sm text-white disabled:opacity-50"
            >
              {tCommon('save')}
            </button>
          </div>
        )}

        {/* Kassir + mijoz */}
        <div className="rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-app)] divide-y divide-[var(--ms-border)]">
          <div className="flex justify-between px-4 py-2.5 text-sm">
            <span className="text-[var(--ms-text-muted)]">{t('cashier')}</span>
            <span className="font-medium">{data.session.cashier.name}</span>
          </div>
          {data.session.store && (
            <div className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-[var(--ms-text-muted)]">{t('shop')}</span>
              <span className="font-medium">{data.session.store.name}</span>
            </div>
          )}
          {data.agent && (
            <div className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-[var(--ms-text-muted)]">{t('customer')}</span>
              <span className="font-medium text-[var(--ms-text-brand)]">{data.agent.name}</span>
            </div>
          )}
        </div>

        {/* Positions */}
        <div
          data-test-id="chek-positions-card"
          className="rounded-xl border border-[var(--ms-border)] overflow-hidden"
        >
          <div className="flex items-center justify-between bg-[var(--ms-bg-app)] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ms-text-muted)]">
            <span>{t('products')}</span>
            {returnMode && (
              <button
                type="button"
                onClick={fillAllReturn}
                data-test-id="pos-refund-fill-all"
                className="rounded border border-[var(--ms-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--ms-text-brand)] hover:bg-[var(--ms-bg-hover)]"
              >
                {t('refund_fill_all')}
              </button>
            )}
          </div>
          <div className="divide-y divide-[var(--ms-border)]">
            {data.positions.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--ms-text-primary)]">
                    {p.product.name}
                  </div>
                  {p.product.code && (
                    <div className="text-xs text-[var(--ms-text-muted)]">{p.product.code}</div>
                  )}
                </div>
                {returnMode && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-[var(--ms-text-muted)]">
                      {t('refund_qty_label')}
                    </span>
                    {/* `type="number"` EMAS: brauzer «1.» oraliq holatini
                        bo'sh satr sifatida qaytaradi va kasr miqdorni
                        yozib bo'lmaydi (FE-02). */}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={returnQty[p.id] ?? ''}
                      onChange={(e) =>
                        setReturnQty((prev) => ({
                          ...prev,
                          [p.id]: clampReturnQty(e.target.value, p.quantity),
                        }))
                      }
                      className="w-14 rounded border border-[var(--ms-border)] bg-[var(--ms-bg-input)] px-1.5 py-0.5 text-right text-sm tabular-nums focus:border-[var(--ms-border-focus)] focus:outline-none"
                    />
                    {/* «/ N» tugma: bosilsa shu qator to'liq soniga to'ladi. */}
                    <button
                      type="button"
                      onClick={() =>
                        setReturnQty((prev) => ({
                          ...prev,
                          [p.id]: normalizeQtyDecimal(p.quantity),
                        }))
                      }
                      className="text-xs text-[var(--ms-text-brand)] underline decoration-dotted underline-offset-2 hover:opacity-80"
                    >
                      / {Number(p.quantity)}
                    </button>
                  </div>
                )}
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-[var(--ms-text-primary)]">
                    {formatMoney(BigInt(p.sumMinor))}
                  </div>
                  <div className="text-xs text-[var(--ms-text-muted)] tabular-nums">
                    {Number(p.quantity)} × {formatMoney(BigInt(p.priceMinor))}
                    {Number(p.discount) > 0 && ` −${p.discount}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment breakdown */}
        <div className="rounded-xl border border-[var(--ms-border)] bg-[var(--ms-bg-app)] divide-y divide-[var(--ms-border)]">
          {cash > 0n && (
            <div className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-[var(--ms-text-muted)]">{t('cash')}</span>
              <span className="font-medium tabular-nums">{formatMoney(cash)}</span>
            </div>
          )}
          {card > 0n && (
            <div className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-[var(--ms-text-muted)]">{t('card')}</span>
              <span className="font-medium tabular-nums">{formatMoney(card)}</span>
            </div>
          )}
          {terminal > 0n && (
            <div className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-[var(--ms-text-muted)]">{t('terminal')}</span>
              <span className="font-medium tabular-nums">{formatMoney(terminal)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-3 text-base font-bold">
            <span>{t('total')}</span>
            <span className="tabular-nums">{formatMoney(BigInt(data.sumMinor))}</span>
          </div>
        </div>
      </div>

      {returnMode && (
        <div className="shrink-0 border-t border-[var(--ms-border)] bg-[var(--ms-bg-surface)] p-4">
          {(() => {
            // Ekranda ko'rinadigan raqam so'rovga ketadigani bilan bir xil
            // formuladan chiqsin (FE-01) — aks holda kassir bir summani
            // ko'rib boshqasini yuborardi.
            const refundValue = refundPayoutMinor(
              data.positions.map((p) => ({
                quantity: p.quantity,
                sumMinor: p.sumMinor,
                returnQty: normalizeQtyDecimal(returnQty[p.id] ?? ''),
              })),
            );
            const saleDebt = saleDebtMinor(data.payments);
            // P5: ekran ham AYNI bo'linishni ko'rsatadi — kassir «naqd
            // beraman» deb turib server 400 bermasin, va mijozga qaysi
            // kanaldan pul qaytishini aytа olsin.
            // V3: ekran ham AYNI kanal tanlovini qo'llaydi (FE-01 intizomi —
            // bitta formula), so'rov `refundMut` da shu funksiyani ishlatadi.
            const autoSplit = refundTenderSplit({
              originalSumMinor: BigInt(data.sumMinor),
              originalDebtMinor: saleDebt,
              originalCashLikeMinor: saleCashLikeMinor(data.payments),
              originalCashUsdMinor: saleCashUsdMinor(data.payments),
              originalUsdBaseMinor: saleUsdBaseMinor(data.payments),
              refundSumMinor: refundValue,
            });
            const split = applyRefundTenderChoice(autoSplit, tenderChoice);
            const refundMinor = split.cashMinor;
            // Tanlagich faqat qaytariladigan SO'M puli bo'lganda ma'noli:
            // to'liq qarzli chekda pul chiqmaydi, tanlashga narsa yo'q.
            const moneyMinor = split.cashMinor + split.cardMinor;
            // Sukut (`auto`) holatida ham kassir qaysi kanal ishlayotganini
            // ko'rib tursin — yolg'iz kanal bo'lsa o'sha tugma yoritiladi.
            const activeChoice: RefundTenderChoice =
              tenderChoice !== 'auto'
                ? tenderChoice
                : autoSplit.cardMinor === 0n
                  ? 'cash'
                  : autoSplit.cashMinor === 0n
                    ? 'card'
                    : 'auto';
            // Qarzdan yechiladigan qism — serverning auto-split'i aynan shu
            // qoldiqni yozadi. Kassir mijozga «pulingiz emas, qarzingiz
            // kamayadi» deyishi uchun ekranda ko'rinishi SHART.
            //
            // P5: KARTA ulushi ham chegiriladi — aks holda bank orqali
            // qaytadigan summa «qarzdan yechiladi» bo'lib ko'rinardi.
            const refundDebtMinor = refundValue - split.cashMinor - split.cardMinor;
            return (
              <>
                {/* V3 (egasi, 2026-09-02): «pul qaytarganda naqd/karta tanlash
                    imkoni bo'lsin». Tanlangach butun so'm ulushi o'sha
                    kanalga o'tadi; server kanal cap'ini o'tkazadi, jami cap
                    esa o'z kuchida (olganidan ko'p pul chiqmaydi). */}
                {moneyMinor > 0n && (
                  <div className="mb-3 flex items-center gap-2" data-test-id="pos-refund-tender">
                    <span className="shrink-0 text-sm text-[var(--ms-text-muted)]">
                      {t('refund_tender_label')}
                    </span>
                    {(['cash', 'card'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        data-test-id={`pos-refund-tender-${k}`}
                        data-active={activeChoice === k || undefined}
                        onClick={() => setTenderChoice(k)}
                        className={`h-9 flex-1 rounded-lg border text-sm font-semibold transition-colors ${
                          activeChoice === k
                            ? 'border-[var(--ms-primary-500)] bg-[var(--ms-primary-500)] text-white'
                            : 'border-[var(--ms-border)] text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]'
                        }`}
                      >
                        {k === 'cash' ? t('refund_tender_cash') : t('refund_tender_card')}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-[var(--ms-text-muted)]">
                    {t('refund_amount_cash')}
                  </span>
                  <span className="font-bold text-lg tabular-nums text-[var(--ms-destructive-500)]">
                    {formatMoney(refundMinor)}
                  </span>
                </div>
                {split.cardMinor > 0n && (
                  <div
                    className="mb-3 flex items-start justify-between gap-3"
                    data-test-id="pos-refund-card-share"
                  >
                    <span className="text-sm text-[var(--ms-text-muted)]">
                      {t('refund_amount_card')}
                      {/* Eslatma faqat AVTOMATIK taqsimotda o'rinli: kassir
                          kanalni o'zi tanlagan bo'lsa «naqd berilmaydi» yolg'on
                          bo'lardi (V3). */}
                      {tenderChoice === 'auto' && (
                        <span className="mt-0.5 block text-[11px] text-[var(--ms-text-muted)]">
                          {t('refund_amount_card_hint')}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--ms-text-primary)]">
                      {formatMoney(split.cardMinor)}
                    </span>
                  </div>
                )}
                {split.usdMinor > 0n && (
                  <div
                    className="mb-3 flex items-start justify-between gap-3"
                    data-test-id="pos-refund-usd-share"
                  >
                    <span className="text-sm text-[var(--ms-text-muted)]">
                      {t('refund_amount_usd')}
                      <span className="mt-0.5 block text-[11px] text-[var(--ms-text-muted)]">
                        {t('refund_amount_usd_hint')}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--ms-text-primary)]">
                      {`$${(Number(split.usdMinor) / 100).toFixed(2)}`}
                    </span>
                  </div>
                )}
                {saleDebt > 0n && refundDebtMinor > 0n && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm text-[var(--ms-text-muted)]">
                      {t('refund_amount_debt')}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--ms-text-primary)]">
                      {formatMoney(refundDebtMinor)}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  // Qaytariladigan QIYMAT nolga teng bo'lsagina bloklanadi —
                  // to'liq qarzli chekda naqd 0 bo'ladi, lekin qaytarish
                  // O'ZI to'g'ri amal (qarz yechiladi).
                  disabled={refundValue <= 0n || refundMut.isPending}
                  onClick={() => refundMut.mutate()}
                  className="w-full rounded-xl bg-[var(--ms-destructive-500)] py-3 font-bold text-white hover:opacity-90 disabled:opacity-40"
                >
                  {refundMut.isPending ? t('refunding') : `↩ ${t('refund_confirm')}`}
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Cheklar rejimi (ro'yxat + detal) ────────────────────────────────────────

interface CheklarModeProps {
  cheklar: { items: SaleRow[]; total: number } | undefined;
  chekSearch: string;
  setChekSearch: Dispatch<SetStateAction<string>>;
  /** Tanlangan chek — holat sahifada (Mijozlar paneli ham shu yerga yo'naltiradi). */
  selectedChekId: string | null;
  setSelectedChekId: Dispatch<SetStateAction<string | null>>;
  /** «Savatga nusxalash» (2026-08-16) — savat sahifada, panel faqat uzatadi. */
  onCopyToCart: (positions: ChekDetailPosition[]) => void;
}

export function CheklarMode({
  cheklar,
  chekSearch,
  setChekSearch,
  selectedChekId,
  setSelectedChekId,
  onCopyToCart,
}: CheklarModeProps) {
  const t = useTranslations('pages.sotuv');
  const bcp47 = useBcp47();
  const listStateLabel = chekStateLabels(t);
  const chekQuery = chekSearch.trim();

  // F4 (spec §5.3) — to'liq-ekran: chapda ro'yxat (64px qatorlar), o'ngda
  // detal-panel. Detal ilgari ro'yxat O'RNIGA chizilardi; endi yonma-yon —
  // funksional 1:1 (qidiruv, qaytarish, qayta chop o'sha panel/holatlar).
  // ⚠️ Qator chek RAQAMINI ko'rsatmaydi (ilgari ham shunday): mavjud
  // testlar «CHEK-xxxxx» faqat detalda ko'rinishiga qulflangan.
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Chap: qidiruv + ro'yxat ── */}
      <div className="flex w-[400px] shrink-0 flex-col overflow-hidden border-[var(--ms-border)] border-r">
        {/* F6.C — istalgan chekni topish (barcha smenalar bo'ylab). */}
        <div className="shrink-0 border-b border-[var(--ms-border)] p-2">
          <input
            type="text"
            data-test-id="sotuv-chek-search"
            value={chekSearch}
            onChange={(e) => setChekSearch(e.target.value)}
            placeholder={t('chek_search_placeholder')}
            className="h-[48px] w-full rounded-lg border border-[var(--ms-border)] bg-[var(--ms-bg-app)] px-3 text-[16px] outline-none focus:border-[var(--ms-primary-500)]"
          />
        </div>
        {!cheklar || cheklar.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[var(--ms-text-muted)]">
            <Receipt className="h-8 w-8 opacity-40" />
            <span className="text-[16px]">
              {chekQuery ? t('chek_search_empty') : t('receipts_empty')}
            </span>
          </div>
        ) : (
          <div className="flex flex-1 flex-col divide-y divide-[var(--ms-border)] overflow-y-auto">
            {cheklar.items.map((sale, i) => (
              <button
                type="button"
                key={sale.id}
                onClick={() => setSelectedChekId(sale.id)}
                data-selected={selectedChekId === sale.id || undefined}
                className="flex min-h-[var(--pos-row-h)] w-full shrink-0 items-center gap-3 px-4 text-left hover:bg-[var(--ms-bg-hover)] active:bg-[var(--ms-bg-hover)] data-[selected]:bg-[var(--pos-brand)]/10"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ms-bg-app)] text-[14px] font-medium text-[var(--ms-text-muted)]">
                  {cheklar.items.length - i}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[18px] font-semibold tabular-nums ${
                        DEAD_STATES.includes(sale.state)
                          ? 'text-[var(--ms-text-muted)] line-through'
                          : 'text-[var(--ms-text-primary)]'
                      }`}
                    >
                      {formatMoney(BigInt(sale.sumMinor))}
                    </span>
                    <span className="shrink-0 text-[14px] text-[var(--ms-text-muted)]">
                      {new Date(sale.moment).toLocaleTimeString(bcp47, {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: POS_TZ,
                      })}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[14px] text-[var(--ms-text-muted)]">
                    {/* Holat — ma'lumot satrining ENG CHAPIDA: pul eng katta
                        element bo'lib qoladi, holat esa birinchi o'qiladigan
                        yorliq. */}
                    <ChekStateBadge
                      state={sale.state}
                      label={listStateLabel[sale.state] ?? sale.state}
                    />
                    {/* Server include'i buni kafolatlaydi (qo'riqchi:
                        api → retail-sale-list-contract.test.ts), lekin
                        kassir ismi — kosmetik maydon: u yetib kelmasa
                        butun POS ekrani oq bo'lib qolmasin. */}
                    <span className="truncate">{sale.session.cashier?.name ?? ''}</span>
                    {sale.agent && (
                      <>
                        <span>·</span>
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{sale.agent.name}</span>
                      </>
                    )}
                    {sale._count && (
                      <>
                        <span>·</span>
                        <span className="shrink-0">
                          {t('items_count', { n: sale._count.positions })}
                        </span>
                      </>
                    )}
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
        {selectedChekId ? (
          <ChekDetailPanel
            saleId={selectedChekId}
            onBack={() => setSelectedChekId(null)}
            onCopyToCart={onCopyToCart}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--ms-text-muted)]">
            <Receipt className="h-12 w-12 opacity-30" />
            <span className="text-[18px]">{t('chek_detail_placeholder')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
