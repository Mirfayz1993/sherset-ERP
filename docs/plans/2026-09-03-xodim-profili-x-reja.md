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
