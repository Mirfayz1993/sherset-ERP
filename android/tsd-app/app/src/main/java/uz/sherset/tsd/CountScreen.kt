package uz.sherset.tsd

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

/**
 * G6.3 — INVENTARIZATSIYA SANASH.
 *
 * Oqim: YACHEYKA yorlig'ini skanerlash → yacheyka tarkibi → har tovarga
 * sanalgan son. Boshqacha aytganda «FAQAT YACHEYKA» qoidasi (F-reja):
 * sanash ombor darajasida emas, yacheyka darajasida bo'ladi.
 *
 * 🔴 MUTLAQ SON (`mode: 'set'`), delta EMAS — sabab `ApiClient.setCellStock`
 * izohida: sanash natijasi ta'rifiga ko'ra mutlaq, va oflayn navbat amalni
 * qayta yuborsa delta qoldiqni ikkinchi marta oshirardi.
 *
 * 🔴 SANASH NAVBATGA QO'YILMAYDI. Boshqa amallardan farqi shu va u ataylab:
 * server bu yo'lda avto Оприходование/Списание hujjatlarini YOZADI (ular
 * yagona tranzaksiyada emas), ya'ni idempotentlik kaliti u yerda ishlamaydi.
 * Aloqa yo'q bo'lsa ekran «aloqa yo'q, qayta urinib ko'ring» deydi va son
 * maydonda TURADI — jim yo'qotish yo'q (IS-5).
 *
 * 🔵 **TOVAR SHTRIXINI SKANERLASH (egasi, 2026-09-01).** Ilgari bu ekran
 * FAQAT yacheyka yorlig'ini tanirdi va tovar shtrixi skanerlansa «Yacheyka
 * topilmadi» chiqardi. Endi skan `/tsd/scan` bilan TASNIFLANADI:
 *   · yacheyka → tarkibi ochiladi (yoki keyingi yacheykaga o'tiladi);
 *   · tovar    → yuqorida «sanalayotgan tovar» kartasi ochiladi.
 * Nega kerak: yacheykada o'nlab qator bo'lishi mumkin, 4" ekranda kerakligini
 * qidirish sanashning o'zidan uzoq davom etardi.
 *
 * 🔴 **Yacheykada YO'Q tovar ham sanaladi va bu ATAYLAB.** Server buni
 * qo'llaydi (`setCellStock` har qanday tovarni oladi, `oldQty = 0`), ya'ni
 * javonda turgan lekin tizimda ko'rinmagan tovar sanalganda avto
 * Оприходование yoziladi — aynan shuning uchun ekran buni OCHIQ ogohlantirish
 * bilan ko'rsatadi («kirim bo'lib yoziladi»), jimgina qo'shib qo'ymaydi.
 *
 * 🔵 **BIRIKTIRILGAN TOVARLAR (T1, egasi 2026-09-03).** Jonli sinovda
 * omborchi bo'sh yacheykada tiqilib qoldi: ekran «ro'yxatdan tanlang»
 * derdi, ro'yxat esa bo'sh edi. Sabab — `cellByBarcode` javobining
 * `products` maydoni (yacheykaga biriktirilgan tovarlar, `__yacheyka` +
 * `ProductCellLink`) O'QILMASDAN tashlab yuborilardi. Endi ekran ikki
 * guruh chizadi: qoldig'i bor qatorlar va biriktirilgan-lekin-qoldiqsiz
 * qatorlar. Qo'shimcha tarmoq so'rovi YO'Q — ma'lumot o'sha javobda.
 *
 * 🔵 **PROGRESS VA «QOLGANINI 0 QILIB YOPISH» (T6, 2026-09-04).** Ilgari
 * yacheyka sanog'i hech qachon TO'LIQ yopilmasdi: nechta qator sanalgani
 * ko'rinmasdi va javonda YO'Q bo'lgan (lekin tizimda turgan) tovarni 0 ga
 * tushirishning ommaviy yo'li yo'q edi. Endi:
 *   · sarlavha-kartada «5/12 sanaldi» — hisob ILOVA ichida (server sanash
 *     sessiyasini bilmaydi, u T11 ning ishi);
 *   · har qatorda belgi: ✓ yashil = shu sessiyada saqlandi, ○ kulrang =
 *     hali sanalmagan, ✕ qizil = yopishda XATO bergan;
 *   · «Qolganini 0 qilib yopish» — sanalmagan qatorlarni BITTALAB `set 0`
 *     bilan yuboradi.
 *
 * 🔴 «0 qilib yopish» — YO'QOTUVCHI amal: qoldig'i bor har qator uchun
 * server avto **Списание** (chiqim) hujjatini yozadi. Shuning uchun u
 * bitta tasdiqdan o'tadi va tasdiq oldidan QAYSI qatorlar, QAYSI son bilan
 * 0 ga tushishi ro'yxat bo'lib ko'rsatiladi (ro'yxat KESILMAYDI). Jim
 * bajarilmaydi.
 *
 * 🔴 Bu amal ham NAVBATGA QO'YILMAYDI (sanash qoidasi o'zgarmadi): aloqa
 * yo'q bo'lsa halqa TO'XTAYDI va yopilmagan qatorlar ekranda kulrang/qizil
 * bo'lib qoladi — jim yo'qotish yo'q (IS-5).
 *
 * 🔵 **«OXIRGI SANOQ» QAYTARISH (T7, 2026-09-04).** Noto'g'ri terilgan son
 * (masalan `14` o'rniga `41`) saqlangach jimgina avto-Оприходование bo'lib
 * qolardi va omborchi eski qiymatni ESLAB, uni qo'lda qayta terishi kerak
 * edi — javon oldida turib buni hech kim qilmaydi. Endi saqlashdan keyin
 * sarlavha ostida chiziq turadi: «avval 14 edi, siz 41 qildingiz ·
 * ⟲ qaytarish». Eski qiymat saqlashdan OLDIN o'qiladi.
 *
 * 🔴 QAYTARISH — BEKOR QILISH EMAS. Server yozilgan hujjatni o'chirmaydi
 * (bunday sirt umuman yo'q), qaytarish esa oddiy `setCellStock(… , eski
 * qiymat, mode: 'set')` — ya'ni MUTLAQ SON semantikasi o'zgarmaydi va
 * tizim IKKINCHI hujjatni yozadi. Chiziqdagi matn shuni ochiq aytadi:
 * omborchi «bekor bo'ldi» deb o'ylab qolsa, ERP'dagi ikkita hujjatni
 * ko'rgan buxgalter bilan qarama-qarshilikka tushardi.
 */
class CountScreen(private val shell: Shell) : Screen {

    private var cell by mutableStateOf<JSONObject?>(null)
    private var items by mutableStateOf(JSONArray())

    /**
     * T1 — yacheykaga BIRIKTIRILGAN tovarlar (`products`). Qoldiqdan MUSTAQIL:
     * bu joylashuv yorlig'i (`__yacheyka` + `ProductCellLink`), son emas.
     * Server uni `cellByBarcode` javobida ALLAQACHON yuborardi, ekran esa
     * tashlab yuborardi — shuning uchun bo'sh yacheyka boshi berk ko'cha edi.
     */
    private var bound by mutableStateOf(JSONArray())

    /** Skanerlangan (yoki ro'yxatdan bosilgan) tovar — yuqoridagi karta. */
    private var picked by mutableStateOf<JSONObject?>(null)
    private var pickedQty by mutableStateOf("")

