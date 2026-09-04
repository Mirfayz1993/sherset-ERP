import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * POS «Qarz to'lovi» ulanish qulfi (kassa TZ §7.2 / §8.4).
 *
 * Bu yerda ikki xato-klassi qulflanadi — ikkalasini ham typecheck, biome va
 * odatiy testlar JIM o'tkazib yuboradi:
 *
 * 1. **`retailShiftId` tushib qolishi.** Prop ixtiyoriy: dialog uni uzatmasa
 *    ham hamma narsa kompilyatsiya bo'ladi va to'lov muvaffaqiyatli o'tadi —
 *    faqat pul yashiqda bor-u smena hisobida YO'Q, ya'ni kassir har safar
 *    o'sha summaga «ortiqcha» chiqadi. Aynan shu bug backend tomonda
 *    tuzatilgan edi; FE uni qaytarib keltirmasin.
 *
 * 2. **PKO havolasining yo'li.** `window.open('/print/...')` — oddiy satr:
 *    yo'l noto'g'ri bo'lsa 404 sahifa ochiladi va hech bir gate shikoyat
 *    qilmaydi. Shuning uchun havola va route fayli birga tekshiriladi.
 */
const WEB_SRC = join(__dirname, '..');
const DIALOG = readFileSync(join(WEB_SRC, 'components', 'pos', 'debt-payment-dialog.tsx'), 'utf8');
const POS_PAGE = readFileSync(join(WEB_SRC, 'app', '(app)', 'sotuv', 'page.tsx'), 'utf8');

