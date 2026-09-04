# Bo'lak hisobini JONLI ISHGA TUSHIRISH (J-reja)

> **Yaratilgan:** 2026-09-04 · **Buyurtmachi:** Ozodbek (egasi) ·
> **Holat:** **J1 ✅ TUGADI** · **J2 ⚠️ QISMAN** (ikkalasi ham 2026-09-04).
> J1 — ombor skriptlari endi bo'lak reyestrini ko'radi (T1 qarzi yopildi),
> jonli bazaga faqat DRY (O'QISH) so'rovlar ketdi.
> J2 — **oltala `piece_tracked` bayrog'i JONLIDA O'CHIRILDI** (15:38 UTC,
> egasining tasdig'i bilan, `POST /stock-pieces/flag` orqali — SQL emas) va
> pilot doirasi o'lchandi. Qabul mezonining 3 tadan 2 tasi bajarildi;
> **ochiq qolgani — egasi 5–8 tovarlik pilot ro'yxatini tanlashi** (§5 → J2
> → 7-band). 🔴 **J3 shu ro'yxatsiz BOSHLANMAYDI.**
> Migratsiya ham, deploy ham hech bir fazada bo'lmadi.
> 🔴 J2 ikki o'lchovni tuzatdi: metrli tovar §1 dagi **632 emas, 634**
> (547 tirik + 87 o'chirilgan) va kabel doirasi **73 emas, 94** — §5 ga qarang.
>
> **Manba reja:** `docs/plans/2026-08-25-bolinadigan-tovar-bolak-hisobi.md`
> (K-reja). **K1…K6 ning KODI 2026-08-29 kechasi jonliga chiqdi**
> (`cbc14723 → f612d804`, 5 migratsiya, `docs/ops/jonli-holat.md` 310-qator).
> Ya'ni bu reja **yangi funksiya qurmaydi** — u yozilgan, sinovdan o'tgan va
> serverda turgan funksiyani **ishlatishga topshiradi**. K-rejaning oltala
> fazasi «⚠️ QISMAN» bo'lib turibdi, chunki ularning qabul mezonidagi JONLI
> band bajarilmagan. Shu reja aynan o'sha bandlarni yopadi.
>
> **Ijro tartibi:** har faza ALOHIDA sessiyada. Agent K-rejani, F-rejani
> (`2026-08-23-ombor-restrukturizatsiya.md`), G-rejani
> (`2026-08-23-omborchi-tsd-mijozlar.md`), hodisa hujjatini
> (`2026-08-24-split-kassa-hodisasi.md`) va SHU faylni TO'LIQ o'qiydi, O'Z
> fazasini bajaradi, §5 ga hisobot yozadi va **TO'XTAYDI**.
>
> **O'ZGARMAS QOIDALAR:** F-rejaning 2-bo'limi (1–14) shu rejaga AYNAN tatbiq
> etiladi — bitta sessiya = bitta faza; testlar + i18n ru/uz majburiy; jonli
> bazaga skript avval lokalda; ikki tomonlama bog'liqlik (10); qabul mezoni
> bilan yopish (11); qaytarish yo'li (12); uchma-uch smoke (13); favqulodda
> tuzatish protokoli (14). **PowerShell bilan manba fayl QAYTA YOZILMAYDI**
> (2026-09-01 kodlash hodisasi) — faqat Edit/Write.

---

## 1. Nega bu reja: 2026-09-04 da O'LCHANGAN holat

Quyidagi raqamlar bugun jonli bazadan (`sherset_v2`, faqat O'QISH so'rovlari)
va repodagi koddan olindi. Taxmin yo'q.

| O'lchov | Qiymat | Ma'nosi |
|---|---|---|
| `stock_pieces` | **0 qator** | Reyestr BO'SH. Funksiya jonlida bir marta ham ishlatilmagan. |
| `products.piece_tracked = true` | **4 ta** ⚠️ **ESKIRDI — o'sha kuni kechqurun 6 ta bo'ldi, §5/J1/0-band** | `Azia Avvg 3x25 1X16`, `Azia Avvg 3x50 1X25`, `Vayr vvg 3x1.5` (birligi «м») + 🔴 **`Vesta ramka 2X` — birligi «шт»**. Qarorlar 2026-09-02 va 09-03 da qo'lda qo'yilgan. |
| Bayroqli 4 tovarning qoldig'i | hammasi **«Taqsimlanmagan»** omborida, **yacheykasiz** | Bitta manba hammasini qoplaydi ⇒ 7.1 istisnosi hozircha chekni yiqitmaydi (pastda 3.2). |
| «Hal qilinmagan» ro'yxati | **629 ta** «м» tovar | K6 ekranidagi navbat. Bittalab qaror qilinsa — 629 bosish. |
| Birligi «м» tovarlar | **632 ta**, jami **6 931 250,575 m** | Katalogning butun «metr» qatlami. |
| Ulardan yacheyka kesimida qoldig'i borlari | **17 ta** | Qolgan **615 tasi ombor hovuzida** (yacheykasiz). Bu J-rejaning tartibini belgilaydi (1.1). |
| «м» qoldiqning omborlar bo'yicha taqsimoti | Taqsimlanmagan **631 tovar / 6 918 946 m** · Ombor 02 — 2/11 004 · Ombor 04 — 1/651 · Ombor 01 — 14/558 · Ombor 07 — 3/91 | Amalda hamma metrli tovar bitta hovuzda. |
| Kabel guruhlari | «Uz kabel» **35** · «Vayr kabel» **23** · «Azia kabel» **15** = **73 tovar ≈ 1,05 mln m** · guruhsiz «м» tovarlar **413 ta** | 🔴 **K-S4 ga javob** (K-rejaning ochiq savoli): pilot doirasi 73 tovar, lekin birinchi hafta uchun bu ham KATTA (4-bo'lim, J2). |
| Kunlik sverka | `stock-piece-digest.cron.ts:34` — `0 20 * * *`, Asia/Tashkent | Signal kanali TAYYOR, faqat ma'lumot yo'q (reyestr bo'sh ⇒ farq ham yo'q). |
| Kesim sirti | web: `apps/web/src/app/(app)/restock-tasks/[id]/page.tsx` · TSD: `CutScreen.kt` | 🟢 **Pilot uchun TSD APK MAJBURIY EMAS** — kesim brauzerda ham bajariladi. |

### 1.1 Uchta KOD dalili — reja tartibi shulardan chiqdi

1. **7.1 istisnosi bayroqqa bog'liq, reyestrga QARAMAYDI**
   ([retail-allocation.ts:62-67](../../apps/api/src/modules/retail-sale/retail-allocation.ts#L62-L67)).
   Ya'ni bayroq yoqilgan zahoti avto-taqsimotning 3-holati (bo'lish) o'chadi —
   reyestr bo'sh bo'lsa ham. **Bayroq — «ko'rsatish» tugmasi emas, XULQ
   tugmasi.**
2. **Inventarizatsiyada bo'lak maydoni FAQAT yacheykali pozitsiyada ko'rinadi**
   ([inventory-positions-panel.tsx:1221](../../apps/web/src/components/inventories/inventory-positions-panel.tsx#L1221):
   `pieceTrackedOf(...) && g.cellId`). Jonlida metrli tovarning **615 tasi
   yacheykasiz** ⇒ 🔴 **K5 ning «sanash orqali to'ldirish» yo'li ular uchun
   JISMONAN OCHILMAYDI.** Reyestr `/omborchi/bolaklar` (K2) ekrani orqali
   to'ldiriladi.
3. **Reyestrga yozish bayroqni TALAB QILMAYDI**
   ([stock-piece-registry.service.ts:348-366](../../apps/api/src/modules/stock-piece/stock-piece-registry.service.ts#L348-L366)
   — `assertScope` ombor, tovar va yacheykani tekshiradi, `pieceTracked` ni
   emas). 🟢 **Shuning uchun reyestrni bayroqdan OLDIN to'ldirish mumkin** —
   kassa xulqi o'zgarmagan holda. Bu J-rejaning eng muhim tartib qarori:
   **avval MA'LUMOT, keyin XULQ.**

> **Xulosa:** «bayroqni yoqamiz, keyin to'ldiramiz» tartibi noto'g'ri bo'lardi —
> kassir bo'sh reyestrni ko'rib, taqsimot esa allaqachon cheklangan bo'lardi.
> J-reja teskari yuradi: reyestr → tekshiruv → bayroq → kuzatuv.

---

## 2. Shu rejaga xos QO'SHIMCHA qoidalar (F-reja 1–14 ustiga)

1. **Reyestr bo'sh paytda qilinadigan ish — birinchi navbatda.** `stock_pieces`
   0 qator turganda skript tuzatish (J1) HECH QANDAY ma'lumotni buza olmaydi.
   Reyestr to'lgandan keyin o'sha ish xavfli bo'lib qoladi.
2. **Bayroq — jonli o'zgarish, deploy emas.** Har yoqish/o'chirish `docs/ops/`
   dagi kunlik qatorga yoziladi: qaysi tovar, kim, qachon, o'sha paytdagi
   manbalar soni.
3. **Bitta tovarda ham bo'lsa reyestr NOTO'G'RI bo'lsa — bayroq DARHOL
   o'chiriladi**, tuzatish keyin. O'chirish deploy ham, skript ham talab
   qilmaydi (tovar kartochkasidagi bitta tugma) — bu K6 hisobotida ataylab
   shunday qurilgan.
4. **Pilot davomida kassa TO'XTAMAYDI.** Sverka farqi — signal, to'siq emas.
   Agar biror yo'l chekni yiqitsa (400/500), bu HODISA: qoida 14 protokoli,
   bayroq o'chiriladi, hisobotga yoziladi.
5. **Jismoniy sanoqsiz reyestr to'ldirilmaydi.** Tizimdagi son (masalan bitta
   kabelda 10 586 m) omborda haqiqatan turgan rulonlar bilan tasdiqlanmaguncha
   reyestrga kiritilmaydi — aks holda invariant birinchi kundanoq soxta bo'ladi.

---

## 3. Xavflar reyestri (dalil bilan)

### 3.1 🔴 T1 — `packages/db` skriptlari bo'lak reyestrini bilmaydi

`docs/ops/2026-08-30-deploy-3-kecha.md:338` da qarz sifatida yozilgan.
Bugun aniq ko'lami o'lchandi — **to'rtta skript**:

| Skript | Nima qiladi | Reyestrga ta'siri |
|---|---|---|
| `packages/db/scripts/warehouse-split.ts:372-379` | `storeCell.storeId` va `stockByCell.storeId` ni yangi omborga ko'chiradi | `stock_pieces.store_id` **joyida qoladi** ⇒ bo'lak eski omborda, qoldig'i yangi omborda; sverka darhol farq beradi |
| `packages/db/scripts/warehouse-split-revert.ts:139-151` | O'shaning teskarisi + `stock.update` | Ayni muammo, teskari yo'nalishda |
| `packages/db/scripts/stock-baseline-cleanup.ts:273` | `Stock.qty` ni KAMAYTIRADI (`stockOperation` bilan) | Reyestrga tegmaydi ⇒ «Σ tarkib === miqdor» buziladi (`jonli-holat.md:193-195` da ogohlantirish sifatida yozilgan) |
| `packages/db/scripts/create-cells.ts:210-232` | `--revert` da bo'sh yacheykalarni o'chiradi; **to'qqizta** jadvalni «ishlatilgan» deb tekshiradi | `stock_pieces` ro'yxatda **YO'Q**; FK esa `ON DELETE SET NULL` ⇒ bo'lagi bor yacheyka jimgina o'chadi, bo'laklar ombor darajasiga tushib qoladi |

Hozir xavf **nolga teng** (reyestr bo'sh). Reyestr to'lgan kundan boshlab
xavf **doimiy** bo'ladi. Shu sabab J1 — birinchi faza.

### 3.2 ⚠️ Bayroqli 4 tovar — hozircha zararsiz, lekin qaror qilinmagan holatda

Bayroq yoqilgani uchun ularda 7.1 istisnosi ALLAQACHON kuchda: chek faqat
BITTA manbadan qoplansa o'tadi, aks holda `no-single-source` bilan rad etiladi.
Bugungi o'lchov: to'rttasining ham qoldig'i faqat «Taqsimlanmagan» da va
yacheykasiz ⇒ manba bitta ⇒ **hozircha hech qanday chek yiqilmaydi.** Lekin:

- qoldiq yacheykalarga tarqalsa yoki boshqa omborga tushsa — chek 400 oladi;
- kassir ekranida reyestr bo'sh (`no-registry`) ⇒ hech qanday foyda ham yo'q;
- 🔴 **`Vesta ramka 2X` ning birligi «шт»** — u metrlab kesilmaydi, bayroq
  xato qo'yilgan (K6 ning avto-yoqishi «шт» ga tegmaydi ⇒ qo'lda qo'yilgan).

### 3.3 ⚠️ Katalogdagi metr qoldiqlarining ishonchliligi

Bayroqli uchala kabelning qoldig'i 10 586 / 10 934 / 11 000 m — bir-biriga
juda yaqin, «yumaloq» sonlar. Butun «м» qatlami 6,93 mln m. Bu raqamlar
jismoniy sanoq bilan tasdiqlanmagan. **J3 ning butun ma'nosi shu:** reyestr
tizimdagi sondan emas, OMBORDAN to'ldiriladi; farq chiqsa — bu topilma,
nosozlik emas.

---

## 4. FAZALAR

**Xarita va bog'liqlik:**

| Faza | Turi | Bog'liq | Hajmi |
|---|---|---|---|
| **J1** — T1 qarzi: skriptlar reyestrni bilsin | KOD | — | O'rta (4 skript + testlar) |
| **J2** — Bayroq gigienasi + pilot doirasi | JONLI audit | J1 shart emas, lekin tavsiya | Kichik |
| **J3** — Pilot tovarlari reyestrini to'ldirish | OPERATSIYA | J2 | O'rta (omborchi ishi) |
| **J4** — Bayroqni yoqish + qoida 13 smoke'i | JONLI sinov | J1 + J3 | O'rta |
| **J5** — 1 hafta kuzatuv (K6/4 piloti) | OPERATSIYA | J4 | 7 kun kalendar |
| **J6** — «Hal qilinmagan» 629 ni tozalash sirti | KOD | J5 dan mustaqil | Kichik |
| **J7** — K-rejani yopish + yoyish qarori | HUJJAT | J5 | Kichik |

---

### J1 — T1 qarzi: `packages/db` skriptlari bo'lak reyestrini bilsin

**Maqsad:** ombor skriptlari reyestrni ko'radigan bo'lsin. **Reyestr BO'SH
paytda** bajarilsa hech qanday ma'lumot xavf ostida emas — bu eng arzon payt.

**Vazifalar:**

1. `warehouse-split.ts` — yacheyka boshqa omborga ko'chganda o'sha yacheykadagi
   `stock_pieces.store_id` ham AYNI TRANZAKSIYADA ko'chsin. DRY hisobotiga
   «N ta bo'lak ko'chadi» qatori qo'shilsin.
2. `warehouse-split-revert.ts` — ayni mantiq, teskari yo'nalishda (hovuz
   qoldig'i ko'chganda `cellId IS NULL` bo'laklar ham ko'chadi).
3. `stock-baseline-cleanup.ts` — `pieceTracked` tovarni **RAD ETSIN** (skip),
   sababi hisobotda ko'rinsin: «bo'lak hisobi yuritiladigan tovar — qoldiqni
   bu skript kamaytira olmaydi, tuzatish inventarizatsiya orqali».
4. `create-cells.ts --revert` — «ishlatilgan yacheyka» tekshiruviga
   `stock_pieces` (status `active`) qo'shilsin ⇒ bo'lagi bor yacheyka
   O'CHIRILMAYDI.
5. `warehouse-state.ts` — holat hisobotiga **bo'lak sverkasi** bandi:
   `active` bo'laklar soni, invariant farqi bor tovarlar soni. Farq bo'lsa
   `ogohlantirish` (🔴 `xato` EMAS — kassa to'xtamasligi qoidasi).
6. Testlar: har o'zgarish uchun sof-mantiq testi + skript hisobotining
   qatorini qulflaydigan test. i18n kerak emas (skriptlar CLI).

**Migratsiya: YO'Q. Deploy: YO'Q** (skriptlar serverda `git pull` bilan
yangilanadi; ular faqat qo'lda yuritiladi).

**Qabul mezoni:**
- To'rtala skript **DRY rejimda jonliga qarshi** yugurtirilgan va hisobotida
  bo'lak qatori ko'ringan (reyestr bo'sh ⇒ hamma joyda `0`, lekin qator BOR);
- `create-cells.ts --revert` DRY da bo'lagi bor yacheyka «saqlanadi» deb
  ko'rsatilgani lokal bazada sun'iy bo'lak bilan isbotlangan;
- `warehouse-state.ts` EXIT kodi o'zgarmagan (bugungi jonli holat: `EXIT=0`);
- Testlar yashil (`api` + `db` to'plamlari), typecheck + lint toza.

**Qaytarish yo'li:** `git revert` — jonli ma'lumotga tegilmagani uchun boshqa
qadam kerak emas.

**PROMPT (yangi sessiyaga ko'chiring):**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) docs/plans/2026-08-25-bolinadigan-tovar-bolak-hisobi.md (K-reja) va
   docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md (J-reja) ni TO'LIQ o'qi.
   F-rejaning 2-bo'limidagi 1-14 qoidalar amal qiladi.
2) Sen FAQAT J1 — «T1 qarzi: packages/db skriptlari bo'lak reyestrini bilsin» fazasini bajarasan.
3) 🔴 Reyestr HOZIR BO'SH (stock_pieces = 0). Aynan shu sabab bu faza hozir arzon —
   lekin kod SHUNDAY yozilsinki, reyestr to'lgach ham to'g'ri ishlasin.
4) Migratsiya QO'SHMA. Jonli bazaga faqat DRY (O'QISH) so'rov yubor.
5) Tugagach J-rejaning §5 iga «### J1 — ...» hisobotini yoz: nima o'zgardi, DRY natijalari,
   qabul mezoni ✔/✘, «bu o'zgarish qaysi mavjud oqimni buzishi mumkin?», ochiq qolganlar.
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```

---

### J2 — Bayroq gigienasi + pilot doirasini o'lchash

**Maqsad:** pilotni **ataylab** boshlash — hozirgi «kimdir 4 ta tovarni
belgilab qo'ygan» holatidan chiqish.

> 🔴 **J1 dan keyingi tuzatish (2026-09-04 kechqurun):** bayroqli tovar **4
> emas, 6 ta** — `Uz kg 1x25 1` (12:53) va `Uz vvgng  5x25` (13:25) o'sha kuni
> qo'shilgan. Ya'ni quyidagi 1–2 vazifalar **oltala** tovarga tegishli va
> qabul mezonidagi «soni 0» ham shundan hisoblanadi. To'liq ro'yxat va
> qoldiqlar: §5 → J1 → 0-band. Bayroq yoqish DAVOM ETAYOTGANI uchun J2 avval
> HOLATNI QAYTA O'LCHASIN — ro'yxat yana o'sgan bo'lishi mumkin.

**Vazifalar:**

1. **`Vesta ramka 2X` (birligi «шт») bayrog'i O'CHIRILADI** — u metrlab
   kesilmaydi (egasidan bir og'iz tasdiq olinadi, J-S1).
2. Uchala kabelning bayrog'i **vaqtincha O'CHIRILADI** — J3 da reyestri
   to'lgach, J4 da ataylab qaytariladi. Sabab: bo'sh reyestr + cheklangan
   taqsimot = foydasi yo'q, xavfi bor (3.2).
3. **Audit skripti** `apps/api/src/scripts/ops-j2-piece-pilot-audit.ts`
   (DRY sukut, `--apply` bilan bayroq o'zgartiradi — UI bosadigan
   `POST /stock-pieces/flag` marshruti orqali, SQL YO'Q):
   - nomzod tovarlar ro'yxati (guruh bo'yicha: «Uz kabel» / «Vayr kabel» /
     «Azia kabel»);
   - har biri uchun: qoldiq, **nechta manbadan** iborat (ombor × yacheyka),
     oxirgi 30 kunda nechta chekda sotilgan;
   - 🔴 **manbasi 1 dan ko'p tovar pilotga KIRITILMAYDI** (7.1 istisnosi
     chekni yiqitardi) — yoki avval qoldig'i bitta manbaga yig'iladi.
4. **Pilot ro'yxati tanlanadi: 5–8 tovar** (73 emas). Mezon: eng ko'p
   sotiladigan, manbasi bitta, omborchi jismonan sanay oladigan. Ro'yxat
   hisobotda ISM bilan yoziladi.
5. `docs/ops/jonli-holat.md` ga qator: kim, qachon, qaysi bayroqlar o'chdi.

**Qabul mezoni:** jonlida `piece_tracked = true` tovarlar soni **0** (ataylab
tozalangan holat); audit skripti pilot nomzodlarini manba soni bilan
ko'rsatgan; egasi 5–8 tovarlik ro'yxatni tasdiqlagan (ism + sana hisobotda).

**Qaytarish yo'li:** bayroq — bitta tugma; skript `--apply` siz hech nima
yozmaydi.

**PROMPT:**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md (J-reja) ni va K-rejani TO'LIQ o'qi.
2) Sen FAQAT J2 — «Bayroq gigienasi + pilot doirasini o'lchash» fazasini bajarasan.
3) 🔴 Bu faza JONLI bazaga YOZADI (4 ta bayroq o'chadi). Avval DRY, natijani ko'rsat,
   egasining tasdig'ini ol, keyin --apply. SQL EMAS — UI bosadigan marshrut orqali.
4) Pilot ro'yxatini O'ZING tanlama — o'lchovni ko'rsat, tanlovni egasi qiladi.
5) §5 ga «### J2 — ...» hisobotini yoz (o'lchov jadvali, tanlangan ro'yxat, qabul mezoni ✔/✘,
   «qaysi oqimni buzishi mumkin?»).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```

---

### J3 — Pilot tovarlarining reyestrini JISMONIY sanoq bilan to'ldirish

**Maqsad:** reyestrda birinchi haqiqiy ma'lumot paydo bo'lsin — kassa xulqiga
tegmasdan (bayroqlar hali o'chiq).

**Vazifalar:**

1. Omborchi J2 ro'yxatidagi har tovarni **jismonan sanaydi**: nechta butun
   rulon (va har birining uzunligi) + nechta bo'lak (har birining uzunligi).
   Qog'ozga emas — darhol ekranga.
2. Kiritish **`/omborchi/bolaklar`** (K2) ekranida: butun rulon `250 m × 3`
   sifatida, bo'laklar alohida. 🔴 **Yacheykasiz kiritish MUMKIN** (jonlida
   metrli qoldiqning deyarli hammasi hovuzda — 1.1/2-dalil).
3. Har bo'lakka **`BLK-` yorlig'i bosiladi** va rulonga yopishtiriladi
   (bu — «tovarga yorliq yopishtirilmaydi» qoidasidan ataylab qilingan
   istisno, K-reja 7.2).
4. Har tovar kiritilgach **sverka tekshiriladi**
   (`/reports/piece-reconciliation`): `Σ bo'laklar` = `Stock.qty` bo'lishi
   SHART. Farq chiqsa — bu **topilma**: tizimdagi son noto'g'ri bo'lgan.
   Farq **hujjatlashtiriladi** va tuzatish inventarizatsiya orqali qilinadi
   (reyestrga «to'g'rilab» yozilmaydi — qoida 5).
5. Natija jadvali hisobotga: tovar · tizimdagi son · sanoq · farq · bo'laklar
   soni · yorliq raqamlari oralig'i.

**Qabul mezoni:** J2 ro'yxatidagi HAR tovarda reyestr to'lgan va sverka
farqi **0** (yoki farq hujjatlashtirilib inventarizatsiya bilan yopilgan);
kamida bitta yorliq jonli printerda bosilib, skanerlanganda AYNAN o'sha bo'lak
ochilgani tekshirilgan (K2 qabul mezonining ochiq qolgan qismi).

**Qaytarish yo'li:** bo'laklarni «tugadi» (`consumed`) qilish yoki K2 ekranidan
tuzatish. Bayroq o'chiq bo'lgani uchun kassa bu ma'lumotni umuman ko'rmaydi ⇒
xato kiritish savdoga ta'sir qilmaydi.

**PROMPT:**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) J-rejani (docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md) va K-rejani TO'LIQ o'qi.
2) Sen FAQAT J3 — «Reyestrni jismoniy sanoq bilan to'ldirish» fazasini bajarasan.
   Bu faza ASOSAN OPERATSIYA: sening ishing — omborchiga ANIQ ko'rsatma tayyorlash,
   kiritishni kuzatish, har qadamda sverkani o'lchash va natijani yozish.
3) 🔴 Reyestrga tizimdagi sondan «to'g'rilab» yozma. Faqat omborchi SANAGAN son kiritiladi.
   Farq chiqsa — bu topilma, hisobotga yoziladi.
4) Bayroqlarni YOQMA — u J4 ning ishi.
5) §5 ga «### J3 — ...» hisobotini yoz (tovar × sanoq × farq jadvali, yorliq oralig'i,
   qabul mezoni ✔/✘, ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```

---

### J4 — Bayroqni yoqish + qoida 13 uchma-uch smoke'i

**Maqsad:** K-rejaning oltala fazasining jonli qabul mezonini BITTA sinov
zanjiri bilan yopish.

**Vazifalar:**

1. J2 ro'yxatidagi tovarlarda bayroq **YOQILADI** (kunning tinch payti; kassa
   ochiq bo'lsa ham bo'ladi — o'zgarish faqat shu tovarlarga tegadi).
2. **Uchma-uch smoke** (qoida 13), haqiqiy chek bilan, ustma-ust:
   1. **Kassa ko'rinishi (K3):** tovar tanlanganda tarkib (`250 × 3 · 200 · 150`)
      va «eng uzun uzluksiz» ko'rinadi; DB dagi bo'laklarga AYNAN teng;
   2. **Yetmaydigan holat:** uzluksiz bo'lak yetmaydigan miqdor so'ralganda
      taklif (`150 + 30`) chiqadi va tizim O'ZI tanlamaydi;
   3. **Kesim (K4):** omborchi topshiriqda bo'lakni skanerlab kesadi;
      qoldiq bo'lakka yorliq AVTOMATIK bosiladi; `Stock.qty` **o'zgarmaydi**
      (stok-neytrallik jonlida o'lchanadi);
   4. **To'lov:** chek `posted` bo'lgach mijozga ketgan bo'lak reyestrdan
      chiqadi va qoldiq AYNAN kesilgan uzunlikka kamayadi;
   5. **Voz kechish ssenariysi:** ikkinchi chekda kesimdan keyin chek bekor
      qilinadi — bo'lak omborda YORLIG'I bilan qoladi, qoldiq o'zgarmaydi;
   6. **Vozvrat (K5/3):** qaytgan bo'lak yorlig'i bo'yicha AYNI qator bilan
      `active` ga qaytadi;
   7. **Sverka:** har qadamdan keyin farq **0**.
3. Har qadamning raqami hisobotga yoziladi (chek raqami, bo'lak yorlig'i,
   qoldiq oldin/keyin).
4. Sinov izlari tozalanadi yoki `description` da «J4 jonli smoke» belgisi bilan
   qoldiriladi (M1 smoke naqshi).

**Qabul mezoni:** yuqoridagi 7 banddan **7 tasi ham ✔**; kassa smenasi
uzilmagan; `warehouse-state.ts` EXIT=0 va «POS yeta olmaydigan qoldiq: 0»
smoke'dan keyin ham saqlangan.

**Qaytarish yo'li:** bayroqni o'chirish (bitta tugma) — kassa avvalgi xulqiga
bir zumda qaytadi; reyestr joyida qoladi.

**PROMPT:**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) J-rejani va K-rejani (ayniqsa K3, K4, K5 hisobotlarini) TO'LIQ o'qi.
2) Sen FAQAT J4 — «Bayroqni yoqish + qoida 13 uchma-uch smoke'i» fazasini bajarasan.
3) 🔴 Bu faza JONLI SAVDOGA tegadi. Har qadamdan OLDIN qoldiqni o'lcha, KEYIN yana o'lcha,
   farqni hisobotga yoz. Chek yiqilsa (400/500) — DARHOL bayroqni o'chir va qoida 14 protokoli.
4) Smoke'ning 7 bandini TARTIB BILAN bajar, birortasini ham «ehtimol ishlaydi» deb o'tkazma.
5) §5 ga «### J4 — ...» hisobotini yoz (7 band ✔/✘, o'lchangan raqamlar, chek raqamlari,
   «qaysi oqimni buzishi mumkin?», ochiq qolganlar).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```

