# Menejer planshet-ilovasi (APK) — reja

Sana: 2026-09-02 · Holat: V0.1 ishlanmoqda

## Maqsad

Umumiy menejer uchun alohida Android ilova (`uz.sherset.manager`), TSD ilovasi
(`android/tsd-app`, jonlida `sherset-tsd-0.3.0.apk`) poydevorida. Menejer rolining
kelishilgan vazifalari (2026-08-31 dizayn-qarori) planshetdan boshqariladi.

## Kelishilgan rol (qisqa)

QILA OLADI: `menejer` moduli to'liq (brifing/jonli/navbat/undirish/KPI/kassa-farqlari/SLA);
hamma hisobot + `debtreport`; savdo+kontragent to'liq CRUD `ALL` (delete=OWN_GROUP);
ombor hujjatlari ko'rish+approve `ALL`; pul faqat ko'rish; kassir smenasi yopilishida
pulni sanab qabul qilish (`cashiersession` view+update+approve, `retailcontrol`);
xodimlar davomati + KPI; `employee.view`.
QILA OLMAYDI: rollar/payroll/bank/sozlamalar/audit/analitika (DENY), POS'da chek urish,
kirim narxini tahrirlash, delete `ALL`.

## Arxitektura qarorlari

1. **Alohida ilova** `android/manager-app` (tsd-app nusxasidan boshlanadi),
   `applicationId uz.sherset.manager`, nomi «Sherset Menejer», versiya 0.1.0 (code 1).
2. **V0.1 login = email+parol** (`POST /auth/login`) — jonli API'ga deploy'siz ishlaydi.
   Qurilma-juftlash (`manager-device/pair` + PIN) va TSD naqshidagi default-deny
   `manager-guard` allowlist'i — **V0.2**. Token'lar EncryptedSharedPreferences'da
   (DeviceStore naqshi), refresh oqimi TSD'dagidek.
3. **Qayta ishlatiladi:** Shell/MainActivity mikro-router, Theme/Widgets, ApiClient
   skeleti, Updater + UpdateCard + FileProvider, `tools/publish.sh`.
   **Tashlanadi:** ScannerBridge/ScanBar, Place/Count/Cut ekranlari, oflayn ActionQueue
   (v0.1 asosan o'qish).
4. **Orientatsiya erkin** (planshet; TSD'dagi portrait qulfi olib tashlanadi).
5. **Tarqatish:** `/var/www/kassa-downloads/menejer/` + `latest.json`
   (nginx `/downloads/` allaqachon butun katalogni beradi — server konfiguratsiyasiga
   tegilmaydi). Imzo: hozircha TSD'dagidek debug-keystore (ma'lum risk, quyida).
6. **Rol:** `role-templates.ts` ga `general_manager` («Umumiy menejer») shabloni;
   jonlida rol yaratish — API restartdan keyin `ops-menejer-rol.ts` (DRY default).
   HR tomoni: `menejer/*` ning bir qismi `RequireHrPermission` talab qiladi —
   ops-skript kerakli HR ruxsatlarini ham beradi.

## V0.1 qamrovi (ekranlar)

- **Kirish** — email+parol, xato xabarlari, refresh bilan sessiya davomi.
- **Bosh** — plitkali menyu (TSD uslubi).
- **Brifing** — kunlik ko'rsatkichlar (GET `manager/briefing`).
- **Tushum / pul xaritasi** — GET `manager/money-map`.
- **KPI** — xodimlar KPI (GET `manager/kpi`).
- **Undirish** — qarz undirish ro'yxati, o'qish rejimida (GET `manager/collection`).
- **Yangilanish kartasi** — `latest.json` (`/downloads/menejer/`).

## V0.2 (keyingi bosqich)

- Qurilma-juftlash + PIN (`tsd-device.service` naqshi, `deviceMode: 'manager'`),
  `manager-policy.ts` allowlist + global guard.
- Kassa sessiyasini qabul qilish (approve) va kassa-farqlari ekrani.
- Davomat (kelgan-ketgan) ekrani — HR `activity`.
- Ombor hujjatlarini tasdiqlash, navbat/SLA ekranlari, push-bildirishnoma.

## Risklar

- **Debug-keystore** — build faqat shu mashinada; kalit yo'qolsa hamma planshetda
  qayta o'rnatish. TSD bilan bir xil ma'lum risk, alohida qaror kutmoqda.
- Menejer xodimida `report.view`/`debt.view` + HR ruxsatlari bo'lmasa ekranlar 403
  oladi — rol jonlida yaratilib biriktirilmaguncha ilova faqat admin bilan sinaladi.
- `manager-guard` yo'qligida v0.1 tokeni web bilan bir xil kuchga ega — planshet
  yo'qolsa xodim sessiyasi revoke qilinadi (mavjud mexanizm). V0.2 yopadi.

## Bog'liq hujjatlar

- `android/tsd-app/README.md` — poydevor ilova.
- `docs/plans/2026-09-01-tsd-zamonaviy-ui.md` — Compose UI naqshlari.
- Xotira: 2026-08-31 «Umumiy menejer roli kelishildi» qarori.
