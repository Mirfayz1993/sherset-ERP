package uz.sherset.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/**
 * DAVOMAT — xodimning O'Z kelgan/ketgani (X-reja X2).
 *
 * Ikki manba, ikkalasi ham FAQAT o'ziniki (`ping.controller.ts`, JwtAuthGuard,
 * `employeeId = user.sub` — ilova kimni so'rashini TANLAY OLMAYDI):
 *  - `GET /hr/attendance/my/today` — bugungi holat + «Keldim»/«Ketyapman»;
 *  - `GET /hr/attendance/my/history?yearMonth=` — oylik tarix (X2 da ochildi).
 *
 * 🔴 «Keldim» GPS talab qiladi: server geofence bilan tekshiradi
 * (`isInsideGeofence`, aniqlik chegarasi 100 m). Shuning uchun tugma bosilganda
 * `shell.locate(...)` chaqiriladi va ruxsat AYNAN o'sha payt so'raladi.
 * Server «ok:false» bilan sababni aytadi — ilova o'zi qaror QILMAYDI, faqat
 * sababni tarjima qiladi.
 *
 * 🔴 Halol raqamlar: `lateMinutes = null` («o'lchanmadi») 0 dan farqlanadi,
 * ikkalasi ham «—» chiqadi, lekin plashka faqat haqiqiy kechikishda chiziladi.
 */
class AttendanceScreen(private val shell: Shell) : Screen {

    private var today by mutableStateOf<JSONObject?>(null)
    private var history by mutableStateOf<JSONObject?>(null)
    private var yearMonth by mutableStateOf(Davomat.currentYearMonth())
    private var loading by mutableStateOf(false)
    private var historyLoading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    /** Tugma bosilib, javob kutilmoqda — qo'sh bosishdan qo'riqlaydi. */
    private var busy by mutableStateOf(false)

    /** Bugungi kun kalendar bo'yicha — «keyingi oy» tugmasi shunga qarab yopiladi. */
    private val todayYearMonth = Davomat.currentYearMonth()

    override fun title(shell: Shell): String = shell.str(R.string.tile_attendance)

    // ── Yuklash ─────────────────────────────────────────────────────────────

