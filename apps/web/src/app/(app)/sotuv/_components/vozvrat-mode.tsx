'use client';

/**
 * В«VozvratВ» rejimi (V2, egasi 2026-09-01) вЂ” qaytarish uchun chekni TOPISH oynasi.
 *
 * Sabab: naqdga olib ketgan MIJOZSIZ odam vozvratga kelsa, chekni faqat TOVAR
 * orqali topish mumkin вЂ” В«CheklarВ» qidiruvi (chek nomi/mijoz ismi) bunda ojiz.
 * Shu yerda ikki tab: В«TovarВ» (asosiy; skaner ham ishlaydi вЂ” shtrix-kod
 * `GET /products?search=` da exact tutiladi) va В«MijozВ». Tanlangach shu
 * tovar/mijoz qatnashgan BARCHA `posted` cheklar sanasi bilan, eng yangisi
 * tepada, 50 tadan sahifalab chiqadi (egasining S-V2/S-V3 javoblari).
 *
 * Chekni ochish вЂ” mavjud `ChekDetailPanel` (cheklar-mode'dan eksport):
 * qaytarish oqimi BITTA joyda, bu fayl faqat qidiruv/ro'yxat.
 *
 * Rejimga kirish `salesreturn.create` bilan yon panelda yashiringan
 * (`pos-sidebar.tsx`); haqiqiy qulf serverda.
 */

import { api } from '@/lib/api-client';
import { useBcp47 } from '@/lib/i18n-format';
import { formatMoney } from '@moysklad/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Package, Receipt, RotateCcw, User, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ChekDetailPanel, type ChekDetailPosition } from './cheklar-mode';
import type { SaleRow } from './pos-types';

/** Sotuv qidiruvi bilan bir xil oyna (`page.tsx` SEARCH_DEBOUNCE_MS). */
const SEARCH_DEBOUNCE_MS = 250;

type VozvratTab = 'product' | 'agent';

interface ProductHit {
  id: string;
  name: string;
  code?: string | null;
}

interface AgentHit {
  id: string;
  name: string;
  phone?: string | null;
}

/** Tanlangan filtr вЂ” bir paytda bittasi (tovar YOKI mijoz). */
interface PickedFilter {
  kind: VozvratTab;
  id: string;
  name: string;
}

interface ChekPage {
  items: SaleRow[];
  nextCursor?: string;
  total: number;
}

