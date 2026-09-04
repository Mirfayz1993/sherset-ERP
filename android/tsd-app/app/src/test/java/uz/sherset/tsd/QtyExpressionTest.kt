package uz.sherset.tsd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/**
 * T5 — `QtyExpression` qulflari.
 *
 * Bu ilovadagi BIRINCHI unit-test (U-reja «Ochiq qolganlar»: TSD tomonda test
 * infratuzilmasi yo'q edi). U mumkin bo'ldi, chunki `QtyExpression` ataylab
 * SOF modul: Android ham, Compose ham, `R` ham unga kirmaydi.
 *
 * 🔴 Eng muhim qulf — [serverRegexQulfi]: hisoblangan matn serverning
 * `/^\d+(\.\d{1,6})?$/` qoidasiga MOS bo'lishi shart. Aks holda omborchi
 * ekranda «= 288» ni ko'rib, saqlashda 400 olardi.
 */
class QtyExpressionTest {

    private fun ok(input: String): String {
        val r = QtyExpression.parse(input)
        assertTrue("«$input» uchun Ok kutilgandi, keldi: $r", r is QtyExpression.Result.Ok)
        return (r as QtyExpression.Result.Ok).text
    }

    private fun bad(input: String): QtyExpression.Problem {
        val r = QtyExpression.parse(input)
        assertTrue("«$input» uchun Bad kutilgandi, keldi: $r", r is QtyExpression.Result.Bad)
        return (r as QtyExpression.Result.Bad).problem
    }

    // ---- Sof sonlar ----

    @Test
    fun sofSonlar() {
        assertEquals("12", ok("12"))
        assertEquals("0", ok("0"))
        assertEquals("14.5", ok("14.5"))
        assertEquals("250", ok(" 250 "))
    }

    /** Vergul ham, nuqta ham — jonlida kabel/shlang metrlari o'nlik keladi. */
    @Test
    fun vergulNuqtaBilanTeng() {
        assertEquals("14.5", ok("14,5"))
        assertEquals(ok("14.5"), ok("14,5"))
        assertEquals("10", ok("2,5*4"))
    }

