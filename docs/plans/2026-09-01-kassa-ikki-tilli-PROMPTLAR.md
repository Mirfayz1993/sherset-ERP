# Kassa ikki tilli — FAZA PROMPTLARI

**Reja:** `docs/plans/2026-09-01-kassa-ikki-tilli.md` (kanonik — qarorlar va sabablar shu yerda)
**Bu fayl:** har faza uchun tayyor prompt. Nusxa ol → yangi sessiyaga qo'y.

---

## Ishlatish qoidasi

- **Har faza = alohida sessiya** (`erp/CLAUDE.md` §0.3: 1 flagship → commit → sessiya yopiladi).
- **Model: Opus.** `Agent()` chaqiruvida `model` **berilmaydi** (inherit). `model: 'sonnet'` bu loyihada TAQIQ (§0).
- **Tartib majburiy:** 0 → 1 → 2 → 3. Faza 1 va 2 **bitta relizda** chiqadi.
- Faza 4 **bloklangan** — egadan javob kutadi.
- Promptni **o'zgartirmasdan** qo'y. Qisqartirsang, taqiqlar yo'qoladi.

---

## ⛔ UMUMIY BLOK — har promptning ichida bor, o'chirilmaydi

Quyidagi blok har prompt ichiga kiritilgan. Uni olib tashlash = qo'riqchini olib tashlash.

```
UMUMIY TAQIQLAR (faza turidan qat'i nazar):
- `git add -A` / `git add .` / `git commit -a` — TAQIQ. Faqat aniq yo'llar bilan
  `git add <fayl>`. Hook mexanik bloklaydi (scripts/hook-git-add-guard.mjs).
- `git reset --hard` / `git stash` / `git clean -fd` / `git checkout -- .` — TAQIQ.
  Parallel sessiya ishini o'chiradi (CLAUDE.md §6.7A — bu real hodisa bo'lgan).
- Seniki BO'LMAGAN o'zgarishlarga tegma. `git status` dirty ko'rsatsa va u fayllarni
  sen o'zgartirmagan bo'lsang — o'qish mumkin, yozish TAQIQ.
- To'liq test-suite yugurtirma. Faqat o'z fazangning testlari.
- «done» / «production-ready» / «verified» DEMA. Faqat «Phase-1 complete».
- Tasdiqlay olmagan narsani fakt deb aytma. «Eslayman» dalil emas — faqat shu
  sessiyada ko'ringan tool-natija dalil (CLAUDE.md §2).
- Yangi tarjima O'YLAB TOPMA. RU qiymat mavjud bandldan olinadi yoki so'raladi.
- Hardcoded matnni allow-list'ga YASHIRMA. Allow-list = hujjatlangan qaror.
- Faza chegarasidan chiqma. Diff path-cheklangan bo'lishi shart.
- Rejaga zid narsa topsang — kod yozma, HISOBOT ber va to'xta.

🔴 HECH QACHON TEGILMAYDI (pul/printer buziladi):
- packages/design-system/src/lib/format.ts:40 — `formatMoney` ataylab 'ru-RU'.
  Moysklad pariteti (ingichka probel + vergul). Lokalga BOG'LAMA.
- apps/web/src/components/pos/pos-rate-chip.tsx:43 — 'ru-RU', ayni sabab.
  Bu nomuvofiqlik EMAS, qaror. TEGMA.
- ESC/POS xom chek yo'liga kirill YUBORMA (print-agent.ts:296-300 — codepage
  muzokara qilinmaydi, printerdan axlat chiqadi).
- IPC payload'iga (desktop/main.js `normalizeCart`) yangi maydon QO'SHMA —
  o'rnatilgan v1.9.0 qobiq uni tashlab yuboradi.
- Faza 0–3 da desktop/ papkasiga TEGMA — yangi .exe majburiyatini keltiradi.

DARVOZA BUYRUQLARI (aniq):
  pnpm --filter @moysklad/web typecheck        # 0 xato
  pnpm --filter @moysklad/web test             # yashil
  pnpm lint:product                            # 0 xato
  pnpm i18n:gate                               # key-existence + no-hardcoded
```

---

# FAZA 0 — Qo'riqchi teshigini yopish + mojibake

> **Prerekvizit.** Funksiya qo'shmaydi. Faza 1–3 dan OLDIN bajariladi:
> keyingi fazalar yangi fayl va matn qo'shadi; gate teshigi ochiq qolsa,
> ular ham jimgina qo'riqsiz qoladi.

