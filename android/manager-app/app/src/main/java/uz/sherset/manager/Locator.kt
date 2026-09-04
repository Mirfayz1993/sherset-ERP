package uz.sherset.manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * BIR MARTALIK GPS O'LCHOVI — «Keldim»/«Ketyapman» tugmalari uchun (X2).
 *
 * Nega kerak: server `POST /hr/attendance/my/check-in` ni GEOFENCE bilan
 * tekshiradi (`ping-ingest.service.ts` — `isInsideGeofence`, aniqlik chegarasi
 * 100 m). Koordinatasiz check-in YO'Q. v0.1 da ilova ATAYLAB lokatsiyasiz
 * («o'qish-ilova») edi — X2 shu qoidaga ONGLI istisno kiritadi va ruxsat
 * FAQAT shu ikki tugma bosilganda so'raladi.
 *
 * 🔴 Play Services ATAYLAB YO'Q: `FusedLocationProviderClient` (driver-app
 * yo'li) yangi bog'liqlik va Google servislari bo'lgan qurilma talab qiladi.
 * Bu yerda `LocationManagerCompat.getCurrentLocation` — androidx.core ichida,
 * yangi bog'liqliksiz, GMS'siz planshetda ham ishlaydi.
 *
 * Provayder tartibi ATAYLAB: avval GPS (aniqligi 100 m chegarasidan o'tadi),
 * u bermasa tarmoq (bino ichida tezroq), u ham bermasa YAQINDAGI oxirgi
 * ma'lum joy. Eskirgan joy OLINMAYDI — uy'dagi eski nuqta bilan ishda
 * «keldim» bosilmasin.
 */
class Locator(private val activity: ComponentActivity) {

    /** Serverga yuboriladigan o'lchov (`PingSchema`: lat/lng/accuracy). */
    data class Fix(val lat: Double, val lng: Double, val accuracy: Double)

    /** Nega o'lchov bo'lmadi — ekran shunga qarab tushunarli xabar beradi. */
    enum class Failure { DENIED, NO_PROVIDER, TIMEOUT }

    private val perms = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )

    private var pending: ((Boolean) -> Unit)? = null

    /**
     * ⚠️ `onCreate` da, `STARTED` holatidan OLDIN chaqirilishi SHART
     * (`ActivityResultRegistry` talabi) — aks holda ilova ishga tushishda
     * yiqiladi.
     */
    private val launcher = activity.registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val ok = granted.values.any { it }
        pending?.also { pending = null }?.invoke(ok)
    }

    private val handler = Handler(Looper.getMainLooper())

    private fun granted(): Boolean = perms.any {
        ContextCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Ruxsatni (kerak bo'lsa) so'raydi va bitta o'lchov oladi.
     * Natija HAR DOIM UI thread'da, HAR DOIM BIR MARTA qaytadi.
     */
    fun locate(onResult: (Fix?, Failure?) -> Unit) {
        if (granted()) {
            fix(onResult)
            return
        }
        pending = { ok -> if (ok) fix(onResult) else onResult(null, Failure.DENIED) }
        launcher.launch(perms)
    }

    private fun lm(): LocationManager? =
        activity.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    private fun fix(onResult: (Fix?, Failure?) -> Unit) {
        val manager = lm() ?: return onResult(null, Failure.NO_PROVIDER)
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        if (providers.isEmpty()) return onResult(null, Failure.NO_PROVIDER)

        tryProvider(manager, providers, 0) { loc ->
            val best = loc ?: lastKnownFresh(manager)
            if (best == null) onResult(null, Failure.TIMEOUT)
            else onResult(Fix(best.latitude, best.longitude, best.accuracy.toDouble()), null)
        }
    }

    /** Provayderlarni navbat bilan sinaydi; birortasi joy bersa to'xtaydi. */
    private fun tryProvider(
        manager: LocationManager,
        providers: List<String>,
        index: Int,
        done: (Location?) -> Unit,
    ) {
        if (index >= providers.size) return done(null)
        currentLocation(manager, providers[index], TIMEOUT_MS) { loc ->
            if (loc != null) done(loc) else tryProvider(manager, providers, index + 1, done)
        }
    }

    /**
     * Bitta provayderdan yangi o'lchov. Platformaning O'Z bekor qilinishi
     * `Consumer` ni chaqirmasligi mumkin, shuning uchun o'z taymerimiz bor va
     * ikki marta chaqirilishdan `AtomicBoolean` qo'riqlaydi.
     */
    private fun currentLocation(
        manager: LocationManager,
        provider: String,
        timeoutMs: Long,
        done: (Location?) -> Unit,
    ) {
        val fired = AtomicBoolean(false)
        // `android.os.CancellationSignal` (API 16+) — androidx variantining
        // o'zi ham, uni oladigan `getCurrentLocation` ortiqchasi ham eskirgan.
        val signal = android.os.CancellationSignal()
        val finish = { loc: Location? ->
            if (fired.compareAndSet(false, true)) done(loc)
        }
        val timeout = Runnable {
            runCatching { signal.cancel() }
            finish(null)
        }
        handler.postDelayed(timeout, timeoutMs)
        try {
            LocationManagerCompat.getCurrentLocation(
                manager,
                provider,
                signal,
                ContextCompat.getMainExecutor(activity),
            ) { loc ->
                handler.removeCallbacks(timeout)
                finish(loc)
            }
        } catch (e: SecurityException) {
            handler.removeCallbacks(timeout)
            finish(null)
        }
    }

    /**
     * Oxirgi ma'lum joy — FAQAT yangi bo'lsa. Eskisi bilan check-in qilish
     * geofence'ni aldash yo'liga aylanardi.
     */
    private fun lastKnownFresh(manager: LocationManager): Location? {
        val now = System.currentTimeMillis()
        return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { p ->
                runCatching { manager.getLastKnownLocation(p) }.getOrNull()
            }
            .filter { now - it.time <= MAX_AGE_MS }
            .maxByOrNull { it.time }
    }

    private companion object {
        /** Har provayderga shuncha kutamiz — bino ichida GPS sekin. */
        const val TIMEOUT_MS = 15_000L

        /** Oxirgi ma'lum joyning eng katta yoshi. */
        const val MAX_AGE_MS = 2 * 60 * 1000L
    }
}