---

### J5 — 1 hafta kuzatuv (K6/4 ning HAQIQIY piloti)

**Maqsad:** funksiya odamlar qo'lida ishlashini isbotlash — kodda emas.

**Vazifalar:**

1. **7 kun** davomida pilot tovarlari jonli savdoda ishlatiladi.
2. **Kunlik sverka signali** (cron 20:00) kuzatiladi: farq chiqqan kun,
   tovar va sabab jurnalda yoziladi. Eng ko'p kutilgan sabab —
   **omborchi yorliq bosishni unutgani**.
3. Har kun qisqa qator: sana · nechta kesim · sverka farqi · hodisa.
4. Hafta oxirida **odamlardan tasdiq**: kassir «bo'laklar to'g'ri ko'rinyapti»,
   omborchi «kesim oqimi ish beryapti» — **ism va sana bilan** (K6 qabul
   mezonining talabi).
5. Kunlik cronning og'irligi o'lchanadi (K6 hisobotidagi ochiq xavf: bayroq
   ko'p tovarga yoyilsa so'rov og'irlashadi).

**Qabul mezoni:** 7 kun to'lgan; **tizimli** sverka farqi yo'q (bir martalik
odam xatosi hisobga olinmaydi, lekin yoziladi); kassir va omborchi tasdig'i
ism+sana bilan hisobotda; kesim tufayli birorta chek yiqilmagan.

**Qaytarish yo'li:** istalgan kuni bayroqni o'chirish; reyestr saqlanadi va
keyin qayta yoqilganda ishlatiladi.

**PROMPT:**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) J-rejani va K-rejaning K6 hisobotini TO'LIQ o'qi.
2) Sen FAQAT J5 — «1 hafta kuzatuv (K6/4 piloti)» fazasini bajarasan.
   Bu faza KOD EMAS, KUZATUV: har kuni o'lchov, jurnal qatori, xulosani yozish.
