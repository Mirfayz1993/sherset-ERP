# Jonli smoke — kassa vaqti (S-reja S1–S5)

> **Yaratilgan:** 2026-09-04 · **Faza:** S5 (`docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md` §5)
> **Holat:** 🟡 **BAJARILMAGAN.** ✅ Deploy **2026-09-04 20:35 da BO'LDI** (jonli HEAD
> `4bf9cee9`, jurnal `2026-09-04-deploy-kassa-vaqti.md`) — ya'ni 0-bo'limdagi to'siq YO'Q,
> smoke'ni istalgan payt bajarsa bo'ladi.
> **Kimga:** egasi + kassa mashinasiga admin bilan kira oladigan odam.
> **Qancha vaqt:** ~15 daqiqa (soatni siljitish va qaytarish bilan birga).

---

## 0. 🔴 Buni QACHON bajarish mumkin

Smoke S1–S5 ning **jonlida** ishlashini tekshiradi. S1–S5 kodi hozir `yacheyka-inventarizatsiya`
branchida turibdi va **deploy QILINMAGAN** (§2 qoida 9: kassa jonli ishlayapti, deploy uni
to'xtatadi — H-reja saboqi, 2026-08-24 da split kassani 46 daqiqa to'xtatgan).

Ya'ni tartib **qat'iy**:

1. egasi «chiqar» deydi → deploy (tinch soatda);
2. **shundan keyin** shu yo'riqnoma bajariladi;
3. natija shu faylning 5-bo'limiga yoziladi.

> 🔴 **Egasining qarori, 2026-09-04 20:00 — chiqarish MARKETPLACE ishi tugagandan KEYIN.**
> O'sha kuni o'lchandi: jonli HEAD `ef99ecb1` («Merge marketplace M1–M9», 2 soat oldin
> chiqarilgan), VPS `origin/climart-adoption` dan **37 commit oldinda** (o'sha ish hech qayerga
> push qilinmagan). Marketplace commitlari S-reja tekkan POS fayllariga tegadi (`m7` — zakazlar
> ro'yxatidagi sayt belgisi, `m5` — onlayn kassir ish o'rni, i18n kalitlari), ya'ni chiqarish
> oddiy «yangi commitni qo'yish» emas, **haqiqiy merge**. Shuning uchun deploy o'sha ish
> joyiga tushgunicha KUTADI. S-reja kodi `yacheyka-inventarizatsiya` da (`00dbee83`) tayyor.

Deploy'dan **oldin** bajarilgan smoke hech nimani isbotlamaydi — jonlida hali eski kod turadi.

---

## 1. Tayyorgarlik

| Nima | Qiymat |
|---|---|
| Vaqt | Mijoz yo'q payt (ertalab ochilishdan oldin yoki yopilishdan keyin) |
| Mashina | **Bitta** kassa (hammasida emas) — nomi jadvalga yoziladi |
| Odamlar | Admin (soatni siljitadi) + kassir yoki egasi (ekranni kuzatadi) |
| Kerak | Mijoz ekrani (CFD) ulangan bo'lsa — yoniq; chek printeri qog'ozli |
| Ogohlantirish | Soat siljigan paytda **haqiqiy savdo qilinmaydi** (7-qadamdan tashqari, u ataylab) |

