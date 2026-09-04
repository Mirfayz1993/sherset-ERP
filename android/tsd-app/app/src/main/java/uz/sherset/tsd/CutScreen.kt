package uz.sherset.tsd

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * K4 — BO'LINADIGAN TOVAR KESIMI (kabel/sim/shlang).
 * Reja: `docs/plans/2026-08-25-bolinadigan-tovar-bolak-hisobi.md`, K4 fazasi.
 *
 * Oqim (K-reja 5-bo'lim, 3-qadam): manba bo'lakni tanlash yoki `BLK-`
 * YORLIG'INI SKANERLASH → kesilgan uzunlik → qolgan uzunlik (tizim taklif
 * qiladi, omborchi tuzatadi) → server yangi yorliqlarni qaytaradi.
 *
 * 🔴 QOLDIQQA TEGMAYDI. Kesim STOK-NEYTRAL: 250 m «180 + 70» bo'ladi, jami
 * o'sha 250. Ombordagi qoldiq faqat kassada, TO'LOV paytida kamayadi. Chiqindi
 * (1 m dan kalta) va o'lchov farqi ham faqat REYESTRDAN chiqadi — qoldiq
 * o'z holicha qoladi (egasining 2026-08-25 qarori).
 *
 * 🔴 OFLAYN NAVBATGA QO'YILMAYDI — `CountScreen` (sanash) bilan AYNI sabab,
 * lekin boshqa dalil: yorliq RAQAMINI server beradi (`BLK-000041`), ya'ni
 * aloqasiz kesimni yozib bo'lmaydi — omborchi bosadigan yorliqda raqam
 * bo'lmasdi. Kesimning butun ma'nosi esa yorliqda (reja 5-bo'lim: «har kesim
 * yorliq bosilishi bilan tugaydi»). Shuning uchun aloqa yo'q bo'lsa ekran
 * SHUNI AYTADI va kiritilgan sonlar joyida turadi — jim yo'qotish yo'q (IS-5).
 *
 * Bo'laklar ro'yxati topshiriq javobidan keladi (`lines[].pieceOptions`) —
 * `/stock-pieces` TSD'ga OCHIQ EMAS (u `piecetracking` ruxsatini talab qiladi
 * va kichik omborchida u yo'q, K-Q9). Skanerlangan yorliq ham SHU ro'yxatdan
 * topiladi: qo'shimcha so'rov ham, yangi ruxsat ham kerak emas.
 */
