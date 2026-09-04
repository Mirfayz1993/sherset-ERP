package uz.sherset.tsd

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * T10 — OFLAYN O'QUV KESHI (`SharedPreferences`, [ActionQueue] naqshi).
 *
 * 🔴 NEGA BOR. Ombor Wi-Fi'si javonlar orasida o'lik zonalar qoldiradi:
 * omborchi yacheykani ochib, ikki qadam narida ekranga qarasa ilova
 * butunlay bo'shab qolardi — «Yuklanmoqda…» yoki qizil banner, va qaysi
 * tovar shu javonda turishini KO'RSATADIGAN hech nima yo'q edi. Endi
 * OXIRGI KO'RILGAN ma'lumot ekranda qoladi, yoshi bilan belgilanib.
 *
 * 🔴 KESH — FAQAT O'QISH. Bu klass hech qanday amal yozmaydi va oflayn AMAL
 * navbatiga ([ActionQueue]) UMUMAN TEGMAYDI — u alohida fayl, alohida
 * `SharedPreferences` va o'zgarmagan qoidalar bilan ishlaydi. Keshdan
 * chiqadigan yagona narsa — EKRANDAGI MATN.
 *
 * 🔴 NARX keshda bo'lishi TUZILMAVIY jihatdan mumkin emas: yozilayotgan
 * javob [CacheShape] oq ro'yxatidan o'tadi va ro'yxatda yo'q maydon
 * ko'chirilmaydi (`CacheShapeTest.cachedaNarxYoq`).
 *
 * 🔴 SIR SAQLANMAYDI: bu yerda token, `deviceSecret` yoki PIN yo'q — shuning
 * uchun oddiy `SharedPreferences` yetarli ([DeviceStore] dagi shifrlangan
 * saqlagich kerak emas). Aynan shu sababdan kesh CHIQISHDA TOZALANMAYDI:
 * sessiya yo'qolishi (401) — keshning eng kerak bo'ladigan payti, chunki u
 * ko'pincha aloqa uzilgani uchun sodir bo'ladi. Topshiriq ro'yxati esa
 * XODIM bo'yicha kalitlanadi, ya'ni boshqa smenaning ro'yxati ko'rinmaydi.
 *
 * Kesh buzilgan bo'lsa (yarim yozilgan JSON) hech qachon ILOVANI
 * YIQITMAYDI: har o'qish/yozish `runCatching` ichida va nosozlik
 * [Diagnostics] ga tushadi.
 */
class ReadCache(context: Context, private val clock: () -> Long = System::currentTimeMillis) {

    private val prefs = context.getSharedPreferences("tsd_read_cache", Context.MODE_PRIVATE)

    /** Keshdan o'qilgan yozuv: tanasi va QACHON saqlangani. */
    class Entry(val body: JSONObject, val savedAt: Long)

    // ── Yacheyka tarkibi (`cellByBarcode`) ─────────────────────────────────

    /** Kalit — SKANERLANGAN kod: oflayn qayta skanerlanganda aynan shu keladi. */
    fun putCell(code: String, resp: JSONObject) =
        put(K_CELLS, code, CacheShape.cell(resp), CacheShape.ENTRY_CAP_CELLS)

    fun cell(code: String): Entry? = get(K_CELLS, code)

    // ── Qidiruv natijasi (`/tsd/search`) ───────────────────────────────────

    fun putSearch(query: String, resp: JSONObject) =
        put(K_SEARCH, normalize(query), CacheShape.search(resp), CacheShape.ENTRY_CAP_SEARCH)

    fun search(query: String): Entry? = get(K_SEARCH, normalize(query))

    // ── Topshiriqlar ───────────────────────────────────────────────────────

    /**
     * Ro'yxat XODIM bo'yicha kalitlanadi: server uni `assigneeId` bilan
     * filtrlaydi, ya'ni kalitsiz kesh boshqa omborchining ishini ko'rsatardi.
     */
    fun putTaskList(employeeId: String, items: JSONArray) =
        put(K_TASK_LIST, employeeId, CacheShape.taskList(items), CacheShape.ENTRY_CAP_TASK_LIST)

    fun taskList(employeeId: String): Entry? = get(K_TASK_LIST, employeeId)

    fun putTask(taskId: String, resp: JSONObject) =
        put(K_TASKS, taskId, CacheShape.task(resp), CacheShape.ENTRY_CAP_TASKS)

    fun task(taskId: String): Entry? = get(K_TASKS, taskId)

    // ── ichki ──────────────────────────────────────────────────────────────

    /** Qidiruv kaliti registrga bog'liq bo'lmasin («Kabel» = «kabel»). */
    private fun normalize(q: String): String = q.trim().lowercase()

    /**
     * Yozuvni bo'limga qo'yadi. Ayni kalit bor bo'lsa u OLIB TASHLANADI va
     * yangisi OXIRIGA qo'yiladi — ya'ni ro'yxat MRU tartibida qoladi va
     * chegara to'lganda haqiqatan eng ESKI ko'rilgani chiqadi.
     */
    @Synchronized
    private fun put(bucket: String, key: String, body: JSONObject, entryCap: Int) {
        runCatching {
            val kept = JSONArray()
            val cur = load(bucket)
            for (i in 0 until cur.length()) {
                val o = cur.optJSONObject(i) ?: continue
                if (o.optString("k") == key) continue
                kept.put(o)
            }
            kept.put(JSONObject().put("k", key).put("at", clock()).put("v", body))
            prefs.edit().putString(bucket, CacheShape.trim(kept, entryCap).toString()).apply()
        }.onFailure { Diagnostics.log("CACHE put xato: " + bucket + " · " + it.message) }
    }

    @Synchronized
    private fun get(bucket: String, key: String): Entry? = runCatching {
        val cur = load(bucket)
        for (i in cur.length() - 1 downTo 0) {
            val o = cur.optJSONObject(i) ?: continue
            if (o.optString("k") != key) continue
            val at = o.optLong("at")
            // Muddati o'tgan yozuv KO'RSATILMAYDI (`MAX_AGE_MS` — bitta
            // smena). «Eski, lekin mayli» degan oraliq holat yo'q.
            if (CacheShape.age(at, clock()) == CacheShape.Age.Expired) return@runCatching null
            val v = o.optJSONObject("v") ?: return@runCatching null
            return@runCatching Entry(v, at)
        }
        null
    }.getOrElse {
        Diagnostics.log("CACHE get xato: " + bucket + " · " + it.message)
        null
    }

    private fun load(bucket: String): JSONArray =
        runCatching { JSONArray(prefs.getString(bucket, "[]")) }.getOrDefault(JSONArray())

    private companion object {
        const val K_CELLS = "cells"
        const val K_SEARCH = "searches"
        const val K_TASKS = "tasks"
        const val K_TASK_LIST = "task_list"
    }
}
