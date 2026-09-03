package uz.sherset.tsd

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Ilovani QURILMANING O'ZIDAN yangilash (egasi, 2026-09-01).
 *
 * Ilgari yangi APK har terminalga qo'lda tashilardi — bitta qurilmada ham
 * bezovta, o'nta bo'lganda esa imkonsiz. Endi ilova serverdagi manifestni
 * o'qiydi va yangi versiya chiqqanini o'zi aytadi.
 *
 * Kanal kassa `.exe` bilan BIR XIL naqshda: `/var/www/kassa-downloads/tsd/`
 * (nginx `/downloads/tsd/`), ya'ni deploy unga tegmaydi va API'ga aloqasi yo'q.
 *
 * 🔴 **Manifest API EMAS.** U oddiy statik JSON va TOKENSIZ o'qiladi: TSD
 * allowlist'i (`tsd-policy.ts`) faqat API marshrutlarini boshqaradi, bu esa
 * nginx statikasi. Shu sababdan yangilanishni tekshirish KIRISHDAN OLDIN ham
 * ishlaydi — terminal juftlanmagan bo'lsa ham.
 *
 * 🔴 **SHA-256 MAJBURIY.** Yuklab olingan fayl manifestdagi xesh bilan
 * solishtiriladi va mos kelmasa O'RNATILMAYDI. Sabab prozaik: ombor Wi-Fi'si
 * zaif, yarim yuklangan APK «buzilgan paket» xatosi bilan tugardi va omborchi
 * nima bo'lganini bilmasdi.
 */
class Updater(private val context: Context) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS) // APK ~13 MB, ombor Wi-Fi'si sekin
        .build()

    /** Serverdagi manifest — `latest.json`. */
    data class Release(
        val versionCode: Long,
        val versionName: String,
        val url: String,
        val sha256: String,
        val notes: String,
    )

    /** O'rnatilgan versiya kodi (taqqoslash SHU son bo'yicha, nom bo'yicha emas). */
    fun installedVersionCode(): Long = runCatching {
        val pi = context.packageManager.getPackageInfo(context.packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode
        else @Suppress("DEPRECATION") pi.versionCode.toLong()
    }.getOrDefault(0L)

    fun installedVersionName(): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull().orEmpty()

    /**
     * Manifestni o'qiydi. Tarmoq yo'q / manifest buzuq bo'lsa `null` —
     * yangilanish tekshiruvi ISHNI TO'XTATMASLIGI kerak.
     */
    fun check(): Release? = runCatching {
        val url = context.getString(R.string.update_manifest_url)
        val req = Request.Builder().url(url).get().build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) return null
            val o = JSONObject(r.body?.string().orEmpty())
            Release(
                versionCode = o.optLong("versionCode"),
                versionName = o.optString("versionName"),
                url = o.optString("url"),
                sha256 = o.optString("sha256").lowercase(),
                notes = o.optString("notes"),
            )
        }
    }.getOrNull()

    fun isNewer(r: Release): Boolean = r.versionCode > installedVersionCode() && r.url.isNotEmpty()

    /**
     * APK'ni yuklab oladi va xeshini tekshiradi.
     *
     * @param onProgress 0..100 (uzunlik noma'lum bo'lsa chaqirilmaydi)
     * @return tayyor fayl, yoki xato sababi bilan `Result.failure`
     */
    fun download(r: Release, onProgress: (Int) -> Unit): Result<File> = runCatching {
        val target = File(context.cacheDir, "update.apk")
        target.delete()

        val req = Request.Builder().url(r.url).get().build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) error("HTTP ${resp.code}")
            val body = resp.body ?: error("Bo'sh javob")
            val total = body.contentLength()
            body.byteStream().use { input ->
                target.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    var read: Int
                    var done = 0L
                    var lastPct = -1
                    while (input.read(buf).also { read = it } > 0) {
                        output.write(buf, 0, read)
                        done += read
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != lastPct) {
                                lastPct = pct
                                onProgress(pct)
                            }
                        }
                    }
                }
            }
        }

        val actual = sha256(target)
        if (r.sha256.isNotEmpty() && actual != r.sha256) {
            target.delete()
            error("Fayl buzilgan (SHA-256 mos emas)")
        }
        target
    }

    /**
     * O'rnatuvchini ochadi.
     *
     * 🔴 Android 8+ da ilova «noma'lum manbalardan o'rnatish» huquqisiz APK
     * ocholmaydi — bu holat JIM YIQILISH beradi (hech narsa ochilmaydi).
     * Shuning uchun huquq oldindan tekshiriladi va yo'q bo'lsa foydalanuvchi
     * AYNAN shu sozlama ekraniga olib boriladi.
     *
     * @return `true` — o'rnatuvchi ochildi; `false` — sozlama ekrani ochildi.
     */
    fun install(file: File): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            val i = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.packageName),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
            return false
        }

        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        return true
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            var read: Int
            while (input.read(buf).also { read = it } > 0) md.update(buf, 0, read)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
