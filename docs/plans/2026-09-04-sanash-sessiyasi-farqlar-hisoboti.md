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
| **N2** | Sessiya sirti va `setCellStock` ilgagi | server, allowlist | 🔴 o'zak | REJA |
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

**Qabul mezoni.**
- Yangi testlar: sessiya ochish idempotent; sanoq qator qo'shadi (`expected/actual/variance`
  raqamlari `stock_by_cell` bilan mos); sessiya yo'q bo'lsa sanoq **avvalgidek** ishlaydi
  (orqaga moslik); qator yozish xatosi sanoqni yiqitmaydi.
- `tsd-policy.test.ts` yashil, `/products` va `/inventories` yopiqligi test bilan isbotlangan.
- Javob namunasi hisobotda keltiriladi va unda **narx maydoni yo'qligi** `select` oq ro'yxati
  bilan yozma isbotlanadi («ekranda ko'rsatmayapmiz» — isbot EMAS).

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

---

### N6 — Jonli smoke (kod yozilmaydi)

**Vazifalar.** Jonli terminalda (iData 95W Pro) sessiya ochish → 2–3 yacheyka sanash →
yopish → web'da tasdiqlash. Har bosqichda `packages/db` dan `npx tsx scripts/warehouse-state.ts`
(oldin va keyin) — **POS yeta olmaydigan qoldiq 0, EXIT=0**. Sanalgan yacheykalarning
`stock_by_cell` raqamlari hisobotdagi «sanaldi» ustuni bilan **aynan** teng bo'lishi tekshiriladi.

**Qabul mezoni.** Yuqoridagilarning hammasi raqam bilan hisobotda; ikki karra qo'llash
YO'Qligi jonli o'lchov bilan tasdiqlangan (sanalgan tovar qoldig'i sessiya yopilgandan keyin
o'zgarmaydi).

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
