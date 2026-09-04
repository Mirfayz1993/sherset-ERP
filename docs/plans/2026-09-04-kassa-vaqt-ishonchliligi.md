# Kassa vaqt ishonchliligi — qurilma soatidan qutulish (S-reja)

> **Yaratilgan:** 2026-09-04 · **Buyurtmachi:** Ozodbek (egasi) · **Holat:** BAJARILMOQDA — S1, S2, S3 TUGADI (2026-09-04)
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
| **S2** | 🔴 Qog'oz: proforma sanasi + chek sanasi `Asia/Tashkent` da | yo'q | 🔴 eng muhim | **TUGADI** |
| **S3** | «O'tgan vaqt» hisoblari: navbat, qarz kunlari, qoralama vaqti | yo'q | 🟠 xato ko'rsatish | **TUGADI** |
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

**Qamrov eslatmasi:** `fmtReceiptDate` ni tuzatish **qarz chekini ham** yopadi —
`lib/pos/receipt-debt-model.ts:71` (`moment: r.paidAt`) o'sha `buildReceiptModel` orqali o'tadi.

<details><summary><b>S2 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md` ni TO'LIQ o'qi — §1 (ayniqsa §1.1 va §1.5),
   §2 (o'zgarmas qoidalar), §4 (modul shartnomasi) va §5 dagi S2 bo'limi, hamda §6 dagi
   S0 va S1 hisobotlari.
2) Sen FAQAT **S2 — Qog'oz: chek va proforma sanasi** fazasini bajarasan. Faqat web (`apps/web`);
   serverga (`apps/api`) TEGILMAYDI.
3) 🔴 QIZIL CHIZIQ: POS serverga `moment` YUBORMAYDI va yubora boshlamaydi. Proforma chekining
   `moment`i faqat QOG'OZGA boradi, hech qanday so'rovga kirmaydi. `retail-sale.service.ts` ga
   tegilmaydi. Hisobotda buni `git diff --stat` bilan yozma isbotla.
4) 🔴 IKKINCHI VAQT MANBASI YARATMA. S1 da `apps/web/src/lib/clock.ts` bor: `serverNow()` va
   `POS_TZ`. Yangi skew mantig'i, yangi NTP, yangi `Date` o'qish — TAQIQ.
5) Ish:
   a) `app/(app)/sotuv/page.tsx:966` — `const now = new Date()` → `serverNow()`. `:982` dagi
      chek `moment`i va `:977` dagi zaxira `CHEK-HHMMSS` raqami SHUNDAN kelsin.
   b) `lib/pos/receipt-model.ts:225-227` — `fmtReceiptDate` ga `timeZone: POS_TZ` qo'shiladi.
      🔴 LOKALNI O'ZGARTIRMA: `'ru-RU'` qog'oz-format qarori (moysklad pariteti), faqat
      `timeZone` qo'shiladi. `lib/pos` `pos-bcp47-guard` skaneriga kirmaydi — bu bo'shliq
      emas, S4 doirasi.
   c) Chek raqami mantig'i (`document_sequences`, 2026-09-02) va tarmoq yiqilgandagi zaxira
      shox O'ZGARMAYDI — faqat vaqt manbasi almashadi.
6) Testlar (majburiy, yangi mantiqqa YANGI test):
   - `lib/pos/receipt-model.test.ts` — `vi.setSystemTime` bilan qurilma soatini BOSHQA KUNGA
     siljitib, `dateLabel` server `moment`iga mos qolishini qulfla;
   - `lib/pos/receipt-proforma-model.test.ts` — skew'li stsenariy (qurilma sanasi xato,
     chekdagi sana to'g'ri);
   - yugurt: `cd apps/web && npx vitest run src/lib/pos src/app/\(app\)/sotuv`
     (to'liq suite SHART EMAS — S2 umumiy transportga tegmaydi);
   - gate: `pnpm --filter @moysklad/web typecheck` · `npx biome check <o'zgargan fayllar>` ·
     `pnpm i18n:gate`.
7) Git: `git add` FAQAT o'zing tegan yo'llar bilan. Ish daraxtida T3 (TSD qidiruv) ning
   commit qilinmagan ishi turibdi — unga TEGMA va commitingga qo'shma. Commit subject kichik harf.
