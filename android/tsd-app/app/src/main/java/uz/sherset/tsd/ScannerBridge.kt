package uz.sherset.tsd

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build

/**
 * Apparat skaner ko'prigi — BROADCAST rejimi.
 *
 * Klaviatura-wedge rejimi bu yerda EMAS: uni `ScanBar.kt` (Compose maydoni)
 * o'zi tutadi. Ikki rejim birga yashaydi va ikkalasi ham yoqilgan bo'lishi
 * zarar qilmaydi — wedge fokusga bog'liq, broadcast esa fokusdan mustaqil.
 *
 * 🔴 **NEGA BITTA EMAS, KO'P AKSIYA (2026-09-01, jonli terminalda o'lchandi).**
 * G5 da bitta `scanner_broadcast_action` sozlamasi bor edi va u «model
 * aniqlangach to'ldiriladi» degan edi. Amalda model aniqlanganda ham (iData
 * 95W Pro) aksiya nomi qurilma sozlamalarida yashiringan bo'lib chiqdi va
 * TAXMIN qilingan nom ishlamadi — natijada skan umuman kelmadi.
 *
 * Shuning uchun endi ilova bozorda tarqalgan HAMMA aksiyani birdan tinglaydi
 * (ro'yxat `config.xml` da, vergul bilan). Qaysi biri kelsa — o'sha ishlaydi;
 * kelmagani jim turadi va hech narsa buzmaydi. Terminal sozlamasida broadcast
 * yoqilgan bo'lsa yetarli, aniq nomini BILISH shart emas.
 *
 * 🔴 **Extra kaliti ham TAXMIN QILINMAYDI.** Har vendor kodni o'z kaliti bilan
 * yuboradi (`barcode_string`, `scannerdata`, `SCAN_BARCODE1`, `value`…).
 * Sanab chiqish o'rniga qabul qiluvchi intent'dagi HAR QANDAY matnli extra'ni
 * ko'rib chiqadi va birinchi mos kelganini oladi (`pickCode`) — ya'ni yangi
 * terminal kelganda ham kod o'zgarmaydi.
 */
class ScannerBridge(
    private val activity: Activity,
    private val onCode: (String) -> Unit,
) {

    private var receiver: BroadcastReceiver? = null

    /** Broadcast rejimini yoqadi (ro'yxatdagi hamma aksiya bo'yicha). */
    fun start() {
        val actions = activity.getString(R.string.scanner_broadcast_actions)
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (actions.isEmpty()) return

        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val i = intent ?: return
                // Diagnostikaga XOM holida yoziladi: kod topilmagan bo'lsa ham
                // qaysi aksiya keldi va ichida nima bor — aynan shu kerak.
                Diagnostics.broadcast(i)
                val code = pickCode(i) ?: return
                onCode(code)
            }
        }
        receiver = r
        val filter = IntentFilter()
        for (a in actions) filter.addAction(a)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ eksport bayrog'ini MAJBURIY talab qiladi; skaner
            // servisi boshqa ilova ⇒ EXPORTED.
            activity.registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            activity.registerReceiver(r, filter)
        }
    }

    fun stop() {
        receiver?.let { runCatching { activity.unregisterReceiver(it) } }
        receiver = null
    }

    private companion object {

        /**
         * Kod BO'LMAGAN extra kalitlari. Vendorlar intent'ga kod bilan birga
         * simbologiya nomi, uzunlik, vaqt va shunga o'xshash maydonlarni ham
         * qo'shadi — ular tasodifan «kod» bo'lib olinmasin.
         */
        val NOT_CODE = listOf("type", "symb", "codeid", "length", "len", "time", "aim", "format")

        /**
         * Intent'dagi matnli extra'lardan kodni tanlaydi.
         *
         * Tartib: avval keng tarqalgan kalitlar (tez yo'l), keyin qolgan hamma
         * extra ko'rib chiqiladi. `ByteArray` ham qabul qilinadi — ba'zi
         * terminallar kodni xom baytlarda yuboradi.
         */
        fun pickCode(intent: Intent): String? {
            val known = listOf(
                "barcode_string", "barcode", "scannerdata", "scanner_data",
                "SCAN_BARCODE1", "value", "data", "barocode",
                "com.symbol.datawedge.data_string",
            )
            for (k in known) {
                val v = intent.getStringExtra(k)?.trim()
                if (!v.isNullOrEmpty()) return v
            }
            val extras = intent.extras ?: return null
            for (key in extras.keySet()) {
                if (NOT_CODE.any { key.lowercase().contains(it) }) continue
                // `Bundle.get()` API 33 dan boshlab deprecated ⇒ turini
                // ATAYLAB nomma-nom so'raymiz (mos kelmasa `null` qaytadi).
                val s = extras.getString(key)?.trim()
                    ?: extras.getByteArray(key)?.let { String(it).trim() }
                if (s != null && s.length >= 3) return s
            }
            return null
        }
    }
}
