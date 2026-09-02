# 2026-09-02 (kunduzi) — mijoz-ekran: rolik kesilishi tuzatildi + kassir ismi

> **Bajardi:** Claude · **Egasi buyurtmasi:** (1) «ikkinchi ekranda videolar
> katta, mahsulotlar videolari to'liq ko'rinmayapti», (2) «ikkinchi ekranda
> kassir nomi ham ko'rinishi kerak».
> **Migratsiya YO'Q. API kodi o'zgarmadi** — faqat `sherset-v2-web` restart.

## Nima chiqdi

| Commit | Nima |
|---|---|
| `76068316` | `fix(cfd)` — mahsulot roliklari `cover` o'rniga `contain` |
| `60643643` | `feat(cfd)` — yuqori panelda kassir ismi |

### 1. Rolik kesilishi (o'lchangan sabab)

Barcha mahsulot roliklari **1280×720 (16:9)** — 39 fayl o'lchandi (`ffprobe`).
Media qutisi esa **960×~734 (≈4:3)**. `objectFit: cover` balandlikka
to'ldirib **enidan 26.4% ni kesib tashlagan** (har chetdan 169px manba
piksel). Ekrandan tushmagan qismlar: mahsulotning chap/o'ng chekkalari,
izoh matnlari, spetsifikatsiya jadvali.

`contain` da rolik 960×540 bo'lib eniga to'la sig'adi, tepa-pastda 97px oq
fon qoladi. **Egasi shu variantni tanladi** (muqobillari: 32px ichkari +
yumaloq burchak; nom/narxni yuqoriga surish).

Brend-rolik (`sherset-loop.mp4`) ham 1280×720 — unda ham SHERSET yozuvining
chetlari kesilardi, u ham `contain` ga o'tkazildi (foni oq, zolak
ko'rinmaydi).

Pastki oq gradient (140px) **olib tashlandi**: u `cover` davrida to'la-bleed
videoning keskin pastki chetini fonga singdirar edi. `contain` da rolik
pastki chetdan ~97px yuqorida tugaydi — gradient endi hech narsani
yumshatmaydi, aksincha rolikning pastki ~43px ini oq parda bilan yuvardi.

### 2. Kassir ismi — backend'ga TEGILMADI

Ism allaqachon kelayotgan ekan: `GET /cashier-sessions/current` javobida
`cashier: { id, name }` bor (`CurrentSessionSchema`,
`cashier-session.service.ts` → `findCurrentForCashier`). Mijoz-ekran
javobning tipini `{ id, cashDesk }` deb **toraytirib** olgani uchun ismni
o'qimay o'tkazib yuborardi. Tip kengaytirildi, `cashier.name` o'qildi.
Xuddi shu maydonni `pos-header.tsx` va `smena-mode.tsx` allaqachon
ishlatadi — maydon jonli va ishonchli.

Ko'rinish: `Kassa №1 · Shavkat`. Kassa nomi kulrang, ism to'q va qalinroq —
mijoz uchun «kim xizmat qilyapti» «qaysi kassa» dan muhimroq. Sessiya yo'q
bo'lsa ism umuman chizilmaydi (eski kassir ismi osilib qolmasin).
**Yangi i18n kaliti kerak emas** — ikkala qiymat ham server ma'lumoti.

## Qo'riqchilar (6 ta yangi test)

`objectFit` uchala media zanjiri bo'g'inida qulflandi + TopBar kassir ismi
uchta holatda. **Qo'riqchi haqiqiyligi tasdiqlandi:** `contain` ni `cover`
ga qaytarganda 2 ta test QIZIL bo'ldi.

Sabab: bu fayl tarixida layout regressiyasi allaqachon jonli televizorga
chiqqan (`2026-09-01-deploy-cfd-layout-fix.md`), va `cover` eski
«media chetlarigacha to'lsin» talabiga mos ko'rinadi — bir so'z bilan
qaytishi oson.

## Darvozalar

| Tekshiruv | Natija |
|---|---|
| typecheck | 0 xato |
| biome | 0 yangi ogohlantirish (1 mavjud baseline) |
| web testlari | 4461 → **4468 yashil** (341 fayl) |
| lokal smoke | `?demo=1` da haqiqiy 1280×720 rolik, 1920×1080 |

## Deploy jarayoni

**Boshlanish holati murakkab edi va bu qayd etilishi kerak:**

