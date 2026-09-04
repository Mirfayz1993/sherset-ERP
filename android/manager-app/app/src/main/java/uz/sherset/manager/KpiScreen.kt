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
import kotlin.math.roundToInt

/**
 * 4M.2 — xodimlar kunlik KPI navbati: `GET /manager/kpi/days?limit=100`
 * (`manager-kpi.controller.ts`, ruxsat HR `employees:read`).
 *
 * Javob: `{items[], total}`. Item: `{id, date, state, employee{name,position},
 * score|null, coverage, receiptCount, revenuePerHourMinor?, attentionSignals[],
 * dataComplete, ...}` — server og'ishli kunlarni TEPAGA saralab beradi.
 *
 * v0.1 — FAQAT O'QISH: qabul/rad qilish (transition) web ERP'da qoladi.
 * `score: null` = «hech narsa ballanmadi» — bu «0%» EMAS (server shartnomasi).
 */
class KpiScreen(private val shell: Shell) : Screen {

    private var data by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    override fun title(shell: Shell): String = shell.str(R.string.kpi_title)

    private fun load() {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.kpiDays()
                shell.main {
                    data = r
                    loading = false
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
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

        val d = data
        when {
            loading -> EmptyState(shell.str(R.string.loading))
            error != null -> SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(error.orEmpty(), color = Palette.Danger)
                Spacer(Modifier.height(10.dp))
                SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) { load() }
            }
            d != null -> Body(d)
        }
    }

    @Composable
    private fun Body(d: JSONObject) {
        val items = d.optJSONArray("items")
        if (items == null || items.length() == 0) {
            EmptyState(shell.str(R.string.kpi_empty))
            return
        }
        Text(
            shell.str(R.string.kpi_total, d.optInt("total", items.length())),
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyMedium,
        )
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            ItemCard(it)
        }
    }

    @Composable
    private fun ItemCard(it: JSONObject) {
        val signals = it.optJSONArray("attentionSignals")?.length() ?: 0
        SectionCard(
            tint = if (signals > 0) Palette.WarningContainer else Palette.Surface,
            border = if (signals > 0) Palette.Warning else Palette.Border,
        ) {
            val emp = it.optJSONObject("employee")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    emp?.optString("name").orEmpty(),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                StatePill(it.optString("state"))
            }
            val position = emp?.optString("position").orEmpty()
            if (position.isNotEmpty() && position != "null") {
                Text(position, color = Palette.TextMuted, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(6.dp))

            InfoRow(shell.str(R.string.kpi_date), Fmt.dateShort(it.optString("date")))

            // Kompozit ball — NULL «0%» emas.
            val score = it.opt("score")
            InfoRow(
                shell.str(R.string.kpi_score_label),
                if (score is Number) "${score.toDouble().roundToInt()}%"
                else shell.str(R.string.kpi_no_score),
            )
            InfoRow(shell.str(R.string.kpi_receipts), Fmt.group(it.optLong("receiptCount")))

            // Ish yuki konteksti — «kam sotdi» xulosasi shusiz noto'g'ri (§3.5).
            val perHour = it.optString("revenuePerHourMinor", "")
            if (perHour.isNotEmpty() && perHour != "null") {
                InfoRow(shell.str(R.string.kpi_rev_per_hour), Fmt.minor(perHour, "UZS"))
            }
            if (signals > 0) {
                Spacer(Modifier.height(4.dp))
                Pill(
                    text = shell.str(R.string.kpi_signals, signals),
                    bg = Palette.WarningContainer,
                    fg = Palette.Warning,
                )
            }
        }
    }

    /** FSM holatlari (`daily-kpi-fsm.ts` DAILY_KPI_STATE) — yopiq lug'at. */
    @Composable
    private fun StatePill(state: String) {
        val (label, bg, fg) = when (state) {
            "computed" -> Triple(shell.str(R.string.kpi_state_computed), Palette.SurfaceMuted, Palette.TextMuted)
            "pending" -> Triple(shell.str(R.string.kpi_state_pending), Palette.PrimaryContainer, Palette.OnPrimaryContainer)
            "accepted" -> Triple(shell.str(R.string.kpi_state_accepted), Palette.SuccessContainer, Palette.Success)
            "rejected" -> Triple(shell.str(R.string.kpi_state_rejected), Palette.DangerContainer, Palette.Danger)
            "escalated" -> Triple(shell.str(R.string.kpi_state_escalated), Palette.WarningContainer, Palette.Warning)
            "force_accepted" -> Triple(shell.str(R.string.kpi_state_force_accepted), Palette.SuccessContainer, Palette.Success)
            "stale" -> Triple(shell.str(R.string.kpi_state_stale), Palette.WarningContainer, Palette.Warning)
            else -> Triple(state, Palette.SurfaceMuted, Palette.TextMuted)
        }
        Pill(text = label, bg = bg, fg = fg)
    }
}
