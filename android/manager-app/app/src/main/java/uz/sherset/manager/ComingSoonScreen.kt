package uz.sherset.manager

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * BO'SH HOLAT — «bu bo'lim keyingi yangilanishda ochiladi».
 *
 * X1 da «Mening kunim» plitkalari shu ekranga olib boradi; X2–X6 da har biri
 * o'z haqiqiy ekraniga ALMASHTIRILADI (`HomeScreen` dagi `go(...)` chaqiruvi
 * o'zgaradi, bu fayl esa keyingi bo'sh bo'limlar uchun qolaveradi).
 *
 * Ataylab HECH QANDAY so'rov yubormaydi: ekran ochilishi serverga yuk
 * bermasligi kerak.
 */
class ComingSoonScreen(
    private val shell: Shell,
    private val titleRes: Int,
) : Screen {

    override fun title(shell: Shell): String = shell.str(titleRes)

    @Composable
    override fun Content() {
        SectionCard {
            Text(
                shell.str(titleRes),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                shell.str(R.string.coming_soon_note),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
        }
    }
}
