package uz.sherset.manager

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.util.Calendar

/**
 * MK19 — brifing ekrani: `GET /manager/briefing/:kind`
 * (`manager-briefing.controller.ts`, ruxsat `report.view`).
 *
 * Javob: `{kind, businessDate, generatedAt, currency, blocks[], summary}`.
 * Blok: `{key, role(signal|measure), count|null, amountMinor|null, attention}`.
 *
 * 🔴 Server shartnomasi (day-briefing.ts): `count: null` = O'LCHANMADI,
 * `0` EMAS — ekranda «—» chiqadi va «tinch kun» deyilmaydi. Bu ilova o'sha
 * farqni YO'QOTMAYDI.
 */
class BriefingScreen(private val shell: Shell) : Screen {

    // Soat 15 dan keyin kechki yakun qiziqroq — lekin tanlov doim ekranda.
    private var kind by mutableStateOf(
        if (Calendar.getInstance().get(Calendar.HOUR_OF_DAY) < 15) "morning" else "evening",
    )
    private var data by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    override fun title(shell: Shell): String = shell.str(R.string.briefing_title)

    private fun load() {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.briefing(kind)
                shell.main {
                    data = r
                    loading = false
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e // qobiq login ekraniga qaytaradi
                shell.main {
                    loading = false
                    error = if (e.code == 403) shell.str(R.string.no_permission) else e.message
                }
            }
        }
    }

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) { if (data == null && !loading) load() }

        // Tur tanlovi — ikkala tugma doim ko'rinadi.
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            KindButton("morning", shell.str(R.string.briefing_morning))
            KindButton("evening", shell.str(R.string.briefing_evening))
        }

        val d = data
        when {
            loading -> EmptyState(shell.str(R.string.loading))
            error != null -> ErrorCard()
            d != null -> Body(d)
        }
    }

    @Composable
    private fun androidx.compose.foundation.layout.RowScope.KindButton(value: String, label: String) {
        val active = kind == value
        if (active) {
            PrimaryButton(text = label, modifier = Modifier.weight(1f)) { /* allaqachon tanlangan */ }
        } else {
            SecondaryButton(text = label, modifier = Modifier.weight(1f)) {
                kind = value
                data = null
                load()
            }
        }
    }

    @Composable
    private fun ErrorCard() {
        SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
            Text(error.orEmpty(), color = Palette.Danger)
            Spacer(Modifier.height(10.dp))
            SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) { load() }
        }
    }

    @Composable
    private fun Body(d: JSONObject) {
        val summary = d.optJSONObject("summary") ?: JSONObject()
        val currency = d.optString("currency", "UZS")

        // Kun xulosasi — quiet/attention/incomplete.
        val status = summary.optString("status")
        val (tint, border, label) = when (status) {
            "quiet" -> Triple(Palette.SuccessContainer, Palette.Success, shell.str(R.string.briefing_status_quiet))
            "attention" -> Triple(Palette.WarningContainer, Palette.Warning, shell.str(R.string.briefing_status_attention))
            else -> Triple(Palette.SurfaceMuted, Palette.Border, shell.str(R.string.briefing_status_incomplete))
        }
        SectionCard(tint = tint, border = border) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(d.optString("businessDate"), color = Palette.TextMuted)
            }
            val att = summary.opt("attentionCount")
            if (att is Number && att.toInt() > 0) {
                Spacer(Modifier.height(4.dp))
                Text("⚠ " + att.toInt(), style = MaterialTheme.typography.bodyLarge)
            }
        }

        val blocks = d.optJSONArray("blocks")
        if (blocks != null) {
            for (i in 0 until blocks.length()) {
                val b = blocks.optJSONObject(i) ?: continue
                BlockCard(b, currency)
            }
        }
    }

    @Composable
    private fun BlockCard(b: JSONObject, currency: String) {
        val attention = b.optBoolean("attention", false)
        SectionCard(
            tint = if (attention) Palette.WarningContainer else Palette.Surface,
            border = if (attention) Palette.Warning else Palette.Border,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(blockLabel(b.optString("key")), style = MaterialTheme.typography.titleMedium)
                // `null` ≠ 0 — o'lchanmagan blok «—» bilan chiqadi.
                val count = b.opt("count")
                Text(
                    if (count is Number) Fmt.group(count.toLong()) else shell.str(R.string.empty_dash),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (attention) Palette.Warning else Palette.Text,
                )
            }
            val amount = b.optString("amountMinor", "")
            if (amount.isNotEmpty() && amount != "null") {
                Spacer(Modifier.height(4.dp))
                Text(
                    Fmt.minor(amount, currency),
                    color = Palette.MoneyText,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (b.opt("count") == null || b.isNull("count")) {
                Spacer(Modifier.height(2.dp))
                Text(
                    shell.str(R.string.briefing_not_measured),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }

    private fun blockLabel(key: String): String = when (key) {
        "stuck" -> shell.str(R.string.blk_stuck)
        "sla_breach" -> shell.str(R.string.blk_sla_breach)
        "acceptance_pending" -> shell.str(R.string.blk_acceptance_pending)
        "stock_signal" -> shell.str(R.string.blk_stock_signal)
        "revenue" -> shell.str(R.string.blk_revenue)
        "shift_acceptance" -> shell.str(R.string.blk_shift_acceptance)
        "cash_variance" -> shell.str(R.string.blk_cash_variance)
        "open_items" -> shell.str(R.string.blk_open_items)
        else -> key // noma'lum kalit yashirilmaydi — xom ko'rinadi
    }
}
