package uz.sherset.tsd

import java.math.BigDecimal

/**
 * 🔴 T5 — MIQDOR IFODASI (kalkulyator). SOF modul: Android ham, Compose ham,
 * tarmoq ham ko'rinmaydi — shuning uchun uni oddiy JVM unit-testi qamrab oladi
 * (`app/src/test/.../QtyExpressionTest.kt`).
 *
 * Nega kerak. Omborchi javon oldida turib «12 quti × 24 dona» ni BOSHIDA
 * hisoblardi — xato aynan shu yerda tug'iladi va keyin uni hech kim
 * tushuntira olmaydi (sanoq avto-hujjat yozadi). Endi u aynan shunday yozadi:
 * `12*24`, natijani ekranda ko'radi va SHU son serverga ketadi.
 *
 * Qo'llab-quvvatlanadigan sintaksis (ATAYLAB kichik):
 *  - sonlar: `12`, `14.5`, `14,5` (vergul = nuqta — jonlida kabel/shlang
 *    metrlari o'nlik keladi), `.5` → `0.5`, `14.` → `14`;
 *  - amallar: `+`, `-`, `*` (yozuvda `×` va `x`/`X` ham qabul qilinadi),
 *    qavslar `(` `)`, unar minus (`-5`, `10*-2`);
 *  - 🔴 **BO'LISH YO'Q.** `/` yozilsa ANIQ sabab qaytadi («bo'lish
 *    qo'llab-quvvatlanmaydi»), jimgina xato deb aytilmaydi. Sabab: bo'lish
 *    yaxlitlash siyosatini ochib yuboradi (3 ta dona 2 ga bo'linsa 1.5 mi,
 *    2 mi?) va bu T5 ning ishi emas — reja buni ochiq taqiqlaydi.
 *
 * 🔴 Javob SHAKLI serverning qoidasiga bo'ysunadi:
 * `SetCellStockSchema.qty` / `CellPlaceSchema.qty` — `/^\d+(\.\d{1,6})?$/`,
 * ya'ni **manfiy emas**, **ko'rsatkichli yozuv (1E+3) YO'Q**, **kasr qismi
 * ≤ 6 xona**, **vergul yo'q**. Shuning uchun bu modul faqat SHU shakldagi
 * matnni «yuborsa bo'ladi» deb qaytaradi — mos kelmagan natija xatoga
 * chiqadi va saqlash tugmasi o'chadi. Jim 0 (yoki jim yaxlitlash) YO'Q.
 */
object QtyExpression {

    /**
     * Nega yuborib bo'lmaydi. Matn EMAS, sabab: bu modul `R` ni ko'rmaydi
     * (aks holda uni JVM testidan chaqirib bo'lmasdi) — matnni ekran tanlaydi
     * (`Widgets.kt: problemText`).
     */
    enum class Problem {
        /** Ifoda tuzilishi buzuq: `12*`, `((3+4)`, `1.2.3`, bo'sh qavs. */
        SYNTAX,

        /** `/` (yoki `:` `÷`) — ataylab qo'llab-quvvatlanmaydi. */
        DIVISION,

        /** Natija manfiy: `10-25`. Miqdor manfiy bo'lolmaydi (server ham rad etadi). */
        NEGATIVE,

        /** Ifoda juda uzun — hisoblashni ham, o'qishni ham cheklaymiz. */
        TOO_LONG,

        /** Natija serverning `Decimal(20,6)` ustuniga sig'maydi. */
        TOO_BIG,

        /** Kasr qismi 6 xonadan uzun — server regexi rad etardi. */
        TOO_PRECISE,
    }

    sealed interface Result {
        /** Maydon bo'sh — bu XATO EMAS (sabab ham ko'rsatilmaydi), lekin yuborilmaydi. */
        data object Empty : Result

        /** [value] — hisoblangan son, [text] — serverga AYNAN shu ketadi. */
        data class Ok(val value: BigDecimal, val text: String) : Result

        data class Bad(val problem: Problem) : Result
    }