describe('POS qarz to`lovi — ulanish', () => {
  it('dialog to`lovni JORIY SMENAGA bog`laydi', () => {
    expect(DIALOG).toMatch(/retailShiftId:\s*sessionId/);
  });

  it('POS sahifasi dialogga haqiqiy smena id sini uzatadi', () => {
    // `sessionId={session.id}` bo'lmasa dialog ichidagi bog'lash ma'nosiz.
    expect(POS_PAGE).toMatch(/<DebtPaymentDialog[\s\S]{0,400}?sessionId=\{session\.id\}/);
  });

  it('to`lovdan keyin chek JIM chop etiladi (window.open EMAS) va zaxira route MAVJUD', () => {
    // 2026-08-16 (egasi): qarz cheki tovar cheki bilan AYNI yo'ldan yuradi —
    // qobiq/agent tirik bo'lsa oynasiz, darhol printerga. `window.open` bilan
    // to'g'ridan-to'g'ri ochish kassa.exe'da chekni EKRANGA chiqarardi.
    expect(POS_PAGE).toMatch(/printDebtReceiptViaAgent\(/);
    expect(POS_PAGE).not.toMatch(/window\.open\(`\/print\/debt-payment/);

    // Zaxira yo'l (agent/qobiq o'lik) — finishPrint popup'i; route fayli bor.
    expect(POS_PAGE).toMatch(/\/print\/debt-payment\/\$\{batchId\}\?auto=1/);
    const routeFile = join(WEB_SRC, 'app', 'print', 'debt-payment', '[batchId]', 'page.tsx');
    expect(existsSync(routeFile), `route yo'q: ${routeFile}`).toBe(true);
  });

  it('chek pay() qaytargan batchId bilan chop etiladi (qator id bilan emas)', () => {
    // Bitta to'lov = N qator: qator id bilan ochilsa chek CHALA chiqadi.
    expect(POS_PAGE).toMatch(/printDebtReceipt\(result\.batchId\)/);
  });

  it('ortiqcha to`lov tugmasi OLDINDAN bloklanadi', () => {
    // Server ham rad etadi, lekin kassir xatoni bosgandan keyin emas,
    // oldin ko'rishi kerak (§6.2 — qaytim naqddan).
    expect(DIALOG).toMatch(/overpay\s*===\s*0n/);
  });

  it('«Hammasi» tugmasi qoldiqni Number orqali emas, aniq qo`yadi', () => {
    // Number(bigint)/100 katta summada yaxlitlaydi → server bir tiyinlik
    // ortiqchani rad etardi. FE-09'dan keyin lokal `minorToInput` o'rniga
    // umumiy `formatAmountInput` (valyuta-scale bilan) ishlatiladi.
    // F6: qiymat `payAllInput` orqali o'tadi — dollarda PASTGA yaxlitlangan
    // sent, so'mda esa aynan qoldiq.
    expect(DIALOG).toMatch(
      /payAllInput = formatAmountInput\(payAllMinor, isUsd \? 'USD' : currency\)/,
    );
    expect(DIALOG).toMatch(/setAmountInput\(payAllInput\)/);
    expect(DIALOG).not.toMatch(/Number\(outstanding\)/);
  });

  it('summa float EMAS, umumiy parse orqali o`qiladi (FE-09)', () => {
    // Lokal `BigInt(Math.round(n * 100))` nusxasi qaytib kelmasin: u float
    // orqali yaxlitlardi va scale'ni qattiq 100 deb olardi.
    // F6: dollar ALOHIDA valyutada parse qilinadi (sent ≠ tiyin).
    expect(DIALOG).toMatch(/parseAmountToMinor\(amountInput, isUsd \? 'USD' : currency\)/);
    expect(DIALOG).not.toMatch(/Math\.round\([^)]*\*\s*100\)/);
  });

  /**
   * S-reja S3 — «kechikish kunlari» ikki nuqson bilan sanalardi: qurilma
   * soatidan va 24 soatlik bo'laklarda (kecha 23:50 dagi qarz bugun ertalab
   * hamon «0 kun»). Ikkalasi ham ulanish-darajasidagi xato: `posDaysSince`
   * ning o'z testlari yashil bo'lsa ham dialog eski formulaga qaytib qolsa
   * hech bir gate shikoyat qilmasdi.
   */
  it('«necha kun» server soatidan va KALENDAR kuni bo`yicha sanaladi (S3)', () => {
    // Faqat funksiya TANASI (izohlar emas — ular eski formulani tushuntiradi).
    const fn = DIALOG.slice(DIALOG.indexOf('function daysSince('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));

    expect(body).toMatch(/posDaysSince\(iso, serverNow\(\)\)/);
    // Eski formulaning ikkala bo'lagi ham qaytib kelmasin.
    expect(body).not.toMatch(/Date\.now\(\)/);
    expect(body).not.toMatch(/86_?400_?000/);
  });

  /**
   * F6 — dollar qarz to'lovining ulanish qulflari. Bularning har biri
   * typecheck'dan JIM o'tadi va faqat PULDA ko'rinadi:
   *  · kurs FE'da qo'lda kiritilsa yoki qayta hisoblansa — chek serverdagi
   *    summadan farq qiladi;
   *  · so'm ekvivalenti payload'ga qo'shilsa — ikki manba paydo bo'ladi.
   */
  it('kurs SERVERDAN olinadi (qo`lda kiritilmaydi)', () => {
    expect(DIALOG).toMatch(/exchange-rates\/rate\?currency=USD/);
  });

  it('payload`ga serverdan olingan `rateMinor` AYNAN uzatiladi', () => {
    expect(DIALOG).toMatch(/exchangeRate: usdRate\.rateMinor/);
  });

  it('so`m ekvivalenti payload`ga QO`SHILMAYDI (yagona manba — server)', () => {
    const body = DIALOG.slice(DIALOG.indexOf("api.post<PayResult>('/debts/pos/pay'"));
    // ⚠️ Ilgari bu yerda `indexOf('}),')` turardi va chaqiruvni payload
    // ichidagi `...(isUsd ? { … } : {}),` spread'ida KESIB tashlardi: tekshiruv
    // faqat birinchi bir necha qatorni ko'rar, spread'dan KEYIN qo'shilgan
    // `somMinor` ni jimgina o'tkazib yuborardi (2026-08-12 da topildi).
    const call = body.slice(0, body.indexOf('\n      }),'));
    expect(call).toContain('amountMinor: amountMinor.toString()');
    expect(call).not.toContain('somMinor');
  });

  /**
   * IDEMPOTENTLIK ulanishi (Faza 3). Serverdagi qulf FAQAT klient AYNI kalitni
   * qayta yuborganda ishlaydi — bu uch qatorning har biri jimgina yo'qolishi
   * mumkin va hech bir gate shikoyat qilmaydi:
   *  · kalit payload'ga qo'shilmasa — himoya umuman yo'q (server ixtiyoriy
   *    maydonni ko'rmaydi va eski xulqda qoladi);
   *  · initsializator lazy bo'lmasa — har render'da yangi uuid, retry ma'nosiz;
   *  · `reset()` da yangilanmasa — keyingi HAQIQIY to'lov «takror» deb
   *    hisoblanib pul JIMGINA yozilmasdan qolardi.
   */
  it('payload IDEMPOTENTLIK kalitini olib ketadi', () => {
    const body = DIALOG.slice(DIALOG.indexOf("api.post<PayResult>('/debts/pos/pay'"));
    // ⚠️ `indexOf('}),')` BU YERDA YARAMAYDI: payload ichidagi
    // `...(isUsd ? { exchangeRate } : {}),` spread'i aynan shu ketma-ketlikni
    // o'zidan oldin beradi va chaqiruv KESILIB qolardi (test jimgina yashil
    // bo'lardi). Chaqiruvning haqiqiy yopilishi — qator boshidagi `}),`.
    const call = body.slice(0, body.indexOf('\n      }),'));
    expect(call).toMatch(/clientRequestId:\s*requestId/);
  });

  it('kalit LAZY tug`iladi (har render`da yangilanmaydi)', () => {
    // `useState(newRequestId())` (lazy EMAS) ham kompilyatsiya bo'ladi,
    // lekin qiymat har render'da qayta hisoblanardi.
    expect(DIALOG).toMatch(/useState\(\(\)\s*=>\s*newRequestId\(\)\)/);
  });

  it('`reset()` yangi kalit beradi (keyingi to`lov takror deb hisoblanmasin)', () => {
    const reset = DIALOG.slice(DIALOG.indexOf('const reset = useCallback('));
    const bodyEnd = reset.indexOf('}, []);');
    expect(reset.slice(0, bodyEnd)).toMatch(/setRequestId\(newRequestId\(\)\)/);
  });

  /**
   * 🔴 SECURE-CONTEXT tuzog'i. `crypto.randomUUID()` faqat HTTPS/localhost'da
   * mavjud, kassa qobig'i esa server manzili sifatida `http://` ni ATAYLAB
   * qabul qiladi (`desktop/device-store.js#normalizeServerUrl`). LAN IP orqali
   * ochilgan monoblokda bare chaqiruv `useState` initsializatorida OTILIB butun
   * oynani yiqitardi — kassir qarz to'lovini umuman qabul qila olmasdi.
   */
  it('kalit generatori secure-context BO`LMASA ham ishlaydi', () => {
    const fn = DIALOG.slice(DIALOG.indexOf('function newRequestId('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // Mavjudlik tekshiruvisiz bare chaqiruv qolmasin.
    expect(body).toMatch(/typeof c\?\.randomUUID === 'function'/);
    // Zaxira yo'l bor va u HAQIQIY v4 yasaydi (server `z.string().uuid()`).
    expect(body).toMatch(/getRandomValues/);
    expect(body).toMatch(/0x40/);
    expect(body).toMatch(/0x80/);
  });
});
