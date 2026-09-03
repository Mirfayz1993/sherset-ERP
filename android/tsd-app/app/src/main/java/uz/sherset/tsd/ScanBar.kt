package uz.sherset.tsd

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
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
 * mustaqil ishlayveradi.
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

    fun submit() {
        val code = value.trim()
        value = ""
        if (code.isNotEmpty()) onCode(code)
    }

    LaunchedEffect(screenKey) { focusRequester.requestFocus() }

    // 🔴 SUFFIKSSIZ SKANER UCHUN ZAXIRA (2026-09-01, jonli terminalda o'lchandi).
    // Wedge rejimidagi skanerlarning bir qismi oxirida Enter YUBORMAYDI —
    // u holda kod maydonga tushadi va u yerda JIM turib qolardi. Bu effekt
    // har harfda qayta ishga tushadi (LaunchedEffect kalitida `value`), ya'ni
    // skaner yozib bo'lgach 350 ms jimlikda kod o'zi yuboriladi.
    // Enter kelsa maydon darhol tozalanadi va bu shox umuman ishlamaydi.
    // Chegara (3 belgi) — tasodifiy bitta bosilgan tugma yuborilmasin.
    LaunchedEffect(value) {
        if (value.trim().length >= 3) {
            delay(350)
            submit()
        }
    }

    OutlinedTextField(
        value = value,
        onValueChange = { value = it },
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
        textStyle = androidx.compose.ui.text.TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = androidx.compose.ui.unit.TextUnit.Unspecified,
        ),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Palette.Accent,
            unfocusedBorderColor = Palette.Border,
            focusedContainerColor = Palette.Surface,
            unfocusedContainerColor = Palette.Surface,
        ),
    )
}