export function VozvratMode({
  onCopyToCart,
}: {
  onCopyToCart: (positions: ChekDetailPosition[]) => void;
}) {
  const t = useTranslations('pages.sotuv');
  const bcp47 = useBcp47();

  const [tab, setTab] = useState<VozvratTab>('product');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<PickedFilter | null>(null);
  const [selectedChekId, setSelectedChekId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  const switchTab = (next: VozvratTab) => {
    if (next === tab) return;
    setTab(next);
    setSearch('');
    setDebounced('');
    setPicked(null);
    setSelectedChekId(null);
  };

  const pick = (kind: VozvratTab, id: string, name: string) => {
    setPicked({ kind, id, name });
    setSearch('');
    setDebounced('');
    setSelectedChekId(null);
  };

  const productHits = useQuery<{ items: ProductHit[] }>({
    queryKey: ['pos-vozvrat-products', debounced],
    queryFn: ({ signal }) =>
      api.get(`/products?search=${encodeURIComponent(debounced)}&limit=30`, { signal }),
    enabled: tab === 'product' && !picked && debounced.length > 0,
    placeholderData: keepPreviousData,
  });

  const agentHits = useQuery<{ items: AgentHit[] }>({
    queryKey: ['pos-vozvrat-agents', debounced],
    queryFn: ({ signal }) =>
      api.get(`/counterparties?search=${encodeURIComponent(debounced)}&limit=20`, { signal }),
    enabled: tab === 'agent' && !picked && debounced.length > 0,
    placeholderData: keepPreviousData,
  });

  // Egasining S-V3 javobi: faqat `posted` вЂ” oyna В«vozvrat qilishВ» uchun, arxiv
  // emas. Qisman qaytarilgan chek `posted` ligicha qoladi va ko'rinaveradi.
  const cheklar = useInfiniteQuery({
    queryKey: ['pos-vozvrat-cheklar', picked?.kind, picked?.id],
    queryFn: ({ pageParam, signal }) => {
      const filterParam =
        picked?.kind === 'product' ? `productId=${picked.id}` : `agentId=${picked?.id}`;
      const cursorParam = pageParam ? `&cursor=${pageParam}` : '';
      return api.get<ChekPage>(
        `/retail-sales?${filterParam}&state=posted&sortBy=moment&sortDir=desc&limit=50${cursorParam}`,
        { signal },
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ChekPage) => last.nextCursor,
    enabled: picked != null,
  });

  const chekRows: SaleRow[] = cheklar.data?.pages.flatMap((p: ChekPage) => p.items) ?? [];

  // Skaner naqshi: matn + Enter. Natija AYNAN bitta bo'lsa (shtrix-kod exact
  // match) вЂ” darhol tanlanadi; ko'p bo'lsa kassir qo'l bilan tanlaydi.
  const onSearchEnter = () => {
    if (picked || tab !== 'product') return;
    const items = productHits.data?.items ?? [];
    if (items.length === 1 && items[0]) pick('product', items[0].id, items[0].name);
  };

  const searchHits: Array<{ id: string; name: string; sub: string | null }> =
    tab === 'product'
      ? (productHits.data?.items ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          sub: p.code ?? null,
        }))
      : (agentHits.data?.items ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          sub: a.phone ?? null,
        }));

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* в”Ђв”Ђ Chap: qidiruv + natija в”Ђв”Ђ */}
      <div className="flex w-[400px] shrink-0 flex-col overflow-hidden border-[var(--ms-border)] border-r">
        {/* Tablar */}
        <div className="flex shrink-0 gap-1 border-b border-[var(--ms-border)] p-2">
          {(['product', 'agent'] as const).map((k) => (
            <button
              key={k}
              type="button"
              data-test-id={`pos-vozvrat-tab-${k}`}
              onClick={() => switchTab(k)}
              className={`flex h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg text-[15px] font-semibold transition-colors ${
                tab === k
                  ? 'bg-[var(--pos-brand)] text-white'
                  : 'border border-[var(--ms-border)] text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]'
              }`}
            >
              {k === 'product' ? <Package className="h-4 w-4" /> : <User className="h-4 w-4" />}
              {k === 'product' ? t('vozvrat_tab_product') : t('vozvrat_tab_agent')}
            </button>
          ))}
        </div>

        {/* Qidiruv maydoni yoki tanlangan filtr-chip */}
        <div className="shrink-0 border-b border-[var(--ms-border)] p-2">
          {picked ? (
            <div className="flex h-[48px] items-center gap-2 rounded-lg border border-[var(--pos-brand)] bg-[var(--pos-brand)]/10 px-3">
              {picked.kind === 'product' ? (
                <Package className="h-4 w-4 shrink-0 text-[var(--pos-brand)]" />
              ) : (
                <User className="h-4 w-4 shrink-0 text-[var(--pos-brand)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-[var(--ms-text-primary)]">
                {picked.name}
              </span>
              <button
                type="button"
                data-test-id="pos-vozvrat-clear-filter"
                aria-label={t('vozvrat_clear_filter')}
                onClick={() => {
                  setPicked(null);
                  setSelectedChekId(null);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ms-text-muted)] hover:bg-[var(--ms-bg-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <input
              type="text"
              data-test-id="pos-vozvrat-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearchEnter();
              }}
              placeholder={
                tab === 'product' ? t('vozvrat_search_product') : t('vozvrat_search_agent')
              }
              className="h-[48px] w-full rounded-lg border border-[var(--ms-border)] bg-[var(--ms-bg-app)] px-3 text-[16px] outline-none focus:border-[var(--ms-primary-500)]"
            />
          )}
        </div>

        {/* Natija: filtr tanlanmagan bo'lsa tovar/mijoz ro'yxati, tanlangan
            bo'lsa cheklar ro'yxati. */}
        {!picked ? (
          debounced.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[var(--ms-text-muted)]">
              <RotateCcw className="h-8 w-8 opacity-40" />
              <span className="text-[15px]">{t('vozvrat_hint')}</span>
            </div>
          ) : searchHits.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-[15px] text-[var(--ms-text-muted)]">
              {tab === 'product' ? t('scan_not_found') : t('vozvrat_agent_not_found')}
            </div>
          ) : (
            <div className="flex flex-1 flex-col divide-y divide-[var(--ms-border)] overflow-y-auto [&>*]:shrink-0">
              {searchHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => pick(tab, hit.id, hit.name)}
                  className="flex min-h-[var(--pos-row-h)] w-full shrink-0 items-center gap-3 px-4 text-left hover:bg-[var(--ms-bg-hover)] active:bg-[var(--ms-bg-hover)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-medium text-[var(--ms-text-primary)]">
                      {hit.name}
                    </div>
                    {hit.sub && (
                      <div className="text-[13px] text-[var(--ms-text-muted)]">{hit.sub}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-[14px] text-[var(--ms-text-muted)]">›</span>
                </button>
              ))}
            </div>
          )
        ) : chekRows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[var(--ms-text-muted)]">
            <Receipt className="h-8 w-8 opacity-40" />
            <span className="text-[15px]">
              {cheklar.isLoading ? t('loading') : t('vozvrat_empty')}
            </span>
          </div>
        ) : (
          <div className="flex flex-1 flex-col divide-y divide-[var(--ms-border)] overflow-y-auto [&>*]:shrink-0">
            {chekRows.map((sale) => (
              <button
                key={sale.id}
                type="button"
                onClick={() => setSelectedChekId(sale.id)}
                data-selected={selectedChekId === sale.id || undefined}
                className="flex min-h-[var(--pos-row-h)] w-full shrink-0 items-center gap-3 px-4 text-left hover:bg-[var(--ms-bg-hover)] active:bg-[var(--ms-bg-hover)] data-[selected]:bg-[var(--pos-brand)]/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[18px] font-semibold tabular-nums text-[var(--ms-text-primary)]">
                      {formatMoney(BigInt(sale.sumMinor))}
                    </span>
                    {/* Egasi: В«cheklar SANASI bilan chiqsinВ» вЂ” vaqt emas,
                        to'liq sana (eski cheklar ham topiladi). */}
                    <span className="shrink-0 text-[14px] tabular-nums text-[var(--ms-text-muted)]">
                      {new Date(sale.moment).toLocaleString(bcp47, {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[14px] text-[var(--ms-text-muted)]">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {sale.agent ? sale.agent.name : t('vozvrat_cash_customer')}
                    </span>
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
            {cheklar.hasNextPage && (
              <button
                type="button"
                data-test-id="pos-vozvrat-more"
                onClick={() => cheklar.fetchNextPage()}
                disabled={cheklar.isFetchingNextPage}
                className="flex h-[48px] w-full shrink-0 items-center justify-center text-[15px] font-semibold text-[var(--pos-brand)] hover:bg-[var(--ms-bg-hover)] disabled:opacity-50"
              >
                {cheklar.isFetchingNextPage ? t('loading') : t('vozvrat_more')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* в”Ђв”Ђ O'ng: detal-panel (qaytarish o'sha yerda) yoki taklif в”Ђв”Ђ */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedChekId ? (
          <ChekDetailPanel
            saleId={selectedChekId}
            onBack={() => setSelectedChekId(null)}
            onCopyToCart={onCopyToCart}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--ms-text-muted)]">
            <RotateCcw className="h-12 w-12 opacity-30" />
            <span className="text-[18px]">{t('vozvrat_detail_placeholder')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
