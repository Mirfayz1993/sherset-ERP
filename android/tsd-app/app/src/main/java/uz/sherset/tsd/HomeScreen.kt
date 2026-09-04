package uz.sherset.tsd

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * 0.2.0 — BOSH EKRAN: plitkali menyu (egasining tanlovi, 2026-09-01).
 *
 * G6 da bosh ekran topshiriqlar RO'YXATI edi va tez-amallar uning tepasida
 * tugmalar bo'lib turardi. Egasi plitkali menyuni tanladi: omborchining to'rt
 * ishi bir xil darajada ko'rinadi va hech biri ro'yxat ostida qolmaydi.
 *
 * Skan HAR QANDAY ekranda ishlaydi (yuqoridagi maydon doim fokusda) — shuning
 * uchun «Skan» alohida plitka EMAS: u rejim emas, doimiy imkoniyat.
 */
class HomeScreen(private val shell: Shell) : Screen {

    override fun title(shell: Shell): String = shell.str(R.string.home_title)

    @Composable
    override fun Content() {
        val pending = shell.queue.size()
        val rejected = shell.queue.rejected().size
        // Yangilanish kartasi ENG TEPADA: u vaqtinchalik va harakat talab
        // qiladi, plitkalar esa doimiy.
        val host = shell as? MainActivity
        if (host != null && host.update !is UpdateState.None) {
            UpdateCard(
                state = host.update,
                installedVersion = host.appVersionName,
                onDownload = { host.downloadUpdate() },
                onInstall = { host.installUpdate() },
            )
            Spacer(Modifier.height(12.dp))
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Tile(
                icon = Icons.AutoMirrored.Filled.List,
                label = stringResource(R.string.tasks_title),
                tint = MaterialTheme.colorScheme.primary,
            ) { shell.go(TaskListScreen(shell)) }
            Tile(
                icon = Icons.Filled.Place,
                label = stringResource(R.string.place_title),
                tint = Palette.Success,
            ) { shell.go(PlaceScreen(shell)) }
        }
        Spacer(Modifier.height(10.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Tile(
                icon = Icons.Filled.CheckCircle,
                label = stringResource(R.string.count_title),
                tint = Palette.CellText,
            ) { shell.go(CountScreen(shell)) }
            // T3 — «bu nima va qayerda» savoliga SHTRIXSIZ javob. Natija
            // bosilganda o'zgartiruvchi oqim emas, NARXSIZ ma'lumot ekrani
            // ochiladi (ko'chirish uchun alohida «Joylashtirish» plitkasi bor).
            Tile(
                icon = Icons.Filled.Search,
                label = stringResource(R.string.search_title),
                tint = Palette.Accent,
            ) {
                shell.go(
                    SearchScreen(shell) { p ->
                        shell.go(
                            ScanInfoScreen(
                                shell,
                                // `ScanInfoScreen` skan javobini kutadi —
                                // qidiruv elementi AYNI shaklda bo'lgani uchun
                                // (server: `buildProductHits`) uni shu yerda
                                // o'rash yetarli, yangi so'rov KERAK EMAS.
                                JSONObject()
                                    .put("kind", "product")
                                    .put("products", JSONArray().put(p)),
                            ),
                        )
                    },
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Tile(
                icon = Icons.AutoMirrored.Filled.Send,
                label = stringResource(R.string.queue_title),
                tint = if (pending > 0 || rejected > 0) Palette.Warning else Palette.TextMuted,
                // Kutayotgan va RAD ETILGAN amallar soni plitkada ko'rinadi —
                // omborchi navbat ekraniga kirmasdan ham biladi (IS-5: jim
                // yo'qotish yo'q).
                badge = when {
                    rejected > 0 -> "$pending · ⚠$rejected"
                    pending > 0 -> pending.toString()
                    else -> null
                },
            ) { shell.go(QueueScreen(shell)) }
            // Beshinchi plitka yo'q — bo'sh yarim qator qoldiriladi, aks holda
            // Navbat plitkasi butun enni egallab, ustidagi to'rtta bilan bir
            // xil o'lchamda ko'rinmasdi.
            Spacer(Modifier.weight(1f))
        }

        Spacer(Modifier.height(14.dp))
        Text(
            stringResource(R.string.home_scan_tip),
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(10.dp))
        // Skaner nosozligini QURILMANING O'ZI ko'rsatsin (USB/logcat yo'q).
        SecondaryButton(
            text = stringResource(R.string.diag_title),
            color = Palette.TextMuted,
        ) { shell.go(DiagnosticsScreen(shell)) }

        if (host != null) {
            Spacer(Modifier.height(14.dp))
            // Versiya raqami ko'rinib turishi qo'llab-quvvatlash uchun muhim:
            // «qaysi versiya o'rnatilgan» savoliga omborchining o'zi javob
            // bera oladi. Tugma esa yangilanishni QO'LDA tekshiradi.
            SecondaryButton(
                text = stringResource(R.string.update_check, host.appVersionName),
                color = Palette.TextMuted,
            ) { host.checkUpdate(silent = false) }
        }
    }

    @Composable
    private fun RowScope.Tile(
        icon: ImageVector,
        label: String,
        tint: Color,
        badge: String? = null,
        onClick: () -> Unit,
    ) {
        Card(
            onClick = onClick,
            modifier = Modifier.weight(1f).height(124.dp),
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = Palette.Surface),
            border = androidx.compose.foundation.BorderStroke(1.dp, Palette.Border),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(38.dp))
                Spacer(Modifier.height(8.dp))
                Text(
                    label,
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                if (badge != null) {
                    Spacer(Modifier.height(6.dp))
                    Pill(text = badge, bg = Palette.WarningContainer, fg = Palette.Warning)
                }
            }
        }
    }
}
