/**
 * KUNLIK CHEK RAQAMI — kalit shakli va KUN CHEGARASI (2026-09-02, egasi).
 *
 * Bu yerda bitta narsa qulflanadi: hisoblagich kaliti Asia/Tashkent kalendar
 * kuniga bog'langan va `VARCHAR(64)` ga sig'adi. Kun chegarasi xato bo'lsa
 * kassirning ertalabki cheklari kechagi raqamdan davom etadi — bu qog'ozda
 * ko'rinadigan, lekin testsiz sezilmaydigan xato.
 */

import { describe, expect, it } from 'vitest';
import {
  DAILY_RECEIPT_KEY_PREFIX,
  dailyReceiptSequenceKey,
  tashkentDayKey,
} from './daily-receipt-number.js';

const CASHIER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('tashkentDayKey — kun chegarasi UTC+5', () => {
  it('Toshkent 00:00 (= 19:00Z oldingi kun) YANGI kunga tushadi', () => {
    // 2026-09-02T19:00:00Z = 03.09.2026 00:00 Toshkent.
    expect(tashkentDayKey(new Date('2026-09-02T19:00:00.000Z'))).toBe('2026-09-03');
  });

  it('Toshkent 23:59 (= 18:59Z) hali ESKI kunda', () => {
    expect(tashkentDayKey(new Date('2026-09-02T18:59:59.999Z'))).toBe('2026-09-02');
  });

  it('UTC yarim tuni Toshkent kunini ALMASHTIRMAYDI (05:00 local)', () => {
    // Naive `toISOString().slice(0,10)` bu yerda `2026-09-03` berardi — ya'ni
    // kassirning kuni yarim tunda emas, soat 05:00 da qayta boshlanardi.
    expect(tashkentDayKey(new Date('2026-09-03T00:00:00.000Z'))).toBe('2026-09-03');
    expect(tashkentDayKey(new Date('2026-09-02T23:00:00.000Z'))).toBe('2026-09-03');
  });
});

describe('dailyReceiptSequenceKey', () => {
  it('kassir + kun bo`yicha ajraladi', () => {
    const at = new Date('2026-09-02T09:00:00.000Z');
    const other = '00000000-0000-4000-8000-000000000001';
    expect(dailyReceiptSequenceKey(CASHIER, at)).not.toBe(dailyReceiptSequenceKey(other, at));
    expect(dailyReceiptSequenceKey(CASHIER, at)).not.toBe(
      dailyReceiptSequenceKey(CASHIER, new Date('2026-09-03T09:00:00.000Z')),
    );
  });

  it('bir kassirning bir kunidagi har qanday oni AYNI kalit beradi', () => {
    expect(dailyReceiptSequenceKey(CASHIER, new Date('2026-09-01T19:00:00.000Z'))).toBe(
      dailyReceiptSequenceKey(CASHIER, new Date('2026-09-02T18:59:00.000Z')),
    );
  });

  it('kalit `document_sequences.key` VARCHAR(64) ga sig`adi', () => {
    const key = dailyReceiptSequenceKey(CASHIER, new Date('2026-09-02T09:00:00.000Z'));
    expect(key.startsWith(DAILY_RECEIPT_KEY_PREFIX)).toBe(true);
    expect(key.length).toBeLessThanOrEqual(64);
  });
});