3) Sverka farqi chiqsa — sababini KODDAN emas, MA'LUMOTDAN topib ko'rsat
   (qaysi bo'lak, qaysi kesim, qaysi chek).
4) Hafta to'lmaguncha fazani «TUGADI» deb yopma.
5) §5 ga «### J5 — ...» hisobotini yoz (kunlik jadval, tasdiq bergan odamlar ism+sana,
   qabul mezoni ✔/✘, cron og'irligi o'lchovi).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```

---

### J6 — «Hal qilinmagan» 629 tovarni tozalash sirti

**Maqsad:** K6 ning navbati amalda yopilsin. Bugun ro'yxatda **629 ta** tovar
bor va ular bittalab bosiladigan qilib qurilgan — bu jismonan bajarilmaydigan
ish.

**Vazifalar:**

1. `/omborchi/hal-qilinmagan` ekraniga **ommaviy qaror**: belgilangan
   tovarlarga bir marta «bo'lak hisobi KERAK EMAS» qo'yish
   (`piecetracking.update` talab qiladi, qaror muhri har tovarga alohida
   yoziladi).
2. Filtrlar: guruh bo'yicha (masalan «Gofra», «Led shlang»), qoldig'i 0
   bo'lganlar, oxirgi 90 kunda sotilmaganlar.
3. 🔴 **Ommaviy YOQISH ATAYLAB YO'Q** — faqat ommaviy «kerak emas». Yoqish
   xulqni o'zgartiradi (7.1) va bittalab, ko'rib chiqilib qilinadi.
4. Testlar + i18n ru/uz.

**Qabul mezoni:** ro'yxat 629 dan egasi belgilagan darajaga tushgan; ommaviy
qarordan keyin birorta tovarda bayroq YOQILMAGAN (test bilan qulflangan);
`products` dan boshqa jadvalga yozilmagan.

**PROMPT:**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) J-rejani va K-rejaning K6 hisobotini TO'LIQ o'qi.
2) Sen FAQAT J6 — «Hal qilinmagan ro'yxatini ommaviy tozalash sirti» fazasini bajarasan.
3) 🔴 Ommaviy YOQISH qilma — faqat ommaviy «kerak emas». Sababi J-rejaning §1.1/1-dalili.
4) Migratsiya kerak emas (ustunlar K6 da qo'shilgan). Testlar + i18n ru/uz majburiy.
5) §5 ga «### J6 — ...» hisobotini yoz (qabul mezoni ✔/✘, «qaysi oqimni buzishi mumkin?»).
6) KEYINGI FAZANI BOSHLAMA. TO'XTA.
```

