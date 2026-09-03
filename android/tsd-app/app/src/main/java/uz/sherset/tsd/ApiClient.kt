package uz.sherset.tsd

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Backend klienti (G-reja G5 skeleti, G6 da ish ekranlari bilan to'ldirildi).
 * `driver-app/ApiClient.kt` naqshi: sinxron, IO thread'da chaqiriladi, xatolar
 * `ApiException` bilan yuqoriga chiqadi.
 *
 * 🔴 Ilova FAQAT TSD allowlist'idagi yo'llarga boradi (`tsd-policy.ts`).
 * Ro'yxatdan tashqarisi serverda 403 bo'ladi — ya'ni bu yerga «tezkorlik
 * uchun» `/products` qo'shib qo'yish ISHLAMAYDI va shunday bo'lishi kerak:
 * narx ombor xodimiga ko'rinmaydi.
 *
 * 🔴 G6 — IDEMPOTENTLIK KALITI. Qoldiqni siljitadigan har amal `clientOpId`
 * bilan boradi (`shared/client-op.ts`): aloqa uzilib qayta yuborilgan amal
 * ikkinchi marta BAJARILMAYDI. Kalit AMAL YARATILGANDA beriladi va qayta
 * yuborishda O'ZGARMAYDI — aks holda butun mexanizm ma'nosini yo'qotadi.
 */
class ApiClient(private val baseUrl: String) {

    /**
     * 🔴 COOKIE IDORASI — 2026-09-02 da jonli terminalda topilgan nuqson.
     *
     * Access-token 15 daqiqada tugaydi va shundan keyin HAR BIR so'rov 401
     * berardi: terminal «skanerlab bo'lmayapti» holatiga tushardi va yagona
     * chora ilovani qayta ochish edi. Ikki sabab ustma-ust edi:
     *   1. `refresh` HECH QACHON chaqirilmasdi (G5 da saqlanardi, ishlatilmasdi);
     *   2. chaqirilganda ham ishlamasdi — server refresh-tokenni FAQAT
     *      cookie'dan o'qiydi (`auth.controller.ts: req.cookies[ms_rt]`),
     *      klient esa uni javob TANASIDA yuborardi, OkHttp'da esa cookie
     *      idorasi umuman yo'q edi ⇒ cookie login'dan keyin tashlanardi.
     *
     * Shuning uchun endi oddiy xotira-idora bor: login qo'ygan `ms_rt`
     * saqlanadi va `/auth/refresh` ga o'zi qaytadi. Rotatsiyada server yangi
     * cookie beradi va u shu yerda ustiga yoziladi — ya'ni zanjir uzilmaydi.
     * DISKKA yozilmaydi: ilova qayta ochilganda PIN baribir so'raladi.
     */
    private val cookieStore = ConcurrentHashMap<String, MutableMap<String, Cookie>>()

    private val jar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            val host = cookieStore.getOrPut(url.host) { ConcurrentHashMap() }
            for (c in cookies) host[c.name] = c
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val host = cookieStore[url.host] ?: return emptyList()
            val now = System.currentTimeMillis()
            return host.values.filter { it.expiresAt > now && it.matches(url) }
        }
    }

    private val http = OkHttpClient.Builder()
        // Ombor Wi-Fi'si zaif — uzun timeout qayta urinishdan yaxshiroq
        // (qayta urinish ikki marta tasdiqlashga olib kelishi mumkin).
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .cookieJar(jar)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    @Volatile
    var accessToken: String? = null

    /**
     * Sessiyani tiklab bo'lmadi (refresh ham 401) — ilova PIN ekraniga
     * qaytadi. Xom «HTTP 401» omborchiga hech nima demaydi.
     */
    @Volatile
    var onSessionLost: (() -> Unit)? = null

    class ApiException(val code: Int, message: String) : Exception(message) {
        /**
         * Xato QAYTA URINISHGA arziydimi. 4xx — arzimaydi (so'rovning o'zi
         * noto'g'ri; navbatda abadiy aylanardi), 5xx va tarmoq — arziydi.
         * Aynan shu farq oflayn navbatning tiqilib qolmasligini ta'minlaydi.
         */
        val retriable: Boolean get() = code == 0 || code >= 500
    }

    /**
     * Terminal kirishi — qurilma kaliti + PIN (`POST /auth/tsd-login`).
     *
     * Javobda `refreshToken` TANADA keladi (kassa qobig'idan farq): Android
     * klienti brauzer emas, cookie idorasi yo'q.
     */
    fun login(deviceId: String, deviceSecret: String, pin: String, appVersion: String): JSONObject {
        val body = JSONObject()
            .put("deviceId", deviceId)
            .put("deviceSecret", deviceSecret)
            .put("pin", pin)
            .put("appVersion", appVersion)
        val resp = post("/auth/tsd-login", body, auth = false)
        val t = resp.optString("accessToken")
        if (t.isEmpty()) throw ApiException(0, "Login javobida accessToken yo'q")
        accessToken = t
        return resp
    }

    /**
     * Sessiyani uzaytirish. Refresh-token TANADA emas, COOKIE'da ketadi —
     * server uni faqat shu yerdan o'qiydi (`auth.controller.ts`).
     * Terminal bekor qilingan bo'lsa (`revokedAt`) server 401 beradi va
     * sessiya o'ladi — bu ATAYLAB: yo'qolgan terminal o'zini tiklay olmasin.
     */
    @Synchronized
    fun renewSession(): Boolean {
        // `allowRefresh = false` — refresh'ning o'zi 401 bersa yana refresh
        // chaqirilib cheksiz halqa hosil bo'lardi.
        val resp = runCatching {
            exec("POST", "/auth/refresh", "{}", auth = false, allowRefresh = false)
        }.getOrNull() ?: return false
        val t = resp.optString("accessToken")
        if (t.isEmpty()) return false
        accessToken = t
        return true
    }

    // ── Topshiriqlar ────────────────────────────────────────────────────────

    /**
     * «Mening topshiriqlarim» — server `assigneeId` bo'yicha filtrlaydi (G2).
     *
     * `status` YUBORILMAYDI: omborchiga bugungi hamma topshirig'i kerak,
     * jumladan yopilganlari (u nimani yig'ib bo'lganini ko'rishi kerak).
     * Ro'yxatdagi `openCount` qaysilari qolganini aytadi (G6).
     */
    fun myTasks(employeeId: String): JSONArray {
        val resp = get("/restock-tasks?assigneeId=" + enc(employeeId) + "&limit=50")
        return resp.optJSONArray("items") ?: JSONArray()
    }

    /** Topshiriq detali — qatorlar YACHEYKA MARSHRUTI tartibida (server saralaydi). */
    fun task(taskId: String): JSONObject = get("/restock-tasks/" + taskId)

    fun confirmLine(taskId: String, lineId: String, clientOpId: String): JSONObject =
        post(
            "/restock-tasks/" + taskId + "/lines/" + lineId + "/confirm",
            JSONObject().put("clientOpId", clientOpId),
        )

    fun confirmScan(taskId: String, productId: String, clientOpId: String): JSONObject =
        post(
            "/restock-tasks/" + taskId + "/confirm-scan",
            JSONObject().put("productId", productId).put("clientOpId", clientOpId),
        )

    /**
     * G6 — «javonda shuncha topolmadim». `qty` MUTLAQ son (delta emas):
     * qayta yuborilgan amal AYNI natijani beradi.
     */
    fun shortage(
        taskId: String,
        lineId: String,
        qty: String,
        note: String?,
        clientOpId: String,
    ): JSONObject {
        val body = JSONObject().put("qty", qty).put("clientOpId", clientOpId)
        if (!note.isNullOrBlank()) body.put("note", note)
        return post("/restock-tasks/" + taskId + "/lines/" + lineId + "/shortage", body)
    }

    /**
     * K4 — BO'LINADIGAN TOVAR KESIMI (kabel/sim/shlang).
     *
     * Manba: skanerlangan `BLK-` yorlig'i YOKI ro'yxatdan tanlangan `pieceId`.
     * `remaining` — omborchi O'LCHAGAN qoldiq (bo'sh bo'lsa server
     * «manba − kesim» ni oladi).
     *
     * 🔴 QOLDIQQA TEGMAYDI: kesim stok-neytral (250 → 180 + 70). Server
     * faqat bo'lak reyestrini yangilaydi va yangi YORLIQlarni qaytaradi.
     */
    fun cut(
        taskId: String,
        lineId: String,
        pieceId: String?,
        label: String?,
        cutLength: String,
        remaining: String?,
        clientOpId: String,
    ): JSONObject {
        val body = JSONObject().put("cutLength", cutLength).put("clientOpId", clientOpId)
        if (!pieceId.isNullOrBlank()) body.put("pieceId", pieceId)
        if (!label.isNullOrBlank()) body.put("label", label)
        if (!remaining.isNullOrBlank()) body.put("remainingLength", remaining)
        return post("/restock-tasks/" + taskId + "/lines/" + lineId + "/cut", body)
    }

    // ── Skan ────────────────────────────────────────────────────────────────

    /** NARXSIZ skan-qidiruv (`tsd-scan.ts`). */
    fun scan(code: String): JSONObject = get("/tsd/scan?code=" + enc(code))

    /** Yacheyka yorlig'i bo'yicha qidirish. */
    fun cellByBarcode(code: String): JSONObject =
        get("/admin/stores/cells/by-barcode?code=" + enc(code))

    // ── Joylashtirish / ko'chirish ──────────────────────────────────────────

    /** Yacheykadan yacheykaga ko'chirish. */
    fun cellMove(
        productId: String,
        storeId: String,
        fromCellId: String,
        toCellId: String,
        qty: String,
        clientOpId: String,
    ): JSONObject = send(
        "POST",
        "/products/" + productId + "/cell-move",
        JSONObject()
            .put("storeId", storeId)
            .put("fromCellId", fromCellId)
            .put("toCellId", toCellId)
            .put("qty", qty)
            .put("clientOpId", clientOpId),
    )

    /** Yacheykasiz qoldiqni (jumladan «Taqsimlanmagan» hovuzdan) yacheykaga joylash. */
    fun cellPlace(
        productId: String,
        toCellId: String,
        qty: String,
        clientOpId: String,
    ): JSONObject = send(
        "POST",
        "/products/" + productId + "/cell-place",
        JSONObject().put("toCellId", toCellId).put("qty", qty).put("clientOpId", clientOpId),
    )

    // ── Sanash ──────────────────────────────────────────────────────────────

    fun cellStock(storeId: String, cellId: String): JSONObject =
        get("/admin/stores/" + storeId + "/cells/" + cellId + "/stock")

    /**
     * Sanash — MUTLAQ son (`mode: 'set'`).
     *
     * 🔴 `add` ATAYLAB ISHLATILMAYDI. Sanash — javondagi tovarni sanash, ya'ni
     * natija MUTLAQ. `add` esa delta bo'lardi va aloqa uzilib qayta
     * yuborilganda qoldiqni ikkinchi marta oshirardi. Server bu yo'lda
     * idempotentlik kalitini o'qimaydi (u yerda yagona tranzaksiya yo'q —
     * avto Оприходование/Списание hujjatlari alohida yoziladi), shuning uchun
     * himoya SEMANTIKADA: mutlaq son qayta yuborilganda AYNI natijani beradi.
     */
    fun setCellStock(
        storeId: String,
        cellId: String,
        assortmentId: String,
        qty: String,
    ): JSONObject = send(
        "PUT",
        "/admin/stores/" + storeId + "/cells/" + cellId + "/stock",
        JSONObject().put("assortmentId", assortmentId).put("qty", qty).put("mode", "set"),
    )

    /**
     * Yangi topshiriq signali — POLLING (SSE emas).
     *
     * Reja «SSE yoki polling» degan edi; skelet POLLING'ni tanlaydi: SSE
     * ulanishi ekran o'chganda va Wi-Fi almashganda uziladi, uni Android'da
     * tirik ushlash uchun foreground-service kerak bo'lardi — ya'ni
     * `driver-app` ning butun murakkabligi. Ombor ilovasiga u kerak emas
     * (terminal qo'lda, ekran ochiq). Narxi: kechikish <= interval.
     */
    fun notifications(): JSONObject = get("/notifications?limit=20")

    // ── Navbatdagi amalni yuborish (G6 — `QueueSender`) ─────────────────────

    /**
     * Amalni AYNAN saqlangan ko'rinishda yuboradi. Oflayn navbat SHU
     * metoddan foydalanadi, ya'ni onlayn yo'l bilan bitta kod: navbatdan
     * chiqqan amal onlayn yuborilganidan farq qilmaydi.
     */
    fun send(method: String, path: String, body: JSONObject): JSONObject = when (method) {
        "POST" -> post(path, body)
        "PUT" -> put(path, body)
        else -> throw ApiException(400, "Noma'lum metod: " + method)
    }

    // -- ichki ---------------------------------------------------------------

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    private fun get(path: String): JSONObject = exec("GET", path, null, auth = true)

    private fun post(path: String, body: JSONObject, auth: Boolean = true): JSONObject =
        exec("POST", path, body.toString(), auth)

    private fun put(path: String, body: JSONObject): JSONObject =
        exec("PUT", path, body.toString(), auth = true)

    /**
     * So'rovni bajaradi va 401 da sessiyani BIR MARTA tiklab qayta yuboradi.
     *
     * So'rov `Builder` emas, bo'laklari bilan uzatiladi — aynan shuning uchun
     * uni qayta qurib takrorlash mumkin (bir marta `build()` qilingan so'rovni
     * ikkinchi marta yuborib bo'lmaydi).
     *
     * 🔴 Takrorlash XAVFSIZ: qoldiqni siljitadigan har amal `clientOpId` bilan
     * ketadi va server uni tranzaksiya ichida da'vo qiladi
     * (`shared/client-op.ts`) — ya'ni birinchi urinish serverga yetib borgan
     * bo'lsa ham ikkinchisi ishni TAKRORLAMAYDI.
     */
    private fun exec(
        method: String,
        path: String,
        body: String?,
        auth: Boolean,
        allowRefresh: Boolean = true,
    ): JSONObject {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post((body ?: "{}").toRequestBody(json))
            "PUT" -> builder.put((body ?: "{}").toRequestBody(json))
            else -> throw ApiException(400, "Noma'lum metod: $method")
        }
        if (auth) accessToken?.let { builder.header("Authorization", "Bearer $it") }

        try {
            http.newCall(builder.build()).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (r.code == 401 && auth && allowRefresh) {
                    // Access-token muddati tugagan bo'lishi mumkin. Tiklab
                    // ko'ramiz; muvaffaqiyatli bo'lsa so'rov QAYTA yuboriladi
                    // va omborchi hech narsa sezmaydi.
                    return if (renewSession()) {
                        exec(method, path, body, auth, allowRefresh = false)
                    } else {
                        onSessionLost?.invoke()
                        throw ApiException(401, "Sessiya tugadi — PIN bilan qayta kiring")
                    }
                }
                if (!r.isSuccessful) throw ApiException(r.code, "HTTP " + r.code + ": " + text)
                return if (text.isBlank()) JSONObject() else JSONObject(text)
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: java.io.IOException) {
            // Tarmoq uzilishi — `code = 0`, ya'ni QAYTA URINISHGA arziydi.
            // Bu farq bo'lmasa navbat 4xx da ham abadiy aylanardi.
            throw ApiException(0, e.message ?: "Aloqa yo'q")
        }
    }
}
