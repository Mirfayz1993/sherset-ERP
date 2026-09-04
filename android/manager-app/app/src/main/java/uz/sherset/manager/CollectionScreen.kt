package uz.sherset.manager

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
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

/**
 * MK16 — «Qarz undirish ish ro'yxati»: `GET /manager/collection?scope=…&limit=200`
 * (`manager-collection.controller.ts`, ruxsat `debt.view`).
 *
 * Javob: `{rows[], summary, totalCount, truncated, generatedAt}`.
 * Qator: `{debtId, debtName, counterpartyName, counterpartyPhone|null,
 * remainingMinor, currency, overdueDays|null, bucket, problem, responsible,
 * lastContactAt, source(registry|retailsale), sourceDocNumber, ...}`.
 *
 * v0.1 — FAQAT O'QISH: eslatma yuborish (`POST remind`) va qo'ng'iroq qaydi
 * web ERP'da qoladi. Serverning NULL≠0 shartnomasi saqlanadi: `overdueDays:
 * null` — «muddatsiz», «bugun» EMAS.
 *
 * Valyutalar QO'SHILMAYDI — summary'dagi har valyuta o'z qatorida
 * (`summarizeCollection` shartnomasi).
 */
class CollectionScreen(private val shell: Shell) : Screen {

    private var scope by mutableStateOf("due")
    private var data by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    override fun title(shell: Shell): String = shell.str(R.string.collection_title)

    private fun load() {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.collection(scope)
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

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ScopeButton("due", shell.str(R.string.collection_scope_due))
            ScopeButton("all", shell.str(R.string.collection_scope_all))
        }

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
    private fun RowScope.ScopeButton(value: String, label: String) {
        val active = scope == value
        if (active) {
            PrimaryButton(text = label, modifier = Modifier.weight(1f)) { /* tanlangan */ }
        } else {
            SecondaryButton(text = label, modifier = Modifier.weight(1f)) {
                scope = value
                data = null
                load()
            }
        }
    }

    @Composable
    private fun Body(d: JSONObject) {
        val rows = d.optJSONArray("rows")
        val summary = d.optJSONObject("summary")

        if (summary != null) SummaryCard(summary)

        if (d.optBoolean("truncated", false)) {
            Text(
                shell.str(
                    R.string.collection_truncated,
                    d.optInt("totalCount"),
                    rows?.length() ?: 0,
                ),
                color = Palette.Warning,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        Text(
            shell.str(R.string.collection_readonly_note),
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyMedium,
        )

        if (rows == null || rows.length() == 0) {
            EmptyState(shell.str(R.string.collection_empty))
            return
        }
        for (i in 0 until rows.length()) {
            val r = rows.optJSONObject(i) ?: continue
            RowCard(r)
        }
    }

    @Composable
    private fun SummaryCard(s: JSONObject) {
        SectionCard(tint = Palette.PrimaryContainer, border = MaterialTheme.colorScheme.primary) {
            // Valyuta bo'yicha ALOHIDA jamlar — hech qachon qo'shilmaydi.
            val byCurrency = s.optJSONArray("byCurrency")
            if (byCurrency != null) {
                for (i in 0 until byCurrency.length()) {
                    val t = byCurrency.optJSONObject(i) ?: continue
                    Text(
                        Fmt.minor(t.optString("remainingMinor"), t.optString("currency")) +
                            "  ·  " + Fmt.group(t.optLong("count")) + " ta qarz",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Palette.OnPrimaryContainer,
                    )
                }
                Spacer(Modifier.height(6.dp))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Pill(
                    text = shell.str(R.string.collection_overdue, s.optInt("overdueCount")),
                    bg = Palette.DangerContainer,
                    fg = Palette.Danger,
                )
                Pill(
                    text = shell.str(R.string.collection_due_today, s.optInt("dueTodayCount")),
                    bg = Palette.WarningContainer,
                    fg = Palette.Warning,
                )
                Pill(
                    text = shell.str(R.string.collection_no_due, s.optInt("noDueDateCount")),
                    bg = Palette.SurfaceMuted,
                    fg = Palette.TextMuted,
                )
            }
            if (s.optInt("problemCount") > 0) {
                Spacer(Modifier.height(6.dp))
                Pill(
                    text = shell.str(R.string.collection_problem, s.optInt("problemCount")),
                    bg = Palette.DangerContainer,
                    fg = Palette.Danger,
                )
            }
        }
    }

    @Composable
    private fun RowCard(r: JSONObject) {
        val problem = r.optBoolean("problem", false)
        SectionCard(
            tint = if (problem) Palette.DangerContainer else Palette.Surface,
            border = if (problem) Palette.Danger else Palette.Border,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    r.optString("counterpartyName"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    Fmt.minor(r.optString("remainingMinor"), r.optString("currency")),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Palette.MoneyText,
                )
            }
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BucketPill(r)
                SourcePill(r)
            }
            Spacer(Modifier.height(6.dp))

            val phone = r.optString("counterpartyPhone", "")
            Text(
                r.optString("debtName") + "  ·  " +
                    if (phone.isEmpty() || phone == "null") shell.str(R.string.collection_no_phone) else phone,
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
            val resp = r.optJSONObject("responsible")
            if (resp != null) {
                Text(
                    shell.str(R.string.collection_responsible, resp.optString("name")),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            val lastContact = r.optString("lastContactAt", "")
            if (lastContact.isNotEmpty() && lastContact != "null") {
                Text(
                    shell.str(R.string.collection_last_contact, Fmt.dateTimeShort(lastContact)),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }

    /**
     * Muddat plashkasi. `overdueDays: null` — MUDDATSIZ («bugun» emas):
     * serverning NULL≠0 shartnomasi ekranda ham saqlanadi.
     */
    @Composable
    private fun BucketPill(r: JSONObject) {
        when (r.optString("bucket")) {
            "overdue" -> Pill(
                text = shell.str(R.string.collection_overdue_days, r.optInt("overdueDays")),
                bg = Palette.DangerContainer,
                fg = Palette.Danger,
            )
            "due_today" -> Pill(
                text = shell.str(R.string.collection_due_today_badge),
                bg = Palette.WarningContainer,
                fg = Palette.Warning,
            )
            "upcoming" -> Pill(
                text = shell.str(R.string.collection_upcoming, -r.optInt("overdueDays")),
                bg = Palette.SuccessContainer,
                fg = Palette.Success,
            )
            else -> Pill(
                text = shell.str(R.string.collection_no_due_badge),
                bg = Palette.SurfaceMuted,
                fg = Palette.TextMuted,
            )
        }
    }

    /** Q4 — qator manbai: kassa cheki yoki reyestr. */
    @Composable
    private fun SourcePill(r: JSONObject) {
        val retail = r.optString("source") == "retailsale"
        val num = r.optString("sourceDocNumber", "")
        val label = if (retail) {
            shell.str(R.string.collection_source_retail) +
                if (num.isNotEmpty() && num != "null") " $num" else ""
        } else {
            shell.str(R.string.collection_source_registry)
        }
        Pill(
            text = label,
            bg = if (retail) Palette.PrimaryContainer else Palette.SurfaceMuted,
            fg = if (retail) Palette.OnPrimaryContainer else Palette.TextMuted,
        )
    }
}
