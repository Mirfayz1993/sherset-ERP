# Kassa + mijoz-ekran ikki tilli (UZ/RU) — REJA

**Sana:** 2026-09-01 · **Holat:** reja (kod yozilmagan) · **Muallif:** Opus sessiyasi
**Kanonik nusxa:** shu fayl. Agentlar ishni shu fayldan oladi.

---

## 0. Eng muhim xulosa — vazifa aslida nima

Topshiriq «kassani ikki tilli qilish» deb yangraydi. **O'lchov shuni ko'rsatdiki,
matnlar allaqachon ikki tilda tayyor.** Yetishmayotgani — mexanizm.

| O'lchov | Natija |
|---|---|
| Kassa doirasidagi tarjima kalitlari (8 namespace) | **552** |
| Shundan RU'da yo'q | **0** |
| Shundan tarjima qilinmagan (UZ = RU) | **0** |
| Mijoz-ekran (CFD) kalitlari | 14 — ikkalasida ham to'liq |
| CFD `useLocale()` / `useTranslations()` ishlatadimi | **Ha, allaqachon** |

Ya'ni: agar `NEXT_LOCALE=ru` bo'lsa, kassa ham, mijoz-ekran ham **hozir ham**
ruscha chiqadi. Muammo boshqa joyda:

1. **Kassir tilni almashtira olmaydi.** `.exe` ichida layout doim kiosk shoxiga
   tushadi (`apps/web/src/app/(app)/layout.tsx:752` — `isShersetShell()`), ya'ni
   `AppShell` chizilmaydi, `LocaleSwitcher` esa `AppShell` ning `topRightExtras`
   ichida (`:806`). Kioskda u **umuman render bo'lmaydi**.
2. **Ikkinchi ekran tilga ergashmaydi.** CFD — alohida Electron oynasi; tilini
   server render paytida cookie'dan oladi va **boshqa hech qachon qayta o'qimaydi**.