    /** Maydon uzunligi chegarasi — ham o'qish, ham hisoblash uchun (40 belgi ≈ 20 ta ko'paytma). */
    const val MAX_LEN = 40

    /** Serverning `Decimal(20,6)` ustuni va sog'lom aql chegarasi. */
    private val MAX_VALUE = BigDecimal("1000000000")

    /** Server regexi: kasr qismi ≤ 6 xona. */
    private const val MAX_SCALE = 6

    private const val DIVISION_CHARS = "/:÷"

    /** Ruxsat etilgan belgilar (normalizatsiyadan KEYIN) — bo'shliq ham. */
    private const val ALLOWED = "0123456789.+-*() "

    /**
     * Yagona kirish nuqtasi. Hech qachon istisno tashlamaydi va hech qachon
     * «taxminiy» son qaytarmaydi — noaniq holatda [Result.Bad].
     */
    fun parse(input: String): Result {
        val raw = input.trim()
        if (raw.isEmpty()) return Result.Empty
        if (raw.length > MAX_LEN) return Result.Bad(Problem.TOO_LONG)

        val s = normalize(raw)
        if (s.isEmpty()) return Result.Empty
        // Bo'lish — ALOHIDA sabab: «noto'g'ri ifoda» deyilsa omborchi nima
        // qilishini bilmasdi, «bo'lish yo'q» deyilsa muqobilini o'zi topadi.
        if (s.any { it in DIVISION_CHARS }) return Result.Bad(Problem.DIVISION)
        if (s.any { it !in ALLOWED }) return Result.Bad(Problem.SYNTAX)

        val parser = Parser(s)
        val value = parser.parse() ?: return Result.Bad(parser.problem ?: Problem.SYNTAX)

        if (value.signum() < 0) return Result.Bad(Problem.NEGATIVE)
        if (value.abs() >= MAX_VALUE) return Result.Bad(Problem.TOO_BIG)

        // `stripTrailingZeros` — `12.000000` (server Decimal ustunidan kelgan
        // sukut qiymati) `12` bo'lib ketsin; `toPlainString` — `1E+2` kabi
        // ko'rsatkichli yozuv server regexidan o'tmasdi.
        val stripped = if (value.signum() == 0) BigDecimal.ZERO else value.stripTrailingZeros()
        if (stripped.scale() > MAX_SCALE) return Result.Bad(Problem.TOO_PRECISE)
        return Result.Ok(stripped, stripped.toPlainString())
    }

    /**
     * Reja talab qilgan imzo: hisoblangan son yoki `null` (bo'sh ham, xato ham).
     * Sonning O'ZI kerak bo'lgan joyda ishlatiladi; serverga ketadigan matn
     * uchun [qty] bor.
     */
    fun evaluate(text: String): BigDecimal? = (parse(text) as? Result.Ok)?.value

    /**
     * Serverga yuboriladigan MATN yoki `null` — «yuborib bo'lmaydi».
     * Ekranlar aynan shuni ishlatadi: `null` bo'lsa saqlash tugmasi o'chadi va
     * `save()` ham to'xtaydi (ikki qavat himoya — jim 0 yuborilmasin).
     */
    fun qty(text: String): String? = (parse(text) as? Result.Ok)?.text

    /**
     * Maydon ostida natijani («= 288») ko'rsatish kerakmi?
     *
     * Faqat sof raqam yozilganda qator chizilmaydi — 4" ekranda har maydon
     * ostida ortiqcha qator joy yeydi. Vergul BOR bo'lsa ko'rsatiladi: omborchi
     * `14,5` ning `14.5` bo'lib ketishini o'z ko'zi bilan ko'rsin.
     */
    fun isExpression(text: String): Boolean = text.any { it in "+-*()×xX," }

