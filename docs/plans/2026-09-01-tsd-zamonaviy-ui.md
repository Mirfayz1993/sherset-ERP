# TSD ilovasi — zamonaviy UI (Compose) · U-reja

> **Sana:** 2026-09-01 · **Holat:** REJA (egasi tasdig'i kutilmoqda)
> **Sabab:** haqiqiy terminal keldi — **iData 95W Pro** (Android 14, 4" 480×800,
> fizik klaviatura + apparat skaner). Egasining qarori: «APK frontend'ini
> to'liq qaytadan zamonaviy dizayn bilan yozaylik» (web-ekran EMAS — TSD
> boshqaruvi hozircha API'da qoladi).
> **Bog'liq rejalar:** G-reja (`2026-08-23-omborchi-tsd-mijozlar.md`, G5/G6
> hisobotlari — ular «QISMAN», sabab: jonli qurilmada sinalmagan).

## 1. O'zgarmaydigan narsalar (invariantlar)

Bu reja FAQAT ko'rinishga tegadi. Quyidagilar bir bayt ham o'zgarmaydi:

1. **Server shartnomasi:** `/tsd/scan` (narxsiz), TSD allowlist (`tsd-policy.ts`),
   `clientOpId` idempotentlik, `/auth/tsd-login` oqimi.
2. **NARX HECH QAYERDA ko'rinmaydi** — server bermaydi, ilova so'ramaydi.
3. **Oflayn navbat qoidalari:** FIFO, qat'iy ketma-ket, 4xx → «rad etilganlar»
   ro'yxatiga (jim yo'qotish yo'q — IS-5), navbat to'lsa YANGISI rad etiladi.
4. **«Tayyor» tugmasi YO'Q** — hamma qator yopilgach chek o'zi KONTROLGA tushadi.
5. **Sanash:** faqat mutlaq son (`mode: 'set'`), oflayn navbatga QO'YILMAYDI.
6. **Kesim (K4):** oflayn ishlamaydi (yorliq raqamini server beradi).
7. **Multi-hit:** ilova hech qachon o'zi tovar tanlamaydi.
8. **Xavfsizlik:** EncryptedSharedPreferences, PIN saqlanmaydi, kamera/lokatsiya
   ruxsati yo'q, faqat HTTPS.
9. **Tegilmaydigan fayllar:** `ApiClient.kt`, `ActionQueue.kt`, `QueueSender.kt`,
   `DeviceStore.kt`, `ScannerBridge.kt` (broadcast qismi).

## 2. Texnik qaror

