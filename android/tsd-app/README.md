# Sherset TSD — omborchi qo'l terminali

> **Holat:** UI **0.2.0 — Jetpack Compose** (U-reja, 2026-09-01). Mantiq G5/G6
> dan aynan ko'chdi, server shartnomasi o'zgarmadi.
> **BUILD-VERIFIED** (2026-09-01): `assembleDebug` ogohlantirishsiz o'tdi,
> `app-debug.apk` ≈ 12,9 MB (Compose bilan 7,1 → 12,9 MB). Toolchain shu
> mashinada: JDK 17 va Android SDK `D:/dev` da (Gradle 8.7 alohida —
> repo'da wrapper yo'q).
> **Qurilma:** iData 95W Pro (Android 14, 4" 480×800, fizik klaviatura +
> apparat skaner) — **jonli smoke hali o'tkazilmagan** (qoida 11).
> Rejalar: [`docs/plans/2026-09-01-tsd-zamonaviy-ui.md`](../../docs/plans/2026-09-01-tsd-zamonaviy-ui.md) (UI),
> [`docs/plans/2026-08-23-omborchi-tsd-mijozlar.md`](../../docs/plans/2026-08-23-omborchi-tsd-mijozlar.md) (G5, G6 — mantiq).

## Nima qiladi (G5 doirasi)

1. **Juftlash** — admin `POST /auth/tsd-device/pair` bilan olgan `deviceId` +
   `deviceSecret` ni terminalga bir marta kiritadi. Kalit **shifrlangan** holda
   yotadi (`DeviceStore.kt` — EncryptedSharedPreferences).
2. **PIN kirish** — `POST /auth/tsd-login` (qurilma kaliti **majburiy** + 4
   raqamli PIN). Sessiya `deviceMode: 'tsd'` bilan muhrlanadi.
3. **Topshiriqlar ro'yxati** — `GET /restock-tasks?assigneeId=…&assigneeOpen=1`.
4. **Skan** — `GET /tsd/scan` (**narxsiz**), yacheyka kodi uchun
   `GET /admin/stores/cells/by-barcode`. Multi-hit tanlovi majburiy.
5. **Oflayn amal navbati** — `ActionQueue.kt` (FIFO, `clientOpId` bilan).

## Ish ekranlari (G6 mantig'i, 0.2.0 dizayni)

Har ekran alohida faylda va `Shell` interfeysi orqali ishlaydi — `Activity` ni
KO'RMAYDI (`Shell.kt`). Skan avval JORIY ekranga beriladi (u bosqichga qarab
talqin qiladi), ekran uni yemasa umumiy narxsiz skan-ma'lumot ochiladi.

| Ekran | Fayl | Nima qiladi |
|---|---|---|
| **Bosh menyu** | `HomeScreen.kt` | 4 plitka: Topshiriqlar · Joylashtirish · Sanash · Navbat (egasining tanlovi, 2026-09-01) |
| Topshiriqlar | `TaskListScreen.kt` | `picking` + `restock` bitta navbatda; kartada progress-chiziq va ⚠ yetishmovchilik soni |
| Topshiriq detali | `TaskDetailScreen.kt` | Qatorlar **yacheyka marshruti** tartibida (saralashni SERVER qiladi); qo'lda tasdiq, skan bilan tasdiq |
| Yetishmovchilik | `ShortageScreen.kt` | «Javonda shuncha topolmadim» — MUTLAQ son; chek tarkibi O'ZGARMAYDI |
| Joylashtirish | `PlaceScreen.kt` | tovar → manba (yacheyka **yoki** yacheykasiz qoldiq) → maqsad yacheyka → miqdor |
| Sanash | `CountScreen.kt` | Yacheyka yorlig'i → tarkib → mutlaq sanoq (`mode: 'set'`) |
| Skan ma'lumoti | `ScanInfoScreen.kt` | Nom, jami qoldiq, yacheykalar — **narxsiz** |
| Multi-hit tanlovi | `PickProductScreen.kt` | Shtrix bir nechta tovarga tegishli bo'lsa TANLOVNI ODAM qiladi |
| **Navbat** | `QueueScreen.kt` | Kutayotgan amallar soni + **RAD ETILGANLAR** ro'yxati (sabab bilan) |

**Navbatni bo'shatish** — `QueueSender.kt`: qat'iy ketma-ket, tarmoq/5xx da
navbat JOYIDA qoladi, 4xx da amal navbatdan chiqadi va **sabab bilan** ekranda
ko'rinadi (jim yo'qotish yo'q). Ilova ochilganda navbat o'z-o'zidan yuboriladi.

🔴 **«Tayyor» tugmasi ATAYLAB YO'Q.** Hamma qator yopilgach topshiriq
o'z-o'zidan `done` bo'ladi va chek KONTROL navbatiga tushadi (G2) — TSD chekni
`mark-ready` bilan flip QILMAYDI. Ekran «kontrolga ketdi» deb aytadi.

## Backend kontrakti

