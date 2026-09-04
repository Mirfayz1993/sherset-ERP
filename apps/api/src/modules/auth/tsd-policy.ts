/**
 * TSD siyosati (G-reja G5) — SOF modul (DB yo'q, Nest yo'q).
 *
 * TSD = kichik omborchining Android qo'l terminali. U kassa kioski BILAN BIR
 * XIL muammoga ega: token haqiqiy, ya'ni terminalni qo'lga kiritgan (yoki
 * uning kalitini olgan) odam butun ERP'ga `curl` bilan kira olardi. Shuning
 * uchun cheklov SERVER tomonda, ro'yxat esa **default-deny**.
 *
 * 🔴 KIOSKDAN IKKI FARQI:
 *
 *  1. **Manba boshqa.** Kiosk rejimi ROLdan hisoblanadi (`resolveUiMode`) —
 *     ya'ni xodimga tegishli. TSD esa SESSIYAga tegishli: ayni omborchi
 *     ertalab terminalda, tushdan keyin brauzerda ishlashi mumkin va brauzerda
 *     u cheklanmasligi kerak. Shuning uchun belgi tokendagi alohida
 *     `deviceMode` da'vosi (`auth.schema.ts`) va u refresh qatorida saqlanadi.
 *  2. **Narx YO'Q.** Egasining qoidasi: «Ombor xodimlari narx ko'rmaydi;
 *     kirim narxi faqat katta omborchiga». Shuning uchun bu ro'yxatda
 *     `/products` UMUMAN yo'q — u to'liq tovar qatorini (`buyPrice`,
 *     `minPrice`, `salePrices`) qaytaradi. Skaner uchun narxsiz alohida sirt
 *     bor: `GET /tsd/scan` (`tsd-scan.ts`), nom bo'yicha
 *     qidiruv uchun esa `GET /tsd/search` (`tsd-search.ts`) — ikkalasi
 *     ham AYNI oq ro'yxat ustida.
 */

import { type Rule, isAllowedBy } from './route-allowlist.js';

/**
 * TSD sessiyasiga OCHIQ endpointlar.
 *
 * Har qator uchun sabab yozilgan. Ro'yxatga qator qo'shishdan oldin savol:
 * «bu javobda NARX bormi?» — bo'lsa, qator o'rniga narxsiz sirt qilinadi.
 */
