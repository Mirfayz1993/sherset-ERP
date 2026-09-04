package uz.sherset.manager

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Backend klienti — tsd-app `ApiClient.kt` naqshi: sinxron OkHttp + org.json,
 * IO thread'da chaqiriladi, xatolar `ApiException` bilan yuqoriga chiqadi.
 *
 * 🔴 AUTH SHARTNOMASI TSD'DAN FARQ QILADI (`auth.controller.ts` dan o'qildi):
 *
 *  - `POST /auth/login` tanasi `{identifier, password}` → javob tanasi
 *    `{accessToken, user}`. REFRESH-TOKEN TANADA KELMAYDI — u faqat
 *    `Set-Cookie: ms_rt=…; Path=/api/v1/auth; HttpOnly` sarlavhasida.
 *    OkHttp'da cookie idorasi yo'q, shuning uchun klient `Set-Cookie` ni
 *    O'ZI o'qiydi va qiymatni AYNAN kelgan (kodlangan) ko'rinishda saqlaydi.
 *  - `POST /auth/refresh` TANASIZ ishlaydi va tokenni FAQAT `ms_rt`
 *    cookie'sidan o'qiydi ⇒ so'rovga `Cookie: ms_rt=…` sarlavhasi qo'yiladi.
 *    Javob: yangi `{accessToken, user}` + ROTATSIYA qilingan yangi cookie.
 *    (TSD `refreshToken` ni tanada yuborardi — u yo'l bu serverda o'qilmaydi.)
 *
 * 401 kelganda klient BIR MARTA refresh qilib so'rovni qaytaradi; refresh ham
 * yiqilsa 401 yuqoriga chiqadi va `MainActivity` login ekraniga qaytaradi.
 */
