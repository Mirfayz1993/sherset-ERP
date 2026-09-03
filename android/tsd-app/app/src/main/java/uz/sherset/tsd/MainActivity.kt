package uz.sherset.tsd

import android.os.Bundle
import android.view.KeyEvent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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

    // ── Yangilanish (qurilmadan) ────────────────────────────────────────────
    private lateinit var updater: Updater
    private var updateState by mutableStateOf<UpdateState>(UpdateState.None)
    private var updateFile: java.io.File? = null

    /** Bosh ekran o'qiydi. */
    val update: UpdateState get() = updateState
    val appVersionName: String get() = updater.installedVersionName()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = DeviceStore(this)
        queue = ActionQueue(this)
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
                    Stage.Pairing -> PairingScreen(
                        onSave = { id, secret ->
                            store.deviceId = id
                            store.deviceSecret = secret
                            toast(R.string.pair_done)
                            stage = Stage.Login
                        },
                    )
                    Stage.Login -> PinScreen(
                        pin = pin,
                        busy = pinBusy,
                        onDigit = { d -> if (pin.length < 4) pin += d },
                        onBackspace = { pin = pin.dropLast(1) },
                        onSubmit = { submitPin() },
                    )
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

    // ── Shell ───────────────────────────────────────────────────────────────

    override fun str(res: Int): String = getString(res)
    override fun str(res: Int, vararg args: Any): String = getString(res, *args)
    override fun toast(res: Int) = runOnUiThread {
        Toast.makeText(this, res, Toast.LENGTH_SHORT).show()
    }

    override fun toast(text: String) = runOnUiThread {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
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
                toast(e.message ?: "")
            } catch (e: Exception) {
                toast(e.message ?: e.javaClass.simpleName)
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
                toast(str(R.string.offline_queued, queue.size()))
            }
        } catch (e: ActionQueue.QueueFullException) {
            // Navbat to'lgan — YANGISI rad etiladi va bu BALAND aytiladi.
            // Eng eskisini tashlash jim yo'qotish bo'lardi (IS-5 klassi).
            toast(e.message ?: "")
        }
    }

    fun flushQueue(silent: Boolean) {
        if (queue.size() == 0) return
        io {
            val r = sender.flush()
            main {
                queueCount = queue.size()
                if (!silent || r.sent > 0 || r.rejected > 0) {
                    toast(
                        if (r.offline) str(R.string.queue_offline, r.left)
                        else str(R.string.queue_sent, r.sent, r.rejected),
                    )
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
                    r == null -> if (!silent) toast(R.string.update_check_failed)
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
        if (!updater.install(f)) toast(R.string.update_needs_permission)
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
            main { go(ScanInfoScreen(this, hit)) }
        }
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
                    stage = Stage.Work
                    goHome()
                    flushQueue(silent = true)
                }
            } catch (e: ApiClient.ApiException) {
                main {
                    pin = ""
                    pinBusy = false
                    toast(if (e.code == 401) str(R.string.login_failed) else (e.message ?: ""))
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
        stage = Stage.Login
    }

    private fun appVersion(): String =
        runCatching { packageManager.getPackageInfo(packageName, 0).versionName }
            .getOrNull().orEmpty()
}