    private fun loadToday() {
        loading = true
        error = null
        shell.io {
            try {
                val r = shell.api.attendanceToday()
                shell.main {
                    today = r
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

    private fun loadHistory(ym: String) {
        historyLoading = true
        shell.io {
            try {
                val r = shell.api.attendanceHistory(ym)
                shell.main {
                    // Oy tez-tez almashtirilsa eski javob kechikib kelib
                    // yangisining ustiga yozilmasin.
                    if (r.optString("yearMonth") == yearMonth) history = r
                    historyLoading = false
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
                shell.main {
                    historyLoading = false
                    if (e.code != 403) shell.toast(e.message.orEmpty())
                }
            }
        }
    }

    private fun changeMonth(delta: Long) {
        val next = Davomat.shiftMonth(yearMonth, delta)
        yearMonth = next
        history = null
        loadHistory(next)
    }

    // ── Amallar ─────────────────────────────────────────────────────────────

    /**
     * «Keldim»/«Ketyapman». Avval GPS, so'ng server. Javobdagi `ok:false`
     * — bu XATO emas, bu server QARORI (masalan «ish joyidan uzoqsiz»),
     * shuning uchun toast bilan aytiladi va holat qayta o'qiladi.
     */
    private fun mark(checkIn: Boolean) {
        if (busy) return
        busy = true
        shell.locate { fix ->
            if (fix == null) {
                // Sababni qobiq o'zi aytdi (ruxsat/GPS/vaqt tugadi).
                busy = false
                return@locate
            }
            shell.io {
                try {
                    val r = if (checkIn) {
                        shell.api.attendanceCheckIn(fix.lat, fix.lng, fix.accuracy)
                    } else {
                        shell.api.attendanceCheckOut(fix.lat, fix.lng, fix.accuracy)
                    }
                    shell.main {
                        busy = false
                        if (r.optBoolean("ok")) {
                            shell.toast(
                                if (checkIn) R.string.att_checked_in else R.string.att_checked_out,
                            )
                        } else {
                            shell.toast(shell.str(reasonRes(r.optString("reason"))))
                        }
                        // Muvaffaqiyat ham, rad ham — haqiqat serverda.
                        loadToday()
                        if (yearMonth == todayYearMonth) loadHistory(yearMonth)
                    }
                } catch (e: ApiClient.ApiException) {
                    if (e.code == 401) throw e
                    shell.main {
                        busy = false
                        shell.toast(e.message.orEmpty())
                    }
                }
            }
        }
    }

    private fun enableOptIn() {
        if (busy) return
        busy = true
        shell.io {
            try {
                shell.api.attendanceOptIn(true)
                shell.main {
                    busy = false
                    loadToday()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
                shell.main {
                    busy = false
                    shell.toast(e.message.orEmpty())
                }
            }
        }
    }

    /** `ManualMarkResult.reason` — yopiq lug'at (`ping-ingest.service.ts`). */
    private fun reasonRes(reason: String?): Int = when (reason) {
        "outside" -> R.string.att_reason_outside
        "accuracy" -> R.string.att_reason_accuracy
        "not_opted_in" -> R.string.att_reason_not_opted_in
        "no_location" -> R.string.att_reason_no_location
        "no_open_record" -> R.string.att_reason_no_open_record
        else -> R.string.att_reason_unknown
    }

    // ── Chizish ─────────────────────────────────────────────────────────────

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) {
            if (today == null && !loading) loadToday()
            if (history == null && !historyLoading) loadHistory(yearMonth)
        }

        val t = today
        when {
            t == null && loading -> EmptyState(shell.str(R.string.loading))
            error != null -> SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(error.orEmpty(), color = Palette.Danger)
                Spacer(Modifier.height(10.dp))
                SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) {
                    loadToday()
                }
            }
            t != null -> {
                TodayCard(t)
                Spacer(Modifier.height(14.dp))
                HistoryBlock()
            }
        }
    }

    // ── Bugungi holat ───────────────────────────────────────────────────────

    @Composable
    private fun TodayCard(t: JSONObject) {
        val status = t.optString("status")
        val rec = t.optJSONObject("today")
        val optIn = t.optBoolean("optIn")
        val (label, bg, fg) = statusLook(status)

        SectionCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val d = todayDate()
                Text(
                    Davomat.dayNumber(d) + " " + Davomat.monthLabel(todayYearMonth) +
                        " · " + Davomat.weekdayLabel(d),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Pill(text = label, bg = bg, fg = fg)
            }
            Spacer(Modifier.height(8.dp))

            InfoRow(shell.str(R.string.att_arrived_at), Davomat.localTime(isoOf(rec, "checkInTime")))
            InfoRow(shell.str(R.string.att_left_at), Davomat.localTime(isoOf(rec, "checkOutTime")))
            InfoRow(
                shell.str(R.string.att_late),
                // Yozuv yo'q bo'lsa — o'lchanmadi (null), 0 EMAS.
                Davomat.lateLabel(if (rec == null) null else rec.optInt("lateMinutes")),
            )

            val sched = t.optJSONObject("schedule")
            if (sched != null && !sched.optBoolean("isDayOff")) {
                InfoRow(
                    shell.str(R.string.att_schedule),
                    sched.optString("startTime") + " – " + sched.optString("endTime"),
                )
            } else if (sched != null) {
                InfoRow(shell.str(R.string.att_schedule), shell.str(R.string.att_dayoff))
            }

            val loc = t.optJSONObject("workLocation")
            if (loc != null) {
                InfoRow(shell.str(R.string.att_workplace), loc.optString("name"))
            }

            if (rec != null && rec.optBoolean("autoClosed")) {
                Spacer(Modifier.height(8.dp))
                Pill(
                    text = shell.str(R.string.att_auto_closed),
                    bg = Palette.WarningContainer,
                    fg = Palette.Warning,
                )
            }

            Spacer(Modifier.height(12.dp))
            Actions(status = status, optIn = optIn, hasLocation = loc != null)
        }
    }

    @Composable
    private fun Actions(status: String, optIn: Boolean, hasLocation: Boolean) {
        if (!optIn) {
            Text(
                shell.str(R.string.att_optin_note),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = shell.str(R.string.att_optin_button),
                enabled = !busy,
            ) { enableOptIn() }
            return
        }
        // Ish joyi biriktirilmagan bo'lsa server har qanday check-in'ni
        // `no_location` bilan rad etadi — buni OLDINDAN aytamiz.
        if (!hasLocation) {
            Text(
                shell.str(R.string.att_no_workplace),
                color = Palette.Warning,
                style = MaterialTheme.typography.bodyMedium,
            )
            return
        }
        when (status) {
            "not_arrived" -> PrimaryButton(
                text = if (busy) shell.str(R.string.att_marking) else shell.str(R.string.att_check_in),
                enabled = !busy,
                color = Palette.Success,
            ) { mark(checkIn = true) }

            "at_work" -> PrimaryButton(
                text = if (busy) shell.str(R.string.att_marking) else shell.str(R.string.att_check_out),
                enabled = !busy,
                color = Palette.Warning,
            ) { mark(checkIn = false) }

            else -> Text(
                shell.str(R.string.att_done_today),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }

    private fun statusLook(status: String): Triple<String, Color, Color> = when (status) {
        "at_work" -> Triple(
            shell.str(R.string.att_status_at_work),
            Palette.SuccessContainer,
            Palette.Success,
        )
        "left" -> Triple(
            shell.str(R.string.att_status_left),
            Palette.PrimaryContainer,
            Palette.OnPrimaryContainer,
        )
        else -> Triple(
            shell.str(R.string.att_status_not_arrived),
            Palette.SurfaceMuted,
            Palette.TextMuted,
        )
    }

    // ── Oylik tarix ─────────────────────────────────────────────────────────

    @Composable
    private fun HistoryBlock() {
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
            // Kelajak oy YOPIQ — u yerda ma'lumot bo'lishi mumkin emas.
            if (Davomat.canGoNext(yearMonth, todayYearMonth)) {
                TextButton(onClick = { changeMonth(1) }) {
                    Text(shell.str(R.string.att_next_month) + " ›", color = Palette.Primary)
                }
            } else {
                Spacer(Modifier.width(72.dp))
            }
        }

        val h = history
        when {
            h == null && historyLoading -> EmptyState(shell.str(R.string.loading))
            h == null -> EmptyState(shell.str(R.string.att_history_empty))
            else -> {
                Totals(h.optJSONObject("totals"))
                Spacer(Modifier.height(8.dp))
                Days(h)
            }
        }
    }

    @Composable
    private fun Totals(totals: JSONObject?) {
        if (totals == null) return
        SectionCard(tint = Palette.SurfaceMuted, border = Palette.Border) {
            InfoRow(shell.str(R.string.att_total_present), totals.optInt("presentDays").toString())
            InfoRow(shell.str(R.string.att_total_late), totals.optInt("lateDays").toString())
            InfoRow(shell.str(R.string.att_total_absent), totals.optInt("absentDays").toString())
            InfoRow(
                shell.str(R.string.att_total_late_minutes),
                Davomat.lateLabel(totals.optInt("lateMinutesTotal")),
            )
        }
    }

    @Composable
    private fun Days(h: JSONObject) {
        val days = h.optJSONArray("days")
        if (days == null || days.length() == 0) {
            EmptyState(shell.str(R.string.att_history_empty))
            return
        }
        SectionCard {
            // Eng yangi kun TEPADA: xodim ko'pincha kechagi kunini qidiradi.
            for (i in days.length() - 1 downTo 0) {
                val d = days.optJSONObject(i) ?: continue
                DayRow(d)
                if (i > 0) Spacer(Modifier.height(2.dp))
            }
        }
    }

    @Composable
    private fun DayRow(d: JSONObject) {
        val status = d.optString("status")
        val date = d.optString("date")
        // 🔴 `optInt` yo'q maydonda 0 beradi — bu «kechikmadi» degani BO'LMAYDI.
        val late = if (d.isNull("lateMinutes")) null else d.optInt("lateMinutes")
        val bg = when (status) {
            "late" -> Palette.WarningContainer
            "absent" -> Palette.DangerContainer
            "dayoff" -> Palette.SurfaceMuted
            else -> Color.Transparent
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(bg, RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.width(46.dp)) {
                Text(
                    Davomat.dayNumber(date),
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    Davomat.weekdayLabel(date),
                    color = Palette.TextMuted,
                    fontSize = 12.sp,
                )
            }
            Text(
                Davomat.timeOrDash(d.optString("checkInTime", "")),
                modifier = Modifier.width(58.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                Davomat.timeOrDash(d.optString("checkOutTime", "")),
                modifier = Modifier.width(58.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                dayStatusLabel(status),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (late != null && late > 0) {
                Spacer(Modifier.width(6.dp))
                Pill(
                    text = Davomat.lateLabel(late),
                    bg = Palette.WarningContainer,
                    fg = Palette.Warning,
                )
            }
            if (d.optBoolean("autoClosed")) {
                Spacer(Modifier.width(6.dp))
                Pill(
                    text = shell.str(R.string.att_auto_closed_short),
                    bg = Palette.SurfaceMuted,
                    fg = Palette.TextMuted,
                )
            }
        }
    }

    /** `MonthlyRow.status` — yopiq lug'at (`monthly-report.util.ts`). */
    private fun dayStatusLabel(status: String): String = when (status) {
        "present" -> shell.str(R.string.att_day_present)
        "late" -> shell.str(R.string.att_day_late)
        "absent" -> shell.str(R.string.att_day_absent)
        "dayoff" -> shell.str(R.string.att_day_off)
        else -> status
    }

    // ── kichik yordamchilar ─────────────────────────────────────────────────

    private fun isoOf(rec: JSONObject?, key: String): String? {
        if (rec == null || rec.isNull(key)) return null
        return rec.optString(key)
    }

    private fun todayDate(): String =
        java.time.LocalDate.now(Davomat.TZ).toString()
}
