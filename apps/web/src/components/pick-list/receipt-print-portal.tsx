'use client';

/**
 * Shared «Лист сборки» receipt renderer (owner spec chain 2026-07-27→28):
 * 72mm check-paper column, uniform-stroke Arial (thermal-safe), one table PER
 * warehouse («01», «02», … from the cell code's first segment; «Без ячейки»
 * last; row numbers run through), columns № · Наименование · Ед.изм · Кол-во ·
 * Ячейка (LAST, extra-bold), 1.5px separators, NO prices.
 *
 * Used by /pick-lists/[id]/print (MoySklad-synced docs) AND the «Печать →
 * Лист сборки» action on OUR customer-orders/new + sales-returns/new pages.
 * Print isolation mirrors qr-price-tag-print: portals under <body>, @media
 * print hides every other body child.
 *
 * 2026-08-10: the receipt itself moved into the exported <PickReceiptBody> so
 * the omborchi picking sheet (/print/picking) renders the SAME template instead
 * of its own «YIG'ISH VARAQASI» markup. Three renderers used to drift; this is
 * the single React source. (The ESC/POS text builder in lib/print-agent.ts is a
 * plain-text approximation — a raw thermal stream cannot draw table borders.)
 */

import { groupByWarehouse } from '@/lib/pick-list-group';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';

export interface ReceiptPositionInput {
  name: string;
  qty: number | string;
  uom?: string | null;
  cell: string | null;
  code?: string | null;
  barcode?: string | null;
}

export interface ReceiptGroupInput {
  /**
   * «01», «02», … · `null` = cell-less group («Yacheykasiz») · **`undefined` =
   * no heading at all**.
   *
   * Uchinchi holat 2026-08-16 da qo'shildi: omborchi varag'i endi bir necha
   * ombor + yacheykasizlarni BITTA qog'ozga birlashtiradi (bitta printer =
   * bitta qog'oz). Bunday ro'yxatda yagona sarlavha YOLG'ON bo'lardi — na
   * «01», na «Yacheykasiz» to'g'ri; manzil esa har qatorda turibdi.
   */
  warehouse?: string | null;
  positions: ReceiptPositionInput[];
}

export interface ReceiptData {
  /** «Товарный чек» or «Возврат» — already localized by the caller. */
  title: string;
  number: string;
  /** DD.MM.YYYY */
  dateStr: string;
  agentName: string | null;
  agentPhone: string | null;
  ownerName: string | null;
  description: string | null;
  positions: ReceiptPositionInput[];
  /**
   * Pre-grouped positions, rendered in the given order. Callers that already
   * know the grouping AND the row order use this — the omborchi picking sheet
   * carries ONE sklad per receipt and its rows are in serpentine pick-route
   * order (server-side), which `groupByWarehouse` would re-sort away.
   * When omitted, `positions` are grouped by warehouse and sorted by cell code.
   */
  groups?: ReceiptGroupInput[];
}

/**
 * The receipt itself (climart «Товарный чек» namunasi): header block → one
 * bordered table per warehouse group → «Всего наименований N» → footer.
 * Shared by <ReceiptPrintPortal> (document «Лист сборки», one receipt with
 * every group) and the omborchi picking sheet (one receipt per sklad).
 */
