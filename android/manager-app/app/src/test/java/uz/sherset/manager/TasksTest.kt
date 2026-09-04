package uz.sherset.manager

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * «Ishlarim» kartasining sof mantig'i (X3) — `HrAccessTest`/`DavomatTest` naqshi:
 * Android'siz JVM testi.
 */
class TasksTest {

    // ── Vaqt: server UTC beradi, ekran Toshkentni ko'rsatadi ────────────────

    @Test
    fun `UTC vaqt Toshkentga o'giriladi`() {
        // 09:30 UTC = 14:30 Toshkent (UTC+5).
        assertEquals("04.09 · 14:30", Tasks.dateTime("2026-09-04T09:30:00.000Z"))
    }

    @Test
    fun `mintaqa siljishi kunni ham suradi`() {
        // 20:10 UTC 4-sentabr = 01:10 Toshkent, 5-sentabr.
        assertEquals("05.09 · 01:10", Tasks.dateTime("2026-09-04T20:10:00.000Z"))
    }

    @Test
    fun `kun va oy ikki xonali - bir xonali sana ham to'g'ri`() {
        assertEquals("01.02 · 08:05", Tasks.dateTime("2026-02-01T03:05:00.000Z"))
    }

    @Test
    fun `bo'sh yoki buzuq vaqt null beradi - ekran o'zi matn tanlaydi`() {
        assertNull(Tasks.dateTime(null))
        assertNull(Tasks.dateTime(""))
        assertNull(Tasks.dateTime("null"))
        assertNull(Tasks.dateTime("kecha"))
    }

    // ── Muddat ─────────────────────────────────────────────────────────────

    @Test
    fun `muddatgacha qolgan soat`() {
        val now = Instant.parse("2026-09-04T09:00:00Z")
        assertEquals(2L, Tasks.hoursLeft("2026-09-04T11:30:00.000Z", now))
    }

    @Test
    fun `muddat yo'q yoki o'tgan bo'lsa null - 0 EMAS`() {
        val now = Instant.parse("2026-09-04T09:00:00Z")
        assertNull(Tasks.hoursLeft(null, now))
        assertNull(Tasks.hoursLeft("2026-09-04T08:00:00.000Z", now))
        assertNull(Tasks.hoursLeft("buzuq", now))
    }

    // ── Holat lug'ati (server bilan bir xil) ───────────────────────────────

    @Test
    fun `javob kutayotgan vazifa - new`() {
        assertEquals("new", Tasks.statusTone("sent"))
    }

    @Test
    fun `tekshiruvchida turgan vazifa - pending`() {
        assertEquals("pending", Tasks.statusTone("pending_review"))
    }

    @Test
    fun `ijobiy yakunlar - ok`() {
        assertEquals("ok", Tasks.statusTone("answered_yes"))
        assertEquals("ok", Tasks.statusTone("answered_text"))
        assertEquals("ok", Tasks.statusTone("approved"))
    }

    @Test
    fun `salbiy yakunlar - bad`() {
        assertEquals("bad", Tasks.statusTone("answered_no"))
        assertEquals("bad", Tasks.statusTone("rejected"))
    }

    @Test
    fun `yuborilmagan vazifa alohida - xodimning aybi emas`() {
        assertEquals("failed", Tasks.statusTone("failed"))
    }

    @Test
    fun `server yangi holat qo'shsa ilova yiqilmaydi`() {
        assertEquals("unknown", Tasks.statusTone("kelajakdagi_holat"))
        assertEquals("unknown", Tasks.statusTone(null))
        assertEquals("unknown", Tasks.statusTone(""))
    }

    // ── Javob tugmalari ────────────────────────────────────────────────────

    @Test
    fun `matnli javob turi ajratiladi`() {
        assertTrue(Tasks.isTextAnswer("text"))
        assertFalse(Tasks.isTextAnswer("yes_no"))
        assertFalse(Tasks.isTextAnswer("none"))
        assertFalse(Tasks.isTextAnswer(null))
    }

    @Test
    fun `javob tugmasi faqat sent holatda chiziladi`() {
        assertTrue(Tasks.needsAnswer("sent", "yes_no"))
        assertTrue(Tasks.needsAnswer("sent", "text"))
        assertFalse(Tasks.needsAnswer("pending_review", "yes_no"))
        assertFalse(Tasks.needsAnswer("approved", "text"))
        assertFalse(Tasks.needsAnswer("failed", "yes_no"))
    }

    @Test
    fun `responseType none - vazifa faqat xabar, tugma yo'q`() {
        assertFalse(Tasks.needsAnswer("sent", "none"))
        assertFalse(Tasks.needsAnswer("sent", null))
        // `org.json.optString` yo'q maydonda "null" MATNINI berishi mumkin.
        assertFalse(Tasks.needsAnswer("sent", "null"))
    }

    @Test
    fun `bo'sh matnli javob yuborilmaydi - server ham 400 beradi`() {
        assertFalse(Tasks.isAnswerTextValid(null))
        assertFalse(Tasks.isAnswerTextValid(""))
        assertFalse(Tasks.isAnswerTextValid("   "))
        assertFalse(Tasks.isAnswerTextValid("\n\t "))
        assertTrue(Tasks.isAnswerTextValid("bajarildi"))
    }

    // ── Ustuvorlik ─────────────────────────────────────────────────────────

    @Test
    fun `shoshilinch va yuqori ustuvorlik belgilanadi`() {
        assertTrue(Tasks.isUrgent("urgent"))
        assertTrue(Tasks.isUrgent("high"))
        assertFalse(Tasks.isUrgent("medium"))
        assertFalse(Tasks.isUrgent("low"))
        assertFalse(Tasks.isUrgent(null))
    }
}