---

### J7 — K-rejani YOPISH + yoyish qarori

**Maqsad:** oltala «⚠️ QISMAN» ni haqiqiy holatga keltirish va keyingi qadamni
egasining qaroriga qo'yish.

**Vazifalar:**

1. K-rejaning **sarlavhasidagi eskirgan matn tuzatiladi**: hozir «egasi
   deploy'ni RAD ETDI» deb turibdi, holbuki deploy 2026-08-29 da bajarilgan.
2. J1…J5 natijalari asosida K1…K6 ning har biriga **TUGADI / QISMAN** hukmi
   qo'yiladi — har biri o'z qabul mezonining bandlari bo'yicha, bittalab.
3. `docs/ops/jonli-holat.md` ga yakuniy qator (bo'lak hisobi qaysi tovarlarda
   yoqilgan, reyestrda nechta bo'lak bor).
4. **Yoyish qarori (egasi):** pilotdan keyin 73 ta kabel tovariga yoyiladimi,
   qancha vaqtda, kim kiritadi. Qaror hisobotda yoziladi.
5. Ochiq savollarga (J-S1…J-S4, §6) javoblar yig'iladi.

**Qabul mezoni:** K-rejada birorta faza «noaniq» holatda qolmagan; jonli holat
reyestri yangilangan; yoyish qarori sana bilan yozilgan.

**PROMPT:**

```
Sen Sherset ERP loyihasida ishlayapsan (D:\sherset-v2).

1) J-rejani (barcha §5 hisobotlari bilan) va K-rejani TO'LIQ o'qi.
2) Sen FAQAT J7 — «K-rejani yopish + yoyish qarori» fazasini bajarasan.
3) Hukmni O'ZING yumshatma: qabul mezonining bandi bajarilmagan bo'lsa «QISMAN» bo'lib qoladi.
4) K-rejaning eskirgan sarlavhasini (deploy RAD ETILGAN) haqiqiy holatga keltir.
5) §5 ga «### J7 — ...» hisobotini yoz.
6) TO'XTA.
```

---

## 5. HISOBOTLAR (har faza o'z hisobotini SHU YERGA yozadi)

### J2 — Bayroq gigienasi + pilot doirasini o'lchash · ⚠️ QISMAN (qoida 11) · 2026-09-04

**Holat: QISMAN.** Qabul mezonining **uchtadan ikkitasi** bajarildi: jonlida
`piece_tracked = true` tovarlar soni **0** (o'lchandi, bashorat emas) va audit
skripti nomzodlarni manba soni bilan ko'rsatdi. Uchinchi band — **egasi 5–8
tovarlik pilot ro'yxatini ISM bilan tasdiqlashi** — hali bajarilmagan: egasi
bayroqlarni o'chirishga ruxsat berdi va J-S1 ga javob qaytardi, lekin pilot
ro'yxatini tanlamadi. **Faza «TUGADI» deb yopilmaydi** (rule 11 — hukm
yumshatilmaydi). Ro'yxat kelgan zahoti shu hisobotning 7-bandi to'ldiriladi va
holat ✅ ga o'zgaradi. **J3 shu ro'yxatsiz boshlanmaydi** — uning butun ishi
o'sha 5–8 tovarni sanashdan iborat.

Migratsiya YO'Q, deploy YO'Q. Jonli bazada o'zgargan YAGONA jadval —
`products` (6 qator, 3 ustun). `stock_pieces`, `stocks`, `stock_by_cell`,
`store_cells` — **bir bayt ham tegilmadi**.

---

**0. Birinchi navbatda: HOLAT QAYTA O'LCHANDI (J2 vazifasining talabi).**

J1 hisoboti «bayroq yoqish DAVOM ETAYOTGANI uchun J2 avval HOLATNI QAYTA
O'LCHASIN — ro'yxat yana o'sgan bo'lishi mumkin» degan edi. O'lchandi
(2026-09-04 15:32 UTC): **ro'yxat o'smadi, hamon 6 ta.**

| Tovar | Birlik | Qoldiq | Manba | Faol bo'lak | 30 kunda chek | Qaror |
|---|---|---|---|---|---|---|
| Azia Avvg 3x25 1X16 | м | 10 586 | **1** | 0 | 6 | 2026-09-02 12:06 · Admin User |
| Azia Avvg 3x50 1X25 | м | 10 789 | **1** | 0 | 4 | 2026-09-02 12:07 · Admin User |
| Uz kg 1x25 1 | м | 11 000 | **1** | 0 | 0 | 2026-09-04 10:53 · Admin User |
| Uz vvgng  5x25 | м | **100** ⚠️ | **1** | 0 | 0 | 2026-09-04 11:25 · Admin User |
| Vayr vvg 3x1.5 | м | 11 000 | **1** | 0 | 0 | 2026-09-03 08:41 · Admin User |
| Vesta ramka 2X | **шт** 🔴 | 10 976 | **1** | 0 | 3 | 2026-09-02 09:56 · Admin User |

`stock_pieces` — **0 qator** (J1 dagidek).

Ikki o'zgarish J1 dan beri: `Uz vvgng  5x25` qoldig'i **0 → 100** (priyomka
bo'lgan; J1 uni «butunlay zararsiz» degan edi, endi u ham qoldiqli tovar), va
oltala tovarning **qaror muhri allaqachon qo'yilgan** (`decidedAt` to'lgan) —
ya'ni ular «Hal qilinmagan» ro'yxatida turmagan, kimdir ataylab bosgan.

🟢 **Eng muhim o'lchov: oltalasining ham manbasi AYNAN 1 ta.** Ya'ni J-reja
3.2 dagi «hozircha hech qanday chek yiqilmaydi» xulosasi **6 tovar uchun ham,
bugungi kunga ham kuchda edi** — bayroq yoqilgan uch kun ichida 7.1 istisnosi
birorta chekni yiqitmagan. Bu taxmin emas: manba sanog'i taqsimot dvigateli
(`retail-allocation.ts` → `buildSources`) bilan AYNI semantikada hisoblanadi.

---

**1. Ikki tomonlama bog'liqlik javobi (qoida 10 — «bu o'zgarish qaysi mavjud
oqimni buzishi mumkin?»).**

| Oqim | Ta'sir | Dalil |
|---|---|---|
| **Kassa sotuvi / taqsimot** | 🔴 **ATAYLAB O'ZGARDI — TESKARI yo'nalishda** | Bayroq o'chgani uchun oltala tovarda avto-taqsimotning **3-holati (bo'lish) QAYTA YOQILDI**, ya'ni kassa 2026-09-02 dan oldingi xulqiga qaytdi. Bu **kengaytirish**, torayish emas: ilgari o'tmaydigan chek endi o'tadi, o'tadigani o'taveradi. Yangi rad etish sinfi paydo bo'lmaydi. |
| **Qoldiq (`Stock` / `StockByCell`)** | **YO'Q** | Yagona chaqirilgan marshrut — `POST /stock-pieces/flag`, uning servisi (`stock-piece-registry.service.ts:275-297`) faqat `product.findFirst` + `product.update` qiladi. Amaldan KEYIN `warehouse-state.ts` jonlida yuritildi: **EXIT=0**, split «bajarilgan» (mos **1456**, mos emas **0**), **«POS yeta olmaydigan qoldiq: 0»**, «✅ Reyestrga MOS — farq yo'q». |
| **Bo'lak reyestri (`stock_pieces`)** | **YO'Q** | Amaldan oldin ham, keyin ham **0 qator** (skript o'zi o'lchaydi va hisobotning boshida chiqaradi). |
| **«Hal qilinmagan» ro'yxati (K6/3)** | ⚠️ **O'ZGARDI, lekin qisqardi emas** | Oltala tovarning qaror muhri J2 dan OLDIN ham to'lgan edi ⇒ ular ro'yxatda turmagan. Marshrut muhrni YANGILADI (sana 2026-09-04 15:38), ro'yxatga esa hech kim qo'shilmadi va chiqmadi. |
| **Qaror muhri semantikasi** | ⚠️ **ONGLI CHEGARA** | `POST /stock-pieces/flag` «yo'q» ni ham QAROR deb muhrlaydi (`buildFlagDecisionPatch`). Ya'ni «vaqtincha o'chirdik, J4 da qaytaramiz» degan holat DB'da «bo'lak hisobi kerak emas deb qaror qilindi» ko'rinishida yotadi. Muhrni chetlab o'tish SQL talab qilardi (J2 prompti taqiqlagan) va UI tugmasi ham AYNAN shunday ishlaydi ⇒ ataylab shu yo'l tanlandi. J4 bayroqni qaytarganda muhr yana yangilanadi. Bu farq **faqat hujjatda** yashaydi — shu sabab jonli holat reyestriga ham, shu bandga ham ochiq yozildi. |
| **Ruxsat matritsasi / rollar** | **YO'Q** | Yangi entity ham, marshrut ham qo'shilmadi. Skript mavjud `piecetracking.update` ruxsati bilan, mavjud xodim (`Admin User`) tokeni ostida ishladi. |
| **`packages/db` skriptlari (J1)** | **YO'Q** | Tegilmadi. |
| **TSD / kiosk / i18n** | **YO'Q** | Yangi sirt yo'q; skript CLI, matni o'zbekcha. Web i18n darvozalari baribir yugurtirildi — yashil. |
| **Eng yomon holat** | Marshrut yarim yo'lda yiqiladi | Har tovar ALOHIDA `POST` — atomar `product.update`. Yarim bajarilgan holatda ham hech nima buzilmaydi: bir qism tovarda bayroq o'chgan, qolganida yoqiq — ikkalasi ham to'g'ri ishlaydigan holat. Skript qayta yuritilsa qolganini tugatadi (idempotent). |

---

