package uz.sherset.manager

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * MENING KPI'IM — xodimning O'Z kunlik KPI kartalari (X-reja X5).
 *
 * Manba: `GET /hr/kpi/my?limit=30` — `JwtAuthGuard`, `employeeId = user.sub`.
 * Ilova kimni so'rashini TANLAY OLMAYDI (so'rovda bunday parametr yo'q).
 *
 * Menejer KPI ekrani (`KpiScreen`) uslubida, lekin:
 *  - faqat O'Z kunlari, xodim ismi/lavozimi ko'rsatilmaydi (u o'zi);
 *  - qabul/rad qilish YO'Q — bu menejerning amali;
 *  - kartani bosganda ko'rsatkichlar ro'yxati ochiladi (drilldown
 *    soddalashtirilgan: hujjatlargacha tushilmaydi).
 *
 * 🔴 HALOL RAQAMLAR (X-reja 8-qoidasi):
 *  - `score: null` → «hisoblanmadi», 0% EMAS;
 *  - `scoreIsFinal: false` → kun hali qabul qilinmagan, ball O'ZGARISHI
 *    mumkin va buni karta OCHIQ aytadi;
 *  - `autoValue: null` → «o'lchanmadi», nol natija emas;
 *  - ball uchun «yaxshi/yomon» rang bandlari O'YLAB TOPILMAYDI — server
 *    bunday bandni bilmaydi, ekran ham bilmasin.
 */
class MyKpiScreen(private val shell: Shell) : Screen {

    private var data by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    /** Ochilgan kun (`id`) — ko'rsatkichlar ro'yxati shu kartada chiziladi. */
    private var expandedId by mutableStateOf<String?>(null)

    override fun title(shell: Shell): String = shell.str(R.string.tile_my_kpi)

    private fun load() {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.myKpi(LIMIT)
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
            error != null -> SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(error.orEmpty(), color = Palette.Danger)
                Spacer(Modifier.height(10.dp))
                SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) { load() }
            }
            d == null && loading -> EmptyState(shell.str(R.string.loading))
            d == null -> EmptyState(shell.str(R.string.mykpi_empty))
            else -> Body(d)
        }
    }

    @Composable
    private fun Body(d: JSONObject) {
        val days = d.optJSONArray("days") ?: JSONArray()
        if (days.length() == 0) {
            EmptyState(shell.str(R.string.mykpi_empty))
            return
        }
        Text(
            shell.str(R.string.mykpi_count, days.length()),
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(8.dp))
        for (i in 0 until days.length()) {
            val day = days.optJSONObject(i) ?: continue
            DayCard(day)
            if (i < days.length() - 1) Spacer(Modifier.height(10.dp))
        }
    }

    // ── Kun kartasi ─────────────────────────────────────────────────────────

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    private fun DayCard(day: JSONObject) {
        val id = day.optString("id")
        val state = day.optString("state")
        val signals = day.optJSONArray("attentionSignals") ?: JSONArray()
        val hasSignals = signals.length() > 0
        val open = expandedId == id

        SectionCard(
            modifier = Modifier.clickable { expandedId = if (open) null else id },
            tint = if (hasSignals) Palette.WarningContainer else Palette.Surface,
            border = if (hasSignals) Palette.Warning else Palette.Border,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    MyKpi.dayLabel(day.optString("date")) ?: shell.str(R.string.empty_dash),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.width(8.dp))
                StatePill(state)
            }

            Spacer(Modifier.height(6.dp))
            ScoreRow(day)

            // Qamrov — «bu ball kunning qanchasini qamragan». Yashirin
            // to'liqsizlik yolg'on ball demakdir (server izohi §2.2).
            val coverage = MyKpi.coveragePercent(numberOrNull(day, "coverage"))
            if (coverage != null) {
                InfoRow(shell.str(R.string.mykpi_coverage), coverage)
            }

            val worked = day.opt("workedMinutes")
            InfoRow(
                shell.str(R.string.mykpi_worked),
                if (worked is Number) {
                    shell.str(R.string.mykpi_unit_minutes, Fmt.group(worked.toLong()))
                } else {
                    // NULL ≠ 0: davomat yozuvi yo'q — «0 daqiqa ishladi» EMAS.
                    shell.str(R.string.mykpi_not_measured)
                },
            )

            if (!day.optBoolean("hasProfile", false)) {
                Spacer(Modifier.height(6.dp))
                Text(
                    shell.str(R.string.mykpi_profile_missing),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            if (hasSignals) {
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0 until signals.length()) {
                        val s = signals.optString(i)
                        val (bg, fg) = signalColors(s)
                        Pill(text = signalLabel(s), bg = bg, fg = fg)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                shell.str(if (open) R.string.mykpi_close else R.string.mykpi_open),
                color = Palette.Primary,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodyMedium,
            )

            if (open) Metrics(day.optJSONArray("metrics"))
        }
    }

    /** Ball qatori + «yakuniy emas» ogohlantirishi. */
    @Composable
    private fun ScoreRow(day: JSONObject) {
        val score = numberOrNull(day, "score")
        val isFinal = day.optBoolean("scoreIsFinal", false)
        InfoRow(
            shell.str(R.string.mykpi_score),
            // 🔴 `null` = hech narsa ballanmadi. «0%» yozish yolg'on bo'lardi.
            MyKpi.percent(score) ?: shell.str(R.string.mykpi_no_score),
        )
        if (MyKpi.isProvisional(isFinal, score)) {
            Text(
                shell.str(R.string.mykpi_provisional),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        } else if (isFinal) {
            Text(
                shell.str(R.string.mykpi_final),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }

    // ── Ko'rsatkichlar (soddalashtirilgan drilldown) ─────────────────────────

    @Composable
    private fun Metrics(metrics: JSONArray?) {
        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = Palette.Border)
        if (metrics == null || metrics.length() == 0) {
            Spacer(Modifier.height(8.dp))
            Text(
                shell.str(R.string.mykpi_no_metrics),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
            return
        }
        for (i in 0 until metrics.length()) {
            val m = metrics.optJSONObject(i) ?: continue
            Spacer(Modifier.height(10.dp))
            MetricRow(m)
        }
    }

    @Composable
    private fun MetricRow(m: JSONObject) {
        val unit = nullableStr(m, "unit")
        val scored = m.optBoolean("scored", false)

        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    m.optString("labelUz"),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    valueText(nullableStr(m, "value"), unit),
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            val target = MyKpi.metricNumber(nullableStr(m, "target"), unit)
            InfoRow(
                shell.str(R.string.mykpi_metric_target),
                // Reja YO'Q — bu «reja 0» EMAS.
                if (target == null) shell.str(R.string.mykpi_no_target_dash)
                else withSuffix(target, unit),
            )

            val achievement = MyKpi.percent(numberOrNull(m, "achievementPercent"))
            if (achievement != null) {
                InfoRow(shell.str(R.string.mykpi_metric_result), achievement)
            }

            val weight = MyKpi.weightLabel(numberOrNull(m, "weight"))
            if (weight != null) {
                InfoRow(shell.str(R.string.mykpi_metric_weight), weight)
            }

            val perHour = MyKpi.metricNumber(nullableStr(m, "perHourValue"), unit)
            if (perHour != null) {
                InfoRow(shell.str(R.string.mykpi_metric_per_hour), withSuffix(perHour, unit))
            }

            if (m.optBoolean("adjusted", false)) {
                Spacer(Modifier.height(4.dp))
                Pill(
                    text = shell.str(R.string.mykpi_adjusted),
                    bg = Palette.PrimaryContainer,
                    fg = Palette.OnPrimaryContainer,
                )
            }

            // Ballga NEGA kirmagani ochiq aytiladi — jimgina 0 emas.
            if (!scored) {
                val reason = skipLabel(nullableStr(m, "skipReason"))
                if (reason != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        reason,
                        color = Palette.TextMuted,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }

    // ── Yordamchilar ────────────────────────────────────────────────────────

    /** Qiymat matni: `null` → «o'lchanmadi» (0 EMAS). */
    private fun valueText(value: String?, unit: String?): String {
        val n = MyKpi.metricNumber(value, unit) ?: return shell.str(R.string.mykpi_not_measured)
        return withSuffix(n, unit)
    }

    private fun withSuffix(number: String, unit: String?): String {
        val suffix = MyKpi.unitSuffix(unit) ?: return number
        return if (suffix == "%") number + suffix else "$number $suffix"
    }

    /** FSM holatlari (`daily-kpi-fsm.ts`) — yopiq lug'at, `KpiScreen` bilan bir xil. */
    @Composable
    private fun StatePill(state: String) {
        val (label, bg, fg) = when (MyKpi.stateTone(state)) {
            "computed" -> Triple(
                shell.str(R.string.kpi_state_computed),
                Palette.SurfaceMuted,
                Palette.TextMuted,
            )
            "pending" -> Triple(
                shell.str(R.string.kpi_state_pending),
                Palette.PrimaryContainer,
                Palette.OnPrimaryContainer,
            )
            "accepted" -> Triple(
                shell.str(R.string.kpi_state_accepted),
                Palette.SuccessContainer,
                Palette.Success,
            )
            "rejected" -> Triple(
                shell.str(R.string.kpi_state_rejected),
                Palette.DangerContainer,
                Palette.Danger,
            )
            "escalated" -> Triple(
                shell.str(R.string.kpi_state_escalated),
                Palette.WarningContainer,
                Palette.Warning,
            )
            "force_accepted" -> Triple(
                shell.str(R.string.kpi_state_force_accepted),
                Palette.SuccessContainer,
                Palette.Success,
            )
            "stale" -> Triple(
                shell.str(R.string.kpi_state_stale),
                Palette.WarningContainer,
                Palette.Warning,
            )
            // Server yangi holat qo'shsa ilova yiqilmaydi — xom qiymat chiqadi.
            else -> Triple(state, Palette.SurfaceMuted, Palette.TextMuted)
        }
        Pill(text = label, bg = bg, fg = fg)
    }

    private fun signalLabel(signal: String): String = when (signal) {
        "stale" -> shell.str(R.string.mykpi_sig_stale)
        "escalated" -> shell.str(R.string.mykpi_sig_escalated)
        "rejected" -> shell.str(R.string.mykpi_sig_rejected)
        "data_incomplete" -> shell.str(R.string.mykpi_sig_data_incomplete)
        "till_variance_abs" -> shell.str(R.string.mykpi_sig_till_variance)
        "below_cost_count" -> shell.str(R.string.mykpi_sig_below_cost)
        "cancel_count" -> shell.str(R.string.mykpi_sig_cancel)
        "refund_count" -> shell.str(R.string.mykpi_sig_refund)
        "late_minutes" -> shell.str(R.string.mykpi_sig_late)
        // Server ro'yxati kengaysa xom kalit ko'rinadi — yashirilmaydi.
        else -> signal
    }

    private fun signalColors(signal: String): Pair<Color, Color> =
        when (MyKpi.signalTone(signal)) {
            "state" -> Palette.DangerContainer to Palette.Danger
            else -> Palette.WarningContainer to Palette.Warning
        }

    private fun skipLabel(skipReason: String?): String? = when (MyKpi.skipTone(skipReason)) {
        "unmeasured" -> shell.str(R.string.mykpi_skip_unmeasured)
        "no_target" -> shell.str(R.string.mykpi_skip_no_target)
        "no_weight" -> shell.str(R.string.mykpi_skip_no_weight)
        "neutral" -> shell.str(R.string.mykpi_skip_neutral)
        "unknown_metric" -> shell.str(R.string.mykpi_skip_unknown_metric)
        else -> null
    }

    /** JSON'dagi son yoki `null` (`optDouble` yo'q qiymatda NaN qaytaradi). */
    private fun numberOrNull(o: JSONObject, key: String): Double? {
        val v = o.opt(key)
        return if (v is Number) v.toDouble() else null
    }

    private fun nullableStr(o: JSONObject, key: String): String? =
        if (o.isNull(key)) null else o.optString(key)

    private companion object {
        /** Server chegarasi 90; 30 kun bitta ekran uchun yetarli (reja qiymati). */
        const val LIMIT = 30
    }
}
