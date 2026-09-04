# TSD — omborchi qulayligi (T-reja)

> **Yaratilgan:** 2026-09-03 · **Buyurtmachi:** Ozodbek (egasi) · **Holat:** BAJARILMOQDA — T1 TUGADI (2026-09-03, `9c7276e8`), T2 TUGADI (2026-09-03, `da2d7daa`), T3 TUGADI (2026-09-04, `1086d253`), T4 TUGADI (2026-09-04, `c339187f`), T5 TUGADI (2026-09-04, `d47a9786`)
> **Boshlang'ich nuqta:** TSD ilovasi `0.4.0` (versionCode 4), Compose UI, jonli terminal **iData 95W Pro** qo'lda.
> **Sabab:** jonli sinovda omborchi «Sanash» ekranida tiqilib qoldi — yacheyka bo'sh edi va tovarni biriktirishning
> HECH QANDAY yo'li yo'q edi (§1.2). Egasining talabi: «omborchi umuman qiynalmasligi kerak».
> **Bog'liq rejalar:** U-reja (`2026-09-01-tsd-zamonaviy-ui.md`), G-reja (`2026-08-23-omborchi-tsd-mijozlar.md`),
> F-reja (`2026-08-23-ombor-restrukturizatsiya.md`), K-reja (`2026-08-25-bolinadigan-tovar-bolak-hisobi.md`).
>
> **Ijro tartibi (O'ZGARMAS):** har faza **ALOHIDA sessiyada**. Agent shu faylni to'liq o'qiydi, FAQAT o'z fazasini
> bajaradi, testlardan o'tkazadi, §5 «Hisobotlar» ga o'z fazasi ostiga yozadi va **TO'XTAYDI** —
> keyingi fazani BOSHLAMAYDI. Sabab: kontekst o'sishi bilan token sarfi ~kvadratik oshadi.

---

## 1. Kontekst (nega bu reja)

### 1.1. Hozir nima bor (2026-09-03 da koddan o'qib o'lchandi)

- Ilova: `android/tsd-app`, `0.4.0` (versionCode 4), Jetpack Compose + Material 3, **11 ekran**
  (`HomeScreen`, `TaskListScreen`, `TaskDetailScreen`, `ShortageScreen`, `CutScreen`, `PlaceScreen`,
  `CountScreen`, `ScanInfoScreen`, `PickProductScreen`, `QueueScreen`, `DiagnosticsScreen`, `AuthScreens`).
- Server sirti: `GET /tsd/scan` (narxsiz), TSD allowlist `tsd-policy.ts` (**default-deny**), `/auth/tsd-login`,
  oflayn navbat `clientOpId` idempotentligi bilan.
- U-reja fazalari U1…U7 bajarilgan; **U4 (jonli qurilma smoke) — QISMAN, ochiq qarz** (U-reja «Ochiq qolganlar»).
- **Kod hali commit qilinmagan**: `git status` da `android/tsd-app` ning 15+ fayli `M`/`??` holatida,
  branch `yacheyka-inventarizatsiya`. Birinchi faza buni hisobga oladi (§2, qoida 6).

### 1.2. 🔴 Jonli hodisa — «Yacheyka bo'sh» boshi berk ko'cha

Omborchi Sanash ekranida `02-01-01-04` yacheykasini ochdi. Yacheyka bo'sh chiqdi. Ekran
«Tovar shtrixini skanerlang **yoki ro'yxatdan tanlang**» deydi — lekin ro'yxat bo'sh, ya'ni maslahatning
yarmi bajarilmaydi. Tovarni biriktirishning yo'li qolmadi. **Uchta ildiz sabab, uchalasi ham koddan
o'qib tasdiqlangan (taxmin emas):**

1. **Nom/artikul bo'yicha qidiruv YO'Q.** `TsdService.scan` faqat AYNAN moslik bilan qidiradi:
   `apps/api/src/modules/tsd/tsd.service.ts` — `OR: [{ barcodes: { has: code } }, { code }, { article: code }]`.
   Ya'ni shtrixi yo'q / yorlig'i yirtilgan / shtrixi bazaga kiritilmagan tovar = **boshi berk ko'cha**.
   TSD allowlist'da `/products` ATAYLAB yo'q (narx sababi) — demak qidiruv uchun **yangi narxsiz sirt** kerak.
2. **Server allaqachon beradigan ma'lumot TASHLAB YUBORILAYAPTI.**
   `store-address.service.ts: lookupCellByBarcode` javobi **`{ cells, products, stock }`** —
   `products` bu yacheykaga BIRIKTIRILGAN tovarlar ro'yxati (`__yacheyka` + `ProductCellLink`, narxsiz).
   `CountScreen.openCell` esa faqat `cells` va `stock` ni o'qiydi, `products` ni **umuman ko'rmaydi**.
   Ya'ni «bo'sh» yacheykada aslida ko'rsatiladigan ro'yxat BOR va u qo'shimcha so'rovsiz keladi.
3. **Qo'lda kiritib ham bo'lmaydi.** `ScanBar.kt` — 3 belgidan keyin **350 ms jimlikda avtomatik yuboradi**
   (U5 da suffikssiz skaner uchun qo'yilgan zaxira). Odam qo'lda `02-01-01-04` yozsa, `02-` dan keyin
   pauza bo'ladi va yarim kod yuboriladi → «Topilmadi». Klaviatura amalda ishlamaydi.

### 1.3. Qo'shimcha ergonomika bo'shliqlari (o'lchandi)

- **Ovoz/tebranish YO'Q** (`grep`: `Vibrator`, `ToneGenerator`, `SoundPool` — hech biri yo'q). Omborchi javon
  oldida turadi, ekranga qaramaydi; muvaffaqiyat ham, xato ham faqat toast bilan aytiladi.
- **`keepScreenOn` YO'Q** — sanash o'rtasida ekran o'chadi, PIN qayta so'raladi.
- **Miqdor faqat sof raqam** (`NumberField`) — «12 quti × 24 dona» ni omborchi boshida hisoblaydi.
- **Sanashda progress yo'q** — yacheykada nechta qator sanaldi/qoldi ko'rinmaydi; «sanalmagan qolganini 0 qilish»
  yo'li yo'q, ya'ni inventarizatsiya hech qachon TO'LIQ yopilmaydi.
- **Sanoqni qaytarish yo'q** — noto'g'ri raqam saqlansa server **jim avto-Оприходование** yozadi
  (`setCellStock`, `oldQty = 0` shoxi). Bu jonlidagi «Ombor 02 yacheykalarida 361 885 soxta son» muammosi
  bilan bir klass.

### 1.4. O'zgarmaydigan biznes qoidalari (bu reja ularga TEGMAYDI)

- **NARX HECH QAYERDA ko'rinmaydi** — server bermaydi, ilova so'ramaydi (`tsd-scan.ts` oq ro'yxati).
- Sanash — **mutlaq son** (`mode: 'set'`), oflayn navbatga qo'yilmaydi.
- **«Tayyor» tugmasi yo'q** — hamma qator yopilgach chek o'zi kontrolga tushadi (G2).
- **Multi-hit'da tanlovni ODAM qiladi** — ilova hech qachon o'zi tovar tanlamaydi.
- Oflayn navbat: FIFO, 4xx → «rad etilganlar» ro'yxatiga (jim yo'qotish yo'q — IS-5).

---

## 2. O'ZGARMAS QOIDALAR (har sessiya uchun)

1. **Bitta sessiya = bitta faza.** Faza tugagach agent **KEYINGISINI BOSHLAMAYDI** — §5 ga hisobot yozadi
   va to'xtaydi. Bu qoidaning istisnosi yo'q.
2. Ishni boshlashdan avval **shu faylni TO'LIQ o'qi** (ayniqsa §1, §2 va avvalgi fazalar hisobotlarini).
   O'z fazang vazifalaridan tashqariga chiqma — «yo'l-yo'lakay tuzatdim» bu yerda TAQIQ; topilgan boshqa
   nuqson hisobotning «Ochiq qolganlar» bandiga yoziladi.
3. **Narx qoidasi — qizil chiziq.** Serverga qo'shiladigan har qanday yangi javob maydoni uchun savol:
   «bu yerda narx bormi?». TSD allowlist'iga qator qo'shilsa, hisobotda **nega narxsizligi** yozma
   isbotlanadi (`select` oq ro'yxati bilan, «ekranda ko'rsatmayapmiz» — isbot EMAS).
4. **Testlar majburiy:**
   - server tegilgan bo'lsa: `cd apps/api && npx vitest run <o'z modulingdagi testlar>` + `pnpm --filter @moysklad/api typecheck`
     (OOM'da `NODE_OPTIONS=--max-old-space-size=8192`), yangi mantiqqa **yangi test**;
   - allowlist tegilgan bo'lsa: `tsd-policy.test.ts` **majburiy** (yangi qator ochilgani + `/products` hamon YOPIQ);
   - ilova tegilgan bo'lsa: build **ogohlantirishsiz** o'tsin:
     ```sh
     cd android/tsd-app && JAVA_HOME=D:/dev/java/jdk-17 ANDROID_HOME=D:/dev/android-sdk \
       /d/dev/_downloads/g87/gradle-8.7/bin/gradle --no-daemon assembleDebug
     ```
     (Gradle **8.7**, 9.x AGP 8.5.0 bilan MOS EMAS.)
   - web tegilgan bo'lsa (odatda tegilmaydi): i18n gate'lar `pnpm i18n:gate`.
5. **Hisobot majburiy** (§5, o'z fazang sarlavhasi ostiga): nima qilindi (fayllar, commit), **test natijalari
   raqam bilan**, qabul mezonining har bandi bo'yicha ✔/✘, ochiq qolganlar, keyingi fazaga eslatmalar.
   Hisobotsiz faza TUGAMAGAN hisoblanadi.
6. **Git.** Branch `yacheyka-inventarizatsiya`, push → `mirfayz` remote. Diqqat: T-reja boshlanganda
   `android/tsd-app` da **commit qilinmagan U-reja ishi** turibdi — birinchi faza agenti avval
   `git status` ni tekshiradi va o'z commitiga BEGONA fayllarni qo'shmaydi (kerak bo'lsa mavjud ishni
   alohida commit bilan qamrab, hisobotda aytadi). Commit subject **kichik harf** (commitlint);
   biome `noAssignInExpressions`/`noNonNullAssertion` pre-commit'da xato beradi.
7. **Qabul mezoni — yopish sharti.** Bandlardan biri bajarilmasa faza «TUGADI» deb yopilmaydi; holati
   **«QISMAN — <nima kutilmoqda>»** bo'ladi. Mezonni egasiga o'tkazish — yopish EMAS. (F-reja qoida 11.)
8. **Jonli xulqqa ta'sir savoli.** Hisobotda **«bu o'zgarish qaysi mavjud oqimni buzishi mumkin?»** savoliga
   YOZMA javob beriladi — «buzmaydi» deyish ham dalil bilan. Ilova-ichi o'zgarishlar uchun ham: sanash
   semantikasi (mutlaq son), oflayn navbat, multi-hit va narx qoidalari buzilmaganini ko'rsat.
9. **APK'ni kanalga chiqarish — FAQAT egasi «chiqar» desa.** Faza kodni yozadi va build qiladi;
   `tools/publish.sh` **avtomatik chaqirilmaydi** (o'rnatish terminalni qayta ishga tushiradi va yarim
   bajarilgan yig'ish/sanashni uzadi). Chiqarilsa: `versionCode` +1 va `versionName` oshiriladi,
   **debug-kalit** bilan imzolanishi va kalit shu mashinada qolishi esda tutiladi (T9 shuni yopadi).
10. **Tegilmaydigan fayllar** (fazasi ochiq aytmasa): `ApiClient.kt` ning transport qismi (cookie idorasi,
    `exec`, 401-refresh), `ActionQueue.kt`, `QueueSender.kt`, `DeviceStore.kt`, `ScannerBridge.kt`.
    Yangi API metodi qo'shish `ApiClient` ga RUXSAT (transport mantig'iga tegmasdan).
11. **Maxfiy ma'lumot bu faylga YOZILMAYDI** (repo public): parol, token, `deviceSecret`, PIN.
12. Ishlar faqat `D:\sherset-v2` da. Jonli bazaga skript yozilmaydi (bu reja ilova+API doirasida).

---

## 3. Fazalar xaritasi

| Faza | Nima | Server ishi | Prioritet | Holat |
|---|---|---|---|---|
| **T1** | Yacheykaga biriktirilgan tovarlar — Sanash ekranida | yo'q (javobda bor) | 🔴 blok | **TUGADI** |
| **T2** | Qo'lda kiritish — `ScanBar` 350 ms tuzog'i va fokus | yo'q | 🔴 blok | **TUGADI** |
| **T3** | Nom/artikul bo'yicha qidiruv (`GET /tsd/search` + ekran) | **ha** (yangi narxsiz sirt) | 🔴 blok | **TUGADI** |
| **T4** | Skan javobi: ovoz, tebranish, xato banneri, ekran o'chmasligi | yo'q | 🟡 qulaylik | **TUGADI** |
| **T5** | Miqdor kiritish: kalkulyator (`12*24`) + tez tugmalar | yo'q | 🟡 qulaylik | **TUGADI** |
| **T6** | Sanash progressi + «qolgan qatorlarni 0 qilib yopish» | yo'q | 🟡 qulaylik | REJA |
| **T7** | «Oxirgi sanoq» — bir bosishda qaytarish (undo) | yo'q | 🟡 qulaylik | REJA |
| **T8** | Jonli qurilma smoke — U4 qarzini yopish (kod yozilmaydi) | yo'q | 🔴 qarz | REJA |
| **T9** | Release-imzo va tarqatish kanali (imzo qarzi) | yo'q | 🟠 xavf | REJA |
| **T10** | Oflayn o'quv keshi | yo'q | 🔵 keyin | REJA |
| **T11** | Inventarizatsiya sessiyasi va farqlar hisoboti | **ha** (katta) | 🔵 keyin | REJA |

**Tartib sababi:** T1 eng arzon va rasmdagi holatni darhol yaxshilaydi; T2 matn kiritishning poydevori
(usiz T3 dagi qidiruv maydoniga qo'lda yozish ham xavf ostida); T3 eng katta va eng muhim funksiya.
T4–T7 — kundalik qulaylik. T8 U-rejadan qolgan qarz va uni **T1–T3 jonliga chiqqach** bajargan ma'qul
(bitta o'rnatishda uchalasi ham sinaladi). T9–T11 — keyingi bosqich.

---

## 4. Fazalar tafsiloti

### T1 — Yacheykaga biriktirilgan tovarlar (Sanash ekrani)

**Maqsad.** «Yacheyka bo'sh» ekrani boshi berk ko'cha bo'lmasin: yacheykaga BIRIKTIRILGAN tovarlar
ro'yxat bo'lib chiqsin va bosilganda sanoq maydoni ochilsin.

**Nega arzon.** `GET /admin/stores/cells/by-barcode` javobi **allaqachon** `{ cells, products, stock }`
qaytaradi (`store-address.service.ts: lookupCellByBarcode`) — `products` narxsiz
(`id, name, code, barcode, archived`). Ilova uni tashlab yuboryapti. **Qo'shimcha so'rov ham,
server o'zgarishi ham KERAK EMAS.**

**Vazifalar.**
1. `CountScreen.openCell`: `resp.optJSONArray("products")` ni ham o'qib state'ga sol (`bound`).
2. Ekranda **ikki guruh**: (a) `stock` — qoldig'i bor qatorlar (hozirgidek); (b) `bound` dan `stock` da
   BO'LMAGANLARI — kulrang «biriktirilgan · qoldiq 0» qatori, bosilsa `pick(name, id)` ishlaydi
   (mavjud metod, o'zgarmaydi). `archived: true` bo'lganlari eng oxirida va belgisi bilan.
3. `count_empty` matni faqat **ikkala guruh ham bo'sh** bo'lgandagina chiqsin; hozirgi
   `count_scan_product_tip` matni endi haqiqatga mos bo'ladi.
4. Sarlavha-kartaga qisqa hisob: «Qoldiqda N · biriktirilgan M».
5. Yangi `strings.xml` qatorlari (uz).
6. `README.md` → «Qo'lda smoke» ga T1 bandi: bo'sh yacheyka ochilganda biriktirilgan tovar ko'rinishi.

**Cheklovlar.** Sanash semantikasi (`mode: 'set'`, mutlaq son) va yacheykada YO'Q tovar sanalganda
chiqadigan **sariq ogohlantirish** (`count_not_in_cell`, «kirim bo'lib yoziladi») o'z holicha qoladi —
biriktirilgan lekin qoldig'i 0 tovar ham aynan shu ogohlantirishga tushadi.

**Qabul mezoni.**
- `assembleDebug` **ogohlantirishsiz**;
- bo'sh (lekin biriktirilgan tovari bor) yacheykada ro'yxat chiqadi va tanlash ishlaydi — **kodda ko'rsatilsin**
  (jonli qurilma sinovi T8 da);
- hech qanday yangi tarmoq so'rovi qo'shilmagani hisobotda aytilsin;
- server fayllariga **bitta bayt ham** tegilmagan.

<details><summary><b>T1 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) Avval `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` faylini TO'LIQ o'qi —
   ayniqsa §1 (kontekst), §2 (o'zgarmas qoidalar) va §4 dagi T1 bo'limini.
2) Sen FAQAT **T1 — Yacheykaga biriktirilgan tovarlar (Sanash ekrani)** fazasini bajarasan.
   Boshqa fazalarga TEGMA, «yo'l-yo'lakay» tuzatish qilma.
3) Ishni boshlashdan oldin `git status` ni tekshir: android/tsd-app da commit qilinmagan
   U-reja ishi bor — o'z commitingga begona fayllarni qo'shma (§2, qoida 6).
4) Qabul mezonini bajar va §2 qoida 4 dagi build buyrug'ini yugurtir.
5) Tugagach rejaning §5 «Hisobotlar» bo'limiga «### T1 — …» sarlavhasi ostida to'liq
   hisobot yoz (nima qilindi, fayllar, build natijasi, qabul mezoni bo'yicha ✔/✘,
   «qaysi oqimni buzishi mumkin?» savoliga javob, ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. Hisobotni yozib TO'XTA.
```
</details>

---

### T2 — Qo'lda kiritish (`ScanBar` 350 ms tuzog'i)

**Maqsad.** Omborchi klaviaturadan yacheyka kodini yoki shtrixni **qo'lda** yoza olsin; skanerning
suffikssiz rejimi esa ishlashda davom etsin.

**Nega.** `ScanBar.kt` da `LaunchedEffect(value) { if (length >= 3) { delay(350); submit() } }` —
skaner uchun to'g'ri, odam uchun halokatli: qo'lda yozilgan kodning birinchi 3 belgisi yuboriladi.

**Vazifalar.**
1. **Manbani ajrat.** Tugma hodisalari orasidagi vaqtni o'lcha (`onPreviewKeyEvent` da oxirgi belgi
   vaqti): o'rtacha interval **< 50 ms** → skaner (avto-yuborish ISHLAYDI); **≥ 50 ms** → odam
   (avto-yuborish O'CHADI, faqat ENT/«Qidirish» tugmasi yuboradi). Chegara `config.xml` dan o'qilsin
   (qurilma almashsa kod o'zgarmasin). Broadcast rejimi (`ScannerBridge`) bu shoxdan mustaqil.
2. Maydonda **rejim belgisi**: odam yozayotgani aniqlanganda o'ng tomonda «⏎» ko'rsatkichi/tugma chiqsin —
   omborchi nima kutilayotganini ko'rsin.
3. **Fokus intizomi:** ekran ichida boshqa matn maydoni fokus olganda `ScanBar` uni **tortib olmasin**
   (hozir `LaunchedEffect(screenKey)` faqat ekran almashganda ishlaydi — buni buzma, lekin T3 da
   qidiruv maydoni qo'shilishini hisobga olib xulqni hisobotda aniq yozib qoldir).
4. `DiagnosticsScreen` ga: oxirgi kiritish **skaner** deb topildimi yoki **odam** deb — jonlida
   sozlashni USB'siz tekshirish uchun.
5. `README.md` → «Skaner» bo'limiga qisqa izoh.

**Cheklovlar.** `ScannerBridge.kt` ning broadcast qismiga TEGILMAYDI (§2, qoida 10). 350 ms zaxirasi
**o'chirilmaydi** — u faqat odam yozganda chetlab o'tiladi (U5 dagi suffikssiz skaner muammosi qaytmasin).

**Qabul mezoni.**
- `assembleDebug` ogohlantirishsiz;
- kodda ko'rsatilsin: sekin yozilgan 11 belgili kod **bir marta va to'liq** yuboriladi; tez «yozilgan»
  (skaner) kod avvalgidek 350 ms da yuboriladi;
- ENT bilan yuborish ishlaydi va maydon tozalanadi;
- diagnostika ekranida manba ko'rinadi.

<details><summary><b>T2 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi — §1, §2 va §4 dagi T2 bo'limi,
   hamda §5 dagi T1 hisoboti (u qidiruv/fokus haqida eslatma qoldirgan bo'lishi mumkin).
2) Sen FAQAT **T2 — Qo'lda kiritish (ScanBar 350 ms tuzog'i)** fazasini bajarasan.
3) Diqqat: 350 ms avto-yuborish zaxirasi U5 da JONLI muammo uchun qo'yilgan — uni o'chirma,
   faqat odam yozganda chetlab o't. ScannerBridge broadcast qismiga tegma.
4) §2 qoida 4 dagi build buyrug'ini yugurtir (Gradle 8.7).
5) Tugagach §5 ga «### T2 — …» hisobotini yoz (nima qilindi, chegara qiymati va u qayerdan o'qiladi,
   build natijasi, qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?», ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T3 — Nom / artikul bo'yicha qidiruv (`GET /tsd/search` + ilova)

