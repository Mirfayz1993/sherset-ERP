/**
 * F2 (POS redizayn) — chap sidebar (spec §3.2).
 *
 * Qulflanayotgan shartnomalar:
 *  · 6 bo'lim: Sotuv · Navbat · Zakazlar · Cheklar · Mijozlar · Smena;
 *    `canSeeOrders=false` da Zakazlar chizilmaydi (ruxsat UX'i — haqiqiy
 *    qulf serverda, eski tab-bar bilan bir xil);
 *  · V2: `canRefund=true` bo'lsa Mijozlar OSTIDA Vozvrat bo'limi chiziladi,
 *    `false` da YO'Q (egasi 2026-09-01: qaytarish faqat ayrim xodimlarda);
 *  · badge'lar (savat soni, navbat soni) ko'rinadi; 0 bo'lsa chizilmaydi;
 *  · bo'lim bosilsa `onModeChange` TO'G'RI mode bilan chaqiriladi;
 *  · yig'ish tugmasi `onToggleCollapsed` chaqiradi;
 *  · har bo'lim balandligi 64px (`h-16`) — sensorli nishon (spec §4);
 *  · yig'iq holatda yozuv yo'q, lekin accessible-name SAQLANADI (aria-label)
 *    — MK32 testlari tugmalarni nom bo'yicha topadi, holatga bog'lanmasin.
 */

import { renderWithProviders, screen, userEvent, within } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { PosSidebar, type PosSidebarProps } from '../pos-sidebar';

function renderSidebar(over: Partial<PosSidebarProps> = {}) {
  const props: PosSidebarProps = {
    mode: 'sotuv',
    onModeChange: vi.fn(),
    badges: { savat: 0, navbat: 0 },
    canSeeOrders: true,
    canRefund: false,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    ...over,
  };
  renderWithProviders(<PosSidebar {...props} />);
  return props;
}

describe('PosSidebar — bo‘limlar', () => {
  it('6 bo‘limning hammasini chizadi (uz yorliqlari bilan)', () => {
    renderSidebar();
    for (const name of ['Sotuv', 'Navbat', 'Zakazlar', 'Cheklar', 'Mijozlar', 'Smena']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('`canSeeOrders=false` da Zakazlar bo‘limi YO‘Q', () => {
    renderSidebar({ canSeeOrders: false });
    expect(screen.queryByRole('button', { name: 'Zakazlar' })).not.toBeInTheDocument();
    // Qolgan 5 bo'lim joyida.
    expect(screen.getByRole('button', { name: 'Sotuv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Smena' })).toBeInTheDocument();
  });

  it('bo‘lim bosilsa `onModeChange` to‘g‘ri mode bilan chaqiriladi', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Navbat' }));
    expect(props.onModeChange).toHaveBeenCalledWith('navbat');
    await user.click(screen.getByRole('button', { name: 'Smena' }));
    expect(props.onModeChange).toHaveBeenCalledWith('smena');
  });

  it('aktiv bo‘lim `aria-current` bilan belgilanadi', () => {
    renderSidebar({ mode: 'cheklar' });
    expect(screen.getByRole('button', { name: 'Cheklar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Sotuv' })).not.toHaveAttribute('aria-current');
  });

  // V2 (egasi, 2026-09-01) — Vozvrat faqat `salesreturn.create` borga.
  it('`canRefund=false` (defolt) da Vozvrat bo‘limi YO‘Q', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'Vozvrat' })).not.toBeInTheDocument();
  });

  it('`canRefund=true` da Vozvrat chiziladi va bosilsa `onModeChange("vozvrat")`', async () => {
    const user = userEvent.setup();
    const props = renderSidebar({ canRefund: true });
    const btn = screen.getByRole('button', { name: 'Vozvrat' });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(props.onModeChange).toHaveBeenCalledWith('vozvrat');
  });
});

describe('PosSidebar — badge‘lar', () => {
  it('savat va navbat sonlari ko‘rinadi', () => {
    renderSidebar({ badges: { savat: 3, navbat: 5 } });
    expect(within(screen.getByTestId('pos-sidebar-item-sotuv')).getByText('3')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('pos-sidebar-item-navbat')).getByText('5'),
    ).toBeInTheDocument();
  });

  it('badge 0 bo‘lsa chizilmaydi', () => {
    renderSidebar({ badges: { savat: 0, navbat: 0 } });
    expect(
      within(screen.getByTestId('pos-sidebar-item-sotuv')).queryByText('0'),
    ).not.toBeInTheDocument();
  });

  it('badge yig‘iq holatda HAM ko‘rinadi (spec §3.2)', () => {
    renderSidebar({ collapsed: true, badges: { savat: 7, navbat: 0 } });
    expect(within(screen.getByTestId('pos-sidebar-item-sotuv')).getByText('7')).toBeInTheDocument();
  });
});

describe('PosSidebar — yig‘ish', () => {
  it('yig‘ish tugmasi `onToggleCollapsed` chaqiradi', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();
    await user.click(screen.getByTestId('pos-sidebar-toggle'));
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('yig‘iq holatda ham bo‘lim nomlari accessible (aria-label)', () => {
    renderSidebar({ collapsed: true });
    for (const name of ['Sotuv', 'Navbat', 'Zakazlar', 'Cheklar', 'Mijozlar', 'Smena']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('PosSidebar — sensorli o‘lchamlar (spec §4)', () => {
  // `h-16` EMAS: ildiz font-size 12px (ERP zichligi) — 4rem real 48px chiqib
  // spec buziladi. 64px token (`--pos-row-h`, pos-theme.css) px'da qulflanadi.
  it('har bo‘lim 64px balandlikda (`--pos-row-h` px-token)', () => {
    renderSidebar();
    for (const key of ['sotuv', 'navbat', 'zakazlar', 'cheklar', 'mijozlar', 'smena']) {
      expect(screen.getByTestId(`pos-sidebar-item-${key}`).className).toContain(
        'h-[var(--pos-row-h)]',
      );
    }
  });
});
