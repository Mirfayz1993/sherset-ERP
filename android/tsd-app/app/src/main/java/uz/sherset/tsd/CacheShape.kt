package uz.sherset.tsd

import org.json.JSONArray
import org.json.JSONObject

/**
 * T10 — OFLAYN O'QUV KESHINING SHAKLI VA CHEGARALARI.
 *
 * Android ham, Compose ham, `R` ham bu yerga kirmaydi — [QtyExpression] va
 * [CountUndo] naqshi (T5, T7): shu tufayli keshning ikkita eng xavfli qarori
 * oddiy JVM unit-testi bilan qamraladi:
 *   1. **keshga NIMA tushadi** (oq ro'yxat — narx qoidasi shu yerda qulflanadi);
 *   2. **kesh qachon ESKI hisoblanadi** va nechta yozuv saqlanadi.
 *
 * 🔴 NARX QOIDASI — TUZILMAVIY, INTIZOM EMAS. Kesh serverdan kelgan javobni
 * NUSXA QILMAYDI: u faqat quyidagi OQ RO'YXATLARDAGI maydonlarni ko'chiradi
 * ([pick]). Ro'yxatda yo'q maydon — jumladan kelajakda kimdir qo'shib
 * qo'yishi mumkin bo'lgan har qanday narx ustuni — keshga TUSHMAYDI. Undan
 * ham muhimi: oq ro'yxatda e'lon qilinmagan ICHKI OBYEKT butunlay tashlanadi
 * (`price: { value, currency }` kabi shakl ham o'ta olmaydi). Bu qoida
 * `cachedaNarxYoq` testi bilan qulflangan.
 *
 * 🔴 KESH — FAQAT O'QISH. Bu fayl hech qanday amal, `clientOpId` yoki navbat
 * yozuvini bilmaydi; oflayn AMAL navbati ([ActionQueue]) mutlaqo alohida va
 * unga TEGILMAGAN. Kesh «nima ko'rsatiladi» degan savolga javob beradi,
 * «nima yuboriladi» degan savolga EMAS.
 */
object CacheShape {

    // ── Oq ro'yxatlar (serverdagi `select` ro'yxatlarining ilova tomondagi aksi) ──

    /** `cellByBarcode` → `cells[]` (`store-address.service.ts: lookupCellByBarcode`). */
    val CELL_FIELDS = setOf("id", "name", "barcode", "storeId", "storeName", "zoneName")

    /**
     * `cellByBarcode` → `stock[]` (`getCellStock`). Serverning `description` va
     * `mainImageId` maydonlari ATAYLAB olinmaydi: sanash ekrani ularni
     * chizmaydi, tavsif esa keshning eng katta va eng foydasiz qismi bo'lardi.
     */
    val STOCK_FIELDS = setOf("assortmentKind", "assortmentId", "name", "code", "barcode", "qty")

    // T12 — `BOUND_FIELDS` (`cellByBarcode` → `products[]`) olib tashlandi:
    // ekran u maydonni endi umuman o'qimaydi, ya'ni uni keshlash bo'sh joy
    // egallardi. Sabab — `CountScreen` boshidagi izoh.

    /** `/tsd/search` → `products[]` (`TsdProductHit`, `tsd.service.ts`). */
    val HIT_FIELDS = setOf(
        "id", "name", "code", "article", "barcodes", "uom", "archived",
        "homeCell", "totalQty", "cells",
    )

    /** `TsdProductHit.cells[]` — yagona e'lon qilingan ICHKI ro'yxat. */
    val HIT_CELL_FIELDS = setOf("storeId", "storeName", "cellId", "cellName", "qty")

    /** `/restock-tasks?assigneeId=…` → `items[]` (topshiriq kartasi). */
    val TASK_CARD_FIELDS =
        setOf("id", "type", "sourceName", "openCount", "lineCount", "shortageCount")

    /** `/restock-tasks/:id` — detal. */
    val TASK_FIELDS = setOf("id", "type", "sourceName", "lines")

    /**
     * Topshiriq qatori.
     *
     * 🔴 `pieceTracked` va `pieceOptions` ATAYLAB YO'Q: kesim (K4) — YOZUV
     * amali va u bo'lak reyestridan boshlanadi. Kesimni keshdagi bo'lak
     * ro'yxatidan boshlash «keshdan yozish qarori» bo'lardi, shuning uchun
     * oflayn ko'rinishda kesim tugmasi umuman paydo bo'lmaydi (maydon
     * bo'lmagach `optBoolean` `false` qaytaradi).
     */
    val LINE_FIELDS =
        setOf("id", "binLocation", "productName", "quantity", "confirmedAt", "shortageQty")

    // ── Hajm chegaralari ────────────────────────────────────────────────────

