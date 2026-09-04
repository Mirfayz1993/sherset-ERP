-- SANASH SESSIYASI (N-reja N1) — `docs/plans/2026-09-04-sanash-sessiyasi-farqlar-hisoboti.md`
--
-- Hozir yacheyka sanashi IZSIZ: `setCellStock` darhol avto-Оприходование /
-- avto-Списание yozadi va tamom. Bu migratsiya mavjud `Inventory` hujjatini
-- sanash sessiyasi sifatida ishlatish uchun IZ ustunlarini qo'shadi (yangi
-- jadval YO'Q — egasining Q1 qarori).
--
-- 🔴 Nega `attributes` EMAS: `AttributeMetadataService.validateAndNormalize`
-- metadatada ro'yxatdan o'tmagan kalitlarni jimgina tashlaydi, ya'ni
-- `attributes.__countSession` belgisi web'dagi BIRINCHI tahrirda yo'qolardi —
-- va u bilan birga ikki-karra-qo'llash qo'riqchisi ham (reja §2.2).
--
-- Hammasi ADDITIV va NULLABLE (yagona default — `count_session = false`), birorta
-- `UPDATE`/`DELETE` yo'q: mavjud inventarizatsiya hujjatlari bir bayt ham
-- o'zgarmaydi va sessiyasiz sanash (bugungi yo'l) avvalgidek ishlaydi.
--
-- Idempotent: `IF NOT EXISTS` — qayta yugurtirish no-op.

-- ── inventories: sessiya belgisi va iz maydonlari ─────────────────────────
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "count_session" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "counted_by" UUID;
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMPTZ;
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "confirmed_by" UUID;
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ;

-- `counted_by` / `confirmed_by` da FK ATAYLAB yo'q —
-- `restock_task_lines.shortage_by_id` naqshi: iz qatlami xodim yozuvi
-- o'chirilganda ham qolishi kerak.

-- «Ochiq sessiyalar» (closed_at IS NULL) va «yopilganlar» ro'yxati uchun.
CREATE INDEX IF NOT EXISTS "inventories_account_id_count_session_closed_at_idx"
  ON "inventories"("account_id", "count_session", "closed_at");

-- ── inventory_positions: qator qaysi avto-hujjatni tug'dirgani ────────────
-- Denormal `auto_doc_name`: hujjat keyinchalik o'chirilsa ham qog'ozdagi
-- raqam hisobotda ko'rinib tursin.
ALTER TABLE "inventory_positions" ADD COLUMN IF NOT EXISTS "auto_doc_type" VARCHAR(10);
ALTER TABLE "inventory_positions" ADD COLUMN IF NOT EXISTS "auto_doc_id" UUID;
ALTER TABLE "inventory_positions" ADD COLUMN IF NOT EXISTS "auto_doc_name" VARCHAR(100);
