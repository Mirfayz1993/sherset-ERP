package uz.sherset.tsd

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/**
 * Umumiy vidjetlar — G5 `Ui.kt` ning Compose merosxo'ri.
 *
 * Tegish nishonlari 56–64dp (`Ui.kt`/`dimens.xml` dagi qaror saqlanadi):
 * omborchi qo'lqopda, harakatda va sovuq omborda ishlaydi.
 */

/** Asosiy amal — 64dp, to'liq en. */
@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = MaterialTheme.colorScheme.primary,
    onColor: Color = MaterialTheme.colorScheme.onPrimary,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().heightIn(min = 64.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = onColor),
    ) {
        Text(text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Ikkinchi darajali amal — 56dp, konturli. */
@Composable
fun SecondaryButton(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
    ) {
        Text(text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
    }
}

/** Kartochka — ekran bo'limlarining asosiy idishi. */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.surface,
    border: Color = Palette.Border,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = tint),
        border = androidx.compose.foundation.BorderStroke(1.dp, border),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp), content = content)
    }
}

/**
 * 🔴 T4 — XATO BANNERI (toast o'rniga).
 *
 * Toast 4" terminal ekranida ko'zdan qochadi: omborchi tovarga qarab turadi
 * va 2 soniyalik xabar u boshini ko'targanda allaqachon yo'q bo'ladi. Xato
 * esa AYNAN ko'rinishi kerak — aks holda «saqlanmadi» jimgina yo'qoladi
 * (IS-5 klassi). Banner ekran tepasida turadi, matn to'liq o'qiladi va
 * bosilganda yopiladi; o'zi ham bir necha soniyadan keyin ketadi
 * (`MainActivity.ERROR_BANNER_MS`).
 *
 * Butun banner bosiladigan: 4" ekranda kichkina ✕ ga tegish qiyin, shuning
 * uchun ✕ — faqat KO'RSATKICH, tegish nishoni esa butun kartochka
 * (`Ui.kt` dagi 56dp qoidasidan ham kattaroq).
 */
@Composable
fun ErrorBanner(text: String, modifier: Modifier = Modifier, onDismiss: () -> Unit) {
    SectionCard(
        modifier = modifier.clickable { onDismiss() },
        tint = Palette.DangerContainer,
        border = Palette.Danger,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("⛔", fontSize = 20.sp)
            Spacer(Modifier.width(10.dp))
            Text(
                text,
                modifier = Modifier.weight(1f),
                color = Palette.Danger,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.width(10.dp))
            Text("✕", color = Palette.Danger, fontSize = 20.sp)
        }
    }
}

/** Yacheyka kodi plashkasi: `01-02-03-05` — mono, ko'k. */
@Composable
fun CellBadge(code: String, modifier: Modifier = Modifier) {
    Text(
        code,
        modifier = modifier
            .background(Palette.CellBg, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
        color = Palette.CellText,
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
    )
}

/** Holat plashkasi (chip) — tur/holat belgilarida. */
@Composable
fun Pill(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier
            .background(bg, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        color = fg,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

/** Bosqich sarlavhasi: to'ldirilgan doira raqam + matn (Joylashtirish oqimi). */
@Composable
fun StepHeader(step: Int, text: String, active: Boolean, modifier: Modifier = Modifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .background(
                    if (active) MaterialTheme.colorScheme.primary else Palette.SurfaceMuted,
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                step.toString(),
                color = if (active) Color.White else Palette.TextMuted,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
            )
        }
        Text(
            text,
            modifier = Modifier.padding(start = 10.dp),
            style = MaterialTheme.typography.titleMedium,
            color = if (active) Palette.Text else Palette.TextMuted,
        )
    }
}

/** Bo'sh holat — markazda katta muted matn. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth().padding(vertical = 40.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * Raqam maydoni — miqdor/uzunlik uchun.
 *
 * `KeyboardType.Decimal`: miqdor kasrli bo'lishi mumkin (kabel metri, kilogramm).
 * Terminalning fizik raqam klaviaturasi ham shu maydonga yozadi.
 */
@Composable
fun NumberField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
        singleLine = true,
        label = { Text(label) },
        textStyle = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = Palette.Border,
        ),
    )
}

/** Oddiy matn maydoni (izoh). */
@Composable
fun PlainField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
        singleLine = true,
        label = { Text(label) },
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = Palette.Border,
        ),
    )
}

/**
 * `/tsd/scan` va `/tsd/search` qaytaradigan TOVAR elementining YAGONA
 * chizuvchisi (T3).
 *
 * Ikkala sirt serverda AYNI funksiyadan (`TsdService.buildProductHits`)
 * chiqadi va bitta test shuni qulflaydi — demak ilovada ham bitta chizuvchi
 * bo'lishi kerak. Aks holda bir tovar Multi-hit ekranida bir xil, Qidiruv
 * ekranida boshqacha ko'rinardi va omborchi ularni bir tovar deb tanimasdi.
 *
 * 🔴 NARX YO'Q va bu ekranning intizomi emas: bu shaklda narx maydoni
 * umuman yo'q (`TSD_PRODUCT_SELECT` oq ro'yxati).
 */
@Composable
fun ProductHitCard(p: JSONObject, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val article = p.optString("article")
    val archived = p.optBoolean("archived")
    SectionCard(
        modifier = if (onClick == null) modifier else modifier.clickable { onClick() },
        tint = if (archived) Palette.SurfaceMuted else MaterialTheme.colorScheme.surface,
    ) {
        Text(p.optString("name"), style = MaterialTheme.typography.titleMedium)
        if (article.isNotEmpty()) {
            Text(
                stringResource(R.string.search_article, article),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
        }
        if (archived) {
            Text(
                stringResource(R.string.count_archived),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.Warning,
            )
        }
        Spacer(Modifier.height(6.dp))
        InfoRow(label = productWhere(p), value = p.optString("totalQty"))
    }
}

/**
 * Tovar QAYERDA: birinchi haqiqiy yacheyka, bo'lmasa uy-yacheykasi TAVSIYA
 * sifatida. «Yacheykada turibdi» va «uyi shu yerda» ni aralashtirmaslik —
 * `ScanInfoScreen` dagi mavjud qoidaning aynan o'zi (jonlida qoldiqning
 * aksariyati hali yacheykasiz).
 */
@Composable
private fun productWhere(p: JSONObject): String {
    val cells = p.optJSONArray("cells") ?: JSONArray()
    if (cells.length() > 0) {
        return cells.optJSONObject(0)?.optString("cellName").orEmpty()
    }
    val home = p.optString("homeCell")
    return if (home.isEmpty()) stringResource(R.string.no_cell)
    else stringResource(R.string.scan_home_cell, home)
}

/** Yorliq-qiymat qatori (skan-ma'lumot, kesim ekranlari). */
@Composable
fun InfoRow(label: String, value: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Palette.TextMuted, style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.End,
        )
    }
}
