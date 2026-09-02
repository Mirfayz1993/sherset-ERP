# 2026-09-03 (kecha, kassa yopiq) — kunlik chek raqami + chek ustunlari tuzatildi

> **Bajardi:** Claude · **Egasi buyurtmasi:** (1) «chekda sonlar chekka
> sig'mayapti — 2 xonali emas, 4 xonalik qilish kerak», (2) «chek chiqarilganida
> bugun nechta sotuv bo'lgan bo'lsa o'shaning soni chiqishi kerak — 120 ta sotuv
> bo'lsa keyingi chek 121», har kassir uchun ALOHIDA, (3) «eski cheklar o'z nomi
> bilan turishi kerak, chunki kerak bo'ladi».
> **Deploy ruxsati:** egasi, «hozir kassa yopiq boshla» (22:30 Toshkent).
> **Migratsiya BOR** — `retail_sales.receipt_no`. API + web ikkalasi ham chiqdi.

## Nima chiqdi

| Commit | Nima |
|---|---|
| `beb01580` | Kunlik chek raqami — kassirning shu kundagi ketma-ket soni |
| `9ce16dd0` | Prod bilan merge (quyida — kechaning eng xavfli qismi) |

Merge bilan birga **oldingi sessiyalarning push qilinmagan 3 ta ishi** ham
chiqdi: kioskda UZ↔RU til almashtirgich (`6ed54577`), kassa UZ↔RU tuzatishlari
(`03f3c738`), CFD rolik `contain` (`d3118499` — prodda allaqachon bor edi).

### 1. Raqamlar ustunga sig'mayotgani (o'lchangan sabab)

Fotodagi chek — `buildReceiptHtml` (Electron-HTML, 72mm). CSS'da
`td{…overflow-wrap:anywhere}` **hamma** kataklarga tegardi. `Narxi`/`Summa`
`.r` klassida `white-space:nowrap` bilan himoyalangan edi, `№` va `Soni` esa
`.c` da — himoyasiz. Natija: `200` → `20`+`0`, `10` → `1`+`0`.

Yechim — yangi `.nw{white-space:nowrap}` klassi shu ikki ustunga. **Cheklov
endi 4 xona emas, ixtiyoriy uzunlik**: sinish nuqtasi umuman yo'q, auto-layout
esa ustunni raqam bo'yi kengaytiradi. `fmtQty` ru-RU guruh ajratgichi bilan
chiqadi (`2 000`) — probel joyidan sinish ham shu bilan yopildi.

Ayni kasallik yana 2 joyda takrorlanardi va ular ham tuzatildi:
`tovar-chek.tsx` (brauzer-zaxira va `/print/*`) va ombor varag'i
(`table-layout:fixed`, `№ 5mm→7mm`, `Кол-во 8mm→11mm`).

### 2. Chek raqami

`CHEK-112159` aslida **soat** edi (11:21:59). Endi hisoblagich
`document_sequences` da, kalit `CHEKKUN:<kassirId>:<Toshkent-kun>`:

- **Atomik `increment`** — `SELECT max()+1` ataylab ishlatilmadi: ikki kassa
  bir vaqtda chek chiqarsa u bitta raqamni ikki chekka berardi.
- **Kun chegarasi Asia/Tashkent, UTC EMAS.** Server UTC'da yurganda
  00:00–05:00 oralig'idagi chek «kechagi» kunga tushib, kassirning yangi kuni
  1 dan emas kechagi raqamdan davom etardi.
- **`receipt_no` post() onida MUZLAYDI** ⇒ qayta chop etilgan chekda AYNI
  raqam. Bekor/qaytarish bo'lganda ham mijoz qo'lidagi qog'oz bazadagi qator
  bilan bir xil qoladi.
- Sotuvsiz chek `POST /retail-sales/receipt-number` dan oladi. So'rov yiqilsa
  chek **to'xtamaydi** — eski vaqt-raqami zaxira (tarmoq uzilgani uchun
  mijozni qog'ozsiz qoldirish yomonroq natija).