- **Jetpack Compose + Material 3** (BOM 2024.05.00, compiler 1.5.14 — Kotlin
  1.9.24 bilan mos; AGP 8.5.0 va Gradle 8.7 o'zgarmaydi).
- G5 dagi «Compose APK'ni og'irlashtiradi» dalili bekor: qurilma Android 14,
  APK ~7 → ~10–12 MB — zaxira katta.
- Versiya: `0.1.0-scaffold` → **`0.2.0`** (versionCode 2).
- Ekranlar ODDIY SINF bo'lib qoladi (`Screen` interfeysi, Compose state ichida)
  — navigatsiya tarixi ekran nusxasini saqlaydi, yarim to'ldirilgan oqim
  («Joylashtirish» 2-bosqichi) «orqaga»da yo'qolmaydi. G6 dagi `Shell`
  shartnomasi saqlanadi, faqat `Ui` vidjet-fabrikasi o'rniga Compose.

## 3. Dizayn tili

- **Ranglar:** Sherset indigo (`#3F51B5`) — brend/asosiy; sariq aksent
  (`#F59E0B`) — skan (terminalning sariq tugmasiga hamohang); yashil —
  bajarildi; sariq-jigarrang — yetishmovchilik; qizil — rad/oflayn.
- **Faqat yorug' mavzu** — ombor yorug' joy, DayNight kechki smenada
  kutilmagan rang almashinuvi berardi.
- **O'lchamlar:** tugmalar 56–64dp (Material 48dp minimumidan ataylab yirik —
  qo'lqop, harakat), matn 17–22sp, yacheyka kodlari mono-shrift ko'k plashkada.
- **Skan maydoni** har doim tepada va fokusda (wedge rejimi shuni talab
  qiladi); broadcast rejimi fokusdan mustaqil ishlayveradi.
- **Bosh ekran — PLITKALI MENYU** (egasining tanlovi): Topshiriqlar ·
  Joylashtirish · Sanash · Navbat. Navbat plitkasi kutayotgan/rad etilgan
  amallar sonini ko'rsatadi.

## 4. Ekranlar xaritasi (9 ta, mantiq G5/G6 dan aynan ko'chadi)

| # | Ekran | Fayl | Yangi ko'rinish |
|---|---|---|---|
| 1 | Juftlash | `AuthScreens.kt` | markaziy karta, 2 maydon |
| 2 | PIN | `AuthScreens.kt` | 4 nuqta + 64dp raqamlagich, apparat klaviatura ham, 4-raqamda avto-kirish |
| 3 | Bosh menyu | `HomeScreen.kt` (yangi) | 2×2 plitka + skan eslatmasi |
| 4 | Topshiriqlar | `TaskListScreen.kt` | kartalar: tur-chip, progress, ⚠ belgisi |
| 5 | Topshiriq detali | `TaskDetailScreen.kt` | progress-bar, qator-kartalar (yacheyka plashka + nom + miqdor), Oldim/Topolmadim/✂ |
| 6 | Yetishmovchilik | `ShortageScreen.kt` | tovar kartasi, miqdor/izoh, «Topdim» yo'li |
| 7 | Joylashtirish | `PlaceScreen.kt` | 1-2-3 bosqich indikatori, manba kartalari |
| 8 | Sanash | `CountScreen.kt` | yacheyka sarlavha-karta, tovar qatorlari |
| 9 | Skan-ma'lumot / Multi-hit / Kesim / Navbat | `ScanInfoScreen.kt` / `PickProductScreen.kt` / `CutScreen.kt` / `QueueScreen.kt` (yangi) | kartalar; Navbat: kutayotganlar + rad etilganlar + «Yuborish» |

O'chadi: `Ui.kt` (o'rnini `Shell.kt` + `Widgets.kt` + `Theme.kt` bosadi).

## 5. Skaner strategiyasi (iData 95W Pro)

1. **Wedge (sukut):** iData skan sozlamalarida chiqish = klaviatura,
   suffiks = Enter — APK sozlashsiz ishlaydi.
2. **Broadcast (maqsad):** `config.xml` da iData'ning odatiy
   `android.intent.action.SCANRESULT` / `value` yozilgan — QURILMADA
   TEKSHIRILADI (noto'g'ri bo'lsa zarari yo'q, wedge ishlayveradi).
   Aniq nom qurilmaning skan sozlamalari ilovasidan olinadi.

## 6. API qo'shimchasi (shu sessiyada kelishilgan, kod yozildi)

