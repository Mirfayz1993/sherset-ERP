# Jonli holat reyestri — ombor / qoldiq / kassa

> **Nima uchun bu fayl bor.** Kod git'da versiyalanadi, jonli MA'LUMOT holati esa —
> qaysi ombor bor, POS prioriteti kimda, yacheykalar qaysi omborda — hech qayerda
> yozilmagan edi. Shu sabab 2026-08-23 dagi ombor-split tovarni kassa yeta olmaydigan
> omborga ko'chirganini **ertasi kuni, odam aytgani uchun** bildik (hodisa tahlili:
> `docs/plans/2026-08-24-split-kassa-hodisasi.md`, ildiz sabab IS-7).
>
> **Bu fayl — KUTILAYOTGAN holat.** Jonli haqiqat bilan solishtirish:
> `packages/db/scripts/warehouse-state.ts` (faqat o'qish; farq bo'lsa chiqish kodi 2).
>
> **Qoida 14 (F-reja 2-bo'lim):** jonli holatga qo'lda yoki skript bilan har tegilganda
> shu fayl O'SHA KUNI yangilanadi — quyidagi jadval, JSON bloki VA «O'zgarishlar
> jurnali» qatori.

---

## 1. Mashina o'qiydigan reyestr

`warehouse-state.ts` aynan shu blokni o'qiydi. Odam o'qiydigan izohlar 2-bo'limda —
ikkalasi bir faylda turishi ataylab: alohida `.json` va `.md` bir-biridan ajralib
ketardi va bu aynan IS-7 muammosini qaytarardi.

```json
{
  "split": "bajarilgan",
  "posSessionStore": "Taqsimlanmagan",
  "allowUnreachableQty": "0",
  "stores": [
    { "name": "Ombor 07", "posPriority": 1, "brak": false, "posFront": false },
    { "name": "Ombor 01", "posPriority": 2, "brak": false, "posFront": false },
    { "name": "Ombor 02", "posPriority": 3, "brak": false, "posFront": false },
    { "name": "Ombor 03", "posPriority": 4, "brak": false, "posFront": false },
    { "name": "Ombor 04", "posPriority": 5, "brak": false, "posFront": false },
    { "name": "Ombor 05", "posPriority": 6, "brak": false, "posFront": false },
    { "name": "Ombor 06", "posPriority": 7, "brak": false, "posFront": false },
    { "name": "Taqsimlanmagan", "posPriority": 8, "brak": false, "unassignedSource": false, "posFront": false },
    { "name": "Ombor 99", "posPriority": null, "brak": true, "posFront": false }
  ]
}
```

**Maydonlar:**

| Maydon | Ma'nosi |
|---|---|
| `split` | Yacheyka kodi prefiksi ↔ ombor mosligi: `bajarilgan` (hamma yacheyka o'z omborida), `qaytarilgan` (hammasi bitta omborda, prefiks mos emas), `qisman`, `yacheyka yoq` |
| `posSessionStore` | Kassir smenalari ochiladigan ombor NOMI. **U POS kaskadida bo'lishi SHART** (`posPriority` bor va BRAK emas) — aks holda undagi qoldiq sotilmay qoladi |
| `allowUnreachableQty` | Ruxsat etilgan «POS yeta olmaydigan qoldiq». Normal qiymat `"0"` |

> 🟢 **`split` «bajarilgan» (2026-08-31):** egasining qarori bilan KUNDUZI
> (savdo ochiq holda) `warehouse-split.ts --apply` yuritildi — 1 244 yacheyka
> (01: 604 · 02: 450 · 03: 1 · 04: 1 · 07: 188) va 512 916 dona qoldiq o'z
> omborlariga ko'chdi. `warehouse-state.ts`: **mos 1 271, mos emas 0, POS yeta
> olmaydigan qoldiq 0, EXIT=0**. Batafsil — jurnal (4-bo'lim, 2026-08-31).
> Tarix: 2026-08-27 da holat «qisman» edi (faqat BRAKning 27 yacheykasi mos),
> 2026-08-30 da 974 → 1 243 o'sish o'lchangan (269 yangi yacheyka, jurnalsiz).
| `stores[].posPriority` | `Store.attributes.__posPriority`. `null` = kaskadda EMAS deb kutiladi |
| `stores[].brak` | `__brakStore` (G3). BRAK omboridagi qoldiq yetuvchanlik hisobiga KIRMAYDI; prioritet qo'yilgan bo'lsa ham kaskadga kirmaydi |
| `stores[].unassignedSource` | `__unassignedSource` (F7 hovuz belgisi) |
| `stores[].posFront` | `__posFrontStore` (G4, «Kassa oldidagi ombor» = 07). **Yetuvchanlikka ta'sir qilmaydi, TAQSIMOT tartibini belgilaydi:** yolg'iz qoplasa birinchi, bo'linishda ENG OXIRGI. Bayroq jimgina yo'qolsa 07 buyurtmalarda birinchi bo'lib bo'shab qoladi |

> 🔴 **E5 — yetuvchanlik modeli 2026-08-26 da QAYTA YOZILDI (G4-2a dan keyin).**
> Ilgari kassa FAQAT kaskadning BIRINCHI omboridan avtomatik ayirardi, qolganlari
> «bosh omborchi tasdig'i kerak» (`needs_approval`) edi va aynan o'sha to'siq
> 2026-08-24 06:46 da savdoni to'xtatdi. G4-2a (`b4c27d24`) tasdiq-to'sig'ini
> olib tashladi — endi POS prioriteti bor va BRAK bo'lmagan HAMMA omborga o'zi
> yetadi. Shuning uchun:
> - `needs_approval` bosqichi **BEKOR QILINDI**;
> - «POS yeta olmaydigan qoldiq» endi FAQAT `__posPriority` yo'q omborlardagi qoldiq;
> - «POS ombori kaskad BOSHI bo'lsin» sharti «kaskadda BO'LSIN» ga aylandi.
>
> Busiz `warehouse-state.ts` deploy'dan keyin yolg'on qizil berardi va qoida 13
> qo'riqchisi «bo'ri keldi» bo'lib qolardi (deploy dossieri, D1).

---

## 2. Kutilayotgan holat — izohlar bilan

**Oxirgi o'lchov: 2026-08-31 ~09:55 UTC** (split bajarilgan kun, `warehouse-state.ts`).
⚠️ Quyidagi raqamlar shu sanadagi o'lchov; **ular reyestrning qismi EMAS**
(skript raqamlarni tekshirmaydi — u tuzilma va yetuvchanlikni tekshiradi), lekin
o'zgarganda shu yerga yoziladi.

| Store | id (qisqa) | Roli | Yacheyka | POS prioriteti | Qoldiq (dona) |
|---|---|---|---|---|---|
| **Ombor 07** | `02016d74` | fizik ombor — **kassaga eng yaqin** | 188 | **1** (kaskad boshi) | 0 |
| Ombor 01 | `7400bf94` | fizik ombor | 604 | 2 | 56 424 (yacheykada 26 450) |
| Ombor 02 | `01662dbe` | fizik ombor | 450 | 3 | 693 675 (yacheykada 483 675) |
| Ombor 03 | `1e5df878` | fizik ombor | 1 | 4 | 0 |
| Ombor 04 | `b628f0d0` | fizik ombor | 1 | 5 | 2 728 (hammasi yacheykada) |
| Ombor 05 | `75878ad6` | fizik ombor (yacheykasiz) | 0 | 6 | 0 |
| Ombor 06 | `ed80b5ce` | fizik ombor (yacheykasiz) | 0 | 7 | 0 |
| **Taqsimlanmagan** | `968f9da2` | hisob-kitob hovuzi + AYNI PAYTDA kassa ombori | **0** | **8** (ENG OXIRIDA) | ≈49,74 mln (H5 soxta qoldiq, yacheykasiz) |
| **Ombor 99** | `d4b4ff85` | **BRAK ombori** (vozvratdagi brak tovar) | **27** | yo'q (ataylab) | 0 |

> ⚠️ Ombor 01/02 dagi yacheykasiz qism (29 974 + 210 000) — 2026-08-30 dagi
> QO'LDA «Оприходование» sinov kirimlari («bakteriya lampa 60 cm», 10 000/200 000
> lik yaxlit sonlar). POS ularga yetadi, uzilish yo'q; soxta bo'lsa hisobdan
> chiqarish — egasining qarori (H5 tozalash yo'li bilan).

**Nega hozir shunday (vaqtinchalik holat):**

- 🟢 **SPLIT BAJARILDI (2026-08-31).** Har yacheyka o'z omborida, «Taqsimlanmagan»
  endi faqat yacheykasiz hovuz (≈49,74 mln soxta qoldiq + smena ombori). 2026-08-23
  hodisasi takrorlanmadi, chunki M1 prioritetlari OLDIN qo'yilgan edi — jonli
  cheklar split'dan 5 daqiqa o'tib Ombor 01/02 yacheykalaridan to'g'ri ayirdi.
  Tarix: 2026-08-23 dagi birinchi split kassani 46 daqiqa to'xtatgan va
  2026-08-24 06:46 da qaytarilgan edi.
- ✅ **R1 va R4 xavflari YOPILDI (2026-08-30, M1).** Ilgari `Ombor 02` da tasodifiy
  `posPriority = 2` turardi, `Ombor 01` va `Ombor 03…07` da esa prioritet umuman
  yo'q edi — ya'ni o'sha omborlarga tovar tushsa POS unga yeta olmasdi. Endi
  **to'qqizala ombor kanonik kaskadda** (07 → 01 → 02 → 03 → 04 → 05 → 06 →
  Taqsimlanmagan), BRAK esa ataylab tashqarida. Tovar joylashtirilishidan OLDIN
  qo'yildi — bu M1 ning butun maqsadi edi.
- **Kaskad boshi endi `Ombor 07`** (kassaga eng yaqin, egasining S-M1 javobi).
  `Taqsimlanmagan` ENG OXIRIGA tushdi: u hovuz, ombor emas. Split'dan (08-31)
  keyin bu tartib to'liq ishlayapti: yacheykali qoldiq 01/02/04 da, ajratmalar
  o'sha yacheykalardan; «Taqsimlanmagan» faqat yacheykasiz (soxta) qoldiqni
  qoplaydi — u H5 tozalashi bilan kamayadi.
  ⚠️ Yacheykasi bor tovarda ham **bironta yacheyka so'ralgan miqdorni yolg'iz
  qoplamasa** taqsimot hozircha yacheykasiz qoldiqqa qochadi (2-holat,
  `smallestCovering`) — bu «yacheyka kamaymayapti» shikoyatining ildizi,
  tuzatish kodda rejalashtirilgan (2026-08-31 tahlili).
- ⚠️ **VOZVRAT ENDI «Ombor 07» GA TUSHADI — ATAYLAB, lekin BUGUNDAN KUCHGA KIRDI.**
  `refund()` qaytgan tovarni `refundCascade[0]` ga yozadi
  (`retail-sale.service.ts:2389–2390`) — bu **F6/Q1 ning ongli qarori**: «mijoz
  tovarni jismonan do'konga olib keladi ⇒ u kassaga eng yaqin omborga kiradi».
  M1 gacha xulq ko'rinmasdi, chunki `cascade[0]` = «Taqsimlanmagan» edi; M1 dan
  keyin `cascade[0]` = **«Ombor 07»** ⇒ har vozvrat qoldiqni o'sha yerga yozadi.
  2026-08-30 smoke'ida jonlida o'lchandi. **Yangi qaror KERAK EMAS** (mexanizm
  `posFront`/M7 ga aloqador emas — u TAQSIMOT tartibini o'zgartiradi, vozvrat
  omborini emas). **Jami qoldiq to'g'ri, POS yetadi** ⇒ uzilish yo'q.
  🔜 **Amaliy oqibat:** «Ombor 07» da endi 188 yacheyka bor (08-31 split'i
  bilan keldi), lekin vozvrat baribir **yacheykasiz** tushadi — omborchi uni
  qo'lda joylashtirishi kerak, aks holda shu yacheykasiz qator o'sib boradi.
- **`__unassignedSource` hech qayerda yoqilmagan** — F7 hovuz belgisi hali
  ishlatilmayapti; `Taqsimlanmagan` amalda hovuz VAZIFASINI bajaradi, lekin belgisi
  yo'q. H4 da aniqlashtiriladi.
- **BRAK ombori YARATILDI** (2026-08-27, «Ombor 99», `d4b4ff85`): `__brakStore = true`,
  `__posPriority` **yo'q** ⇒ POS kaskadiga kirmaydi va yetuvchanlik hisobiga ta'sir
  qilmaydi. 27 yacheyka (`99-01-01-01` … `99-01-03-09`), zonasiz. `warehouse-state.ts`
  uni «BRAK (ataylab yopiq)» deb tanidi.

---

## 3. Tekshirish

```bash
# packages/db ichidan (faqat O'QISH — savdo ustida ham xavfsiz)
npx tsx scripts/warehouse-state.ts               # jadval + reyestr farqi
npx tsx scripts/warehouse-state.ts --json        # mashina uchun
npx tsx scripts/warehouse-state.ts --no-registry # faqat o'lchov
```

Chiqish kodi: `0` = mos, `2` = farq bor (`xato` darajali drift).
`ogohlantirish` darajali driftlar kodni o'zgartirmaydi.

🔴 **DIQQAT — skript hozircha FAQAT LOKALDA bor.** 2026-08-26 da o'lchandi:
jonli HEAD (`62a27024`) da na `scripts/warehouse-state.ts`, na shu reyestr
fayli mavjud — H2 fazasi hali deploy qilinmagan va u serverga birinchi
deploy bilan yetib boradi. Ya'ni **birinchi deploy'dan OLDIN uni jonlida
yugurtirib bo'lmaydi**; u deploy'dan KEYINGI smoke'da birinchi marta
yuriladi (dossier B5). Undan keyingi har bir ombor-deploy'ida — ikkala
tomonda ham.

**Qachon yugurtiriladi:**

1. ombor / qoldiq / kassaga tegadigan **har deploy'dan keyin** — natijasi faza
   hisobotiga kiritiladi (F-reja qoida 13);
2. jonli ma'lumot o'zgartiradigan skriptdan **oldin va keyin**;
3. H4 (split qayta yuritilishi) da — **oldin, keyin va ertasi ertalab**.

---

## 3.1. Kechalik tozalash tartibi (H5 — soxta «mashq» qoldig'i)

Sanash davom etayotgan davrda har kuni, **savdo tugagach**:

    cd packages/db
    npx tsx scripts/stock-baseline-cleanup.ts --since <bugungi sana>      # DRY-RUN
    npx tsx scripts/stock-baseline-cleanup.ts --since <sana> --apply --allow-remote

Chiqishdagi **qaytarish buyrug'ini saqlang** (bitta `docId`). Ertasi ertalab,
savdo boshlanishidan OLDIN: `warehouse-state.ts` + bitta sinov sotuv
(post → tekshir → cancel). Nosozlikda — `--revert <docId> --apply --allow-remote`.

🔴 **Kunduzi YUGURTIRMANG:** skript ombor jamisini kamaytiradi, ya'ni kassani
to'xtatib qo'yishi mumkin (qoida 13). Default imzo-oralig'i 9 000–11 000 — faqat
soxta sonlarni oladi, haqiqiy qoldiqqa tegmaydi. Batafsil: H5 hisoboti.

🔴 **T1 — K-REJA DEPLOY QILINGANDAN KEYIN BU SKRIPT TO'XTATILADI.**
`stock_pieces` jadvali bo'sh bo'lmagan kundan boshlab skript bo'linadigan
tovarga tegmasligi shart: u `Stock.qty` ni kamaytiradi, bo'lak reyestriga esa
tegmaydi ⇒ «Σ tarkib === miqdor» sharti buziladi va K5 ning kiritish oqimi
(sanash / priyomka / vozvrat) **400** bera boshlaydi. Aynan shu bilan H4
(`warehouse-split.ts`) ham bloklanadi. To'liq talab:
`docs/plans/2026-08-24-split-kassa-hodisasi.md` → H4 → «T1» bandi.

## 3.2. Kassa qarzi backfill'i (Q5) — ✅ YUGURTIRILDI 2026-08-31

> **2026-08-31 ~13:10–14:30 CEST, KUNDUZI** — egasining «vaqt bo'yicha cheklov
> yo'q, hozir jonlida yugurtir» ko'rsatmasi bilan (qoida 13 oynasidan ongli
> chekinish). Ijro: Claude, SSH (kalit) orqali. O'lchovlar:
>
> - **DRY:** 567 qarzga chek → **282 qator / 1 001 380 725 so'm / 133
>   kontragent** (88 tasida reyestrdan tashqari qarz yo'q; already-registered
>   77 · cap-exhausted 24 · fully-returned 1 chek o'tkazildi).
> - **APPLY uch bosqichda:** `RUN=20260831-01` kanareyka «aki taksi» 1 qator
>   (`QRZ-2026-00891`) → `RUN=20260831-02` `LIMIT=10` → `RUN=20260831-03`
>   qolgan 271. **Jami 282 — DRY bilan aynan.** Rollback shu RUN yorliqlari
>   bilan tayyor turadi.
> - **Balans tegilmadi:** kanareyka balansi bir tiyin o'zgarmadi; jarayon
>   oynasida `counterparty_balance_entries` ga backfill'dan **0 yozuv** (4
>   yozuv bor edi — hammasi jonli savdoning o'zi). `recompute` oldin/keyin:
>   `changed: 0`, cross-check shovqini **759 → 759** (aynan teng).
> - **`warehouse-state`** oldin/keyin: POS yeta olmaydigan qoldiq **0/0**;
>   yagona `[xato] split-holati` Q5 dan OLDIN ham bor edi (2-bo'limdagi
>   bugungi ombor-split bandi, reyestr JSON hali «qisman» deydi).
> - **Qoida 13 smoke** (`ops-m1-live-smoke.ts --live`): 7/8 — yagona «xato»
>   vozvratning `cascade[0]` ga tushishi (ma'lum ATAYLAB xulq), siljishni
>   skript o'zi «Перемещение» bilan qaytardi, farq 0. 🔴 **OGOHLANTIRISH:
>   `--restore-stray` endi XAVFLI** — split'dan keyin u Ombor 01–07 dagi
>   QONUNIY qoldiqni «hovuzga qaytarish» deb taklif qiladi; APPLY QILINMASIN.
> - **UI tasdiq (Playwright, faqat o'qish):** `/menejer/undirish` →
>   Manba=«Kassa cheki» → **426 qarz**, «Kassadan: 200» chip, qatorlarda chek
>   raqami havolasi; kanareyka ro'yxatda ko'rindi.
> - **FIFO 2+ qarzli to'lov xabari HAQIQIY savdoda tasdiqlandi:** 13:21:10 da
>   «Aziz jiyan» 2 367 000 so'm to'ladi, to'lov 2 qarzga bo'lindi
>   (`QRZ-2026-00389` 850 000 + `QRZ-2026-00890` 1 517 000 — ikkinchisi 22.08
>   dagi eski chek `ТРН-2026-01151` niki, bitta `batch_id`), outbox'da **BITTA** yig'ma
>   xabar «2 367 000 so'm … Hisob teng» `sent` bo'ldi — `b43a7e27` ishlayapti.
> - **Q6 jonli verify:** qamrov **6/6 OK** (reyestrda 451 kassa qatori, 282
>   tasi Q5 belgisi bilan). `--live` zanjiri skript nuqsonida yiqildi —
>   `post()` endi `expectedSumMinor` ni MAJBURIY talab qiladi, skript esa
>   yubormasdi (tuzatildi, shu commitda). Qayta yugurishda QARZ zanjiri to'liq
>   yurdi (0 → 1000 → 800 → −200); AVANS zanjiri «faqat smenani ochgan kassir»
>   cheklovida to'xtadi — kunduzi begona smenada yurmaydi, **ochiq band**
>   (kecha oynasida smena egasi tokeni bilan). Sinov izlari TO'LIQ tozalandi:
>   `ТРН-2026-02474` cancelled, `ТРН-2026-02478` refunded, 200 so'm to'lov
>   reverse (kassa daftari ham), `QRZ-2026-01174` soft-delete, balans 0.
>
> Eslatma cron'i **2026-09-14 dan** zinapoya bo'yicha ochila boshlaydi (har
> 50 qatorda +1 kun) — operator navbatining to'lishi KUTILGAN xulq.

### Asl retsept (tarix uchun, yugurtirishdan oldingi matn)

> **Nega bu yerda tursa-yu, jurnalda qator yo'q.** Qoida 14 jonli holatga
> TEGILGANDA jurnalga qator yozishni talab qiladi. Q5 backfill'i jonlida
> **yugurtirilmagan** (kod tayyor, deploy 2026-08-25 da egasi tomonidan rad
> etilgan, so'ng «jonliga tegma» qarori), ya'ni jurnalga yozadigan hodisa
> hali YO'Q — soxta qator yozilmaydi. Bu bo'lim esa yugurtirish kuni
> nimani qayd etish kerakligini OLDINDAN belgilaydi, aks holda o'sha kuni
> shoshilinch ishda qayd tushib qolardi (IS-7 naqshi).

**Nima qiladi:** Q2 dan OLDIN post qilingan kassa cheklarining balans-qarzlarini
`Debt` reyestriga olib kiradi (`balanceAdopted = true`, `sourceDocType =
'retailsale'`), ya'ni ular undirish ro'yxatida ko'rinadi. **Balansga va
kassaga TEGMAYDI** — `applyDelta` umuman chaqirilmaydi.

**Oldindan shart (tartib MAJBURIY):** `20260825120000_debt_source_doc`
migratsiyasi berilgan bo'lishi kerak. Skript buni O'ZI tekshiradi
(`preflight()`) va ustunsiz bazada tushunarli xato bilan to'xtaydi.

**Skriptlar** (`apps/api`, box'da qo'lda; DRY-RUN default):

    ./node_modules/.bin/tsx src/scripts/ops-q5-backfill-sale-debts.ts              # o'lchash
    APPLY=1 ONLY_CP=<uuid> RUN=<sana>-01 ./node_modules/.bin/tsx src/scripts/ops-q5-backfill-sale-debts.ts
    RUN=<sana>-01 ./node_modules/.bin/tsx src/scripts/ops-q5-backfill-rollback.ts  # teskarisi

**Yugurtirish kuni yoziladigan iz (har bosqichdan keyin):**

| Maydon | Qayerdan |
|---|---|
| `RUN` yorlig'i | skript argumenti (`RUN=<sana>-NN`) — rollback AYNAN shu bo'yicha ishlaydi |
| qator soni / summa | skript chiqishi (`OCHILADIGAN QATOR` / `OCHILADIGAN JAMI SUMMA`) |
| kontragent soni | o'sha chiqish |
| kim yugurtirgan, qachon | qo'lda — ish soatidan TASHQARIDA (qoida 13) |
| `warehouse-state.ts` oldin/keyin | qoida 8 — ikkalasi ham faza hisobotiga |
| uchma-uch smoke | qoida 13 — sinov sotuv (post→tekshir→cancel), yacheyka sanash, ko'chirish |

**Yakuniy o'lchov:** `apps/api/src/scripts/ops-q6-live-verify.ts` (DRY default —
«jonlida qaysi faza bor» qamrov jadvali; `--live` esa besh invariantni sinov
cheki bilan isbotlaydi va izini O'ZI tozalaydi).

🔴 **Kutilgan yon ta'sir — nosozlik EMAS:** undirish ro'yxati va menejer
navbati HAJMI keskin o'sadi (lokal o'lchov: 579 → 812 qator). Bu **yangi qarz
emas, ko'rinmagan qarz endi ko'rinmoqda**. Eslatma cron'i 14 kun JIM turadi,
so'ng zinapoya bo'yicha kuniga ~50 qatordan ochiladi.

Reja va to'liq retsept: `docs/plans/2026-08-25-kassa-qarzi-undirish-reyestri.md`
(Q5 hisoboti — «Jonli yugurish retsepti»).

---

## 4. O'zgarishlar jurnali (qoida 14)

| Sana | Nima o'zgardi | Kim / nima bilan | Reyestr yangilandimi |
|---|---|---|---|
| 2026-08-23 15:58 | Split bajarildi: 291 yacheyka + 2,95 mln dona → «Ombor 02» | F5 sessiyasi, `warehouse-split.ts` | — (reyestr hali yo'q edi) |
| 2026-08-24 06:46 | Split QAYTARILDI (kassa to'xtagani uchun) | shoshilinch, `warehouse-split-revert.ts` | — |
| 2026-08-24 (ertalab) | `Taqsimlanmagan.__posPriority = 1` | F6 sessiyasi, qo'lda UPDATE | — |
| 2026-08-24 ~21:00 | 119 ta `01-04-…` yacheyka «Ombor 01» → «Taqsimlanmagan»; 490 yangi yacheyka yaratildi (410 → 900) | parallel sessiya, `create-cells.ts` + `warehouse-split-revert.ts` | — |
| 2026-08-24 (H2) | **Shu reyestr yaratildi** — yuqoridagi holat kodga tushirildi | H2 sessiyasi | ✅ |
| 2026-08-26 20:02–20:12 | **1-kecha deploy'i** `83027bc2 → 61780120` (37 commit, 6 migratsiya): G1–G6 + Q1–Q3 + H2 + H5 kodi. Ombor TUZILMASI o'zgarmadi | deploy operatori, qo'lda ff-merge | ✅ (tuzilma o'zgarmagani qayd etildi) |
| 2026-08-27 ~01:15 | **BRAK ombori yaratildi** — «Ombor 99» (`d4b4ff85`), `__brakStore=true`, POS prioriteti YO'Q, 27 yacheyka (`99-01-*`) | deploy operatori; ombor qatori — jonli `BEGIN…ROLLBACK` DRY, so'ng `COMMIT`; yacheykalar — `create-cells.ts --store "Ombor 99" --ombor 99 --stelaj 1:3x9` (DRY → `--apply --allow-remote`) | ✅ |
| 2026-08-27 ~01:20 | **`sklad_keepers` to'ldirildi** — sklad 1, 2, 3 → «Admin User» (`885fb467`, Administrator). Omborchi vazifasi vaqtincha unga yuklandi (jonlida ombor xodimi yo'q) | deploy operatori, jonli `BEGIN…ROLLBACK` DRY, so'ng `COMMIT` (`ON CONFLICT DO NOTHING`) | ✅ (ombor tuzilmasiga tegmaydi) |
| 2026-08-27 05:32–05:37 | **Ombor 03, 04, 05, 06, 07 yaratildi** (`__cellInventory=true`, `__posPriority` YO'Q, yacheykasiz, qoldiq 0) ⇒ jonlida 9 ombor | egasi, UI orqali | ❌ **YO'Q** — reyestrda hamon 4 ombor; `warehouse-state.ts` ularni `reyestrda-yoq` (ogohlantirish) deb ko'rsatadi. Reyestrga kiritish **M1** ning ishi (M1.3) |
| **2026-08-29 05:50–06:23** | 🔴 **2-kecha deploy'i KUNDUZI bajarildi** (egasi qarori — savdo ochiq, 5 ta smena ishlab turgan holda): `61780120 → cbc14723`, 14 commit, **1 migratsiya** `20260825220000_drawer_cash_in_kind` (additiv: `retail_drawer_cash_in.kind` + 2 indeks). Chiqdi: A1/A2/A3 avans oqimi + G1 tuzatishi + yacheykadan «Chiqarish». **Ombor TUZILMASI o'zgarmadi.** | Claude, SSH orqali; zaxira `/root/sherset_v2-pre-deploy-20260829.dump` (TOC: 259 `TABLE DATA`); build **`.next-new`** ichiga (jonli `.next` tegilmagan) → katalog almashtirish → `pm2 restart`; eski build **`.next-old`** da saqlanmoqda | ✅ (tuzilma o'zgarmagani qayd etildi) |
| **2026-08-29 20:25–21:31** | 🟢 **3-kecha deploy'i KECHKI OYNADA bajarildi** (savdo YO'Q): `cbc14723 → f612d804`, 38 commit, **5 migratsiya** (`stock_piece_registry`, `company_settings_sale_debt_term`, `stock_piece_cut`, `stock_piece_intake`, `piece_tracking_decision` — hammasi additiv). Chiqdi: **K1–K6** (bo'lak reyestri) + **Q4–Q6** + **E5** + qarz xabari tuzatishi. `topup-role-permissions.ts` yuritildi ⇒ `piecetracking` 26 qator. **Ombor TUZILMASI o'zgarmadi.** | Claude, Posh-SSH orqali; zaxira `/root/sherset_v2-pre-deploy-20260830.dump` (259 `TABLE DATA`); build `.next-new` ichiga → katalog almashtirish (`.next-old2`) → `pm2 restart` | ✅ **reyestrning O'ZI shu deploy bilan serverga yetib bordi** (JSON hamon 4 ombor — Ombor 03–07 M1 ning ishi) |
| **2026-08-30 07:15** | 🟢 **M1.2 — POS KASKAD PRIORITETLARI QO'YILDI** (kanonik jadval, reja 4-bo'lim): `Ombor 07=1` · `01=2` · `02=3` · `03=4` · `04=5` · `05=6` · `06=7` · `Taqsimlanmagan=8` (1 dan 8 ga tushdi) · `Ombor 99` (BRAK) ATAYLAB tegilmadi. **Faqat `stores.attributes` — qoldiqqa, hujjatga, yacheykaga BIR BAYT ham tegilmadi.** Oldshart o'lchandi: Ombor 01–07 da qoldiq **0** ⇒ M1.0 to'xtash sharti ishga tushmadi. Xulq o'zgarmasligi kutiladi (bo'sh ombor ⇒ hissasi 0) | Claude, paramiko/SFTP orqali; qaytarish nuqtasi `/root/m1-stores-before-20260830.txt` (9 qator); DRY jonli `BEGIN → oldinga → zond → qaytarish → zond → ROLLBACK` bilan **ikkala yo'nalish** sinaldi (qaytarish zondi asl holatni AYNAN tikladi); skriptlar `/root/m1-apply.sql` + `/root/m1-rollback.sql` | ✅ (JSON + 2-bo'lim jadvali + shu qator) |
| **2026-08-30 08:05–08:40** | 🟢 **M1.5 — QOIDA 13 SMOKE'i BAJARILDI** (`ops-m1-live-smoke.ts --live`, HTTP orqali, izini o'zi tozalaydi). Uchala band: **(1) SOTUV** — chek → post (qoldiq aynan −1) → vozvrat (jami AYNAN tiklandi); ajratma **«Taqsimlanmagan» dan** olindi, bo'sh «Ombor 07» hech nima TORTMADI ✅ M1 ning asosiy sharti jonlida isbotlandi; **(2) SANASH** — yacheyka `02-02-03-42` bo'yicha chernovik ochildi, `position-meta` qoldiqni (22 700) to'g'ri ko'rsatdi, chernovik o'chirildi; **(3) KO'CHIRISH** — `02-02-03-42` → `01-04-01-105` 1 dona, ombor jamisi o'zgarmadi, teskari ko'chirish yacheyka kesimini tikladi. `warehouse-state.ts` o'zgarishdan OLDIN va KEYIN: **EXIT=0, «POS yeta olmaydigan qoldiq: 0»**. ⚠️ **Yo'l-yo'lakay o'lchandi: vozvrat tovarni `cascade[0]` («Ombor 07») ga qaytaradi** — bu F6/Q1 ning ATAYLAB qilingan xulqi (`retail-sale.service.ts:2389`), M1 uni ko'rinadigan qildi; yangi qaror kerak emas, lekin «Ombor 07» da yacheyka yo'qligi (M3) 2-bo'limga yozildi. Smoke siljishni «Перемещение» bilan qaytardi, jonli taqsimot AYNAN tiklandi (Ombor 07 = 0) | Claude (avtomatik, HTTP+Prisma). Sinov hujjatlari: `ТРН-2026-02224` (cancelled), `…02225 / …02227 / …02229` (refunded) + qaytarish «Перемещение» hujjatlari — hammasi `description` da «M1 jonli smoke» belgisi bilan | ✅ (2-bo'lim + shu qator) |
| **2026-08-31 09:46 UTC** | 🟢 **OMBOR-SPLIT BAJARILDI — KUNDUZI, EGASINING QARORI BILAN** (qoida 12 dan ongli chekinish; egasi «qoidani shu safar e'tiborsiz qoldiramiz» dedi). `warehouse-split.ts --apply`: **1 244 yacheyka + 512 916 dona** o'z omborlariga ko'chdi — Ombor 01: 604 yach./26 470 dona (docId `8a64665f`) · 02: 450/483 718 (`0d00b341`) · 03: 1/0 (`15825f60`) · 04: 1/2 728 (`15c5cc22`) · 07: 188/0 (`de06fcec`); Taqsimlanmagan'da 14 bo'sh zona o'chirildi. **V0 (5 123 assortiment jami/qiymat/rezerv o'zgarmadi) + V1/V2/V3 + idempotentlik — hammasi OK.** Oldshart o'lchovlari: barcha prefikslar mavjud prioritetli omborlarga mos (yangi Store yaratilmadi), rezerv-yacheyka kesishuvi 0, anomaliya 0. Keyin `warehouse-state.ts`: **split «bajarilgan» (mos 1 271, mos emas 0), POS yeta olmaydigan qoldiq 0, EXIT=0**. Qoida 13 smoke (`ops-m1-live-smoke.ts --live`): **7/8** — sotuv post qoldiqni aynan −1 qildi va **ajratma yacheykali omborlardan** olindi, cancel jamini aynan tikladi, sanash va ko'chirish stok-neytral; yagona «xato» — vozvrat `cascade[0]` (Ombor 07) ga tushishi, bu ATAYLAB xulq (M1 hisobotida ham xuddi shunday). Jonli isbot: 09:51 dagi haqiqiy cheklar Ombor 01 (−21) va Ombor 02 (−43) **yacheykalaridan** ayirdi | Claude, SSH (kalit) orqali; apply'ni egasi o'z terminalidan ishga tushirdi (auto-rejim klassifikatori yozuvni bloklagani uchun); zaxira `/root/sherset_v2-pre-split-20260831.dump` (260 `TABLE DATA`); log `/root/split-apply-20260831.log`; qaytarish yo'li: `warehouse-split-revert.ts --from "Ombor NN" --apply --allow-remote` (ombor-ma-ombor) | ✅ (JSON `split: bajarilgan` + 2-bo'lim jadvali + shu qator) |

| **2026-08-31 ~13:10–14:30** | 🟢 **Q5 BACKFILL YUGURTIRILDI (kunduzi, egasi ruxsati bilan)** — `RUN=20260831-01` (kanareyka «aki taksi», 1 qator `QRZ-2026-00891`) · `-02` (`LIMIT=10`) · `-03` (271) = **282 qator / 1 001 380 725 so'm reyestrga** (`ops-q5-backfill-sale-debts.ts`), DRY bilan aynan mos. Balans/kassa TEGILMADI (balans jurnaliga 0 yozuv, `recompute` `changed:0`, shovqin 759→759). Ombor TUZILMASIGA tegilmagan (`warehouse-state` POS-yeta-olmaydigan 0/0). Qoida 13 smoke 7/8 (yagona «xato» — ma'lum vozvrat-cascade[0] xulqi, iz qaytarildi). UI: undirishda Manba=«Kassa cheki» 426 qarz. FIFO 2+ qarz xabari HAQIQIY savdoda tasdiqlandi (13:21, bitta yig'ma xabar). Q6 `--live` skript nuqsoni topilib tuzatildi (`expectedSumMinor`), sinov izlari to'liq tozalandi. Tafsilot: §3.2 | Claude, SSH (kalit); rollback: `RUN=<yorliq>` bilan `ops-q5-backfill-rollback.ts` | ✅ (tuzilma o'zgarmagani qayd etildi; §3.2 yangilandi) |
| **2026-08-31 ~14:25–14:45 UTC** | 🟢 **VITRINA-DEPLOY KUNDUZI BAJARILDI** (egasi qarori, kassirlar bo'sh paytda): `bccecb0a → ec56dd1f` (4 commit, **1 additiv migratsiya** `20260831120000_store_cell_vitrina` — `store_cells.vitrina DEFAULT false`, berilgach 1 271 yacheykada 0 ta belgili ⇒ xulq o'zgarmagan). Chiqdi: **vitrina yacheyka** (taqsimotda mutlaq oxirgi chora + yacheykalar jadvalida tugma), **2-holat tuzatishi** (yacheykali tovarda hovuz yolg'iz g'olib emas — yacheykalar bo'lib olinadi; jonli o'lchov: sanalgan tovar sotuvining 18% i hovuzga qochardi), warehouse-split qo'riqchisi + `--only`, M1 smoke skripti repoga. Uzilish: faqat restart (~40 s API boot), web `.next` almashtirish orqali. Verify: api/web health 200 · qoida 13 smoke **7/8** (yagona «xato» — ma'lum vozvrat-cascade[0] xulqi) · `warehouse-state.ts` **reyestrga MOS, POS yeta olmaydigan 0, EXIT=0** | Claude, SSH (kalit); zaxira `/root/sherset_v2-pre-deploy-20260831b.dump` (260 `TABLE DATA`); build log `/root/deploy-e5-20260831.log`; eski build `/var/www/sherset-v2/apps/web/.next-old31aug` (qaytarish: mv + pm2 restart, ~15 s); kod qaytarish: `git reset --hard bccecb0a` | ✅ (shu qator; tuzilma o'zgarmagan — vitrina belgilari hali qo'yilmagan) |

> **2026-08-29 deploy'ining o'lchangan izi** (qoida 8 + 13):
> `warehouse-state.ts` deploy'dan KEYIN — `EXIT=2`, **aynan 1 ta `xato`**
> (`split-holati`: kutilgan «qaytarilgan», jonlida «qisman») + **6 ta
> `ogohlantirish`** (`reyestrda-yoq`: Ombor 03–07 va 99). Bu kesim deploy'dan
> OLDIN skript kodidan hisoblab qo'yilgan edi va **aynan mos tushdi**.
> 🟢 **«POS yeta olmaydigan qoldiq» = 0.** Jami yacheyka 1089, ombor qoldiq
> 50 506 981,03, kaskad `1:Taqsimlanmagan → 2:Ombor 02`, POS smena ombori
> «Taqsimlanmagan» — **POS SOTADI**.
> Texnik verify: 9/9 sahifa 200 · API `06:22:48` da toza ko'tarildi · flip'dan
> keyin web xatolari **0** · haqiqiy kassir so'rovi `GET /api/v1/retail-sales`
> → **200** (136 ms, Electron desktop klient).
> 🔴 **Qoida 13 smoke'i HALI TO'LIQ EMAS** — yacheyka sanash, ko'chirish va
> A1–A3 avans oqimi jonlida sinalmagan ⇒ fazalar «QISMAN» bo'lib qoladi.

| **2026-08-30 ~00:1x** | 🟢 **B1 BAJARILDI — ombor rollari yaratildi**: «Katta omborchi» (`848479f8`, shablon `warehouse_manager`) va «Omborchi» (`10ce71bf`, shablon `storekeeper`) ⇒ jonlida endi **10 rol**. Assimetriya o'lchandi va TO'G'RI: `retailcontrol` / `returnacceptance` / `warehousenumbering` / `supply` — faqat KATTA omborchida; `storecell` — ikkalasida. `maskedByOverride` 0. | Claude, `ops-b1-ombor-rollari.ts --apply` (UI bosadigan `POST /roles` + `POST /roles/:id/apply-template` marshrutlari, SQL YO'Q) | — (ombor tuzilmasiga tegmaydi) |

| **2026-08-30 ~01:0x** | 🟢 **B2 BAJARILDI — ombor rollari xodimlarga biriktirildi** (egasi tanlovi): **Muxriddin** `dade79a1` → `Kassir + Katta omborchi` (kassir roli ATAYLAB saqlandi — u ba'zida kassada o'tiradi), **Ilhom** `0deb373d` → `Administrator + Omborchi`. Ikkalasi ham QO'SHIMCHA: `PUT /roles/employee/:id` REPLACE-SET bo'lgani uchun mavjud rol ham qayta yuborildi, aks holda jimgina o'chirilardi. | Claude, `ops-b2-ombor-xodimlari.ts --apply` | — (ombor tuzilmasiga tegmaydi) |

> 🟢 **B2 YOPILDI (2026-08-30) — «kassirni omborchi qilmang» tuzog'i KODDAN aniqlandi.**
> Muxriddin kassir bo'la turib «Katta omborchi» qilindi. Bu XAVFSIZ, va sabab
> hujjatdan emas, koddan o'qildi: `markReady`
> (`retail-sale.service.ts:4121`) chaqiruvchida shu chek uchun `picking`
> topshirig'i bormi deb qaraydi (`assigneeId = userId`) — bor bo'lsa «tayyor»
> chekni `ready` ga o'tkazmaydi. **Lekin `assigneeId` ROLDAN emas,
> `sklad_keepers` DAN keladi** (`:4080` → `keeper.employeeId`). Muxriddin ham,
> Ilhom ham `sklad_keepers` da YO'Q ⇒ tuzoq otilmaydi.
>
> 🔴 **AYNAN SHU SABABDAN ULARGA TOPSHIRIQ HAM TUSHMAYDI.** `sklad_keepers`
> hamon **sklad 1, 2, 3 → «Admin User»**. Ya'ni Muxriddin va Ilhom ekran va
> huquqni oldi, lekin yig'ish navbati o'zgarmadi. Buni ko'chirish — **M4**
> ning ishi va o'z smoke'ini talab qiladi.
>
> ⚠️ **Ikki halol chegara:** (1) Ilhom `Administrator` bo'lib qolgani uchun
> undagi «omborchida `/omborchi/kontrol` → 403» sinovi MA'NOSIZ — 403
> assimetriyasini isbotlash uchun ADMIN BO'LMAGAN omborchi kerak;
> (2) Muxriddin ham kassir, ham katta omborchi ⇒ o'z chekini o'zi kontrol qila
> oladi — texnik nosozlik emas, JARAYON masalasi, egasi bilib tanladi.
>
> Eski qayd (endi tarixiy): 🔴 **B2 nega OCHIQ edi — sabab KADR (o'lchov).**
> Jonlida **13 xodim**, va admin bo'lmaganlarning HAMMASI kassir:
> `Kassir 8 · Administrator 2 · AccountOwner 1 · B2B/B2G 1 · PointOfSale 1`.
> Rejaning qattiq qoidasi — **kassirni omborchi QILMANG** (`markReady` da
> `assigneeId === userId` bo'lsa chek `ready` ga o'tmay QOTIB QOLADI, 1-kechada
> o'lchangan) ⇒ «Omborchi» rolini biriktiradigan odam UMUMAN YO'Q.
> **Keyingi qadam:** haqiqiy ombor xodimi uchun yangi xodim kartasi ochilsin,
> so'ng rol biriktirilsin. Undan oldin B3 zanjirlari ham sinalmaydi.

> **2026-08-30 (3-kecha) deploy'ining o'lchangan izi** (qoida 8 + 13):
> `warehouse-state.ts` deploy'dan KEYIN — **`EXIT=0`**, **0 ta `xato`**,
> **5 ta `ogohlantirish`** (`reyestrda-yoq`: Ombor 03, 04, 05, 06, 07).
> 🟢 Bu kesim ham deploy'dan OLDIN skript kodidan hisoblab qo'yilgan edi va
> **aynan mos tushdi**. `split-holati` xatosi YO'QOLDI — chunki reyestr faylining
> o'zi (`split: "qisman"` + «Ombor 99») shu deploy bilan serverga yetib bordi.
> 🟢 **«POS yeta olmaydigan qoldiq» = 0.** Jami yacheyka **1270** (2-kechada 1089
> edi — oradagi kunda 181 yangi yacheyka yaratilgan), ombor qoldiq
> 50 252 495,30, kaskad `1:Taqsimlanmagan → 2:Ombor 02`, split `mos 27 / mos
> emas 1243`.
> Texnik verify: **11/11 sahifa 200** — shundan `/omborchi/bolaklar` (K2) va
> `/omborchi/hal-qilinmagan` (K6) **YANGI** · pm2 ikkalasi `online`, sikl yo'q ·
> flip'dan keyin API va web jurnalida **yangi xato YO'Q** (bor xatolar 06:20 va
> undan oldingi, ya'ni deploy'dan avvalgi) · `BUILD_ID yF8gtOuG… → LpEjL2oe3…`.
> **Q6 jonli verify (DRY) BIRINCHI MARTA YURITILDI** — 6/6 band `OK`:
> Q1/A1/Q4 migratsiyalari bazada, A2/A3 maydonlari API javobida, undirish
> reyestrida **105 ta kassa cheki qatori** (Q5 backfill'idan 0 — u hali
> yuritilmagan).
> 🔴 **Qoida 13 smoke'i HALI BAJARILMAGAN** — yacheyka sanash/ko'chirish, avans
> oqimi va K-oqimi (bayroq → rulon → kesim) egasining UI ishi ⇒ fazalar
> «QISMAN» bo'lib qoladi.

> 🔴 **2026-08-30 da o'lchangan — ESKI DA'VO YIQILDI: `restock_tasks` endi 0 EMAS.**
> Hujjatlarda (1-kecha va 2026-08-29 kecha rejasining B3 bandi) «`restock_tasks`
> jonlida 0 qator — G2 zanjiri hech qachon yurmagan» deb yozilgan edi. Bugungi
> o'lchov: **18 topshiriq / 58 qator** — `2026-08-27` da 5, `08-28` da 1,
> `08-29` da 12. Holati: **9 `done` + 9 `cancelled`**, `new`/`in_progress`
> **0 ta** ⇒ **qotib qolgan topshiriq YO'Q**.
> Hammasi bitta bajaruvchiga biriktirilgan — `885fb467…` («Admin User»), ya'ni
> `sklad_keepers` dagi vaqtinchalik yechim ishlayapti.
> ⚠️ **Lekin bu Blok B ni YOPMAYDI:** jonlida hamon **8 rol** va ularning
> ichida `warehouse_manager` ham, `storekeeper` ham YO'Q (`employee_roles`:
> Kassir 8, Administrator 2, AccountOwner 1, B2B/B2G 1, PointOfSale 1, qolgani
> 0). Ya'ni yig'ish oqimi ADMIN huquqi bilan yuryapti va «oddiy omborchida
> `/omborchi/kontrol` → 403» assimetriyasi hamon sinalmagan.

| **2026-09-04 15:38 UTC** | 🟢 **J2 — BO'LAK BAYROG'I GIGIENASI: OLTALA `piece_tracked` O'CHIRILDI** (egasining o'sha kundagi tasdig'i bilan). Oldin: `Azia Avvg 3x25 1X16` · `Azia Avvg 3x50 1X25` · `Uz kg 1x25 1` · `Uz vvgng  5x25` · `Vayr vvg 3x1.5` (birligi «м») + `Vesta ramka 2X` (birligi **«шт»** — bayroq XATO qo'yilgan edi; egasi J-S1 ga «yo'q, xato bo'lgan» deb javob berdi). Keyin: **0**. Oltalasining ham `piece_tracked_decided_at` muhri yangilandi (qaror egasi «Admin User»), ya'ni ular «Hal qilinmagan» ro'yxatidan chiqdi. **Reyestr (`stock_pieces`) TEGILMADI — oldin ham, keyin ham 0 qator.** Qoldiqqa, yacheykaga, ombor tuzilmasiga bir bayt ham yozilmadi: yagona tegilgan jadval — `products`. Yo'l-yo'lakay o'lchandi: oltalasining ham manbasi **1 ta** edi ⇒ 7.1 istisnosi hozirgacha birorta chekni yiqitmagan; kabel doirasi **94 tovar** (Uz 35 · Vayr 23 · Azia 15 · papkasiz 20 · Andijon 1), shundan **90 tasi** pilotga kiritilishi mumkin; metrli tovar **634** (547 tirik + 87 o'chirilgan — J-rejadagi «632» o'chirilganlarni ham sanagan edi) | Claude, `ops-j2-piece-pilot-audit.ts --apply` (UI bosadigan `POST /stock-pieces/flag` marshruti, **SQL YO'Q**); DRY oldin yuritilib egasiga ko'rsatildi; skript serverda vaqtinchalik `apps/api/src/scripts-j2/` da yugurtirilib **o'chirildi**; qaytarish — tovar kartochkasidagi bitta tugma (yoki `POST /stock-pieces/flag` `pieceTracked: true`) | — (ombor tuzilmasiga tegmaydi; `warehouse-state.ts` amaldan KEYIN: **EXIT=0**, split «bajarilgan» mos 1456 / mos emas 0, «POS yeta olmaydigan qoldiq **0**», «Reyestrga MOS») |

> **J2 dan keyingi holat (2026-09-04):** jonlida bo'lak hisobi **hech bir
> tovarda yoqilmagan** va reyestr **bo'sh**. Ya'ni K1…K6 kodi serverda turibdi,
> lekin kassa xulqi bo'lak hisobisiz — 2026-09-02 dan beri birinchi marta
> ATAYLAB shunday. Keyingi yoqish **J4** ning ishi va u J3 (reyestrni jismoniy
> sanoq bilan to'ldirish) tugagandan KEYIN, egasi tanlagan 5–8 tovarda bo'ladi.
> O'lchov va nomzodlar jadvali: J-rejaning §5 → J2 hisoboti.

> Yangi qator qo'shganda: sana, nima, kim/nima bilan, va reyestr (1-bo'lim JSON +
> 2-bo'lim jadval) yangilanganini belgilang.

> 🔴 **Kutilayotgan, lekin HALI BO'LMAGAN o'zgarish:** Q5 kassa-qarzi
> backfill'i (3.2-bo'lim). Yugurtirilgan kuni shu jadvalga qator qo'shiladi:
> «`RUN=<sana>-NN` · N qator / X so'm reyestrga · `ops-q5-backfill-sale-debts.ts`
> · balans va yacheyka reyestri TEGILMAGAN». Ombor tuzilmasiga tegmagani uchun
> 1-bo'lim JSON'i va 2-bo'lim jadvali O'ZGARMAYDI — buni ham qatorda ayting.
