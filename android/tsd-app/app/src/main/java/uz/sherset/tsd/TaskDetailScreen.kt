package uz.sherset.tsd

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
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * G6.1 — TOPSHIRIQ EKRANI: qatorlar, tasdiqlash, yetishmovchilik.
 *
 * Qatorlar YACHEYKA MARSHRUTI tartibida keladi — saralashni SERVER qiladi
 * (`restock-task-progress.ts#sortLinesByRoute`), klient uni qayta
 * saralamaydi. Sabab: tartib biznes qoidasi, ikki joyda ikki xil bo'lsa
 * omborchi web va terminalda boshqa-boshqa marshrut ko'rardi.
 *
 * 🔴 «TAYYOR» TUGMASI YO'Q — G2 hisobotining G6 ga eslatmasi: TSD'da chekni
 * `mark-ready` bilan flip qilish YO'Q. Hamma qator yopilgach topshiriq
 * o'z-o'zidan `done` bo'ladi va chek KONTROL navbatiga tushadi (katta
 * omborchi ko'z bilan tekshiradi). Shuning uchun ekran «kontrolga ketdi»
 * deb aytadi, «tayyor» demaydi.
 */
class TaskDetailScreen(
    private val shell: Shell,
    private val taskId: String,
) : Screen {

    private var task by mutableStateOf<JSONObject?>(null)
    private var loading by mutableStateOf(true)

    /**
     * 🔴 T10 — topshiriq KESHDAN chizildimi (`null` = jonli javob).
     *
     * Oflayn ko'rinish FAQAT O'QISH: «Oldim», «Topolmadim» va «Kesish»
     * tugmalari CHIZILMAYDI. Sabab qat'iy — bu tugmalar «qator hali OCHIQ»
     * degan xulosani bajaradi, xulosa esa keshdan chiqadi: shu orada
     * qatorni boshqa terminal yopgan yoki kontrol bekor qilgan bo'lishi
     * mumkin. Amal navbatga tushib, keyin 4xx bilan rad etilar edi — ya'ni
     * omborchi «bo'ldi» degan javobni eshitib, ishi rad etilganlar
     * ro'yxatiga tushardi.
     *
     * Yo'qotilgan narsa yo'q: ilgari oflaynda bu ekran umuman ochilmasdi
     * (`load()` yiqilib, «Yuklanmoqda…» abadiy qolardi).
     */
    private var cachedAt by mutableStateOf<Long?>(null)

    /** Jim yangilash halqasining kaliti. */
    private var retry by mutableStateOf(0)

    /**
     * 🔴 T10 — jim yangilash AYNI DAMDA ketmoqdami.
     *
     * `Shell.io` YAGONA thread'da yuradi (`MainActivity.ioPool`), zaif
     * Wi-Fi'da esa bitta so'rov 15 soniyagacha `connectTimeout` ushlaydi —
     * ya'ni 20 soniyalik halqa qo'riqchisiz bo'lsa navbat O'SARDI va
     * omborchining o'z amallari o'sha navbat orqasida kutib qolardi.
     * Bayroq Compose state EMAS: u chizishda o'qilmaydi (o'qish ham, yozish
     * ham UI thread'da — [CountScreen.onScreen] naqshi).
     */
    private var refreshing = false

    override fun title(shell: Shell): String = shell.str(R.string.task_title)

    /**
     * Skan qatorni tasdiqlaydi (`confirm-scan`) — omborchi tovarni javondan
     * olib skanerlaydi. Multi-hit MAJBURIY: shtrix bir nechta tovarga tegishli
     * bo'lsa ilova O'ZI birortasini tanlamaydi.
     */
    override fun onScan(code: String): Boolean {
        // BETARAF xabar (T4): bu na muvaffaqiyat, na xato — shunchaki
        // «so'rov ketdi». Shuning uchun toast QOLADI va signal berilmaydi;
        // natija kelganda `onScanResult` o'zi ok/fail ni aytadi.
        shell.toast(R.string.scan_working)
        shell.io {
            val hit = try {
                shell.api.scan(code)
            } catch (e: ApiClient.ApiException) {
                // 🔴 T10 — skan tasdiq YO'LI, ya'ni yozish. Keshda «bu shtrix
                // qaysi tovar» degan javob yo'q va bo'lishi ham kerak emas:
                // tasdiq faqat jonli tasnifdan keyin ketadi.
                shell.error(
                    if (e.retriable) shell.str(R.string.cache_no_actions) else (e.message ?: ""),
                )
                return@io
            }
            shell.main { onScanResult(hit) }
        }
        return true
    }

    private fun onScanResult(hit: JSONObject) {
        val products = hit.optJSONArray("products") ?: JSONArray()
        when {
            hit.optString("kind") == "piece" -> shell.error(R.string.scan_piece)
            products.length() == 0 -> shell.error(R.string.scan_none)
            // Bitta topilgan holatda signal BERILMAYDI: darhol `confirm-scan`
            // ketadi va uning javobi (tasdiqlandi / xato) o'z signalini
            // beradi — aks holda bitta skanga ikkita ovoz chiqardi.
            products.length() == 1 -> confirmByProduct(products.getJSONObject(0).optString("id"))
            else -> {
                // Multi-hit: TANLOVNI ODAM qiladi (G-reja majburiy qoidasi).
                // T4 — tovar tanildi, tanlov ro'yxati ochilmoqda.
                Feedback.ok()
                shell.go(
                    PickProductScreen(shell, products) { p ->
                        shell.back()
                        confirmByProduct(p.optString("id"))
                    },
                )
            }
        }
    }

    @Composable
    override fun Content() {
        LaunchedEffect(Unit) { load() }

        val t = task
        if (loading || t == null) {
            EmptyState(stringResource(R.string.loading))
            return
        }

        val lines = t.optJSONArray("lines") ?: JSONArray()
        var open = 0
        for (i in 0 until lines.length()) {
            val l = lines.optJSONObject(i) ?: continue
            if (!isClosed(l)) open++
        }
        val total = lines.length()
        val done = total - open

        val staleAt = cachedAt
        if (staleAt != null) {
            OfflineBadge(savedAt = staleAt, note = stringResource(R.string.cache_no_actions))
            Spacer(Modifier.height(10.dp))
            // Aloqa qaytganda JIM yangilash (izohi `CountScreen.refreshQuietly`).
            LaunchedEffect(retry, staleAt) {
                delay(CacheShape.RETRY_MS)
                refreshQuietly()
                retry++
            }
        }

        SectionCard {
            Text(
                t.optString("sourceName").ifEmpty { stringResource(R.string.task_title) },
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
        Spacer(Modifier.height(10.dp))

        if (open == 0) {
            // Hamma qator yopilgan — chek endi KONTROLDA (G2 zanjiri).
            SectionCard(tint = Palette.SuccessContainer, border = Palette.Success) {
                Text(
                    stringResource(R.string.task_done_control),
                    style = MaterialTheme.typography.titleMedium,
                    color = Palette.Success,
                )
            }
            Spacer(Modifier.height(10.dp))
        }

        for (i in 0 until lines.length()) {
            val l = lines.optJSONObject(i) ?: continue
            LineCard(l)
            Spacer(Modifier.height(10.dp))
        }

        SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
            shell.back()
        }
    }

    @Composable
    private fun LineCard(l: JSONObject) {
        val closed = isClosed(l)
        val confirmed = !l.isNull("confirmedAt")
        val shortageQty = if (l.isNull("shortageQty")) null else l.optString("shortageQty")

        SectionCard(
            tint = when {
                confirmed -> Palette.SuccessContainer
                shortageQty != null -> Palette.WarningContainer
                else -> Palette.Surface
            },
            border = when {
                confirmed -> Palette.Success
                shortageQty != null -> Palette.Warning
                else -> Palette.Border
            },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CellBadge(l.optString("binLocation").ifEmpty { stringResource(R.string.no_cell) })
                when {
                    confirmed -> Pill("✔", Palette.SuccessContainer, Palette.Success)
                    shortageQty != null ->
                        Pill("⚠ $shortageQty", Palette.WarningContainer, Palette.Warning)
                }
            }
            Spacer(Modifier.height(8.dp))
            // NARX YO'Q: server bu javobda narx maydonini umuman bermaydi.
            Text(
                l.optString("productName"),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.line_qty, l.optString("quantity")),
                style = MaterialTheme.typography.bodyLarge,
                color = Palette.TextMuted,
            )

            if (closed) return@SectionCard
            // 🔴 T10 — kesh ustida AMAL tugmalari yo'q (sabab `cachedAt`
            // izohida). Qator o'zi ko'rinadi: omborchi nimani yig'ishini
            // biladi, tasdiqni esa aloqa qaytgach beradi.
            if (cachedAt != null) return@SectionCard

            Spacer(Modifier.height(12.dp))
            // K4 — bo'linadigan tovar: qator KESIMSIZ yopilmaydi (server ham
            // rad etadi). Tugma FAQAT reyestrda manba bor bo'lganda chiqadi:
            // reyestr bo'sh bo'lsa qator odatdagidek tasdiqlanadi (K3 ning
            // `no-registry` qoidasi — bo'lak hisobi savdoni to'xtatmaydi).
            if (l.optBoolean("pieceTracked") &&
                (l.optJSONArray("pieceOptions")?.length() ?: 0) > 0
            ) {
                PrimaryButton(
                    text = stringResource(R.string.cut_button),
                    color = Palette.CellText,
                ) { shell.go(CutScreen(shell, taskId, l)) }
                Spacer(Modifier.height(8.dp))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PrimaryButton(
                    text = stringResource(R.string.line_confirm),
                    modifier = Modifier.weight(1f),
                    color = Palette.Success,
                ) { confirmLine(l.optString("id")) }
                SecondaryButton(
                    text = stringResource(R.string.line_shortage),
                    modifier = Modifier.weight(1f),
                    color = Palette.Warning,
                ) { shell.go(ShortageScreen(shell, taskId, l)) }
            }
        }
    }

    private fun load() {
        loading = true
        shell.io {
            val t = try {
                shell.api.task(taskId)
            } catch (e: ApiClient.ApiException) {
                // 🔴 T10 — aloqa yo'q: oxirgi ko'rilgan topshiriq chiziladi
                // (faqat o'qish uchun). Ilgari ekran «Yuklanmoqda…» da
                // abadiy qolardi va omborchi nimani yig'ishini ko'rolmasdi.
                val hit = if (e.retriable) shell.cache.task(taskId) else null
                shell.main {
                    loading = false
                    if (hit == null) return@main
                    task = hit.body
                    cachedAt = hit.savedAt
                }
                if (hit == null) shell.error(e.message ?: "")
                return@io
            }
            shell.cache.putTask(taskId, t)
            shell.main {
                task = t
                cachedAt = null
                loading = false
            }
        }
    }

    /** T10 — aloqa qaytganda jim yangilash: xato KO'RSATILMAYDI. */
    private fun refreshQuietly() {
        if (refreshing) return
        refreshing = true
        shell.io {
            val t = try {
                shell.api.task(taskId)
            } catch (e: ApiClient.ApiException) {
                Diagnostics.log("CACHE topshiriq jim yangilanmadi: " + (e.message ?: ""))
                shell.main { refreshing = false }
                return@io
            }
            shell.cache.putTask(taskId, t)
            shell.main {
                task = t
                cachedAt = null
                refreshing = false
            }
        }
    }

    private fun confirmByProduct(productId: String) {
        val opId = UUID.randomUUID().toString()
        shell.io {
            try {
                shell.api.confirmScan(taskId, productId, opId)
                shell.main {
                    shell.success(shell.str(R.string.line_confirmed))
                    load()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.retriable) {
                    shell.enqueue(
                        "POST",
                        "/restock-tasks/$taskId/confirm-scan",
                        JSONObject().put("productId", productId).put("clientOpId", opId),
                        shell.str(R.string.op_confirm_scan),
                    )
                } else {
                    shell.error(e.message ?: "")
                }
            }
        }
    }

    private fun confirmLine(lineId: String) {
        val opId = UUID.randomUUID().toString()
        val path = "/restock-tasks/$taskId/lines/$lineId/confirm"
        val payload = JSONObject().put("clientOpId", opId)
        shell.io {
            try {
                shell.api.send("POST", path, payload)
                shell.main {
                    shell.success(shell.str(R.string.line_confirmed))
                    load()
                }
            } catch (e: ApiClient.ApiException) {
                if (e.retriable) {
                    shell.enqueue("POST", path, payload, shell.str(R.string.op_confirm_line))
                } else {
                    shell.error(e.message ?: "")
                }
            }
        }
    }

    private fun isClosed(l: JSONObject): Boolean =
        !l.isNull("confirmedAt") || !l.isNull("shortageQty")
}