    /** Kiritilgan sonlar: `assortmentId → son`. Saqlashdan keyin ham TURADI. */
    private val counts = mutableStateMapOf<String, String>()

    /**
     * T6 — progressning MAXRAJI: shu yacheyka sessiyasida BIR MARTA bo'lsa
     * ham ko'ringan har qator (`assortmentId → nom`).
     *
     * Nega alohida ro'yxat, nega `items.length()` emas: `set 0` dan keyin
     * server qatorni `getCellStock` javobidan OLIB TASHLAYDI (`qty > 0`
     * filtri, biriktirilmagan tovar uchun). Maxraj `items` dan olinsa
     * «12 dan 5 tasi» sanalgach maxraj 9 ga tushib, progress ORQAGA ketardi.
     * Bu ro'yxat esa faqat O'SADI va yacheyka almashganda tozalanadi.
     */
    private val roster = mutableStateMapOf<String, String>()

    /**
     * T6 — qator belgisi. Kalitda YO'Q = hali sanalmagan (kulrang ○).
     * Belgi ILOVA ichida yashaydi: server «kim nimani sanadi» sessiyasini
     * bilmaydi, shuning uchun boshqa terminal sanagan qator bu yerda
     * kulrang qoladi (T11 sessiya tushunchasini serverga olib chiqadi).
     */
    private val marks = mutableStateMapOf<String, Mark>()

    /** T6 — tasdiq kartasi ochiqmi (0 qilib yopish ro'yxati ko'rinadi). */
    private var confirming by mutableStateOf(false)

    /** T6 — yopish halqasi ketmoqda: tugma o'rniga holat matni chiqadi. */
    private var closing by mutableStateOf(false)

    /**
     * T7 — oxirgi QIYMATI O'ZGARGAN sanoq. `null` = qaytariladigan narsa yo'q.
     *
     * Faqat bitta qator saqlanadi (nomi ham shu): omborchi javon oldida
     * turib «uch qadam orqaga» qaytmaydi, va uzun undo-tarixi qaysi hujjat
     * qaysi qatorga tegishli ekanini chalkashtirardi.
     */
    private var lastSave by mutableStateOf<LastSave?>(null)

    /** T7 — qaytarish so'rovi ketmoqda: tugma o'rniga holat matni chiqadi. */
    private var undoing by mutableStateOf(false)

    /**
     * T7 — [LastSave.seq] uchun hisoblagich. Ketma-ket IKKI marta AYNI
     * o'zgarish saqlansa (`14 → 41`, keyin yana `14 → 41`) `data class`
     * nusxalari teng bo'lardi va `LaunchedEffect` avto-yopish taymerini
     * qayta boshlamasdi — ikkinchi chiziq birinchisidan qolgan vaqtda
     * yo'qolardi. `MainActivity.errorSeq` dagi naqshning aynan o'zi.
     */
    private var saveSeq = 0

    /**
     * T7 — ekran AYNI DAMDA kompozitsiyadami. Compose state EMAS: u
     * chizishda o'qilmaydi, faqat «chiziqni qo'yish mumkinmi?» savoliga
     * javob beradi (o'qish ham, yozish ham UI thread'da).
     *
     * Nega kerak: saqlash so'rovi ketayotganda omborchi qidiruvga o'tib
     * ketsa, javob kelganda chiziq KO'RINMAYOTGAN ekranga qo'yilardi va
     * qaytib kelganda kutilmaganda paydo bo'lardi.
     */
    private var onScreen = false

    /**
     * 🔴 T10 — TARKIB KESHDAN CHIZILDIMI. `null` = jonli javob; son = kesh
     * QACHON yozilgani (plashka yoshi shundan hisoblanadi).
     *
     * Bu bayroq shunchaki bezak emas — u ekranning UCH ta yozish yo'lini
     * o'chiradi (sanoq maydonining sukut qiymati, «qolganini 0 qilib
     * yopish» va ⟲ qaytarish), chunki ularning hammasi SERVERDAGI songa
     * tayanadi. Kesh — faqat O'QISH.
     */
    private var cachedAt by mutableStateOf<Long?>(null)

    /** Yacheyka QAYSI kod bilan ochilgan — jim yangilash shu koddan ketadi. */
    private var cellCode by mutableStateOf("")

    /** Jim yangilash halqasining kaliti (`LaunchedEffect` shundan qayta boshlanadi). */
    private var cacheRetry by mutableStateOf(0)

    /**
     * 🔴 T10 — jim yangilash AYNI DAMDA ketmoqdami.
     *
     * `Shell.io` YAGONA thread'da yuradi (`MainActivity.ioPool`), zaif
     * Wi-Fi'da esa bitta so'rov 15 soniyagacha `connectTimeout` ushlaydi —
     * ya'ni 20 soniyalik halqa qo'riqchisiz bo'lsa navbat O'SARDI va
     * omborchining o'z amallari o'sha navbat orqasida kutib qolardi.
     * Bayroq Compose state EMAS: u chizishda o'qilmaydi (o'qish ham, yozish
     * ham UI thread'da — [CountScreen.onScreen] naqshi).
     */
    private var refreshing = false

    override fun title(shell: Shell): String = shell.str(R.string.count_title)

