import uz from '@/messages/uz.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RECEIPT_LABELS,
  type ReceiptSaleInput,
  buildReceiptModel,
  fmtQty,
  fmtReceiptDate,
  fmtSom,
  wrapText,
} from './receipt-model';

/**
 * KASSA CHEKI MODELI — egasining namunasi (`chek.png`, 2026-08-12) shartnomasi.
 *
 * Bu yerda qulflanadigan narsa — chekning MA'NOSI: qaysi maydon qayerdan
 * keladi, qaysi qator DOIM chiqadi va yorliqlar i18n bilan bir xilmi.
 * Ko'rinishning o'zi (jadval chiziqlari, shrift) renderer testlarida.
 */

const SALE = (over: Partial<ReceiptSaleInput> = {}): ReceiptSaleInput => ({
  name: '00025',
  moment: '2026-07-22T09:15:00.000Z',
  // 310 250 + 20 000 = 330 250 so'm
  sumMinor: '33025000',
  payments: [],
  cashAmountMinor: '0',
  cardAmountMinor: '0',
  changeMinor: '0',
  description: null,
  agent: { name: '1покупатель', legalTitle: null },
  session: {
    cashier: { name: 'Admin User' },
    organization: {
      name: 'Sherset elektro tovarlar',
      legalTitle: 'MCHJ Sherset',
      phone: '+998908769900',
    },
  },
  positions: [
    {
      quantity: '36.5',
      priceMinor: '850000',
      sumMinor: '31025000',
      product: { name: "Led shlang lupa 3 ko'z oq", uom: 'm' },
    },
    {
      quantity: '2',
      priceMinor: '1000000',
      sumMinor: '2000000',
      product: { name: "Evert led shteker 3 ko'z lupa", uom: 'dona' },
    },
  ],
  ...over,
});

describe('yorliqlar i18n bilan bir xil (ikki manba ajralib ketmasin)', () => {
  const print = (uz as unknown as { pages: { print: Record<string, string> } }).pages.print;
  const PAIRS: Array<[keyof typeof RECEIPT_LABELS, string]> = [
    ['titleSale', 'chek_title_sale'],
    ['titleReturn', 'chek_title_return'],
    ['titleDebt', 'chek_title_debt'],
    ['date', 'date'],
    ['seller', 'chek_seller'],
    ['buyer', 'chek_buyer'],
    ['phone', 'chek_phone'],
    ['comment', 'chek_comment'],
    ['colName', 'chek_col_name'],
    ['colUom', 'chek_col_uom'],
    ['colQty', 'chek_col_qty'],
    ['colPrice', 'chek_col_price'],
    ['colSum', 'chek_col_sum'],
    ['subtotal', 'chek_subtotal'],
    ['discount', 'chek_discount'],
    ['debtAfter', 'chek_debt_after'],
    ['total', 'chek_total'],
    ['itemsCount', 'chek_items_count'],
    ['itemsUnit', 'chek_items_unit'],
    ['inWords', 'chek_in_words'],
    ['footerLegal', 'chek_footer_legal'],
    ['footerThanks', 'chek_footer_thanks'],
  ];

  it.each(PAIRS)('%s = uz.json → pages.print.%s', (labelKey, msgKey) => {
    expect(print[msgKey], `uz.json da ${msgKey} yo'q`).toBeDefined();
    expect(RECEIPT_LABELS[labelKey]).toBe(print[msgKey]);
  });
});

