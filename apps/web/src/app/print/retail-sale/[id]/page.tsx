'use client';

/**
 * KASSA CHEKI — mijozga beriladigan qog'oz (brauzer popup'i).
 *
 * 2026-08-12: egasi bergan namunaga (`chek.png`) o'tkazildi. Ilgari bu sahifa
 * o'zining `monospace` «termal tasma» ko'rinishini chizardi — buyurtma/
 * jo'natma cheklaridan butunlay boshqacha edi va namunadagi bloklar
 * (o'lchov birligi ustuni, chegirma qatori, nomenklatura soni, summa so'z
 * bilan, huquqiy izoh) YO'Q edi.
 *
 * Endi shablon YAGONA: `TovarChek` — xuddi `customer-order` / `demand` /
 * `sales-return` chekiday. Farqi bitta: kassa chekida to'lov qatorlari ham
 * bosiladi (sabab `receipt-model.ts` da).
 *
 * 🔴 Bu sahifa — ZAXIRA yo'l. Haqiqiy chop odatda agent (ESC/POS matn) yoki
 * Electron (HTML) orqali ketadi; uchalasi ham `buildReceiptModel` dan
 * oziqlanadi, ya'ni bir joyda o'zgartirish qolganini eskirtirmaydi
 * (xotira: `ombor-chek-uch-renderer`).
 */

import { ThermalShell } from '@/components/print/thermal-shell';
import { type ChekPosition, TovarChek } from '@/components/print/tovar-chek';
import { api } from '@/lib/api-client';
import { fetchDebtAfter } from '@/lib/pos/receipt-debt';
import { buildReceiptModel } from '@/lib/pos/receipt-model';
import type { ReceiptPaymentRow } from '@/lib/pos/receipt-payments';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useParams, useSearchParams } from 'next/navigation';

interface PositionDetail {
  id: string;
  position: number;
  quantity: string;
  priceMinor: string;
  discount: string;
  sumMinor: string;
  product: { id: string; name: string; code: string | null; uom: string | null } | null;
}

interface RetailSaleDetail {
  id: string;
  name: string;
  /**
   * Kunlik chek raqami (2026-09-02) — `buildReceiptModel` uni `docNumber`
   * qilib oladi. Eski cheklarda `null`/yo'q ⇒ shablon `name` ga qaytadi.
   */
  receiptNo?: number | null;
  state: string;
  moment: string;
  sumMinor: string;
  /** Kassa TZ §6.1 — chekning to'lov qatlami (`RetailSalePayment`). */
  payments?: ReceiptPaymentRow[] | null;
  cashAmountMinor: string;
  cardAmountMinor: string;
  changeMinor: string;
  description: string | null;
  agent: { id: string; name: string; legalTitle: string | null; phone: string | null } | null;
  session: {
    cashDesk: { name: string; currency: string };
    cashier: { name: string };
    store: { name: string };
    organization: { name: string; legalTitle: string | null; phone: string | null };
  };
  positions: PositionDetail[];
}

export default function PrintRetailSalePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const auto = searchParams.get('auto') === '1';
  // Boshqa chek sahifalari bilan bir xil: `?w=58` tor lenta.
  const widthMm = searchParams.get('w') === '58' ? 58 : 80;
  const t = useTranslations('pages.print');

  const { data, isLoading } = useQuery<RetailSaleDetail>({
    queryKey: ['retail-sale-print', id],
    queryFn: () => api.get<RetailSaleDetail>(`/retail-sales/${id}`),
  });

  // P05 — kontragentli chekda qolgan qarz («Sizning qarzingiz»). Helper
  // fail-open (`null`) — summary yiqilsa chek qarz qatorisiz baribir chiqadi.
  // `auto=1` popup'i darhol chop qilgani uchun bu so'rov ham render'dan
  // OLDIN kutiladi (pastdagi isLoading sharti), aks holda qator poygada
  // qog'ozga ulgurmasdi.
  const agentId = data?.agent?.id ?? null;
  const debtQuery = useQuery<bigint | null>({
    queryKey: ['retail-sale-print-debt', agentId],
    queryFn: () => fetchDebtAfter(agentId as string),
    enabled: agentId != null,
  });

  if (isLoading || (agentId != null && debtQuery.isLoading)) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }
  if (!data) return <div style={{ padding: 24 }}>Not found</div>;

  // Qarorlar va formatlash SOF modulda — bu sahifa faqat chizadi.
  const model = buildReceiptModel({
    ...data,
    debtAfterMinor: agentId != null ? (debtQuery.data ?? null) : null,
  });

  const positions: ChekPosition[] = data.positions.map((p) => ({
    position: p.position,
    name: p.product?.name ?? '—',
    code: p.product?.code ?? null,
    uom: p.product?.uom ?? null,
    quantity: p.quantity,
    priceMinor: p.priceMinor,
    sumMinor: p.sumMinor,
  }));

  // «Chek bo'yicha umumiy summa» — MODELdan (2026-08-16): u endi qatorning
  // muzlatilgan sotilish narxi (`basePriceMinor`) bo'yicha yalpini beradi,
  // «Chegirma» esa shu bilan jami farqi. Bu yerda qayta hisoblash uch-renderer
  // paritetini buzardi (agent-chek chegirma ko'rsatib, brauzer-chek 0 berardi).
  const grossMinor = model.subtotalMinor;

  return (
    <ThermalShell widthMm={widthMm} autoPrint={auto}>
      <TovarChek
        title={t('chek_title_sale')}
        docNumber={model.docNumber}
        docDate={data.moment}
        orgName={model.orgName}
        orgPhone={model.orgPhone}
        sellerName={model.sellerName}
        buyerName={model.buyerName}
        buyerPhone={model.buyerPhone}
        comment={data.description}
        positions={positions}
        totalMinor={data.sumMinor}
        subtotalMinor={grossMinor}
        payments={model.payments}
        debtAfterMinor={model.debtAfterMinor}
        widthMm={widthMm}
      />
    </ThermalShell>
  );
}
