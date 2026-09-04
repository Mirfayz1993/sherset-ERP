package uz.sherset.tsd

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T10 — oflayn o'quv keshining IKKI eng xavfli qarori.
 *
 *  1. **Keshga NIMA tushadi.** Bu yerda narx qoidasi (§2, qoida 3) qulflanadi:
 *     serverning javobiga narx maydoni qo'shilib qolsa ham u keshga o'ta
 *     olmasligi kerak — «ekranda ko'rsatmayapmiz» isbot emas.
 *  2. **Kesh qachon ESKI.** Muddati o'tgan yoki kelajakdan kelgan yozuv
 *     ko'rsatilmaydi; yosh raqami plashkada to'g'ri chiqadi.
 *
 * `CacheShape` ataylab sof modul ([QtyExpression], [CountUndo] naqshi):
 * Android ham, Compose ham kirmaydi, shuning uchun bu testlar oddiy JVM'da
 * yuguradi.
 */
class CacheShapeTest {

    // ── 1. NARX (qizil chiziq) ─────────────────────────────────────────────

    /**
     * 🔴 ENG MUHIM QULF. Server javobiga narx maydonlari qo'shilgan holat
     * modellashtiriladi — kesh ularning BIRORTASINI ham saqlamasligi kerak.
     */
    @Test
    fun cachedaNarxYoq() {
        val resp = JSONObject()
            .put(
                "stock",
                JSONArray().put(
                    JSONObject()
                        .put("assortmentId", "p1")
                        .put("name", "Kabel 2x1.5")
                        .put("qty", "14")
                        // Serverga kelajakda qo'shilib qolishi mumkin bo'lgan narx:
                        .put("salePrice", 120000)
                        .put("buyPrice", 90000)
                        .put("price", JSONObject().put("value", 120000).put("currency", "UZS")),
                ),
            )
            .put(
                "products",
                JSONArray().put(
                    JSONObject().put("id", "p2").put("name", "Rozetka").put("minPrice", 5000),
                ),
            )
            .put("cells", JSONArray().put(JSONObject().put("id", "c1").put("name", "02-01-01-04")))

        val text = CacheShape.cell(resp).toString().lowercase()
        for (word in listOf("price", "narx", "цена", "sum", "uzs", "120000", "90000", "5000")) {
            assertFalse("keshda «$word» chiqib qoldi: $text", text.contains(word))
        }
    }

    /** Oq ro'yxatda yo'q OBYEKT butunlay tashlanadi (shakli noma'lum). */
    @Test
    fun oqRoyxatsizObyektTushmaydi() {
        val src = JSONObject()
            .put("id", "p1")
            .put("name", "Kabel")
            .put("cells", JSONArray().put(JSONObject().put("cellName", "01-01").put("cost", 7)))
        val out = CacheShape.pick(src, setOf("id", "name", "cells"))
        // `cells` oq ro'yxatda bor, lekin `nested` e'lon qilinmagan ⇒ ichidagi
        // obyektlar SKALYAR emas, ya'ni ular ham tushmaydi.
        assertEquals(0, out.optJSONArray("cells")!!.length())
    }

    /** E'lon qilingan ichki ro'yxat O'Z oq ro'yxati bilan o'tadi. */
    @Test
    fun elonQilinganIchkiRoyxatOtadi() {
        val resp = JSONObject().put(
            "products",
            JSONArray().put(
                JSONObject()
                    .put("id", "p1")
                    .put("name", "Kabel")
                    .put("barcodes", JSONArray().put("4780").put("4781"))
                    .put(
                        "cells",
                        JSONArray().put(
                            JSONObject()
                                .put("cellName", "02-01-01-04")
                                .put("qty", "14")
                                .put("cost", 999),
                        ),
                    ),
            ),
        )
        val hit = CacheShape.search(resp).optJSONArray("products")!!.optJSONObject(0)!!
        val cell = hit.optJSONArray("cells")!!.optJSONObject(0)!!
        assertEquals("02-01-01-04", cell.optString("cellName"))
        assertEquals("14", cell.optString("qty"))
        assertFalse(cell.has("cost"))
        assertEquals(2, hit.optJSONArray("barcodes")!!.length())
    }

    /** `null` MA'NOLI: `confirmedAt = null` = qator OCHIQ, tashlab bo'lmaydi. */
    @Test
    fun nullSaqlanadi() {
        val src = JSONObject().put("id", "l1").put("confirmedAt", JSONObject.NULL)
        val out = CacheShape.pick(src, CacheShape.LINE_FIELDS)
        assertTrue(out.has("confirmedAt"))
        assertTrue(out.isNull("confirmedAt"))
    }