### 3. Eski cheklar — backfill ATAYLAB YO'Q

`receipt_no` NULLABLE, renderer NULL ko'rsa hujjat nomiga (`ТРН-2026-…`)
qaytadi. Deploydan keyin o'lchandi: **2685 chek, 0 tasida raqam** — egasining
talabi aynan shu edi.

## 🔴 Kechaning eng xavfli qismi — prod AJRALIB ketgan edi

`git status` prodda toza ko'rinardi, lekin **prod HEAD lokal branch'da YO'Q
7 ta commitni** ushlab turardi:

```
ceb237f2 Merge branch 'deploy-20260902-kanal'
92e9654d feat(pos): qaytarishda naqd/karta kanalini kassir tanlaydi (V3)  ← JONLI POS
60643643 feat(cfd): ikkinchi ekranda kassir ismi
76068316 fix(cfd): rolik contain
a4d8359e fix(pos): vozvrat mojibake tuzatishi
7ad16309, a5cc42e6  (docs)
```

GitHub `origin` esa **12 commit orqada** (push huquqi yo'q — saqlangan hisob
`Mehmed-sila`, repo `Davlatbek1717/sherset-ERP` → 403).

**`deploy-smart.sh` ISHLATILMADI** — u `git fetch origin` + `reset --hard`
qiladi. Origin orqada bo'lgani uchun skriptning orqaga-ketish qo'riqchisi
to'g'ri ravishda FATAL bergan bo'lardi; qo'riqchisiz esa u jonli POS ishini
**jimgina o'chirib tashlardi** (CLAUDE.md §6.7A ning aynan sinfi).

**Ishlatilgan usul:** prod tarixi `git bundle` bilan olib kelindi → lokalda
MERGE (reset EMAS) → darvozalar → teskari bundle → prodda `merge --ff-only`.

### Merge konfliktlari (3) — uchalasi ham ADDITIV

| Fayl | Qaror |
|---|---|
| `customer-display/page.tsx` | i18n hook (lokal) + kassir ismi holati (prod) yonma-yon. Prodning qattiq satrlari (`Kassa №1`, `Demo Kassir`) OLINMADI — `i18n-no-hardcoded` qo'riqchisi rad etardi va RU'ga o'tganda demo matni o'zbekcha qolardi; o'rniga yangi `cashier_fallback` kaliti (uz+ru). |
| `customer-display.test.tsx` | Prodning «TopBar — kassir ismi» to'plami va `TopBar` importi saqlandi (lokal import uning kichik to'plami edi). |
| `docs/progress.json` | Generatsiya artefakti — yangiroq (lokal) olindi; proddagi nusxa `yacheyka-inventarizatsiya` branch nomi bilan eskirgan. |