```
TASK: Kassa i18n qo'riqchilarining reyestr teshigini yop va vozvrat oynasidagi
mojibake belgilarni tuzat. Yangi funksiya QO'SHILMAYDI — bu faqat himoya fazasi.

OLDIN O'QI (majburiy, skip qilma):
1. docs/plans/2026-09-01-kassa-ikki-tilli.md — §1.2 (D, E, F bandlari) va «FAZA 0»
2. apps/web/src/__tests__/i18n-no-hardcoded.test.ts — TO'LIQ (484 qator).
   Diqqat: POS_DONE_FILES (:260), POS_ALLOWED (:327), qochish-qulfi testi (:461-472)
3. apps/web/src/__tests__/pos-i18n-guard.test.ts — TO'LIQ, ayniqsa fayl boshidagi
   izoh va POS_FILES (:34-59)

KONTEKST:
- Ikkita ALOHIDA reyestr mavjud va qo'lda sinxron tutiladi:
    · i18n-no-hardcoded.test.ts → POS_DONE_FILES — 23 ta NISBIY satr ('components/pos/x.tsx')
    · pos-i18n-guard.test.ts    → POS_FILES      — 16 ta join(SRC,...) ABSOLYUT yo'l
  Shakli ham, tarkibi ham farq qiladi. Bu drift tuzog'i.
- Qochish-qulfi (i18n-no-hardcoded.test.ts:461-472) FAQAT components/pos/ ni
  tekshiradi. Shuning uchun app/(app)/sotuv/_components/vozvrat-mode.tsx va
  app/customer-display/page.tsx reyestrga tushmay qolgan — AYNAN SHU TESHIK
  vozvrat-mode.tsx ni mojibake bilan o'tkazib yuborgan.
- Mojibake AYNIQ baytlar (tekshirilgan, taxmin emas):
    vozvrat-mode.tsx:245 va :299 → D0 B2 D0 82 D1 94  = "вЂє"  → to'g'risi "›" (U+203A)
    vozvrat-mode.tsx:291         → D0 92 C2 B7        = "В·"  → to'g'risi "·" (U+00B7)
  Sabab: UTF-8 matn cp1251 deb o'qilgan. Fayl UTF-8 (BOM'siz) saqlanishi shart.

BAJARILADI:
[ ] 1. vozvrat-mode.tsx:245,291,299 — mojibake tuzatildi
[ ] 2. app/customer-display/page.tsx:379 — 'Kassa №1' → t('cash_desk_fallback');
       kalit uz.json VA ru.json ga qo'shildi (pages.customer_display ostiga)
[ ] 3. customer-display/page.tsx:983 dagi 'DEMO' → POS_ALLOWED ga SABAB bilan
       ("?demo=1 ishlab chiqish nishoni — foydalanuvchi ko'rmaydi")
[ ] 4. Reyestr birlashtirildi YOKI birlashtirilmagani asoslandi (quyida)
[ ] 5. POS_DONE_FILES ga qo'shildi:
         app/(app)/sotuv/_components/vozvrat-mode.tsx
         app/(app)/sotuv/_components/pos-types.ts
         app/customer-display/page.tsx
[ ] 6. Qochish-qulfi kengaytirildi: components/pos/ GA QO'SHIMCHA
         app/(app)/sotuv/_components/  va  app/customer-display/
[ ] 7. app/customer-display/__tests__/customer-display.test.tsx — hozir 14 kalitdan
       9 tasi tekshiriladi; yetishmayotgan 3 tasi qo'shildi: tagline, som, in_queue

4-BAND QANDAY BAJARILADI (diqqat — bu yerda hukm kerak):
  Avval pos-i18n-guard.test.ts fayl boshidagi izohni O'QI va aniqla: u
  i18n-no-hardcoded.test.ts dagi POS skaneri bilan AYNI invariantni tekshiradimi,
  yoki BOSHQASINI (masalan kalit mavjudligi + hardcoded birga)?
    · AYNI bo'lsa   → ro'yxatni apps/web/src/__tests__/_pos-i18n-registry.ts ga
                      chiqar, ikkala test undan import qilsin. Shakl farqini
                      (nisbiy vs absolyut) helper bilan yop.
    · BOSHQA bo'lsa → BIRLASHTIRMA. Hisobotda nega birlashtirmaganingni yoz va
                      o'rniga ikkala ro'yxatga bir xil 3 faylni qo'sh.
  Ikkilanish bo'lsa — birlashtirma, hisobot ber. Noto'g'ri birlashtirish
  qo'riqchini zaiflashtiradi; ajratib qoldirish esa faqat qo'lda ish qoldiradi.

DARVOZALAR (qaytishdan oldin o'tishi SHART):
  pnpm --filter @moysklad/web typecheck    → 0 xato
  pnpm lint:product                        → 0 xato
  pnpm i18n:gate                           → yashil
  pnpm --filter @moysklad/web test         → mavjudlar yashil + yangi testlar

  🔴 5–6 bandlardan KEYIN gate YASHIL bo'lishi shart. Qizarsa — demak reyestrga
  kirgan faylda yana hardcoded matn bor. Uni TUZAT, allow-list'ga YASHIRMA.

BAYT TEKSHIRUVI (majburiy, da'vo yetarli emas):
  Tuzatgandan keyin quyidagini yugurtir va chiqishni hisobotga qo'y:
    sed -n '245p;291p;299p' "apps/web/src/app/(app)/sotuv/_components/vozvrat-mode.tsx" | od -c
  Natijada 320 262 320 202 321 224 va 320 222 302 267 ketma-ketliklari
  BO'LMASLIGI shart.

QILMA:
- Yangi funksiya, yangi UI, yangi til almashtirgich QO'SHMA — u Faza 1 da.
- POS_ALLOWED ga 'DEMO' dan boshqa hech narsa qo'shma.
- Mojibake'ni "o'xshash" belgi bilan almashtirma — aynan › va · bo'lsin.
- Boshqa fayllardagi mojibake'ni qidirib butun repoga tarqalma. Agar topsang —
  hisobotda ayt, tuzatma (alohida ish).
- <UMUMIY TAQIQLAR bloki — yuqoridan to'liq nusxa ol>

QAYTAR:
1. O'zgargan fayllar: yo'l + +N/−M
2. Test soni: avval N → hozir M
3. Har darvozaning HAQIQIY chiqishi (nusxa), «o'tdi» degan da'vo emas
4. od -c chiqishi (bayt tekshiruvi)
5. 4-band bo'yicha qaror: birlashtirildimi? bo'lmasa nega?
6. Nima ishlamadi va nega
```

