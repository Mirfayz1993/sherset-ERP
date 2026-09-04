package uz.sherset.manager

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
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

    // -- ichki ---------------------------------------------------------------

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    private fun get(path: String): JSONObject =
        exec(Request.Builder().url(url(path)).get(), auth = true, retryOn401 = true)

    /**
     * So'rovni bajaradi. `retryOn401` — access-token eskirgan bo'lsa BIR MARTA
     * refresh qilib qaytaradi (faqat auth'li GET yo'llarda).
     */
    private fun exec(builder: Request.Builder, auth: Boolean, retryOn401: Boolean): JSONObject {
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
                        return if (text2.isBlank()) JSONObject() else JSONObject(text2)
                    }
                }
                if (!r.isSuccessful) throw ApiException(r.code, "HTTP " + r.code + ": " + text)
                return if (text.isBlank()) JSONObject() else JSONObject(text)
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