export function PickReceiptBody({
  data,
  widthMm = 72,
}: {
  data: ReceiptData;
  /** Paper column in mm — 72 on 80mm rolls (climart 1:1), 54 on 58mm rolls. */
  widthMm?: number;
}) {
  const t = useTranslations('pages.pickLists');
  const groups = data.groups ?? groupByWarehouse(data.positions);
  let rowNo = 0;
  const th = 'border border-black px-1 py-0.5 text-center font-bold';
  const td = 'border border-black px-1 py-0.5 align-top';

  return (
    <div
      className="rcpt mx-auto bg-white p-2 text-black"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif', width: `${widthMm}mm` }}
    >
      <div className="font-bold text-[14px]" data-test-id="receipt-agent">
        {data.agentName ?? ''}
      </div>
      <div className="mt-1 text-center font-bold text-[16px]" data-test-id="receipt-title">
        {data.title} № {data.number}
      </div>
      <div className="text-center text-[11px]">
        {t('receipt_from')} {data.dateStr}
      </div>
      <div className="mt-1 font-bold text-[11px] leading-tight">
        <div>
          {t('receipt_seller')}: {data.ownerName ?? ''}
        </div>
        <div>
          {t('receipt_buyer')}: {data.agentName ?? ''}
        </div>
        <div>
          {t('receipt_phone')}: {data.agentPhone ?? ''}
        </div>
        <div>
          {t('receipt_comment')}: {data.description ?? ''}
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.warehouse ?? 'no-cell'} className="mt-2" style={{ breakInside: 'avoid' }}>
          {/* `undefined` — birlashtirilgan ro'yxat: sarlavha CHIQMAYDI. */}
          {g.warehouse !== undefined && (
            <div
              className="mb-0.5 font-bold text-[15px]"
              data-test-id={`receipt-group-${g.warehouse ?? 'none'}`}
            >
              {g.warehouse ?? t('print_no_cell')}
            </div>
          )}
          <table className="w-full table-fixed border-collapse text-[10px]">
            <thead>
              <tr>
                <th className={`${th} w-[7mm]`}>№</th>
                <th className={th}>{t('receipt_col_name')}</th>
                <th className={`${th} w-[7mm]`}>{t('receipt_col_uom')}</th>
                <th className={`${th} w-[11mm]`}>{t('receipt_col_qty')}</th>
                <th className={`${th} w-[17mm]`}>{t('print_col_cell')}</th>
              </tr>
            </thead>
            <tbody>
              {g.positions.map((p) => {
                rowNo += 1;
                return (
                  <tr key={`${p.cell ?? ''}-${p.name}-${rowNo}`}>
                    <td className={`${td} text-center`}>{rowNo}</td>
                    <td className={`${td} rcpt-name break-words text-[11px]`}>{p.name}</td>
                    <td className={`${td} text-center`}>{p.uom ?? t('receipt_uom_default')}</td>
                    <td className={`${td} whitespace-nowrap text-center font-bold text-[11px]`}>
                      {p.qty}
                    </td>
                    <td
                      className={`${td} whitespace-nowrap text-center font-extrabold text-[10px] tabular-nums`}
                      data-test-id="receipt-cell"
                    >
                      {p.cell ?? '–'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="mt-1 font-bold text-[12px]" data-test-id="receipt-items-line">
        {t('receipt_items_short', { n: rowNo })}
      </div>

      <div className="mt-4 border-black border-t pt-1 font-bold text-[11px] italic">
        {t('receipt_footer_brand')}
      </div>
    </div>
  );
}

export function ReceiptPrintPortal({
  data,
  loading,
  error,
  onPrint,
  onClose,
}: {
  data: ReceiptData | null;
  loading?: boolean;
  error?: string | null;
  /** Fired on the FIRST print click (e.g. stamp printedAt). */
  onPrint?: () => void;
  /** ✕ handler; defaults to window.close() (standalone tab). */
  onClose?: () => void;
}) {
  const t = useTranslations('pages.pickLists');
  if (typeof document === 'undefined') return null;

  const doPrint = () => {
    onPrint?.();
    window.print();
  };

  let body: React.ReactNode;
  if (error) {
    body = <div className="p-8 text-red-600 text-sm">{error}</div>;
  } else if (loading || !data) {
    body = <div className="p-8 text-slate-500 text-sm">{t('print_loading')}</div>;
  } else {
    body = (
      <>
        <PickReceiptBody data={data} />
        <div className="no-print mx-auto p-2" style={{ width: '72mm' }}>
          <button
            type="button"
            className="rounded border border-slate-400 px-4 py-2 text-sm"
            onClick={doPrint}
            data-test-id="pick-list-print-again"
          >
            🖨 {t('print')}
          </button>
        </div>
      </>
    );
  }

  return createPortal(
    <div
      data-pick-print-root=""
      data-test-id="pick-list-print-page"
      className="fixed inset-0 z-[200] overflow-auto bg-slate-100"
    >
      <style>{`
        .rcpt table th, .rcpt table td { border: 1.5px solid #000; }
        .rcpt, .rcpt table { font-weight: 600; }
        .rcpt td.rcpt-name { font-weight: 700; }
        @media print {
          /* climart 1:1 (asl, ishlaydigan): 72mm .rcpt inline kengligi + size:auto/3mm.
             Termal printer o'z kengligiga moslaydi; qo'lda 80mm/68mm/max-width qo'shish
             ARALASHTIRIB, chetga tegizib qo'ygan edi — shuning uchun climart'niki tiklandi. */
          @page { size: auto; margin: 3mm; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
          body > *:not([data-pick-print-root]) { display: none !important; }
          [data-pick-print-root] { position: static !important; overflow: visible !important; background: #fff !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-center gap-3 border-slate-300 border-b bg-white px-4 py-2 shadow-sm">
        <button
          type="button"
          className="rounded bg-[#186999] px-5 py-1.5 font-medium text-sm text-white hover:brightness-110"
          onClick={doPrint}
          data-test-id="pick-list-print-btn"
        >
          🖨 {t('print')}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-4 py-1.5 text-slate-600 text-sm hover:bg-slate-50"
          onClick={onClose ?? (() => window.close())}
          data-test-id="pick-list-print-close"
        >
          ✕
        </button>
      </div>
      {body}
    </div>,
    document.body,
  );
}

/** DD.MM.YYYY for the receipt header. */
export function receiptDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