---

# FAZA 1 — Kioskda til almashtirgich

> Faza 2 bilan **bitta relizda** chiqadi. Yolg'iz deploy qilinmaydi.

```
TASK: Kassa kiosk rejimiga UZ↔RU til almashtirgichini qo'sh. Hozir kiosk layout
AppShell'ni chizmaydi, LocaleSwitcher esa uning ichida — ya'ni .exe da kassir
tilni umuman o'zgartira olmaydi.

OLDIN O'QI (majburiy):
1. docs/plans/2026-09-01-kassa-ikki-tilli.md — §2.3 va «FAZA 1»
2. apps/web/src/app/(app)/layout.tsx:740-800 — kiosk shoxi (nega AppShell yo'q)
3. apps/web/src/components/locale-switcher.tsx — TO'LIQ (nusxa OLMA, naqshni tushun)
4. apps/web/src/app/actions/locale.ts — setLocale server action
5. apps/web/src/app/(app)/sotuv/_components/smena-mode.tsx:480-500 — «Kassirni
   almashtirish» tugmasi (yangi blok shu yonga qo'yiladi)
6. apps/web/src/app/(app)/sotuv/__tests__/harness.tsx — test jihozi

KONTEKST:
- Kiosk shoxi: layout.tsx:752 — `if (isKioskUser(auth.user) || isShersetShell())`.
  .exe ichida DOIM shu shox ishlaydi.
- Til cookie'da: NEXT_LOCALE, middleware uni DOIM yozadi (middleware.ts:14-36),
  httpOnly EMAS. Server action mavjud — setLocale(next).
- Til nomlari mavjud: i18n/config.ts:20-23 localeMeta[l].nativeLabel
  ("O'zbek" / "Русский"). locale.uz / locale.ru kalitlari ham bor.
- POS namespace: useTranslations('pages.pos').
- 🔴 Savat oddiy React holati: sotuv/page.tsx:422 `useState<CartLine[]>([])`.
  To'liq reload uni YO'QOTADI. router.refresh() hujjat bo'yicha saqlaydi —
  LEKIN BU TASDIQLANISHI SHART (quyidagi bloklovchi test).
- Qoralama mexanizmi mavjud: parkCart (sotuv/page.tsx:898), restoreDraft (:982),
  localStorage'da saqlanadi — zaxira dizayn shunga tayanadi.

BAJARILADI:
[ ] 1. Yangi: apps/web/src/components/pos/pos-locale-toggle.tsx
[ ] 2. smena-mode.tsx ga ulandi («Kassirni almashtirish» yonidagi blokka)
[ ] 3. Yangi kalitlar uz.json + ru.json: pages.pos.language,
       pages.pos.locale_change_failed
[ ] 4. Yangi fayl ikkala POS reyestriga qo'shildi (qochish-qulfi buni majburlaydi)
[ ] 5. Komponent testi: pos-locale-toggle
[ ] 6. 🔴 BLOKLOVCHI TEST: savat omon qolishi (quyida)

KOMPONENT TALABLARI (aniq):
- Ikkita KATTA sensorli tugma, <select> EMAS. Sabab: kioskda klaviatura yo'q,
  native select sensorli ekranda noqulay.
- Joriy til `aria-pressed={true}` + vizual holat bilan ko'rsatiladi.
- Bosilganda: `await setLocale(next)` → `router.refresh()`.
- 🔴 XATO ISHLOVI MAJBURIY. Mavjud locale-switcher.tsx:22-27 da catch YO'Q —
  tarmoq uzilsa (kassa uchun REAL holat) setLocale otiladi va hech kim ushlamaydi.
  Yangi komponentda: try/catch + toast.error(t('locale_change_failed')) +
  tugmalar avvalgi holatga qaytadi.
- `pending` paytida IKKALA tugma disabled (ikki marta bosish yo'q).
- Tugmalar ro'yxati `locales` massividan chiziladi (i18n/config.ts:15) — qattiq
  ['uz','ru'] YOZMA. Sabab: uchinchi til qo'shilganda kod o'zgarmasin.
- data-test-id: "pos-locale-toggle", har tugmaga "pos-locale-<kod>".

🔴 BLOKLOVCHI TEST — bu fazani yopishdan oldin:
  Test: /sotuv ochilgan, savatga 2 qator qo'shilgan holatda tilni almashtir →
  savat o'zgarmasligini tasdiqla.
    · YASHIL  → davom et, normal yakunla.
    · QIZIL   → 🔴 TO'XTA. Kod yozishni DAVOM ETTIRMA. HISOBOT ber.
                Zaxira dizayn (oldindan kelishilgan, lekin FAQAT ruxsatdan keyin):
                tugma bosilganda savat bo'sh bo'lmasa — avval parkCart(),
                keyin almashtirish, kassirga toast bilan xabar.
                Bu zaxirani O'ZBOSHIMCHALIK bilan qo'llama — avval hisobot.

DARVOZALAR:
  pnpm --filter @moysklad/web typecheck    → 0
  pnpm lint:product                        → 0
  pnpm i18n:gate                           → yashil (yangi kalitlar ikkala bandlda)
  pnpm --filter @moysklad/web test         → mavjudlar yashil + yangi testlar

QILMA:
- locale-switcher.tsx NI O'ZGARTIRMA. U web navbar uchun — kiosk boshqa yuza.
  Uning kodini NUSXA HAM OLMA (catch yo'qligini ham nusxa olib qo'yasan).
- Almashtirgichni pos-header.tsx GA QO'YMA. Sabab: sensorli ekranda sotuv
  paytida barmoq tegib ketadi va mijoz turgan ekran uning oldida reload bo'ladi.
- kassa-kirish (PIN ekrani) ga TEGMA — u alohida qaror, bu fazada emas.
- Mijoz-ekranga (customer-display) TEGMA — u Faza 2.
- Yangi server action YOZMA — mavjud setLocale ishlatiladi.
- Cookie'ni klientdan document.cookie bilan YOZMA — faqat server action orqali.
  Sabab: server action revalidatePath ni ham chaqiradi.
- <UMUMIY TAQIQLAR bloki — yuqoridan to'liq nusxa ol>

QAYTAR:
1. O'zgargan/yangi fayllar: yo'l + +N/−M
2. Test soni: avval N → hozir M
3. Har darvozaning HAQIQIY chiqishi
4. 🔴 BLOKLOVCHI TEST natijasi — yashil/qizil, va test kodining o'zi
5. Nima ishlamadi va nega
```