    /**
     * Vergul → nuqta, `×`/`x` → `*`, turli tirelar → `-`, har xil bo'shliq →
     * oddiy probel.
     *
     * 🔴 Bo'shliq OLIB TASHLANMAYDI — u token AJRATUVCHI bo'lib qoladi:
     * `12 * 24` = 288, lekin `12 24` — XATO. Aks holda `12 24` jimgina `1224`
     * bo'lib ketardi, ya'ni faza tuzatayotgan kasallikning o'zi (jim noto'g'ri
     * son) yangi shaklda qaytardi. Bu ilk sinovda AYNAN shunday chiqdi.
     */
    private fun normalize(input: String): String {
        val sb = StringBuilder(input.length)
        for (ch in input) {
            // `Char.isWhitespace` uzilmas probelni (U+00A0) bilmaydi, u esa
            // ekran klaviaturasidan/qo'yishdan kelishi mumkin.
            if (ch.isWhitespace() || ch.code == 0xA0) {
                sb.append(' ')
                continue
            }
            when (ch) {
                ',' -> sb.append('.')
                '×', 'x', 'X' -> sb.append('*')
                '−', '–', '—' -> sb.append('-')
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }

    /**
     * Rekursiv tushuvchi tahlilchi. Grammatika (bo'lishsiz):
     * ```
     * expr    := term (('+' | '-') term)*
     * term    := factor ('*' factor)*
     * factor  := ('+' | '-')* primary
     * primary := number | '(' expr ')'
     * ```
     * Ko'paytirish qo'shishdan ustun — `3*24+6` = 78, ya'ni omborchi kutgan
     * odatiy matematika (aks holda 90 chiqardi).
     */
    private class Parser(private val s: String) {
        private var i = 0
        var problem: Problem? = null

        fun parse(): BigDecimal? {
            val v = expr() ?: return null
            ws()
            // Oxirigacha o'qilmagan bo'lsa — ifoda buzuq (`12 24`, `3)`).
            if (i < s.length) return fail()
            return v
        }

        private fun fail(p: Problem = Problem.SYNTAX): BigDecimal? {
            if (problem == null) problem = p
            return null
        }

        /** Tokenlar ORASIDAGI bo'shliq tashlanadi; son ICHIDAGISI esa yo'q. */
        private fun ws() {
            while (i < s.length && s[i] == ' ') i++
        }

        private fun expr(): BigDecimal? {
            var left = term() ?: return null
            ws()
            while (i < s.length && (s[i] == '+' || s[i] == '-')) {
                val plus = s[i] == '+'
                i++
                val right = term() ?: return null
                left = if (plus) left.add(right) else left.subtract(right)
                ws()
            }
            return left
        }

        private fun term(): BigDecimal? {
            var left = factor() ?: return null
            ws()
            while (i < s.length && s[i] == '*') {
                i++
                val right = factor() ?: return null
                left = left.multiply(right)
                ws()
            }
            return left
        }

        private fun factor(): BigDecimal? {
            ws()
            if (i < s.length && (s[i] == '+' || s[i] == '-')) {
                val minus = s[i] == '-'
                i++
                val v = factor() ?: return null
                return if (minus) v.negate() else v
            }
            return primary()
        }

        private fun primary(): BigDecimal? {
            ws()
            if (i >= s.length) return fail()
            if (s[i] == '(') {
                i++
                val v = expr() ?: return null
                ws()
                if (i >= s.length || s[i] != ')') return fail()
                i++
                return v
            }
            return number()
        }

        private fun number(): BigDecimal? {
            val start = i
            var dots = 0
            while (i < s.length && (s[i].isDigit() || s[i] == '.')) {
                if (s[i] == '.') dots++
                i++
            }
            if (i == start || dots > 1) return fail()
            var t = s.substring(start, i)
            // `.5` va `14.` — yozayotgan odamning normal oraliq holati; ma'nosi
            // bir xilda tushuniladi va JIM emas (natija qatorida ko'rinadi).
            if (t == ".") return fail()
            if (t.startsWith(".")) t = "0$t"
            if (t.endsWith(".")) t = t.dropLast(1)
            return runCatching { BigDecimal(t) }.getOrNull() ?: fail()
        }
    }
}
