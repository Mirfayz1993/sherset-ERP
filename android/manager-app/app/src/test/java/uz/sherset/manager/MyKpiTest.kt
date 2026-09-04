package uz.sherset.manager

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * MENING KPI'IM sof funksiyalarining testlari (X5).
 *
 * Uch nozik joy ataylab qoplangan:
 *  1. `null` ≠ 0 — «hisoblanmadi» hech qayerda nolga aylanmaydi;
 *  2. sana YORLIQ (instant emas) — mintaqaga surilmaydi;
 *  3. `Locale.ROOT` — og'irlikdagi kasr ajratgich qurilma lokaliga
 *     bog'lanib qolmaydi (X4 ning 7-topilmasi).
 */
class MyKpiTest {

    /**
     * 🔴 `Fmt.group` mingliklarni UZILMAYDIGAN probel (U+00A0) bilan ajratadi
     * — ODDIY probel EMAS (raqam qatorining o'rtasidan bo'linib ketmasligi
     * uchun). Testning birinchi varianti oddiy probel bilan yozilgan edi va
     * «1 234 ≠ 1 234» degan o'qib bo'lmaydigan xato berdi.
     *
     * Ko'rinmas belgi shu faylda FAQAT SHU BITTA joyda turadi — qolgan
     * kutilgan matnlar shu konstantadan yig'iladi.
     */
    private val NBSP = " "

    private val defaultLocale: Locale = Locale.getDefault()

    @After
    fun restoreLocale() {
        Locale.setDefault(defaultLocale)
    }

    // ── Sana: YORLIQ, instant emas ──────────────────────────────────────────

    @Test
    fun `dateOnly serverdagi kun yorligini AYNAN qaytaradi`() {
        assertEquals("2026-09-03", MyKpi.dateOnly("2026-09-03T00:00:00.000Z"))
    }

    @Test
    fun `dateOnly mintaqaga SURMAYDI — yarim tun ertangi kunga o'tib ketmaydi`() {
        // 🔴 `EmployeeDailyKpi.date` — `@db.Date`, ya'ni MAHALLIY kun yorlig'i.
        // Uni Toshkentga o'girish (+5) kunni surib yuborardi; X2/X3 dagi UTC
        // tuzog'i bu maydonda TESKARI ishlaydi.
        assertEquals("2026-01-01", MyKpi.dateOnly("2026-01-01T00:00:00.000Z"))
        assertEquals("2026-12-31", MyKpi.dateOnly("2026-12-31T00:00:00.000Z"))
    }

    @Test
    fun `dateOnly buzuq matnda null`() {
        assertNull(MyKpi.dateOnly(null))
        assertNull(MyKpi.dateOnly(""))
        assertNull(MyKpi.dateOnly("null"))
        assertNull(MyKpi.dateOnly("qisqa"))
        assertNull(MyKpi.dateOnly("2026/09/03T00:00:00Z"))
    }

    @Test
    fun `dayLabel kun va hafta kunini beradi`() {
        // 2026-09-03 — payshanba.
        assertEquals("03.09 · Pa", MyKpi.dayLabel("2026-09-03T00:00:00.000Z"))
    }

    @Test
    fun `dayLabel buzuq sanada null — ekran o'zi tire qo'yadi`() {
        assertNull(MyKpi.dayLabel("null"))
    }

    // ── Foiz: null ≠ 0 ──────────────────────────────────────────────────────

    @Test
    fun `percent butun songa yaxlitlaydi`() {
        assertEquals("88%", MyKpi.percent(87.6))
        assertEquals("100%", MyKpi.percent(100.0))
        assertEquals("150%", MyKpi.percent(150.0))
    }

    @Test
    fun `percent null bo'lsa null — nolga AYLANMAYDI`() {
        assertNull(MyKpi.percent(null))
    }

    @Test
    fun `percent haqiqiy nolni ko'rsatadi (0 va null farqlanadi)`() {
        assertEquals("0%", MyKpi.percent(0.0))
    }

    @Test
    fun `percent buzuq son null`() {
        assertNull(MyKpi.percent(Double.NaN))
        assertNull(MyKpi.percent(Double.POSITIVE_INFINITY))
    }

    @Test
    fun `coveragePercent 0…1 oralig'ini foizga o'giradi`() {
        assertEquals("75%", MyKpi.coveragePercent(0.75))
        assertEquals("100%", MyKpi.coveragePercent(1.0))
        assertEquals("0%", MyKpi.coveragePercent(0.0))
        assertNull(MyKpi.coveragePercent(null))
    }

    // ── Og'irlik: Locale.ROOT ───────────────────────────────────────────────

    @Test
    fun `weightLabel butun og'irlikni kasrsiz beradi`() {
        assertEquals("1", MyKpi.weightLabel(1.0))
        assertEquals("3", MyKpi.weightLabel(3.0))
    }

    @Test
    fun `weightLabel kasr og'irlikda NUQTA ishlatadi — ru-RU lokalida ham`() {
        // 🔴 X4 ning 7-topilmasi: lokal ruscha bo'lsa `%f` vergul qo'yadi.
        Locale.setDefault(Locale.forLanguageTag("ru-RU"))
        assertEquals("1.5", MyKpi.weightLabel(1.5))
        assertEquals("0.25", MyKpi.weightLabel(0.25))
    }

