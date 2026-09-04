package uz.sherset.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * ISHLARIM — xodimning O'Z vazifalari (X-reja X3).
 *
 * Manba: `GET /hr/tasks/my` — `tasks:own_only`, `employeeId = user.sub`.
 * Ilova kimni so'rashini TANLAY OLMAYDI (so'rovda bunday parametr yo'q).
 *
 * 🔴 Bu ekran v0.1 ning «faqat o'qish» qoidasidan ATAYLAB istisno: vazifaga
 * javob berish — xodimning O'Z amali, boshqa odamning ma'lumotiga tegmaydi
 * (`POST /hr/tasks/logs/:id/answer`, egalik servisda tekshiriladi).
 *
 * Javobdan keyin ro'yxat SERVERDAN qayta o'qiladi: haqiqiy holatni
 * (`pending_review` mi, darhol yopildimi) shablondagi tekshiruvchi hal
 * qiladi, ilova uni taxmin qilmaydi.
 */
class MyTasksScreen(private val shell: Shell) : Screen {

    /** `null` — hammasi; `"sent"` — javob kutayotganlari. */
    private var statusFilter by mutableStateOf<String?>("sent")

    private var rows by mutableStateOf<JSONArray?>(null)
    private var loading by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    /** Javob yozilayotgan vazifa (`id`) — matnli javob maydoni shu kartada ochiladi. */
    private var answeringId by mutableStateOf<String?>(null)
    private var answerText by mutableStateOf("")

    /** Javob yuborilmoqda — qo'sh bosishdan qo'riqlaydi. */
    private var busy by mutableStateOf(false)

    override fun title(shell: Shell): String = shell.str(R.string.tile_my_tasks)

    // ── Yuklash ─────────────────────────────────────────────────────────────

    private fun load() {
        loading = true
        error = null
        val asked = statusFilter
        shell.io {
            try {
                val r = shell.api.myTasks(asked, LIMIT)
                shell.main {
                    // Filtr tez almashtirilsa eski javob yangisining ustiga
                    // yozilmasin (X2 dagi oy tanlagichi bilan bir xil tuzoq).
                    if (asked == statusFilter) {
                        rows = r.optJSONArray("rows") ?: JSONArray()
                        loading = false
                    }
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
                shell.main {
                    if (asked != statusFilter) return@main
                    loading = false
                    error = if (e.code == 403) shell.str(R.string.no_permission) else e.message
                }
            }
        }
    }

    private fun changeFilter(status: String?) {
        if (statusFilter == status) return
        statusFilter = status
        rows = null
        answeringId = null
        load()
    }

    // ── Javob berish ────────────────────────────────────────────────────────

    private fun send(logId: String, type: String, text: String?) {
        if (busy) return
        busy = true
        shell.io {
            try {
                shell.api.answerTask(logId, type, text)
                shell.main {
                    busy = false
                    answeringId = null
                    answerText = ""
                    shell.toast(R.string.task_answer_sent)
                    // Haqiqat serverda: tekshiruvchi bo'lsa holat
                    // `pending_review` bo'ladi, bo'lmasa darhol yopiladi.
                    load()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.code == 401) throw e
                shell.main {
                    busy = false
                    shell.toast(
                        when (e.code) {
                            403 -> shell.str(R.string.task_answer_forbidden)
                            400 -> shell.str(R.string.task_answer_stale)
                            else -> e.message.orEmpty()
                        },
                    )
                    // Rad etilgan sabab serverda — ro'yxatni yangilab ko'rsatamiz.
                    load()
                }
            }
        }
    }

    // ── Chizish ─────────────────────────────────────────────────────────────

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) {
            if (rows == null && !loading) load()
        }

        FilterRow()
        Spacer(Modifier.height(10.dp))

