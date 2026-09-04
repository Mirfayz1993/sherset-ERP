# Kassa mashinasining soatini NTP ga ulash (ops yo'riqnomasi)

> **Yaratilgan:** 2026-09-04 · **Faza:** S-reja S5 (`docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md`)
> **Kimga:** kassa mashinasiga admin huquqi bilan kira oladigan odam (egasi / IT).
> **Qancha vaqt oladi:** bitta mashinada ~3 daqiqa. Kassani TO'XTATMAYDI.

---

## 1. Nega bu kerak

S-reja S1–S4 dan keyin kassa dasturi qurilma soatiga **bog'liq emas**: ekrandagi soat, chekdagi
sana, «o'tgan vaqt» hisoblari va qog'oz hujjatlar — hammasi server vaqtidan va qat'iy
`Asia/Tashkent` mintaqasidan chiziladi. Ya'ni soati adashgan kassa ham **to'g'ri ishlaydi**.

Lekin ildiz sabab joyida qoladi: mashinaning o'z soati adashgan bo'lsa —

- Windows'ning o'zi (loglar, sertifikat tekshiruvi, yangilanish) xato vaqtda ishlaydi;
- kassir ekranning pastidagi Windows soatiga qarab chalg'iydi;
- dastur tashqarisidagi har qanday narsa (chop-agent loglari, TeamViewer va b.) xato vaqt yozadi.

Shuning uchun: **dastur — immunitet, NTP — davolash.** Ikkalasi ham kerak.

S5 dan boshlab kassa header'ida sariq chip chiqadi — «Qurilma vaqti ~N daqiqa orqada/oldinda»
(farq 2 daqiqadan oshsa). Chip chiqqan mashinada aynan shu yo'riqnoma bajariladi.

---

## 2. Nega buni O'RNATUVCHI o'zi qilmaydi (o'lchandi, 2026-09-04)

Savol tabiiy: `w32tm` buyrug'ini NSIS o'rnatuvchisiga qo'shib qo'yish mumkin emasmi?

**Yo'q — hozirgi o'rnatish modelida mumkin emas.** O'lchov:

| Fayl | Qiymat |
|---|---|
| `desktop/package.json` → `build.nsis` | `"perMachine": false` |
| `desktop/omborchi.builder.json` → `nsis` | `"perMachine": false` |

`perMachine: false` = **per-user o'rnatma**, ya'ni o'rnatuvchi UAC so'ramaydi va oddiy
foydalanuvchi huquqi bilan ishlaydi. `w32tm /config` ham, `sc config w32time` ham
**administrator** talab qiladi — per-user o'rnatuvchidan ular shunchaki «Access denied» beradi.

🔴 **`perMachine` ni `true` ga o'zgartirish YECHIM EMAS.** Bu qiymat ataylab tanlangan va
testda qulflangan (`apps/web/src/__tests__/kassa-installer-config.test.ts:129`, izohda niyati
yozilgan, F8/K03): kassirda admin huquqi yo'q, per-machine o'rnatmada esa **har avtoyangilanish
UAC so'raydi** ⇒ yangilanish amalda hech qachon o'rnatilmasdi. Ya'ni `perMachine: true` butun
avtoyangilanish modelini sindiradi — vaqt sozlash uchun bunga bormaymiz.

Watchdog ham xuddi shu naqshda ishlaydi: `desktop/tools/watchdog/install-watchdog.ps1`
qurilmada **bir marta, admin bilan** qo'lda yugurtiriladi (`-RunLevel Limited` bilan
ro'yxatdan o'tadi). NTP sozlash ham shu toifadagi ish — **bir martalik ops qadami**, dastur
qismi emas.

---

## 3. Bajarish (admin PowerShell)

**PowerShell ni administrator sifatida oching:** Пуск → `PowerShell` → o'ng tugma →
«Запуск от имени администратора». Sarlavhada «Администратор» yozuvi turishi SHART.

### 3.1. Xizmatni yoqish

```powershell
Set-Service w32time -StartupType Automatic
Start-Service w32time
```

> 🔴 **Tuzoq:** PowerShell'da `sc` — bu `Set-Content` ning aliasi, `sc.exe` EMAS.
> Ya'ni `sc config w32time start= auto` PowerShell'da **ishlamaydi** (fayl yozmoqchi bo'ladi).
> Yuqoridagi `Set-Service` — o'sha ishning to'g'ri shakli. Agar `sc.exe` ni ishlatmoqchi
> bo'lsangiz, `.exe` va `=` dan keyingi **bo'shliq** shart: `sc.exe config w32time start= auto`.

### 3.2. NTP serverlarini ko'rsatish va sinxronlash

```powershell
w32tm /config /manualpeerlist:"pool.ntp.org,0x9 time.windows.com,0x9" /syncfromflags:manual /update
Restart-Service w32time
w32tm /resync /force
```

`,0x9` — «SpecialInterval + Client» bayrog'i: mashina serverni belgilangan oraliqda o'zi
so'rab turadi (usiz ba'zi Windows nusxalari bir marta sinxronlab, keyin unutadi).

