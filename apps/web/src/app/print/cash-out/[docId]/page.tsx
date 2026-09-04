'use client';

import { PrintShell } from '@/components/print/print-shell';
import { api } from '@/lib/api-client';
import { POS_TZ } from '@/lib/clock';
import { formatMoney } from '@moysklad/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';

interface CashOutDoc {
  id: string;
  name: string;
  kind: string;
  sumMinor: string;
  currency: string;
  description: string | null;
  createdAt: string;
  expenseItem: { id: string; name: string } | null;
  recipient: { id: string; name: string } | null;
  /** G1 — vozvrat-to'lov (`kind='return_payout'`) hujjatida to'ldiriladi. */
  agent: { id: string; name: string } | null;
  salesReturn: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  organization: { name: string; legalTitle: string | null } | null;
  retailShift: { id: string; cashDesk: { name: string } | null } | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // 🔴 S4: RKO — QOG'OZ hujjat (`cash-in` ning ko'zgusi, ayni qaror).
    // Sanasi bosgan mashinaning mintaqasiga bog'liq bo'lmasin.
    timeZone: POS_TZ,
  });
}

const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'space-between' };

/**
 * RKO — kassadan chiqim cheki (kassa TZ §8.2 / §8.3).
 *
 * Bitta shablon ikki hujjat uchun: xarajat va inkassatsiya. Farqi —
 * sarlavha va «nima uchun» qatori (modda yoki qabul qiluvchi). Ikkita
 * deyarli bir xil shablon saqlash ularning bir-biridan asta uzoqlashishiga
 * olib kelardi.
 *
 * **Imzo satri** — inkassatsiyada MAJBURIY: qog'ozdagi imzo «pulni qabul
 * qildim» dalilining o'zi. Xarajatda ham qoldirilgan (kassir hisobotiga
 * ilinadi).
 */
export default function PrintCashOutPage() {
  const { docId } = useParams<{ docId: string }>();
  const searchParams = useSearchParams();
  const auto = searchParams.get('auto') === '1';

  const { data, isLoading } = useQuery<CashOutDoc>({
    queryKey: ['cash-out-doc', docId],
    queryFn: () => api.get<CashOutDoc>(`/cashier-sessions/cash-out/${docId}`),
  });

  if (isLoading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!data) return <div style={{ padding: 24 }}>Not found</div>;

  const isCollection = data.kind === 'collection';
  // G1 — vozvrat puli: mijozga kassadan qaytarilgan naqd cheki.
  const isReturnPayout = data.kind === 'return_payout';
  // A3 — mijozning sarflanmagan AVANSI naqd qaytarildi. Bu vozvrat puli
  // EMAS: hech qanday tovar qaytmagan, mijoz o'z pulini olib ketdi.
  // Chalkashsa mijoz imzolagan qog'oz noto'g'ri hodisani tasdiqlardi.
  const isPrepayRefund = data.kind === 'prepay_refund';
  const title = isPrepayRefund
    ? 'AVANS QAYTARILDI'
    : isReturnPayout
      ? 'VOZVRAT PULI'
      : isCollection
        ? 'INKASSATSIYA'
        : 'XARAJAT';
  const subtitle = isPrepayRefund
    ? 'Oldindan to`langan pulning qaytarilishi'
    : isReturnPayout
      ? 'Mijozga naqd qaytarish'
      : isCollection
        ? 'Naqd pul topshirish'
        : 'Chiqim kassa orderi (RKO)';

  return (
    <PrintShell autoPrint={auto}>
      <div style={{ maxWidth: 320, margin: '0 auto', fontFamily: 'monospace', fontSize: 13 }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {data.organization?.legalTitle ?? data.organization?.name ?? '—'}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{title}</div>
          <div style={{ fontSize: 11, color: '#666' }}>{subtitle}</div>
        </div>

        <div
          style={{
            borderTop: '1px dashed #999',
            borderBottom: '1px dashed #999',
            paddingTop: 6,
            paddingBottom: 6,
            marginBottom: 8,
          }}
        >
          <div style={ROW}>
            <span>Hujjat №</span>
            <span style={{ fontWeight: 700 }}>{data.name}</span>
          </div>
          <div style={ROW}>
            <span>Sana</span>
            <span>{fmtDate(data.createdAt)}</span>
          </div>
          <div style={ROW}>
            <span>Kassir</span>
            <span>{data.owner?.name ?? '—'}</span>
          </div>
          {data.retailShift?.cashDesk && (
            <div style={ROW}>
              <span>Kassa</span>
              <span>{data.retailShift.cashDesk.name}</span>
            </div>
          )}
        </div>

        {/* «Nima uchun» — hujjatning ma'nosi shu qatorda. */}
        <div style={{ marginBottom: 8 }}>
          <div style={ROW}>
            <span>{isReturnPayout ? 'Mijoz' : isCollection ? 'Qabul qildi' : 'Modda'}</span>
            <span style={{ fontWeight: 700 }}>
              {isReturnPayout
                ? (data.agent?.name ?? '—')
                : isCollection
                  ? (data.recipient?.name ?? '—')
                  : (data.expenseItem?.name ?? '—')}
            </span>
          </div>
          {isReturnPayout && (
            <div style={ROW}>
              <span>Vozvrat</span>
              <span style={{ fontWeight: 700 }}>{data.salesReturn?.name ?? '—'}</span>
            </div>
          )}
          {data.description && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#444' }}>{data.description}</div>
          )}
        </div>

        <div
          style={{
            border: '1px solid #333',
            padding: '6px 8px',
            marginBottom: 12,
            ...ROW,
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          <span>SUMMA</span>
          <span>{formatMoney(BigInt(data.sumMinor))}</span>
        </div>

        {/* Imzo — inkassatsiyada dalilning o'zi. */}
        <div style={{ marginBottom: 10, fontSize: 12 }}>
          <div style={{ ...ROW, marginBottom: 10 }}>
            <span>Topshirdi</span>
            <span>_________________</span>
          </div>
          <div style={ROW}>
            <span>{isReturnPayout ? 'Oldim (mijoz)' : isCollection ? 'Qabul qildi' : 'Oldi'}</span>
            <span>_________________</span>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#666' }}>
          № {data.id.slice(0, 8).toUpperCase()}
        </div>
      </div>
    </PrintShell>
  );
}
