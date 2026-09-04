# Sherset — xodim va menejer ilovasi (Android)

> **Holat:** v0.2.0 (code 2) — «Xodim profili» to'lqini
> (reja: [`docs/plans/2026-09-03-xodim-profili-x-reja.md`](../../docs/plans/2026-09-03-xodim-profili-x-reja.md),
> X1–X7). v0.1 skeleti: [`docs/plans/2026-09-02-menejer-planshet-apk.md`](../../docs/plans/2026-09-02-menejer-planshet-apk.md).
> Jetpack Compose, OkHttp, o'z mikro-routeri — Retrofit/Hilt ATAYLAB yo'q
> (tsd-app dagi bir xil qaror).
>
> 🔴 **v0.2 da ilova endi faqat menejerniki emas.** «Mening kunim» bo'limi HAR
> BIR xodimga ochiq, shuning uchun launcher yorlig'i «Sherset Menejer» emas,
> **«Sherset»**. Paket nomi (`uz.sherset.manager`) va katalog nomi
> (`manager-app`) ATAYLAB o'zgarmadi: `applicationId` ni o'zgartirish — bu
> BOSHQA ilova degani, ya'ni yangilanish kanali uzilib, qurilmada ikkita ilova
> qolib ketardi.
>
> **Bitta APK, bosh ekran rolga qarab moslashadi.** «Boshqaruv» bo'limi faqat
> menejer/adminda chiziladi, «Mening kunim» hammada.

## Nima qiladi

**Kirish** — email/username + parol (`POST /auth/login`). Qurilma-juftlash va
PIN hamon YO'Q (tsd-app dan farqli). Login javobidagi `user.hrRoles` va
`user.hrPermissions` bosh ekranni chizadi — qo'shimcha so'rov kerak emas.

**«Boshqaruv» bo'limi** (menejer/admin, yoki `employees:read`+) — v0.1 dan:

