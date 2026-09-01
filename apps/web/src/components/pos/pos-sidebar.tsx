'use client';

/**
 * F2 (POS redizayn) — chap yig'iladigan sidebar (spec §3.2).
 *
 * Eski tab-bar o'rnini bosadi: rejimlar TO'LIQ EKRAN bo'ladi (spec Q2),
 * sidebar ish maydonini almashtiradi. Kengaygan 240px ↔ yig'iq 72px;
 * holat sahifada (`localStorage['sherset.pos.sidebar']`), bu komponent
 * faqat chizadi. `position: fixed` ATAYLAB ishlatilmaydi — desktop
 * klaviatura-evristikasi (`keyboardRoot`) «fixed ichida button»ni
 * klaviatura deb qidiradi (F6 sharti ham shu).
 *
 * Accessible-name har doim `aria-label`da turadi: MK32 testlari va
 * skanerlab o'quvchilar tugmani nom bo'yicha topadi — yig'iq holatda
 * yozuv yashirin bo'lsa ham nom o'zgarmaydi.
 */

import type { LucideIcon } from 'lucide-react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * POS rejim unioni — eski `tab` unionining vorisi ('savat'→'sotuv',
 * 'jarayonda'/'tayyor'→'navbat'). F3–F5 va F8 shu tipga tayanadi.
 */
export type PosMode =
  | 'sotuv'
  | 'navbat'
  | 'zakazlar'
  | 'cheklar'
  | 'mijozlar'
  | 'vozvrat'
  | 'smena';

export interface PosSidebarProps {
  mode: PosMode;
  onModeChange: (mode: PosMode) => void;
  /** Savat = savatdagi qatorlar soni; navbat = yig'ilmoqda + tayyor jami. */
  badges: { savat: number; navbat: number };
  /** `customerorder.view` — faqat UX; haqiqiy qulf serverda (eski tab-bar bilan bir xil). */
  canSeeOrders: boolean;
  /** `salesreturn.create` — Vozvrat rejimi faqat huquqi borga (V2); qulf serverda. */
  canRefund: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface SidebarItem {
  key: PosMode;
  icon: LucideIcon;
  label: string;
  badge?: number;
  /** Badge rangi — navbat sarg'ish (omborchi ishlayapti), savat ko'k. */
  badgeTone?: 'brand' | 'amber';
}

function SidebarButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const showBadge = (item.badge ?? 0) > 0;
  // O'lchamlar px'da ATAYLAB (`--pos-row-h`, 24/28px ikonka): ildiz font-size
  // 12px (ERP zichligi) — rem-asosli `h-16`/`h-6` real 48/18px chiqib,
  // spec §4 sensorli nishonlarini buzadi (jonli brauzerda o'lchab topildi).
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      data-test-id={`pos-sidebar-item-${item.key}`}
      onClick={onClick}
      className={`relative flex h-[var(--pos-row-h)] w-full shrink-0 items-center gap-3 px-4 text-left transition-colors ${
        active
          ? 'bg-[var(--pos-surface)] text-[var(--pos-brand)]'
          : 'text-[var(--pos-sidebar-fg)] hover:bg-[var(--pos-sidebar-hover)]'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {/* Aktiv bo'lim — chap ko'k chiziq (spec §3.2). */}
      {active && <span className="absolute inset-y-0 left-0 w-1 bg-[var(--pos-brand)]" />}
      <span className="relative">
        <Icon
          className={collapsed ? 'h-[28px] w-[28px]' : 'h-[24px] w-[24px]'}
          strokeWidth={active ? 2.4 : 2}
        />
        {/* Yig'iq holatda badge ikonka burchagida turadi — spec: «badge'lar
            yig'iq holatda ham ko'rinadi». */}
        {showBadge && collapsed && (
          <span
            className={`absolute -right-2.5 -top-2 min-w-[20px] rounded-full px-1 py-0.5 text-center font-bold text-[11px] leading-none text-white ${
              item.badgeTone === 'amber' ? 'bg-amber-500' : 'bg-[var(--pos-brand)]'
            }`}
          >
            {item.badge}
          </span>
        )}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate font-semibold text-[17px]">{item.label}</span>
          {showBadge && (
            <span
              className={`min-w-[24px] rounded-full px-1.5 py-1 text-center font-bold text-[13px] leading-none text-white ${
                item.badgeTone === 'amber' ? 'bg-amber-500' : 'bg-[var(--pos-brand)]'
              }`}
            >
              {item.badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function PosSidebar({
  mode,
  onModeChange,
  badges,
  canSeeOrders,
  canRefund,
  collapsed,
  onToggleCollapsed,
}: PosSidebarProps) {
  const t = useTranslations('pages.pos');

  const items: SidebarItem[] = [
    { key: 'sotuv', icon: ShoppingCart, label: t('sidebar_sotuv'), badge: badges.savat },
    {
      key: 'navbat',
      icon: Clock,
      label: t('sidebar_navbat'),
      badge: badges.navbat,
      badgeTone: 'amber',
    },
    ...(canSeeOrders
      ? [{ key: 'zakazlar' as const, icon: ClipboardList, label: t('sidebar_zakazlar') }]
      : []),
    { key: 'cheklar', icon: Receipt, label: t('sidebar_cheklar') },
    { key: 'mijozlar', icon: Users, label: t('sidebar_mijozlar') },
    // V2 — vozvrat huquqi (`salesreturn.create`) borgagina ko'rinadi: egasining
    // qarori bilan qaytarish faqat ayrim xodimlarda (Shavkat va b.).
    ...(canRefund
      ? [{ key: 'vozvrat' as const, icon: RotateCcw, label: t('sidebar_vozvrat') }]
      : []),
  ];

  return (
    <nav
      data-test-id="pos-sidebar"
      className={`flex shrink-0 flex-col border-[var(--ms-border)] border-r bg-[var(--pos-sidebar-bg)] transition-[width] duration-150 ${
        collapsed ? 'w-[72px]' : 'w-[240px]'
      }`}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {items.map((item) => (
          <SidebarButton
            key={item.key}
            item={item}
            active={mode === item.key}
            collapsed={collapsed}
            onClick={() => onModeChange(item.key)}
          />
        ))}
      </div>

      {/* Smena — pastda, ajratilgan (spec §3.2). */}
      <div className="border-[var(--ms-border)] border-t">
        <SidebarButton
          item={{ key: 'smena', icon: Settings, label: t('sidebar_smena') }}
          active={mode === 'smena'}
          collapsed={collapsed}
          onClick={() => onModeChange('smena')}
        />
        <button
          type="button"
          data-test-id="pos-sidebar-toggle"
          aria-label={collapsed ? t('sidebar_expand') : t('sidebar_collapse')}
          onClick={onToggleCollapsed}
          className="flex h-[48px] w-full items-center justify-center text-[var(--pos-sidebar-fg)] transition-colors hover:bg-[var(--pos-sidebar-hover)]"
        >
          {collapsed ? (
            <ChevronRight className="h-[24px] w-[24px]" />
          ) : (
            <ChevronLeft className="h-[24px] w-[24px]" />
          )}
        </button>
      </div>
    </nav>
  );
}
