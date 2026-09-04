/**
 * Kassa vaqti — YAGONA manba (S-reja S1: `docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md`).
 *
 * Muammo (egasi, 2026-09-04): «kassada vaqt qurilma vaqti bilan ishlayapti va
 * qurilmada vaqt xato bo'lsa xato ko'rsatmoqda». Kassa mashinasining soati
 * adashsa, ekrandagi soat, chekdagi sana va «o'tgan vaqt» hisoblari ham adashadi.
 *
 * Yechim — vaqtni SERVERDAN olish. Bu loyihaning mavjud tamoyilining davomi:
 * `CurrentSessionSchema.openMinutes` izohi «Yosh SERVERDA hisoblanadi, ekranda
 * emas … Ekran o'zi hisoblasa, chegara ikki joyda ikki xil bo'lardi» deydi.
 *
 * 🔴 YANGI SO'ROV QO'SHILMAYDI. Manba — HAR javobning `Date` sarlavhasi:
 * `authedFetch` uni `noteServerDate()` ga uzatadi va biz server bilan qurilma
 * orasidagi farqni («skew») saqlaymiz. POS allaqachon polling qiladi (cheklar
 * 8s, tovarlar 60s), demak skew o'zidan yangilanib turadi. Jonlida `/api/`
 * nginx'dan to'g'ridan-to'g'ri API'ga ketadi (`deploy/nginx-erp.sherset.uz.conf`
 * → `127.0.0.1:4001`), ya'ni sarlavha API mashinasiniki.
 *
 * Aniqlik: `Date` sarlavhasi sekundgacha yaxlitlangan (RFC 7231) va javob
 * tarmoqda yurgan vaqt hisobga olinmaydi — skew ~1-2 s gacha kam chiqishi
 * mumkin. Minutli soat, chek sanasi va «necha daqiqa o'tdi» uchun bu ahamiyatsiz
 * (tuzatilayotgan xato soatlar va kunlar bilan o'lchanadi).
 */

/** POS va chek uchun QAT'IY mintaqa — qurilma sozlamasi so'ralmaydi. */
export const POS_TZ = 'Asia/Tashkent';

const STORAGE_KEY = 'pos.clock.skew-ms';

/**
 * Jitter filtri. `Date` sekundgacha yaxlitlangani uchun ketma-ket o'lchovlar
 * ~1 s ga tebranadi; shu chegaradan kichik farq YOZILMAYDI, aks holda soat
 * har so'rovda oldinga-orqaga sakrardi.
 */
const MIN_UPDATE_MS = 1_500;

/**
 * Aql chegarasi (~10 yil). Buzuq proksi yoki g'alati sarlavha butun ekranni
 * boshqa asrga olib ketmasin — bunday qiymat shunchaki rad etiladi.
 */
const MAX_SANE_SKEW_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

/**
 * Kassirga OGOHLANTIRISH beriladigan chegara (S-reja S5).
 *
 * Bu yerda — `MIN_UPDATE_MS` bilan YONMA-YON — turishi ataylab: ikkala chegara
 * ham skew semantikasiga tegishli va bir-biriga bog'liq. Jitter (~1.5 s) shovqin
 * deb tashlanadi, ogohlantirish esa undan **80 barobar** kattaroqda boshlanadi,
 * ya'ni chip `Date` sarlavhasining sekundlik yaxlitlanishidan yoki tarmoq
 * kechikishidan HECH QACHON yonmaydi.
 *
 * Nega aynan 2 daqiqa: chek va smena hisobotlari daqiqa aniqligida o'qiladi;
 * undan kichik farq qog'ozda ham, ekranda ham ko'rinmaydi (ko'rsatilsa —
 * kassir o'rganib, chipga umuman qaramay qo'yardi). 2 daqiqadan kattasi esa
 * qurilma soati «suzib ketgan» yoki mintaqasi/RTC'si adashgan demakdir —
 * bu odam aralashuvini talab qiladi (`docs/ops/kassa-vaqt-ntp.md`).
 */
