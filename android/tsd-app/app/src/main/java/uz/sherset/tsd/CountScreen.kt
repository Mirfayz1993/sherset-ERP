package uz.sherset.tsd

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
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

    override fun title(shell: Shell): String = shell.str(R.string.count_title)

    @Composable
    override fun Content() {
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
        }
        Spacer(Modifier.height(10.dp))

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
            SectionCard(modifier = Modifier.clickable { pick(it.optString("name"), assortmentId) }) {
                // NARX YO'Q: bu javob narx maydonini umuman qaytarmaydi.
                Text(it.optString("name"), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                InfoRow(
                    label = stringResource(R.string.count_system_qty),
                    value = it.optString("qty"),
                )
                Spacer(Modifier.height(10.dp))
                val typed = counts[assortmentId] ?: it.optString("qty")
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
                ) { save(c, assortmentId, typed) }
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
            SectionCard(
                modifier = Modifier.clickable { pick(b.optString("name"), boundId) },
                tint = Palette.SurfaceMuted,
            ) {
                // NARX YO'Q: `getCellProducts` select'i — id, name, code,
                // barcode, archived. Narx maydoni javobda umuman yo'q.
                Text(b.optString("name"), style = MaterialTheme.typography.titleMedium)
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
            Text(p.optString("name"), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            if (inCell != null) {
                InfoRow(label = stringResource(R.string.count_system_qty), value = inCell)
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
            ) { save(c, assortmentId, pickedQty) }
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

    private fun pick(name: String, assortmentId: String) {
        picked = JSONObject().put("id", assortmentId).put("name", name)
        // Ro'yxatdagi tovarda sukut — tizim qoldig'i (omborchi ko'pincha uni
        // tasdiqlaydi); yacheykada yo'q tovarda maydon BO'SH qoladi, chunki
        // «0» taklif qilish sanashning ma'nosini yo'qotardi.
        pickedQty = systemQty(assortmentId) ?: ""
    }

    private fun reset() {
        cell = null
        items = JSONArray()
        bound = JSONArray()
        counts.clear()
        picked = null
        pickedQty = ""
    }

    /**
     * Skan bosqichga qarab talqin qilinadi (`PlaceScreen` naqshi): avval
     * `/tsd/scan` kodni TASNIFLAYDI, keyin yacheyka yoki tovar yo'liga ketadi.
     */
    override fun onScan(code: String): Boolean {
        shell.io {
            val hit = shell.api.scan(code)
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
        val resp = shell.api.cellByBarcode(code)
        val cells = resp.optJSONArray("cells") ?: JSONArray()
        shell.main {
            when (cells.length()) {
                0 -> shell.error(R.string.cell_not_found)
                1 -> {
                    // T4 — yacheyka ochildi: omborchi yorliqni skanerlab,
                    // ekranga qaramasdan keyingi tovarga qo'l uzatadi.
                    Feedback.ok()
                    cell = cells.getJSONObject(0)
                    items = resp.optJSONArray("stock") ?: JSONArray()
                    // Qo'shimcha SO'ROV YO'Q — `products` shu javobning ichida.
                    bound = resp.optJSONArray("products") ?: JSONArray()
                    counts.clear()
                    picked = null
                    pickedQty = ""
                }
                // Ikki javonda bir xil yorliq — ilova TANLAMAYDI, aks holda
                // sanoq noto'g'ri yacheykaga yozilardi.
                else -> shell.error(R.string.cell_ambiguous)
            }
        }
    }

    private fun save(c: JSONObject, assortmentId: String, input: String) {
        // 🔴 T5 — ifoda SHU YERDA songa aylanadi va serverga aynan shu son
        // ketadi (`12*24` emas, `288`). Tugma allaqachon o'chirilgan bo'lsa ham
        // ikkinchi qavat: jim 0 yoki ifoda MATNI hech qachon yuborilmasin.
        val qty = QtyExpression.qty(input)
        if (qty == null) {
            shell.error(if (input.isBlank()) R.string.count_qty_hint else R.string.qty_invalid)
            return
        }
        shell.io {
            try {
                shell.api.setCellStock(c.optString("storeId"), c.optString("id"), assortmentId, qty)
                // Tarkib QAYTA O'QILADI: aks holda «Tizimda» ustuni eski sonni
                // ko'rsatib turardi va yangi sanalgan tovar ro'yxatda umuman
                // paydo bo'lmasdi.
                val fresh = shell.api.cellStock(c.optString("storeId"), c.optString("id"))
                shell.main {
                    items = fresh.optJSONArray("items") ?: items
                    counts.remove(assortmentId)
                    if (picked?.optString("id") == assortmentId) {
                        picked = null
                        pickedQty = ""
                    }
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
