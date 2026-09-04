package uz.sherset.manager

import androidx.compose.runtime.Composable

/**
 * Ekranning ilovadan so'raydigan HAMMASI — tsd-app `Shell.kt` shartnomasi,
 * menejer-ilova uchun qisqartirilgan (skaner/oflayn-navbat yo'q: v0.1
 * asosan O'QISH ilovasi).
 */
interface Shell {
    val api: ApiClient

    /** Kirgan xodim nomi — bosh ekranda ko'rinadi. */
    val userName: String

    /**
     * Kirgan xodimning HR rollari (`user.hrRoles`) — login/refresh javobidan.
     * Bosh ekran bo'limlari shu bo'yicha chiziladi (`HrAccess`).
     */
    val hrRoles: List<String>

    /** Kirgan xodimning HR sahifa ruxsatlari (`user.hrPermissions`). */
    val hrPermissions: List<HrPermission>

    fun str(res: Int): String
    fun str(res: Int, vararg args: Any): String
    fun toast(res: Int)
    fun toast(text: String)

    fun go(screen: Screen)
    fun back()

    /**
     * Ish IO thread'da. `ApiException(401)` — sessiya tugagan: qobiq o'zi
     * login ekraniga qaytaradi; boshqa xatolar toast bilan aytiladi.
     */
    fun io(work: () -> Unit)

    /** UI thread'da bajarish — Compose state FAQAT shu yerda o'zgartiriladi. */
    fun main(work: () -> Unit)

    /** Sessiyani yopadi (lokal sirlar o'chadi, server zanjiri bekor qilinadi). */
    fun logout()

    /**
     * Bir martalik GPS o'lchovi — «Keldim»/«Ketyapman» uchun (X2).
     *
     * Ruxsat FAQAT shu chaqiruvda so'raladi (ilova ochilishida EMAS): ilova
     * qolgan hamma joyda o'qish-ilova bo'lib qolaveradi, lokatsiya esa xodim
     * tugmani o'zi bosgandagina kerak.
     *
     * Natija HAR DOIM UI thread'da va BIR MARTA keladi. `null` — o'lchov
     * bo'lmadi; sababi (ruxsat berilmadi / GPS o'chiq / vaqt tugadi) qobiq
     * tomonidan toast bilan aytiladi, ekran esa shunchaki tugmani qayta ochadi.
     */
    fun locate(onFix: (Locator.Fix?) -> Unit)
}

/**
 * Bitta ish ekrani. Ekran — ODDIY SINF (Compose state ichida yashaydi):
 * navigatsiya tarixi ekran NUSXASINI saqlaydi, «orqaga» bosilganda holat
 * yo'qolmaydi.
 */
interface Screen {
    /** Yuqori panelga chiqadigan sarlavha. */
    fun title(shell: Shell): String

    @Composable
    fun Content()
}
