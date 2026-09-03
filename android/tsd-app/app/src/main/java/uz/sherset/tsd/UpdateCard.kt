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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Yangilanish holati — `MainActivity` da yashaydi, `HomeScreen` da chiziladi.
 *
 * Ilova o'zini AVTOMATIK yangilamaydi: yuklab olishni ham, o'rnatishni ham
 * omborchi bosadi. Sabab — yangilanish ilovani QAYTA ISHGA TUSHIRADI, ya'ni
 * yarim bajarilgan yig'ish yoki sanash uzilardi. Terminal esa smena o'rtasida
 * ham ishlab turadi.
 */
sealed interface UpdateState {
    /** Tekshirilmagan yoki yangilanish yo'q — hech narsa ko'rsatilmaydi. */
    data object None : UpdateState
    data class Available(val release: Updater.Release) : UpdateState
    data class Downloading(val percent: Int) : UpdateState
    data class Ready(val release: Updater.Release) : UpdateState
    data class Failed(val reason: String) : UpdateState
}

@Composable
fun UpdateCard(
    state: UpdateState,
    installedVersion: String,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
) {
    when (state) {
        is UpdateState.None -> Unit

        is UpdateState.Available -> SectionCard(
            tint = Palette.PrimaryContainer,
            border = MaterialTheme.colorScheme.primary,
        ) {
            Header(state.release.versionName, installedVersion)
            if (state.release.notes.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(state.release.notes, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(12.dp))
            PrimaryButton(text = stringResource(R.string.update_download)) { onDownload() }
        }

        is UpdateState.Downloading -> SectionCard {
            Text(
                stringResource(R.string.update_downloading, state.percent),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { state.percent / 100f },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                color = MaterialTheme.colorScheme.primary,
                trackColor = Palette.SurfaceMuted,
            )
        }

        is UpdateState.Ready -> SectionCard(
            tint = Palette.SuccessContainer,
            border = Palette.Success,
        ) {
            Header(state.release.versionName, installedVersion)
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.update_ready_note),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(12.dp))
            PrimaryButton(
                text = stringResource(R.string.update_install),
                color = Palette.Success,
            ) { onInstall() }
        }

        is UpdateState.Failed -> SectionCard(
            tint = Palette.DangerContainer,
            border = Palette.Danger,
        ) {
            Text(
                stringResource(R.string.update_failed),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.Danger,
            )
            Spacer(Modifier.height(4.dp))
            Text(state.reason, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            SecondaryButton(
                text = stringResource(R.string.update_retry),
                color = Palette.Danger,
            ) { onDownload() }
        }
    }
}

@Composable
private fun Header(newVersion: String, installedVersion: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.update_available),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Pill(
            text = "$installedVersion → $newVersion",
            bg = Palette.Surface,
            fg = Palette.Text,
        )
    }
}
