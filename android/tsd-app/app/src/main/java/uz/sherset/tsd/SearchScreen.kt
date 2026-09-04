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
import org.json.JSONArray
import org.json.JSONObject

/**
 * T3 — NOM / ARTIKUL BO'YICHA QIDIRUV.
 *
 * 🔴 NEGA BOR (jonli hodisa, 2026-09-03). Omborchi bo'sh yacheykada tiqilib
 * qoldi: `/tsd/scan` faqat AYNAN moslik qiladi, ya'ni shtrixi yirtilgan,
 * yorlig'i o'chgan yoki shtrixi bazaga umuman kiritilmagan tovarni terminal
 * TOPA OLMASDI va boshqa yo'l yo'q edi. Endi u nomini yozib topadi.
 *
 * 🔴 NARX YO'Q va bu ekranning intizomi EMAS, server shartnomasi: ekran
 * `GET /tsd/search` ga boradi, u `TSD_PRODUCT_SELECT` oq ro'yxati ustida
 * ishlaydi va `/products` TSD sessiyasiga umuman yopiq (`tsd-policy.ts`).
 *
 * 🔴 MULTI-HIT qoidasi kuchda: ekran HECH QACHON o'zi tovar tanlamaydi,
 * bitta natija qaytganda ham ro'yxat ko'rsatiladi va bosishni ODAM qiladi.
 * Qidiruv ataylab noaniq — «bitta topildi, demak o'shadir» degan xulosa bu
 * yerda skanerdagidan ham xavfliroq bo'lardi.
 *
 * 🔴 AVTO-YUBORISH YO'Q (T2 qoidasi): maydon odam yozadigan matn uchun,
 * shuning uchun so'rov faqat «Qidirish» tugmasi yoki klaviaturaning tasdiq
 * tugmasi bilan ketadi. `ScanBar` ning 350 ms zaxirasi bu yerda umuman
 * ishlamaydi — u boshqa vidjet.
 *
 * Ekran hech nimani O'ZGARTIRMAYDI — u faqat tovar tanlaydi va uni
 * chaqiruvchiga (`onPick`) beradi.
 */
class SearchScreen(
    private val shell: Shell,
    private val onPick: (JSONObject) -> Unit,
) : Screen {

    private var query by mutableStateOf("")
    private var results by mutableStateOf(JSONArray())
    private var busy by mutableStateOf(false)

    /** Qidiruv BO'LDIMI — «Topilmadi» birinchi ochilishda chiqmasin. */
    private var searched by mutableStateOf(false)

    /** Server ro'yxatni kesdimi (30 dan ko'p mos keldi). */
    private var truncated by mutableStateOf(false)

    override fun title(shell: Shell): String = shell.str(R.string.search_title)

    @Composable
    override fun Content() {
        val ready = query.trim().length >= MIN_LEN

        SectionCard {
            PlainField(
                value = query,
                onChange = { query = it },
                label = stringResource(R.string.search_hint),
            )
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = stringResource(R.string.search_button),
                enabled = ready && !busy,
            ) { run() }
            if (!ready) {
                Spacer(Modifier.height(6.dp))
                // Tugma nega o'chiq turganini AYTAMIZ — jim o'chiq tugma
                // omborchiga «ilova osilib qoldi» bo'lib ko'rinadi.
                Text(
                    stringResource(R.string.search_min, MIN_LEN),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.TextMuted,
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        if (busy) {
            EmptyState(stringResource(R.string.scan_working))
            return
        }

        if (searched && results.length() == 0) {
            EmptyState(stringResource(R.string.search_none))
        }

        for (i in 0 until results.length()) {
            val p = results.optJSONObject(i) ?: continue
            // Bitta chizuvchi (`Widgets.kt`) — Multi-hit ekrani ham shundan
            // foydalanadi, ya'ni tovar ikki joyda bir xil ko'rinadi.
            ProductHitCard(p) { onPick(p) }
            Spacer(Modifier.height(10.dp))
        }

        if (truncated) {
            // 🔴 Jim kesish IS-5 klassi bo'lardi: omborchi «bazada boshqa yo'q»
            // deb o'ylab, bor tovarni qaytadan kiritib yuborardi.
            SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
                Text(
                    stringResource(R.string.search_truncated, results.length()),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.Warning,
                )
            }
            Spacer(Modifier.height(10.dp))
        }

        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    private fun run() {
        val q = query.trim()
        if (q.length < MIN_LEN) return
        busy = true
        shell.io {
            try {
                val resp = shell.api.search(q)
                shell.main {
                    results = resp.optJSONArray("products") ?: JSONArray()
                    truncated = resp.optBoolean("truncated")
                    searched = true
                    busy = false
                }
            } catch (e: ApiClient.ApiException) {
                // Xato holatida `busy` ALBATTA tushiriladi, aks holda ekran
                // «Qidirilmoqda…» da qotib qolardi va tugma ham o'chiq turardi.
                shell.main { busy = false }
                shell.toast(e.message ?: "")
            }
        }
    }

    private companion object {
        /**
         * Serverdagi `SEARCH_MIN_LEN` ning ilova tomondagi aksi. Ikki joyda
         * turgani ataylab: server QULF (u yerda 400), ilova esa tugmani
         * oldindan o'chirib omborchini bekorga so'rov yuborishdan saqlaydi.
         */
        const val MIN_LEN = 2
    }
}