**Maqsad.** Shtrixsiz (yoki shtrixi o'qilmaydigan) tovarni omborchi **nomidan** topa olsin — Sanash,
Joylashtirish va «ma'lumot» oqimlarining hammasida.

**Nega yangi endpoint.** `/tsd/scan` faqat aynan moslik qiladi; `/products` esa TSD'ga ATAYLAB yopiq
(javobida `buyPrice`, `minPrice`, `salePrices` bor). Demak — **narxsiz alohida sirt**, `/tsd/scan` bilan
bir xil oq ro'yxat ustida.

**Vazifalar — server.**
1. `apps/api/src/modules/tsd/tsd-search.ts` (SOF modul, Prisma/Nest yo'q): so'rovni tozalash
   (`normalizeSearchQuery`), min 2 / max 100 belgi, natijalarni **saralash qoidasi** (aynan moslik →
   boshida moslik → ichida moslik; `archived` eng oxirida).
2. `TsdService.search(accountId, query)`: `where: { accountId, deletedAt: null, OR: [ name contains
   (insensitive), article contains, code contains, barcodes has ] }`, `select: TSD_PRODUCT_SELECT`,
   `take: 30`. **Javob shakli `/tsd/scan` ning `products` elementi bilan AYNAN BIR XIL** bo'lsin
   (`id, name, code, article, barcodes, uom, archived, homeCell, totalQty, cells`) — buning uchun
   `scan` ichidagi «hit qurish» mantig'i umumiy funksiyaga (`buildProductHits`) chiqariladi va
   IKKALA yo'l ham shundan foydalanadi. Sabab: ilova bitta renderer va bitta `PickProductScreen`
   bilan ishlaydi, ikki xil shakl ikki xil bug beradi.
3. `TsdController`: `@Get('search')` + `@RequirePermission({ entity: 'product', action: 'view' })`.
4. `tsd-policy.ts`: `{ prefix: '/tsd/search', methods: ['GET'], exact: true, why: 'narxsiz nom-qidiruv' }`.
5. **Testlar:** `tsd-search.test.ts` (sof modul: normalizatsiya, saralash, chegaralar) +
   `tsd.service.test.ts` ga qidiruv holatlari (nom bo'lagi, artikul, arxiv oxirida, `take` chegarasi,
   **narx maydonlari yo'qligi qulfi**) + `tsd-policy.test.ts` (yangi qator ochiq, `/products` hamon **yopiq**).
6. **Ishlash tezligi:** `name contains` indekssiz — hisobotda jonliga yaqin hajmda (yoki lokal dev bazada)
   **o'lchangan vaqt** yozilsin. Sekin bo'lsa `pg_trgm` indeksi taklif qilinadi (migratsiya
   **bu fazada yozilmaydi** — alohida qaror).

**Vazifalar — ilova.**
7. `ApiClient` ga `fun search(q: String): JSONArray` (transport mantig'iga tegmasdan).
8. Yangi `SearchScreen.kt`: qidiruv maydoni (T2 dagi qoidaga bo'ysunadi — avto-yuborish yo'q,
   «Qidirish» tugmasi/ENT), natijalar kartalari (nom, artikul, jami qoldiq, uy-yacheykasi),
   `onPick: (JSONObject) -> Unit` callback bilan.
9. Ulash nuqtalari: **Sanash** (yacheyka ochiq bo'lganda «🔍 Tovar qidirish» → `pick()`),
   **Joylashtirish** (1-bosqichda «🔍 Qidirish» → `product`), **Bosh menyu** (yangi plitka →
   natija bosilsa `ScanInfoScreen`, ya'ni «bu nima va qayerda»).
10. `strings.xml` (uz) + `README.md` «Backend kontrakti» va smoke bandlari.

**Cheklovlar.** Narx maydonlari javobga **hech qanday yo'l bilan** kirmaydi; `TSD_PRODUCT_SELECT`
kengaytirilmaydi. Multi-hit qoidasi kuchda: qidiruv natijasidan tovarni **ODAM** tanlaydi.

**Qabul mezoni.**
- api testlari yashil, **yangi testlar soni raqam bilan** hisobotda;
- `tsd-policy.test.ts` da `/products` hamon 403 ekani qulflangan;
- `pnpm --filter @moysklad/api typecheck` 0 xato;
- `assembleDebug` ogohlantirishsiz;
- qidiruv javobining shakli `/tsd/scan` bilan bir xilligi test bilan qulflangan;
- o'lchangan qidiruv vaqti hisobotda.

<details><summary><b>T3 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi — §1, §2 va §4 dagi T3 bo'limi,
   hamda §5 dagi T1/T2 hisobotlari.
2) Sen FAQAT **T3 — Nom/artikul bo'yicha qidiruv** fazasini bajarasan (server + ilova).
3) 🔴 NARX QOIDASI: javobga narx maydoni hech qanday yo'l bilan kirmasin; `/products` TSD'ga
   YOPIQ qolsin va buni test qulflasin. `TSD_PRODUCT_SELECT` kengaytirilmaydi.
4) `/tsd/scan` ichidagi hit-qurish mantig'ini umumiy funksiyaga chiqarib, qidiruv ham SHU shaklni
   qaytarsin (ilovada bitta renderer).
5) Testlar: apps/api vitest (tsd + auth/tsd-policy) va typecheck; ilova tomonda §2 qoida 4 build.
6) Tugagach §5 ga «### T3 — …» hisobotini yoz: fayllar, yangi testlar SONI, test natijalari raqam bilan,
   o'lchangan qidiruv vaqti, qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?» javobi, ochiq qolganlar.
7) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T4 — Skan javobi: ovoz, tebranish, xato banneri, ekran o'chmasligi

**Maqsad.** Omborchi ekranga qaramasdan ham amal o'tgan-o'tmaganini bilsin.

**Vazifalar.**
1. `Feedback.kt` (yangi): `ok()` — qisqa yuqori ton + 1 ta qisqa tebranish; `fail()` — past ton +
   ikkita tebranish. `ToneGenerator` yoki `SoundPool`, `Vibrator`/`VibratorManager` (Android 14).
   Ovoz balandligi ombor shovqiniga mos (media emas, `STREAM_NOTIFICATION`).
2. Ulash: muvaffaqiyatli skan/tasdiq/saqlash → `ok()`; «Topilmadi», 4xx, «yacheyka topilmadi»,
   «avval yacheykani skanerlang» → `fail()`.
3. **Xato banneri:** `Shell` ga `error(text)` qo'shilsin — toast o'rniga ekran tepasida **qizil banner**
   (bir necha soniya turadi, bosilsa yopiladi). Muvaffaqiyat toast bo'lib qolaveradi.
   4" ekranda toast ko'zdan qochadi va bu IS-5 klassiga yaqin (jim yo'qotish).
4. **`keepScreenOn`** — `MainActivity` da oyna bayrog'i; sozlamada emas, doimiy (terminal quvvatda turadi).
5. Sozlama shart emas, lekin ovozni o'chirish kerak bo'lsa — `config.xml` da bitta bayroq.

**Qabul mezoni.** `assembleDebug` ogohlantirishsiz; hamma xato yo'llari bannerga o'tgani (toast qolgan
joylar hisobotda sanab o'tilsin); ovoz/tebranish ruxsati manifestda (`VIBRATE`) va u **yagona yangi
ruxsat** ekani (kamera/lokatsiya YO'Q — G5 qoidasi).

<details><summary><b>T4 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi (§1, §2, §4-T4 va §5 hisobotlari).
2) Sen FAQAT **T4 — Skan javobi: ovoz/tebranish/xato banneri/ekran o'chmasligi** fazasini bajarasan.
3) Manifestga qo'shiladigan yagona yangi ruxsat — VIBRATE. Kamera/lokatsiya/audio-yozish TAQIQ.
4) §2 qoida 4 dagi build buyrug'i yashil bo'lsin.
5) Tugagach §5 ga «### T4 — …» hisobotini yoz (qaysi yo'llar bannerga o'tdi, qaysi toast qoldi va nega,
   qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?», ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T5 — Miqdor kiritish: kalkulyator va tez tugmalar

**Maqsad.** «12 quti × 24 dona» ni omborchi boshida hisoblamasin.

**Vazifalar.**
1. `Widgets.kt` dagi `NumberField` ga **ifoda rejimi**: `12*24`, `10+5`, `3*24+6` yozilsa maydon ostida
   natija ko'rinsin («= 288») va saqlashda AYNAN o'sha son yuborilsin. Sof funksiya
   `QtyExpression.kt` (`evaluate(text): BigDecimal?`) — faqat `+ - * ( )` va o'nlik nuqta/vergul;
   bo'linish YO'Q (yaxlitlash siyosati ochilib ketadi).
2. Noto'g'ri ifoda → saqlash tugmasi **o'chadi** va sabab ko'rinadi (jim 0 yuborilmasin).
3. Vergul/nuqta ikkalasi ham qabul qilinsin (`14,5` = `14.5`) — jonlida o'nlik miqdorlar bor
   (kabel/shlang metrlari).
4. Sanash va Joylashtirish ekranlarida ishlasin; kesim (`CutScreen`) uzunligiga ham tatbiq etilsin.
5. Testlar: `QtyExpression` sof funksiya — Kotlin unit-test yo'q bo'lsa hisobotda shu ochiq aytilsin
   va kamida qo'lda tekshirilgan holatlar ro'yxati yozilsin (ilovada test infratuzilmasi yo'qligi —
   U-reja «Ochiq qolganlar» dagi ma'lum holat).

**Qabul mezoni.** `assembleDebug` ogohlantirishsiz; ifoda natijasi **serverga son bo'lib** ketishi
(ifoda matni EMAS) kodda ko'rsatilsin; noto'g'ri ifodada saqlash imkonsiz.

<details><summary><b>T5 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi (§1, §2, §4-T5 va §5 hisobotlari).
2) Sen FAQAT **T5 — Miqdor kiritish: kalkulyator va tez tugmalar** fazasini bajarasan.
3) Bo'linish (/) ATAYLAB qo'llab-quvvatlanmaydi — yaxlitlash siyosati bu fazaning ishi emas.
   Noto'g'ri ifodada saqlash imkonsiz bo'lsin (jim 0 yuborilmasin).
4) §2 qoida 4 dagi build yashil bo'lsin.
5) Tugagach §5 ga «### T5 — …» hisobotini yoz (qo'llab-quvvatlanadigan sintaksis, tekshirilgan holatlar,
   qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?», ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T6 — Sanash progressi va «qolgan qatorlarni 0 qilib yopish»

**Maqsad.** Yacheyka sanog'i TO'LIQ yopilsin — «sanalmagan qator» tushunchasi ko'rinsin.

**Vazifalar.**
1. Yacheyka sarlavha-kartasida progress: «**5/12 sanaldi**» (shu sessiyada saqlangan qatorlar soni).
   Hisob ilova ichida (server sanash sessiyasini bilmaydi — u T11 ning ishi).
2. Sanalgan qatorda **yashil belgi**, sanalmaganda kulrang — omborchi ko'z bilan ajratsin.
3. «**Qolganini 0 qilib yopish**» tugmasi: sanalmagan qatorlarni **bittalab** `set 0` bilan yuboradi,
   har biri uchun tasdiq oynasi EMAS, lekin **oldindan ro'yxat ko'rsatiladi** («N ta qator 0 bo'ladi:
   …») va omborchi tasdiqlaydi. Xatoga uchragan qatorlar ro'yxatda **qizil** bo'lib qoladi.
4. 🔴 Bu amal `set 0` bo'lgani uchun serverda **avto-Списание** yozadi — tasdiq oynasida shu ochiq
   aytilsin («tizimdan chiqim bo'lib yoziladi»), jim bajarilmasin.
5. Yacheyka almashganda progress nolga tushadi.

**Cheklovlar.** Oflayn navbatga QO'YILMAYDI (sanash qoidasi) — aloqa yo'q bo'lsa amal to'xtaydi va
qaysi qatorlar yopilmagani ko'rinadi.

**Qabul mezoni.** `assembleDebug` ogohlantirishsiz; tasdiq oynasida chiqim ogohlantirishi bor;
qisman muvaffaqiyatsizlikda qaysi qator yopilmagani ekranda qoladi (jim yo'qotish yo'q).

<details><summary><b>T6 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi (§1, §2, §4-T6 va §5 hisobotlari).
2) Sen FAQAT **T6 — Sanash progressi va «qolganini 0 qilib yopish»** fazasini bajarasan.
3) 🔴 `set 0` serverda avto-Списание yozadi — bu tasdiq oynasida OCHIQ aytilsin, jim bajarilmasin.
   Sanash oflayn navbatga QO'YILMAYDI (qoida o'zgarmaydi).
4) §2 qoida 4 dagi build yashil bo'lsin.
5) Tugagach §5 ga «### T6 — …» hisobotini yoz (progress qanday hisoblanadi, qisman xatolikda xulq,
   qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?», ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T7 — «Oxirgi sanoq» — bir bosishda qaytarish

**Maqsad.** Noto'g'ri kiritilgan son darhol tuzatilsin; hozir u **jim avto-Оприходование** bo'lib qoladi.

**Vazifalar.**
1. Saqlangandan keyin qator ustida 10–15 soniya turadigan chiziq: «avval **14** edi → **41** qildingiz ·
   **⟲ qaytarish**». Eski qiymat saqlashdan OLDIN o'qilgan `qty` dan olinadi.