    @Composable
    override fun Content() {
        // 🔴 T7 (reja bandi 4) — EKRAN ALMASHSA chiziq yo'qoladi. `WorkRoot`
        // ekranni `key(screen)` bilan chizadi, ya'ni boshqa ekranga o'tilganda
        // (Qidiruv, tovar tanlash) shu kompozitsiya TARQATILADI va bu yerga
        // tushadi. Nega kerak: ekran nusxasi navigatsiya tarixida saqlanadi,
        // shuning uchun qaytib kelganda eski chiziq o'z joyida turardi va
        // omborchi allaqachon unutilgan sanoqni «qaytarib» yuborishi mumkin
        // edi. Yacheyka almashishi esa `clearProgress()` da qamralgan.
        DisposableEffect(Unit) {
            onScreen = true
            onDispose {
                onScreen = false
                lastSave = null
            }
        }

        val c = cell
        if (c == null) {
            SectionCard {
                Text(
                    stringResource(R.string.count_step_cell),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            Spacer(Modifier.height(10.dp))
            SecondaryButton(text = stringResource(R.string.back), color = Palette.TextMuted) {
                shell.back()
            }
            return
        }

        val extras = boundOnly()

        SectionCard(tint = Palette.PrimaryContainer, border = MaterialTheme.colorScheme.primary) {
            CellBadge(c.optString("name"))
            Spacer(Modifier.height(6.dp))
            Text(c.optString("storeName"), color = Palette.TextMuted)
            Spacer(Modifier.height(4.dp))
            // «Qoldiqda N · biriktirilgan M» — N + M aynan quyida chiziladigan
            // qatorlar soni, ya'ni omborchi ro'yxat tugaganini ko'radi.
            Text(
                stringResource(R.string.count_summary, items.length(), extras.size),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            // T6 — «5/12 sanaldi». Bo'sh yacheykada («0/0») chizilmaydi:
            // sanaladigan qator yo'q joyda progress faqat joy yeydi.
            val done = countedCount()
            val total = roster.size
            if (total > 0) {
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.count_progress, done, total),
                    style = MaterialTheme.typography.titleMedium,
                    color = if (done >= total) Palette.Success else Palette.TextMuted,
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        // 🔴 T10 — kesh plashkasi: sarlavhadan darhol KEYIN, qatorlardan
        // OLDIN. Omborchi sonlarni o'qishdan avval ularning eski ekanini
        // ko'rishi kerak — pastga qo'yilsa u skroll bilan ketib qolardi.
        val staleAt = cachedAt
        if (staleAt != null) {
            OfflineBadge(savedAt = staleAt, note = stringResource(R.string.cache_count_note))
            Spacer(Modifier.height(10.dp))
            // Aloqa qaytganda JIM yangilash: omborchi hech nima bosmaydi va
            // hech nima ko'rmaydi — plashka shunchaki yo'qoladi.
            LaunchedEffect(cacheRetry, staleAt) {
                delay(CacheShape.RETRY_MS)
                refreshQuietly()
                cacheRetry++
            }
        }

        // T7 — «oxirgi sanoq» chizig'i. Sarlavhadan KEYIN va «sanalayotgan
        // tovar» kartasidan OLDIN: saqlashdan keyin karta yopiladi va ko'z
        // aynan shu joyda qoladi.
        UndoStrip(c)

        val p = picked
        if (p != null) {
            PickedCard(c, p)
            Spacer(Modifier.height(10.dp))
        } else {
            Text(
                stringResource(R.string.count_scan_product_tip),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(10.dp))
        }

        // «Yacheyka bo'sh» faqat IKKALA guruh ham bo'sh bo'lganda — aks holda
        // ekran o'zi ko'rsatib turgan ro'yxatni «yo'q» deb aytardi (T1).
        if (items.length() == 0 && extras.isEmpty()) {
            EmptyState(stringResource(R.string.count_empty))
        }
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            val assortmentId = it.optString("assortmentId")
            // Yuqorida ochilgan tovar ro'yxatda IKKINCHI marta chizilmaydi —
            // ikki maydon bir tovarga ikki xil son berishga yo'l ochardi.
            if (assortmentId == p?.optString("id")) continue
            val mark = marks[assortmentId]
            SectionCard(
                modifier = Modifier.clickable { pick(it.optString("name"), assortmentId) },
                border = markBorder(mark),
            ) {
                // NARX YO'Q: bu javob narx maydonini umuman qaytarmaydi.
                // T6 — nom oldida belgi: ✓ sanaldi · ○ sanalmadi · ✕ xato.
                MarkedTitle(it.optString("name"), mark)
                if (mark == Mark.FAILED) {
                    Text(
                        stringResource(R.string.count_row_failed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Palette.Danger,
                    )
                }
                Spacer(Modifier.height(4.dp))
                InfoRow(
                    label = stringResource(
                        if (staleAt == null) R.string.count_system_qty
                        else R.string.count_system_qty_stale,
                    ),
                    value = it.optString("qty"),
                )
                Spacer(Modifier.height(10.dp))
                // 🔴 T10 — KESHDAN kelgan son SUKUT QIYMAT bo'la olmaydi:
                // omborchi «Saqlash» ni bosgan zahoti eski son MUTLAQ sanoq
                // bo'lib serverga ketardi — bu aynan «keshdan chiqqan yozish
                // qarori». Oflaynda maydon BO'SH va tugma o'chiq turadi
                // (`QtyExpression.qty("") == null`), ya'ni son javondan
                // sanab kiritilishi SHART.
                val typed = counts[assortmentId]
                    ?: if (staleAt == null) it.optString("qty") else ""
                NumberField(
                    value = typed,
                    onChange = { v -> counts[assortmentId] = v },
                    label = stringResource(R.string.count_qty_hint),
                    expression = true,
                )
                Spacer(Modifier.height(10.dp))
                // T5 — ifoda noto'g'ri bo'lsa tugma O'CHADI (sabab maydon
                // ostida turadi). Ilgari bu tugma har doim yoniq edi va bo'sh
                // maydonda bosilsa faqat xato chiqardi.
                PrimaryButton(
                    text = stringResource(R.string.count_save),
                    enabled = QtyExpression.qty(typed) != null,
                ) { save(c, assortmentId, it.optString("name"), typed) }
            }
            Spacer(Modifier.height(10.dp))
        }

        // Ikkinchi guruh: biriktirilgan, lekin qoldig'i 0 tovarlar. Sanoq
        // maydoni bu yerda YO'Q — bosilganda yuqoridagi «sanalayotgan tovar»
        // kartasi ochiladi va sariq ogohlantirish (kirim bo'lib yoziladi)
        // o'sha yerda ko'rinadi.
        for (b in extras) {
            val boundId = b.optString("id")
            if (boundId == p?.optString("id")) continue
            val boundMark = marks[boundId]
            SectionCard(
                modifier = Modifier.clickable { pick(b.optString("name"), boundId) },
                tint = Palette.SurfaceMuted,
                border = markBorder(boundMark),
            ) {
                // NARX YO'Q: `getCellProducts` select'i — id, name, code,
                // barcode, archived. Narx maydoni javobda umuman yo'q.
                MarkedTitle(b.optString("name"), boundMark)
                if (boundMark == Mark.FAILED) {
                    Text(
                        stringResource(R.string.count_row_failed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Palette.Danger,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.count_bound_zero),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.TextMuted,
                )
                if (b.optBoolean("archived")) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        stringResource(R.string.count_archived),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Palette.Warning,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        // T6 — «qolganini 0 qilib yopish». Ro'yxatlardan KEYIN turadi:
        // omborchi avval qatorlarni ko'radi, keyin «qolgani yo'q» deydi.
        CloseRestBlock(c)

        // T3 — shtrixsiz tovarni NOMIDAN topish. Yacheyka ochiq bo'lgandagina
        // ko'rinadi: yacheykasiz sanoq ma'nosiz (son qaysi yacheykaga
        // yozilishi noma'lum bo'lardi) — bu `onScan` dagi mavjud qoidaning
        // aynan o'zi.
        SecondaryButton(text = stringResource(R.string.search_open)) {
            shell.go(
                SearchScreen(shell) { pr ->
                    // Multi-hit qoidasi buzilmaydi: tanlovni ODAM qildi,
                    // ekran esa mavjud `pick()` ga o'tadi — yangi sanoq yo'li
                    // yaratilmaydi va sariq «yacheykada yo'q» ogohlantirishi
                    // o'z joyida ishlaydi.
                    pick(pr.optString("name"), pr.optString("id"))
                    shell.back()
                },
            )
        }
        Spacer(Modifier.height(10.dp))

        SecondaryButton(text = stringResource(R.string.restart), color = Palette.TextMuted) {
            reset()
        }
    }

    /** Skanerlangan tovar kartasi — ekranning tepasida, maydoni tayyor. */
    @Composable
    private fun PickedCard(c: JSONObject, p: JSONObject) {
        val assortmentId = p.optString("id")
        val inCell = systemQty(assortmentId)

        SectionCard(
            tint = if (inCell == null) Palette.WarningContainer else Palette.SuccessContainer,
            border = if (inCell == null) Palette.Warning else Palette.Success,
        ) {
            Text(
                stringResource(R.string.count_scanned),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(4.dp))
            // T6 — ro'yxatdagi kabi belgi: ochiq turgan qator ham «sanaldimi»
            // savoliga javob bersin (ro'yxatda u chizilmaydi).
            MarkedTitle(p.optString("name"), marks[assortmentId])
            Spacer(Modifier.height(6.dp))
            if (inCell != null) {
                InfoRow(
                    label = stringResource(
                        if (cachedAt == null) R.string.count_system_qty
                        else R.string.count_system_qty_stale,
                    ),
                    value = inCell,
                )
            } else {
                // 🔴 Yangi qator — sanash KIRIM hujjatini yozadi. Omborchi buni
                // oldindan bilishi kerak (jim qo'shish IS-5 klassi bo'lardi).
                Text(
                    stringResource(R.string.count_not_in_cell),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Palette.Warning,
                )
            }
            Spacer(Modifier.height(10.dp))
            NumberField(
                value = pickedQty,
                onChange = { pickedQty = it },
                label = stringResource(R.string.count_qty_hint),
                expression = true,
            )
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = stringResource(R.string.count_save),
                color = if (inCell == null) Palette.Warning else Palette.Success,
                // T5 — «bo'sh emas» o'rniga «hisoblanadi»: `12*` yozilgan
                // holatda ham tugma o'chadi va sabab maydon ostida ko'rinadi.
                enabled = QtyExpression.qty(pickedQty) != null,
            ) { save(c, assortmentId, p.optString("name"), pickedQty) }
            Spacer(Modifier.height(8.dp))
            SecondaryButton(
                text = stringResource(R.string.count_cancel),
                color = Palette.TextMuted,
            ) {
                picked = null
                pickedQty = ""
            }
        }
    }

    /**
     * 🔴 T7 — «Oxirgi sanoq» chizig'i: nima o'zgargani va bir bosishda
     * qaytarish. Chiziq [UNDO_STRIP_MS] dan keyin O'ZI yo'qoladi.
     *
     * **Qaytarish — BEKOR QILISH EMAS.** U hujjatni o'chirmaydi (serverda
     * bunday sirt yo'q), balki eski qiymat bilan YANGI `set` so'rovini
     * yuboradi: mutlaq son semantikasi buzilmaydi va tizim ikkinchi hujjat
     * yozadi. Kartadagi qizil izoh shuni ochiq aytadi — «bekor bo'ldi» degan
     * jim taassurot ERP tomondagi ikkita hujjat bilan qarama-qarshi bo'lardi.
     *
     * 🔴 Chiziq DIALOG emas, oqim ichidagi karta — T6 dagi tasdiq kartasi
     * bilan bir sabab: dialog `ScanBar` fokusini tortib olsa, yopilgandan
     * keyin uni hech kim qaytarmaydi va klaviatura-wedge skaner jim o'lardi.
     *
     * Chiziq FAQAT qiymat haqiqatan o'zgarganda chiqadi ([save] dagi shart):
     * maydonning sukut qiymati tizim qoldig'ining O'ZI, ya'ni saqlashlarning
     * ko'pi «14 → 14» bo'ladi. Ularda server hujjat ham yozmaydi (delta 0)
     * va qaytariladigan narsa yo'q — har saqlashda chiziq chiqsa u shovqinga
     * aylanib, HAQIQIY xatolik ko'rinmay qolardi.
     */
    @Composable
    private fun UndoStrip(c: JSONObject) {
        val last = lastSave ?: return

        if (undoing) {
            SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
                Text(
                    stringResource(R.string.count_undoing),
                    style = MaterialTheme.typography.titleMedium,
                    color = Palette.Warning,
                )
            }
            Spacer(Modifier.height(10.dp))
            return
        }

        // Avto-yopish. Kalit — `seq`, chunki AYNI o'zgarish ikkinchi marta
        // saqlansa `data class` nusxalari teng bo'lardi va taymer qayta
        // boshlanmasdi. Taymer tugaganda o'zi qo'ygan chiziq hamon o'sha
        // ekanini tekshiradi: kechikkan taymer yangi chiziqni o'chirmasin.
        LaunchedEffect(last.seq) {
            delay(UNDO_STRIP_MS)
            if (lastSave?.seq == last.seq) lastSave = null
        }

        val target = last.target
        SectionCard(tint = Palette.SurfaceMuted) {
            Text(
                stringResource(R.string.count_undo_title),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (last.before == null) {
                    stringResource(R.string.count_undo_new, last.name, last.after)
                } else {
                    stringResource(R.string.count_undo_changed, last.name, last.before, last.after)
                },
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(6.dp))
            // Izoh nishonga qarab tanlanadi, kelib chiqishiga emas: nishon 0
            // bo'lsa qaytarish CHIQIM (Списание) yozadi — yacheykada YO'Q
            // tovarda ham, qoldig'i 0 biriktirilgan tovarda ham (reja bandi 3).
            val zeroTarget = target == "0"
            Text(
                if (zeroTarget) {
                    stringResource(R.string.count_undo_note_zero)
                } else {
                    stringResource(R.string.count_undo_note, target)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = if (zeroTarget) Palette.Danger else Palette.Warning,
            )
            Spacer(Modifier.height(10.dp))
            SecondaryButton(
                text = stringResource(R.string.count_undo_button, target),
                color = if (zeroTarget) Palette.Danger else Palette.Primary,
            ) { undoLast(c, last) }
        }
        Spacer(Modifier.height(10.dp))
    }

    /**
     * T6 — qator sarlavhasi BELGI bilan: ✓ yashil (shu sessiyada sanaldi),
     * ○ kulrang (hali sanalmagan), ✕ qizil (0 qilib yopishda xato bergan).
     *
     * Belgi nomdan CHAPDA: omborchi ro'yxatni yuqoridan pastga ko'z bilan
     * kesib o'tadi va bir ustunda turgan belgilar «qayerda qoldim?»
     * savoliga bir qarashda javob beradi (rang bilan birga SHAKL ham farq
     * qiladi — 4" ekranda va qo'lqopda rang yolg'iz yetarli emas).
     */
    @Composable
    private fun MarkedTitle(name: String, mark: Mark?) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                markGlyph(mark),
                color = markColor(mark),
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                name,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }

    /**
     * T6 — «Qolganini 0 qilib yopish» tugmasi, tasdiq kartasi va halqa
     * holati.
     *
     * 🔴 TASDIQ **KARTA**, dialog (`AlertDialog`) EMAS — bu ataylab.
     * `ScanBar` fokusni FAQAT ekran almashganda so'raydi (`ScanBar.kt`
     * izohi); dialog oynasi fokusni tortib olsa, yopilgandan keyin uni
     * hech kim qaytarmaydi va klaviatura-wedge skaner **jim o'lardi**.
     * Karta esa oqim ichida turadi, skroll bilan ochiladi va fokusga
     * umuman tegmaydi.
     *
     * 🔴 Ro'yxat KESILMAYDI («…va yana 20 ta» yo'q): bu yo'qotuvchi amal va
     * omborchi AYNAN nima 0 bo'lishini ko'rishi kerak. Har qator yonida
     * hozirgi tizim qoldig'i turadi — chiqim aynan shuncha bo'ladi.
     */
    @Composable
    private fun CloseRestBlock(c: JSONObject) {
        // 🔴 T10 — OFLAYN ko'rinishda bu blok umuman chizilmaydi. «Qolganini
        // 0 qilib yopish» — YO'QOTUVCHI ommaviy amal (har qator uchun avto
        // Списание) va u «qaysi qator sanalmagan» ro'yxatidan chiqadi.
        // Ro'yxat kesh bo'lsa qaror ham keshdan chiqqan bo'lardi: boshqa
        // terminal allaqachon sanagan qator bu yerda «sanalmagan» ko'rinadi.
        if (cachedAt != null) return
        if (closing) {
            SectionCard(tint = Palette.WarningContainer, border = Palette.Warning) {
                Text(
                    stringResource(R.string.count_closing),
                    style = MaterialTheme.typography.titleMedium,
                    color = Palette.Warning,
                )
            }
            Spacer(Modifier.height(10.dp))
            return
        }
        val pending = pendingRows()
        if (pending.isEmpty()) return

        if (!confirming) {
            SecondaryButton(
                text = stringResource(R.string.count_close_rest, pending.size),
                color = Palette.Danger,
            ) { confirming = true }
            Spacer(Modifier.height(10.dp))
            return
        }

        SectionCard(tint = Palette.DangerContainer, border = Palette.Danger) {
            Text(
                stringResource(R.string.count_close_title),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.Danger,
            )
            Spacer(Modifier.height(6.dp))
            // 🔴 Chiqim ogohlantirishi — jim bajarilmasin (reja T6, band 4).
            Text(
                stringResource(R.string.count_close_warning),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.Danger,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.count_close_list, pending.size),
                style = MaterialTheme.typography.bodyMedium,
                color = Palette.TextMuted,
            )
            Spacer(Modifier.height(4.dp))
            for (row in pending) {
                InfoRow(label = row.name, value = row.qty)
            }
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = stringResource(R.string.count_close_confirm),
                color = Palette.Danger,
            ) { closeRest(c) }
            Spacer(Modifier.height(8.dp))
            SecondaryButton(
                text = stringResource(R.string.count_cancel),
                color = Palette.TextMuted,
            ) { confirming = false }
        }
        Spacer(Modifier.height(10.dp))
    }

    /**
     * Biriktirilgan, lekin `stock` da BO'LMAGAN tovarlar. Qoldig'i bor tovar
     * ikki marta chizilmaydi (ikki maydon bir tovarga ikki xil son berardi),
     * arxivlanganlari esa oxiriga suriladi — `sortedBy` barqaror, ya'ni
     * serverning `name` tartibi guruh ichida saqlanadi.
     */
    private fun boundOnly(): List<JSONObject> {
        if (bound.length() == 0) return emptyList()
        val inStock = HashSet<String>()
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            inStock.add(it.optString("assortmentId"))
        }
        val out = ArrayList<JSONObject>()
        for (i in 0 until bound.length()) {
            val b = bound.optJSONObject(i) ?: continue
            if (inStock.contains(b.optString("id"))) continue
            out.add(b)
        }
        return out.sortedBy { if (it.optBoolean("archived")) 1 else 0 }
    }

    /** Shu yacheykadagi tizim qoldig'i, tovar ro'yxatda bo'lmasa `null`. */
    private fun systemQty(assortmentId: String): String? {
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            if (it.optString("assortmentId") == assortmentId) return it.optString("qty")
        }
        return null
    }

    /**
     * T6 — progressning SURATI: shu sessiyada saqlangan qatorlar soni.
     * `roster` dan mustaqil o'qiladi, chunki 0 ga tushirilgan qator server
     * javobidan yo'qoladi — lekin u SANALGAN va hisobdan chiqmasligi kerak.
     */
    private fun countedCount(): Int = marks.count { it.value == Mark.COUNTED }

    /**
     * T6 — `roster` ni server ma'lumotidan to'ldiradi. FAQAT qo'shadi:
     * yo'qolgan qator (0 ga tushgani uchun) maxrajda qoladi, aks holda
     * «12/12 sanaldi» hech qachon chiqmasdi.
     */
    private fun rosterSync() {
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            roster[it.optString("assortmentId")] = it.optString("name")
        }
        for (i in 0 until bound.length()) {
            val b = bound.optJSONObject(i) ?: continue
            roster[b.optString("id")] = b.optString("name")
        }
    }

