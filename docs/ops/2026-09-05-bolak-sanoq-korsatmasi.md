# Bo'lak sanog'i — OMBORCHI KO'RSATMASI (J3)

> **Sana:** 2026-09-05 · **Kim bajaradi:** **Muxriddin** (Katta omborchi) ·
> **Nechta tovar:** 5 · **Jami sanaladigan:** ~42 400 m
> **Reja:** `docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md` → J3
>
> 🟢 **Bu ish savdoga TEGMAYDI.** Bo'lak hisobi bayrog'i hamma tovarda
> **o'chiq**, ya'ni kassa siz kiritgan ma'lumotni umuman ko'rmaydi. Xato
> kiritsangiz ham hech qanday chek buzilmaydi — tuzatib qo'yasiz, xolos.
> Bayroq keyingi bosqichda (J4), sanoq tekshirilgandan KEYIN yoqiladi.

---

## 0. Eng muhim qoida

> 🔴 **Ekranda turgan songa QARAB yozmang.**
>
> Har tovarning yonida tizimdagi son ko'rinadi (masalan 5 854,5 m). **U son
> to'g'ri deb hisoblanmaydi** — butun ishning maqsadi aynan shuni tekshirish.
> Omborda nechta rulon bo'lsa va har biri necha metr bo'lsa — **faqat o'shani**
> kiriting.
>
> **Farq chiqsa — bu sizning xatoyingiz emas, TOPILMA.** Farqni yozib qo'yamiz
> va keyin inventarizatsiya bilan tuzatamiz. Sonni «to'g'rilab» kiritish esa
> butun hisobni birinchi kunidan yolg'on qiladi.

---

## 1. Nima sanaladi

| # | Tovar | Tizimdagi son (м) |
|---|---|---|
| 1 | **Uz apunp 2x4** | 5 854,5 |
| 2 | **Uz punp 2x2.5** | 9 068 |
| 3 | **Uz punp 2x1.5** | 9 588 |
| 4 | **Uz pugnp 2x1** | 10 276 |
| 5 | **Azia apunp 2x6** | 7 632 |

Beshalasi ham **«Taqsimlanmagan»** omborida, **yacheykasiz** turibdi.

Har tovar uchun ikki xil narsa sanaladi:

- **Butun rulon** — ochilmagan, zavod uzunligidagi rulon (masalan 100 m yoki
  250 m). Bularga **yorliq bosilmaydi**, chunki ular bir-biridan farq qilmaydi.
- **Bo'lak** — kesilgan, uzunligi noaniq qoldiq. **Har bo'lak alohida
  o'lchanadi va har biriga yorliq bosiladi.**

---

## 2. Tayyorgarlik (5 daqiqa)

1. Brauzerda **`https://erp.sherset.uz`** ni oching va **o'z profilingiz bilan**
   kiring (Muxriddin).
2. **Omborchi → Bo'laklar** (`/omborchi/bolaklar`) bo'limiga o'ting.
3. **Ombor** maydonidan **«Taqsimlanmagan»** ni tanlang.
4. Metr o'lchagich (ruletka yoki hisoblagich) va printer tayyor bo'lsin.

⚠️ Ekranda **«bo'lak hisobi yoqilmagan»** degan sariq yozuv ko'rinadi — bu
**normal**. **«Bo'lak hisobi yuritilsin» tugmasini BOSMANG.** Uni keyinroq,
sanoq tekshirilgandan keyin biz yoqamiz.

---

## 3. Bitta tovarni sanash — qadamma-qadam

Quyidagini **har tovar uchun** takrorlaysiz.

### 3.1. Tovarni toping

Qidiruv maydoniga tovar nomini yozing (masalan `Uz apunp 2x4`) va ro'yxatdan
tanlang. Ekranning yuqorisida beshta son chiqadi:

```
Qoldiq        Reyestr       Farq       Faol bo'laklar    Eng uzun uzluksiz
5 854,5          0        -5 854,5            0                 —
```

Boshida **Reyestr = 0** va **Farq = −qoldiq** bo'lishi to'g'ri: hali hech nima
kiritilmagan.

### 3.2. Butun rulonlarni sanang

Bir xil uzunlikdagi butun rulonlarni **guruhlab** kiriting:

1. **Tur** maydonidan **«Butun rulon»** ni tanlang;
2. **Uzunlik** — bitta rulonning uzunligi (masalan `250`);
3. **Soni** — shu uzunlikdagi rulonlar soni (masalan `3`);
4. **Yacheyka** — **bo'sh qoldiring** («yacheykasiz»);
5. **Qo'shish**.

Ekranda `250 m × 3` degan bitta qator paydo bo'ladi.

> Uzunliklari har xil bo'lsa — har uzunlik uchun alohida kiriting:
> `250 × 3`, keyin `200 × 2`, keyin `100 × 4`.

### 3.3. Bo'laklarni sanang

Har kesilgan qoldiqni **alohida** o'lchang va alohida kiriting:

1. **Tur** — **«Bo'lak»**;
2. **Uzunlik** — o'lchagan uzunligingiz. **Vergul ishlaydi**: `37,5` deb
   yozsangiz ham to'g'ri saqlanadi;
3. **Soni** — `1` (har bo'lak alohida!);
4. **Yacheyka** — bo'sh;
5. **Qo'shish**.

Har bo'lak uchun tizim **`BLK-000003`**, `BLK-000004`, … degan **yorliq raqami**
beradi. (`BLK-000001` va `BLK-000002` sinovda ishlatilgan, shuning uchun
haqiqiy sanoq uchtadan boshlanadi.)

> ⚠️ **1 metrdan kalta qoldiq kiritilmaydi** — tizim uni rad etadi. Bunday
> qoldiq chiqindi hisoblanadi.

### 3.4. Yorliqni bosing va rulonga yopishtiring

Har bo'lak qatorining yonida **«Yorliq»** tugmasi bor:

1. Tugmani bosing → chop dialogi ochiladi → **Chop etish**;
2. Yorliqda **UZUNLIK katta harflar bilan**, ostida `BLK-…` shtrixi bo'ladi;
3. Yorliqni **o'sha bo'lakning o'ziga** yopishtiring.

> 🔴 **Yorliqni adashtirib yopishtirmang.** Yorliq — bo'lakning pasporti;
> keyin kassir «shu bo'lakni kesing» deganda omborchi aynan shu yorliqni
> skanerlaydi.

**Birinchi yorliqni bosganingizdan keyin darhol tekshiring:** ekranning
yuqorisidagi **skaner** maydoniga o'sha yorliqni skanerlang. **Aynan o'sha
bo'lak** ochilishi kerak (tovar tanlash ro'yxati EMAS). Ochilmasa — to'xtang va
xabar bering.

### 3.5. Sverkani o'qing va YOZIB OLING

Hamma rulon va bo'laklar kiritilgach yuqoridagi qatorga qarang:

```
Qoldiq        Reyestr       Farq       Faol bo'laklar
5 854,5       5 854,5          0             14
```

- **Farq = 0** ⇒ tizimdagi son to'g'ri ekan. Zo'r.
- **Farq ≠ 0** ⇒ **bu topilma.** Sonni o'zgartirmang! Shunchaki yozib oling:

| Yozib olinadigan | Misol |
|---|---|
| Tovar nomi | `Uz apunp 2x4` |
| Qoldiq (tizim) | 5 854,5 |
| Reyestr (sizning sanoq) | 5 610 |
| Farq | −244,5 |
| Butun rulon | 250 × 3 · 200 × 4 |
| Bo'laklar soni | 11 |
| Yorliq oralig'i | BLK-000003 … BLK-000013 |

---

## 4. Ish tugagach

1. Beshala tovarning jadvalini (yuqoridagi ko'rinishda) menejerga bering — u
   rejaning §5 → J3 → 1-bandiga yoziladi.
2. Farq chiqqan tovarlarni **alohida ayting** — ular bo'yicha inventarizatsiya
   qilinadi.
3. **Bayroqni O'ZINGIZ yoqmang** — u tekshiruvdan keyin yoqiladi.

---

## 5. Nimadir noto'g'ri ketsa

| Holat | Nima qilish |
|---|---|
| Uzunlikni xato kiritdim | Qator yonidagi **«Tuzatish»** dan uzunlikni o'zgartiring |
| Ortiqcha qator qo'shdim | Qator yonidagi **«Tugadi»** ni bosing — qator hisobdan chiqadi |
| Yorliqni yo'qotdim / yirtildi | O'sha qatordan **«Qayta bosish»** |
| Skanerlaganda tovar ro'yxati ochilyapti | **TO'XTANG**, xabar bering (bu jiddiy nosozlik) |
| Ekran «Farq» ni qizil ko'rsatyapti | Bu **normal** — kiritish tugamaguncha shunday bo'ladi |
| Xato yozib yubordim, hammasini o'chirmoqchiman | Menejerga ayting — bir buyruq bilan tozalanadi |

> Har qanday holatda: **qoldiq (`Qoldiq` ustuni) hech qachon o'zgarmaydi.**
> Bo'lak kiritish, tuzatish yoki yopish qoldiqqa **tegmaydi** — bu tekshirilgan.

---

## 6. Kim nima qila oladi (jonlida o'lchangan, 2026-09-05)

| Kim | Bo'lak ekraniga yoza oladimi |
|---|---|
| **Muxriddin** (Katta omborchi) | ✅ ha |
| **Ilhom** (Administrator) | ✅ ha |
| Ravshan (AccountOwner) | 🔴 **yo'q** — roli eskirgan, tuzatilishi kerak |
| «Omborchi» rolidagi xodimlar | ❌ yo'q (ataylab) |
| Kassirlar | ❌ yo'q (ataylab) |
