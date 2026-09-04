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
 * G6.2 — JOYLASHTIRISH / KO'CHIRISH.
 *
 * Oqim uch skandan iborat va u ATAYLAB shunday: omborchi qo'lida terminal,
 * u yozmaydi — skanerlaydi.
 *   1) TOVAR shtrixi   → tovar (multi-hit bo'lsa tanlov);
 *   2) MANBA           → tovarning mavjud yacheykalaridan biri, yoki
 *                        «yacheykasiz qoldiq» (hovuz/Taqsimlanmagan);
 *   3) MAQSAD yacheyka → yorlig'ini skanerlash;
 *   4) miqdor          → yuborish.
 *
 * 🔴 ESKI `__yacheyka` SATRIGA YOZILMAYDI (reja G6.2 ning aniq bandi). Ekran
 * FAQAT yangi qatlam endpointlariga boradi:
 *   · manba yacheyka bo'lsa  → `POST /products/:id/cell-move`;
 *   · yacheykasiz qoldiq bo'lsa → `POST /products/:id/cell-place`
 *     (u o'z ombori → hovuz → uy tartibida oladi — F7 `pool-placement.ts`).
 * `cell-rebind` (uy-yacheykasini o'zgartirish) TSD allowlist'ida UMUMAN yo'q:
 * u tovar KARTASINI tahrirlaydi, terminal ishi emas.
 *
 * 🔴 RUXSAT: bu ikki marshrut G6 da `storecell.update` ga tushirildi, ya'ni
 * kichik omborchi ularni bajara oladi. OMBORLARARO ko'chirish (hovuzdan
 * tashqari) esa hamon `store.update` talab qiladi — server 403 beradi va
 * ekran shu xabarni ko'rsatadi (`product-cell-move-scope.ts`).
 */
class PlaceScreen(private val shell: Shell) : Screen {

    private var product by mutableStateOf<JSONObject?>(null)

    /** Manba: `null` = yacheykasiz qoldiq (`cell-place`). */
    private var fromCell by mutableStateOf<JSONObject?>(null)
    private var toCell by mutableStateOf<JSONObject?>(null)

    /** Manba TANLANDIMI — `fromCell = null` ikki xil ma'noni bildirardi. */
    private var sourceChosen by mutableStateOf(false)

    private var qty by mutableStateOf("")

    override fun title(shell: Shell): String = shell.str(R.string.place_title)

    @Composable
    override fun Content() {
        val p = product

        StepHeader(1, stringResource(R.string.place_step_product), active = p == null)
        Spacer(Modifier.height(8.dp))

        if (p == null) {
            SectionCard { Text(stringResource(R.string.place_need_product), color = Palette.TextMuted) }
            Spacer(Modifier.height(10.dp))
            // T3 — shtrixi yirtilgan tovarni NOMIDAN topish. Bosqichning o'zi
            // o'zgarmaydi: natija `product` ga tushadi va oqim odatdagidek
            // 2-bosqichga (manba tanlash) o'tadi.
            SecondaryButton(text = stringResource(R.string.search_open)) {
                shell.go(
                    SearchScreen(shell) { hit ->
                        product = hit
                        shell.back()
                    },
                )
            }
            Spacer(Modifier.height(10.dp))
            SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
                shell.back()
            }
            return
        }

        SectionCard {
            Text(p.optString("name"), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.place_total, p.optString("totalQty")),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyLarge,
            )
        }
        Spacer(Modifier.height(12.dp))

        StepHeader(2, stringResource(R.string.place_step_source), active = !sourceChosen)
        Spacer(Modifier.height(8.dp))

        if (!sourceChosen) {
            val cells = p.optJSONArray("cells") ?: JSONArray()
            for (i in 0 until cells.length()) {
                val c = cells.optJSONObject(i) ?: continue
                SectionCard(
                    modifier = Modifier.clickable {
                        fromCell = c
                        sourceChosen = true
                    },
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CellBadge(c.optString("cellName"))
                        Text(c.optString("qty"), fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            // Yacheykasiz qoldiq — F7 ning kundalik oqimi («Taqsimlanmagan»dan
            // haqiqiy omborga joylashtirish). Yacheyka kesimi bo'sh bo'lsa ham
            // bu yo'l ochiq bo'lishi SHART: jonlida qoldiqning aksariyati
            // yacheykasiz (jonli-holat reyestri, E1).
            SecondaryButton(text = stringResource(R.string.place_source_unassigned)) {
                fromCell = null
                sourceChosen = true
            }
            Spacer(Modifier.height(10.dp))
            SecondaryButton(text = stringResource(R.string.restart), color = Palette.TextMuted) {
                reset()
            }
            return
        }

        SectionCard {
            InfoRow(
                label = stringResource(R.string.place_source),
                value = fromCell?.optString("cellName")
                    ?: stringResource(R.string.place_source_unassigned),
            )
        }
        Spacer(Modifier.height(12.dp))

        val target = toCell
        StepHeader(3, stringResource(R.string.place_step_target), active = target == null)
        Spacer(Modifier.height(8.dp))

        if (target == null) {
            SectionCard { Text(stringResource(R.string.place_need_cell), color = Palette.TextMuted) }
            Spacer(Modifier.height(10.dp))
            SecondaryButton(text = stringResource(R.string.restart), color = Palette.TextMuted) {
                reset()
            }
            return
        }

        SectionCard(tint = Palette.SuccessContainer, border = Palette.Success) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.place_target), color = Palette.TextMuted)
                CellBadge(target.optString("name"))
            }
            Spacer(Modifier.height(12.dp))
            NumberField(
                value = qty,
                onChange = { qty = it },
                label = stringResource(R.string.place_qty_hint),
                expression = true,
            )
            Spacer(Modifier.height(12.dp))
            PrimaryButton(
                text = stringResource(R.string.place_save),
                color = Palette.Success,
                // T5 — «bo'sh emas» o'rniga «hisoblanadi» (sabab maydon ostida).
                enabled = QtyExpression.qty(qty) != null,
            ) { submit(qty) }
        }
        Spacer(Modifier.height(10.dp))
        SecondaryButton(text = stringResource(R.string.restart), color = Palette.TextMuted) {
            reset()
        }
    }

    private fun reset() {
        product = null
        fromCell = null
        toCell = null
        sourceChosen = false
        qty = ""
    }

    /**
     * Skan bosqichga qarab talqin qilinadi. Tovar kutilayotganda YACHEYKA
     * kodi kelsa (yoki aksincha) ilova buni AYTADI va jimgina noto'g'ri
     * bosqichga o'tmaydi.
     */
    override fun onScan(code: String): Boolean {
        shell.io {
            val hit = shell.api.scan(code)
            val kind = hit.optString("kind")
            when {
                product == null && kind == "product" -> {
                    val products = hit.optJSONArray("products") ?: JSONArray()
                    shell.main {
                        // T4 — tovar tanildi (bittami, ko'pmi): qisqa signal.
                        // Xabar YO'Q, chunki natija ekranning O'ZIDA
                        // ko'rinadi (bosqich oldinga siljiydi yoki tanlov
                        // ro'yxati ochiladi).
                        Feedback.ok()
                        if (products.length() == 1) {
                            product = products.getJSONObject(0)
                        } else {
                            shell.go(
                                PickProductScreen(shell, products) { p ->
                                    product = p
                                    shell.back()
                                },
                            )
                        }
                    }
                }
                product == null && kind == "piece" -> shell.error(R.string.scan_piece)
                product == null -> shell.error(R.string.place_need_product)
                kind == "cell" -> {
                    val resp = shell.api.cellByBarcode(code)
                    val cells = resp.optJSONArray("cells") ?: JSONArray()
                    shell.main {
                        when (cells.length()) {
                            0 -> shell.error(R.string.cell_not_found)
                            // Bir yorliq ikki javonda bo'lsa ilova TANLAMAYDI —
                            // yacheyka aralashishi qoldiqni noto'g'ri joyga
                            // yozardi va uni keyin topib bo'lmasdi.
                            1 -> {
                                // T4 — maqsad yacheyka qabul qilindi.
                                Feedback.ok()
                                toCell = cells.getJSONObject(0)
                            }
                            else -> shell.error(R.string.cell_ambiguous)
                        }
                    }
                }
                else -> shell.error(R.string.place_need_cell)
            }
        }
        return true
    }

    private fun submit(input: String) {
        val p = product ?: return
        val target = toCell ?: return
        // 🔴 T5 — ifoda SHU YERDA songa aylanadi: `payload` ga ham, oflayn
        // navbatning YORLIG'IGA ham aynan shu son tushadi (ifoda matni EMAS —
        // aks holda navbatdagi amal server regexidan o'tmasdi).
        val qty = QtyExpression.qty(input)
        if (qty == null) {
            shell.error(if (input.isBlank()) R.string.place_qty_hint else R.string.qty_invalid)
            return
        }
        val productId = p.optString("id")
        val opId = UUID.randomUUID().toString()
        val src = fromCell

        val path: String
        val payload: JSONObject
        val label: String
        if (src != null) {
            path = "/products/$productId/cell-move"
            payload = JSONObject()
                .put("storeId", src.optString("storeId"))
                .put("fromCellId", src.optString("cellId"))
                .put("toCellId", target.optString("id"))
                .put("qty", qty)
                .put("clientOpId", opId)
            label = shell.str(R.string.op_cell_move) + " · " + target.optString("name") + " · " + qty
        } else {
            path = "/products/$productId/cell-place"
            payload = JSONObject()
                .put("toCellId", target.optString("id"))
                .put("qty", qty)
                .put("clientOpId", opId)
            label = shell.str(R.string.op_cell_place) + " · " + target.optString("name") + " · " + qty
        }

        shell.io {
            try {
                shell.api.send("POST", path, payload)
                shell.main {
                    shell.success(shell.str(R.string.place_saved))
                    reset()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.retriable) {
                    shell.enqueue("POST", path, payload, label)
                    shell.main { reset() }
                } else {
                    shell.error(e.message ?: "")
                }
            }
        }
    }
}