export const TSD_ALLOWED: readonly Rule[] = [
  // ── Omborchining o'z ishi: yig'ish/joylashtirish topshiriqlari ────────────
  // `GET /restock-tasks` o'ziga biriktirilganlarni beradi (`assigneeId` filtri
  // G2 da haqiqiy qilingan). Ro'yxat + detal + qator tasdiqlash.
  { prefix: '/restock-tasks', methods: ['GET'], why: "o'z topshiriqlari va detali" },
  {
    prefix: '/restock-tasks/:id/lines/:lineId/confirm',
    methods: ['POST'],
    exact: true,
    why: 'qatorni qo`lda tasdiqlash',
  },
  {
    prefix: '/restock-tasks/:id/confirm-scan',
    methods: ['POST'],
    exact: true,
    why: 'qatorni SKANER bilan tasdiqlash',
  },
  // G6 — «javonda topolmadim». Busiz topshiriq abadiy ochiq qolardi va chek
  // KONTROL NAVBATIGA TUSHMASDI (G2 sharti) — ya'ni kassa yopilmagan chek
  // bilan qotib qolardi. Bu qator chek tarkibini o'zgartirmaydi.
  {
    prefix: '/restock-tasks/:id/lines/:lineId/shortage',
    methods: ['POST'],
    exact: true,
    why: 'qatorda yetishmovchilikni belgilash',
  },
  // K4 — bo'linadigan tovar (kabel/sim/shlang) KESIMI. Terminalning o'z ishi:
  // omborchi javonda turib `BLK-` yorlig'ini skanerlaydi va kesimni yozadi.
  // Javobda NARX YO'Q (bo'lakda narx tushunchasi umuman yo'q) va QOLDIQQA
  // TEGMAYDI — kesim stok-neytral (K-reja 2-bo'lim). Reyestrni ERKIN
  // tahrirlash (`/stock-pieces`) TSD'ga OCHIQ EMAS: u `piecetracking`
  // ruxsatini talab qiladi va kichik omborchida u YO'Q (K-Q9).
  {
    prefix: '/restock-tasks/:id/lines/:lineId/cut',
    methods: ['POST'],
    exact: true,
    why: "bo'linadigan tovar kesimini yozish",
  },
  // 🔴 `POST /restock-tasks/from-sales-return` ATAYLAB YO'Q: u vozvratdan
  // topshiriq OCHADI (kassir/katta omborchi ishi), TSD esa topshiriqni
  // BAJARADI. `picking-sheets` ham yo'q — u chop etish yo'li (kassa qobig'i).

  // ── Skaner: NARXSIZ tovar/yacheyka ma'lumoti ──────────────────────────────
  // Alohida sirt, chunki `/products` javobida kirim narxi bor (yuqoridagi izoh).
  { prefix: '/tsd/scan', methods: ['GET'], exact: true, why: 'narxsiz skan-qidiruv' },
  // T3 — NOM/ARTIKUL qidiruvi. Alohida qator, chunki `/tsd/scan` `exact` va
  // uning ostiga yangi yo'l qo'shib bo'lmaydi (bu ataylab: `exact` yangi
  // sub-yo'l jimgina ochilib ketishining oldini oladi).
  //
  // 🔴 «Bu javobda narx bormi?» — YO'Q, va bu tuzilmaviy: javob `/tsd/scan`
  // bilan AYNI funksiyadan (`TsdService.buildProductHits`) chiqadi va o'sha
  // `TSD_PRODUCT_SELECT` oq ro'yxati ustida qurilgan. `/products` esa
  // qidiruv uchun ham OCHILMADI — u hamon bu ro'yxatda yo'q.
  { prefix: '/tsd/search', methods: ['GET'], exact: true, why: 'narxsiz nom-qidiruv' },
  {
    prefix: '/admin/stores/cells/by-barcode',
    methods: ['GET'],
    exact: true,
    why: 'yacheyka yorlig`ini skanerlash — narx yo`q',
  },

  // ── Yacheykaga joylashtirish / ko'chirish (F7 qatlami) ────────────────────
  // AYNAN ikki yo'l. `exact` MAJBURIY: `/products/:id` ning o'zi ochilib
  // ketsa kirim narxi TSD'ga yetib borardi. `cell-rebind` (uy-yacheykasini
  // o'zgartirish) — tovar kartasi tahriri, TSD ishi emas.
  {
    prefix: '/products/:id/cell-move',
    methods: ['POST'],
    exact: true,
    why: 'yacheykadan yacheykaga ko`chirish',
  },
  {
    prefix: '/products/:id/cell-place',
    methods: ['POST'],
    exact: true,
    why: 'yacheykasiz qoldiqni yacheykaga joylashtirish',
  },

  // ── Yacheyka sanash (inventarizatsiya — F-reja «faqat yacheyka» qoidasi) ──
  {
    prefix: '/admin/stores/:id/cells/:cellId/stock',
    methods: ['GET', 'PUT'],
    exact: true,
    why: 'yacheyka qoldig`ini ko`rish va sanash',
  },
  {
    prefix: '/admin/stores/:id/cells/:cellId/products',
    methods: ['GET'],
    exact: true,
    why: 'yacheykaga biriktirilgan tovarlar (sanash ro`yxati)',
  },

  // ── Sanash SESSIYASI (N-reja N2) ──────────────────────────────────────────
  //
  // 🔴 «Bu javobda narx bormi?» — YO'Q, va bu TUZILMAVIY: javob
  // `count-session.ts` dagi `COUNT_SESSION_SELECT` oq ro'yxati ustida
  // quriladi va unda `Inventory.sumMinor` («Стоимость») ATAYLAB yo'q;
  // hisoblagichlar ham faqat SANOQ (`cellCount`/`lineCount`/`surplusLines`/
  // `shortageLines`). Sessiya qatorlarida `cost_minor` NULL qoladi.
  //
  // 🔴 `/inventories` HAMON YO'Q va ochilmaydi: uning javobida `sumMinor` va
  // qator `costMinor` bor. Sessiya mavjud `Inventory` hujjatida yashasa ham
  // terminal unga faqat MANA SHU uchta narxsiz yo'l orqali tegadi.
  // Uchalasi ham `exact` — sub-yo'llar jimgina ochilmasin.
  { prefix: '/tsd/count-sessions', methods: ['POST'], exact: true, why: 'sanashni boshlash' },
  {
    prefix: '/tsd/count-sessions/active',
    methods: ['GET'],
    exact: true,
    why: 'ochiq sessiya va sanoq hisoblagichlari — narx yo`q',
  },
  {
    prefix: '/tsd/count-sessions/:id/close',
    methods: ['POST'],
    exact: true,
    why: 'sessiyani yopish (qoldiqqa tegmaydi)',
  },

  // ── Bildirishnomalar ──────────────────────────────────────────────────────
  {
    prefix: '/notifications',
    methods: ['GET', 'POST'],
    why: 'yangi topshiriq signali (SSE + o`qildi)',
  },

  // ── Har sessiyaga kerak bo'ladigan minimum ────────────────────────────────
  { prefix: '/auth', methods: ['*'], why: 'login/refresh/logout — qulfsiz qolmasin' },
  { prefix: '/health', methods: ['GET'], why: "sog'lik tekshiruvi" },
  { prefix: '/permissions/me', methods: ['GET'], why: 'ilova o`z tugmalarini shundan quradi' },
] as const;

/** TSD sessiyasi shu so'rovni bajara oladimi. **Default-deny.** */
export function isTsdAllowed(method: string, path: string): boolean {
  return isAllowedBy(TSD_ALLOWED, method, path);
}

/**
 * Sessiya qurilma rejimi — tokendagi `deviceMode` da'vosi.
 *
 * `undefined` = oddiy (brauzer/kassa) sessiya, cheklov yo'q. Eski tokenlarda
 * bu da'vo yo'q va ular hech qachon TSD deb qaralmaydi — ya'ni bu qo'shimcha
 * hech kimni jimgina cheklab qo'ymaydi.
 */
export const DEVICE_MODE_TSD = 'tsd' as const;