8) 🔴 Manba fayllarni `Get-Content`/`Set-Content` bilan qayta yozma — faqat Edit/Write
   (2026-09-01 kodlash hodisasi).
9) Deploy QILMA (§2 qoida 9) — kassa jonli ishlayapti, deploy uni to'xtatadi.
10) Tugagach §6 ga «### S2 — …» hisobotini yoz: fayllar, yangi testlar SONI, test natijalari
    raqam bilan, qabul mezonining har bandi ✔/✘, «bu o'zgarish qaysi mavjud oqimni buzishi
    mumkin?» javobi, ochiq qolganlar.
11) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### S3 — «O'tgan vaqt» hisoblari

**Fayllar** (qatorlar S2 dan KEYIN qayta o'lchandi, HEAD `57217f3e`):
`sotuv/_components/navbat-mode.tsx:42-50` (`useNowTick` → `useServerClock`) va `:51-62`
(`formatElapsed`); `components/pos/debt-payment-dialog.tsx:153-157` (`daysSince`);
`sotuv/page.tsx:906,930,1014` (qoralama `createdAt`) va `:1035` (`timeLabel` ga `timeZone: POS_TZ`).

**Testlar:** navbat kartasining «o'tgan vaqt»i skew ostida to'g'ri chiqishi; qarz kechikish kunlari uchun
chegara testi (kun chegarasida ±1 kun xato bermasin — hisob **`Asia/Tashkent` kalendar kuni** bo'yicha).

**Qabul mezoni:**
- ✔ Skew +3 soat bo'lganda navbat «o'tgan vaqt»i o'zgarmaydi.
- ✔ Qoralama vaqti server soatida yoziladi va ko'rsatiladi.
- ✔ `newDraftId()` (`cart-drafts.ts:97`) TEGILMAGAN — u identifikator, vaqt emas (§2 qoida 4).

<details><summary><b>S3 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md` ni TO'LIQ o'qi — §1 (ayniqsa §1.1, §1.2
   va §1.5), §2 (o'zgarmas qoidalar), §4 (modul shartnomasi) va §5 dagi S3 bo'limi, hamda §6
   dagi S0, S1 va S2 hisobotlari.
2) Sen FAQAT **S3 — «O'tgan vaqt» hisoblari** fazasini bajarasan. Faqat web (`apps/web`);
   serverga (`apps/api`) TEGILMAYDI. Hisobotda buni `git diff --stat` bilan yozma isbotla.
3) 🔴 IKKINCHI VAQT MANBASI YARATMA. S1 da tayyor: `apps/web/src/lib/clock.ts`
   (`serverNow()`, `POS_TZ`) va `apps/web/src/hooks/use-server-clock.ts`
   (`useServerClock(stepMs): Date | null`). Yangi skew mantig'i, yangi interval-soat
   hook'i, yangi `Date.now()` o'quvchi — TAQIQ. Yangi so'rov/ping ham QO'SHILMAYDI.
4) Ish (uch nuqta):
   a) `sotuv/_components/navbat-mode.tsx` — `useNowTick()` (`Date.now()` + 30s interval)
      OLIB TASHLANADI, o'rniga `useServerClock(30_000)`.
      🔴 `useServerClock` mount'gacha `null` qaytaradi (gidratatsiya qarori, S1 hisoboti).
      Karta «o'tgan vaqt»i shu bir renderda NIMA ko'rsatishini ATAYLAB hal qil va izohla:
      soxta «hozir» chiqarma — bu kassirga yolg'on ma'lumot. Qarorni testga qulfla.
      `formatElapsed` sof funksiya bo'lib qolsin (`now` PARAMETR bo'lib kiradi).
   b) `components/pos/debt-payment-dialog.tsx` — `daysSince` (`:153-157`) hozir
      `Date.now() − iso` ni 86 400 000 ga bo'ladi. Ikki nuqson: (1) qurilma soati,
      (2) bu KALENDAR kun emas, 24 soatlik bo'lak — kechqurun to'langan qarz ertalab
      «0 kun» bo'lib turadi. Hisob **`Asia/Tashkent` kalendar kunlari FARQI** bo'lsin.
      Buni `lib/pos/` da SOF funksiyaga chiqar (ikkala sana ham parametr — modul ichida
      `serverNow()` CHAQIRILMAYDI) va alohida sina; chaqiruvchi `serverNow()` beradi.
      `fmtDate` (`:144`) mintaqasi ATAYLAB tegilmaydi — u §1.3 ro'yxatida, S4 doirasi.
   c) `sotuv/page.tsx` — qoralama `createdAt` (`:906,930,1014`) `Date.now()` →
      `serverNow().getTime()`; chip `timeLabel` (`:1035`) formatiga `timeZone: POS_TZ`.
      🔴 `newDraftId()` (`lib/pos/cart-drafts.ts:97`) TEGILMAYDI — u identifikator,
      vaqt emas (§2 qoida 4 dagi oq ro'yxat).
      🔴 `localStorage` da TURIB QOLGAN eski qoralamalar qurilma vaqtida yozilgan:
      `createdAt` tipi (`number`) va `parseCartDrafts` shartnomasi O'ZGARMASIN, aks holda
      kassirning saqlangan savati YO'QOLADI. Eski yozuvlar vaqti bir marta siljib
      ko'rinishi — qabul qilinadigan narx; buni hisobotda ochiq yoz.
5) Testlar (majburiy, yangi mantiqqa YANGI test; mavjud fayllarga qo'sh):
   - `app/(app)/sotuv/__tests__/navbat-mode.test.tsx` — skew +3 soat: qurilma soati
     adashgan bo'lsa ham «o'tgan vaqt» server `moment`iga nisbatan to'g'ri
     (skew'siz holatda 3 soat xato chiqishini ham ko'rsat);
   - qarz kunlari uchun SOF funksiya testi — kun chegarasi: 23:50 (Toshkent) da yozilgan
     qarz ertasi kuni 00:10 da «1 kun», «0 kun» EMAS; teskarisi ham (bir necha soatlik
     farq bir xil kalendar kunda «0 kun»);
   - qoralama chipi vaqti: skew ostida server soatida yoziladi va `Asia/Tashkent` da
     chiziladi (mintaqa testini `vi.stubEnv('TZ', …)` bilan HAQIQATAN qizaradigan qil —
     sinov mashinasining TZ'i `Asia/Tashkent`, S2 hisobotidagi naqsh);
   - yugurt: `cd apps/web && npx vitest run "src/app/(app)/sotuv" src/components/pos src/lib/pos`
     (to'liq suite SHART EMAS — S3 umumiy transportga tegmaydi);
   - gate: `pnpm --filter @moysklad/web typecheck` · `npx biome check <o'zgargan fayllar>` ·
     `pnpm i18n:gate` (yangi matn qo'shilsa ru+uz ikkalasi).
6) ANTI-VAKUUM: har yangi testni tuzatishni vaqtincha orqaga qaytarib qizarishini o'lchа
   va natijani hisobotda ko'rsat (S2 naqshi) — yashil test o'z-o'zidan dalil emas.
7) Git: `git add` FAQAT o'zing tegan yo'llar bilan. Ish daraxtida T3 (TSD) ning commit
   qilinmagan ishi turibdi (`apps/api/**`, `android/manager-app/`) — unga TEGMA va
   commitingga qo'shma. Commit subject kichik harf.
8) 🔴 Manba fayllarni `Get-Content`/`Set-Content` bilan qayta yozma — faqat Edit/Write
   (2026-09-01 kodlash hodisasi).
