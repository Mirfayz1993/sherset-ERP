/**
 * SOTUVSIZ CHEK (proforma, 2026-08-16 — egasi so'rovi): savatdan bevosita
 * `ReceiptSaleInput` yig'adi — hech qanday sotuv/hujjat yaratilmaydi, serverga
 * hech nima yozilmaydi. Chek tovar cheki bilan AYNI shablonda chiqadi (egasi
 * qarori: farqsiz; firibgarlik xavfi ochiq tushuntirilgan va qabul qilingan).
 *
 * «Chekni o'zgartirish» oqimi bu modulda EMAS — chop etilgach sahifa savatni
 * Qoralama chipiga oladi; chipni ochib o'zgartirib qayta chiqariladi.
 *
 * Hisob-qoidalar (haqiqiy sotuv qatorlari bilan bir xil ko'rinish uchun):
 *  · qator yalpisi = narx × miqdor (half-up, floatsiz — `mulQtyMinor`);
 *  · savat-darajali `discountPct` HAR QATOR summasiga qo'llanadi (half-up);
 *  · `basePriceMinor` o'tadi — chekdagi «Chegirma» qatori (qo'lda
 *    arzonlashtirish + savat-%) `buildReceiptModel` da o'zi hisoblanadi;
 *  · «to'lov» naqd sifatida jami bilan to'ldiriladi (chek haqiqiy naqd
 *    sotuv chekidan farqsiz ko'rinsin — egasi qarori).
 */

import type { CartLine } from '@/app/(app)/sotuv/_components/pos-types';
import type { ReceiptSaleInput } from './receipt-model';
import { mulQtyMinor } from './receipt-model';

export interface ProformaContext {
  /**
   * Chek «raqami» — kassirning shu kundagi ketma-ket soni (2026-09-02, egasi),
   * `POST /retail-sales/receipt-number` dan. So'rov yiqilsa chaqiruvchi eski
   * vaqt-raqamini (`CHEK-112159`) zaxira sifatida beradi.
   *
   * Bu yerda `name` ga yoziladi — `buildReceiptModel` raqamsiz chekda aynan
   * `name` ni bosadi, ya'ni qog'ozda «SAVDO CHEKI № 121» chiqadi.
   */
  number: string;
  /** ISO moment — chekdagi sana. */
  moment: string;
  cashierName: string;
  organization: { name: string; legalTitle?: string | null; phone?: string | null };
  /**
   * Savatga yozilgan izoh (2026-08-19, egasi: «har bir chekka izoh»).
   * Bo'sh/berilmagan bo'lsa `null` — chekda «Izoh:» qatori umuman chizilmaydi.
   */
  comment?: string | null;
}

/** Savat + savat-chegirmasi(%) → chek-kirishi. Sof funksiya, DB/tarmoq yo'q. */
export function cartToProformaReceipt(
  cart: CartLine[],
  discountPct: number,
  ctx: ProformaContext,
): ReceiptSaleInput {
  const pct = BigInt(Math.max(0, Math.min(100, Math.round(discountPct))));
  const positions = cart.map((l) => {
    const gross = mulQtyMinor(l.priceMinor, l.quantity);
    const sum = pct > 0n ? (gross * (100n - pct) + 50n) / 100n : gross;
    return {
      quantity: l.quantity,
      priceMinor: l.priceMinor.toString(),
      sumMinor: sum.toString(),
      basePriceMinor: l.basePriceMinor != null ? l.basePriceMinor.toString() : null,
      product: { name: l.productName },
    };
  });
  const totalMinor = positions.reduce((acc, p) => acc + BigInt(p.sumMinor), 0n);

  return {
    name: ctx.number,
    moment: ctx.moment,
    sumMinor: totalMinor.toString(),
    payments: [],
    // Egasi qarori: chek to'liq naqd sotuv chekidek ko'rinadi.
    cashAmountMinor: totalMinor.toString(),
    cardAmountMinor: '0',
    changeMinor: '0',
    description: ctx.comment?.trim() ? ctx.comment.trim() : null,
    agent: null,
    session: {
      cashier: { name: ctx.cashierName },
      organization: {
        name: ctx.organization.name,
        legalTitle: ctx.organization.legalTitle ?? null,
        phone: ctx.organization.phone ?? null,
      },
    },
    positions,
  };
}
