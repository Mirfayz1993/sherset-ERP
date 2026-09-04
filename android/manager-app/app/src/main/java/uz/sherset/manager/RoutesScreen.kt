package uz.sherset.manager

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import java.time.Instant

/**
 * YO'NALISHLARIM — haydovchining O'Z smenasi, reyslari va qo'lidagi puli
 * (X-reja X4). Server O'ZGARMADI: uch manba ham tayyor edi.
 *
 * Manbalar (hammasi `JwtAuthGuard` + `driverId = user.sub`, ya'ni ilova kimni
 * so'rashini TANLAY OLMAYDI — bu yo'llarda `driverId` parametri UMUMAN yo'q):
 *  - `GET  /driver-tracking/shifts/current` — ochiq smena yoki `null`;
 *  - `POST /driver-tracking/shifts/start|end` — smenani boshlash/yakunlash;
 *  - `GET  /driver-tracking/my/trips` — oxirgi 20 reys;
 *  - `GET  /driver-cash/mine` — o'z naqd yozuvlari.
 *
 * 🔴 VALYUTALAR QO'SHILMAYDI. «Qo'limdagi pul» valyuta kesimida ko'rsatiladi,
 * yakuniy jami HISOBLANMAYDI (X-reja 8-qoidasi) — hisob `Routes` da, testi bor.
 *
 * 🔴 OCHIQ SMENA YIG'MASI KO'RSATILMAYDI. `activeSeconds`/`stopSeconds`/
 * `deliveriesCount` ping-oqimidan FAQAT smena yopilganda hisoblanadi
 * (`driver-shift.service.close`), ochiq smenada ular bazadagi `0` bo'lib
 * turadi. Ularni chizish «bugun 0 yetkazma qildingiz» degan YOLG'ON bo'lardi,
 * shuning uchun yig'ma faqat YAKUNLANGAN smena kartasida chiqadi.
 *
 * 🔴 Reys holatini ilova O'ZGARTIRMAYDI: `PATCH /driver-trips/:id/status`
 * `DispatcherGuard` ostida (haydovchi dispecher bo'la olmaydi — server
 * qarori). Bu ekran reyslar bo'yicha FAQAT O'QIYDI.
 */
class RoutesScreen(private val shell: Shell) : Screen {

    private var shift by mutableStateOf<JSONObject?>(null)
    private var trips by mutableStateOf<JSONArray?>(null)
    private var cash by mutableStateOf<JSONArray?>(null)

    /** Shu sessiyada yakunlangan smena — yig'masi bilan bir marta ko'rsatiladi. */
    private var lastEnded by mutableStateOf<JSONObject?>(null)

    private var loaded by mutableStateOf(false)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    /** Tugma bosilib javob kutilmoqda — qo'sh bosishdan qo'riqlaydi. */
    private var busy by mutableStateOf(false)

    override fun title(shell: Shell): String = shell.str(R.string.tile_my_routes)

    // ── Yuklash ─────────────────────────────────────────────────────────────

