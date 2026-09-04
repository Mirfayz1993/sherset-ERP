package uz.sherset.manager

import java.math.BigInteger

/**
 * OYLIGIM — oylik kartasining SOF FUNKSIYALARI (X6).
 *
 * `HrAccess`/`Davomat`/`Tasks`/`Routes`/`MyKpi` bilan bir xil sabab:
 * Android'ga ham, `org.json` ga ham bog'lanmaydi ⇒ oddiy JVM testi bilan
 * sinaladi. Ekran faqat chizadi.
 *
 * 🔴 HALOL RAQAMLAR (X-reja 8-qoidasi) shu ekranda ENG og'ir:
 *  - `finalSalaryMinor: null` — oy HALI HISOBLANMAGAN. «0 so'm oylik» deb
 *    ko'rsatish xodimga aytiladigan eng og'ir yolg'on bo'lardi, shuning
 *    uchun bu yerdagi formatlovchilar `null` ni QAYTARADI (0 ham, bo'sh
 *    satr ham emas) va matnni ekran tanlaydi;
 *  - `status: 'partial'` — qabul kutayotgan kunlar bor, ya'ni raqam
 *    O'ZGARISHI mumkin; ekran buni OCHIQ aytadi;
 *  - bonus va jarima QO'SHILMAYDI — alohida qatorda turadi (X4 dagi
 *    valyuta qoidasi bilan bir sinfda).
 *
 * 🔴 OY — YORLIQ. `yearMonth` («2026-09») instant EMAS: uni mintaqaga
 * surish oyni o'zgartirib yuborardi. Oy hisobi `Davomat` dagi tayyor sof
 * funksiyalardan olinadi (`currentYearMonth`/`shiftMonth`/`canGoNext`/
 * `monthLabel`) — yangi nusxa YOZILMAYDI.
 *
 * 🔴 VAQT esa instant: bonus/jarima yozuvining `createdAt` i Nest `Date`,
 * ya'ni UTC. U `Tasks.dateTime` bilan Toshkentga o'giriladi (X2 ning
 * 2-topilmasi — bu tuzoq har `Date` maydonda qaytadi).
 */
object MyPayroll {

    // ── Oy holati ───────────────────────────────────────────────────────────

    /**
     * Server `status` i — YOPIQ lug'at (`my-payroll.service.ts`):
     *  - `not_computed` — oy uchun qator yo'q (hisoblanmagan);
     *  - `partial`      — qator bor, lekin qabul kutayotgan kun bor ⇒ CHALA;
     *  - `computed`     — hamma kun qabul qilingan;
     *  - `unknown`      — server yangi holat qo'shgan; ilova YIQILMAYDI
     *    (X4 dagi reys holati, X5 dagi FSM holati bilan bir naqsh).
     */
    fun statusTone(status: String?): String = when (status) {
        "not_computed" -> "not_computed"
        "partial" -> "partial"
        "computed" -> "computed"
        else -> "unknown"
    }

    /**
     * Raqam yakuniymi. `partial` da oylik hali o'zgaradi, shuning uchun
     * karta ogohlantirish yozuvi bilan turadi. Noma'lum holat ham YAKUNIY
     * DEB QARALMAYDI (fail-closed: kutilmagan qiymatni «tayyor» deb
     * ko'rsatgandan ko'ra ehtiyot bo'lgan yaxshi).
     */
    fun isFinal(status: String?): Boolean = statusTone(status) == "computed"

    // ── Pul ─────────────────────────────────────────────────────────────────

    /**
     * Minor-string → «5 000 000 so'm». `null`/bo'sh/buzuq → `null`
     * = «hisoblanmadi» (`Fmt.minor` dagi «—» EMAS: ekran o'z matnini
     * tanlashi kerak).
     *
     * Qiymat serverdan BigInt-string bo'lib keladi, ya'ni `Long`
     * chegarasidan katta bo'lishi mumkin (X4 dagi naqd summasi bilan bir
     * xil ehtiyot chorasi).
     */
    fun money(minor: String?): String? {
        val v = parse(minor) ?: return null
        return Fmt.minor(v.toString(), "UZS")
    }

    /**
     * Jarima qatori MANFIY belgisi bilan: oylikdan AYIRILADI
     * (`payroll-formula.util.computeFinalSalaryMinor`). Bonusda belgi yo'q.
     *
     * Server summani doim MUSBAT saqlaydi (`createManual` musbatlikni
     * talab qiladi), ya'ni belgini ekran qo'yadi. Manfiy qiymat kelib
     * qolsa ikki marta belgilanmaydi — `abs` olinadi.
     */
    fun signedMoney(kind: String?, minor: String?): String? {
        val v = parse(minor) ?: return null
        val text = Fmt.minor(v.abs().toString(), "UZS")
        return if (kindTone(kind) == "fine") MINUS + text else text
    }