2. «Qaytarish» — o'sha `set <eski qiymat>` so'rovi (ya'ni yangi hujjat yoziladi, bekor qilish EMAS) —
   bu matnda ochiq aytilsin («qaytarish ham hujjat yozadi»).
3. Eski qiymati bo'lmagan (yacheykada yo'q) tovar uchun qaytarish = `set 0`, matn shunga mos bo'lsin.
4. Ekran/yacheyka almashsa chiziq yo'qoladi (adashib eski qatorga bosilmasin).

**Qabul mezoni.** `assembleDebug` ogohlantirishsiz; qaytarishdan keyin tarkib qayta o'qiladi;
qaytarish ham xuddi sanash kabi **mutlaq son** semantikasida (delta EMAS).

<details><summary><b>T7 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi (§1, §2, §4-T7 va §5 hisobotlari).
2) Sen FAQAT **T7 — «Oxirgi sanoq» qaytarish** fazasini bajarasan.
3) Qaytarish — bekor qilish EMAS, yangi `set <eski qiymat>` so'rovi; buni UI matni ham aytsin.
   Mutlaq son semantikasi buzilmasin.
4) §2 qoida 4 dagi build yashil bo'lsin.
5) Tugagach §5 ga «### T7 — …» hisobotini yoz (qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?»,
   ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T8 — Jonli qurilma smoke (U4 qarzini yopish) · **kod yozilmaydi**

**Maqsad.** T1–T7 (yoki egasi tanlagan qismi) o'rnatilgan terminalda **haqiqiy** sinovdan o'tsin va
U-rejaning U4/G5/G6 «QISMAN» statuslari yopilsin.

**Shart.** Bu faza **egasi bilan birga**, qo'lida terminal bo'lganda bajariladi. Agent APK'ni chiqaradi
(`versionCode` +1 → `tools/publish.sh`), ro'yxat bo'yicha yuritadi va natijani yozadi.

**Ro'yxat (README dagi bandlar + yangi):**
1. Juftlash → PIN → bosh menyu; versiya raqami to'g'ri.
2. Skaner: sariq tugma → kod maydonga tushadi (wedge) yoki broadcast keladi; **diagnostika ekranida**
   manba ko'rinadi (T2).
3. Bo'sh yacheyka → biriktirilgan tovarlar ro'yxati (T1) → tanlash → sanash → saqlash.
4. Qo'lda `02-01-01-04` yozish → to'liq kod ketadi (T2).
5. Nom bo'yicha qidiruv → tovar topiladi → sanash/joylashtirish (T3).
6. **Narx tekshiruvi:** o'sha token bilan `GET /api/v1/products?search=…` → **403**;
   `GET /api/v1/tsd/search?q=…` → 200 va javobda narx **yo'q**.
7. Oflayn: Wi-Fi o'chirilganda joylashtirish navbatga tushadi, qaytgach yuboriladi;
   sanash esa «aloqa yo'q» deydi va son maydonda TURADI.
8. Uchma-uch: bitta yig'ish topshirig'i to'liq bajarilib chek **kontrolga** tushadi.

**Qabul mezoni.** Har band bo'yicha ✔/✘ va ✘ larning sababi; U-reja faylidagi U4 statusi ham
yangilanadi (havola bilan). Ochiq nuqson topilsa — **tuzatish shu fazada QILINMAYDI**, yangi faza
(T12+) sifatida shu reja oxiriga yoziladi.

<details><summary><b>T8 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2). Bu faza QO'LDA SINOV — egasi bilan birga,
terminal (iData 95W Pro) qo'lda bo'lganda bajariladi.

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi (ayniqsa §4-T8 va §5 hisobotlari)
   hamda `android/tsd-app/README.md` dagi smoke ro'yxatlarini.
2) Sen FAQAT **T8 — Jonli qurilma smoke** fazasini bajarasan. Yangi funksiya YOZMAYSAN.
3) APK chiqarish: `app/build.gradle.kts` da versionCode +1 va versionName oshirilsin, so'ng
   `bash android/tsd-app/tools/publish.sh "<nima o'zgardi>"`. Egasidan tasdiq so'ra (qoida 9).
4) Ro'yxatni band-band yurit va natijani AYNAN yoz (topilgan nuqsonni SHU YERDA tuzatma).
5) Tugagach §5 ga «### T8 — …» hisobotini yoz; topilgan nuqsonlar uchun rejaning §3 jadvaliga
   yangi faza qatori (T12+) qo'sh va tafsilotini §4 ga yoz. U-reja faylidagi U4 statusini yangila.
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T9 — Release-imzo va tarqatish kanali

**Maqsad.** U-rejadan qolgan **imzo qarzi**ni yopish: hozir APK `~/.android/debug.keystore` bilan
imzolangan — kalit yo'qolsa har terminalda ilovani o'chirib qayta o'rnatish kerak va **juftlash yo'qoladi**.

**Vazifalar.** Alohida release-keystore yaratish (parol **repoga yozilmaydi** — qoida 11),
`signingConfigs` + `release` build turi, `publish.sh` ni release APK'ga o'tkazish, kalitning zaxira
tartibi (qayerda va kim saqlaydi — hujjatda **joylashuv nomi**, sirning o'zi emas), va bir martalik
o'tish yo'riqnomasi (eski debug-imzoli ilova ustiga release o'rnatilmaydi — o'chirib qayta o'rnatish
va **qayta juftlash** kerak).

**Qabul mezoni.** Release APK build bo'ladi va o'rnatiladi; `latest.json` zanjiri release bilan
ishlaydi; zaxira tartibi yozilgan; egasi kalit zaxirasini olganini tasdiqlagan.

<details><summary><b>T9 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` (§2, §4-T9, §5) va U-rejadagi «IMZO QARZI»
   bandini o'qi.
2) Sen FAQAT **T9 — Release-imzo va tarqatish kanali** fazasini bajarasan.
3) 🔴 Parol/kalit repoga YOZILMAYDI (repo public). Hujjatda faqat tartib va joylashuv NOMI bo'ladi.
4) Eski debug-imzoli ilovadan release'ga o'tish JUFTLASHNI yo'qotadi — o'tish yo'riqnomasi yozilsin
   va egasiga oldindan aytilsin.
5) Tugagach §5 ga «### T9 — …» hisobotini yoz. KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T10 — Oflayn o'quv keshi

**Maqsad.** Ombor Wi-Fi'si zaif joyda ilova butunlay «o'lmasin»: **o'qish** yo'llari keshdan ishlasin
(yozish qoidalari o'zgarmaydi).

**Vazifalar.** Oxirgi ochilgan yacheykalar tarkibi, oxirgi qidiruv natijalari va topshiriq detallarini
lokal saqlash (`SharedPreferences` yetarli — `ActionQueue` naqshi; Room kiritilmaydi), yoshi bilan
belgilash («**oflayn ma'lumot · 12 daq oldin**» plashkasi), aloqa qaytganda jim yangilash.

**Cheklovlar.** 🔴 Keshdan **hech qanday yozish qarori chiqmaydi**: sanashda «Tizimda» ustuni kesh
bo'lsa, saqlash tugmasi ham keshga tayanmaydi (mutlaq son baribir omborchi kiritgan sondan keladi).
Narx keshda ham yo'q.

**Qabul mezoni.** `assembleDebug` yashil; kesh yoshi ko'rinadi; aloqa yo'q bo'lganda ekran o'qiladi;
kesh hajmi chegaralangan (masalan 200 yacheyka / 500 tovar) va bu son hisobotda.

<details><summary><b>T10 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` ni TO'LIQ o'qi (§1, §2, §4-T10, §5).
2) Sen FAQAT **T10 — Oflayn o'quv keshi** fazasini bajarasan.
3) 🔴 Kesh — faqat O'QISH. Undan yozish qarori chiqmaydi; oflayn navbat qoidalari o'zgarmaydi;
   keshda narx bo'lishi mumkin emas. Room kiritilmaydi (SharedPreferences yetarli).
4) §2 qoida 4 dagi build yashil bo'lsin.
5) Tugagach §5 ga «### T10 — …» hisobotini yoz (nima keshlanadi, hajm chegarasi, yosh belgisi,
   qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?»). KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### T11 — Inventarizatsiya sessiyasi va farqlar hisoboti

**Maqsad.** Sanash **izli** bo'lsin: kim, qachon, qaysi yacheykalarni sanadi va **farq qancha** —
hozir avto-Оприходование/Списание jimgina yoziladi va keyin uni hech kim tushuntira olmaydi.
Bu jonlidagi «Ombor 02 yacheykalarida 361 885 soxta son» muammosining bevosita davosi.

**Doira (server + web + ilova — KATTA).** Bu faza boshlanishidan oldin agent **egasidan qamrovni
tasdiqlatadi**; ehtimol o'zining alohida rejasiga ajratiladi.

**Eskiz.** `CountSession` (kim/qachon/qaysi ombor), unga bog'langan qatorlar (yacheyka, tovar, tizim
soni, sanalgan son, farq, yozilgan hujjat), TSD'da «sessiyani boshlash/yopish», web'da farqlar
hisoboti va «tasdiqlash» oqimi. Mavjud `setCellStock` avto-hujjatlari **saqlanadi** — sessiya ularning
ustiga izoh qatlami bo'ladi (qoldiq mantig'i o'zgarmasin).

**Qabul mezoni (dastlabki).** Migratsiya idempotent; mavjud sanash yo'li sessiyasiz ham ishlashda
davom etadi (orqaga moslik); farqlar hisoboti raqamlari `stock_by_cell` bilan mos.

