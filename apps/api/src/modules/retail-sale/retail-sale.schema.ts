import { z } from 'zod';
import { discountPercent } from '../shared/discount.js';

/**
 * RetailSale — POS receipt document.
 *
 * FSM: draft ──send-to-picking──► picking ──mark-ready──► ready ──post──► posted
 *        └──────────────────────── post ────────────────────────────────────┘
 *      har bosqichdan → cancelled (draft/picking/ready)
 *      (refund creates a new RetailSale in posted state immediately)
 *
 * `picking` / `ready` — omborchi zanjiri (2026-08-01 `d7ab3b1`):
 * `send-to-picking` omborlarga yig'ish varaqalarini yuboradi va hujjatni
 * `picking` ga o'tkazadi; har omborchi `mark-ready` bilan O'Z zonasi
 * topshiriqlarini yopadi, barcha zonalar tugagach hujjat `ready` bo'ladi.
 * Ular DB'ga (VarChar) yozilardi-yu, shu enum'da yo'q edi — natijada POS'ning
 * `?state=picking` / `?state=ready` ro'yxat so'rovlari 400 qaytarardi va
 * «Yig'ilmoqda» / «Tayyor» ro'yxatlari bo'sh qolardi (TZ 1-bo'lim §0.1).
 *
 * Invariants:
 *   - post requires session.state='open'
 *   - post: cashAmount + cardAmount >= sumMinor (change computed from overpayment)
 *   - cancel only from a pre-posted state (draft/picking/ready)
 *   - One open session per cashier enforced in CashierSessionService
 */

export const RetailSaleStateSchema = z.enum([
  'draft',
  'picking',
  'ready',
  'posted',
  'refunded',
  'cancelled',
]);
export type RetailSaleState = z.infer<typeof RetailSaleStateSchema>;

/**
 * F8 — POS'dan to'lash mumkin bo'lgan CustomerOrder holatlari.
 *
 * `draft` ATAYLAB yo'q: rezerv aynan `draft → confirmed` o'tishida tushadi
 * (`customer-order.service.applyReservationInvariant('hold-remaining')`), ya'ni
 * tasdiqlanmagan zakazni to'lash tovar hech qachon band qilinmagan holda uni
 * sotardi. POS'da tasdiqlash tugmasi bor (F7) — kassir avval tasdiqlaydi.
 *
 * `partially_shipped` ham yo'q: `applyPayment` uni qabul qiladi-yu, POS
 * qisman jo'natilgan zakazni butunlay sotmaydi — bu yuzani tor tutamiz.
 *
 * 🔴 Bu ro'yxat AYNI paytda ikki marta to'lash himoyasining predikati:
 * `post()` ichidagi `updateMany WHERE state IN (…)` shu qiymatlardan quriladi,
 * ya'ni `paid` zakaz predikatga tushmaydi va ikkinchi to'lov `count = 0` oladi.
 */
export const ORDER_PAYABLE_STATES = ['confirmed', 'awaiting_payment'] as const;
export type OrderPayableState = (typeof ORDER_PAYABLE_STATES)[number];

// --- Position ---

export const RetailSalePositionInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.string().regex(/^\d+(\.\d{1,6})?$/, 'quantity must be a positive decimal'),
  priceMinor: z.coerce.string().regex(/^\d+$/, 'priceMinor must be a non-negative integer'),
  discount: discountPercent.default('0'),
  /**
   * K4 — KASSIRNING mijoz bilan kelishgan bo'lak tarkibi: `['150','30']`.
   *
   * Bo'linadigan tovarda (kabel/sim/shlang) mijozga 180 m uzluksiz kerak
   * bo'lsa-yu eng uzuni 150 bo'lsa, kassir mijoz bilan kelishadi va tarkibni
   * BELGILAYDI (K-Q5: «tizim o'zi bo'lmaydi»). K3 uni faqat SAVATDA saqlardi,
   * serverga yubormasdi — omborchi kelishuvni ko'rmasdi (K3 hisobotining
   * «K4 uchun ASOSIY qarz» bandi).
   *
   * Miqdorga TA'SIR QILMAYDI: qator baribir 180 m bo'lib qoladi — egasining
   * 2026-08-25 dagi K-S3 qarori bo'yicha chekda BITTA qator, tarkib esa
   * izoh. Ixtiyoriy; oddiy tovarda umuman yuborilmaydi.
   */
  pieceLengths: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
});
export type RetailSalePositionInput = z.infer<typeof RetailSalePositionInputSchema>;

