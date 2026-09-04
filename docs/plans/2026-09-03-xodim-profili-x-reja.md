# X-REJA — Xodim profili (Sherset mobil ilovasi v0.2)

**Sana:** 2026-09-03 · **Muallif:** Claude (egasi bilan kelishilgan)
**Ilova:** `android/manager-app` (Sherset Menejer v0.1 poydevori ustiga quriladi)
**Maqsad:** har bir xodim o'z telefonida/planshetida O'ZINING ma'lumotlarini ko'radi: davomat (kelgan-ketgan), vazifalar, haydovchi bo'lsa — yo'nalishlar va qo'lidagi pul, KPI, oylik. Menejer esa v0.1 dagi boshqaruv ekranlarini saqlab qoladi — bitta APK, bosh ekran rolga qarab moslashadi.

---

## 0. O'ZGARMAS QOIDALAR — har bir faza agenti uchun MAJBURIY

1. **BIR SESSIYA = BIR FAZA.** Faza tugagach agent TO'LIQ TO'XTAYDI. Keyingi fazani BOSHLAMAYDI, "davom etaymi?" deb so'ramaydi ham — sessiya shu yerda tugaydi. Sabab: kontekst o'sgani sari token sarfi oshadi. Bu qoida muhokama qilinmaydi.
2. **Avval rejani to'liq o'qi** (shu fayl, boshidan oxirigacha), keyin FAQAT o'z fazangdagi vazifalarni bajar.
3. **Fayllarni FAQAT Edit/Write vositalari bilan o'zgartir.** PowerShell `Get-Content`/`Set-Content` bilan manba faylga tegish TAQIQLANGAN — 2026-09-01 da shu yo'l bilan jonliga mojibake chiqib ketgan. `apps/web/src/__tests__/no-mojibake.test.ts` qo'riqchisi bor, lekin unga yetmasdan oldin qoidaga amal qil.
4. **Jonli serverga TEGILMAYDI.** Hech qanday SSH, hech qanday jonli API so'rovi. Deploy — X7 dan keyin egasi bilan alohida sessiyada, deploy oynasida (20:00–04:30).
5. **Daraxt umumiy.** Unda boshqa sessiyalarning ishlari turibdi (manager-app v0.1, `general_manager` shabloni, TSD 0.3.0 qoldiqlari). Faqat o'z fazangga tegishli fayllarni o'zgartir. Commit: O'Z fayllaringni faylma-fayl `git add` qilib BITTA commit (subject kichik harf — commitlint), boshqa o'zgarishlarga tegma, **push YO'Q**.
6. **Testlar majburiy.** Har fazada: (a) o'zing yozgan yangi testlar; (b) tegishli modul(lar)ning mavjud testlari; (c) `apps/api` typecheck (`NODE_OPTIONS=--max-old-space-size=8192` kerak bo'lishi mumkin); (d) ilova o'zgargan bo'lsa `assembleDebug` (`JAVA_HOME=D:/dev/java/jdk-17`, Gradle 8.7) — BUILD SUCCESSFUL bo'lishi shart. Test yuritish usulini `apps/api/package.json` dagi test skriptidan aniqla.
7. **Own-only xavfsizlik shartnomasi:** har bir yangi `my`-endpoint uchun MANFIY test shart — (a) boshqa xodimning ma'lumoti javobga tushmasligi; (b) `?employeeId=` kabi query-param bilan o'zgani so'rab bo'lmasligi (server parametrni e'tiborsiz qoldiradi yoki 403). Bir xodim boshqasining oyligini/vazifasini ko'rishi = jiddiy hodisa.
8. **Halol raqamlar shartnomasi:** `null` ≠ 0 («—»/«hisoblanmadi» chiqadi), valyutalar qo'shilmaydi, yarim yig'indi ko'rsatilmaydi. Ekranlarda ham, API javoblarida ham.
9. **Compose saboqlari:** ekran almashishda `key(screen)` majburiy (usiz `LaunchedEffect(Unit)` qayta yurmaydi); yangi `overflow`+`flex-col` konteynerlarda TSD'dagi shrink saboqlarini esla.
10. **Hisobot majburiy:** faza tugagach SHU FAYLNING pastidagi «Faza hisobotlari» bo'limiga o'z bo'limingni yoz (shablon o'sha yerda): nima qilinding, qaysi fayllar, test natijalari raqamlar bilan, topilmalar/og'ishlar, commit hash. Hisobotsiz faza tugagan hisoblanmaydi.

---

## 1. Kontekst — nima BOR, nima YO'Q (2026-09-03 o'lchangan)

**Ilova:** `android/manager-app` — Sherset Menejer v0.1 (login + refresh-cookie sessiya, plitkali bosh ekran, Brifing/Tushum/KPI/Undirish, o'z-o'zini yangilash). APK 12,3 MB, assembleDebug yashil. Login javobida (`auth.schema.ts:100-127`) `user.hrRoles: string[]` va `user.hrPermissions: [{pageKey, section, accessLevel}]` KELADI — bosh ekran plitkalarini shundan chizamiz, qo'shimcha so'rov kerak emas.

**Server — tayyor endpointlar (yozish kerak emas):**
- Davomat (bugungi): `GET /hr/attendance/my/today`, `POST /hr/attendance/my/check-in|check-out|opt-in`, `POST /hr/attendance/ping` — `ping.controller.ts`, JwtAuthGuard, `employeeId = user.sub`. Javob: `{optIn, workLocation, schedule, today:{checkInTime,checkOutTime,lateMinutes,...}, status: not_arrived|at_work|left}`.
- Haydovchi: `GET /driver-tracking/my/trips` (oxirgi 20 ta reys), `POST /driver-tracking/shifts/start|end`, `GET /driver-tracking/shifts/current`, `GET /driver-cash/mine`, `POST /driver-cash/collect` — hammasi JwtAuthGuard, o'z-o'ziga scoped.
- Vazifaga javob: `POST /hr/tasks/logs/:id/answer` — `tasks:own_only`, egalik servisda tekshiriladi.

**Server — YO'Q, X-rejada yaratiladi:**
- Davomat tarixi (oylik): bloklar tayyor (`monthly-report.util.ts`, `davomat-report.service.ts`), faqat `my/history` o'rami kerak → **X2**.
- Xodimning o'z vazifalar ro'yxati: `GET /hr/tasks/logs` guardi `tasks:read` talab qiladi, `own_only` o'tmaydi; ustiga `hr-task-send.service.ts:325-327` da `?employeeId=` override NUQSONI bor → **X3**.
- O'z KPI'si: `hr-kpi.controller.ts` self-scope bilmaydi, `manager/kpi` `employees:read` talab qiladi; ma'lumot `EmployeeDailyKpi` da tayyor → **X5**.
- O'z oyligi: `GET /hr/payroll/:yearMonth` `oylik:read` talab qiladi, `listMonthly` da `employeeId` filtri yo'q → **X6**.

**HR ruxsat modeli:** `hr-permission.guard.ts` — `ACCESS_RANK = {own_only:1, read:2, full:3}`, guard faqat darvoza, MA'LUMOTNI FILTRLAMAYDI (filtrlash servis/kontrollerda). `own_only` eng past daraja — `read` talab qilgan endpointga o'tmaydi. Yangi my-endpointlar `@RequireHrPermission('<page>','own_only')` bilan ochiladi.

---

## 2. Fazalar

> Har faza: vazifalar → qabul mezonlari → sessiya-prompti. Fazalar tartibi majburiy (X1 poydevor, X7 yakun), lekin X2–X6 texnik jihatdan mustaqil.
>
> **X8–X9 — CHIQARISHDAN KEYINGI to'lqin** (2b-bo'lim): «xodim ish joyidan tashqarida» muammosi. Ular v0.2.0 qamroviga KIRMAYDI va X7 dan oldin boshlanmaydi.

---

### X1 — Bosh ekran rolga moslashadi («Mening kunim» poydevori)

**Faqat ilova.** Server o'zgarmaydi.

**Vazifalar:**
1. `LoginScreen`/`MainActivity`/`ApiClient` oqimida login (va refresh) javobidagi `user.hrRoles` va `user.hrPermissions` ni `SessionStore` ga saqlash va `Shell` orqali ekranlarga berish.
2. `HomeScreen` ni ikki bo'limli qilish:
   - **«Boshqaruv»** — mavjud 4 plitka (Brifing/Tushum/KPI/Undirish). Ko'rsatish sharti: `hrRoles` da `manager`/`admin` bor YOKI `hrPermissions` da `employees` sahifasi `read`+ bor. Shart bajarilmasa bo'lim umuman chizilmaydi (403 ekranga olib bormaymiz).
   - **«Mening kunim»** — HAMMA xodimga ko'rinadi: Davomat · Ishlarim · Mening KPI'im · Oyligim plitkalari. X1 da ular ochilganda «Tez orada» (bo'sh holat) ekrani chiqadi — haqiqiy ekranlar X2–X6 da ulanadi. Haydovchi plitkasi («Yo'nalishlarim») faqat `hrRoles` da `driver` bo'lsa chiziladi.
3. Bo'lim sarlavhalari, yangi plitka ikonkalari, `strings.xml` matnlari (uz).
4. Bo'sh-holat ekrani (`ComingSoonScreen`) — nom + «bu bo'lim keyingi yangilanishda ochiladi».

**Qabul mezonlari:** assembleDebug SUCCESSFUL; menejer-login stsenariysida ikkala bo'lim, oddiy-xodim stsenariysida faqat «Mening kunim» (buni ilova ichidagi mantiqni birlik testi bilan bo'lmasa, `hrPermissions` parse funksiyasini alohida sinf qilib JVM-testsiz bo'lsa ham kod ko'rigi bilan asosla — hech bo'lmasa parse mantig'ini `SessionStore` dan ajratib sof-funksiya qil); mavjud v0.1 ekranlari regressiyasiz.

**Prompt (yangi sessiyaga aynan shuni ber):**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X1-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X1 vazifalarini bajar: android/manager-app bosh ekranini rolga
moslashtir («Boshqaruv» + «Mening kunim» bo'limlari, hrRoles/hrPermissions
sessiyada saqlanadi, ComingSoon ekranlar). Qabul mezonlarini bajar,
assembleDebug yurit, o'z fayllaringni bitta commit qil (push YO'Q),
reja pastidagi «Faza hisobotlari» bo'limiga X1 hisobotini yoz va TO'XTA —
keyingi fazani BOSHLAMA.
```

---

### X2 — Davomat (kelgan-ketgan)

**Server:** `GET /hr/attendance/my/history?yearMonth=YYYY-MM` — JwtAuthGuard (my/today naqshida), `employeeId = user.sub`, javob: kunlar ro'yxati `{date, checkInTime|null, checkOutTime|null, lateMinutes|null, isDayOff, autoClosed}` + oy jamlari (kech qolgan kunlar soni, ishlangan kunlar). `monthly-report.util.ts`/`davomat-report.service.ts` bloklaridan foydalaning — yangi hisob mantiqini QAYTA YOZMANG.

**Ilova:** «Davomat» ekrani:
1. Tepada bugungi holat kartasi (`my/today` dan): status (kelmagan/ishda/ketgan), kelish-ketish vaqtlari, kechikish; `status` ga qarab **«Keldim»** / **«Ketyapman»** tugmasi (`my/check-in|check-out`). optIn bo'lmasa — opt-in taklifi.
2. Pastda oylik tarix (`my/history`): kun-qatorlar, kech qolgan kun sariq, kelmagan kun qizil, dam olish kulrang; oy tanlagichi (oldingi/keyingi).

**Qabul mezonlari:** yangi endpoint uchun testlar — o'z ma'lumoti to'g'ri keladi, BOSHQA xodim ma'lumoti kelmaydi, `?employeeId=` e'tiborsiz (0-bo'lim 7-qoida); attendance modulining mavjud testlari yashil; typecheck 0; assembleDebug SUCCESSFUL.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X2-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X2 ni bajar: serverda GET /hr/attendance/my/history endpointi
(mavjud util/servis bloklaridan), ilovada Davomat ekrani (bugungi holat +
Keldim/Ketyapman + oylik tarix), X1 dagi ComingSoon o'rniga ulanadi.
Manfiy own-only testlar majburiy. Testlar+typecheck+assembleDebug yashil
bo'lgach o'z fayllaringni bitta commit qil (push YO'Q), reja pastiga X2
hisobotini yoz va TO'XTA — keyingi fazani BOSHLAMA.
```

---

### X3 — Ishlarim (vazifalar) + xavfsizlik tuzatishi

**Server:**
1. 🔴 **Nuqson tuzatiladi:** `hr-task-send.service.ts:325-327` — own-scope o'rnatilgach `filter.employeeId` uni qayta yozadi; endi o'zga xodimni so'rash faqat `tasks:read`+ da mumkin bo'lsin, own-scope'da param E'TIBORSIZ qolsin. Regress-test shart.
2. `GET /hr/tasks/my?status=&limit=` — `@RequireHrPermission('tasks','own_only')`, `employeeId = user.sub` qat'iy; javobda vazifa matni, muddat, holat, javob talab qilinishi.