        val list = rows
        when {
            error != null -> SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(error.orEmpty(), color = Palette.Danger)
                Spacer(Modifier.height(10.dp))
                SecondaryButton(text = shell.str(R.string.retry), color = Palette.Danger) { load() }
            }
            list == null && loading -> EmptyState(shell.str(R.string.loading))
            list == null || list.length() == 0 -> EmptyState(
                if (statusFilter == "sent") {
                    shell.str(R.string.task_empty_new)
                } else {
                    shell.str(R.string.task_empty_all)
                },
            )
            else -> {
                for (i in 0 until list.length()) {
                    val t = list.optJSONObject(i) ?: continue
                    TaskCard(t)
                    if (i < list.length() - 1) Spacer(Modifier.height(10.dp))
                }
            }
        }
    }

    @Composable
    private fun FilterRow() {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(shell.str(R.string.task_filter_new), statusFilter == "sent") {
                changeFilter("sent")
            }
            FilterChip(shell.str(R.string.task_filter_all), statusFilter == null) {
                changeFilter(null)
            }
        }
    }

    /**
     * Filtr plashkasi. `Widgets.Pill` faqat CHIZADI (bosilmaydi), shuning
     * uchun bu yerda o'z varianti — v0.1 vidjetlariga tegmaslik uchun ataylab
     * shu faylda qoldirildi.
     */
    @Composable
    private fun FilterChip(text: String, selected: Boolean, onClick: () -> Unit) {
        Text(
            text,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(if (selected) Palette.Primary else Palette.SurfaceMuted)
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 9.dp),
            color = if (selected) Palette.OnPrimary else Palette.TextMuted,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.bodyMedium,
        )
    }

    /**
     * Ko'p qatorli javob maydoni. `Widgets.PlainField` bir qatorli (login
     * uchun qilingan), vazifa javobi esa 2000 belgigacha bo'lishi mumkin.
     */
    @Composable
    private fun AnswerField() {
        OutlinedTextField(
            value = answerText,
            onValueChange = { answerText = it },
            modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp),
            minLines = 3,
            maxLines = 6,
            label = { Text(shell.str(R.string.task_answer_hint)) },
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MaterialTheme.colorScheme.primary,
                unfocusedBorderColor = Palette.Border,
            ),
        )
    }

    @Composable
    private fun TaskCard(t: JSONObject) {
        val id = t.optString("id")
        val status = t.optString("status")
        val responseType = t.optString("responseType")
        val overdue = t.optBoolean("overdue")
        // 🔴 Server aytadi; ilova o'z soati bilan qayta hisoblamaydi.
        val needsAnswer = t.optBoolean("needsAnswer") && Tasks.needsAnswer(status, responseType)

        SectionCard(
            tint = if (overdue) Palette.DangerContainer else MaterialTheme.colorScheme.surface,
            border = if (overdue) Palette.Danger else Palette.Border,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    t.optString("title"),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(8.dp))
                val (label, bg, fg) = statusLook(status)
                Pill(text = label, bg = bg, fg = fg)
            }

            val desc = if (t.isNull("description")) null else t.optString("description")
            if (!desc.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    desc,
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            Spacer(Modifier.height(8.dp))
            InfoRow(
                shell.str(R.string.task_sent_at),
                Tasks.dateTime(nullableStr(t, "sentAt")) ?: shell.str(R.string.empty_dash),
            )
            // Muddat YO'Q — bu «muddati bugun» ham, «kechikkan» ham emas.
            InfoRow(
                shell.str(R.string.task_deadline),
                Tasks.dateTime(nullableStr(t, "deadlineAt")) ?: shell.str(R.string.task_no_deadline),
            )

            val answeredAt = Tasks.dateTime(nullableStr(t, "answeredAt"))
            if (answeredAt != null) InfoRow(shell.str(R.string.task_answered_at), answeredAt)

            val myAnswer = nullableStr(t, "responseText")
            if (!myAnswer.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    shell.str(R.string.task_my_answer) + ": " + myAnswer,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            val review = nullableStr(t, "reviewComment")
            if (!review.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    shell.str(R.string.task_review_comment) + ": " + review,
                    color = Palette.TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            if (Tasks.isUrgent(t.optString("priority"))) {
                Spacer(Modifier.height(8.dp))
                Pill(
                    text = shell.str(R.string.task_urgent),
                    bg = Palette.WarningContainer,
                    fg = Palette.Warning,
                )
            }

            if (overdue) {
                Spacer(Modifier.height(8.dp))
                Text(
                    shell.str(R.string.task_overdue),
                    color = Palette.Danger,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            if (needsAnswer) {
                Spacer(Modifier.height(12.dp))
                AnswerActions(id, responseType)
            }
        }
    }

    @Composable
    private fun AnswerActions(id: String, responseType: String) {
        if (Tasks.isTextAnswer(responseType)) {
            if (answeringId != id) {
                PrimaryButton(text = shell.str(R.string.task_answer_open), enabled = !busy) {
                    answeringId = id
                    answerText = ""
                }
                return
            }
            AnswerField()
            Spacer(Modifier.height(8.dp))
            PrimaryButton(
                text = if (busy) shell.str(R.string.task_answer_sending)
                else shell.str(R.string.task_answer_send),
                // Bo'sh matn serverda 400 bo'lardi — tugma oldindan yopiq.
                enabled = !busy && Tasks.isAnswerTextValid(answerText),
            ) { send(id, "text", answerText.trim()) }
            Spacer(Modifier.height(6.dp))
            SecondaryButton(text = shell.str(R.string.task_answer_cancel), color = Palette.TextMuted) {
                answeringId = null
                answerText = ""
            }
            return
        }
        // `yes_no` — ikki tugma.
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                PrimaryButton(
                    text = shell.str(R.string.task_answer_yes),
                    enabled = !busy,
                    color = Palette.Success,
                ) { send(id, "yes", null) }
            }
            Column(modifier = Modifier.weight(1f)) {
                PrimaryButton(
                    text = shell.str(R.string.task_answer_no),
                    enabled = !busy,
                    color = Palette.Danger,
                ) { send(id, "no", null) }
            }
        }
    }

    /** `Tasks.statusTone` kalitidan yorliq + ranglar. */
    private fun statusLook(status: String): Triple<String, Color, Color> =
        when (Tasks.statusTone(status)) {
            "new" -> Triple(
                shell.str(R.string.task_status_new),
                Palette.PrimaryContainer,
                Palette.OnPrimaryContainer,
            )
            "pending" -> Triple(
                shell.str(R.string.task_status_pending),
                Palette.WarningContainer,
                Palette.Warning,
            )
            "ok" -> Triple(
                shell.str(R.string.task_status_ok),
                Palette.SuccessContainer,
                Palette.Success,
            )
            "bad" -> Triple(
                shell.str(R.string.task_status_bad),
                Palette.DangerContainer,
                Palette.Danger,
            )
            "failed" -> Triple(
                shell.str(R.string.task_status_failed),
                Palette.SurfaceMuted,
                Palette.TextMuted,
            )
            // Server yangi holat qo'shsa ilova yiqilmaydi — xom qiymat chiqadi.
            else -> Triple(status, Palette.SurfaceMuted, Palette.TextMuted)
        }

    private fun nullableStr(o: JSONObject, key: String): String? =
        if (o.isNull(key)) null else o.optString(key)

    private companion object {
        /** Server chegarasi 200; 100 ta karta bitta ekran uchun yetarli. */
        const val LIMIT = 100
    }
}
