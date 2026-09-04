package uz.sherset.manager

/**
 * Login javobidagi BITTA HR sahifa ruxsati (`user.hrPermissions[]` elementi,
 * `auth.schema.ts:120-124`): `{pageKey, section, accessLevel}`.
 */
data class HrPermission(
    val pageKey: String,
    val section: String?,
    val accessLevel: String,
)

/**
 * ROL/RUXSAT MANTIG'I — ATAYLAB SOF FUNKSIYALAR.
 *
 * Bu fayl Android'ga ham, `org.json` ga ham BOG'LANMAYDI: shuning uchun
 * oddiy JVM birlik testi bilan sinaladi (`app/src/test/.../HrAccessTest.kt`).
 * JSON'dan o'qish `SessionUser.kt` da, saqlash `SessionStore.kt` da —
 * qaror mantig'i esa faqat shu yerda.
 *
 * 🔴 BU QAROR — QULAYLIK, XAVFSIZLIK EMAS. Plitkani yashirish odamni
 * 403 ekraniga olib bormaslik uchun; haqiqiy chegara serverdagi
 * `hr-permission.guard.ts` (`ACCESS_RANK = {own_only:1, read:2, full:3}`)
 * va `@RequirePermission` darvozalarida. Klientdagi bu ro'yxatni aldab
 * bo'lgan odam ham serverdan ma'lumot ololmaydi.
 */
object HrAccess {

    /** Server bilan bir xil darajalar (`hr-permission.guard.ts`). */
    const val OWN_ONLY = "own_only"
    const val READ = "read"
    const val FULL = "full"

    /** `ACCESS_RANK` ning aynan nusxasi — nomalum daraja = 0 (huquq yo'q). */
    private val RANK = mapOf(OWN_ONLY to 1, READ to 2, FULL to 3)

    /**
     * «Boshqaruv» bo'limini ochadigan rollar.
     *
     * `manager` — `ops-menejer-rol.ts` AYNAN shu satrni `hrRoles` ga yozadi
     * (`resolveShiftActor`/`resolveActor` konvensiyasi), `admin` — HR guard'ini
     * butunlay chetlab o'tadigan daraja (`hr-permission.guard.ts:54`).
     */
    private val MANAGER_ROLES = setOf("admin", "manager")

    /**
     * Haydovchi rollari. `hrRoles` — ERKIN LUG'AT (`HrRole.value`), ya'ni
     * akkauntda qiymat o'zbekcha ham kiritilgan bo'lishi mumkin; shuning
     * uchun ikkala yozuv ham qabul qilinadi. Plitka topilmasa haydovchi
     * ekranni umuman ko'rmaydi, shuning uchun ro'yxat kengroq olindi.
     */
    private val DRIVER_ROLES = setOf("driver", "haydovchi")

    /** Ruxsat darajasining og'irligi; nomalum/bo'sh — 0. */
    fun rank(accessLevel: String?): Int = RANK[norm(accessLevel)] ?: 0

    /**
     * Xodimda `pageKey` sahifasi bo'yicha KAMIDA `minLevel` darajasi bormi.
     * `section` ATAYLAB e'tiborga olinmaydi: bo'lim-darajali qator ham
     * sahifaga kirish huquqini beradi (guard ham shunday qaraydi).
     */
    fun hasPage(permissions: List<HrPermission>, pageKey: String, minLevel: String): Boolean {
        val need = rank(minLevel)
        if (need == 0) return false
        val page = norm(pageKey)
        return permissions.any { norm(it.pageKey) == page && rank(it.accessLevel) >= need }
    }

    /** Rollardan bittasi ham `wanted` ichida bormi. */
    fun hasAnyRole(roles: List<String>, wanted: Set<String>): Boolean =
        roles.any { norm(it) in wanted }

    /**
     * Bosh ekranda «Boshqaruv» bo'limi chizilsinmi (X-reja X1).
     *
     * Shart: `hrRoles` da `manager`/`admin`, YOKI `employees` sahifasi
     * `read`+ — chunki `manager/…` endpointlari aynan shuni talab qiladi.
     * Shart bajarilmasa bo'lim UMUMAN chizilmaydi (403 ekranga bormaymiz).
     */
    fun canSeeManagement(roles: List<String>, permissions: List<HrPermission>): Boolean =
        hasAnyRole(roles, MANAGER_ROLES) || hasPage(permissions, "employees", READ)

    /** «Yo'nalishlarim» plitkasi faqat haydovchiga (X-reja X4). */
    fun isDriver(roles: List<String>): Boolean = hasAnyRole(roles, DRIVER_ROLES)

    /** Solishtirish bo'sh joy/registrdan qat'i nazar ishlashi kerak. */
    private fun norm(value: String?): String = value?.trim()?.lowercase() ?: ""
}
