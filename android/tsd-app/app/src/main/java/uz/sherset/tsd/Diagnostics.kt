package uz.sherset.tsd

import android.content.Intent
import android.view.KeyEvent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
 *   · `CLIP`  — buferga yozadigan rejim (qo'lda tekshiriladi);
 *   · `IN`    — `ScanBar` kodni yuborganda: manba SKANER deb topildimi
 *               yoki ODAM deb, o'lchangan o'rtacha interval bilan (T2).
 * Uchalasidan biri ham chiqmasa — skaner umuman ilovaga yubormayapti va
 * javob qurilma sozlamalarida.
 *
 * Jurnal FAQAT xotirada (50 qator), hech qayerga yuborilmaydi.
 */
object Diagnostics {

    /** Compose to'g'ridan-to'g'ri kuzatadi. */
    val events = mutableStateListOf<String>()

    /**
     * Oxirgi kiritish `ScanBar` da SKANER deb topildimi yoki ODAM deb —
     * o'lchangan o'rtacha interval bilan (T2). `null` = hali kiritilmagan.
     *
     * Bu qator jonlida chegarani (`scan_human_gap_ms`) USB'siz sozlash uchun:
     * skaner «ODAM» deb tanilsa, bu yerda uning HAQIQIY o'rtacha intervali
     * ko'rinadi va chegara `config.xml` da o'sha raqamdan yuqori qo'yiladi.
     */
    var lastInput by mutableStateOf<String?>(null)
        private set

    private const val MAX = 50
    private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized
    fun log(line: String) {
        events.add(0, clock.format(Date()) + "  " + line)
        while (events.size > MAX) events.removeAt(events.size - 1)
    }

    @Synchronized
    fun clear() {
        events.clear()
        lastInput = null
    }

    /**
     * `ScanBar` kodni yuborganda chaqiriladi. 🔴 Kodning O'ZI yozilmaydi —
     * faqat manba, uzunlik va o'lchov (§2, qoida 11: maxfiy ma'lumot
     * jurnalga tushmasin; yacheyka kodi maxfiy emas, lekin bu jurnalning
     * vazifasi kodni emas, MANBANI ko'rsatish).
     */
    @Synchronized
    fun input(human: Boolean, length: Int, avgGapMs: Long) {
        val kind = if (human) "ODAM" else "SKANER"
        val gap = if (avgGapMs < 0) "—" else "$avgGapMs ms"
        lastInput = "$kind · $length belgi · o'rtacha $gap"
        log("IN $kind len=$length avg=$gap")
    }

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
