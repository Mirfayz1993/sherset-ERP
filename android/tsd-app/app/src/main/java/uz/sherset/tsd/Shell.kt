package uz.sherset.tsd

import androidx.compose.runtime.Composable

/**
 * Ekranning ilovadan so'raydigan HAMMASI — G5/G6 `Ui.kt` dagi `Shell`
 * shartnomasining Compose davomi. Ekran `Activity` ni ko'rmaydi, shuning
 * uchun ekranlarni qayta tartiblash yoki qo'shish `MainActivity` ga tegmaydi.
 *
 * 0.2.0 farqi: eski `Ui` vidjet-fabrikasi yo'q (Compose o'zi chizadi) va
 * `setStatus` yo'q — yuklanish holati har ekranning o'z state'ida.
 */
interface Shell {
    val api: ApiClient
    val queue: ActionQueue
    val sender: QueueSender

    /** Kirgan xodim (topshiriqlar shu bo'yicha filtrlanadi). */
    val employeeId: String

    fun str(res: Int): String
    fun str(res: Int, vararg args: Any): String

    /**
     * BETARAF xabar (toast): «Qidirilmoqda…», navbat hisoboti, yangilanish
     * holati. Ovoz/tebranish YO'Q — bu na muvaffaqiyat, na xato.
     */
    fun toast(res: Int)
    fun toast(text: String)

    /**
     * T4 — AMAL O'TDI: toast + qisqa yuqori ton va bitta tebranish
     * ([Feedback.ok]). Sanoq saqlandi, qator tasdiqlandi, navbat bo'shadi.
     */
    fun success(res: Int)
    fun success(text: String)

    /**
     * 🔴 T4 — AMAL O'TMADI: ekran tepasida QIZIL BANNER + past ton va
     * ikkita tebranish ([Feedback.fail]).
     *
     * Toast EMAS, chunki 4" terminal ekranida u ko'zdan qochadi va omborchi
     * xatoni ko'rmasdan keyingi tovarga o'tib ketardi — bu IS-5 («jim
     * yo'qotish») klassiga yaqin. Banner bir necha soniya turadi va bosilsa
     * yopiladi.
     *
     * Skan TANILDI/TANILMADI kabi matnsiz javob uchun ekranlar
     * [Feedback.ok]/[Feedback.fail] ni to'g'ridan-to'g'ri chaqiradi —
     * `Feedback` `Diagnostics` kabi global obyekt, `Activity` ni ochmaydi.
     */
    fun error(res: Int)
    fun error(text: String)

    fun go(screen: Screen)
    fun back()

    /** Ish IO thread'da; `ApiException` va boshqa xatolar BANNER bilan aytiladi (T4). */
    fun io(work: () -> Unit)

    /** UI thread'da bajarish — Compose state FAQAT shu yerda o'zgartiriladi. */
    fun main(work: () -> Unit)

    /**
     * Amalni oflayn navbatga qo'yadi (aloqa yo'qligi aniqlanganda).
     * `label` — omborchiga ko'rinadigan tavsif.
     */
    fun enqueue(method: String, path: String, body: org.json.JSONObject, label: String)

    /** Sessiyani yopadi; qurilma juftligi QOLADI. */
    fun logout()
}

/**
 * Bitta ish ekrani. Ekran — ODDIY SINF (Compose state ichida yashaydi):
 * navigatsiya tarixi ekran NUSXASINI saqlaydi, ya'ni «orqaga» bosilganda
 * yarim to'ldirilgan oqim (masalan Joylashtirishning 2-bosqichi) yo'qolmaydi.
 */
interface Screen {
    /** Yuqori panelga chiqadigan sarlavha. */
    fun title(shell: Shell): String

    @Composable
    fun Content()

    /**
     * Skaner kodi keldi. Sukut — e'tiborsiz (har ekran skanerni kutmaydi).
     * `true` qaytarsa kod SHU ekran tomonidan yeyildi va umumiy skan-qidiruv
     * ochilmaydi.
     */
    fun onScan(code: String): Boolean = false
}
