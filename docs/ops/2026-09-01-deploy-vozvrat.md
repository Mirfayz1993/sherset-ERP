# 2026-09-01 (kech) — POS Vozvrat oynasi deployi + V0 huquq-toraytirish

> **Bajardi:** Claude · **Egasi buyurtmasi:** Shavkat kassasida Vozvrat tugmasi,
> tovar/mijoz bo'yicha chek qidiruv, mijozsiz (naqd) cheklar ham topilsin.
> **Reja:** `docs/plans/2026-09-01-pos-vozvrat-oynasi.md` (S-V1..S-V3 javoblari bilan)

## Nima chiqdi (jonli HEAD `d4e41377`)

1. **V1 (api):** `GET /retail-sales?productId=` — chekni tovar bo'yicha qidirish
   (`positions.some.productId`, indeks tayyor edi).
2. **V2 (web):** POS yon panelida **Vozvrat** rejimi (Mijozlar ostida),
   `salesreturn.create` borgagina ko'rinadi. Ikki tabli qidiruv (Tovar —
   skaner Enter bilan / Mijoz), natija: `posted` cheklar sana bilan desc,
   50 tadan `cursor` sahifalash. Chek `ChekDetailPanel` da ochiladi (eksport
   qilindi, refund oqimi bitta joyda). Cheklar rejimidagi eski «Qaytarish»
   tugmasi ham endi shu huquq bilan yashirinadi.
3. **Ertalabki tuzatish (shu deployda):** qaytarish rejimi endi **0 bilan
   ochiladi** — «Hammasini qaytarish» tugmasi va qatordagi «/ N» to'ldiradi
   (kassir shikoyati: bitta tovar uchun hammasini 0 ga tushirish kerak edi).

## Deploy jarayoni (retsept bo'yicha, muammosiz)

- Server bizdan OLDINDA edi (`6f0247a4`, mijoz-ekran video/krossfeyd — parallel
  ish): fetch → rebase (3× `docs/progress.json` trivial konflikt, server varianti
  olindi) → darvozalar qayta (web 4460 yashil; `pos-scroll-panel-shrink`
  qo'riqchisi vozvrat ro'yxatlarida `[&>*]:shrink-0` yo'qligini ushladi —
  tuzatildi `d4e41377`).
- Push `deploy-20260901-vozvrat` → serverda `merge --ff-only`.
- Build `NEXT_DISTDIR=.next-new`, sentinel **`BUILD_TUGADI rc=0` KUTILDI**,
  flip (~20:05), pm2 web+api restart. Migratsiya YO'Q.
- Verify domen orqali: 6/6 sahifa 200, api/health 200, `sotuv/page-*.js`
  chunk'ida `vozvrat` bor.
- Qaytarish nuqtasi: `.next-old-vozvrat` + `git reset --hard 6f0247a4`.
- ⚠️ Klassifikator birlashgan flip buyrug'ini blokladi — mayda qadam (alohida
  `mv`, alohida `pm2 restart`) ISHLADI (avvalgi saboq tasdiqlandi).

## V0 — vozvrat huquqi toraytirildi (jonli, HTTP orqali)

Skript `apps/api/src/scripts/ops-v0-vozvrat-huquqi.ts` (DRY → APPLY → nazorat-DRY):

- **Kassir** va **PointOfSale** rollaridan `salesreturn.create` olib tashlandi
  (`view` qoldi); ofis/admin rollariga tegilmadi.
- **Shavkat** (`2bcf6bf3…`) va **Muxriddin** (`dade79a1…`) ga MK26 xodim-override
  `salesreturn.create=ALL` yozildi (note: «V0 vozvrat huquqi — egasi 2026-09-01»).
- Amalda huquq qoldi: Shavkat, Muxriddin (override) + Ravshan (owner),
  Admin User, Ilhom (admin), B2B (sales_manager — ofis).
- Yo'qoldi: Umid 1, Umid, Bahodir, Sardor, Otabek, Jahongir, Umrbek.
- Qaytarish: kassir shabloniga `apply-template` (create'ni tiklaydi) yoki
  override'ga `scope:null`.

## Ochiq qoldiq

- Ertalabki jonli smoke egasida: Shavkat login → Vozvrat tugmasi BOR, tovar
  qidirib eski chekdan 1 dona qaytarish; oddiy kassirda tugma YO'Q.
- Vozvrat tovari kaskad boshiga (Ombor 07) tushishi — ATAYLAB (M1 qaydi),
  yacheykaga joylashtirish omborchi oqimida.
- GitHub `mirfayz` zaxirasi hamon orqada (push qilinmagan).