CFD `objectFit: contain` tuzatishi ikkala tarixda ham bor edi (`d3118499` va
`76068316`, bir xil o'zgarish) — git uni bitta qilib birlashtirdi.

## Darvozalar (merge'dan KEYIN)

| Tekshiruv | Natija |
|---|---|
| api typecheck | 0 xato |
| web typecheck | 0 xato |
| api testlari | **10002 yashil** (689 fayl) |
| web testlari | **4517 yashil** (346 fayl) |
| biome | 0 xato (mavjud baseline ogohlantirishlar) |
| chek renderi | 72mm da vizual tekshirildi — `200`, `2 000`, `1 234` butun |

## Deploy jarayoni

```
22:30  bundle -> prod, git merge --ff-only ceb237f2..9ce16dd0   (reset EMAS)
       rollback nuqtasi: /root/rollback-head-20260903.txt = ceb237f2
       prisma generate + migrate deploy  -> receipt_no / integer / nullable=YES
       pm2 restart sherset-v2-api
21:09Z sovuq build boshlandi (NEXT_DISTDIR=.next-chek — jonli .next ga TEGILMADI)
21:17Z build tugadi, 8.5 daqiqa, SENTINEL_RC=0
21:18Z artefakt tekshiruvi -> FLIP -> .next-old-chekraqam
       pm2 restart sherset-v2-web
```

Sentinel **skript fayl ichida** (09-01 sabog'i: SSH orqali `$?` escaping'da
yeb ketiladi). Flip mayda qadamlar bilan: ikkinchi `mv` yiqilsa birinchisi
avtomat qaytariladi.

## Verify (jonli, domen orqali — TASHQARIDAN)

| Tekshiruv | Natija |
|---|---|
| `/login` `/sotuv` `/customer-display` `/api/v1/health` | **200 (4/4)** |
| Jonli `sotuv/page-87c2db8a615235a5.js` | `retail-sales/receipt-number` ✓ · `c nw` ✓ |
| `POST /api/v1/retail-sales/receipt-number` | **401** (marshrut BOR) |
| Taqqos: mavjud bo'lmagan marshrut | **404** — ya'ni 401 haqiqiy dalil |
| `BUILD_ID` | `yBPNkttQcLjA4Ksq2WpiE` → **`oTtvFt6iVm42_-KlKA_4c`** |
| Eski build'da `receiptNo` | 0 chunk → yangi build'da **3 chunk** (farq O'LCHANDI) |
| pm2 `sherset-v2-api` / `-web` | ikkalasi `online`, yangi xato yo'q |
| Baza | 2685 chek, **0 tasida raqam** · 0 ta `CHEKKUN:` hisoblagich qatori |

**Ikkita yolg'on-ijobiy yo'l-yo'lakay ushlandi:**
1. `127.0.0.1:4000` dagi `health -> 200` **eski saytniki** edi — v2 API aslida
   **4001** portida. Tekshirmaganda «sog'lom» degan yolg'on xulosa chiqardi.
2. Restartdan darhol keyingi domen `502` — API hali ko'tarilayotgani edi
   (NestJS+Prisma ~30s), 1 daqiqadan keyin 200.

## Qaytarish nuqtalari

```bash
# FE ni qaytarish (raqam va ustun tuzatishi yo'qoladi, migratsiya qoladi):
cd /var/www/sherset-v2/apps/web
mv .next .next-new && mv .next-old-chekraqam .next && pm2 restart sherset-v2-web

# Kodni butunlay qaytarish:
cd /var/www/sherset-v2 && git reset --hard $(cat /root/rollback-head-20260903.txt)
pm2 restart sherset-v2-api
```

Migratsiya qaytarilmasa ham zarar yo'q: ustun NULLABLE va eski kod uni
umuman o'qimaydi.

## 🔴 Hali TEKSHIRILMAGAN — birinchi haqiqiy chek

Kassa yopiq bo'lgani uchun **haqiqiy sotuv qilinmadi** va qog'ozga chek
bosilmadi. Endpoint'ni qo'lda chaqirib sinash ham ATAYLAB qilinmadi: u
hisoblagichni surib, kassirning birinchi cheki № 1 emas № 2 bo'lib qolardi.

Ertaga birinchi chek chiqqanda tekshirilsin:
- sarlavha `SAVDO CHEKI № 1` (har kassirda alohida 1 dan);
- `Soni` ustunida 200 / 2 000 butun chiqadimi;
- eski chekni qayta chop etganda hamon `ТРН-2026-…` turadimi.

## ⚠️ Disk — o'sishda davom etyapti

Deploydan keyin **85% band, 16 GB bo'sh** (deploy oldidan 83%/17GB). Uchta
rollback katalogi 1.5 GB dan: `.next-old-cfdvideo`, `.next-old-kassir`,
`.next-old-chekraqam`, ustiga eskirgan `.next-new`. Egasi tasdiqlagach eng
eskisini (`cfdvideo`) o'chirish mumkin — har deploy ~1.5 GB qo'shadi.

## Ochiq savol (egasiga)

Cheklar ro'yxatida hamon `ТРН-…` ko'rinadi. Mijoz «chek № 121» bilan kelsa
kassir uni ro'yxatdan **topa olmaydi** — bu o'zgarish tug'dirgan bo'shliq.
Ro'yxatga va qidiruvga kunlik raqamni qo'shish kerakmi?