<details><summary><b>T11 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` (§1.3, §2, §4-T11, §5), F-rejadagi
   inventarizatsiya qoidasini («faqat yacheyka kesimi») va `docs/ops/jonli-holat.md` ni o'qi.
2) Sen FAQAT **T11 — Inventarizatsiya sessiyasi va farqlar hisoboti** fazasini bajarasan.
3) 🔴 AVVAL EGASIDAN QAMROVNI TASDIQLAT (savollar: sessiyani kim ochadi/yopadi; farqni kim
   tasdiqlaydi; mavjud avto-hujjatlar saqlanadimi). Tasdiqsiz kod yozma — bu faza jonli
   qoldiq mantig'iga tegadi.
4) Ish katta bo'lsa uni ALOHIDA rejaga ajratib, shu yerga havola qoldir.
5) Tugagach §5 ga «### T11 — …» hisobotini yoz. KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

## 5. Hisobotlar

> Har faza agenti O'Z sarlavhasi ostiga yozadi. Shablon:
>
> ```
> ### T<N> — <nom> · <HOLAT: TUGADI | QISMAN — nima kutilmoqda> · <sana> · `<commit>`
>
> **Nima qilindi:** (fayllar bo'yicha, qaror sabablari bilan)
> **O'lchandi:** (build/test natijalari RAQAM bilan)
> **Qabul mezoni:** har band ✔/✘
> **Qaysi oqimni buzishi mumkin?** (qoida 8 — dalil bilan)
> **Ochiq qolganlar / keyingi fazaga eslatmalar:**
> ```

### T0 — Reja tuzildi · 2026-09-03

Reja shu sessiyada tuzildi. Kontekst koddan **o'qib** o'lchandi (taxmin emas):
`CountScreen.kt`, `PlaceScreen.kt`, `ScanBar.kt`, `ApiClient.kt`, `HomeScreen.kt`, `TaskDetailScreen.kt`,
`ScanInfoScreen.kt`, `tsd-policy.ts`, `tsd-scan.ts`, `tsd.service.ts`, `store.controller.ts`,
`store-address.service.ts`, U-reja va G-reja hisobotlari.

**Sessiyaning asosiy topilmasi:** `lookupCellByBarcode` javobi **`{ cells, products, stock }`** —
ya'ni yacheykaga biriktirilgan tovarlar ro'yxati serverdan **allaqachon kelayapti**, `CountScreen` esa
uni o'qimaydi. Shuning uchun T1 fazasi serverga umuman tegmaydi va eng arzon fazadir.

**Ikkinchi topilma:** `ScanBar` ning 350 ms avto-yuborishi qo'lda kiritishni **imkonsiz** qiladi —
rasmdagi holatda omborchining oxirgi zaxira yo'li ham yopiq edi.

**Ochiq qolganlar:** hech bir faza boshlanmagan; `android/tsd-app` da U-rejadan qolgan commit
qilinmagan ish bor (§2, qoida 6).

### T1 — Yacheykaga biriktirilgan tovarlar (Sanash ekrani) · **TUGADI** · 2026-09-03 · `9c7276e8`

**Nima qilindi**

- **`android/tsd-app/app/src/main/java/uz/sherset/tsd/CountScreen.kt`** (+87 / −3)
  - Yangi state `bound` (`JSONArray`) — `openCell` da `resp.optJSONArray("products")` dan to'ldiriladi.
    Bu maydon `cellByBarcode` javobida **allaqachon kelardi**, ekran esa uni o'qimasdan tashlab yuborardi;
    shuning uchun **qo'shimcha so'rov ham, server o'zgarishi ham qo'shilmadi**.
  - Yangi yordamchi `boundOnly(): List<JSONObject>` — `bound` dan `stock` (ya'ni `items`) da BO'LMAGANLARINI
    ajratadi. Ikki guruhda bir tovar ikki marta chizilmaydi (aks holda ikki maydon bitta tovarga ikki xil
    son berardi — bu `picked` kartasidagi mavjud qoidaning aynan o'zi). Arxivlanganlar `sortedBy` bilan
    oxiriga suriladi; `sortedBy` **barqaror**, shuning uchun serverning `name` bo'yicha tartibi guruh
    ichida saqlanadi.
  - Ekran endi **ikki guruh** chizadi: (a) qoldig'i bor qatorlar — **o'zgarmagan** (sanoq maydoni + Saqlash);
    (b) `boundOnly()` qatorlari — kulrang (`Palette.SurfaceMuted`) karta, matni «biriktirilgan · qoldiq 0»,
    arxivlangani bo'lsa ostiga «⚠ arxivlangan». Bosilganda **mavjud `pick(name, id)`** ishlaydi, ya'ni
    yuqoridagi «sanalayotgan tovar» kartasi ochiladi — yangi sanoq yo'li YARATILMADI.
  - Ikkinchi guruhda **sanoq maydoni ATAYLAB yo'q**: qoldig'i 0 tovar sanalsa server avto-Оприходование
    yozadi, shuning uchun u faqat sariq ogohlantirishli `PickedCard` orqali o'tishi kerak.
  - `count_empty` («Yacheyka bo'sh») endi **faqat ikkala guruh ham bo'sh** bo'lganda chiqadi — aks holda
    ekran o'zi ko'rsatib turgan ro'yxatni «yo'q» deb aytardi.
  - Sarlavha-kartaga «**Qoldiqda N · biriktirilgan M**» hisobi. `N + M` — aynan quyida chiziladigan
    qatorlar soni, ya'ni omborchi ro'yxat tugaganini ko'radi.
  - Sinf KDoc'iga T1 bandi qo'shildi (fayl uslubiga mos: nima, nega, qanday).
- **`app/src/main/res/values/strings.xml`** (+4): `count_summary` (`Qoldiqda %1$d · biriktirilgan %2$d`),
  `count_bound_zero`, `count_archived`. Faqat `uz`.
- **`README.md`** (+9 / −1): G6 «Qo'lda smoke» ro'yxatiga **8-band (T1)** — bo'sh yacheyka ochilganda
  biriktirilgan tovar ko'rinishi va uni sanash zanjiri; eski «Narx tekshiruvi» bandi 9 ga surildi.

**Git (§2, qoida 6 bo'yicha)**

T1 boshlanganda `android/tsd-app` da **U-reja ishi commit qilinmagan** edi va T1 aynan o'sha fayllarning
uchtasiga tegadi (`CountScreen.kt`, `strings.xml`, `README.md`), ya'ni fayl darajasida ajratib bo'lmasdi.
Shuning uchun:

1. T1 hunklari skript bilan **vaqtincha orqaga qaytarildi**; skriptning to'g'riligi **aylanma tekshiruv**
   bilan isbotlandi (orqaga → oldinga qo'yilgach uchala fayl `cmp` bo'yicha **bayt-bayt** bir xil chiqdi);
2. `12613600` — `feat(tsd): u-reja zamonaviy ui ishi (commit qilinmagan holat qamrab olindi)`:
   **faqat** `android/tsd-app` + `docs/plans/2026-09-01-tsd-zamonaviy-ui.md`, T1 o'zgarishlarisiz;
3. T1 qayta qo'yildi va `9c7276e8` bilan **uchta fayl** commit qilindi (+ `docs/progress.json` — uni
   loyihaning **o'z `pre-commit` hook'i** avtomatik `git add` qiladi, begona ish emas).

`apps/api` va `android/manager-app` dagi commit qilinmagan ish (menejer-planshet rejasi) **ATAYLAB
tegilmadi** — u boshqa rejaga tegishli va hamon commit qilinmagan turibdi.

**O'lchandi**

| Nima | Buyruq | Natija |
|---|---|---|
| Build | `gradle --no-daemon clean assembleDebug` (Gradle 8.7, JDK 17) | **BUILD SUCCESSFUL in 1m** · **36 task, 35 bajarildi** · `w:` / `warning` / `e:` qatorlari — **0 ta** |
| Server testlari | — | **yugurtirilmadi, chunki server fayllariga tegilmagan** (`git show --stat 9c7276e8` — `apps/` yo'q) |

Ogohlantirishsizlik toza build'da (`clean` bilan) o'lchandi, ya'ni `UP-TO-DATE` task'lar natijani yashirmadi.

**Qabul mezoni**

| Band | Holat | Dalil |
|---|---|---|
| `assembleDebug` ogohlantirishsiz | ✔ | toza build, 35 task bajarildi, log'da bitta ham `w:` yo'q |
| Bo'sh (lekin biriktirilgan tovari bor) yacheykada ro'yxat chiqadi va tanlash ishlaydi — **kodda ko'rsatilsin** | ✔ | `openCell` → `bound = resp.optJSONArray("products")`; `Content()` → `val extras = boundOnly()`; `for (b in extras) { SectionCard(modifier = Modifier.clickable { pick(...) }) }`; `count_empty` sharti endi `items.length() == 0 && extras.isEmpty()`. Jonli qurilmada sinov — **T8** |
| Yangi tarmoq so'rovi qo'shilmagani aytilsin | ✔ | `CountScreen` dagi `shell.api.*` chaqiruvlari **avvalgidek 4 ta**: `scan`, `cellByBarcode`, `setCellStock`, `cellStock`. `ApiClient.kt` diffda **umuman yo'q** |
| Server fayllariga bitta bayt ham tegilmagan | ✔ | `9c7276e8` fayllari: 3 ta `android/tsd-app` fayli + hook yozgan `docs/progress.json`. `apps/`, `packages/`, `prisma/` — **yo'q** |

**Narx qoidasi (§2, qoida 3)**

Yangi server maydoni qo'shilmadi, allowlist'ga tegilmadi. Ko'rsatilayotgan `products` massivining
**yozma isboti**: `store-address.service.ts: getCellProducts` → `select: { id, name, code, barcodes,
archived }`, javob `map` i esa `{ id, name, code, barcode, archived }`. `buyPrice`/`salePrice`/`sum`
maydonlari **so'ralmaydi ham, qaytarilmaydi ham** — «ekranda ko'rsatmayapmiz» degan zaif dalilga
tayanilmadi. Ekranda ham faqat `name` chiziladi.

**Qaysi oqimni buzishi mumkin? (§2, qoida 8)**

- **Sanash semantikasi** — buzilmadi. `save()` ga **umuman tegilmadi**: hamon `setCellStock(..., qty)`,
  ya'ni `mode: 'set'` (mutlaq son). Ikkinchi guruh qatorining o'zida sonni saqlash tugmasi yo'q — u
  faqat `pick()` ni chaqiradi.
- **Oflayn navbat** — buzilmadi. Sanash ilgarigidek navbatga QO'YILMAYDI; `ActionQueue`/`QueueSender`
  fayllariga tegilmadi (§2, qoida 10).
- **Multi-hit'da tanlovni odam qiladi** — buzilmadi. `onScan` ning `"product"` shoxi o'zgarmadi
  (`0 → toast`, `1 → pick`, `else → PickProductScreen`). Yangi ro'yxat ham **hech qachon o'zi
  tanlamaydi** — har qator odamning bosishini kutadi.
- **Sariq «yacheykada yo'q — KIRIM bo'lib yoziladi» ogohlantirishi** — saqlanib qoldi va aynan
  biriktirilgan-lekin-qoldiqsiz tovarga ham tushadi (§4 «Cheklovlar» shuni ataylab talab qilgan):
  `pick()` → `systemQty(id)` `null` qaytaradi → `PickedCard` sariq `WarningContainer` rejimda ochiladi,
  son maydoni BO'SH qoladi.
- **Qoldig'i bor yacheykalar** (eski, keng tarqalgan holat) — ko'rinishi deyarli o'zgarmaydi: `products`
  odatda `stock` ning ichida bo'ladi, `boundOnly()` bo'sh chiqadi va faqat sarlavhadagi
  «Qoldiqda N · biriktirilgan 0» qatori qo'shiladi.
- **`products` kelmasa** (eski server, yoki ko'p yacheyka topilgan holat — u yerda javob
  `products: []`) — `optJSONArray("products") ?: JSONArray()` tufayli ekran **avvalgidek** ishlaydi.
- **Saqlashdan keyin** `save()` faqat `items` ni yangilaydi, `bound` esa turaveradi. Bu to'g'ri: sanoq
  biriktirishni o'zgartirmaydi. Yangi sanalgan tovar `items` ga tushgani uchun `boundOnly()` uni
  avtomatik tashlab yuboradi — qator **ikkinchi guruhdan birinchi guruhga o'tadi**, dublikat bo'lmaydi.

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. **Jonli qurilmada sinalmagan.** Qabul mezoni «kodda ko'rsatilsin» deydi va shu bajarildi; haqiqiy
   iData 95W Pro sinovi — **T8**. README'ga 8-band aynan shu uchun yozildi.
2. **APK chiqarilmadi** (§2, qoida 9): `versionCode`/`versionName` **oshirilmadi** (hamon `0.4.0`/`4`),
   `tools/publish.sh` chaqirilmadi. Egasi «chiqar» degandagina — o'shanda versiya oshiriladi.
3. **Boshi berk ko'chaning ikkinchi yarmi ochiq:** T1 faqat **yacheyka yorlig'i skanerlangan** holatni
   yopadi. Yorliq yirtilgan / skaner o'qimagan bo'lsa yacheykani **qo'lda** kiritishning yo'li hamon
   yo'q — bu **T2** (`ScanBar` 350 ms avto-yuborishi).
4. **Yacheykaga biriktirilmagan va qoldig'i ham yo'q tovar** hamon ro'yxatda ko'rinmaydi — uni topish
   uchun nom/artikul qidiruvi kerak, ya'ni **T3**.
5. **`bound` ro'yxati saralanishi:** server `name` bo'yicha beradi, arxivlanganlar pastga suriladi.
   Agar biriktirilgan tovar juda ko'p bo'lsa (o'nlab), 4" ekranda skroll uzayadi — o'lchanmagan;
   kerak bo'lsa keyingi fazada «faqat birinchi 10 tasi + qidiruv» ko'rib chiqilsin (T3 bilan birga
   qilingani ma'qul, alohida emas).
6. **`docs/progress.json`** T1 commitiga loyihaning `pre-commit` hook'i tomonidan qo'shildi — keyingi
   faza agenti buni «begona fayl» deb o'ylab olib tashlamasin.
7. **`apps/api` + `android/manager-app` hamon commit qilinmagan** (menejer-planshet rejasi). Keyingi
   T-faza agenti ham ularni **o'z commitiga qo'shmasin**.

### T2 — Qo'lda kiritish (`ScanBar` 350 ms tuzog'i) · **TUGADI** · 2026-09-03 · `da2d7daa`

**Nima qilindi**

- **`android/tsd-app/app/src/main/java/uz/sherset/tsd/ScanBar.kt`** (+130 / −8)
  - Yangi `private class TypingWatch(humanGapMs)` — belgilar orasidagi intervallarni yig'adi va
    **o'rtacha** qiymat bo'yicha «skaner / odam» qarorini beradi:
    `isHuman = edited || (gaps > 0 && averageGapMs >= humanGapMs)`.
    - **`edited`** — matn qisqarsa (backspace) darhol «odam». Skaner hech qachon tahrir qilmaydi,
      shuning uchun bu eng ishonchli bitta signal.
    - **Birinchi belgining intervali hisoblanmaydi** (`lastAt == 0L`) — undan oldin belgi yo'q,
      aks holda «maydon ochilgandan beri o'tgan vaqt» interval deb o'lchanardi va HAR kiritish
      «odam» chiqardi.
    - Bitta `onValueChange` da bir nechta belgi kelsa (skaner burst'i yoki qo'yish), o'lchangan
      interval o'sha belgilar soniga **bo'linadi** (`gaps += added`) — koalesatsiya skanerni
      sun'iy «sekin» qilib ko'rsatmasin.
  - `submit()` endi `reset()` orqali `value`, `TypingWatch` va `human` ni **birga** tozalaydi —
    keyingi kiritish o'lchovi oldingisining qoldig'i bilan aralashmasin.
  - Avto-yuborish shoxi: `LaunchedEffect(value, human) { if (!human && length >= 3) { delay(350); submit() } }`.
    `human` **kalitga qo'shildi**, shuning uchun odam yozayotgani aniqlangan zahoti kutayotgan
    korutina bekor bo'ladi va qayta boshlanmaydi. **350 ms ham, 3 belgi ham, `delay`+`submit`
    zanjiri ham o'zgarmadi** — zaxira o'chirilmadi, faqat chetlab o'tildi (§4 «Cheklovlar»).
  - `trailingIcon`: `human == true` bo'lgandagina **⏎** tugmasi (`IconButton` + `Palette.Accent`),
    `contentDescription` bilan. Bu ham rejim belgisi («endi o'zi yuborilmaydi»), ham bosiladigan
    tugma — omborchi ekran klaviaturasidan tasdiq tugmasini qidirmasin.
  - `keyboardActions` ga `onGo`/`onSearch` qo'shildi (`onDone` turibdi): ekran klaviaturasining
    tasdiq tugmasi qurilma/IME ga qarab uchtasidan biri bo'lib chiqadi. `imeAction` **o'zgartirilmadi**
    (`Done`) — uni yozish o'rtasida almashtirish IME ni qayta ishga tushiradi va terilayotgan matnni
    uzishi mumkin.
  - Sinf KDoc'iga T2 bandi va «nega `onValueChange`» dalili yozildi.
- **`app/src/main/res/values/config.xml`** (+19): `<integer name="scan_human_gap_ms">50</integer>` —
  chegara **resursda**, kodda emas (§4 T2 vazifa 1: qurilma almashsa kod o'zgarmasin). Izohda
  ikkala shox va sozlash yo'li yozilgan.
- **`app/src/main/java/uz/sherset/tsd/Diagnostics.kt`** (+37 / −4): yangi `lastInput` (Compose state,
  `private set`) va `input(human, length, avgGapMs)`. Jurnalga yangi `IN` turi qo'shildi.
  🔴 **Kodning O'ZI yozilmaydi** — faqat manba, uzunlik va o'lchov (§2, qoida 11; jurnalning vazifasi
  kodni emas, MANBANI ko'rsatish). `clear()` endi `lastInput` ni ham tozalaydi.
- **`app/src/main/java/uz/sherset/tsd/DiagnosticsScreen.kt`** (+25): «Oxirgi kiritish (skan maydoni)»
  kartasi — manba + o'lchangan o'rtacha interval + sozlash izohi.
- **`app/src/main/res/values/strings.xml`** (+8): `scan_submit`, `diag_input`, `diag_input_none`,
  `diag_input_help`. Faqat `uz`.
- **`README.md`** (+35 / −1): «Skaner» bo'limiga **«Qo'lda kiritish va manba ajratish (T2)»** kichik
  bo'limi (jadval bilan: qaysi interval → qaysi xulq, chegara qayerda, nega `onValueChange`,
  jonlida qanday sozlanadi); «Qo'lda smoke» ro'yxatiga **9-band (T2)**, eski «Narx tekshiruvi» 10 ga surildi.

**Chegara qiymati va u qayerdan o'qiladi**

`res/values/config.xml` → `<integer name="scan_human_gap_ms">50</integer>`, kodda
`integerResource(R.integer.scan_human_gap_ms)` orqali (`ScanBar.kt`). **50 ms** tanlandi: wedge skaner
belgilarni odatda 5–30 ms oralig'ida «yozadi», odam esa ekran klaviaturasida 120 ms dan tez tera
olmaydi — oraliq keng. Jonlida sozlash **USB'siz**: Diagnostika ekranidagi «Oxirgi kiritish» qatori
skanerning HAQIQIY o'rtacha intervalini raqam bilan ko'rsatadi, chegara o'sha raqamdan yuqori qilinadi.

**O'lchandi**

| Nima | Buyruq | Natija |
|---|---|---|
| Build | `gradle --no-daemon clean assembleDebug` (Gradle 8.7, JDK 17) | **BUILD SUCCESSFUL in 1m 6s** · **36 task, 35 bajarildi** |
| Ogohlantirish | o'sha buyruq, `grep -c -E "^w:\|warning\|^e:"` | **0 ta** (toza build'da o'lchandi — `UP-TO-DATE` task natijani yashirmadi) |
| Server testlari | — | **yugurtirilmadi: server fayllariga tegilmagan** (`git show --stat da2d7daa` da `apps/` yo'q) |

**Qabul mezoni**

| Band | Holat | Dalil |
|---|---|---|
| `assembleDebug` ogohlantirishsiz | ✔ | toza build, 35 task, `w:`/`warning`/`e:` — 0 qator |
| Sekin yozilgan 11 belgili kod **bir marta va to'liq** yuboriladi | ✔ | 2-belgidayoq `onChange` bitta gap yozadi (odam uchun ≥120 ms) → `human = true`; `LaunchedEffect(value, human)` kaliti o'zgarib kutayotgan korutina bekor bo'ladi va `!human` shartida qayta boshlanmaydi ⇒ 3-belgida avto-yuborish YO'Q. Kod ⏎/Enter bosilganda **bir marta** `submit()` ga tushadi, `reset()` maydonni darhol bo'shatadi ⇒ takror yuborilmaydi |
| Tez «yozilgan» (skaner) kod avvalgidek 350 ms da yuboriladi | ✔ | o'rtacha 5–30 ms < 50 ⇒ `isHuman = false` ⇒ shart `!human && length >= 3` bajariladi va **o'zgarmagan** `delay(350); submit()` ishlaydi |
| ENT bilan yuborish ishlaydi va maydon tozalanadi | ✔ | `onPreviewKeyEvent` dagi `Key.Enter`/`Key.NumPadEnter` shoxi **tegilmadi**; `submit()` ichida `reset()` birinchi bo'lib chaqiriladi (`code` undan oldin olinadi) |
| Diagnostika ekranida manba ko'rinadi | ✔ | `Diagnostics.input(...)` → `lastInput` → `DiagnosticsScreen` dagi «Oxirgi kiritish» kartasi: «SKANER · 13 belgi · o'rtacha 12 ms» ko'rinishida. Jonli qurilmada sinov — **T8** |

**Narx qoidasi (§2, qoida 3)**

Serverga tegilmadi, allowlist'ga tegilmadi, yangi API chaqiruvi qo'shilmadi (`ApiClient.kt` diffda
umuman yo'q). Narx maydoni bilan aloqasi yo'q.

**Rejadan chekinish (bitta, ochiq aytiladi)**

§4 T2 vazifa 1 «`onPreviewKeyEvent` da oxirgi belgi vaqti» deydi. Amalda o'lchov **`onValueChange`**
da olindi. Sabab — dalil bilan: **ekran klaviaturasi (IME) matnni `InputConnection` orqali qo'yadi va
bitta ham `KeyEvent` yubormaydi**. Omborchi kodni aynan ekran klaviaturasida yozadi, ya'ni tugma
hodisalariga qarab o'lchansa `gaps == 0` bo'lib qolardi → `isHuman = false` → 3-belgidan keyin yana
yarim kod yuborilardi, ya'ni **T2 tuzatayotgan xatoning o'zi qaytardi**. `onValueChange` esa uchala
yo'lni ham bir xil ko'radi (ekran klaviaturasi, apparat klaviatura, wedge skaner — ularning hammasi
matnni o'zgartiradi). Maqsad — «interval o'lchash» — o'zgarmadi, faqat o'lchov nuqtasi ishonchlirog'iga
ko'chdi.

**Fokus intizomi (§4 T2 vazifa 3 — T3 uchun yozib qoldiriladi)**

- `ScanBar` fokusni **faqat** `LaunchedEffect(screenKey)` da so'raydi, ya'ni **ekran almashgandagina**.
  T2 da bu shoxga **tegilmadi** va yangi `requestFocus()` qo'shilmadi.
- Demak ekran ichida boshqa maydon (Sanashdagi `NumberField`, T3 dagi qidiruv maydoni) fokus olsa,
  `ScanBar` uni **tortib olmaydi** — `screenKey` o'zgarmagani uchun effekt qayta ishlamaydi.
- 🔴 **T3 uchun teskari tomoni:** fokus boshqa maydonda turganda **wedge skaner o'sha maydonga yozadi**
  (masalan qidiruv maydoniga yacheyka kodi tushadi). Bu T2 dan oldin ham shunday edi va T2 uni
  o'zgartirmadi. T3 da qidiruv maydoni qo'shilganda ikkitadan biri tanlansin: (a) qidiruv maydoni
  ham `TypingWatch` mantig'ini ishlatsin (unda skaner kodi ham qidiruvga tushib, natija chiqadi —
  zarari yo'q), yoki (b) qidiruv yopilganda fokus `ScanBar` ga QAYTARILSIN. Hozircha hech biri
  qilinmadi — bu T3 ning qarori.
- `key(screen) { screen.Content() }` (MainActivity) tufayli ekran almashganda `ScanBar` ning ichki
  `remember` holati (`value`, `human`, `TypingWatch`) saqlanadi — `ScanBar` `key` blokidan TASHQARIDA.
  Bu to'g'ri: yarim yozilgan kod ekran o'zgarganda yo'qolmaydi. Lekin `human` ham saqlanadi, ya'ni
  odam yozib tugatmasdan ekran almashtirsa ⏎ ko'rinib turadi — `submit()` yoki backspace bilan
  maydon bo'shagach o'z-o'zidan yo'qoladi.

**Qaysi oqimni buzishi mumkin? (§2, qoida 8)**

- **Suffikssiz skaner (U5 muammosi)** — buzilmadi. Yagona shart `!human` qo'shildi; skaner uchun
  `human` **hech qachon `true`** bo'lmaydi (o'rtacha 5–30 ms, backspace yo'q). `delay(350)` va 3 belgi
  chegarasi **raqam bilan o'zgarmadi**. Eng yomon holat — g'ayrioddiy SEKIN skaner (o'rtacha ≥50 ms):
  u «odam» deb tanilib avto-yuborishni yo'qotadi, LEKIN kod maydonda ko'rinib turadi va ⏎ bosiladi
  (ya'ni jim yo'qolish YO'Q), diagnostika esa aniq raqamni ko'rsatadi va chegara `config.xml` dan
  ko'tariladi — kod qayta yig'ilmasdan.
- **Broadcast rejimi** — umuman tegilmadi. `ScannerBridge.kt` diffda **yo'q**; u `MainActivity` da
  to'g'ridan-to'g'ri `routeScan(code)` chaqiradi, ya'ni `ScanBar` dan, fokusdan va tezlik o'lchovidan
  **mustaqil**. Broadcast kodi `Diagnostics.input` ga ham tushmaydi (u yerda `BCAST` qatori bor).
- **Enter bilan yuborish** — `onPreviewKeyEvent` sharti belgi-ba-belgi o'zgarmadi. Enter kelganda
  `submit()` ishlaydi, `human` qanday bo'lishidan qat'i nazar.
- **Sanash semantikasi, oflayn navbat, multi-hit** — `ScanBar` faqat **matnni** `onCode` ga uzatadi;
  `routeScan` va undan keyingi hech nima o'zgarmadi. `ActionQueue`/`QueueSender`/`ApiClient`/
  `DeviceStore` diffda yo'q (§2, qoida 10).
- **PIN ekrani** — tegilmadi: `ScanBar` faqat `Stage.Work` dagi `WorkRoot` da chiziladi, PIN raqamlari
  `dispatchKeyEvent` orqali boradi va `Diagnostics` u yerda ilgarigidek jim (§ mavjud shart
  `if (stage == Stage.Work)`).
- **Ekranning balandligi** — ⏎ `trailingIcon` sifatida maydonning ICHIDA chiqadi, maydon balandligi
  (`heightIn(min = 56.dp)`) o'zgarmaydi, ya'ni 4" ekranda pastdagi ro'yxat siljimaydi.

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. **Jonli qurilmada sinalmagan** (chegara ham, ⏎ ham). Qabul mezoni «kodda ko'rsatilsin» deydi va
   bajarildi; haqiqiy iData 95W Pro sinovi — **T8**. README'ga 9-band aynan shu uchun yozildi va
   unda skanerning o'lchangan o'rtachasini **yozib olish** talab qilinadi.
2. **Chegara jonli o'lchov bilan tasdiqlanmagan.** 50 ms — sanoatdagi odatiy oraliqdan olingan
   taxmin, jonlida o'lchanmagan. T8 da birinchi ish: skanerlab, diagnostikadagi raqamni o'qish.
   Agar u 50 ga yaqin chiqsa (masalan 35–45), chegarani 2 barobar zaxira bilan qo'yish kerak.
3. **T3 dagi qidiruv maydoni** o'z `TypingWatch` ini ISHLATMAYDI — u alohida `TextField` bo'ladi va
   avto-yuborish u yerda umuman bo'lmasligi kerak (§4 T3 vazifa 8 shuni aytadi). Yuqoridagi «Fokus
   intizomi» bandi T3 uchun ochiq qaror qoldiradi.
4. **APK chiqarilmadi** (§2, qoida 9): `versionCode`/`versionName` **oshirilmadi** (hamon `4`/`0.4.0`),
   `tools/publish.sh` chaqirilmadi.
5. **`docs/progress.json`** T2 commitiga ham `pre-commit` hook'i tomonidan qo'shildi (7 fayl) —
   begona ish emas.
6. **`apps/api` + `android/manager-app` hamon commit qilinmagan** (menejer-planshet rejasi) —
   keyingi T-faza agenti ularni **o'z commitiga qo'shmasin**.
7. **Ovoz/tebranish hamon yo'q** — odam yozib ⏎ bosgach ham javob faqat toast bilan keladi (T4).
### T3 — Nom/artikul bo'yicha qidiruv (`GET /tsd/search`) · **TUGADI** · 2026-09-04 · `1086d253`

**Nima qilindi**

*Server (`apps/api`)*

- **`src/modules/tsd/tsd-search.ts`** (YANGI, 124 qator) — SOF modul (Prisma yo'q, Nest yo'q):
  - `normalizeSearchQuery` — chekka bo'shliqlarni oladi, ichkilarini bittaga siqadi, `SEARCH_MAX_LEN`
    gacha KESADI (rad etmaydi) va **`%` bilan `\` ni olib tashlaydi**. Oxirgisi topilma, taxmin emas:
    Prisma'ning `contains` filtri qiymatni `ILIKE '%' || $1 || '%'` naqshiga qo'yadi va LIKE
    metabelgilarini **ekranlamaydi** — ya'ni omborchi bitta `%` yozsa filtr ma'nosini yo'qotib,
    tasodifiy 30 ta tovar qaytarardi. `_` esa ATAYLAB qoldirildi: u artikullarda haqiqatan uchraydi
    (`KAB_2x1.5`) va bitta belgiga mos kelgani uchun zarari yo'q.
  - `SEARCH_MIN_LEN = 2`, `SEARCH_MAX_LEN = 100`, `SEARCH_TAKE = 30` — uchalasi ham izohda sababi bilan.
  - `searchRank` + `sortSearchHits` — «aynan moslik → boshida moslik → ichida moslik», **arxivlangan
    esa bosqichdan QAT'I NAZAR eng oxirida**. Teng kalitlarda `Array.prototype.sort` barqarorligiga
    tayaniladi, ya'ni serverning `name asc` tartibi guruh ichida saqlanadi (T1 dagi `sortedBy`
    qarorining aynan o'zi). Kirish massivi o'zgartirilmaydi.
- **`src/modules/tsd/tsd.service.ts`** (+129 / −31):
  - 🔴 **`buildProductHits` ajratildi** (reja vazifasi 2 va prompt bandi 4). `scan` ichidagi
    «hit qurish» mantig'i — `Stock`/`StockByCell` so'rovlari va `{id, name, code, article, barcodes,
    uom, archived, homeCell, totalQty, cells}` shakli — endi BITTA private metodda va IKKALA yo'l
    ham shundan foydalanadi. `scan` ning xulqi bunda **zarracha o'zgarmadi** (mavjud 10 ta testi
    tegilmasdan yashil qoldi).
  - `search(accountId, rawQuery)` — `where: { accountId, deletedAt: null, OR: [name contains
    insensitive, article contains, code contains, barcodes has] }`, `select: TSD_PRODUCT_SELECT`,
    `take: 30`, `orderBy: [{archived: 'asc'}, {name: 'asc'}]`.
    - `orderBy` reja matnida yo'q edi, lekin **kerak**: `take` DB tomonda kesadi, tartibsiz `take`
      esa har so'rovda BOSHQA 30 tani olib kelardi. Nozik saralash (bosqichlar) xotirada, kesilgan
      to'plam ustida.
    - Javob: `{ query, products, truncated }`. `truncated` — ro'yxat kesilganini AYTADI; jim kesish
      omborchini «bazada boshqa yo'q» deb adashtirardi (IS-5 klassi).
    - 🔴 `pickExactHits` bu yerda **ataylab chaqirilmaydi**: u skanerlangan token uchun («aynan mos
      kelgan shtrix ustun»), qidiruv so'rovi esa ataylab noaniq. Multi-hit qoidasi kuchda — bitta
      natija qaytganda ham ro'yxat qaytadi, tanlovni ODAM qiladi.
  - `TsdSearchQuerySchema` — xom `q` uchun `max(1000)`. Ikki chegara ikki xil vazifada: `1000` —
    mudofaa (uzun matn umuman qabul qilinmasin), `SEARCH_MAX_LEN = 100` — ma'noli chegara va u rad
    ETMAYDI, KESADI (omborchi tasodifan uzun matn qo'ysa ishi uzilmasin).
  - `TsdProductRow` interfeysi — `buildProductHits` kirishi; **narx maydoni turda ham yo'q**, ya'ni
    kimdir `select` ga narx ustuni qo'shsa TypeScript uni bu turdan o'tkazmaydi.
- **`src/modules/tsd/tsd.controller.ts`** (+20 / −5): `@Get('search')` +
  `@RequirePermission({ entity: 'product', action: 'view' })` — `scan` bilan AYNI ruxsat.
- **`src/modules/auth/tsd-policy.ts`** (+13 / −2):
  `{ prefix: '/tsd/search', methods: ['GET'], exact: true, why: 'narxsiz nom-qidiruv' }`.
  Alohida qator, chunki `/tsd/scan` **`exact`** va uning ostiga yangi yo'l qo'shib bo'lmaydi
  (bu ataylab — `exact` yangi sub-yo'l jimgina ochilishining oldini oladi).

*Ilova (`android/tsd-app`)*

- **`SearchScreen.kt`** (YANGI, 148 qator): `PlainField` + «Qidirish» tugmasi, `busy` holati,
  «Topilmadi», `truncated` ogohlantirishi, natijalar `ProductHitCard` bilan. Xato yo'lida `busy`
  ALBATTA tushiriladi (aks holda ekran «Qidirilmoqda…» da qotib qolardi). **Avto-yuborish YO'Q** —
  T2 qoidasi: so'rov faqat tugma yoki klaviaturaning tasdiq tugmasi bilan ketadi.
- **`Widgets.kt`** (+63): 🔴 **`ProductHitCard` — YAGONA renderer** (prompt bandi 4 ning ilova
  tomoni). Nom, artikul (yangi), arxiv belgisi (yangi), «qayerda» (birinchi yacheyka, bo'lmasa
  uy-yacheykasi TAVSIYA sifatida — `ScanInfoScreen` dagi mavjud qoida) va jami qoldiq.
- **`PickProductScreen.kt`** (+7 / −18): o'z chizuvchisi va `whereText` i olib tashlanib
  `ProductHitCard` ga o'tdi. Xulq o'zgarmadi, ustiga **artikul va arxiv belgisi qo'shildi** —
  multi-hit tanlovida aynan ular ikki o'xshash tovarni ajratadi.
- **`ApiClient.kt`** (+17 / −1): `fun search(q: String): JSONObject`.
- **`CountScreen.kt`** (+18): yacheyka OCHIQ bo'lgandagina «🔍 Tovar qidirish» tugmasi → mavjud
  `pick()` ga tushadi (yangi sanoq yo'li yaratilmadi).
- **`PlaceScreen.kt`** (+12): 1-bosqichda «🔍 Tovar qidirish» → `product` ga tushadi, oqim
  odatdagidek 2-bosqichga o'tadi.
- **`HomeScreen.kt`** (+38): beshinchi plitka «🔍 Tovar qidirish» → natija bosilsa NARXSIZ
  `ScanInfoScreen`. Qidiruv elementi skan javobi bilan AYNI shaklda bo'lgani uchun uni
  `{kind: 'product', products: [p]}` ga o'rash yetdi — **yangi tarmoq so'rovi yo'q**.
- **`strings.xml`** (+12, faqat `uz`), **`README.md`** (+27 / −4): «Backend kontrakti» jadvaliga
  `/tsd/search` qatori, «Nega narx yo'q» ga T3 bandi, G6 smoke ro'yxatiga **10-band (T3)**
  (eski «Narx tekshiruvi» 11 ga surildi va unga `curl` tekshiruvi qo'shildi), fayl xaritasi.

**Yangi testlar — 35 ta**

| Fayl | Yangi testlar | Nima qulflanadi |
|---|---|---|
| `tsd-search.test.ts` (YANGI) | **18** | normalizatsiya (`%`/`\` olinishi, `_` qolishi, kesish), chegaralar, `searchRank` bosqichlari, arxiv ustunligi, barqarorlik, kirishga tegmaslik |
| `tsd.service.test.ts` | **15** | oq ro'yxat, narxsiz javob, `OR` tarkibi, tenant, `take`+`orderBy`, tozalash, uzun so'rov, qisqa so'rov 400 (**va DB ga umuman bormasligi**), bo'sh natija (qoldiq so'rovlari ketmasligi), arxiv oxirida, `truncated`, multi-hit, **shakl `/tsd/scan` bilan AYNI** |
| `tsd-policy.test.ts` | **2** | `/tsd/search` GET ochiq · `exact` · POST/PUT/DELETE yopiq · segment chegarasi; **`/products` HAMON YOPIQ** (`?search=` bilan ham) |

**O'lchandi**

| Nima | Buyruq | Natija |
|---|---|---|
| API testlari | `npx vitest run src/modules/tsd src/modules/auth/tsd-policy.test.ts` | **4 fayl · 79 test · 79 yashil · 0 qizil** (1.62s) |
| Typecheck | `pnpm --filter @moysklad/api typecheck` | **0 xato** (exit 0) |
| Biome | `npx biome check` (+ pre-commit hook) | toza |
| Ilova build | `gradle --no-daemon clean assembleDebug` (Gradle 8.7, JDK 17) | **BUILD SUCCESSFUL in 46s** · **36 task, 35 bajarildi** |
| Ogohlantirish | o'sha buyruq, `grep -c -E "^w:\|warning\|^e:"` | **0 ta** (toza `clean` build'da o'lchandi) |

**Qidiruv tezligi — JONLI bazada o'lchandi (FAQAT O'QISH)**

Lokal dev bazasi yo'q (`psql`/`docker` mashinada yo'q), shuning uchun o'lchov jonli VPS'da
(`13.140.157.10`, baza `sherset_v2`) `EXPLAIN (ANALYZE, BUFFERS)` bilan qilindi. **Hech nima
o'zgartirilmagan** — faqat `SELECT`/`EXPLAIN` (§2 qoida 12: jonliga skript YOZILMADI).

- Hajm: **4 635 tirik + 399 arxivlangan tovar** (`deleted_at IS NULL`).
- `TsdService.search` ning aynan so'rovi (`name/article/code ILIKE '%q%' OR barcodes @> ...`,
  `ORDER BY archived, name LIMIT 30`):

| So'rov | Execution Time | Qaytdi |
|---|---|---|
| `kabel` (sovuq) | **13.30 ms** | 30 (54 mos keldi) |
| `kabel` (takror) | **12.36 ms** | 30 |
| `uz` (2 belgi — eng yomon holat) | **13.06 ms** | 30 |
| `shlang` | **12.85 ms** | 30 |

- Reja plani: `Seq Scan on products` (5 139 qator) → `Sort` → `Limit`, `Buffers: shared hit=561`
  (diskka bormaydi), planning 4.7 ms.
- **`pg_trgm` migratsiyasi KERAK EMAS va yozilmadi** — reja shuni ochiq qoldirgan edi. Ikki sabab:
  1. **Indeks ALLAQACHON bor:** `products_name_trgm_idx` (GIN `gin_trgm_ops`), migratsiya
     `20260723150000_trgm_search_indexes` da; `products_barcodes_gin_idx` ham bor.
  2. Planner shu hajmda uni **ATAYLAB ishlatmaydi**: 5 ming qatorda to'rt shoxli `OR` uchun to'liq
     ko'rib chiqish bitmap-OR dan arzon. 13 ms — omborchi uchun sezilmaydigan vaqt (Germaniya↔UZ
     tarmoq kechikishi ~90–120 ms, ya'ni so'rovning o'zi umumiy vaqtning **~10%** i ham emas).
  Tovarlar soni bir necha o'n mingga chiqsa planner o'zi indeksga o'tadi — kod o'zgarmaydi.

**Narx qoidasi (§2, qoida 3) — YOZMA ISBOT**

1. **`select` oq ro'yxati kengaytirilmadi.** `TSD_PRODUCT_SELECT` diffda **umuman yo'q**
   (`git show 1086d253 -- apps/api/src/modules/tsd/tsd-scan.ts` → bo'sh). Qidiruv aynan shu
   obyektni ishlatadi.
2. **Javob shakli umumiy.** `search` o'zining javob quruvchisiga EGA EMAS — u `buildProductHits`
   ga boradi, ya'ni unga narx maydonini qo'shib yuborish uchun `scan` ni ham buzish kerak bo'lardi
   va buni ikkita mavjud test darhol ushlardi.
3. **Qo'shimcha so'rovlar narxsiz jadvallarga:** `Stock` (`assortmentId, qty`) va `StockByCell`
   (`assortmentId, storeId, cellId, qty, store.name, cell.name`) — bu jadvallarda narx ustuni
   **umuman yo'q**.
4. **Test qulflari:** `tsd.service.test.ts` — `select` da `price|cost|margin` yo'qligi + javobning
   `JSON.stringify` i `price|cost|margin|narx` ga mos kelmasligi; `tsd-policy.test.ts` — yangi
   `«🔴 T3 — nom-qidiruv qo'shilgach ham /products YOPIQ QOLDI»` testi `/products` va
   `/api/v1/products?search=kabel` uchun `false` ni qulflaydi.
5. «Ekranda ko'rsatmayapmiz» degan zaif dalilga **tayanilmadi** — yuqoridagi to'rttasi ham
   ekrandan mustaqil.

**Qabul mezoni**

| Band | Holat | Dalil |
|---|---|---|
| api testlari yashil, yangi testlar soni raqam bilan | ✔ | **79/79 yashil**, yangi **35** ta (18 + 15 + 2 — yuqoridagi jadval) |
| `tsd-policy.test.ts` da `/products` hamon 403 ekani qulflangan | ✔ | yangi test: `/products`, `/api/v1/products?search=kabel`, `?limit=1&search=k` → `false`; `/tsd/search` → `true` |
| `pnpm --filter @moysklad/api typecheck` 0 xato | ✔ | exit 0, chiqishda bitta ham `error TS` yo'q |
| `assembleDebug` ogohlantirishsiz | ✔ | toza build, 35 task, `w:`/`warning`/`e:` — **0 qator** |
| Javob shakli `/tsd/scan` bilan bir xilligi test bilan qulflangan | ✔ | `«T3 qabul mezoni — javob SHAKLI /tsd/scan bilan AYNI»`: `Object.keys(...).sort()` tengligi **va** `expect(b).toEqual(a)` |
| O'lchangan qidiruv vaqti hisobotda | ✔ | jonli `sherset_v2`, 5 034 tovar, **12.4–13.3 ms** (yuqoridagi jadval) |

**Rejadan chekinishlar (ikkita, ochiq aytiladi)**

1. **`ApiClient.search` `JSONObject` qaytaradi, `JSONArray` emas** (reja vazifa 7 `JSONArray` degan).
   Sabab: javobdagi `truncated` bayrog'i ilovaga YETIB BORISHI kerak. `JSONArray` qaytarilsa u
   yo'qolardi va omborchi 30 tadan ko'p mos kelgan holatda «bazada boshqa yo'q» deb o'ylab, bor
   tovarni qaytadan kiritib yuborardi — bu aynan IS-5 (jim yo'qotish) klassi. Ekran `products` ni
   baribir bitta qatorda oladi (`resp.optJSONArray("products")`).
2. **`PickProductScreen` ning chizish qismi o'zgardi** (o'z kartasi → `ProductHitCard`). Bu «yo'l-yo'lakay
   tuzatish» emas, prompt bandi 4 ning to'g'ridan-to'g'ri talabi («ilovada bitta renderer»): ikkita
   chizuvchi qolsa server tomonda shakl birlashtirilgani ma'nosini yo'qotardi. Tanlash mantig'iga
   (`onPicked`, multi-hit qoidasi) tegilmadi.

**Qaysi oqimni buzishi mumkin? (§2, qoida 8)**

- **`/tsd/scan` (butun skan oqimi)** — buzilmadi va bu **o'lchangan**: `scan` ning mavjud **10 ta
  testi bitta ham o'zgartirilmasdan** yashil qoldi (`tsd-scan.test.ts` ham tegilmadi, 12/12).
  Refaktoring faqat kodni KO'CHIRDI: `where`, `take: 20`, `pickExactHits`, `kind` shoxlari
  (`piece`/`cell`/`none`/`product`) va javob maydonlari — hammasi bayt-baytga aynan o'sha.
- **Sanash semantikasi** — buzilmadi. `CountScreen.save()` ga **umuman tegilmadi**: hamon
  `setCellStock(..., qty)`, ya'ni `mode: 'set'` (mutlaq son). Qidiruv natijasi mavjud `pick()` ga
  tushadi, ya'ni **sariq «yacheykada yo'q — KIRIM bo'lib yoziladi» ogohlantirishi ishlashda davom
  etadi** (`systemQty(id)` `null` qaytaradi → `PickedCard` `WarningContainer` rejimda ochiladi).
- **Oflayn navbat** — buzilmadi. `ActionQueue`/`QueueSender`/`DeviceStore`/`ScannerBridge` diffda
  **umuman yo'q** (§2, qoida 10). `ApiClient` ga faqat bitta yangi metod qo'shildi, transport
  qismiga (cookie idorasi, `exec`, 401-refresh) **tegilmadi**.
- **Multi-hit'da tanlovni odam qiladi** — buzilmadi va **kuchaytirildi**: qidiruv bitta natija
  qaytarganda ham ro'yxat ko'rsatiladi (`pickExactHits` ataylab chaqirilmaydi), ya'ni ilova bu
  yo'lda hech qachon o'zi tanlamaydi. `PickProductScreen` ning tanlash mantig'i o'zgarmadi.
- **Fokus intizomi (T2 ochiq qoldirgan qaror — javob shu)** — T2 hisoboti ikkita variantdan birini
  tanlashni so'ragan edi. Tanlov: **(a)**, ya'ni maxsus hech nima qilinmaydi, va sabab o'lchangan:
  - `SearchScreen` ochilganda `screenKey` o'zgaradi ⇒ `ScanBar` fokusni oladi (odatdagidek);
  - omborchi qidiruv maydoniga tegsa fokus u yerga o'tadi va `ScanBar` uni **ORQAGA TORTMAYDI**
    (`LaunchedEffect(screenKey)` qayta ishlamaydi — T2 da shu ataylab qoldirilgan);
  - shu holatda skanerlansa kod **qidiruv maydoniga** tushadi — va bu zararsiz, chunki
    `/tsd/search` ning `OR` ida `barcodes: { has: q }` bor: shtrix bo'yicha qidiruv shu tovarni
    TOPADI. Ya'ni eng yomon holat ham ishlaydigan yo'lga tushadi, boshi berk ko'chaga emas.
  - `SearchScreen` `onScan` ni **ushlamaydi**, ya'ni fokus `ScanBar` da bo'lganda skan avvalgidek
    umumiy narxsiz `ScanInfoScreen` ni ochadi.
- **Qidiruv maydonida 350 ms avto-yuborish** — YO'Q va bo'lishi mumkin ham emas: u `ScanBar` ning
  ichki mantig'i, `SearchScreen` esa oddiy `PlainField` ishlatadi (T2 hisoboti bandi 3 shuni talab
  qilgan edi).
