package uz.sherset.manager

import java.time.Instant
import java.time.OffsetDateTime

/**
 * ISHLARIM — vazifa kartasining SOF FUNKSIYALARI (X3).
 *
 * `HrAccess`/`Davomat` bilan bir xil sabab: Android'ga ham, `org.json` ga ham
 * bog'lanmaydi ⇒ oddiy JVM testi bilan sinaladi. Ekran faqat chizadi.
 *
 * 🔴 VAQT. `GET /hr/tasks/my` javobidagi `sentAt`/`deadlineAt`/`answeredAt` —
 * Nest `Date` ni `JSON.stringify` bilan beradi, ya'ni UTC (`…T09:30:00.000Z`).
 * Matndan kesib olish ekranda 5 SOAT orqadagi vaqtni chiqarardi (X2 ning
 * 2-topilmasi). Shuning uchun hamma vaqt shu yerda Toshkentga o'giriladi.
 *
 * 🔴 HALOL RAQAMLAR. `deadlineAt = null` — «muddat belgilanmagan», u
 * «muddati bugun» ham, «muddati o'tgan» ham EMAS. `overdue` ni ilova O'ZI
 * hisoblamaydi — server aytadi (serverning soati yagona sanksiyalangan manba).
 */
object Tasks {

    /** Vaqt mintaqasi — server bilan bir xil (`Davomat.TZ`). */
    private val TZ = Davomat.TZ

    /**
     * UTC ISO → «04.09 · 09:30» (Toshkent). `null`/bo'sh/buzuq → `null`
     * (ekran «—» yoki tegishli matnni o'zi tanlaydi).
     */
    fun dateTime(iso: String?): String? {
        if (iso.isNullOrBlank() || iso == "null") return null
        val z = runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(TZ) }.getOrNull()
            ?: return null
        return "%02d.%02d · %02d:%02d".format(
            z.dayOfMonth,
            z.monthValue,
            z.hour,
            z.minute,
        )
    }

    /** Muddatgacha qolgan to'liq soat; muddat yo'q yoki o'tgan bo'lsa `null`. */
    fun hoursLeft(deadlineIso: String?, now: Instant = Instant.now()): Long? {
        if (deadlineIso.isNullOrBlank() || deadlineIso == "null") return null
        val at = runCatching { OffsetDateTime.parse(deadlineIso).toInstant() }.getOrNull()
            ?: return null
        val ms = at.toEpochMilli() - now.toEpochMilli()
        return if (ms <= 0) null else ms / 3_600_000
    }

    /**
     * Holat rangi/yorlig'i uchun kalit — yopiq lug'at
     * (`hr-task-send.schema.ts` dagi `HR_TASK_LOG_STATUSES`).
     *
     *  - `new`     — javob kutilmoqda (xodim harakat qilishi kerak);
     *  - `pending` — javob berilgan, tekshiruvchi qaroriga qoldi;
     *  - `ok`      — ijobiy yakun;
     *  - `bad`     — salbiy yakun (rad / «yo'q» javob);
     *  - `failed`  — yuborilmadi (texnik nosozlik, xodimning aybi emas);
     *  - `unknown` — server yangi holat qo'shgan; ilova YIQILMAYDI, holat
     *    matnini o'zi ko'rsatadi.
     */
    fun statusTone(status: String?): String = when (status) {
        "sent" -> "new"
        "pending_review" -> "pending"
        "answered_yes", "answered_text", "approved" -> "ok"
        "answered_no", "rejected" -> "bad"
        "failed" -> "failed"
        else -> "unknown"
    }

    /** Matnli javob talab qilinadimi (`responseType == 'text'`). */
    fun isTextAnswer(responseType: String?): Boolean = responseType == "text"

    /**
     * Javob tugmalari chizilsinmi. Server ham `needsAnswer` beradi — bu
     * QAT'IY tekshiruv emas, ekranning o'z ehtiyot chorasi: javob berilgach
     * ro'yxat qayta o'qilguncha tugma qayta bosilib qolmasin.
     */
    fun needsAnswer(status: String?, responseType: String?): Boolean =
        status == "sent" && responseType != null && responseType != "none" && responseType != "null"

    /** Matnli javob bo'sh (yoki faqat probel) bo'lsa yuborilmaydi — server ham 400 beradi. */
    fun isAnswerTextValid(text: String?): Boolean = !text.isNullOrBlank()

    /** Diqqat talab qiladigan vazifa (`HrTaskTemplate.priority` — yuqori/shoshilinch). */
    fun isUrgent(priority: String?): Boolean = priority == "urgent" || priority == "high"
}
