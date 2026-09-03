package uz.sherset.tsd

import androidx.compose.foundation.clickable
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
            SectionCard(modifier = Modifier.clickable { onPicked(p) }) {
                Text(p.optString("name"), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                InfoRow(
                    label = whereText(p),
                    value = p.optString("totalQty"),
                )
            }
            Spacer(Modifier.height(10.dp))
        }

        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    /** Birinchi yacheyka, bo'lmasa uy-yacheykasi tavsiyasi. */
    @Composable
    private fun whereText(p: JSONObject): String {
        val cells = p.optJSONArray("cells") ?: JSONArray()
        if (cells.length() > 0) {
            return cells.optJSONObject(0)?.optString("cellName").orEmpty()
        }
        return p.optString("homeCell").ifEmpty { stringResource(R.string.no_cell) }
    }
}
