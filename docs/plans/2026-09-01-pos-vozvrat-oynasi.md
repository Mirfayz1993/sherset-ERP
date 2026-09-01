# POS Vozvrat oynasi — V-REJA

> **Tuzildi:** 2026-09-01 · **Muallif:** Claude · **Egasi buyurtmasi:** «Shavkat aka
> kassasida chap panelda, Mijozlar ostida Vozvrat tugmasi tursin; bosganda mijoz
> bo'yicha VA mahsulot bo'yicha qidiruv chiqsin; mahsulot qidirilsa shu mahsulot
> qatnashgan BARCHA cheklar sanasi bilan chiqsin; naqdga olib ketgan (mijozsiz)
> odamlar ham vozvrat qila olsin.»
> **Holat:** reja — egasi tasdig'i kutilmoqda (4-bo'lim savollari bilan)

---

## 0. NIMA BOR, NIMA YO'Q — o'lchangan holat (2026-09-01)

Hammasi kod o'qish bilan o'lchandi, taxmin yo'q:

| Fakt | Qayerda |
|---|---|
| Yon panel `PosMode` union + `items[]` bilan quriladi; faqat Zakazlar permission bilan yashiringan (`canSeeOrders`) | `components/pos/pos-sidebar.tsx:35,133-147` |
| Rejim almashish — route emas, `useState<PosMode>`; rejimlararo o'tish namunasi bor (mijozlar→cheklar) | `sotuv/page.tsx:377,1756-1758` |
| Chek qidiruvi bugun faqat `name`/`agent.name` bo'yicha — **mahsulot bo'yicha chek qidiruv YO'Q** | `retail-sale.service.ts:453-460` |
| Lekin kerakli indeks BOR: `RetailSalePosition @@index([accountId, productId])` | `schema.prisma:8953-8954` |
| Boshqa modullarda `positions: { some: { productId } }` naqshi ishlatilgan (idiomatik) | `demand.service.ts:1682` va b. |
| Refund serveri `salesreturn.create` bilan qo'riqlangan; kassir shablonida bu HAMMAGA berilgan | `retail-sale.controller.ts:174`, `role-templates.ts:370` |
| Frontendda `usePermissions().can(entity, action)` tayyor; POS'da bitta misol ishlaydi | `hooks/use-permissions.ts:151`, `page.tsx:672-673` |
| Cheklar rejimidagi refund tugmasi FE'da permission bilan YASHIRILMAGAN (faqat `state==='posted'`) | `cheklar-mode.tsx:478-495` |
| Chek detali + refund paneli (`ChekDetailPanel`) o'z ma'lumotini o'zi oladi — qayta ishlatsa bo'ladi, lekin eksport qilinmagan | `cheklar-mode.tsx:148-153` |
| Mijoz qidiruvi va mijoz chek-tarixi allaqachon bor (CustomersPanel: `agentId` bilan ro'yxat, qarz, to'lanmagan vozvratlar) | `components/pos/customers-panel.tsx:196-228` |
| Barcode-skan alohida endpoint emas — `GET /products?search=` shtrix-kodni ham exact tutadi | `product.repository.ts:93-113` |
| Bugun ertalab qaytarish 0-dan boshlanadigan qilindi (`02564704`, hali deploy yo'q) | `cheklar-mode.tsx` startReturn |

**Xulosa:** yangi hech qanday jadval/migratsiya kerak EMAS. Ish — bitta API-filtr +
bitta yangi rejim-komponent + permission-sozlash.

---

## 1. DIZAYN QARORLARI (nega shunday)

**Q1. «Faqat Shavkat kassasida» = qurilma emas, PERMISSION.** Tugma
`can('salesreturn','create')` bo'lganda ko'rinadi. Shu bitta permission uch narsani
birdan boshqaradi: (a) yon paneldagi Vozvrat tugmasi, (b) Cheklar rejimidagi mavjud
«Qaytarish» tugmasi, (c) server (`POST :id/refund` allaqachon shu bilan qo'riqlangan).
Boshqa kassirlardan `salesreturn.create` olib tashlansa — ularning ekranida tugma
o'zi yo'qoladi, serverda ham yopiq. Kassaga (qurilmaga) bog'lash rad etildi: permission
tekshiruviga qurilma ID yetib bormaydi (yangi mexanizm kerak bo'lardi) va mantiqan
zaif — Shavkat boshqa kassaga o'tirsa ishlay olmay qolardi.

**Q2. Qidiruv ikki yo'nalishli, mahsulot — asosiy.** Naqdga olib ketgan mijozsiz
chekni FAQAT mahsulot orqali topish mumkin, shuning uchun mahsulot-qidiruv birinchi
o'rinda. Mijoz-qidiruv — mavjud `/counterparties?search=` bilan.

**Q3. Chek ochilganda YANGI panel yozilmaydi** — mavjud `ChekDetailPanel` eksport
qilinib qayta ishlatiladi (unda refund, taqsimot, chop — hammasi bor, shu jumladan
bugungi «0 dan boshlanadi» tuzatishi). Nusxa ko'chirish taqiqlanadi: bitta panel,
ikki joydan chaqiriladi.

**Q4. Serverda faqat FILTR qo'shiladi, yangi endpoint emas.** `GET /retail-sales`
ga `productId` parametri — sxema + `where` ga 2 qator. Indeks tayyor, katta bazada
ham tez. Ruxsat o'zgarmasdan `retailsale.view` qoladi (chekni KO'RISH — vozvrat
huquqidan alohida; refundning o'zi baribir `salesreturn.create` talab qiladi).

---

## 2. FAZALAR

### V0 — permission-sozlash (jonli, kod YO'Q, qaytariladigan)

Skript `apps/api/src/scripts/ops-v0-vozvrat-huquqi.ts` (DRY default, `--apply`),
B1/B2 naqshida (HTTP marshrutlar orqali, SQL yo'q):

1. Jonli rollarda kimda `salesreturn.create` borligini o'lchab chiqarish (DRY hisobot).
2. Egasi tasdiqlagan ro'yxatdan tashqari kassir rollaridan `salesreturn`
   entity'sini olib tashlash. ⚠️ `PUT /roles/employee/:id` REPLACE-SET ekani
   yodda (sherset-loyiha saboqlari) — rol tarkibini to'liq yuborish.
3. Shavkatning xodim kartasi va roli tekshiriladi (u menejer ham — rolida
   `salesreturn.create` qolishi kafolatlanadi).

**Qaytarish nuqtasi:** DRY hisobotdagi «oldin» holati faylga yoziladi; teskari
skript o'sha fayldan tiklaydi.
**Blok:** S1 savoliga javobsiz boshlanmaydi.

### V1 — API: chekni mahsulot bo'yicha qidirish (lokal, ~2 qator mantiq + testlar)

- `RetailSaleFilterSchema` ga `productId: z.string().uuid().optional()`
  (`retail-sale.schema.ts:362-390`).
- `list()` where'iga: `productId ? { positions: { some: { productId } } } : {}`
  (`retail-sale.service.ts:436-514`).
- Javobga qo'shimcha maydon KERAK EMAS — ro'yxat satri (sana, raqam, mijoz, summa)
  yetarli; miqdorlar detal panelda ko'rinadi.
- Mavjud `agentId`, `dateFrom/dateTo`, `state`, `cursor` filtrlar bilan birga ishlaydi.
- Test: service-test — productId bilan faqat shu tovar qatnashgan cheklar; boshqa
  filtrlar bilan kombinatsiya; sxema-test — noto'g'ri uuid 400.

**Qaytarish nuqtasi:** additiv filtr — olib tashlash = 2 qator revert.

### V2 — Web: Vozvrat rejimi (lokal, asosiy ish)

1. `PosMode` ga `'vozvrat'`; yon panelga Mijozlar OSTIDA element,
   `canRefund = can('salesreturn','create')` bilan shartli (Zakazlar naqshi,
   `pos-sidebar.tsx:142-144`). Ikonka: ↩ (RotateCcw), test-id
   `pos-sidebar-item-vozvrat`.
2. `_components/chek-detail-panel.tsx` — `ChekDetailPanel` cheklar-mode'dan
   ko'chirilib EKSPORT qilinadi (mazmun o'zgarmaydi); invalidatsiya kalitlariga
   `['pos-vozvrat-cheklar']` qo'shiladi. `cheklar-mode.tsx` yangi fayldan import
   qiladi.
3. `_components/vozvrat-mode.tsx` — chap ustun qidiruv, o'ng ustun natija/detal:
   - Bitta qidiruv maydoni, ikki tab: **«Tovar»** (default) va **«Mijoz»**.
   - Tovar tabi: `GET /products?search=` (skanner ham ishlaydi — Enter naqshi
     sotuv-mode'dagidek); tovar tanlangach
     `GET /retail-sales?productId=…&state=posted&sortBy=moment&sortDir=desc&limit=50`.
   - Mijoz tabi: `GET /counterparties?search=…&limit=20`; tanlangach
     `GET /retail-sales?agentId=…&state=posted&sortBy=moment&sortDir=desc&limit=50`
     (CustomersPanel'dagi tayyor naqsh).
   - Natija satri: chek raqami · **sana-vaqt** · mijoz ismi yoki «Naqd (mijozsiz)» ·
     summa · holat belgisi. Bosilsa o'ng panelda `ChekDetailPanel` (refund shu yerda).
   - 50 tadan ko'p bo'lsa `cursor` bilan «Yana ko'rsatish».
4. Cheklar rejimidagi mavjud «Qaytarish» tugmasi ham `canRefund` bilan yashiriladi
   (hozir permissionsiz ko'rinib, 403 yeyishi mumkin edi).
5. i18n: `pages.pos.sidebar_vozvrat` (uz «Vozvrat», ru «Возврат») + rejim matnlari
   `pages.sotuv.vozvrat_*` (uz+ru BIRGA, i18n-qo'riqchi bor).

**Qaytarish nuqtasi:** faqat frontend fayllar; revert = commit revert.

### V3 — darvozalar + deploy (retsept bo'yicha)

- `pnpm -s typecheck` (api+web), lint gate, `vitest` (web to'liq + api retail-sale).
- Deploy KECHKI OYNADA (20:00–04:30): rebase serverdan fetch qilingan HEAD ustiga,
  `NEXT_DISTDIR=.next-new` build, **flip faqat `BUILD_TUGADI rc=0` dan keyin**,
  verify faqat erp.sherset.uz orqali. API'ga build kerak emas — restart yetadi
  (V1 api o'zgarishi bor, `pm2 restart sherset-v2-api`).
- Jonli smoke: Shavkat login → Vozvrat tugmasi BOR; oddiy kassir login → tugma
  YO'Q va Cheklar'da ham qaytarish yo'q; tovar qidirib eski chek topish → 1 dona
  qaytarish → summa/ombor tekshiruvi (vozvrat kaskad boshiga — Ombor 07 ga tushadi,
  bu ATAYLAB, M1 qaydi).

---

## 3. QAMROVGA KIRMAYDI (ataylab)

- **Vozvrat tovarga yorliq chop etish POS'dan** — qabul + yacheyka + yorliq allaqachon
  omborchi oqimida bor (`return-label-print.tsx`, restock-task). QR YO'Q — egasining
  2026-07-05 qoidasi (faqat shtrix-kod).
- **Per-kassa (qurilma) cheklovi** — Q1 qarori bilan rad etildi.
- **Chek ichida qator matni bo'yicha qidiruv** (mahsulot nomini to'g'ridan-to'g'ri
  chek qidiruviga qo'shish) — tovar tanlab qidirish aniqroq (omonim nomlar xavfi yo'q).

---

## 4. EGASIGA SAVOLLAR (javobsiz tegishli faza boshlanmaydi)

- **S-V1.** Vozvrat huquqi KIMLARDA qoladi? Taxminiy javob: Shavkat + egasi/admin.
  Aniq ro'yxat kerak — V0 shu ro'yxat bilan yuritiladi. (Muxriddin kassir+katta
  omborchi — unda qolsinmi?)
- **S-V2.** Qidiruv natijasida qancha davr ko'rsatilsin? Taklif: chegarasiz, eng
  yangisi tepada, 50 tadan sahifalab. Egasi «faqat oxirgi N kun» desa — `dateFrom`
  bilan cheklanadi (tayyor filtr).
- **S-V3.** Natijada faqat `posted` (qaytarish mumkin) cheklar ko'rsinmi, yoki
  `refunded`/bekor qilinganlar ham (ma'lumot uchun, kulrang)? Taklif: faqat posted —
  oyna «vozvrat qilish» uchun, arxiv emas.

---

## 5. HAJM BAHOSI

| Faza | Hajm | Xavf |
|---|---|---|
| V0 skript | ~150 qator skript, jonli rol-yozuv | O'rta (REPLACE-SET tuzog'i — DRY majburiy) |
| V1 api | ~10 qator + testlar | Past |
| V2 web | ~400–500 qator (asosan yangi rejim-fayl) | Past (faqat FE) |
| V3 | darvoza + kechki deploy | Ma'lum retsept |

Hammasi bitta kechki deployga sig'adi; V0 deploydan mustaqil (jonli rollarga
HTTP orqali, xohlagan payt).
