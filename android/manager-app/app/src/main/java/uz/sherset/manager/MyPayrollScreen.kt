package uz.sherset.manager

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/**
 * OYLIGIM — xodimning O'Z oylik hisobi (X-reja X6).
 *
 * Manba: `GET /hr/payroll/my/:yearMonth` — `oylik:own_only`,
 * `employeeId = user.sub`. Ilova kimni so'rashini TANLAY OLMAYDI (bu yo'lda
 * `employeeId` na parametrda, na tanada bor).
 *
 * 🔴 EKRANGA BOSHQA XODIM CHIQMAYDI. Server javobida ism ham, `employee`
 * relation'i ham, jarimani KIM yozgani ham YO'Q (`my-payroll.service.ts`
 * `select` i testlar bilan qulflangan). Bu ekran shu sababdan hech qanday
 * ism maydonini O'QIMAYDI ham.
 *
 * 🔴 HALOL RAQAMLAR (X-reja 8-qoidasi):
 *  - oy hisoblanmagan bo'lsa summa UMUMAN chizilmaydi — «0 so'm» EMAS;
 *  - `partial` holatda «summa o'zgarishi mumkin» deb OCHIQ yoziladi
 *    (X5 dagi «ball yakuniy emas» qarori bilan bir sinfda);
 *  - bonus va jarima QO'SHILMAYDI, alohida qatorda turadi;
 *  - ro'yxat hisobdan keyin o'zgargan bo'lsa buni ham ekran aytadi.
 */
class MyPayrollScreen(private val shell: Shell) : Screen {

    /** Toshkent kalendari bo'yicha joriy oy — qurilma mintaqasidan mustaqil. */
    private val todayYearMonth = Davomat.currentYearMonth()

    private var yearMonth by mutableStateOf(todayYearMonth)
    private var data by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    override fun title(shell: Shell): String = shell.str(R.string.tile_my_payroll)

