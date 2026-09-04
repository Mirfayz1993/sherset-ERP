package uz.sherset.manager

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Sherset Menejer dizayn tizimi — tsd-app 0.2.0 (`Theme.kt`) merosxo'ri.
 *
 * Planshet uchun moslashuvlar:
 *  - tegish nishonlari TSD'dagidek yirik qolmadi shart emas, lekin 56dp
 *    saqlanadi (barmoq bilan ishlash);
 *  - FAQAT YORUG' mavzu — hamma planshetda bir xil ko'rinish;
 *  - dinamik rang YO'Q.
 */
object Palette {
    /** Brend — Sherset ERP indigosi (TSD bilan bir oila). */
    val Primary = Color(0xFF3F51B5)
    val PrimaryDark = Color(0xFF2C3A94)
    val OnPrimary = Color(0xFFFFFFFF)
    val PrimaryContainer = Color(0xFFE2E6FB)
    val OnPrimaryContainer = Color(0xFF1A2370)

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

    /** Pul summasi plashkasi — mono emas, lekin alohida rang. */
    val MoneyText = Color(0xFF1D4ED8)
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

private val ManagerTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 17.sp),
    bodyMedium = TextStyle(fontSize = 15.sp),
    labelLarge = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
)

private val ManagerShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
)

@Composable
fun SersetManagerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ColorScheme,
        typography = ManagerTypography,
        shapes = ManagerShapes,
        content = content,
    )
}