1. **Repoda parallel sessiya jonli ishlayotgan edi** («kassa ikki tilli»
   Faza 0 — `customer-display/page.tsx`, `messages/*.json`,
   `vozvrat-mode.tsx` da commit qilinmagan o'zgarishlar). Egasi tasdiqladi.
   Shuning uchun **asosiy ishchi katalogga TEGILMADI** — butun ish alohida
   `git worktree` da bajarildi (`node_modules` junction bilan ulandi,
   `pnpm install` kerak bo'lmadi).
2. **Server bizdan 2 commit oldinda edi** (`7ad16309` — mojibake tuzatishi va
   uning qo'riqchisi). `git bundle` bilan olib kelindi, cherry-pick qilindi.
   Yagona konflikt `docs/progress.json` (avtomat generatsiya) — server
   varianti olindi.
3. Serverga ham **bundle orqali** (GitHub'ga push QILINMADI — origin hamon
   7 commit orqada), `merge --ff-only`.

**Nega `deploy-smart.sh` ISHLATILMADI:** u `git fetch origin` + `reset --hard`
qiladi, origin esa jonlidan orqada — skriptning orqaga-ketish qo'riqchisi
to'g'ri ravishda FATAL bergan bo'lardi. Ikkinchidan u **joyida** (`.next`)
build qiladi; do'kon ochiq edi (11:00) va joyida build jonli saytni build
davomida buzardi.

**Ishlatilgan usul** (shu haftaning 4 deployi bilan bir xil):
`NEXT_DISTDIR=.next-new` sovuq build → artefakt tekshiruvi → flip → restart.

- Sentinel **alohida skript faylda** (`/root/build-cfd-video.sh`) — 09-01
  sabog'i: SSH orqali uzatilganda `$?` escaping'da yeb ketilgan edi.
- **Sovuq build** (kesh ko'chirilmadi) — 09-01 sabog'i: boshqa commit'ning
  `.next/cache` i Next'ni manifest yozmaslikka olib kelgan.
- Flip **mayda qadamlar** bilan (alohida `mv`, alohida `pm2 restart`).

```
1-build 6.3 daqiqa  rc=0  BUILD_ID n41PiihVz-dD6j7lGaBPx  (video)
FLIP 1  → .next-old-cfdvideo                              (11:23 UTC)
2-build            rc=0  BUILD_ID yBPNkttQcLjA4Ksq2WpiE   (+ kassir ismi)
FLIP 2  → .next-old-kassir                                (12:56 UTC)
```

## Verify (jonli, domen orqali)

| Tekshiruv | Natija |
|---|---|
| `/login` `/sotuv` `/customer-display` `/omborchi` `/counterparties` | **200 (5/5)** |
| `api/v1/health` | **200** |
| Jonli chunk `page-e4068b0854ecc22c.js` | `contain` ×3 · `cover` **0** · `cfd-cashier-name` ×1 |
| pm2 web / api | ikkalasi `online` |

Eski jonli chunk'da `contain` 1, `cover` 2 edi — ya'ni farq o'lchandi,
taxmin qilinmadi.

## Qaytarish nuqtalari

```bash
cd /var/www/sherset-v2/apps/web
# faqat kassir ismini qaytarish (video tuzatishi qoladi):
mv .next .next-new && mv .next-old-kassir .next && pm2 restart sherset-v2-web
# ikkalasini ham qaytarish:
mv .next .next-new && mv .next-old-cfdvideo .next && pm2 restart sherset-v2-web
```

## 🟢 DISK — hal qilindi

Deploy boshida **92% band, 8.1 GB bo'sh** edi (09-01 jurnalidagi ogohlantirish
o'sishda davom etgan). Egasining ruxsati bilan (**«ehtiyot bo'l, muhim
narsalar o'chib ketmasin»**) 6 ta eskirgan build o'chirildi.

Ehtiyot chorasi: har katalog o'chirishdan OLDIN `BUILD_ID` + `server/` +
`static/` borligi tekshirildi — ya'ni faqat Next build chiqishi ekani
tasdiqlandi. Ichida media, ma'lumot yoki `.env` yo'qligi ko'z bilan
ko'rildi.

```
o'chirildi: mojibake 1.5G · serif 1.7G · xfade 2.2G
            light 1.5G · tannarx2 1.7G · tannarx 1.7G      = 10.3 GB
qoldi:      .next-old-cfdvideo · .next-old-kassir
natija:     92% / 8.1 GB  →  82% / 19 GB
```

O'chirishdan keyin smoke qayta yuritildi — 5/5 sahifa 200.

## Ochiq qoldiq

- **Egasining televizorida ko'z bilan tasdiqlash** — rolik to'liq
  ko'rinyaptimi, kassir ismi zaldan o'qiladimi (26px).
- **Parallel sessiya bilan birlashtirish:** «kassa ikki tilli» ishi
  `customer-display/page.tsx` ning ESKI nusxasidan (`f09d3d2a` asosidan)
  ketyapti. Ular commit qilganda bu ikki o'zgarish qaytib ketmasligi uchun
  ularning branchini jonli HEAD (`60643643`) ustiga rebase qilish kerak.
- GitHub `origin` hamon jonlidan orqada (endi 9 commit) — zaxira sifatida
  bir marta push qilib qo'yish kerak.
- Kassir ismi Electron kioskda va kassirning haqiqiy hisobi bilan hali
  sinalmagan (demo va jonli chunk tekshiruvi bor, jonli sessiya yo'q).

## Status

**Phase-1 + qisman Phase-2.** Darvozalar yashil, jonli smoke 5/5, jonli
artefakt tekshiruvi o'lchangan. Egasining ekranida ko'z bilan tasdiqlash
qolmoqda.