    /**
     * Bitta yacheykadagi eng ko'p qator. Jonlida eng «qalin» javon ham
     * o'nlab SKU tutadi; 200 — zaxira bilan olingan shift.
     */
    const val ROW_CAP = 200

    /** Bitta qidiruv natijasi — server o'zi 30 tada kesadi (`SEARCH_TAKE`). */
    const val HIT_CAP = 30

    /** Bitta topshiriqdagi eng ko'p qator. */
    const val LINE_CAP = 300

    /** Topshiriqlar ro'yxatidagi eng ko'p karta. */
    const val TASK_CARD_CAP = 50

    /** Nechta YACHEYKA saqlanadi (bitta smenada omborchi ~50 javon aylanadi). */
    const val ENTRY_CAP_CELLS = 50

    /** Nechta QIDIRUV natijasi saqlanadi. */
    const val ENTRY_CAP_SEARCH = 20

    /** Nechta TOPSHIRIQ detali saqlanadi. */
    const val ENTRY_CAP_TASKS = 20

    /** Nechta xodimning topshiriq RO'YXATI saqlanadi (bitta terminal — bir necha smena). */
    const val ENTRY_CAP_TASK_LIST = 5

    /**
     * 🔴 Bitta bo'limning (bucket) eng katta serializatsiya hajmi.
     *
     * Yozuv soni emas, AYNAN BAYT chegarasi hal qiluvchi: `SharedPreferences`
     * butun faylni xotiraga o'qiydi va har `apply()` da qayta yozadi — bu esa
     * eng issiq yo'lda (har skan) sodir bo'ladi. Shuning uchun yozuv soni
     * chegarasi bilan birga bayt chegarasi ham bor va TO'LSA eng ESKISI
     * chiqadi. Ikkalasidan qaysi biri oldin to'lsa, o'sha ishlaydi.
     */
    const val BUCKET_BYTES = 256 * 1024

    /**
     * 🔴 Kesh ESKIRISH muddati — 12 soat, ya'ni BITTA SMENA.
     *
     * Kesh Wi-Fi o'lik zonasidan o'tib ketish uchun, KECHANI o'tkazish uchun
     * emas: tunda kirim/chiqim bo'ladi va ertalab ko'rsatilgan «tizim soni»
     * omborchini yanglishtirardi. Muddati o'tgani ko'rsatilMAYDI (`null`
     * qaytadi) — «eski, lekin mayli» degan oraliq holat yo'q.
     */
    const val MAX_AGE_MS = 12L * 60L * 60L * 1000L

    /**
     * 🔴 Aloqa qaytganini tekshirish oralig'i (ekranlar «jim yangilash»
     * halqasi shu bilan yuradi).
     *
     * 20 soniya — omborchi bitta qatorni sanab ulgurmaydigan vaqt, ya'ni
     * aloqa qaytgani deyarli darhol seziladi. Undan qisqasi zaif Wi-Fi'da
     * o'lik so'rovlarni ko'paytirardi (har biri 15 soniyagacha
     * `connectTimeout` ushlaydi), uzunrog'i esa plashkani aloqa qaytgandan
     * keyin ham ekranda ushlab turardi.
     */
    const val RETRY_MS = 20_000L

    // ── Yosh ────────────────────────────────────────────────────────────────

    /** Keshning yoshi — matn EMAS, QAROR (matn `R` bilan ekranda tanlanadi). */
    sealed interface Age {
        /** Bir daqiqadan yangi. */
        object Fresh : Age

        data class Minutes(val n: Long) : Age

        data class Hours(val n: Long) : Age

        /**
         * Ko'rsatilMAYDI: [MAX_AGE_MS] dan eski YOKI kelajakdan
         * (qurilma soati orqaga surilgan). Ikkinchi holat ham shu yerda,
         * chunki «−3 soat oldin» degan plashka omborchiga hech nima demaydi.
         */
        object Expired : Age
    }

    fun age(savedAt: Long, now: Long): Age {
        val delta = now - savedAt
        if (delta < 0 || delta > MAX_AGE_MS) return Age.Expired
        val minutes = delta / 60_000L
        return when {
            minutes < 1 -> Age.Fresh
            minutes < 60 -> Age.Minutes(minutes)
            else -> Age.Hours(minutes / 60L)
        }
    }

    // ── Proyeksiya ──────────────────────────────────────────────────────────

