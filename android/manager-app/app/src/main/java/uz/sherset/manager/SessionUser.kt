package uz.sherset.manager

import org.json.JSONArray
import org.json.JSONObject

/**
 * Kirgan xodim — `POST /auth/login` va `POST /auth/refresh` javoblaridagi
 * `user` obyektining ilovaga kerakli qismi (`auth.schema.ts:110-127`).
 *
 * Bu yerda FAQAT o'qish/yozish (`org.json`) turadi; qaror mantig'i
 * `HrAccess.kt` da (u sof funksiya bo'lgani uchun testlanadi).
 */
data class SessionUser(
    val name: String,
    val hrRoles: List<String>,
    val hrPermissions: List<HrPermission>,
) {
    companion object {

        /** Nomsiz, rolsiz xodim — fail-closed: faqat «Mening kunim» ko'rinadi. */
        val EMPTY = SessionUser(name = "", hrRoles = emptyList(), hrPermissions = emptyList())

        /**
         * Javobdagi `user` obyektidan o'qiydi.
         *
         * `null` qaytishi — javobda `user` UMUMAN yo'q degani (eski server
         * yoki kutilmagan javob). Bo'sh massivlar esa haqiqiy javob: xodimda
         * rol/ruxsat yo'q. Ikkisi ATAYLAB farqlanadi — birinchisida oxirgi
         * saqlangan ma'lumot ishlatiladi, ikkinchisida esa server so'zi
         * ustun (rol olib qo'yilgan bo'lsa plitka ham yo'qolishi kerak).
         */
        fun fromJson(user: JSONObject?): SessionUser? {
            if (user == null) return null
            return SessionUser(
                name = user.optString("name").orEmpty(),
                hrRoles = readRoles(user.optJSONArray("hrRoles")),
                hrPermissions = readPermissions(user.optJSONArray("hrPermissions")),
            )
        }

        // ── Diskka saqlash uchun (SessionStore) ─────────────────────────────

        fun rolesToJson(roles: List<String>): String {
            val arr = JSONArray()
            for (r in roles) arr.put(r)
            return arr.toString()
        }

        fun permissionsToJson(permissions: List<HrPermission>): String {
            val arr = JSONArray()
            for (p in permissions) {
                arr.put(
                    JSONObject()
                        .put("pageKey", p.pageKey)
                        .put("section", p.section ?: JSONObject.NULL)
                        .put("accessLevel", p.accessLevel),
                )
            }
            return arr.toString()
        }

        fun rolesFromJson(text: String?): List<String> =
            readRoles(runCatching { JSONArray(text.orEmpty()) }.getOrNull())

        fun permissionsFromJson(text: String?): List<HrPermission> =
            readPermissions(runCatching { JSONArray(text.orEmpty()) }.getOrNull())

        // ── ichki ───────────────────────────────────────────────────────────

        private fun readRoles(arr: JSONArray?): List<String> {
            if (arr == null) return emptyList()
            val out = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) {
                val v = arr.optString(i).orEmpty()
                if (v.isNotEmpty()) out.add(v)
            }
            return out
        }

        private fun readPermissions(arr: JSONArray?): List<HrPermission> {
            if (arr == null) return emptyList()
            val out = ArrayList<HrPermission>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val page = o.optString("pageKey").orEmpty()
                if (page.isEmpty()) continue
                out.add(
                    HrPermission(
                        pageKey = page,
                        // `section` server tomonda `null` bo'lishi ODATIY hol
                        // (sahifa-darajali qator) — «null» satriga aylanmasin.
                        section = if (o.isNull("section")) null else o.optString("section"),
                        accessLevel = o.optString("accessLevel").orEmpty(),
                    ),
                )
            }
            return out
        }
    }
}
