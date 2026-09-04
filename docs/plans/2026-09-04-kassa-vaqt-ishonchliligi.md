# Kassa vaqt ishonchliligi — qurilma soatidan qutulish (S-reja)

> **Yaratilgan:** 2026-09-04 · **Buyurtmachi:** Ozodbek (egasi) · **Holat:** BAJARILMOQDA — S1 TUGADI (2026-09-04)
> **Boshlang'ich nuqta:** `yacheyka-inventarizatsiya` branch, HEAD `8e698b11`. Jonli: `erp.sherset.uz`.
> **Sabab (egasining xabari, 2026-09-04):** «kassada vaqt qurilma vaqti bilan ishlayapti va qurilmada vaqt
> xato bo'lsa xato ko'rsatmoqda».
> **Bog'liq rejalar:** V-ish (`2026-09-01-pos-vozvrat-oynasi.md`), CFD (`2026-08-31-ikkinchi-ekran.md`),
> H-reja (`2026-08-24-split-kassa-hodisasi.md` — kassa to'xtashi qanchalik qimmatligi haqida).
>
> **Ijro tartibi (O'ZGARMAS):** har faza **ALOHIDA sessiyada**. Agent shu faylni to'liq o'qiydi, FAQAT o'z
> fazasini bajaradi, testlardan o'tkazadi, §6 «Hisobotlar» ga o'z fazasi ostiga yozadi va **TO'XTAYDI** —
> keyingi fazani BOSHLAMAYDI.

---

## 1. Kontekst (2026-09-04 da koddan o'qib o'lchandi)

### 1.1. 🟢 Nima BUZILMAGAN — buni bilmasdan tuzatishga kirishilmasin

**Bazadagi sotuv vaqti to'g'ri va qurilmaga bog'liq EMAS.** Server `moment`ni o'zi qo'yadi
(`apps/api/src/modules/retail-sale/retail-sale.service.ts:676` — `parsed.moment ? … : new Date()`), POS esa
sotuv yaratishda `moment` **umuman yubormaydi** (butun `apps/web/src/components/pos` va `sotuv/` bo'ylab
o'lchandi: `moment` faqat javobni O'QISHDA uchraydi). Demak:

- smena jamlari, kunlik hisobotlar, `document_sequences`, kassa farqlari — **hammasi server vaqtida**;
- muammo **faqat ko'rsatish va qog'oz** qatlamida.

Bu rejaning maqsadi — shu holatni **buzmasdan** ko'rsatish qatlamini ham server vaqtiga o'tkazish.

### 1.2. 🔴 Qurilma soatiga bog'langan joylar (to'liq ro'yxat, o'lchangan)

| # | Joy | Fayl:qator | Ta'siri |
|---|---|---|---|
| 1 | Header soati | `components/pos/pos-header.tsx:44,48` | kassir xato soat ko'radi |
| 2 | Mijoz ekrani (CFD) soati | `app/customer-display/page.tsx:603-604,670` | mijoz xato soat ko'radi |
| 3 | **Sotuvsiz chek (proforma) sanasi** | `app/(app)/sotuv/page.tsx:966,982` → `lib/pos/receipt-proforma-model.ts:34,66` | 🔴 **qog'ozga xato sana bosiladi** |
| 4 | Qoralama (park) yaratilgan vaqti | `sotuv/page.tsx:904,928,1007` va ko'rsatish `:1028` | ro'yxatda xato vaqt |
| 5 | Navbat kartasi «o'tgan vaqt» | `sotuv/_components/navbat-mode.tsx:43-45,51-60` | server `moment` − qurilma `now` = **soatlab xato** |
| 6 | Qarz «kechikish kunlari» | `components/pos/debt-payment-dialog.tsx:154` | xato kun soni |

### 1.3. 🟠 Ikkinchi, ko'rinmaydigan qatlam — qurilma TIMEZONE'i

Server bergan ISO vaqtni ekran `toLocaleTimeString/DateString(bcp47, …)` bilan formatlaydi — **`timeZone`siz**,
ya'ni qurilma mintaqasida. Qurilmaning soati to'g'ri bo'lib mintaqasi xato bo'lsa ham (yoki yarim tunga yaqin
paytda) **server sanasi siljib ko'rinadi**. O'lchangan joylar:

`sotuv/_components/cheklar-mode.tsx:407,1074` · `smena-mode.tsx:231` · `vozvrat-mode.tsx:347` ·
`zakazlar-mode.tsx:284` · `components/pos/customers-panel.tsx:464,787,792` · `customer-card-panel.tsx:195` ·
`debt-payment-dialog.tsx:144` · `customer-display/page.tsx:886` · **`lib/pos/receipt-model.ts:227`
(qog'oz chek sanasi!)** · `app/print/cash-in/[docId]/page.tsx:25` · `app/print/cash-out/[docId]/page.tsx:28`

**Loyihada bu allaqachon yechilgan — faqat POS'dan tashqarida:** HR/davomat/haydovchi sahifalari
`const TZ = 'Asia/Tashkent'` bilan ishlaydi (16 fayl), API esa hisobotlarda hamma joyda `Asia/Tashkent`
kalendar-kunini ishlatadi (`debt.service.ts:112`, `demand.service.ts:1602`, `counterparty-statement` …).
POS shu konvensiyadan **chetda qolgan**. Bu reja uni qatorga qo'yadi.

### 1.4. Muhandislik qarori — vaqtni QAYERDAN olamiz

Uch variant ko'rildi:

| Variant | Baho |
|---|---|
| Faqat qurilmada NTP (`w32tm`) sozlash | **Yetarli emas** — bitta kassa uzilib qolsa yana xato; dasturiy immunitet bermaydi. Lekin **ops sifatida baribir kerak** (S5). |
| Yangi `GET /time` endpoint + polling | Ortiqcha so'rov. `use-server-link.ts` da yozilgan konvensiya: *«YANGI so'rov/ping QO'SHILMAYDI»*. |
| ✅ **Har javobdagi HTTP `Date` sarlavhasidan «skew» (farq)** | **0 qo'shimcha so'rov.** POS allaqachon polling qiladi (cheklar 8s, tovarlar 60s). `Date` — CORS-safelisted, o'qish uchun sozlash shart emas. Jonlida `/api/` nginx'dan to'g'ridan-to'g'ri API'ga ketadi (`deploy/nginx-erp.sherset.uz.conf:5-6` → `127.0.0.1:4001`), demak sarlavha **API mashinasi**niki. |

Aniqlik: `Date` 1 sekundli qadamda + tarmoq kechikishi → **±2 s**. Minutli soat va chek sanasi uchun
ortig'i bilan yetarli (bugungi xato — soat va kunlar bilan o'lchanadi).

Bu qaror loyihaning mavjud tamoyilining davomi — `packages/contracts/src/cashier-session.ts` dagi
`openMinutes` izohi: *«Yosh SERVERDA hisoblanadi, ekranda emas … Ekran o'zi hisoblasa, chegara ikki joyda
ikki xil bo'lardi»*. Vaqt uchun ham **yagona manba = server**.

### 1.5. O'zgarmaydigan biznes qoidalari (bu reja ularga TEGMAYDI)

- Sotuv/qaytarish/kassa hujjatlarining `moment`ini **server qo'yadi** — o'zgarmaydi.
- Chek raqami `document_sequences` dan olinadi (2026-09-02) — vaqtdan yasalmaydi. Tarmoq yiqilgandagi
  `CHEK-HHMMSS` zaxira shoxi (`sotuv/page.tsx:977`) **saqlanadi**, faqat manbasi `serverNow()` bo'ladi.
- Smena yoshi (`openMinutes`, `stale`) — serverdan keladi, ekran qayta hisoblamaydi.

---

## 2. O'ZGARMAS QOIDALAR (har sessiya uchun)

1. **Bitta sessiya = bitta faza.** Faza tugagach agent keyingisini BOSHLAMAYDI — §6 ga hisobot yozadi va
   to'xtaydi. Istisnosi yo'q.
2. Ishni boshlashdan avval **shu faylni TO'LIQ o'qi** (§1, §2 va avvalgi fazalar hisobotlari). O'z fazangdan
   tashqariga chiqma; topilgan boshqa nuqson hisobotning «Ochiq qolganlar» bandiga yoziladi.
3. 🔴 **QIZIL CHIZIQ — server yozuvlariga tegilmaydi.** Bu reja **faqat ko'rsatish/qog'oz** qatlamini
   o'zgartiradi. Taqiqlanadi:
   - `retail-sale.service.ts` dagi `moment` mantig'ini o'zgartirish;
   - POS'dan serverga **`moment` yuborishni boshlash** (hozir yuborilmaydi — `sotuv/page.tsx` dagi proforma
     `moment`i **serverga bormaydi**, faqat qog'ozga chiqadi);
   - `openMinutes`/`stale` ni ekranda qayta hisoblash.

   Har faza hisobotida shu bandga **yozma isbot** beriladi (`git diff --stat` + «serverga yuborilgan yangi
   maydon yo'q»).
4. **Ko'chirish qoidasi:** POS doirasida `new Date()` / `Date.now()` **taqiqlanadi** — o'rniga `serverNow()`.
   Ikki istisno **ruxsat** (va guard-testda oq ro'yxatda bo'ladi):
   - **nisbiy o'lchov** — bitta qurilmaning ikki nuqtasi orasidagi farq (debounce/throttle):
     `sotuv-mode.tsx:109`, `desktop/main.js:372`;
   - **identifikator yasash** — `lib/pos/cart-drafts.ts:97` (`newDraftId`), `desktop/main.js:563` (tmp fayl nomi).
5. **Testlar majburiy:**
   - web: `cd apps/web && npx vitest run <tegilgan testlar>` va **yangi mantiqqa yangi test**;
   - gate: `pnpm --filter @moysklad/web typecheck` · `pnpm biome check` · `pnpm i18n:gate`
     (yangi matn qo'shilsa ru+uz ikkalasi);
   - qog'ozga chiqadigan faza (S2) uchun **sana-formatlash testi soxta soat bilan**
     (`vi.setSystemTime`) — qurilma soati siljitilganda natija o'zgarmasligi ko'rsatiladi.
6. **Hisobot majburiy** (§6, o'z fazang sarlavhasi ostiga): fayllar, commit, **yangi testlar SONI**,
   **test natijalari raqam bilan**, qabul mezoni bo'yicha har band ✔/✘, «bu o'zgarish qaysi mavjud oqimni
   buzishi mumkin?» savoliga yozma javob, ochiq qolganlar. Hisobotsiz faza TUGAMAGAN.
7. **Git.** Branch `yacheyka-inventarizatsiya`, push → `mirfayz`. 🔴 **Diqqat:** reja tuzilganda ish daraxtida
   **T3 (TSD qidiruv) ning commit qilinmagan ishi** turibdi (`apps/api/src/modules/tsd/*`,
   `auth/tsd-*`, `permissions/role-templates*`, `android/manager-app/`). Faza agenti avval `git status`
   ni tekshiradi va **o'z commitiga BEGONA fayllarni qo'shmaydi** — faqat o'zi tegkan fayllarni `git add`
   qiladi. Commit subject kichik harf (commitlint).
8. **Qabul mezoni — yopish sharti.** Bandlardan biri bajarilmasa faza «TUGADI» emas, **«QISMAN — <nima
   kutilmoqda>»** bo'ladi.
9. **Deploy — FAQAT egasi «chiqar» desa.** Kassa jonli ishlayotganda deploy uni to'xtatadi (H-reja saboqi).
   Faza kodni yozadi va testdan o'tkazadi; `deploy/deploy-smart.sh` avtomatik chaqirilmaydi.
10. **Tegilmaydigan fayllar/mantiqlar:** `api-client.ts` dagi **transport mantig'i** — `authedFetch` ning
    401-refresh shoxi, `credentials`, `Content-Type` shartlari (izohda yozilgan bug-klasslar). Skew o'qish
    faqat **`res` qaytishidan oldin bitta qator** bo'lib qo'shiladi, mavjud shoxlarga tegmasdan.
11. **Maxfiy ma'lumot bu faylga yozilmaydi** (repo public).
12. Ishlar faqat `D:\sherset-v2` da. Jonli bazaga skript yozilmaydi.
13. 🔴 **Kodlash (encoding):** manba fayllarni `Get-Content`/`Set-Content` bilan qayta yozish **TAQIQ** —
    faqat `Edit`/`Write`. (2026-09-01 jonli hodisasi: UTF-8 buzilib mojibake chiqdi, gate'lar tutmadi.)

---

## 3. Fazalar xaritasi

| Faza | Nima | Server ishi | Prioritet | Holat |
|---|---|---|---|---|
| **S1** | Poydevor: `serverNow()` + skew (`Date` sarlavhasi) + `POS_TZ`; iste'molchi — 2 ta soat | yo'q | 🔴 blok | **TUGADI** |
| **S2** | 🔴 Qog'oz: proforma sanasi + chek sanasi `Asia/Tashkent` da | yo'q | 🔴 eng muhim | REJA |
| **S3** | «O'tgan vaqt» hisoblari: navbat, qarz kunlari, qoralama vaqti | yo'q | 🟠 xato ko'rsatish | REJA |
| **S4** | TZ qotirish — qolgan barcha POS/print formatlari + guard test | yo'q | 🟡 to'liqlik | REJA |
| **S5** | Ogohlantirish chipi + qurilmada NTP (ops) + jonli smoke | yo'q | 🟡 immunitet | REJA |

**Tartib sababi:** S1 — poydevor, usiz qolganlari yo'q. S2 birinchi bo'lib bajariladi, chunki **qog'oz
mijozning qo'lida qoladi** (eng qimmat xato). S3 — kassirni chalg'itadigan raqamlar. S4 — qolgan
ko'rinishlar (xatosi kamroq, hajmi kattaroq). S5 — ildiz sabab (qurilma soati) va ko'rinuvchanlik.

**S1–S3 birgalikda egasining shikoyatini yopadi.** S4–S5 — mustahkamlash.

---

## 4. Yangi modul shartnomasi (S1 da yaratiladi, keyingi fazalar shunga tayanadi)

**`apps/web/src/lib/clock.ts`** — yagona vaqt manbasi:

```ts
/** Asia/Tashkent — POS/chek uchun QAT'IY mintaqa (HR sahifalari konvensiyasi). */
export const POS_TZ = 'Asia/Tashkent';

/** Server bilan qurilma orasidagi farq (ms). Faqat `Date` sarlavhasidan yangilanadi. */
export function clockSkewMs(): number;

/** Serverga tekislangan hozirgi vaqt. POS'da `new Date()` O'RNIGA shu ishlatiladi. */
export function serverNow(): Date;

/** `authedFetch` chaqiradi — javobdagi `Date` sarlavhasidan skew'ni yangilaydi. */
export function noteServerDate(res: Response): void;

/** React uchun: intervalda yangilanadigan serverga tekislangan soat. */
export function useServerClock(stepMs?: number): Date;
```

**Xulq talablari (S1 testlari shularni qulflaydi):**

1. `noteServerDate` faqat **haqiqiy** sarlavhada ishlaydi: `Date` yo'q/parse bo'lmasa — skew o'zgarmaydi.
2. **Keshlangan javob hisobga olinmaydi:** `Age` sarlavhasi bor bo'lsa skew yangilanmaydi (eski `Date`
   soatni orqaga tortib yuborardi).
3. **Jitter filtri:** yangi skew eskisidan **1500 ms** dan kam farq qilsa — yozilmaydi (soat sakramaydi).
4. **Oflayn davomiylik:** oxirgi skew `localStorage` da saqlanadi va yuklanishda tiklanadi; hech qachon
   ulanmagan qurilmada `skew = 0` (bugungi xulq — regressiya emas).
5. `serverNow()` server-render paytida ham xavfsiz (`typeof window === 'undefined'` → `new Date()`).

---

## 5. Fazalar tafsiloti

### S1 — Poydevor: `serverNow()` + `POS_TZ`

**Fayllar:** yangi `apps/web/src/lib/clock.ts`; `apps/web/src/lib/api-client.ts` (`authedFetch` ichida bitta
qator — `noteServerDate(res)`); `components/pos/pos-header.tsx:44-48`;
`app/customer-display/page.tsx:603-604` (+`:670` formatga `timeZone: POS_TZ`).

**Testlar:** yangi `apps/web/src/lib/clock.test.ts` — §4 dagi 5 xulq talabining har biri;
`components/pos/__tests__/pos-header.test.tsx` ga **skew stsenariysi** (qurilma soati +3 soat siljitilgan,
header baribir server soatini ko'rsatadi).

**Qabul mezoni:**
- ✔ Qurilma soati 3 soatga siljitilganda header va CFD soati **to'g'ri** ko'rsatadi (test bilan).
- ✔ `authedFetch` ning 401-refresh shoxi va boshqa transport xulqi o'zgarmagan (mavjud
  `api-client.test.ts` yashil).
- ✔ Tarmoq yo'qligida sahifa yiqilmaydi, oxirgi ma'lum skew ishlaydi.

**«Qaysi oqimni buzishi mumkin?»** — har HTTP javobga bitta yengil funksiya qo'shiladi; xato otilmasligi
uchun `try/catch` ichida. Hisobotda shu isbotlanadi.

---

### S2 — 🔴 Qog'oz: chek va proforma sanasi

**Fayllar:** `app/(app)/sotuv/page.tsx:966` (`new Date()` → `serverNow()`; `:982` `moment` va `:977` zaxira
`CHEK-HHMMSS` shundan); `lib/pos/receipt-model.ts:225-227` (`fmtReceiptDate` ga `timeZone: POS_TZ`).

**Testlar:** `lib/pos/receipt-model.test.ts` ga — `vi.setSystemTime` bilan qurilma soatini **boshqa kunga**
siljitib, `dateLabel` server `moment`iga mos qolishini qulflash; `receipt-proforma-model.test.ts` ga
skew'li stsenariy.

**Qabul mezoni:**
- ✔ Qurilma sanasi noto'g'ri bo'lganda **qog'ozdagi sana to'g'ri** (test bilan).
- ✔ Chek raqami mantig'i (`document_sequences`, 2026-09-02) o'zgarmagan; zaxira shox saqlangan.
- ✔ Serverga yangi maydon yuborilmagan (§2 qoida 3 isboti).

---

### S3 — «O'tgan vaqt» hisoblari

**Fayllar:** `sotuv/_components/navbat-mode.tsx:43-45` (`useNowTick` → `useServerClock`);
`components/pos/debt-payment-dialog.tsx:154`; `sotuv/page.tsx:904,928,1007` (qoralama `createdAt`) va
`:1028` (`timeLabel` ga `timeZone: POS_TZ`).

**Testlar:** navbat kartasining «o'tgan vaqt»i skew ostida to'g'ri chiqishi; qarz kechikish kunlari uchun
chegara testi (kun chegarasida ±1 kun xato bermasin — hisob **`Asia/Tashkent` kalendar kuni** bo'yicha).

**Qabul mezoni:**
- ✔ Skew +3 soat bo'lganda navbat «o'tgan vaqt»i o'zgarmaydi.
- ✔ Qoralama vaqti server soatida yoziladi va ko'rsatiladi.
- ✔ `newDraftId()` (`cart-drafts.ts:97`) TEGILMAGAN — u identifikator, vaqt emas (§2 qoida 4).

---

### S4 — TZ qotirish + guard test

**Fayllar:** §1.3 dagi ro'yxatning S2/S3 da yopilmagan qolgani — `cheklar-mode.tsx:407,1074` ·
`smena-mode.tsx:231` · `vozvrat-mode.tsx:347` · `zakazlar-mode.tsx:284` · `customers-panel.tsx:464,787,792` ·
`customer-card-panel.tsx:195` · `debt-payment-dialog.tsx:144` · `customer-display/page.tsx:886` ·
`app/print/cash-in/[docId]/page.tsx:25` · `app/print/cash-out/[docId]/page.tsx:28`.

**Yangi guard:** `apps/web/src/__tests__/pos-clock-discipline.test.ts` — manba-skaner
(`kassa-default-printer.test.ts` uslubi: izohlar `stripComments` bilan olib tashlanadi + **anti-vacuity**
tekshiruvi):

1. POS yo'llarida (`app/(app)/sotuv/**`, `components/pos/**`, `lib/pos/**`, `app/customer-display/**`)
   `new Date()` / `Date.now()` **yo'q** — §2 qoida 4 dagi oq ro'yxatdan tashqari.
2. O'sha yo'llarda `toLocaleTimeString`/`toLocaleDateString`/`toLocaleString` **sana ustida** `timeZone`siz
   chaqirilmaydi.
   🔴 **Yolg'on-pozitiv xavfi:** `toLocaleString` RAQAM formatlash uchun ham ishlatiladi —
   `sotuv-mode.tsx:217`, `pos-rate-chip.tsx:43`, `receipt-model.ts:216`, `payment-dialog.tsx:32`.
   Skaner faqat `new Date(...).toLocale…` shaklini tutadi, raqamlarga tegmaydi; oq ro'yxat izohlanadi.
3. POS'dan serverga `moment` yuborilmasligi (§2 qoida 3 ni testga aylantiradi).

**Qabul mezoni:** ✔ guard yashil va **vacuity emas** (ataylab buzilgan namunada qizarishi hisobotda
ko'rsatiladi) · ✔ mavjud POS testlari regress yo'q.

---

### S5 — Ogohlantirish chipi + qurilma NTP (ops) + jonli smoke

1. **Ko'rinuvchanlik:** `|skew| > 2 daqiqa` bo'lsa header'da sariq chip — «Qurilma vaqti ~N daqiqa xato»
   (i18n ru+uz). Buzuq kassa **ko'rinib turadi**, yashirin qolmaydi.
2. **Ildiz sabab:** kassa mashinalarida Windows vaqt xizmati sozlanadi —
   `w32tm /config /manualpeerlist:"pool.ntp.org time.windows.com" /syncfromflags:manual /update` +
   `sc config w32time start=auto`. Qayerga qo'yish qaroriga faza kelganda `desktop/` o'rnatuvchisi
   (`omborchi.builder.json` / NSIS) tekshiriladi; **admin huquqi talab qiladi**, shuning uchun bu band
   koddan ko'ra **ops yo'riqnomasi** bo'lishi ham mumkin — faza shuni hujjatlaydi.
3. **Jonli smoke (kod yozilmaydi):** bitta kassada soat +3 soatga siljitiladi va tekshiriladi:
   header soati ✔ · CFD soati ✔ · chek sanasi ✔ · navbat «o'tgan vaqt» ✔ · sariq chip chiqadi ✔ ·
   sotuv bazaga to'g'ri vaqtda tushadi ✔. Natija `docs/ops/` ga yoziladi.

---

## 6. Hisobotlar

### S0 — Reja tuzildi · 2026-09-04

Kod o'qib o'lchandi (kod yozilmadi): qurilma soatiga bog'liq **6 ta joy** (§1.2) va qurilma mintaqasiga
bog'liq **14 ta formatlash nuqtasi** (§1.3) topildi. Muhim natija — **bazadagi vaqt buzilmagan**
(`retail-sale.service.ts:676` serverda `moment` qo'yadi, POS uni yubormaydi), demak hisobotlar/smena
xavf ostida emas va tuzatish faqat ko'rsatish qatlamida.

Vaqt manbasi sifatida **HTTP `Date` sarlavhasi** tanlandi (§1.4): 0 qo'shimcha so'rov, jonlida sarlavha
API mashinasidan keladi (nginx `/api/` → `127.0.0.1:4001`). Tanlov loyihaning mavjud tamoyiliga mos —
`openMinutes` kabi, vaqt ham **serverda hisoblanadi, ekranda emas**.

**Ochiq qolganlar / keyingi fazaga eslatmalar:**
- Ish daraxtida T3 (TSD qidiruv) ning commit qilinmagan ishi bor — §2 qoida 7 ga qat'iy amal qilinsin.
- S5 ning NTP bandi admin huquqi talab qiladi; kod bilan yechiladimi yoki ops yo'riqnomasi bo'ladimi —
  o'sha fazada qaror qilinadi.

---

### S1 — Poydevor: `serverNow()` + `POS_TZ` · **TUGADI** · 2026-09-04

**Nima qilindi**

| Fayl | O'zgarish |
|---|---|
| `apps/web/src/lib/clock.ts` | **YANGI** — `POS_TZ`, `clockSkewMs()`, `serverNow()`, `noteServerDate()`. §4 shartnomasi to'liq bajarildi. |
| `apps/web/src/hooks/use-server-clock.ts` | **YANGI** — `useServerClock(stepMs)`, `Date \| null`. |
| `apps/web/src/lib/api-client.ts` | `authedFetch` ichida **bitta chaqiruv** — `noteServerDate(res)`. Transport mantig'iga (401-refresh, `credentials`, `Content-Type`) tegilmadi. |
| `apps/web/src/components/pos/pos-header.tsx` | Soat `serverNow()` + `POS_TZ` da; `clockText` (qurilma `getHours()`) olib tashlandi. |
| `apps/web/src/app/customer-display/page.tsx` | CFD soati `useServerClock(10_000)`; formatga `timeZone: POS_TZ`. |
| `apps/web/src/lib/clock.test.ts` | **YANGI** — 15 test. |
| `apps/web/src/components/pos/__tests__/pos-header.test.tsx` | +2 test (skew va mintaqa). |

**§4 shartnomasidan chetlanish (hujjatlanadi):** `useServerClock` `lib/clock.ts` ga EMAS,
`src/hooks/` ga qo'yildi — repo konvensiyasi hook'larni o'sha yerda saqlaydi (45 fayl) va `lib/clock.ts`
shu tariqa React'siz, ya'ni server-komponentdan ham xavfsiz import qilinadigan bo'lib qoldi.

**Yangi testlar soni:** **17** (15 + 2).

**Test natijalari (raqam bilan)**

- `src/lib/clock.test.ts` — **15/15** ✔
- `src/components/pos/__tests__/pos-header.test.tsx` — **12/12** ✔ (ilgari 10 edi)
- Tegilgan doiralar (`api-client`, `customer-display`, butun `components/pos`) — **26 fayl / 301 test** ✔
- **Butun web unit-suite** (`api-client` hamma joyda ishlatilgani uchun to'liq yugurtirildi) —
  **348/348 fayl · 4543 o'tdi · 26 o'tkazib yuborildi · 0 yiqildi** ✔
- `pnpm --filter @moysklad/web typecheck` — **0 xato** ✔
- `npx biome check` (o'zgargan 7 fayl) — **0 xato**. Qolgan 1 ta ogohlantirish
  (`customer-display/page.tsx:1262 useExhaustiveDependencies`) **MENDAN OLDIN bor edi** —
  `git stash` bilan HEAD nusxasida ham chiqishi o'lchandi.
- `pnpm i18n:gate` — **20/20** ✔ (yangi matn qo'shilmadi)

**🔴 Mavjud qo'riqcha meni tutdi (va to'g'ri tutdi):** soatni avval `Intl.DateTimeFormat('en-GB', …)`
bilan yozgan edim — `src/__tests__/pos-bcp47-guard.test.ts` uni «kassa doirasida qattiq BCP-47 teg»
deb rad etdi. Teg `useBcp47()` ga o'tkazildi. Bu **ko'rinishni o'zgartirmaydi**: o'sha qo'riqchining
o'z hujjati (`i18n-format.ts`, Node va Chromium'da o'lchangan jadval) soat/daqiqa formatini ikki
lokalda **aynan bir xil** deb qayd etadi. `hour12: false` ham ataylab BERILMADI — ba'zi ICU nusxalarida
u h24 ga tushib yarim tunni «24:00» qilib yozadi.

**Qabul mezoni**

- ✔ Qurilma soati 3 soatga siljitilganda header va CFD soati to'g'ri ko'rsatadi — test bilan
  (`18:00` kutiladi, qurilma vaqtida `15:00` chiqardi).
- ✔ Qurilmaning MINTAQASI ham so'ralmaydi — alohida test (`23:30 UTC` → `04:30` Toshkent).
- ✔ `authedFetch` ning 401-refresh shoxi va transport xulqi o'zgarmagan (`api-client.test.ts` yashil,
  diff 6 qator: 1 import + 1 chaqiruv + 3 qator izoh).
- ✔ Tarmoq yo'qligida sahifa yiqilmaydi — `noteServerDate` butunlay `try/catch` ichida va
  «sarlavhalar o'qilmasa ham OTMAYDI» testi shuni qulflaydi; oxirgi skew `localStorage` dan tiklanadi
  («qurilma qayta yuklandi, tarmoq yo'q» testi).

**«Bu o'zgarish qaysi mavjud oqimni buzishi mumkin?»**

1. **Har HTTP javob** endi bitta qo'shimcha funksiyadan o'tadi. U to'liq `try/catch` ichida, tashqi
   chaqiruv qilmaydi va faqat ikki sarlavhani o'qiydi — savdo so'rovini yiqita olmaydi. Buni test
   ham (buzuq `headers` bilan) qulflaydi.
2. **Serverga yuborilgan yangi maydon YO'Q** (§2 qoida 3). `git diff` da yagona serverga tegishli
   fayl — `api-client.ts`, unda ham faqat javobni O'QISH qo'shildi. Sotuv `moment`i hamon serverniki.
3. **Soatning birinchi paydo bo'lishi** endi mount'dan keyin (ilgari header darhol chizardi). Bu
   ataylab: CFD allaqachon shu himoyada edi (gidratatsiya nomuvofiqligi). Ko'zga ko'rinmaydi —
   effekt birinchi bo'yashdan keyin darhol ishlaydi.
4. **Skew kechikishi:** birinchi javob kelgunicha skew `0` bo'lishi mumkin, ya'ni eng ko'p bitta
   interval (POS 30 s, CFD 10 s) davomida qurilma vaqti ko'rinadi. Amalda POS header'i sessiya
   yuklangandan KEYIN chiziladi (ya'ni skew allaqachon bor), qayta yuklashda esa `localStorage`
   dan tiklanadi. Bu kechikish faqat mashinaning eng birinchi ishga tushishida bo'ladi.
5. **Til almashish** soatga ta'sir qilmaydi (yuqoridagi o'lchov).

**Ochiq qolganlar**

- Chek/qog'oz hamon qurilma sanasida — **S2** yopadi (eng muhim).
- Navbat «o'tgan vaqt», qarz kunlari, qoralama vaqti — **S3**.
- §1.3 dagi qolgan 12 formatlash nuqtasi mintaqasiz — **S4** (guard test ham o'sha yerda).
- CFD navbat kartasidagi vaqt (`customer-display/page.tsx:886`) ATAYLAB tegilmadi — u S4 doirasi va
  unga bog'langan mavjud test (`customer-display.test.tsx:82`, `05:01`) mashina mintaqasida yozilgan;
  S4 uni test bilan birga ko'chirsin.
