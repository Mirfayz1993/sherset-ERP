package uz.sherset.manager

import java.math.BigInteger
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

/**
 * YO'NALISHLARIM — smena/reys/naqd hisobining SOF FUNKSIYALARI (X4).
 *
 * `HrAccess`/`Davomat`/`Tasks` bilan bir xil sabab: Android'ga ham, `org.json`
 * ga ham bog'lanmaydi ⇒ oddiy JVM testi bilan sinaladi. Ekran faqat chizadi,
 * javobni `CashRow` ga o'zi ko'chiradi.
 *
 * 🔴 VALYUTALAR QO'SHILMAYDI (X-reja 8-qoidasi). `driver-cash/mine` javobida
 * har yozuvning O'Z valyutasi bor va ularning summasini qo'shish — yolg'on
 * raqam. Shuning uchun `pendingByCurrency` valyuta kesimida qaytaradi va
 * YAKUNIY JAMI umuman hisoblanmaydi.
 *
 * 🔴 `null` ≠ 0. Summani o'qib bo'lmasa (`amountMinor` buzuq kelsa) o'sha
 * valyutaning jamlanmasi `null` bo'ladi — «hisoblanmadi». Buzuq qatorni
 * jimgina tashlab yuborish xodimning qo'lidagi pulni KAMAYTIRIB ko'rsatardi.
 */
object Routes {

    /** Server sxemasidagi sukut valyuta (`DriverCashHandover.currency`). */
    const val DEFAULT_CURRENCY = "UZS"

    /** `driver-cash/mine` qatorining ekranga kerakli qismi. */
    data class CashRow(
        val amountMinor: String?,
        val currency: String?,
        val status: String?,
    )

    /**
     * Bitta valyutaning jamlanmasi. `totalMinor == null` — o'sha valyutada
     * o'qib bo'lmagan qator bor, ya'ni jamlanma HISOBLANMADI (0 EMAS).
     */
    data class CashTotal(
        val currency: String,
        val totalMinor: String?,
        val count: Int,
    )

    /**
     * Topshirilmagan («qo'lidagi») pul — VALYUTA kesimida.
     *
     * Faqat `pending`: `handed` pul allaqachon kassada (u yerda ikkinchi marta
     * sanalardi), `cancelled` esa umuman olinmagan — server izohi bilan bir xil
     * qaror (`driver-cash.service.outstandingByCurrency`).
     *
     * Tartib QAT'IY: avval `UZS` (asosiy valyuta), keyin alifbo bo'yicha —
     * shunda ro'yxat har yuklanishda bir xil joyda turadi.
     */
    fun pendingByCurrency(rows: List<CashRow>): List<CashTotal> {
        val sums = LinkedHashMap<String, BigInteger?>()
        val counts = LinkedHashMap<String, Int>()
        for (r in rows) {
            if (r.status != "pending") continue
            val cur = r.currency?.takeIf { it.isNotBlank() && it != "null" } ?: DEFAULT_CURRENCY
            counts[cur] = (counts[cur] ?: 0) + 1
            val parsed = parseMinor(r.amountMinor)
            if (!sums.containsKey(cur)) {
                sums[cur] = parsed
                continue
            }
            val prev = sums[cur]
            // Bir marta «o'qilmadi» bo'lgan valyuta shundayligicha qoladi:
            // qolgan qatorlarni qo'shib qo'ysak, yarim yig'indi chiqardi.
            sums[cur] = if (prev == null || parsed == null) null else prev + parsed
        }
        return counts.keys
            .sortedWith(compareBy({ if (it == DEFAULT_CURRENCY) 0 else 1 }, { it }))
            .map { CashTotal(it, sums[it]?.toString(), counts[it] ?: 0) }
    }

    /** `amountMinor` — BigInt-string. Buzuq/bo'sh bo'lsa `null` («o'qilmadi»). */
    fun parseMinor(amount: String?): BigInteger? {
        if (amount.isNullOrBlank() || amount == "null") return null
        return runCatching { BigInteger(amount.trim()) }.getOrNull()
    }

    // ── Smena ───────────────────────────────────────────────────────────────

