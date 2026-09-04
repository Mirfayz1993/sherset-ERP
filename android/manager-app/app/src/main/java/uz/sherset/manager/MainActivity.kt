package uz.sherset.manager

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.util.ArrayDeque
import java.util.concurrent.Executors

/**
 * Sherset Menejer (v0.1): email+parol → ISH EKRANLARI.
 *
 * Qobiq tsd-app `MainActivity` dan: Stage holat-mashinasi, `ArrayDeque`
 * tarix, `key(screen)` bilan majburiy rekompozitsiya. Skaner/PIN/oflayn
 * navbat YO'Q — bu o'qish-ilova (reja 2026-09-02).
 *
 * Kirish oqimi: ochilishda saqlangan refresh-token bilan JIM davom etishga
 * urinadi (`Stage.Boot`); bo'lmasa login ekrani. Ishlash payti 401 kelib
 * refresh ham yiqilsa — login ekraniga qaytadi (`onSessionExpired`).
 */
class MainActivity : ComponentActivity(), Shell {

    private val ioPool = Executors.newSingleThreadExecutor()
    private lateinit var store: SessionStore

    override lateinit var api: ApiClient
    override var userName: String = ""

    // 🔴 Rol va ruxsatlar COMPOSE STATE: refresh javobi kelganda bosh ekran
    // qayta chizilishi kerak (oddiy `var` bo'lsa plitkalar eskicha qolardi).
    override var hrRoles: List<String> by mutableStateOf(emptyList())
        private set
    override var hrPermissions: List<HrPermission> by mutableStateOf(emptyList())
        private set

    /** Boot — saqlangan sessiya bilan jim urinish. */
    private enum class Stage { Boot, Login, Work }

    private var stage by mutableStateOf(Stage.Boot)
    private var current by mutableStateOf<Screen?>(null)
    private val history = ArrayDeque<Screen>()

    // ── Yangilanish (qurilmadan) ────────────────────────────────────────────
    private lateinit var updater: Updater
    private var updateState by mutableStateOf<UpdateState>(UpdateState.None)
    private var updateFile: java.io.File? = null

    /** Bosh ekran o'qiydi. */
    val update: UpdateState get() = updateState
    val appVersionName: String get() = updater.installedVersionName()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        api = ApiClient(getString(R.string.api_base_url))
        // Rotatsiya qilingan refresh-token DARHOL diskka tushadi — aks holda
        // ilova o'ldirilganda eski (bekor bo'lgan) token qolardi.
        api.onRefreshRotated = { store.refreshToken = it }
        // Har refreshda rol/ruxsat SERVERDAN qayta o'qiladi: admin rolni olib
        // qo'ysa «Boshqaruv» bo'limi chiqishdan keyin emas, o'sha zahoti yo'qoladi.
        api.onUserRefreshed = { u ->
            SessionUser.fromJson(u)?.let { user -> main { applyUser(user) } }
        }
        updater = Updater(this)

        setContent {
            SersetManagerTheme {
                when (stage) {
                    Stage.Boot -> BootScreen()
                    Stage.Login -> LoginScreen(shell = this, onLoggedIn = { enterWork(it) })
                    Stage.Work -> WorkRoot()
                }
            }
        }