// --- Create draft ---

export const CreateRetailSaleSchema = z.object({
  sessionId: z.string().uuid(),
  agentId: z.string().uuid().nullish(),
  moment: z.coerce.date().optional(),
  description: z.string().max(4000).nullish(),
  // moysklad «Внешний код» — universal external-system sync key (the
  // RetailSale model already carries the column; this exposes it on the
  // create/update API used by POS/e-commerce integrations).
  externalCode: z.string().max(50).nullish(),
  /**
   * F8 — chek qaysi zakazni yopayotgani. Ustun/relation/indeks sxemada
   * ALLAQACHON bor edi (`schema.prisma` → `RetailSale.customerOrderId`), lekin
   * hech bir kod unga yozmasdi: ulanish nuqtasi tayyor, sim tortilmagan edi.
   * Ixtiyoriy — oddiy kassa cheki (zakazsiz) hech narsa yubormaydi.
   */
  customerOrderId: z.string().uuid().nullish(),
  positions: z.array(RetailSalePositionInputSchema).min(1, 'at least one position required'),
});
export type CreateRetailSaleInput = z.infer<typeof CreateRetailSaleSchema>;

// --- Update draft (patch positions) ---

export const UpdateRetailSaleSchema = z.object({
  agentId: z.string().uuid().nullish(),
  description: z.string().max(4000).nullish(),
  externalCode: z.string().max(50).nullish(),
  positions: z.array(RetailSalePositionInputSchema).min(1).optional(),
  // Optimistic-lock token (moysklad parity). REQUIRED on update (absent on
  // create): the edit/integration client echoes back the `version` it loaded
  // and the service runs the header write as WHERE version = ? … version += 1,
  // so a stale copy 409s instead of silently clobbering a concurrent edit.
  version: z.number().int().nonnegative(),
});
export type UpdateRetailSaleInput = z.infer<typeof UpdateRetailSaleSchema>;

// --- Post (take payment) ---

export const PostRetailSaleSchema = z
  .object({
    cashAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'cashAmountMinor must be a non-negative integer'),
    cardAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'cardAmountMinor must be a non-negative integer'),
    // Kassa TZ §6 — aralash to'lov. Bu ikkitasi `/sotuv` to'lov oynasidan
    // ALLAQACHON kelardi, lekin sxemada yo'q edi: Zod ularni jimgina tashlab
    // yuborardi va server «0 to'landi» deb 400 qaytarardi. Ya'ni terminal bilan
    // to'lagan yoki qarzga olgan mijozning cheki umuman rasmiylashmasdi.
    // `.default('0')` — eski chaqiruvchilar (moysklad-compat, testlar) buzilmasin.
    terminalAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'terminalAmountMinor must be a non-negative integer')
      .default('0'),
    debtAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'debtAmountMinor must be a non-negative integer')
      .default('0'),
    /**
     * Hisob raqamidan (bank o'tkazmasi, 2026-08-31). Pul yashiqqa TUSHMAYDI
     * va qaytim chegarasiga kirmaydi (`retail-tenders.ts` — ACCOUNT).
     * `.default('0')` — eski chaqiruvchilar buzilmasin.
     */
    accountAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'accountAmountMinor must be a non-negative integer')
      .default('0'),
    /**
     * A2 (2026-08-25) — mijozning AVANSIDAN qoplanadigan ulush (kassa
     * valyutasi, minor). `.default('0')` ⇒ avansdan foydalanmaydigan
     * chaqiruvchilar (moysklad-compat, eski POS, testlar) buzilmaydi.
     *
     * Server ikki qo'riqchi qo'yadi va IKKALASI ham 400 beradi (jimgina
     * qarzga aylantirish YO'Q — invariant 5):
     *  1. `prepay ≤ chek qoldig'i` — avans qaytim bermaydi (`retail-tenders.ts`);
     *  2. `prepay ≤ −balansOldin` — mavjud avansdan ortiq sarflanmaydi
     *     (`post()`, balans `FOR UPDATE` bilan qulflangan holda).
     */
    prepayAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'prepayAmountMinor must be a non-negative integer')
      .default('0'),
    /** Qarzga sotishda MAJBURIY — qarz kimning balansiga yozilishi (TZ §7.1). */
    agentId: z.string().uuid().optional(),
    /**
     * Dollar naqd — mijoz bergan summa SENTDA (MK31 · TZ §6.2).
     * `.default('0')` — dollarsiz kassa uchun hech narsa o'zgarmaydi.
     */
    cashUsdAmountMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'cashUsdAmountMinor must be a non-negative integer')
      .default('0'),
    /**
     * Qo'llanilgan kurs — KANONIK ×10^8 (DB-01, Faza 16; `Currency.rateValue`
     * va `DebtPayment.exchangeRate` bilan bir xil): 12 450,27 so'm →
     * '1245027000000'. Chekka MUZLATILADI.
     */
    usdRateMinor: z.coerce.string().regex(/^\d+$/, 'usdRateMinor must be an integer').optional(),
    /** Client-side sanity check — server revalidates against DB sum */
    expectedSumMinor: z.coerce
      .string()
      .regex(/^\d+$/, 'expectedSumMinor must be a non-negative integer'),
  })
  // TZ §6.2: kurs topilmasa to'lov BLOKLANADI — sentni tiyin deb jim qabul
  // qilish chekni haqiqiy summaning ~12 000 dan biriga yopardi.
  .refine((v) => BigInt(v.cashUsdAmountMinor) === 0n || v.usdRateMinor != null, {
    message: 'Dollar to‘lovida kurs majburiy',
    path: ['usdRateMinor'],
  })
  // DB-01 (Faza 16): eski ×10^4 masshtabdagi klient qiymati kanonik deb
  // o'qilsa 10 000× xato bo'lardi. Real USD kursi 10 so'mdan (10^9) ming
  // barobar yuqori, stale qiymat esa doim past — past qiymat JIM o'tmaydi.
  // (`debt.schema.ts` dagi bir xil qo'riqchi bilan bitta qoida.)
  .refine((v) => v.usdRateMinor == null || BigInt(v.usdRateMinor) >= 1_000_000_000n, {
    message: 'Kurs eski (×10⁴) masshtabda — sahifani yangilang (kanonik ×10⁸)',
    path: ['usdRateMinor'],
  });