**Ilova:** «Ishlarim» ekrani: vazifa kartalari (holat plashkasi: yangi/javob kutilmoqda/qabul/rad), muddati o'tgan qizil; vazifaga **matnli javob yuborish** (`POST /hr/tasks/logs/:id/answer` — allaqachon own_only). v0.1 dagi «faqat o'qish» qoidasidan bu ATAYLAB istisno: javob berish xodimning o'z amali.

**Qabul mezonlari:** nuqson-regress testi + yangi endpoint own-only testlari; tasks modulining mavjud testlari yashil; typecheck 0; assembleDebug SUCCESSFUL.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X3-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X3 ni bajar: hr-task-send.service.ts:325-327 dagi employeeId-override
nuqsonini tuzat (regress-test bilan), GET /hr/tasks/my endpointini och
(tasks:own_only), ilovada Ishlarim ekrani + vazifaga javob yuborish.
Testlar+typecheck+assembleDebug yashil bo'lgach bitta commit (push YO'Q),
reja pastiga X3 hisobotini yoz va TO'XTA — keyingi fazani BOSHLAMA.
```

---

### X4 — Yo'nalishlarim (haydovchi)

**Faqat ilova.** Server tayyor: `GET /driver-tracking/my/trips`, `GET /driver-tracking/shifts/current`, `POST /driver-tracking/shifts/start|end`, `GET /driver-cash/mine`.

**Vazifalar:** «Yo'nalishlarim» ekrani (faqat `hrRoles` da `driver`):
1. Smena kartasi: joriy smena holati + «Smenani boshlash/yakunlash» tugmalari.
2. Reyslar ro'yxati (`my/trips`): qayerga, qaysi mijozga, holati, biriktirilgan vaqti.
3. «Qo'limdagi pul» kartasi (`driver-cash/mine`) — valyutalar alohida, qo'shilmaydi.

**Qabul mezonlari:** typecheck 0 (server tegilmagani uchun api testlari shart emas, lekin build yashil); assembleDebug SUCCESSFUL; driver bo'lmagan xodimda plitka chizilmasligi X1 mantig'ida tasdiqlangan.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X4-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X4 ni bajar: ilovada Yo'nalishlarim ekrani (smena boshlash/yakunlash,
my/trips reyslar, driver-cash/mine — valyutalar alohida). Server o'zgarmaydi.
assembleDebug yashil bo'lgach bitta commit (push YO'Q), reja pastiga X4
hisobotini yoz va TO'XTA — keyingi fazani BOSHLAMA.
```

---

### X5 — Mening KPI'im

**Server:** `GET /hr/kpi/my?limit=30` — `@RequireHrPermission('oylik','own_only')` YOKI JwtAuthGuard+qat'iy self (attendance naqshi; qaysi biri to'g'riligini `hr-permission-adapter` bilan solishtirib tanla va hisobotda asosla), `EmployeeDailyKpi`/`EmployeeDailyKpiMetric` dan `employeeId = user.sub` bo'yicha kunlar: sana, holat, ball (`score:null` ≠ 0!), metrikalar, signallar. `manager/kpi` kodiga TEGMA — alohida yengil kontroller.

**Ilova:** «Mening KPI'im» ekrani — menejer KPI ekrani uslubida, lekin faqat o'z kunlari: ball, holat plashkasi, signallar; kartani ochganda metrikalar ro'yxati (drilldown soddalashtirilgan).

**Qabul mezonlari:** own-only manfiy testlar; kpi modullarining mavjud testlari yashil; typecheck 0; assembleDebug SUCCESSFUL.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X5-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X5 ni bajar: serverda GET /hr/kpi/my (EmployeeDailyKpi'dan, qat'iy
self-scope, score:null≠0 shartnomasi), ilovada Mening KPI'im ekrani.
Manfiy own-only testlar majburiy. Testlar+typecheck+assembleDebug yashil
bo'lgach bitta commit (push YO'Q), reja pastiga X5 hisobotini yoz va
TO'XTA — keyingi fazani BOSHLAMA.
```

---

### X6 — Oyligim (eng qattiq xavfsizlik fazasi)

**Server:** `GET /hr/payroll/my/:yearMonth` — `@RequireHrPermission('oylik','own_only')`, `hr-payroll.service.listMonthly` ga `employeeId` filtri qo'shiladi (mavjud chaqiruvlar buzilmaydi), javob FAQAT o'z qatori: hisoblangan summa, tarkibi (baza/bonus/jarima — formula util'laridan qaysi maydonlar chiqsa o'shalar), oy holati. Bonus/jarima ro'yxati ham o'ziniki bo'lsa qo'shilsin (`hr-bonus-fine` dan self-filter bilan) — imkoni bo'lmasa hisobotda sabab yoz.

**Ilova:** «Oyligim» ekrani: oy tanlagichi, jami summa katta kartada, tarkib qatorlari, «hisoblanmagan oy» bo'sh holati. Hech qanday boshqa xodim ismi/summasi ekranga chiqishi MUMKIN EMAS.

**Qabul mezonlari:** manfiy testlar KENGAYTIRILGAN — boshqa xodim, boshqa account, `oylik` ruxsati umuman yo'q xodim (403); payroll modulining mavjud testlari yashil; typecheck 0; assembleDebug SUCCESSFUL.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X6-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X6 ni bajar: serverda GET /hr/payroll/my/:yearMonth (oylik:own_only,
listMonthly'ga employeeId filtri, faqat o'z qatori), ilovada Oyligim ekrani.
Bu eng qattiq xavfsizlik fazasi — kengaytirilgan manfiy testlar majburiy.
Testlar+typecheck+assembleDebug yashil bo'lgach bitta commit (push YO'Q),
reja pastiga X6 hisobotini yoz va TO'XTA — keyingi fazani BOSHLAMA.
```

---

### X7 — Yakun: versiya, release-imzolash, publish, yagona smoke-reja

