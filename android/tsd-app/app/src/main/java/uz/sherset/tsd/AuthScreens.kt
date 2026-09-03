package uz.sherset.tsd

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Juftlash va PIN ekranlari (G5 oqimi, 0.2.0 dizayni).
 *
 * Juftlash ATAYLAB QO'LDA (G5 qarori saqlanadi): kalit admin javobida BIR
 * marta ko'rinadi va terminalga ko'chiriladi — QR bilan uzatish uni yana bir
 * joyda ko'rsatishni talab qilardi.
 */

@Composable
fun PairingScreen(onSave: (id: String, secret: String) -> Unit) {
    var id by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }

    AuthShell {
        Text(stringResource(R.string.pair_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(16.dp))
        AuthField(value = id, onChange = { id = it }, hint = stringResource(R.string.pair_hint))
        Spacer(Modifier.height(10.dp))
        AuthField(
            value = secret,
            onChange = { secret = it },
            hint = stringResource(R.string.pair_secret_hint),
        )
        Spacer(Modifier.height(20.dp))
        PrimaryButton(
            text = stringResource(R.string.pair_save),
            enabled = id.trim().isNotEmpty() && secret.trim().isNotEmpty(),
        ) {
            onSave(id.trim(), secret.trim())
        }
    }
}

/**
 * PIN — 4 nuqta + ekran raqamlagichi. Apparat klaviatura ham teradi
 * (`MainActivity.dispatchKeyEvent`). To'rtinchi raqam bilan avto-yuboriladi.
 */
@Composable
fun PinScreen(
    pin: String,
    busy: Boolean,
    onDigit: (String) -> Unit,
    onBackspace: () -> Unit,
    onSubmit: () -> Unit,
) {
    LaunchedEffect(pin) { if (pin.length == 4 && !busy) onSubmit() }

    AuthShell {
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(20.dp))

        // 4 nuqta — terilgani to'ldiriladi. PIN raqamlari EKRANDA KO'RINMAYDI.
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            repeat(4) { i ->
                Box(
                    modifier = Modifier
                        .size(18.dp)
                        .background(
                            if (i < pin.length) MaterialTheme.colorScheme.primary
                            else Palette.SurfaceMuted,
                            CircleShape,
                        ),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            if (busy) stringResource(R.string.loading) else " ",
            color = Palette.TextMuted,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(12.dp))

        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓")
        for (rowIdx in 0 until 4) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                for (colIdx in 0 until 3) {
                    val key = keys[rowIdx * 3 + colIdx]
                    PinKey(
                        label = key,
                        modifier = Modifier.weight(1f),
                        accent = key == "✓",
                        enabled = !busy,
                    ) {
                        when (key) {
                            "⌫" -> onBackspace()
                            "✓" -> onSubmit()
                            else -> onDigit(key)
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
private fun PinKey(
    label: String,
    modifier: Modifier = Modifier,
    accent: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(64.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (accent) MaterialTheme.colorScheme.primary else Palette.Surface,
            contentColor = if (accent) Color.White else Palette.Text,
        ),
        border = if (accent) null else BorderStroke(1.dp, Palette.Border),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 0.dp),
    ) {
        Text(label, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Auth ekranlarining umumiy fon-qobig'i: brend sarlavha + markaziy karta. */
@Composable
private fun AuthShell(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(28.dp))
        Text(
            stringResource(R.string.app_name),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(28.dp))
        SectionCard {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                content()
            }
        }
    }
}

@Composable
private fun AuthField(value: String, onChange: (String) -> Unit, hint: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = { Text(hint) },
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = Palette.Border,
        ),
    )
}
