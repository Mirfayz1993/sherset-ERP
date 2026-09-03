package uz.sherset.tsd

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Sherset TSD dizayn tizimi (0.2.0 — Compose'ga o'tish, egasining
 * «zamonaviy dizayn» qarori 2026-09-01).
 *
 * Ombor terminali uchun qoidalar (G5 `dimens.xml` merosxo'ri):
 *  - tegish nishonlari 56–64dp (Material minimumi 48dp dan ATAYLAB yirik:
 *    qo'lqop, harakat, sovuq ombor);
 *  - matn yirik (body 17–18sp, sarlavha 22sp) — terminal 4" va qo'l uzunligida;
 *  - FAQAT YORUG' mavzu: ombor yorug' joy, kontrast muhim, DayNight esa
 *    kechki smenada kutilmagan rang almashinuviga olib kelardi;
 *  - dinamik rang YO'Q — hamma terminalda bir xil ko'rinish.
 *
 * NARX RANGI YO'Q — bu ilova narx ko'rsatmaydi (server shartnomasi).
 */
object Palette {
    /** Brend — Sherset ERP indigosi (webdagi ACCOUNT tender rangi bilan bir oila). */
    val Primary = Color(0xFF3F51B5)
    val PrimaryDark = Color(0xFF2C3A94)
    val OnPrimary = Color(0xFFFFFFFF)
    val PrimaryContainer = Color(0xFFE2E6FB)
    val OnPrimaryContainer = Color(0xFF1A2370)

    /** Skan/harakat urg'usi — terminalning sariq apparat tugmasiga hamohang. */
    val Accent = Color(0xFFF59E0B)
    val OnAccent = Color(0xFF231A00)

    val Success = Color(0xFF15803D)
    val SuccessContainer = Color(0xFFDCFCE7)
    val Warning = Color(0xFFB45309)
    val WarningContainer = Color(0xFFFEF3C7)
    val Danger = Color(0xFFB91C1C)
    val DangerContainer = Color(0xFFFEE2E2)

    val Bg = Color(0xFFF4F5F9)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceMuted = Color(0xFFEDEFF5)
    val Border = Color(0xFFD8DCE8)
    val Text = Color(0xFF1B1F2E)
    val TextMuted = Color(0xFF5B6172)

    /** Yacheyka kodi plashkasi — mono, ko'k fon. */
    val CellBg = Color(0xFFE0EAFF)
    val CellText = Color(0xFF1D4ED8)
}

private val ColorScheme = lightColorScheme(
    primary = Palette.Primary,
    onPrimary = Palette.OnPrimary,
    primaryContainer = Palette.PrimaryContainer,
    onPrimaryContainer = Palette.OnPrimaryContainer,
    secondary = Palette.Accent,
    onSecondary = Palette.OnAccent,
    background = Palette.Bg,
    onBackground = Palette.Text,
    surface = Palette.Surface,
    onSurface = Palette.Text,
    surfaceVariant = Palette.SurfaceMuted,
    onSurfaceVariant = Palette.TextMuted,
    outline = Palette.Border,
    error = Palette.Danger,
    errorContainer = Palette.DangerContainer,
)

private val TsdTypography = Typography(
    // Sarlavha — ekran nomi.
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
    // Asosiy matn — 4" ekranda qo'l uzunligidan o'qiladi.
    bodyLarge = TextStyle(fontSize = 17.sp),
    bodyMedium = TextStyle(fontSize = 15.sp),
    labelLarge = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
)

private val TsdShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
)

@Composable
fun SersetTsdTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ColorScheme,
        typography = TsdTypography,
        shapes = TsdShapes,
        content = content,
    )
}