        bootSession()
    }

    override fun onStart() {
        super.onStart()
        checkUpdate(silent = true)
    }

    /** Saqlangan refresh-token bilan jim kirishga urinish. */
    private fun bootSession() {
        val rt = store.refreshToken
        if (rt.isNullOrEmpty()) {
            stage = Stage.Login
            return
        }
        api.refreshToken = rt
        ioPool.execute {
            val resp = runCatching { api.tryRefresh() }.getOrNull()
            main {
                if (resp == null) {
                    // Sessiya tugagan yoki server javob bermadi — login orqali.
                    stage = Stage.Login
                } else {
                    // Javobda `user` bo'lmasa — oxirgi ma'lum holat bilan
                    // davom etamiz (diskdagi rol/ruxsat), bo'lsa server so'zi ustun.
                    val user = SessionUser.fromJson(resp.optJSONObject("user"))
                        ?: SessionUser(
                            name = store.userName.orEmpty(),
                            hrRoles = store.hrRoles,
                            hrPermissions = store.hrPermissions,
                        )
                    enterWork(user)
                }
            }
        }
    }

    private fun enterWork(user: SessionUser) {
        applyUser(user)
        stage = Stage.Work
        goHome()
    }

    /**
     * Login/refresh javobidagi xodimni qobiqqa va diskka yozadi.
     *
     * 🔴 Rol/ruxsat HAR SAFAR to'liq ALMASHTIRILADI (qo'shilmaydi): bo'sh
     * ro'yxat ham server javobi — rol olib qo'yilgan bo'lsa plitka yo'qolishi
     * kerak. UI thread'da chaqiriladi (Compose state).
     */
    private fun applyUser(user: SessionUser) {
        userName = user.name.ifEmpty { store.userName.orEmpty() }
        if (user.name.isNotEmpty()) store.userName = user.name
        hrRoles = user.hrRoles
        hrPermissions = user.hrPermissions
        store.hrRoles = user.hrRoles
        store.hrPermissions = user.hrPermissions
    }

    /** 401 + refresh yiqildi — sessiya o'ldi, sirlar tozalanadi. */
    private fun onSessionExpired() {
        store.clear()
        api.accessToken = null
        api.refreshToken = null
        hrRoles = emptyList()
        hrPermissions = emptyList()
        history.clear()
        current = null
        stage = Stage.Login
        toast(R.string.session_expired)
    }

    // ── Boot ekrani ─────────────────────────────────────────────────────────

    @Composable
    private fun BootScreen() {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(12.dp))
                Text(str(R.string.loading), color = Palette.TextMuted)
            }
        }
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
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = str(R.string.back),
                                )
                            }
                        }
                    },
                    actions = {
                        IconButton(onClick = { logout() }) {
                            Icon(
                                Icons.AutoMirrored.Filled.ExitToApp,
                                contentDescription = str(R.string.logout),
                            )
                        }
                    },
                )
            },
        ) { padding ->
            // Planshet: kontent 760dp dan keng cho'zilmaydi (o'qilish uchun).
            Box(
                modifier = Modifier.padding(padding).fillMaxSize(),
                contentAlignment = Alignment.TopCenter,
            ) {
                Column(
                    modifier = Modifier
                        .widthIn(max = 760.dp)
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // 🔴 `key(screen)` MAJBURIY: usiz Compose har ekranni AYNI
                    // slotda ko'radi va ekran almashganda `LaunchedEffect(Unit)`
                    // qayta ishga tushmaydi (tsd-app dagi bir xil saboq).
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
    }

    override fun back() {
        val prev = history.poll()
        if (prev == null) {
            goHome()
            return
        }
        current = prev
    }

    /** Bosh ekran (plitkali menyu) — tarix tozalanadi. */
    fun goHome() {
        history.clear()
        current = HomeScreen(this)
    }

    override fun io(work: () -> Unit) {
        ioPool.execute {
            try {
                work()
            } catch (e: ApiClient.ApiException) {
                // 401 shu yergacha yetib kelgan bo'lsa — refresh ham yiqilgan.
                if (e.code == 401) main { onSessionExpired() }
                else toast(e.message ?: "")
            } catch (e: Exception) {
                toast(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    override fun main(work: () -> Unit) = runOnUiThread(work)

    /** Chiqish — sirlar o'chadi, server zanjiri bekor qilinadi (best-effort). */
    override fun logout() {
        ioPool.execute { runCatching { api.logout() } }
        store.clear()
        api.accessToken = null
        api.refreshToken = null
        userName = ""
        hrRoles = emptyList()
        hrPermissions = emptyList()
        history.clear()
        current = null
        stage = Stage.Login
    }

    // ── Yangilanish ─────────────────────────────────────────────────────────

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
        if (!updater.install(f)) toast(R.string.update_needs_permission)
    }
}
