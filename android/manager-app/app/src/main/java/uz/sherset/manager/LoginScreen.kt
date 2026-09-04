package uz.sherset.manager

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Kirish (v0.1) — email/username + parol (`POST /auth/login`).
 *
 * Parol faqat shu ekranning xotirasida yashaydi va so'rov ketgach unutiladi
 * — HECH QAYERGA yozilmaydi. Qurilma-juftlash + PIN — V0.2 (reja).
 */
@Composable
fun LoginScreen(shell: Shell, onLoggedIn: (SessionUser) -> Unit) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy) return
        val id = identifier.trim()
        val pw = password
        if (id.isEmpty() || pw.isEmpty()) {
            error = shell.str(R.string.login_fill_both)
            return
        }
        busy = true
        error = null
        shell.io {
            try {
                val resp = shell.api.login(id, pw)
                // Rol/ruxsat AYNI javobda keladi (`auth.schema.ts:110-127`) —
                // bosh ekranni chizish uchun qo'shimcha so'rov kerak emas.
                val user = SessionUser.fromJson(resp.optJSONObject("user")) ?: SessionUser.EMPTY
                shell.main {
                    busy = false
                    password = ""
                    onLoggedIn(user)
                }
            } catch (e: ApiClient.ApiException) {
                shell.main {
                    busy = false
                    error = when {
                        e.code == 401 -> shell.str(R.string.login_failed)
                        e.code == 400 -> shell.str(R.string.login_failed)
                        else -> e.message ?: shell.str(R.string.update_check_failed)
                    }
                }
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                shell.str(R.string.app_name),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                shell.str(R.string.login_title),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(24.dp))

            PlainField(
                value = identifier,
                onChange = { identifier = it },
                label = shell.str(R.string.login_id_hint),
                keyboardType = KeyboardType.Email,
            )
            Spacer(Modifier.height(12.dp))
            PasswordField(
                value = password,
                onChange = { password = it },
                label = shell.str(R.string.login_password_hint),
            )

            if (error != null) {
                Spacer(Modifier.height(12.dp))
                Text(
                    error.orEmpty(),
                    color = Palette.Danger,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(20.dp))
            PrimaryButton(
                text = if (busy) shell.str(R.string.login_busy) else shell.str(R.string.login_button),
                enabled = !busy,
            ) { submit() }
        }
    }
}