describe('buildReceiptModel — namunadagi maydonlar', () => {
  it('shapka: DO`KON nomi (yuridik nom EMAS) va telefon', () => {
    const m = buildReceiptModel(SALE());
    // 🔴 Mijoz qo'lidagi qog'ozda «MCHJ …» emas, do'kon nomi turishi kerak.
    expect(m.orgName).toBe('Sherset elektro tovarlar');
    expect(m.orgPhone).toBe('+998908769900');
    expect(m.title).toBe('SAVDO CHEKI');
    expect(m.docNumber).toBe('00025');
  });

  it('sana — FAQAT kun (namunada soat yo`q)', () => {
    expect(buildReceiptModel(SALE()).dateLabel).toBe('22.07.2026');
  });

  it('sotuvchi = kassir, xaridor = kontragent', () => {
    const m = buildReceiptModel(SALE());
    expect(m.sellerName).toBe('Admin User');
    expect(m.buyerName).toBe('1покупатель');
  });

  it('kontragentsiz chekda xaridor bo`sh emas, tire', () => {
    expect(buildReceiptModel(SALE({ agent: null })).buyerName).toBe('—');
  });

  // 2026-08-31 (egasi): chekda kontragent raqami chiqsin — «Telefon:» qatori.
  it('kontragent telefoni: bor bo`lsa modelda, yo`q/bo`sh bo`lsa null', () => {
    const withPhone = SALE({
      agent: { name: '1покупатель', legalTitle: null, phone: '+998901234567' },
    });
    expect(buildReceiptModel(withPhone).buyerPhone).toBe('+998901234567');
    expect(buildReceiptModel(SALE()).buyerPhone).toBeNull();
    expect(buildReceiptModel(SALE({ agent: null })).buyerPhone).toBeNull();
    const blank = SALE({ agent: { name: 'x', legalTitle: null, phone: '   ' } });
    expect(buildReceiptModel(blank).buyerPhone).toBeNull();
  });

  it('qatorlar: №, nom, o`lchov birligi, soni, narxi, summa', () => {
    const [first, second] = buildReceiptModel(SALE()).rows;
    expect(first).toEqual({
      index: 1,
      name: "Led shlang lupa 3 ko'z oq",
      uom: 'm',
      qty: '36,5',
      price: '8 500',
      sum: '310 250',
    });
    expect(second?.index).toBe(2);
    expect(second?.uom).toBe('dona');
  });

  it('o`lchov birligi yo`q tovarda tire (ustun bo`sh qolmaydi)', () => {
    const m = buildReceiptModel(
      SALE({
        positions: [
          {
            quantity: '1',
            priceMinor: '100',
            sumMinor: '100',
            product: { name: 'Nomsiz birlik' },
          },
        ],
      }),
    );
    expect(m.rows[0]?.uom).toBe('—');
  });

  it('jamilar: yalpi · chegirma · jami (uchalasi ham DOIM)', () => {
    const m = buildReceiptModel(SALE());
    expect(m.subtotal).toBe('330 250');
    expect(m.discount).toBe('0');
    expect(m.total).toBe('330 250');
  });

  it('chegirma = yalpi − hujjat summasi', () => {
    // Hujjat summasi 300 000 so'm ⇒ chegirma 30 250 so'm.
    const m = buildReceiptModel(SALE({ sumMinor: '30000000' }));
    expect(m.subtotal).toBe('330 250');
    expect(m.discount).toBe('30 250');
    expect(m.total).toBe('300 000');
  });

  it('🔴 chegirma MANFIY bo`lmaydi (jami yalpidan katta bo`lsa 0)', () => {
    // Aks holda chekda «Chegirma: -5 000» chiqib, mijozni chalg'itardi.
    const m = buildReceiptModel(SALE({ sumMinor: '40000000' }));
    expect(m.discount).toBe('0');
  });

  it('nomenklatura soni va summa SO`Z bilan', () => {
    const m = buildReceiptModel(SALE());
    expect(m.itemsCount).toBe(2);
    expect(m.inWords.toLowerCase()).toContain('ming');
    expect(m.inWords.toLowerCase()).toContain('tiyin');
  });

  it('to`lov qatorlari modelda bor (namunadan tashqari, ataylab)', () => {
    const m = buildReceiptModel(
      SALE({
        payments: [
          {
            method: 'CASH_UZS',
            amountMinor: '33025000',
            currency: 'UZS',
            rateMinor: null,
            amountBaseMinor: '33025000',
          },
        ],
        changeMinor: '500000',
      }),
    );
    const labels = m.payments.map((p) => p.label);
    expect(labels).toContain('Naqd');
    // Qaytim — chekdagi eng nizoli raqam, u YO'QOLMASLIGI shart.
    expect(labels).toContain('Qaytim');
  });

  it('P05 (2026-08-13) — debtAfterMinor modeldan o`tadi (null = o`lchanmagan)', () => {
    // Egasi: kontragent tanlangan chek oxirida «Sizning qarzingiz» qatori.
    // Qiymat serverniki (`/debts/pos/summary` → payableMinor, post'dan keyin);
    // so'rov yiqilsa null — «o'lchanmagan» ≠ 0 (xotira `pos-customer-card-one-number`).
    const m = buildReceiptModel({ ...SALE(), debtAfterMinor: 125000000n });
    expect(m.debtAfterMinor).toBe(125000000n);
    const m2 = buildReceiptModel(SALE());
    expect(m2.debtAfterMinor).toBeNull();
  });

  it('🔴 dollar qatorida kurs ×10^8 shkalasida formatlanadi', () => {
    // `fmtSom` bilan formatlansa 12 450,27 o'rniga 12 450 270 000 chiqardi.
    const m = buildReceiptModel(
      SALE({
        payments: [
          {
            method: 'CASH_USD',
            amountMinor: '1250',
            currency: 'USD',
            rateMinor: '1245027000000',
            amountBaseMinor: '15562837',
          },
        ],
      }),
    );
    const usd = m.payments.find((p) => p.note);
    expect(usd?.value).toBe('$12.50');
    expect(usd?.note?.left).toBe('1USD = 12450.27');
  });
});

