package uz.sherset.manager

import java.math.BigInteger
import java.util.Locale
import kotlin.math.roundToLong

/**
 * MENING KPI'IM — kun kartasining SOF FUNKSIYALARI (X5).
 *
 * `HrAccess`/`Davomat`/`Tasks`/`Routes` bilan bir xil sabab: Android'ga ham,
 * `org.json` ga ham bog'lanmaydi ⇒ oddiy JVM testi bilan sinaladi. Ekran
 * faqat chizadi.
 *
 * 🔴 `null` ≠ 0 (X-reja 8-qoidasi). Serverda ham shu shartnoma:
 *  - `score: null` — hech narsa ballanmadi (profil/maqsad/og'irlik yo'q).
 *    Bu «0%» EMAS va ekranda «hisoblanmadi» bo'lib chiqadi.
 *  - `autoValue: null` — ko'rsatkich O'LCHANMAGAN, nol natija emas.
 *  - `workedMinutes: null` — davomat yozuvi yo'q, «0 daqiqa ishladi» emas.
 * Shuning uchun bu yerdagi formatlovchilar `null` ni QAYTARADI (bo'sh satr
 * yoki 0 emas) va matnni ekran tanlaydi.
 *
 * 🔴 SANA — INSTANT EMAS, YORLIQ. `EmployeeDailyKpi.date` bazada `@db.Date`
 * va u MAHALLIY kunni nomlaydi (`tz.util.localDateOnly`), ya'ni JSON'da
 * `2026-09-03T00:00:00.000Z` ko'rinishida keladi. Uni X2/X3 dagidek Toshkentga
 * O'GIRISH KERAK EMAS: yorliqni mintaqaga surish uni buzadi. Shu sababli
 * bu yerda sana matndan kesib olinadi (`Davomat.localTime` YO'Q).
 */
object MyKpi {

    // ── Sana ────────────────────────────────────────────────────────────────

    /** `2026-09-03T00:00:00.000Z` → `2026-09-03`. Buzuq matn → `null`. */
    fun dateOnly(iso: String?): String? {
        if (iso.isNullOrBlank() || iso == "null") return null
        val head = if (iso.length >= 10) iso.substring(0, 10) else return null
        return if (Regex("""\d{4}-\d{2}-\d{2}""").matches(head)) head else null
    }

    /** `2026-09-03T…` → «03.09 · Pa». Buzuq matn → `null`. */
    fun dayLabel(iso: String?): String? {
        val d = dateOnly(iso) ?: return null
        val weekday = Davomat.weekdayLabel(d)
        val head = d.substring(8, 10) + "." + d.substring(5, 7)
        return if (weekday.isEmpty()) head else "$head · $weekday"
    }

    // ── Foizlar ─────────────────────────────────────────────────────────────

    /**
     * Ball/bajarish foizi → «88%». `null` → `null` («hisoblanmadi»).
     *
     * Butun songa yaxlitlanadi: telefon kartasida kasr foiz aniqlik
     * bermaydi, `Locale` bilan bog'liq kasr-ajratgich tuzog'ini ham
     * chetlab o'tadi (X4 ning 7-topilmasi).
     */
    fun percent(value: Double?): String? {
        if (value == null || value.isNaN() || value.isInfinite()) return null
        return "${value.roundToLong()}%"
    }

    /** Qamrov 0…1 → «75%». `null` → `null` (og'irlik umuman yo'q). */
    fun coveragePercent(coverage: Double?): String? {
        if (coverage == null || coverage.isNaN() || coverage.isInfinite()) return null
        return "${(coverage * 100).roundToLong()}%"
    }

    /**
     * Og'irlik → «1,5» EMAS, «1.5». 🔴 `Locale.ROOT` MAJBURIY: qurilma lokali
     * ruscha/o'zbekcha bo'lsa `%f` kasr ajratgichni vergul qilib qo'yadi
     * (X4 ning 7-topilmasi). Butun son bo'lsa kasr qismi ko'rsatilmaydi.
     *
     * `null` = og'irlik QO'YILMAGAN (0 EMAS — server shartnomasi, KPI-05).
     */
    fun weightLabel(weight: Double?): String? {
        if (weight == null || weight.isNaN() || weight.isInfinite()) return null
        if (weight == weight.toLong().toDouble()) return weight.toLong().toString()
        return String.format(Locale.ROOT, "%.2f", weight).trimEnd('0').trimEnd('.')
    }

