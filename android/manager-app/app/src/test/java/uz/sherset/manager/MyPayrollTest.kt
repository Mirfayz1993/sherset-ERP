package uz.sherset.manager

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * OYLIGIM sof funksiyalarining testlari (X6).
 *
 * Bu ekranning eng qimmat xatosi — YOLG'ON RAQAM, shuning uchun testlar
 * to'rt nozik joyni ataylab qoplaydi:
 *  1. `null` ≠ 0 — «hisoblanmadi» hech qayerda nolga aylanmaydi;
 *  2. jarima belgisi — oylikdan AYIRILADI va belgi `Fmt` niki bilan
 *     BAYT-BA-BAYT bir xil (U+2212, defis emas);
 *  3. `BigInteger` — pul `Long` chegarasidan katta bo'lishi mumkin;
 *  4. ro'yxat ↔ saqlangan jami mosligi — mos kelmasa ekran ochiq aytadi.
 */
class MyPayrollTest {

    /**
     * 🔴 `Fmt.group` mingliklarni UZILMAYDIGAN probel (U+00A0) bilan
     * ajratadi — ODDIY probel EMAS (X5 ning 9-topilmasi: birinchi variant
     * «1 234 ≠ 1 234» degan o'qib bo'lmaydigan xato bergan edi).
     * Ko'rinmas belgilar shu faylda FAQAT shu ikki konstantada turadi.
     */
    private val nbsp = " "

    /** `Fmt` dagi manfiy belgi — U+2212 MINUS SIGN, defis (U+002D) EMAS. */
    private val minus = "−"

    private val defaultLocale: Locale = Locale.getDefault()

    @After
    fun restoreLocale() {
        Locale.setDefault(defaultLocale)
    }

    // ── Oy holati ───────────────────────────────────────────────────────────

    @Test
    fun `holat lug'ati server qiymatlari bilan bir xil`() {
        assertEquals("not_computed", MyPayroll.statusTone("not_computed"))
        assertEquals("partial", MyPayroll.statusTone("partial"))
        assertEquals("computed", MyPayroll.statusTone("computed"))
    }

    @Test
    fun `server yangi holat qo'shsa ilova yiqilmaydi`() {
        assertEquals("unknown", MyPayroll.statusTone("paid"))
        assertEquals("unknown", MyPayroll.statusTone(null))
        assertEquals("unknown", MyPayroll.statusTone(""))
    }

    @Test
    fun `raqam FAQAT computed holatida yakuniy`() {
        assertTrue(MyPayroll.isFinal("computed"))
        assertFalse(MyPayroll.isFinal("partial"))
        assertFalse(MyPayroll.isFinal("not_computed"))
    }

    @Test
    fun `noma'lum holat YAKUNIY deb qaralmaydi (fail-closed)`() {
        // Kutilmagan qiymatni «tayyor» deb ko'rsatish — yolg'on tinchlik.
        assertFalse(MyPayroll.isFinal("paid"))
        assertFalse(MyPayroll.isFinal(null))
    }

    // ── Pul: null ≠ 0 ───────────────────────────────────────────────────────

    @Test
    fun `hisoblanmagan summa null bo'lib qoladi, nolga aylanmaydi`() {
        assertNull(MyPayroll.money(null))
        assertNull(MyPayroll.money(""))
        assertNull(MyPayroll.money("   "))
        assertNull(MyPayroll.money("null"))
    }

    @Test
    fun `buzuq summa null (yolg'on raqam chizilmaydi)`() {
        assertNull(MyPayroll.money("ko'p"))
        assertNull(MyPayroll.money("12.5"))
        assertNull(MyPayroll.money("1 000"))
    }

    @Test
    fun `aniq nol — HAQIQIY javob, u yashirilmaydi`() {
        // «0 so'm komissiya» — «komissiya hisoblanmadi» EMAS. Ikkisi
        // farqlanadi: birinchisi o'lchangan natija.
        assertEquals("0 so'm", MyPayroll.money("0"))
        assertTrue(MyPayroll.isZero("0"))
    }

    @Test
    fun `null nol EMAS`() {
        assertFalse(MyPayroll.isZero(null))
        assertFalse(MyPayroll.isZero("null"))
        assertFalse(MyPayroll.isZero("buzuq"))
        assertFalse(MyPayroll.isZero("100"))
    }

    @Test
    fun `summa so'mga o'giriladi va minglik ajratgich qo'yiladi`() {
        // 500 000 000 tiyin = 5 000 000 so'm.
        assertEquals("5${nbsp}000${nbsp}000 so'm", MyPayroll.money("500000000"))
    }

