# TSD — release-imzo va tarqatish kanali

> **Yaratilgan:** 2026-09-04 (T-reja, T9) · **Egasi:** Ozodbek
> **Tegishli:** `android/tsd-app`, `docs/plans/2026-09-03-tsd-omborchi-qulayligi.md` §4-T9,
> U-reja (`2026-09-01-tsd-zamonaviy-ui.md`) «IMZO QARZI».
>
> 🔴 **Bu faylda SIR YO'Q.** Repo public — parol, kalit fayli va ularning mazmuni bu yerga
> hech qachon yozilmaydi. Bu yerda faqat **tartib** va **joylashuv nomi** bor.

---

## 1. Nega bu kerak edi

Android yangilanishni **imzo bo'yicha** qabul qiladi: o'rnatilgan ilova ustiga faqat **ayni kalit**
bilan imzolangan APK tushadi. 0.5.0 gacha TSD APK'si **debug-kalit** bilan
(`~/.android/debug.keystore`, iz `b8ae71fd…`) imzolanardi. U kalit:

- Android SDK **avtomatik** yaratadi va uni hech kim zaxiralamaydi;
- SDK qayta o'rnatilsa yoki mashina almashsa **jimgina boshqasi** paydo bo'ladi;
- yo'qolsa yangilanish kanali o'ladi: har terminalda ilovani **o'chirib qayta o'rnatish** kerak
  bo'ladi va **juftlash yo'qoladi** (qurilma kaliti ilova ma'lumotlari bilan birga o'chadi).

Hozir jonli terminal **bitta** (iData 95W Pro) — o'tish arzon. Terminallar ko'paygach har biri
qo'lda qayta juftlanishi kerak bo'lardi.

## 2. Kalit qayerda (nomlar — sirning o'zi emas)

| Nima | Joyi | Izoh |
|---|---|---|
| Kalit ombori | `%USERPROFILE%\.sherset\sherset-tsd-release.jks` | PKCS12, RSA 4096, **2056** gacha |
| Parol + alias | `%USERPROFILE%\.sherset\sherset-tsd-release.properties` | `chmod 600`, repoda YO'Q |
| Alias | `sherset-tsd` | |
| Sertifikat izi (SHA-256) | `7bd90f5358091d95d0e6ac053ee835fe291da78d61fbf984ddef6b83306678ec` | **sir emas** — har APK ichida bor |

Ikkalasi ham **repodan tashqarida**. `app/build.gradle.kts` `.properties` faylni o'qiydi;
yo'lni `SHERSET_TSD_KEYSTORE_PROPS` muhit o'zgaruvchisi bilan boshqa joyga ko'rsatish mumkin.
Repo tomonda qo'shimcha to'siq: `android/tsd-app/.gitignore` da `*.jks`, `*.keystore`,
`*keystore*.properties`.

Sertifikat izi `tools/publish.sh` ichida `EXPECTED_SIGNER` sifatida **ataylab** turadi: xato bilan
debug-kalitli APK chiqarilsa, skript uni serverga **yuklashdan oldin** to'xtatadi.

## 3. 🔴 ZAXIRA — kim, qayerda, qanday

Kalit yo'qolsa uni **hech qanday yo'l bilan tiklab bo'lmaydi** (§6). Shuning uchun ikkala fayl ham
**kamida ikkita** joyda turishi kerak, ikkalasi ham shu mashinadan tashqarida:

1. **Egasining parol menejeri** (1Password/Bitwarden/KeePass — qaysi ishlatilsa) — `.jks` faylni
   biriktirma sifatida, parolni alohida yozuv sifatida.
2. **Oflayn nusxa** — shifrlangan USB yoki egasining shaxsiy seyfi/telefon xotirasi.

Nusxa olish (Git Bash, shu mashinada):

```sh
cp ~/.sherset/sherset-tsd-release.jks        /d/zaxira/
cp ~/.sherset/sherset-tsd-release.properties /d/zaxira/
```

**Tekshiruv (nusxa haqiqatan ochiladimi):** faylni ko'chirgach nusxadan izni o'qing —
quyidagi buyruq §2 dagi bilan **bir xil** SHA-256 berishi shart:

```sh
/d/dev/java/jdk-17/bin/keytool -list -v -keystore /d/zaxira/sherset-tsd-release.jks -alias sherset-tsd
```

