package uz.sherset.manager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Yo'nalishlarim ekranining hisobi (X-reja X4).
 *
 * `Routes` — Android'siz sof funksiyalar to'plami, shuning uchun oddiy JVM
 * testi (`gradle testDebugUnitTest`). Asosiy tuzoqlar:
 *   - VALYUTALAR QO'SHILMAYDI (8-qoida) va faqat `pending` sanaladi;
 *   - o'qilmagan summa `null` bo'ladi, 0 EMAS;
 *   - koordinata `Locale.ROOT` bilan formatlanadi (ruscha lokalda vergul
 *     kasr ajratgichi koordinatani o'qib bo'lmaydigan qilardi).
 */
class RoutesTest {

    private fun row(amount: String?, currency: String?, status: String?) =
        Routes.CashRow(amount, currency, status)

    // ── Qo'limdagi pul: faqat `pending` ─────────────────────────────────────

    @Test
    fun `topshirilgan va bekor qilingan pul qo'lda hisoblanmaydi`() {
        val t = Routes.pendingByCurrency(
            listOf(
                row("100000", "UZS", "pending"),
                row("900000", "UZS", "handed"),
                row("700000", "UZS", "cancelled"),
            ),
        )
        assertEquals(1, t.size)
        assertEquals("100000", t[0].totalMinor)
        assertEquals(1, t[0].count)
    }

    @Test
    fun `bo'sh ro'yxatda jamlanma ham bo'sh`() {
        assertTrue(Routes.pendingByCurrency(emptyList()).isEmpty())
    }

    @Test
    fun `faqat topshirilgan pul bo'lsa qo'lda hech narsa qolmaydi`() {
        assertTrue(Routes.pendingByCurrency(listOf(row("5000", "UZS", "handed"))).isEmpty())
    }

    // ── 🔴 Valyutalar qo'shilmaydi ──────────────────────────────────────────

    @Test
    fun `har valyuta ALOHIDA qatorda - summalar qo'shilmaydi`() {
        val t = Routes.pendingByCurrency(
            listOf(
                row("1000000", "UZS", "pending"),
                row("5000", "USD", "pending"),
                row("2000000", "UZS", "pending"),
            ),
        )
        assertEquals(2, t.size)
        val uzs = t.first { it.currency == "UZS" }
        val usd = t.first { it.currency == "USD" }
        assertEquals("3000000", uzs.totalMinor)
        assertEquals("5000", usd.totalMinor)
    }

    @Test
    fun `tartib qat'iy - UZS birinchi, keyin alifbo`() {
        val t = Routes.pendingByCurrency(
            listOf(
                row("1", "USD", "pending"),
                row("2", "EUR", "pending"),
                row("3", "UZS", "pending"),
                row("4", "RUB", "pending"),
            ),
        )
        assertEquals(listOf("UZS", "EUR", "RUB", "USD"), t.map { it.currency })
    }

    @Test
    fun `valyuta kelmasa server sukut qiymati UZS ishlatiladi`() {
        val t = Routes.pendingByCurrency(listOf(row("1000", null, "pending")))
        assertEquals("UZS", t[0].currency)
    }

    @Test
    fun `Long chegarasidan katta summa ham to'g'ri qo'shiladi`() {
        // 2 × 9 223 372 036 854 775 807 — Long'da toshib ketardi.
        val t = Routes.pendingByCurrency(
            listOf(
                row("9223372036854775807", "UZS", "pending"),
                row("9223372036854775807", "UZS", "pending"),
            ),
        )
        assertEquals("18446744073709551614", t[0].totalMinor)
    }

    // ── 🔴 null ≠ 0 ─────────────────────────────────────────────────────────

    @Test
    fun `o'qilmagan summa jamlanmani null qiladi - 0 EMAS`() {
        val t = Routes.pendingByCurrency(
            listOf(
                row("100000", "UZS", "pending"),
                row("shalag'", "UZS", "pending"),
            ),
        )
        assertNull(t[0].totalMinor)
    }

    @Test
    fun `o'qilmagan qator ham sanaladi - jimgina tashlanmaydi`() {
        val t = Routes.pendingByCurrency(
            listOf(
                row("100000", "UZS", "pending"),
                row(null, "UZS", "pending"),
            ),
        )
        assertEquals(2, t[0].count)
        assertNull(t[0].totalMinor)
    }

    @Test
    fun `bir valyutadagi nosozlik boshqasini buzmaydi`() {
        val t = Routes.pendingByCurrency(
            listOf(
                row("yo'q", "UZS", "pending"),
                row("5000", "USD", "pending"),
            ),
        )
        assertNull(t.first { it.currency == "UZS" }.totalMinor)
        assertEquals("5000", t.first { it.currency == "USD" }.totalMinor)
    }

    @Test
    fun `birinchi qator buzuq bo'lsa keyingilari uni tiklamaydi`() {
        // Tartib teskari bo'lgan hol: «o'qilmadi» holati YOPISHQOQ bo'lishi
        // kerak, aks holda yarim yig'indi chiqardi.
        val t = Routes.pendingByCurrency(
            listOf(
                row("buzuq", "UZS", "pending"),
                row("100000", "UZS", "pending"),
            ),
        )
        assertNull(t[0].totalMinor)
        assertEquals(2, t[0].count)
    }