- **Bosh ekran plitkalari** — to'rttadan beshtaga chiqdi; «Navbat» plitkasi uchinchi qatorga tushdi
  va yonida bo'sh yarim ustun qoldirildi (aks holda u ustidagilardan ikki barobar keng ko'rinardi).
  Plitkaning `badge` mantig'i (kutayotgan + rad etilganlar soni) **o'zgarmadi**.
- **Brauzerdan `/tsd/search`** — `product.view` ruxsati borlar chaqira oladi; javob narxsiz, ya'ni
  zararsiz (bu `scan` da ham shunday va uning izohida ochiq yozilgan).
- **Eski ilova + yangi server** — `/tsd/search` ni hech kim chaqirmaydi, boshqa hech nima o'zgarmadi.
  **Yangi ilova + eski server** — `/tsd/search` 403/404 beradi, ekran toast ko'rsatadi va `busy`
  tushadi (qotib qolmaydi); qolgan ekranlar ishlayveradi.

**Git (§2, qoida 6)**

`1086d253` — **17 fayl** (16 ta T3 fayli + `docs/progress.json`, uni loyihaning `pre-commit` hook'i
o'zi qo'shadi). `apps/api/src/modules/auth/{auth.controller,auth.schema,tsd-device.service}.ts`,
`apps/api/src/modules/permissions/*`, `apps/api/src/scripts/seed-role-templates.ts`,
`android/manager-app/` va `docs/plans/2026-09-02-menejer-planshet-apk.md` — **menejer-planshet
rejasiga tegishli, tegilmadi va commit qilinmadi** (T1/T2 hisobotlaridagi eslatma bajarildi).

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. **Jonli qurilmada sinalmagan.** Qabul mezoni «kodda ko'rsatilsin» deydi va bajarildi; haqiqiy
   iData 95W Pro sinovi — **T8**. README'ning G6 smoke ro'yxatiga **10-band** aynan shu uchun
   yozildi (uchala ulash nuqtasi + `curl` narx tekshiruvi bilan).
