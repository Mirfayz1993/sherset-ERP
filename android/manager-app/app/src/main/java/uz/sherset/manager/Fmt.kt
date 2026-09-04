package uz.sherset.manager

import java.math.BigDecimal
import java.math.BigInteger

/**
 * Formatlash — pul MINOR birlikda keladi (server shartnomasi: `amountMinor`
 * BigInt-string, UZS'da tiyin). Ekranga so'mda chiqadi.
 */
object Fmt {

    /**
     * Minor-string → odam o'qiydigan summa. `null`/bo'sh → «—».
     *
     * UZS: minor/100 so'm, tiyin YASHIRILADI (menejer paneli tiyin sanamaydi,
     * server esa doim ,00 beradi). Boshqa valyuta: minor/100 + kod.
     */
    fun minor(amount: String?, currency: String?): String {
        if (amount.isNullOrBlank() || amount == "null") return "—"
        val v = runCatching { BigInteger(amount) }.getOrNull() ?: return amount
        val major = BigDecimal(v).movePointLeft(2)
        // Butun so'mgacha (tiyin kasri bor bo'lsa ham ko'rsatilmaydi — jami emas, panel).
        val whole = major.setScale(0, java.math.RoundingMode.DOWN).toBigInteger()
        val label = when (currency) {
            null, "", "UZS" -> "so'm"
            else -> currency
        }
        return group(whole) + " " + label
    }

    /** 1234567 → «1 234 567». */
    fun group(v: BigInteger): String {
        val neg = v.signum() < 0
        val digits = v.abs().toString()
        val sb = StringBuilder()
        for ((i, ch) in digits.withIndex()) {
            if (i > 0 && (digits.length - i) % 3 == 0) sb.append(' ')
            sb.append(ch)
        }
        return (if (neg) "−" else "") + sb
    }

    fun group(v: Long): String = group(BigInteger.valueOf(v))

    /** ISO instant/sana → «02.09». Buzuq bo'lsa xom matn qaytadi (jim yiqilmaydi). */
    fun dateShort(iso: String?): String {
        if (iso.isNullOrBlank()) return "—"
        return runCatching {
            val d = iso.substring(0, 10) // YYYY-MM-DD
            d.substring(8, 10) + "." + d.substring(5, 7)
        }.getOrDefault(iso)
    }

    /** ISO instant → «02.09 14:05» (vaqti bo'lsa). */
    fun dateTimeShort(iso: String?): String {
        if (iso.isNullOrBlank()) return "—"
        val date = dateShort(iso)
        val time = runCatching { iso.substring(11, 16) }.getOrNull()
        return if (time != null && time.isNotBlank()) "$date $time" else date
    }
}