/**
 * 2026-08-16 (egasi): «10 000 lik tovarni 9 000 qilsam, chekda chegirma
 * 1 000 chiqsin». Chegirma endi qatorning MUZLATILGAN sotilish narxi
 * (`basePriceMinor`) bilan haqiqiy summasi farqidan hisoblanadi:
 *   Umumiy summa = Σ max(base×qty, sum) · Chegirma = Umumiy − Jami.
 * Eski (faqat gross−total) hisob POS'da doim 0 chiqarardi, chunki
 * arzonlashtirish qator summasining O'ZIDA yashiringan edi.
 */
describe('chegirma — basePriceMinor dan (2026-08-16, egasi)', () => {
  it('1 × 10 000 → 9 000 qilingan: chegirma 1 000, umumiy 10 000, jami 9 000', () => {
    const m = buildReceiptModel(
      SALE({
        sumMinor: '900000',
        positions: [
          {
            quantity: '1',
            priceMinor: '900000',
            sumMinor: '900000',
            basePriceMinor: '1000000',
            product: { name: 'Test tovar', uom: 'dona' },
          },
        ],
      }),
    );
    expect(m.subtotal).toBe('10 000');
    expect(m.discount).toBe('1 000');
    expect(m.total).toBe('9 000');
  });

  it('narx OSHIRILGAN qatorda chegirma 0 (manfiy chegirma yo`q), umumiy = summa', () => {
    const m = buildReceiptModel(
      SALE({
        sumMinor: '1200000',
        positions: [
          {
            quantity: '1',
            priceMinor: '1200000',
            sumMinor: '1200000',
            basePriceMinor: '1000000',
            product: { name: 'Qimmatlashgan', uom: 'dona' },
          },
        ],
      }),
    );
    expect(m.discount).toBe('0');
    expect(m.subtotal).toBe('12 000');
    expect(m.total).toBe('12 000');
  });

  it('kasr miqdor: 2.5 × (1 000 → 900) — chegirma 250', () => {
    const m = buildReceiptModel(
      SALE({
        sumMinor: '225000',
        positions: [
          {
            quantity: '2.5',
            priceMinor: '90000',
            sumMinor: '225000',
            basePriceMinor: '100000',
            product: { name: 'Kabel', uom: 'm' },
          },
        ],
      }),
    );
    expect(m.subtotal).toBe('2 500');
    expect(m.discount).toBe('250');
  });

  it('basePriceMinor YO`Q (eski chaqiruvchi) — eski xulq: umumiy = Σ summa, chegirma = gross − total', () => {
    const m = buildReceiptModel(
      SALE({
        sumMinor: '900000',
        positions: [
          {
            quantity: '1',
            priceMinor: '900000',
            sumMinor: '900000',
            product: { name: 'Eski qator', uom: 'dona' },
          },
        ],
      }),
    );
    expect(m.subtotal).toBe('9 000');
    expect(m.discount).toBe('0');
  });

  it('aralash: bir qator chegirmali, bir qator base`siz — faqat birinchisi qo`shiladi', () => {
    const m = buildReceiptModel(
      SALE({
        sumMinor: '1400000',
        positions: [
          {
            quantity: '1',
            priceMinor: '900000',
            sumMinor: '900000',
            basePriceMinor: '1000000',
            product: { name: 'Chegirmali', uom: 'dona' },
          },
          {
            quantity: '1',
            priceMinor: '500000',
            sumMinor: '500000',
            product: { name: 'Basesiz', uom: 'dona' },
          },
        ],
      }),
    );
    // Umumiy = 10 000 + 5 000; chegirma = 15 000 − 14 000 = 1 000.
    expect(m.subtotal).toBe('15 000');
    expect(m.discount).toBe('1 000');
  });
});

