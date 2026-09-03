package uz.sherset.tsd

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.util.UUID

/**
 * G6.1 — YETISHMOVCHILIK: «javonda shuncha topolmadim».
 *
 * 🔴 NEGA BU EKRAN BOR. Qator na tasdiqlanmasa, na yopilmasa topshiriq
 * abadiy ochiq qoladi ⇒ chek KONTROL NAVBATIGA TUSHMAYDI (G2 sharti:
 * hamma topshiriq yopiq) va kassir uni yopolmaydi. Ya'ni «belgisiz
 * yetishmovchilik» 2026-08-24 hodisasining boshqa shakli: tizim ishlayotgandek
 * ko'rinadi, kassa esa to'xtaydi.
 *
 * 🔴 CHEK TARKIBI BU YERDA O'ZGARMAYDI. Omborchi XABAR beradi, qarorni
 * KONTROL qabul qiladi (`control-edit`, faqat KAMAYTIRISH). Omborchining
 * o'zi chekni kamaytirsa mijoz to'lagan summa bilan tovar jimgina ajralardi.
 *
 * Miqdor MUTLAQ (delta emas) — oflayn navbat amalni qayta yuborsa ham
 * natija AYNI bo'lishi uchun (`planShortage` izohi).
 */
class ShortageScreen(
    private val shell: Shell,
    private val taskId: String,
    private val line: JSONObject,
) : Screen {

    // Sukut — TALAB QILINGAN miqdor: eng ko'p uchraydigan holat «umuman
    // topolmadim». Omborchi qisman topgan bo'lsa sonni kamaytiradi.
    private var qty by mutableStateOf(line.optString("quantity"))
    private var note by mutableStateOf("")

    override fun title(shell: Shell): String = shell.str(R.string.shortage_title)

    @Composable
    override fun Content() {
        SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
            CellBadge(line.optString("binLocation").ifEmpty { stringResource(R.string.no_cell) })
            Spacer(Modifier.height(8.dp))
            Text(line.optString("productName"), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.shortage_requested, line.optString("quantity")),
                style = MaterialTheme.typography.bodyLarge,
                color = Palette.TextMuted,
            )
        }
        Spacer(Modifier.height(10.dp))

        SectionCard {
            NumberField(
                value = qty,
                onChange = { qty = it },
                label = stringResource(R.string.shortage_qty_hint),
            )
            Spacer(Modifier.height(10.dp))
            PlainField(
                value = note,
                onChange = { note = it },
                label = stringResource(R.string.shortage_note_hint),
            )
            Spacer(Modifier.height(14.dp))
            PrimaryButton(
                text = stringResource(R.string.shortage_save),
                color = Palette.Warning,
                enabled = qty.trim().isNotEmpty(),
            ) { send(qty.trim(), note.trim()) }
        }
        Spacer(Modifier.height(10.dp))

        // «Topdim» — belgini olib tashlash (qty = 0). Omborchi keyin tovarni
        // topib olishi normal holat, ya'ni bu yo'l ochiq bo'lishi kerak.
        SecondaryButton(
            text = stringResource(R.string.shortage_clear),
            color = Palette.Success,
        ) { send("0", "") }
        Spacer(Modifier.height(8.dp))
        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    private fun send(qty: String, note: String) {
        if (qty.isEmpty()) {
            shell.toast(R.string.shortage_qty_hint)
            return
        }
        val lineId = line.optString("id")
        val opId = UUID.randomUUID().toString()
        val path = "/restock-tasks/$taskId/lines/$lineId/shortage"
        val payload = JSONObject().put("qty", qty).put("clientOpId", opId)
        if (note.isNotEmpty()) payload.put("note", note)

        shell.io {
            try {
                shell.api.send("POST", path, payload)
                shell.main {
                    shell.toast(R.string.shortage_saved)
                    shell.back()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.retriable) {
                    shell.enqueue("POST", path, payload, shell.str(R.string.op_shortage))
                    shell.main { shell.back() }
                } else {
                    shell.toast(e.message ?: "")
                }
            }
        }
    }
}