    /**
     * Uch manba ham BITTA IO ishida ketma-ket o'qiladi: ekran yaxlit, yarim
     * yuklangan ko'rinish (smena bor, reyslar yo'q) foydalanuvchiga
     * tushunarsiz bo'lardi.
     */
    private fun load() {
        if (loading) return
        loading = true
        error = null
        shell.io {
            try {
                val s = shell.api.driverShiftCurrent()
                val t = shell.api.driverTrips()
                val c = shell.api.driverCashMine()
                shell.main {
                    shift = s
                    trips = t
                    cash = c
                    loaded = true
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

    // ── Amallar ─────────────────────────────────────────────────────────────

    /**
     * Smenani boshlash/yakunlash. Ikkala yo'lda ham HAQIQAT SERVERDA:
     * javobdan keyin holat qaytadan o'qiladi, ilova o'zi taxmin qilmaydi.
     *
     * 400 — kutilgan rad javobi (boshlashda: xodim `field` rejimida emas;
     * yakunlashda: ochiq smena yo'q, masalan kron avtomatik yopgan).
     */
    private fun toggleShift(start: Boolean) {
        if (busy) return
        busy = true
        shell.io {
            try {
                val r = if (start) shell.api.driverShiftStart() else shell.api.driverShiftEnd()
                shell.main {
                    busy = false
                    if (start) {
                        shift = r
                        shell.toast(R.string.route_shift_started)
                    } else {
                        lastEnded = r
                        shift = null
                        shell.toast(R.string.route_shift_ended)
                    }
                    load()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
                shell.main {
                    busy = false
                    shell.toast(
                        when {
                            e.code == 400 && start -> shell.str(R.string.route_not_driver)
                            e.code == 400 -> shell.str(R.string.route_no_open_shift)
                            else -> e.message.orEmpty()
                        },
                    )
                    // Rad sababi serverda — holatni yangilab ko'rsatamiz.
                    load()
                }
            }
        }
    }

    // ── Chizish ─────────────────────────────────────────────────────────────

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) {
            if (!loaded && !loading) load()
        }

        val err = error
        if (err != null) {
            SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(err, color = Palette.Danger)
                Spacer(Modifier.height(10.dp))
                SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) { load() }
            }
            return
        }
        if (!loaded) {
            EmptyState(shell.str(R.string.loading))
            return
        }

        ShiftCard()
        lastEnded?.let {
            Spacer(Modifier.height(10.dp))
            EndedShiftCard(it)
        }

        Spacer(Modifier.height(14.dp))
        CashCard()

        Spacer(Modifier.height(14.dp))
        SectionHeader(shell.str(R.string.route_trips_title))
        TripList()
    }

    // ── Smena ───────────────────────────────────────────────────────────────

    @Composable
    private fun ShiftCard() {
        val open = shift
        SectionCard(
            tint = if (open != null) Palette.SuccessContainer else MaterialTheme.colorScheme.surface,
            border = if (open != null) Palette.Success else Palette.Border,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    shell.str(R.string.route_shift_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(8.dp))
                if (open != null) {
                    Pill(
                        text = shell.str(R.string.route_shift_open),
                        bg = Palette.Surface,
                        fg = Palette.Success,
                    )
                } else {
                    Pill(
                        text = shell.str(R.string.route_shift_closed),
                        bg = Palette.SurfaceMuted,
                        fg = Palette.TextMuted,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            if (open != null) {
                InfoRow(
                    shell.str(R.string.route_started_at),
                    Tasks.dateTime(nullableStr(open, "startedAt"))
                        ?: shell.str(R.string.empty_dash),
                )
                InfoRow(
                    shell.str(R.string.route_duration),
                    Routes.durationLabel(
                        Routes.elapsedSeconds(nullableStr(open, "startedAt"), Instant.now()),
                    ) ?: shell.str(R.string.empty_dash),
                )
                // Yig'ma (harakat/to'xtash/yetkazma) ATAYLAB yo'q — u smena
                // yopilganda hisoblanadi, hozir bazada 0 turadi.
                Spacer(Modifier.height(4.dp))
                Text(
                    shell.str(R.string.route_open_totals_note),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                PrimaryButton(
                    text = if (busy) {
                        shell.str(R.string.route_shift_busy)
                    } else {
                        shell.str(R.string.route_shift_end)
                    },
                    enabled = !busy,
                    color = Palette.Danger,
                ) { toggleShift(start = false) }
            } else {
                Text(
                    shell.str(R.string.route_shift_none),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                PrimaryButton(
                    text = if (busy) {
                        shell.str(R.string.route_shift_busy)
                    } else {
                        shell.str(R.string.route_shift_start)
                    },
                    enabled = !busy,
                    color = Palette.Success,
                ) { toggleShift(start = true) }
            }
        }
    }

    /** Yakunlangan smena yig'masi — raqamlar SERVERDA qayta hisoblangan. */
    @Composable
    private fun EndedShiftCard(ended: JSONObject) {
        SectionCard {
            Text(
                shell.str(R.string.route_shift_summary),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
            InfoRow(
                shell.str(R.string.route_started_at),
                Tasks.dateTime(nullableStr(ended, "startedAt")) ?: shell.str(R.string.empty_dash),
            )
            InfoRow(
                shell.str(R.string.route_ended_at),
                Tasks.dateTime(nullableStr(ended, "endedAt")) ?: shell.str(R.string.empty_dash),
            )
            InfoRow(
                shell.str(R.string.route_active_time),
                Routes.durationLabel(optLong(ended, "activeSeconds"))
                    ?: shell.str(R.string.empty_dash),
            )
            InfoRow(
                shell.str(R.string.route_stop_time),
                Routes.durationLabel(optLong(ended, "stopSeconds"))
                    ?: shell.str(R.string.empty_dash),
            )
            InfoRow(
                shell.str(R.string.route_deliveries),
                optLong(ended, "deliveriesCount")?.toString() ?: shell.str(R.string.empty_dash),
            )
            if (ended.optBoolean("autoClosed")) {
                Spacer(Modifier.height(6.dp))
                Pill(
                    text = shell.str(R.string.route_auto_closed),
                    bg = Palette.WarningContainer,
                    fg = Palette.Warning,
                )
            }
        }
    }

    // ── Qo'limdagi pul ──────────────────────────────────────────────────────

    /**
     * 🔴 Valyutalar ALOHIDA qatorlarda. Yakuniy «jami» YO'Q va bo'lmaydi:
     * kurssiz qo'shilgan summa yolg'on raqam bo'lardi (X-reja 8-qoidasi,
     * `money-map` dagi bir xil qaror).
     */
    @Composable
    private fun CashCard() {
        val rows = cash
        val totals = Routes.pendingByCurrency(cashRows(rows))
        SectionCard {
            Text(
                shell.str(R.string.route_cash_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
            if (totals.isEmpty()) {
                Text(
                    shell.str(R.string.route_cash_empty),
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
                return@SectionCard
            }
            for (t in totals) {
                InfoRow(
                    shell.str(R.string.route_cash_count, t.currency, t.count),
                    // `null` — o'qib bo'lmadi; «0 so'm» EMAS.
                    t.totalMinor?.let { Fmt.minor(it, t.currency) }
                        ?: shell.str(R.string.route_cash_unreadable),
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                shell.str(R.string.route_cash_note),
                color = Palette.TextMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }

    /** `JSONArray` → sof funksiyalar tushunadigan ro'yxat (org.json shu yerda qoladi). */
    private fun cashRows(arr: JSONArray?): List<Routes.CashRow> {
        if (arr == null) return emptyList()
        val out = ArrayList<Routes.CashRow>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(
                Routes.CashRow(
                    amountMinor = nullableStr(o, "amountMinor"),
                    currency = nullableStr(o, "currency"),
                    status = nullableStr(o, "status"),
                ),
            )
        }
        return out
    }

    // ── Reyslar ─────────────────────────────────────────────────────────────

    @Composable
    private fun TripList() {
        val list = trips
        if (list == null || list.length() == 0) {
            EmptyState(shell.str(R.string.route_trips_empty))
            return
        }
        for (i in 0 until list.length()) {
            val t = list.optJSONObject(i) ?: continue
            TripCard(t)
            if (i < list.length() - 1) Spacer(Modifier.height(10.dp))
        }
    }

    @Composable
    private fun TripCard(t: JSONObject) {
        val status = t.optString("status")
        val active = Routes.isTripActive(status)
        SectionCard(
            border = if (active) Palette.Primary else Palette.Border,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    Routes.destLabel(
                        nullableStr(t, "destAddress"),
                        optDouble(t, "destLat"),
                        optDouble(t, "destLng"),
                    ) ?: shell.str(R.string.route_no_address),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(8.dp))
                val (label, bg, fg) = statusLook(status)
                Pill(text = label, bg = bg, fg = fg)
            }

            Spacer(Modifier.height(8.dp))
            InfoRow(shell.str(R.string.route_order_type), orderTypeLabel(t.optString("orderType")))
            InfoRow(
                shell.str(R.string.route_assigned_at),
                Tasks.dateTime(nullableStr(t, "assignedAt")) ?: shell.str(R.string.empty_dash),
            )
            // Bosib o'tilgan bosqichlar FAQAT bo'lsa chiziladi: yo'q bosqichni
            // «—» bilan ko'rsatish qatorlarni ma'nosiz uzaytiradi.
            Tasks.dateTime(nullableStr(t, "startedAt"))
                ?.let { InfoRow(shell.str(R.string.route_started_trip), it) }
            Tasks.dateTime(nullableStr(t, "arrivedAt"))
                ?.let { InfoRow(shell.str(R.string.route_arrived_at), it) }
            Tasks.dateTime(nullableStr(t, "completedAt"))
                ?.let { InfoRow(shell.str(R.string.route_completed_at), it) }

            // Manzil matni bo'lsa koordinata ham kerak (navigatorga qo'lda
            // kiritish uchun) — takror bo'lsa chizilmaydi.
            val addr = nullableStr(t, "destAddress")
            val coords = Routes.coords(optDouble(t, "destLat"), optDouble(t, "destLng"))
            if (!addr.isNullOrBlank() && coords != null) {
                InfoRow(shell.str(R.string.route_coords), coords)
            }

            // 🔴 ETA — SERVER hisoblagan taxmin va ESKIRGAN bo'lishi mumkin
            // (`eta-worker.cron.ts`). Shuning uchun qachon hisoblangani BIRGA
            // ko'rsatiladi va u faqat yakunlanmagan reysda chiqadi.
            if (active) {
                val etaSec = optLong(t, "etaSeconds")
                val etaAt = Tasks.dateTime(nullableStr(t, "etaComputedAt"))
                val etaLabel = Routes.durationLabel(etaSec)
                if (etaLabel != null && etaAt != null) {
                    InfoRow(shell.str(R.string.route_eta), "$etaLabel · $etaAt")
                }
                Routes.distanceLabel(optLong(t, "distanceMeters")?.toInt())
                    ?.let { InfoRow(shell.str(R.string.route_distance), it) }
            }
        }
    }

    /** `Routes.tripStatusTone` kalitidan yorliq + ranglar. */
    private fun statusLook(status: String): Triple<String, Color, Color> =
        when (Routes.tripStatusTone(status)) {
            "assigned" -> Triple(
                shell.str(R.string.route_status_assigned),
                Palette.PrimaryContainer,
                Palette.OnPrimaryContainer,
            )
            "enroute" -> Triple(
                shell.str(R.string.route_status_enroute),
                Palette.WarningContainer,
                Palette.Warning,
            )
            "arrived" -> Triple(
                shell.str(R.string.route_status_arrived),
                Palette.SuccessContainer,
                Palette.Success,
            )
            "done" -> Triple(
                shell.str(R.string.route_status_completed),
                Palette.SurfaceMuted,
                Palette.TextMuted,
            )
            "cancelled" -> Triple(
                shell.str(R.string.route_status_cancelled),
                Palette.DangerContainer,
                Palette.Danger,
            )
            // Server yangi holat qo'shsa ilova yiqilmaydi — xom qiymat chiqadi.
            else -> Triple(status, Palette.SurfaceMuted, Palette.TextMuted)
        }

    private fun orderTypeLabel(orderType: String?): String =
        when (Routes.orderTypeTone(orderType)) {
            "demand" -> shell.str(R.string.route_order_demand)
            "retail_sale" -> shell.str(R.string.route_order_retail)
            "manual" -> shell.str(R.string.route_order_manual)
            else -> shell.str(R.string.empty_dash)
        }

    @Composable
    private fun SectionHeader(text: String) {
        Text(
            text,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = Palette.TextMuted,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        )
    }

    // ── org.json yordamchilari ──────────────────────────────────────────────

    private fun nullableStr(o: JSONObject, key: String): String? =
        if (o.isNull(key)) null else o.optString(key)

    private fun optLong(o: JSONObject, key: String): Long? =
        if (o.isNull(key)) null else o.optLong(key)

    private fun optDouble(o: JSONObject, key: String): Double? =
        if (o.isNull(key)) null else o.optDouble(key)
}
