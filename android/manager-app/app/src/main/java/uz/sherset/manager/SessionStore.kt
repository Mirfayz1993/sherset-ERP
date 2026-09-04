package uz.sherset.manager

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Sessiya sirlari — SHIFRLANGAN diskda (tsd-app `DeviceStore.kt` naqshi).
 *
 * Saqlanadigan yagona sir — REFRESH-TOKEN (`ms_rt` cookie qiymati): u bilan
 * ilova qayta ochilganda parolsiz davom etadi. PAROL HECH QACHON saqlanmaydi
 * — u odamning bilimi. Access-token ham saqlanmaydi (15 daqiqalik, xotirada
 * yashaydi va refresh bilan qayta olinadi).
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "manager_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** `ms_rt` cookie qiymati — AYNAN server yuborgan (kodlangan) ko'rinishda. */
    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH, null)
        set(v) = prefs.edit().putString(KEY_REFRESH, v).apply()

    /** Ekranda ko'rsatish uchun — sir emas, lekin bir joyda tursin. */
    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(v) = prefs.edit().putString(KEY_USER_NAME, v).apply()

    /**
     * Xodimning HR rollari (`user.hrRoles`) — bosh ekran plitkalari shu
     * bo'yicha chiziladi. Sir emas, lekin sessiyaning bir qismi bo'lgani
     * uchun AYNI idishda yashaydi va `clear()` bilan birga o'chadi.
     *
     * Nega saqlanadi: ilova ochilganda `refresh` javobi kelmasligi ham
     * mumkin (tarmoq yo'q) — o'sha holda oxirgi ma'lum rol ishlatiladi.
     * Server javobi kelgan zahoti USTIGA yoziladi — server so'zi ustun.
     */
    var hrRoles: List<String>
        get() = SessionUser.rolesFromJson(prefs.getString(KEY_HR_ROLES, null))
        set(v) = prefs.edit().putString(KEY_HR_ROLES, SessionUser.rolesToJson(v)).apply()

    /** Xodimning HR sahifa ruxsatlari (`user.hrPermissions`). */
    var hrPermissions: List<HrPermission>
        get() = SessionUser.permissionsFromJson(prefs.getString(KEY_HR_PERMS, null))
        set(v) = prefs.edit().putString(KEY_HR_PERMS, SessionUser.permissionsToJson(v)).apply()

    val hasSession: Boolean get() = !refreshToken.isNullOrEmpty()

    /** Chiqish — hamma narsa o'chadi. */
    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_REFRESH = "refresh_token"
        const val KEY_USER_NAME = "user_name"
        const val KEY_HR_ROLES = "hr_roles"
        const val KEY_HR_PERMS = "hr_permissions"
    }
}