export type PostRetailSaleInput = z.infer<typeof PostRetailSaleSchema>;

// --- Refund ---

export const RefundRetailSaleSchema = z.object({
  /** Positions to refund. Must be a subset of original positions. */
  positions: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce
          .string()
          .regex(/^\d+(\.\d{1,6})?$/, 'quantity must be a positive decimal'),
        /**
         * SALES-01: IGNORED by the server. The refund is priced from the
         * original receipt (`priceRefundFromOriginal`) — trusting these made
         * the payout cap self-referential. Optional so a client need not send
         * them; kept accepted so existing callers do not break.
         */
        priceMinor: z.coerce
          .string()
          .regex(/^\d+$/, 'priceMinor must be a non-negative integer')
          .optional(),
        discount: discountPercent.optional(),
      }),
    )
    .min(1, 'at least one position required for refund'),
  cashAmountMinor: z.coerce.string().regex(/^\d+$/).default('0'),
  cardAmountMinor: z.coerce.string().regex(/^\d+$/).default('0'),
  /**
   * Dollar naqd qaytarish — **SENTDA** (2026-08-17, egasi qarori).
   *
   * 🔴 Nega alohida maydon: ilgari dollarda to'langan chek to'liq SO'M bilan
   * qaytarilardi (`CASH_USD` «naqd-o'xshash» sanalgani uchun) va prodda
   * o'lchangan yo'qotish berdi — so'm kassasi 1 200 000 ga kamayib, mijozning
   * $100 yashiqda qolib ketdi. Endi dollar dollarda qaytadi va smenaning
   * dollar hisobi (`returnsUsdMinor`) mirror chekning `CASH_USD` qatoridan
   * o'qiladi. So'm maydonlariga QO'SHILMAYDI — birligi boshqa.
   */
  cashUsdReturnMinor: z.coerce.string().regex(/^\d+$/).default('0'),
  /**
   * SALES-04 — qarzga sotilgan chek qaytarilganda mijoz balansidan
   * o'chiriladigan qarz ulushi. **Berilmasa** server o'zi hisoblaydi:
   * chekning qarz ulushi qaytarilgan qiymatga proporsional yopiladi.
   * Bu ataylab shunday — eski klientlar (POS) hech narsa yubormaydi, va
   * «qarzga olgan mijoz tovarni qaytardi, qarzi qolaveradi» holati
   * o'z-o'zidan yopiladi. Berilgan qiymat esa cheklanadi
   * (`computeRefundSettlementCaps`), oshirib bo'lmaydi.
   */
  debtReturnMinor: z.coerce
    .string()
    .regex(/^\d+$/, 'debtReturnMinor must be a non-negative integer')
    .optional(),
  /**
   * A2 — avansdan to'langan chek qaytarilganda mijozning BALANSIGA qaytariladigan
   * ulush. **Berilmasa** server o'zi hisoblaydi (`debtReturnMinor` bilan AYNAN
   * bir xil sabab: POS hech narsa yubormaydi, «tovar qaytdi-yu avans sarflangan
   * bo'lib qolaverdi» esa aynan tuzatilayotgan yo'qotish).
   *
   * 🔴 Pul KASSADAN CHIQMAYDI — avans naqd bo'lib qaytmaydi, u mijozning
   * balansiga qaytadi va u yerdan yo keyingi chekka ishlatiladi, yo A3 ning
   * RKO hujjati bilan naqd olinadi. Aks holda vozvrat avansni hujjatsiz
   * naqdga aylantirish yo'li bo'lardi.
   */
  prepayReturnMinor: z.coerce
    .string()
    .regex(/^\d+$/, 'prepayReturnMinor must be a non-negative integer')
    .optional(),
  /**
   * V3 (egasi, 2026-09-02): «pul qaytarganda naqd/karta tanlash imkoni
   * bo'lsin». Kassir kanalni O'ZI tanlaganini bildiradi — server KANAL
   * cap'ini (`cashMaxMinor`) tekshirmaydi, ya'ni karta bilan to'langan chek
   * naqd qaytarilishi mumkin.
   *
   * 🔴 JAMI cap o'z kuchida: `naqd + karta ≤ kassa olgan pul`. Qarz/avans
   * ulushi hamon naqdga aylanmaydi.
   *
   * Sukut `false` — bayroqni faqat POS ning kanal tanlagichi yuboradi;
   * boshqa chaqiruvchilar (moysklad-compat, integratsiyalar, eski POS)
   * uchun P5/R1 himoyasi o'zgarmaydi.
   */
  channelOverride: z.boolean().optional().default(false),
  description: z.string().max(4000).nullish(),
});
export type RefundRetailSaleInput = z.infer<typeof RefundRetailSaleSchema>;