---

# FAZA 2 — Mijoz-ekran tilga ergashadi

> Topshiriqning o'zagi. **Faza 1 bilan bitta relizda.** Yolg'iz chiqarilsa —
> kassir RU qo'yadi, mijoz ekrani UZ qoladi: bu hozirgi holatdan YOMONROQ.

```
TASK: Mijoz-ekran (CFD) kassa tili o'zgarganda o'zi ergashsin. Hozir u tilini
bir marta server render paytida oladi va boshqa hech qachon qayta o'qimaydi.

OLDIN O'QI (majburiy):
1. docs/plans/2026-09-01-kassa-ikki-tilli.md — §2.1, §2.2 va «FAZA 2».
   Ayniqsa «Nega poll, IPC yoki BroadcastChannel emas» jadvali.
2. apps/web/src/app/customer-display/page.tsx — fayl boshidagi izoh (1-35) va
   useParkedDrafts (:305-350) — NAQSH SHU YERDA, unga ergash
3. desktop/main.js:660-720 — CFD oynasi qanday ochiladi, did-finish-load
4. apps/web/src/middleware.ts — cookie invarianti
5. apps/web/src/i18n/config.ts — isLocale, locales

KONTEKST (nega aynan shunday — o'zgartirma):
- CFD alohida Electron oynasi, LEKIN kassa oynasi bilan AYNI sessiyada
  (main.js:679-682 — `partition` ATAYLAB berilmagan). Ya'ni cookie UMUMIY.
  Bu jonlida isbotlangan: CFD auth tokenini aynan shu umumiy cookie'dan oladi.
- NEXT_LOCALE httpOnly EMAS ⇒ document.cookie dan o'qish mumkin.
- Middleware cookie'ning DOIM mavjud va to'g'ri bo'lishini kafolatlaydi
  (middleware.ts:16) ⇒ «cookie yo'q» holati yo'q.
- CFD'da saqlanadigan holat YO'Q: main.js:699-702 savatni did-finish-load da
  qayta yuboradi ⇒ reload hech narsani yo'qotmaydi.
- Sahifada allaqachon 3 ta interval bor (navbat 8s, qoralama 8s, soat 10s) —
  yana bittasi arzon.

BAJARILADI:
[ ] 1. customer-display/page.tsx ga yangi hook: useLocaleSync()
[ ] 2. Yangi konstanta LOCALE_POLL_MS = 2000 (fayl boshidagi konstantalar yoniga)
[ ] 3. Hook sahifa komponentida chaqiriladi
[ ] 4. 5 ta test (quyida)

MANTIQ (aynan shunday, soddalashtirma):
  rendered = useLocale()
  har LOCALE_POLL_MS da:
    cookie = document.cookie dan NEXT_LOCALE ni ajratib ol
    agar !isLocale(cookie)                    -> hech narsa qilma
    agar cookie === rendered                  -> sessionStorage['cfd.localeReloadFor'] ni
                                                 O'CHIR; qaytish
    agar sessionStorage['cfd.localeReloadFor'] === cookie -> TO'XTA (sikl qo'riqchisi)
    aks holda -> sessionStorage['cfd.localeReloadFor'] = cookie
                 window.location.reload()

HAR QO'RIQCHINING SABABI (kodda IZOH bilan yozilishi SHART — bular sezgiga zid):
- isLocale tekshiruvi: bo'sh/buzuq cookie render tiliga teng bo'lmaydi ⇒ tekshiruvsiz
  CHEKSIZ RELOAD bo'lardi. Middleware buni deyarli imkonsiz qiladi, lekin mijoz
  turgan ekranda «deyarli» yetarli emas.
- sessionStorage belgisi: reload'dan keyin ham mos kelmasa (masalan server eski
  tilni bersa) — ikkinchi marta urinilmaydi. Bu main.js:705-714 dagi cfdRetries
  naqshining aynan o'zi.
- Belgi cookie === rendered da TOZALANADI: aks holda ikkinchi marta til
  o'zgartirilganda hook ishlamay qolardi.
- sessionStorage (localStorage EMAS): belgi shu oyna sessiyasiga tegishli;
  localStorage kassir oynasiga ham ko'rinardi va ma'nosiz umumiy holat yaratardi.
- 2000 ms (QUEUE_POLL_MS=8000 EMAS): kassir uchun «darhol» tuyulsin; qolaversa
  QUEUE_POLL_MS tokenReady ga bog'liq, til esa tokendan mustaqil bo'lishi kerak.

TESTLAR (5 ta, hammasi majburiy):
[ ] render 'uz' + cookie 'ru'        → reload BIR MARTA chaqiriladi
[ ] keyingi tick                     → BOSHQA chaqirilmaydi (sikl qo'riqchisi)
[ ] render 'uz' + cookie 'uz'        → hech qachon chaqirilmaydi
[ ] cookie buzuq ('NEXT_LOCALE=xx')  → hech qachon chaqirilmaydi
[ ] cookie 'ru' → keyin 'uz' ga qaytdi → YANA reload bo'ladi (belgi tozalangan)

DARVOZALAR:
  pnpm --filter @moysklad/web typecheck    → 0
  pnpm lint:product                        → 0
  pnpm --filter @moysklad/web test         → mavjudlar yashil + 5 yangi

REAL MUHITDA TASDIQLASH (Phase-2 — imkoni bo'lsa):
  Ikki brauzer tabi: /sotuv va /customer-display. Tilni almashtir → ikkinchi tab
  2 soniya ichida yangilanishini KO'R. Savat to'la holatda ham sina.
  🔴 Bu tasdiqlanmasa — fazani «Phase-1: runtime-tasdiqlanmagan» deb belgila va
  hisobotda OCHIQ yoz. «Ishlaydi» DEMA.

QILMA:
- desktop/ ga TEGMA. Yangi IPC maydoni QO'SHMA — o'rnatilgan v1.9.0 qobiq
  normalizeCart oq ro'yxati tufayli uni tashlab yuboradi.
- BroadcastChannel ISHLATMA. U kodda bor, lekin faqat brauzer yo'lida; ikki
  Electron oynasi orasida HECH QACHON o'lchanmagan. Tasdiqlanmagan mexanizm.
- POS tomondan localStorage kaliti YOZMA — cookie yagona manba, nusxa drift qiladi.
- Ikkala xabar-to'plamini klientga yuklab provayderni almashtirishga URINMA —
  bandl kattalashadi, foyda yo'q (CFD'da saqlanadigan holat yo'q).
- Reloadni «savat bo'shaguncha kutish» bilan shartlama — bu fazada emas; agar
  kerak deb hisoblasang, hisobotda taklif qil.
- Kassa tomoniga (sotuv/, components/pos/) TEGMA — u Faza 1 da tugagan.
- <UMUMIY TAQIQLAR bloki — yuqoridan to'liq nusxa ol>

QAYTAR:
1. O'zgargan fayllar: yo'l + +N/−M
2. 5 testning har birining nomi va natijasi
3. Har darvozaning HAQIQIY chiqishi
4. Real muhitda sinaldimi? Sinalmagan bo'lsa — OCHIQ ayt
5. Nima ishlamadi va nega
```