    // ── Smena davomiyligi ───────────────────────────────────────────────────

    @Test
    fun `smena davomiyligi UTC vaqtdan to'g'ri hisoblanadi`() {
        val started = "2026-09-04T04:00:00.000Z"
        val now = Instant.parse("2026-09-04T06:30:00.000Z")
        assertEquals(9000L, Routes.elapsedSeconds(started, now))
    }

    @Test
    fun `qurilma soati orqada bo'lsa manfiy emas, nol chiqadi`() {
        val started = "2026-09-04T06:00:00.000Z"
        val now = Instant.parse("2026-09-04T05:59:50.000Z")
        assertEquals(0L, Routes.elapsedSeconds(started, now))
    }

    @Test
    fun `buzuq boshlanish vaqti null beradi`() {
        assertNull(Routes.elapsedSeconds("shalag'", Instant.now()))
        assertNull(Routes.elapsedSeconds(null, Instant.now()))
        assertNull(Routes.elapsedSeconds("null", Instant.now()))
    }

    @Test
    fun `davomiylik yorlig'i - soat va daqiqa`() {
        assertEquals("2 soat 15 daq", Routes.durationLabel(8100))
        assertEquals("45 daq", Routes.durationLabel(2700))
        assertEquals("2 soat", Routes.durationLabel(7200))
    }

    @Test
    fun `bir daqiqadan kam vaqt 0 deb ko'rsatilmaydi`() {
        assertEquals("1 daq dan kam", Routes.durationLabel(0))
        assertEquals("1 daq dan kam", Routes.durationLabel(59))
    }

    @Test
    fun `davomiylik yo'q bo'lsa null - ekran o'zi tire qo'yadi`() {
        assertNull(Routes.durationLabel(null))
        assertNull(Routes.durationLabel(-5))
    }

    // ── Reys holati ─────────────────────────────────────────────────────────

    @Test
    fun `reys holatlari server lug'ati bilan bir xil`() {
        assertEquals("assigned", Routes.tripStatusTone("assigned"))
        assertEquals("enroute", Routes.tripStatusTone("enroute"))
        assertEquals("arrived", Routes.tripStatusTone("arrived"))
        assertEquals("done", Routes.tripStatusTone("completed"))
        assertEquals("cancelled", Routes.tripStatusTone("cancelled"))
    }

    @Test
    fun `server yangi holat qo'shsa ilova yiqilmaydi`() {
        assertEquals("unknown", Routes.tripStatusTone("qandaydir_yangi"))
        assertEquals("unknown", Routes.tripStatusTone(null))
    }

    @Test
    fun `faol reyslar - yakunlangani va bekor qilingani faol emas`() {
        assertTrue(Routes.isTripActive("assigned"))
        assertTrue(Routes.isTripActive("enroute"))
        assertTrue(Routes.isTripActive("arrived"))
        assertFalse(Routes.isTripActive("completed"))
        assertFalse(Routes.isTripActive("cancelled"))
        assertFalse(Routes.isTripActive(null))
    }

    @Test
    fun `manba hujjat turi yopiq lug'at`() {
        assertEquals("demand", Routes.orderTypeTone("demand"))
        assertEquals("retail_sale", Routes.orderTypeTone("retail_sale"))
        assertEquals("manual", Routes.orderTypeTone("manual"))
        assertEquals("unknown", Routes.orderTypeTone(null))
    }

    // ── Manzil va koordinata ────────────────────────────────────────────────

    @Test
    fun `manzil matni bo'lsa u ko'rsatiladi`() {
        assertEquals(
            "Chilonzor 12-kvartal",
            Routes.destLabel("Chilonzor 12-kvartal", 41.31, 69.28),
        )
    }

    @Test
    fun `manzil bo'sh bo'lsa koordinata ko'rsatiladi`() {
        assertEquals("41.31000, 69.28000", Routes.destLabel("   ", 41.31, 69.28))
        assertEquals("41.31000, 69.28000", Routes.destLabel(null, 41.31, 69.28))
    }

    @Test
    fun `manzil ham koordinata ham bo'lmasa null`() {
        assertNull(Routes.destLabel(null, null, null))
    }

    @Test
    fun `koordinata NUQTA bilan yoziladi - ruscha lokalda ham`() {
        // 🔴 Bu test uchun lokal ATAYLAB almashtiriladi: `%f` sukut lokal
        // bilan ishlaganda «41,31000» chiqib, koordinata o'qib bo'lmas edi.
        val prev = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ru-RU"))
            assertEquals("41.31083, 69.27972", Routes.coords(41.31083, 69.27972))
            assertEquals("1.5 km", Routes.distanceLabel(1500))
        } finally {
            Locale.setDefault(prev)
        }
    }

    @Test
    fun `buzuq koordinata null beradi`() {
        assertNull(Routes.coords(null, 69.28))
        assertNull(Routes.coords(Double.NaN, 69.28))
        assertNull(Routes.coords(41.31, Double.POSITIVE_INFINITY))
    }

    @Test
    fun `masofa metr va kilometrda`() {
        assertEquals("450 m", Routes.distanceLabel(450))
        assertEquals("999 m", Routes.distanceLabel(999))
        assertEquals("1.0 km", Routes.distanceLabel(1000))
        assertNull(Routes.distanceLabel(null))
        assertNull(Routes.distanceLabel(-1))
    }
}
