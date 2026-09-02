import { buildReceiptModel } from '@/lib/pos/receipt-model';
import { cartToProformaReceipt } from '@/lib/pos/receipt-proforma-model';
import { buildReceiptHtml, buildReceiptText } from '@/lib/print-agent';
import { describe, expect, it } from 'vitest';

/**
 * CHEK RAQAMI VA RAQAM USTUNLARI (egasi, 2026-09-02 — jonli chek fotosi).
 *
 * Fotoda ikki nuqson ko'rindi (CHEK-112159, «Gofra ko'k 32x» qatori):
 *   1. «Soni» 200 qog'ozda «20» + «0» bo'lib IKKI QATORGA sindi — `td` dagi
 *      `overflow-wrap:anywhere` («Nomi» uchun kerak) raqam ustunlariga ham
 *      tegardi. Xuddi shu sabab № ustunida 10 ni «1»+«0» qilardi.
 *   2. Raqamning o'zi soatdan yasalardi (`CHEK-` + 11:21:59) — mijoz uchun
 *      ham, kassir uchun ham hech qanday ma'no bermasdi.
 *
 * Bu yerda ikkalasi ham qulflanadi. Raqamning SERVER tomoni (kassir bo'yicha
 * kunlik hisoblagich) `apps/api` dagi `retail-sale-daily-receipt-wiring` va
 * `daily-receipt-number` testlarida.
 */

const SALE = (over: Record<string, unknown> = {}) => ({
  name: 'ТРН-2026-00073',
  moment: '2026-09-02T05:30:00.000Z',
  sumMinor: '40000000',
  cashAmountMinor: '40000000',
  cardAmountMinor: '0',
  changeMinor: '0',
  description: null,
  agent: null,
  session: {
    cashier: { name: 'Otabek' },
    organization: { name: 'Sherset MChJ', legalTitle: null, phone: null },
  },
  positions: [
    {
      // 🔴 Fotodagi AYNAN o'sha qator: 200 dona × 2 000 = 400 000.
      quantity: '200',
      priceMinor: '200000',
      sumMinor: '40000000',
      product: { name: "Gofra ko'k 32x", uom: null },
    },
  ],
  payments: [],
  ...over,
});

describe('chek raqami — kunlik son hujjat nomidan USTUN', () => {
  it('`receiptNo` bo`lsa qog`ozda O`SHA chiqadi', () => {
    expect(buildReceiptModel(SALE({ receiptNo: 121 }) as never).docNumber).toBe('121');
  });

  it('`receiptNo` YO`Q bo`lsa hujjat nomiga qaytadi (eski cheklar)', () => {
    // Migratsiyadan oldingi cheklar `receipt_no` siz qoladi — qayta chop
    // etilganda chek RAQAMSIZ chiqib qolmasligi kerak.
    expect(buildReceiptModel(SALE() as never).docNumber).toBe('ТРН-2026-00073');
    expect(buildReceiptModel(SALE({ receiptNo: null }) as never).docNumber).toBe('ТРН-2026-00073');
  });

  it('raqam 0 bo`lmaydi, lekin bo`lsa ham nomga TUSHIB KETMAYDI', () => {
    // `receiptNo ?? name` yozilsa 0 to'g'ri o'tardi, `receiptNo || name` esa
    // uni jimgina hujjat nomiga almashtirardi — shart `!= null` bo'lishi shart.
    expect(buildReceiptModel(SALE({ receiptNo: 0 }) as never).docNumber).toBe('0');
  });

  it('ikkala renderer ham AYNI raqamni bosadi', () => {
    const sale = SALE({ receiptNo: 121 }) as never;
    expect(buildReceiptHtml(sale)).toContain('SAVDO CHEKI № 121');
    expect(buildReceiptText(sale)).toContain('SAVDO CHEKI № 121');
  });

  it('sotuvsiz chek raqami ham `name` orqali qog`ozga chiqadi', () => {
    const input = cartToProformaReceipt(
      [
        {
          productId: 'p-1',
          productName: "Gofra ko'k 32x",
          quantity: '200',
          priceMinor: 200_000n,
          priceStr: '2000',
        } as never,
      ],
      0,
      {
        number: '121',
        moment: '2026-09-02T05:30:00.000Z',
        cashierName: 'Otabek',
        organization: { name: 'Sherset MChJ' },
      },
    );
    expect(buildReceiptModel(input).docNumber).toBe('121');
  });
});

describe('raqam ustunlari qog`ozda SINMAYDI (fotodagi «20»+«0»)', () => {
  const html = buildReceiptHtml(SALE({ receiptNo: 121 }) as never);

  it('№ va «Soni» kataklari `nw` (nowrap) klassi bilan chiqadi', () => {
    expect(html).toContain('.nw{white-space:nowrap}');
    // Sarlavha + qator: to'rttasi ham (2 sarlavha, 2 qiymat) nowrap.
    expect(html.match(/class="c nw"/g)?.length).toBe(4);
  });

  it('«Nomi» ustuni esa O`RALADI — nowrap unga tegmaydi', () => {
    // 🔴 Bu shart: uzun tovar nomi nowrap bo'lsa jadval 72mm lentadan chiqib
    // ketardi va o'ng chetdagi «Summa» qirqilardi.
    expect(html).toContain('class="c nm"');
    expect(html).toContain('overflow-wrap:anywhere');
  });

  it('4 xonali miqdor bitta bo`lak bo`lib qoladi', () => {
    const wide = buildReceiptHtml(
      SALE({
        receiptNo: 1210,
        positions: [
          {
            quantity: '2000',
            priceMinor: '200000',
            sumMinor: '400000000',
            product: { name: 'Kabel', uom: null },
          },
        ],
      }) as never,
    );
    // `fmtQty` ru-RU guruh ajratgichi bilan chiqadi («2 000») — u ham
    // nowrap katak ichida, ya'ni probel joyidan ham sinmaydi.
    expect(wide).toMatch(/<td class="c nw">2\s000<\/td>/);
  });
});