---

# FAZA 3 — Sana/vaqt formati tilga bog'lanadi

```
TASK: Kassa doirasidagi qattiq yozilgan 'uz-UZ' locale teglarini joriy tilga
bog'la va regressiyani yangi qo'riqchi bilan qulfla.

OLDIN O'QI (majburiy):
1. docs/plans/2026-09-01-kassa-ikki-tilli.md — §1.3, §2.5 va «FAZA 3»
2. apps/web/src/app/customer-display/page.tsx:494 va :710 — TO'G'RI naqsh
   allaqachon shu yerda (locale === 'ru' ? 'ru-RU' : 'uz-UZ')
3. packages/design-system/src/lib/format.ts:25-50 — formatMoney izohi
   (NEGA u lokaldan mustaqil — buni tushunmasdan boshlama)

KONTEKST — O'LCHANGAN FARQ (Node ICU):
  uz-UZ  son: "1 234 567,89"  sana: "01-sen, 2026"      vaqt: "14:05"
  ru-RU  son: "1 234 567,89"  sana: "01 сент. 2026 г."  vaqt: "14:05"
  ⇒ FAQAT SANA farq qiladi. Son va vaqt bir xil, ya'ni ular bilan bog'liq
  o'zgarish kosmetik jihatdan xavfsiz — lekin baribir normallashtiriladi, chunki
  kelajakda format opsiyalari (masalan month:'long') qo'shilsa farq paydo bo'ladi.

BAJARILADI:
[ ] 1. Yangi: apps/web/src/lib/i18n-format.ts
         export const BCP47: Record<Locale, string> = { uz: 'uz-UZ', ru: 'ru-RU' }
         export function useBcp47(): string   // useLocale() -> BCP47, fallback BCP47.uz
[ ] 2. Quyidagi 14 joy helper'ga o'tkazildi:
         components/pos/customer-card-panel.tsx:189
         components/pos/customers-panel.tsx:462, 785, 790
         components/pos/debt-payment-dialog.tsx:139
         components/pos/payment-dialog.tsx:32
         app/(app)/sotuv/page.tsx:1010
         app/(app)/sotuv/_components/cheklar-mode.tsx:385, 1003
         app/(app)/sotuv/_components/smena-mode.tsx:228
         app/(app)/sotuv/_components/sotuv-mode.tsx:215
         app/(app)/sotuv/_components/vozvrat-mode.tsx:275
         app/(app)/sotuv/_components/zakazlar-mode.tsx:282
[ ] 3. CFD'dagi ikki ternary (customer-display/page.tsx:494, 710) ham helper'ga —
       bir naqsh, ikki nusxa qolmasin
[ ] 4. Yangi qo'riqchi test: kassa doirasida qattiq BCP-47 teg taqiqlanadi
[ ] 5. Qo'riqchining o'zi mutant-fikstura bilan sinaladi (mavjud naqsh:
       i18n-no-hardcoded.test.ts:408-445 «the guard is itself guarded»)

🔴 ALMASHTIRILMAYDI (yangi qo'riqchida HUJJATLANGAN ISTISNO bo'ladi):
  · packages/design-system/src/lib/format.ts:40 — formatMoney 'ru-RU'
  · apps/web/src/components/pos/pos-rate-chip.tsx:43 — 'ru-RU'
  Ikkalasi ham moysklad pul-pariteti uchun ATAYLAB shunday. Ularni «izchillik
  uchun» tuzatish = REGRESSIYA: pul ko'rinishi tilga qarab o'zgarib ketardi va
  ICU versiyasiga bog'liq bo'lib qolardi (format.ts:36-39 izohi buni yozgan).

QO'RIQCHI TALABI:
- Skaner faqat KASSA doirasini tekshiradi (components/pos/, app/(app)/sotuv/,
  app/customer-display/, app/kassa-kirish/). ERP'ning qolgan qismiga TEGMAYDI —
  u yerda ~200 ta 'ru-RU' bor va ular ALOHIDA ish.
- Istisno ro'yxati kod ichida SABAB bilan yoziladi, bo'sh o'tkazib yuborilmaydi.
- Mutant testi: qo'riqchi haqiqatan tutishini isbotla (soxta 'uz-UZ' qo'shilsa
  test qizarsin).

DARVOZALAR:
  pnpm --filter @moysklad/web typecheck    → 0
  pnpm lint:product                        → 0
  pnpm --filter @moysklad/web test         → mavjudlar yashil + yangi qo'riqchi

QABUL MEZONI:
- RU rejimida cheklar ro'yxatidagi sana "01 сент. 2026 г." ko'rinishida
  (o'zbekcha "01-sen" EMAS).
- Pul ko'rinishi IKKALA tilda AYNAN bir xil — o'zgarmagan.
- ⚠️ Formatni CHROMIUM'da ham tekshir, faqat Node'da emas: ICU versiyasi farq
  qilishi mumkin. Tekshira olmasang — hisobotda OCHIQ ayt.

QILMA:
- ERP'ning qolgan qismidagi ~200 ta 'ru-RU' ga TEGMA. Faza chegarasi.
- formatMoney yoki pos-rate-chip.tsx:43 ni O'ZGARTIRMA (yuqoriga qara).
- toLocaleTimeString/toLocaleDateString ni Intl.DateTimeFormat ga qayta
  yozishga urinma — bu refactor emas, faqat locale tegi almashtiriladi.
- Sana FORMATINI (opsiyalarini) o'zgartirma — faqat birinchi argument.
- <UMUMIY TAQIQLAR bloki — yuqoridan to'liq nusxa ol>

QAYTAR:
1. O'zgargan fayllar: yo'l + +N/−M · 14 joy hammasi qamralganini tasdiqla
2. Yangi qo'riqchi kodi va uning mutant testi
3. Har darvozaning HAQIQIY chiqishi
4. Chromium'da tekshirildimi?
5. Nima ishlamadi va nega
```