class ApiClient(private val baseUrl: String) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    @Volatile
    var accessToken: String? = null

    /** `ms_rt` cookie qiymati — server yuborgan KODLANGAN ko'rinishda. */
    @Volatile
    var refreshToken: String? = null

    /** Rotatsiyadan keyin saqlash uchun (`SessionStore` ga yozadi). */
    @Volatile
    var onRefreshRotated: ((String) -> Unit)? = null

    /**
     * Refresh javobidagi `user` obyekti. Rol/ruxsat XODIMDAN qayta quriladi
     * (`token.service.ts`), ya'ni admin rolni olib qo'ysa keyingi refreshdan
     * so'ng qobiq buni biladi — plitkalar ham o'sha zahoti yangilanadi.
     * IO thread'da chaqiriladi: qabul qiluvchi UI ga o'zi ko'chiradi.
     */
    @Volatile
    var onUserRefreshed: ((JSONObject) -> Unit)? = null

    private val refreshLock = Any()

    class ApiException(val code: Int, message: String) : Exception(message) {
        /** 4xx — qayta urinishga arzimaydi; 0 (tarmoq) va 5xx — arziydi. */
        val retriable: Boolean get() = code == 0 || code >= 500
    }

    // ── Auth ────────────────────────────────────────────────────────────────

    /**
     * Email/username + parol bilan kirish (`POST /auth/login`).
     * Javob: `{accessToken, user}`; refresh-token cookie'dan ushlanadi.
     */
    fun login(identifier: String, password: String): JSONObject {
        val body = JSONObject().put("identifier", identifier).put("password", password)
        val resp = exec(
            Request.Builder().url(url("/auth/login")).post(body.toString().toRequestBody(json)),
            auth = false,
            retryOn401 = false,
        )
        val t = resp.optString("accessToken")
        if (t.isEmpty()) throw ApiException(0, "Login javobida accessToken yo'q")
        accessToken = t
        return resp
    }

    /**
     * Sessiyani uzaytirish. Muvaffaqiyatda `{accessToken, user}` qaytadi
     * (yangi cookie ham ushlab olinadi), aks holda `null` — sessiya tugagan.
     */
    fun tryRefresh(): JSONObject? {
        synchronized(refreshLock) {
            val rt = refreshToken ?: return null
            return try {
                val resp = exec(
                    Request.Builder()
                        .url(url("/auth/refresh"))
                        .header("Cookie", "ms_rt=$rt")
                        .post("{}".toRequestBody(json)),
                    auth = false,
                    retryOn401 = false,
                )
                val t = resp.optString("accessToken")
                if (t.isEmpty()) null else {
                    accessToken = t
                    resp.optJSONObject("user")?.let { u -> onUserRefreshed?.invoke(u) }
                    resp
                }
            } catch (e: ApiException) {
                if (e.code == 401 || e.code == 400) null else throw e
            }
        }
    }

    /** Chiqish — server tomonda refresh-zanjirni o'ldirish (best-effort). */
    fun logout() {
        val rt = refreshToken ?: return
        runCatching {
            exec(
                Request.Builder()
                    .url(url("/auth/logout"))
                    .header("Cookie", "ms_rt=$rt")
                    .post("{}".toRequestBody(json)),
                auth = false,
                retryOn401 = false,
            )
        }
        refreshToken = null
        accessToken = null
    }

    // ── Menejer ekranlari (hammasi O'QISH) ──────────────────────────────────

    /** MK19 — brifing. `kind` = `morning` | `evening`. Ruxsat: `report.view`. */
    fun briefing(kind: String): JSONObject = get("/manager/briefing/" + enc(kind))

    /** MK15 — «pul qayerda» paneli: 6 blok + yakun. Ruxsat: `report.view`. */
    fun moneyMap(): JSONObject = get("/manager/money-map")

    /** 4M.2 — kunlik KPI navbati `{items,total}`. Ruxsat: HR `employees:read`. */
    fun kpiDays(): JSONObject = get("/manager/kpi/days?limit=100")

    /** MK16 — undirish ro'yxati `{rows,summary,totalCount,truncated}`. Ruxsat: `debt.view`. */
    fun collection(scope: String): JSONObject =
        get("/manager/collection?scope=" + enc(scope) + "&limit=200")

    // ── Xodimning O'ZI: davomat (X2) ────────────────────────────────────────
    //
    // Bularning hammasi `ping.controller.ts` da va FAQAT `JwtAuthGuard` bilan
    // yopilgan: xodim token'dan olinadi. Ya'ni ilova KIMNI so'rashini tanlay
    // olmaydi — `employeeId` parametri bu yo'llarda UMUMAN yo'q.

    /** Bugungi holat: `{optIn, workLocation, schedule, today, status}`. */
    fun attendanceToday(): JSONObject = get("/hr/attendance/my/today")

    /** Oylik tarix: `{yearMonth, days[], totals}` — X2 da ochilgan endpoint. */
    fun attendanceHistory(yearMonth: String): JSONObject =
        get("/hr/attendance/my/history?yearMonth=" + enc(yearMonth))

    /** «Keldim» — server geofence bilan tekshiradi; javob `{ok, reason, status}`. */
    fun attendanceCheckIn(lat: Double, lng: Double, accuracy: Double): JSONObject =
        post("/hr/attendance/my/check-in", ping(lat, lng, accuracy))

    /** «Ketyapman» — ochiq yozuvni yopadi (joy tekshirilmaydi, faqat yozib qo'yiladi). */
    fun attendanceCheckOut(lat: Double, lng: Double, accuracy: Double): JSONObject =
        post("/hr/attendance/my/check-out", ping(lat, lng, accuracy))

    /** Davomat kuzatuvini yoqish — xodimning O'Z roziligi (`my/opt-in`). */
    fun attendanceOptIn(optIn: Boolean): JSONObject =
        post("/hr/attendance/my/opt-in", JSONObject().put("optIn", optIn))

    private fun ping(lat: Double, lng: Double, accuracy: Double): JSONObject =
        JSONObject().put("lat", lat).put("lng", lng).put("accuracy", accuracy)

    // ── Xodimning O'ZI: vazifalar (X3) ──────────────────────────────────────
    //
    // `GET /hr/tasks/my` — `tasks:own_only`, xodim token'dan olinadi. So'rovda
    // `employeeId` UMUMAN yo'q (server sxemasi notanish kalitni tashlab
    // yuboradi), ya'ni ilova KIMNI so'rashini tanlay olmaydi.

    /** «Ishlarim»: `{rows, total}`. `status` bo'sh bo'lsa — hammasi. */
    fun myTasks(status: String?, limit: Int): JSONObject {
        val q = StringBuilder("/hr/tasks/my?limit=").append(limit)
        if (!status.isNullOrEmpty()) q.append("&status=").append(enc(status))
        return get(q.toString())
    }

    /**
     * Vazifaga javob (`POST /hr/tasks/logs/:id/answer`, `tasks:own_only`).
     * Egalik SERVERDA tekshiriladi — o'zganing vazifasi 403 bilan qaytadi.
     *
     * `type`: `yes` | `no` | `text`; `text` faqat matnli javobda.
     *
     * Javob bir martalik amal (server ikkinchisini «allaqachon javob berilgan»
     * deb rad etadi), lekin 401 da BIR MARTA qaytarish xavfsiz: 401 ni
     * `JwtAuthGuard` beradi, ya'ni so'rov kontrollergacha YETIB BORMAGAN va
     * hech narsa yozilmagan. Aks holda access-token eskirgan xodim yozgan
     * javobini yo'qotib, qaytadan kirishga majbur bo'lardi.
     */
    fun answerTask(logId: String, type: String, text: String?): JSONObject {
        val body = JSONObject().put("type", type)
        if (text != null) body.put("text", text)
        return post("/hr/tasks/logs/" + enc(logId) + "/answer", body)
    }

    // ── Xodimning O'ZI: haydovchi yo'nalishlari (X4) ────────────────────────
    //
    // Hammasi FAQAT `JwtAuthGuard` bilan yopilgan va `driverId = user.sub`
    // (`driver-tracking.controller.ts`, `driver-cash.controller.ts` — SELF
    // bo'limi). Ya'ni ilova KIMNI so'rashini TANLAY OLMAYDI: bu yo'llarda
    // `driverId` na parametrda, na tanada bor. Dispecher yo'llari
    // (`live`, `route`, `driver-cash` umumiy ro'yxati) `DispatcherGuard`
    // ostida va bu ilovadan UMUMAN chaqirilmaydi.

    /**
     * Ochiq smena yoki `null` (smena boshlanmagan). Server ochiq yozuv
     * bo'lmasa `null` qaytaradi — bu XATO emas, oddiy holat.
     */
    fun driverShiftCurrent(): JSONObject? = getObjectOrNull("/driver-tracking/shifts/current")

    /**
     * Smenani boshlash. Server IDEMPOTENT: ochiq smena bo'lsa o'shani
     * qaytaradi, yangisini yaratmaydi (`driver-shift.service.start`) —
     * shuning uchun 401 dan keyin so'rovni qaytarish qo'sh smena yaratmaydi.
     *
     * 400 — xodim `field` (haydovchi) rejimida emas.
     */
    fun driverShiftStart(): JSONObject = post("/driver-tracking/shifts/start", JSONObject())

    /**
     * Smenani yakunlash. Javobda yopilgan smena: harakat/to'xtash soniyalari
     * va yetkazmalar soni SERVERDA ping-oqimidan qayta hisoblanadi.
     *
     * 400 — ochiq smena topilmadi (masalan kron avtomatik yopib qo'ygan).
     */
    fun driverShiftEnd(): JSONObject = post("/driver-tracking/shifts/end", JSONObject())

    /** Oxirgi 20 reys (server chegarasi) — yangisi tepada. */
    fun driverTrips(): JSONArray = getArray("/driver-tracking/my/trips")

    /** O'z naqd yozuvlari (oxirgi 50) — «qo'limdagi pul» shu yerdan sanaladi. */
    fun driverCashMine(): JSONArray = getArray("/driver-cash/mine")

    // ── Xodimning O'ZI: KPI (X5) ────────────────────────────────────────────
    //
    // `GET /hr/kpi/my` — FAQAT `JwtAuthGuard`, `employeeId = user.sub`.
    // HR sahifa-ruxsati ATAYLAB talab qilinmaydi (`my-kpi.controller.ts`
    // izohiga qara: `oylik` — OYLIK sahifasi, KPI emas; oddiy xodimda HR
    // sahifa qatorlari umuman bo'lmaydi). Qamrovni darvoza emas, SO'ROV
    // himoya qiladi: bu yo'lda `employeeId` parametri UMUMAN yo'q va server
    // sxemasi notanish kalitni tashlab yuboradi ⇒ ilova KIMNI so'rashini
    // TANLAY OLMAYDI.

    /** «Mening KPI'im»: `{limit, total, days[]}` — yangi kun tepada. */
    fun myKpi(limit: Int): JSONObject = get("/hr/kpi/my?limit=$limit")

    // -- ichki ---------------------------------------------------------------

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    private fun get(path: String): JSONObject =
        exec(Request.Builder().url(url(path)).get(), auth = true, retryOn401 = true)

    /**
     * MASSIV qaytaradigan yo'llar (X4: `my/trips`, `driver-cash/mine`).
     * Bo'sh tana — bo'sh ro'yxat. Obyekt kelib qolsa JIM bo'sh ro'yxat
     * ko'rsatmaymiz: shartnoma buzilgan, buni xato deb aytamiz.
     */
    private fun getArray(path: String): JSONArray {
        val text = execRaw(Request.Builder().url(url(path)).get(), auth = true, retryOn401 = true)
        if (text.isBlank() || text == "null") return JSONArray()
        return runCatching { JSONArray(text) }.getOrElse {
            throw ApiException(0, "Javob ro'yxat emas: " + path)
        }
    }

    /**
     * `null` ham to'g'ri javob bo'lgan yo'llar (X4: `shifts/current` — ochiq
     * smena yo'q). Bo'sh tana ham, `null` matni ham `null` demakdir.
     */
    private fun getObjectOrNull(path: String): JSONObject? {
        val text = execRaw(Request.Builder().url(url(path)).get(), auth = true, retryOn401 = true)
        if (text.isBlank() || text == "null") return null
        return runCatching { JSONObject(text) }.getOrElse {
            throw ApiException(0, "Javob obyekt emas: " + path)
        }
    }

    /**
     * Auth'li POST. 401 da BIR MARTA qaytarish bu yo'llar uchun XAVFSIZ:
     * check-in ochiq yozuv bo'lsa yangi yozuv yaratmay `already_open` beradi,
     * check-out esa ochiq yozuv bo'lmasa `no_open_record` — ikkalasi ham
     * takrorlansa qo'sh yozuv chiqmaydi (`ping-ingest.service.ts`).
     * Vazifa javobi (X3) esa bir martalik, lekin 401 ni guard beradi — so'rov
     * kontrollergacha yetib bormaydi, ya'ni qaytarish hech narsani buzmaydi.
     * Smena boshlash (X4) idempotent (ochiq smena qaytariladi), yakunlash esa
     * ochiq smena bo'lmasa 400 beradi — ikkalasi ham qo'sh yozuv yaratmaydi.
     */
    private fun post(path: String, body: JSONObject): JSONObject =
        exec(
            Request.Builder().url(url(path)).post(body.toString().toRequestBody(json)),
            auth = true,
            retryOn401 = true,
        )

    /**
     * So'rovni bajaradi. `retryOn401` — access-token eskirgan bo'lsa BIR MARTA
     * refresh qilib qaytaradi (auth'li GET yo'llarda va yuqoridagi idempotent
     * davomat POST'larida).
     */
    private fun exec(builder: Request.Builder, auth: Boolean, retryOn401: Boolean): JSONObject {
        val text = execRaw(builder, auth, retryOn401)
        // `null` — obyekt kutayotgan yo'lda bo'sh javob bilan bir xil
        // (X4 dan oldin bunday yo'l yo'q edi; `getObjectOrNull` uni ATAYLAB
        // farqlaydi, bu yerda esa eski xulq saqlanadi).
        return if (text.isBlank() || text == "null") JSONObject() else JSONObject(text)
    }

    /** So'rovni bajaradi va javob TANASINI xom matn sifatida qaytaradi. */
    private fun execRaw(builder: Request.Builder, auth: Boolean, retryOn401: Boolean): String {
        if (auth) accessToken?.let { builder.header("Authorization", "Bearer $it") }
        val req = builder.build()
        try {
            http.newCall(req).execute().use { r ->
                captureRefreshCookie(r.headers("Set-Cookie"))
                val text = r.body?.string().orEmpty()
                if (r.code == 401 && retryOn401 && tryRefresh() != null) {
                    // Yangi access-token bilan AYNI so'rov bir marta qaytariladi.
                    val again = req.newBuilder()
                        .header("Authorization", "Bearer " + (accessToken ?: ""))
                        .build()
                    http.newCall(again).execute().use { r2 ->
                        captureRefreshCookie(r2.headers("Set-Cookie"))
                        val text2 = r2.body?.string().orEmpty()
                        if (!r2.isSuccessful) {
                            throw ApiException(r2.code, "HTTP " + r2.code + ": " + text2)
                        }
                        return text2
                    }
                }
                if (!r.isSuccessful) throw ApiException(r.code, "HTTP " + r.code + ": " + text)
                return text
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: java.io.IOException) {
            throw ApiException(0, e.message ?: "Aloqa yo'q")
        }
    }

    /**
     * `Set-Cookie` lar ichidan `ms_rt` ni ajratib oladi. Qiymat DEKODLANMAYDI
     * — keyingi so'rovda aynan shu ko'rinishda qaytariladi (server o'zi
     * dekodlaydi), ya'ni kodlash bo'yicha taxmin yo'q.
     */
    private fun captureRefreshCookie(setCookies: List<String>) {
        for (c in setCookies) {
            if (!c.startsWith("ms_rt=")) continue
            val v = c.substring("ms_rt=".length).substringBefore(';')
            if (v.isNotEmpty()) {
                refreshToken = v
                onRefreshRotated?.invoke(v)
            }
        }
    }
}