`GET /auth/tsd-devices` (ro'yxat) va `POST /auth/tsd-device/:id/revoke`
(yo'qolgan terminalni bekor qilish) — ikkalasi `employee.update` bilan
(`pair` bilan bir xil darvoza). Web-ekran YO'Q (egasi qarori). Servis
testlari U1 fazasida yoziladi.

## 7. Fazalar (bitta sessiya = bitta faza, hisobot shu faylga)

- **U1 — Poydevor:** Compose build sozlamasi, `Theme/Widgets/Shell/ScanBar`,
  juftlash+PIN, `MainActivity` qobig'i; API `list`/`revoke` testlari.
  **Qabul:** `assembleDebug` yashil; api testlar yashil.
  ⚠️ Qoralama allaqachon bor (shu sessiyada yozilgan) — U1 uni tugatadi.
- **U2 — Ish ekranlari:** Home, TaskList, TaskDetail, Shortage, PickProduct,
  Queue. **Qabul:** `assembleDebug` yashil; yig'ish oqimi kompilyatsiyada butun.
- **U3 — Qolgan ekranlar:** Place, Count, ScanInfo, Cut; `Ui.kt` o'chadi;
  README «Build»+smoke bo'limi yangilanadi. **Qabul:** `assembleDebug` yashil,
  eski Views koddan asar qolmaydi.
- **U4 — Qurilma smoke (iData, egasi bilan):** APK o'rnatish, juftlash
  (admin `pair` chaqiradi), skaner rejimini aniqlash (wedge/broadcast),
  README'dagi 8-band smoke + G5/G6 qabul mezonlari. **Qabul:** jonli chek TSD
  bilan yig'ilib kontrolga tushadi — shunda G5/G6 «QISMAN» dan chiqadi.

## 8. Hisobotlar

### U1+U2+U3 — Compose UI TO'LIQ YOZILDI · ⚠️ QISMAN (qoida 11) · 2026-09-01

**Holat: QISMAN.** Kod tayyor, **`assembleDebug` ogohlantirishsiz o'tdi**
(`app-debug.apk` **12,9 MB**, 7,1 MB dan o'sdi), api testlari va typecheck
yashil. Lekin **jonli qurilmada hech narsa sinalmagan** ⇒ faza yopilmaydi.
U4 (iData smoke) — egasi bilan.

Uch faza bitta sessiyada bajarildi (ular bir-biriga shunchalik bog'liq ediki,
oraliqda build ham qilib bo'lmasdi: `Ui.kt` o'chishi hamma ekranga tegadi).

**Nima qilindi:**

1. **Dizayn qatlami (yangi):** `Theme.kt` (Sherset indigo + sariq aksent,
   FAQAT yorug' mavzu, dinamik rangsiz), `Widgets.kt` (64dp asosiy tugma,
   56dp ikkinchi darajali, kartochka, **yacheyka plashkasi** — mono ko'k,
   chip, bosqich sarlavhasi, raqam/matn maydonlari, bo'sh holat).
2. **`Ui.kt` va `dimens.xml` O'CHDI.** `Shell`/`Screen` shartnomasi
   `Shell.kt` ga ko'chdi va Compose'ga moslandi: `render(LinearLayout)` →
   `@Composable fun Content()`, `setStatus` yo'qoldi (holat endi ekranning
   o'z state'ida).
3. **Ekranlar (10 ta):** `HomeScreen` (YANGI — plitkali menyu),
   `QueueScreen` (YANGI — navbat + rad etilganlar), `AuthScreens`
   (juftlash + PIN raqamlagichi), `TaskListScreen`, `TaskDetailScreen`,
   `ShortageScreen`, `PlaceScreen`, `CountScreen`, `ScanInfoScreen`,
   `PickProductScreen`, `CutScreen`.
4. **PIN endi apparat klaviaturadan ham teriladi** (`dispatchKeyEvent`):
   iData'da fizik raqam tugmalari bor, ENT — kirish, ⌫ — o'chirish;
   4-raqamda avto-yuborish. Raqamlar ekranda KO'RINMAYDI (4 nuqta).
5. **`ScanBar.kt`** — klaviatura-wedge maydoni Compose'da; fokus ekran
   almashganda ham qaytariladi.
6. **API (kelishilgan):** `GET /auth/tsd-devices` va
   `POST /auth/tsd-device/:id/revoke` (`employee.update`, `pair` bilan bir
   darvoza). Web-ekran ATAYLAB yozilmadi (egasi: «hozircha API'da qolsin»).

**🔴 Ikki tomonlama bog'liqlik javobi (qoida 10):**

- **Server shartnomasiga TEGILMADI.** `ApiClient`, `ActionQueue`,
  `QueueSender`, `DeviceStore`, `ScannerBridge` — bir qatori o'zgarmagan.
  Ya'ni allowlist, idempotentlik, narxsizlik va oflayn qoidalari o'z holicha.
- **Yangi API ikkitasi FAQAT O'QISH va BEKOR QILISH.** `revoke` tenant
  chegarasini so'rovning o'zida ushlaydi (`where: {id, accountId}`), ya'ni
  begona akkaunt qurilmasiga tegib bo'lmaydi; idempotent (allaqachon bekor
  qilingani xato emas). `list` da `secretHash` **select'ga kirmaydi** va buni
  test qulflaydi.
- **Jonli xulq O'ZGARMAYDI:** `tsd_devices` jonlida BO'SH, ilova hali hech
  qayerda o'rnatilmagan. Yangi endpointlar `employee.update` talab qiladi —
  omborchida u yo'q.

**🔴 Compose'ning bitta minasi topildi va yopildi:** ekran obyektlari
almashganda Compose ularni AYNI slotda ko'radi ⇒ `LaunchedEffect(Unit)` qayta
ishga tushmaydi va yangi ekran eskisining ma'lumoti bilan chizilardi.
`key(screen) { screen.Content() }` shuni yopadi (izoh `MainActivity` da).

**O'lchandi:** `assembleDebug` **BUILD SUCCESSFUL** (1m 57s, ogohlantirishsiz);
api `auth` moduli + `mutation-guard-coverage` — **453 test yashil**
(`tsd-device.service.test.ts` **18**, ya'ni **+8**: `list` 5, `revoke` 3);
`tsc --noEmit` api'da **0 xato**.

### U5 — JONLI QURILMADA BIRINCHI ISHGA TUSHIRISH · 2026-09-01 (kech)

Terminal (iData 95W Pro) qo'lga olindi va ilova unda **ishga tushdi**:
juftlash ekrani → juftlash → PIN ekrani. Jonlida `tsd_devices` ga birinchi
qurilma yozildi (`TSD-1, Ombor 02`, `/auth/tsd-device/pair` → 201).
Yo'l-yo'lakay o'lchandi: 13 xodimdan **12 tasida kassa PIN'i bor** (ombor
tomonidagi Muxriddin va Ilhom ham) ⇒ TSD kirishi uchun yangi PIN kerak emas.

🔴 **BIRINCHI HAQIQIY NUQSON — SKANER MA'LUMOT BERMADI.** Sariq tugma
bosilganda maydonga ham, broadcast'ga ham hech narsa kelmadi. Ikki sabab
bo'lishi mumkin edi va ikkalasi ham yopildi:

1. **Aksiya nomi taxminiy edi.** G5 dizayni «model aniqlangach `config.xml` ga
   bitta aksiya yoziladi» degan edi — amalda model aniqlanganda ham nom
   qurilma sozlamalarida yashiringan bo'lib chiqdi. Endi `ScannerBridge`
   **ro'yxatdagi hamma aksiyani birdan tinglaydi** (iData/Urovo/Chainway/
   Newland/Zebra/Honeywell — 10 ta) va extra kalitini ham taxmin qilmaydi:
   intent'dagi matnli maydonlarni ko'rib, xizmat maydonlarini (simbologiya,
   uzunlik, vaqt) chetlab o'tib kodni topadi. Yangi terminalda kod
   o'zgarmaydi — faqat `config.xml` qatoriga qo'shiladi.
2. **Enter suffiksi bo'lmasligi mumkin.** Wedge rejimida kod maydonga tushib
   JIM turib qolardi. Endi `ScanBar` da **350 ms jimlik = yuborish** (≥3
   belgi); Enter kelsa maydon darhol tozalanadi va bu shox ishlamaydi.

Qolgani terminal sozlamasida: skan chiqishi **klaviatura + Enter suffiksi**
yoki **broadcast** qilib qo'yilishi kerak (README «Skaner» bo'limi).

### U6 — SANASHDA TOVAR SHTRIXI + QURILMADAN YANGILASH · 2026-09-01 (kech)

**1. Sanash ekraniga tovar skani (egasi so'radi).** Ilgari ekran FAQAT
yacheyka yorlig'ini tanirdi; tovar shtrixi «Yacheyka topilmadi» berardi.
Endi skan `/tsd/scan` bilan tasniflanadi: yacheyka → tarkib ochiladi (yoki
keyingi yacheykaga o'tiladi), tovar → ekran TEPASIDA «sanalayotgan tovar»
kartasi, son maydoni tayyor. Multi-hit'da tanlovni odam qiladi.
🔴 **Yacheykada YO'Q tovar ham sanaladi** — server buni qo'llaydi
(`setCellStock` har qanday tovarni oladi, `oldQty = 0` ⇒ avto Оприходование).
Karta bunday holatda SARIQ bo'lib ochiq ogohlantiradi («kirim bo'lib
yoziladi»), jimgina qo'shmaydi. Saqlangach tarkib qayta o'qiladi — «Tizimda»
ustuni eski sonni ko'rsatib turmaydi. **Serverga o'zgarish KERAK BO'LMADI:**
`/tsd/scan` ham, yacheyka-sanash marshrutlari ham allaqachon allowlist'da.

**2. Qurilmadan yangilash (egasi so'radi).** `Updater.kt`: ilova har
ochilganda `/downloads/tsd/latest.json` ni o'qiydi (nginx statikasi, tokensiz
— juftlashdan oldin ham ishlaydi), `versionCode` katta bo'lsa bosh ekranda
karta chiqadi → yuklab olish → **SHA-256 tekshiruvi** → tizim o'rnatuvchisi.
Android 8+ «noma'lum manba» huquqi yo'q bo'lsa ilova aynan o'sha sozlama
ekranini ochadi (jim yiqilish yo'q). Avtomatik EMAS: o'rnatish ilovani qayta
ishga tushiradi, ya'ni yarim bajarilgan yig'ish/sanash uzilardi.
Chiqarish endi bitta buyruq: `tools/publish.sh` (build → APK → manifest →
tekshiruv; versiya allaqachon serverda bo'lsa TO'XTAYDI, tartib «avval APK,
keyin manifest»).

**O'lchandi:** `assembleDebug` **ogohlantirishsiz**, APK **13,4 MB**;
`0.3.0` (versionCode 3) kanalga chiqarildi va `latest.json` bilan tasdiqlandi
(sha256 mos, ikkala URL 200).

🔴 **IMZO QARZI — qaror kerak.** APK **debug-kalit** bilan imzolangan
(`~/.android/debug.keystore`, sertifikat `b8ae71fd…`, 2056 gacha). Yangilanish
faqat ayni kalit bilan ishlaydi ⇒ **build doim shu mashinada** bo'lishi va
kalit **zaxiralanishi** shart. Kalit yo'qolsa har terminalda o'chirib qayta
o'rnatish kerak va **juftlash yo'qoladi**. Alohida release-kalitga o'tish
hozir arzon (bitta terminal), keyinroq qimmat bo'ladi.

### U7 — 🔴 SESSIYA 401 (G5 dan qolgan nuqson) · 2026-09-02 · `0.4.0`

**Belgi:** terminalda skanerlaganda «401» xatosi. **Aslida bu YAXSHI xabar
edi:** 401 kod ilovaga YETIB KELGANINI bildiradi (ilova serverga so'rov
yuborgan) — ya'ni U5 dagi skaner tuzatishi ISHLAGAN, to'siq esa boshqa joyga
ko'chgan.

**Ildiz — ikkita nuqson ustma-ust (koddan o'qib topildi, taxmin emas):**

1. **`refresh` HECH QACHON chaqirilmasdi.** G5 login'da `store.refreshToken`
   ni saqlardi va uni HECH QAYERDA ishlatmasdi (`api.refresh` chaqiruvi butun
   ilovada yo'q edi). Access-token 15 daqiqada tugagach har bir so'rov 401
   berardi va yagona chora ilovani qayta ochish bo'lardi. Bu G5/G6 testlarida
   ko'rinmasdi: birorta test 15 daqiqadan uzoq sessiyani ifodalamaydi.
2. **Chaqirilganda ham ishlamasdi.** `ApiClient.refresh` tokenni so'rov
   TANASIDA yuborardi, server esa uni FAQAT cookie'dan o'qiydi
   (`auth.controller.ts:96` — `req.cookies[ms_rt]`), OkHttp'da esa cookie
   idorasi umuman yo'q edi ⇒ login qo'ygan cookie darhol tashlanardi.
   Ya'ni klient serverda MAVJUD BO'LMAGAN shartnomaga yozilgan edi.

**Tuzatildi (server tomonga TEGILMASDAN):** `ApiClient` ga xotira-cookie
idorasi qo'shildi (login qo'ygan `ms_rt` saqlanadi va `/auth/refresh` ga o'zi
qaytadi; rotatsiyada yangi cookie ustiga yoziladi), va 401 da sessiya BIR
MARTA tiklanib so'rov qayta yuboriladi. **Takrorlash xavfsiz:** qoldiqni
siljitadigan har amal `clientOpId` bilan ketadi va server uni tranzaksiya
ichida da'vo qiladi. Refresh ham yiqilsa (qurilma `revokedAt`, yoki
refresh-token o'lgan) ilova PIN ekraniga qaytadi va SABABINI aytadi — ilgari
bu xom «HTTP 401» bo'lib chiqardi.

**Yon ish — SKANER DIAGNOSTIKASI ekrani.** Qurilma USB'da emas ⇒ `logcat`
yo'q edi va skaner nosozligi «aksiya nomini taxmin qilish» ga aylanardi.
Endi bosh ekranda «Skaner diagnostikasi» bor: u `KEY` (wedge tugma
hodisalari), `BCAST` (kelgan aksiya + intent ichidagi HAMMA maydon) va
`CLIP` (bufer) ni ko'rsatadi, hamda tinglanayotgan aksiyalar ro'yxatini
chiqaradi. PIN bosqichida tugmalar YOZILMAYDI (jurnalga PIN tushmasin).

**O'lchandi:** build ogohlantirishsiz; `0.4.0` (versionCode 4) kanalga
`tools/publish.sh` bilan chiqarildi va manifest xeshi serverdan qayta o'qib
tasdiqlandi. ⚠️ Skriptdagi `grep -oP` Git Bash (Windows) lokalida yiqilardi —
`sed` ga o'tkazildi.

**Ochiq qolganlar:**

- **U4 — jonli smoke qilinmagan ⇒ QISMAN.** Yangi 6 bandli ro'yxat
  `android/tsd-app/README.md` da («0.2.0 UI — birinchi o'rnatish»), undan keyin
  G5/G6/K4 ro'yxatlari. Shu bajarilsa G5/G6 ham «QISMAN» dan chiqadi.
- **Skaner broadcast nomi TAXMINIY** — `config.xml` da iData'ning odatiy
  `android.intent.action.SCANRESULT`/`value` turibdi; qurilmada tasdiqlanishi
  kerak (noto'g'ri bo'lsa wedge ishlayveradi, zarar yo'q).
- **Release-build va imzolash yo'q** — hozircha `app-debug.apk`. Tarqatish
  kanali (kassa .exe kabi `/downloads/…`) haqida qaror kerak.
- **Web boshqaruv ekrani yo'q** (egasi qarori) — juftlash/bekor qilish API
  orqali; endpointlar tayyor.
- **Ruscha matnlar yo'q** (`values-ru/strings.xml`) — G5 qarori kuchda.
- **Compose'da UI testi yo'q** — ilovada hech qachon bo'lmagan; mantiq
  server tomonda qulflangan.