    // ── Ko'rsatkich qiymati ─────────────────────────────────────────────────

    /** Pulmi (ekran «so'm» yozuvini `Fmt.minor` dan oladi). */
    fun isMoney(unit: String?): Boolean = unit == "money"

    /**
     * Ko'rsatkich raqami — BIRLIK SO'ZISIZ (pul bundan mustasno: `Fmt.minor`
     * «so'm» ni o'zi qo'yadi). `null` → `null` = «o'lchanmadi».
     *
     * Qiymat serverdan BigInt-string bo'lib keladi (`autoValue`/`target`),
     * ya'ni `Long` chegarasidan katta bo'lishi mumkin — `BigInteger` bilan
     * o'qiladi (X4 dagi naqd summasi bilan bir xil ehtiyot chorasi).
     */
    fun metricNumber(value: String?, unit: String?): String? {
        if (value.isNullOrBlank() || value == "null") return null
        if (isMoney(unit)) return Fmt.minor(value, "UZS")
        val v = runCatching { BigInteger(value.trim()) }.getOrNull() ?: return null
        return Fmt.group(v)
    }

    /** Birlik so'zi kerakmi: `minutes` → «daq», `percent` → «%». */
    fun unitSuffix(unit: String?): String? = when (unit) {
        "minutes" -> "daq"
        "percent" -> "%"
        else -> null
    }

    // ── Yopiq lug'atlar ─────────────────────────────────────────────────────

    /**
     * Kun holati (`daily-kpi-fsm.ts` DAILY_KPI_STATE) — yopiq lug'at.
     * `unknown` = server yangi holat qo'shgan; ilova YIQILMAYDI, xom
     * qiymatni o'zi ko'rsatadi (X4 dagi reys holati bilan bir naqsh).
     */
    fun stateTone(state: String?): String = when (state) {
        "computed" -> "computed"
        "pending" -> "pending"
        "accepted" -> "accepted"
        "rejected" -> "rejected"
        "escalated" -> "escalated"
        "force_accepted" -> "force_accepted"
        "stale" -> "stale"
        else -> "unknown"
    }

    /**
     * E'tibor signali kaliti (server `attentionSignals` ro'yxati). Yopiq
     * lug'at — server ro'yxati kengaysa `unknown` bo'ladi va xom kalit
     * ko'rinadi (jimgina yashirilmaydi: xodim nega kun belgilanganini
     * bilishi kerak).
     */
    fun signalTone(signal: String?): String = when (signal) {
        "stale", "escalated", "rejected", "data_incomplete" -> "state"
        "till_variance_abs", "below_cost_count", "cancel_count", "refund_count",
        "late_minutes",
        -> "metric"
        else -> "unknown"
    }

    /**
     * Ko'rsatkich ballga NEGA kirmagani (`kpi-score.ts` SkipReason).
     * Ekranda ochiq aytiladi — jimgina 0 ko'rsatilmaydi.
     */
    fun skipTone(skipReason: String?): String = when (skipReason) {
        "unmeasured" -> "unmeasured"
        "no_target" -> "no_target"
        "no_weight" -> "no_weight"
        "neutral" -> "neutral"
        "unknown_metric" -> "unknown_metric"
        else -> "none"
    }

    /**
     * Ball ishonchli ko'rinishda chiqsinmi. `scoreIsFinal == false` — kun
     * hali qabul qilinmagan, ya'ni raqam O'ZGARISHI MUMKIN. Buni ekran
     * ochiq aytadi: aks holda xodim taxminiy ballni yakuniy deb o'ylardi.
     */
    fun isProvisional(scoreIsFinal: Boolean, score: Double?): Boolean =
        score != null && !scoreIsFinal
}