    private fun load(month: String) {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.myPayroll(month)
                shell.main {
                    // Oy tez almashtirilsa eskirgan javob yangisini bosmasin.
                    if (month == yearMonth) {
                        data = r
                        loading = false
                    }
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
                shell.main {
                    if (month != yearMonth) return@main
                    loading = false
                    error = if (e.code == 403) shell.str(R.string.no_permission) else e.message
                }
            }
        }
    }

    private fun changeMonth(delta: Long) {
        val next = Davomat.shiftMonth(yearMonth, delta)
        yearMonth = next
        data = null
        load(next)
    }

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) { if (data == null && !loading) load(yearMonth) }

        MonthPicker()
        Spacer(Modifier.height(10.dp))

        val d = data
        when {
            error != null -> SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(error.orEmpty(), color = Palette.Danger)
                Spacer(Modifier.height(10.dp))
                SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) {
                    load(yearMonth)
                }
            }
            d == null && loading -> EmptyState(shell.str(R.string.loading))
            d == null -> EmptyState(shell.str(R.string.payroll_empty))
            else -> Body(d)
        }
    }

    // ── Oy tanlagichi ───────────────────────────────────────────────────────

    @Composable
    private fun MonthPicker() {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = { changeMonth(-1) }) {
                Text("‹ " + shell.str(R.string.att_prev_month), color = Palette.Primary)
            }
            Text(
                Davomat.monthLabel(yearMonth),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            // Kelajak oy YOPIQ — oylik u yerda hisoblangan bo'lishi mumkin emas.
            if (Davomat.canGoNext(yearMonth, todayYearMonth)) {
                TextButton(onClick = { changeMonth(1) }) {
                    Text(shell.str(R.string.att_next_month) + " ›", color = Palette.Primary)
                }
            } else {
                Spacer(Modifier.width(72.dp))
            }
        }
    }

    // ── Tana ────────────────────────────────────────────────────────────────

    @Composable
    private fun Body(d: JSONObject) {
        TotalCard(d)
        Spacer(Modifier.height(10.dp))

        val components = d.optJSONObject("components")
        if (components != null) {
            ComponentsCard(components)
            Spacer(Modifier.height(10.dp))
        }

        val sales = d.optJSONObject("sales")
        if (sales != null) {
            SalesCard(sales)
            Spacer(Modifier.height(10.dp))
        }

        LedgerCard(d.optJSONObject("ledger"), components)
    }

    /** Jami summa — eng katta karta. `null` bo'lsa raqam UMUMAN chizilmaydi. */
    @Composable
    private fun TotalCard(d: JSONObject) {
        val status = d.optString("status")
        val tone = MyPayroll.statusTone(status)
        val total = MyPayroll.money(nullableStr(d, "finalSalaryMinor"))

        SectionCard(
            tint = if (tone == "computed") Palette.SuccessContainer else Palette.Surface,
            border = if (tone == "computed") Palette.Success else Palette.Border,
        ) {
            Text(
                shell.str(R.string.payroll_total),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                // 🔴 `null` = hisoblanmadi. «0 so'm» yozish YOLG'ON bo'lardi.
                total ?: shell.str(R.string.payroll_not_computed),
                fontSize = if (total == null) 20.sp else 28.sp,
                fontWeight = FontWeight.Bold,
                color = if (total == null) Palette.TextMuted else Palette.MoneyText,
                textAlign = TextAlign.Start,
            )

            Spacer(Modifier.height(8.dp))
            StatusNote(tone, status, d.optJSONObject("sales"))

            val computedAt = MyPayroll.rowDateTime(nullableStr(d, "computedAt"))
            if (computedAt != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    shell.str(R.string.payroll_computed_at, computedAt),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }

    /** Holat izohi — raqam yakuniymi yoki hali o'zgaradimi. */
    @Composable
    private fun StatusNote(tone: String, rawStatus: String, sales: JSONObject?) {
        when (tone) {
            "not_computed" -> Text(
                shell.str(R.string.payroll_empty),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
            // Uzun jumla — plashka (chip) EMAS, oddiy matn: plashka ichida
            // o'ralib ketgan gap o'qilmaydi.
            "partial" -> Text(
                shell.str(R.string.payroll_status_partial, sales?.optInt("pendingDays") ?: 0),
                color = Palette.Warning,
                style = MaterialTheme.typography.bodyMedium,
            )
            "computed" -> Text(
                shell.str(R.string.payroll_status_computed),
                color = Palette.Success,
                style = MaterialTheme.typography.bodyMedium,
            )
            // Server yangi holat qo'shsa ilova YIQILMAYDI — xom qiymat chiqadi.
            else -> Text(
                shell.str(R.string.payroll_status_unknown, rawStatus),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }

    /**
     * Tarkib qatorlari. Doimiylari HAR DOIM chiziladi (nol ham javob:
     * «bu oyda komissiya bo'lmagan»), tuzatma qatorlari esa faqat noldan
     * farqli bo'lsa — ular kamdan-kam uchraydi va bo'sh qator chalkashtirardi.
     */
    @Composable
    private fun ComponentsCard(c: JSONObject) {
        SectionCard {
            Text(
                shell.str(R.string.payroll_components),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(6.dp))

            MoneyRow(R.string.payroll_fix, nullableStr(c, "fixComponentMinor"))
            MoneyRow(R.string.payroll_kpi, nullableStr(c, "kpiEarnedMinor"))
            MoneyRow(R.string.payroll_bonus, nullableStr(c, "bonusSumMinor"))
            // 🔴 Jarima AYIRILADI — belgi bilan ko'rsatiladi.
            MoneyRow(
                R.string.payroll_fine,
                nullableStr(c, "fineSumMinor"),
                signedKind = "fine",
            )
            MoneyRow(R.string.payroll_commission, nullableStr(c, "commissionMinor"))

            val increase = nullableStr(c, "correctionIncreaseMinor")
            if (!MyPayroll.isZero(increase)) {
                MoneyRow(R.string.payroll_correction_increase, increase)
            }
            val decrease = nullableStr(c, "correctionDecreaseMinor")
            if (!MyPayroll.isZero(decrease)) {
                // Ushlanma bazada MUSBAT saqlanadi, oylikdan esa AYIRILADI.
                MoneyRow(R.string.payroll_correction_decrease, decrease, signedKind = "fine")
            }
        }
    }

    @Composable
    private fun SalesCard(s: JSONObject) {
        SectionCard {
            Text(
                shell.str(R.string.payroll_sales),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(6.dp))

            MoneyRow(R.string.payroll_total_sales, nullableStr(s, "totalSalesMinor"))
            MoneyRow(R.string.payroll_target, nullableStr(s, "targetMinor"))
            InfoRow(
                shell.str(R.string.payroll_achievement),
                // Foiz `null` bo'lsa «hisoblanmadi» — 0% EMAS.
                MyKpi.percent(numberOrNull(s, "achievementPercent"))
                    ?: shell.str(R.string.payroll_not_computed),
            )
            InfoRow(
                shell.str(R.string.payroll_tier),
                MyKpi.percent(numberOrNull(s, "tierPayoutPercent"))
                    ?: shell.str(R.string.payroll_not_computed),
            )
            InfoRow(shell.str(R.string.payroll_accepted_days), s.optInt("acceptedDays").toString())
            InfoRow(shell.str(R.string.payroll_pending_days), s.optInt("pendingDays").toString())

            // «Nega oylik kam» degan savolning javobi — yashirilmaydi (TZ §4.4).
            val blocked = nullableStr(s, "blockedSalesMinor")
            if (MyPayroll.isPositive(blocked)) {
                Spacer(Modifier.height(6.dp))
                Text(
                    shell.str(R.string.payroll_blocked, MyPayroll.money(blocked).orEmpty()),
                    color = Palette.Warning,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }

    // ── Bonus/jarima ro'yxati ───────────────────────────────────────────────

    @Composable
    private fun LedgerCard(ledger: JSONObject?, components: JSONObject?) {
        val rows = ledger?.optJSONArray("rows") ?: JSONArray()
        SectionCard {
            Text(
                shell.str(R.string.payroll_ledger),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(6.dp))

            if (rows.length() == 0) {
                Text(
                    shell.str(R.string.payroll_ledger_empty),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
                return@SectionCard
            }

            // 🔴 Bonus va jarima QO'SHILMAYDI — alohida qatorda.
            MoneyRow(
                R.string.payroll_ledger_bonus_total,
                if (ledger == null) null else nullableStr(ledger, "bonusMinor"),
            )
            MoneyRow(
                R.string.payroll_ledger_fine_total,
                if (ledger == null) null else nullableStr(ledger, "fineMinor"),
                signedKind = "fine",
            )

            StaleNote(ledger, components)

            for (i in 0 until rows.length()) {
                val r = rows.optJSONObject(i) ?: continue
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = Palette.Border)
                Spacer(Modifier.height(10.dp))
                LedgerRow(r)
            }
        }
    }

    /**
     * Ro'yxat saqlangan jamiga mos kelmasa — OCHIQ aytiladi. Oylik qatori
     * bir marta hisoblanadi (`computedAt`), yangi jarima esa keyin ham
     * yozilishi mumkin; jim qolinsa xodim «jami noto'g'ri» deb o'ylardi.
     */
    @Composable
    private fun StaleNote(ledger: JSONObject?, components: JSONObject?) {
        if (ledger == null || components == null) return
        val bonusOk = MyPayroll.ledgerMatches(
            nullableStr(components, "bonusSumMinor"),
            nullableStr(ledger, "bonusMinor"),
        )
        val fineOk = MyPayroll.ledgerMatches(
            nullableStr(components, "fineSumMinor"),
            nullableStr(ledger, "fineMinor"),
        )
        if (bonusOk == false || fineOk == false) {
            Spacer(Modifier.height(6.dp))
            Text(
                shell.str(R.string.payroll_ledger_stale),
                color = Palette.Warning,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }

    @Composable
    private fun LedgerRow(r: JSONObject) {
        val kind = r.optString("kind")
        val isFine = MyPayroll.kindTone(kind) == "fine"

        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Pill(
                    text = kindLabel(kind),
                    bg = if (isFine) Palette.DangerContainer else Palette.SuccessContainer,
                    fg = if (isFine) Palette.Danger else Palette.Success,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    MyPayroll.signedMoney(kind, nullableStr(r, "amountMinor"))
                        ?: shell.str(R.string.payroll_not_computed),
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (isFine) Palette.Danger else Palette.MoneyText,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                // Sabab bo'sh bo'lsa ochiq aytiladi — bo'sh joy qoldirilmaydi.
                nullableStr(r, "reason") ?: shell.str(R.string.payroll_no_reason),
                style = MaterialTheme.typography.bodyMedium,
            )
            InfoRow(sourceLabel(nullableStr(r, "source")), rowDate(r))
        }
    }

    private fun rowDate(r: JSONObject): String =
        MyPayroll.rowDateTime(nullableStr(r, "createdAt")) ?: shell.str(R.string.empty_dash)

    private fun kindLabel(kind: String?): String = when (MyPayroll.kindTone(kind)) {
        "bonus" -> shell.str(R.string.payroll_kind_bonus)
        "fine" -> shell.str(R.string.payroll_kind_fine)
        // Server yangi tur qo'shsa xom qiymat ko'rinadi, ilova yiqilmaydi.
        else -> kind.orEmpty()
    }

    private fun sourceLabel(source: String?): String = when (MyPayroll.sourceTone(source)) {
        "manual" -> shell.str(R.string.payroll_src_manual)
        "rule" -> shell.str(R.string.payroll_src_rule)
        "auto_late" -> shell.str(R.string.payroll_src_auto_late)
        "auto_task_reward" -> shell.str(R.string.payroll_src_task_reward)
        "auto_task_fine" -> shell.str(R.string.payroll_src_task_fine)
        "auto_expire_fine" -> shell.str(R.string.payroll_src_expire_fine)
        "kpi_accept" -> shell.str(R.string.payroll_src_kpi_accept)
        "kpi_accept_reversal" -> shell.str(R.string.payroll_src_kpi_reversal)
        // Ro'yxat kengaysa xom kalit ko'rinadi — jimgina yashirilmaydi.
        else -> source.orEmpty()
    }

    // ── Yordamchilar ────────────────────────────────────────────────────────

    /** Pul qatori: `null` → «hisoblanmadi» (0 EMAS). */
    @Composable
    private fun MoneyRow(labelRes: Int, minor: String?, signedKind: String? = null) {
        val text = if (signedKind == null) {
            MyPayroll.money(minor)
        } else {
            MyPayroll.signedMoney(signedKind, minor)
        }
        InfoRow(shell.str(labelRes), text ?: shell.str(R.string.payroll_not_computed))
    }

    /** JSON'dagi son yoki `null` (`optDouble` yo'q qiymatda NaN qaytaradi). */
    private fun numberOrNull(o: JSONObject, key: String): Double? {
        val v = o.opt(key)
        return if (v is Number) v.toDouble() else null
    }

    private fun nullableStr(o: JSONObject, key: String): String? =
        if (o.isNull(key)) null else o.optString(key)
}
