package uz.sherset.manager

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
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
 * MK15 — «Korxona puli qayerda»: `GET /manager/money-map`
 * (`money-map.controller.ts`, ruxsat `report.view`). So'rov parametri YO'Q.
 *
 * Javob: `{blocks[6], summary{netMinor|null, currency, unconvertedByCurrency}}`.
 * Blok: `{key, direction(asset|liability), amountMinor|null, mixedCurrency,
 * unconvertedByCurrency[]}`.
 *
 * 🔴 Server shartnomalari (money-map.ts) bu yerda ham amal qiladi:
 *  1. NULL ≠ 0 — o'lchanmagan blok «hisoblanmadi» bo'lib chiqadi.
 *  2. Yarim yig'indi berilmaydi — `netMinor: null` bo'lsa sof qoldiq ham
 *     «hisoblanmadi» (qolganlarining yig'indisi CHIZILMAYDI).
 */
class MoneyMapScreen(private val shell: Shell) : Screen {

    private var data by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    override fun title(shell: Shell): String = shell.str(R.string.money_title)

    private fun load() {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.moneyMap()
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
        val summary = d.optJSONObject("summary") ?: JSONObject()
        val currency = summary.optString("currency", "UZS")

        // Sof qoldiq — bitta blok o'lchanmagan bo'lsa NULL (yarim yig'indi yo'q).
        SectionCard(tint = Palette.PrimaryContainer, border = MaterialTheme.colorScheme.primary) {
            Text(shell.str(R.string.money_net), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            if (summary.isNull("netMinor")) {
                Text(
                    shell.str(R.string.money_net_incomplete),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                Text(
                    Fmt.minor(summary.optString("netMinor"), currency),
                    style = MaterialTheme.typography.titleLarge,
                    color = Palette.OnPrimaryContainer,
                    fontWeight = FontWeight.Bold,
                )
            }
            UnconvertedNote(summary.optJSONArray("unconvertedByCurrency"))
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
        val liability = b.optString("direction") == "liability"
        SectionCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row {
                    Text(blockLabel(b.optString("key")), style = MaterialTheme.typography.titleMedium)
                    if (liability) {
                        Spacer(Modifier.width(8.dp))
                        Pill(
                            text = shell.str(R.string.money_liability),
                            bg = Palette.DangerContainer,
                            fg = Palette.Danger,
                        )
                    }
                }
                if (b.isNull("amountMinor")) {
                    Text(shell.str(R.string.money_not_measured), color = Palette.TextMuted)
                } else {
                    Text(
                        Fmt.minor(b.optString("amountMinor"), currency),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (liability) Palette.Danger else Palette.MoneyText,
                    )
                }
            }
            UnconvertedNote(b.optJSONArray("unconvertedByCurrency"))
        }
    }

    /** M-12 — kursi topilmagan pul jamiga QO'SHILMAGAN: oshkora ko'rsatiladi. */
    @Composable
    private fun UnconvertedNote(arr: org.json.JSONArray?) {
        if (arr == null || arr.length() == 0) return
        Spacer(Modifier.height(6.dp))
        val parts = buildList {
            for (i in 0 until arr.length()) {
                val u = arr.optJSONObject(i) ?: continue
                add(Fmt.minor(u.optString("amountMinor"), u.optString("currency")))
            }
        }
        Text(
            shell.str(R.string.money_unconverted) + " " + parts.joinToString(" · "),
            color = Palette.Warning,
            style = MaterialTheme.typography.bodyMedium,
        )
    }

    private fun blockLabel(key: String): String = when (key) {
        "cash" -> shell.str(R.string.mm_cash)
        "bank" -> shell.str(R.string.mm_bank)
        "customer_debt" -> shell.str(R.string.mm_customer_debt)
        "supplier_debt" -> shell.str(R.string.mm_supplier_debt)
        "driver_cash" -> shell.str(R.string.mm_driver_cash)
        "goods_in_transit" -> shell.str(R.string.mm_goods_in_transit)
        else -> key
    }
}