(parol so'raladi — uni `.properties` dan olasiz). `keytool` izni **ikki nuqtali va katta
harfda** chiqaradi (`7B:D9:0F:…`), `apksigner` esa nuqtasiz kichik harfda — bu bir xil son.
Iz mos kelmasa nusxa **noto'g'ri**.

🔴 Zaxira **bulutli kod xosting**iga (GitHub, Gitea) va umumiy chatga **qo'yilmaydi**.

## 4. Yangi versiya chiqarish

Tartib o'zgarmadi, faqat build endi **release**:

```sh
# 1) app/build.gradle.kts — versionCode +1 VA versionName oshiriladi
# 2) bitta buyruq: assembleRelease -> imzo tekshiruvi -> APK -> latest.json -> tekshiruv
bash android/tsd-app/tools/publish.sh "nima o'zgardi"
```

Skript ketma-ketligi: versiya serverda bor-yo'qligini tekshiradi → `assembleRelease` →
**`apksigner` bilan imzo izini `EXPECTED_SIGNER` ga solishtiradi** → APK → `latest.json` →
serverdan xeshni qayta o'qib tasdiqlaydi.

Kalit topilmasa `assembleRelease` **aniq xabar bilan yiqiladi** (imzosiz APK chiqib ketmasin):

```
Release kaliti topilmadi: C:\Users\user\.sherset\sherset-tsd-release.properties
Bir marta yaratish: bash android/tsd-app/tools/imzo-yarat.sh
Zaxiradan tiklash: docs/ops/tsd-release-imzo.md
```

`assembleDebug` kalitsiz ham ishlayveradi — kundalik ish to'xtamaydi.

## 5. 🔴 Bir martalik o'tish: debug → release

**Debug-imzoli ilova ustiga release APK TUSHMAYDI.** Android «App not installed» /
«Paket mos kelmaydi» deydi. Bu **kutilgan** xulq, nosozlik emas.

Ya'ni terminaldagi «Yangilanish bor» kartasi 0.6.0 ni ko'rsatadi, yuklab oladi, lekin
**o'rnatishda to'xtaydi**. Shuning uchun o'tish **qo'lda** qilinadi.

**Har terminalda (hozir bitta — iData 95W Pro), egasi ishtirokida:**

1. **AVVAL: eski juftlashni yozib oling yoki yangisiga tayyorlaning.** `deviceSecret` bazada
   **xesh** holida yotadi va uni qayta ko'rsatib bo'lmaydi. Ikki yo'l:
   - eski `deviceId` + `deviceSecret` qog'ozda/parol menejerida saqlangan bo'lsa — o'shani
     qayta kiritasiz, serverda hech narsa o'zgartirilmaydi;
   - saqlanmagan bo'lsa — admin **yangi juftlash** ochadi:
     `POST /api/v1/auth/tsd-device/pair` `{"name":"TSD-1","storeId":"<ombor UUID>"}` →
     javobdagi `deviceId` va `deviceSecret` yoziladi.
2. Yarim bajarilgan yig'ish/sanash **bo'lmasin**: ilovani o'chirish uning butun ma'lumotini
   o'chiradi — `ActionQueue` navbati (`tsd_action_queue` SharedPreferences) ham, qurilma kaliti
   (`DeviceStore`, EncryptedSharedPreferences) ham. Terminalda **navbat bo'sh** ekaniga ishonch
   hosil qiling (bosh ekrandagi navbat ko'rsatkichi).
3. Terminalning brauzerida `https://erp.sherset.uz/downloads/tsd/sherset-tsd-0.6.0.apk` ni
   oching va yuklab oling (kanal tokensiz — ilova ishlamayotganda ham ochiladi).
4. **Eski ilovani o'chiring** (Sozlamalar → Ilovalar → Sherset TSD → O'chirish).
5. Yuklab olingan APK'ni o'rnating («noma'lum manba» ruxsati kerak bo'lishi mumkin).
6. Ilovani oching → **Terminalni ulash** → `deviceId` + `deviceSecret` → **Saqlash** → PIN.
7. Yangi juftlash ochilgan bo'lsa, **eskisini yoping**:
   `POST /api/v1/auth/tsd-device/<eski-id>/revoke` (yoki `GET /api/v1/auth/tsd-devices` bilan
   ro'yxatdan topib). Ochiq qolgan eski qurilma yozuvi — keraksiz kirish yo'li.
8. Bosh ekranda versiya **0.6.0** ekanini tekshiring.

Shundan **keyin** yangilanish kanali odatdagidek ishlaydi: 0.6.0 → 0.7.0 → … hammasi ayni
release kalit bilan imzolangani uchun ilova ichidan tushadi.

## 6. Kalit yo'qolsa

Tiklashning **yo'li yo'q** — yangi kalit **boshqa** ilova hisoblanadi. Natija: §5 dagi 8 bandli
qo'l ishi **har terminalda** qaytadan bajariladi (o'chirish + qayta o'rnatish + qayta juftlash),
va oflayn navbatdagi yuborilmagan amallar yo'qoladi.

`tools/imzo-yarat.sh` kalit mavjud bo'lsa **to'xtaydi** — tasodifan «yangisini yasab qo'yish»
tuzog'i shu bilan yopilgan.

## 7. Boshqa mashinada build qilish

Mumkin, lekin kalit ko'chirilishi shart:

1. `~/.sherset/` katalogini yarating va zaxiradan ikkala faylni nusxalang.
2. `.properties` ichidagi `storeFile` yo'lini **yangi mashinaning** yo'liga to'g'rilang
   (oldinga qiya chiziq bilan: `C:/Users/<kim>/.sherset/sherset-tsd-release.jks`).
3. `bash android/tsd-app/tools/publish.sh "…"` — skript imzo izini o'zi tekshiradi.

Kalit **hech qachon** CI'ga yoki umumiy mashinaga qo'yilmaydi.