3. **Sanalar tilga bog'lanmagan** — kassa doirasida 14 joyda `'uz-UZ'` qattiq yozilgan.
4. **Ikki fayl qo'riqchidan tashqarida** — va bittasida hozir ekranda buzuq belgi turibdi.
5. **Qog'oz chek faqat o'zbekcha** (RU tarjimasi bazada BOR, lekin o'qilmaydi).
6. **API xato xabarlari faqat o'zbekcha** — kassirga aynan shu ko'rinadi.
7. **Electron qobig'ining o'z matnlari faqat o'zbekcha** — yangi `.exe` talab qiladi.

**Shuning uchun reja «tarjima qilish» haqida emas — «almashtirish va ergashtirish»
haqida.** Bu farq butun rejani belgilaydi.

---

## 1. O'lchangan holat — har bir da'vo dalil bilan

### 1.1 Nima ishlaydi (tegilmaydi)

| Narsa | Dalil |
|---|---|
| next-intl 4.9.2, cookie-asosli, URL prefiksi yo'q | `apps/web/src/i18n/config.ts:15-25` |
| Til: cookie → Accept-Language → `uz` | `apps/web/src/i18n/request.ts:13-29` |
| **Middleware cookie'ni DOIM yozadi** — u har doim mavjud va to'g'ri | `apps/web/src/middleware.ts:14-36` |
| Cookie `httpOnly` EMAS ⇒ JS o'qiy oladi | `middleware.ts:30-34`, `app/actions/locale.ts:16-20` |
| `logout` `NEXT_LOCALE` ga tegmaydi (faqat 2 auth cookie) | `apps/api/src/modules/auth/auth.controller.ts:114-115` |
| Electron hech qachon `clearStorageData` chaqirmaydi | `desktop/main.js` — grep 0 natija |
| POS 23/26 fayl qo'riqchi reyestrida, 0 hardcoded matn | `__tests__/i18n-no-hardcoded.test.ts:260-290` |
| Z-hisobot **allaqachon to'liq i18n** — yorliqlar struct bilan uzatiladi | `lib/z-report-receipt.ts:93-141`, `lib/use-z-receipt-labels.ts:20-82` |

### 1.2 Nima buzuq / yetishmaydi

| # | Muammo | Dalil | Ta'sir |
|---|---|---|---|
| A | Kioskda til almashtirgich yo'q | `(app)/layout.tsx:752` vs `:806` | Kassir tilni o'zgartira olmaydi |
| B | CFD tilga ergashmaydi | `app/customer-display/page.tsx` — cookie qayta o'qilmaydi | Kassa RU, ekran UZ |
| C | 14 joyda `'uz-UZ'` qattiq | quyidagi ro'yxat | RU rejimida sana o'zbekcha |
| D | 2 fayl gate tashqarisida | `sotuv/_components/vozvrat-mode.tsx`, `app/customer-display/page.tsx` | Regressiya jim o'tadi |
| E | **Mojibake ekranda** | `vozvrat-mode.tsx:245,291,299` | Kassir `вЂє` va `В·` ko'radi |
| F | CFD fallback qattiq | `customer-display/page.tsx:379` `'Kassa №1'` | Tarjima qilinmaydi |
| G | Qog'oz chek UZ-only | `lib/pos/receipt-model.ts:49-75` (22), `receipt-payments.ts:91-101` (8), `receipt-debt-model.ts:39` (1) | Mijoz UZ chek oladi |
| H | Chekda summa-so'z `'uz'` ga qotirilgan | `receipt-model.ts:287` | RU chekda ham o'zbekcha |
| I | API ~284 o'zbekcha xabar POS'ga verbatim chiqadi | `lib/api-client.ts:86` → `sotuv/page.tsx:149,1286,…` | RU kassir UZ xato ko'radi |
| J | Electron qobiq ~49 o'zbekcha satr | `desktop/{main,updater,device-store}.js`, `{setup,offline,updating}.html` | Yangi `.exe` kerak |

**C — aniq ro'yxat (14 ta):**
`components/pos/customer-card-panel.tsx:189` · `customers-panel.tsx:462,785,790` ·
`debt-payment-dialog.tsx:139` · `payment-dialog.tsx:32` ·
`app/(app)/sotuv/page.tsx:1010` · `_components/cheklar-mode.tsx:385,1003` ·
`smena-mode.tsx:228` · `sotuv-mode.tsx:215` · `vozvrat-mode.tsx:275` ·
`zakazlar-mode.tsx:282` · CFD `customer-display/page.tsx:494,710` (bular
allaqachon lokalga bog'liq — namuna sifatida to'g'ri).

### 1.3 O'lchangan format farqi (Node ICU)

| Locale | Son | Sana (`day 2-digit, month short`) | Vaqt |
|---|---|---|---|
| `uz-UZ` | `1 234 567,89` | `01-sen, 2026` | `14:05` |
| `ru-RU` | `1 234 567,89` | `01 сент. 2026 г.` | `14:05` |

**Xulosa:** faqat **sana** farq qiladi. Son va vaqt bir xil ⇒ ular bilan bog'liq
o'zgarish xavfsiz, lekin kelajakdagi format opsiyalari uchun baribir normallashtiriladi.
⚠️ Bu Node'da o'lchandi — **Chromium/Electron ICU'da qayta tekshiriladi** (Faza 3 qabul mezoni).

---

## 2. Arxitektura qarori — va NEGA aynan shunday

### 2.1 Yagona haqiqat manbai = `NEXT_LOCALE` cookie

**Qaror:** til holati faqat cookie'da yashaydi. Hech qanday parallel nusxa
(localStorage kaliti, IPC maydoni, Electron config) **yaratilmaydi**.

**Nega:**
- Cookie'ni **server o'qiydi** — render tili aynan shundan kelib chiqadi. Boshqa
  har qanday nusxa unga nisbatan *hosila* bo'lardi va **drift** qilishi mumkin edi
  (nusxa `ru`, cookie `uz` ⇒ ekran UZ, lekin tizim «RU» deb o'ylaydi).
- Middleware cookie'ning **doim mavjud va to'g'ri** bo'lishini kafolatlaydi
  (`middleware.ts:16`). Ya'ni «cookie yo'q» holati yo'q — bu butun bir xatolar
  sinfini strukturaviy yopadi.
- CFD cookie'ni o'z render tili bilan solishtirib, **o'zini o'zi tuzatadi**:
  sinxronlashtiriladigan holat yo'q ⇒ desinxron bo'lish imkoni ham yo'q.

### 2.2 CFD qanday ergashadi: cookie-poll + qo'riqlangan bitta reload

**Qaror:** CFD `document.cookie` dagi `NEXT_LOCALE` ni davriy o'qiydi va o'zining
`useLocale()` qiymati bilan solishtiradi. Farq bo'lsa — **bir marta** `location.reload()`.

**Nega reload, «jonli almashtirish» emas:** CFD tili root layout'da server
tomonda `NextIntlClientProvider` ga berilgan (`app/layout.tsx:38-55`). Uni
qayta o'qish uchun sahifa server'dan qayta render bo'lishi shart. Ikkala
xabar-to'plamini klientga yuklab, provayderni almashtirish ham mumkin edi —
lekin bu bandl hajmini oshiradi va CFD'da saqlanadigan holat yo'q, ya'ni
**reload hech narsani yo'qotmaydi**: `desktop/main.js` savatni
`did-finish-load` da qayta yuboradi (`main.js:699-702`). Ya'ni oddiyroq yechim
ayni paytda xavfsizroq ham.

**Nega poll, IPC yoki BroadcastChannel emas:**

| Kanal | Nega YO'Q |
|---|---|
| Yangi IPC maydoni | `main.js` `normalizeCart()` payload'ni oq ro'yxat bo'yicha qayta quradi ⇒ **o'rnatilgan v1.9.0 qobiq yangi maydonni tashlab yuboradi**. Yangi `.exe` kerak bo'lardi (`customer-display/page.tsx:24-31` izohi). |
| `BroadcastChannel` | Kodda mavjud, **lekin faqat brauzer yo'lida** (`page.tsx:171-179`) — Electron yo'li undan oldin `return` qiladi. Ikki Electron oynasi orasida **hech qachon o'lchanmagan**. Tasdiqlanmagan mexanizmga tayanish — aynan «ko'r-ko'rona» qadam. |
| `storage` hodisasi | POS tomondan ortiqcha kalit yozishni talab qiladi ⇒ §2.1 dagi drift. |
| **Cookie poll** ✅ | Cookie umumiyligi **jonlida isbotlangan**: CFD auth tokenini aynan umumiy cookie sessiyasidan oladi (`main.js:679-682` — `partition` ataylab berilmagan). Yangi `.exe` kerak emas. |

**Cheksiz reload xavfi va u qanday yopiladi:**
`sessionStorage['cfd.localeReloadFor']` = biz reload qilgan **maqsad til**.
- `cookie === render` ⇒ belgini tozala (kelajakdagi o'zgarish ishlaydi).
- `cookie !== render` va belgi `=== cookie` ⇒ **to'xta** (bir marta urindik, foyda bermadi).
- Aks holda ⇒ belgini yoz, reload qil.

Bu `main.js` dagi `cfdRetries` naqshining aynan o'zi (`main.js:705-714`) —
mijoz turgan ekran hech qachon reload siklida qolmasligi kerak.

### 2.3 Almashtirgich qayerda turadi: «Smena» ekrani

**Qaror:** `_components/smena-mode.tsx` — sidebar'dagi ⚙ tugmasi ochadigan ekran
(`components/pos/pos-sidebar.tsx:187`), pastida allaqachon «Kassirni almashtirish»
turibdi (`smena-mode.tsx:491`).

**Nega header EMAS:** kassa — **sensorli ekran**. Header doim ko'rinadi va
sotuv paytida barmoq tegib ketishi mumkin. Tasodifiy tegish esa mijoz turgan
ekranni uning oldida reload qiladi. Til — kuniga bir marta o'rnatiladigan
sozlama, tez-tez bosiladigan tugma emas ⇒ u ataylab qidiriladigan joyda turishi kerak.

**Nega `<select>` EMAS, ikkita katta tugma:** kioskda klaviatura yo'q; native
select sensorli ekranda noqulay. `LocaleSwitcher` (`components/locale-switcher.tsx`)
web navbar uchun mo'ljallangan — u qayta ishlatilmaydi, **lekin nusxa ham
ko'chirilmaydi**: `setLocale` server action ikkalasiga umumiy qoladi.

### 2.4 Qurilma bo'yicha til (hozircha), kassir bo'yicha emas

Cookie — **qurilma darajasida**. Kassir A `ru` qo'ysa, kassir B ham `ru` ko'radi.

**Nega hozir shunday:** kassir bo'yicha til `User.locale` ustuni + migratsiya +
PIN login'da qo'llash demakdir — bu alohida ish. Do'kon odatda bitta tilda ishlaydi.

**Nega bu kelajakni bloklamaydi:** cookie **yagona ish vaqti manbai** bo'lgani
uchun, kelajakdagi kassir-tili shunchaki *PIN login'da cookie'ni yozadi*.
Boshqa hech nima o'zgarmaydi — CFD, format, gate'lar hammasi o'z holicha qoladi.
**Aynan shu sabab §2.1 qarori muhim.**

### 2.5 🔴 TEGILMAYDIGAN narsalar (buzilsa — pul buziladi)

| Narsa | Nega tegilmaydi |
|---|---|
| `packages/design-system/src/lib/format.ts:40` — `formatMoney` `'ru-RU'` | **Ataylab lokaldan mustaqil.** Izoh (`:36-39`): moysklad pariteti — ingichka probel + vergul (`64 000,00`). Lokalga bog'lansa pul ko'rinishi tilga qarab o'zgarardi va ICU versiyasiga bog'liq bo'lib qolardi. |
| `components/pos/pos-rate-chip.tsx:43` — `'ru-RU'` | Kurs raqami, aynan yuqoridagi sabab. **Bu «nomuvofiqlik» EMAS — qaror.** |
| ESC/POS xom chek yorliqlari — lotin | `lib/print-agent.ts:296-300`: «ESC/POS codepage agent tomonidan muzokara qilinmaydi». Kirill yuborilsa **printerdan axlat chiqadi**. |
| IPC payload shakli (`normalizeCart`) | Yangi maydon eski qobiqda tashlanadi ⇒ yangi `.exe` majburiyati. |

---

## 3. Fazalar

> Har faza = **bitta sessiya, bitta commit** (loyiha `CLAUDE.md` §0.3).
> Faza 0–3 birgalikda **bitta reliz**; 4/5/6 alohida.

### FAZA 0 — Qo'riqchi teshigini yopish + mojibake (majburiy prerekvizit)

**Nega birinchi:** Faza 1–3 yangi fayl va yangi matn qo'shadi. Agar gate teshigi
ochiq qolsa, yangi kod ham jimgina qo'riqsiz qoladi. Teshikni oldin yopamiz —
keyin har bir qadam avtomatik himoyalanadi.

**Fayllar va aniq ish:**

1. `apps/web/src/app/(app)/sotuv/_components/vozvrat-mode.tsx`
   - `:245` va `:299` — `вЂє` (baytlar `D0 B2 D0 82 D1 94`) → `›` (U+203A)
   - `:291` — `В·` (baytlar `D0 92 C2 B7`) → `·` (U+00B7)
   - ⚠️ Faylni **UTF-8 (BOM'siz)** saqlash. Tuzatgandan keyin `od -c` bilan bayt tekshiruvi.
2. `apps/web/src/app/customer-display/page.tsx:379` — `'Kassa №1'` fallback'ini
   `t('cash_desk_fallback')` ga o'tkaz; kalitni uz+ru ga qo'sh.
3. `apps/web/src/app/customer-display/page.tsx:983` — `DEMO` nishoni **tarjima
   qilinmaydi**; `POS_ALLOWED` ga sabab bilan qo'shiladi (`?demo=1` — faqat ishlab chiqish).
4. **Reyestr birlashtirish.** Hozir ikkita ro'yxat bor:
   - `__tests__/i18n-no-hardcoded.test.ts` → `POS_DONE_FILES` (23 fayl)
   - `__tests__/pos-i18n-guard.test.ts` → `POS_FILES` (15 fayl)

   Ikkalasini qo'lda sinxron tutish — drift tuzog'i. **Avval `pos-i18n-guard.test.ts`
   ni to'liq o'qi**: agar u boshqa invariantni tekshirsa (kalit mavjudligi + hardcoded
   birga), ro'yxatni umumiy modulga chiqar:
   `apps/web/src/__tests__/_pos-i18n-registry.ts` → ikkala test import qiladi.
   Agar birlashtirish maqsadlarni buzsa — **birlashtirma, hisobotda sababini yoz.**
5. Reyestrga qo'sh: `app/(app)/sotuv/_components/vozvrat-mode.tsx`,
   `app/(app)/sotuv/_components/pos-types.ts` (tip fayli — skaner uni bo'sh ko'radi,
   lekin reyestr to'liqligi uchun), `app/customer-display/page.tsx`.
6. **Qochish-qulfini kengaytir.** Hozirgi qulf faqat `components/pos/` ni tekshiradi
   (`i18n-no-hardcoded.test.ts:461-472`). Uni **`app/(app)/sotuv/_components/`** va
   **`app/customer-display/`** ga ham yoy. *Aynan shu teshik `vozvrat-mode.tsx` ni
   mojibake bilan o'tkazib yuborgan.*
7. `app/customer-display/__tests__/customer-display.test.tsx` — hozir 14 kalitdan
   9 tasini tekshiradi; yetishmayotgan `tagline`, `som`, `in_queue` qo'shiladi.

**Darvozalar:** `pnpm --filter @moysklad/web typecheck` 0 · biome 0 ·
`pnpm --filter @moysklad/web test` — mavjud testlar yashil, yangi 3+ test.

**Tasdiqlash:** `git diff` da mojibake baytlari yo'qolganini `od -c` bilan ko'rsat.
Reyestrga qo'shilgandan keyin gate **yashil** bo'lishi shart — qizarsa, demak
yana hardcoded matn bor: uni **tuzat**, allow-list'ga yashirma.

**Qaytarish:** faqat test + 4 satr manba — `git revert` yetarli.

---

### FAZA 1 — Kioskda til almashtirgich

**Yangi fayl:** `apps/web/src/components/pos/pos-locale-toggle.tsx`

Talablar:
- Ikkita katta sensorli tugma: `O'zbekcha` | `Русский` (nomlar `locale.uz`/`locale.ru`
  dan, `i18n/config.ts:20-23` `nativeLabel` bilan mos).
- Joriy til `aria-pressed` + vizual holat bilan ko'rsatiladi.
- Bosilganda: `setLocale(next)` (mavjud server action, `app/actions/locale.ts`) →
  `router.refresh()`.
- 🔴 **Xato ishlovi MAJBURIY.** Mavjud `locale-switcher.tsx:22-27` da `catch` YO'Q —
  tarmoq uzilsa (kassa uchun real holat) `await setLocale` otiladi va hech kim
  ushlamaydi. Yangi komponentda: `try/catch` + `toast.error(t('locale_change_failed'))`
  + tugmalar avvalgi holatga qaytadi.
- `pending` paytida ikkala tugma `disabled` (ikki marta bosish yo'q).

**Ulash:** `_components/smena-mode.tsx` — «Kassirni almashtirish» (`:491`) yonidagi
sozlama blokiga.

**Yangi kalitlar** (uz + ru, ikkalasiga ham): `pages.pos.language`,
`pages.pos.locale_change_failed`. `locale.uz`/`locale.ru` allaqachon bor
(`locale.uz` RU bandlida ham `"O'zbekcha"` — bu **to'g'ri**, til nomi o'z tilida yoziladi).

**Reyestrga qo'sh:** yangi fayl `components/pos/` ichida ⇒ qochish-qulfi uni
avtomatik talab qiladi.

**🔴 MAJBURIY TEKSHIRUV — bu fazani yopishdan oldin:**

> **Savat omon qoladimi?** `sotuv/page.tsx:422` — `const [cart, setCart] = useState<CartLine[]>([])`.
> Bu oddiy React holati. To'liq reload uni **yo'qotadi**. `router.refresh()` esa
> hujjat bo'yicha holatni saqlaydi — **lekin bu tasdiqlanishi shart, ishonilmaydi.**

Test: `sotuv/__tests__/` da — savatga 2 qator qo'sh → tilni almashtir →
savat o'zgarmaganini tasdiqla.

- Test **yashil** ⇒ davom et.
- Test **qizil** ⇒ **TO'XTA, kod yozma, hisobot ber.** Zaxira dizayn (oldindan
  kelishilgan): tugma bosilganda savat bo'sh bo'lmasa — avval `parkCart()`
  (qoralamaga olish, `sotuv/page.tsx:900`, allaqachon localStorage'da saqlanadi),
  keyin almashtirish; kassirga toast bilan aytiladi.

**Darvozalar:** typecheck 0 · biome 0 · i18n key-existence uz+ru · POS no-hardcoded ·
web Vitest — mavjudlar yashil + yangi testlar.

---

### FAZA 2 — Mijoz-ekran tilga ergashadi

> ⚠️ **Faza 1 bilan BIR RELIZDA chiqadi.** Almashtirgich CFD ergashuvisiz
> chiqarilsa — kassir RU qo'yadi, mijoz ekrani UZ qoladi. Bu hozirgi holatdan
> **yomonroq**: nomuvofiqlik mijoz oldida ko'rinadi.

**Fayl:** `apps/web/src/app/customer-display/page.tsx` — yangi hook `useLocaleSync()`.

```
LOCALE_POLL_MS = 2000   // yangi konstanta, fayl boshidagi konstantalar yoniga

useLocaleSync():
  rendered = useLocale()
  har LOCALE_POLL_MS da:
    cookie = document.cookie dan NEXT_LOCALE
    agar !isLocale(cookie)      -> hech narsa (middleware buni deyarli imkonsiz qiladi)
    agar cookie === rendered    -> sessionStorage['cfd.localeReloadFor'] ni tozala; qaytish
    agar sessionStorage['cfd.localeReloadFor'] === cookie -> TO'XTA (sikl qo'riqchisi)
    aks holda -> sessionStorage['cfd.localeReloadFor'] = cookie; location.reload()
```

Qaror izohlari (kodda **yozilishi shart**, chunki bular sezgiga zid):
- Nega 2000 ms: kassir almashtirgandan keyin ekran ~2 s ichida yangilanadi —
  kassir uchun «darhol» tuyuladi. Mavjud `QUEUE_POLL_MS` (8 s) qayta ishlatilmaydi:
  u `tokenReady` ga bog'liq, til esa tokendan mustaqil bo'lishi kerak.
- Nega `isLocale` tekshiruvi: bo'sh/buzuq cookie render tiliga teng bo'lmaydi ⇒
  tekshiruvsiz **cheksiz reload** bo'lardi. Middleware buni deyarli imkonsiz
  qiladi, lekin mijoz turgan ekranda «deyarli» yetarli emas.
- Nega `sessionStorage` (localStorage emas): belgi shu oyna sessiyasiga tegishli;
  localStorage kassir oynasiga ham ko'rinardi va ma'nosiz umumiy holat yaratardi.

**Testlar (`app/customer-display/__tests__/`):**
1. render `uz` + cookie `ru` ⇒ `reload` **bir marta** chaqiriladi.
2. Keyingi tick ⇒ **boshqa chaqirilmaydi** (sikl qo'riqchisi).
3. render `uz` + cookie `uz` ⇒ hech qachon chaqirilmaydi.
4. cookie buzuq (`NEXT_LOCALE=xx`) ⇒ hech qachon chaqirilmaydi.
5. cookie `ru` → `uz` ga qaytsa ⇒ yana reload bo'ladi (belgi tozalangan).

**🔴 Real muhitda tasdiqlash (Phase-2, majburiy):**
- Ikki brauzer tabi: `/sotuv` + `/customer-display` — tilni almashtir, 2 s ichida
  ikkinchi tab yangilanishini KO'R.
- Iloji bo'lsa haqiqiy `.exe` (v1.9.0) + ikkinchi monitor — chunki cookie
  umumiyligi Electron sessiyasida tasdiqlanishi kerak. **Bu tasdiqlanmasa, faza
  «Phase-1: runtime-tasdiqlanmagan» deb belgilanadi va shunday deploy qilinadi.**
- Savat to'la holatda almashtir: reload'dan keyin savat qaytishini
  (`main.js` `did-finish-load` → `sendCart`) o'z ko'zing bilan ko'r.

---

### FAZA 3 — Sana/vaqt formati tilga bog'lanadi

**Yangi fayl:** `apps/web/src/lib/i18n-format.ts`

```
BCP47: Record<Locale, string> = { uz: 'uz-UZ', ru: 'ru-RU' }
useBcp47(): string   // useLocale() -> BCP47, noma'lum bo'lsa BCP47.uz
```

**Almashtiriladi:** §1.2-C dagi 14 joy.
**CFD'dagi `locale === 'ru' ? 'ru-RU' : 'uz-UZ'`** (`:494`, `:710`) ham shu
helper'ga o'tkaziladi — bir naqsh, ikki nusxa qolmasin.

**🔴 ALMASHTIRILMAYDI:** `formatMoney` (`packages/design-system/.../format.ts:40`)
va `pos-rate-chip.tsx:43`. Sabab — §2.5. Agent bularni «izchillik uchun» tuzatishga
urinsa — bu **regressiya**, pul ko'rinishi buziladi.

**Yangi qo'riqchi:** kassa doirasida qattiq BCP-47 teg (`'uz-UZ'`/`'ru-RU'`)
taqiqlanadi, ikkita hujjatlangan istisno bilan. Bu **yangi xato-sinfi qulfi** —
bugungi 14 joy tuzatilgandan keyin 15-chisi qo'shilmasin.

**Qabul:** RU rejimida cheklar ro'yxatidagi sana `01 сент. 2026 г.` ko'rinishida
(o'zbekcha `01-sen` emas). Chromium'da ham tekshiriladi, faqat Node'da emas.

---

### FAZA 4 — Qog'oz chek ikki tilli *(alohida reliz)*

**Bu faza fizik cheklovga bog'liq — quyidagini o'qimasdan boshlanmaydi.**

Chekning ikki chizuvchisi bor (`lib/print-agent.ts:696-697`):
```
const el = electron();
el ? el.printSheet('', buildReceiptHtml(sale), …)   // .exe — Windows drayveri
   : agentPrint('', { text: buildReceiptText(sale) }) // brauzer — xom ESC/POS
```
- **Electron yo'li** (kassalar aynan shunda ishlaydi) — Windows drayveri chizadi,
  **kirill ishlaydi** (`print-agent.ts:330-333` izohi).
- **ESC/POS xom yo'li** — codepage muzokara qilinmaydi, **kirill axlat chiqadi**
  (`:296-300`).

⇒ **Dizayn:** yorliqlar tilga bog'lanadi **faqat HTML yo'lida**; ESC/POS yo'li
majburan `uz` (lotin) qoladi va buning sababi kodda yoziladi.

**Naqsh — o'ylab topilmaydi, nusxa olinadi:** Z-hisobot bu masalani allaqachon
yechgan — `ZReceiptLabels` struct'i `use-z-receipt-labels.ts` da `t()` dan
yig'iladi va `printZReportViaAgent(labels)` ga uzatiladi. Chek ham aynan shunday.

**Ish:** `RECEIPT_LABELS` (22) + `RECEIPT_PAYMENT_LABELS` (8) + `DEBT_ROW_NAME` (1)
→ `ReceiptLabels` struct. **Tarjimalar allaqachon mavjud** — `ru.json → pages.print.chek_*`
to'liq to'ldirilgan; hozir shunchaki hech kim o'qimaydi.
`receipt-model.ts:287` — `amountInWords(total, 'UZS', 'uz')` → joriy lokal.
`amountInWords` `'ru'` ni qo'llab-quvvatlaydi (`packages/money/src/amount-in-words.ts:12` — `WordsLocale = 'ru' | 'uz'`).
`lib/pos/receipt-model.test.ts:57-88` drift-qulfi **ikkala bandlni** tekshiradigan qilib yangilanadi.

**Ochiq savol egasiga:** chek mijozniki. Kassir tili RU bo'lsa, **mijoz** ham
ruscha chek olishi kerakmi, yoki chek doim o'zbekcha qolsinmi (rasmiy hujjat)?
**Bu biznes qarori — kod yozilishidan oldin javob olinadi.**

---

### FAZA 5 — API xato xabarlari *(katta, alohida)*

~284 o'zbekcha satr, ~83 to'g'ridan-to'g'ri `throw`. POS ularni
`toast.error(e.message)` bilan **o'zgartirmasdan** ko'rsatadi (`api-client.ts:86`).

Ikki yo'l:
- (a) **Xato KODLARI** + klientda tarjima — POS uchun kritik yo'llarda bosqichma-bosqich.
- (b) `nestjs-i18n` + `Accept-Language` — butun API bo'ylab, ancha katta.

**Tavsiya: (a)**, faqat kassa yo'llarida (`retail-sale`, `cashier-session`,
`auth/pos-*`, `debt/pos`). Sabab: to'liq (b) 252 ta `throw` ni qamraydi va bu
alohida loyiha; (a) esa kassirga ko'rinadigan 100% ni ~30 ta xabar bilan qoplaydi.
**Bu relizga KIRMAYDI** — bu yerda faqat o'lchandi va chegaralandi.

---

### FAZA 6 — Electron qobiq matnlari *(yangi `.exe` talab qiladi — oxirgi)*

~49 satr: `main.js` 15 · `updater.js` 4 · `device-store.js` 5 · `logger.js` 2 ·
`check-build-assets.js` 2 · `setup.html` 4 · `offline.html` 12 · `updating.html` 4.

Eng ko'rinadigani — `offline.html` (tarmoq uzilganda kassir aynan shuni ko'radi)
va `main.js:664,667` («Server manzili sozlanmagan», «Ikkinchi ekran topilmadi»).

**Nega oxirgi:** yangi `.exe` qurish + har kassaga tarqatish + kanal tartibi
(exe oldin, `latest.yml` oxirida — `deploy/DEPLOY-sherset.md:133-143`). Faza 0–3
buni **umuman talab qilmaydi** — bu ularning eng katta afzalligi va shuning
uchun ular oldin chiqadi.

---

## 4. Agentlar uchun qoidalar

### 4.1 Model

🔴 Bu loyihada **«Opus bilan o'yla, Sonnet bilan yoz» AMAL QILMAYDI**
(`erp/CLAUDE.md` §0). Har bir subagent va Workflow agenti **Opus** — `Agent()`
chaqiruvida `model` **berilmaydi** (inherit). Mexanik ish uchun avval
**deterministik skript**, agent faqat hukm talab qiladigan joyda.

### 4.2 RUXSAT ETILADI

- Faqat **o'z fazasining** fayllariga yozish.
- Mavjud naqshni **file:line bilan ko'rsatib** takrorlash.
- Yangi test qo'shish; mavjud testni **kengaytirish**.
- Reja bilan kelishmaslik — **hisobot berib**, kod yozmasdan.
- O'z fazasining darvozalarini (typecheck/biome/o'z testlari) yugurtirish.

### 4.3 TAQIQLANADI

| Taqiq | Sabab |
|---|---|
| `formatMoney` / `pos-rate-chip.tsx:43` ni «izchillik uchun» tuzatish | §2.5 — pul ko'rinishi buziladi |
| ESC/POS yo'liga kirill yuborish | Printerdan axlat chiqadi |
| IPC payload'iga yangi maydon qo'shish | v1.9.0 qobiq tashlab yuboradi |
| Faza 0–3 da `desktop/` ga tegish | Yangi `.exe` majburiyatini keltirib chiqaradi |
| Yangi tarjima **o'ylab topish** | RU qiymat mavjud bandldan olinadi yoki egasiga so'rov |
| Hardcoded matnni `POS_ALLOWED` ga **yashirish** | Allow-list = qaror, jimgina o'tkazish emas |
| `git add -A` / `git add .` / `git commit -a` | Hook bloklaydi (`scripts/hook-git-add-guard.mjs`) |
| `git reset --hard` / `stash` / `clean -fd` / `checkout -- .` | Parallel sessiya ishini o'chiradi (`CLAUDE.md` §6.7A) |
| To'liq test-suite yugurtirish | Markazda, commit nuqtasida bir marta |
| «done» / «production-ready» / «verified» deyish | Faqat **«Phase-1 complete»** (`CLAUDE.md` §1) |
| Tasdiqlanmagan narsani fakt deb aytish | `CLAUDE.md` §2 |
| Faza chegarasidan chiqish (masalan ERP'dagi 200 ta `ru-RU`) | Diff path-cheklangan bo'lishi shart |

### 4.4 Har agent qaytarishi shart

1. O'zgargan fayllar — yo'l + `+N/−M`.
2. Test soni delta (avval N, hozir M).
3. Darvoza natijalari — **haqiqiy chiqish**, «o'tdi» degan da'vo emas.
4. **Nima ishlamadi va nega.**
5. Rejaga zid topilma bo'lsa — kodni emas, **hisobotni** qaytaradi.

### 4.5 Markaz (Opus) har qaytishda tekshiradi

`git status` → `git diff` → darvozalarni **mustaqil** yugurtirish. Da'voga
ishonilmaydi (`CLAUDE.md` §0 «Trust but verify»).

---

## 5. Xavflar reyestri

| # | Xavf | Ehtimol | Ta'sir | Qanday yopiladi |
|---|---|---|---|---|
| R1 | Til almashganda **savat yo'qoladi** | O'rta | 🔴 Yuqori | Faza 1 bloklovchi testi; qizil bo'lsa `parkCart` zaxirasi |
| R2 | CFD **cheksiz reload** — mijoz oldida | Past | 🔴 Yuqori | `sessionStorage` sikl qo'riqchisi + `isLocale` + middleware invarianti |
| R3 | Electron'da cookie umumiy **emas** chiqadi | Juda past | Yuqori | Jonlida isbotlangan (CFD tokeni shundan); baribir 2 oynali real tasdiq |
| R4 | `ru-RU` chek printerda axlat | O'rta | 🔴 Yuqori | Faza 4 — ESC/POS majburan lotin |
| R5 | Pul formati tilga qarab o'zgarib ketadi | O'rta | 🔴 Yuqori | §2.5 taqiq + qo'riqchi istisnolari hujjatlangan |
| R6 | Ikki reyestr drift qiladi | Yuqori | O'rta | Faza 0 — bitta modulga chiqarish + qochish-qulfi |
| R7 | Tarmoq uzilganda almashtirish yarim qoladi | O'rta | O'rta | `try/catch` + toast + holat qaytadi |
| R8 | ICU Chromium'da Node'dan farq qiladi | Past | O'rta | Faza 3 qabul mezoni — brauzerda tekshirish |
| R9 | Reload paytida navbat 1–2 s bo'sh | Yuqori | Past | Qabul qilinadi; hujjatlanadi |

---

## 6. Kelajakka kengaytirish (bugun 0 xarajat)

| Kelajakdagi ish | Bugungi qaror uni qanday osonlashtiradi |
|---|---|
| **Kassir bo'yicha til** | Cookie yagona ish vaqti manbai ⇒ PIN login'da cookie yoziladi, boshqa hech nima o'zgarmaydi |
| **Uchinchi til (en)** | `locales` massiviga qo'shiladi; `BCP47` xaritasiga 1 qator; almashtirgich `locales` dan chizadi ⇒ hardcode yo'q |
| **Mahsulot tavsifi ikki tilda** | Hozir `Product.description` bitta ustun (`schema.prisma:5432`). Sxemada naqsh bor: `MxikCode.nameUz/nameRu` (`:9165-9167`) ⇒ ergashiladi |
| **Chek tili mijozga bog'liq** | Faza 4 yorliqlarni struct qiladi ⇒ manba (kassir tili yoki mijoz kartasi) almashtirish — bir joyda |
| **ERP'dagi 200 ta `ru-RU`** | Faza 3 helper'i tayyor ⇒ mexanik codemod, yangi dizayn kerak emas |

---

## 7. Qabul mezonlari (reliz A = Faza 0–3)

- [ ] Kassir «Smena» ekranidan tilni UZ↔RU almashtira oladi.
- [ ] Almashtirishda **savat yo'qolmaydi** (test bilan qulflangan).
- [ ] Mijoz-ekran **2 soniya ichida** o'zi yangilanadi va savat qaytadi.
- [ ] Mijoz-ekran hech qanday holatda reload siklga tushmaydi (4 test).
- [ ] RU rejimida sanalar ruscha (`01 сент. 2026 г.`).
- [ ] Pul ko'rinishi **ikkala tilda AYNAN bir xil** (regressiya yo'q).
- [ ] Kassa doirasidagi 26 fayl **hammasi** qo'riqchi reyestrida.
- [ ] `vozvrat-mode.tsx` da mojibake yo'q (bayt tekshiruvi).
- [ ] typecheck 0 · biome 0 · i18n key-existence uz+ru · web Vitest yashil.
- [ ] **Yangi `.exe` KERAK EMAS** — v1.9.0 qobiqda ishlaydi.
- [ ] Holat halol belgilangan: brauzer-smoke bo'lsa «Phase-2 verified», bo'lmasa «Phase-1».

---

## 8. O'z-o'zini baholash

**Nima yaxshi ketdi.** Kod yozishdan oldin o'lchadim, va o'lchov vazifani
butunlay qayta ta'rifladi: «tarjima qilish» emas, «almashtirish + ergashtirish».
Agar men birinchi taassurot bilan boshlaganimda, 552 ta allaqachon tarjima
qilingan kalitni «qayta tarjima qilib» kunlarni yo'qotgan bo'lardim.

**Uchta qadam meni jiddiy xatodan saqladi:**
1. `formatMoney` ni tekshirish — u ataylab `ru-RU`. «Izchillik uchun» uni
   lokalga bog'lash pulning ko'rinishini buzardi. Reja endi buni **taqiqlaydi**.
2. ESC/POS codepage izohini o'qish — kirill chek **printerda axlat** bo'lardi.
3. `normalizeCart` oq ro'yxatini ko'rish — IPC yechimi «ishlaydi» deb yozilardi,
   lekin o'rnatilgan qobiqda **jimgina** ishlamasdi.

**Nimani boshqacha qilishim mumkin edi.** Boshida `desktop/main.js` ni
oxirigacha o'qidim, holbuki avval **savol ro'yxatini** tuzib, keyin o'qiganimda
tezroq bo'lardi. Ikkinchisi — chek va API bo'yicha subagentni **erta**
yubordim, lekin uni yuborishdan oldin ESC/POS savolini ham unga qo'shsam
bo'lardi; natijada o'sha tekshiruvni keyin o'zim qildim.

**Nimadan hamon xavotirdaman (halol).** R1 (savat) va R3 (Electron cookie) —
ikkalasi ham **hujjatga emas, real ishga** tayanadi. Men Next.js hujjatiga
tayanib «`router.refresh()` holatni saqlaydi» deb yozishim mumkin edi va
bu **konfabulyatsiya** bo'lardi. Shuning uchun reja ularni *tekshiruvsiz o'tib
bo'lmaydigan darvoza* qilib qo'ydi, taxmin qilib emas. Agar R1 testi qizarsa —
reja «to'xta va hisobot ber» deydi, «aylanib o't» demaydi.

**Eng katta qolgan noaniqlik:** haqiqiy `.exe` + ikkinchi monitor bilan sinov.
Usiz bu ish **«Phase-1: runtime-tasdiqlanmagan»** bo'lib qoladi va men uni
«tayyor» deb atamayman.