1. **Brifing** — ertalabki/kechki kun xulosasi.
2. **Tushum (pul xaritasi)** — «korxona puli qayerda»: 6 blok + sof qoldiq.
3. **KPI** — xodimlar kunlik KPI navbati (og'ishlilar tepada).
4. **Undirish** — qarz undirish ish ro'yxati, o'qish rejimida.

**«Mening kunim» bo'limi** (hamma xodimga) — v0.2 da qo'shildi:

5. **Davomat** (X2) — bugungi holat + «Keldim»/«Ketyapman» (geofence bilan,
   bir martalik GPS o'lchovi) + oylik tarix.
6. **Ishlarim** (X3) — o'z vazifalari va ularga **javob yuborish**.
7. **Mening KPI'im** (X5) — o'z kunlari, ball, signallar, ko'rsatkichlar.
8. **Oyligim** (X6) — oy tanlagichi, jami, tarkib, bonus/jarima ro'yxati.
9. **Yo'nalishlarim** (X4) — FAQAT haydovchida: smena, reyslar, qo'ldagi pul.

10. **O'z-o'zini yangilash** — `latest.json` + SHA-256 (tsd-app naqshi).

🔴 **v0.1 ning «faqat o'qish» qoidasiga ATAYLAB ikki istisno:** vazifaga javob
berish (X3) va davomat «Keldim/Ketyapman» (X2). Ikkalasi ham xodimning O'Z
amali va egalik SERVERDA tekshiriladi. Menejer amallari (KPI qabul, eslatma
yuborish, smena qabul) hamon web ERP'da.

🔴 **Own-only shartnomasi.** Har bir `my`-endpoint `employeeId` ni FAQAT
token'dan (`user.sub`) oladi; so'rov sxemalarida bunday maydon UMUMAN yo'q, ya'ni
`?employeeId=` kontrollergacha yetib bormaydi. Bu klientda emas, SERVERDA
qulflangan va har fazada manfiy testlar bilan tekshirilgan.

## Backend kontrakti

| Endpoint | Metod | Ruxsat | Izoh |
|---|---|---|---|
| `/auth/login` | POST | — | `{identifier, password}` → tanada `{accessToken, user}`; **refresh-token TANADA KELMAYDI** — faqat `Set-Cookie: ms_rt=…` (pastga qarang) |
| `/auth/refresh` | POST | cookie | Tanasiz; token FAQAT `Cookie: ms_rt=…` dan o'qiladi; javob `{accessToken, user}` + ROTATSIYA qilingan yangi cookie |
| `/auth/logout` | POST | cookie | Chiqishda best-effort chaqiriladi |
| `/manager/briefing/:kind` | GET | `report.view` | `kind` = `morning`\|`evening`; `{blocks[], summary}` |
| `/manager/money-map` | GET | `report.view` | `{blocks[6], summary{netMinor\|null}}` |
| `/manager/kpi/days?limit=100` | GET | HR `employees:read` | `{items[], total}` — server og'ish bo'yicha saralaydi |
| `/manager/collection?scope=due&limit=200` | GET | `debt.view` | `{rows[], summary, totalCount, truncated}` |

**«Mening kunim» — own-only yo'llar (v0.2).** Hammasida `employeeId = user.sub`:

| Endpoint | Metod | Darvoza | Izoh |
|---|---|---|---|
| `/hr/attendance/my/today` | GET | JwtAuthGuard | `{optIn, workLocation, schedule, today{…}, status}` |
| `/hr/attendance/my/check-in` · `check-out` · `opt-in` | POST | JwtAuthGuard | 🔴 geofence bilan — koordinatasiz «Keldim» MUMKIN EMAS |
| `/hr/attendance/my/history?yearMonth=YYYY-MM` | GET | JwtAuthGuard | **X2 da yaratildi.** Kun qatorlari + oy jamlari; vaqtlar `HH:mm` MATNI |
| `/hr/tasks/my?status=&limit=` | GET | HR `tasks:own_only` | **X3 da yaratildi.** Muddat SERVERDA (`sentAt + deadlineMinutes`) |
| `/hr/tasks/logs/:id/answer` | POST | HR `tasks:own_only` | Egalik servisda tekshiriladi |
| `/hr/kpi/my?limit=30` | GET | JwtAuthGuard | **X5 da yaratildi.** `score: null ≠ 0`; darvoza tanlovi sababi pastda |
| `/hr/payroll/my/:yearMonth` | GET | HR `oylik:own_only` | **X6 da yaratildi.** Uch qavatli qamrov, faqat o'z qatori |
| `/driver-tracking/my/trips` · `shifts/current` · `shifts/start\|end` | GET/POST | JwtAuthGuard | Haydovchi; server `trackingMode='field'` talab qiladi |
| `/driver-cash/mine` | GET | JwtAuthGuard | Valyutalar ALOHIDA, qo'shilmaydi |

⚠️ **Darvozalar ATAYLAB bir xil emas.** `hr/kpi/my` `JwtAuthGuard` + qat'iy
self bilan ochilgan (X5), `hr/payroll/my` esa `oylik:own_only` bilan (X6).
Sabab: `oylik` — OYLIK sahifasi, KPI emas; KPI'ni o'sha darvoza ostiga qo'yish
«o'z KPI'ingni ko'rish» huquqini «o'z OYLIGINGNI ko'rish» huquqiga bog'lab
qo'yardi. Himoyani darvoza emas, QAMROV beradi (`employeeId` so'rovdan
olinmaydi) — ikkalasi ham testlar bilan qulflangan.

🔴 **Cookie-refresh — TSD'dan asosiy farq.** Web `auth.controller.ts` refresh
tokenni FAQAT `ms_rt` cookie'sidan o'qiydi (TSD'dagidek tanada qabul
qilmaydi). OkHttp'da cookie idorasi yo'q, shuning uchun `ApiClient` `Set-Cookie`
sarlavhasini O'ZI ushlaydi, qiymatni AYNAN kelgan (kodlangan) ko'rinishda
`SessionStore` ga (EncryptedSharedPreferences, AES-256) yozadi va keyingi
refresh'da `Cookie:` sarlavhasi bilan qaytaradi. Access-token xotirada, 401 da
klient BIR MARTA refresh qilib so'rovni qaytaradi; refresh ham yiqilsa —
login ekrani. **PAROL HECH QACHON saqlanmaydi.**

🔴 **Server shartnomalari ekranda saqlanadi:** `null ≠ 0` («o'lchanmadi» hech
qachon «0» bo'lib chiqmaydi), sof qoldiqda yarim yig'indi yo'q, valyutalar
qo'shilmaydi, KPI `score: null` — «0%» emas. Pul `amountMinor` (tiyin) da
keladi va `Fmt.minor` so'mga formatlaydi.

⚠️ **Ruxsatlar:** `general_manager` roli jonlida hali yaratilmagan —
xodimda `report.view` / `debt.view` / HR `employees:read` bo'lmasa tegishli
ekran 403 oladi (ekranda oshkora aytiladi). V0.1 admin bilan sinaladi.

🔴 **v0.2 chiqarishdan OLDIN jonlida tekshiriladigan uchta ma'lumot bandi.**
Kodda hammasi tayyor, lekin ular BAZADAGI qatorlarga tayanadi — berilmagan
bo'lsa ekran fail-closed (xavfsiz, lekin foydasiz) bo'lib qoladi:

| Nima | Kim ko'rmay qoladi | Qayerdan beriladi |
|---|---|---|
| HR ruxsati `tasks:own_only` | «Ishlarim» → 403 | HR ekrani (qo'lda) |
| HR ruxsati `oylik:own_only` | «Oyligim» → 403 | HR ekrani (qo'lda) |
| `hrRoles` da `driver` **va** `Employee.trackingMode = 'field'` | «Yo'nalishlarim» plitkasi umuman chizilmaydi | HR ekrani / xodim kartochkasi |

`seed-hr.ts` sahifa ruxsatlarini FAQAT egalarga/adminlarga yozadi, qolganiga
HR ekranidan qo'lda beriladi. Haydovchilikda esa IKKI manba bor: plitka
`hrRoles` bo'yicha chiziladi, server esa `trackingMode` bo'yicha hal qiladi —
ikkalasi ham qo'yilishi shart.

## Yangilanish (qurilmadan)

tsd-app bilan bir xil naqsh, kanal boshqa: ilova har ochilganda
`GET /downloads/menejer/latest.json` ni o'qiydi (nginx statikasi, tokensiz),
yangi `versionCode` bo'lsa bosh ekranda karta chiqadi; APK keshga tushadi va
**SHA-256 tekshiriladi**. Chiqarish:

```sh
# 1) app/build.gradle.kts — versionCode +1 VA versionName oshiriladi
# 2) birinchi chiqarishdan oldin serverda: mkdir -p /var/www/kassa-downloads/menejer
bash android/manager-app/tools/publish.sh "nima o'zgardi"
```

Skript ketma-ketligi: `EXPECTED_SIGNER` bor-yo'qligi → versiya serverda
bor-yo'qligi → **`assembleRelease`** → `apksigner` bilan imzo izini
solishtirish → APK → `latest.json` → serverdan xeshni qayta o'qib tasdiqlash.

---

## Release imzo (X7) — 🔴 kalit YARATILMAGAN, egasidan kutiladi

Android yangilanishni **imzo bo'yicha** qabul qiladi: o'rnatilgan ilova ustiga
faqat **ayni kalit** bilan imzolangan APK tushadi. v0.1 debug-kalit bilan
imzolangan edi (`~/.android/debug.keystore`) — u kalitni SDK avtomatik yaratadi,
hech kim zaxiralamaydi, SDK qayta o'rnatilsa **jimgina boshqasi** paydo bo'ladi.
Shuning uchun 0.2.0 dan boshlab **release kalit** ishlatiladi.

**Build konfiguratsiyasi TAYYOR, kalitning O'ZI yo'q.** `assembleDebug` kalitsiz
ham ishlayveradi (kundalik ish to'xtamaydi), `assembleRelease` esa ANIQ XABAR
bilan yiqiladi — imzosiz APK jimgina chiqib ketmasin.

### 1. Kalitni bir marta yaratish (egasi, shu mashinada)

```sh
bash android/manager-app/tools/imzo-yarat.sh
```

Skript `~/.sherset/` ichida ikkita fayl yaratadi va sertifikat izini ekranga
chiqaradi. **Kalit mavjud bo'lsa skript TO'XTAYDI** — tasodifan «yangisini
yasab qo'yish» tuzog'i shu bilan yopilgan.

| Nima | Joyi | Izoh |
|---|---|---|
| Kalit ombori | `%USERPROFILE%\.sherset\sherset-manager-release.jks` | PKCS12, RSA 4096, **2056** gacha |
| Parol + alias | `%USERPROFILE%\.sherset\sherset-manager-release.properties` | `chmod 600`, repoda YO'Q |
| Alias | `sherset-manager` | |

Ikkalasi ham **repodan tashqarida** (repo public). Yo'lni
`SHERSET_MANAGER_KEYSTORE_PROPS` muhit o'zgaruvchisi bilan boshqa joyga
ko'rsatish mumkin. Repo tomonda qo'shimcha to'siq: `.gitignore` da `*.jks`,
`*.keystore`, `*keystore*.properties`.

🔴 **TSD kaliti QAYTA ISHLATILMAYDI** — u boshqa ilovaniki (`uz.sherset.tsd`).
Ikkalasini bitta kalitga bog'lash bitta yo'qotish bilan IKKI kanalni birdaniga
o'ldirardi.

### 2. Izni `publish.sh` ga yozish

`tools/publish.sh` dagi `EXPECTED_SIGNER` hozir **bo'sh**. Skript bo'sh iz
bilan ATAYLAB to'xtaydi (fail-closed): aynan «kalit sozlanmagan» holatda
imzosiz yoki debug-imzoli APK chiqib ketish xavfi eng yuqori. Yaratish
skripti chiqargan SHA-256 ni **nuqtasiz, kichik harfda** o'sha o'zgaruvchiga
yozing. Iz **sir emas** — u har APK ichida bor va bu yerda ataylab turadi:
xato kalitli APK serverga **yuklashdan oldin** to'xtatiladi.

### 3. 🔴 ZAXIRA — kalit yo'qolsa tiklab BO'LMAYDI

Yangi kalit **boshqa ilova** hisoblanadi: har qurilmada ilovani o'chirib qayta
o'rnatish kerak bo'ladi va **har xodim qayta login qiladi**. Shuning uchun
ikkala fayl ham **kamida ikkita** joyda, shu mashinadan tashqarida tursin:

1. **Egasining parol menejeri** — `.jks` biriktirma sifatida, parol alohida yozuv.
2. **Oflayn nusxa** — shifrlangan USB yoki egasining seyfi.

```sh
cp ~/.sherset/sherset-manager-release.jks        /d/zaxira/
cp ~/.sherset/sherset-manager-release.properties /d/zaxira/
```

**Tekshiruv (nusxa haqiqatan ochiladimi):** nusxadan izni o'qing — `publish.sh`
dagi `EXPECTED_SIGNER` bilan **bir xil** bo'lishi shart:

```sh
/d/dev/java/jdk-17/bin/keytool -list -v \
  -keystore /d/zaxira/sherset-manager-release.jks -alias sherset-manager
```

`keytool` izni ikki nuqtali va katta harfda chiqaradi (`7B:D9:…`), `apksigner`
esa nuqtasiz kichik harfda — bu bir xil son. Iz mos kelmasa nusxa **noto'g'ri**.

🔴 Zaxira bulutli kod xostingiga (GitHub, Gitea) va umumiy chatga **qo'yilmaydi**.

### 4. ⚠️ Bir martalik o'tish: debug → release

**Debug-imzoli ilova ustiga release APK TUSHMAYDI** — Android «App not
installed» / «Paket mos kelmaydi» deydi. Bu **kutilgan** xulq, nosozlik emas.

v0.1 APK'si HECH QAYERGA chiqarilmagan bo'lsa (`/downloads/menejer/` kanali
hali ochilmagan — `latest.json` yo'q), bu bo'lim KERAK EMAS: 0.2.0 birinchi
chiqarish bo'ladi va toza o'rnatiladi. **Egasi tasdiqlasin.** Agar v0.1 biror
planshetga qo'lda o'rnatilgan bo'lsa, o'sha qurilmada:

1. Qurilma brauzerida `https://erp.sherset.uz/downloads/menejer/sherset-manager-0.2.0.apk`
   ni oching va yuklab oling (kanal tokensiz).
2. **Eski ilovani o'chiring** (Sozlamalar → Ilovalar → Sherset Menejer → O'chirish).
3. Yuklab olingan APK'ni o'rnating («noma'lum manba» ruxsati kerak bo'lishi mumkin).
4. Ilovani oching → email/parol bilan **qayta kiring** (refresh-token ilova
   ma'lumoti bilan birga o'chadi — yarim ish yo'qolmaydi, ilova hech narsani
   oflayn navbatda saqlamaydi).
5. Bosh ekranda versiya **0.2.0** ekanini tekshiring.

Shundan **keyin** yangilanish kanali odatdagidek ishlaydi: 0.2.0 → 0.3.0 → …
hammasi ayni release kalit bilan imzolangani uchun ilova ichidan tushadi.

### 5. Boshqa mashinada build qilish

Mumkin, lekin kalit ko'chirilishi shart: `~/.sherset/` katalogini yarating,
zaxiradan ikkala faylni nusxalang va `.properties` ichidagi `storeFile` yo'lini
yangi mashinanikiga to'g'rilang (oldinga qiya chiziq bilan). Kalit **hech
qachon** CI'ga yoki umumiy mashinaga qo'yilmaydi.

## Build

1. **JDK 17** va **Android SDK** (platform `android-34`) — shu mashinada
   `D:/dev/java/jdk-17` va `D:/dev/android-sdk`.
2. **Gradle 8.7** (AGP 8.5.0 shuni kutadi; repo'da wrapper YO'Q) — shu
   mashinada `D:/dev/_downloads/g87/gradle-8.7`. ⚠️ Gradle 9.x MOS EMAS.
3. `local.properties` da `sdk.dir` (gitignore'da).
4. Buyruq (PowerShell):

   ```powershell
   $env:JAVA_HOME='D:/dev/java/jdk-17'
   & 'D:/dev/_downloads/g87/gradle-8.7/bin/gradle.bat' --no-daemon -p android/manager-app testDebugUnitTest assembleDebug
   ```

   → `app/build/outputs/apk/debug/app-debug.apk` (v0.2.0 da 139 JVM testi).

5. **Testlar** — `testDebugUnitTest`. Sof mantiq (`HrAccess`, `Davomat`,
   `Tasks`, `Routes`, `MyKpi`, `MyPayroll`) ATAYLAB Android API'siz yozilgan,
   shuning uchun emulyator/Robolectric KERAK EMAS. Compose ekranlarining o'zi
   testsiz — qaror mantig'i ekrandan tashqarida turadi.
6. `assembleRelease` uchun **release kalit** kerak (yuqoridagi «Release imzo»).
   Kalitsiz u ANIQ XABAR bilan yiqiladi — bu kutilgan xulq.

## Qo'lda smoke

v0.2.0 ning YAGONA smoke-rejasi (menejer oqimi + xodim oqimi + xavfsizlik
bandlari, har biri «kim, qaysi qurilmada, nimani bosadi, nima kutiladi»
ko'rinishida) alohida faylda:

📋 [`docs/ops/2026-09-04-menejer-v0.2-smoke.md`](../../docs/ops/2026-09-04-menejer-v0.2-smoke.md)

Bu ro'yxat ilgari shu README da turgan v0.1 bandlarini ham o'z ichiga oladi —
ikki joyda ikki xil ro'yxat bo'lib qolmasligi uchun bu yerdan olib tashlandi.

## Fayl xaritasi

```
app/src/main/AndroidManifest.xml           — ruxsatlar (INTERNET + o'rnatish + JOYLASHUV); portrait qulfi YO'Q
app/src/main/res/values/
   config.xml                              — api_base_url + update_manifest_url (menejer kanali)
   strings.xml                             — matnlar (uz); `app_name` = «Sherset»
app/src/main/res/xml/file_paths.xml        — FileProvider (faqat update.apk)
app/src/main/java/uz/sherset/manager/
   — qobiq va infra —
   ApiClient.kt                            — sinxron OkHttp; cookie-refresh (ms_rt) + 401 avto-retry;
                                             getArray/getObjectOrNull (massiv va null javoblar uchun)
   SessionStore.kt                         — SHIFRLANGAN refresh-token + hrRoles/hrPermissions
   SessionUser.kt                          — login/refresh javobidagi `user` ni o'qish (org.json shu yerda)
   Updater.kt · UpdateCard.kt              — qurilmadan yangilash (manifest+sha256)
   Shell.kt                                — `Shell`/`Screen` shartnomasi (+ locate)
   MainActivity.kt                         — Boot→Login→Work; ArrayDeque tarix; `key(screen)` MAJBURIY
   Locator.kt                              — bir martalik GPS o'lchovi (FON ruxsati/xizmati YO'Q)
   — dizayn —
   Theme.kt · Widgets.kt · Fmt.kt          — tsd-app dizayn tizimi + minor→so'm formatlash
   — SOF mantiq (Android'siz ⇒ JVM testlari bor) —
   HrAccess.kt                             — rol/ruxsat qarori (X1) · HrAccessTest 16 test
   Davomat.kt                              — oy/kun hisobi, UTC→Toshkent (X2) · DavomatTest 22 test
   Tasks.kt                                — vazifa kartasi, muddat (X3) · TasksTest 17 test
   Routes.kt                               — smena/reys/naqd, valyuta kesimi (X4) · RoutesTest 27 test
   MyKpi.kt                                — kun kartasi, ball/qamrov (X5) · MyKpiTest 27 test
   MyPayroll.kt                            — oylik kartasi, imzolangan summa (X6) · MyPayrollTest 30 test
   — ekranlar: «Boshqaruv» —
   LoginScreen.kt                          — email+parol, xato/yuklanish holati
   HomeScreen.kt                           — ikki bo'lim, rolga qarab (X1) + yangilanish kartasi
   BriefingScreen.kt                       — GET /manager/briefing/:kind
   MoneyMapScreen.kt                       — GET /manager/money-map
   KpiScreen.kt                            — GET /manager/kpi/days
   CollectionScreen.kt                     — GET /manager/collection
   — ekranlar: «Mening kunim» —
   AttendanceScreen.kt                     — bugungi holat + Keldim/Ketyapman + oylik tarix (X2)
   MyTasksScreen.kt                        — vazifalar + javob yuborish (X3)
   RoutesScreen.kt                         — smena, reyslar, qo'ldagi pul (X4, faqat haydovchi)
   MyKpiScreen.kt                          — o'z KPI kunlari + metrikalar (X5)
   MyPayrollScreen.kt                      — oy tanlagichi, jami, tarkib, bonus/jarima (X6)
   ComingSoonScreen.kt                     — bo'sh holat (X1); hozir chaqirilmaydi, X8–X9 uchun qoldirildi
app/build.gradle.kts · settings.gradle.kts — build konfiguratsiyasi (Compose) + RELEASE IMZO
tools/publish.sh                           — chiqarish (assembleRelease + imzo tekshiruvi)
tools/imzo-yarat.sh                        — release kalitni BIR MARTA yaratish
```
