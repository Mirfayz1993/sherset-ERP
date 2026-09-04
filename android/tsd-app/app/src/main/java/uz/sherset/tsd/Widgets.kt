package uz.sherset.tsd

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.delay
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
 *
 * 🔴 T5 — [expression] = `true` bo'lganda IFODA REJIMI yoqiladi:
 *  - maydon ostida **tez tugmalar** qatori (`+ − × ( )`). Ular ZARUR, qulaylik
 *    emas: `KeyboardType.Decimal` klaviaturasida `*` tugmasi UMUMAN yo'q, ya'ni
 *    tugmalarsiz omborchi `12*24` ni yoza olmasdi;
 *  - tugmalar ostida natija qatori — «= 288» (yashil) yoki xato SABABI (qizil).
 *
 * Tartib ataylab shunday: maydon → tugmalar → natija. Natija tugmalar USTIGA
 * qo'yilsa, birinchi `×` bosilganda qator paydo bo'lib tugmalarni pastga
 * surardi va keyingi bosish adashardi. Natija esa Saqlash tugmasining ustida
 * turadi — ko'z aynan shu yo'ldan o'tadi.
 *
 * Ifodani hisoblash va tekshirish `QtyExpression` da (sof modul, testlari bor);
 * bu vidjet faqat CHIZADI — serverga son yuborish qarori ekranlarda.
 */
@Composable
fun NumberField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    expression: Boolean = false,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
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
        if (expression) {
            Spacer(Modifier.height(6.dp))
            QtyOperatorRow(value, onChange)
            QtyHint(value)
        }
    }
}

/**
 * Tez tugmalar: yorlig'i `×`, maydonga esa `*` yoziladi (omborchi matematika
 * belgisini ko'radi, `QtyExpression` esa ikkalasini ham tushunadi).
 *
 * Belgi matnning OXIRIGA qo'shiladi — kursor joyiga emas. Sabab: maydon
 * `String` ustida ishlaydi (`TextFieldValue` emas) va kursor holatini
 * bilmaydi; kalkulyator oqimi esa baribir chapdan o'ngga («12» → `×` → «24»).
 */
@Composable
private fun QtyOperatorRow(value: String, onChange: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for ((glyph, insert) in QTY_OPS) {
            OutlinedButton(
                onClick = { onChange(value + insert) },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                shape = RoundedCornerShape(12.dp),
                // Sukut ichki chekkasi 24dp — 4" ekranda beshta tugma sig'masdi.
                contentPadding = PaddingValues(0.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.Text),
            ) {
                Text(glyph, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** Yorliq → maydonga yoziladigan belgi. */
private val QTY_OPS = listOf(
    "+" to "+",
    "−" to "-",
    "×" to "*",
    "(" to "(",
    ")" to ")",
)

/**
 * Natija yoki xato sababi.
 *
 * Bo'sh maydonda hech nima chizilmaydi — bu xato emas (omborchi hali yozmagan),
 * saqlash tugmasi esa ilgarigidek o'chiq turadi. Sof raqamda ham qator yo'q:
 * «= 12» ni takrorlash 4" ekranda joy yeyishdan boshqa hech nima bermaydi.
 */
@Composable
private fun QtyHint(value: String) {
    when (val r = QtyExpression.parse(value)) {
        is QtyExpression.Result.Empty -> {}
        is QtyExpression.Result.Ok ->
            if (QtyExpression.isExpression(value)) {
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.qty_result, r.text),
                    color = Palette.Success,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        is QtyExpression.Result.Bad -> {
            Spacer(Modifier.height(4.dp))
            Text(
                "⛔ " + stringResource(qtyProblemRes(r.problem)),
                color = Palette.Danger,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** Sabab → matn. `QtyExpression` `R` ni ko'rmaydi (u JVM testidan chaqiriladi). */
private fun qtyProblemRes(p: QtyExpression.Problem): Int = when (p) {
    QtyExpression.Problem.SYNTAX -> R.string.qty_bad_syntax
    QtyExpression.Problem.DIVISION -> R.string.qty_bad_division
    QtyExpression.Problem.NEGATIVE -> R.string.qty_bad_negative
    QtyExpression.Problem.TOO_LONG -> R.string.qty_bad_long
    QtyExpression.Problem.TOO_BIG -> R.string.qty_bad_big
    QtyExpression.Problem.TOO_PRECISE -> R.string.qty_bad_precise
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

/**
 * 🔴 T10 — «OFLAYN MA'LUMOT» PLASHKASI.
 *
 * Ekranda kesh turganini AYTMASLIK mumkin emas: omborchi ko'rgan sonni
 * TIZIMDAGI son deb qabul qiladi va uning ustiga qaror quradi. Shuning
 * uchun plashka ikki narsani aytadi — ma'lumot ESKI ekanini va QANCHA
 * eski ekanini.
 *
 * Yosh JONLI: karta ekranda turgan sayin har 30 soniyada qayta hisoblanadi,
 * ya'ni «2 daq oldin» plashkasi omborchi javon oldida turganda ham to'g'ri
 * qoladi (aks holda u yozilgan paytdagi raqamda muzlab qolardi).
 */
@Composable
fun OfflineBadge(savedAt: Long, note: String? = null, modifier: Modifier = Modifier) {
    var now by remember(savedAt) { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(savedAt) {
        while (true) {
            delay(30_000L)
            now = System.currentTimeMillis()
        }
    }
    val text = when (val age = CacheShape.age(savedAt, now)) {
        is CacheShape.Age.Fresh -> stringResource(R.string.cache_fresh)
        is CacheShape.Age.Minutes -> stringResource(R.string.cache_minutes, age.n)
        is CacheShape.Age.Hours -> stringResource(R.string.cache_hours, age.n)
        // Ekranda turganda muddati o'tib ketdi — «qancha eski» degan raqam
        // endi yolg'on bo'lardi, shuning uchun faqat «juda eski» deyiladi.
        is CacheShape.Age.Expired -> stringResource(R.string.cache_expired)
    }
    SectionCard(modifier = modifier, tint = Palette.WarningContainer, border = Palette.Warning) {
        Text(
            text,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = Palette.Warning,
        )
        if (note != null) {
            Spacer(Modifier.height(4.dp))
            Text(note, style = MaterialTheme.typography.bodyMedium, color = Palette.TextMuted)
        }
    }
}