/**
 * TO'LANGAN chekni tahrirlash (2026-08-16, egasi: «cheklar bo'limidan chekni
 * tahrirlash bo'lsin»).
 *
 * 1-bosqich QAMROVI — mijoz va to'lov taqsimoti. Tovar tarkibi ATAYLAB yo'q:
 * u tan narx (COGS) hisobini talab qiladi (miqdor kamaysa `consumeRefundCost`,
 * oshsa yangi tan narx) va uni shoshib yozish marja ma'lumotini JIMGINA
 * buzadi. Servis tovar o'zgarishini aniq xabar bilan rad etadi.
 */
export const EditRetailSaleSchema = z.object({
  /** Optimistik qulf — chek o'qilgandan keyin o'zgargan bo'lsa 409. */
  version: z.coerce.number().int().nonnegative(),
  /** Yangi mijoz. `null` — mijozni olib tashlash (faqat qarzsiz chekda). */
  agentId: z.string().uuid().nullable().optional(),
  /** Naqd/karta bilan to'langan qism (tiyin, satr). */
  paidMinor: z.coerce.string().regex(/^\d+$/, 'paidMinor butun manfiymas son bo`lishi kerak'),
  /** Qarzga yoziladigan qism (tiyin, satr). */
  debtMinor: z.coerce.string().regex(/^\d+$/, 'debtMinor butun manfiymas son bo`lishi kerak'),
});
export type EditRetailSaleInput = z.infer<typeof EditRetailSaleSchema>;

/**
 * CHEK IZOHI (2026-08-19, egasi: «kassada har bir chekka izoh ham qo'shish»).
 *
 * ATAYLAB alohida sxema va alohida yo'l: `UpdateRetailSaleSchema` faqat
 * `draft` chekka ishlaydi (pul olingan va ombor yechilgan chekni qayta
 * yozishdan saqlaydigan qulf), izoh esa summa/ombor/holatga UMUMAN tegmaydigan
 * metama'lumot. Shuning uchun u o'sha qulfni yumshatish orqali emas, faqat
 * SHU maydonni yozadigan tor yo'l bilan qo'yiladi.
 *
 * `null` — izohni butunlay olib tashlash (bo'sh satr ham `null` ga tushadi,
 * pastdagi `transform`): chekda «Izoh:» qatori bo'sh turmasin.
 */
