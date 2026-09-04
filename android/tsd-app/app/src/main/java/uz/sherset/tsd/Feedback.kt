package uz.sherset.tsd

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * T4 (2026-09-04) — SKAN JAVOBI: OVOZ VA TEBRANISH.
 *
 * 🔴 NEGA KERAK. Omborchi javon oldida turadi, qo'lida terminal va tovar —
 * ekranga qaramaydi. T4 gacha amal o'tgan-o'tmagani FAQAT toast bilan
 * aytilardi (`grep`: `Vibrator`, `ToneGenerator`, `SoundPool` — hech biri
 * yo'q edi), ya'ni omborchi «saqlandi» ni ham, «Topilmadi» ni ham ko'rmay
 * qolib, keyingi tovarga o'tib ketardi. Bu IS-5 (jim yo'qotish) klassiga
 * yaqin: xato SODIR bo'ldi, lekin uni HECH KIM eshitmadi.
 *
 * Ikki signal, ATAYLAB bir-biriga o'xshamaydigan:
 *  · [ok]   — qisqa YUQORI ton (`TONE_PROP_BEEP`, 1400+2060 Gs) + bitta
 *             qisqa tebranish;
 *  · [fail] — uzunroq PAST ton (`TONE_SUP_CONGESTION`, 425 Gs, 200 ms
 *             yoqilgan / 200 ms o'chgan ⇒ 600 ms da IKKI past signal) +
 *             ikkita tebranish.
 * Balandlik va past-yuqorilik farqi ombor shovqinida ikkalasini ajratadi;
 * tebranish esa naushniksiz, shovqinli joyda ham yetib boradi.
 *
 * **Oqim `STREAM_NOTIFICATION`, media EMAS.** Media oqimi radio/qo'ng'iroq
 * balandligidan mustaqil va terminalda odatda past turadi; bildirishnoma
 * oqimi esa qurilma sozlamasidagi «ovoz» tugmasiga bo'ysunadi, ya'ni
 * omborchi kerak bo'lsa uni O'ZI balandlatadi.
 *
 * Ovozni butunlay o'chirish kerak bo'lsa — `config.xml` dagi
 * `feedback_sound` bayrog'i (kod o'zgarmaydi). Tebranish uchun alohida
 * bayroq YO'Q: u ovozsiz va bu ilovaning yagona shovqinsiz kanali.
 *
 * Bu obyekt `Diagnostics` naqshida — global va `Activity` ga bog'liq emas,
 * shuning uchun uni ekranlar ham, `MainActivity` ham to'g'ridan-to'g'ri
 * chaqira oladi (`Shell` shartnomasi o'smaydi). IO thread'dan chaqirish
 * XAVFSIZ: metodlar `@Synchronized` va UI ga tegmaydi.
 */
object Feedback {

    /** Bildirishnoma oqimining o'zidagi maksimal balandlik (oqim darajasi emas). */
    private const val VOLUME = ToneGenerator.MAX_VOLUME

    private const val OK_TONE_MS = 120
    private const val FAIL_TONE_MS = 600

    private const val OK_VIBRATE_MS = 60L

    /** `[kutish, tebranish, kutish, tebranish]` — ikkita qisqa turtki. */
    private val FAIL_PATTERN = longArrayOf(0L, 120L, 110L, 120L)

    private var vibrator: Vibrator? = null
    private var tone: ToneGenerator? = null
    private var soundEnabled = true

    /**
     * `MainActivity.onCreate` da bir marta. `applicationContext` olinadi —
     * bu obyekt `Activity` dan uzoq yashaydi va uni ushlab qolishi mumkin
     * emas.
     */
    @Synchronized
    fun init(context: Context) {
        val app = context.applicationContext
        soundEnabled = app.resources.getBoolean(R.bool.feedback_sound)
        // `Context.VIBRATOR_SERVICE` API 31 dan boshlab eskirgan (build
        // ogohlantirishsiz bo'lishi kerak — §2, qoida 4), shuning uchun
        // ikkala shox ham TURDAN oladi.
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            app.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            app.getSystemService(Vibrator::class.java)
        }
    }

    /** Amal o'tdi: skan tanildi, qator tasdiqlandi, sanoq saqlandi. */
    @Synchronized
    fun ok() {
        play(ToneGenerator.TONE_PROP_BEEP, OK_TONE_MS)
        buzz(VibrationEffect.createOneShot(OK_VIBRATE_MS, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    /** Amal o'tmadi: topilmadi, 4xx, «avval yacheykani skanerlang». */
    @Synchronized
    fun fail() {
        play(ToneGenerator.TONE_SUP_CONGESTION, FAIL_TONE_MS)
        // `-1` — takrorlanmaydi (bir marta chalinadi va to'xtaydi).
        buzz(VibrationEffect.createWaveform(FAIL_PATTERN, -1))
    }

    /**
     * `ToneGenerator` audio resursini ushlab turadi — ilova yopilganda
     * qaytariladi. Keyingi chaqiruv uni o'zi qayta yaratadi.
     */
    @Synchronized
    fun release() {
        runCatching { tone?.release() }
        tone = null
    }

    private fun play(toneType: Int, durationMs: Int) {
        if (!soundEnabled) return
        val first = tone ?: newTone()
        tone = first
        if (first == null) return
        // Oldingi signal hali chalinayotgan bo'lsa (tez-tez skanerlash)
        // yangisi eshitilmay qolardi.
        first.stopTone()
        if (first.startTone(toneType, durationMs)) return
        // `false` = audio resursi yo'qolgan (ba'zi terminallarda uzoq
        // turgandan keyin shunday bo'ladi). BIR marta qayta yaratib ko'ramiz;
        // yana bo'lmasa jim qolamiz — tebranish baribir ishlaydi.
        runCatching { first.release() }
        val second = newTone()
        tone = second
        second?.startTone(toneType, durationMs)
    }

    /**
     * Konstruktor ba'zi qurilmalarda `RuntimeException` tashlaydi (audio
     * resursi band). Ovoz — QULAYLIK, ya'ni u yo'q bo'lgani uchun ilova
     * yiqilmasligi kerak.
     */
    private fun newTone(): ToneGenerator? =
        runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, VOLUME) }.getOrNull()

    private fun buzz(effect: VibrationEffect) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        runCatching { v.vibrate(effect) }
    }
}
