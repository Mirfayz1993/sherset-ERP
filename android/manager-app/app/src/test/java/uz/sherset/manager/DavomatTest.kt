package uz.sherset.manager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Davomat ekranining oy/kun hisobi (X-reja X2).
 *
 * `Davomat` — Android'siz sof funksiyalar to'plami, shuning uchun oddiy JVM
 * testi (`gradle testDebugUnitTest`). Asosiy tuzoqlar:
 *   - oy chegarasi (dekabr→yanvar) va kelajak oyga o'tmaslik;
 *   - qurilma mintaqasi boshqa bo'lsa ham «joriy oy» TOSHKENT bo'yicha;
 *   - `null` ≠ 0 (kechikish).
 */
class DavomatTest {

    // ── Oy surish ───────────────────────────────────────────────────────────

    @Test
    fun `oldingi oyga o'tadi`() {
        assertEquals("2026-08", Davomat.shiftMonth("2026-09", -1))
    }

    @Test
    fun `yanvardan orqaga o'tganda yil kamayadi`() {
        assertEquals("2025-12", Davomat.shiftMonth("2026-01", -1))
    }

    @Test
    fun `dekabrdan oldinga o'tganda yil oshadi`() {
        assertEquals("2027-01", Davomat.shiftMonth("2026-12", 1))
    }

    @Test
    fun `buzuq oy matni o'zini qaytaradi - ekran yiqilmaydi`() {
        assertEquals("shalag'", Davomat.shiftMonth("shalag'", -1))
    }

    // ── Kelajak oy yopiq ────────────────────────────────────────────────────

    @Test
    fun `o'tgan oydan keyingiga o'tish mumkin`() {
        assertTrue(Davomat.canGoNext("2026-08", "2026-09"))
    }

    @Test
    fun `joriy oydan keyingiga o'tib bo'lmaydi`() {
        assertFalse(Davomat.canGoNext("2026-09", "2026-09"))
    }

    @Test
    fun `kelajak oydan yana oldinga o'tib bo'lmaydi`() {
        assertFalse(Davomat.canGoNext("2026-10", "2026-09"))
    }

    // ── Joriy oy — TOSHKENT kalendari ───────────────────────────────────────

    @Test
    fun `joriy oy Toshkent mintaqasidan olinadi`() {
        // UTC'da hali 31-avgust 20:00, Toshkentda esa 1-sentabr 01:00 —
        // server sentabrni ko'radi, ilova ham AYNAN shuni so'rashi kerak.
        val t = Instant.parse("2026-08-31T20:00:00Z")
        assertEquals("2026-09", Davomat.currentYearMonth(t))
    }

    @Test
    fun `oy oxirida UTC bilan farq qilmagan payt ham to'g'ri`() {
        val t = Instant.parse("2026-09-15T06:00:00Z")
        assertEquals("2026-09", Davomat.currentYearMonth(t))
    }

    // ── Yorliqlar ───────────────────────────────────────────────────────────

    @Test
    fun `oy yorlig'i o'zbekcha`() {
        assertEquals("Sentabr 2026", Davomat.monthLabel("2026-09"))
        assertEquals("Yanvar 2026", Davomat.monthLabel("2026-01"))
        assertEquals("Dekabr 2025", Davomat.monthLabel("2025-12"))
    }

    @Test
    fun `buzuq oy yorlig'i o'zini qaytaradi`() {
        assertEquals("2026-99", Davomat.monthLabel("2026-99"))
    }

    @Test
    fun `kun raqami boshidagi nolsiz`() {
        assertEquals("5", Davomat.dayNumber("2026-09-05"))
        assertEquals("15", Davomat.dayNumber("2026-09-15"))
    }

    @Test
    fun `hafta kuni qisqartmasi`() {
        assertEquals("Ju", Davomat.weekdayLabel("2026-09-04")) // juma
        assertEquals("Yak", Davomat.weekdayLabel("2026-09-06")) // yakshanba
        assertEquals("Du", Davomat.weekdayLabel("2026-09-07")) // dushanba
    }

    @Test
    fun `buzuq sanada hafta kuni bo'sh - ekran yiqilmaydi`() {
        assertEquals("", Davomat.weekdayLabel("—"))
    }

    // ── Halol raqamlar: null ≠ 0 ────────────────────────────────────────────

    @Test
    fun `kechikish null bo'lsa chiziqcha - o'lchanmadi`() {
        assertEquals("—", Davomat.lateLabel(null))
    }

    @Test
    fun `kechikish nol bo'lsa ham chiziqcha - plashka chizilmaydi`() {
        assertEquals("—", Davomat.lateLabel(0))
    }

    @Test
    fun `kechikish bo'lsa daqiqada ko'rsatiladi`() {
        assertEquals("20 daq", Davomat.lateLabel(20))
    }

    // ── my/today vaqti UTC keladi — Toshkentga o'giriladi ───────────────────

    @Test
    fun `UTC instant Toshkent vaqtiga o'giriladi`() {
        // Server 04:20 UTC beradi — xodim soat 09:20 da kelgan.
        assertEquals("09:20", Davomat.localTime("2026-09-04T04:20:00.000Z"))
    }

    @Test
    fun `ofsetli ISO ham qabul qilinadi`() {
        assertEquals("09:20", Davomat.localTime("2026-09-04T09:20:00+05:00"))
    }

    @Test
    fun `yarim tundan keyingi UTC vaqti kun chegarasida to'g'ri`() {
        // 20:30 UTC = ertasi kun 01:30 Toshkent (tungi smena yakuni).
        assertEquals("01:30", Davomat.localTime("2026-09-04T20:30:00.000Z"))
    }

    @Test
    fun `vaqt null yoki buzuq bo'lsa ekran yiqilmaydi`() {
        assertEquals("—", Davomat.localTime(null))
        assertEquals("—", Davomat.localTime("null"))
        assertEquals("shalag'", Davomat.localTime("shalag'"))
    }

    @Test
    fun `vaqt null yoki bo'sh bo'lsa chiziqcha`() {
        assertEquals("—", Davomat.timeOrDash(null))
        assertEquals("—", Davomat.timeOrDash(""))
        // org.json `optString` yo'q maydonda "null" MATNINI berib yuboradi.
        assertEquals("—", Davomat.timeOrDash("null"))
        assertEquals("09:20", Davomat.timeOrDash("09:20"))
    }
}
