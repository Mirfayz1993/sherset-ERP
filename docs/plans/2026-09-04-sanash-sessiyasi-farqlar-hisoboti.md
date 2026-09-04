# Sanash sessiyasi va farqlar hisoboti (N-reja)

> **Yaratilgan:** 2026-09-04 · **Buyurtmachi:** Ozodbek (egasi) · **Holat:** REJA (kod yozilmagan)
> **Kelib chiqishi:** T-reja (`2026-09-03-tsd-omborchi-qulayligi.md`) → **T11**. T11 sessiyasida
> qamrov egasidan tasdiqlandi va ish katta bo'lgani uchun (server + allowlist + TSD ilova + web +
> i18n + migratsiya) T-reja prompti 4-bandiga ko'ra shu alohida rejaga ajratildi.
> **Bog'liq rejalar:** T-reja (T1…T11), F-reja (`2026-08-23-ombor-restrukturizatsiya.md` — «faqat
> yacheyka kesimi» qoidasi), K-reja (`2026-08-25-bolinadigan-tovar-bolak-hisobi.md` — `pieceEntry`),
> H-reja (`2026-08-24-split-kassa-hodisasi.md`), G-reja (`2026-08-23-omborchi-tsd-mijozlar.md`).
> **Reyestr:** `docs/ops/jonli-holat.md`.
>
> **Ijro tartibi (O'ZGARMAS):** har faza **ALOHIDA sessiyada**. Agent shu faylni to'liq o'qiydi,
> FAQAT o'z fazasini bajaradi, testlardan o'tkazadi, §6 «Hisobotlar» ga yozadi va **TO'XTAYDI**.

---

## 1. Nima uchun bu reja bor

Hozir yacheyka sanashi **izsiz**: omborchi TSD'da sonni kiritadi, server
`setCellStock` ([store-address.service.ts:443](../../apps/api/src/modules/store/store-address.service.ts))
darhol avto-**Оприходование** (delta > 0) yoki avto-**Списание** (delta < 0) yozadi va tamom.
Keyin hech kim «bu 361 885 dona qayerdan keldi, kim sanadi, tizimda nechta edi» degan savolga
javob bera olmaydi — hujjatda faqat `Sanash (yacheyka 02-01-01-04) — avto-tenglash` izohi qoladi.

Bu jonlidagi **«Ombor 02 yacheykalarida 361 885 soxta son»** muammosining bevosita sababi
(T-reja §1.3, `docs/ops/jonli-holat.md` §3.1 — H5 tozalash skripti aynan shu soxta sonlarni oladi).

**Maqsad:** sanash **izli** bo'lsin — kim, qachon, qaysi omborning qaysi yacheykalarini sanadi,
har qatorda tizim soni / sanalgan son / farq va qaysi avto-hujjat yozilgani ko'rinsin;
bosh omborchi sessiyani ko'rib **tasdiqlasin**.

---

## 2. Egasining qarorlari (2026-09-04, T11 sessiyasida tasdiqlangan)

| # | Savol | Qaror |
|---|---|---|
| **Q1** | Sessiya qanday modellansin? | **Mavjud `Inventory` hujjatidan foydalaniladi** (yangi `CountSession` jadvali EMAS) |
| **Q2** | Kim ochadi/yopadi? | **Omborchi TSD'da o'zi** — «Sanashni boshlash» / «Yopish». Web'da faqat ko'rinadi |
| **Q3** | Farqni kim tasdiqlaydi? | **Bosh omborchi** (`warehouse_manager`) web'da. Tasdiq — FAQAT iz, **qoldiqqa tegmaydi** |
| **Q4** | Avto-hujjatlar saqlanadimi? | **Ha** — `setCellStock` yo'li o'zgarmaydi, sessiya ularning ustiga iz qatlami |

### 2.1. 🔴 Q1 + Q4 ziddiyati va uning YECHIMI

Q1 va Q4 birga olinganda **ikki karra qo'llash** xavfi tug'iladi:

- avto-Оприходование deltani qoldiqqa **bir marta** yozadi (sanoq paytida, darhol);
- o'sha qatorlar `Inventory` hujjatiga tushib, hujjat **post** qilinsa — `inventory.service.ts`
  ning `transition('post')` yo'li `stock.applyDeltas` orqali **ikkinchi marta** yozadi
  (`inventory.service.ts:940`).

Natija: sanalgan farq jonli qoldiqqa ikki barobar tushadi — bu aynan «361 885 soxta son»
sinfidagi hodisa, faqat kattaroq miqyosda.

**Yechim (bu rejaning o'zagi):** sanash sessiyasi hujjati **HECH QACHON post qilinmaydi**.
U `inventories` jadvalida yashaydi, qatorlari `inventory_positions` da (ya'ni Q1 bajarildi —
yangi jadval yo'q, mavjud hisobotlar va ekranlar qayta ishlatiladi), lekin uning holati
**`counted`** — «qatorlar yozildi, qoldiq ALLAQACHON avto-hujjatlar bilan tenglashgan».
`post` ga o'tish **server tomonda qattiq taqiqlanadi** (N1 qo'riqchisi).

### 2.2. 🔴 Belgi `attributes` da SAQLANMAYDI — ustun bo'lishi SHART

O'lchandi (2026-09-04): `AttributeMetadataService.validateAndNormalize`
([attribute-metadata.service.ts:172-196](../../apps/api/src/modules/attribute-metadata/attribute-metadata.service.ts))
**faqat metadatada ro'yxatdan o'tgan kalitlarni** qaytaradi — qolgani jimgina tashlanadi:

```ts
for (const meta of metas) { ... if (normalized != null) out[meta.code] = normalized; }
return out;   // ⇐ input dagi begona kalitlar YO'QOLADI
```

`inventory.service.ts` `create()` va `update()` ikkalasi ham `attributes` ni shu funksiyadan
o'tkazadi. Demak `attributes.__countSession = true` belgisi **web'dagi birinchi tahrirda
yo'qolardi** — va u bilan birga 2.1 dagi post-qo'riqchisi ham. Shu sabab sessiya belgilari
`Store.attributes.__posPriority` naqshi bo'yicha EMAS, **haqiqiy ustunlar** sifatida
qo'shiladi (N1).

---

## 3. O'ZGARMAS QOIDALAR (har sessiya uchun)

1. **Bitta sessiya = bitta faza.** Faza tugagach agent keyingisini BOSHLAMAYDI — §6 ga hisobot
   yozadi va to'xtaydi.
2. Ishni boshlashdan avval shu faylni TO'LIQ o'qi (ayniqsa §2 va avvalgi fazalar hisobotlarini).
   «Yo'l-yo'lakay tuzatdim» TAQIQ — topilgan boshqa nuqson hisobotning «Ochiq qolganlar» iga yoziladi.
3. 🔴 **Ikki karra qo'llash — qizil chiziq.** Sessiya hujjati post qilinmaydi; `applyDeltas`
   sessiya qatorlari uchun HECH QACHON chaqirilmaydi. Har faza hisobotida bu bandga **yozma
   javob** beriladi.
4. 🔴 **Narx qoidasi — qizil chiziq** (T-reja qoida 3). TSD sirtiga qo'shiladigan har maydon uchun
   savol: «bu yerda narx bormi?». Sessiya qatorlarida `cost_minor` **NULL** qoldiriladi.
   `tsd-policy.ts` ga qator qo'shilsa — `tsd-policy.test.ts` majburiy va `/products` hamon YOPIQ.
5. **F-reja «faqat yacheyka kesimi» qoidasi buzilmaydi:** sessiyaga faqat `cellId` li qatorlar
   yoziladi. Yacheykasiz sanoq — bu rejaning ishi EMAS.
6. **Testlar majburiy:**
   - server: `cd apps/api && npx vitest run <o'z modulingdagi testlar>` + `pnpm --filter @moysklad/api typecheck`
     (OOM'da `NODE_OPTIONS=--max-old-space-size=8192`), yangi mantiqqa **yangi test**;
   - allowlist: `tsd-policy.test.ts`;
   - web: `pnpm i18n:gate` (ru+uz, `i18n-key-existence`, `i18n-no-hardcoded`);
   - ilova: build ogohlantirishsiz —
     ```sh
     cd android/tsd-app && JAVA_HOME=D:/dev/java/jdk-17 ANDROID_HOME=D:/dev/android-sdk \
       /d/dev/_downloads/g87/gradle-8.7/bin/gradle --no-daemon assembleDebug
     ```
     (Gradle **8.7**, 9.x AGP 8.5.0 bilan MOS EMAS.)
7. **Migratsiya idempotent** va **orqaga mos**: sessiyasiz sanash (hozirgi yo'l) bayt-baytga
   ishlashda davom etadi. Migratsiya jonliga chiqishdan oldin lokal dev bazada sinaladi
   (`sherset_v2_dev` @ localhost).
8. **Hisobot majburiy** (§6): nima qilindi (fayllar, commit), test natijalari **raqam bilan**,
   qabul mezoni ✔/✘, «qaysi jonli oqimni buzishi mumkin?» (dalil bilan), ochiq qolganlar.
9. **Git.** Branch `yacheyka-inventarizatsiya`, push → `mirfayz` remote. ⚠️ Ish daraxtida
   BEGONA ish turibdi (2026-09-04 da o'lchandi: 39 fayl — X-reja `android/manager-app`,
   J-reja skriptlari); commitga begona fayl QO'SHILMAYDI. Commit subject kichik harf (commitlint).
10. **Maxfiy ma'lumot bu faylga YOZILMAYDI** (repo public): parol, token, `deviceSecret`, PIN.
11. **Qabul mezoni — yopish sharti.** Bandlardan biri bajarilmasa faza «TUGADI» emas,
    **«QISMAN — <nima kutilmoqda>»**.

---

## 4. Fazalar xaritasi

| Faza | Nima | Tegiladi | Prioritet | Holat |
|---|---|---|---|---|
| **N1** | Migratsiya + post-qo'riqchisi | server, prisma | 🔴 poydevor | REJA |
| **N2** | Sessiya sirti va `setCellStock` ilgagi | server, allowlist | 🔴 o'zak | ✅ TUGADI (2026-09-05) |
| **N3** | TSD ilova — sessiyani boshlash/yopish | ilova | 🟡 | REJA |
| **N4** | Web — farqlar hisoboti va tasdiqlash | web, i18n | 🟡 | REJA |
| **N5** | Mavjud `inventory-variance` hisobotini kengaytirish | server, web | 🔵 | REJA |
| **N6** | Jonli smoke (kod yozilmaydi) | — | 🔴 qarz | REJA |

**Tartib sababi:** N1 poydevor va qo'riqchi — usiz N2 jonli qoldiqqa xavf tug'diradi.
N2 dan keyin sessiya server tomonda to'liq ishlaydi (TSD'siz ham, `curl` bilan sinaladi).
N3/N4 mustaqil, parallel bo'lishi mumkin. N5 — qulaylik. N6 hammasidan keyin.

---

## 5. Fazalar tafsiloti

### N1 — Migratsiya va post-qo'riqchisi

**Maqsad.** `inventories` hujjatini sanash sessiyasi sifatida ishlatish uchun **haqiqiy ustunlar**
(§2.2) va **ikki karra qo'llashdan qo'riqchi** (§2.1).

**Vazifalar.**

1. Prisma migratsiyasi — `inventories` ga:
   - `count_session Boolean @default(false)` — «bu TSD sanash sessiyasi»;
   - `counted_by String? @db.Uuid` — sessiyani ochgan omborchi (Employee);
   - `closed_at DateTime? @db.Timestamptz()`;
   - `confirmed_by String? @db.Uuid`, `confirmed_at DateTime? @db.Timestamptz()`;
   - indeks: `@@index([accountId, countSession, closedAt])`.
2. `inventory_positions` ga — sanoq qatori qaysi avto-hujjatni tug'dirgani:
   - `auto_doc_type String? @db.VarChar(10)` (`enter` | `loss`), `auto_doc_id String? @db.Uuid`,
     `auto_doc_name String? @db.VarChar(100)` (hujjat o'chirilsa ham raqam ko'rinsin — denormal).
3. 🔴 **Qo'riqchi** `inventory.service.ts` `transition()` da: `countSession = true` bo'lgan hujjat
   `post` ga o'ta OLMAYDI — `BadRequestException` («Sanash sessiyasi post qilinmaydi: qoldiq
   allaqachon avto-hujjatlar bilan tenglashgan»). `cancel` ham taqiqlanadi (u ham `applyDeltas`
   chaqiradi — `inventory.service.ts:1120`).
4. Yangi holat `counted` `state` ustunida (`VarChar(30)`, migratsiya kerak emas). Mavjud
   `draft/posted/cancelled` semantikasi o'zgarmaydi.
5. `update()` va `clone()` sessiya hujjatiga nisbatan: `countSession` hujjat **web'dan
   tahrirlanmaydi** (`update` → 400) — aks holda `deleteMany` sanoq izini yo'q qilardi.
   `clone()` esa `countSession` bayrog'ini **ko'chirmaydi** (nusxa oddiy qoralama bo'ladi).

**Qabul mezoni.**
- Migratsiya idempotent, lokal dev bazada yurdi; `pnpm --filter @moysklad/api typecheck` yashil.
- Yangi test: `countSession` hujjat `post` ga o'tmaydi (400), `cancel` ga ham (400);
  oddiy hujjat ikkalasiga ham avvalgidek o'tadi (orqaga moslik).
- Yangi test: `update()` sessiya hujjatini rad etadi; `clone()` bayroqni ko'chirmaydi.
- Mavjud `inventory.*.test.ts` to'plami **to'liq yashil** (raqam bilan).

<details><summary><b>N1 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) Avval `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` ni TO'LIQ o'qi —
   ayniqsa §2 (egasining qarorlari, 2.1 ikki karra qo'llash, 2.2 `attributes` tuzog'i),
   §3 (o'zgarmas qoidalar) va §5 dagi N1 bo'limini.
2) Sen FAQAT **N1 — Migratsiya va post-qo'riqchisi** fazasini bajarasan. `/tsd/count-sessions`
   sirtiga va `setCellStock` ilgagiga TEGMA — bu N2 ning ishi. «Yo'l-yo'lakay tuzatdim» TAQIQ.
3) 🔴 Belgi `attributes` ga YOZILMAYDI (§2.2 — `validateAndNormalize` begona kalitlarni
   jimgina tashlaydi). Faqat HAQIQIY ustunlar: `count_session`, `counted_by`, `closed_at`,
   `confirmed_by`, `confirmed_at`, hamda `inventory_positions` da `auto_doc_type/id/name`.
4) 🔴 Qo'riqchi: `countSession = true` hujjat `post` GA HAM, `cancel` GA HAM o'tmaydi —
   ikkalasi ham `applyDeltas` chaqiradi (`inventory.service.ts:940` va `:1120`).
   `update()` sessiya hujjatini rad etadi (u qatorlarni `deleteMany` qilib sanoq izini
   o'chirardi — `inventory.service.ts:588`), `clone()` esa bayroqni KO'CHIRMAYDI.
5) Migratsiyani AVVAL lokal dev bazada (`sherset_v2_dev` @ localhost) yugurtir va
   idempotentligini isbotla. Jonli bazaga TEGMA.
