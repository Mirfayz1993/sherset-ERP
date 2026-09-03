package uz.sherset.tsd

import android.os.SystemClock
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.integerResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Klaviatura-wedge skan maydoni (G5 `ScannerBridge.bindKeyboardWedge` ning
 * Compose davomi): skaner kodni «yozadi» va Enter yuboradi — Enter kelganda
 * kod beriladi va maydon TOZALANADI (keyingi skan ustiga yozilmasin).
 *
 * 🔴 Fokus ekranlar almashganda ham QOLADI (`LaunchedEffect(screenKey)`) —
 * wedge skaner aynan fokusdagi maydonga yozadi, aks holda har o'tishda
 * birinchi skan yo'qolardi. Broadcast rejimi (`ScannerBridge`) fokusdan
 * mustaqil ishlayveradi. Fokus FAQAT ekran almashganda so'raladi: ekran
 * ichidagi boshqa maydon (Sanashdagi son maydoni, T3 dagi qidiruv maydoni)
 * fokus olsa, bu maydon uni ORQAGA TORTMAYDI.
 *
 * 🔴 T2 (2026-09-03) — MANBANI AJRATISH. Pastdagi 350 ms avto-yuborish
 * zaxirasi suffikssiz skaner uchun kerak, lekin odam qo'lda `02-01-01-04`
 * yozganda kodning birinchi 3 belgisini yuborib yuborardi — klaviatura
 * amalda ishlamasdi. Endi belgilar orasidagi O'RTACHA interval o'lchanadi
 * (`TypingWatch`): chegaradan tez → skaner (avto-yuborish ISHLAYDI),
 * sekin → odam (avto-yuborish O'CHADI, faqat ⏎ / Enter yuboradi).
 * Chegara — `config.xml` dagi `scan_human_gap_ms` (qurilma almashsa kod
 * o'zgarmasin).
 */
@Composable
fun ScanBar(
    screenKey: Any?,
    hint: String,
    onCode: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var value by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val humanGapMs = integerResource(R.integer.scan_human_gap_ms)
    val watch = remember(humanGapMs) { TypingWatch(humanGapMs) }
    // `watch` ning qarori Compose uchun KO'RINADIGAN bo'lishi kerak (⏎ belgisi
    // ham, avto-yuborish shoxi ham shunga qarab qayta hisoblanadi) — shuning
    // uchun u alohida state'ga ko'chiriladi.
    var human by remember { mutableStateOf(false) }
    val submitLabel = stringResource(R.string.scan_submit)

    fun reset() {
        value = ""
        watch.reset()
        human = false
    }

    fun submit() {
        val code = value.trim()
        val wasHuman = human
        val avgGap = watch.averageGapMs
        reset()
        if (code.isEmpty()) return
        // Diagnostikaga FAQAT manba va o'lchov tushadi — kodning O'ZI emas.
        Diagnostics.input(human = wasHuman, length = code.length, avgGapMs = avgGap)
        onCode(code)
    }

    LaunchedEffect(screenKey) { focusRequester.requestFocus() }

    // 🔴 SUFFIKSSIZ SKANER UCHUN ZAXIRA (2026-09-01, jonli terminalda o'lchandi).
    // Wedge rejimidagi skanerlarning bir qismi oxirida Enter YUBORMAYDI —
    // u holda kod maydonga tushadi va u yerda JIM turib qolardi. Bu effekt
    // har harfda qayta ishga tushadi (LaunchedEffect kalitida `value`), ya'ni
    // skaner yozib bo'lgach 350 ms jimlikda kod o'zi yuboriladi.
    // Enter kelsa maydon darhol tozalanadi va bu shox umuman ishlamaydi.
    // Chegara (3 belgi) — tasodifiy bitta bosilgan tugma yuborilmasin.
    // T2: `human` ham kalit — odam yozayotgani aniqlangan zahoti kutish BEKOR
    // qilinadi va qayta boshlanmaydi. Zaxira o'chirilmadi, chetlab o'tildi.
    LaunchedEffect(value, human) {
        if (!human && value.trim().length >= 3) {
            delay(350)
            submit()
        }
    }

    OutlinedTextField(
        value = value,
        onValueChange = { next ->
            watch.onChange(oldLength = value.length, newLength = next.length)
            human = watch.isHuman
            value = next
        },
        modifier = modifier
            .heightIn(min = 56.dp)
            .focusRequester(focusRequester)
            .onPreviewKeyEvent { e ->
                if (e.type == KeyEventType.KeyUp && (e.key == Key.Enter || e.key == Key.NumPadEnter)) {
                    submit()
                    true
                } else {
                    false
                }
            },
        singleLine = true,
        placeholder = { Text(hint) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        // Odam yozayotgani aniqlangan zahoti o'ng tomonda ⏎ chiqadi: bu ham
        // «endi o'zi yuborilmaydi» degan rejim belgisi, ham bosiladigan tugma
        // (omborchi ekran klaviaturasidan tasdiq tugmasini qidirmasin).
        trailingIcon = if (!human) {
            null
        } else {
            {
                IconButton(
                    onClick = { submit() },
                    modifier = Modifier.semantics { contentDescription = submitLabel },
                ) {
                    Text(
                        "⏎",
                        style = MaterialTheme.typography.titleLarge,
                        color = Palette.Accent,
                    )
                }
            }
        },
        textStyle = androidx.compose.ui.text.TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = androidx.compose.ui.unit.TextUnit.Unspecified,
        ),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        // Ekran klaviaturasining tasdiq tugmasi qurilmadan qurilmaga «Done»,
        // «Go» yoki «Search» bo'lib chiqadi — uchalasi ham yuborsin.
        keyboardActions = KeyboardActions(
            onDone = { submit() },
            onGo = { submit() },
            onSearch = { submit() },
        ),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Palette.Accent,
            unfocusedBorderColor = Palette.Border,
            focusedContainerColor = Palette.Surface,
            unfocusedContainerColor = Palette.Surface,
        ),
    )
}

/**
 * BELGILAR ORASIDAGI TEZLIKNI o'lchaydi va «skaner»/«odam» qarorini beradi (T2).
 *
 * 🔴 NEGA `onValueChange`, `onPreviewKeyEvent` EMAS. Tugma hodisasi faqat
 * APPARAT klaviaturadan (va wedge skanerdan) keladi — EKRAN klaviaturasi
 * matnni `InputConnection` orqali qo'yadi va bitta ham `KeyEvent`
 * yubormaydi. Omborchi kodni aynan ekran klaviaturasida yozadi, ya'ni tugma
 * hodisalariga qarab o'lchash uni «skaner» deb tanigan va kodni yana yarmida
 * yuborgan bo'lardi — T2 tuzatayotgan xatoning O'ZI qaytardi.
 * `onValueChange` esa uchala yo'lni ham (ekran klaviaturasi, apparat
 * klaviatura, wedge skaner) bir xil ko'radi.
 *
 * Qaror **o'rtacha** interval bo'yicha, eng katta interval bo'yicha EMAS:
 * skan o'rtasida bitta GC pauzasi tushsa ham skaner «odam» ga aylanib
 * qolmasin — aks holda U5 dagi «kod maydonda jim turib qoldi» qaytardi.
 */
private class TypingWatch(private val humanGapMs: Int) {

    private var lastAt = 0L
    private var totalGapMs = 0L
    private var gaps = 0

    /** Tahrir (backspace) — skaner buni hech qachon qilmaydi. */
    private var edited = false

    /** Belgi boshiga o'rtacha interval, ms. Hali o'lchov bo'lmasa `-1`. */
    val averageGapMs: Long get() = if (gaps == 0) -1L else totalGapMs / gaps

    val isHuman: Boolean get() = edited || (gaps > 0 && averageGapMs >= humanGapMs)

    fun onChange(oldLength: Int, newLength: Int) {
        val now = SystemClock.elapsedRealtime()
        if (newLength < oldLength) {
            edited = true
            lastAt = now
            return
        }
        val added = newLength - oldLength
        if (added <= 0) return
        // Birinchi belgining «intervali» yo'q (undan oldin belgi ham yo'q).
        // Bir chaqiruvda bir nechta belgi kelsa (skaner burst'i yoki qo'yish),
        // o'lchangan interval o'sha belgilarga BO'LINADI.
        if (lastAt != 0L) {
            totalGapMs += now - lastAt
            gaps += added
        }
        lastAt = now
    }

    fun reset() {
        lastAt = 0L
        totalGapMs = 0L
        gaps = 0
        edited = false
    }
}