export const UpdateSaleCommentSchema = z.object({
  /** Optimistik qulf — ikki kishi bir vaqtda yozsa ikkinchisi 409 oladi. */
  version: z.coerce.number().int().nonnegative(),
  description: z
    .string()
    .max(4000, 'Izoh 4000 belgidan oshmasligi kerak')
    .nullable()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    }),
});
export type UpdateSaleCommentInput = z.infer<typeof UpdateSaleCommentSchema>;

// --- G2: kontrol tahriri ---

/**
 * G2 — kontrol tahriri (`PATCH /retail-sales/:id/control-edit`).
 *
 * Kontrolchi CHEKDA QOLADIGAN qatorlarni yuboradi: ro'yxatda yo'q qator
 * O'CHIRILADI, `quantity` esa yangi son (faqat kamaytirish — qoida sof
 * modulda, `retail-control.ts`). Narx/chegirma tahrir qilinMAYDI: kontrol
 * tarkibni haqiqatga moslaydi, narx siyosati kassir/menejer ishi.
 */
export const ControlQueueFilterSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ControlQueueFilterInput = z.infer<typeof ControlQueueFilterSchema>;

export const ControlEditSchema = z.object({
  /** Optimistik qulf — kassir yoki boshqa kontrolchi bilan poyga 409 oladi. */
  version: z.coerce.number().int().nonnegative(),
  positions: z
    .array(
      z.object({
        /** Mavjud `RetailSalePosition.id` — yangi qator qo'shilmaydi. */
        id: z.string().uuid(),
        quantity: z.string().regex(/^\d+(\.\d{1,6})?$/, "Miqdor musbat o'nlik son bo'lishi kerak"),
      }),
    )
    .max(500),
});
export type ControlEditInput = z.infer<typeof ControlEditSchema>;

// --- Z-report query ---

/**
 * GET /retail-sales/z-report?sessionId=… — controller query'ni validatsiyasiz
 * uzatardi: noto'g'ri/berilmagan uuid Prisma'gacha yetib P2023 bilan 500
 * qaytarardi. Endi servis kirishda shu sxema bilan tekshiradi — ZodError'ni
 * global filtr 400 qiladi.
 */
export const ZReportQuerySchema = z.object({
  sessionId: z.string().uuid(),
});
export type ZReportQueryInput = z.infer<typeof ZReportQuerySchema>;

// --- List filter ---

export const RetailSaleFilterSchema = z.object({
  sessionId: z.string().uuid().optional(),
  // F9 — mijoz kartasidagi «oxirgi xaridlar» bloki ANIQ kontragent bo'yicha
  // o'qiydi. `search` (agent.name contains) buning o'rnini bosolmaydi: bir
  // xil ismli ikki mijoz aralashib ketardi.
  agentId: z.string().uuid().optional(),
  // V1 — POS Vozvrat oynasi: «shu tovar qatnashgan barcha cheklar». Mijozsiz
  // (naqd) chekni faqat tovar orqali topish mumkin; `search` (name/agent.name)
  // buning o'rnini bosolmaydi. Indeks tayyor: RetailSalePosition
  // @@index([accountId, productId]).
  productId: z.string().uuid().optional(),
  state: RetailSaleStateSchema.optional(),
  // G2 — omborchi paneli. `/omborchi` sahifasi `assigneeId` ni 2026-08 dan beri
  // YUBORARDI, lekin sxema uni jimgina tashlab yuborardi (z.object unknown
  // kalitlarni kesadi) — ya'ni har omborchi HAMMA cheklarni ko'rardi. Endi
  // filtr haqiqiy: chekning yig'ish topshirig'i (RestockTask type=picking)
  // shu xodimga biriktirilgan bo'lishi kerak.
  assigneeId: z.string().uuid().optional(),
  // `true` bo'lsa faqat OCHIQ (done/cancelled emas) topshiriqli cheklar —
  // omborchining «yig'ilishi kerak» ro'yxati. U «Tayyor» bosgach chek uning
  // ro'yxatidan chiqadi (kontrol navbatiga o'tadi), «ishim tugadi» darhol
  // ko'rinadi.
  assigneeOpen: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
  sortBy: z.enum(['moment', 'name', 'sumMinor']).default('moment'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type RetailSaleFilterInput = z.infer<typeof RetailSaleFilterSchema>;
