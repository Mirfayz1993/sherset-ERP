package uz.sherset.tsd

/**
 * T7 — «Oxirgi sanoq» qaytarish nuqtasining SOF qarori: chiziq
 * ko'rsatiladimi va qaytarishda serverga QAYSI son ketadi.
 *
 * Android ham, Compose ham, `R` ham bu yerga kirmaydi — bu ataylab
 * ([QtyExpression] naqshi, T5): shu tufayli qaror oddiy JVM unit-testi bilan
 * qamraladi. Bu yerdagi xato serverga NOTO'G'RI mutlaq son yuborardi, ya'ni
 * u aynan shu reja tuzatayotgan kasallik sinfiga tegishli (§1.3 — jonlidagi
 * «361 885 soxta son»).
 *
 * 🔴 Qaytarish — BEKOR QILISH EMAS: natija oddiy `setCellStock(…, target,
 * mode: 'set')` bo'lib ketadi, ya'ni MUTLAQ SON semantikasi o'zgarmaydi.
 */
object CountUndo {

    /** [point] ning javobi. */
    sealed interface Point {

        /**
         * Chiziq YO'Q: saqlangan son eski qiymatning O'ZI. Bunda serverda
         * delta 0 va hujjat ham yozilmagan — qaytariladigan narsa yo'q.
         *
         * Bu holat kamdan-kam emas, AKSINCHA: sanoq maydonining sukut
         * qiymati tizim qoldig'ining o'zi, ya'ni saqlashlarning ko'pi
         * «14 → 14» bo'ladi. Ularda ham chiziq chiqsa u shovqinga aylanib,
         * HAQIQIY xatolik ko'rinmay qolardi.
         */
        object Unchanged : Point

        /**
         * Chiziq YO'Q: eski qoldiqni miqdor sifatida qayta yuborib
         * bo'lmaydi (server `qty` uchun `^\d+(\.\d{1,6})?$` talab qiladi).
         * Amalda kutilmaydi, lekin bo'lsa — noto'g'ri son yuborgandan ko'ra
         * qaytarishni umuman TAKLIF QILMASLIK xavfsiz.
         */
        object Unreadable : Point

        /**
         * Chiziq BOR.
         *
         * @param before saqlashdan oldingi qoldiq, normallashtirilgan;
         *   `null` = qator yacheykada UMUMAN yo'q edi (matn shunga mos
         *   bo'ladi — reja bandi 3).
         * @param target qaytarishda serverga ketadigan MUTLAQ son;
         *   `before` yo'q bo'lsa `"0"`.
         */
        data class Show(val before: String?, val target: String) : Point
    }

    /**
     * @param raw saqlashdan OLDIN o'qilgan tizim qoldig'i (`stock[].qty`),
     *   `null` = tovar yacheykada yo'q edi.
     * @param after saqlangan son — allaqachon [QtyExpression] dan o'tgan.
     *
     * Eski qiymat ham [QtyExpression] dan o'tkaziladi: server `12.000000`
     * qaytarsa ham qaytarishda `12` ketadi va T5 dagi shakl qulfidan
     * foydalaniladi. Shu bilan «o'zgarmadi» taqqoslashi ham ishonchli
     * bo'ladi (`12.000000` va `12` bir xil son deb ko'riladi).
     */
    fun point(raw: String?, after: String): Point {
        val before = if (raw == null) null else (QtyExpression.qty(raw) ?: return Point.Unreadable)
        // Yacheykada yo'q qatorning «oldingi qiymati» ta'rifiga ko'ra 0.
        val target = before ?: "0"
        if (target == after) return Point.Unchanged
        return Point.Show(before, target)
    }
}
