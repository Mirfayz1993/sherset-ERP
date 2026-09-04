/**
 * SOTUVSIZ CHEK (proforma, 2026-08-16 — egasi so'rovi): savatdan to'g'ridan-
 * to'g'ri chek-modeli yig'iladi — hech qanday hujjat/sotuv yaratilmaydi.
 *
 * Shartnoma:
 *  · pozitsiyalar savat qatorlaridan (narx kassir qo'ygan qiymat, basePrice
 *    muzlatilgan sotilish narxi — chekdagi «Chegirma» shundan hisoblanadi);
 *  · savat-darajali `discountPct` HAR QATOR summasiga qo'llanadi (haqiqiy
 *    sotuv qatorlari bilan bir xil ko'rinish) — half-up yaxlitlash;
 *  · jami = qator summalari yig'indisi; «to'lov» naqd sifatida jami bilan
 *    to'ldiriladi (egasi qarori: chek haqiqiy sotuv chekidan farqsiz);
 *  · sotuvchi/do'kon nomlari joriy sessiyadan keladi.
 */

import type { CartLine } from '@/app/(app)/sotuv/_components/pos-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReceiptModel } from './receipt-model';
import { cartToProformaReceipt } from './receipt-proforma-model';

const LINE = (over: Partial<CartLine> = {}): CartLine => ({
  productId: 'p-1',
  productName: 'Kabel 2×2.5',
  quantity: '1',
  priceMinor: 1000000n,
  priceStr: '10000',
  costMinor: null,
  wholesaleMinor: null,
  basePriceMinor: 1000000n,
  ...over,
});

const CTX = {
  number: 'CHEK-091530',
  moment: '2026-08-16T09:15:30.000Z',
  cashierName: 'Kassir Aliyev',
  organization: { name: 'Sherset elektro tovarlar', legalTitle: 'MCHJ Sherset', phone: null },
};

describe('cartToProformaReceipt — savatdan chek-kirishi', () => {
  it('pozitsiya: narx×soni, base o`tadi, jami = Σ, to`lov naqd = jami', () => {
    const input = cartToProformaReceipt(
      [LINE(), LINE({ productId: 'p-2', quantity: '2' })],
      0,
      CTX,
    );

    expect(input.positions).toHaveLength(2);
    expect(input.positions[0]).toMatchObject({
      quantity: '1',
      priceMinor: '1000000',
      sumMinor: '1000000',
      basePriceMinor: '1000000',
    });
    expect(input.positions[1]?.sumMinor).toBe('2000000');
    expect(input.sumMinor).toBe('3000000');
    // Egasi qarori: chek haqiqiy sotuv chekidan farqsiz — naqd to'lov ko'rinadi.
    expect(input.cashAmountMinor).toBe('3000000');
    expect(input.changeMinor).toBe('0');
    expect(input.name).toBe('CHEK-091530');
    expect(input.session.cashier.name).toBe('Kassir Aliyev');
  });

  it('savat-chegirmasi (10%) har qator summasiga tushadi, jami mos', () => {
    const input = cartToProformaReceipt(
      [LINE({ quantity: '2' }), LINE({ productId: 'p-2', priceMinor: 500000n })],
      10,
      CTX,
    );
    // 2×10 000 = 20 000 → 18 000; 5 000 → 4 500.
    expect(input.positions[0]?.sumMinor).toBe('1800000');
    expect(input.positions[1]?.sumMinor).toBe('450000');
    expect(input.sumMinor).toBe('2250000');
  });

  it('kasr miqdor half-up: 3 × 3 333,33 so`m, 10% → qator 8 999,99 so`m', () => {
    const input = cartToProformaReceipt([LINE({ quantity: '3', priceMinor: 333333n })], 10, CTX);
    // 3 × 333333 = 999999 tiyin; 10% chegirma → 899999.1 → half-up 899999.
    expect(input.positions[0]?.sumMinor).toBe('899999');
    expect(input.sumMinor).toBe('899999');
  });

  it('modelga ulanish: 10 000 → 9 000 qator chekda «Chegirma: 1 000» beradi', () => {
    const input = cartToProformaReceipt([LINE({ priceMinor: 900000n, priceStr: '9000' })], 0, CTX);
    const m = buildReceiptModel(input);
    expect(m.subtotal).toBe('10 000');
    expect(m.discount).toBe('1 000');
    expect(m.total).toBe('9 000');
    expect(m.title).toBe('SAVDO CHEKI');
  });

  it('savat-pct ham chegirmaga qo`shiladi: base 10 000, narx 10 000, 10% → chegirma 1 000', () => {
    const m = buildReceiptModel(cartToProformaReceipt([LINE()], 10, CTX));
    expect(m.subtotal).toBe('10 000');
    expect(m.discount).toBe('1 000');
    expect(m.total).toBe('9 000');
  });
});