class CutScreen(
    private val shell: Shell,
    private val taskId: String,
    private val line: JSONObject,
) : Screen {

    /** Tanlangan manba (skan yoki ro'yxatdan bosish). */
    private var source by mutableStateOf<JSONObject?>(null)
    private var cutLength by mutableStateOf("")
    private var remaining by mutableStateOf("")

    override fun title(shell: Shell): String = shell.str(R.string.cut_title)

    @Composable
    override fun Content() {
        val options = line.optJSONArray("pieceOptions") ?: JSONArray()

        SectionCard {
            Text(line.optString("productName"), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            InfoRow(label = stringResource(R.string.cut_need_label), value = needText())

            // Kassirning mijoz bilan kelishuvi («150 + 30») — omborchi nimani
            // kesishini SHU qatordan biladi (K3 da u faqat savatda qolardi).
            val agreed = line.optJSONArray("agreedLengths") ?: JSONArray()
            if (agreed.length() > 1) {
                val parts = (0 until agreed.length()).joinToString(" + ") { agreed.optString(it) }
                InfoRow(label = stringResource(R.string.cut_agreed_label), value = parts)
            }
        }
        Spacer(Modifier.height(12.dp))

        val src = source
        if (src == null) {
            Text(
                stringResource(R.string.cut_pick_source),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(8.dp))
            if (options.length() == 0) {
                EmptyState(stringResource(R.string.cut_no_pieces))
            }
            for (i in 0 until options.length()) {
                val p = options.optJSONObject(i) ?: continue
                SectionCard(modifier = Modifier.clickable { pick(p) }) { PieceRow(p) }
                Spacer(Modifier.height(8.dp))
            }
            SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
                shell.back()
            }
            return
        }

        SectionCard(tint = Palette.PrimaryContainer, border = MaterialTheme.colorScheme.primary) {
            PieceRow(src)
        }
        Spacer(Modifier.height(12.dp))

        SectionCard {
            NumberField(
                value = cutLength,
                onChange = { cutLength = it },
                label = stringResource(R.string.cut_length_hint),
            )
            Spacer(Modifier.height(10.dp))
            NumberField(
                value = remaining,
                onChange = { remaining = it },
                label = stringResource(R.string.cut_remaining_hint),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.cut_remaining_note),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(12.dp))
            PrimaryButton(
                text = stringResource(R.string.cut_submit),
                color = Palette.CellText,
                enabled = cutLength.trim().isNotEmpty(),
            ) { send(cutLength.trim(), remaining.trim()) }
        }
        Spacer(Modifier.height(10.dp))
        SecondaryButton(text = stringResource(R.string.cut_change_source)) { source = null }
        Spacer(Modifier.height(8.dp))
        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    /** «BLK-000041 · 250 · 02-01-03-04» (butun rulonda yorliq YO'Q — K-Q3). */
    @Composable
    private fun PieceRow(p: JSONObject) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CellBadge(p.optString("label").ifEmpty { stringResource(R.string.cut_whole_roll) })
            Text(
                p.optString("length"),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            p.optString("cellName").ifEmpty { stringResource(R.string.no_cell) },
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyMedium,
        )
    }

    /**
     * Skan — manba tanlash. Yorliq SHU qatorning bo'laklari orasidan
     * qidiriladi: boshqa tovarning yorlig'i skanerlansa ekran ANIQ xato
     * beradi va jimgina noto'g'ri bo'lakni tanlamaydi (K-reja 7.3).
     */
    override fun onScan(code: String): Boolean {
        val options = line.optJSONArray("pieceOptions") ?: JSONArray()
        val wanted = code.trim().uppercase()
        for (i in 0 until options.length()) {
            val p = options.optJSONObject(i) ?: continue
            if (p.optString("label").uppercase() == wanted) {
                // T4 — bo'lak yorlig'i shu qatorda topildi.
                Feedback.ok()
                pick(p)
                return true
            }
        }
        shell.error(R.string.cut_piece_not_in_line)
        return true
    }

    private fun pick(p: JSONObject) {
        source = p
        // Sukut — hali QOPLANMAGAN miqdor: eng ko'p uchraydigan holat «mijoz
        // so'raganini bitta bo'lakdan kesish».
        cutLength = needText()
    }

    /** Hali qoplanmagan miqdor: qator miqdori − kesilgan bo'laklar. */
    private fun needText(): String {
        val quantity = line.optString("quantity").toDoubleOrNull() ?: 0.0
        val cutPieces = line.optJSONArray("cutPieces") ?: JSONArray()
        var done = 0.0
        for (i in 0 until cutPieces.length()) {
            done += cutPieces.optJSONObject(i)?.optString("length")?.toDoubleOrNull() ?: 0.0
        }
        val need = quantity - done
        return if (need <= 0) "0" else trim(need)
    }

    private fun trim(v: Double): String =
        if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

    private fun send(cut: String, remainingInput: String) {
        val src = source ?: return
        if (cut.isEmpty()) {
            shell.error(R.string.cut_length_hint)
            return
        }
        val opId = UUID.randomUUID().toString()
        shell.io {
            try {
                val resp = shell.api.cut(
                    taskId,
                    line.optString("id"),
                    src.optString("id"),
                    null,
                    cut,
                    remainingInput.ifEmpty { null },
                    opId,
                )
                val labels = resp.optJSONArray("labels") ?: JSONArray()
                shell.main {
                    // Yorliq TERMINALDA bosilmaydi (unga printer ulanmagan) —
                    // ekran raqamlarni ko'rsatadi va omborchi ularni katta
                    // omborchi ekranidan (K2/web) bosadi. Reja 5-bo'limining
                    // «yorliq bilan tugaydi» sharti shu bilan bajariladi:
                    // raqam BERILGAN va u bo'lakda yozilgan.
                    val text = (0 until labels.length()).joinToString(", ") { labels.optString(it) }
                    shell.success(
                        if (text.isEmpty()) shell.str(R.string.cut_saved)
                        else shell.str(R.string.cut_saved_labels, text),
                    )
                    shell.back()
                }
            } catch (e: ApiClient.ApiException) {
                // Oflayn navbat YO'Q (sinf izohi): yorliq raqamini server
                // beradi, ya'ni aloqasiz kesim yozib bo'lmaydi.
                shell.error(
                    if (e.retriable) shell.str(R.string.cut_offline) else (e.message ?: ""),
                )
            }
        }
    }
}