    /**
     * 🔴 U+2212 (MINUS SIGN), oddiy defis EMAS — `Fmt.group` manfiy sonda
     * aynan shu belgini qo'yadi. Ikki xil belgi ishlatilsa bitta ekranda
     * ikki xil «minus» ko'rinardi. Ko'rinmas farqni test ushlab tursin
     * deb konstanta qilib olindi.
     */
    private const val MINUS = "−"

    /** Qiymat aniq NOL mi (`null` — «hisoblanmadi», nol EMAS). */
    fun isZero(minor: String?): Boolean = parse(minor)?.signum() == 0

    /** Qiymat noldan katta mi (bloklangan sotuv ogohlantirishi uchun). */
    fun isPositive(minor: String?): Boolean = (parse(minor)?.signum() ?: 0) > 0

    // ── Yopiq lug'atlar ─────────────────────────────────────────────────────

    /** `HrBonusFineLog.kind` — `bonus` | `fine`. Boshqasi → `unknown`. */
    fun kindTone(kind: String?): String = when (kind) {
        "bonus" -> "bonus"
        "fine" -> "fine"
        else -> "unknown"
    }

    /**
     * Yozuv MANBASI (`HrBonusFineLog.source`) — yopiq lug'at. Ro'yxat
     * kengaysa `unknown` bo'ladi va ekran xom kalitni KO'RSATADI: xodim
     * pul yozuvining qayerdan kelganini bilishi kerak, jimgina
     * yashirilmaydi (X5 dagi signal lug'ati bilan bir naqsh).
     *
     * ⚠️ Ro'yxat serverning `HR_BONUS_FINE_SOURCES` zod-enumidan EMAS,
     * yozuvchi kodning O'ZIDAN olindi: o'sha enumda 5 ta qiymat bor, lekin
     * `late-fine.service.ts` («auto_late») va `kpi-accrual.ts`
     * («kpi_accept», «kpi_accept_reversal») undan tashqarida yozadi. Enum
     * faqat filtr uchun ishlatilgani sababli bu jonlida sezilmaydi —
     * X6 hisobotida topilma sifatida yozildi.
     */
    fun sourceTone(source: String?): String = when (source) {
        "manual" -> "manual"
        "rule" -> "rule"
        "auto_late" -> "auto_late"
        "auto_task_reward" -> "auto_task_reward"
        "auto_task_fine" -> "auto_task_fine"
        "auto_expire_fine" -> "auto_expire_fine"
        "kpi_accept" -> "kpi_accept"
        "kpi_accept_reversal" -> "kpi_accept_reversal"
        else -> "unknown"
    }

    // ── Ro'yxat ↔ saqlangan hisob ───────────────────────────────────────────

    /**
     * Saqlangan yig'indi ro'yxatdagi qatorlar bilan mos keladimi.
     *
     * 🔴 Nega kerak: oylik qatori bir marta hisoblanadi (`computedAt`), yangi
     * bonus/jarima esa keyin ham yozilishi mumkin. Ro'yxatda ko'rinib turgan
     * jarima jamiga kirmagan bo'lsa, xodim «jami noto'g'ri» deb o'ylaydi.
     * Shuning uchun farq bo'lsa ekran «hisob shu yozuvlardan keyin
     * yangilanmagan» deb OCHIQ aytadi.
     *
     * `null` — oy hisoblanmagan (solishtiradigan narsa yo'q). Buzuq qiymat
     * ham `null`: yolg'on «mos» ham, yolg'on «mos emas» ham chiqmaydi.
     */
    fun ledgerMatches(storedMinor: String?, listedMinor: String?): Boolean? {
        val stored = parse(storedMinor) ?: return null
        val listed = parse(listedMinor) ?: return null
        return stored == listed
    }

    // ── Vaqt ────────────────────────────────────────────────────────────────

    /** Yozuv sanasi — UTC instant, Toshkentga o'giriladi (X3 dagi funksiya). */
    fun rowDateTime(iso: String?): String? = Tasks.dateTime(iso)

    // ── Ichki ───────────────────────────────────────────────────────────────

    /** BigInt-string → `BigInteger`; `null`/bo'sh/«null»/buzuq → `null`. */
    private fun parse(minor: String?): BigInteger? {
        if (minor.isNullOrBlank() || minor == "null") return null
        return runCatching { BigInteger(minor.trim()) }.getOrNull()
    }
}