    @Test
    fun `Long chegarasidan katta summa ham to'g'ri`() {
        // 9 223 372 036 854 775 807 × 2 — `Long` da sig'maydi.
        val huge = "1844674407370955161400"
        assertEquals("18${nbsp}446${nbsp}744${nbsp}073${nbsp}709${nbsp}551${nbsp}614 so'm", MyPayroll.money(huge))
    }

    @Test
    fun `manfiy oylik ham chiziladi (jarima hammasidan ko'p bo'lsa)`() {
        // `computeFinalSalaryMinor` manfiy qiymat qaytarishi MUMKIN va u
        // nolga siqilmaydi — aks holda «qarzdor oy» ko'rinmay qolardi.
        assertEquals("${minus}5${nbsp}000 so'm", MyPayroll.money("-500000"))
    }

    // ── Jarima belgisi ──────────────────────────────────────────────────────

    @Test
    fun `jarima MANFIY belgi bilan chiqadi`() {
        assertEquals("${minus}10${nbsp}000 so'm", MyPayroll.signedMoney("fine", "1000000"))
    }

    @Test
    fun `bonusda belgi yo'q`() {
        assertEquals("10${nbsp}000 so'm", MyPayroll.signedMoney("bonus", "1000000"))
    }

    @Test
    fun `noma'lum turda belgi qo'yilmaydi (o'ylab topilmaydi)`() {
        assertEquals("10${nbsp}000 so'm", MyPayroll.signedMoney("hadya", "1000000"))
        assertEquals("10${nbsp}000 so'm", MyPayroll.signedMoney(null, "1000000"))
    }

    @Test
    fun `manfiy kelgan jarima IKKI marta belgilanmaydi`() {
        // Server summani musbat saqlaydi; qaytadan manfiy kelib qolsa
        // «−−10 000» chiqmasligi kerak.
        assertEquals("${minus}10${nbsp}000 so'm", MyPayroll.signedMoney("fine", "-1000000"))
    }

    @Test
    fun `belgi Fmt niki bilan BAYT-BA-BAYT bir xil`() {
        // Ikki xil «minus» (U+2212 va oddiy defis) bitta ekranda turib
        // qolmasin: bu yerda ikkalasi ham `Fmt` orqali chiqadi.
        val fromFmt = Fmt.minor("-1000000", "UZS")
        val fromScreen = MyPayroll.signedMoney("fine", "1000000")
        assertEquals(fromFmt, fromScreen)
    }

    @Test
    fun `hisoblanmagan qiymat belgilanmaydi ham`() {
        assertNull(MyPayroll.signedMoney("fine", null))
        assertNull(MyPayroll.signedMoney("bonus", "null"))
    }

    // ── Bloklangan sotuv ogohlantirishi ─────────────────────────────────────

    @Test
    fun `bloklangan sotuv faqat noldan katta bo'lsa ogohlantiradi`() {
        assertTrue(MyPayroll.isPositive("1"))
        assertTrue(MyPayroll.isPositive("50000000"))
        assertFalse(MyPayroll.isPositive("0"))
        assertFalse(MyPayroll.isPositive("-5"))
        // O'qilmagan qiymat ogohlantirish CHIQARMAYDI (yolg'on tashvish yo'q).
        assertFalse(MyPayroll.isPositive(null))
        assertFalse(MyPayroll.isPositive("buzuq"))
    }

    // ── Yopiq lug'atlar ─────────────────────────────────────────────────────

    @Test
    fun `tur lug'ati yopiq`() {
        assertEquals("bonus", MyPayroll.kindTone("bonus"))
        assertEquals("fine", MyPayroll.kindTone("fine"))
        assertEquals("unknown", MyPayroll.kindTone("premiya"))
        assertEquals("unknown", MyPayroll.kindTone(null))
    }

    @Test
    fun `manba lug'ati serverda YOZILADIGAN hamma qiymatni biladi`() {
        // Ro'yxat yozuvchi kodning O'ZIDAN olindi (zod-enumdan emas — u
        // eskirgan, `auto_late` va `kpi_accept*` unda yo'q).
        val written = listOf(
            "manual", // hr-bonus-fine.service.createManual
            "rule", // hr-bonus-fine-rule.service
            "auto_late", // late-fine.service
            "auto_task_reward", // hr-task-send.service
            "auto_task_fine", // hr-task-send.service
            "auto_expire_fine", // hr-task-send.service (deadline_expire)
            "kpi_accept", // kpi-accrual.KPI_ACCRUAL_SOURCE
            "kpi_accept_reversal", // kpi-accrual.KPI_ACCRUAL_REVERSAL_SOURCE
        )
        for (s in written) {
            assertEquals("«$s» manbasi lug'atda yo'q", s, MyPayroll.sourceTone(s))
        }
    }

