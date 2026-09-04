package uz.sherset.tsd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T7 — [CountUndo] qulflari.
 *
 * Nega aynan bu yer testlanadi: qaytarish serverga MUTLAQ son yuboradi
 * (`mode: 'set'`), ya'ni bu yerdagi xato qoldiqni jimgina noto'g'ri qilib
 * qo'yardi — reja §1.3 dagi «361 885 soxta son» kasalligining aynan o'zi.
 *
 * 🔴 Eng muhim ikki qulf: [nishonServerRegexigaMos] (yuboriladigan son
 * serverning `^\d+(\.\d{1,6})?$` qoidasidan o'tadi) va
 * [ozgarmaganSaqlashChiziqBermaydi] (sanoq maydonining sukut qiymati tizim
 * qoldig'ining O'ZI, ya'ni bu holat kamdan-kam emas).
 */
class CountUndoTest {

    private val serverQty = Regex("^\\d+(\\.\\d{1,6})?$")

    private fun show(raw: String?, after: String): CountUndo.Point.Show {
        val p = CountUndo.point(raw, after)
        assertTrue("«$raw → $after» uchun Show kutilgandi, keldi: $p", p is CountUndo.Point.Show)
        return p as CountUndo.Point.Show
    }

    /** Odatiy xato: `14` o'rniga `41` terildi. */
    @Test
    fun oddiyQaytarish() {
        val p = show("14", "41")
        assertEquals("14", p.before)
        assertEquals("14", p.target)
    }

    /**
     * Yacheykada YO'Q tovar sanaldi (server KIRIM yozadi) — qaytarish 0,
     * `before` esa `null` bo'lib qoladi: ekrandagi matn shunga qarab
     * «avval bu yacheykada YO'Q edi» deydi (reja bandi 3).
     */
    @Test
    fun yacheykadaYoqTovarNishoniNol() {
        val p = show(null, "41")
        assertNull(p.before)
        assertEquals("0", p.target)
    }

    /** Qoldig'i 0 qator (biriktirilgan tovar) — nishon ham 0, lekin `before` bor. */
    @Test
    fun qoldigiNolQator() {
        val p = show("0", "41")
        assertEquals("0", p.before)
        assertEquals("0", p.target)
    }

    /**
     * 🔴 O'zgarmagan saqlash chiziq BERMAYDI. Serverda delta 0 va hujjat ham
     * yozilmaydi — qaytariladigan narsa yo'q.
     */
    @Test
    fun ozgarmaganSaqlashChiziqBermaydi() {
        assertEquals(CountUndo.Point.Unchanged, CountUndo.point("14", "14"))
        // Server `Decimal(20,6)` sukutini qaytarsa ham AYNI son deb ko'riladi.
        assertEquals(CountUndo.Point.Unchanged, CountUndo.point("14.000000", "14"))
        assertEquals(CountUndo.Point.Unchanged, CountUndo.point("0", "0"))
        // Yacheykada yo'q tovar 0 deb saqlandi — holat o'zgarmadi.
        assertEquals(CountUndo.Point.Unchanged, CountUndo.point(null, "0"))
    }

    /** Ortiqcha nollar kesiladi: `12.000000` qaytarilganda `12` yuboriladi. */
    @Test
    fun eskiQiymatNormallashadi() {
        assertEquals("12", show("12.000000", "41").target)
        assertEquals("14.5", show("14.500000", "3").target)
    }

    /**
     * Eski qoldiqni miqdor sifatida qayta yuborib bo'lmasa — qaytarish
     * UMUMAN taklif qilinmaydi (noto'g'ri son yuborgandan ko'ra xavfsiz).
     */
    @Test
    fun oqilmaydiganEskiQoldiq() {
        assertEquals(CountUndo.Point.Unreadable, CountUndo.point("", "41"))
        assertEquals(CountUndo.Point.Unreadable, CountUndo.point("-5", "41"))
        assertEquals(CountUndo.Point.Unreadable, CountUndo.point("1E+2", "41"))
        assertEquals(CountUndo.Point.Unreadable, CountUndo.point("null", "41"))
    }

    /**
     * Eski qoldiq [QtyExpression] dan o'tgani uchun `*` bo'lsa u HISOBLANADI.
     * Server qoldig'i hech qachon bunday bo'lmaydi — bu xulq shu yerda
     * yozib qo'yilyapti, chunki u qulf emas, oqibat: nishon baribir sof son
     * bo'lib qoladi va serverga faqat shu ketadi.
     */
    @Test
    fun ifodaKorinishidagiQoldiqHisoblanadi() {
        assertEquals("288", show("12*24", "41").target)
    }

    /**
     * 🔴 Nishon HAR DOIM serverning `qty` qoidasiga mos: aks holda qaytarish
     * 400 bilan yiqilib, omborchi noto'g'ri sonni tuzata olmasdi.
     */
    @Test
    fun nishonServerRegexigaMos() {
        val cases = listOf(
            null to "41",
            "0" to "41",
            "14" to "41",
            "14.000000" to "41",
            "0.5" to "2",
            "1000000" to "1",
            "7,5" to "7",
        )
        for ((raw, after) in cases) {
            val t = show(raw, after).target
            assertTrue("«$raw» nishoni server regexidan o'tmadi: $t", serverQty.matches(t))
        }
    }
}
