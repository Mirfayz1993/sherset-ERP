package uz.sherset.manager

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
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * BOSH EKRAN — plitkali menyu (tsd-app 0.2.0 uslubi), ROLGA MOSLASHADI (X1).
 *
 * Ikki bo'lim:
 *  - «Boshqaruv» — v0.1 ning 4 plitkasi (Brifing/Tushum/KPI/Undirish). FAQAT
 *    menejer/admin yoki `employees:read`+ bo'lgan xodimga chiziladi; aks holda
 *    bo'lim UMUMAN yo'q — odamni 403 ekraniga olib bormaymiz.
 *  - «Mening kunim» — HAMMA xodimda. X1 da plitkalar `ComingSoonScreen` ga
 *    olib boradi; X2–X6 da har biri o'z ekraniga almashtiriladi.
 *    «Yo'nalishlarim» faqat haydovchida (X4).
 *
 * Qaror mantig'i shu faylda EMAS — `HrAccess` da (sof funksiya, JVM testi bor).
 */
class HomeScreen(private val shell: Shell) : Screen {

    override fun title(shell: Shell): String =
        shell.userName.ifEmpty { shell.str(R.string.home_title) }

    @Composable
    override fun Content() {
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

        if (HrAccess.canSeeManagement(shell.hrRoles, shell.hrPermissions)) {
            SectionHeader(stringResource(R.string.home_section_management))
            TileGrid(managementTiles())
            Spacer(Modifier.height(18.dp))
        }

        SectionHeader(stringResource(R.string.home_section_myday))
        TileGrid(myDayTiles())

        if (shell is MainActivity) {
            Spacer(Modifier.height(14.dp))
            // Versiya raqami ko'rinib turishi qo'llab-quvvatlash uchun muhim;
            // tugma yangilanishni QO'LDA tekshiradi.
            SecondaryButton(
                text = stringResource(R.string.update_check, shell.appVersionName),
                color = Palette.TextMuted,
            ) { shell.checkUpdate(silent = false) }
        }
    }

    // ── Plitkalar ro'yxati ──────────────────────────────────────────────────

    /** v0.1 qamrovi — o'zgarmadi, faqat «Boshqaruv» bo'limi ostiga ko'chdi. */
    @Composable
    private fun managementTiles(): List<TileSpec> = listOf(
        TileSpec(
            icon = Icons.AutoMirrored.Filled.List,
            label = stringResource(R.string.tile_briefing),
            tint = MaterialTheme.colorScheme.primary,
        ) { shell.go(BriefingScreen(shell)) },
        TileSpec(
            icon = Icons.Filled.Place,
            label = stringResource(R.string.tile_money),
            tint = Palette.Success,
        ) { shell.go(MoneyMapScreen(shell)) },
        TileSpec(
            icon = Icons.Filled.CheckCircle,
            label = stringResource(R.string.tile_kpi),
            tint = Palette.MoneyText,
        ) { shell.go(KpiScreen(shell)) },
        TileSpec(
            icon = Icons.Filled.Call,
            label = stringResource(R.string.tile_collection),
            tint = Palette.Warning,
        ) { shell.go(CollectionScreen(shell)) },
    )

    /**
     * Xodimning o'z bo'limi. Tartib ATAYLAB qat'iy (4 doimiy plitka), haydovchi
     * plitkasi OXIRIGA qo'shiladi — shunda haydovchi bo'lmagan xodimda qolgan
     * plitkalar joyi o'zgarmaydi.
     */
    @Composable
    private fun myDayTiles(): List<TileSpec> {
        val tiles = mutableListOf(
            TileSpec(
                icon = Icons.Filled.DateRange,
                label = stringResource(R.string.tile_attendance),
                tint = MaterialTheme.colorScheme.primary,
                // X2 — «Tez orada» o'rniga haqiqiy ekran ulandi.
            ) { shell.go(AttendanceScreen(shell)) },
            TileSpec(
                icon = Icons.Filled.Edit,
                label = stringResource(R.string.tile_my_tasks),
                tint = Palette.Warning,
                // X3 — «Tez orada» o'rniga haqiqiy ekran ulandi.
            ) { shell.go(MyTasksScreen(shell)) },
            TileSpec(
                icon = Icons.Filled.Star,
                label = stringResource(R.string.tile_my_kpi),
                tint = Palette.MoneyText,
                // X5 — «Tez orada» o'rniga haqiqiy ekran ulandi.
            ) { shell.go(MyKpiScreen(shell)) },
            TileSpec(
                icon = Icons.Filled.AccountBox,
                label = stringResource(R.string.tile_my_payroll),
                tint = Palette.Success,
            ) { shell.go(ComingSoonScreen(shell, R.string.tile_my_payroll)) },
        )
        if (HrAccess.isDriver(shell.hrRoles)) {
            tiles.add(
                TileSpec(
                    icon = Icons.Filled.LocationOn,
                    label = stringResource(R.string.tile_my_routes),
                    tint = Palette.Danger,
                    // X4 — «Tez orada» o'rniga haqiqiy ekran ulandi.
                ) { shell.go(RoutesScreen(shell)) },
            )
        }
        return tiles
    }

    // ── Chizish ─────────────────────────────────────────────────────────────

    private class TileSpec(
        val icon: ImageVector,
        val label: String,
        val tint: Color,
        val onClick: () -> Unit,
    )

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

    /** Ikki ustunli panjara. Toq sonli oxirgi qatorda plitka yarim enda qoladi. */
    @Composable
    private fun TileGrid(tiles: List<TileSpec>) {
        tiles.chunked(2).forEachIndexed { index, row ->
            if (index > 0) Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                for (t in row) Tile(t.icon, t.label, t.tint, t.onClick)
                // Yolg'iz plitka butun enni egallab ketmasin — u qo'shni
                // qatorlardagi plitkalar bilan bir o'lchamda ko'rinishi kerak.
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }

    @Composable
    private fun RowScope.Tile(
        icon: ImageVector,
        label: String,
        tint: Color,
        onClick: () -> Unit,
    ) {
        Card(
            onClick = onClick,
            modifier = Modifier.weight(1f).height(132.dp),
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
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(40.dp))
                Spacer(Modifier.height(10.dp))
                Text(
                    label,
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