**2. Nima qurildi (4 fayl, migratsiya YO'Q).**

**`apps/api/src/scripts/j2-pilot-audit-core.ts`** — sof yadro (Prisma yo'q,
SQL yo'q, HTTP yo'q):

- `buildPieceSources` — 🔴 **J2 ning yuragi.** Manbani `retail-allocation.ts`
  ning `buildSources` bilan AYNI sanoqda quradi: har yacheyka bitta manba,
  ombordagi YACHEYKASIZ qoldiq esa alohida psevdo-manba. BRAK va kaskaddan
  tashqari ombor manba sanalmaydi, lekin qoldig'i **ko'rinadi**
  (`unreachableQty`) — jim yo'qolmaydi. Yacheykalar yig'indisi ombor
  qoldig'idan katta bo'lsa `overCelledStores` bilan qichqiradi.
  ⚠️ Manba ATAYLAB `qty` bo'yicha sanaladi, `qty − reserved` bo'yicha emas:
  rezerv soatlab o'zgaradi, tovarning JISMONIY tarqoqligi esa yo'q.
- `planFlagOff` — o'chirish sababini ISM bilan beradi (`birlik-metr-emas` ·
  `reyestr-bosh` · `reyestr-tolgan`). 🔴 **`reyestr-tolgan` ataylab «xavfsiz
  emas»**: reyestri to'lgan tovarda bayroqni skript O'ZI o'chirmaydi,
  `--force` talab qiladi — bu QAROR odamniki (bugun 0 ta shunday tovar bor
  edi, lekin J3 dan keyin bo'ladi).
- `evaluateCandidate` / `rankCandidates` / `summarizeGroups` — nomzodlarni
  BAHOLAYDI, lekin **tanlamaydi**: faqat qat'iy to'siqlarni sanaydi
  (`manba-1-dan-kop` · `qoldiq-yoq` · `birlik-metr-emas`).

**`apps/api/src/scripts/ops-j2-piece-pilot-audit.ts`** — DRY sukut, `--apply`
bilan **faqat `POST /stock-pieces/flag`**. Hisoboti besh bo'lim: hozirgi holat
· gigiena rejasi · pilot nomzodlari · yozish · qabul mezoni. 🔴 **Yoqish yo'li
ATAYLAB YO'Q** — skript bayroqni faqat O'CHIRA oladi (yoqish J4 ning ishi va u
ko'z bilan ko'rilib, bittalab bosiladi).

**Testlar (+31):** `j2-pilot-audit-core.test.ts` **20** (manba sanog'i,
gigiena sabablari, to'siqlar, saralash, guruh kesimi) + yangi
`j2-pilot-audit-guard.test.ts` **11** — skriptning SHAKLINI matndan qulflaydi
(`q5-backfill-scripts-guard` naqshi, izohlar olib tashlanadi):

- `--apply` siz yozish shoxi ochilmasligi;
- **birorta yozadigan Prisma chaqirig'i yo'qligi** (`prisma.*` faqat
  `findMany`/`findFirst`/`groupBy`/`count` — mexanik ro'yxat, yangi metod
  qo'shilsa test yiqiladi);
- bayroq FAQAT marshrut orqali o'zgarishi;
- `/stock-pieces/flag` ga `pieceTracked: true` yuboradigan yo'l yo'qligi;
- yadroda Prisma ham, `fetch` ham yo'qligi.

---

**3. JONLI DRY natijalari (`sherset_v2` @ 13.140.157.10, faqat O'QISH).**

J1 naqshi: skript jonli daraxtga MERGE QILINMADI — ikki fayl izolyatsiyalangan
`apps/api/src/scripts-j2/` katalogiga qo'yildi (nisbiy importlar AYNAN bir xil
chuqurlikda ishlaydi), yugurtirildi va **katalog o'chirildi**. Yugurishdan
keyin `git status apps/api/src` — bizning bir ham faylimiz yo'q.

DRY **EXIT=0**, hisobot 0-banddagi jadvalni chiqardi va yozish shoxida oltala
`POST` ning tanasini AYNAN bosib ko'rsatdi («hech nima yozilmadi»).

---

**4. APPLY natijalari (2026-09-04 15:38:05 UTC, egasining tasdig'i bilan).**

Oldshart tekshirildi: `pm2` da `sherset-v2-api` **online**, marshrut
`POST /api/v1/stock-pieces/flag` **401** qaytardi (mavjud va himoyalangan).

```
Token: Admin User (admin@demo.local)
OK   Azia Avvg 3x25 1X16        pieceTracked=false · qaror muhri 2026-09-04T15:38:05.354Z
OK   Vayr vvg 3x1.5             pieceTracked=false · qaror muhri 2026-09-04T15:38:05.414Z
OK   Uz vvgng  5x25             pieceTracked=false · qaror muhri 2026-09-04T15:38:05.442Z
OK   Azia Avvg 3x50 1X25        pieceTracked=false · qaror muhri 2026-09-04T15:38:05.475Z
OK   Uz kg 1x25 1               pieceTracked=false · qaror muhri 2026-09-04T15:38:05.520Z
OK   Vesta ramka 2X             pieceTracked=false · qaror muhri 2026-09-04T15:38:05.545Z
```

Oltala `POST` ham 2xx — birortasi ham 4xx/5xx olmadi.

**Mustaqil tekshiruv (amaldan keyin, alohida yugurish):**

| O'lchov | Natija |
|---|---|
| `piece_tracked = true` soni | **0** («yo'q — bayroq hech qayerda yoqilmagan») |
| `stock_pieces` | **0 qator · faol 0** (o'zgarmadi) |
| `warehouse-state.ts` (serverdagi versiya) | **EXIT=0** · split «bajarilgan» (mos **1456**, mos emas 0) · **POS yeta olmaydigan qoldiq 0** · «✅ Reyestrga MOS» |

⚠️ **Halol qayd:** `warehouse-state` ning JAMI qoldig'i J1 dagidan farq qiladi
(50 469 774,884557 → **50 514 463,784557**; yacheykalarda 506 634,6 →
506 563,6). Bu **bizning ishimiz emas** — oradan bir kunlik jonli savdo o'tdi.
Bizning amalimiz qoldiqqa tega olmasligining dalili qoldiq raqamida emas,
**marshrut kodida** (`setFlag` faqat `product.update` qiladi) va **qo'riqchi
testida** (skriptda yozadigan Prisma chaqirig'i yo'qligi mexanik tekshiriladi).

---

**5. 🔴 IKKI O'LCHOV REJADAGIDAN FARQ QILDI.**

**(a) Metrli tovar — 632 emas, 634; tiriklari esa 547.**
J-reja §1 «birligi «м» tovarlar — **632 ta**» deb yozadi. Bugungi o'lchov:
**547 tirik + 87 o'chirilgan = 634**. Ya'ni rejadagi son `deleted_at` filtri
BO'LMAGAN so'rovdan olingan. Skript «м/m» bilan boshlanadigan, lekin metr deb
TANILMAGAN birliklarni ham alohida sanadi — **bittasi ham yo'q**, ya'ni farq
`isMeterUom` ning tor ro'yxatidan emas, aynan o'chirilgan tovarlardan.

> **Nima o'zgaradi:** pilot va **J6 ning «hal qilinmagan» navbati faqat 547
> tirik tovarga** tegishli — 629 emas. J6 ni bajaradigan agent o'z sonini
> QAYTA o'lchasin (bugun o'lchanmadi: J6 ning ro'yxati `decidedAt IS NULL`
> shartiga ham qaraydi).

**(b) Kabel doirasi — 73 emas, 94.**
J1 papka bo'yicha 73 ta deb o'lchagan (Uz 35 · Vayr 23 · Azia 15) va bu
**AYNAN tasdiqlandi**. Lekin nomida «kabel» bo'lgan, papkasi boshqa tovarlar
ham bor — ular ilgari sanalmagan:

| Papka | Tovar | Manbasi 1 | 30 kunda sotilgan | Jami qoldiq |
|---|---|---|---|---|
| Uz kabel | 35 | 33 | 23 | 454 100,885 |
| Vayr kabel | 23 | 23 | 8 | 222 284,5 |
| **(papkasiz)** | **20** | 19 | 11 | 213 016,3 |
| Azia kabel | 15 | 14 | 13 | 397 184,2 |
| Andijon | 1 | 1 | 0 | 11 000 |
| **JAMI** | **94** | **90** | **55** | — |

🟢 **90 tasi kiritilishi mumkin** (manbasi aynan 1 va qoldig'i bor) — ya'ni
7.1 istisnosi kabel qatlamida deyarli hech kimni to'smaydi. Sababi J-reja
§1 da yozilgan: metrli qoldiqning deyarli hammasi «Taqsimlanmagan» hovuzida,
yacheykasiz ⇒ har tovarda bitta psevdo-manba.

---

**6. PILOT NOMZODLARI — o'lchov (eng ko'p sotilgan 15 tasi).**

Saralash: 30 kunda nechta CHEKda sotilgani (J2 mezoni «eng ko'p
sotiladigan»). Hammasining manbasi **1**, ya'ni hammasi kiritilishi mumkin.

| # | Tovar | Papka | Qoldiq | Eng katta manba | 30k chek | 30k miqdor |
|---|---|---|---|---|---|---|
| 1 | Uz apunp 2x4 | Uz kabel | 5 854,5 | 5 854,5 | **54** | 6 220,5 |
| 2 | Uz punp 2x2.5 | Uz kabel | 9 068 | 9 068 | **51** | 4 432 |
| 3 | Uz apunp 2x2.5 | Uz kabel | 101 858 | 101 858 | **42** | 13 705 |
| 4 | Uz punp 2x1.5 | Uz kabel | 9 588 | 9 588 | **38** | 3 662 |
| 5 | Skoba kabEl 2*2.5 | (papkasiz) | 10 954,5 | 10 954,5 | **38** | 1 545,5 |
| 6 | Uz pugnp 2x1 | Uz kabel | 10 276 | 10 276 | **37** | 3 724 |
| 7 | Azia apunp 2x6 | Azia kabel | 7 632 | 7 632 | **35** | 3 397 |
| 8 | Azia pugnp 2x1.5 | Azia kabel | 103 796 | 103 796 | **33** | 12 707 |
| 9 | Azia pugnp 2x2.5 | Azia kabel | 2 065,7 | 2 065,7 | **27** | 8 934,3 |
| 10 | Azia apunp 2x4 | Azia kabel | 103 526 | 103 526 | **27** | 7 474 |
| 11 | Azia apunp 2x2.5 | Azia kabel | 4 850 | 4 850 | **22** | 6 150 |
| 12 | Uz apunp 2x10 | Uz kabel | 10 382 | 10 382 | **22** | 618 |
| 13 | Uz pugnp 3x2.5 | Uz kabel | 9 064 | 9 064 | **21** | 1 936 |
| 14 | Azia pugnp 2x4 | Azia kabel | 9 777,5 | 9 777,5 | **20** | 1 222,5 |
| 15 | Uz pvs 2x2.5 | Uz kabel | 11 534 | 11 534 | **19** | 466 |

⚠️ **Bu jadval TAVSIYA EMAS, O'LCHOV.** J2 vazifa 4 uch mezonni qo'yadi:
«eng ko'p sotiladigan» (jadvaldagi ustun), «manbasi bitta» (hammasi ✔) va
**«omborchi jismonan sanay oladigan»** — uchinchisini skript o'lchay olmaydi
va aynan u J3 ning ish hajmini belgilaydi (masalan `Azia pugnp 2x1.5` ning
103 796 m i necha rulon? Uni bir kunda sanab bo'ladimi?). Shuning uchun
**tanlov egasiniki**.

🔴 **Ogohlantirish (J-reja 3.3 ning ayni o'zi):** 3, 8, 10-qatorlardagi
~100 000 m lik qoldiqlar va 4-, 6-, 12–15-qatorlardagi «yumaloq» 9 000–11 500
sonlar jismoniy sanoq bilan tasdiqlanmagan. Pilotga aynan shular kiritilsa
J3 ning birinchi kuni katta farq chiqishi kutiladi — bu **topilma**, nosozlik
emas (J-S5 shu haqda).

---

**7. TANLANGAN PILOT RO'YXATI — ⏳ KUTILMOQDA**

| # | Tovar | Kim tanladi | Sana |
|---|---|---|---|
| — | *(egasi hali tanlamadi)* | — | — |

🔴 **J3 shu jadval to'lmaguncha boshlanmaydi.** To'lgach: shu hisobotning
holati ✅ TUGADI ga o'zgaradi va `docs/ops/jonli-holat.md` ga ro'yxat qatori
qo'shiladi.

---

**8. Testlar / darvozalar.**

| Gate | Natija |
|---|---|
| Yangi `j2-pilot-audit-core.test.ts` | **20** ✅ |
| Yangi `j2-pilot-audit-guard.test.ts` | **11** ✅ |
| `apps/api/src/scripts/` to'plami | 14 fayl · **354 test** ✅ (J1 da 323 edi) |
| `tsc --noEmit` — `apps/api` | ✅ 0 xato |
| biome (tegilgan 4 fayl) | ✅ 0 **error** (mavjud `noConsole` OGOHLANTIRISHLARI CLI skriptlarida avvaldan bor) |
| Fayl kodlashi (2026-09-01 hodisasi qo'riqchisi) | 4 fayl ham **UTF-8, BOM yo'q, mojibake yo'q** |

---

**9. Qabul mezoni — bandma-band (qoida 11).**

| # | Mezon | Holat |
|---|---|---|
| 1 | Jonlida `piece_tracked = true` tovarlar soni **0** | ✔ **o'lchandi** (amaldan keyin alohida yugurish, «bashorat» emas) |
| 2 | Audit skripti pilot nomzodlarini **manba soni bilan** ko'rsatgan | ✔ 94 qator, har birida manba soni + eng katta manba + 30 kunlik savdo |
| 3 | Egasi **5–8 tovarlik ro'yxatni tasdiqlagan** (ism + sana hisobotda) | ✘ **BAJARILMAGAN** — 7-band bo'sh |

**Uchtadan ikkitasi ⇒ J2 «QISMAN».**

---

**10. Qaytarish yo'li (qoida 12).**

- **Jonli o'zgarish:** har tovarda bitta tugma — tovar kartochkasidagi «Bo'lak
  hisobi yuritilsin» (yoki `POST /stock-pieces/flag` `pieceTracked: true`).
  Migratsiya ham, deploy ham, skript ham kerak emas. Reyestr bo'sh bo'lgani
  uchun qaytarish hech qanday ma'lumotni tiklashni talab qilmaydi.
- **Kod:** `git revert <commit>` — repoga faqat yangi fayllar qo'shildi,
  mavjud birorta fayl o'zgartirilmadi.

**Qoida 14:** VPS'da yozilgan skript YO'Q — ikkita fayl repodagi (commit
qilingan) nusxalari edi va yugurishdan keyin katalog bilan birga o'chirildi.

**Qoida 13 (uchma-uch smoke):** J2 kassa xulqini KENGAYTIRDI (bo'lish qayta
yoqildi), ya'ni yangi rad etish sinfi ochmadi ⇒ to'liq smoke QO'LLANMAYDI.
Uning o'rniga `warehouse-state.ts` qo'riqchisi yuritildi (EXIT=0, POS yeta
olmaydigan qoldiq 0). To'liq smoke — J4 ning ishi.

---

**11. Ochiq qolganlar / keyingi fazalarga.**

- 🔴 **EGASIGA:** pilot ro'yxati (5–8 tovar) — 7-band. **J3 ni bloklaydi.**
- 🟢 **J-S1 YOPILDI (egasi, 2026-09-04):** `Vesta ramka 2X` da bayroq **xato**
  qo'yilgan edi. Bayroq o'chirildi, §6 yangilandi.
- ⚠️ **Qaror muhri semantikasi** (1-banddagi «ONGLI CHEGARA»): DB'da beshala
  kabel «bo'lak hisobi kerak emas» deb turibdi, holbuki niyat «vaqtincha».
  J4 buni qaytaradi; oraliqda kimdir `/omborchi/hal-qilinmagan` ekraniga
  qarasa ularni ko'rmaydi. Agar bu chalkashlik jiddiy bo'lsa — «vaqtincha
  o'chirildi» holati ALOHIDA ish (K6 ga uchinchi holat qo'shish).
- ⚠️ **J6 ning soni QAYTA o'lchansin** — 5(a) bandi: 629 emas, tirik metrli
  tovar 547 (undan ham `decidedAt` to'lganlari ayriladi).
- ⚠️ **Nomzodlar ro'yxatidagi «(papkasiz) 20 ta»** — `Skoba kabEl 2*2.5`,
  `Kabel 1x6  qora qizil`, `tv kabel 1700` kabi tovarlar papkasiz. Bular
  kabel guruhiga tegishlimi yoki katalog tartibsizligimi — pilotga kiritishdan
  oldin egasi qarasin (`Skoba kabEl` 30 kunda **38 chek** bilan 5-o'rinda).
- ℹ️ **Jonli VPS holati (yo'l-yo'lakay):** `/var/www/sherset-v2` HEAD
  J1 dagi `ef99ecb1` dan **`af38fa11`** ga o'zgargan — oradan yana bir deploy
  o'tgan. Ombor tuzilmasiga ta'siri yo'q (`warehouse-state` EXIT=0).
- ℹ️ **SSH beqaror:** jonliga ulanish har uchinchi-to'rtinchi urinishda
  «Software caused connection abort» beradi (fail2ban tezlik chegarasi
  ko'rinadi). Keyingi fazalar ulanishni takrorlash halqasi bilan qilsin.

---

### J1 — T1 qarzi: `packages/db` skriptlari bo'lak reyestrini bilsin · ✅ TUGADI · 2026-09-04

**Holat: TUGADI** (qoida 11 — qabul mezonining TO'RTALA bandi ham bajarildi).
Migratsiya YO'Q, deploy YO'Q, jonli ma'lumotga BIR BAYT ham yozilmadi: jonli
bazaga faqat DRY (O'QISH) so'rovlar ketdi. Faza boshlanganda `stock_pieces` = 0
qator edi va tugaganda ham 0 qator — bu ATAYLAB: T1 ni aynan reyestr bo'sh
paytda yopish J-rejaning 2-bo'lim/1-qoidasi.

---

**0. 🔴 BIRINCHI NAVBATDA: jonli o'lchov REJADAGIDAN FARQ QILDI.**

J-reja §1 «`products.piece_tracked = true` — **4 ta**» deb yozadi. Bugun
17:5x (Toshkent) da o'lchandi — **6 ta**:

| Tovar | Birlik | Qaror qo'yilgan vaqt (server, CEST) | Ombor qoldig'i |
|---|---|---|---|
| Azia Avvg 3x25 1X16 | м | 2026-09-02 14:06 | 10 586 |
| Azia Avvg 3x50 1X25 | м | 2026-09-02 14:07 | 10 789 |
| **Uz kg 1x25 1** | м | **2026-09-04 12:53** | 11 000 |
| **Uz vvgng  5x25** | м | **2026-09-04 13:25** | **0** |
| Vayr vvg 3x1.5 | м | 2026-09-03 10:41 | 11 000 |
| Vesta ramka 2X | **шт** | 2026-09-02 11:56 | 10 976 |

Ya'ni **ikkita bayroq BUGUN, J-reja yozilgandan KEYIN qo'lda yoqilgan**.
Reyestr esa hamon bo'sh ⇒ o'sha ikki tovarda ham 7.1 istisnosi ALLAQACHON
kuchda, foydasi esa yo'q. Bu J-rejaning 3.2 xavfi o'sib borayotganini
ko'rsatadi: **J2 ning doirasi 4 emas, 6 tovar** va u kechiktirilsa ro'yxat
yana o'sadi. `Uz vvgng  5x25` qoldig'i 0 ⇒ hozircha butunlay zararsiz.

🟢 Yaxshi xabar: oltalasining ham qoldig'i FAQAT «Taqsimlanmagan» da va
YACHEYKASIZ ⇒ manba bitta ⇒ 7.1 istisnosi hozircha birorta chekni yiqitmaydi
(J-reja 3.2 dagi xulosa 6 tovar uchun ham kuchda).

---

**1. Ikki tomonlama bog'liqlik javobi (qoida 10 — «bu o'zgarish qaysi mavjud
oqimni buzishi mumkin?»).** «Buzmaydi» degani dalil bilan:

| Oqim | Ta'sir | Dalil |
|---|---|---|
| **Kassa sotuvi / taqsimot** | **YO'Q** | `apps/api` ga BIR BAYT ham tegilmadi (o'zgargan fayllar ro'yxati 2-bandda: hammasi `packages/db/scripts/` va `apps/api/src/scripts/*.test.ts`). Skriptlar API jarayoni ichida umuman ishlamaydi — ular qo'lda yuritiladigan CLI. |
| **Qoldiq (`Stock`/`StockByCell`)** | **YO'Q** | Yangi yozuvlarning YAGONA nishoni — `stock_pieces.store_id`. `warehouse-split` va `-revert` ning mavjud `stock`/`stockByCell` yozuvlari BIR QATOR ham o'zgarmadi; lokal isbotda V0 («JAMI qoldiq/qiymat/rezerv o'zgarmadi») va V1–V3 avvalgidek OK. |
| **`warehouse-state.ts` (qoida 8 deploy qo'riqchisi)** | **YO'Q** | Bo'lak driftlari HAMMASI `ogohlantirish`; `exitCodeFor` faqat `xato` ni sanaydi (test bilan qulflangan). Jonlida ESKI va YANGI versiya YONMA-YON yugurtirildi: ikkalasi ham **EXIT=0**, jadvaldagi HAR BIR raqam AYNAN bir xil (3-band). |
| **`stock-baseline-cleanup.ts`** | 🔴 **ATAYLAB O'ZGARDI** — bayroqli tovar endi RAD ETILADI | Bu fazaning maqsadi. Bayroqsiz tovarda xulq AYNAN avvalgidek (test: `off.lines` ≡ `absent.lines`). Jonli DRY: **5 qator rad etildi**, hisobot jamisi hamon `0 tovar · 0 dona` (bugungi holat baribir no-op edi — pastda 4-band halol qayd). |
| **`create-cells.ts --revert`** | 🔴 **ATAYLAB O'ZGARDI** — bo'lagi bor yacheyka endi O'CHMAYDI | Faqat `status='active'` to'sadi. `consumed` bo'lak yacheykani QULFLAMAYDI (`stock_operations` shu ro'yxatda bo'lmagani bilan bir sabab) — bu ONGLI chegara, lokal isbotda o'lchandi (4-band). |
| **Bo'lak reyestrining O'ZI (K1…K6 kodi)** | **YO'Q** | `apps/api` dagi `stock-piece` moduliga tegilmadi. Skriptlar reyestrga faqat `store_id` ni ko'chirish uchun yozadi; `length`, `label`, `status`, `cell_id`, `reserved_*` — hech biriga TEGILMAYDI. |
| **TSD / kiosk / ruxsatlar** | **YO'Q** | Yangi marshrut ham, entity ham qo'shilmadi. |
| **i18n** | **YO'Q** | Skriptlar CLI, matnlari o'zbekcha va joyida (J1 vazifa 6). Web i18n gate'lari baribir yugurtirildi — yashil. |
| **Eng yomon holat** | Skript bo'lakni noto'g'ri ko'chiradi | Tranzaksiya ichida `updateMany` sanog'i rejadagidan farq qilsa **ROLLBACK** bo'ladi (`throw`), ya'ni yarim ko'chgan holat qolmaydi. Kassa esa bu skriptlarga umuman bog'liq emas. |

---

**2. Nima o'zgardi (8 skript fayli + 4 test fayli, migratsiya YO'Q).**

**`warehouse-split-core.ts`** (sof yadro, Prisma yo'q):
- `StockPieceRow` kirishi (**ixtiyoriy** — reyestrsiz bazada skript avvalgidek
  ishlaydi), `PieceMovePlan`, `SplitPlan.pieceMoves`, `countPieceMoves`;
- `WarehouseSummaryRow` ga `pieces` / `activePieces`;
- yangi anomaliya `piece-store-mismatch` — bo'lak ombori yacheykasinikiga teng
  bo'lmasa ko'chadi, LEKIN jim emas;
- 🔴 **yacheykasiz (`cellId IS NULL`) bo'lak split'da hovuzda QOLADI** — uning
  qoldig'i ham «Taqsimlanmagan» da qoladi (F4 dizayni);
- `filterPlanTo` bo'laklarni ham kesadi (`--only` = «bir kechada BITTA ombor»).

**`warehouse-split.ts`:** `stock_pieces` o'qish; hisobotda HAR DOIM chiqadigan
`Bo'lak reyestri (K-reja): N bo'lak ko'chadi (faol M)` qatori; **AYNI
tranzaksiyada** `tx.stockPiece.updateMany` (sanog'i mos kelmasa ROLLBACK);
yangi invariant **V4 `piece.storeId == cell.storeId`** (V1 ning bo'lak
varianti, buzilsa EXIT=2).

**`warehouse-split-revert.ts`:** manba ombordagi **HAMMA** bo'lak ko'chadi —
yacheykalilar ham, **hovuzdagilar ham** (bu skript butun omborni bo'shatadi,
ya'ni `cellId IS NULL` shartli chetlash forward split'dagi kabi TO'G'RI
BO'LMASDI); tranzaksiya oxirida «manbada bo'lak QOLMADI» invarianti.

**`stock-baseline-cleanup-core.ts`:** `BaselineRow.pieceTracked` + yangi skip
sababi `bolak-hisobi`. 🔴 **Tekshiruv eng BOSHDA** — bu filtr emas, RAD ETISH:
«ortiqchasi yo'q» deb yashirinsa operator skript bu tovarga tegmasligini
hech qayerdan bilmasdi.

**`stock-baseline-cleanup.ts`:** bayroqni DRY da o'qiydi VA **tranzaksiya
ichida QAYTA o'qiydi** — bayroq K6 kartochkasidagi bitta tugma bilan
yoqiladi (deploy talab qilmaydi), ya'ni DRY↔APPLY orasida poyga BOR.

**`create-cells.ts`:** `--revert` ning «ishlatilgan yacheyka» tekshiruviga
`stock_pieces` (status `active`) qo'shildi — FK `ON DELETE SET NULL` bo'lgani
uchun ilgari bo'lagi bor yacheyka **jimgina** o'chib ketardi.

**`warehouse-state-core.ts`:** `buildPieceState` (ikki qatlamli sverka:
yacheykali bo'g'in `StockByCell` bilan, yacheykasiz bo'g'in
`Stock − Σ StockByCell` bilan — K1 semantikasi) + `pieceStateDrifts`.
**Uch nosozlik ATAYLAB AJRATILGAN**, chunki uchtasi uch xil ish talab qiladi:
`bolak-reyestri-bosh` (J3 ning ishi) · `bolak-bayroqsiz` (K6 ekranidagi
qaror) · `bolak-sverkasi` (haqiqiy invariant buzilishi). Bittaga yig'ilsa
signal «bo'ri keldi» ga aylanardi (E5 sabog'i).

**`warehouse-state.ts`:** bo'lak bandi; bo'laklar **`groupBy`** bilan
o'qiladi (reyestr to'lganda so'rov qator soniga emas, bo'g'in soniga
bog'liq bo'lsin); bayroqli tovar bo'lmasa qoldiq so'rovi **umuman ketmaydi**;
driftlar reyestrdan mustaqil (`--no-registry` da ham chiqadi). **FAQAT
O'QISH qoldi** — qo'riqchi test yozuv chaqiruvlarini mexanik taqiqlaydi.

**Testlar (+38):** `warehouse-split-core.test.ts` +8 · `warehouse-state-core.test.ts`
+8 · `stock-baseline-cleanup-core.test.ts` +5 · **yangi
`apps/api/src/scripts/j1-piece-aware-scripts-guard.test.ts` 17** (skript
hisobot qatorlarini va yozuv-shaklini matndan qulflaydi — `q5-backfill-scripts-guard`
naqshi: izohlar olib tashlanadi, izohdagi so'z dalil emas).

---

**3. JONLI DRY natijalari (`sherset_v2` @ 13.140.157.10, faqat O'QISH).**

Skriptlar jonli daraxtga MERGE QILINMADI: sakkizta fayl izolyatsiyalangan
`packages/db/scripts-j1/` katalogiga qo'yildi (nisbiy importlar va `.env`
yo'li AYNAN bir xil ishlaydi), yugurtirildi va **katalog o'chirildi**.
Yugurishdan keyin server `git status packages/db/` — **bo'sh**, HEAD
o'zgarmagan (`ef99ecb1`).

| Skript | EXIT | Bo'lak qatori |
|---|---|---|
| `warehouse-split.ts` (DRY) | 0 | `Bo'lak reyestri (K-reja): 0 bo'lak ko'chadi (faol 0)` — ko'chadigan yacheyka yo'q (split allaqachon bajarilgan) |
| `warehouse-split-revert.ts --from "Ombor 01"` (DRY) | 0 | `0 bo'lak ko'chadi (faol 0)` — 604 yacheyka / 322 tovar / 54 121,6 dona ko'chardi |
| `stock-baseline-cleanup.ts` (DRY) | 0 | `5 qator RAD ETILDI` · «Tegilmadi: hali sanalmagan 4877, ortiqcha yo'q 1057, **bo'lak hisobi 5**» |
| `create-cells.ts --revert` (DRY, Ombor 01 / stelaj 06+08) | 0 | `0 faol bo'lak · 0 yacheyka SHU SABAB saqlanadi` (mavjud 35, saqlanadi 26, o'chirilardi 9) |
| `warehouse-state.ts` — **ESKI (serverdagi)** | **0** | (bandi yo'q) · «✅ Reyestrga MOS — farq yo'q», POS yeta olmaydigan qoldiq **0** |
| `warehouse-state.ts` — **YANGI (J1)** | **0** | bayroqli tovar **6** · faol bo'lak **0** · farqli tovar **5** (jami −54 351) |

🔴 **Ikkala `warehouse-state` yugurishida jadvalning HAR BIR raqami aynan bir
xil** (1456 yacheyka, ombor qoldiq 50 469 774,884557, yacheykalarda 506 634,6,
split «bajarilgan» 1456/0/0, POS yeta olmaydigan qoldiq 0). Yangi versiya
ustiga ikkita **ogohlantirish** qo'shdi va EXIT baribir **0** bo'lib qoldi.

Yangi band jonlida shuni ko'rsatdi (raqamlar 0-banddagi jadval bilan bir xil):

```
BO'LAK REYESTRI (K-reja): bayroqli tovar 6 · faol bo'lak 0 · farqli tovar 5 (5 bo'g'in, jami -54351)
   · bayroq YOQILGAN, reyestri bo'sh (qoldig'i bor): 5
   · Taqsimlanmagan (yacheykasiz) — Uz kg 1x25 1: qoldiq 11000, reyestr 0, farq -11000 (0 bo'lak)
   ... (yana 4 qator)
⚠️  [ogohlantirish] bolak-reyestri-bosh · [ogohlantirish] bolak-sverkasi
```

`stock_pieces` jonlida **0 qator** ekani alohida SQL bilan ham tasdiqlandi.

---

**4. LOKAL ISBOT (qoida 7 va 12) — reyestr TO'LGAN holat.**

Jonli reyestr bo'sh, ya'ni jonli DRY «bo'lak ROSTDAN ko'chadimi?» degan
savolga javob BERA OLMAYDI. Shuning uchun alohida sinov bazasi qurildi:
**`sherset_j1_probe`** (localhost, `prisma db push`, sun'iy 1 akkaunt / 2 ombor
/ 1 bayroqli tovar) — sinov oxirida **`DROP DATABASE` bilan o'chirildi**
(`sherset_v2_dev` VA jonli baza TEGILMADI).

🔴 **`stock_pieces` uchala jadval qatori kabi `sherset_v2_dev` da `postgres`
egaligida** (`client_operations`, `retail_sale_position_allocations` ham) —
`sherset_dev` foydalanuvchisi ularni O'QIY OLMAYDI. Shu sabab dev baza emas,
alohida probe bazasi ishlatildi. **Bu K1 dan qolgan lokal-muhit qarzi**
(6-bandga yozildi).

| # | Qadam | Natija |
|---|---|---|
| 1 | `create-cells --apply` (97-01-01-01, 97-01-01-02) | 2 yacheyka |
| 2 | `--revert` DRY, bo'laksiz | `o'chiriladi: 2` · `0 faol bo'lak · 0 yacheyka saqlanadi` |
| 3 | 01 ga **faol**, 02 ga **consumed** bo'lak qo'yildi; `--revert` DRY | `o'chiriladi: 1` · **`1 faol bo'lak · 1 yacheyka SHU SABAB saqlanadi`** |
| 4 | `--revert --apply` | `97-01-01-01` **QOLDI** (bo'lagi `cell_id` bilan), `97-01-01-02` o'chdi va `consumed` bo'lakning `cell_id` NULL bo'ldi (`ON DELETE SET NULL` — ONGLI chegara) |
| 5 | Split ssenariysi: yacheykada 250 (butun rulon + 1 consumed), hovuzda 200 (bo'lak); `Stock` 450 | `warehouse-state`: bayroqli 1 · faol bo'lak 2 · **farq 0** |
| 6 | `warehouse-split.ts` DRY | `Bo'lak reyestri: 2 bo'lak ko'chadi (faol 1) — Ombor 01: 2 (faol 1)` |
| 7 | `warehouse-split.ts --apply` | `✓ Ombor 01: 1 yacheyka, 1 qator, 2 bo'lak ko'chdi` · **V0 OK · V1 OK · V2 OK · V3 OK · V4 OK · idempotentlik OK** |
| 8 | `warehouse-state` split'dan KEYIN | Ombor 01: 250/250 · Taqsimlanmagan: 200 hovuzda · **farqli tovar 0** ⇒ invariant IKKALA omborda ham saqlandi |
| 9 | 🔴 **ESKI XULQ qayta tiklandi** (bo'lak qo'lda eski omborga qaytarildi) | `warehouse-state`: **farqli tovar 1 (2 bo'g'in)** — `Ombor 01: qoldiq 250, reyestr 0, farq −250` va `Taqsimlanmagan: qoldiq 0, reyestr 250, farq +250`; **EXIT baribir 0** |
| 10 | O'sha buzuq holatda `warehouse-split.ts --verify` | `V4 piece.storeId == cell.storeId: XATO (2 bo'lak)` · **EXIT=2**; tuzatilgach `V4 OK` · **EXIT=0** |
| 11 | `warehouse-split-revert.ts --from "Ombor 01" --apply` | `2 bo'lak ko'chadi (faol 1)` → uchala bo'lak (hovuzdagi + yacheykali + consumed) «Taqsimlanmagan» da |
| 12 | `stock-baseline-cleanup.ts` DRY (bayroqli kabel ortiqchasi 10 000 = imzo-oralig'ida, bayroqsiz «Gofra» 9 960) | Gofra **o'chadi** (avvalgidek), kabel **RAD ETILDI**: `Tegilmadi: bo'lak hisobi … 2` |

**9-qadam T1 qarzining ZARARINI aynan ko'rsatadi:** bo'lak eski omborda
qolsa sverka ikkala omborda ham yolg'on beradi — birida «qoldiq bor, reyestr
yo'q», ikkinchisida «reyestr bor, qoldiq yo'q». Reyestr to'lgan kunidan
boshlab HAR split shuni yozib ketardi.

⚠️ **Halol qayd (jonli DRY haqida):** bugun `stock-baseline-cleanup` ning
rad etgan 5 qatori baribir yozilmasdi — ular `assignedQty = 0` bo'lgani uchun
eski mantiqda ham `sanalmagan` deb chetlab o'tilardi. Rad etish **J3 dan
keyin** kuch oladi: yacheykalarga sanalgach o'sha qatorlar to'g'ridan-to'g'ri
9 000–11 000 imzo-oralig'iga tushadi. Tekshiruvni eng boshga qo'yish esa
faktni **hozirdan** ko'rinadigan qildi.

---

**5. Testlar / darvozalar.**

| Gate | Natija |
|---|---|
| Yangi `j1-piece-aware-scripts-guard.test.ts` | **17** ✅ |
| `warehouse-split-core.test.ts` | 40 (+8) ✅ |
| `warehouse-state-core.test.ts` | 38 (+8) ✅ |
| `stock-baseline-cleanup-core.test.ts` | 31 (+5) ✅ |
| `apps/api/src/scripts/` to'plami | 12 fayl · **323 test** ✅ |
| `apps/api` vitest **TO'LIQ** | 694 fayl · **10 139 passed** · 1 fayl / 2 test skipped · **0 FAILED** ✅ |
| `apps/web` i18n darvozalari | 8 fayl · 63 test ✅ |
| `tsc --noEmit` — `packages/db` va `apps/api` | ✅ 0 xato |
| biome (tegilgan 12 fayl) | ✅ 0 **error** (mavjud `noConsole` OGOHLANTIRISHLARI CLI skriptlarida avvaldan bor) |
| Fayl kodlashi (2026-09-01 hodisasi qo'riqchisi) | 12 fayl ham **UTF-8, BOM yo'q, mojibake yo'q** |

---

**6. Qabul mezoni — bandma-band (qoida 11).**

| # | Mezon | Holat |
|---|---|---|
| 1 | To'rtala skript DRY rejimda jonliga qarshi yugurtirilgan va hisobotida bo'lak qatori ko'ringan | ✔ (3-band; qator hamma joyda BOR, jonlida `0`) |
| 2 | `create-cells.ts --revert` DRY da bo'lagi bor yacheyka «saqlanadi» deb ko'rsatilgani **lokal bazada sun'iy bo'lak bilan** isbotlangan | ✔ (4-band, 3–4 qadam; `--apply` bilan ham tasdiqlandi) |
| 3 | `warehouse-state.ts` EXIT kodi o'zgarmagan (jonli holat: `EXIT=0`) | ✔ ESKI **0** ↔ YANGI **0**, jadval raqamlari AYNAN bir xil |
| 4 | Testlar yashil (`api` + `db`), typecheck + lint toza | ✔ 5-band |

**To'rttadan to'rttasi ✔ ⇒ J1 «TUGADI».**

---

**7. Qaytarish yo'li (qoida 12).** `git revert <commit>` — boshqa qadam
KERAK EMAS: migratsiya yo'q, jonli ma'lumotga yozilmagan, serverdagi
vaqtinchalik katalog o'chirilgan. Skriptlar serverga `git pull` bilan yetadi
va faqat qo'lda yuritiladi.

**Qoida 14:** VPS'da yozilgan skript YO'Q — sakkizta fayl repodagi (commit
qilingan) nusxalari edi va yugurishdan keyin o'chirildi.

**Qoida 13 (uchma-uch smoke):** J1 jonli xulqni ham, jonli ma'lumotni ham
o'zgartirmagani uchun QO'LLANMAYDI — smoke J4 ning ishi.

---

**8. Ochiq qolganlar / keyingi fazalarga.**

- 🔴 **J2 ga:** doira **4 emas, 6 tovar** (0-band). Ikkitasi bugun yoqilgan ⇒
  J2 kechiktirilsa ro'yxat yana o'sadi. `Vesta ramka 2X` (birlik «шт») hamon
  ro'yxatda — J-S1 egasidan javob kutmoqda.
- 🔴 **Lokal muhit qarzi (K1 dan qolgan):** `sherset_v2_dev` da `stock_pieces`,
  `client_operations`, `retail_sale_position_allocations` jadvallari
  **`postgres` egaligida** va `sherset_dev` ularni o'qiy olmaydi. Keyingi
  bo'lak fazasi lokal isbot qilmoqchi bo'lsa **avval egalikni tuzatish** kerak
  (`ALTER TABLE … OWNER TO sherset_dev`, superuser talab qiladi) — aks holda
  har safar alohida probe-baza qurishga to'g'ri keladi.
- ⚠️ **`consumed` bo'lak yacheykani QULFLAMAYDI** (`create-cells --revert`).
  Ya'ni faqat `consumed` bo'lagi bor yacheyka o'chsa bo'lakning `cell_id` NULL
  bo'ladi va u JOYLASHUV tarixini yo'qotadi (qoldiqqa ta'siri YO'Q, sverkaga
  ham — sverka faqat `active` ni sanaydi). J1 vazifa 4 ATAYLAB shunday
  yozilgan; kerak bo'lsa alohida qaror.
- ⚠️ **`warehouse-state-core.ts` ning bo'lak sverkasi — TAKRORLANGAN MANTIQ**
  (`apps/api/.../stock-piece-core.ts#buildPieceReconciliation` bilan).
  `readPosPriority` va cost-basis takrorlari bilan bir sabab (`packages/db` app
  qatlamiga qaray olmaydi). Birini o'zgartirsangiz ikkinchisini ham —
  manba faylda ogohlantirish yozilgan.
- ⚠️ **Ish unumdorligi o'lchanmagan:** bo'lak `groupBy` so'rovi jonlida 0
  qatorga qarshi yugurdi. Reyestr to'lgach (J3/J5) `warehouse-state` ning
  vaqti qayta o'lchansin — K1 hisobotidagi ochiq xavfning ayni o'zi.
- 🟢 **J2 endi J1 ga bog'liq emas** (u shunday ham edi) — lekin J1 tugagani
  uchun J2 dan keyingi HAR QANDAY ombor skripti reyestrni buzmaydi.
- ℹ️ **Jonli VPS holati (yo'l-yo'lakay o'lchandi, J1 ga aloqasi yo'q):**
  `/var/www/sherset-v2` HEAD = **`ef99ecb1`** — bu `e1d8614c` (bizning
  2026-09-03 vozvrat ishimiz) ustiga Davlatbekning marketplace M1–M9 ishini
  MERGE qilgan commit. Ya'ni **reset EMAS, merge** — bizning ishimiz joyida.

---

## 6. OCHIQ SAVOLLAR (egasidan)

- **J-S1 ✅ JAVOB OLINDI (egasi, 2026-09-04):** `Vesta ramka 2X` (birligi
  «шт») da bayroq **XATO** qo'yilgan edi — ataylab emas. J2 uni o'chirdi
  (15:38 UTC). Boshqa qadam kerak emas.
- **J-S2 (= K-S1):** Bir yacheykada bir nechta bo'lak yotadimi, yoki har bo'lak
  alohida o'ringa qo'yiladimi? Jonlida metrli qoldiqning deyarli hammasi
  **yacheykasiz hovuzda** ⇒ amalda savol «bo'lakni omborchi qanday topadi?»
  ga aylanadi. Yorliq raqami bo'yicha topish yetarlimi?
- **J-S3 (= K-S2):** Qoldiq bo'lak butun rulondan **arzonroq** sotiladimi?
  Hozircha «yo'q» deb qabul qilingan; «ha» bo'lsa bu ALOHIDA ish (narx
  qatlamiga tegadi).
- **J-S4:** Pilotda kim kesadi? Bugun `sklad_keepers` da uchala sklad ham
  **«Admin User»** ga biriktirilgan (`jonli-holat.md`), ya'ni yig'ish
  topshiriqlari admin huquqi bilan yuryapti. Pilot haqiqiy omborchi bilan
  o'tkazilsinmi (M4 ishi) yoki hozirgi holatda boshlanaveradimi?
- **J-S5:** `Stock.qty` bilan jismoniy sanoq farq qilsa (3.3 xavfi),
  tuzatish inventarizatsiya bilan **darhol** qilinsinmi yoki farq
  hujjatlashtirilib pilotdan keyinga qoldirilsinmi?

---

## 7. NIMA QILINMAYDI (ataylab)

- **Yangi funksiya qo'shilmaydi.** K1…K6 kodi yetarli; J6 dan boshqa hamma
  faza mavjud sirtni ishlatadi.
- **Butun katalogga yoyilmaydi.** 632 ta «м» tovar — pilot 5–8 ta bilan
  boshlanadi (J2), yoyish qarori J7 da.
- **TSD APK majburiy emas** — kesim brauzerda ham bajariladi
  (`restock-tasks/[id]`), TSD oqimi pilotdan keyin sinaladi.
- **Narx qatlamiga tegilmaydi** (J-S3 «ha» bo'lsa — alohida reja).
- **Chekdagi qator ko'rinishi o'zgartirilmaydi** — K-S3 yopilgan: bitta qator
  «180 m (150+30)».