6) Testlar (§3 qoida 6): yangi testlar — post 400, cancel 400, oddiy hujjat ikkalasiga ham
   avvalgidek o'tadi (orqaga moslik), `update()` rad etadi, `clone()` bayroqni ko'chirmaydi;
   + mavjud `inventory.*.test.ts` to'plami TO'LIQ; + `pnpm --filter @moysklad/api typecheck`.
7) `git status` ni tekshir — ish daraxtida BEGONA ish turibdi (X-reja, J-reja);
   commitga begona fayl QO'SHMA (§3 qoida 9). Commit subject kichik harf.
8) Tugagach §6 ga «### N1 — …» hisobotini shablon bo'yicha yoz — shu jumladan
   «Ikki karra qo'llash qo'riqchisi» bandiga DALIL bilan yozma javob.
9) KEYINGI FAZANI BOSHLAMA. Hisobotni yozib TO'XTA.
```
</details>

---

### N2 — Sessiya sirti va `setCellStock` ilgagi

**Maqsad.** Omborchi TSD'da sessiya ochsin; ochiq sessiya davomida har sanoq **qo'shimcha
qator** sifatida yozilsin; yopilganda hujjat `counted` holatiga o'tsin.

**Vazifalar.**

1. Yangi **narxsiz** sirt (`apps/api/src/modules/tsd/`):
   - `POST /tsd/count-sessions` — `{ storeId }` bilan ochadi. Bir omborchida bir vaqtda
     **bitta ochiq sessiya** (takroriy so'rov mavjudini qaytaradi — idempotent).
   - `GET /tsd/count-sessions/active` — ochiq sessiya + hisoblagichlar
     (`cellCount`, `lineCount`, `surplusLines`, `shortageLines`). **Narx yo'q.**
   - `POST /tsd/count-sessions/:id/close` — `closedAt` va `state = 'counted'`.
   - Hujjat nomi mavjud `nextName()` ketma-ketligidan (`ИН-YYYY-NNNNN`) olinadi — ro'yxatda
     tabiiy ko'rinsin. `organizationId` — `setCellStock` dagidek birinchi tashkilot.
2. **Ilgak** `setCellStock` da (`store-address.service.ts`): amal oxirida, agar `userId` ning shu
   `storeId` da ochiq sessiyasi bo'lsa — `inventory_positions` ga **bitta qator qo'shiladi**:
   `cellId`, `cell` (nomi), `assortmentId`, `expectedQty = oldQty`, `actualQty = finalQty`,
   `varianceQty = delta`, `cost_minor = NULL`, `auto_doc_*` = yozilgan hujjat.
   - 🔴 **Append**, `update()` EMAS: `inventory.update()` qatorlarni `deleteMany` qiladi
     (`inventory.service.ts:588`) — sanoq izi yo'qolardi.
   - 🔴 **Sanoq yo'li sessiyaga BOG'LIQ EMAS:** qator yozish xato bersa ham sanoqning o'zi
     muvaffaqiyatli qaytadi (iz qatlami hech qachon omborchini bloklamaydi). Xato loglanadi.
   - `mode: 'add'` da ham `expectedQty`/`actualQty` **mutlaq** sonlar bo'ladi (`oldQty`/`finalQty`),
     `varianceQty` esa aynan `delta` — hisobot ikkala rejimda bir xil o'qiladi.
   - K5: `pieceEntry` bo'lsa u ham qatorga ko'chiriladi (bo'linadigan tovar izi).
3. `tsd-policy.ts` ga uchta qator (`exact`) + `tsd-policy.test.ts`: yangi qatorlar ochilgani,
   `/products` va `/inventories` hamon **YOPIQ** (mavjud `/inventories` javobida `sumMinor`
   va `costMinor` bor — TSD unga hech qachon tegmaydi).
4. Ruxsat: sessiya ochish/yopish `storekeeper` da bor bo'lgan yacheyka amali ruxsatiga tayanadi
   (yangi ruxsat kiritilmaydi — `role-templates.ts` tegilmaydi; agar tegishi kerak bo'lsa
   hisobotda alohida asoslanadi).
5. 🟡 **T-reja T6 dan meros qolgan qarz — `getCellProducts` da `deletedAt: null` filtri YO'Q**
   (`store-address.service.ts:407–417`; T6 hisobotining 2-bandi buni T11 ga yo'naltirgan,
   2026-09-04 da koddan qayta tasdiqlandi). `getCellStock` da filtr BOR, `getCellProducts` da
   yo'q ⇒ javobga **yumshoq o'chirilgan** tovar tushadi va u sanalganda server **404** beradi.

   ⚠️ **2026-09-05 da QAYTA BAHOLANDI — bandning shoshilinchligi TUSHDI.** T-rejaning **T12**
   fazasi (2026-09-04, `5d66e612`) TSD ilovasidagi «biriktirilgan» guruhini butunlay olib
   tashladi va ilova endi bu maydonni **umuman o'qimaydi** (koddan tasdiqlandi:
   `grep -rn "cells/.*products" android/tsd-app/…` — bitta ham iz yo'q). Ya'ni «TSD ro'yxatiga
   o'lik tovar tushadi» degan asl sabab **endi mavjud emas** va sessiya qatori ham o'sha 404 ni
   olmaydi. Qolgan iste'molchilar: **web'ning «Ko'rish» ekrani** va TSD allowlist'idagi
   `/admin/stores/:id/cells/:cellId/products` yo'li (ochiq, lekin ilova chaqirmaydi).

   Shuning uchun: tuzatish **hamon to'g'ri va qilinsin**, lekin N2 hisobotida uni «sessiya izini
   qutqaradi» deb **asoslamang** — bu yolg'on bo'lardi. Haqiqiy asos: web «Ko'rish» ekranida
   o'chirilgan tovar ko'rinmasin va ikki endpoint bir xil qoidaga bo'ysunsin. O'zgarish
   **oldi/keyin qator soni bilan** ko'rsatiladi va egasiga aytiladi. Agar N2 agenti bu bandni
   fazaning hajmi uchun og'ir deb topsa — uni alohida kichik ishga ajratishi mumkin.

**Qabul mezoni.**
- Yangi testlar: sessiya ochish idempotent; sanoq qator qo'shadi (`expected/actual/variance`
  raqamlari `stock_by_cell` bilan mos); sessiya yo'q bo'lsa sanoq **avvalgidek** ishlaydi
  (orqaga moslik); qator yozish xatosi sanoqni yiqitmaydi.
- Yangi test: `getCellProducts` yumshoq o'chirilgan tovarni QAYTARMAYDI (5-vazifa).
- `tsd-policy.test.ts` yashil, `/products` va `/inventories` yopiqligi test bilan isbotlangan.
- Javob namunasi hisobotda keltiriladi va unda **narx maydoni yo'qligi** `select` oq ro'yxati
  bilan yozma isbotlanadi («ekranda ko'rsatmayapmiz» — isbot EMAS).

<details><summary><b>N2 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` ni TO'LIQ o'qi (§2, §3,
   §5-N2 va N1 hisoboti). F-rejadagi «faqat yacheyka kesimi» qoidasini va T-rejaning
   T6 hisobotini ham ko'r.
