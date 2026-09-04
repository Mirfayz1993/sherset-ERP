/**
 * S3 (kassa vaqti) — KALENDAR KUNI shartnomasi.
 *
 * Qulflanadigan narsa: «necha kun o'tdi» KALENDAR kunlari bo'yicha sanaladi
 * (24 soatlik bo'lak bo'yicha emas) va chegara `Asia/Tashkent` yarim tunida
 * turadi — UTC yarim tunida emas. Bu hisob serverning qarz reyestri bilan
 * bir xil chiqishi shart, aks holda bitta qarz kassada va menejer ekranida
 * ikki xil yoshda ko'rinardi.
 */

import { describe, expect, it, vi } from 'vitest';
import { posDayKey, posDaysBetween, posDaysSince } from './pos-calendar';

describe('posDayKey — Toshkent kalendar kuni', () => {
  it('UTC kuni bilan Toshkent kuni AJRALADI (19:00 UTC = ertasi kun)', () => {
    // 19:00 UTC = 00:00 (+1 kun) Toshkentda.
    expect(posDayKey(new Date('2026-08-15T19:00:00.000Z'))).toBe('2026-08-16');
    expect(posDayKey(new Date('2026-08-15T18:59:59.999Z'))).toBe('2026-08-15');
  });

  it('serverning `tashkentDayKey` chegara namunalari bilan mos', () => {
    // `apps/api/.../debt-collection.test.ts:53` dagi ayni holat.
    expect(posDayKey(new Date('2026-08-08T20:00:00.000Z'))).toBe('2026-08-09');
    // `sale-debt-registry.test.ts` dagi namunalar.
    expect(posDayKey(new Date('2026-08-25T04:00:00.000Z'))).toBe('2026-08-25');
    expect(posDayKey(new Date('2026-08-25T19:30:00.000Z'))).toBe('2026-08-26');
  });
});

describe('posDaysBetween — soat emas, KUN sanaladi', () => {
  it('🔴 20 daqiqa ham yarim tundan o`tsa 1 KUN beradi', () => {
    const from = new Date('2026-08-15T18:50:00.000Z'); // Toshkent 23:50
    const to = new Date('2026-08-15T19:10:00.000Z'); // Toshkent 00:10 (16-si)
    expect(posDaysBetween(from, to)).toBe(1);
  });

  it('🔴 23 soat ham bir kalendar kun ichida bo`lsa 0 beradi', () => {
    const from = new Date('2026-08-15T19:10:00.000Z'); // Toshkent 00:10
    const to = new Date('2026-08-16T18:00:00.000Z'); // Toshkent 23:00 (ayni kun)
    expect(posDaysBetween(from, to)).toBe(0);
  });

  it('to`liq kunlar: 5 kun oldingi sana → 5', () => {
    expect(
      posDaysBetween(new Date('2026-08-10T06:00:00.000Z'), new Date('2026-08-15T06:00:00.000Z')),
    ).toBe(5);
  });

  it('teskari yo`nalish manfiy (chaqiruvchi o`zi qisadi)', () => {
    expect(
      posDaysBetween(new Date('2026-08-15T06:00:00.000Z'), new Date('2026-08-10T06:00:00.000Z')),
    ).toBe(-5);
  });
});

describe('posDaysSince — qarz oynasi uchun', () => {
  /** Qurilma soati ATAYLAB adashtirilgan — modul unga QARAMAYDI. */
  const DEVICE_LIE = new Date('2019-01-01T00:00:00.000Z');

  it('vaqt manbasi PARAMETR — qurilma soati natijaga ta`sir qilmaydi', () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE_LIE);
    try {
      const now = new Date('2026-08-16T06:00:00.000Z');
      expect(posDaysSince('2026-08-10T06:00:00.000Z', now)).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('yarim tun chegarasi: kechagi 23:50 qarzi bugun 00:10 da «1 kun»', () => {
    expect(posDaysSince('2026-08-15T18:50:00.000Z', new Date('2026-08-15T19:10:00.000Z'))).toBe(1);
  });

  it('sana yo`q / buzuq → `null` (O`LCHANMAGAN, 0 EMAS)', () => {
    const now = new Date('2026-08-16T06:00:00.000Z');
    expect(posDaysSince(null, now)).toBeNull();
    expect(posDaysSince(undefined, now)).toBeNull();
    expect(posDaysSince('buzuq', now)).toBeNull();
  });

  it('kelajakdagi sana manfiy bermaydi — 0 ga qisiladi (mavjud xulq)', () => {
    expect(posDaysSince('2026-08-20T06:00:00.000Z', new Date('2026-08-16T06:00:00.000Z'))).toBe(0);
  });
});
