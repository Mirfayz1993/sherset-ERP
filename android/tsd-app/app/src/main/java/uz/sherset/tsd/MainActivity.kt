package uz.sherset.tsd

import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.Executors

/**
 * TSD ilovasi: juftlash → PIN → ISH EKRANLARI.
 *
 * 0.2.0 — UI Jetpack Compose'da (egasining «zamonaviy dizayn» qarori,
 * 2026-09-01). QOBIQ mantiqlari G5/G6 dagidek: juftlash, kirish, skaner
 * marshruti, oflayn navbat va ekranlar orasidagi navigatsiya. Ekranlar
 * `Activity` ni ko'rmaydi — faqat `Shell` ni (`Shell.kt`).
 *
 * 🔴 NARX HECH QAYERDA ko'rsatilmaydi. Bu ekranlarning intizomi emas, SERVER
 * shartnomasi: ilova `/tsd/scan` dan foydalanadi va u narx qaytarmaydi,
 * `/products` esa TSD sessiyasiga umuman yopiq (`tsd-policy.ts`).
 */
class MainActivity : ComponentActivity(), Shell {

    private val ioPool = Executors.newSingleThreadExecutor()
    private lateinit var store: DeviceStore
    private lateinit var scanner: ScannerBridge

    override lateinit var api: ApiClient
    override lateinit var queue: ActionQueue
    override lateinit var sender: QueueSender

    /** T10 — oflayn O'QUV keshi (amal navbatidan mustaqil, [ReadCache]). */
    override lateinit var cache: ReadCache
    override var employeeId: String = ""

    /** Auth bosqichi — juftlashdan ish stoligacha. */
    private enum class Stage { Pairing, Login, Work }

    private var stage by mutableStateOf(Stage.Pairing)
    private var current by mutableStateOf<Screen?>(null)
    private val history = ArrayDeque<Screen>()

    /** PIN ekrani holati — apparat klaviatura ham teradi (`dispatchKeyEvent`). */
    private var pin by mutableStateOf("")
    private var pinBusy by mutableStateOf(false)

    /** Navbat hisoblagichi — top-bar chipida jonli ko'rinadi. */
    private var queueCount by mutableStateOf(0)

    /**
     * T4 — ekran tepasidagi xato banneri matni (`null` = banner yo'q).
     * `errorSeq` esa HAR xatoda o'sadi: aynan bir xil matnli xato ketma-ket
     * kelganda ham avto-yopish taymeri boshidan boshlansin.
     */
    private var errorText by mutableStateOf<String?>(null)
    private var errorSeq by mutableStateOf(0)

    // ── Yangilanish (qurilmadan) ────────────────────────────────────────────
    private lateinit var updater: Updater
    private var updateState by mutableStateOf<UpdateState>(UpdateState.None)
    private var updateFile: java.io.File? = null

    /** Bosh ekran o'qiydi. */
    val update: UpdateState get() = updateState
    val appVersionName: String get() = updater.installedVersionName()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 🔴 T4 — EKRAN O'CHMASIN. Sanash o'rtasida ekran so'nsa sessiya
        // yopilib PIN qayta so'ralardi va omborchi yacheykani boshidan
        // ochardi. Sozlamada emas, DOIMIY: terminal smena davomida quvvat
        // tokchasida turadi, ya'ni batareya dalili bu yerda ishlamaydi
        // (ilova fonga ketganda bayroq o'z-o'zidan kuchdan qoladi).
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Feedback.init(this)
        store = DeviceStore(this)
        queue = ActionQueue(this)
        // T10 — kesh sessiyadan MUSTAQIL yashaydi: u chiqishda tozalanmaydi
        // (izohi `ReadCache` da) va sirni ham, narxni ham saqlamaydi.
        cache = ReadCache(this)
        api = ApiClient(getString(R.string.api_base_url))
        // Sessiyani tiklab bo'lmadi ⇒ PIN ekrani. Ilgari bu holat xom
        // «HTTP 401» bo'lib chiqardi va terminal boshi berk ko'chaga kirardi.
        api.onSessionLost = { main { if (stage == Stage.Work) logout() } }
        sender = QueueSender(api, queue)
        queueCount = queue.size()
        updater = Updater(this)