export const SKEW_WARN_MS = 2 * 60 * 1_000;

let skewMs = 0;
let restored = false;

/**
 * Skew HAQIQATAN o'lchanganmi (server bilan kamida bir marta taqqoslanganmi).
 *
 * 🔴 `skewMs === 0` ni «hammasi joyida» deb o'qib bo'LMAYDI: soati ideal
 * mashinada ham, hech qachon serverga ulanmagan mashinada ham qiymat aynan `0`.
 * Ogohlantirish chipi shu ikkisini ajratishi shart — aks holda o'lchanmagan
 * holat ekranda «yashil» bo'lib ko'rinardi (S1/S3 dagi «soxta qiymat
 * chizilmaydi» qaroriga zid).
 */
let measured = false;

/**
 * Oxirgi ma'lum skew'ni `localStorage` dan bir marta tiklaydi — qurilma
 * oflayn ko'tarilsa ham soat to'g'ri boshlanadi. Hech qachon ulanmagan
 * mashinada `0` qoladi (bugungi xulq — regressiya emas).
 */
function restoreOnce(): void {
  if (restored) return;
  restored = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Math.abs(parsed) <= MAX_SANE_SKEW_MS) {
      skewMs = parsed;
      // Saqlangan qiymat bor = bu qurilma serverni ALLAQACHON ko'rgan.
      measured = true;
    }
  } catch {
    // Maxfiy rejim / o'chirilgan saqlash — skew shunchaki 0 dan boshlanadi.
  }
}

/** Server bilan qurilma orasidagi farq (ms). Musbat = qurilma orqada. */
export function clockSkewMs(): number {
  restoreOnce();
  return skewMs;
}

/**
 * Skew kamida bir marta o'lchanganmi. `clockSkewMs()` ning `0` i MA'NOLI
 * («soat to'g'ri») ekanini shu funksiya tasdiqlaydi — `false` bo'lsa `0`
 * shunchaki «bilmaymiz» degani.
 */
export function clockSkewMeasured(): boolean {
  restoreOnce();
  return measured;
}

/**
 * Serverga tekislangan hozirgi vaqt. POS doirasida `new Date()` O'RNIGA shu
 * ishlatiladi (S-reja §2 qoida 4). Serverda render paytida (`window` yo'q)
 * mashinaning o'z vaqti qaytadi — u allaqachon server vaqti.
 */
export function serverNow(): Date {
  return new Date(Date.now() + clockSkewMs());
}

/**
 * Javobdagi `Date` sarlavhasidan skew'ni yangilaydi. `authedFetch` chaqiradi.
 *
 * 🔴 Bu funksiya HECH QACHON otmaydi — vaqt sinxronizatsiyasi tufayli savdo
 * so'rovi yiqilishi mumkin emas.
 */
export function noteServerDate(res: Response): void {
  try {
    // Keshdan kelgan javobning `Date`i eski — u soatni orqaga tortib yuborardi.
    if (res.headers.get('age') != null) return;

    const raw = res.headers.get('date');
    if (!raw) return;
    const serverMs = Date.parse(raw);
    if (!Number.isFinite(serverMs)) return;

    const next = serverMs - Date.now();
    if (Math.abs(next) > MAX_SANE_SKEW_MS) return;

    restoreOnce();
    // 🔴 Jitter filtridan OLDIN: taqqoslash SODIR BO'LDI, hatto natija eskisiga
    // teng chiqib yozilmasa ham. Aks holda soati ideal mashinada (`next ≈ 0`)
    // skew abadiy «o'lchanmagan» bo'lib qolardi.
    measured = true;
    if (Math.abs(next - skewMs) < MIN_UPDATE_MS) return;
    skewMs = next;

    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Saqlash ishlamasa ham joriy sessiyada skew amal qiladi.
    }
  } catch {
    // Sarlavhalar o'qilmasa — qurilma vaqtida qolamiz (bugungi xulq).
  }
}