    /**
     * T6 — 0 ga tushiriladigan qatorlar: EKRANDA turgan va shu sessiyada
     * SANALMAGAN hammasi, aynan ko'rinish tartibida (avval qoldiqlilar,
     * keyin biriktirilganlar).
     *
     * `roster` dan emas, ekrandagi ikki ro'yxatdan yig'iladi va buning
     * sababi bor: `roster` — hash-jadval, tartibi ixtiyoriy bo'lardi, va
     * u ALLAQACHON 0 ga tushirilgan (ya'ni yo'qolgan) qatorlarni ham
     * saqlaydi — ular qayta yuborilishi kerak emas.
     *
     * `Mark.FAILED` qatorlar QAYTA kiradi: ular sanalmagan, demak omborchi
     * ikkinchi urinishni tugmani qayta bosib qila oladi.
     */
    private fun pendingRows(): List<Pending> {
        val out = ArrayList<Pending>()
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            val id = it.optString("assortmentId")
            if (marks[id] == Mark.COUNTED) continue
            out.add(Pending(id, it.optString("name"), it.optString("qty")))
        }
        for (b in boundOnly()) {
            val id = b.optString("id")
            if (marks[id] == Mark.COUNTED) continue
            // Biriktirilgan qatorning qoldig'i ta'rifiga ko'ra 0 — bunda
            // delta ham 0 bo'ladi va server hujjat YOZMAYDI, faqat qator
            // «sanaldi» belgisini oladi.
            out.add(Pending(id, b.optString("name"), "0"))
        }
        return out
    }

    /**
     * 🔴 T6 — sanalmagan qatorlarni BITTALAB `set 0` bilan yopadi.
     *
     * Xulq (jonli xatoliklar ochiq ko'rinsin uchun):
     *  · muvaffaqiyat → qator ✓ yashil bo'ladi;
     *  · 4xx (masalan o'chirilgan tovar) → qator ✕ QIZIL bo'ladi va halqa
     *    DAVOM etadi — bitta buzuq qator butun yacheykani ushlab qolmasin;
     *  · aloqa yo'q / 5xx (`retriable`) → halqa TO'XTAYDI. Sabab sanash
     *    qoidasi: bu amal navbatga QO'YILMAYDI, ya'ni «keyin yuboriladi»
     *    degan va'da berib bo'lmaydi. Qolgan qatorlar kulrang turadi.
     *
     * Tarkib oxirida BIR MARTA qayta o'qiladi (har qatordan keyin emas):
     * 30 qatorli yacheykada bu 30 ta ortiqcha so'rovni yo'q qiladi.
     */
    private fun closeRest(c: JSONObject) {
        val targets = pendingRows()
        if (targets.isEmpty()) return
        val storeId = c.optString("storeId")
        val cellId = c.optString("id")
        confirming = false
        closing = true
        // T7 — ommaviy yopish oldingi BITTA qatorning chizig'ini eskirtiradi:
        // «oxirgi sanoq» endi u emas. Ommaviy amalning o'z qaytarishi YO'Q
        // (T7 doirasi — bitta qator), buni tasdiq matni ochiq aytadi.
        lastSave = null
        shell.io {
            var ok = 0
            var stopped = false
            try {
                for (row in targets) {
                    try {
                        shell.api.setCellStock(storeId, cellId, row.id, "0")
                        ok++
                        // Yacheyka almashib ketgan bo'lsa belgi YANGI
                        // yacheykaning qatoriga tushib qolmasin.
                        shell.main {
                            if (cell?.optString("id") == cellId) {
                                marks[row.id] = Mark.COUNTED
                                roster[row.id] = row.name
                                counts.remove(row.id)
                                if (picked?.optString("id") == row.id) {
                                    picked = null
                                    pickedQty = ""
                                }
                            }
                        }
                    } catch (e: ApiClient.ApiException) {
                        shell.main {
                            if (cell?.optString("id") == cellId) marks[row.id] = Mark.FAILED
                        }
                        // 4xx — bu qatorda ish bitdi (qizil qoladi), halqa
                        // davom etadi. Üstma-ust hisob «yopilmagan»
                        // sifatida pastda chiqadi.
                        if (e.retriable) {
                            stopped = true
                            break
                        }
                    }
                }
                // Qayta o'qish MUVAFFAQIYATSIZ bo'lsa ham yakuniy xabar
                // AYNI qoladi: belgilar yozilgan amallardan olingan, ro'yxat
                // esa faqat KO'RINISH. Shuning uchun bu yerdagi xato pastdagi
                // hisobotni bosib ketmasligi kerak.
                try {
                    val fresh = shell.api.cellStock(storeId, cellId)
                    shell.main {
                        if (cell?.optString("id") == cellId) {
                            items = fresh.optJSONArray("items") ?: items
                            rosterSync()
                        }
                    }
                } catch (e: ApiClient.ApiException) {
                    Diagnostics.log("count: yopishdan keyin qayta o'qish xato — " + e.code)
                }
            } finally {
                // Hisob YOPILGAN qatorlardan olinadi, `bad` dan emas: halqa
                // kutilmagan xato bilan uzilsa ham «hammasi yopildi» degan
                // yolg'on xabar chiqmasin (jim yo'qotish yo'q — IS-5).
                val left = targets.size - ok
                shell.main {
                    closing = false
                    when {
                        stopped -> shell.error(shell.str(R.string.count_close_stopped, ok, left))
                        left > 0 -> shell.error(shell.str(R.string.count_close_partial, ok, left))
                        else -> shell.success(shell.str(R.string.count_close_done, ok))
                    }
                }
            }
        }
    }

    /**
     * 🔴 T7 — SAQLASHDAN OLDINGI holatni suratga oladi. `null` qaytarsa
     * chiziq CHIZILMAYDI (va eskisi ham olib tashlanadi).
     *
     * Qarorning O'ZI [CountUndo] da — sof modulda, unit-test bilan
     * qulflangan. Bu yerda faqat ekranning holati qo'shiladi: qator progress
     * maxrajida bormidi va taymer kaliti.
     */
    private fun undoPoint(assortmentId: String, name: String, after: String): LastSave? {
        // 🔴 T10 — kesh ustida qaytarish TAKLIF QILINMAYDI: «avvalgi qiymat»
        // eski nusxadan olingan bo'lardi va ⟲ tugmasi uni MUTLAQ son
        // sifatida serverga yuborardi — ya'ni keshdan chiqqan yozish qarori.
        if (cachedAt != null) return null
        val raw = systemQty(assortmentId)
        val point = CountUndo.point(raw, after)
        if (point is CountUndo.Point.Unreadable) {
            Diagnostics.log("count: qaytarish nuqtasi yo'q — eski qoldiq o'qilmadi: " + raw)
        }
        if (point !is CountUndo.Point.Show) return null
        saveSeq++
        return LastSave(
            id = assortmentId,
            name = name,
            before = point.before,
            target = point.target,
            after = after,
            wasInRoster = roster.containsKey(assortmentId),
            seq = saveSeq,
        )
    }

    /**
     * 🔴 T7 — oxirgi sanoqni qaytaradi: eski qiymat bilan YANGI `set` so'rovi.
     *
     * Bu BEKOR QILISH emas — server hujjatni o'chirmaydi va ilovada bunday
     * sirt yo'q. `setCellStock` hamon `mode: 'set'`, ya'ni MUTLAQ SON
     * semantikasi buzilmaydi: so'rov ikki marta ketsa ham natija AYNI bo'ladi.
     * Yacheykada bo'lmagan tovar uchun nishon `0` (reja bandi 3).
     *
     * Amal, sanashning o'zi kabi, oflayn NAVBATGA QO'YILMAYDI: aloqa yo'q
     * bo'lsa chiziq O'Z JOYIDA qoladi va omborchi qayta urinadi — «keyin
     * yuboriladi» degan va'da berilmaydi.
     */
    private fun undoLast(c: JSONObject, last: LastSave) {
        val storeId = c.optString("storeId")
        val cellId = c.optString("id")
        val target = last.target
        undoing = true
        shell.io {
            try {
                shell.api.setCellStock(storeId, cellId, last.id, target)
            } catch (e: ApiClient.ApiException) {
                shell.main {
                    undoing = false
                    shell.error(
                        if (e.retriable) shell.str(R.string.count_offline) else (e.message ?: ""),
                    )
                }
                return@io
            }
            // Tarkib QAYTA O'QILADI (qabul mezoni). Qayta o'qish yiqilsa ham
            // qaytarish BO'LDI: belgilar yozilgan AMALDAN olinadi, ro'yxat
            // esa faqat ko'rinish — T6 dagi qoidaning aynan o'zi.
            val fresh = try {
                shell.api.cellStock(storeId, cellId)
            } catch (e: ApiClient.ApiException) {
                Diagnostics.log("count: qaytarishdan keyin qayta o'qish xato — " + e.code)
                null
            }
            shell.main {
                undoing = false
                // Yacheyka almashib ketgan bo'lsa (so'rov ketayotganda) natija
                // YANGI yacheykaning qatorlariga tushmasin — `closeRest` dagi
                // qo'riqning o'zi.
                if (cell?.optString("id") == cellId) {
                    if (fresh != null) items = fresh.optJSONArray("items") ?: items
                    counts.remove(last.id)
                    // 🔴 Qator endi SANALMAGAN (○): qiymat tizimning o'z
                    // qoldig'iga qaytdi, ya'ni omborchi uni hali sanamadi.
                    // ✓ qoldirilsa progress «sanaldi» deb yolg'on aytardi va
                    // «qolganini 0 qilib yopish» bu qatorni chetlab o'tardi.
                    marks.remove(last.id)
                    // Maxrajga qatorni SHU saqlash qo'shgan bo'lsa — olib
                    // tashlanadi: 0 ga qaytgan qator server javobidan
                    // yo'qoladi va aks holda progress «12/13» da abadiy
                    // qolib ketardi (yopadigan qator ekranda yo'q).
                    if (!last.wasInRoster) roster.remove(last.id)
                    if (fresh != null) rosterSync()
                    if (picked?.optString("id") == last.id) {
                        picked = null
                        pickedQty = ""
                    }
                    // Ikkinchi marta qaytarish taklif qilinmaydi: u endi
                    // «qaytarish» emas, oddiy yangi sanoq bo'lardi.
                    lastSave = null
                }
                shell.success(shell.str(R.string.count_undo_done, last.name, target))
            }
        }
    }

    private fun pick(name: String, assortmentId: String) {
        picked = JSONObject().put("id", assortmentId).put("name", name)
        // Ro'yxatdagi tovarda sukut — tizim qoldig'i (omborchi ko'pincha uni
        // tasdiqlaydi); yacheykada yo'q tovarda maydon BO'SH qoladi, chunki
        // «0» taklif qilish sanashning ma'nosini yo'qotardi.
        // 🔴 T10 — kesh ustida sukut qiymat TAKLIF QILINMAYDI (sabab
        // ro'yxatdagi maydon izohida): oflaynda sonni omborchi o'zi kiritadi.
        pickedQty = if (cachedAt != null) "" else systemQty(assortmentId) ?: ""
    }

    private fun reset() {
        cell = null
        cellCode = ""
        items = JSONArray()
        bound = JSONArray()
        counts.clear()
        picked = null
        pickedQty = ""
        clearProgress()
    }

    /**
     * T6 — progress YACHEYKAGA bog'liq: yacheyka almashganda (yoki
     * «Boshidan» bosilganda) u nolga tushadi. Aks holda oldingi javonning
     * ✓ belgilari yangi javonning qatorlariga tushib qolardi (id'lar
     * kesishishi mumkin: bir tovar ikki yacheykada turadi).
     */
    private fun clearProgress() {
        roster.clear()
        marks.clear()
        confirming = false
        // T10 — yangi yacheyka JONLI deb hisoblanadi; keshdan ochilgan
        // bo'lsa `adoptCell` bayroqni shundan KEYIN qo'yadi.
        cachedAt = null
        // 🔴 T7 (reja bandi 4) — YACHEYKA almashsa chiziq ham yo'qoladi.
        // Aks holda omborchi yangi javon oldida turib eski javonning
        // sanog'ini «qaytarib» yuborardi. Ekran almashishi esa
        // `Content()` dagi `DisposableEffect` da qamralgan.
        lastSave = null
    }

    /**
     * Skan bosqichga qarab talqin qilinadi (`PlaceScreen` naqshi): avval
     * `/tsd/scan` kodni TASNIFLAYDI, keyin yacheyka yoki tovar yo'liga ketadi.
     */
    override fun onScan(code: String): Boolean {
        shell.io {
            val hit = try {
                shell.api.scan(code)
            } catch (e: ApiClient.ApiException) {
                // 🔴 T10 — aloqa yo'q, ya'ni kod TASNIFLANMAGAN: u yacheykami
                // yoki tovarmi — bilmaymiz. Yagona xavfsiz javob — xotirada
                // AYNAN shu kod bilan ochilgan yacheyka bormi. Tovar shtrixi
                // oflaynda tanilmaydi va bu ATAYLAB: kesh qaysi shtrix qaysi
                // tovarga tegishli ekanini emas, faqat KO'RILGAN ro'yxatni
                // biladi — undan tovar «tanlash» multi-hit qoidasini
                // (tanlovni ODAM qiladi) chetlab o'tishga yo'l ochardi.
                if (e.retriable) openCellFromCache(code) else shell.error(e.message ?: "")
                return@io
            }
            when (hit.optString("kind")) {
                "cell" -> openCell(code)
                "product" -> {
                    if (cell == null) {
                        // Yacheykasiz sanoq ma'nosiz: son QAYSI yacheykaga
                        // yozilishi noma'lum bo'lardi.
                        shell.error(R.string.count_need_cell_first)
                    } else {
                        val products = hit.optJSONArray("products") ?: JSONArray()
                        shell.main {
                            when (products.length()) {
                                0 -> shell.error(R.string.scan_none)
                                1 -> {
                                    val pr = products.getJSONObject(0)
                                    // T4 — tovar tanildi: qisqa signal.
                                    // Xabar YO'Q, chunki tanlangan tovar
                                    // kartochkasi ekranda o'zi ochiladi.
                                    Feedback.ok()
                                    pick(pr.optString("name"), pr.optString("id"))
                                }
                                // Multi-hit: TANLOVNI ODAM qiladi (G-reja
                                // majburiy qoidasi) — shtrixlar unikal emas.
                                // T4 signali bu yerda ham «tanildi» degani.
                                else -> {
                                    Feedback.ok()
                                    shell.go(
                                        PickProductScreen(shell, products) { pr ->
                                            pick(pr.optString("name"), pr.optString("id"))
                                            shell.back()
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
                "piece" -> shell.error(R.string.scan_piece)
                else -> shell.error(R.string.scan_none)
            }
        }
        return true
    }

    /** Yacheyka yorlig'i — tarkibini ochadi (yoki keyingi yacheykaga o'tadi). */
    private fun openCell(code: String) {
        val resp = try {
            shell.api.cellByBarcode(code)
        } catch (e: ApiClient.ApiException) {
            // T10 — skan tasniflanib ulgurdi, lekin tarkib kelmadi (Wi-Fi
            // aynan shu daqiqada uzildi). Xotiradagi nusxa bo'lsa — ochamiz.
            if (!e.retriable) throw e
            openCellFromCache(code)
            return
        }
        val cells = resp.optJSONArray("cells") ?: JSONArray()
        // 🔴 T10 — kesh IO thread'da yoziladi (`SharedPreferences` diskka
        // tegadi) va FAQAT yagona yacheyka topilganda: ko'p natijali yorliq
        // keshga tushsa, oflaynda ilova uni «shu yacheyka» deb ochib
        // yuborardi, ya'ni «tanlovni ODAM qiladi» qoidasi buzilardi.
        if (cells.length() == 1) shell.cache.putCell(code, resp)
        shell.main {
            when (cells.length()) {
                0 -> shell.error(R.string.cell_not_found)
                1 -> {
                    // T4 — yacheyka ochildi: omborchi yorliqni skanerlab,
                    // ekranga qaramasdan keyingi tovarga qo'l uzatadi.
                    Feedback.ok()
                    adoptCell(code, cells.getJSONObject(0), resp, at = null)
                }
                // Ikki javonda bir xil yorliq — ilova TANLAMAYDI, aks holda
                // sanoq noto'g'ri yacheykaga yozilardi.
                else -> shell.error(R.string.cell_ambiguous)
            }
        }
    }

    /**
     * Yacheyka tarkibini ekranga oladi (UI thread).
     *
     * @param at `null` = JONLI javob; son = KESH va uning yoshi.
     * @param fresh `true` = YANGI yacheyka (sanoq sessiyasi noldan boshlanadi);
     *   `false` = AYNI yacheykaning jim yangilanishi, ya'ni omborchi terib
     *   qo'ygan sonlar, ✓ belgilari va progress JOYIDA qoladi.
     */
    private fun adoptCell(
        code: String,
        c: JSONObject,
        resp: JSONObject,
        at: Long?,
        fresh: Boolean = true,
    ) {
        if (fresh) {
            counts.clear()
            picked = null
            pickedQty = ""
            // T6 — yangi yacheyka = yangi sanoq sessiyasi. `clearProgress`
            // `cachedAt` ni ham nolga tushiradi, shuning uchun bayroq undan
            // KEYIN qo'yiladi.
            clearProgress()
        }
        cell = c
        cellCode = code
        items = resp.optJSONArray("stock") ?: JSONArray()
        // Qo'shimcha SO'ROV YO'Q — `products` shu javobning ichida.
        bound = resp.optJSONArray("products") ?: JSONArray()
        cachedAt = at
        rosterSync()
    }

    /**
     * 🔴 T10 — yacheykani XOTIRADAN ochadi (aloqa yo'q).
     *
     * Kesh yozuvi yo'q yoki muddati o'tgan bo'lsa ([CacheShape.MAX_AGE_MS] —
     * bitta smena) hech nima ochilmaydi va xato AYTILADI: bo'sh yacheyka
     * ko'rsatib qo'yish 2026-09-03 dagi boshi berk ko'chaning aynan o'zi
     * bo'lardi.
     */
    private fun openCellFromCache(code: String) {
        val entry = shell.cache.cell(code)
        val one = entry?.body?.optJSONArray("cells")?.optJSONObject(0)
        if (entry == null || one == null) {
            shell.error(R.string.cache_cell_missing)
            return
        }
        shell.main {
            // Yorliq TANILDI — signal T4 qoidasi bo'yicha beriladi (omborchi
            // ekranga emas, javonga qaraydi). Ma'lumot eski ekanini sariq
            // plashka aytadi, bo'sh sanoq maydonlari esa unga qarashga
            // majbur qiladi.
            Feedback.ok()
            adoptCell(code, one, entry.body, at = entry.savedAt)
        }
    }

    /**
     * 🔴 T10 — ALOQA QAYTGANDA JIM YANGILASH.
     *
     * «Jim» — so'zma-so'z: muvaffaqiyatda ovoz ham, toast ham, banner ham
     * yo'q (plashka shunchaki yo'qoladi), xatoda esa faqat [Diagnostics] ga
     * qator tushadi. Sabab: bu urinishni omborchi so'ramagan — u javon
     * oldida ishlayapti va har 20 soniyada chiqadigan qizil banner uning
     * ishini to'sardi.
     */
    private fun refreshQuietly() {
        val code = cellCode
        if (code.isEmpty() || refreshing) return
        refreshing = true
        shell.io {
            val resp = try {
                shell.api.cellByBarcode(code)
            } catch (e: ApiClient.ApiException) {
                Diagnostics.log("CACHE jim yangilash o'tmadi: " + (e.message ?: ""))
                shell.main { refreshing = false }
                return@io
            }
            val cells = resp.optJSONArray("cells") ?: JSONArray()
            val one = cells.optJSONObject(0)
            if (cells.length() == 1 && one != null) {
                shell.cache.putCell(code, resp)
                shell.main { adoptCell(code, one, resp, at = null, fresh = false) }
            }
            shell.main { refreshing = false }
        }
    }

    private fun save(c: JSONObject, assortmentId: String, name: String, input: String) {
        // 🔴 T5 — ifoda SHU YERDA songa aylanadi va serverga aynan shu son
        // ketadi (`12*24` emas, `288`). Tugma allaqachon o'chirilgan bo'lsa ham
        // ikkinchi qavat: jim 0 yoki ifoda MATNI hech qachon yuborilmasin.
        val qty = QtyExpression.qty(input)
        if (qty == null) {
            shell.error(if (input.isBlank()) R.string.count_qty_hint else R.string.qty_invalid)
            return
        }
        // 🔴 T7 — eski qiymat saqlashdan OLDIN o'qiladi (reja bandi 1). Bu
        // funksiya UI thread'dan chaqiriladi va `items` faqat `shell.main`
        // ichida almashadi, ya'ni bu yerdagi o'qish so'rovdan oldingi holat.
        val undo = undoPoint(assortmentId, name, qty)
        shell.io {
            try {
                shell.api.setCellStock(c.optString("storeId"), c.optString("id"), assortmentId, qty)
                // Tarkib QAYTA O'QILADI: aks holda «Tizimda» ustuni eski sonni
                // ko'rsatib turardi va yangi sanalgan tovar ro'yxatda umuman
                // paydo bo'lmasdi.
                val fresh = shell.api.cellStock(c.optString("storeId"), c.optString("id"))
                shell.main {
                    items = fresh.optJSONArray("items") ?: items
                    // T10 — «Tizimda» ustuni endi JONLI o'qildi: plashka
                    // ketadi va sukut qiymatlar qaytadi.
                    cachedAt = null
                    counts.remove(assortmentId)
                    // T6 — qator SANALDI (✓ yashil) va progressga kiradi.
                    // `roster` ga ham yoziladi: 0 deb sanalgan yoki
                    // yacheykada BO'LMAGAN tovar server javobidan
                    // yo'qolishi mumkin, lekin sanalgani rost.
                    marks[assortmentId] = Mark.COUNTED
                    roster[assortmentId] = name
                    rosterSync()
                    if (picked?.optString("id") == assortmentId) {
                        picked = null
                        pickedQty = ""
                    }
                    // T7 — qaytarish chizig'i. `undo == null` bo'lsa (qiymat
                    // o'zgarmagan yoki eski qiymat o'qib bo'lmaydigan) eski
                    // chiziq ham OLIB TASHLANADI: u endi «oxirgi» emas.
                    // Ekran almashib ketgan bo'lsa chiziq umuman qo'yilmaydi.
                    lastSave = if (onScreen) undo else null
                    shell.success(shell.str(R.string.count_saved))
                }
            } catch (e: ApiClient.ApiException) {
                shell.error(
                    if (e.retriable) shell.str(R.string.count_offline) else (e.message ?: ""),
                )
            }
        }
    }
}

/**
 * T6 — qatorning SHU SESSIYADAGI holati. «Sanalmagan» uchun qiymat YO'Q
 * (jadvalda kalit bo'lmasligi) — ya'ni sukut holat hech qayerda saqlanmaydi
 * va yacheyka almashganda tozalanadigan bitta joy qoladi.
 */
private enum class Mark {
    /** Shu sessiyada saqlandi (qo'lda yoki «0 qilib yopish» bilan). */
    COUNTED,

    /** «0 qilib yopish» da server rad etdi — qator QIZIL bo'lib qoladi. */
    FAILED,
}

/** T6 — 0 ga tushiriladigan qator: tasdiq ro'yxati aynan shuni chizadi. */
private data class Pending(val id: String, val name: String, val qty: String)

/**
 * 🔴 T7 — qaytarish nuqtasi: bitta qatorning SAQLASHDAN OLDINGI holati.
 *
 * Faqat SON saqlanadi, hujjat identifikatori emas — chunki qaytarish hujjatni
 * o'chirmaydi, u yangi `set <before>` so'rovini yuboradi (mutlaq son).
 */
private data class LastSave(
    val id: String,
    val name: String,

    /**
     * Saqlashdan oldingi qoldiq, `QtyExpression` orqali normallashtirilgan.
     * `null` = qator yacheykada UMUMAN yo'q edi; bunda qaytarish nishoni `0`
     * va matn ham shunga mos bo'ladi (reja bandi 3).
     */
    val before: String?,

    /**
     * Qaytarishda serverga ketadigan MUTLAQ son ([CountUndo.Point.Show]
     * dan): `before` yo'q bo'lsa `"0"`.
     */
    val target: String,
    val after: String,

    /**
     * Saqlashdan oldin qator progress MAXRAJIDA (`roster`) bormidi.
     * Qaytarishda maxrajni tozalash uchun: qatorni maxrajga aynan shu saqlash
     * qo'shgan bo'lsa, qaytarilgach u yerda qolmasligi kerak.
     */
    val wasInRoster: Boolean,

    /** Avto-yopish taymerining kaliti (`MainActivity.errorSeq` naqshi). */
    val seq: Int,
)

/**
 * T7 — chiziq shuncha turadi. Reja 10–15 soniya deydi; o'rtasi olindi:
 * omborchi saqlagach ekranga bir qaraydi va xatoni shu qarashda ko'radi,
 * lekin chiziq keyingi tovarga o'tgach yo'lda qolib ketmaydi.
 */
private const val UNDO_STRIP_MS = 12_000L


/**
 * Belgi RANGDAN tashqari SHAKL bilan ham farq qiladi: 4" ekranda, qo'lqopda
 * va yorug' omborda rang yolg'iz ishonchli emas.
 */
private fun markGlyph(m: Mark?): String = when (m) {
    Mark.COUNTED -> "✓"
    Mark.FAILED -> "✕"
    null -> "○"
}

private fun markColor(m: Mark?): Color = when (m) {
    Mark.COUNTED -> Palette.Success
    Mark.FAILED -> Palette.Danger
    null -> Palette.TextMuted
}

/** Kartochka chegarasi — qatorni ro'yxatda uzoqdan ajratadi. */
private fun markBorder(m: Mark?): Color = when (m) {
    Mark.COUNTED -> Palette.Success
    Mark.FAILED -> Palette.Danger
    null -> Palette.Border
}
