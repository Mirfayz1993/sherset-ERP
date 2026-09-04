'use client';

import { PrintShell } from '@/components/print/print-shell';
import { api } from '@/lib/api-client';
import { POS_TZ } from '@/lib/clock';
import { formatMoney } from '@moysklad/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';

interface CashInDoc {
  id: string;
  name: string;
  kind: string;
  sumMinor: string;
  currency: string;
  description: string | null;
  createdAt: string;
  /** A1 — avans (`kind='customer_prepay'`) hujjatida to'ldiriladi. */
  agent: { id: string; name: string } | null;
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
    // 🔴 S4: PKO — QOG'OZ hujjat, mijozning qo'lida qoladi. Sanasi bosgan
    // mashinaning mintaqasiga bog'liq bo'lmasin (`receipt-model.ts` bilan
    // ayni qaror, S2). `'uz-UZ'` lokali ATAYLAB tegilmadi — qog'oz-format
    // qarori, mintaqa esa undan mustaqil.
    timeZone: POS_TZ,
  });
}

const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'space-between' };

/**
 * PKO — kassaga kirim cheki (A1, 2026-08-25).
 *
 * `print/cash-out/[docId]` ning AYNAN ko'zgusi: bitta shablon ikki hujjat
 * uchun — «Внесение» (`topup`) va MIJOZ AVANSI (`customer_prepay`). Farqi
 * sarlavha va «kimdan» qatorida. Ikkita deyarli bir xil shablon saqlash
 * ularning bir-biridan asta uzoqlashishiga olib kelardi (chiqim tomonida
 * aynan shu qaror qabul qilingan).
 *
 * **Imzo satri** — avansda MAJBURIY: qog'ozdagi imzo «pulni topshirdim»
 * dalilining o'zi. Mijoz keyin «men 1 000 000 bergandim» desa, kassada
 * qoladigan yagona qog'oz shu.
 */
export default function PrintCashInPage() {
  const { docId } = useParams<{ docId: string }>();
  const searchParams = useSearchParams();
  const auto = searchParams.get('auto') === '1';

  const { data, isLoading } = useQuery<CashInDoc>({
    queryKey: ['cash-in-doc', docId],
    queryFn: () => api.get<CashInDoc>(`/cashier-sessions/cash-in/${docId}`),
  });

  if (isLoading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!data) return <div style={{ padding: 24 }}>Not found</div>;

  const isPrepay = data.kind === 'customer_prepay';
  const title = isPrepay ? 'AVANS' : 'KIRIM';
  const subtitle = isPrepay ? 'Mijozdan oldindan to`lov qabul qilindi' : 'Kirim kassa orderi (PKO)';

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

        {/* «Kimdan va nima uchun» — hujjatning ma'nosi shu qatorda. */}
        <div style={{ marginBottom: 8 }}>
          {isPrepay && (
            <div style={ROW}>
              <span>Mijoz</span>
              <span style={{ fontWeight: 700 }}>{data.agent?.name ?? '—'}</span>
            </div>
          )}
          <div style={ROW}>
            <span>Asos</span>
            <span style={{ fontWeight: 700 }}>
              {isPrepay ? 'Oldindan to`lov (avans)' : 'Kassaga kirim'}
            </span>
          </div>
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

        {/* Avans mijozning puli — «pul mening hisobimda turadi» ma'nosi
            qog'ozda OCHIQ yozilsin, aks holda keyin nizo tug'iladi. */}
        {isPrepay && (
          <div style={{ marginBottom: 10, fontSize: 11, color: '#444' }}>
            Ushbu summa mijozning hisobida turadi va keyingi xaridlarida hisobga olinadi.
          </div>
        )}

        {/* Imzo — avansda dalilning o'zi. */}
        <div style={{ marginBottom: 10, fontSize: 12 }}>
          <div style={{ ...ROW, marginBottom: 10 }}>
            <span>{isPrepay ? 'Topshirdi (mijoz)' : 'Topshirdi'}</span>
            <span>_________________</span>
          </div>
          <div style={ROW}>
            <span>Qabul qildi (kassir)</span>
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
