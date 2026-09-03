package uz.sherset.tsd

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * SKANER DIAGNOSTIKASI ekrani (2026-09-02).
 *
 * Qurilma USB bilan ulanmagan ⇒ `logcat` yo'q. Bu ekran o'sha bo'shliqni
 * to'ldiradi: omborchi skan tugmasini bosadi va EKRANDA nima kelayotganini
 * ko'radi — `KEY` (klaviatura-wedge), `BCAST` (broadcast) yoki hech nima.
 *
 * «Hech nima» ham javob: demak skaner ilovaga umuman yubormayapti va
 * yechim qurilma sozlamalarida, ilovada emas.
 */
class DiagnosticsScreen(private val shell: Shell) : Screen {

    override fun title(shell: Shell): String = shell.str(R.string.diag_title)

    @Composable
    override fun Content() {
        val ctx = LocalContext.current

        SectionCard {
            Text(
                stringResource(R.string.diag_help),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Spacer(Modifier.height(10.dp))

        SectionCard(tint = Palette.SurfaceMuted) {
            Text(
                stringResource(R.string.diag_listening),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.scanner_broadcast_actions).replace(",", "\n"),
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                color = Palette.TextMuted,
            )
        }
        Spacer(Modifier.height(10.dp))

        // Ba'zi terminallar kodni BUFERGA yozadi (uchinchi chiqish rejimi).
        // Uni ushlab turib bo'lmaydi — qo'lda o'qiladi.
        SecondaryButton(text = stringResource(R.string.diag_clipboard)) {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            val text = cm?.primaryClip?.takeIf { it.itemCount > 0 }
                ?.getItemAt(0)?.coerceToText(ctx)?.toString().orEmpty()
            Diagnostics.log(if (text.isEmpty()) "CLIP <bo'sh>" else "CLIP $text")
        }
        Spacer(Modifier.height(8.dp))
        SecondaryButton(text = stringResource(R.string.diag_clear), color = Palette.Danger) {
            Diagnostics.clear()
        }
        Spacer(Modifier.height(10.dp))

        if (Diagnostics.events.isEmpty()) {
            EmptyState(stringResource(R.string.diag_empty))
        } else {
            SectionCard {
                for (line in Diagnostics.events) {
                    Text(
                        line,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                }
            }
        }
        Spacer(Modifier.height(10.dp))

        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }
}