2) Sen FAQAT **N2 — Sessiya sirti va `setCellStock` ilgagi** fazasini bajarasan.
   Ilovaga (N3) va web'ga (N4) TEGMA — sirt test va `curl` bilan sinaladi.
3) 🔴 AVVAL N1 qo'riqchisi joyida ekanini tekshir (post/cancel taqiqi + ustunlar).
   Yo'q bo'lsa TO'XTA va hisobotga yoz — qo'riqchisiz bu faza jonli qoldiqqa xavf
   tug'diradi (§2.1).
4) 🔴 Ilgak **append** qiladi, `inventory.update()` EMAS (u `deleteMany` qiladi —
   `inventory.service.ts:588`). Va sanoq yo'li sessiyaga BOG'LIQ EMAS: iz qatori
   yozilmasa ham sanoqning o'zi muvaffaqiyatli qaytadi, xato loglanadi. Test bilan isbotla.
5) `mode: 'add'` da ham `expectedQty`/`actualQty` MUTLAQ sonlar (`oldQty`/`finalQty`),
   `varianceQty` — aynan `delta`. K5: `pieceEntry` bo'lsa qatorga ko'chiriladi.
6) 🔴 Narx qoidasi: sessiya qatorlarida `cost_minor` NULL; javobda narx yo'qligi `select`
   oq ro'yxati bilan YOZMA isbotlanadi («ekranda ko'rsatmayapmiz» — isbot EMAS).
   `tsd-policy.ts` ga faqat uchta `exact` qator; `/products` va `/inventories` HAMON YOPIQ —
   `tsd-policy.test.ts` bilan isbotlansin.
7) 5-vazifa: `getCellProducts` da `deletedAt: null` filtri yo'q
   (`store-address.service.ts:407-417`) — T6 dan qolgan qarz. Tuzat va hisobotda
   o'zgarish OLDI/KEYIN qator soni bilan ko'rsat (u web'ning «Ko'rish» ekraniga ham
   tegadi) — natija egasiga aytiladi.
8) Ruxsat: mavjud yacheyka amali ruxsatiga tayan; `role-templates.ts` ga tegilsa —
   hisobotda alohida asoslansin.
9) Testlar: yangi testlar + `tsd-policy.test.ts` + `pnpm --filter @moysklad/api typecheck`.
   `git status` — begona fayl commitga qo'shilmasin.
10) Tugagach §6 ga «### N2 — …» hisobotini yoz (javob namunasi bilan).
    KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### N3 — TSD ilova: sessiyani boshlash va yopish

**Maqsad.** Omborchi bitta tugma bilan sessiya ochsin va yopsin; ochiq sessiya doim ko'rinib tursin.

