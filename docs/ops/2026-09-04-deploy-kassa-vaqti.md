# 2026-09-04 — Kassa vaqti (S-reja S1–S5) jonliga chiqdi

> **Bajardi:** Claude · **Egasi ruxsati:** «deploy qilsang bo'ladi» (20:1x)
> **Jonli HEAD:** `af38fa11` → **`4bf9cee9`** · **Vaqt:** 20:20–20:35 (kassa ~15 s uzildi)
> **Reja:** `docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md`

## Chiqdi

**Kassa endi qurilma soatiga bog'liq EMAS.** Vaqt manbasi — har HTTP javobning `Date`
sarlavhasidan o'lchanadigan «skew» (yangi so'rov QO'SHILMADI), mintaqa esa qat'iy
`Asia/Tashkent`:

| Faza | Nima |
|---|---|
| S1 | `lib/clock.ts` (`serverNow`, `clockSkewMs`, `noteServerDate`, `POS_TZ`) + header va CFD soati |
| S2 | 🔴 qog'oz: chek va proforma sanasi server vaqtida, Toshkent kunida |
| S3 | «o'tgan vaqt»: navbat kartasi, qarz kechikish kunlari (Toshkent kalendar kuni), qoralama vaqti |
| S4 | 11 ta formatlash nuqtasiga `timeZone`, zaxira `CHEK-HHMMSS` Toshkent soatida + `pos-clock-discipline` qo'riqchisi |
| S5 | header'da sariq chip: «Qurilma vaqti ~N daqiqa orqada/oldinda» (chegara 2 daqiqa), o'lchanmagan holat neytral «Vaqt tekshirilmadi» |

## Qanday chiqarildi (faqat S-reja, butun branch EMAS)

Egasining qarori «faqat S-reja» edi, shuning uchun `yacheyka-inventarizatsiya` (jonlidan
**193 commit** oldinda — TSD, menejer, J1 ham ichida) MERGE QILINMADI. O'rniga jonli HEAD
ustiga **7 commit cherry-pick** qilindi:

`8dec1b20` S1 · `7302aee9` S2 · `c0347240` S3 · `921a4c9e` S4 · `c36c4044` S5 ·
`f1e6dbea`+`4bf9cee9` (test qattiqlashtirish).

- **To'qnashuv 1 — `docs/progress.json`** (avtogeneratsiya): jonlidagisi qoldirildi.
- **To'qnashuv 2 — `apps/web/src/app/(app)/sotuv/_components/zakazlar-mode.tsx`:**
  marketplace `m7` o'sha sana ko'rinishini butunlay almashtirgan (`formatPickupDate`),
  S4 esa o'sha yerga bitta `timeZone` qatori qo'shgan edi. **Jonlining nusxasi qoldirildi** —
  marketplace ishi jimgina o'chirilmadi.
- `apps/web/src/lib/api-client.ts` — avtomatik birlashdi (S1 ning bitta qatori).

Build: `NEXT_DISTDIR=.next-new` (jonli `.next` ga tegilmadi) → `BUILD_TUGADI rc=0` →
flip → `pm2 restart sherset-v2-web`. **API va shop RESTART QILINMADI** — S-reja faqat web.

## Tekshiruv

- VPS'da `pnpm --filter @moysklad/web typecheck` — **0 xato**.
- VPS'da `clock.test.ts` + `pos-header.test.tsx` — **41/41** yashil.
- Yangi bundle'da chip matni bor: `Vaqt tekshirilmadi` va `Время не сверено`
  (`.next/server/chunks/*.js`).
- Sahifalar: `/kassa-kirish`, `/sotuv`, `/customer-display`, `/api/v1/health` — **200**.
- Skew manbasi tekshirildi: `Date: Fri, 04 Sep 2026 17:30:52 GMT` — server soati bilan
  **aynan bir xil**; serverning o'zi NTP bilan sinxron (`System clock synchronized: yes`).
