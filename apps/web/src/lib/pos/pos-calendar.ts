/**
 * KASSA KALENDAR KUNI — «necha kun o'tdi» ni sanashning YAGONA qoidasi
 * (S-reja S3: `docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md`).
 *
 * ## Nega 24 soatlik bo'lak YARAMAYDI
 * Qarz oynasi «eng eski qarzdan necha kun o'tdi» ni `(now − iso) / 86 400 000`
 * bilan sanardi. Bu KALENDAR kun emas, 24 soatlik bo'lak: kecha soat 23:50 da
 * yozilgan qarz bugun ertalab 08:00 da hamon «0 kun» bo'lib turadi, kassir esa
 * mijozga «kechagi qarz» deb aytadi. Kalendar kunlari farqi bunday adashmaydi.
 *
 * ## Nega Intl EMAS, qat'iy siljish
 * Bu hisob SERVERdagi qarz reyestri bilan bir xil chiqishi SHART — aks holda
 * kassir ekranida «5 kun», menejerning undirish ro'yxatida «4 kun» bo'lardi va
 * bitta qarz ikki xil yoshda ko'rinardi. Server aynan shu formulani ishlatadi:
 * `apps/api/src/modules/debt/sale-debt-registry.ts` → `tashkentDayKey()`
 * (`TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000`). Shu yerda u ATAYLAB nusxalanadi
 * (paketlararo import yo'q) va quyidagi test ikkalasining chegara-holatlarini
 * qulflaydi.
 *
 * O'zbekiston 1996-yildan beri yozgi vaqtga o'tmaydi, ya'ni `Asia/Tashkent`
 * yil bo'yi UTC+5 — qat'iy siljish bilan Intl bir xil natija beradi.
 * `POS_TZ` (`lib/clock.ts`) bilan bog'lanish shu izohda: ikkisi bir mintaqa.
 */

/** `Asia/Tashkent` = UTC+5, yil bo'yi (DST yo'q). Server bilan AYNI qiymat. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Sanani Toshkent kalendar kuniga (`YYYY-MM-DD`) aylantiradi. */
export function posDayKey(d: Date): string {
  return new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Toshkent devor-soatining `HHMMSS` raqamlari (S-reja S4).
 *
 * 🔴 Bu FORMATLASH emas, IDENTIFIKATOR bo'lagi. Yagona iste'molchisi —
 * tarmoq yiqilganda chek raqamining zaxira shoxi (`sotuv/page.tsx`,
 * `CHEK-HHMMSS`). Shakl (aynan 6 raqam) va takrorlanmaslik kafolati (bir kun
 * ichida sekund aniqligi) O'ZGARMAYDI; ilgari raqamlar `now.getHours()` bilan
 * QURILMA mintaqasida olinardi, endi do'kon mintaqasida.
 *
 * Nega `toLocaleTimeString` EMAS: (1) u qattiq BCP-47 teg talab qilardi —
 * `pos-bcp47-guard` uni rad etadi; (2) `hour12`/h24 chekkasi yarim tunni
 * ba'zi ICU nusxalarida «24» qilib yozadi (S1 hisobotida o'lchangan), ya'ni
 * identifikator ICU versiyasiga bog'lanib qolardi. Bu yerda esa `posDayKey`
 * bilan AYNI qat'iy siljish ishlatiladi — ikkalasi bir mintaqa, bir formula.
 */
export function posTimeDigits(d: Date): string {
  return new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(11, 19).replace(/:/g, '');
}

/**
 * Ikki sana orasidagi KALENDAR kunlar farqi (Toshkent bo'yicha).
 * Soatlar hisobga olinmaydi: 23:50 → ertasi 00:10 = **1 kun**.
 */
export function posDaysBetween(from: Date, to: Date): number {
  const fromMs = Date.parse(`${posDayKey(from)}T00:00:00.000Z`);
  const toMs = Date.parse(`${posDayKey(to)}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / DAY_MS);
}

/**
 * «Shu sanadan bugungacha necha kun» — qarz oynasi uchun.
 *
 * `null` = O'LCHANMAGAN (sana yo'q yoki buzuq) — 0 EMAS. Kelajakdagi sana
 * manfiy bermaydi, 0 ga qisiladi (mavjud xulq saqlanadi).
 *
 * 🔴 `now` PARAMETR: bu modul vaqt manbasi EMAS. Chaqiruvchi `serverNow()`
 * beradi (S-reja §2 qoida 4 — POS'da yagona vaqt manbasi `lib/clock.ts`).
 */
export function posDaysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const from = new Date(iso);
  if (Number.isNaN(from.getTime())) return null;
  const days = posDaysBetween(from, now);
  return days > 0 ? days : 0;
}