---

# FAZA 4 — Qog'oz chek ikki tilli ⛔ BLOKLANGAN

> **Bu promptni EGADAN javob olmasdan ishlatma.**
> Savol: kassir tili RU bo'lsa, **mijoz ham ruscha chek olsinmi**, yoki chek
> rasmiy hujjat sifatida **doim o'zbekcha** qolsinmi?
> Javob «doim o'zbekcha» bo'lsa — bu faza BEKOR QILINADI, kod yozilmaydi.

```
TASK: Qog'oz chek yorliqlarini tilga bog'la — LEKIN faqat Electron/Windows
drayver yo'lida. ESC/POS xom yo'li lotin bo'lib qoladi.

⛔ PREREKVIZIT: egadan «chek mijoz tiliga ergashsin» javobi olingan bo'lishi
   SHART. Olinmagan bo'lsa — TO'XTA, kod yozma.

OLDIN O'QI (majburiy):
1. docs/plans/2026-09-01-kassa-ikki-tilli.md — «FAZA 4»
2. apps/web/src/lib/print-agent.ts:286-345 — ESC/POS codepage izohi.
   BU IZOHNI TUSHUNMASDAN BOSHLAMA.
3. apps/web/src/lib/print-agent.ts:680-700 — yo'l tanlash (electron() ? html : text)
4. apps/web/src/lib/z-report-receipt.ts:93-141 + lib/use-z-receipt-labels.ts:20-82
   — 🔴 NAQSH SHU YERDA. Z-hisobot bu masalani ALLAQACHON yechgan. Nusxa ol,
   yangi arxitektura O'YLAB TOPMA.
5. apps/web/src/lib/pos/receipt-model.test.ts:57-88 — mavjud drift-qulfi

FIZIK CHEKLOV (buzilsa mijozga axlat bosiladi):
  · Electron yo'li (kassalar AYNAN shunda ishlaydi) — Windows drayveri chizadi,
    KIRILL ISHLAYDI.
  · ESC/POS xom yo'li (brauzer + HTTP agent) — codepage muzokara qilinmaydi,
    KIRILL AXLAT CHIQADI.
  ⇒ buildReceiptHtml → tilga bog'lanadi
     buildReceiptText → MAJBURAN 'uz' (lotin), sabab kodda yoziladi

BAJARILADI:
[ ] 1. ReceiptLabels struct (Z-hisobot naqshi bo'yicha), t() dan yig'iladi
[ ] 2. RECEIPT_LABELS (receipt-model.ts:49-75, 22 ta) → struct
[ ] 3. RECEIPT_PAYMENT_LABELS (receipt-payments.ts:91-101, 8 ta) → struct
[ ] 4. DEBT_ROW_NAME (receipt-debt-model.ts:39, 1 ta) → struct
[ ] 5. receipt-model.ts:287 — amountInWords(total,'UZS','uz') → joriy lokal
       (packages/money WordsLocale = 'ru' | 'uz' — ikkalasi ham qo'llab-quvvatlanadi)
[ ] 6. buildReceiptText majburan 'uz' yorliqlarini oladi + IZOH
[ ] 7. receipt-model.test.ts drift-qulfi IKKALA bandlni tekshiradi
[ ] 8. Test: RU lokalda HTML chek ruscha, ESC/POS chek LOTIN

MUHIM: RU tarjimalari ALLAQACHON MAVJUD — ru.json → pages.print.chek_* to'liq
to'ldirilgan. Hozir shunchaki hech kim o'qimaydi. YANGI TARJIMA YOZMA.

QILMA:
- ESC/POS yo'liga kirill yuborma (yuqoriga qara).
- Yangi print arxitekturasi o'ylab topma — Z-hisobot naqshidan nusxa ol.
- Z-hisobot kodiga tegma (u allaqachon to'g'ri).
- <UMUMIY TAQIQLAR bloki — yuqoridan to'liq nusxa ol>

QAYTAR: standart 5 band + ESC/POS yo'li lotin qolganini isbotlovchi test
```

