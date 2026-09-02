/**
 * KUNLIK CHEK RAQAMI — kassir bo'yicha (egasi, 2026-09-02).
 *
 * Talab: «chek chiqarilganida bugun nechta sotuv bo'lgan bo'lsa o'shaning
 * soni chiqishi kerak — 120 ta sotuv bo'lsa keyingi chek 121», va raqam
 * HAR BIR KASSIR uchun ALOHIDA sanaladi.
 *
 * Ilgari qog'ozda ikki xil raqam turardi:
 *   · haqiqiy sotuv cheki  → `ТРН-2026-00073` (yillik hujjat nomi)
 *   · sotuvsiz chek        → `CHEK-112159`   (soat 11:21:59 — ma'nosiz)
 * Endi ikkalasi ham shu yerdagi YAGONA hisoblagichdan raqam oladi.
 *
 * Hisoblagich `document_sequences` da yashaydi (`allocateDocumentNumber`) —
 * atomik `increment`, ya'ni ikki kassa bir vaqtda chek chiqarsa ham raqam
 * TAKRORLANMAYDI. `SELECT max()+1` naqshi bu yerda ataylab ishlatilmadi:
 * u aynan shu poygada ikki chekka bir raqam berardi.
 *
 * 🔴 KUN CHEGARASI — Asia/Tashkent, UTC EMAS. Server UTC'da yursa, soat
 * 00:00–05:00 orasida sotilgan chek UTC bo'yicha «kechagi» kunga tushib,
 * kassirning yangi kuni 1 dan emas, kechagi raqamdan davom etardi. O'zbekiston
 * 1995 yildan beri qat'iy UTC+5 (DST yo'q) — shuning uchun konstanta siljish
 * yetarli, kutubxona kerak emas (`report-date-bounds.util.ts` bilan ayni
 * yondashuv, konstanta ham o'sha yerdan olinadi — ikki nusxa bo'lmasin).
 */

import { TASHKENT_OFFSET_MS } from '../report/report-date-bounds.util.js';

/** `document_sequences.key` prefiksi — boshqa hisoblagichlar bilan to'qnashmaydi. */
export const DAILY_RECEIPT_KEY_PREFIX = 'CHEKKUN:';

/**
 * Instant → Asia/Tashkent kalendar kuni (`YYYY-MM-DD`).
 *
 * `toISOString()` UTC'da chiqadi, shuning uchun avval +5s siljitiladi:
 * 2026-09-02T20:30:00Z (= 03.09 01:30 Toshkent) → `2026-09-03`.
 */
export function tashkentDayKey(at: Date): string {
  return new Date(at.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Kassir + kun → hisoblagich kaliti.
 *
 * 🔴 Uzunlik: `document_sequences.key` — `VARCHAR(64)`. Bu yerda
 * 8 (prefiks) + 36 (uuid) + 1 + 10 (sana) = 55 belgi, ya'ni sig'adi.
 * Test buni qulflaydi — kalit shakli o'zgarsa jimgina 500 bermasin.
 */
export function dailyReceiptSequenceKey(cashierId: string, at: Date): string {
  return `${DAILY_RECEIPT_KEY_PREFIX}${cashierId}:${tashkentDayKey(at)}`;
}