    /** Yozayotgan odamning oraliq holatlari — jimgina boshqa songa aylanmaydi. */
    @Test
    fun yarimYozilganSon() {
        assertEquals("0.5", ok(".5"))
        assertEquals("14", ok("14."))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("."))
    }

    /** Serverning `Decimal(20,6)` ustuni `12.000000` beradi — maydonda `12` bo'lsin. */
    @Test
    fun ortiqchaNollarKesiladi() {
        assertEquals("12", ok("12.000000"))
        assertEquals("0", ok("0.000"))
        assertEquals("100", ok("100.0"))
    }

    // ---- Kalkulyator ----

    @Test
    fun kopaytirish() {
        assertEquals("288", ok("12*24"))
        assertEquals("288", ok("12 * 24"))
        assertEquals("288", ok("12×24"))
        assertEquals("288", ok("12x24"))
        assertEquals("288", ok("12X24"))
    }

    @Test
    fun qoshishVaAyirish() {
        assertEquals("15", ok("10+5"))
        assertEquals("5", ok("10-5"))
        assertEquals("0", ok("10-10"))
    }

    /** Ko'paytirish qo'shishdan USTUN: `3*24+6` = 78 (90 emas). */
    @Test
    fun amallarTartibi() {
        assertEquals("78", ok("3*24+6"))
        assertEquals("78", ok("6+3*24"))
        assertEquals("20", ok("(2+3)*4"))
        assertEquals("14", ok("2+3*4"))
    }

    @Test
    fun kasrliKopaytma() {
        assertEquals("31.25", ok("12.5*2.5"))
        assertEquals("37.5", ok("2,5*15"))
    }

    @Test
    fun evaluateSonQaytaradi() {
        assertEquals(0, BigDecimal("288").compareTo(QtyExpression.evaluate("12*24")))
        assertEquals(0, BigDecimal("14.5").compareTo(QtyExpression.evaluate("14,5")))
        assertNull(QtyExpression.evaluate("12*"))
        assertNull(QtyExpression.evaluate(""))
    }

    // ---- Rad etiladigan holatlar (saqlash IMKONSIZ) ----

    @Test
    fun bosMaydonXatoEmasLekinYuborilmaydi() {
        assertTrue(QtyExpression.parse("") is QtyExpression.Result.Empty)
        assertTrue(QtyExpression.parse("   ") is QtyExpression.Result.Empty)
        assertNull(QtyExpression.qty(""))
        assertNull(QtyExpression.qty("   "))
    }

    /** 🔴 Bo'lish ATAYLAB yo'q va sababi ANIQ aytiladi (umumiy «xato» emas). */
    @Test
    fun bolishQollabQuvvatlanmaydi() {
        assertEquals(QtyExpression.Problem.DIVISION, bad("12/2"))
        assertEquals(QtyExpression.Problem.DIVISION, bad("12:2"))
        assertEquals(QtyExpression.Problem.DIVISION, bad("12÷2"))
        assertNull(QtyExpression.qty("12/2"))
    }

    @Test
    fun buzuqIfoda() {
        assertEquals(QtyExpression.Problem.SYNTAX, bad("12*"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("*12"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("((3+4)"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("3+4)"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("()"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("1.2.3"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("12 24"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("abc"))
        assertEquals(QtyExpression.Problem.SYNTAX, bad("12+"))
    }

    /** Manfiy miqdor bo'lmaydi — server ham rad etardi, lekin sabab EKRANDA aytiladi. */
    @Test
    fun manfiyNatija() {
        assertEquals(QtyExpression.Problem.NEGATIVE, bad("-5"))
        assertEquals(QtyExpression.Problem.NEGATIVE, bad("10-25"))
        assertEquals(QtyExpression.Problem.NEGATIVE, bad("10*-2"))
    }

    @Test
    fun chegaralar() {
        // 41 belgi — chegaradan bitta oshdi.
        assertEquals(QtyExpression.Problem.TOO_LONG, bad("1+".repeat(20) + "1"))
        // 39 belgi — hamon ishlaydi.
        assertEquals("20", ok("1+".repeat(19) + "1"))
        assertEquals(QtyExpression.Problem.TOO_BIG, bad("999999999*2"))
        // Kasr qismi 7 xona — server regexi rad etardi.
        assertEquals(QtyExpression.Problem.TOO_PRECISE, bad("0.0000001"))
        assertEquals(QtyExpression.Problem.TOO_PRECISE, bad("0,001*0,0001"))
        // 6 xona — hamon o'tadi.
        assertEquals("0.000001", ok("0.001*0.001"))
    }

    // ---- 🔴 Server shartnomasi ----

    /**
     * Hisoblangan MATN serverning qoidasiga mos bo'lishi SHART:
     * `SetCellStockSchema.qty` / `CellPlaceSchema.qty` / `CellMoveSchema.qty` —
     * `/^\d+(\.\d{1,6})?$/`. Vergul, `1E+3`, bo'sh joy, minus — hech biri
     * o'tmaydi.
     */
    @Test
    fun serverRegexQulfi() {
        val serverQty = Regex("^\\d+(\\.\\d{1,6})?$")
        val inputs = listOf(
            "12", "12*24", "14,5", ".5", "14.", "0", "0.000", "100.0", "12.000000",
            "3*24+6", "(2+3)*4", "12.5*2.5", "2,5*15", "999999999", "0.001*0.001",
            " 250 ", "10-5", "1000*1000",
        )
        for (input in inputs) {
            val text = ok(input)
            assertTrue("«$input» → «$text» server regexidan o'tmadi", serverQty.matches(text))
        }
    }

    /** Katta sonda ham ko'rsatkichli yozuv (`1E+6`) chiqmaydi. */
    @Test
    fun korsatkichliYozuvYoq() {
        assertEquals("1000000", ok("1000*1000"))
        assertEquals("100", ok("10*10"))
    }

    // ---- Ekran qaroriga tegishli ----

    @Test
    fun natijaQatoriQachonKorinadi() {
        assertFalse(QtyExpression.isExpression("12"))
        assertFalse(QtyExpression.isExpression("14.5"))
        assertTrue(QtyExpression.isExpression("12*24"))
        assertTrue(QtyExpression.isExpression("10+5"))
        assertTrue(QtyExpression.isExpression("14,5"))
        assertTrue(QtyExpression.isExpression("(2+3)*4"))
    }
}