**Vazifalar:**
1. Versiya 0.1.0 → **0.2.0** (versionCode 2), ilova nomi «Sherset Menejer» → «**Sherset**» (endi hamma xodim uchun) — `strings.xml`, README yangilanadi.
2. **Release-imzolash:** `keystore` yaratish bo'yicha yo'riqnoma + `signingConfigs.release` (keystore fayli va parollar REPOga KIRMAYDI — `local.properties`/env orqali; `.gitignore` tekshirilsin). Keystore'ni yaratishni egasi qiladi — yo'riqnomani README'ga yoz, build konfiguratsiyasini tayyorla, `assembleRelease` konfiguratsiya darajasida xato bermasligini tekshir (keystore yo'qligi kutilgan to'siq — buni hisobotda ayt).
3. `tools/publish.sh` ni tekshir/yangila (`/var/www/kassa-downloads/menejer`, latest.json, SHA-256) — YURITMA, faqat tayyorla.
4. **Yagona smoke-reja** yoz (`docs/ops/` ga yangi fayl): menejer oqimi (v0.1: login, brifing, tushum, KPI, undirish) + xodim oqimi (X1–X6: plitkalar rolga mos, davomat keldim/ketdim, ishlarim+javob, haydovchi reyslari, KPI, oylik) + xavfsizlik bandlari (oddiy xodim menejer bo'limini KO'RMAYDI, boshqa xodim ma'lumoti hech qayerda chiqmaydi) — har band «kim, qaysi qurilmada, nimani bosadi, nima kutiladi» ko'rinishida.
5. To'liq yakuniy tekshiruv: api typecheck + tegishli test to'plami, assembleDebug, X1–X6 hisobotlarini o'qib chiqib nomuvofiqlik bo'lsa ro'yxatini yoz.

**Qabul mezonlari:** assembleDebug SUCCESSFUL (0.2.0); smoke-reja fayli tayyor; barcha hisobotlar jamlangan yakuniy xulosa (nima jonliga tayyor, nima egasidan kutilmoqda: keystore, deploy oynasi, `ops-menejer-rol.ts`).

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X7-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X7 ni bajar: versiya 0.2.0 + ilova nomi «Sherset», release-imzolash
konfiguratsiyasi (keystore'siz, yo'riqnoma bilan), publish.sh tayyorligi,
docs/ops ga yagona smoke-reja, yakuniy tekshiruv va X1–X6 hisobotlari
jamlamasi. Jonliga TEGMA. Bitta commit (push YO'Q), reja pastiga X7
hisobotini yoz va TO'XTA.
```

---

## 2b. Keyingi to'lqin — «xodim ish joyidan tashqarida» (v0.3, X7 dan KEYIN)

> 🔴 **Bu ikki faza v0.2.0 QAMROVIDAN TASHQARIDA.** X7 chiqarish darvozasi bo'lib qolaveradi: X1–X7 chiqarilib, jonlida ishlagach boshlanadi. Sabab — X8 davomatning ANIQ-CHEGARASIGA (geofence) tegadi, uni chiqarish oldidan aralashtirish xavfli.
>
> **Muammo (X2 da o'lchandi):** xodim Toshkentga (yoki boshqa ombor/mijozga) ish bilan ketsa, «Keldim» tugmasi `reason: 'outside'` bilan rad etiladi va **hech qanday yozuv yaratilmaydi** — oylik tarixda o'sha kun «Kelmadi» (qizil) bo'lib qoladi. Ishlagan odam kelmagan bo'lib yozilib qoladi; tuzatishning yagona yo'li — HR web ERP'da qo'lda yozuv qo'shishi.
>
> **Yechim ikkiga bo'lindi ATAYLAB:** X8 — arzon va aldash yuzasini OCHMAYDIGAN qism (kompaniyaning o'z ombori); X9 — odam tasdig'i kerak bo'ladigan qism. X8 X9 siz ham to'liq foyda beradi, X9 esa X8 siz ortiqcha ish yaratadi (boshqa omborga borgan har xodim so'rov yozishga majbur bo'lardi). **Tartib majburiy: X8 → X9.**

---

### X8 — Geofence xodimga biriktirilgan HAMMA ish joyiga (boshqa omborga borish)

**Faqat server.** Ilova o'zgarmaydi, migratsiya KERAK EMAS.

**Hozirgi holat (kod bo'yicha o'lchandi):** `ping-ingest.service.ts` ning IKKALA yo'lida ham — `ingest()` (avtomatik ping) va `manualCheckIn()` («Keldim») — geofence FAQAT `emp.workLocationId` ga, ya'ni bitta biriktirilgan joyga solishtiriladi. Kompaniyada 7+ ombor bor.

🟢 **Muhim topilma:** `HrEmployeeBranch` jadvali (xodim ↔ bir nechta `HrWorkLocation`, `@@id([employeeId, workLocationId])`) **bazada ALLAQACHON bor** — migratsiya `20260724133452_hr_timepay_attendance_core`. Lekin serverda HECH QAYERDA o'qilmaydi (`grep` — faqat generatsiya qilingan Prisma klientida uchraydi). Ya'ni jadval bor, kodi yo'q. **Egasidan so'raladi: jonlida bu jadval to'ldirilganmi?** Bo'sh bo'lsa X8 ni to'ldirish yo'li (HR ekranida biriktirish) ham kerak bo'ladi — buni faza boshida o'lchab, hisobotda ayt.

**Vazifalar:**
1. Yagona util/servis: `resolveAllowedLocations(accountId, employeeId)` → xodimning asosiy `workLocationId` **+** `HrEmployeeBranch` dagi qatorlari; `archived: false` bo'lgan `HrWorkLocation` lar, hammasi `accountId` bilan chegaralangan.
2. `manualCheckIn()` va `ingest()` — ruxsat etilgan joylardan **BIRORTASIGA** kirsa `inside`. Yozuvga MOS KELGAN joyning `workLocationId` si yoziladi (hozir doim `emp.workLocationId` yoziladi — shu tuzatiladi, aks holda menejer paneli xodimni noto'g'ri filialda ko'rsatadi).
3. Kechikish hisobi O'ZGARMAYDI — `resolveShift` xodimning o'z jadvalidan (§5.1 «yagona sanksiyalangan manba»).
4. Hech bir ruxsat etilgan joyga kirmasa — hozirgidek `outside` (xulq o'zgarmaydi).
5. `isInsideGeofence`/`haversine` utillariga TEGILMAYDI — faqat chaqiruvchi tomon o'zgaradi.

🔴 **Xavfsizlik chegarasi — muhokama qilinmaydi:** ruxsat etilgan joylar **xodimga BIRIKTIRILGAN** bo'lishi shart. «Akkauntning hamma ish joylari» degan yechim TAQIQLANGAN — uyi boshqa ombor radiusiga tushadigan xodim uydan «keldim» bosib qo'yardi, ya'ni geofence ma'nosini yo'qotardi.

**Qabul mezonlari:** yangi util testlari — asosiy joyda `inside` · qo'shimcha filialda `inside` · begona nuqtada `outside` · **arxivlangan joy hisobga OLINMAYDI** · **boshqa akkauntning joyi HECH QACHON hisobga olinmaydi** · yozuvdagi `workLocationId` mos kelgan joyniki; `ping-ingest.service.test.ts` ning mavjud 17 testi yashil; attendance-geo moduli yashil; typecheck 0. Ilova tegilmagani uchun assembleDebug shart emas.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X8-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
FAQAT X8 ni bajar: geofence tekshiruvi xodimga biriktirilgan HAMMA ish
joyiga (asosiy workLocationId + HrEmployeeBranch) solishtirilsin, yozuvga
mos kelgan joy yozilsin — manualCheckIn va ingest yo'llarining IKKALASIDA.
«Akkauntning hamma joylari» yechimi TAQIQLANGAN. Migratsiya YOZMA (jadval
bazada bor). Testlar+typecheck yashil bo'lgach bitta commit (push YO'Q),
reja pastiga X8 hisobotini yoz va TO'XTA — keyingi fazani BOSHLAMA.
```

---

### X9 — «Tashqarida ish» — so'rov va menejer tasdig'i

**Server + ilova + migratsiya.** X8 tugamaguncha BOSHLANMAYDI.

**Vazifalar:**

1. **Prisma modeli** (yangi jadval, mavjud jadvallarga ALTER YO'Q — «qo'shimcha-only» qoidasi): `HrAttendanceRemoteRequest` — `accountId`, `employeeId`, `requestedAt`, `lat`, `lng`, `accuracy`, `distanceMeters`, `reason` (matn), `status` (`pending|approved|rejected|expired`), `decidedById`, `decidedAt`, `decisionNote`, `attendanceId` (tasdiqlangach yaratilgan yozuv — xom FK, `workLocationId` naqshi). **Migratsiya YOZILADI, jonliga QO'LLANMAYDI** (0-bo'lim 4-qoidasi).
2. **Server — xodim tomoni:**
   - `POST /hr/attendance/my/remote-request` — JwtAuthGuard, `employeeId = user.sub`, tana `{lat, lng, accuracy, reason}`. `reason` MAJBURIY (bo'sh/probel — 400): sababsiz so'rov menejerga qaror qilish uchun hech narsa bermaydi.
   - 🔴 **Masofani SERVER hisoblaydi** (`haversine.util.ts`), klient yuborgan masofaga ISHONILMAYDI.
   - Bir kunda bitta ochiq so'rov — takrori `already_pending` (yangi qator YARATMAYDI).
   - Ochiq so'rov `my/today` javobida ko'rinadi (ekran «tasdiq kutilmoqda» deb chizishi uchun).
3. **Server — menejer tomoni:**
   - `GET /hr/attendance/remote-requests?status=pending` — `@RequireHrPermission('employees','read')`.
   - `POST /hr/attendance/remote-requests/:id/approve` va `/reject` — `@RequireHrPermission('employees','full')`, tanasida izoh.
   - Javobda menejer ko'radigan HAMMASI: xodim, sabab, **koordinata va ish joyidan masofa**, so'rov vaqti. Aynan shu masofa oqimni halol saqlaydi — «Toshkentdaman» degan odam uyidan 200 m da bo'lsa menejer buni ko'radi.
   - Tasdiqlanganda `HrAttendance` yaratiladi: 🔴 `checkInTime` = **SO'ROV vaqti**, tasdiq vaqti EMAS (aks holda xodim menejerning sekinligi uchun kechikkan bo'lib chiqadi); `source` = yangi qiymat (`remote_approved`), `workLocationId` = `null`, `editedById` = tasdiqlagan odam, `notes` = sabab. Kechikish `resolveShift` bo'yicha SO'ROV vaqtidan.
4. **Muddat:** kun oxirigacha javob bo'lmasa kron `expired` qiladi va egaga chiqaradi (`davomat-autocheckout.cron.ts` naqshi). 🔴 Javobsiz qolgan so'rov JIMGINA «kelmadi» ga aylanib qolmasligi kerak.
5. **Xabar:** mavjud infratuzilma — `HR_EVENT` + `attendance-notify.service.ts` (direktor Telegram sloti). Yangi kanal QURILMAYDI.
6. **Ilova:** `AttendanceScreen` da `reason == 'outside'` javobidan keyin «Ish yumushi bilan tashqaridaman» tugmasi → sabab matni maydoni → so'rov. Holat kartasida «tasdiq kutilmoqda» ko'rinishi. (Sabab lug'ati tarjimasi allaqachon `reasonRes()` da.)
7. **Tarixda ALOHIDA ko'rinsin:** tasdiqlangan kun `status: 'remote'` (yoki `approvedRemote: true`) — «keldi» bilan bir xil rangda EMAS. Oy jamlarida alohida sanaladi (`remoteDays`). 🔴 Halol raqamlar shartnomasi: GPS bilan tasdiqlangan kun va ODAM tasdiqlagan kun bir xil narsa emas.

**Qabul mezonlari:** own-only manfiy testlar — o'zganing so'rovini yubora olmaslik, `employees:full` siz tasdiqlab bo'lmasligi (403), boshqa akkauntning so'rovi ko'rinmasligi; masofa serverda hisoblanishi (klient yolg'on masofa yuborsa e'tiborsiz); kechikish SO'ROV vaqtidan hisoblanishi; muddati o'tgan so'rov `expired` bo'lishi; takroriy so'rov qo'sh qator yaratmasligi; attendance-geo moduli yashil; typecheck 0; assembleDebug SUCCESSFUL.

**Egasidan javob kutiladigan ochiq savollar (faza boshida so'ralsin, hisobotda yozilsin):**
- **Kim tasdiqlaydi?** `employees:full` bo'lgan HAR KIMMI, yoki aniq bir odam/bo'lim boshlig'imi? Hozir «menejer» degan aniq egasi tizimda YO'Q.
- **Avto-jarima** (`HrAttendanceNotifyConfig.lateFineEnabled`) tasdiq kutayotgan kunga qanday munosabatda bo'ladi — kutadimi, tasdiqdan keyin hisoblanadimi?
- **Rejalashtirilgan xizmat safari** (oldindan ma'lum kunlar) alohida kerakmi? Tizimda ta'til/safar modeli UMUMAN YO'Q (24 ta `Hr*` modeli tekshirildi) — kerak bo'lsa bu alohida faza.

**Prompt:**
```
D:\sherset-v2\docs\plans\2026-09-03-xodim-profili-x-reja.md rejasini TO'LIQ o'qi.
Sen X9-faza agentisan. 0-bo'limdagi o'zgarmas qoidalarga so'zsiz amal qil.
X8 tugaganini tekshir — tugamagan bo'lsa TO'XTA va shuni ayt.
FAQAT X9 ni bajar: HrAttendanceRemoteRequest modeli (migratsiya yoziladi,
jonliga QO'LLANMAYDI), xodim so'rovi + menejer tasdig'i endpointlari,
tasdiqlanganda checkInTime = SO'ROV vaqti, muddat kroni, ilovada so'rov
oqimi va tarixda alohida ko'rinish. Manfiy own-only testlar majburiy.
Testlar+typecheck+assembleDebug yashil bo'lgach bitta commit (push YO'Q),
reja pastiga X9 hisobotini yoz va TO'XTA.
```

---

## 3. Faza hisobotlari (agentlar to'ldiradi)

> Shablon — har agent o'z fazasi uchun aynan shu tuzilmada yozadi:
>
> ```
> ### X<N> hisoboti — <sana>
> **Holat:** ✅ bajarildi / ⚠️ qisman (sabab) / ❌ bajarilmadi (sabab)
> **O'zgargan/yangi fayllar:** (ro'yxat, qisqa izoh bilan)
> **Testlar:** (nima yuritildi, nechta o'tdi/yiqildi, typecheck, assembleDebug)
> **Topilmalar/og'ishlar:** (rejadan chetlashish, yangi nuqson, keyingi fazaga eslatma)
> **Commit:** <hash> (push yo'q)
> ```

<!-- HISOBOTLAR SHU YERDAN PASTGA QO'SHILADI -->

### X1 hisoboti — 2026-09-04

**Holat:** ✅ bajarildi

**O'zgargan/yangi fayllar** (hammasi `android/manager-app/`; server TEGILMADI):

| Fayl | Nima qilindi |
|---|---|
| `app/src/main/java/uz/sherset/manager/HrAccess.kt` | **YANGI.** `HrPermission` data-sinfi + `HrAccess` — rol/ruxsat qarorining SOF FUNKSIYALARI (`rank`, `hasPage`, `hasAnyRole`, `canSeeManagement`, `isDriver`). Android'ga ham, `org.json` ga ham bog'lanmaydi ⇒ oddiy JVM testi bilan sinaladi. `ACCESS_RANK` server bilan bir xil (`own_only:1, read:2, full:3`). |
| `app/src/main/java/uz/sherset/manager/SessionUser.kt` | **YANGI.** Login/refresh javobidagi `user` obyektini o'qish va diskka yozish (`org.json` shu yerda, qaror mantig'i emas). `fromJson` `null` qaytarsa — javobda `user` UMUMAN yo'q; bo'sh massiv esa haqiqiy javob (rol yo'q). Ikkisi ataylab farqlanadi. |
| `app/src/main/java/uz/sherset/manager/ComingSoonScreen.kt` | **YANGI.** Bo'sh holat: nom + «Bu bo'lim keyingi yangilanishda ochiladi». Hech qanday so'rov yubormaydi. |
| `app/src/test/java/uz/sherset/manager/HrAccessTest.kt` | **YANGI.** 16 ta JVM birlik testi (pastda). |
| `app/src/main/java/uz/sherset/manager/HomeScreen.kt` | Ikki bo'limga bo'lindi: «BOSHQARUV» (shart bajarilsa) + «MENING KUNIM» (hammaga). Plitkalar `TileSpec` ro'yxati bo'lib, `TileGrid` ularni 2 ustunga teradi (toq sonda oxirgisi yarim enda qoladi — `Spacer(weight(1f))`). |
| `app/src/main/java/uz/sherset/manager/MainActivity.kt` | `hrRoles`/`hrPermissions` — Compose state (`private set`); `applyUser()` login/refresh javobini qobiq+diskka yozadi; `enterWork(SessionUser)`; `logout()`/`onSessionExpired()` da rol/ruxsat tozalanadi. |
| `app/src/main/java/uz/sherset/manager/Shell.kt` | Shartnomaga `hrRoles: List<String>` va `hrPermissions: List<HrPermission>` qo'shildi. |
| `app/src/main/java/uz/sherset/manager/SessionStore.kt` | Rol/ruxsat shifrlangan prefs'da (`hr_roles`, `hr_permissions`) — `clear()` bilan birga o'chadi. Tarmoq yo'q holatda oxirgi ma'lum rol ishlatiladi. |
| `app/src/main/java/uz/sherset/manager/ApiClient.kt` | `onUserRefreshed` qayta-chaqiruvi — refresh javobidagi `user` qobiqqa uzatiladi. |
| `app/src/main/java/uz/sherset/manager/LoginScreen.kt` | `onLoggedIn` endi `SessionUser` beradi (ilgari faqat `name` edi). |
| `app/src/main/res/values/strings.xml` | 8 ta yangi satr: `home_section_management`, `home_section_myday`, `tile_attendance`, `tile_my_tasks`, `tile_my_kpi`, `tile_my_payroll`, `tile_my_routes`, `coming_soon_note`. |
| `app/build.gradle.kts` | `testImplementation("junit:junit:4.13.2")` — FAQAT test yo'lida, APK'ga tushmaydi. |

**Ko'rinish qoidasi (kodda bitta joyda — `HrAccess`):**
- «BOSHQARUV» = `hrRoles` da `manager`/`admin`, YOKI `hrPermissions` da `employees` sahifasi `read`+. Shart bajarilmasa bo'lim UMUMAN chizilmaydi (403 ekranga bormaydi).
- «MENING KUNIM» = hammaga: Davomat · Ishlarim · Mening KPI'im · Oyligim (to'rttasi ham hozircha `ComingSoonScreen`).
- «Yo'nalishlarim» = faqat `isDriver` (X4 uchun tayyor tirgak), ro'yxat OXIRIDA — shunda haydovchi bo'lmagan xodimda qolgan plitkalar joyi o'zgarmaydi.

**Testlar:**
- `gradle testDebugUnitTest` → **16 test, 16 o'tdi, 0 yiqildi, 0 xato** (`app/build/test-results/testDebugUnitTest`). Qamrov: menejer/admin ko'radi · oddiy xodim (`staff`,`cashier`) KO'RMAYDI · rolsiz-ruxsatsiz xodim KO'RMAYDI · haydovchi KO'RMAYDI · `employees:read` va `employees:full` ochadi · `employees:own_only` YETMAYDI · boshqa sahifa `full` bo'lsa ham ochmaydi · bo'lim-darajali (`section`) qator ham hisobga olinadi · past qator yuqorisini to'smaydi · registr/bo'sh joy chidamliligi · nomalum daraja = 0 huquq · darajalar tartibi server bilan bir xil.
- `gradle assembleDebug` → **BUILD SUCCESSFUL** (JDK 17, Gradle 8.7). APK `app-debug.apk` = 12 990 112 bayt (~12,4 MiB — v0.1 bilan amalda bir xil, ikonkalar core to'plamdan).
- Boshlashdan OLDIN mos yozuvlar (baseline) `assembleDebug` ham yashil edi — ya'ni yashil natija shu fazaga tegishli.
- `apps/api` typecheck (`tsc --noEmit`, `--max-old-space-size=8192`) → **0 xato** (server o'zgarmagani uchun formallik, 0-bo'lim 6-qoidasi bo'yicha yuritildi).

**Topilmalar/og'ishlar:**
1. 🔴 **Kotlin izohida `manager/*` yozib bo'lmaydi.** Kotlin blok-izohlari UYALI: KDoc ichidagi `manager/*` yangi izoh ochadi, keyingi `*/` esa faqat o'shani yopadi — natijada fayl oxirigacha «unclosed comment» va sirli «Unresolved reference» xatolari. Tuzatildi (`manager/…` deb yozildi). **X2–X7 ga eslatma:** Kotlin izohlarida `manager/*`, `hr/*`, `driver-tracking/*` kabi yo'l naqshlarini yozmang — `…` ishlating.
2. ⚠️ **Haydovchi rolining qiymati tasdiqlanmagan.** `hrRoles` — erkin lug'at (`HrRole.value`); `packages/db/prisma/seed-hr.ts` da faqat `admin/manager/cashier/warehouse/staff` bor, `driver` YO'Q. Shuning uchun `HrAccess.DRIVER_ROLES = {"driver", "haydovchi"}` (registrga befarq) qilindi. **Egasidan so'raladi:** jonlida haydovchilarga qaysi qiymat qo'yilgan? X4 dan oldin aniqlanmasa haydovchi «Yo'nalishlarim» plitkasini ko'rmaydi (fail-closed — xavfsiz, lekin foydasiz).
3. **Rejadan tashqari qo'shimcha:** `ApiClient.onUserRefreshed`. Sababi — `token.service.ts` rol/ruxsatni XODIMDAN qayta quradi, ya'ni admin rolni olib qo'ysa keyingi refreshda qobiq buni biladi va «Boshqaruv» bo'limi o'sha zahoti yo'qoladi (aks holda chiqib-kirmaguncha eski plitkalar qolardi). Rol/ruxsat har javobda TO'LIQ almashtiriladi, qo'shilmaydi.
4. **Commit qamrovi — diqqat.** `android/manager-app/` daraxtda BUTUNLAY kuzatilmagan (v0.1 sessiyasi ham `push YO'Q` bilan tugagan). 0-bo'lim 5-qoidasi «faqat o'z fayllaringni» deydi, shuning uchun commitga FAQAT yuqoridagi 12 fayl kirdi; `BriefingScreen.kt`, `MoneyMapScreen.kt`, `KpiScreen.kt`, `CollectionScreen.kt`, `Theme.kt`, `Widgets.kt`, `Fmt.kt`, `Updater.kt`, `UpdateCard.kt`, `AndroidManifest.xml`, `config.xml`, `file_paths.xml`, `settings.gradle.kts`, `gradle.properties`, `.gitignore` va `README` hamon KUZATILMAGAN. **Ya'ni bu commit yolg'iz o'zi yig'ilmaydi.** Egasi v0.1 poydevorini alohida commit qilishi kerak (yoki X7 agentiga shu vazifa berilsin).
5. Ikonkalar `material-icons-core` dan tanlandi (EXTENDED to'plam ataylab yo'q, APK ~+10 MB bo'lardi): Davomat `DateRange`, Ishlarim `Edit`, Mening KPI'im `Star`, Oyligim `AccountBox`, Yo'nalishlarim `LocationOn`.
6. Klientdagi bu tekshiruv — QULAYLIK, xavfsizlik emas; haqiqiy chegara serverda (`hr-permission.guard.ts`, `@RequirePermission`). Kod izohlarida shu ataylab yozib qo'yildi.

**Commit:** kod va shu hisobot — BITTA commitda, push YO'Q. Hash ataylab yozilmadi: hisobot commitning O'ZI ichida bo'lgani uchun o'z hashini saqlay olmaydi (amend qilinsa hash yana o'zgaradi). Topish yo'li:
`git log --oneline -1 -- docs/plans/2026-09-03-xodim-profili-x-reja.md` → subject `feat(menejer): x1 — bosh ekran rolga moslashdi`.

---

### X2 hisoboti — 2026-09-04

**Holat:** ✅ bajarildi

**O'zgargan/yangi fayllar:**

*Server — `apps/api/src/modules/hr/attendance-geo/`:*

| Fayl | Nima qilindi |
|---|---|
| `attendance-geo.schema.ts` | `MyHistoryQuerySchema` — FAQAT ixtiyoriy `yearMonth` (`^\d{4}-(0[1-9]|1[0-2])$`). 🔴 `employeeId` maydoni ATAYLAB YO'Q: zod obyekti notanish kalitlarni olib tashlaydi ⇒ `?employeeId=` kontrollergacha YETIB BORMAYDI. |
| `davomat-report.service.ts` | `myHistory(accountId, employeeId, yearMonth?)` — self-scoped. Hisob mantig'i QAYTA YOZILMADI: kun/holat/jamlar `computeMonthlyAttendance` dan (menejer hisoboti bilan bir xil manba), o'ram ustiga faqat `autoClosed` va `null ≠ 0` qoidasini qo'yadi. `monthRange()` + `WEEK_SELECT` — `monthly()`/`dashboard()` dan takrorlanish olib tashlandi. |
| `ping.controller.ts` | `GET my/history` — `my/today` naqshida: `JwtAuthGuard`, `employeeId = user.sub`, `accountId = user.accountId`. `HrDavomatReportService` inyeksiya qilindi. |
| `davomat-report.service.test.ts` | +7 test (quyida). |
| `my-history.controller.test.ts` | **YANGI** — 5 ta own-only qulf testi. |

*Ilova — `android/manager-app/`:*

| Fayl | Nima qilindi |
|---|---|
| `…/Davomat.kt` | **YANGI.** Oy/kun hisobining SOF funksiyalari (`HrAccess` naqshi — Android'siz, `org.json` siz ⇒ JVM testi): `currentYearMonth` (TOSHKENT kalendari), `shiftMonth`, `canGoNext`, `monthLabel`, `dayNumber`, `weekdayLabel`, `lateLabel` (null≠0), `timeOrDash`, `localTime` (UTC→Toshkent). |
| `…/Locator.kt` | **YANGI.** Bir martalik GPS o'lchovi: ruxsat so'rash + GPS→tarmoq→yaqindagi oxirgi joy (2 daqiqadan eski OLINMAYDI), har provayderga 15 s, natija bir marta va UI thread'da. |
| `…/AttendanceScreen.kt` | **YANGI.** Bugungi holat kartasi (status plashkasi, kelish/ketish/kechikish, smena, ish joyi, `autoClosed` belgisi) + «Keldim»/«Ketyapman»/opt-in + oylik tarix (oy tanlagichi, jamlar, kun qatorlari: kech sariq, kelmagan qizil, dam kulrang). |
| `…/ApiClient.kt` | `attendanceToday/History/CheckIn/CheckOut/OptIn` + `post()` yordamchisi. |
| `…/Shell.kt` | Shartnomaga `locate(onFix)` qo'shildi. |
| `…/MainActivity.kt` | `locator` MAYDON sifatida (`registerForActivityResult` STARTED dan oldin bo'lishi shart) + `locate()` amalga oshirildi (sababni toast bilan aytadi). |
| `…/HomeScreen.kt` | «Davomat» plitkasi `ComingSoonScreen` o'rniga `AttendanceScreen` ga ulandi (qolgan 3 plitka X3–X6 ni kutadi). |
| `…/AndroidManifest.xml` | `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`. FON ruxsati va fon xizmati ATAYLAB YO'Q. |
| `…/res/values/strings.xml` | +40 satr (davomat, server rad sabablari, tarix, joylashuv xabarlari). |
| `…/test/…/DavomatTest.kt` | **YANGI** — 22 ta JVM testi. |

**Testlar:**

- `vitest run src/modules/hr/attendance-geo` → **22 fayl, 131 test, 131 o'tdi, 0 yiqildi** (shundan 12 tasi yangi).
  - Servis (7): o'z oyi kunma-kun to'g'ri · kelmagan kunda `lateMinutes = null` (0 EMAS) · kelib kechikmagan kunda `0` (null EMAS) · `autoClosed` FAQAT o'sha kunga tushadi · `yearMonth` berilmasa joriy oy va kelajak kunlar chizilmaydi · **🔴 prisma `where` da FAQAT `accountId`+`employeeId`** (kalitlar ro'yxati qat'iy tekshiriladi — kelajakda `OR`/`in` qo'shilsa test yiqiladi) · **🔴 boshqa akkaunt xodimi → bo'sh tarix va davomat jadvaliga UMUMAN so'rov ketmaydi.**
  - Kontroller (5): `employeeId` token'dan · **🔴 `?employeeId=<o'zga>` e'tiborsiz** · **🔴 `?accountId=` ham e'tiborsiz** · `yearMonth` sukut qiymati · noto'g'ri oy (13-oy, kun bilan, bo'sh) rad etiladi.
  - Vaqt qotirildi (`vi.setSystemTime`) — «joriy oy» sinovlari kalendarga bog'lanib qolmasin.
- `vitest run src/modules/hr` (butun HR moduli) → **95 fayl, 1022 test, hammasi o'tdi.**
- `tsc --noEmit` (`--max-old-space-size=8192`) → **0 xato.**
- `gradle testDebugUnitTest` → **38 test, 38 o'tdi** (22 yangi `DavomatTest` + 16 X1 `HrAccessTest`).
- `gradle assembleDebug` (JDK 17, Gradle 8.7) → **BUILD SUCCESSFUL, ogohlantirishsiz.** APK 13 034 880 bayt (~12,4 MiB; X1 dan +44 KB — yangi bog'liqlik qo'shilmadi).

**Topilmalar/og'ishlar:**

1. 🔴 **v0.1 ning «lokatsiya ATAYLAB yo'q» qoidasiga ONGLI istisno.** Server `my/check-in` ni GEOFENCE bilan tekshiradi (`ping-ingest.service.ts` — `isInsideGeofence`, aniqlik chegarasi 100 m), ya'ni koordinatasiz «Keldim» MUMKIN EMAS. Chegaralar: fon ruxsati YO'Q, fon xizmati YO'Q, o'lchov FAQAT tugma bosilganda, ruxsat ham aynan o'sha payt so'raladi. **Play Services ISHLATILMADI** (driver-app `FusedLocationProviderClient` yo'lidan farqli) — `LocationManagerCompat` androidx.core ichida, yangi bog'liqliksiz va GMS'siz planshetda ham ishlaydi.
2. 🔴 **`my/today` VAQTLARI UTC keladi — X5/X6 ga eslatma.** Nest `Date` ni `JSON.stringify` bilan beradi (`…T04:20:00.000Z`). Matndan kesib olish (`Fmt.dateTimeShort` naqshi) ekranda **5 SOAT orqadagi** vaqtni chiqarardi. Shuning uchun `Davomat.localTime` qo'shildi (`OffsetDateTime` → Toshkent), unga 4 ta test bor. **Keyingi fazalarda serverdan `Date` kelsa AYNAN shu tuzoq takrorlanadi.**
3. **Maydon nomlari rejadan, qiymat turi boshqacha:** `my/history` javobidagi `checkInTime`/`checkOutTime` — LOKAL `HH:mm` MATNI (`my/today` dagi to'liq Date'dan farq qiladi). Sababi: oy jadvalida 30 ta qator qisqa vaqt ko'rsatadi, `computeMonthlyAttendance` esa allaqachon `HH:mm` beradi. Servis izohida va JSDoc'da yozib qo'yildi.
4. **`lateMinutes: null`** — rejadagi shartnoma. `computeMonthlyAttendance` yozuv yo'q kunda `0` beradi; o'ram uni `null` ga aylantiradi, aks holda «kelmagan kun» ekranda «kechikmadi» bo'lib ko'rinardi. Jamlardagi `lateMinutesTotal` esa son bo'lib qolaveradi.
5. ⚠️ **Jadvalsiz xodimda butun oy «dam olish» ko'rinadi.** `computeMonthlyAttendance` da `scheduleFor()` null bo'lsa kun `dayoff` bo'ladi — bu MAVJUD xulq (menejer hisoboti ham shunday), o'zgartirilmadi. Ammo `EmployeeWorkSchedule` biriktirilmagan xodim «Davomat» ekranida oyni butunlay dam olish deb ko'radi. **Egasidan tekshirish so'raladi:** jonlida qaysi xodimlarda hafta jadvali yo'q? (Tuzatish X-reja qamrovidan tashqarida — u menejer hisobotiga ham tegadi.)
6. ⚠️ **`AndroidManifest.xml` shu commitga KIRITILDI.** U X1 dan keyin ham kuzatilmagan (v0.1 qoldig'i) edi, lekin X2 ruxsatlari usiz ishlamaydi — ekranning asosiy tugmasi o'lik bo'lib qolardi. Ya'ni commitda v0.1 manifestining butun matni bor, faqat mening qo'shgan qatorlarim emas.
7. **X1 ning 4-topilmasi HAMON KUCHDA:** `android/manager-app/` ning katta qismi (`BriefingScreen.kt`, `Widgets.kt`, `Theme.kt`, `Updater.kt`, `settings.gradle.kts`, `README.md`, `.gitignore`, `tools/` …) hamon KUZATILMAGAN, ya'ni X1+X2 commitlari yolg'iz o'zi yig'ilmaydi. Egasi v0.1 poydevorini alohida commit qilishi kerak (yoki X7 ga shu vazifa berilsin).
8. **Kichik refaktor:** `davomat-report.service.ts` da uch joyda takrorlangan `workSchedules` select'i → `WEEK_SELECT`, oy chegarasi hisobi → `monthRange()`. Mavjud testlar bilan qoplangan.
9. `Locator` da `android.os.CancellationSignal` ishlatildi — `androidx.core.os` varianti ham, uni oladigan `getCurrentLocation` ortiqchasi ham eskirgan (birinchi qurishda ogohlantirish chiqdi, tuzatildi).
10. Platformaning bekor qilinishi `Consumer` ni chaqirmasligi mumkin — shuning uchun `Locator` da O'Z taymeri bor va `AtomicBoolean` ikki marta chaqirilishdan qo'riqlaydi (aks holda «Yuborilmoqda…» tugmasi abadiy qotib qolardi).
11. **Commitda 17-fayl bor: `docs/progress.json`.** Uni MEN yozmadim — repo'ning O'Z pre-commit ilgagi qayta yaratib stage'ga qo'shdi (o'zgargani faqat `generatedAt` vaqt tamg'asi). `lint-staged` shu yerda biome bilan yangi test fayllarining qo'shtirnoq uslubini ham tekislab qo'ydi (testlar keyin qayta yuritildi — 131 o'tdi).
12. Daraxtda boshqa sessiyaning kuzatilgan, lekin commit qilinmagan ishi turibdi (`android/tsd-app/` — T9 release-imzo; `apps/api/src/modules/auth`, `permissions`). Ularga TEGILMADI, commitga ham kirmadi.

**Commit:** kod va shu hisobot — BITTA commitda, push YO'Q. Hash ataylab yozilmadi (X1 dagi sabab: hisobot commitning O'ZI ichida bo'lgani uchun o'z hashini saqlay olmaydi). Topish yo'li:
`git log --oneline -1 -- docs/plans/2026-09-03-xodim-profili-x-reja.md` → subject `feat(menejer): x2 — davomat ekrani va my/history endpointi`.

---

### X3 hisoboti — 2026-09-04

**Holat:** ✅ bajarildi

**O'zgargan/yangi fayllar:**

*Server — `apps/api/src/modules/hr/hr-task-send/`:*

| Fayl | Nima qilindi |
|---|---|
| `hr-task-send.service.ts` | 🔴 **NUQSON TUZATILDI** (`listLogs`): `if (filter.employeeId) where.employeeId = …` qatori `scopeEmployeeId` dan KEYIN turardi va uni bosib ketardi. Endi `if (!scopeEmployeeId && filter.employeeId)` — qamrov QAT'IY SHIFT, uni hech qanday query-param bosib o'tolmaydi. **+ `listMyTasks(accountId, employeeId, query, now)`** — «Ishlarim» uchun alohida metod (`listLogs` dan ataylab ajratilgan: u menejer jurnali, bu own-only ekran). |
| `hr-task-send.schema.ts` | `MyTasksQuerySchema` — FAQAT `status` + `limit`. 🔴 `employeeId` maydoni ATAYLAB YO'Q (X2 dagi `MyHistoryQuerySchema` naqshi): zod obyekti notanish kalitlarni olib tashlaydi ⇒ `?employeeId=` kontrollergacha YETIB BORMAYDI. |
| `hr-task-send.controller.ts` | `GET /hr/tasks/my` (`@RequireHrPermission('tasks','own_only')`, `employeeId = user.sub`). `GET logs` da qamrov qarori endi ANIQ: sukut bo'yicha tor (o'ziniki), admin — butun akkaunt, o'zgani so'rash faqat `tasks:read`+ da (`mayReadOthersTasks`). |
| `hr-task-send.service.test.ts` | +11 test (4 tasi regress + 7 tasi `listMyTasks`). |
| `my-tasks.controller.test.ts` | **YANGI** — 11 ta kontroller-darajasidagi qulf testi. |

*Ilova — `android/manager-app/`:*

| Fayl | Nima qilindi |
|---|---|
| `…/Tasks.kt` | **YANGI.** Karta mantig'ining SOF funksiyalari (`HrAccess`/`Davomat` naqshi — Android'siz, `org.json` siz ⇒ JVM testi): `dateTime` (UTC→Toshkent), `hoursLeft`, `statusTone`, `isTextAnswer`, `needsAnswer`, `isAnswerTextValid`, `isUrgent`. |
| `…/MyTasksScreen.kt` | **YANGI.** Filtr plashkalari (Javob kutmoqda / Hammasi), vazifa kartalari (holat plashkasi, muddat, shoshilinch belgisi, muddati o'tgani QIZIL kartochka), `yes_no` uchun Ha/Yo'q tugmalari, `text` uchun ko'p qatorli javob maydoni. |
| `…/ApiClient.kt` | `myTasks(status, limit)` + `answerTask(logId, type, text)`. |
| `…/HomeScreen.kt` | «Ishlarim» plitkasi `ComingSoonScreen` o'rniga `MyTasksScreen` ga ulandi (X5–X6 plitkalari hamon kutmoqda). |
| `…/res/values/strings.xml` | +27 satr (filtrlar, karta maydonlari, holat lug'ati, javob oqimi, xato matnlari). |
| `…/test/…/TasksTest.kt` | **YANGI** — 17 ta JVM testi. |

**Testlar:**

- `vitest run src/modules/hr/hr-task-send` → **2 fayl, 47 test, 47 o'tdi, 0 yiqildi** (shundan 22 tasi yangi).
  - 🔴 **Regress ISHLAYAPTI — o'lchab tekshirildi:** tuzatilgan qator vaqtincha eski holiga qaytarildi va `vitest` yuritildi → **2 test YIQILDI** (`?employeeId= e'tiborsiz` va `count ham AYNI where bilan`), tuzatish qaytarilgach yana 47/47. Ya'ni test haqiqatan o'sha nuqsonni tutadi, shunchaki yashil turmaydi.
  - Servis (11): qamrov qo'yilganda param e'tiborsiz · `count` ham AYNI `where` bilan (jami boshqa xodimniki bo'lib qolmasin) · **qamrovli `where` da FAQAT `accountId`+`employeeId`** (kalitlar ro'yxati qat'iy — kelajakda `OR`/`in` qo'shilsa test yiqiladi) · qamrovsiz (admin) chaqiruvda `?employeeId=` HAMON ishlaydi (menejer ekrani buzilmadi) · `listMyTasks` where'i qat'iy · javobda BOSHQA xodim maydonlari yo'q (`select` da `employee`/`reviewedBy` YO'Q, mukofot/jarima summasi YO'Q) · muddat = `sentAt + deadlineMinutes` · **muddatsiz shablonda `deadlineAt = null`, `overdue = false`** · muddati o'tgan `sent` → `overdue` · javob berilgan vazifa muddati o'tsa ham qizarmaydi · `responseType: 'none'` da javob tugmasi yo'q.
  - Kontroller (11): `employeeId` token'dan · **🔴 `?employeeId=<o'zga>` e'tiborsiz** · **🔴 `?accountId=` ham e'tiborsiz** · noto'g'ri `status`/`limit` (0, 201) rad etiladi · `/logs` qamrovi: admin → qamrovsiz, oddiy xodim → o'ziga, `tasks:read` + `employeeId` → ataylab o'zga, **`tasks:own_only` → qamrov O'ZIDA**, ruxsatsiz → o'zida, **boshqa sahifada `full` bo'lsa ham `tasks` ochilmaydi**.
- `vitest run src/modules/hr` (butun HR moduli) → **96 fayl, 1046 test, hammasi o'tdi.**
- `tsc --noEmit` (`--max-old-space-size=8192`) → **0 xato.**
- `no-mojibake.test.ts` qo'riqchisi → 4 test, o'tdi. Barcha yangi fayllar BOM'siz UTF-8 (`file` bilan tekshirildi).
- `gradle testDebugUnitTest` → **55 test, 55 o'tdi** (17 yangi `TasksTest` + 22 `DavomatTest` + 16 `HrAccessTest`).
- `gradle assembleDebug` (JDK 17, Gradle 8.7) → **BUILD SUCCESSFUL.** APK 13 697 552 bayt (~13,1 MiB; X2 dan +663 KB — yangi bog'liqlik qo'shilmadi, o'sish `OutlinedTextField`/`clickable` yo'llarining Compose kodidan).

**Topilmalar/og'ishlar:**

1. 🔴 **Nuqson jonlida ekspluatatsiya qilinadigan darajada emas edi — LATENT edi, lekin endi yopildi.** `/hr/tasks/logs` darvozasi `tasks:read` talab qiladi, `read` esa ma'no jihatidan «o'zganikini o'qish» degani — ya'ni bugun param bilan o'zgani so'ragan odam allaqachon huquqli edi. Xavf KELAJAKDA edi: `listLogs` ni own-only yo'ldan chaqirgan har qanday yangi kod (masalan X3 ning `my` endpointi `listLogs` ni qayta ishlatganda) bitta parametr bilan ochilib ketardi. Shuning uchun tuzatish ikki qavatli: servis qamrovni QAT'IY qildi, kontroller esa qamrov qarorini `isAdmin` degan tasodifiy mezondan RUXSAT DARAJASIGA ko'chirdi.
2. ⚠️ **`/logs` qamrovida ONGLI kelishuv.** Sof model bo'yicha `tasks:read` egasi jurnalning HAMMASINI ko'rishi kerak edi, lekin web'dagi `hr/my-tasks` sahifasi `?employeeId=` SIZ so'rov yuboradi va serverning o'zi-o'ziga qamrab qo'yishiga tayanadi — qamrovni bo'shatsam o'sha sahifa hamma xodimning vazifalarini ko'rsatib qo'yardi. Shuning uchun sukut TOR qoldirildi (o'ziniki), o'zgani so'rash esa ATAYLAB harakat (`?employeeId=` + `read`+). Natijada `hr/employees/[id]/tasks` menejer sahifasi ham, `hr/my-tasks` ham AVVALGIDEK ishlaydi — web'ga tegilmadi.
3. **`/hr/tasks/my` uchun `listLogs` QAYTA ISHLATILMADI.** Sabab: `listLogs` javobi menejer jurnali uchun (`employee`, `reviewedBy` ismlari, sahifalash), xodim ekraniga esa shablon matni + muddat kerak. Own-only yo'lga o'z metodini yozish — o'zga xodim maydonlarini javobga tushirmaslikning eng ishonchli yo'li (test bu `select` ni qat'iy tekshiradi).
4. 🔴 **Muddat SERVERDA hisoblanadi, `overdue` ham.** `HrTaskLog` da muddat maydoni YO'Q — u `sentAt + template.deadlineMinutes` (`hr-deadline-expire.service.ts` bilan bir xil formula). Ilova qurilma soati bilan qayta hisoblamaydi: qurilma soati noto'g'ri bo'lsa xodim «muddat o'tmagan» deb o'ylab qolardi. `deadlineMinutes = null` → `deadlineAt = null` va ekranda «Muddatsiz» — 0 yoki `sentAt` EMAS (8-qoida).
5. **X2 ning 2-topilmasi (UTC tuzoq) TAKRORLANDI va oldi olindi.** `sentAt`/`deadlineAt`/`answeredAt` — Nest `Date`, ya'ni UTC. `Tasks.dateTime` ularni Toshkentga o'giradi (4 ta test, shundan biri mintaqa siljishi kunni ham surishini tekshiradi: 20:10 UTC → ertangi 01:10). **X5/X6 ga eslatma: bu tuzoq har `Date` maydonda qaytadi.**
6. **v0.1 ning «faqat o'qish» qoidasidan ATAYLAB istisno** (rejada shunday): javob yuborish — xodimning O'Z amali. Egalik SERVERDA tekshiriladi (`recordAnswer` → `ForbiddenException('Bu vazifa sizniki emas')`), ilova faqat sababni tarjima qiladi.
7. **Javob yuborishda 401 da so'rov BIR MARTA qaytariladi.** 401 ni `JwtAuthGuard` beradi, ya'ni so'rov kontrollergacha yetib bormagan va hech narsa yozilmagan ⇒ qaytarish qo'sh javob yaratmaydi. Aksi bo'lsa access-token eskirgan xodim yozgan matnini yo'qotardi.
8. **v0.1 vidjetlariga TEGILMADI.** Filtr plashkasi (`Pill` bosilmaydi) va ko'p qatorli javob maydoni (`PlainField` bir qatorli) `MyTasksScreen.kt` ichida — `Widgets.kt` hamon KUZATILMAGAN fayl, uni commitga tortmaslik uchun ataylab shunday qilindi.
9. ⚠️ **`tasks` ruxsati umuman yo'q xodim «Ishlarim» ekranida 403 ko'radi.** Endpoint rejadagidek `tasks:own_only` bilan ochildi, guard esa sahifa qatori BO'LMAGAN xodimni rad etadi. Ekran buni `no_permission` matni bilan halol aytadi (bo'sh ro'yxat ko'rsatib aldamaydi). **Egasidan so'raladi:** jonlida har bir xodimga `tasks:own_only` qatori berilganmi? Berilmagan bo'lsa plitka bosilganda 403 chiqadi (fail-closed — xavfsiz, lekin foydasiz). Bu X1 ning 2-topilmasi (haydovchi roli qiymati) bilan bir xil sinfdagi savol.
10. **Bosh ekranda «Ishlarim» plitkasi HAMMAGA ko'rinadi** (X1 dagi qaror o'zgarmadi) — ruxsat tekshiruvi ekran ichida, serverda. Klientdagi yashirish qulaylik bo'lardi, xavfsizlik emas.
11. **X1 ning 4-topilmasi HAMON KUCHDA:** `android/manager-app/` ning katta qismi (`BriefingScreen.kt`, `Widgets.kt`, `Theme.kt`, `Updater.kt`, `settings.gradle.kts`, `README.md`, `.gitignore`, `tools/` …) hamon KUZATILMAGAN — X1+X2+X3 commitlari yolg'iz o'zi yig'ilmaydi. Egasi v0.1 poydevorini alohida commit qilishi kerak (yoki X7 ga shu vazifa berilsin).
12. **Biome formatlashi.** Yangi fayllarda qo'shtirnoq uslubi va qator uzunligi `biome check --write` bilan tekislandi (faqat MENING fayllarim), keyin testlar qayta yuritildi — 47 o'tdi. `docs/progress.json` ni yana repo'ning O'Z pre-commit ilgagi qo'shishi mumkin (X2 ning 11-topilmasi).
13. Daraxtda boshqa sessiyalarning commit qilinmagan ishi turibdi (`apps/api/src/modules/auth`, `permissions`, `apps/api/src/scripts/ops-menejer-rol.ts`, `docs/plans/2026-09-04-bolak-hisobi-…`). Ularga TEGILMADI, commitga ham kirmadi.

**Commit:** kod va shu hisobot — BITTA commitda, push YO'Q. Hash ataylab yozilmadi (X1 dagi sabab: hisobot commitning O'ZI ichida bo'lgani uchun o'z hashini saqlay olmaydi). Topish yo'li:
`git log --oneline -1 -- docs/plans/2026-09-03-xodim-profili-x-reja.md` → subject `feat(menejer): x3 — ishlarim ekrani va tasks own-only qulfi`.

---

### X4 hisoboti — 2026-09-04

**Holat:** ✅ bajarildi

**O'zgargan/yangi fayllar** (hammasi `android/manager-app/`; **server TEGILMADI** — `apps/api` da bitta ham qatorim yo'q):

| Fayl | Nima qilindi |
|---|---|
| `…/Routes.kt` | **YANGI.** Smena/reys/naqd hisobining SOF funksiyalari (`HrAccess`/`Davomat`/`Tasks` naqshi — Android'siz, `org.json` siz ⇒ JVM testi): `pendingByCurrency` (🔴 valyuta kesimi, jami YO'Q), `parseMinor`, `elapsedSeconds`, `durationLabel`, `tripStatusTone`, `isTripActive`, `orderTypeTone`, `destLabel`, `coords`, `distanceLabel`. |
| `…/RoutesScreen.kt` | **YANGI.** Smena kartasi (holat plashkasi + «Smenani boshlash/yakunlash»), yakunlangan smena yig'masi, «Qo'limdagi pul» (valyutalar alohida), reyslar ro'yxati (manzil/koordinata, manba, bosqich vaqtlari, faol reysda ETA). |
| `…/ApiClient.kt` | `driverShiftCurrent/Start/End`, `driverTrips`, `driverCashMine` + `exec` **ikkiga bo'lindi**: `execRaw` (xom tana) ustida `getArray` va `getObjectOrNull`. Sababi pastda (1-topilma). |
| `…/HomeScreen.kt` | «Yo'nalishlarim» plitkasi `ComingSoonScreen` o'rniga `RoutesScreen` ga ulandi (X5–X6 plitkalari hamon kutmoqda). |
| `…/res/values/strings.xml` | +44 satr (smena, naqd, reys holatlari, manba turlari, rad sabablari). |
| `…/test/…/RoutesTest.kt` | **YANGI** — 27 ta JVM testi. |

**Testlar:**

- `gradle testDebugUnitTest` → **82 test, 82 o'tdi, 0 yiqildi** (27 yangi `RoutesTest` + 17 `TasksTest` + 22 `DavomatTest` + 16 `HrAccessTest`).
  - Naqd (11): faqat `pending` sanaladi (`handed`/`cancelled` — YO'Q, server `outstandingByCurrency` qarori bilan bir xil) · **🔴 valyutalar QO'SHILMAYDI** (UZS va USD alohida qatorda) · tartib qat'iy (UZS birinchi, keyin alifbo — ro'yxat har yuklanishda bir joyda) · valyutasiz qator sukut `UZS` · **`Long` chegarasidan katta summa ham to'g'ri** (BigInteger; `9223372036854775807 × 2`) · **🔴 o'qilmagan summa jamlanmani `null` qiladi, 0 EMAS** · o'qilmagan qator ham SANALADI (jimgina tashlanmaydi — qo'ldagi pulni kamaytirib ko'rsatardi) · «o'qilmadi» holati YOPISHQOQ (buzuq qator birinchi kelsa ham, oxirida kelsa ham natija `null` — yarim yig'indi chiqmaydi) · bir valyutadagi nosozlik boshqasini buzmaydi.
  - Smena (6): davomiylik UTC vaqtdan to'g'ri · qurilma soati orqada bo'lsa manfiy emas 0 · buzuq/`null`/«null» vaqt → `null` · «2 soat 15 daq»/«45 daq»/«2 soat» · **bir daqiqadan kam vaqt «0» deb ko'rsatilmaydi** («1 daq dan kam») · yo'q davomiylik `null`.
  - Reys (4): holat lug'ati server `ALLOWED_TRANSITIONS` kalitlari bilan bir xil · **server yangi holat qo'shsa ilova yiqilmaydi** (`unknown`) · faol reyslar (`assigned`/`enroute`/`arrived`) · manba turi yopiq lug'at.
  - Manzil (6): matn bo'lsa u, bo'sh bo'lsa koordinata, ikkalasi yo'q bo'lsa `null` · **🔴 `Locale.ROOT` testi — lokal `ru-RU` ga ATAYLAB almashtirilib tekshiriladi** · NaN/cheksiz koordinata `null` · masofa m/km.
- `gradle assembleDebug` (JDK 17, Gradle 8.7) → **BUILD SUCCESSFUL.** APK 13 715 740 bayt (~13,1 MiB; X3 dan +18 188 bayt — yangi bog'liqlik qo'shilmadi).
- `gradle :app:compileDebugKotlin :app:compileDebugUnitTestKotlin --rerun-tasks` → **BUILD SUCCESSFUL, bitta ham `warning:` yo'q** (inkremental qurishda ogohlantirishlar yashirinib qolmasin deb ataylab qayta yuritildi).
- `apps/api` `tsc --noEmit` (`--max-old-space-size=8192`) → **0 xato** (server o'zgarmagani uchun formallik; X4 qabul mezoni «typecheck 0» deydi).
- Server o'zgarmagani uchun `vitest` yuritilmadi (X4 qabul mezoni buni ataylab talab qilmaydi).
- Kodlash: barcha yangi/o'zgargan fayllar `file` bilan tekshirildi — **BOM'siz UTF-8**, `no-mojibake.test.ts` dagi imzolar ro'yxati bo'yicha `grep` — 0 marta uchraydi. (Qo'riqchining O'ZI FAQAT `apps/web/src` ni skanerlaydi — `android/` uning qamrovida EMAS, shuning uchun qo'lda o'lchandi. Imzolarni bu yerga literal ko'chirmadim: reja fayli kelajakda qo'riqchi qamroviga kirsa o'zini tutib qolardi.)

**Topilmalar/og'ishlar:**

1. 🔴 **`ApiClient` massiv ham, `null` ham qaytara olmasdi — X4 dan oldin bu yo'llar ILOVANI YIQITARDI.** `exec` javobni doim `JSONObject(text)` qilardi; `my/trips` va `driver-cash/mine` esa MASSIV, `shifts/current` esa ochiq smena bo'lmasa `null` qaytaradi. `JSONObject("[…]")`/`JSONObject("null")` — `JSONException`, u `ApiException` emas, ya'ni `shell.io` ushlamay ilova qulardi. Shuning uchun `exec` `execRaw` (xom tana) ustiga ko'chirildi va ikkita yangi yo'l qo'shildi: `getArray` (bo'sh tana → bo'sh ro'yxat) va `getObjectOrNull` (bo'sh tana/`null` → `null`). Shartnoma buzilsa (massiv o'rniga obyekt) JIM bo'sh ro'yxat KO'RSATILMAYDI — `ApiException` bo'lib ekranga chiqadi. Eski `exec` xulqi o'zgarmadi (mavjud chaqiruvlar shu bo'yicha ishlaydi).
2. 🔴 **REJADAN OG'ISH: «qaysi mijozga» KO'RSATIB BO'LMAYDI.** X4 vazifasida reys qatorida «qaysi mijozga» deb yozilgan, lekin `GET /driver-tracking/my/trips` xom `DriverTrip` qatorlarini qaytaradi va **`DriverTrip` modelida mijoz maydoni UMUMAN YO'Q** (`schema.prisma:11314`): faqat `orderType` (`demand`/`retail_sale`/`manual`) va `orderId` — XOM UUID, hech qanday relation'siz. Mijoz ismini chiqarish uchun serverda `orderId` bo'yicha realizatsiya/chek → kontragent join'i kerak, ya'ni **server o'zgarishi** — X4 esa «Server o'zgarmaydi» deb qat'iy yozilgan. Shuning uchun kartada mijoz o'rniga: **manzil** (`destAddress`, bo'lmasa koordinata), **manba turi** va bosqich vaqtlari. Amalda haydovchi uchun manzil mijoz ismidan muhimroq, lekin bu OG'ISH — **X7 ga eslatma:** mijoz ismi kerak bo'lsa u alohida server ishi (`my/trips` javobini boyitish).
3. 🔴 **OCHIQ SMENA YIG'MASI ATAYLAB KO'RSATILMAYDI.** `activeSeconds`/`stopSeconds`/`deliveriesCount` ping-oqimidan FAQAT smena yopilganda hisoblanadi (`driver-shift.service.close`), ochiq smenada bazada `0` turadi. Ularni chizsam ekran ish kuni o'rtasida «harakatda: 0, yetkazma: 0» deb turardi — 8-qoidaga zid YOLG'ON. Ochiq smenada faqat boshlanish vaqti va davomiyligi bor, yig'ma esa YAKUNLANGAN smena kartasida chiqadi (o'sha karta `shifts/end` javobidan to'ldiriladi). Ekranda buning sababi ham yozilgan («…smena yakunlanganda hisoblanadi»).
4. 🔴 **Reys bosqichi ilovadan O'ZGARTIRILMAYDI.** `PATCH /driver-trips/:id/status` `DispatcherGuard` ostida va bu ATAYLAB shunday (`driver-trip.controller.ts` izohi: «field-haydovchi dispecher bo'la olmaydi»). Ya'ni haydovchi «yo'lga chiqdim/yetib bordim» deb bosa olmaydi — holat dispecherdan yoki ping avto-kelishidan (`markArrivalIfInside`) o'zgaradi. Ekran reyslar bo'yicha FAQAT O'QIYDI. **Egasidan so'raladi:** haydovchi holatni o'zi belgilashi kerakmi? Kerak bo'lsa bu server qarori (yangi self-endpoint) va alohida faza.
5. 🔴 **ETA eskirgan bo'lishi mumkin — shuning uchun HISOBLANGAN VAQTI bilan birga chiqadi.** `etaSeconds` ni `eta-worker.cron.ts` davriy yozadi; uni yolg'iz ko'rsatish «hozirgi taxmin» degan taassurot berardi. Kartada «25 daq · 04.09 · 14:12» ko'rinishida va FAQAT yakunlanmagan reysda. `etaSeconds` yoki `etaComputedAt` dan biri `null` bo'lsa qator UMUMAN chizilmaydi.
6. ⚠️ **HAYDOVCHILIKNING IKKI XIL MANBASI BOR — bu jonlida plitkani ko'rinmas qilib qo'yishi mumkin.** Plitka `hrRoles` da `driver` bo'lishiga qarab chiziladi (X1 qarori), server esa haydovchilikni **`Employee.trackingMode === 'field'`** bo'yicha hal qiladi (`driver-shift.service`, `driver-trip.service`, `driver-cash.service` — uchalasida bir xil tekshiruv). Ikki nomuvofiqlik holati:
   - `trackingMode = 'field'`, lekin `hrRoles` da `driver` yo'q → **haydovchi plitkani KO'RMAYDI** (fail-closed, lekin foydasiz);
   - `hrRoles` da `driver` bor, lekin `trackingMode ≠ 'field'` → plitka bor, «Smenani boshlash» 400 beradi. Endi bu 400 «Siz haydovchi rejimida emassiz — HR ga murojaat qiling» deb tarjima qilinadi (xom `HTTP 400: {...}` emas).

   **X1 ning 2-topilmasi HAMON OCHIQ:** `hrRoles` erkin lug'at, `seed-hr.ts` da `driver` YO'Q. `HrAccess.DRIVER_ROLES = {"driver","haydovchi"}` shundayligicha qoldi (X4 X1 mantig'iga TEGMADI). **Egasidan so'raladi:** jonlida haydovchilarga (a) qaysi `hrRoles` qiymati va (b) `trackingMode = 'field'` qo'yilganmi? Ikkalasi ham kerak.
7. 🔴 **`Locale.ROOT` tuzog'i — yangi sinf, testi bor.** Koordinata va «km» `String.format` bilan yoziladi; qurilma lokali ruscha/o'zbekcha bo'lsa `%f` kasr ajratgichni VERGUL qiladi va koordinata «41,31083, 69,27972» bo'lib navigatorga ko'chirib bo'lmay qolardi. `Routes.coords`/`distanceLabel` da `Locale.ROOT` qat'iy; test lokalni ataylab `ru-RU` ga o'girib tekshiradi. **X5/X6 ga eslatma:** har `String.format`/`%f` da shu tuzoq qaytadi (X2 ning UTC tuzog'i bilan bir sinfda).
8. **Vaqt formatlash `Tasks.dateTime` dan QAYTA ISHLATILDI** (X3 da yozilgan, 4 ta testi bor): `startedAt`/`assignedAt`/`arrivedAt`/`completedAt` — hammasi Nest `Date`, ya'ni UTC. Yangi nusxa yozilmadi — X2 ning 2-topilmasi (UTC tuzog'i) shu bilan uchinchi marta yopildi.
9. **`POST /driver-cash/collect` ATAYLAB ULANMADI.** X4 vazifasida «Qo'limdagi pul» kartasi FAQAT o'qish deb yozilgan. «Mijozdan naqd oldim» yozuvi — pul zanjiriga kiradigan YOZUV amali (summa, valyuta, reys tanlash, xato yozuvni bekor qilish oqimi kerak) va u alohida fazaga arziydi. Hozir yozuvlarni web ERP/dispecher qiladi.
10. **Uch manba BITTA IO ishida ketma-ket o'qiladi** (`shifts/current` → `my/trips` → `driver-cash/mine`). Sababi: ekran yaxlit, «smena bor-u reyslar hali yo'q» degan yarim holat foydalanuvchiga tushunarsiz. Xato bo'lsa butun ekran xato kartasi + «Qayta urinish» ko'rsatadi.
11. **Bo'sh holatlar HALOL ajratilgan:** «Topshirilmagan pul yo'q» (o'lchandi, natija nol) va «hisoblanmadi» (summa o'qilmadi) — ikki BOSHQA matn. «Sizga reys biriktirilmagan» ham bo'sh ro'yxat, xato emas.
12. **X1 ning 4-topilmasi HAMON KUCHDA:** `android/manager-app/` ning katta qismi (`BriefingScreen.kt`, `Widgets.kt`, `Theme.kt`, `Fmt.kt`, `Updater.kt`, `settings.gradle.kts`, `README.md`, `.gitignore`, `tools/` …) hamon KUZATILMAGAN — X1+X2+X3+X4 commitlari yolg'iz o'zi yig'ilmaydi. Egasi v0.1 poydevorini alohida commit qilishi kerak (yoki X7 ga shu vazifa berilsin). Bu commit `Widgets.kt`/`Fmt.kt` ga TEGMADI (`Pill`, `InfoRow`, `SectionCard`, `EmptyState`, `PrimaryButton`, `Fmt.minor` xuddi borligicha ishlatildi).
13. Daraxtda boshqa sessiyalarning commit qilinmagan ishi turibdi (`android/tsd-app/`, `apps/api/src/modules/auth`, `permissions`, `apps/web/src/app/(app)/sotuv/`, `packages/db/scripts/`). Ularga TEGILMADI, commitga ham kirmadi. `docs/progress.json` ni repo'ning O'Z pre-commit ilgagi qo'shishi mumkin (X2 ning 11-topilmasi).

**Commit:** kod va shu hisobot — BITTA commitda, push YO'Q. Hash ataylab yozilmadi (X1 dagi sabab: hisobot commitning O'ZI ichida bo'lgani uchun o'z hashini saqlay olmaydi). Topish yo'li:
`git log --oneline -1 -- docs/plans/2026-09-03-xodim-profili-x-reja.md` → subject `feat(menejer): x4 — yo'nalishlarim ekrani (smena, reyslar, qo'ldagi pul)`.

---

### X5 hisoboti — 2026-09-04

**Holat:** ✅ bajarildi

**O'zgargan/yangi fayllar:**

*Server — `apps/api/src/modules/hr/hr-kpi/` (🔴 `manager/kpi` ga BITTA QATOR ham yozilmadi):*

| Fayl | Nima qilindi |
|---|---|
| `my-kpi.schema.ts` | **YANGI.** `MyKpiQuerySchema` — FAQAT `limit` (sukut 30, maksimum 90). 🔴 `employeeId` va `accountId` maydonlari ATAYLAB YO'Q (X2 `MyHistoryQuerySchema` / X3 `MyTasksQuerySchema` naqshi): zod obyekti notanish kalitlarni olib tashlaydi ⇒ `?employeeId=` kontrollergacha YETIB BORMAYDI. |
| `my-kpi-view.util.ts` | **YANGI, SOF modul** (DB yo'q, soat yo'q): muhr qoidasi (`sealedTarget`/`sealedWeight` — KPI-03/KPI-05), `scoreMyDay` (ball formulasini QAYTA YOZMAYDI — `kpi-score.ts` dagi `scoreDay` ni chaqiradi), `myAttentionSignals`, `resolveScore` (muzlagan ball jonlisidan ustun). |
| `my-kpi.service.ts` | **YANGI.** `listMine(accountId, employeeId, {limit})` — `EmployeeDailyKpi` + `EmployeeDailyKpiMetric` dan qat'iy self-scope bilan o'qiydi; katalogni (built-in + hisobning `manual` ko'rsatkichlari) o'zi yig'adi. |
| `my-kpi.controller.ts` | **YANGI.** `GET /hr/kpi/my` — `@Controller('hr/kpi')` + `@UseGuards(JwtAuthGuard)`, `employeeId = user.sub`. Darvoza tanlovi va uning asosi izohda (pastda). |
| `my-kpi-view.util.test.ts` | **YANGI** — 25 test (shundan biri menejer ro'yxati bilan MEXANIK solishtiruv). |
| `my-kpi.service.test.ts` | **YANGI** — 15 test (5 tasi qamrov qulfi). |
| `my-kpi.controller.test.ts` | **YANGI** — 7 ta own-only / darvoza qulfi. |
| `hr-kpi.module.ts` | `MyKpiController` + `MyKpiService` ro'yxatga qo'shildi (yetim kontroller = jim 404; `app-boot.test.ts` qo'riqlaydi). |

*Ilova — `android/manager-app/`:*

| Fayl | Nima qilindi |
|---|---|
| `…/MyKpi.kt` | **YANGI.** Kun kartasining SOF funksiyalari (`HrAccess`/`Davomat`/`Tasks`/`Routes` naqshi — Android'siz, `org.json` siz ⇒ JVM testi): `dateOnly`, `dayLabel`, `percent`, `coveragePercent`, `weightLabel` (`Locale.ROOT`), `metricNumber` (BigInteger), `unitSuffix`, `stateTone`, `signalTone`, `skipTone`, `isProvisional`. |
| `…/MyKpiScreen.kt` | **YANGI.** Kun kartalari (sana + holat plashkasi + ball + qamrov + ishlangan vaqt + signal plashkalari); karta bosilganda ko'rsatkichlar ro'yxati ochiladi (soddalashtirilgan drilldown: reja, bajarish %, og'irlik, soatiga, «menejer tuzatgan», ballga kirmagan bo'lsa SABABI). |
| `…/ApiClient.kt` | `myKpi(limit)` — `GET /hr/kpi/my?limit=…`. |
| `…/HomeScreen.kt` | «Mening KPI'im» plitkasi `ComingSoonScreen` o'rniga `MyKpiScreen` ga ulandi (X6 «Oyligim» plitkasi hamon kutmoqda). |
| `…/res/values/strings.xml` | +33 satr. Holat plashkalari YANGIDAN YOZILMADI — `kpi_state_*` (v0.1) qayta ishlatildi. |
| `…/test/…/MyKpiTest.kt` | **YANGI** — 27 ta JVM testi. |

**Darvoza tanlovi (reja «asosla» degan band):** `@RequireHrPermission('oylik','own_only')` EMAS, **`JwtAuthGuard` + qat'iy self**. Sabablari:

1. **`oylik` — OYLIK sahifasi, KPI emas.** `hr-permission-adapter.ts` `oylik` ni `hrsalary` entity'siga, `own_only` ni esa `view:OWN` ga xaritalaydi. KPI'ni shu darvoza ostiga qo'yish «o'z KPI'ingni ko'rish» huquqini «o'z OYLIGINGNI ko'rish» huquqiga bog'lab qo'yardi — kelajakda oylik ko'rinishi o'zgartirilsa KPI ham JIMGINA o'zgarardi. Menejer tomonda KPI `employees` sahifasi ostida turibdi, `oylik` ostida emas (`manager-kpi.controller.ts`).
2. **HR sahifa-ruxsatlari oddiy xodimda YO'Q.** `seed-hr.ts` sahifa qatorlarini FAQAT egalarga/adminlarga yozadi; `hrEmployeePermission` boshqa hech qayerda avtomatik yaratilmaydi — faqat HR ekranidan qo'lda. `oylik:own_only` talab qilinsa, o'sha qator berilmagan har bir xodim o'z KPI'sini **403** bilan ko'rmasdi: plitka bor-u ekran o'lik bo'lardi.
3. **Bu qaror shu domenda ALLAQACHON qabul qilingan.** `manager-kpi.controller.ts` da `POST days/:id/explain` da `@RequireHrPermission` ATAYLAB yo'q va izohda sababi yozilgan: «oddiy xodimda `employees:read` bo'lmaydi, lekin u o'z kuniga tushuntirish bera olishi SHART». O'z kunini O'QISH undan ham yumshoqroq amal.
4. **Naqsh:** `hr/attendance/my/*` (X2) va `driver-tracking`/`driver-cash` self-yo'llari (X4) — hammasi `JwtAuthGuard` + `user.sub`.

Xavfsizlik bundan zaiflashmaydi: himoyani **darvoza emas, QAMROV** beradi — `employeeId` so'rovdan olinmaydi (sxemada bunday maydon yo'q) va prisma `where` i `accountId` + `employeeId` bilan qat'iy yopilgan. Ikkalasi ham testlar bilan qulflangan.

⚠️ **X6 ga eslatma:** rejada `GET /hr/payroll/my/:yearMonth` uchun `oylik:own_only` YOZILGAN va bu o'rinli (oylik — aynan o'sha sahifa), lekin 2-band o'sha yerda ham amal qiladi: `oylik` qatori berilmagan xodim o'z oyligini ko'rmaydi. Buni egasi bilan aniqlashtirish kerak — HR ekranidan hamma xodimga `oylik:own_only` beriladimi, yoki endpoint darvozasi yumshatiladimi.

**Testlar:**

- `vitest run src/modules/hr/hr-kpi` → **4 fayl, 62 test, 62 o'tdi, 0 yiqildi** (shundan 47 tasi yangi).
  - Kontroller (7): `employeeId` token'dan · **🔴 `?employeeId=<o'zga>` e'tiborsiz** · **🔴 `?accountId=` ham e'tiborsiz** · **sxemada `employeeId` maydoni UMUMAN yo'q** (uzatilgan obyekt kalitlari qat'iy: `['limit']`) · sukut limit 30 · noto'g'ri limit (0, −1, 91, matn) rad etiladi · **🔴 manba matni bo'yicha `@UseGuards(JwtAuthGuard)` bor va kontrollerda `employeeId` so'zi umuman yo'q** (2026-08-10 dagi «dekorator bezakka aylandi» klassi).
  - Servis (15): **🔴 prisma `where` da FAQAT `accountId`+`employeeId`** (kalitlar ro'yxati qat'iy — kelajakda `OR`/`in` qo'shilsa yiqiladi) · **🔴 `select` da `employee`/`acceptedById`/`events`/`corrections`/`bonusFineLogs`/`account` YO'Q** · **🔴 javob obyektida boshqa xodim maydonlari yo'q** · begona xodim → bo'sh ro'yxat · katalog ham faqat o'z akkauntidan · `score: null ≠ 0` · o'lchanmagan ko'rsatkich `null` bo'lib qoladi · **muzlagan ball jonlisidan USTUN** · `workedMinutes: null` da soatlik qiymat `null` · soatlik qiymat faqat `perHour` ko'rsatkichda · signallar · hisobning O'Z ko'rsatkichi yorlig'i · katalogda yo'q kalit tushib qolmaydi · tartib qat'iy.
  - Sof modul (25): muhr qoidasining har bir holati · **muhrlangan «maqsad/og'irlik yo'q» profilga QAYTMAYDI** · tuzatma g'olib, avtomat saqlanadi · `null ≠ 0` · signal lug'ati · **🔴 menejer `ALERT_METRICS` ro'yxati bilan mexanik solishtiruv** · muzlagan/jonli ball tanlovi.
  - 🔴 **Solishtiruv qulfi O'LCHAB TEKSHIRILDI:** `MY_KPI_ALERT_METRICS` dan bitta kalit vaqtincha olib tashlandi → o'sha test YIQILDI, qaytarilgach yana 62/62. Ya'ni test haqiqatan divergensiyani tutadi, shunchaki yashil turmaydi.
- `vitest run src/modules/hr src/modules/manager/kpi src/app-boot.test.ts` → **121 fayl, 1576 test, hammasi o'tdi** (marshrut to'qnashuvi qo'riqchisi ham yashil: `hr/kpi/my` ≠ `hr/kpi/daily`).
- `tsc --noEmit` (`--max-old-space-size=8192`) → **0 xato.**
- `no-mojibake.test.ts` → 4 test, o'tdi. Barcha yangi/o'zgargan 14 fayl qo'lda ham tekshirildi: **BOM'siz UTF-8, mojibake imzosi 0 marta.**
- `gradle testDebugUnitTest` → **109 test, 109 o'tdi** (27 yangi `MyKpiTest` + 27 `RoutesTest` + 17 `TasksTest` + 22 `DavomatTest` + 16 `HrAccessTest`).
- `gradle assembleDebug` (JDK 17, Gradle 8.7) → **BUILD SUCCESSFUL.** APK 13 729 812 bayt (~13,1 MiB; X4 dan +14 072 bayt — yangi bog'liqlik qo'shilmadi).
- `gradle :app:compileDebugKotlin :app:compileDebugUnitTestKotlin --rerun-tasks` → **BUILD SUCCESSFUL, bitta ham `warning:` yo'q.**

**Topilmalar/og'ishlar:**

1. 🔴 **MUHR QOIDASI ENDI UCH JOYDA — ro'yxatga olindi.** `targetSource`/`weightSource` muhrini o'qish `daily-kpi-acceptance.service.ts` da (xususiy `effectiveTarget`/`effectiveWeight`), `kpi-config.service.ts:211` da (CHALA nusxa — u FAQAT maqsad muhrini biladi, og'irlik muhrini bilmaydi) va endi `my-kpi-view.util.ts` da. X5 sharti «`manager/kpi` kodiga TEGMA» bo'lgani uchun xususiy funksiyalarni eksport qilib bo'lmadi. **BALL FORMULASI takrorlanmadi** — u `kpi-score.ts` dan chaqiriladi (1.4 dagi «yetti joyda uch xil foiz» hodisasi shundan boshlangan edi), signallar ro'yxati esa mexanik qulf bilan bog'landi. **X7 ga eslatma:** bu uch nusxani bitta sof modulga (`kpi-seal.util.ts`) chiqarish kerak.
2. 🔴 **`date` — INSTANT EMAS, YORLIQ; X2/X3 dagi UTC tuzog'i bu maydonda TESKARI ishlaydi.** `EmployeeDailyKpi.date` — `@db.Date` va u MAHALLIY kunni nomlaydi (`tz.util.localDateOnly` izohi), JSON'da `2026-09-03T00:00:00.000Z` bo'lib keladi. Uni `Tasks.dateTime` bilan Toshkentga o'girish kunni SURIB yuborardi. Shuning uchun `MyKpi.dateOnly` matndan kesib oladi va buning testi bor (1-yanvar / 31-dekabr chegaralari). **X6 ga eslatma:** oylik davri ham yorliq — o'girishdan oldin ustun turini tekshiring.
3. 🔴 **BALLGA «YAXSHI/YOMON» RANG BANDLARI O'YLAB TOPILMADI.** Server ball uchun xodim ekraniga mo'ljallangan chegara bilmaydi, shuning uchun ekran ballni neytral ko'rsatadi. Kartani sariq qiladigan yagona narsa — SERVER bergan `attentionSignals`. Aks holda ilova o'zi o'ylab topgan «60% dan past = qizil» qoidasi jonlida rasmiy mezonga aylanib qolardi.
4. 🔴 **«Yakuniy emas» ball OCHIQ aytiladi.** Kun qabul qilinmaguncha `scorePercent` bazada `null` bo'ladi va ekranda JONLI hisoblangan ball chiqadi (menejer navbati ham shunday). Xodim buni yakuniy deb o'ylamasligi uchun karta «Kun hali qabul qilinmagan — ball o'zgarishi mumkin» deb turadi; qabul qilingach «ball muzlatilgan». Aks holda oylikdagi raqam ekrandagidan boshqacha chiqib, tushuntirib bo'lmaydigan nizo tug'ilardi.
5. ⚠️ **Menejer izohlari/jurnal (`events`) ATAYLAB javobga tushmadi.** Rad etilgan kunda xodim SABABINI ko'rmaydi — faqat «Rad etildi» plashkasini. Ikki sabab: (a) X5 qamrovi «ball, holat, signallar, metrikalar» deb yozilgan; (b) jurnal qatorlarida menejerning izohi va `actorId` si bor, ularni xodim ekraniga chiqarish alohida qaror. **Ammo bu FSM'dagi «rad etish → tushuntirish» halqasini ilovada UZIB qo'yadi** (`POST manager/kpi/days/:id/explain` allaqachon xodimga ochiq). **Egasidan so'raladi:** xodim rad sababini va tushuntirish yozish imkonini ilovada olsinmi? Kerak bo'lsa bu alohida faza (server tayyor, ilova qismi kerak).
6. ⚠️ **`GET /hr/kpi/daily` (eski endpoint) BOSHQA JADVALDAN o'qiydi.** `hr-kpi.service.ts` `HrKpiDailyLog` bilan ishlaydi (uchta qat'iy ustun), X5 esa `EmployeeDailyKpi` dan — bular IKKI BOSHQA o'lchov tizimi. Bir modulda ikkalasi turgani chalkash, lekin eskisiga TEGILMADI (X5 qamrovidan tashqarida). **X7 ga eslatma:** `HrKpiDailyLog` ni oylik dvigateli 4M.3 da o'qishni to'xtatgan — u endi faqat eski web ekranini boqadi.
7. ⚠️ **KPI profili biriktirilmagan xodimda ekran deyarli bo'sh bo'ladi.** `hasProfile: false` bo'lsa hech narsa ballanmaydi (`score: null`) va karta «KPI profili biriktirilmagan — ball hisoblanmaydi» deb turadi. Bu HALOL, lekin foydasiz. **Egasidan tekshirish so'raladi:** jonlida nechta xodimga `KpiProfileVersion`/`EmployeeKpiTarget` biriktirilgan? Hech kimga biriktirilmagan bo'lsa, plitka hamma uchun bo'sh ekran ochadi (X2 ning 5-topilmasi bilan bir sinfda).
8. **`KpiMetricCatalogService` in'yeksiya QILINMADI.** U `ManagerModule` da va `exports` da yo'q; uni eksportga chiqarish `manager/kpi` wiring'iga tegish bo'lardi. O'rniga servis `kpiMetricDef` ni o'zi o'qiydi (bitta `findMany`, `accountId` bilan chegaralangan, testi bor). Natijada hisobning O'Z ko'rsatkichi ham xodim ekranida yorlig'i bilan ko'rinadi — `detail()` da tuzatilgan hodisa (egasining KPI'si ekranda umuman ko'rinmasligi) bu yerda takrorlanmadi.
9. **`Fmt.group` MINGLIKLARNI UZILMAYDIGAN PROBEL (U+00A0) bilan ajratadi.** Testning birinchi varianti oddiy probel bilan yozilgan edi va «`1 234` ≠ `1 234`» degan o'qib bo'lmaydigan `ComparisonFailure` berdi. `MyKpiTest` da ko'rinmas belgi FAQAT bitta konstantada (`NBSP`) turadi va izohi bor. **X6 ga eslatma:** oylik summasi ham `Fmt` orqali chiqadi — ayni tuzoq qaytadi.
10. **`Locale.ROOT` tuzog'i (X4 ning 7-topilmasi) X5 da ham qaytdi va oldi olindi.** Foizlar butun songa yaxlitlanadi (kasr ajratgich umuman ishlatilmaydi), og'irlik esa `String.format(Locale.ROOT, "%.2f")` bilan — testi lokalni ataylab `ru-RU` ga o'girib tekshiradi.
11. **Biome commitdan OLDIN yuritildi** (`biome check --write`) — 4 ta fayl formatlandi (import tartibi, qator uzunligi), keyin testlar va typecheck QAYTA yuritildi. X2 ning 11-topilmasidagi «lint-staged testlardan keyin fayllarni o'zgartirib qo'yadi» holatining oldi shu bilan olindi. Qolgan 3 ta biome ogohlantirishi `hr-kpi.service.test.ts` da (v0.1 qoldig'i) va MENGA tegishli emas — tegilmadi.
12. **X1 ning 4-topilmasi HAMON KUCHDA:** `android/manager-app/` ning katta qismi (`BriefingScreen.kt`, `Widgets.kt`, `Theme.kt`, `Fmt.kt`, `Updater.kt`, `settings.gradle.kts`, `README.md`, `.gitignore`, `tools/` …) hamon KUZATILMAGAN — X1…X5 commitlari yolg'iz o'zi yig'ilmaydi. Egasi v0.1 poydevorini alohida commit qilishi kerak (yoki X7 ga shu vazifa berilsin). Bu commit `Widgets.kt`/`Fmt.kt`/`Theme.kt` ga TEGMADI (`SectionCard`, `InfoRow`, `Pill`, `EmptyState`, `SecondaryButton`, `Fmt.minor`, `Fmt.group` xuddi borligicha ishlatildi).
13. Daraxtda boshqa sessiyalarning commit qilinmagan ishi turibdi (`apps/api/src/modules/auth`, `permissions`, `packages/db/scripts/`, `apps/api/src/scripts/`, yangi `docs/plans/` fayllari). Ularga TEGILMADI, commitga ham kirmadi. `docs/progress.json` ni repo'ning O'Z pre-commit ilgagi qo'shishi mumkin (X2 ning 11-topilmasi).

**Commit:** kod va shu hisobot — BITTA commitda, push YO'Q. Hash ataylab yozilmadi (X1 dagi sabab: hisobot commitning O'ZI ichida bo'lgani uchun o'z hashini saqlay olmaydi). Topish yo'li:
`git log --oneline -1 -- docs/plans/2026-09-03-xodim-profili-x-reja.md` → subject `feat(menejer): x5 — mening kpi'im ekrani va hr/kpi/my endpointi`.
