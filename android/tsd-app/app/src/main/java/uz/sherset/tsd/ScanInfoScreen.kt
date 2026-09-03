package uz.sherset.tsd

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * G6.4 — SKAN-MA'LUMOT EKRANI: tovar nomi, qoldiq, yacheykalar. **NARXSIZ.**
 *
 * 🔴 Narxning yo'qligi bu ekranning intizomi EMAS, SERVER SHARTNOMASI:
 * ekran `GET /tsd/scan` dan foydalanadi va u narx qaytarmaydi (ustunlar OQ
 * RO'YXAT bilan tanlangan — `tsd-scan.ts`), `/products` esa TSD sessiyasiga
 * umuman yopiq (`tsd-policy.ts`). Ya'ni terminalni qo'lga kiritgan odam
 * `curl` bilan ham kirim narxini ololmaydi.
 *
 * Bu ekran hech nimani O'ZGARTIRMAYDI — u «bu nima va qayerda» savoliga
 * javob. Ko'chirish uchun alohida ekran bor (`PlaceScreen`).
 */
class ScanInfoScreen(
    private val shell: Shell,
    private val hit: JSONObject,
) : Screen {

    override fun title(shell: Shell): String = shell.str(R.string.scan_info_title)

    @Composable
    override fun Content() {
        val products = hit.optJSONArray("products") ?: JSONArray()

        when (hit.optString("kind")) {
            // K-reja 7.3 — bo'lak kodi tovar tanlovini HECH QACHON ochmaydi:
            // yorliq akkaunt ichida UNIKAL, ya'ni multi-hit bo'lishi mumkin
            // emas. K1–K3 davrida bu yerda «hali qo'llab-quvvatlanmaydi»
            // yozuvi turardi; K4 dan boshlab bo'lakning O'ZI ko'rsatiladi.
            "piece" -> PieceCard()
            "none" -> EmptyState(stringResource(R.string.scan_none))
            else -> {
                if (products.length() > 1) {
                    SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
                        Text(
                            stringResource(R.string.scan_multi),
                            style = MaterialTheme.typography.titleMedium,
                            color = Palette.Warning,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                }
                for (i in 0 until products.length()) {
                    val p = products.optJSONObject(i) ?: continue
                    ProductCard(p)
                    Spacer(Modifier.height(10.dp))
                }
            }
        }

        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    /**
     * K4 — skanerlangan `BLK-` yorlig'i: bo'lakning uzunligi, joyi va tovari.
     * NARX YO'Q (bo'lakda narx tushunchasi umuman yo'q).
     */
    @Composable
    private fun PieceCard() {
        val piece = hit.optJSONObject("piece")
        if (piece == null || !piece.optBoolean("found")) {
            EmptyState(stringResource(R.string.scan_piece_not_found))
            return
        }
        SectionCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CellBadge(piece.optString("label"))
                Text(
                    piece.optString("length"),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                piece.optJSONObject("product")?.optString("name").orEmpty(),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(6.dp))
            InfoRow(
                label = piece.optString("storeName"),
                value = piece.optString("cellName").ifEmpty { stringResource(R.string.no_cell) },
            )
        }
        if (piece.optBoolean("reserved")) {
            // Boshqa chek uchun ajratilgan bo'lak — omborchi buni BILISHI kerak,
            // aks holda uni ikkinchi mijozga kesib yuborardi.
            Spacer(Modifier.height(10.dp))
            SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
                Text(
                    stringResource(R.string.scan_piece_reserved),
                    color = Palette.Warning,
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }
        if (piece.optString("status") != "active") {
            Spacer(Modifier.height(10.dp))
            SectionCard(tint = Palette.SurfaceMuted) {
                Text(stringResource(R.string.scan_piece_closed), color = Palette.TextMuted)
            }
        }
        Spacer(Modifier.height(10.dp))
    }

    @Composable
    private fun ProductCard(p: JSONObject) {
        SectionCard {
            Text(p.optString("name"), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.scan_total, p.optString("totalQty")),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(10.dp))

            val cells = p.optJSONArray("cells") ?: JSONArray()
            if (cells.length() == 0) {
                // Yacheykasiz qoldiq — jonlida bu ODATIY hol (qoldiqning
                // aksariyati hali yacheykaga biriktirilmagan). Uy-yacheyka bo'lsa
                // u TAVSIYA sifatida ko'rsatiladi, «shu yerda turibdi» deb emas.
                val home = p.optString("homeCell")
                Text(
                    if (home.isEmpty()) stringResource(R.string.scan_no_cells)
                    else stringResource(R.string.scan_home_cell, home),
                    color = Palette.TextMuted,
                )
                return@SectionCard
            }
            for (i in 0 until cells.length()) {
                val c = cells.optJSONObject(i) ?: continue
                Row(
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CellBadge(c.optString("cellName"))
                    Text(
                        c.optString("qty") + "  ·  " + c.optString("storeName"),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        }
    }
}