    @Test
    fun `weightLabel null — og'irlik QO'YILMAGAN, 0 emas`() {
        assertNull(MyKpi.weightLabel(null))
        // Nol qo'yilgan og'irlik esa ko'rinadi.
        assertEquals("0", MyKpi.weightLabel(0.0))
    }

    // ── Ko'rsatkich qiymati ─────────────────────────────────────────────────

    @Test
    fun `metricNumber pulni so'mga o'giradi`() {
        assertEquals("10${NBSP}000 so'm", MyKpi.metricNumber("1000000", "money"))
    }

    @Test
    fun `metricNumber sanoqni guruhlaydi`() {
        assertEquals("1${NBSP}234", MyKpi.metricNumber("1234", "count"))
        assertEquals("45", MyKpi.metricNumber("45", "minutes"))
    }

    @Test
    fun `metricNumber Long chegarasidan katta summani ham o'qiydi`() {
        // Server BigInt-string beradi; `toLong()` bilan o'qish jimgina
        // buzardi (X4 dagi naqd summasi bilan bir xil ehtiyot chorasi).
        val huge = "18446744073709551614"
        val expected = listOf("18", "446", "744", "073", "709", "551", "614").joinToString(NBSP)
        assertEquals(expected, MyKpi.metricNumber(huge, "count"))
    }

    @Test
    fun `metricNumber o'lchanmagan qiymatda null — 0 EMAS`() {
        assertNull(MyKpi.metricNumber(null, "count"))
        assertNull(MyKpi.metricNumber("", "count"))
        assertNull(MyKpi.metricNumber("null", "count"))
        assertNull(MyKpi.metricNumber("buzuq", "count"))
    }

    @Test
    fun `metricNumber haqiqiy nolni ko'rsatadi`() {
        assertEquals("0", MyKpi.metricNumber("0", "count"))
    }

    @Test
    fun `unitSuffix yopiq lug'at`() {
        assertEquals("daq", MyKpi.unitSuffix("minutes"))
        assertEquals("%", MyKpi.unitSuffix("percent"))
        assertNull(MyKpi.unitSuffix("money"))
        assertNull(MyKpi.unitSuffix("count"))
        assertNull(MyKpi.unitSuffix(null))
    }

    // ── Yopiq lug'atlar ─────────────────────────────────────────────────────

    @Test
    fun `stateTone FSM holatlarini biladi`() {
        for (s in listOf(
            "computed",
            "pending",
            "accepted",
            "rejected",
            "escalated",
            "force_accepted",
            "stale",
        )) {
            assertEquals(s, MyKpi.stateTone(s))
        }
    }

    @Test
    fun `stateTone server yangi holat qo'shsa ilova yiqilmaydi`() {
        assertEquals("unknown", MyKpi.stateTone("archived"))
        assertEquals("unknown", MyKpi.stateTone(null))
    }

    @Test
    fun `signalTone holat va ko'rsatkich signalini ajratadi`() {
        assertEquals("state", MyKpi.signalTone("rejected"))
        assertEquals("state", MyKpi.signalTone("data_incomplete"))
        assertEquals("metric", MyKpi.signalTone("late_minutes"))
        assertEquals("metric", MyKpi.signalTone("till_variance_abs"))
        assertEquals("unknown", MyKpi.signalTone("yangi_signal"))
    }

    @Test
    fun `skipTone server sabablarini biladi va notanishini none qiladi`() {
        assertEquals("unmeasured", MyKpi.skipTone("unmeasured"))
        assertEquals("no_target", MyKpi.skipTone("no_target"))
        assertEquals("no_weight", MyKpi.skipTone("no_weight"))
        assertEquals("neutral", MyKpi.skipTone("neutral"))
        assertEquals("unknown_metric", MyKpi.skipTone("unknown_metric"))
        assertEquals("none", MyKpi.skipTone(null))
        assertEquals("none", MyKpi.skipTone("yangi_sabab"))
    }

    // ── Yakuniy / taxminiy ball ─────────────────────────────────────────────

    @Test
    fun `isProvisional qabul qilinmagan kunda ogohlantiradi`() {
        assertTrue(MyKpi.isProvisional(scoreIsFinal = false, score = 88.0))
    }

    @Test
    fun `isProvisional muzlagan kunda ogohlantirmaydi`() {
        assertFalse(MyKpi.isProvisional(scoreIsFinal = true, score = 88.0))
    }

    @Test
    fun `isProvisional balli yo'q kunda ogohlantirmaydi — ogohlantirish uchun raqam kerak`() {
        assertFalse(MyKpi.isProvisional(scoreIsFinal = false, score = null))
    }

    @Test
    fun `isMoney faqat money birligida`() {
        assertTrue(MyKpi.isMoney("money"))
        assertFalse(MyKpi.isMoney("count"))
        assertFalse(MyKpi.isMoney(null))
    }
}