- `pm2 logs sherset-v2-web --err` — restartdan keyin **yangi xato yo'q**.

## Ikkinchi flip — qo'riqchi tutgan nuqson tuzatildi (21:2x)

Egasining ko'rsatmasi bilan quyidagi topilma **o'sha kuni tuzatildi va chiqarildi**:
jonli HEAD `4bf9cee9` → **`d426b592`**, ikkinchi build (`rc=0`) → flip
(`.next-old-zakazfix` — qaytarish nuqtasi) → `pm2 restart sherset-v2-web`.

- `pos-clock-discipline` **yashil** (ilgari shu nuqson uchun qizil edi): 3 fayl / **62 test**.
- POS doirasi to'liq: **154 fayl / 2336 o'tdi / 25 o'tkazib yuborildi / 0 yiqildi** — marketplace
  komponentining o'z testlari ham yashil.
- typecheck 0 xato · `biome check` o'zgargan faylda 0 xato · 4 sahifa **200** · yangi xato logi yo'q.
- ⚠️ Build ketayotganda parallel sessiya `c315f70a` («shop A-guruh») ni commit qildi — u
  **faqat `apps/shop`** ga tegadi (`git diff --stat d426b592..HEAD -- apps/web` bo'sh), ya'ni
  POS bundle'i aynan mo'ljallangan kod (`d426b592`) dan yig'ilgan.

## 🔴 Topilma — marketplace kodida qurilma soati qoldi (✅ TUZATILDI)

`pos-clock-discipline` qo'riqchisi (S4) jonli kodda **haqiqiy nuqson** tutdi:

```
app/(app)/sotuv/_components/zakazlar-mode.tsx:84  Date.now()  →  serverNow()
```

`OnlineBadge` sayt buyurtmasining «muddati o'tdi» qizil belgisini
`isPickupOverdue(online.expiresAt, Date.now())` bilan hisoblardi — ya'ni **kassa
mashinasining soati** bo'yicha. Soati adashgan kassada muddati o'tmagan buyurtma qizil
(yoki teskarisi) ko'rinardi.

**Tuzatildi** (`d426b592`, egasining ko'rsatmasi bilan) — aynan ikki qator: `@/lib/clock`
importi va `Date.now()` → `serverNow().getTime()`. Boshqa hech nimaga tegilmadi:
`isPickupOverdue` sof funksiya bo'lib qoldi (`nowMs` parametr), `formatPickupDate` va
M7 ning ko'rinish qarorlari o'z joyida. Endi belgi server vaqtiga qarab chiziladi.

## Qaytarish nuqtasi

```bash
cd /var/www/sherset-v2/apps/web
# 1-qadam orqaga (zakazlar tuzatishisiz, S-reja bilan):
mv .next .next-broken && mv .next-old-zakazfix .next && pm2 restart sherset-v2-web
# butunlay S-rejagacha (marketplace holati):
mv .next .next-broken && mv .next-old-svaqt .next && pm2 restart sherset-v2-web
# kod uchun: git reset --hard af38fa11   (S-reja commitlari olib tashlanadi)
```

## Qolgan ish

1. 🔴 **Jonli smoke bajarilmagan** — `docs/ops/kassa-vaqt-jonli-smoke.md`. U FIZIK ish:
   kassa mashinasining soatini +3 soatga surib, header/CFD/chek/navbat/chip/bazani
   tekshirish. Endi kod jonlida, ya'ni smoke'ni **istalgan payt** bajarsa bo'ladi.
2. 🔴 **NTP** hech bir kassada sozlanmagan — `docs/ops/kassa-vaqt-ntp.md` (admin PowerShell).
3. ✅ `zakazlar-mode.tsx:84` — tuzatildi va chiqarildi (`d426b592`). Marketplace sessiyasi
   o'z branch'ini jonli holat bilan birlashtirganda bu commit'ni saqlab qolsin.