---

# FAZA 5 — API xato xabarlari ⏸ HOZIRCHA EMAS

> Alohida loyiha. ~284 o'zbekcha satr, ~83 to'g'ridan-to'g'ri `throw`.
> Bu relizga kirmaydi. Quyida faqat **kelajakda boshlash uchun** boshlang'ich prompt.

```
TASK (kelajak): POS kassirga ko'rinadigan API xato xabarlarini ikki tilli qil.

OLDIN O'QI: docs/plans/2026-09-01-kassa-ikki-tilli.md — «FAZA 5»

KONTEKST:
- API'da i18n qatlami UMUMAN yo'q. Xabarlar xom o'zbekcha satr literallari.
- POS ularni O'ZGARTIRMASDAN ko'rsatadi: api-client.ts:86 → toast.error(e.message)
  (sotuv/page.tsx:149,1286,1328,1377,1493,1513,1599 va boshqalar).
- Kassa modullari: retail-sale, cashier-session, auth/pos-*, debt, product,
  stock, cash-desk, sklad-keeper.

BIRINCHI QADAM — KOD YOZISH EMAS, O'LCHASH:
  Deterministik skript yoz: kassa yo'llarida kassirga HAQIQATAN yetib boradigan
  xabarlarni sanab chiq (throw + refusals.push + zod message). Natijani faylga
  yoz, kontekstga emas.
  Keyin: eng ko'p uchraydigan ~30 tasini aniqla — ular kassirga ko'rinadigan
  holatlarning katta qismini qoplaydi.

TAVSIYA ETILGAN YO'L: xato KODLARI + klientda tarjima, faqat kassa yo'llarida.
  Sabab: to'liq nestjs-i18n 252 ta throw ni qamraydi va bu alohida loyiha;
  kodlar esa kassirga ko'rinadigan 100% ni ~30 xabar bilan yopadi.

QILMA:
- Butun API'ga nestjs-i18n o'rnatishni BOSHLAMA — avval o'lchov va kelishuv.
- Xabar matnini o'zgartirma (faqat kod qo'shiladi) — mavjud testlar matnga
  bog'langan bo'lishi mumkin, avval tekshir.
- <UMUMIY TAQIQLAR bloki>
```