2. **APK chiqarilmadi** (§2, qoida 9): `versionCode`/`versionName` **oshirilmadi** (hamon `4`/`0.4.0`),
   `tools/publish.sh` chaqirilmadi. Egasi «chiqar» degandagina.
3. **`take: 30` saralashdan OLDIN ishlaydi.** Ya'ni 30 tadan ko'p mos kelsa, «aynan moslik» 31-o'rinda
   turgan tovar ro'yxatga umuman tushmaydi (DB tartibi `name asc`). Bu bilib qilingan savdo:
   muqobili — hammasini olib xotirada saralash (jonlida 5 ming tovarda ishlardi, lekin o'sish bilan
   yiqilardi). `truncated` bayrog'i omborchini «aniqroq yozing» deb yo'naltiradi. To'liq yechim —
   saralashni SQL ga tushirish (`ORDER BY (name = q) DESC, name ILIKE q||'%' DESC, ...`); T10/T11
   dan oldin kerak bo'lsa ko'rib chiqilsin.
4. **Ro'yxatda tovarning UOM (o'lchov birligi) ko'rsatilmaydi** — `ProductHitCard` da jami qoldiq
   sonini birligisiz chizadi (bu `PickProductScreen` ning avvalgi xulqi ham edi). Kabel/shlang
   metrlarida bu chalkashlik bo'lishi mumkin; shakl `uom` ni ALLAQACHON qaytaradi, ya'ni tuzatish
   bir qatorlik. T5 (miqdor kiritish) bilan birga qilingani ma'qul.
5. **Qidiruv natijasidan to'g'ridan-to'g'ri KESIM (`CutScreen`) oqimiga o'tish yo'li yo'q** —
   bo'linadigan tovar `BLK-` yorlig'i bo'yicha topiladi (K-reja 7.3), qidiruv esa tovarni topadi.
   Bu T3 doirasidan tashqarida, lekin K-reja fazalari uchun eslatma.
6. **T1 hisobotining 5-bandi (yacheykada o'nlab biriktirilgan tovar bo'lsa skroll uzayadi) —
   YOPILMADI.** T3 unga qidiruvni QO'SHDI (endi kerakli tovarni ro'yxatdan qidirmasdan topsa
   bo'ladi), lekin ro'yxatning O'ZI hamon to'liq chiziladi. Agar jonlida uzunlik muammo bo'lsa
   («faqat birinchi 10 tasi») — T6 (sanash progressi) bilan birga.
7. **`apps/api` + `android/manager-app` hamon commit qilinmagan** (menejer-planshet rejasi) va
   ularga T3 da ham tegilmadi — keyingi T-faza agenti ham o'z commitiga qo'shmasin.

### T4 — Skan javobi: ovoz, tebranish, xato banneri, ekran o'chmasligi · **TUGADI** · 2026-09-04 · `c339187f`

**Nima qilindi**

*Yangi fayl*