**Boshlashdan oldin yozib oling:** mashinaning hozirgi to'g'ri vaqti va
`w32tm /query /status` chiqishi (qaytarishda kerak bo'ladi).

---

## 2. Soatni siljitish (admin PowerShell)

```powershell
Stop-Service w32time                    # NTP darhol qaytarib qo'ymasin
Set-Date (Get-Date).AddHours(3)         # qurilma soati 3 SOAT OLDINGA
Get-Date                                # tekshirish
```

> Soat **oldinga** siljitiladi (orqaga emas): orqaga siljish TLS sertifikatlarini yaroqsiz
> qilib, brauzerni umuman ulanmaydigan holga keltirishi mumkin.
> Bu holatda kassa soati serverdan **3 soat oldinda** bo'ladi ⇒ chip «~3 soat oldinda» deydi.

---

## 3. Tekshiruvlar (oltitasi ham)

Har qator uchun: **qadam → kutilgan natija**. Bittasi ham «taxminan» emas — ko'z bilan ko'riladi.

| # | Qadam | Kutilgan natija |
|---|---|---|
| 1 | **Header soati.** Kassa dasturini oching (yoki F5), o'ng yuqoridagi soatga qarang | **To'g'ri vaqt** (server vaqti), Windows'ning pastdagi soati bilan **mos kelmaydi** — farq 3 soat |
| 2 | **Sariq chip.** O'sha yerda, soatning chap yonida | Sariq chip: «Qurilma vaqti ~3 soat oldinda». Chiqishi eng ko'p **30 soniya** oladi (soat pulsi 30 s) |
| 3 | **CFD (mijoz ekrani) soati.** Mijoz ekranini oching (headerdagi CFD tugmasi / ikkinchi monitor) | Yuqoridagi soat header'dagi bilan **bir xil** va to'g'ri |
| 4 | **Chek sanasi (qog'oz).** Savatga 1 ta arzon tovar soling → **sotuvsiz chek (proforma)** bosing | Qog'ozdagi sana va vaqt **to'g'ri** (bugungi kun, hozirgi soat). Bu qadam bazaga **hech nima yozmaydi** |
| 5 | **Navbat «o'tgan vaqt».** «Navbat» rejimini oching (yig'ilayotgan/tayyor cheklar) | Kartadagi «o'tgan vaqt» **haqiqiy** (masalan «10 daq»), 3 soatga oshib ketmagan. Navbat bo'sh bo'lsa: bitta chekni yig'ishga bering yoki qadamni «tekshirilmadi» deb yozing |
| 6 | **Qoralama vaqti** (ixtiyoriy). Savatga tovar solib «Qoralama» tugmasini bosing | Qoralama chipidagi soat **to'g'ri vaqt**, 3 soat oldingi emas |
| 6b | **Qarz kunlari** (qarzdor mijoz bo'lsa; ixtiyoriy) | Kechikish kunlari ERP dagi undirish ro'yxati bilan **bir xil** |

### 7-qadam — bazadagi vaqt (🔴 bu YAGONA yozadigan qadam)

Faqat **egasining ruxsati bilan**:

1. eng arzon tovardan **1 dona** haqiqiy savdo qiling (naqd);
2. **boshqa qurilmadan** (egasining noutbuki/telefoni — kassa mashinasidan EMAS) ERP ni ochib,
   Cheklar ro'yxatida o'sha savdoni toping;
3. savdo vaqti — **haqiqiy hozirgi vaqt** bo'lishi kerak (3 soat oldinga siljigan emas);
4. tekshirgach savdoni **vozvrat** qiling (yoki egasi qoldirishga ruxsat bersa qoldiring).

> Nega ishonch bor: POS serverga `moment` **yubormaydi** — vaqtni server o'zi qo'yadi
> (`retail-sale.service.ts`). Bu qadam shuni jonlida tasdiqlaydi.

---

## 4. Soatni QAYTARISH (majburiy, smoke tugashi bilan)

```powershell
Start-Service w32time
w32tm /resync /force
Get-Date                 # to'g'ri vaqt
w32tm /query /status     # Source: pool.ntp.org (Local CMOS Clock EMAS)
```

Keyin kassa dasturida:

- sariq chip **yo'qolganini** ko'ring (eng ko'p 30 soniya);
- header soati Windows soati bilan **mos** bo'lishi kerak.

Agar `w32time` sozlanmagan bo'lsa — `docs/ops/kassa-vaqt-ntp.md` bo'yicha sozlang
(smoke'dan keyin baribir kerak).

### Agar biror tekshiruv YIQILSA

1. **Avval soatni qaytaring** (yuqoridagi blok) — kassa ishlashda davom etsin;
2. yiqilgan qadamni **skrinshot/foto** bilan qayd eting (chek bo'lsa — qog'ozni saqlang);
3. kodni orqaga qaytarish kerak bo'lsa: oldingi versiyaga deploy (odatdagi
   `deploy/deploy-smart.sh` jarayoni, oldingi commit bilan) — S1–S5 faqat **ko'rsatish**
   qatlamiga tegadi, ya'ni orqaga qaytarish ma'lumotga zarar bermaydi;
4. natijani S-reja §6 dagi S5 hisobotiga yozing.

---

## 5. Natija (to'ldiriladi)

| Sana | Kassa / mashina | Kim | 1 header | 2 chip | 3 CFD | 4 chek | 5 navbat | 6 qoralama | 7 baza | Izoh |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

> Bo'sh jadval = smoke **bajarilmagan**. S5 fazasi shu sababdan «QISMAN» holatida yopilgan.