### 3.3. Mintaqani tekshirish (soatdan alohida masala)

```powershell
tzutil /g
```

Kutilgan javob: `Central Asia Standard Time` (UTC+5, Toshkent).

> Mintaqa xato bo'lsa POS **ko'rinishi buzilmaydi** (S4 dan keyin sana/vaqt qat'iy
> `Asia/Tashkent` da chiziladi) va sariq chip ham **chiqmaydi** — chip UTC farqini o'lchaydi,
> mintaqani emas. Xavf boshqa yoqdan keladi: mintaqasi xato mashinada Windows soati odamga
> noto'g'ri ko'rinadi va kimdir uni **qo'lda «to'g'rilab»** qo'yadi — o'shanda UTC buziladi va
> chip N soatlik farqni ko'rsatib qoladi. Shuning uchun mintaqa avval to'g'rilanadi:
> `tzutil /s "Central Asia Standard Time"`.

---

## 4. Tekshirish (bu qadam TASHLAB KETILMAYDI)

```powershell
w32tm /query /status
```

Kutilgan natija (muhim qatorlar):

- `Source:` — `pool.ntp.org` yoki `time.windows.com` (**`Local CMOS Clock` BO'LMASIN** — bu
  «hech kim bilan sinxronlanmayapti» degani);
- `Last Successful Sync Time:` — hozirgi vaqtga yaqin;
- `Stratum:` — 2–4 orasida (`0` yoki `unspecified` bo'lmasin).

Qo'shimcha ikki tekshiruv:

```powershell
w32tm /query /peers                                   # ro'yxat va «Active» holati
w32tm /stripchart /computer:pool.ntp.org /samples:3 /dataonly   # farq sekundlarda
```

`stripchart` chiqargan farq **1 sekunddan kichik** bo'lishi kerak.

**Eng oxirgi tekshiruv — kassaning O'ZIDA:** dasturni oching va header'ga qarang.
Sariq chip **yo'q bo'lishi** kerak. Chip hamon tursa — 5-bo'limga qarang.

---

## 5. Muammolar

| Alomat | Sabab / yechim |
|---|---|
| `Access is denied` | PowerShell admin emas. Oynani yoping va «Запуск от имени администратора» bilan qayta oching. |
| `Source: Local CMOS Clock` | `/config` qadam qo'llanmagan yoki xizmat qayta ishga tushmagan. 3.2 ni qaytadan, `Restart-Service w32time` bilan. |
| `The computer did not resync…` | 123/UDP port yopiq (router/provayder). Ichki NTP manbasini ko'rsating yoki tarmoq egasiga ayting. |
| Soat qayta-qayta adashadi | BIOS batareyasi (CR2032) o'lgan — mashina o'chgach vaqtni unutadi. Batareyani almashtiring; NTP har ko'tarilishda to'g'rilaydi, lekin sana butunlay sakrasa TLS ham buziladi. |
| Chip «~5 soat» ko'rsatadi | Deyarli har doim mintaqa+qo'lda tuzatish kombinatsiyasi (§3.3). `tzutil /g` va `w32tm /resync /force`. |
| Mashina domenda | Domen a'zosida vaqt manbasi domen kontrolleridan keladi — `/syncfromflags:manual` ni QO'LLAMANG, domen adminiga murojaat qiling. |

---

## 6. Bajarilgan kassalar reyestri

Har mashinada bajarilgach shu jadval to'ldiriladi (mashina nomi — Windows'dagi nomi:
`hostname`).

| # | Kassa / mashina | Sana | Kim bajardi | `w32tm /query /status` → `Source` | Chip yo'qoldimi |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

> Jadval **bo'sh holda** qo'shildi: S5 fazasi kod tomonini yopdi, mashinalarga kirish esa
> egasining qo'lida. To'ldirilmagan qator = o'sha kassada ish **bajarilmagan**.

---

## 7. Orqaga qaytarish

Sozlash mashinaga zarar bermaydi, lekin kerak bo'lsa:

```powershell
w32tm /config /syncfromflags:domhier /update   # domen naqshiga qaytaradi
Restart-Service w32time
```

Dastur tomonidan **hech nima qaytarilmaydi** — POS baribir server vaqtida ishlaydi (S1–S4).
