package uz.sherset.manager

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

/**
 * DAVOMAT — oy/kun hisobining SOF FUNKSIYALARI (X2).
 *
 * `HrAccess` bilan bir xil sabab: Android'ga ham, `org.json` ga ham
 * bog'lanmaydi ⇒ oddiy JVM testi bilan sinaladi (emulyator/Robolectric
 * kerak emas). Ekran esa faqat chizadi.
 *
 * 🔴 VAQT MINTAQASI. Server davomatni Toshkent kalendari bo'yicha kesadi
 * (`hr-shared/tz.util.ts` — `HR_TZ`). Qurilma soati boshqa mintaqada bo'lsa
 * ham «joriy oy» AYNAN shu mintaqadan olinadi, aks holda oyning birinchi/
 * oxirgi kunlarida ilova serverdan boshqa oyni so'rab qolardi.
 */
object Davomat {

    /** Server bilan bir xil mintaqa — o'zgartirilmaydi. */
    val TZ: ZoneId = ZoneId.of("Asia/Tashkent")

    private val MONTHS = arrayOf(
        "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
        "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
    )

    /** Dushanbadan boshlab (java.time `DayOfWeek` tartibi: 1=Du … 7=Yak). */
    private val WEEKDAYS = arrayOf("Du", "Se", "Ch", "Pa", "Ju", "Sha", "Yak")

    /** Toshkent kalendari bo'yicha joriy oy — `yyyy-MM`. */
    fun currentYearMonth(now: Instant = Instant.now()): String =
        YearMonth.from(now.atZone(TZ)).toString()

    /**
     * Oyni surish: `shiftMonth("2026-01", -1)` → `"2025-12"`.
     * Buzuq matn kelsa o'zini qaytaradi (ekran jim yiqilmaydi).
     */
    fun shiftMonth(yearMonth: String, delta: Long): String =
        runCatching { YearMonth.parse(yearMonth).plusMonths(delta).toString() }
            .getOrDefault(yearMonth)

    /**
     * «Keyingi oy» tugmasi ochiqmi? Kelajak oy hech qachon ochilmaydi —
     * server u yerda bo'sh ro'yxat qaytaradi va ekran sababsiz bo'sh ko'rinardi.
     */
    fun canGoNext(yearMonth: String, todayYearMonth: String): Boolean =
        yearMonth < todayYearMonth

    /** `2026-09` → «Sentabr 2026». Buzuq matn — o'zi. */
    fun monthLabel(yearMonth: String): String {
        val ym = runCatching { YearMonth.parse(yearMonth) }.getOrNull() ?: return yearMonth
        return MONTHS[ym.monthValue - 1] + " " + ym.year
    }

    /** `2026-09-15` → «15» (kun raqami). Buzuq matn — o'zi. */
    fun dayNumber(date: String): String =
        if (date.length >= 10) date.substring(8, 10).trimStart('0') else date

    /** `2026-09-15` → «Se» (hafta kuni, qisqa). Buzuq matn — bo'sh. */
    fun weekdayLabel(date: String): String {
        val d = runCatching { LocalDate.parse(date) }.getOrNull() ?: return ""
        return WEEKDAYS[d.dayOfWeek.value - 1]
    }

    /**
     * Kechikish matni. 🔴 `null` ≠ 0 (X-reja 8-qoidasi): yozuvi yo'q kunda
     * «0 daq» yozish YOLG'ON bo'lardi.
     *  - `null` → «—» (o'lchanmadi)
     *  - `0`    → «—» (keldi, kechikmadi — plashka ham chizilmaydi)
     *  - `n>0`  → «n daq»
     */
    fun lateLabel(lateMinutes: Int?): String =
        if (lateMinutes == null || lateMinutes <= 0) "—" else "$lateMinutes daq"

    /** Vaqt yoki «—» (server `HH:mm` matnini beradi, `null` — yozuv yo'q). */
    fun timeOrDash(hhmm: String?): String =
        if (hhmm.isNullOrBlank() || hhmm == "null") "—" else hhmm

    /**
     * 🔴 `my/today` javobidagi VAQT — UTC. Nest `Date` ni `JSON.stringify`
     * bilan beradi, ya'ni `2026-09-04T04:20:00.000Z`. Uni matndan kesib
     * olish (`substring(11,16)`) ekranda 5 SOAT ORQADAGI vaqtni chiqarardi —
     * xodim «men 09:20 da keldim» deganda ilova «04:20» deb turardi.
     * Shuning uchun instant Toshkentga o'giriladi.
     *
     * `my/history` esa allaqachon lokal `HH:mm` beradi — u yerda `timeOrDash`.
     */
    fun localTime(iso: String?): String {
        if (iso.isNullOrBlank() || iso == "null") return "—"
        return runCatching {
            java.time.OffsetDateTime.parse(iso)
                .atZoneSameInstant(TZ)
                .toLocalTime()
                .toString()
                .substring(0, 5)
        }.getOrDefault(iso)
    }
}