| Endpoint | Metod | Izoh |
|---|---|---|
| `/auth/tsd-device/pair` | POST | Admin (JWT + `employee.update`). Kalit FAQAT shu javobda. |
| `/auth/tsd-devices` | GET | **0.2.0** — terminallar ro'yxati (nom, ombor, oxirgi ko'rinish, APK versiyasi, qulf/bekor holati). Kalit/xesh QAYTMAYDI. |
| `/auth/tsd-device/:id/revoke` | POST | **0.2.0** — yo'qolgan terminalni bekor qilish (idempotent; ochiq sessiya keyingi refresh'da o'ladi) |
| `/auth/tsd-login` | POST | `{deviceId, deviceSecret, pin, appVersion?}` → `{accessToken, refreshToken, user, device}` |
| `/auth/refresh` | POST | Sessiya uzaytirish; terminal bekor qilingan bo'lsa 401 |
| `/restock-tasks` | GET | «Mening topshiriqlarim» |
| `/restock-tasks/:id/lines/:lineId/confirm` | POST | Qatorni qo'lda tasdiqlash |
| `/restock-tasks/:id/confirm-scan` | POST | Skaner bilan tasdiqlash |
| `/restock-tasks/:id/lines/:lineId/shortage` | POST | **G6** — «topolmadim» (mutlaq miqdor; `0` = belgini olib tashlash) |
| `/tsd/scan?code=` | GET | **Narxsiz** tovar qidiruvi — AYNAN moslik (multi-hit) |
| `/tsd/search?q=` | GET | **T3** — **narxsiz** nom/artikul qidiruvi (`contains`, min 2 belgi, eng ko'pi 30 ta). Javob: `{query, products, truncated}`; `products` elementi `/tsd/scan` bilan **AYNI shaklda** (serverda ikkalasi ham `buildProductHits` dan chiqadi) |
| `/admin/stores/cells/by-barcode?code=` | GET | Yacheyka yorlig'i |
| `/products/:id/cell-move` · `/cell-place` | POST | Ko'chirish / joylashtirish |
| `/admin/stores/:id/cells/:cellId/stock` | GET·PUT | Yacheyka sanash |
| `/notifications` | GET | Yangi topshiriq signali (polling) |

🔴 **Bu ro'yxatdan tashqarisi serverda 403.** Cheklov `apps/api/src/modules/auth/tsd-policy.ts`
da (default-deny) va uni `TsdGuard` global bajaradi. Ilovaga yangi endpoint
kerak bo'lsa **avval o'sha ro'yxatga** qo'shiladi — va savol beriladi: «bu
javobda narx bormi?»

## Nega narx yo'q

Egasining qoidasi: *«Ombor xodimlari narx ko'rmaydi; kirim narxi faqat katta
omborchiga»*. `GET /products` to'liq tovar qatorini (`buyPrice`, `minPrice`,
`salePrices`) qaytaradi, shuning uchun u TSD ro'yxatida **umuman yo'q** —
o'rniga `GET /tsd/scan` bor va uning ustunlari `tsd-scan.ts` da **oq ro'yxat**
bilan sanab chiqilgan. Ekranda ko'rsatmaslik himoya emas: token haqiqiy.

**T3 (2026-09-03) shu qoidani QAYTA sinadi.** Omborchiga nom bo'yicha qidiruv
kerak bo'ldi va eng oson yechim `/products?search=` ni allowlist'ga qo'shish
bo'lardi — u kirim narxini terminalga ochib yuborardi. Shuning uchun ikkinchi
**narxsiz** sirt qilindi: `GET /tsd/search`. U `/tsd/scan` bilan **ayni**
`TSD_PRODUCT_SELECT` oq ro'yxati va **ayni** hit-quruvchi
(`TsdService.buildProductHits`) ustida ishlaydi, ya'ni unga narx maydonini
qo'shib yuborish tuzilmaviy jihatdan mumkin emas. `/products` hamon YOPIQ va
buni `tsd-policy.test.ts` alohida test bilan qulflaydi.

## Skaner (iData 95W Pro)

Ikki rejim BIRGA yashaydi — ikkalasi ham yoqilgan bo'lishi zarar qilmaydi:

- **klaviatura-wedge** (`ScanBar.kt`) — sukut. Skaner kodni ekrandagi maydonga
  «yozadi» va Enter yuboradi. Terminalning skan sozlamalarida chiqish
  **klaviatura** va **suffiks = Enter** bo'lsa ilova hech qanday sozlashsiz
  ishlaydi. Sharti: maydon FOKUSDA bo'lishi — shuning uchun skan maydoni har
  doim tepada va ekran almashganda fokus unga qaytariladi.
- **broadcast** (`ScannerBridge.kt`) — `res/values/config.xml` dagi
  `scanner_broadcast_action`/`_extra` bilan, **kod o'zgarmaydi**.
  ⚠️ Hozir iData'ning odatiy `android.intent.action.SCANRESULT` / `value`
  yozilgan — **qurilmada tekshirilishi kerak** (skan sozlamalari ilovasida
  ko'rsatiladi). Nomi noto'g'ri bo'lsa zarari yo'q: qabul qiluvchi jim turadi
  va wedge rejimi ishlayveradi.

**Farqi:** wedge fokusga bog'liq (dialog ochilsa yoki fokus ketsa skan
yo'qoladi), broadcast esa fokusdan mustaqil — shuning uchun maqsad broadcast,
wedge esa zaxira.

### Qo'lda kiritish va manba ajratish (T2)

Skan maydoniga kod **qo'lda** ham yoziladi (yorliq yirtilgan, skaner o'qimadi).
Buning yo'lida ikkita bir-biriga zid talab bor va `ScanBar.kt` ularni belgilar
orasidagi **o'rtacha intervalni** o'lchab ajratadi:

| O'rtacha interval | Manba | Xulq |
|---|---|---|
| `< scan_human_gap_ms` (50 ms) | **skaner** | 350 ms jimlikdan keyin kod **o'zi** yuboriladi — suffikssiz skaner zaxirasi (U5), **o'chirilmagan** |
| `≥ scan_human_gap_ms` | **odam** | avto-yuborish o'chadi; maydonning o'ng tomonida **⏎** tugmasi chiqadi, kod faqat ⏎ / Enter bilan yuboriladi |

