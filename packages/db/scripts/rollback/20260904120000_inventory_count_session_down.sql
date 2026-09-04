-- QAYTARISH YO'LI (F-reja 2-bo'lim, 12-qoida) — N1 migratsiyasining TESKARISI.
--
-- Reja: `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md` (§5, N1).
-- Asl migratsiya:
--   `packages/db/prisma/migrations/20260904120000_inventory_count_session/`.
--
-- Migratsiya `inventories` ga 5 ta ustun + 1 indeks, `inventory_positions` ga
-- 3 ta nullable ustun qo'shadi; birorta `UPDATE`/`DELETE` yo'q. Shuning uchun
-- bu teskari yo'l — sof DDL qaytarish.
--
-- 🔴 MA'LUMOT YO'QOLADI: sanash sessiyalarining IZI o'chadi — qaysi hujjat
-- sessiya bo'lgani, kim sanagani, qachon yopilgani/tasdiqlangani va har
-- qatorning qaysi avto-hujjatga tegishli ekani. QOLDIQQA TEGMAYDI:
--   · `stock` / `stock_by_cell` raqamlari bu ustunlarga bog'liq EMAS —
--     ular `setCellStock` yozgan avto-hujjatlar bilan tenglashgan;
--   · sessiya hujjatlari `inventories` da QOLADI (qatorlari bilan), faqat
--     ular endi oddiy hujjatdan farq qilmaydi.
--
-- 🔴 ENG XAVFLI OQIBAT — QO'RIQCHI YO'QOLADI: `count_session` ustuni
-- bo'lmasa `transition()` post/cancel taqiqi ishlamaydi va eski sessiya
-- hujjati POST QILINSA farq qoldiqqa IKKINCHI marta tushadi (reja §2.1).
-- Shu sabab qaytarishdan OLDIN ochiq/yopilgan sessiyalarni sanab oling va
-- ularni `deleted_at` bilan yoping:
--
--   SELECT id, name, state, count_session, closed_at, confirmed_at
--     FROM inventories WHERE count_session = true;
--
-- ⚠️ KOD BILAN TARTIB: bu skript kod ESKI holatga qaytarilgandan KEYIN
-- yugurtiriladi (aks holda Prisma mavjud bo'lmagan ustunni so'rab
-- `/inventories` ro'yxatini yiqitardi).
--
-- Idempotent: `IF EXISTS` — qayta yugurtirish no-op.

DROP INDEX IF EXISTS "inventories_account_id_count_session_closed_at_idx";

ALTER TABLE "inventories" DROP COLUMN IF EXISTS "count_session";
ALTER TABLE "inventories" DROP COLUMN IF EXISTS "counted_by";
ALTER TABLE "inventories" DROP COLUMN IF EXISTS "closed_at";
ALTER TABLE "inventories" DROP COLUMN IF EXISTS "confirmed_by";
ALTER TABLE "inventories" DROP COLUMN IF EXISTS "confirmed_at";

ALTER TABLE "inventory_positions" DROP COLUMN IF EXISTS "auto_doc_type";
ALTER TABLE "inventory_positions" DROP COLUMN IF EXISTS "auto_doc_id";
ALTER TABLE "inventory_positions" DROP COLUMN IF EXISTS "auto_doc_name";