    /**
     * 🔴 Kesim (K4) oflaynda BOSHLANMAYDI: bo'lak maydonlari keshga tushmaydi,
     * shuning uchun `optBoolean("pieceTracked")` `false` bo'ladi va tugma
     * chizilmaydi.
     */
    @Test
    fun bolakMaydonlariKeshgaTushmaydi() {
        val resp = JSONObject().put(
            "lines",
            JSONArray().put(
                JSONObject()
                    .put("id", "l1")
                    .put("productName", "Kabel")
                    .put("pieceTracked", true)
                    .put("pieceOptions", JSONArray().put(JSONObject().put("id", "blk1"))),
            ),
        )
        val line = CacheShape.task(resp).optJSONArray("lines")!!.optJSONObject(0)!!
        assertFalse(line.optBoolean("pieceTracked"))
        assertFalse(line.has("pieceOptions"))
    }

    // ── 2. YOSH ────────────────────────────────────────────────────────────

    @Test
    fun yoshDaqiqaVaSoatda() {
        val t = 1_000_000_000L
        assertEquals(CacheShape.Age.Fresh, CacheShape.age(t, t + 30_000L))
        assertEquals(CacheShape.Age.Minutes(12), CacheShape.age(t, t + 12 * 60_000L))
        assertEquals(CacheShape.Age.Hours(3), CacheShape.age(t, t + 3 * 3_600_000L))
        // Chegara: 59 daqiqa hamon daqiqada, 60 daqiqa — soatda.
        assertEquals(CacheShape.Age.Minutes(59), CacheShape.age(t, t + 59 * 60_000L))
        assertEquals(CacheShape.Age.Hours(1), CacheShape.age(t, t + 60 * 60_000L))
    }

    /** 🔴 Bitta smenadan eski yozuv KO'RSATILMAYDI. */
    @Test
    fun smenadanEskiYozuvKorsatilmaydi() {
        val t = 1_000_000_000L
        assertEquals(
            CacheShape.Age.Hours(11),
            CacheShape.age(t, t + CacheShape.MAX_AGE_MS - 60_000L),
        )
        assertEquals(CacheShape.Age.Expired, CacheShape.age(t, t + CacheShape.MAX_AGE_MS + 1L))
    }

    /** Qurilma soati orqaga surilgan — «−3 soat oldin» plashkasi bo'lmaydi. */
    @Test
    fun kelajakdagiYozuvHamEski() {
        val t = 1_000_000_000L
        assertEquals(CacheShape.Age.Expired, CacheShape.age(t, t - 1L))
    }

    // ── 3. HAJM ────────────────────────────────────────────────────────────

    /** Yozuv soni chegarasi: eng ESKISI (boshidagi) chiqadi. */
    @Test
    fun yozuvSoniChegarasi() {
        val bucket = JSONArray()
        for (i in 0 until 8) bucket.put(JSONObject().put("k", "y$i").put("at", i))
        val out = CacheShape.trim(bucket, entryCap = 3)
        assertEquals(3, out.length())
        assertEquals("y5", out.optJSONObject(0)!!.optString("k"))
        assertEquals("y7", out.optJSONObject(2)!!.optString("k"))
    }

    /** Bayt chegarasi yozuv sonidan QAT'IY NAZAR ishlaydi. */
    @Test
    fun baytChegarasiHamKesadi() {
        val fat = "x".repeat(40_000)
        val bucket = JSONArray()
        for (i in 0 until 20) bucket.put(JSONObject().put("k", "y$i").put("v", fat))
        val out = CacheShape.trim(bucket, entryCap = 20)
        assertTrue("bo'lim chegaradan katta qoldi", out.toString().length <= CacheShape.BUCKET_BYTES)
        assertTrue("hamma yozuv tashlab yuborildi", out.length() > 0)
        // Eng YANGISI (oxirgisi) albatta qoladi.
        assertEquals("y19", out.optJSONObject(out.length() - 1)!!.optString("k"))
    }