---

# FAZA 6 — Electron qobiq matnlari ⏸ OXIRGI

> Yangi `.exe` talab qiladi. Faza 0–3 tugab, jonlida ishlaganidan keyin.

```
TASK (kelajak): Electron qobig'ining o'z matnlarini ikki tilli qil.

OLDIN O'QI:
1. docs/plans/2026-09-01-kassa-ikki-tilli.md — «FAZA 6»
2. deploy/DEPLOY-sherset.md:103-160 — update kanali qoidalari
   (🔴 exe OLDIN, latest.yml OXIRIDA; latest.yml ni QO'LDA TAHRIRLAMA)

QAMROV (~49 satr):
  main.js 15 · updater.js 4 · device-store.js 5 · logger.js 2 ·
  check-build-assets.js 2 · setup.html 4 · offline.html 12 · updating.html 4
  Eng ko'rinadigani: offline.html (tarmoq uzilganda kassir AYNAN shuni ko'radi)
  va main.js:664,667.

TIL MANBAI: qobiq web ilovaning cookie'sini bevosita o'qiy olmaydi (u alohida
jarayon). Variantlar — avval TAHLIL, keyin kod:
  (a) device-store.js dagi kassa-config.json ga til yozish (kassir sozlashi kerak)
  (b) qobiq oyna yuklanganda cookie'ni session API orqali o'qish
      (session.defaultSession.cookies.get) — bu web tanlovi bilan avtomat mos keladi
  (b) afzalroq ko'rinadi, LEKIN tekshirilmagan. Avval o'lchov, keyin qaror.

QILMA:
- .exe ni O'ZBOSHIMCHALIK bilan qurib tarqatma. Reliz — alohida qaror.
- latest.yml ni qo'lda tahrirlama (SHA-512 tashiydi).
- Eski .exe ni o'chirma (offline kassa eski manifestni hal qilayotgan bo'lishi mumkin).
- <UMUMIY TAQIQLAR bloki>
```

---

## Faza tugagach — markaz (Opus) nima qiladi

Agent qaytgach, **da'vosiga ishonilmaydi** (`CLAUDE.md` §0 «Trust but verify»):

1. `git status --short` — qaysi fayllar HAQIQATAN o'zgargan
2. `git diff` — claim qilinganlar amalga oshganmi
3. Darvozalarni **mustaqil** yugurtirish (agent chiqishiga ishonmasdan)
4. Farq bo'lsa — Opus'da o'zim tuzataman, yangi subagent yubormayman
5. Commit: Conventional Commits, `git add <aniq fayllar>`
6. `git show --stat HEAD` — lint-staged begona fayl qo'shmaganini tekshirish
   (`CLAUDE.md` §6.7B — bu real hodisa bo'lgan)
7. `NEXT.md` ga hand-off yozuvi + holat yorlig'i (**«Phase-1» yoki «Phase-2 verified»**)