**Vazifalar.** `HomeScreen` da sessiya kartochkasi («Sanash sessiyasi ochiq · 14 yacheyka ·
37 qator · 09:12 dan beri») + «Boshlash»/«Yopish» tugmalari; `CountScreen` sarlavhasida ochiq
sessiya belgisi; yopishda tasdiq dialogi (yig'ma: nechta yacheyka, nechta ortiqcha/kam qator).
`ApiClient` ga uchta metod (transport mantig'iga tegmasdan — T-reja qoida 10).

**Cheklovlar.**
- 🔴 Sessiya amallari **oflayn navbatga qo'yilmaydi** (sanashning o'zi ham qo'yilmaydi —
  T-reja §1.4). Aloqa yo'q bo'lsa tugma o'chadi va sabab yoziladi.
- T10 keshi sessiya holatini keshlashi mumkin (faqat KO'RSATISH uchun); keshdan **yozish
  qarori chiqmaydi**.
- Narx yo'q.

**Qabul mezoni.** `assembleDebug` ogohlantirishsiz yashil; ochiq sessiyada sanash oldingidek
ishlaydi; sessiyasiz sanash ham ishlaydi (ilova sessiyani MAJBUR qilmaydi).

<details><summary><b>N3 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` (§2, §3, §5-N3 va N2
   hisoboti) hamda T-rejaning §1.4 va qoida 10 ini o'qi.
2) Sen FAQAT **N3 — TSD ilova: sessiyani boshlash va yopish** fazasini bajarasan.
   Server fayllariga BITTA BAYT ham tegma — sirt N2 da tayyor.
3) 🔴 Sessiya amallari oflayn navbatga QO'YILMAYDI (sanashning o'zi ham qo'yilmaydi).
   Aloqa yo'q bo'lsa tugma o'chadi va SABAB ekranda yoziladi. T10 keshi sessiya holatini
   faqat KO'RSATISH uchun keshlashi mumkin — keshdan yozish qarori CHIQMAYDI.
4) 🔴 Ilova sessiyani MAJBUR qilmaydi: sessiyasiz sanash avvalgidek ishlaydi,
   ochiq sessiyada ham sanash oqimi o'zgarmaydi. Ilovada narx yo'q.
5) `ApiClient` ga uchta metod — transport mantig'iga (retry/timeout/auth) TEGMASDAN.
   `HomeScreen` da sessiya kartochkasi + «Boshlash»/«Yopish» tugmalari, `CountScreen`
   sarlavhasida ochiq sessiya belgisi, yopishda yig'ma tasdiq dialogi.
6) Build (§3 qoida 6): `cd android/tsd-app && JAVA_HOME=D:/dev/java/jdk-17
   ANDROID_HOME=D:/dev/android-sdk /d/dev/_downloads/g87/gradle-8.7/bin/gradle
   --no-daemon assembleDebug` — **ogohlantirishsiz** yashil. Gradle 8.7; 9.x AGP 8.5.0
   bilan MOS EMAS.
7) `git status`: ish daraxtida begona ish bor — commitga qo'shma.
8) Tugagach §6 ga «### N3 — …» hisobotini yoz. KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### N4 — Web: farqlar hisoboti va tasdiqlash

**Maqsad.** Bosh omborchi yopilgan sessiyani ko'rib **tasdiqlasin**.

**Vazifalar.**

1. Yangi sahifa `/omborchi/sanash` (mavjud `omborchi/*` bo'limi yonida): yopilgan/ochiq
   sessiyalar ro'yxati — sana, ombor, omborchi, yacheyka soni, ortiqcha/kam qatorlar,
   tasdiq holati.
2. Sessiya detali: qatorlar (yacheyka · tovar · tizimda · sanaldi · farq · hujjat raqami),
   yacheyka bo'yicha guruhlash, farq bo'yicha saralash.
3. **«Tasdiqlayman»** tugmasi — `POST /inventories/:id/confirm-count` (`warehouse_manager`).
   🔴 Tasdiq **qoldiqqa tegmaydi**: faqat `confirmed_by`/`confirmed_at` yoziladi + audit yozuvi.
4. Sessiya hujjati oddiy `/inventories` ro'yxatida ham ko'rinadi — u yerda «Провести» tugmasi
   **o'chirilgan** bo'lishi kerak (server baribir rad etadi — N1 qo'riqchisi; UI faqat
   noto'g'ri kutishning oldini oladi).
5. i18n: barcha matnlar ru+uz.

**Qabul mezoni.** `pnpm i18n:gate` yashil; tasdiqdan keyin `stock_by_cell` **bir tiyin
o'zgarmagani** test bilan isbotlangan; ruxsatsiz foydalanuvchida tugma yo'q va endpoint 403.

<details><summary><b>N4 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` ni TO'LIQ o'qi
   (§2, §3, §5-N4 va N1/N2 hisobotlari).
2) Sen FAQAT **N4 — Web: farqlar hisoboti va tasdiqlash** fazasini bajarasan.
   Ilovaga (N3) va `inventory-variance` hisobotiga (N5) TEGMA.
3) 🔴 «Tasdiqlayman» QOLDIQQA TEGMAYDI — faqat `confirmed_by`/`confirmed_at` + audit yozuvi.
   Buni test bilan isbotla: tasdiqdan keyin `stock_by_cell` BIR TIYIN o'zgarmaydi.
4) Ruxsat — `warehouse_manager`. Ruxsatsiz foydalanuvchida tugma YO'Q **va** endpoint 403;
   ikkalasi ham tekshiriladi (faqat UI da yashirish — isbot EMAS).
5) Sessiya hujjati oddiy `/inventories` ro'yxatida ham ko'rinadi — u yerda «Провести»
   tugmasi O'CHIRILGAN bo'lsin (server baribir rad etadi — N1 qo'riqchisi; UI faqat
   noto'g'ri kutishning oldini oladi).
6) Sahifa `/omborchi/sanash`: ro'yxat (sana, ombor, omborchi, yacheyka soni,
   ortiqcha/kam qatorlar, tasdiq holati) + detal (yacheyka · tovar · tizimda · sanaldi ·
   farq · hujjat raqami), yacheyka bo'yicha guruhlash, farq bo'yicha saralash.
7) i18n: barcha matnlar ru+uz; `pnpm i18n:gate` yashil (`i18n-key-existence`,
   `i18n-no-hardcoded`). `git status` — begona fayl commitga qo'shilmasin.
8) Tugagach §6 ga «### N4 — …» hisobotini yoz. KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### N5 — Mavjud `inventory-variance` hisobotini kengaytirish

**Maqsad.** `reports/inventory-variance` sanash sessiyalarini ham ko'rsatsin.

**Vazifalar.** `inventory-variance.service.ts` dagi `AND i.state = 'posted'` shartini
`AND i.state IN ('posted', 'counted')` ga kengaytirish + filtr («faqat sessiyalar» / «faqat
hujjatlar»). ⚠️ Sessiya qatorlarida `cost_minor` NULL ⇒ `varianceCostMinor` ular uchun **0**
bo'ladi — bu ATAYLAB (narx qoidasi) va hisobot ustunida izohlanadi, aks holda bosh omborchi
«farq 0 so'm» ni «farq yo'q» deb o'qirdi.

**Qabul mezoni.** Mavjud `inventory-variance.schema.test.ts` va sana-mintaqa testlari yashil;
yangi test: sessiya hujjati hisobotga tushadi va `varianceCostMinor = 0` ekani hujjatlangan.

<details><summary><b>N5 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2, branch yacheyka-inventarizatsiya).

1) `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` (§2, §3, §5-N5 va
   avvalgi fazalar hisobotlari) ni o'qi.
2) Sen FAQAT **N5 — mavjud `inventory-variance` hisobotini kengaytirish** fazasini
   bajarasan. O'zgarish TOR: `AND i.state = 'posted'` → `AND i.state IN ('posted','counted')`
   + filtr («faqat sessiyalar» / «faqat hujjatlar»). Hisobotning boshqa mantig'iga tegma.
3) 🔴 Sessiya qatorlarida `cost_minor` NULL ⇒ ular uchun `varianceCostMinor = 0`.
   Bu ATAYLAB (narx qoidasi, §3 qoida 4), xato EMAS. Ustunda IZOH bo'lishi SHART —
   aks holda bosh omborchi «farq 0 so'm» ni «farq yo'q» deb o'qiydi. Izoh ru+uz.
4) Testlar: mavjud `inventory-variance.schema.test.ts` va sana-mintaqa testlari yashil;
   yangi test — sessiya hujjati hisobotga tushadi va `varianceCostMinor = 0` ekani
   hujjatlangan. Web tegilsa `pnpm i18n:gate`.
5) `git status` — begona fayl commitga qo'shilmasin.
6) Tugagach §6 ga «### N5 — …» hisobotini yoz. KEYINGI FAZANI BOSHLAMA. TO'XTA.
```
</details>

---

### N6 — Jonli smoke (kod yozilmaydi)

**Vazifalar.** Jonli terminalda (iData 95W Pro) sessiya ochish → 2–3 yacheyka sanash →
yopish → web'da tasdiqlash. Har bosqichda `packages/db` dan `npx tsx scripts/warehouse-state.ts`
(oldin va keyin) — **POS yeta olmaydigan qoldiq 0, EXIT=0**. Sanalgan yacheykalarning
`stock_by_cell` raqamlari hisobotdagi «sanaldi» ustuni bilan **aynan** teng bo'lishi tekshiriladi.

**Qabul mezoni.** Yuqoridagilarning hammasi raqam bilan hisobotda; ikki karra qo'llash
YO'Qligi jonli o'lchov bilan tasdiqlangan (sanalgan tovar qoldig'i sessiya yopilgandan keyin
o'zgarmaydi).

<details><summary><b>N6 sessiyasi uchun PROMPT</b></summary>

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` ni TO'LIQ o'qi —
   ayniqsa N1…N5 hisobotlarining «Ochiq qolganlar» bandlarini — va
   `docs/ops/jonli-holat.md` ni.
2) Sen FAQAT **N6 — Jonli smoke** fazasini bajarasan. 🔴 KOD YOZILMAYDI. Nuqson topilsa —
   u hisobotga TOPILMA sifatida yoziladi, tuzatish alohida sessiyada qilinadi.
3) Bu faza ASOSAN OPERATSIYA: omborchiga ANIQ ko'rsatma tayyorla, jonli terminalda
   (iData 95W Pro) sessiya ochish → 2-3 yacheyka sanash → yopish → web'da bosh omborchi
   tasdiqlashi zanjirini kuzat va HAR bosqichni o'lchab yoz.
4) Har bosqichda (oldin va keyin) `packages/db` dan `npx tsx scripts/warehouse-state.ts`:
   POS yeta olmaydigan qoldiq **0**, **EXIT=0**.
5) 🔴 Ikki karra qo'llash YO'Qligini JONLI o'lchov bilan isbotla: sanalgan tovarning
   `stock_by_cell` raqami sessiya YOPILGANDAN va TASDIQLANGANDAN keyin O'ZGARMAYDI
   va hisobotdagi «sanaldi» ustuniga AYNAN teng.
6) Jonliga tegilgan bo'lsa `docs/ops/jonli-holat.md` reyestriga ham yoz.
7) §6 ga «### N6 — …» hisobotini RAQAMLAR bilan yoz. TO'XTA.
```
</details>

---

## 6. Hisobotlar

> Har faza agenti O'Z sarlavhasi ostiga yozadi. Shablon T-reja §5 dagi bilan bir xil:
>
> ```
> ### N<N> — <nom> · <HOLAT: TUGADI | QISMAN — nima kutilmoqda> · <sana> · `<commit>`
>
> **Nima qilindi:** (fayllar bo'yicha, qaror sabablari bilan)
> **O'lchandi:** (build/test natijalari RAQAM bilan)
> **Qabul mezoni:** har band ✔/✘
> **Ikki karra qo'llash qo'riqchisi:** (qoida 3 — dalil bilan)
> **Qaysi oqimni buzishi mumkin?** (dalil bilan)
> **Ochiq qolganlar / keyingi fazaga eslatmalar:**
> ```

### N0 — Reja tuzildi · 2026-09-04

Reja T-reja T11 sessiyasida tuzildi. Kontekst koddan **o'qib** o'lchandi (taxmin emas):

- `setCellStock` avto-hujjat yo'li — `store-address.service.ts:443–595`;
- `Inventory` / `InventoryPosition` modellari (`cellId`, `expectedQty`, `actualQty`,
  `varianceQty`, `costMinor`, `pieceEntry`) — `packages/db/prisma/schema.prisma:7583–7680`;
- `transition('post')` → `stock.applyDeltas` — `inventory.service.ts:940`;
  `cancel` → `applyDeltas` — `inventory.service.ts:1120`;
- `update()` qatorlarni `deleteMany` bilan almashtiradi — `inventory.service.ts:~588`;
- `validateAndNormalize` begona `attributes` kalitlarini tashlaydi —
  `attribute-metadata.service.ts:172–196`;
- `inventory-variance` hisoboti `state = 'posted'` bilan cheklangan va `varianceCostMinor`
  (narx) beradi — `report/inventory-variance.service.ts:100–125`;
- TSD allowlist (`auth/tsd-policy.ts`) default-deny, `/products` va `/inventories` yopiq.

**Kod yozilmadi.** Ijro N1 dan boshlanadi.

---

### N1 — Migratsiya va post-qo'riqchisi · **TUGADI** · 2026-09-05 · `ace7876b`

**Nima qilindi**

| Fayl | Nima |
|---|---|
| `packages/db/prisma/schema.prisma` (+35) | `Inventory` ga `countSession`/`countedBy`/`closedAt`/`confirmedBy`/`confirmedAt` + `@@index([accountId, countSession, closedAt])`; `InventoryPosition` ga `autoDocType`/`autoDocId`/`autoDocName` |
| `packages/db/prisma/migrations/20260904120000_inventory_count_session/migration.sql` (yangi, 39) | Sof additiv DDL, `IF NOT EXISTS` bilan |
| `packages/db/scripts/rollback/20260904120000_inventory_count_session_down.sql` (yangi, 44) | Teskari yo'l (F-reja 2-bo'lim, 12-qoida) |
| `apps/api/src/modules/inventory/inventory.service.ts` (+61) | `assertNotCountSession()` qo'riqchisi + uchta chaqiruv nuqtasi (`transition`, `update`, `clone`) |
| `apps/api/src/modules/inventory/inventory.count-session.test.ts` (yangi, 305) | 10 ta xulq testi |

**Qaror sabablari**

1. **Ustunlar, `attributes` EMAS** (§2.2 talab qilgani). Belgini `attributes` da saqlash
   qo'riqchini web'dagi birinchi tahrirda o'chirib yuborardi.
2. **`counted_by` / `confirmed_by` da FK YO'Q** — `restock_task_lines.shortage_by_id`
   naqshi. Iz qatlami xodim yozuvi o'chirilganda ham qolishi kerak; `ON DELETE SET NULL`
   esa «kim sanadi» degan yagona javobni yo'q qilardi.
3. **`auto_doc_name` denormal** — avto-hujjat keyinchalik o'chirilsa ham bosh omborchi
   qog'ozdagi raqamni ko'radi.
4. **Qo'riqchi bitta funksiyada** (`assertNotCountSession`), uchta amal uchun uchta
   o'ziga xos xabar bilan. `transition()` da u `withSerializationRetry` closure'i ICHIDA,
   `findById` dan keyin — ya'ni post va cancel ning YAGONA umumiy kirish nuqtasida:
   kelajakda yangi transition qo'shilsa ham qo'riqchidan o'tib ketolmaydi.
5. **`clone()` da `countSession: false` OSHKORA yoziladi** (ustun defaultiga tayanmasdan) —
   niyat kodda ko'rinsin va test uni tekshira olsin.
6. **`prisma format` ATAYLAB qaytarildi:** u sxemaning 172 ta begona qatorini qayta
   tekislagan edi (parallel sessiyaning `Role.templateSlug` ishi tufayli). Diff faqat
   35 qator — §3 qoida 2 («yo'l-yo'lakay tuzatdim» TAQIQ).

**O'lchandi**

*Migratsiya — lokal `sherset_v2_dev` @ `localhost:5432` (jonli bazaga TEGILMADI):*

| Bosqich | Natija |
|---|---|
| UP #1 | 9 ta DDL bayonot, `EXIT=0` |
| UP #2 (idempotentlik) | 9 ta `NOTICE: ... already exists, skipping`, `EXIT=0` — **no-op** |
| Zond: ustunlar | 8/8 mavjud; `count_session` = `boolean NOT NULL DEFAULT false`, qolgan 7 tasi **nullable**, defaultsiz; `auto_doc_type` = `varchar(10)`, `auto_doc_name` = `varchar(100)` |
| Zond: indeks | `CREATE INDEX ... ON public.inventories USING btree (account_id, count_session, closed_at)` |
| Zond: mavjud ma'lumot | 51 hujjat — `count_session = true` **0 ta**, `counted_by` to'ldirilgan **0 ta**; 4729 qator — `auto_doc_*` to'ldirilgan **0 ta** |
| Zond: FK | `inventories` da 6 ta FK — `counted_by`/`confirmed_by` ular orasida **YO'Q** (ataylab) |
| DOWN #1 | 9 ta DDL, `EXIT=0`, qolgan ustun **0** |
| DOWN #2 (idempotentlik) | 9 ta `NOTICE ... skipping`, `EXIT=0` — **no-op** |
| DOWN dan keyin ma'lumot | 51 hujjat / 4729 qator — **o'zgarmadi** |
| UP (qayta) | 8/8 ustun qaytdi; 51 / 4729 — **o'zgarmadi** |

*Sxema ↔ baza mosligi:* `prisma migrate diff --from-url <dev> --to-schema-datamodel` — 99 qator
drift qaytdi, ammo ular **faqat** `driver_cash_handovers`, `equipment`, `expense_budgets`,
`manager_*`, `retail_sale*`, `sales_plans`, `stock_pieces`, `store_cells`, `tsd_devices`
jadvallariga tegishli (dev baza `20260822` dan keyingi migratsiyalarni olmagan).
`inventories` va `inventory_positions` bo'yicha **drift 0** — ya'ni yozilgan SQL sxema
e'lon qilgan narsani AYNAN takrorlaydi.

*Testlar:*

| Buyruq | Natija |
|---|---|
| `npx vitest run src/modules/inventory/` | **6 fayl / 58 test yashil** (shundan yangi fayl — 10 test) |
| `npx vitest run src/modules/auth/tsd-policy.test.ts src/modules/report/` | **44 fayl / 444 test yashil** |
| `pnpm --filter @moysklad/api typecheck` | **yashil** (xatosiz) |
| `pnpm --filter @moysklad/db typecheck` | **yashil**, `EXIT=0` |
| `npx biome check` (2 ta tegilgan TS fayl) | **yashil** |
| `npx prisma validate` | «The schema ... is valid» |

**Qabul mezoni**

- ✔ Migratsiya idempotent, lokal dev bazada yurdi (UP → UP → zond → DOWN → DOWN → UP).
- ✔ `pnpm --filter @moysklad/api typecheck` yashil.
- ✔ Yangi test: `countSession` hujjat `post` ga o'tmaydi (400), `cancel` ga ham (400).
- ✔ Yangi test: oddiy hujjat ikkalasiga ham avvalgidek o'tadi (orqaga moslik).
- ✔ Yangi test: `update()` sessiya hujjatini rad etadi; `clone()` bayroqni ko'chirmaydi.
- ✔ Mavjud `inventory.*.test.ts` to'plami to'liq yashil — **58/58**.

**Ikki karra qo'llash qo'riqchisi (§3 qoida 3) — DALIL**

Qo'riqchi `transition()` da `findById` dan keyin, `post()`/`cancel()` ga kirishdan OLDIN
turadi (`inventory.service.ts`, `withSerializationRetry` closure'i ichida). Ya'ni
`applyDeltas` ga olib boradigan ikkala yo'l ham **bir xil to'siqdan** o'tadi.

Test buni **soxta tranzaksiya orqali o'lchaydi**, nafaqat «400 qaytdi» deb: `makeTx()`
har bir qoldiq yozuvini (`stock.upsert`, `stockByCell.upsert`, `stockByCell.update`,
`stockOperation.createMany`) va har bir holat-da'vosini (`inventory.updateMany`)
ro'yxatga yozadi. Sessiya hujjatida:

```
post:   stockTouches = []   stateClaims = []
cancel: stockTouches = []   stateClaims = []
```

— ya'ni qoldiqqa **birorta bayt** yozilmadi va hujjat holati hatto da'vo ham qilinmadi.
Bayroqsiz hujjatda esa o'sha ro'yxatda `stockByCell.upsert` va `stock.upsert` **bor**
(orqaga moslik: bugungi jonli yo'l qimirlamadi). `update()` uchun ayni dalil —
`positionDeletes = []` (sanoq izi o'chmadi), bayroqsiz hujjatda esa `positionDeletes`
uzunligi **1** (avvalgidek ishlaydi).

Qo'shimcha struktura dalili: qo'riqchi tashlaydigan `BadRequestException` — biznes
xatosi, `withSerializationRetry` uni qayta urinmaydi (u faqat 40001 serializatsiya
konfliktini qayta uradi), ya'ni «bir necha urinishdan keyin baribir o'tib ketish»
yo'li ham yopiq.

**Qaysi oqimni buzishi mumkin? (dalil bilan)**

1. **Bugungi sanash oqimi — buzilmaydi.** `setCellStock` ga BIR BAYT ham tegilmadi
   (commit tarkibida `store-address.service.ts` yo'q). Sessiya hali hech qayerda
   ochilmaydi (`countSession` ni yozadigan kod N2 da), demak jonlida bayroq **hamma
   joyda `false`** — 51 hujjat / 4729 qator zondi buni tasdiqladi. Qo'riqchi
   `doc.countSession !== true` da **darhol qaytadi**, ya'ni mavjud `post`/`cancel`/
   `update`/`clone` yo'llari o'zgarmagan.
2. **`/inventories` javobiga 5 ta yangi maydon qo'shiladi** (Prisma default `select`
   hamma skalyar ustunni beradi). Bu web uchun **additiv** — mavjud ekranlar bilmagan
   maydonni e'tiborsiz qoldiradi. Narx maydoni QO'SHILMADI (`cost_minor` tegilmadi),
   TSD allowlist'da `/inventories` **hamon yopiq** (`tsd-policy.test.ts` yashil).
3. **Migratsiya jonliga chiqqanda** — `ALTER TABLE ... ADD COLUMN`. `count_session` da
   `NOT NULL DEFAULT false` bor: PostgreSQL 11+ da bu jadvalni **qayta yozmaydi**
   (default katalogda saqlanadi), qolgan 7 tasi nullable — ya'ni qulf qisqa, kassa/sotuv
   oqimiga ta'sir kutilmaydi. Indeks esa `CREATE INDEX` (CONCURRENTLY EMAS) —
   `inventories` kichik jadval, lekin deploy paytida qisqa yozuv-qulfi bo'ladi;
   N6 smoke rejasiga kiritilsin.
4. **Qaytarish yo'li yozildi va lokal bazada sinaldi** (yuqoridagi jadval).
   Skript ichida ochiq ogohlantirish bor: ustun qaytarilsa **qo'riqchi ham yo'qoladi** —
   shuning uchun qaytarishdan oldin `count_session = true` hujjatlar sanab chiqiladi.

**Commit gigienasi**

`git status` ish daraxtida parallel sessiyalar ishini ko'rsatdi (X-reja `hr/attendance-geo`,
J-reja skriptlari, `auth/*`, `permissions/role-templates.*`). Commit `ace7876b` da
**faqat 5 ta o'z faylim** + `docs/progress.json` bor. `progress.json` — pre-commit
hook'ining avtomatikasi (diff = `generatedAt` vaqt muhri, 2 qator); shu repoda avvalgi
hisobotlarda ham (kassa F1/F2/F3) aynan shunday qayd etilgan.

**Parallel sessiyaga xalaqit — ochiq aytiladi.** Commit paytida indeksda X-reja
sessiyasining fayllari ham turgan edi (ular o'z commitini `reset --soft` qilib qayta
stage qilishgan). Ularni commitimga qo'shmaslik uchun `git restore --staged` bilan
indeksdan chiqardim — ya'ni **ularning stage holatini bir muddat buzdim**. Ish daraxti
va commit tarixi tegilmadi (`reset --soft` ularniki, reflog `HEAD@{1}` da ko'rinadi,
commit `778a3fa2` reflogdan tiklanadi); stage holati `git add` bilan darhol qaytarildi
va `git status` bilan tasdiqlandi.

Keyingi fazalarga xulosa: bu repoda **`git commit -- <yo'llar>`** ishlamaydi —
`lint-staged` butun daraxtni stash qilgani uchun «No staged files found» deb commit'ni
bekor qiladi. Yagona ishonchli yo'l — indeksda faqat o'z fayllaringni qoldirib, oddiy
commit qilish (va tugagach begonalarini qaytarish).

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. 🔴 **N2 uchun:** `state = 'counted'` qiymatini hali HECH KIM yozmaydi va yoza olmaydi —
   `InventoryStateSchema` (`inventory.schema.ts:4`) `['draft','posted','cancelled']` bilan
   cheklangan. Sessiya yopishda `counted` yozilishi uchun **o'sha zod enum'i kengaytirilishi
   kerak** (ustunning o'zi `VarChar(30)`, migratsiya kerak emas — reja shuni aytgan,
   koddan tasdiqlandi). Ro'yxat filtri ham shu enumdan foydalanadi.
2. 🔴 **N2 uchun:** `delete()` sessiya hujjatini bloklamaydi — u `state === 'draft'` bo'lsa
   soft-delete qiladi. Ochiq sessiya (`draft`) shu yo'l bilan **izsiz yo'qolishi mumkin**.
   Qo'riqchiga `delete` amali qo'shilsinmi — bu N2 ning qarori (hozircha sessiya ochadigan
   sirt yo'q, ya'ni jonli xavf yo'q).
3. ⚠️ **Migratsiyalar zanjiri boshidan qayta o'ynatilmaydi** — bu N1 dan OLDIN mavjud
   qarz: `prisma migrate diff --from-migrations` `20260802180000_manager_daily_kpi` da
   `relation "driver_cash_handovers" already exists` bilan yiqiladi (mening migratsiyam
   `20260904`, ya'ni undan ancha keyin). Ta'siri: toza bazani faqat `migrate deploy`
   bilan ko'tarib bo'lmaydi va `prisma migrate dev` shadow bazasi ishlamaydi.
   Tuzatish — alohida sessiya ishi.
4. ⚠️ **Lokal dev baza `sherset_v2_dev` `20260822` dan keyingi migratsiyalarni olmagan**
   (yuqoridagi drift ro'yxati). Bu N1 ni sinashga xalal bermadi (`inventories` va
   `inventory_positions` to'liq mos), lekin N2 sirtini lokal sinaydigan agent buni
   bilib qo'ysin.
5. `attributes` bo'yicha eslatma: sessiya belgisi ustunda bo'lgani bilan, kelajakda
   kimdir `attributes.__countSession` yozib qo'ymasin — u **hech qanday kuchga ega emas**
   (`validateAndNormalize` uni tashlaydi, qo'riqchi esa faqat ustunni o'qiydi).
---

### N2 — Sessiya sirti va `setCellStock` ilgagi · **TUGADI** · 2026-09-05 · `847ad63f`

**0. N1 qo'riqchisi joyidami? (prompt 3-bandi — TEKSHIRILDI, JOYIDA)**

Fazani boshlashdan oldin koddan o'qib tasdiqlandi:

| Nima | Qayerda | Holat |
|---|---|---|
| `count_session`/`counted_by`/`closed_at`/`confirmed_by`/`confirmed_at` | `schema.prisma:7624–7634` | ✔ ustunlar bor |
| `auto_doc_type`/`auto_doc_id`/`auto_doc_name` | `schema.prisma:7705–7707` | ✔ |
| `@@index([accountId, countSession, closedAt])` | `schema.prisma:7657` | ✔ |
| `assertNotCountSession` | `inventory.service.ts:136` | ✔ |
| `post`/`cancel` taqiqi (`transition` da, `findById` dan keyin) | `inventory.service.ts:697` | ✔ |
| `update` taqiqi | `inventory.service.ts:588` | ✔ |

Qo'riqchi joyida ⇒ faza bajarildi.

**Nima qilindi**

| Fayl | Nima |
|---|---|
| `apps/api/src/modules/tsd/count-session.ts` (yangi, 168) | SOF yadro: `COUNT_SESSION_SELECT` / `COUNT_SESSION_LINE_SELECT` oq ro'yxatlari, `summarizeCountSessionLines`, `buildCountSessionLine`, `COUNT_SESSION_STATE = 'counted'` |
| `apps/api/src/modules/tsd/count-session.service.ts` (yangi, 245) | `open` (idempotent) / `active` / `close` / `recordCount` (ilgak) |
| `apps/api/src/modules/tsd/count-session.controller.ts` (yangi, 45) | `POST /tsd/count-sessions`, `GET /tsd/count-sessions/active`, `POST /tsd/count-sessions/:id/close` |
| `apps/api/src/modules/tsd/tsd.module.ts` (+7) | Yangi kontroller/servis; `CountSessionService` EKSPORT qilinadi |
| `apps/api/src/modules/store/store.module.ts` (+4) | `TsdModule` import (bir tomonlama — halqa yo'q) |
| `apps/api/src/modules/store/store-address.service.ts` (+48) | 🔴 `setCellStock` ILGAGI (amal oxirida, `try/catch` da); `autoDoc` (id+nom) yig'ish; 5-vazifa: `getCellProducts` ga `deletedAt: null` |
| `apps/api/src/modules/auth/tsd-policy.ts` (+25) | Uchta `exact` qator + «bu javobda narx bormi?» ga yozma javob |
| `apps/api/src/modules/inventory/inventory-number.ts` (yangi, 33) | `nextInventoryName` — hujjat raqamining YAGONA manbai |
| `apps/api/src/modules/inventory/inventory.service.ts` (+18/−16) | `nextName` shu manbaga bog'landi; qo'riqchiga `delete` amali qo'shildi |
| `apps/api/src/modules/inventory/inventory.schema.ts` (+11) | `InventoryStateSchema` ga `counted` (faqat ro'yxat filtri uchun) |
| Testlar | `count-session.test.ts` (15), `count-session.service.test.ts` (24), `store-address-count-session.behaviour.test.ts` (11), `store-address-deleted-product.behaviour.test.ts` (4), `tsd-policy.test.ts` (+2), `inventory.count-session.test.ts` (+4), `inventory.schema.test.ts` (+2) |

**Qaror sabablari**

1. **`InventoryService` CHAQIRILMADI, alohida servis yozildi.** Uning `create()`
   yo'li `attributes` ni normalizatsiya qiladi, qatorlarni majburlaydi va
   sessiya bayrog'ini bilmaydi; `update()` esa `deleteMany` qiladi. Yagona
   umumiy narsa — hujjat RAQAMI, u `inventory-number.ts` ga ko'chirildi
   (nusxalansa ikkita hisoblagich paydo bo'lib, ikki hujjat bir nom bilan
   `(account_id, name)` unikaliga urilardi).
2. **Hujjat nomi — reja `ИН-YYYY-NNNNN` degan, KOD boshqa.** O'lchandi:
   `nextName` moysklad-parity **prefikssiz 5 xonali** raqam beradi (`00042`).
   Reja matni eskirgan; sessiya mavjud ketma-ketlikdan raqam oladi (niyat
   bajarildi), formati esa boshqa inventarizatsiya hujjatlari bilan bir xil.
3. **Bir omborchida bitta ochiq sessiya.** Shu omborda takroriy `open` —
   mavjudini qaytaradi (idempotent, terminal qayta yuborsa ro'yxat bo'sh
   hujjatlar bilan to'lmaydi). BOSHQA omborda ochiq sessiya bo'lsa — **400**,
   jimgina qaytarish emas: aks holda omborchi 02-omborni sanab, iz
   01-omborning hujjatiga tushardi.
4. **Yopilgan sessiyani qayta yopish — xato EMAS**, o'zgartirmasdan qaytadi
   (`closedAt` birinchi yopishnikidek qoladi). Terminal javobni olmasdan qayta
   yuborishi real hodisa; 400 omborchini chalg'itardi.
5. **`state = 'counted'` uchun `InventoryStateSchema` kengaytirildi** (N1
   hisobotining 1-bandi). Sabab FAQAT ro'yxat filtri (`InventoryFilterSchema`
   shu enumdan foydalanadi) — usiz N4 web'da `?state=counted` bilan
   sessiyalarni ajratib ololmasdi. `InventoryTransitionSchema` ATAYLAB
   tegilmadi: `counted` ga API orqali O'TIB bo'lmaydi (test bilan qulflandi).
6. **🔴 `delete()` qo'riqchisi QO'SHILDI** (N1 hisobotining 2-bandi qarorni N2
   ga qoldirgandi). N2 da xavf HAQIQIY bo'ldi: sessiya ochadigan sirt paydo
   bo'ldi, OCHIQ sessiya esa `state = 'draft'` da turadi — ya'ni `delete()`
   ning `state !== 'draft'` sharti uni **to'smasdi** va omborchining izi bir
   so'rov bilan yumshoq o'chib ketardi. Sessiyani «bekor qilish» yo'li — uni
   YOPISH, o'chirish emas.
7. **`position` raqami `_max + 1`.** `@@index([inventoryId, position])` unikal
   EMAS, ya'ni ikki parallel sanoq bir raqam olsa ham yozuv yiqilmaydi — eng
   yomoni ikki qator bir tartibda turadi (iz uchun zararsiz). Unikal cheklov
   qo'yish sanoqni bloklash xavfini tug'dirardi — qoida 3 ga zid.

**🔴 Narx qoidasi — YOZMA ISBOT (§3 qoida 4)**

«Ekranda ko'rsatmayapmiz» isbot emas, shuning uchun uch qavat:

1. **`select` OQ RO'YXATI.** Har so'rov `COUNT_SESSION_SELECT` bilan ketadi.
   Prisma `select` berilmasa HAMMA skalyar ustunni qaytaradi — shu jumladan
   `Inventory.sumMinor` («Стоимость»). Oq ro'yxatda u **YO'Q**:
   `id, name, storeId, state, countSession, countedBy, closedAt, confirmedBy,
   confirmedAt, moment, createdAt`. Qator hisoblagichlari uchun esa faqat
   `cellId, varianceQty`.
2. **Tur oq ro'yxatning aksi** (`CountSessionRow` — `tsd.service.ts` dagi
   `TsdProductRow` naqshi): kimdir `select` ga narx ustuni qo'shsa TypeScript
   uni o'tkazmaydi.
3. **Test soxta bazani ham NARXLI qiladi.** `count-session.service.test.ts`
   dagi fake `select` ni HURMAT QILADI va baza qatoriga ataylab
   `sumMinor: 123456n` qo'shadi. Javobda u **yo'q** — ya'ni kesish haqiqatda
   `select` bilan bo'layapti, fake soddaligidan emas.

Sessiya QATORLARIDA `cost_minor` — **NULL**: `buildCountSessionLine` u kalitni
umuman yozmaydi (`undefined` ham emas — kalitning O'ZI yo'q) va bu test bilan
qulflangan (`expect('costMinor' in row).toBe(false)`).

`/products` va `/inventories` — **HAMON YOPIQ**, `tsd-policy.test.ts` da
alohida test bilan: `/inventories`, `/inventories/:id`, `POST /inventories`,
`PUT /inventories/:id`, `/inventories/:id/transitions/post`,
`/inventories/position-meta`, `?state=counted` — hammasi `false`.

**Javob namunasi** (`GET /tsd/count-sessions/active`, haqiqiy koddan olingan):

```json
{
  "session": {
    "id": "ac1f0e2b-6d3a-4f21-9c88-5b0e1d7a4c33",
    "name": "00042",
    "storeId": "11111111-1111-4111-8111-111111111111",
    "state": "draft",
    "countSession": true,
    "countedBy": "9f2b1c40-77aa-4d15-8f60-2c1e9d8b3a71",
    "closedAt": null,
    "confirmedBy": null,
    "confirmedAt": null,
    "moment": "2026-09-05T09:12:00.000Z",
    "createdAt": "2026-09-05T09:12:00.000Z",
    "counters": { "cellCount": 2, "lineCount": 3, "surplusLines": 1, "shortageLines": 1 }
  }
}
```

Sessiya yo'q bo'lsa — `{ "session": null }`. `POST /tsd/count-sessions` va
`POST /tsd/count-sessions/:id/close` AYNI shaklni beradi (test bilan
qulflangan), yopilganida `state: "counted"` va `closedAt` — vaqt.

**O'lchandi**

| Buyruq | Natija |
|---|---|
| `npx vitest run src/modules/tsd/` | **5 fayl / 94 test yashil** (yangi: yadro 15, servis 24) |
| `npx vitest run src/modules/store/` | **15 fayl / 199 test yashil** (avval 13/184; yangi: ilgak 11, o'chirilgan tovar 4) |
| `npx vitest run src/modules/inventory/` | **6 fayl / 64 test yashil** (avval 6/58) |
| `npx vitest run src/modules/auth/tsd-policy.test.ts` | **26 test yashil** (avval 24) |
| `pnpm --filter @moysklad/api typecheck` | **yashil**, xatosiz |
| `npx biome check` (tegilgan modullar) | **xatosiz** (3 ta ogohlantirish — tegilmagan fayllarda, avvaldan bor) |
| To'liq `npx vitest run` (apps/api) | **709 fayl / 10 386 test**, 1 tasi qizil — **BEGONA ish**, quyida |

⚠️ **To'liq to'plamdagi yagona qizil — meniki EMAS.**
`src/modules/permissions/mutation-guard-coverage.test.ts` `HrDavomatPingController#myRemoteRequest`
(`/hr/attendance-geo/ping.controller.ts`) ni ro'yxatsiz mutatsiya deb topdi.
Bu fayl ish daraxtida **X-reja sessiyasining commit qilinmagan o'zgarishi**
(`git status`: `M apps/api/src/modules/hr/attendance-geo/ping.controller.ts`),
men unga bir bayt ham tegmadim. **Mening kontrollerim o'sha testdan O'TDI** —
uchala yo'lda ham `@RequirePermission` bor (ro'yxatda faqat bitta begona
element chiqdi).

**Qabul mezoni**

- ✔ Sessiya ochish **idempotent** — shu omborda takroriy `open` yangi hujjat
  ochmaydi (`inventory.create` chaqirilmagani bilan isbotlandi); boshqa
  omborda — 400.
- ✔ Sanoq **qator qo'shadi**; `expected/actual/variance` raqamlari
  `stock_by_cell` dan hisoblangan sonlar va `setCellStock` javobidagi
  (`previousQty`/`qty`) **AYNI stringlar** (test buni javob bilan solishtiradi).
- ✔ Sessiya yo'q bo'lsa sanoq **avvalgidek** ishlaydi (`recorded: false`, hech
  narsa yozilmaydi, xato yo'q) — orqaga moslik.
- ✔ Qator yozish xatosi sanoqni **yiqitmaydi**: `recordCount` xato chiqarsa ham
  `setCellStock` to'liq javob qaytaradi va avto-hujjat yozilgan qoladi.
- ✔ `getCellProducts` yumshoq o'chirilgan tovarni **qaytarmaydi** (5-vazifa).
- ✔ `tsd-policy.test.ts` yashil; `/products` va `/inventories` yopiqligi test
  bilan isbotlangan.
- ✔ Javob namunasi keltirildi; narx yo'qligi `select` oq ro'yxati bilan **yozma**
  isbotlandi.

**Ikki karra qo'llash qo'riqchisi (§3 qoida 3) — DALIL**

Sessiya hujjati bu fazada ham **post qilinmaydi va qilinolmaydi**:

1. **Sirt post yo'lini bermaydi.** Uchta endpoint bor: ochish, o'qish, yopish.
   Yopish `state = 'counted'` yozadi — `posted` EMAS (test:
   `expect(updates[0].state).toBe('counted')`). `counted`
   `InventoryTransitionSchema` da YO'Q, ya'ni
   `POST /inventories/:id/transitions/counted` ham ishlamaydi (test bilan
   qulflandi).
2. **`applyDeltas` sessiya qatorlari uchun HECH QACHON chaqirilmaydi.**
   `count-session.service.test.ts` fake'i har qoldiq yozuvini
   (`stock.upsert/update`, `stockByCell.upsert/update/deleteMany`,
   `stockOperation.createMany`) ro'yxatga oladi. Uchala amalda ham:
   `open → stockTouches = []`, `close → stockTouches = []`,
   `recordCount → stockTouches = []`.
3. **Manba intizomi testi:** `count-session.service.ts` MANBA MATNIDA
   `applyDeltas`, `stockByCell`, `stockOperation`, `$executeRaw` so'zlari
   umuman yo'q (K-reja naqshi — «hozircha tegmayapti» dan kuchliroq
   shartnoma).
4. **Ilgak APPEND qiladi.** `store-address-count-session.behaviour.test.ts` da
   `inventoryTouches = []` — `inventory.update()` ham,
   `inventoryPosition.deleteMany` ham chaqirilmaydi. Iz faqat
   `inventoryPosition.create` bilan qo'shiladi.
5. **Terminal `/inventories` ga yeta olmaydi** (allowlist testi) — ya'ni TSD
   sessiyasidan `transitions/post` ni `curl` bilan urish ham mumkin emas.

**Qaysi oqimni buzishi mumkin? (dalil bilan)**

1. **Bugungi sanash oqimi — buzilmaydi.** Ilgak amalning ENG OXIRIDA turadi
   (test: `enters.create` chaqiruv tartibi `recordCount` dan KICHIK) va
   `try/catch` da. Ochiq sessiya bo'lmasa `recordCount` darhol
   `{ recorded: false }` qaytaradi. Jonlida hozircha sessiya OCHADIGAN klient
   yo'q (N3 hali yozilmagan) ⇒ ilgak amalda no-op. Mavjud
   `store-address-count-mode.behaviour.test.ts` (avto-hujjat semantikasi)
   o'zgarmagan holda yashil.
2. **`getCellProducts` javobi QISQARADI — bu KO'RINADIGAN o'zgarish.**
   O'lchov (test bilan): tuzatishdan **OLDIN 2 qator** (tirik + yumshoq
   o'chirilgan), **KEYIN 1 qator** (faqat tirik). Ta'sir qiladigan joy —
   **web'ning «Ko'rish» ekrani** va `lookupCellByBarcode` javobidagi
   `products` ro'yxati.
   ⚠️ **Asos ochiq aytiladi:** bu «sessiya izini qutqarmaydi» — T12 dan keyin
   TSD ilovasi bu endpointni umuman chaqirmaydi (rejaning o'zi shuni
   ta'kidlagan). Haqiqiy asos: o'lik tovar «Ko'rish» da ko'rinmasin va ikki
   endpoint (`getCellStock` va `getCellProducts`) BIR XIL qoidaga bo'ysunsin —
   qo'shni endpointda filtr allaqachon bor edi. **Natija egasiga aytilsin:**
   yacheyka kartochkasida ilgari ko'rinib turgan o'chirilgan tovarlar endi
   ko'rinmaydi.
3. **`/inventories` javobiga yangi holat qiymati (`counted`) chiqishi mumkin** —
   faqat sessiya yopilganda. Web'ning holat ustuni bilmagan qiymatni xom
   ko'rsatadi — N4 ning ishi. Ro'yxat filtri endi `?state=counted` ni QABUL
   QILADI (avval 400 berardi).
4. **`delete()` endi sessiya hujjatini rad etadi (400).** Bugungi jonli
   hujjatlarda `count_session = true` **0 ta** (N1 zondi) ⇒ hozircha hech
   kimga ta'sir qilmaydi; sessiyalar paydo bo'lgach ular o'chirilmaydi
   (ataylab).
5. **Modul halqasi yo'q:** `StoreModule → TsdModule → AuthModule`.
   `TsdModule` `StoreModule` ni import QILMAYDI; `typecheck` yashil.
6. **Migratsiya YO'Q** — bu faza sxemaga bir bayt ham qo'shmadi (ustunlar N1 da).

**Ruxsat (prompt 8-bandi)**

`role-templates.ts` ga **TEGILMADI**. Uchala endpoint mavjud yacheyka amali
ruxsatiga tayanadi: ochish/yopish — `storecell:update` (sanashning o'zi ham shu
ruxsat bilan: `PUT /admin/stores/:id/cells/:cellId/stock`), ko'rish —
`storecell:view`. `storekeeper` shabloni ikkalasini ham `ALL` bilan oladi
(`role-templates.ts:475`) ⇒ yangi ruxsat kerak emas.

**Commit gigienasi**

Ish daraxtida parallel sessiyalar ishi turibdi (X-reja `hr/attendance-geo` +
`schema.prisma`, J-reja skriptlari, `auth/*`, `permissions/role-templates.*`).
Commitga faqat o'z fayllarim kirdi (yuqoridagi jadval) + `docs/progress.json`
(pre-commit hook avtomatikasi).

**Ochiq qolganlar / keyingi fazaga eslatmalar**

1. 🔴 **Jonli/lokal `curl` BAJARILMADI** — qabul mezonida yo'q, lekin prompt
   uni eslatgan. Sabab: lokal `sherset_v2_dev` bazasiga ulanish paroli bu
   sessiyada yo'q (`postgres:postgres` autentifikatsiyadan o'tmadi), demak
   server ko'tarilmadi. Sirt **test bilan** isbotlandi (94 ta TSD testi +
   javob shakli qulfi). **N6 smoke rejasiga kiritilsin:** uchala endpointni
   haqiqiy TSD tokeni bilan bir marta chaqirib, javobda narx yo'qligini ko'z
   bilan tasdiqlash.
2. 🟡 **K5 — `pieceEntry` hozircha HAR DOIM `null`.** O'lchandi:
   `SetCellStockSchema` da bunday maydon yo'q va hech bir klient yubormaydi
   (TSD'da bo'lak tarkibini kiritish ekrani yo'q — u WEB'dagi inventarizatsiya
   orqali kiritiladi, K-reja). Ilgak va `buildCountSessionLine` uni **qabul
   qiladi va qatorga ko'chiradi** (test bilan), ya'ni kirish paydo bo'lganda
   bitta qatorlik o'zgarish yetarli. Sirtga inert maydon ATAYLAB QO'SHILMADI:
   qabul qilinib `stock_pieces` reyestriga qo'llanmaydigan tarkib — yolg'on iz
   bo'lardi.
3. 🟡 **Hujjat nomi formati rejadagidan farq qiladi** (yuqorida, 2-qaror
   sababi). N4 web ekranida sessiya `00042` ko'rinishida chiqadi.
4. 🟡 **Bir omborchi — bitta ochiq sessiya.** Ikki omborchi bir omborni bir
   vaqtda sanasa, ikkita alohida sessiya bo'ladi (har biri o'ziniki). N4
   hisoboti buni hisobga olsin: bitta ombor bo'yicha bir necha sessiya qatori.
5. 🟡 **`confirmedBy`/`confirmedAt` hali HECH KIM yozmaydi** — bosh omborchi
   tasdig'i N4 ning ishi. Ustunlar tayyor.
6. ⚠️ **`mutation-guard-coverage.test.ts` hozir qizil** — X-reja sessiyasining
   commit qilinmagan ishi tufayli (yuqorida). O'sha sessiya o'z fazasini
   yopganda tuzalishi kutiladi; N3/N4 agenti buni MENING ishim deb o'ylamasin.
7. ⚠️ **§4 xaritasida N1 qatori hamon «REJA»** — N1 hisoboti «TUGADI» degan
   bo'lsa ham. Men faqat O'Z qatorimni yangiladim (§3 qoida 2). Reja egasi
   yoki N3 agenti buni to'g'rilab qo'ysin.
8. ⚠️ **N1 dan meros:** migratsiyalar zanjiri boshidan qayta o'ynatilmaydi va
   lokal dev baza `20260822` dan keyingi migratsiyalarni olmagan (N1 hisoboti
   3- va 4-bandlar) — o'zgarmadi.