- **`android/tsd-app/app/src/main/java/uz/sherset/tsd/Feedback.kt`** (YANGI, 136 qator) — global obyekt
  (`Diagnostics` naqshi: `Activity` ni ko'rmaydi, ya'ni uni ekranlar ham, `MainActivity` ham chaqira oladi
  va `Shell` shartnomasi ortiqcha o'smaydi):
  - `ok()` — `ToneGenerator.TONE_PROP_BEEP` (1400+2060 Gs, **yuqori**) 120 ms + bitta 60 ms tebranish;
  - `fail()` — `TONE_SUP_CONGESTION` (425 Gs, **past**, 200 ms yoqilgan / 200 ms o'chgan ⇒ 600 ms da
    ikkita past signal) + `createWaveform([0,120,110,120], -1)` ya'ni **ikkita** turtki.
    Ikki signal ataylab ikki o'lchovda farq qiladi (balandlik **va** uzunlik) — ombor shovqinida bitta
    o'lchov yetmaydi.
  - Oqim **`STREAM_NOTIFICATION`**, media EMAS (reja talabi): media oqimi terminalda odatda past turadi
    va qurilmaning ovoz tugmasiga bo'ysunmaydi.
  - 🔴 **Eskirgan API'dan qochildi:** `Context.VIBRATOR_SERVICE` API 31 dan eskirgan va `compileSdk = 34`
    da u **build ogohlantirishi** berardi (§2, qoida 4 buni taqiqlaydi). Shuning uchun ikkala shox ham
    turdan oladi: API 31+ da `getSystemService(VibratorManager::class.java)?.defaultVibrator`, undan
    pastda `getSystemService(Vibrator::class.java)`.
  - **Chidamlilik:** `ToneGenerator` konstruktori ba'zi qurilmalarda `RuntimeException` tashlaydi va
    `startTone` audio resursi yo'qolganda `false` qaytaradi. Ikkalasi ham `runCatching`/qayta yaratish
    bilan yopilgan — ovoz QULAYLIK, uning yo'qligi ilovani yiqitmasligi kerak. Ovoz chiqmasa ham
    **tebranish ishlayveradi**.
  - `release()` — `onDestroy` da audio resursi qaytariladi.

*Manifest — YAGONA yangi ruxsat*

- **`AndroidManifest.xml`** (+16 / −0): `<uses-permission android:name="android.permission.VIBRATE" />`.
  Izohda yozilgan: bu «normal» darajadagi ruxsat (o'rnatishda tizim beradi, omborchidan hech nima
  so'ralmaydi, hech qanday ma'lumotga yo'l ochmaydi). Mavjud «kamera/lokatsiya YO'Q» izohiga
  **mikrofon (`RECORD_AUDIO`) ham YO'Q** qatori qo'shildi: T4 ovozni faqat CHIQARADI.

*Xato banneri*

- **`Shell.kt`** (+29 / −1): shartnoma uch darajaga bo'lindi — `toast()` (BETARAF), `success()`
  (toast + `Feedback.ok()`), `error()` (**qizil banner** + `Feedback.fail()`). Har uchtasining
  KDoc'ida qachon ishlatilishi yozilgan, ya'ni keyingi fazalar «toast qo'yaymi banner qo'yaymi» deb
  o'ylamaydi.
- **`Widgets.kt`** (+41 / −0): `ErrorBanner` — `Palette.DangerContainer` fonli, `Palette.Danger` chegarali
  kartochka: ⛔ · matn · ✕. **Butun kartochka bosiladigan** (4" ekranda kichkina ✕ ga tegish qiyin;
  ✕ faqat ko'rsatkich).
- **`MainActivity.kt`** (+183 / −26): `errorText` + `errorSeq` state, `ErrorHost` (avto-yopish
  taymeri + bosib yopish), `AuthStage` (juftlash/PIN uchun), `success()`/`error()` amalga oshirilishi,
  `ERROR_BANNER_MS = 6_000L`.
  - **Joylashuvi:** ish ekranlarida banner **skan maydonining OSTIDA va ro'yxatning USTIDA**.
    Sabab kodda yozilgan: (a) maydon USTIGA qo'yilsa banner chiqqanda skan maydoni pastga sakrardi —
    omborchi aynan o'sha maydonga yozadi/skanerlaydi; (b) ro'yxat ICHIGA qo'yilsa u skroll bilan ketib,
    xato yana ko'rinmay qolardi. Yuqori panel to'silmaydi — «orqaga»/«chiqish» banner turganda ham
    bosiladi.
  - Juftlash va PIN bosqichlarida (`AuthStage`) banner **ustiga qoplanadi**: bu ekranlarda yuqori panel
    yo'q va oqimga qo'yilsa PIN klaviaturasining oxirgi qatori ekrandan chiqib ketardi.
  - `errorSeq` — aynan bir xil matnli xato ketma-ket kelsa taymer QAYTADAN boshlansin (aks holda
    ikkinchi banner birinchisidan qolgan vaqtda yo'q bo'lardi).
  - Bosqich almashganda banner tozalanadi (`logout`, muvaffaqiyatli PIN) — «PIN noto'g'ri» ish stoliga,
    «Yacheyka topilmadi» esa PIN ekraniga ergashib o'tmaydi. 401 sababli chiqarilgan xato **yo'qolmaydi**:
    `onSessionLost` avval, `io()` ning banneri esa KEYIN ishlaydi (ikkalasi UI thread navbatida).

*Ekran o'chmasligi*

- **`MainActivity.onCreate`**: `window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)` —
  sozlamada emas, **doimiy** (reja talabi). Ilova fonga ketganda bayroq o'z-o'zidan kuchdan qoladi,
  ya'ni terminal cho'ntakda yotganda ekran yonib turmaydi.

*Sozlama*

- **`config.xml`** (+13 / −0): `<bool name="feedback_sound">true</bool>` — reja «bitta bayroq» degan va
  ayni shunday qilindi. Tebranish uchun alohida bayroq **ataylab yo'q**: u ovozsiz kanal va uni
  o'chirishning sababi yo'q (ovoz o'chirilganda ham ishlayveradi).
- **`strings.xml`** (+5 / −0): `error_unknown` («Xatolik — amal bajarilmadi») — matnsiz 5xx da bannerda
  bo'sh qator turmasin.

**Qaysi yo'llar BANNERGA o'tdi (hammasi)**

| Fayl | Yo'l | Nega xato |
|---|---|---|
| `MainActivity` | `io()` ning **ikkala** `catch` i (`ApiException` + `Exception`) | ekranlar o'zi tutmagan HAMMA xatoning oxirgi to'ri — toast qolsa qoidada teshik qolardi |
| `MainActivity` | `QueueFullException` (navbat to'ldi) | yangi amal RAD ETILDI (IS-5) |
| `MainActivity` | `flushQueue`: `r.offline` · `r.rejected > 0` | amal yuborilmadi / rad etildi |
| `MainActivity` | `login_failed` va PIN dagi boshqa xatolar | kirish o'tmadi |
| `MainActivity` | `update_check_failed`, `update_needs_permission` | yangilanish o'tmadi |
| `CountScreen` | `count_need_cell_first`, `scan_none` (×2), `scan_piece`, `cell_not_found`, `cell_ambiguous`, `count_qty_hint`, saqlash `catch` (`count_offline` yoki server matni) | 9 yo'l |
| `PlaceScreen` | `scan_piece`, `place_need_product`, `cell_not_found`, `cell_ambiguous`, `place_need_cell`, `place_qty_hint`, yuborish `catch` | 7 yo'l |
| `CutScreen` | `cut_piece_not_in_line`, `cut_length_hint`, yuborish `catch` (`cut_offline` yoki server matni) | 3 yo'l |
| `ShortageScreen` | `shortage_qty_hint`, yuborish `catch` | 2 yo'l |
| `TaskDetailScreen` | `scan_piece`, `scan_none`, `confirmByProduct` `catch`, `confirmLine` `catch` | 4 yo'l |
| `SearchScreen` | qidiruv `catch` | 1 yo'l |
| `QueueScreen` | `r.offline` · `r.rejected > 0` | 2 yo'l |

**Qaysi toast QOLDI va nega (ikkitasi, sanab o'tilgan)**

1. **`TaskDetailScreen.onScan` → `scan_working` («Qidirilmoqda…»).** Bu na muvaffaqiyat, na xato —
   «so'rov ketdi» degan **betaraf** xabar. Bannerga chiqarilsa qizil rang «xato bo'ldi» degan ma'no
   berardi; ovoz berilsa esa bitta skanga ikkita signal chiqardi (avval «ketdi», keyin natija).
   Natija kelganda `onScanResult` o'zi ok/fail ni aytadi.
2. **`MainActivity.checkUpdate` → `update_up_to_date` («eng so'nggi versiya»).** Bu ham betaraf javob
   va u FAQAT omborchi tugmani o'zi bosganda chiqadi (`silent = false`); hech qanday amal
   bajarilmagan, ya'ni ovoz ham, banner ham ortiqcha.

**Muvaffaqiyat — toast bo'lib QOLDI (banner emas), ustiga ovoz qo'shildi**

`count_saved`, `place_saved`, `shortage_saved`, `line_confirmed` (×2), `cut_saved`/`cut_saved_labels`,
`pair_done`, `offline_queued`, toza `queue_sent`. Sabab: har saqlashda banner chiqsa 4" ekranning
uchdan biri doimiy band bo'lardi va u xato bannerining kuchini yo'qotardi (hamma narsa banner bo'lsa
banner hech nima demaydi). Muvaffaqiyat uchun **ovoz+tebranish** yetarli — omborchi aynan shuni kutadi.

**Matnsiz signal (`Feedback` to'g'ridan-to'g'ri) — 6 nuqta**

`MainActivity.routeScan` (topildi/topilmadi — `isEmptyHit`: `kind: "none"` yoki `piece.found != true`),
`CountScreen` yacheyka ochildi · tovar tanildi (bitta va multi-hit), `PlaceScreen` tovar tanildi ·
maqsad yacheyka qabul qilindi, `CutScreen` bo'lak yorlig'i qatordan topildi, `TaskDetailScreen`
multi-hit ro'yxati ochilmoqda. Bu joylarda **xabar yo'q** (natija ekranning O'ZIDA ko'rinadi), lekin
omborchi ekranga qaramasdan skan qabul qilinganini bilishi kerak.
`TaskDetailScreen` da **bitta** tovar topilganda signal ATAYLAB berilmaydi: darhol `confirm-scan`
ketadi va uning javobi o'z signalini beradi — aks holda bitta skanga ikkita ovoz chiqardi.

**O'lchandi**

| Nima | Buyruq | Natija |
|---|---|---|
| Build | `gradle --no-daemon clean assembleDebug` (Gradle 8.7, JDK 17) | **BUILD SUCCESSFUL in 51s** · **36 task, 35 bajarildi** · exit 0 |
| Ogohlantirish | o'sha buyruq, `grep -c -E "^w:\|warning\|^e:"` | **0 ta** (toza `clean` build'da o'lchandi — `UP-TO-DATE` task natijani yashirmadi) |
| Server testlari | — | **yugurtirilmadi: server fayllariga tegilmagan** (`git show --stat c339187f` da `apps/` yo'q) |

**Qabul mezoni**

| Band | Holat | Dalil |
|---|---|---|
| `assembleDebug` ogohlantirishsiz | ✔ | toza build, `w:`/`warning`/`e:` — **0 qator**. Ayniqsa `Context.VIBRATOR_SERVICE` (API 31 dan eskirgan) ATAYLAB ishlatilmadi — u yagona ehtimoliy ogohlantirish manbai edi |
| Hamma xato yo'llari bannerga o'tgani; toast qolgan joylar hisobotda sanab o'tilgan | ✔ | yuqoridagi ikki jadval. `grep -rn "toast(" app/src/main/java/` da butun ilova bo'yicha **atigi 2 ta** chaqiruv qoldi (`scan_working`, `update_up_to_date`) + `Shell`/`MainActivity` dagi ta'rifning o'zi |
| Ovoz/tebranish ruxsati manifestda (`VIBRATE`) | ✔ | `<uses-permission android:name="android.permission.VIBRATE" />` |
| U **yagona** yangi ruxsat (kamera/lokatsiya YO'Q — G5 qoidasi) | ✔ | `git diff AndroidManifest.xml` da qo'shilgan yagona `uses-permission` — `VIBRATE`. Manifestda kamera, lokatsiya, fon-servis va mikrofon **YO'Q** (izohlarda ochiq yozilgan). Ovoz uchun ruxsat umuman kerak emas: `ToneGenerator` — chiqish qurilmasi |

**Narx qoidasi (§2, qoida 3)**

Serverga **bitta bayt ham** tegilmadi: `apps/`, `packages/`, `prisma/` diffda umuman yo'q. Yangi javob
maydoni ham, allowlist qatori ham, yangi API chaqiruvi ham qo'shilmadi (`ApiClient.kt` diffda yo'q).
Banner **mavjud** matnlarni ko'rsatadi va ularning hech birida narx yo'q; `Feedback` esa umuman matn
ko'rmaydi (faqat `ok()`/`fail()`).

**Qaysi oqimni buzishi mumkin? (§2, qoida 8)**

- **Sanash semantikasi** — buzilmadi. `CountScreen.save()` ning MANTIG'IGA tegilmadi: hamon
  `setCellStock(..., qty)`, ya'ni `mode: 'set'` (mutlaq son). O'zgargani faqat javob KANALI
  (`toast` → `success`/`error`). `count_qty_hint` bo'sh maydonda saqlashni ilgarigidek to'xtatadi.
- **Oflayn navbat** — buzilmadi va bu muhim: `enqueue()` **xato emas** (`success`), chunki amal
  yo'qolmadi, keyinroq yuboriladi; xato bo'lib faqat **navbat to'lgani** va **rad etilganlar** chiqadi.
  `ActionQueue`/`QueueSender`/`DeviceStore`/`ScannerBridge`/`ApiClient` diffda **umuman yo'q**
  (§2, qoida 10). FIFO, `clientOpId` idempotentligi, 4xx → «rad etilganlar» — hammasi joyida.
- **Multi-hit'da tanlovni odam qiladi** — buzilmadi. `Feedback.ok()` qo'shilgan joylarda tanlov
  mantig'i o'zgarmadi: multi-hit hamon `PickProductScreen` ni ochadi, ilova hech qachon o'zi tanlamaydi.
- **Skaner (T2 ishi)** — buzilmadi. `ScanBar.kt` diffda **umuman yo'q**: 350 ms zaxirasi ham,
  `TypingWatch` ham, ⏎ tugmasi ham tegilmagan. `ScannerBridge` broadcast qismi ham tegilmagan.
- **Fokus intizomi** — buzilmadi. Banner **fokus olmaydi** (u `Text` lar ichidagi `Card`, matn maydoni
  emas) va `ScanBar` fokusni faqat `LaunchedEffect(screenKey)` da so'raydi. Banner chiqishi ekran
  almashishi EMAS, ya'ni `screenKey` o'zgarmaydi va fokus qayerda bo'lsa o'sha yerda qoladi.
- **Skroll holati** — banner skroll konteynerining TASHQARISIDA, ya'ni u chiqqanda/ketganda
  ro'yxatning skroll pozitsiyasi qayta hisoblanmaydi (ichkarida bo'lsa qator ostiga siljirdi).
- **Ekran balandligi (4")** — banner ~64 dp joy egallaydi va u FAQAT xato bo'lganda paydo bo'ladi;
  6 soniyadan keyin joy qaytadi. Sanashdagi sanoq maydoni va Saqlash tugmasi skrollda, ya'ni ular
  ekrandan «chiqib ketmaydi», pastroqqa suriladi.
- **`FLAG_KEEP_SCREEN_ON` va batareya** — terminal smena davomida quvvat tokchasida turadi (egasining
  ish tartibi), ya'ni bu bayroqning narxi yo'q. Ilova fonga ketganda (`onPause`) Android bayroqni
  o'zi hisobga olmaydi — ekran odatdagi tartibda o'chadi. Qulflangan ekran/quvvat tugmasi ham
  ilgarigidek ishlaydi (bayroq faqat AVTO o'chishni to'xtatadi).
- **Ovoz «bezovta qilmaslik» rejimida** — `STREAM_NOTIFICATION` qurilma sozlamasiga bo'ysunadi, ya'ni
  ovoz o'chirilgan terminalda signal jim chiqadi va **tebranish** ishlayveradi. Aksincha ham to'g'ri:
  tebranishsiz terminalda ovoz qoladi.
- **PIN ekrani va maxfiylik** — buzilmadi. `Diagnostics` ga yangi hech nima yozilmadi; banner matni
  ham hech qayerga yuborilmaydi (faqat ekranda). PIN bosqichida `dispatchKeyEvent` ning diagnostika
  qulfi (`if (stage == Stage.Work)`) tegilmadi.
- **Eski ilova + yangi server / yangi ilova + eski server** — bu faza SERVERGA umuman tegmagani uchun
  ikkala kombinatsiya ham ilgarigidek ishlaydi.

**Git (§2, qoida 6)**

`c339187f` — **16 fayl** (15 ta T4 fayli + `docs/progress.json`, uni loyihaning `pre-commit` hook'i o'zi qo'shadi). `apps/api` (menejer-planshet rejasi: `auth.*`, `tsd-device.service.*`,
`permissions/*`, `seed-role-templates.ts`), `apps/api/src/scripts/ops-menejer-rol.ts`,
`android/manager-app/` va `docs/plans/2026-09-02-menejer-planshet-apk.md` — **T4 ga tegishli emas,
tegilmadi va commit qilinmadi** (T1/T2/T3 hisobotlaridagi eslatma bajarildi).

⚠️ Ish davomida `apps/web` da ham qisqa vaqt commit qilinmagan o'zgarishlar ko'rindi
(`pos-header.tsx`, `customer-display/page.tsx`, `api-client.ts` + testlar) va keyin ular o'z-o'zidan
yo'qoldi — ehtimol yonma-yon ishlayotgan boshqa sessiya. Ularga TEGILMADI va commitga tushmadi
(`git show --stat c339187f` da `apps/` umuman yo'q).

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. **Jonli qurilmada sinalmagan** — ovozning haqiqiy balandligi, tebranish kuchi va tonlarning
   ombor shovqinida ajralishi FAQAT iData 95W Pro'da o'lchanadi. Bu **T8** ning ishi; README'ning
   G6 smoke ro'yxatiga **11-band** aynan shu uchun yozildi (eski «Narx tekshiruvi» 12 ga surildi).
   T8 da tekshirilsin: (a) tonlar bir-biridan ajraladimi, (b) `TONE_SUP_CONGESTION` juda uzun emasmi
   (600 ms), (c) banner 6 soniyasi yetarlimi.
2. **Ton turlari taxminga tayanadi.** `TONE_PROP_BEEP` va `TONE_SUP_CONGESTION` ning aniq chastotalari
   Android hujjatidan olindi, qurilmada o'lchanmadi. Ba'zi terminallarda `ToneGenerator` umuman jim
   bo'lishi mumkin — o'shanda `SoundPool` + o'z `.ogg` fayllariga o'tish kerak bo'ladi (kod bitta
   `Feedback.play()` ichida jamlangani uchun bu bitta funksiya almashtirish).
3. **Banner ekranlar orasida saqlanmaydi.** `errorText` `MainActivity` da yashaydi va ekran
   almashganda **qoladi** (bosqich almashganda esa tozalanadi) — bu ataylab: xato ekran o'zgargani
   bilan yo'qolmasin. Lekin `back()` bosilsa ham banner turadi va u yangi ekranning xatosi kabi
   ko'rinishi mumkin. T8 da bu chalkashlik kuzatilsa — `go()`/`back()` da tozalash bir qatorlik.
4. **Ovozni sozlash — faqat qayta yig'ish bilan.** `feedback_sound` resursda, ya'ni uni o'zgartirish
   uchun APK qayta yig'iladi. Jonlida tez o'chirish kerak bo'lsa (T2 dagi chegara kabi) uni
   `DiagnosticsScreen` ga tugma qilib chiqarish mumkin — hozir qilinmadi, chunki reja «bitta bayroq»
   degan va sozlama ekrani T4 doirasida emas.
5. **Baland ovozli signal muvaffaqiyat uchun ham bir xil** — omborchi ketma-ket 20 ta tovar sanaganda
   20 ta bir xil «bip» eshitadi. Jonlida bu charchatsa, T5/T6 bilan birga «faqat xatoda ovoz» rejimi
   ko'rib chiqilsin (hozir bunday talab yo'q).
6. **APK chiqarilmadi** (§2, qoida 9): `versionCode`/`versionName` **oshirilmadi** (hamon `4`/`0.4.0`),
   `tools/publish.sh` chaqirilmadi. Egasi «chiqar» degandagina.
7. **`apps/api` + `android/manager-app` hamon commit qilinmagan** (menejer-planshet rejasi) —
   keyingi T-faza agenti ham o'z commitiga qo'shmasin. `apps/web` dagi vaqtinchalik o'zgarishlar
   (yuqoridagi ⚠ bandi) T4 tugagunicha o'z-o'zidan yo'qoldi.

### T5 — Miqdor kiritish: kalkulyator va tez tugmalar · **TUGADI** · 2026-09-04 · `d47a9786`

**Nima qilindi**

*Yangi fayl — sof modul*

- **`android/tsd-app/app/src/main/java/uz/sherset/tsd/QtyExpression.kt`** (YANGI, 264 qator).
  Android ham, Compose ham, `R` ham unga KIRMAYDI — bu ataylab: shu tufayli mantiq oddiy JVM
  unit-testi bilan qamraldi (pastda). Tashqi sirti: `parse(input): Result`
  (`Empty` / `Ok(value, text)` / `Bad(problem)`), reja talab qilgan
  `evaluate(text): BigDecimal?`, ekranlar ishlatadigan `qty(text): String?` va
  `isExpression(text)`.
  - **Rekursiv tushuvchi tahlilchi**, grammatikasi KDoc'da yozilgan:
    `expr := term (('+'|'-') term)*` · `term := factor ('*' factor)*` ·
    `factor := ('+'|'-')* primary` · `primary := number | '(' expr ')'`.
    Ko'paytirish qo'shishdan ustun (`3*24+6` = **78**, 90 EMAS).
  - Hisob **`BigDecimal`** da, `Double` da emas — `12.5*2.5` aynan `31.25`, suzuvchi
    nuqta artefakti yo'q.
  - 🔴 **Natija serverning shakliga bo'ysunadi.** `SetCellStockSchema.qty` /
    `CellPlaceSchema.qty` / `CellMoveSchema.qty` — hammasi `/^\d+(\.\d{1,6})?$/`.
    Shuning uchun modul `stripTrailingZeros().toPlainString()` beradi (`12.000000` → `12`,
    `10*10` → `100`, **`1E+2` EMAS**) va manfiy / 6 xonadan uzun kasr / `1e9` dan katta
    natijani **rad etadi**. Ya'ni ekranda «= 288» ko'ringan son serverda 400 bo'lib
    qaytmaydi.
  - 🔴 **Bo'lish (`/`, `:`, `÷`) — ALOHIDA sabab bilan rad etiladi**, umumiy «xato» emas:
    omborchi «bo'lish yo'q» deb o'qisa muqobilini o'zi topadi, «ifoda noto'g'ri» desa
    nima qilishini bilmasdi. Yaxlitlash siyosati ochilmadi (prompt bandi 3).

*Vidjet*

- **`Widgets.kt`** (+132 / −13): `NumberField` ga `expression: Boolean = false` parametri.
  Yoqilganda maydon ostida:
  1. **tez tugmalar qatori `+ − × ( )`** (`QtyOperatorRow`). Bu qulaylik EMAS, **zarurat**:
     maydon `KeyboardType.Decimal` da ishlaydi va bu klaviaturada `*` tugmasi **umuman yo'q** —
     tugmalarsiz omborchi `12*24` ni jismonan yoza olmasdi. Yorlig'i `×`, maydonga `*` yoziladi.
     Tugmalar `weight(1f)` bilan teng bo'linadi, `contentPadding = 0` (sukut 24dp bo'lsa 4"
     ekranda beshtasi sig'masdi), balandligi 48dp.
  2. **natija / sabab qatori** (`QtyHint`): to'g'ri ifodada yashil «**= 288**», xatoda qizil
     «⛔ <sabab>». Sof raqamda va bo'sh maydonda qator **umuman chizilmaydi** (4" ekranda joy).
  - **Tartib: maydon → tugmalar → natija.** Natija tugmalar USTIGA qo'yilsa, birinchi `×`
    bosilganda qator paydo bo'lib tugmalarni pastga surardi va keyingi bosish adashardi.
    Hozirgi tartibda tegish nishonlari **qimirlamaydi**, natija esa Saqlash tugmasining
    ustida — ko'z aynan shu yo'ldan o'tadi.
  - `qtyProblemRes()` — sabab → `strings.xml`. Sabab matnlari ekranda, chunki `QtyExpression`
    `R` ni ko'rmaydi.

*Ekranlar — uch joyda yoqildi, uch joyda ham SAQLASH YO'LI qulflandi*

- **`CountScreen.kt`** (+25 / −6): ikkala miqdor maydoni ham (`PickedCard` dagi sanoq va
  ro'yxat qatoridagi sanoq) `expression = true`. Ikkala Saqlash tugmasi endi
  `enabled = QtyExpression.qty(...) != null` — ro'yxat qatoridagi tugma ilgari **doim yoniq**
  edi. `save()` imzosi `qty` → `input` ga o'zgardi va ichida ifoda **songa aylanadi**.
- **`PlaceScreen.kt`** (+11 / −5): miqdor maydoni + tugma sharti; `submit()` ichida son
  hisoblanadi va u **`payload` ga ham, oflayn navbatning YORLIG'IGA ham** tushadi
  (ifoda matni navbatda qolsa, keyin server regexidan o'tmasdi).
- **`CutScreen.kt`** (+45 / −13): `cutLength` va `remaining` — **ikkalasi ham**. Reja faqat
  «kesim uzunligi» degan, lekin qo'shni ikki maydondan biri ifodani tushunib ikkinchisi
  tushunmasa omborchi qaysi biriga nima yozishni bilmasdi, va `14,5` ikkinchi maydondan
  jimgina serverga ketardi. Tugma sharti: `cutLength` to'g'ri **va** (`remaining` bo'sh
  **yoki** to'g'ri) — «qolgan uzunlik» ixtiyorsiz emas, IXTIYORIY (bo'sh = server hisoblaydi).
  - 🔴 **`needText()` `Double` dan `BigDecimal` ga ko'chirildi.** Bu «yo'l-yo'lakay tuzatish»
    emas, T5 ning O'ZI keltirib chiqaradigan yiqilishning oldini olish: `250 − 237.3` `Double`
    da **`12.700000000000017`** beradi, bu son maydonga **sukut** bo'lib tushardi va yangi
    tekshiruv («kasr ≤ 6 xona») uni rad etib, omborchi **hech nima yozmasdan turib**
    «Kesimni yozish» tugmasini o'chiq holatda ko'rardi — boshi berk ko'cha. Endi hisob aniq.
- **`strings.xml`** (+11, faqat `uz`): `qty_result`, `qty_bad_syntax`, `qty_bad_division`,
  `qty_bad_negative`, `qty_bad_long`, `qty_bad_big`, `qty_bad_precise`, `qty_invalid`.
- **`README.md`** (+54 / −4): yangi «**Miqdor kiritish — kalkulyator (T5)**» bo'limi
  (qo'llab-quvvatlanadigan sintaksisning to'liq jadvali + test buyrug'i), G6 smoke ro'yxatiga
  **12-band (T5)** (eski «Narx tekshiruvi» 13 ga surildi), fayl xaritasiga `QtyExpression.kt`
  va `app/src/test/` qatorlari.
- **`app/build.gradle.kts`** (+6): `testImplementation("junit:junit:4.13.2")`.

**Qo'llab-quvvatlanadigan sintaksis (to'liq)**

| Yozildi | Natija | Izoh |
|---|---|---|
| `12`, `250`, ` 250 ` | `12`, `250`, `250` | chekka bo'shliqlar kesiladi |
| `14.5` · `14,5` | `14.5` | **vergul ham, nuqta ham** (reja vazifasi 3 — kabel/shlang metrlari) |
| `.5` · `14.` | `0.5` · `14` | yozayotgan odamning oraliq holati; natija qatorida KO'RINADI |
| `12.000000` · `100.0` | `12` · `100` | serverning `Decimal(20,6)` sukut qiymati qisqaradi |
| `12*24` · `12×24` · `12x24` · `12 * 24` | `288` | `×` va `x`/`X` ham ko'paytirish (fizik klaviatura) |
| `10+5` · `10-5` | `15` · `5` | |
| `3*24+6` · `6+3*24` | `78` | ko'paytirish ustun |
| `(2+3)*4` | `20` | qavslar |
| `12.5*2.5` · `2,5*15` | `31.25` · `37.5` | `BigDecimal`, artefakt yo'q |
| `12*` · `*12` · `((3+4)` · `3+4)` · `()` · `1.2.3` · `abc` | ✘ SYNTAX | «Ifoda tugallanmagan» |
| **`12 24`** | ✘ SYNTAX | 🔴 probel token AJRATADI — jimgina `1224` BO'LMAYDI |
| `12/2` · `12:2` · `12÷2` | ✘ DIVISION | «Bo'lish qo'llab-quvvatlanmaydi» |
| `-5` · `10-25` · `10*-2` | ✘ NEGATIVE | «Natija manfiy» |
| 41 belgi | ✘ TOO_LONG | 40 belgi chegara (39 belgi hamon ishlaydi) |
| `999999999*2` | ✘ TOO_BIG | ≥ 1e9 |
| `0.0000001` · `0,001*0,0001` | ✘ TOO_PRECISE | server regexi: kasr ≤ 6 xona |

**🔴 Sinov paytida topilgan va tuzatilgan xato (ochiq aytiladi)**

Birinchi yozilishda `normalize()` **hamma bo'shliqni olib tashlardi** — natijada **`12 24`
jimgina `1224` bo'lib ketardi**. Buni birinchi test yugurishi ushladi (17 tadan 1 tasi qizil).
Bu aynan T5 tuzatayotgan kasallikning yangi shakli edi (jim noto'g'ri son), shuning uchun
xulq o'zgartirildi: bo'shliq **saqlanadi va token ajratuvchi** bo'ladi — `12 * 24` ishlaydi,
`12 24` esa XATO. Test qulf sifatida qoldirildi (`buzuqIfoda`).

**O'lchandi**

| Nima | Buyruq | Natija |
|---|---|---|
| Unit-testlar | `gradle --no-daemon clean testDebugUnitTest assembleDebug` | **17 test · 17 yashil · 0 qizil · 0 skipped** (`QtyExpressionTest`, 68 ta `assert`) |
| Build | o'sha buyruq | **BUILD SUCCESSFUL in 53s** · **42 task, 41 bajarildi** · exit 0 |
| Ogohlantirish | o'sha log, `grep -c -E "^w:\|warning\|^e:"` | **0 ta** (toza `clean` build'da o'lchandi — `UP-TO-DATE` task natijani yashirmadi) |
| Server testlari | — | **yugurtirilmadi: server fayllariga tegilmagan** (`git show --stat d47a9786` da `apps/` yo'q) |

🔴 **Ilovada endi unit-test bor.** U-reja «Ochiq qolganlar» dagi «TSD tomonda test
infratuzilmasi yo'q» holati SHU faza uchun yopildi: `app/src/test/` manba to'plami va
`testImplementation("junit:junit:4.13.2")` qo'shildi. Bu bog'liqlik **APK'ga tushmaydi**
(`testImplementation`, `assembleDebug` uni hatto yechmaydi ham). Reja «test yo'q bo'lsa
hisobotda ayting» degan edi — o'rniga test YOZILDI, chunki `QtyExpression` ataylab sof
modul qilib chiqarilgan va aynan shu yerda test eng ko'p foyda beradi.

**Tekshirilgan holatlar (17 test metodi)**

`sofSonlar` · `vergulNuqtaBilanTeng` · `yarimYozilganSon` · `ortiqchaNollarKesiladi` ·
`kopaytirish` · `qoshishVaAyirish` · `amallarTartibi` · `kasrliKopaytma` ·
`evaluateSonQaytaradi` · `bosMaydonXatoEmasLekinYuborilmaydi` · `bolishQollabQuvvatlanmaydi` ·
`buzuqIfoda` · `manfiyNatija` · `chegaralar` · **`serverRegexQulfi`** · `korsatkichliYozuvYoq` ·
`natijaQatoriQachonKorinadi`.

`serverRegexQulfi` — eng muhim qulf: 18 ta turli kirish uchun natija matni
`^\d+(\.\d{1,6})?$` ga mos kelishi **testda tekshiriladi**, ya'ni ekrandagi son bilan
serverning qoidasi bir-biridan ajralib ketolmaydi.

**Qabul mezoni**

| Band | Holat | Dalil |
|---|---|---|
| `assembleDebug` **ogohlantirishsiz** | ✔ | toza `clean` build, 42 task / 41 bajarildi, `w:`/`warning`/`e:` — **0 qator** |
| Ifoda natijasi **serverga son bo'lib** ketishi (ifoda matni EMAS) — **kodda ko'rsatilsin** | ✔ | Uchala yozish yo'li ham bitta cho'qqidan o'tadi: `CountScreen.save()` → `val qty = QtyExpression.qty(input)` → `api.setCellStock(..., qty)`; `PlaceScreen.submit()` → `payload.put("qty", qty)` **va** navbat yorlig'i; `CutScreen.send()` → `api.cut(..., cut, remaining, ...)`. Maydondagi MATN (`12*24`) bu funksiyalardan nariga o'tolmaydi. Ustiga `serverRegexQulfi` testi shaklni qulflaydi |
| Noto'g'ri ifodada **saqlash imkonsiz** | ✔ | ikki qavat: (1) tugma `enabled = QtyExpression.qty(...) != null` — `12*`, `-5`, `12/2`, `12 24` da **o'chadi**; (2) tugma chetlab o'tilsa ham `save`/`submit`/`send` `null` da to'xtaydi va bannerga sabab chiqaradi. **Jim 0 yuborilmaydi** — 0 faqat omborchi `0` (yoki `10-10`) yozganda ketadi |
| Bo'linish (`/`) qo'llab-quvvatlanmaydi | ✔ | `Problem.DIVISION` — grammatikada `/` umuman yo'q, tugmasi ham yo'q; sababi ANIQ matn bilan aytiladi. Yaxlitlash siyosati ochilmadi |
| Vergul/nuqta ikkalasi (reja vazifasi 3) | ✔ | `vergulNuqtaBilanTeng` testi: `ok("14,5") == ok("14.5") == "14.5"` |
| Sanash va Joylashtirishda ishlaydi; kesim uzunligiga ham tatbiq etilgan (vazifa 4) | ✔ | `CountScreen` (2 maydon), `PlaceScreen` (1), `CutScreen` (2 — uzunlik **va** qolgan uzunlik) |
| Testlar (vazifa 5) | ✔ | reja «test yo'q bo'lsa ayting» degan; o'rniga **17 ta JVM unit-test** yozildi va yashil |

**Narx qoidasi (§2, qoida 3)**

Serverga **bitta bayt ham** tegilmadi: `git show --stat d47a9786` da `apps/`, `packages/`,
`prisma/` **umuman yo'q**. Yangi javob maydoni ham, allowlist qatori ham, yangi API chaqiruvi
ham qo'shilmadi (`ApiClient.kt` diffda yo'q). `QtyExpression` faqat omborchi O'ZI kiritgan
matn bilan ishlaydi — u serverdan hech nima o'qimaydi va narx tushunchasini bilmaydi.

**Qaysi oqimni buzishi mumkin? (§2, qoida 8)**

- **Sanash semantikasi (mutlaq son)** — buzilmadi. `setCellStock(..., qty)` va `mode: 'set'`
  o'zgarmadi; o'zgargani faqat `qty` ning QAYERDAN kelishi (matn → hisoblangan son).
  Sariq «yacheykada yo'q — KIRIM bo'lib yoziladi» ogohlantirishi (`PickedCard`) tegilmadi.
- **Oflayn navbat** — buzilmadi va bu joyda kuchaydi ham: `PlaceScreen` navbatga
  **hisoblangan sonni** qo'yadi, ya'ni aloqa qaytganda yuboriladigan `payload` server
  regexidan o'tadi. Ilgari maydonda vergul bo'lsa navbatdagi amal 400 bo'lib **rad
  etilganlar** ro'yxatiga tushardi. `ActionQueue`/`QueueSender`/`DeviceStore`/`ScannerBridge`/
  `ApiClient` diffda **umuman yo'q** (§2, qoida 10). Sanash ilgarigidek navbatga QO'YILMAYDI.
- **Multi-hit'da tanlovni odam qiladi** — buzilmadi: tanlov mantig'iga (`pick`, `onScan`,
  `PickProductScreen`) tegilmadi.
- **Skaner (T2 ishi)** — buzilmadi. `ScanBar.kt` diffda **yo'q**. Ifoda maydonlari `ScanBar`
  emas, oddiy `NumberField`; ular fokusni o'zi TORTMAYDI (yangi `requestFocus()` qo'shilmadi),
  ya'ni T2/T3 dagi fokus intizomi o'z holicha. Tez tugmalar `Button` — ular Compose'da
  tegish rejimida fokus olmaydi, demak bosilganda matn maydonining fokusi ham, klaviaturasi
  ham yopilmaydi.
- **Xato banneri (T4 ishi)** — buzilmadi va **kamroq ishlaydi**: noto'g'ri miqdor endi
  bannergacha yetmaydi (tugma o'chiq), sabab maydonning O'ZIDA turadi. `save`/`submit`/`send`
  ichidagi qolgan `shell.error(...)` yo'llari joyida — bo'sh maydonda eski matn
  (`count_qty_hint` / `place_qty_hint` / `cut_length_hint`), boshqa holatda `qty_invalid`.
- **T4 ovoz/tebranishi** — tegilmadi (`Feedback.kt` diffda yo'q).
- **Eski xulqning o'zgargan yagona joyi:** ilgari maydonga `12,5` yozib saqlansa server 400
  berardi (banner), endi u **14.5 kabi to'g'ri songa aylanadi va SAQLANADI**. Bu tuzatish,
  lekin xulq o'zgarishi — hisobotda ochiq turibdi.
- **4" ekran balandligi** — ⚠️ har ifoda maydoni ~54dp uzaydi (tugmalar qatori 48dp + oraliq).
  Sanash ekranida qoldiq qatorlari ko'p bo'lsa ro'yxat sezilarli uzayadi. Sanoqning asosiy
  yo'li — skandan keyin ochiladigan YUQORIDAGI karta, u joyida qoladi; pastdagi ro'yxat esa
  skrollda. Jonlida bezovta qilsa — «Ochiq qolganlar» 2-bandiga qara.
- **Server bilan moslik** — bu faza serverga tegmagani uchun «eski ilova + yangi server» va
  «yangi ilova + eski server» kombinatsiyalari o'zgarmaydi.

**Rejadan chekinishlar (ikkita, ochiq aytiladi)**

1. **`CutScreen` ning «qolgan uzunlik» maydoniga ham yoqildi** — reja faqat «kesim
   uzunligi» degan. Sabab yuqorida: qo'shni ikki bir xil ko'rinishdagi maydondan biri
   ifodani tushunib ikkinchisi tushunmasa chalkashlik tug'ilardi va `14,5` ikkinchi
   maydondan jimgina serverga ketardi.
2. **`CutScreen.needText()` `BigDecimal` ga ko'chirildi** — reja vazifalarida yo'q. Bu
   T5 ning o'zi keltirib chiqaradigan yiqilishning to'g'ridan-to'g'ri oldini olish
   (yuqorida `12.700000000000017` misoli); busiz faza kesim oqimini buzib qo'yardi.

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. **Jonli qurilmada sinalmagan.** Qabul mezoni «kodda ko'rsatilsin» deydi va bajarildi;
   haqiqiy iData 95W Pro sinovi — **T8**. README'ning G6 smoke ro'yxatiga **12-band** aynan
   shu uchun yozildi (`12*24`, tugallanmagan ifoda, vergul, manfiy, `12 24`, bo'lish).
2. **Tugmalar qatori har maydon ostida DOIM turadi** — fokusga bog'liq emas. Bu ataylab
   (ko'rinmaydigan tugma topilmaydi; fokus bilan paydo bo'lsa layout sakrardi), lekin narxi
   bor: 4" ekranda sanash ro'yxati uzayadi. **T6** (sanash progressi va ro'yxat) shu ekranni
   baribir qayta ko'radi — uzunlik muammo bo'lsa o'sha yerda hal qilinsin (T1 hisobotining
   5-bandi va T3 hisobotining 6-bandi ham shu ro'yxat haqida).
3. **Belgi matnning OXIRIGA qo'shiladi**, kursor joyiga emas — maydon `String` ustida
   ishlaydi (`TextFieldValue` emas) va kursorni bilmaydi. Kalkulyator oqimida bu sezilmaydi
   (`12` → `×` → `24`), lekin omborchi o'rtaga qaytib tahrir qilsa tugma baribir oxiriga
   yozadi. Tuzatish `TextFieldValue` ga o'tishni talab qiladi — hozir qilinmadi.
4. **`ShortageScreen` («Topolmadim» miqdori) ifoda rejimisiz qoldi** — reja vazifasi 4 uni
   sanamagan (§2 qoida 2: fazadan tashqariga chiqilmaydi). Ya'ni u yerda `14,5` hamon
   xom holda serverga ketadi (bu T5 dan OLDINGI xulq, yangi nuqson emas). Bir qatorlik ish:
   `expression = true` + `send()` da `QtyExpression.qty(...)`. Keyingi fazalardan biriga
   qo'shib yuborilsin.
5. **`PlaceScreen` da `0` yozilsa** server 400 beradi (`CellPlaceSchema` `> 0` talab qiladi) —
   `QtyExpression` uni to'g'ri son deb o'tkazadi, chunki «musbat bo'lishi shart» qoidasi
   **maydonga** emas, endpointga tegishli va u ekrandan ekranga farq qiladi (sanashda `0`
   TO'G'RI qiymat). Bu T5 dan oldin ham shunday edi. Kerak bo'lsa `NumberField` ga
   `min` parametri qo'shiladi — hozir qilinmadi.
6. **Ilovada endi `app/src/test/` bor** — keyingi faza agenti yangi sof mantiqni SHU YERGA
   test bilan qo'shsin; buyrug'i README'da va §2 qoida 4 ga qo'shimcha:
   `gradle --no-daemon testDebugUnitTest`.
7. **APK chiqarilmadi** (§2, qoida 9): `versionCode`/`versionName` **oshirilmadi**
   (hamon `4`/`0.4.0`), `tools/publish.sh` chaqirilmadi. Egasi «chiqar» degandagina.
8. **`apps/api` + `android/manager-app` hamon commit qilinmagan** (menejer-planshet rejasi) —
   T5 da ham tegilmadi va commitga tushmadi. Keyingi T-faza agenti ham o'z commitiga
   qo'shmasin. `docs/progress.json` esa `pre-commit` hook'i qo'shgan, begona ish emas.