        // Broadcast rejimi (DataWedge/Urovo/Newland/iData) — fokusdan mustaqil.
        // Klaviatura-wedge rejimini esa `ScanBar` (Compose) o'zi tutadi.
        scanner = ScannerBridge(this) { code -> runOnUiThread { routeScan(code) } }

        stage = if (store.isPaired) Stage.Login else Stage.Pairing

        setContent {
            SersetTsdTheme {
                when (stage) {
                    Stage.Pairing -> AuthStage {
                        PairingScreen(
                            onSave = { id, secret ->
                                store.deviceId = id
                                store.deviceSecret = secret
                                success(str(R.string.pair_done))
                                stage = Stage.Login
                            },
                        )
                    }
                    Stage.Login -> AuthStage {
                        PinScreen(
                            pin = pin,
                            busy = pinBusy,
                            onDigit = { d -> if (pin.length < 4) pin += d },
                            onBackspace = { pin = pin.dropLast(1) },
                            onSubmit = { submitPin() },
                        )
                    }
                    Stage.Work -> WorkRoot()
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        scanner.start()
        checkUpdate(silent = true)
        // Ekran yoqilganda navbat o'z-o'zidan bo'shashga urinadi: omborchi
        // oflayn ishlab, keyin Wi-Fi zonasiga qaytadi va u yerda hech nima
        // bosmasligi mumkin (G6 qarori saqlanadi).
        if (employeeId.isNotEmpty()) flushQueue(silent = true)
    }

    override fun onStop() {
        scanner.stop()
        super.onStop()
    }

    override fun onDestroy() {
        // `ToneGenerator` audio resursini ushlab turadi — qaytariladi.
        Feedback.release()
        super.onDestroy()
    }

    /**
     * Apparat klaviatura PIN bosqichida to'g'ridan-to'g'ri teradi (iData 95W
     * Pro'da fizik raqam tugmalari bor) — ekranda maxsus maydon shart emas.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Diagnostika — FAQAT ish rejimida. PIN bosqichida yozilsa jurnalga
        // omborchining PIN raqamlari tushib qolardi.
        if (stage == Stage.Work) Diagnostics.key(event)

        if (stage == Stage.Login && event.action == KeyEvent.ACTION_UP && !pinBusy) {
            val digit = when (event.keyCode) {
                in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> event.keyCode - KeyEvent.KEYCODE_0
                in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 ->
                    event.keyCode - KeyEvent.KEYCODE_NUMPAD_0
                else -> -1
            }
            when {
                digit in 0..9 -> {
                    if (pin.length < 4) pin += digit.toString()
                    return true
                }
                event.keyCode == KeyEvent.KEYCODE_DEL -> {
                    pin = pin.dropLast(1)
                    return true
                }
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                    event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    submitPin()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    // ── Ish stoli qobig'i ───────────────────────────────────────────────────

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    private fun WorkRoot() {
        val screen = current ?: return
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        titleContentColor = MaterialTheme.colorScheme.onPrimary,
                        navigationIconContentColor = MaterialTheme.colorScheme.onPrimary,
                        actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    title = {
                        Text(
                            screen.title(this@MainActivity),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    navigationIcon = {
                        if (history.isNotEmpty()) {
                            IconButton(onClick = { back() }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = str(R.string.back))
                            }
                        }
                    },
                    actions = {
                        if (queueCount > 0) {
                            Pill(
                                text = "⇪ $queueCount",
                                bg = Palette.Accent,
                                fg = Palette.OnAccent,
                                modifier = Modifier.padding(end = 8.dp),
                            )
                        }
                        IconButton(onClick = { logout() }) {
                            Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = str(R.string.logout))
                        }
                    },
                )
            },
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize(),
            ) {
                // Skan maydoni HAR DOIM tepada va fokusda (klaviatura-wedge
                // skaner aynan fokusdagi maydonga yozadi — G6 qarori).
                ScanBar(
                    screenKey = screen,
                    hint = str(R.string.scan_hint),
                    onCode = { code -> routeScan(code) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                )
                // 🔴 T4 — xato banneri AYNAN shu yerda: skan maydonining
                // OSTIDA va ro'yxatning USTIDA.
                //  · Skan maydonining USTIGA qo'yilsa, banner chiqqanda
                //    maydon pastga sakrardi — omborchi aynan o'sha maydonga
                //    yozadi/skanerlaydi va u qimirlamasligi kerak.
                //  · Ro'yxat ICHIGA qo'yilsa u skroll bilan ketib qolardi,
                //    ya'ni xato yana ko'rinmay qolardi.
                // Yuqori panel ham to'silmaydi: «orqaga» va «chiqish»
                // tugmalari banner turganda ham bosiladi.
                ErrorHost(
                    modifier = Modifier
                        .padding(horizontal = 14.dp)
                        .padding(bottom = 10.dp),
                )
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // 🔴 `key(screen)` MAJBURIY: usiz Compose har ekranni AYNI
                    // slotda ko'radi va ekran almashganda `LaunchedEffect(Unit)`
                    // qayta ishga tushmaydi — ya'ni yangi ekran eskisining
                    // ma'lumoti bilan chizilardi. Kalit bilan har ekran nusxasi
                    // o'z kompozitsiyasini oladi (orqaga qaytganda ham yangilanadi).
                    key(screen) { screen.Content() }
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
        }
    }

    /**
     * T4 — xato banneri joyi. Bannerni QAYERGA qo'yish chaqiruvchining ishi
     * (`WorkRoot` da layout oqimida, `AuthStage` da ustiga qoplab) — bu
     * yerda faqat matn, avto-yopish taymeri va bosib yopish jamlangan.
     * `errorText` `null` bo'lsa bu joy umuman hech nima egallamaydi.
     */
    @Composable
    private fun ErrorHost(modifier: Modifier = Modifier) {
        val text = errorText ?: return
        // Kalit `errorSeq`: aynan bir xil matnli xato ikkinchi marta kelsa
        // ham taymer QAYTADAN boshlansin (aks holda ikkinchi banner
        // birinchisidan qolgan vaqtda yo'q bo'lardi).
        LaunchedEffect(errorSeq) {
            delay(ERROR_BANNER_MS)
            errorText = null
        }
        ErrorBanner(text = text, modifier = modifier) { errorText = null }
    }

    /**
     * Juftlash va PIN bosqichlari — bu yerda yuqori panel ham, skan maydoni
     * ham yo'q, shuning uchun banner USTIGA qoplanadi: oqimga qo'yilsa PIN
     * klaviaturasi pastga surilib, oxirgi qatori ekrandan chiqib ketardi.
     */
    @Composable
    private fun AuthStage(content: @Composable () -> Unit) {
        Box(modifier = Modifier.fillMaxSize()) {
            content()
            ErrorHost(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(12.dp),
            )
        }
    }

    // ── Shell ───────────────────────────────────────────────────────────────

    override fun str(res: Int): String = getString(res)
    override fun str(res: Int, vararg args: Any): String = getString(res, *args)
    override fun toast(res: Int) = runOnUiThread {
        Toast.makeText(this, res, Toast.LENGTH_SHORT).show()
    }

    override fun toast(text: String) = runOnUiThread {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
    }

    override fun success(res: Int) = success(getString(res))

    /**
     * T4 — amal o'tdi: toast QOLADI (u qisqa va yo'lni to'smaydi), ustiga
     * ovoz va tebranish qo'shiladi. Muvaffaqiyat uchun banner ATAYLAB
     * ishlatilmaydi: har saqlashda ekranning uchdan biri band bo'lardi.
     */
    override fun success(text: String) = runOnUiThread {
        Feedback.ok()
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
    }

    override fun error(res: Int) = error(getString(res))

    /**
     * 🔴 T4 — amal o'tmadi: QIZIL BANNER + past ton va ikkita tebranish.
     * Toast bu yerda ishlatilmaydi (`Shell.error` izohi: 4" ekranda u
     * ko'zdan qochadi va xato jimgina yo'qolardi).
     */
    override fun error(text: String) = runOnUiThread {
        // Matnsiz xato (masalan tanasiz 5xx) bannerda bo'sh qator bo'lardi —
        // omborchi hech bo'lmasa amal O'TMAGANINI bilishi kerak.
        errorText = text.ifBlank { getString(R.string.error_unknown) }
        errorSeq++
        Feedback.fail()
    }

    override fun go(screen: Screen) {
        val prev = current
        if (prev != null && prev !== screen) history.push(prev)
        current = screen
        queueCount = queue.size()
    }

    override fun back() {
        val prev = history.poll()
        if (prev == null) {
            goHome()
            return
        }
        current = prev
        queueCount = queue.size()
    }

    /** Bosh ekran (plitkali menyu) — tarix tozalanadi. */
    fun goHome() {
        history.clear()
        current = HomeScreen(this)
        queueCount = queue.size()
    }

    override fun io(work: () -> Unit) {
        ioPool.execute {
            try {
                work()
            } catch (e: ApiClient.ApiException) {
                // T4 — HAR QANDAY ushlanmagan xato endi bannerga tushadi:
                // bu yo'l ekranlar o'zi tutmagan hamma xatoning oxirgi
                // to'ri, ya'ni u toast bo'lib qolsa banner qoidasida
                // teshik qolardi.
                error(e.message ?: "")
            } catch (e: Exception) {
                error(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    override fun main(work: () -> Unit) = runOnUiThread(work)

    override fun enqueue(method: String, path: String, body: JSONObject, label: String) {
        try {
            queue.enqueue(
                ActionQueue.Action(
                    opId = body.optString("clientOpId").ifEmpty { UUID.randomUUID().toString() },
                    method = method,
                    path = path,
                    body = body,
                    label = label,
                ),
            )
            main {
                queueCount = queue.size()
                // Navbatga tushish — amal YO'QOLMADI, keyinroq yuboriladi:
                // ya'ni bu XATO emas (banner chiqarilmaydi), lekin omborchi
                // «bo'ldi» degan javobni eshitishi kerak.
                success(str(R.string.offline_queued, queue.size()))
            }
        } catch (e: ActionQueue.QueueFullException) {
            // Navbat to'lgan — YANGISI rad etiladi va bu BALAND aytiladi.
            // Eng eskisini tashlash jim yo'qotish bo'lardi (IS-5 klassi).
            // T4: aynan shu sabab endi toast emas, BANNER.
            error(e.message ?: "")
        }
    }

    fun flushQueue(silent: Boolean) {
        if (queue.size() == 0) return
        io {
            val r = sender.flush()
            main {
                queueCount = queue.size()
                if (!silent || r.sent > 0 || r.rejected > 0) {
                    // T4: «aloqa yo'q» ham, «rad etilganlar bor» ham XATO
                    // yo'li — omborchi ular haqida bilmasa amal jimgina
                    // yo'qolgandek bo'lardi (IS-5). Toza yuborish esa
                    // muvaffaqiyat.
                    val report = str(R.string.queue_sent, r.sent, r.rejected)
                    when {
                        r.offline -> error(str(R.string.queue_offline, r.left))
                        r.rejected > 0 -> error(report)
                        else -> success(report)
                    }
                }
                if (r.sent > 0 || r.rejected > 0) goHome()
            }
        }
    }

    // ── Yangilanish ─────────────────────────────────────────────────────────

    /**
     * Manifestni tekshiradi. `silent` — natijasi yo'q bo'lsa hech nima
     * aytilmaydi (ilova har ochilganda chaqiriladi); qo'lda bosilganda esa
     * «eng so'nggi versiya» degan javob ham KERAK.
     *
     * Yuklab olish davom etayotgan bo'lsa tekshiruv o'tkazib yuboriladi —
     * aks holda holat orqaga sakrardi.
     */
    fun checkUpdate(silent: Boolean) {
        if (updateState is UpdateState.Downloading) return
        Thread {
            val r = updater.check()
            main {
                when {
                    r == null -> if (!silent) error(R.string.update_check_failed)
                    updater.isNewer(r) -> updateState = UpdateState.Available(r)
                    else -> {
                        updateState = UpdateState.None
                        if (!silent) toast(R.string.update_up_to_date)
                    }
                }
            }
        }.start()
    }

    fun downloadUpdate() {
        val r = when (val s = updateState) {
            is UpdateState.Available -> s.release
            is UpdateState.Failed -> return checkUpdate(silent = false)
            else -> return
        }
        updateState = UpdateState.Downloading(0)
        Thread {
            val res = updater.download(r) { pct ->
                main { updateState = UpdateState.Downloading(pct) }
            }
            main {
                res.fold(
                    onSuccess = { f ->
                        updateFile = f
                        updateState = UpdateState.Ready(r)
                    },
                    onFailure = { e ->
                        updateState = UpdateState.Failed(e.message ?: e.javaClass.simpleName)
                    },
                )
            }
        }.start()
    }

    fun installUpdate() {
        val f = updateFile ?: return
        // `false` — huquq yo'q edi va foydalanuvchi sozlama ekraniga ketdi;
        // qaytgach shu tugmani yana bosadi (fayl joyida turadi).
        if (!updater.install(f)) error(R.string.update_needs_permission)
    }

    // ── Skaner marshruti ────────────────────────────────────────────────────

    /**
     * Skan AVVAL joriy ekranga beriladi (u bosqichga qarab talqin qiladi);
     * ekran uni yemasa — umumiy NARXSIZ skan-ma'lumot ochiladi.
     */
    private fun routeScan(code: String) {
        if (stage != Stage.Work) return
        val screen = current
        if (screen != null && screen.onScan(code)) return
        io {
            val hit = api.scan(code)
            // T4 — umumiy skan yo'lining OVOZLI javobi: omborchi ekranga
            // qaramasdan ham kod tanilgan-tanilmaganini biladi. Bu yo'lda
            // xabar (toast/banner) YO'Q — natijani `ScanInfoScreen` o'zi
            // ko'rsatadi, shuning uchun signal ham to'g'ridan-to'g'ri
            // `Feedback` dan olinadi.
            if (isEmptyHit(hit)) Feedback.fail() else Feedback.ok()
            main { go(ScanInfoScreen(this, hit)) }
        }
    }

    /**
     * Skan HECH NIMA topmadimi? `kind: "none"` — kod umuman tanilmadi;
     * `piece` esa yorliq REYESTRDA yo'q bo'lsa ham `found: false` bilan
     * qaytadi (`ScanInfoScreen.PieceCard` shu shoxni chizadi). Ikkalasi
     * ham omborchi uchun «bo'lmadi».
     */
    private fun isEmptyHit(hit: JSONObject): Boolean = when (hit.optString("kind")) {
        "none" -> true
        "piece" -> hit.optJSONObject("piece")?.optBoolean("found") != true
        else -> false
    }

    // ── PIN kirish ──────────────────────────────────────────────────────────

    private fun submitPin() {
        val code = pin
        if (code.length != 4 || pinBusy) return
        pinBusy = true
        io {
            try {
                val resp = api.login(
                    store.deviceId.orEmpty(),
                    store.deviceSecret.orEmpty(),
                    code,
                    appVersion(),
                )
                // Refresh-token TANADAN olinadi (cookie yo'q) va shifrlangan
                // holda saqlanadi. PIN HECH QACHON saqlanmaydi.
                store.refreshToken = resp.optString("refreshToken").takeIf { it.isNotEmpty() }
                employeeId = resp.optJSONObject("user")?.optString("id").orEmpty()
                main {
                    pin = ""
                    pinBusy = false
                    // Kirishdan oldingi xato (masalan «PIN noto'g'ri»)
                    // ish stoliga ergashib o'tmasin.
                    errorText = null
                    stage = Stage.Work
                    goHome()
                    flushQueue(silent = true)
                }
            } catch (e: ApiClient.ApiException) {
                main {
                    pin = ""
                    pinBusy = false
                    error(if (e.code == 401) str(R.string.login_failed) else (e.message ?: ""))
                }
            }
        }
    }

    /** Chiqish — sessiya o'chadi, juftlik QOLADI (terminal qayta ulanmasin). */
    override fun logout() {
        store.clearSession()
        api.accessToken = null
        employeeId = ""
        history.clear()
        current = null
        pin = ""
        // Ish ekranidagi xato PIN ekraniga ergashib o'tmasin. 401 sababli
        // chiqarilganda bu banner YO'QOLMAYDI: `onSessionLost` avval,
        // `io()` ning xato banneri esa KEYIN ishlaydi (ikkalasi ham UI
        // thread'ga navbat bilan qo'yiladi).
        errorText = null
        stage = Stage.Login
    }

    private fun appVersion(): String =
        runCatching { packageManager.getPackageInfo(packageName, 0).versionName }
            .getOrNull().orEmpty()

    private companion object {
        /**
         * T4 — xato banneri necha ms turadi. 6 s: omborchi tovardan boshini
         * ko'tarib matnni o'qib ulgursin (toastning ~2 s i aynan shuning
         * uchun yetmasdi). Undan uzunroq qilinsa keyingi skanning javobini
         * to'sib qolardi. Bosilsa banner darhol yopiladi.
         */
        const val ERROR_BANNER_MS = 6_000L
    }
}
