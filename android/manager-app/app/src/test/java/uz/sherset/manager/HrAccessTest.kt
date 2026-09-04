package uz.sherset.manager

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Bosh ekran bo'limlarining ko'rinish qoidasi (X-reja X1 qabul mezoni).
 *
 * `HrAccess` ATAYLAB Android'siz sof funksiya — shuning uchun oddiy JVM
 * testi bilan sinaladi (`gradle testDebugUnitTest`, emulyator kerak emas).
 * Tekshiriladigan ikki stsenariy:
 *   - MENEJER: «Boshqaruv» ko'rinadi;
 *   - ODDIY XODIM: «Boshqaruv» KO'RINMAYDI (faqat «Mening kunim» qoladi).
 */
class HrAccessTest {

    private fun perm(page: String, level: String, section: String? = null) =
        HrPermission(pageKey = page, section = section, accessLevel = level)

    // ── «Boshqaruv» bo'limi: ROL bo'yicha ───────────────────────────────────

    @Test
    fun `menejer roli boshqaruvni ochadi`() {
        assertTrue(HrAccess.canSeeManagement(listOf("manager"), emptyList()))
    }

    @Test
    fun `admin roli boshqaruvni ochadi`() {
        assertTrue(HrAccess.canSeeManagement(listOf("admin"), emptyList()))
    }

    @Test
    fun `oddiy xodim boshqaruvni KO'RMAYDI`() {
        assertFalse(HrAccess.canSeeManagement(listOf("staff", "cashier"), emptyList()))
    }

    @Test
    fun `rolsiz va ruxsatsiz xodim boshqaruvni KO'RMAYDI`() {
        assertFalse(HrAccess.canSeeManagement(emptyList(), emptyList()))
    }

    @Test
    fun `haydovchi boshqaruvni KO'RMAYDI`() {
        assertFalse(HrAccess.canSeeManagement(listOf("driver"), emptyList()))
    }

    // ── «Boshqaruv» bo'limi: RUXSAT bo'yicha ────────────────────────────────

    @Test
    fun `employees read ruxsati boshqaruvni ochadi`() {
        val perms = listOf(perm("employees", HrAccess.READ))
        assertTrue(HrAccess.canSeeManagement(listOf("staff"), perms))
    }

    @Test
    fun `employees full ruxsati ham ochadi`() {
        // `ops-menejer-rol.ts` menejerga AYNAN `employees:full` beradi.
        val perms = listOf(perm("employees", HrAccess.FULL))
        assertTrue(HrAccess.canSeeManagement(emptyList(), perms))
    }

    @Test
    fun `employees own_only ruxsati YETMAYDI`() {
        // Server ham shunday qaraydi: own_only rank=1 < read rank=2.
        val perms = listOf(perm("employees", HrAccess.OWN_ONLY))
        assertFalse(HrAccess.canSeeManagement(listOf("staff"), perms))
    }

    @Test
    fun `boshqa sahifa full bo'lsa ham boshqaruv ochilmaydi`() {
        val perms = listOf(perm("oylik", HrAccess.FULL), perm("tasks", HrAccess.FULL))
        assertFalse(HrAccess.canSeeManagement(listOf("staff"), perms))
    }

    @Test
    fun `bo'lim-darajali employees qatori ham hisobga olinadi`() {
        val perms = listOf(perm("employees", HrAccess.READ, section = "davomat"))
        assertTrue(HrAccess.canSeeManagement(emptyList(), perms))
    }

    @Test
    fun `eng yuqori daraja tanlanadi - past qator to'sib qo'ymaydi`() {
        val perms = listOf(
            perm("employees", HrAccess.OWN_ONLY),
            perm("employees", HrAccess.FULL, section = "kpi"),
        )
        assertTrue(HrAccess.canSeeManagement(emptyList(), perms))
    }

    // ── Haydovchi plitkasi ──────────────────────────────────────────────────

    @Test
    fun `haydovchi plitkasi faqat driver rolida`() {
        assertTrue(HrAccess.isDriver(listOf("driver")))
        assertTrue(HrAccess.isDriver(listOf("staff", "haydovchi")))
        assertFalse(HrAccess.isDriver(listOf("manager", "staff")))
        assertFalse(HrAccess.isDriver(emptyList()))
    }

    // ── Chidamlilik: registr, bo'sh joy, nomalum qiymatlar ──────────────────

    @Test
    fun `registr va bo'sh joy solishtirishga xalaqit bermaydi`() {
        assertTrue(HrAccess.canSeeManagement(listOf(" Manager "), emptyList()))
        assertTrue(HrAccess.canSeeManagement(emptyList(), listOf(perm("Employees", "FULL"))))
        assertTrue(HrAccess.isDriver(listOf("DRIVER")))
    }

    @Test
    fun `nomalum daraja huquq bermaydi`() {
        assertEquals(0, HrAccess.rank("superuser"))
        assertEquals(0, HrAccess.rank(""))
        assertEquals(0, HrAccess.rank(null))
        assertFalse(HrAccess.canSeeManagement(emptyList(), listOf(perm("employees", "superuser"))))
    }

    @Test
    fun `darajalar tartibi server bilan bir xil`() {
        assertTrue(HrAccess.rank(HrAccess.OWN_ONLY) < HrAccess.rank(HrAccess.READ))
        assertTrue(HrAccess.rank(HrAccess.READ) < HrAccess.rank(HrAccess.FULL))
    }

    @Test
    fun `nomalum minLevel bilan hasPage har doim false`() {
        val perms = listOf(perm("employees", HrAccess.FULL))
        assertFalse(HrAccess.hasPage(perms, "employees", "nomalum"))
    }
}
