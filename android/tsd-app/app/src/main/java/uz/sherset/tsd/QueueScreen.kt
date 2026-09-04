package uz.sherset.tsd

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/**
 * 0.2.0 — OFLAYN NAVBAT EKRANI.
 *
 * G6 da navbat va rad etilganlar topshiriqlar ro'yxatining TEPASIDA turardi;
 * plitkali menyuga o'tish bilan ular o'z ekranini oldi. Mazmun o'zgarmadi:
 *
 * 🔴 RAD ETILGAN amallar (4xx) EKRANDA TURADI va o'zi yo'qolmaydi — ularni
 * omborchi ko'rib, ish qaytadan bajarilishi kerak. Jim yo'qotish IS-5 klassi
 * (2026-08-24 hodisasi tahlili). «Ro'yxatni tozalash» — ATAYLAB qo'lda.
 *
 * Kutayotgan amallar ro'yxati KO'RSATILMAYDI, faqat soni: ular yuborilgach
 * o'z-o'zidan yo'qoladi va omborchining ular ustida qarori yo'q.
 */
class QueueScreen(private val shell: Shell) : Screen {

    private var pending by mutableStateOf(0)
    private var rejected by mutableStateOf<List<ActionQueue.Rejected>>(emptyList())
    private var busy by mutableStateOf(false)

    override fun title(shell: Shell): String = shell.str(R.string.queue_title)

    private fun reload() {
        pending = shell.queue.size()
        rejected = shell.queue.rejected()
    }

    @Composable
    override fun Content() {
        androidx.compose.runtime.LaunchedEffect(Unit) { reload() }

        if (pending == 0 && rejected.isEmpty()) {
            EmptyState(stringResource(R.string.queue_empty))
            return
        }

        if (pending > 0) {
            SectionCard {
                Text(
                    stringResource(R.string.queue_pending, pending),
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(10.dp))
                PrimaryButton(
                    text = stringResource(R.string.queue_send),
                    enabled = !busy,
                ) { flush() }
            }
            Spacer(Modifier.height(10.dp))
        }

        if (rejected.isNotEmpty()) {
            SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
                Text(
                    stringResource(R.string.queue_rejected_title, rejected.size),
                    style = MaterialTheme.typography.titleMedium,
                    color = Palette.Danger,
                )
                Spacer(Modifier.height(8.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    for (r in rejected) {
                        Text(
                            "• ${r.label}",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            r.reason,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Palette.TextMuted,
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                }
                SecondaryButton(
                    text = stringResource(R.string.queue_rejected_clear),
                    color = Palette.Danger,
                ) {
                    shell.queue.clearRejected()
                    reload()
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        SecondaryButton(text = stringResource(R.string.back)) { shell.back() }
    }

    private fun flush() {
        busy = true
        shell.io {
            val r = shell.sender.flush()
            shell.main {
                busy = false
                reload()
                // T4 — «aloqa yo'q» va «rad etilganlar bor» XATO yo'li:
                // omborchi ular haqida bilmasa amal jimgina yo'qolgandek
                // bo'lardi (IS-5). Toza yuborish esa muvaffaqiyat.
                val report = shell.str(R.string.queue_sent, r.sent, r.rejected)
                when {
                    r.offline -> shell.error(shell.str(R.string.queue_offline, r.left))
                    r.rejected > 0 -> shell.error(report)
                    else -> shell.success(report)
                }
            }
        }
    }
}