describe('formatlash yordamchilari', () => {
  it('fmtSom — mingliklar bo`sh joy bilan, butun bo`lsa kasrsiz', () => {
    expect(fmtSom('33025000')).toBe('330 250');
    expect(fmtSom('100')).toBe('1');
    expect(fmtSom('150')).toBe('1,50');
    expect(fmtSom(-500000n)).toBe('-5 000');
  });

  it('fmtQty — kasr vergul bilan', () => {
    expect(fmtQty('36.5')).toBe('36,5');
    expect(fmtQty('2')).toBe('2');
  });

  it('fmtReceiptDate — buzuq sanada tire (chek yiqilmasin)', () => {
    expect(fmtReceiptDate('buzuq')).toBe('—');
  });

  it('wrapText — lenta enidan oshmaydi', () => {
    const lines = wrapText('Ushbu chek to`lovni tasdiqlovchi hujjat hisoblanadi.', 32);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(32);
  });

  it('wrapText — 32 belgidan uzun SO`Z ham qirqilmaydi, bo`linadi', () => {
    const lines = wrapText('A'.repeat(70), 32);
    expect(lines.join('')).toBe('A'.repeat(70));
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(32);
  });
});

/**
 * S2 (kassa vaqti) — QOG'OZDAGI SANA QURILMAGA BOG'LIQ EMAS.
 *
 * Mijozning qo'lida qoladigan xato eng qimmati: chek chiqib ketgach uni
 * qaytarib olib bo'lmaydi. Shu yerda ikkita bog'liqlik qulflanadi:
 *   1. qurilmaning SOATI — sana faqat server `moment`idan chizilishi kerak;
 *   2. qurilmaning MINTAQASI — kalendar kun doim `Asia/Tashkent` bo'yicha.
 */
describe('S2 — chek sanasi: qurilma soati ham, mintaqasi ham so`ralmaydi', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('qurilma soati BOSHQA KUNDA (hatto boshqa yilda) — sana server `moment`ida qoladi', () => {
    vi.useFakeTimers();
    // Kassa mashinasi «2019-yil 1-yanvar» deb o'ylayapti (BIOS batareyasi o'lgan
    // mashinaning odatiy holati) — chekdagi sana bundan mutlaqo mustaqil.
    vi.setSystemTime(new Date('2019-01-01T00:00:00.000Z'));

    expect(buildReceiptModel(SALE()).dateLabel).toBe('22.07.2026');
    expect(fmtReceiptDate('2026-07-22T09:15:00.000Z')).toBe('22.07.2026');
    expect(buildReceiptModel(SALE()).dateLabel).not.toContain('2019');
  });

  it('server `moment`i yarim tundan keyin: UTC hali 22-si, Toshkent allaqachon 23-si', () => {
    // 19:30 UTC = ertasi kun 00:30 Toshkentda. Kassa uchun kun `Asia/Tashkent`
    // bo'yicha — API hisobotlari ham aynan shu kalendar kunni ishlatadi.
    expect(fmtReceiptDate('2026-07-22T19:30:00.000Z')).toBe('23.07.2026');
  });

  it('qurilma MINTAQASI adashgan bo`lsa ham qog`ozda Toshkent kuni chiqadi', () => {
    // Mashinaning TZ'i vaqtincha okean ortiga ko'chiriladi: `timeZone` qotirilgan
    // bo'lmasa shu qatorda `22.07.2026` chiqadi — ya'ni MIJOZGA XATO KUN.
    try {
      vi.stubEnv('TZ', 'Pacific/Honolulu');
      expect(fmtReceiptDate('2026-07-22T20:00:00.000Z')).toBe('23.07.2026');
    } finally {
      // Mutatsiya shu test faylining qolganiga oqib ketmasin.
      vi.unstubAllEnvs();
    }
  });
});
