-- KUNLIK CHEK RAQAMI (egasi, 2026-09-02): qog'ozda «SAVDO CHEKI № 121» —
-- kassirning shu kundagi ketma-ket soni. Hujjat nomi (`name` = ТРН-2026-…)
-- O'ZGARMAYDI: u tizim ichidagi qidiruv va reyestrlar uchun qoladi.
--
-- Additiv va NULLABLE: mavjud cheklar tegilmaydi (backfill ataylab yo'q —
-- ularning qog'ozida bu raqam umuman chiqmagan), renderer NULL ko'rsa eski
-- xulqqa (hujjat nomiga) qaytadi.
ALTER TABLE "retail_sales" ADD COLUMN "receipt_no" INTEGER;