    /**
     * Ochiq smena boshlanganidan beri o'tgan soniya. `null` — vaqt o'qilmadi.
     *
     * Manfiy natija 0 ga tiqiladi: qurilma soati serverdan bir necha soniya
     * orqada bo'lsa «−3 soniya» emas, «hozir boshlandi» to'g'riroq.
     */
    fun elapsedSeconds(startedIso: String?, now: Instant = Instant.now()): Long? {
        val at = instantOf(startedIso) ?: return null
        val sec = (now.toEpochMilli() - at.toEpochMilli()) / 1000
        return if (sec < 0) 0 else sec
    }

    /**
     * Soniya → «2 soat 15 daq». `null` → `null` (ekran «—» ni o'zi qo'yadi),
     * bir daqiqadan kam → «1 daq dan kam» (0 EMAS: smena boshlandi-ku).
     */
    fun durationLabel(seconds: Long?): String? {
        if (seconds == null || seconds < 0) return null
        if (seconds < 60) return "1 daq dan kam"
        val minutes = seconds / 60
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h == 0L -> "$m daq"
            m == 0L -> "$h soat"
            else -> "$h soat $m daq"
        }
    }

    // ── Reys ────────────────────────────────────────────────────────────────

    /**
     * Reys holatining rang/yorliq kaliti — yopiq lug'at
     * (`driver-trip.service.ts` dagi `ALLOWED_TRANSITIONS` kalitlari):
     * `assigned → enroute → arrived → completed | cancelled`.
     *
     * `unknown` — server yangi holat qo'shgan; ilova YIQILMAYDI, xom qiymatni
     * o'zi ko'rsatadi.
     */
    fun tripStatusTone(status: String?): String = when (status) {
        "assigned" -> "assigned"
        "enroute" -> "enroute"
        "arrived" -> "arrived"
        "completed" -> "done"
        "cancelled" -> "cancelled"
        else -> "unknown"
    }

    /** Yakunlanmagan reys (dispecher board bilan bir xil ro'yxat). */
    fun isTripActive(status: String?): Boolean =
        status == "assigned" || status == "enroute" || status == "arrived"

    /** Manba hujjat turi (`DriverTrip.orderType`) — yopiq lug'at. */
    fun orderTypeTone(orderType: String?): String = when (orderType) {
        "demand" -> "demand"
        "retail_sale" -> "retail_sale"
        "manual" -> "manual"
        else -> "unknown"
    }

    /**
     * Manzil sarlavhasi: matn bo'lsa o'sha, bo'lmasa koordinata. Ikkalasi ham
     * yo'q bo'lsa `null` — ekran «manzil ko'rsatilmagan» deydi (bo'sh satr
     * emas: xodim kartani manzilsiz deb tushunishi kerak).
     */
    fun destLabel(address: String?, lat: Double?, lng: Double?): String? {
        val a = address?.trim()
        if (!a.isNullOrEmpty() && a != "null") return a
        return coords(lat, lng)
    }

    /**
     * `41.31083, 69.27972` — 🔴 `Locale.ROOT` MAJBURIY: qurilma lokali
     * ruscha/o'zbekcha bo'lsa `%f` kasr ajratgichni vergul qilib qo'yadi va
     * koordinata «41,31083, 69,27972» bo'lib o'qib bo'lmay qoladi.
     */
    fun coords(lat: Double?, lng: Double?): String? {
        if (lat == null || lng == null) return null
        if (lat.isNaN() || lng.isNaN() || lat.isInfinite() || lng.isInfinite()) return null
        return String.format(Locale.ROOT, "%.5f, %.5f", lat, lng)
    }

    /** Masofa (metr) → «1,2 km» / «450 m». `null` → `null`. */
    fun distanceLabel(meters: Int?): String? {
        if (meters == null || meters < 0) return null
        if (meters < 1000) return "$meters m"
        return String.format(Locale.ROOT, "%.1f km", meters / 1000.0)
    }

    private fun instantOf(iso: String?): Instant? {
        if (iso.isNullOrBlank() || iso == "null") return null
        return runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
    }
}
