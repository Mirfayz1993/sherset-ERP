package uz.sherset.tsd

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * G6.1 — «Mening topshiriqlarim» (0.2.0 dizayni).
 *
 * Ro'yxatda ikki tur birga: `picking` (yig'ish — kassa cheki uchun) va
 * `restock` (joylashtirish — vozvrat tovari). Ular ATAYLAB ajratilmagan:
 * omborchi uchun bu bitta navbat va u qaysi ish oldin kelganiga qarab
 * yuradi; ikki tab qilish uni har safar ikki joyga qaratardi.
 *
 * Kartada `openCount` — hali TEGILMAGAN qatorlar soni (yetishmovchilik
 * belgilangan qator ham YOPIQ, `restock-task-progress.ts` izohi).
 */
class TaskListScreen(private val shell: Shell) : Screen {

    private var items by mutableStateOf(JSONArray())
    private var loading by mutableStateOf(true)

    override fun title(shell: Shell): String = shell.str(R.string.tasks_title)

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) { load() }

        if (loading) {
            EmptyState(stringResource(R.string.loading))
            return
        }

        if (items.length() == 0) {
            EmptyState(stringResource(R.string.tasks_empty))
        } else {
            for (i in 0 until items.length()) {
                val t = items.optJSONObject(i) ?: continue
                TaskCard(t)
                Spacer(Modifier.height(10.dp))
            }
        }

        SecondaryButton(text = stringResource(R.string.tasks_refresh)) { load() }
        Spacer(Modifier.height(8.dp))
        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    @Composable
    private fun TaskCard(t: JSONObject) {
        val picking = t.optString("type") == "picking"
        val open = t.optInt("openCount", 0)
        val total = t.optInt("lineCount", 0)
        val shortage = t.optInt("shortageCount", 0)
        val done = (total - open).coerceAtLeast(0)

        SectionCard(modifier = Modifier.clickable { shell.go(TaskDetailScreen(shell, t.optString("id"))) }) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Pill(
                    text = if (picking) stringResource(R.string.task_kind_picking)
                    else stringResource(R.string.task_kind_restock),
                    bg = if (picking) Palette.PrimaryContainer else Palette.SuccessContainer,
                    fg = if (picking) Palette.OnPrimaryContainer else Palette.Success,
                )
                if (shortage > 0) {
                    // Yetishmovchilik belgisi — kontrol uni ko'radi, lekin
                    // omborchi ham o'z ro'yxatida ko'rib turishi kerak.
                    Pill(
                        text = "⚠ $shortage",
                        bg = Palette.WarningContainer,
                        fg = Palette.Warning,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                t.optString("sourceName").ifEmpty { t.optString("id") },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { if (total == 0) 0f else done.toFloat() / total.toFloat() },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                color = if (open == 0) Palette.Success else MaterialTheme.colorScheme.primary,
                trackColor = Palette.SurfaceMuted,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.task_progress, done, total),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
        }
    }

    private fun load() {
        loading = true
        shell.io {
            val fetched = shell.api.myTasks(shell.employeeId)
            shell.main {
                items = fetched
                loading = false
            }
        }
    }
}