    /**
     * 🔴 KESHNING YAGONA KIRISH ESHIGI: `src` dan FAQAT `fields` dagi
     * maydonlarni ko'chiradi.
     *
     * Qoidalar (uchalasi ham test bilan qulflangan):
     *  · ro'yxatda yo'q maydon — tashlanadi;
     *  · ro'yxatda bor, lekin `nested` da e'lon qilinmagan ICHKI OBYEKT ham
     *    tashlanadi (shakli noma'lum obyekt keshga tushmaydi);
     *  · ro'yxatdagi massiv `nested` bo'lsa o'z oq ro'yxati bilan, aks holda
     *    faqat SKALYARLARI bilan ko'chiriladi (`barcodes` shu yo'ldan o'tadi).
     */
    fun pick(
        src: JSONObject,
        fields: Set<String>,
        nested: Map<String, Set<String>> = emptyMap(),
    ): JSONObject {
        val out = JSONObject()
        for (f in fields) {
            if (!src.has(f)) continue
            if (src.isNull(f)) {
                // `null` MA'NOLI: `confirmedAt = null` = qator ochiq.
                out.put(f, JSONObject.NULL)
                continue
            }
            when (val v = src.opt(f)) {
                is JSONArray -> {
                    val inner = nested[f]
                    out.put(f, if (inner == null) scalars(v) else pickAll(v, inner))
                }
                // Oq ro'yxatsiz obyekt — TUSHMAYDI.
                is JSONObject -> continue
                else -> out.put(f, v)
            }
        }
        return out
    }

    /** Massivdagi har obyektni [pick] dan o'tkazadi (`limit` gacha). */
    fun pickAll(
        src: JSONArray?,
        fields: Set<String>,
        limit: Int = Int.MAX_VALUE,
        nested: Map<String, Set<String>> = emptyMap(),
    ): JSONArray {
        val out = JSONArray()
        if (src == null) return out
        var i = 0
        while (i < src.length() && out.length() < limit) {
            val o = src.optJSONObject(i)
            if (o != null) out.put(pick(o, fields, nested))
            i++
        }
        return out
    }

    /** Faqat skalyarlar (`barcodes` kabi matn massivlari). */
    private fun scalars(src: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until src.length()) {
            val v = src.opt(i)
            if (v is JSONObject || v is JSONArray) continue
            if (v != null && v != JSONObject.NULL) out.put(v)
        }
        return out
    }

    // ── Keshlanadigan javoblar ──────────────────────────────────────────────

    /**
     * `cellByBarcode` javobi. Serverdan `{ cells, stock, products }` keladi,
     * keshga esa T12 dan beri FAQAT `cells` + `stock` tushadi — `products`
     * ni ekran o'qimaydi (`CountScreen` boshidagi izoh).
     */
    fun cell(resp: JSONObject): JSONObject = JSONObject()
        .put("cells", pickAll(resp.optJSONArray("cells"), CELL_FIELDS, limit = 5))
        .put("stock", pickAll(resp.optJSONArray("stock"), STOCK_FIELDS, limit = ROW_CAP))

    /** `/tsd/search` javobi. `truncated` ham saqlanadi — u OGOHLANTIRISH. */
    fun search(resp: JSONObject): JSONObject = JSONObject()
        .put(
            "products",
            pickAll(
                resp.optJSONArray("products"),
                HIT_FIELDS,
                limit = HIT_CAP,
                nested = mapOf("cells" to HIT_CELL_FIELDS),
            ),
        )
        .put("truncated", resp.optBoolean("truncated"))

    /** «Mening topshiriqlarim» ro'yxati. */
    fun taskList(items: JSONArray?): JSONObject =
        JSONObject().put("items", pickAll(items, TASK_CARD_FIELDS, limit = TASK_CARD_CAP))

    /** Topshiriq detali. */
    fun task(resp: JSONObject): JSONObject =
        pick(resp, TASK_FIELDS, nested = mapOf("lines" to LINE_FIELDS)).also {
            // `pick` massivni `limit` siz ko'chiradi — qator chegarasi shu yerda.
            val lines = it.optJSONArray("lines") ?: return@also
            if (lines.length() <= LINE_CAP) return@also
            val cut = JSONArray()
            for (i in 0 until LINE_CAP) cut.put(lines.get(i))
            it.put("lines", cut)
        }

    // ── Bo'limni chegarada ushlash ──────────────────────────────────────────

    /**
     * Bo'limni yozuv soni va BAYT chegarasiga soladi: eng ESKISI (boshidagi)
     * chiqadi. Ro'yxat MRU tartibida — eng yangisi OXIRIDA.
     *
     * Oxirgi yozuv hech qachon tashlanmaydi: u hozirgina yozilgan va uni
     * darhol chiqarib tashlash keshni ma'nosiz qilardi.
     */
    fun trim(bucket: JSONArray, entryCap: Int): JSONArray {
        var cur = bucket
        while (cur.length() > 1 && (cur.length() > entryCap || cur.toString().length > BUCKET_BYTES)) {
            val next = JSONArray()
            for (i in 1 until cur.length()) next.put(cur.get(i))
            cur = next
        }
        return cur
    }
}