/**
 * S2 (kassa vaqti) — SOTUVSIZ CHEKNING SANASI.
 *
 * Bu chek serverda hech qanday hujjat qoldirmaydi: uning sanasini keyin
 * bazadan tekshirib bo'lmaydi, qog'ozdagi raqam YAGONA nusxa. Shuning uchun
 * `moment` sahifada `serverNow()` dan olinadi — kassa mashinasining soatidan
 * emas. Bu yerda sahifaning aynan shu oqimi (skew → `moment` → chek modeli)
 * uchdan-uchi bilan qulflanadi.
 *
 * Skew modul holati bo'lgani uchun har test `vi.resetModules()` bilan TOZA
 * `clock` nusxasini oladi (`lib/clock.test.ts` naqshi).
 */
describe('S2 — skew: qurilma sanasi xato, chekdagi sana to`g`ri', () => {
  /** Faqat `headers` kerak — `noteServerDate` boshqa hech nimaga tegmaydi. */
  const RES = (dateHeader: string): Response =>
    ({ headers: new Headers({ Date: dateHeader }) }) as unknown as Response;

  async function freshClock() {
    vi.resetModules();
    return await import('@/lib/clock');
  }

  /** Sahifadagi `printProforma` oqimining sof qismi (page.tsx bilan bir xil). */
  const receiptDateFor = (moment: string): string =>
    buildReceiptModel(cartToProformaReceipt([LINE()], 0, { ...CTX, moment })).dateLabel;

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('qurilma IKKI KUN orqada — chekda server kuni chiqadi, qurilmaniki emas', async () => {
    const device = new Date('2026-08-14T09:15:30.000Z');
    const server = new Date('2026-08-16T09:15:30.000Z');
    vi.setSystemTime(device);

    const clock = await freshClock();
    clock.noteServerDate(RES(server.toUTCString()));

    // Sahifa aynan shuni qiladi: `const now = serverNow()` → `moment`.
    const label = receiptDateFor(clock.serverNow().toISOString());

    expect(label).toBe('16.08.2026');
    // Tuzatishdan OLDIN aynan shu qiymat qog'ozga bosilardi.
    expect(label).not.toBe('14.08.2026');
  });

  it('yarim tun chegarasi: 20 daqiqalik skew ham kunni to`g`rilaydi', async () => {
    // Qurilma: 23:50 (15-avgust, Toshkent). Server: 00:10 (16-avgust).
    const device = new Date('2026-08-15T18:50:00.000Z');
    const server = new Date('2026-08-15T19:10:00.000Z');
    vi.setSystemTime(device);

    const clock = await freshClock();
    clock.noteServerDate(RES(server.toUTCString()));

    expect(receiptDateFor(clock.serverNow().toISOString())).toBe('16.08.2026');
    // Qurilma soati bilan chek bir kun oldingi sana bilan chiqardi.
    expect(receiptDateFor(new Date().toISOString())).toBe('15.08.2026');
  });
});
