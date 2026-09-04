/**
 * TSD nom/artikul QIDIRUVINING sof yadrosi (Prisma yo'q, Nest yo'q) — T-reja T3.
 *
 * 🔴 NEGA YANA BITTA SIRT (`/tsd/scan` yetmadi):
 * `scan` faqat AYNAN moslik qiladi (`barcodes has`, `code =`, `article =`).
 * Ya'ni shtrixi yirtilgan, yorlig'i o'chgan yoki shtrixi bazaga umuman
 * kiritilmagan tovar omborchi uchun **boshi berk ko'cha** edi (T-reja §1.2,
 * jonli hodisa). Nom bo'yicha qidirish uchun yagona mavjud yo'l `GET /products`
 * bo'lardi — u esa `buyPrice`, `minPrice`, `salePrices` qaytaradi va aynan
 * shuning uchun TSD allowlist'ida YO'Q. Demak: **narxsiz alohida sirt**,
 * `/tsd/scan` bilan BIR XIL oq ro'yxat ustida (`TSD_PRODUCT_SELECT`).
 *
 * Bu modul DB'ga tegmaydi — u faqat SO'ROVNI tozalaydi va NATIJANI saralaydi,
 * shuning uchun qoidalarni testda to'g'ridan-to'g'ri o'qish mumkin.
 */

/**
 * Qidiruv so'rovining eng qisqa uzunligi.
 *
 * 2 belgi — omborchi «uz» yozib «uzatgich» ni topa olsin degan chegara.
 * 1 belgiga tushirilmaydi: bitta harf bazadagi tovarlarning yarmiga mos
 * keladi va 4" ekranda foydasiz ro'yxat chiqadi (bundan tashqari, trigram
 * indeksi ham 3 belgidan qisqa naqshga yordam bermaydi — pastdagi izoh).
 */
export const SEARCH_MIN_LEN = 2;

/**
 * Eng uzun so'rov. Undan uzun matn KESILADI (rad etilmaydi): omborchi
 * tasodifan uzun matn qo'yib yuborsa ham qidiruv ishlashda davom etsin.
 */
export const SEARCH_MAX_LEN = 100;

/**
 * Bir so'rovda qaytadigan maksimal tovar.
 *
 * 30 — 4" ekranda ma'noli skroll chegarasi. Javobda `truncated` bayrog'i
 * ham boradi, ya'ni omborchi «hammasi shu» deb o'ylab qolmaydi: ro'yxat
 * kesilgan bo'lsa ekran «aniqroq yozing» deydi (jim kesish IS-5 klassi).
 */
export const SEARCH_TAKE = 30;

/** `searchRank` qaytaradigan bosqichlar — kichigi yaxshiroq. */
export const RANK_EXACT = 0;
export const RANK_PREFIX = 1;
export const RANK_CONTAINS = 2;

/**
 * So'rovni tozalaydi.
 *
 * 1. chekka bo'shliqlar olib tashlanadi va ichkilari BITTAga siqiladi
 *    (skanerlar va ekran klaviaturasi ikki probel qo'shib yuborishi odatiy);
 * 2. `%` va `\` OLIB TASHLANADI. Sabab tuzilmaviy: Prisma'ning `contains`
 *    filtri qiymatni `ILIKE '%' || $1 || '%'` naqshiga QO'YADI va LIKE
 *    metabelgilarini ekranlamaydi — ya'ni bitta `%` yozilsa so'rov BUTUN
 *    jadvalga mos kelib, tasodifiy 30 ta tovar qaytardi. `_` esa QOLDIRILADI:
 *    u artikullarda haqiqatan uchraydi (`KAB_2x1.5`) va bitta belgiga mos
 *    kelgani uchun zarari yo'q.
 * 3. `SEARCH_MAX_LEN` gacha kesiladi.
 *
 * Skanerlangan QR (`.../scan?c=`) bu yerda ochilmaydi — u `normalizeScanCode`
 * ning ishi va skan `/tsd/scan` ga boradi; qidiruv maydoni odam yozadigan
 * matn uchun.
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.replace(/[%\\]/g, '').trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX_LEN);
}

/** Saralash uchun kerak bo'ladigan minimal maydonlar (`TSD_PRODUCT_SELECT` ning bo'lagi). */
export interface SearchSortable {
  name: string;
  code: string | null;
  article: string | null;
  barcodes: string[] | null;
  archived: boolean;
}

/**
 * Qator so'rovga QANCHALIK mos kelgani — kichigi yaxshiroq.
 *
 * `RANK_EXACT` — maydonlardan biri so'rovga AYNAN teng (artikulni to'liq
 * yozgan omborchi uni birinchi qatorda ko'rishi kerak); `RANK_PREFIX` —
 * maydon so'rov bilan BOSHLANADI; `RANK_CONTAINS` — qolgan hammasi.
 *
 * Registr hisobga olinmaydi (DB filtri ham `insensitive`). Funksiya SOF va
 * DB filtridan MUSTAQIL: hech bir maydonda so'rov umuman uchramasa ham
 * `RANK_CONTAINS` qaytadi — bu holat amalda bo'lmaydi (qator DB filtridan
 * o'tgan), lekin funksiya har qanday kirishda aniq qiymat berishi kerak.
 */
export function searchRank(item: SearchSortable, query: string): number {
  const q = query.toLowerCase();
  if (q === '') return RANK_CONTAINS;
  let best = RANK_CONTAINS;
  const fields: (string | null)[] = [item.name, item.code, item.article, ...(item.barcodes ?? [])];
  for (const field of fields) {
    if (!field) continue;
    const value = field.toLowerCase();
    // Aynan moslikdan yaxshiroq bosqich yo'q — darhol qaytamiz.
    if (value === q) return RANK_EXACT;
    if (value.startsWith(q)) best = RANK_PREFIX;
  }
  return best;
}

/**
 * Natijalarni saralaydi: **arxivlanganlar eng oxirida**, ular ichida va
 * tashqarisida — moslik bosqichi bo'yicha.
 *
 * Arxiv bosqichdan USTUN: arxivlangan tovarning artikuli aynan mos kelsa ham
 * u tirik tovardan yuqoriga chiqmasligi kerak — omborchi kundalik ishda
 * arxivlanganini QIDIRMAYDI, u ro'yxatda faqat «bor ekan» deb turadi.
 *
 * Teng kalitlarda tartib O'ZGARMAYDI: `Array.prototype.sort` barqaror
 * (ES2019), ya'ni serverning `name asc` tartibi guruh ichida saqlanadi —
 * T1 dagi `sortedBy` qarorining aynan o'zi. Kirish massivi o'zgartirilmaydi.
 */
export function sortSearchHits<T extends SearchSortable>(items: readonly T[], query: string): T[] {
  const ranks = new Map<T, number>();
  for (const item of items) ranks.set(item, searchRank(item, query));
  return [...items].sort((a, b) => {
    const archived = Number(a.archived) - Number(b.archived);
    if (archived !== 0) return archived;
    return (ranks.get(a) ?? RANK_CONTAINS) - (ranks.get(b) ?? RANK_CONTAINS);
  });
}
