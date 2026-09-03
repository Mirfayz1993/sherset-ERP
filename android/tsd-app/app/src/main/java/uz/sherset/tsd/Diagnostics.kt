package uz.sherset.tsd

import android.content.Intent
import android.view.KeyEvent
import androidx.compose.runtime.mutableStateListOf
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * SKANER DIAGNOSTIKASI (2026-09-02).
 *
 * 🔴 NEGA BU KERAK BO'LDI. Terminal (iData 95W Pro) skaneri OTADI — nur
 * chiqadi — lekin kod ilovaga yetib kelmaydi. Qurilma USB bilan ulanmagan,
 * ya'ni `logcat` yo'q; ilovaning ichida nima kelayotganini KO'RSATADIGAN
 * joy ham yo'q edi. Natijada tuzatish «aksiya nomini taxmin qilish» ga
 * aylanardi — bu 2026-08-24 hodisasining kichik ko'rinishi: sabab
 * o'lchanmasdan, taxmin bilan tuzatiladi.
 *
 * Endi qurilmaning O'ZI aytadi: bu jurnal skanerdan keladigan HAR QANDAY
 * signalni yozadi —
 *   · `KEY`   — klaviatura-wedge rejimi (tugma hodisalari);
 *   · `BCAST` — broadcast rejimi (aksiya + intent ichidagi HAMMA maydon);
 *   · `CLIP`  — buferga yozadigan rejim (qo'lda tekshiriladi).
 * Uchalasidan biri ham chiqmasa — skaner umuman ilovaga yubormayapti va
 * javob qurilma sozlamalarida.
 *
 * Jurnal FAQAT xotirada (50 qator), hech qayerga yuborilmaydi.
 */
object Diagnostics {

    /** Compose to'g'ridan-to'g'ri kuzatadi. */
    val events = mutableStateListOf<String>()

    private const val MAX = 50
    private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized
    fun log(line: String) {
        events.add(0, clock.format(Date()) + "  " + line)
        while (events.size > MAX) events.removeAt(events.size - 1)
    }

    @Synchronized
    fun clear() = events.clear()

    /**
     * Tugma hodisasi. Wedge skaner kodni AYNAN shu yo'l bilan «yozadi»,
     * shuning uchun bu yerda kod belgilari birma-bir ko'rinadi.
     */
    fun key(e: KeyEvent) {
        val ch = e.unicodeChar.takeIf { it != 0 }?.toChar()
        val action = if (e.action == KeyEvent.ACTION_DOWN) "DOWN" else "UP"
        log("KEY $action code=${e.keyCode}" + (if (ch != null) " char='$ch'" else "") + " src=${e.source}")
    }

    /**
     * Broadcast. Intent ichidagi HAMMA maydon yoziladi — biz kutgan kalit
     * bo'lmasa ham ko'rinsin (aynan shuni bilish kerak).
     */
    fun broadcast(intent: Intent) {
        val extras = intent.extras
        val fields = extras?.keySet()?.joinToString(", ") { k ->
            val v = extras.getString(k)
                ?: extras.getByteArray(k)?.let { String(it) }
                ?: "<?>"
            "$k=" + v.take(40)
        } ?: "<bo'sh>"
        log("BCAST ${intent.action}  {$fields}")
    }
}
