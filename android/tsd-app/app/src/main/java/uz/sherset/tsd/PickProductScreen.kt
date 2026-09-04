package uz.sherset.tsd

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * MULTI-HIT TANLOVI — G-rejaning majburiy qoidasi.
 *
 * Sherset shtrixlari ATAYLAB unikal emas (ikkala rejaning 1-bo'limi): bir
 * shtrix bir necha tovarga tegishli bo'lishi mumkin. Shuning uchun ilova
 * HECH QACHON o'zi birortasini tanlamaydi — jimgina birinchisini olish
 * noto'g'ri tovarni ko'chirishga yoki noto'g'ri qatorni yopishga olib
 * kelardi va buni omborchi keyin topolmasdi.
 *
 * Ekran NARX ko'rsatmaydi — server ham bermaydi (`tsd-scan.ts` oq ro'yxati).
 */
class PickProductScreen(
    private val shell: Shell,
    private val products: JSONArray,
    private val onPicked: (JSONObject) -> Unit,
) : Screen {

    override fun title(shell: Shell): String = shell.str(R.string.scan_multi)

    @Composable
    override fun Content() {
        SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
            Text(
                stringResource(R.string.scan_multi),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.Warning,
            )
        }
        Spacer(Modifier.height(10.dp))

        for (i in 0 until products.length()) {
            val p = products.optJSONObject(i) ?: continue
            // T3 — chizish `Widgets.ProductHitCard` ga ko'chdi: Qidiruv ekrani
            // ham AYNI shaklni (`buildProductHits`) ko'rsatadi va ikki ekranda
            // bir tovar boshqacha ko'rinmasligi kerak. Xulq o'zgarmadi, ustiga
            // artikul va arxiv belgisi qo'shildi — multi-hit tanlovida aynan
            // ular ikki o'xshash tovarni ajratadi.
            ProductHitCard(p) { onPicked(p) }
            Spacer(Modifier.height(10.dp))
        }

        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }
}