- Chegara — `res/values/config.xml` dagi **`scan_human_gap_ms`** (kod emas,
  resurs: qurilma almashsa faqat shu raqam o'zgaradi).
- O'lchov `onValueChange` da olinadi, `onPreviewKeyEvent` da EMAS: **ekran
  klaviaturasi bitta ham `KeyEvent` yubormaydi**, ya'ni tugma hodisalariga
  qarab o'lchansa omborchi «skaner» deb tanilardi.
- Qaror **o'rtacha** bo'yicha (eng katta interval bo'yicha emas) — skan
  o'rtasidagi bitta GC pauzasi skanerni «odam» ga aylantirib qo'ymasin.
- Backspace bosilsa manba darhol **odam** bo'ladi (skaner tahrir qilmaydi).
- Sozlash: **Diagnostika** ekranidagi «Oxirgi kiritish» qatori oxirgi kodning
  manbasini va **o'lchangan o'rtacha intervalini** ko'rsatadi. Skaner «ODAM»
  deb tanilsa — chegarani o'sha raqamdan yuqori qiling. Broadcast rejimi bu
  shoxdan **mustaqil**: `ScannerBridge` fokusdan ham, tezlikdan ham qat'i
  nazar ishlayveradi.

## Skan javobi — ovoz, tebranish, banner (T4)

Omborchi javon oldida turadi va ekranga qaramaydi. T4 gacha amal o'tgan-o'tmagani
FAQAT toast bilan aytilardi, ya'ni 4" ekranda u ko'pincha umuman ko'rilmasdi.
Endi har javobning **uchta darajasi** bor:

| Daraja | Nima ko'rinadi | Nima eshitiladi | Qachon |
|---|---|---|---|
| **muvaffaqiyat** (`Shell.success`) | toast (qisqa) | qisqa **yuqori** ton + 1 tebranish | sanoq saqlandi, qator tasdiqlandi, kesim yozildi, navbat bo'shadi |
| **xato** (`Shell.error`) | **QIZIL BANNER** ekran tepasida | **past** ton + 2 tebranish | «Topilmadi», 4xx/5xx, «avval yacheykani skanerlang», yacheyka topilmadi/ikkilamchi, navbat to'ldi, aloqa yo'q, rad etilganlar bor |
| **betaraf** (`Shell.toast`) | toast | — | «Qidirilmoqda…», «eng so'nggi versiya» |

Matnsiz javob ham bor: skan TANILDI/TANILMADI ni ekranlar to'g'ridan-to'g'ri
`Feedback.ok()` / `Feedback.fail()` bilan aytadi (yacheyka ochildi, tovar
tanildi, bo'lak yorlig'i topildi) — bu yerda ovoz xabarning O'RNIGA emas,
natijaning O'ZI ekranda ko'rinadi.

- **Banner** (`Widgets.ErrorBanner`) — 6 soniya turadi (`MainActivity.ERROR_BANNER_MS`),
  bosilsa darhol yopiladi; ish ekranlarida u **skan maydonining ostida** chiziladi
  (maydon qimirlamasin), juftlash/PIN ekranlarida esa ustiga qoplanadi.
- **Ovoz** (`Feedback.kt`) — `ToneGenerator`, oqim **`STREAM_NOTIFICATION`**
  (media EMAS: media oqimi terminalda odatda past turadi). Butunlay o'chirish
  kerak bo'lsa — `config.xml` dagi **`feedback_sound`** bayrog'i; tebranish
  o'z holicha ishlayveradi.
- **Tebranish** — manifestdagi yagona yangi ruxsat **`VIBRATE`** («normal»
  darajada, o'rnatishda beriladi, omborchidan hech nima so'ralmaydi).
  Kamera/lokatsiya/mikrofon ruxsati **hamon YO'Q**.
- **Ekran o'chmaydi** — `MainActivity` da `FLAG_KEEP_SCREEN_ON` (doimiy,
  sozlamada emas): sanash o'rtasida ekran so'nsa sessiya yopilib PIN qayta
  so'ralardi. Ilova fonga ketganda bayroq o'z-o'zidan kuchdan qoladi.

## Miqdor kiritish — kalkulyator (T5)

Omborchi «12 quti × 24 dona» ni boshida hisoblamaydi: miqdor maydoniga
`12*24` yozadi, maydon ostida **«= 288»** ko'radi va serverga **288** ketadi
(ifoda MATNI hech qachon yuborilmaydi — `CountScreen.save`, `PlaceScreen.submit`,
`CutScreen.send` uchalasi ham `QtyExpression.qty()` dan o'tadi).

| Yozildi | Natija | Izoh |
|---|---|---|
| `12*24`, `12×24`, `12 * 24`, `12x24` | `288` | `*` tugmasi Decimal klaviaturada YO'Q — shuning uchun maydon ostida `+ − × ( )` tugmalari bor |
| `3*24+6` | `78` | ko'paytirish qo'shishdan ustun |
| `(2+3)*4` | `20` | qavslar ishlaydi |
| `14,5` va `14.5` | `14.5` | vergul ham, nuqta ham (kabel/shlang metrlari) |
| `12.000000` | `12` | serverdan kelgan sukut qiymati qisqaradi |
| `12*` | ✘ «Ifoda tugallanmagan» | **Saqlash tugmasi o'chadi** |
| `12 24` | ✘ xato | probel token ajratadi — jimgina `1224` BO'LMAYDI |
| `10-25`, `-5` | ✘ «Natija manfiy» | |
| `12/2` | ✘ «Bo'lish qo'llab-quvvatlanmaydi» | 🔴 ATAYLAB: bo'lish yaxlitlash siyosatini ochib yuborardi |
| `0.0000001` | ✘ «Kasr qismi 6 xonadan uzun» | server regexi: `^\d+(\.\d{1,6})?$` |

Mantiq `QtyExpression.kt` da (SOF modul — Android/Compose/`R` ko'rinmaydi), shuning
uchun uni oddiy JVM testi qamrab oladi:

```sh
cd android/tsd-app && JAVA_HOME=D:/dev/java/jdk-17 ANDROID_HOME=D:/dev/android-sdk \
  /d/dev/_downloads/g87/gradle-8.7/bin/gradle --no-daemon testDebugUnitTest
```

Ifoda rejimi **Sanash**, **Joylashtirish** va **Kesish** maydonlarida yoqilgan
(`NumberField(expression = true)`); «Topolmadim» (`ShortageScreen`) da hozircha
YO'Q — T-rejaning T5 vazifasi uni sanamagan.

## «Oxirgi sanoq» qaytarish (T7)

Sanash ekranida son SAQLANGACH, sarlavha-karta ostida **12 soniya** turadigan
chiziq chiqadi: «<nom> — avval **14** edi, siz **41** qildingiz · ⟲ Qaytarish».

🔴 **Qaytarish — BEKOR QILISH EMAS.** Serverda hujjatni o'chiradigan sirt yo'q;
tugma oddiy `PUT …/stock` ni `mode: 'set'` va **eski qiymat** bilan yuboradi.
Ya'ni **MUTLAQ SON** semantikasi o'zgarmaydi va ERP'da **ikkinchi hujjat**
paydo bo'ladi (avval KIRIM, keyin CHIQIM). Chiziqdagi izoh buni ochiq aytadi —
omborchi «bekor bo'ldi» deb o'ylab qolsa, hujjatlarni ko'rgan buxgalter bilan
qarama-qarshilikka tushardi.

| Holat | Chiziq | Qaytarish nishoni |
|---|---|---|
| `14` → `41` | «avval 14 edi, siz 41 qildingiz» | `14` (sariq izoh) |
| yacheykada YO'Q tovar → `5` | «avval bu yacheykada YO'Q edi» | `0` — **qizil** izoh: CHIQIM (Списание) yoziladi |
| qoldig'i `0` qator → `41` | «avval 0 edi» | `0` — **qizil** izoh |
| `14` → `14` (sukut qiymat) | **chiziq YO'Q** | serverda delta 0, hujjat yozilmagan |
| `12.000000` → `41` | «avval 12 edi» | `12` (ortiqcha nollar kesiladi) |

Chiziq yo'qoladigan holatlar: 12 soniya o'tdi · qaytarildi · yacheyka almashdi ·
**ekran almashdi** (qidiruvga o'tib qaytilsa ham) · «Qolganini 0 qilib yopish»
ishga tushdi. Qaytarish, sanashning o'zi kabi, **oflayn navbatga qo'yilmaydi**:
aloqa yo'q bo'lsa chiziq o'z joyida qoladi va omborchi qayta urinadi.

Qaror `CountUndo.kt` da — yana SOF modul, `CountUndoTest.kt` bilan qulflangan
(eng muhimi: yuboriladigan nishon serverning `^\d+(\.\d{1,6})?$` qoidasidan
o'tadi).

## Yangilanish (qurilmadan) — 0.3.0

Terminal Play Store'da emas, shuning uchun ilova o'zi yangilanadi
(`Updater.kt` + `UpdateCard.kt`):

1. Ilova har ochilganda `GET /downloads/tsd/latest.json` ni o'qiydi (**API
   emas**, nginx statikasi — tokensiz, juftlashdan oldin ham ishlaydi).
2. `versionCode` o'rnatilganidan katta bo'lsa bosh ekranda karta chiqadi.
3. «Yuklab olish» → APK keshga tushadi va **SHA-256 tekshiriladi** (mos
   kelmasa o'rnatilmaydi: ombor Wi-Fi'sida yarim yuklangan fayl «buzilgan
   paket» xatosini berardi).
4. «O'rnatish» → tizim o'rnatuvchisi ochiladi. Android 8+ da ilovaga «noma'lum
   manbalardan o'rnatish» huquqi kerak — yo'q bo'lsa ilova aynan o'sha sozlama
   ekranini ochadi (jim yiqilish emas).

Yangilanish **avtomatik emas**: ikkala tugmani ham omborchi bosadi, chunki
o'rnatish ilovani qayta ishga tushiradi va yarim bajarilgan yig'ish/sanash
uzilardi. Bosh ekranning pastida o'rnatilgan versiya ko'rinib turadi va
o'sha yerdan qo'lda tekshirish ham mumkin.

**Yangi versiya chiqarish:**

```sh
# 1) app/build.gradle.kts — versionCode +1 VA versionName oshiriladi
# 2) bitta buyruq: release build → imzo izi tekshiruvi → APK → latest.json → tekshiruv
bash android/tsd-app/tools/publish.sh "nima o'zgardi"
```

🔴 **IMZO — eng muhim shart.** Yangilanish faqat **ayni kalit** bilan
imzolangan APK ustiga tushadi. **0.6.0 dan boshlab release-kalit** ishlatiladi
(`~/.sherset/sherset-tsd-release.jks`, alias `sherset-tsd`, sertifikat
`7bd90f53…`, **2056** gacha). Parol repoda YO'Q — Gradle uni
`~/.sherset/sherset-tsd-release.properties` dan o'qiydi; kalit topilmasa
`assembleRelease` aniq xabar bilan yiqiladi (`assembleDebug` ishlayveradi).
Tartib, zaxira va tiklash: **`docs/ops/tsd-release-imzo.md`**.

Kalit yo'qolsa har terminalda ilovani o'chirib qayta o'rnatish kerak bo'ladi —
va **juftlash yo'qoladi** (qurilma qayta juftlanadi). Shuning uchun kalit
**ikkita joyda zaxiralanadi** (ops hujjati §3).

### 🔴 Debug → release o'tishi (bir martalik, 0.5.0 → 0.6.0)

0.5.0 gacha APK **debug-kalit** bilan imzolangan edi (`b8ae71fd…`). Ikki kalit
har xil ⇒ **release APK eski ilova ustiga TUSHMAYDI**: terminal APK'ni yuklab
oladi-yu, o'rnatishda «App not installed» deydi. Bu kutilgan xulq, nosozlik
emas.

Shuning uchun o'tish **qo'lda** qilinadi: eski juftlash ma'lumotini tayyorlab →
navbat bo'shligini tekshirib → brauzerdan APK'ni yuklab → eski ilovani
**o'chirib** → yangisini o'rnatib → **qayta juftlab**. Band-band yo'riqnoma:
`docs/ops/tsd-release-imzo.md` §5. Terminal hozircha bitta — shuning uchun
o'tish AYNI PAYTDA arzon.

## Build

**2026-09-01 da shu mashinada BAJARILDI va o'tdi** (`BUILD SUCCESSFUL`,
ogohlantirishsiz, `app-debug.apk` ≈ 12,9 MB — Compose bilan 7,1 MB dan o'sdi).

1. **JDK 17** va **Android SDK** (platform `android-34`). Shu mashinada ular
   `D:/dev/java/jdk-17` va `D:/dev/android-sdk` da.
2. **Gradle 8.7** — AGP 8.5.0 shuni kutadi. Repo'da wrapper binarlari YO'Q
   (`driver-app` bilan bir xil qaror), shuning uchun gradle alohida yuklab
   olinadi yoki `gradle wrapper --gradle-version 8.7` bilan yaratiladi.
   ⚠️ Shu mashinadagi Gradle 9.1 (`D:/dev/gradle`) AGP 8.5.0 bilan MOS EMAS.
3. `local.properties` ga `sdk.dir=…` (gitignore'da); kerak bo'lsa
   `app/src/main/res/values/config.xml` dagi `api_base_url` ni o'zgartiring.
4. Buyruq:

   ```sh
   JAVA_HOME=D:/dev/java/jdk-17 ANDROID_HOME=D:/dev/android-sdk \
     <gradle-8.7>/bin/gradle --no-daemon assembleDebug
   ```

   → `app/build/outputs/apk/debug/app-debug.apk`.
5. **Release** (tarqatiladigan APK) — `assembleRelease`, release-kalit talab
   qilinadi (yuqoridagi «IMZO» bandi):

   ```sh
   JAVA_HOME=D:/dev/java/jdk-17 ANDROID_HOME=D:/dev/android-sdk \
     <gradle-8.7>/bin/gradle --no-daemon assembleRelease
   ```

   → `app/build/outputs/apk/release/app-release.apk`.
   **2026-09-04 da shu mashinada o'tdi:** `BUILD SUCCESSFUL`, ogohlantirishsiz,
   0.6.0 (code 6), APK ≈ **10,1 MB** (debug 13,0 MB), `apksigner verify` →
   «v2 scheme: true», iz `7bd90f53…`.
6. Terminalda «Noma'lum manbalar» ni yoqib APK'ni o'rnating.

## Qo'lda smoke (G5 qabul mezoni)

1. Admin (ERP, `employee.update` ruxsati bilan):
   `POST /api/v1/auth/tsd-device/pair` `{"name":"TSD-1","storeId":"<ombor UUID>"}`
   → javobdagi `deviceId` va `deviceSecret` ni yozib oling.
2. Ilovani oching → **Terminalni ulash** → ikkalasini kiriting → **Saqlash**.
3. Omborchi PIN'ini kiriting → **Kirish**. Topshiriqlar ro'yxati ochilishi kerak.
4. **Narx tekshiruvi:** o'sha `accessToken` bilan
   `GET /api/v1/products?search=kabel` → **403** bo'lishi SHART.
   `GET /api/v1/tsd/scan?code=<shtrix>` → 200 va javobda narx yo'q.
5. **Refresh tekshiruvi:** 15 daqiqadan keyin (yoki `/auth/refresh` ni qo'lda
   chaqirib) yangi token bilan yana `GET /api/v1/products` → **yana 403**
   (cheklov refresh'dan omon qolgani).
6. **Bekor qilish tekshiruvi:** bazada `tsd_devices.revoked_at` ni qo'ying →
   keyingi `/auth/refresh` **401** berishi kerak.
7. **Oflayn:** Wi-Fi ni o'chiring, amal qiling — «Navbatda: N ta amal»
   ko'rinsin; Wi-Fi qaytgach ilovani qayta oching → navbat o'z-o'zidan
   yuborilsin («Yuborildi: N, rad etildi: 0»).

## Qo'lda smoke (G6 qabul mezoni — TERMINAL kelgach)

Javobgar: __________ · Sana/vaqt: __________ · APK versiyasi: __________

1. **Yig'ish zanjiri (G2 bilan uchma-uch):** kassir 2 skladli chek ochib
   yig'ishga yuboradi → TSD'da topshiriq chiqadi → qatorlar **yacheyka
   tartibida** ekanini ko'zdan kechiring → har qatorni skan yoki tugma bilan
   tasdiqlang → oxirgi qatordan keyin ekranda «chek KONTROLGA tushdi» chiqsin
   va chek `/omborchi/kontrol` navbatida ko'rinsin.
2. **Yetishmovchilik:** bitta qatorda «Topolmadim» → miqdor → saqlang.
   Topshiriq YOPILSIN, chek kontrolga TUSHSIN va kontrol kartasida sariq
   «Omborchi topolmadi» bloki miqdori bilan ko'rinsin.
   So'ng kontrolda o'sha qatorni kamaytiring — kassirda summa o'zgarsin.
3. **Takror himoyasi:** o'sha «Topolmadim» ni AYNI qiymat bilan yana yuboring —
   hech narsa o'zgarmasin (400 ham bo'lmasin).
4. **Joylashtirish:** tovar shtrixini skanerlang → «Yacheykasiz qoldiq» →
   maqsad yacheyka yorlig'ini skanerlang → miqdor → **Ko'chirish**.
   Qoldiq hisobotida o'sha yacheykada ko'rinsin.
5. **Ko'chirish (yacheyka → yacheyka):** o'sha tovarni boshqa yacheykaga
   ko'chiring; ombor JAMI qoldig'i O'ZGARMASIN.
6. **Omborlararo qulf:** kichik omborchi bilan boshqa OMBOR yacheykasiga
   ko'chirishga urinib ko'ring → **403** («store.update kerak»).
7. **Sanash:** yacheyka yorlig'ini skanerlang → tarkib chiqsin → bitta tovarga
   yangi son kiriting → saqlang → `/cell` ekranida o'sha son ko'rinsin.
8. **Biriktirilgan tovarlar (T1):** qoldig'i YO'Q, lekin tovar kartasida
   «Yacheyka»/«Polka» shu yacheykaga qo'yilgan tovar tayyorlang → o'sha
   yacheyka yorlig'ini Sanash ekranida skanerlang → «Yacheyka bo'sh»
   O'RNIGA kulrang «biriktirilgan · qoldiq 0» qatori chiqsin; sarlavhada
   «Qoldiqda 0 · biriktirilgan 1» ko'rinsin → qatorni bosing → yuqorida
   sariq «yacheykada yo'q — KIRIM bo'lib yoziladi» kartasi ochilsin →
   son kiriting → saqlang → qator endi qoldiq guruhida ko'rinsin.
9. **Qo'lda kiritish (T2):** Sanash ekranida yacheyka kodini (`02-01-01-04`)
   klaviaturadan **sekin** yozing → 3-belgidan keyin HECH NIMA yuborilmasin,
   o'ng tomonda **⏎** chiqsin → ⏎ ni bosing → yacheyka TO'LIQ kod bo'yicha
   ochilsin. So'ng o'sha yacheyka yorlig'ini **skanerlang** (suffiks Enter
   YO'Q rejimida ham) → kod avvalgidek o'zi yuborilsin. Diagnostika ekranida
   ikkala urinish ham «ODAM …» / «SKANER …» bo'lib ko'rinsin; skaner «ODAM»
   deb tanilsa `config.xml` dagi `scan_human_gap_ms` ni ko'rsatilgan
   o'rtachadan yuqori qo'ying.
10. **Nom bo'yicha qidiruv (T3):** bosh menyudagi **🔍 Tovar qidirish**
    plitkasini oching → tovar nomining bir bo'lagini yozing (kamida 2 belgi) →
    **Qidirish** → ro'yxat chiqsin, har qatorda nom, artikul, qayerdaligi va
    jami qoldiq ko'rinsin, **narx YO'Q** bo'lsin → qatorni bosing → narxsiz
    «Skan ma'lumoti» ekrani ochilsin.
    So'ng **Sanash** da yacheyka ochib «🔍 Tovar qidirish» → topilgan tovar
    yuqoridagi sanoq kartasiga tushsin; **Joylashtirish** ning 1-bosqichida ham
    «🔍 Tovar qidirish» → tovar tanlangach oqim 2-bosqichga o'tsin.
    ⚠️ Maydon **o'zi yubormaydi** (T2 qoidasi) — «Qidirish» tugmasi yoki
    klaviaturaning tasdiq tugmasi bosilishi kerak.
11. **Skan javobi (T4):** terminal ovozini o'rtacha darajaga qo'ying va
    **ekranga qaramasdan** ishlab ko'ring.
    - Yacheyka yorlig'ini skanerlang → **qisqa yuqori** signal + bitta turtki;
      noma'lum kodni skanerlang → **past** signal + ikkita turtki va ekran
      tepasida **qizil banner** («Yacheyka topilmadi») chiqsin.
    - Bannerni **bosing** → darhol yopilsin; boshqasini tegmasdan qoldiring →
      ~6 soniyada o'zi ketsin. Banner turganda yuqori paneldagi «orqaga» va
      «chiqish» tugmalari **bosilishi** kerak (banner ularni to'smaydi).
    - Sanoqni saqlang → yuqori signal + «Saqlandi» toasti.
    - Wi-Fi'ni o'chiring va sanoqni saqlang → past signal + **banner**
      («aloqa yo'q»), son maydonda TURSIN.
    - Terminalni **5 daqiqa tegmasdan** qoldiring → ekran **o'chmasin** va PIN
      qayta so'ralmasin.
    - `config.xml` da `feedback_sound` ni `false` qilib qayta yig'ing →
      ovoz yo'qolsin, **tebranish qolsin**.
    - Sozlamalar → Ilovalar → Sherset TSD → Ruxsatlar: ro'yxatda **kamera,
      lokatsiya, mikrofon YO'Q**.
12. **Miqdor kalkulyatori (T5):** Sanashda yacheyka ochib tovarni tanlang.
    - Miqdor maydoni ostida **`+ − × ( )`** tugmalari ko'rinsin. `12` yozing →
      **×** → `24` → maydon ostida **«= 288»** chiqsin → **Saqlang** →
      qayta o'qilgan tarkibda **288** tursin, `12*24` MATNI emas.
    - `12` yozib **×** ni bosing va shu holda qoldiring → «Ifoda tugallanmagan»
      chiqsin va **Saqlash tugmasi o'chsin** (bosib bo'lmasin).
    - `14,5` yozing (vergul) → «= 14.5» chiqsin va saqlangach **14.5** tursin.
    - `10` → **−** → `25` → «Natija manfiy» chiqsin, tugma o'chiq bo'lsin.
    - `12 24` (orasida probel) yozing → **XATO** bo'lsin; `1224` bo'lib
      ketmasligi SHART.
    - Imkoni bo'lsa fizik klaviaturada `12/2` yozing → «Bo'lish
      qo'llab-quvvatlanmaydi» chiqsin. Bo'lish tugmasi **YO'Q** — shunday
      bo'lishi kerak.
    - O'sha tekshiruvni **Joylashtirish** miqdorida va **✂ Kesish**
      uzunligida takrorlang.
13. **Sanash progressi va «0 qilib yopish» (T6):** kamida **3 ta** qatori bor
    yacheykani Sanashda oching.
    - Sarlavha-kartada **«0/3 sanaldi»** chiqsin; har qator oldida kulrang
      **○** bo'lsin.
    - Bitta qatorga son kiritib **Saqlang** → o'sha qator **✓ yashil** bo'lsin,
      chegarasi yashil rangga o'tsin, sarlavhada **«1/3 sanaldi»** tursin.
    - Pastda **«Qolganini 0 qilib yopish (2)»** tugmasi ko'rinsin → bosing →
      QIZIL tasdiq kartasi ochilsin. Kartada: 🔴 **avtomatik CHIQIM
      (Списание)** ogohlantirishi va **ikkala** qator nomi hozirgi qoldig'i
      bilan ro'yxat bo'lib tursin (ro'yxat KESILMASIN).
    - **Bekor qilish** → hech nima yuborilmasin, progress o'zgarmasin.
    - Yana bosib **«Ha, 0 qilib yopish»** → «Yopilmoqda…» chiqsin → tugagach
      «2 qator 0 qilib yopildi» toasti, sarlavhada **«3/3 sanaldi»** (yashil)
      va tugmaning O'ZI yo'qolsin.
    - ERP'da o'sha ombor hujjatlarini oching → har qator uchun avto
      **Списание** («Sanash (yacheyka …) — avto-tenglash») yozilgan bo'lsin.
    - **Aloqasiz xulq:** boshqa yacheykani oching, Wi-Fi'ni O'CHIRING va
      «Qolganini 0 qilib yopish» ni tasdiqlang → past signal + qizil banner
      «Aloqa yo'q — to'xtatildi. 0 qator yopildi, N qator yopilmadi», qatorlar
      ekranda TURSIN (jim yo'qolmasin), navbatga HECH NIMA tushmasin
      («Navbatda: N» hisobi o'zgarmasin).
    - Boshqa yacheyka yorlig'ini skanerlang → progress **0/M** ga tushsin
      (eski ✓ belgilar ergashib o'tmasin).
14. **«Oxirgi sanoq» qaytarish (T7):** qoldig'i bor yacheykani Sanashda oching.
    - Qoldig'i **14** bo'lgan qatorga ataylab **41** yozib **Saqlang** →
      sarlavha-karta ostida kulrang chiziq chiqsin: «Oxirgi sanoq · <nom> —
      **avval 14 edi, siz 41 qildingiz**», ostida sariq izoh
      «🔴 Qaytarish — BEKOR QILISH emas: ilova yangi sanoq (14) yuboradi va
      tizim YANA hujjat yozadi» va tugma «⟲ Qaytarish — 14 qilib qo'yish».
    - **⟲ Qaytarish** → «Qaytarilmoqda…» → «Qaytarildi: <nom> = 14» toasti,
      qatorning «Tizimda» soni **14** ga qaytsin, belgisi **○ kulrang** bo'lsin
      (progress **1/3** dan **0/3** ga tushadi — sanoq qaytarildi, demak qator
      hali sanalmagan) va chiziq yo'qolsin.
    - **ERP'da IKKITA hujjat** turgan bo'lsin (avval KIRIM 27, keyin CHIQIM 27)
      — qaytarish hujjatni o'chirmaydi, yangisini yozadi.
    - **O'zgarmagan saqlash chiziq bermasin:** shu qatorga **14** ni (ya'ni
      sukut qiymatni) qayta saqlang → «Sanoq saqlandi» chiqsin, lekin chiziq
      **umuman chiqmasin**.
    - **Yacheykada YO'Q tovar:** 🔍 qidiruvdan yacheykada bo'lmagan tovarni
      tanlab **5** deb saqlang → chiziqda «avval bu yacheykada YO'Q edi, siz 5
      qildingiz», izoh **qizil** («qoldiq 0 ga tushadi va tizim CHIQIM
      (Списание) hujjatini yozadi»), tugma «⟲ Qaytarish — 0 qilib qo'yish».
    - **Chiziq o'zi yo'qolsin:** yangi sanoq saqlab **12 soniya** kuting →
      chiziq yo'qolsin.
    - **Ekran/yacheyka almashishi:** sanoq saqlab, **🔍 Tovar qidirish** ni
      oching va «Orqaga» qayting → chiziq **bo'lmasin**. Boshqa yacheyka
      yorlig'ini skanerlaganda ham chiziq bo'lmasin.
    - **Aloqasiz xulq:** sanoq saqlab Wi-Fi'ni O'CHIRING va ⟲ ni bosing →
      past signal + qizil banner «Aloqa yo'q — sanoq saqlanmadi, qayta urinib
      ko'ring», chiziq **O'Z JOYIDA qolsin** (navbatga hech nima tushmasin).
15. **Narx tekshiruvi (yana):** har ekranda narx YO'Qligini ko'zdan kechiring.
    Terminal tokeni bilan `GET /api/v1/products?search=…` → **403**;
    `GET /api/v1/tsd/search?q=…` → **200** va javobda narx maydoni **yo'q**.

## Qo'lda smoke (K4 qabul mezoni — BO'LINADIGAN TOVAR KESIMI)

Javobgar: __________ · Sana/vaqt: __________ · APK versiyasi: __________

Oldshart: sinov tovarga (kabel) bo'lak hisobi bayrog'i YOQILGAN va reyestrga
bo'laklar kiritilgan (K2 ekrani, `/omborchi/bolaklar`).

1. **Kesim zanjiri:** kassir 180 m kabel bilan chek ochib yig'ishga yuboradi →
   TSD'da qatorda **«✂ Kesish»** tugmasi chiqsin (kassir «150 + 30» deb
   kelishgan bo'lsa, o'sha kelishuv ham ekranda ko'rinsin) → bo'lakni tanlang
   yoki `BLK-` yorlig'ini SKANERLANG → kesilgan uzunlikni kiriting → saqlang.
   Ekranda YANGI YORLIQ raqamlari chiqsin.
2. **Qator O'ZI yopilsin:** so'ralgan miqdor to'liq kesilgach qator
   tasdiqlangan bo'lsin (qo'shimcha tugma bosilmasin) va chek KONTROLGA tushsin.
3. **Kesimsiz yopib bo'lmasligi:** boshqa kabel qatorida kesimni yozmasdan
   «Tasdiqlash» ni bosing → **rad etilsin** («avval kesimni yozing»).
4. **QOLDIQ O'ZGARMASIN (eng muhim band):** kesimdan OLDIN va KEYIN o'sha
   tovarning ombor qoldig'ini yozib oling — **bir grammga ham o'zgarmasligi
   SHART** (kesim stok-neytral; qoldiq faqat to'lovda kamayadi).
5. **Sverka:** `/reports/piece-reconciliation` da o'sha tovar bo'yicha farq
   kesimdan keyin ham «yo'q» bo'lsin (o'lchov farqi kiritilgan bo'lsa —
   aynan o'sha miqdorda ko'rinsin).
6. **Yorliqni skanerlash:** yangi `BLK-` yorlig'ini skan qiling → AYNAN o'sha
   bo'lak ochilsin (tovar multi-hit tanlovi OCHILMASIN).
7. **To'lov:** kassir chekni yopsin → qoldiq kamaysin VA o'sha bo'lak
   reyestrdan chiqsin (sverka farq bermasin).
8. **Mijoz voz kechdi:** yangi chekda kesim yozing va chekni BEKOR qiling →
   kesilgan bo'lak omborda YORLIG'I bilan QOLSIN (`active`), qoldiq esa
   o'zgarmasin.
9. **Aloqasiz holat:** Wi-Fi ni o'chirib kesimni saqlashga urinib ko'ring →
   ekran «aloqa yo'q — kesim saqlanmadi» desin va kiritilgan sonlar JOYIDA
   qolsin (kesim oflayn navbatga ATAYLAB qo'yilmaydi: yorliq raqamini server
   beradi).

## Qo'lda smoke (0.2.0 UI — iData 95W Pro'da BIRINCHI o'rnatish)

Javobgar: __________ · Sana/vaqt: __________ · APK versiyasi: __________

Bu ro'yxat yuqoridagi G5/G6/K4 smoke'laridan OLDIN bajariladi — u qurilma va
ilova bir-birini «ko'ryaptimi» degan savolga javob beradi.

1. **O'rnatish:** «Noma'lum manbalar» yoqilgan holda `app-debug.apk` ni
   o'rnating → ilova ochilsin, «Terminalni ulash» ekrani chiqsin.
2. **Skaner rejimini ANIQLANG (eng muhim band):** juftlashdan keyin istalgan
   ekranda shtrix skanerlang.
   - Kod tepadagi maydonga yozilib, so'ng qidiruv ketsa → **wedge ishlayapti**.
   - Hech nima bo'lmasa: terminalning skan sozlamalarida chiqishni
     «klaviatura» + suffiks «Enter» qiling.
   - Broadcast'ni yoqmoqchi bo'lsangiz: o'sha sozlamalardagi **action** va
     **extra** nomlarini yozib oling → `config.xml` ga qo'ying → qayta build.
3. **Fizik klaviatura:** PIN ekranida raqamlarni **qurilma tugmalaridan**
   tering → nuqtalar to'lsin; **ENT** bosilganda kirish bo'lsin; **⌫** o'chirsin.
4. **Plitkali menyu:** to'rt plitka ham ochilsin va «Orqaga» bosh menyuga
   qaytarsin.
5. **Navbat plitkasi:** Wi-Fi ni o'chirib bitta amal qiling → plitkada son
   chiqsin; Wi-Fi qaytgach «Navbat» ekranidan «Yuborish» → son yo'qolsin.
6. **O'qilishi:** 4" ekranda tugmalar qo'lqop bilan bosilsinmi, matn qo'l
   uzunligidan o'qilsinmi — omborchining o'zi aytsin.

## Fayl xaritasi

```
app/src/main/AndroidManifest.xml           — ruxsatlar (VIBRATE bor; kamera/lokatsiya/mikrofon YO'Q)
app/src/main/res/values/
   config.xml                              — api_base_url + skaner broadcast aksiyasi + T2/T4 bayroqlari
   strings.xml                             — matnlar (uz; ru kerak bo'lsa values-ru)
app/src/main/java/uz/sherset/tsd/
   — o'zgarmagan qatlam (G5/G6, server bilan muloqot) —
   DeviceStore.kt                          — SHIFRLANGAN kalit/refresh saqlash
   ApiClient.kt                            — allowlist ichidagi endpointlar
   ActionQueue.kt                          — oflayn FIFO amal navbati
   QueueSender.kt                          — navbatni bo'shatish
   ScannerBridge.kt                        — broadcast skaner ko'prigi (ko'p vendor)
   Feedback.kt                             — T4: ovoz (ToneGenerator) + tebranish (Vibrator)
   QtyExpression.kt                        — T5: miqdor ifodasi (SOF modul, `12*24` → `288`)
   CountUndo.kt                            — T7: qaytarish nishoni (SOF modul; chiziq chiqadimi, qaysi son ketadi)
   Updater.kt                              — qurilmadan yangilash (manifest+sha256+o'rnatish)
   — dizayn qatlami (0.2.0, Compose) —
   Theme.kt                                — ranglar, tipografika, shakllar
   Widgets.kt                              — tugmalar, kartalar, yacheyka plashkasi, maydonlar (T5 kalkulyator rejimi), xato banneri
   Shell.kt                                — `Shell`/`Screen` shartnomasi
   ScanBar.kt                              — doim fokusdagi klaviatura-wedge maydoni
   AuthScreens.kt                          — juftlash + PIN (raqamlagich)
   MainActivity.kt                         — qobiq: juftlash → PIN → router → skan marshruti
   HomeScreen.kt                           — plitkali bosh menyu
   UpdateCard.kt                           — yangilanish kartasi (holat mashinasi)
   TaskListScreen.kt · TaskDetailScreen.kt · ShortageScreen.kt
   PlaceScreen.kt · CountScreen.kt · ScanInfoScreen.kt · PickProductScreen.kt
   SearchScreen.kt                         — T3: nom/artikul qidiruvi (narxsiz)
   QueueScreen.kt                          — oflayn navbat + rad etilganlar
   CutScreen.kt                            — K4: bo'linadigan tovar kesimi
app/src/test/java/uz/sherset/tsd/
   QtyExpressionTest.kt                    — T5: JVM unit-test (17 ta) — `gradle testDebugUnitTest`
   CountUndoTest.kt                        — T7: JVM unit-test (8 ta) — qaytarish nishoni server regexidan o'tadi
app/build.gradle.kts · settings.gradle.kts — build konfiguratsiyasi (Compose + T9 release-imzo)
tools/
   imzo-yarat.sh                           — T9: release-kalitni BIR MARTA yaratish (mavjud bo'lsa to'xtaydi)
   publish.sh                              — chiqarish: assembleRelease → imzo izi tekshiruvi → APK → latest.json
```