    @Test
    fun `noma'lum manba unknown — lekin xom kalit yo'qolmaydi`() {
        assertEquals("unknown", MyPayroll.sourceTone("auto_yangi"))
        assertEquals("unknown", MyPayroll.sourceTone(null))
    }

    // ── Ro'yxat ↔ saqlangan jami ────────────────────────────────────────────

    @Test
    fun `jami ro'yxatga mos kelsa true`() {
        assertEquals(true, MyPayroll.ledgerMatches("30000", "30000"))
        assertEquals(true, MyPayroll.ledgerMatches("0", "0"))
    }

    @Test
    fun `jami eskirgan bo'lsa false — ekran buni ochiq aytadi`() {
        // Oylik qatori bir marta hisoblanadi, yangi jarima keyin yozilishi
        // mumkin. Jim qolinsa xodim «jami noto'g'ri» deb o'ylardi.
        assertEquals(false, MyPayroll.ledgerMatches("30000", "45000"))
    }

    @Test
    fun `oy hisoblanmagan bo'lsa solishtiruv NULL, false EMAS`() {
        // `false` bo'lsa ekran «hisob eskirgan» deb yolg'on ogohlantirardi.
        assertNull(MyPayroll.ledgerMatches(null, "30000"))
        assertNull(MyPayroll.ledgerMatches("30000", null))
        assertNull(MyPayroll.ledgerMatches("buzuq", "30000"))
        assertNull(MyPayroll.ledgerMatches("30000", "buzuq"))
    }

    @Test
    fun `solishtiruv Long chegarasidan katta sonda ham to'g'ri`() {
        // `Long` ga siqilsa ikkalasi ham «to'lib» ketib teng chiqib qolardi.
        val a = "92233720368547758070"
        val b = "92233720368547758071"
        assertEquals(true, MyPayroll.ledgerMatches(a, a))
        assertEquals(false, MyPayroll.ledgerMatches(a, b))
    }

    // ── Vaqt: instant, YORLIQ emas ──────────────────────────────────────────

    @Test
    fun `yozuv sanasi UTC dan Toshkentga o'giriladi`() {
        // 09:00 UTC = 14:00 Toshkent (+5).
        assertEquals("15.09 · 14:00", MyPayroll.rowDateTime("2026-09-15T09:00:00.000Z"))
    }

    @Test
    fun `mintaqa siljishi kunni ham suradi`() {
        // 20:10 UTC → ertangi 01:10 Toshkent.
        assertEquals("16.09 · 01:10", MyPayroll.rowDateTime("2026-09-15T20:10:00.000Z"))
    }

    @Test
    fun `sanasi yo'q yoki buzuq yozuv null`() {
        assertNull(MyPayroll.rowDateTime(null))
        assertNull(MyPayroll.rowDateTime(""))
        assertNull(MyPayroll.rowDateTime("null"))
        assertNull(MyPayroll.rowDateTime("kecha"))
    }

    // ── Lokal ───────────────────────────────────────────────────────────────

    @Test
    fun `pul matni qurilma lokaliga bog'lanmaydi`() {
        // X4 ning 7-topilmasi: `ru-RU` da kasr ajratgich vergul bo'lib
        // qoladi. Bu yerda kasr umuman ishlatilmaydi — o'lchab tasdiqlanadi.
        Locale.setDefault(Locale.forLanguageTag("ru-RU"))
        assertEquals("5${nbsp}000${nbsp}000 so'm", MyPayroll.money("500000000"))
        assertEquals("${minus}10${nbsp}000 so'm", MyPayroll.signedMoney("fine", "1000000"))
    }

    // ── Oy hisobi QAYTA ISHLATILDI (yangi nusxa yozilmadi) ──────────────────

    @Test
    fun `oy tanlagichi Davomat dagi tayyor funksiyalardan foydalanadi`() {
        // X6 o'z oy-hisobini YOZMADI: `Davomat` (X2) dagi sof funksiyalar
        // qayta ishlatiladi. Bu qator o'sha shartnomani qulflaydi — kelajakda
        // ikkinchi nusxa paydo bo'lsa ikki ekran ikki xil oy so'rardi.
        assertEquals("2026-08", Davomat.shiftMonth("2026-09", -1))
        assertEquals("2027-01", Davomat.shiftMonth("2026-12", 1))
        assertEquals("Sentabr 2026", Davomat.monthLabel("2026-09"))
        // Kelajak oy YOPIQ — oylik u yerda hisoblangan bo'lishi mumkin emas.
        assertFalse(Davomat.canGoNext("2026-09", "2026-09"))
        assertTrue(Davomat.canGoNext("2026-08", "2026-09"))
    }
}