    /**
     * Bitta yacheyka yozuvining ENG YOMON hajmi — hisobotdagi raqam shu
     * testdan olinadi. Chegaradan oshsa kesh bitta javonni ham saqlay
     * olmasdi.
     */
    @Test
    fun engQalinYacheykaBolimgaSigadi() {
        val stock = JSONArray()
        for (i in 0 until CacheShape.ROW_CAP + 50) {
            stock.put(
                JSONObject()
                    .put("assortmentKind", "product")
                    .put("assortmentId", "clx0000000000000000000$i")
                    .put("name", "Kabel VVG 3x2.5 oq, o'ram $i")
                    .put("code", "00$i")
                    .put("barcode", "478000000000$i")
                    .put("qty", "123.456"),
            )
        }
        val resp = JSONObject()
            .put("cells", JSONArray().put(JSONObject().put("id", "c1").put("name", "02-01-01-04")))
            .put("stock", stock)
            .put("products", JSONArray())
        val cached = CacheShape.cell(resp)
        // Qator chegarasi ishladi.
        assertEquals(CacheShape.ROW_CAP, cached.optJSONArray("stock")!!.length())
        val bytes = cached.toString().length
        assertTrue("bitta yacheyka $bytes bayt — bo'lim chegarasidan katta", bytes < CacheShape.BUCKET_BYTES)
        // Hisobot uchun o'lchov: chegaraga nechta shunday yacheyka sig'adi.
        println("T10: eng qalin yacheyka = $bytes bayt; bo'limga ~${CacheShape.BUCKET_BYTES / bytes} ta sig'adi")
    }

    /** Qidiruv natijasi server kesgan chegaradan oshmaydi. */
    @Test
    fun qidiruvNatijasiChegarada() {
        val products = JSONArray()
        for (i in 0 until 100) products.put(JSONObject().put("id", "p$i").put("name", "T$i"))
        val out = CacheShape.search(JSONObject().put("products", products).put("truncated", true))
        assertEquals(CacheShape.HIT_CAP, out.optJSONArray("products")!!.length())
        // `truncated` — OGOHLANTIRISH, u ham saqlanadi (jim kesish IS-5 klassi).
        assertTrue(out.optBoolean("truncated"))
    }

    /** Topshiriq qatorlari ham chegaralangan. */
    @Test
    fun topshiriqQatorlariChegarada() {
        val lines = JSONArray()
        for (i in 0 until CacheShape.LINE_CAP + 10) lines.put(JSONObject().put("id", "l$i"))
        val out = CacheShape.task(JSONObject().put("id", "t1").put("lines", lines))
        assertEquals(CacheShape.LINE_CAP, out.optJSONArray("lines")!!.length())
    }

    // ── 4. Oq ro'yxatlarning O'ZI (qo'shilib qolishdan qulf) ───────────────

    /**
     * 🔴 Oq ro'yxatlar SHU YERDA yozib qo'yilgan. Kimdir ularga maydon
     * qo'shsa test yiqiladi va o'zgartirish KO'RINADI — «yo'l-yo'lakay
     * qo'shib qo'ydim» bu yerda jim o'tmaydi.
     */
    @Test
    fun oqRoyxatlarQulflangan() {
        assertEquals(
            setOf("id", "name", "barcode", "storeId", "storeName", "zoneName"),
            CacheShape.CELL_FIELDS,
        )
        assertEquals(
            setOf("assortmentKind", "assortmentId", "name", "code", "barcode", "qty"),
            CacheShape.STOCK_FIELDS,
        )
        // T12 — `BOUND_FIELDS` olib tashlandi (ekran `products` ni o'qimaydi).
        assertEquals(
            setOf(
                "id", "name", "code", "article", "barcodes", "uom", "archived",
                "homeCell", "totalQty", "cells",
            ),
            CacheShape.HIT_FIELDS,
        )
        assertEquals(
            setOf("storeId", "storeName", "cellId", "cellName", "qty"),
            CacheShape.HIT_CELL_FIELDS,
        )
        assertEquals(
            setOf("id", "type", "sourceName", "openCount", "lineCount", "shortageCount"),
            CacheShape.TASK_CARD_FIELDS,
        )
        assertEquals(setOf("id", "type", "sourceName", "lines"), CacheShape.TASK_FIELDS)
        assertEquals(
            setOf("id", "binLocation", "productName", "quantity", "confirmedAt", "shortageQty"),
            CacheShape.LINE_FIELDS,
        )
    }

    /** Bo'sh/nuqsonli javob keshni yiqitmaydi (server javobi kutilmagan shaklda). */
    @Test
    fun nuqsonliJavobYiqitmaydi() {
        val out = CacheShape.cell(JSONObject())
        assertEquals(0, out.optJSONArray("cells")!!.length())
        assertEquals(0, out.optJSONArray("stock")!!.length())
        // T12 — `products` KESHLANMAYDI: ekran uni o'qimaydi.
        assertNull(out.optJSONArray("products"))
        // Massiv o'rniga matn kelgan holat.
        val weird = JSONObject().put("stock", "yo'q").put("cells", 7)
        assertEquals(0, CacheShape.cell(weird).optJSONArray("stock")!!.length())
        assertNull(CacheShape.taskList(null).optJSONArray("items")!!.optJSONObject(0))
    }
}