9) Deploy QILMA (§2 qoida 9) — kassa jonli ishlayapti, deploy uni to'xtatadi.
10) Tugagach §6 ga «### S3 — …» hisobotini yoz: fayllar, commit, yangi testlar SONI,
    test natijalari raqam bilan, anti-vakuum o'lchovi, qabul mezonining har bandi ✔/✘,
    «bu o'zgarish qaysi mavjud oqimni buzishi mumkin?» javobi, ochiq qolganlar.
11) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

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

---

### S2 — 🔴 Qog'oz: chek va proforma sanasi · **TUGADI** · 2026-09-04

**Commit:** `988fb45c` — `feat(kassa): chek va proforma sanasi server vaqtida (S2)`
(T3 (TSD) ning commit qilinmagan ishi tegilmadi va commitga kirmadi; commitda `apps/api` yo'q).

**Nima qilindi** (faqat `apps/web` — 4 fayl, `apps/api` ga TEGILMADI)

| Fayl | O'zgarish |
|---|---|
| `apps/web/src/app/(app)/sotuv/page.tsx` | `printProforma` da `const now = new Date()` → **`serverNow()`** (+ `@/lib/clock` importi). Chek `moment`i (`:989`) va tarmoq yiqilgandagi zaxira `CHEK-HHMMSS` raqami (`:985`) shu bitta manbadan oladi. |
| `apps/web/src/lib/pos/receipt-model.ts` | `fmtReceiptDate` ga **`timeZone: POS_TZ`**. `'ru-RU'` lokali TEGILMADI (qog'oz-format qarori, moysklad pariteti). |
| `apps/web/src/lib/pos/receipt-model.test.ts` | +3 test (yangi `describe`: qurilma soati / yarim tun chegarasi / qurilma mintaqasi). |
| `apps/web/src/lib/pos/receipt-proforma-model.test.ts` | +2 test (skew'li uchdan-uchi stsenariy). |

**Nima ATAYLAB o'zgarmadi:** chek raqami mantig'i (`POST /retail-sales/receipt-number` →
`document_sequences`, 2026-09-02) va tarmoq yiqilgandagi zaxira shox — diffda ular bitta qator ham
o'zgarmagan, faqat vaqt MANBASI almashdi. Yangi skew/NTP/`Date` o'qish mantig'i yaratilmadi —
S1 ning `lib/clock.ts` idan iste'mol qilinadi.

**Qamrov:** `fmtReceiptDate` — chekning YAGONA sana nuqtasi, shuning uchun bitta tuzatish oltita
chaqiruvchini yopdi: savdo cheki, sotuvsiz (proforma) chek, **qarz cheki**
(`receipt-debt-model.ts:71` → `buildReceiptModel`), `/print/retail-sale/[id]`,
`/print/debt-payment/[batchId]`, `components/print/tovar-chek.tsx` va `/p/[token]` ommaviy cheki.

**Yangi testlar soni:** **5** (3 + 2).

**Test natijalari (raqam bilan)**

- `src/lib/pos/receipt-model.test.ts` — **49/49** ✔ (ilgari 46 edi)
- `src/lib/pos/receipt-proforma-model.test.ts` — **7/7** ✔ (ilgari 5 edi)
- `npx vitest run src/lib/pos "src/app/(app)/sotuv"` — **35 fayl · 486/486** ✔
- `fmtReceiptDate` ning QOLGAN chaqiruvchilari (`src/__tests__`, `src/lib/__tests__`,
  `src/components/print`, `src/app/print`, `src/app/p`) — **111 fayl · 1703 o'tdi · 25 o'tkazib
  yuborildi · 0 yiqildi** ✔ (`pos-bcp47-guard` shu to'plamda — yashil)
- `pnpm --filter @moysklad/web typecheck` — **0 xato** ✔
- `npx biome check` (o'zgargan 4 fayl) — **0 xato**, 9 ogohlantirish. To'qqiztasi ham
  **MENDAN OLDIN bor edi**: `page.tsx` ning `useSortedClasses` (8 ta) va `noNonNullAssertion` (1 ta)
  qatorlari — `git show HEAD:…` bilan aynan o'sha qatorlar HEAD'da ham tekshirildi
  (177/181/186/204/212/268/542/1764). Men tekkan qatorlarda ogohlantirish yo'q.
- `pnpm i18n:gate` — **20/20** ✔ (yangi matn qo'shilmadi)

**Anti-vakuum (test haqiqatan tutadimi?):** `timeZone: POS_TZ` vaqtincha olib tashlanib yugurtirildi —
mintaqa testi darhol qizardi: `expected '22.07.2026' to be '23.07.2026'`. Ya'ni test mavjud
xatoni **haqiqatan** tutadi, keyin qator qaytarildi. (Test mashinaning o'z TZ'i `Asia/Tashkent`
bo'lgani uchun mintaqa `vi.stubEnv('TZ', 'Pacific/Honolulu')` bilan siljitiladi — aks holda test
shu mashinada hech qachon qizarmasdi va yolg'on-yashil bo'lardi.)

**🔴 §2 qoida 3 — YOZMA ISBOT: serverga yangi maydon YUBORILMADI**

`git diff --stat` (S2 ning o'z fayllari; qolgan `apps/api/*` qatorlari — T3 (TSD) ning MENDAN
OLDIN turgan commit qilinmagan ishi, ularga TEGILMADI va commitga QO'SHILMADI):

```
 apps/web/src/app/(app)/sotuv/page.tsx              |  9 +-
 apps/web/src/lib/pos/receipt-model.ts              | 17 ++-
 apps/web/src/lib/pos/receipt-model.test.ts         | 45 ++++++-
 apps/web/src/lib/pos/receipt-proforma-model.test.ts| 69 ++++++++++-
```

1. Diffda **`apps/api` yo'q** — `retail-sale.service.ts` ga tegilmadi.
2. `printProforma` dagi YAGONA tarmoq chaqiruvi —
   `api.post('/retail-sales/receipt-number', { sessionId })`; uning tanasi o'zgarmadi va unda
   `moment` YO'Q.
3. `now` ikki joyga boradi va **ikkalasi ham qog'oz**: zaxira raqam satri va
   `cartToProformaReceipt(…).moment` → `printProformaReceiptViaAgent` → Electron `printSheet` /
   lokal chop-agent / `window.open`. ERP API'ga chiqmaydi.
4. Butun POS bo'ylab o'lchandi (`grep -rn moment app/(app)/sotuv components/pos`): yozish yo'nalishida
   `moment` faqat `page.tsx:989` (yuqoridagi qog'oz yo'li). Qolgan hamma uchrashi — O'QISH:
   `sortBy=moment` GET parametri va javobni ko'rsatish.

**Qabul mezoni**

- ✔ **Qurilma sanasi noto'g'ri bo'lganda qog'ozdagi sana to'g'ri.** Test bilan: qurilma «2019-yil
  1-yanvar» deb tursa ham chek sanasi server `moment`ida (`22.07.2026`); skew testida qurilma ikki
  kun orqada — chekda `16.08.2026`, `14.08.2026` EMAS; 20 daqiqalik skew ham yarim tun chegarasida
  kunni to'g'rilaydi (`15.08` → `16.08`).
- ✔ **Chek raqami mantig'i o'zgarmagan; zaxira shox saqlangan.** `document_sequences` chaqiruvi va
  `CHEK-HHMMSS` shoxi diffda o'zgarmagan (yuqoridagi diff — faqat `new Date()` → `serverNow()`).
- ✔ **Serverga yangi maydon yuborilmagan** — yuqoridagi 4 bandli isbot.

**«Bu o'zgarish qaysi mavjud oqimni buzishi mumkin?»**

1. **`fmtReceiptDate` — eng keng ta'sir nuqtasi.** U endi DOIM `Asia/Tashkent` kalendar kunini
   chizadi. Toshkent mintaqasidagi mashinada ko'rinish **aynan o'zgarmaydi** (barcha kassalar
   O'zbekistonda), mintaqasi adashgan mashinada esa **tuzaladi**. Yagona ko'rinish o'zgaradigan
   holat — `/p/[token]` ommaviy chekini mijoz **chet elda** ochsa: endi u ham do'kon kunini ko'radi.
   Bu to'g'ri xulq: chek sanasi — savdo bo'lgan kun, o'quvchining mintaqasi emas.
2. **`receipt-model.ts` endi `@/lib/clock` ni import qiladi.** Modul React'siz, `window` ga faqat
   guard ostida tegadi, ya'ni `/print/*` server-komponentlarida ham xavfsiz. Buni typecheck va
   `fmtReceiptDate` ning barcha chaqiruvchilari bo'yicha 111 fayl / 1703 test tasdiqladi.
3. **Zaxira `CHEK-HHMMSS` raqami** endi server soatidan yasaladi. Takrorlanmaslik kafolati
   o'zgarmadi (bir kun ichida sekund aniqligi), lekin soat raqami hamon qurilma MINTAQASIDA
   (`now.getHours()`) — bu **identifikator, sana emas** (§2 qoida 4 dagi ajratma), TZ qotirish S4
   doirasi. Ochiq qolganlarga yozildi.
4. **Skew kechikishi.** Birinchi HTTP javob kelgunicha skew `0`, ya'ni nazariy jihatdan qurilma
   vaqti. Amalda proforma bosilguncha smena/tovar/cheklar so'rovlari allaqachon o'nlab javob
   qaytargan bo'ladi, qayta yuklashda esa skew `localStorage` dan tiklanadi (S1).
5. **`useCallback` bog'liqliklari o'zgarmadi** — `serverNow` modul funksiyasi, dep emas; biome
   `useExhaustiveDependencies` ogohlantirish bermadi.

**Ochiq qolganlar**

- Zaxira `CHEK-HHMMSS` dagi `getHours/getMinutes/getSeconds` hamon qurilma mintaqasida — **S4**.
- Qoralama chipi vaqti (`page.tsx` `draftChips.timeLabel`) hamon `Date.now()` + mintaqasiz — **S3**
  (rejada shunday belgilangan). ✅ S3 da yopildi.
- §1.3 dagi qolgan formatlash nuqtalari (`cheklar-mode`, `smena-mode`, `vozvrat-mode`,
  `zakazlar-mode`, `customers-panel`, `customer-card-panel`, `debt-payment-dialog`,
  `customer-display:886`, `print/cash-in`, `print/cash-out`) — **S4**.
- `pos-bcp47-guard` skaneri `lib/pos` ni QAMRAMAYDI (S2 prompti buni bo'shliq emas deb belgilagan);
  S4 ning yangi `pos-clock-discipline` guard'i doirani kengaytirishda buni ham hisobga olsin.
- **Deploy QILINMADI** (§2 qoida 9) — kassa jonli ishlayapti. Kod branchda, egasi «chiqar» desa
  chiqariladi.

---

### S3 — «O'tgan vaqt» hisoblari · **TUGADI** · 2026-09-04

> **Ijro eslatmasi:** §2 qoida 1 «bitta sessiya = bitta faza» edi; S3 egasining shu sessiyadagi
> «davom et» ko'rsatmasi bilan S2 dan keyin AYNI sessiyada bajarildi. Qoidaning o'zi
> o'zgarmadi — S4/S5 yana alohida sessiyada.

**Commit:** `c1ed09b4` — `feat(kassa): «o'tgan vaqt» hisoblari server soatida (S3)`
(T3 (TSD) ning commit qilinmagan ishi tegilmadi; commitda `apps/api` yo'q).

**Nima qilindi** (faqat `apps/web` — 6 fayl, `apps/api` ga TEGILMADI)

| Fayl | O'zgarish |
|---|---|
| `apps/web/src/lib/pos/pos-calendar.ts` | **YANGI** — `posDayKey`, `posDaysBetween`, `posDaysSince`. Sof modul: vaqt manbasi EMAS, `now` PARAMETR bo'lib kiradi. |
| `apps/web/src/components/pos/debt-payment-dialog.tsx` | `daysSince` endi `posDaysSince(iso, serverNow())`. Ikki nuqson birdan yopildi: qurilma soati va 24-soatlik bo'lak. |
| `apps/web/src/app/(app)/sotuv/_components/navbat-mode.tsx` | `useNowTick` (`Date.now()` + o'z 30s intervali) OLIB TASHLANDI → `useServerClock(30_000)`. `formatElapsed` sof qoldi. |
| `apps/web/src/app/(app)/sotuv/page.tsx` | Qoralama `createdAt` (3 joy) → `serverNow().getTime()`; chip `timeLabel` ga `timeZone: POS_TZ`. |
| `apps/web/src/lib/pos/pos-calendar.test.ts` | **YANGI** — 10 test. |
| `apps/web/src/app/(app)/sotuv/__tests__/navbat-mode.test.tsx` · `…/sales-screen-cart.test.tsx` · `src/__tests__/pos-debt-payment-wiring.test.ts` | +1 test har biriga. |

**🔴 Muhandislik qarori — nega `Intl` EMAS, qat'iy +5 siljish.** «Kechikish kunlari» SERVERdagi qarz
reyestri bilan bir xil chiqishi shart: kassir ekranida «5 kun», menejerning undirish ro'yxatida
«4 kun» bo'lsa bitta qarz ikki yoshda ko'rinardi. Shuning uchun `posDayKey` serverning
`apps/api/src/modules/debt/sale-debt-registry.ts:143` (`tashkentDayKey`) formulasini AYNAN takrorlaydi
(`TASHKENT_OFFSET_MS = 5 soat`; O'zbekistonda 1996 dan beri DST yo'q, ya'ni `Asia/Tashkent` yil bo'yi
UTC+5 — natija `Intl` bilan bir xil). Qo'shimcha foyda: qattiq BCP-47 teg kerak bo'lmadi, ya'ni S4
guard doirasini `lib/pos` ga kengaytirganda bu modul to'siq bo'lmaydi. Testda serverning o'z
chegara-namunalari (`debt-collection.test.ts:53`, `sale-debt-registry.test.ts`) qayta o'lchandi.

**Ko'rinish qarori — `useServerClock` `null` qaytarganda.** Mount'gacha soat o'lchanmagan. Kartada
soxta «hozirgina» chizish kassirga YOLG'ON ma'lumot berardi, shuning uchun vaqt bo'lagi o'sha bitta
kadrda umuman chizilmaydi; ajratuvchi «·» ham o'zidan oldingi bo'lak bor bo'lgandagina qo'yiladi
(osilib qolgan nuqta chiqmasin).

**Yangi testlar soni:** **13** (10 + 3).

**Test natijalari (raqam bilan)**

- `src/lib/pos/pos-calendar.test.ts` — **10/10** ✔
- `…/sotuv/__tests__/navbat-mode.test.tsx` — **6/6** ✔ (ilgari 5 edi)
- `…/sotuv/__tests__/sales-screen-cart.test.tsx` — **47/47** ✔ (ilgari 46 edi)
- `src/__tests__/pos-debt-payment-wiring.test.ts` — **15/15** ✔ (ilgari 14 edi)
- To'liq S3 doirasi (`src/app/(app)/sotuv` · `src/components/pos` · `src/lib/pos` · `src/__tests__`) —
  **152 fayl · 2281 o'tdi · 25 o'tkazib yuborildi · 0 yiqildi** ✔
- `pnpm --filter @moysklad/web typecheck` — **0 xato** ✔
- `npx biome check` (o'zgargan 8 fayl) — **0 xato**, 40 ogohlantirish; hammasi
  `useSortedClasses`/`noNonNullAssertion` va **MENDAN OLDIN bor edi** — `git diff -U0` bilan
  o'zgargan qator oraliqlari chiqarilib solishtirildi, ogohlantirishlarning BIRORTASI ham
  o'zgargan qatorlarga tushmadi.
- `pnpm i18n:gate` — **20/20** ✔ (yangi matn qo'shilmadi — `navbat_elapsed_*` kalitlari o'sha-o'sha)

**Anti-vakuum (uchala tuzatish ham o'lchandi)**

| Vaqtincha qaytarildi | Test natijasi |
|---|---|
| `useServerClock` → `Date.now()` (navbat) | ✘ qizardi: `'…3 soat 5 daq·2 ta pozitsiya…' not to contain 'soat'` |
| `serverNow().getTime()` → `Date.now()` (qoralama) | ✘ qizardi: chip `23:50` chiqardi, `00:10` kutilgan |
| `timeZone: POS_TZ` olib tashlandi (chip) | ✘ qizardi: chip `09:10` chiqardi, `00:10` kutilgan |

Qoralama testi to'rt kombinatsiyani bir vaqtda ajratadi (qurilma soati 23:50 Toshkent / 08:50
Honolulu, server 00:10): faqat **server soati + Toshkent mintaqasi** o'tadi.

**🔴 §2 qoida 3 — YOZMA ISBOT: serverga yangi maydon YUBORILMADI**

```
 apps/web/src/__tests__/pos-debt-payment-wiring.test.ts   | 18 +++++
 apps/web/src/app/(app)/sotuv/__tests__/navbat-mode.test.tsx | 61 ++++++++++-
 apps/web/src/app/(app)/sotuv/__tests__/sales-screen-cart.test.tsx | 49 +++++++-
 apps/web/src/app/(app)/sotuv/_components/navbat-mode.tsx | 40 ++++++------
 apps/web/src/app/(app)/sotuv/page.tsx                    | 15 ++++--
 apps/web/src/components/pos/debt-payment-dialog.tsx      | 18 ++++--
 apps/web/src/lib/pos/pos-calendar.ts (YANGI) · pos-calendar.test.ts (YANGI)
```

Diffda `apps/api` YO'Q. Uch o'zgarish ham FAQAT ko'rsatish qatlamida: navbat kartasining matni,
qarz oynasidagi kun soni va qoralama chipining yorlig'i. Hech biri so'rov tanasiga tegmaydi —
qoralama umuman serverga chiqmaydi (`localStorage`), qarz to'lovi payload'i o'zgarmadi
(`pos-debt-payment-wiring.test.ts` uni qulflab turadi va yashil).

**Qabul mezoni**

- ✔ **Skew +3 soat bo'lganda navbat «o'tgan vaqt»i o'zgarmaydi** — test bilan: qurilma 3 soat
  oldinda, karta baribir «5 daq» ko'rsatadi (tuzatishdan oldin «3 soat 5 daq» edi).
- ✔ **Qoralama vaqti server soatida yoziladi va ko'rsatiladi** — test bilan (`00:10`, `23:50` EMAS),
  ustiga mintaqa ham qotirildi.
- ✔ **`newDraftId()` (`cart-drafts.ts:97`) TEGILMAGAN** — `git diff` da `cart-drafts.ts` umuman yo'q.
- ✔ **Qarz kunlari `Asia/Tashkent` kalendar kuni bo'yicha** — chegara testlari: 23:50 → ertasi 00:10
  = **1 kun** (ilgari 0); 00:10 → o'sha kunning 23:00 = **0 kun**.

**«Bu o'zgarish qaysi mavjud oqimni buzishi mumkin?»**

1. **Qarz «kechikish kunlari» raqami O'ZGARADI** — bu tuzatishning maqsadi, lekin kassir ertaga
   boshqa raqam ko'radi: kecha yozilgan qarz endi «0» emas, «1 kun». Bu server bilan mos, ya'ni
   ilgari mos KELMAGANI nuqson edi. Pulga, payload'ga, FIFO taqsimotga ta'siri YO'Q — faqat matn.
2. **`localStorage` dagi ESKI qoralamalar** qurilma vaqtida yozilgan `createdAt` bilan turibdi.
   Tip (`number`) va `parseCartDrafts` shartnomasi tegilmagani uchun ular YO'QOLMAYDI (savat
   saqlanadi); faqat chipdagi vaqtlari bir marta skew qadar siljib ko'rinadi. Qoralama umri
   soatlar bilan o'lchanadi — keyingi park'dan boshlab hammasi server vaqtida.
3. **Navbat kartasida vaqt bir kadr kechroq paydo bo'ladi** (`useServerClock` mount'gacha `null`).
   Ataylab: soxta qiymat chizishdan ko'ra bo'sh joy afzal. Mavjud test (`5 daq` ni kutadigan)
   yashil qoldi — effekt birinchi bo'yashdan keyin darhol ishlaydi.
4. **Har karta o'z intervalini ochmaydi** — puls avvalgidek BITTA (endi `useServerClock` ichida),
   ya'ni o'nlab kartali navbatda ham taymer soni o'zgarmadi.
5. **`daysSince` endi `null` ni ko'proq holatda qaytaradi** (buzuq ISO ham `null`, ilgari `NaN` →
   `0` bo'lardi). Chaqiruvchi allaqachon `null` ni O'LCHANMAGAN deb chizmaydi, ya'ni buzuq sana
   endi «0 kun» degan yolg'on o'rniga umuman ko'rsatilmaydi.

**Ochiq qolganlar**

- `debt-payment-dialog.tsx:154` dagi `fmtDate` (qarz sanalari ro'yxati) hamon mintaqasiz — **S4**
  (§1.3 ro'yxatida shunday belgilangan; S3 ataylab tegmadi).
- §1.3 dagi qolgan formatlash nuqtalari va zaxira `CHEK-HHMMSS` soati — **S4**.
- Ogohlantirish chipi + qurilmada NTP + jonli smoke — **S5**.
- **Deploy QILINMADI** (§2 qoida 9) — kassa jonli ishlayapti.
