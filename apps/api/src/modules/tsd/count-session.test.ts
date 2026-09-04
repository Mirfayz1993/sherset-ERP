import { describe, expect, it } from 'vitest';
import {
  COUNT_SESSION_LINE_SELECT,
  COUNT_SESSION_SELECT,
  COUNT_SESSION_STATE,
  buildCountSessionLine,
  summarizeCountSessionLines,
} from './count-session.js';

/**
 * Sanash sessiyasining SOF yadrosi (N-reja §5-N2).
 *
 * Bu yerda qulflanadigan ikki shartnoma:
 *   1. 🔴 **narx YO'Q** — `select` oq ro'yxatlarida va yozilgan qatorda;
 *   2. hisoblagichlar semantikasi (yacheyka ≠ qator, farq ishorasi).
 */

/** Pul/narx hidini beradigan har qanday kalit — `tsd-policy.test.ts` naqshi. */
const PRICEISH = /price|cost|sum|minor|margin|profit|amount|money|buy|sale/i;

describe('🔴 NARX — javob oq ro`yxatida pul maydoni YO`Q', () => {
  it('sessiya `select` ida narx-nomli kalit umuman yo`q', () => {
    const offenders = Object.keys(COUNT_SESSION_SELECT).filter((k) => PRICEISH.test(k));
    expect(offenders).toEqual([]);
  });

  it('🔴 `sumMinor` ATAYLAB yo`q — Prisma default `select` uni bergan bo`lardi', () => {
    // `Inventory.sumMinor` — «Стоимость» ustuni. `select` berilmasa Prisma
    // HAMMA skalyar ustunni qaytaradi va u narx bo'lib terminalga oqib
    // chiqardi. Shuning uchun har so'rov aynan shu ro'yxat bilan ketadi.
    expect(Object.keys(COUNT_SESSION_SELECT)).not.toContain('sumMinor');
    expect(Object.keys(COUNT_SESSION_SELECT)).toEqual([
      'id',
      'name',
      'storeId',
      'state',
      'countSession',
      'countedBy',
      'closedAt',
      'confirmedBy',
      'confirmedAt',
      'moment',
      'createdAt',
    ]);
  });

  it('qator `select` i faqat hisoblagichga kerakli ikki maydon', () => {
    expect(Object.keys(COUNT_SESSION_LINE_SELECT)).toEqual(['cellId', 'varianceQty']);
    expect(Object.keys(COUNT_SESSION_LINE_SELECT).filter((k) => PRICEISH.test(k))).toEqual([]);
  });

  it('🔴 yozilgan qatorda `costMinor` KALITI YO`Q ⇒ ustun NULL qoladi', () => {
    const row = buildCountSessionLine({
      accountId: 'acc-1',
      inventoryId: 'inv-1',
      position: 1,
      assortmentId: 'prod-1',
      cellId: 'cell-1',
      cellName: '02-01-01-04',
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
      autoDoc: { type: 'enter', id: 'ent-1', name: '00042' },
    });
    // `undefined` EMAS, kalitning O'ZI yo'q: `undefined` yozilsa Prisma uni
    // «tegilmadi» deb o'qiydi — natija bir xil, lekin niyat noaniq bo'lardi.
    expect('costMinor' in row).toBe(false);
    expect(Object.keys(row).filter((k) => PRICEISH.test(k))).toEqual([]);
  });
});

describe('buildCountSessionLine — iz qatorining shakli', () => {
  const base = {
    accountId: 'acc-1',
    inventoryId: 'inv-1',
    position: 7,
    assortmentId: 'prod-1',
    cellId: 'cell-1',
    cellName: '02-01-01-04',
  };

  it('sonlar `setCellStock` javobidagi AYNI stringlar bo`lib yoziladi', () => {
    const row = buildCountSessionLine({
      ...base,
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
      autoDoc: { type: 'enter', id: 'ent-1', name: '00042' },
    });
    expect(row.expectedQty).toBe('26');
    expect(row.actualQty).toBe('126');
    expect(row.varianceQty).toBe('100');
    expect(row.position).toBe(7);
    expect(row.assortmentKind).toBe('product');
    expect(row.productId).toBe('prod-1');
  });

  it('kamomad — `varianceQty` ISHORALI va avto-hujjat `loss`', () => {
    const row = buildCountSessionLine({
      ...base,
      expectedQty: '40',
      actualQty: '25',
      varianceQty: '-15',
      autoDoc: { type: 'loss', id: 'los-1', name: '00099' },
    });
    expect(row.varianceQty).toBe('-15');
    expect(row.autoDocType).toBe('loss');
    expect(row.autoDocId).toBe('los-1');
    expect(row.autoDocName).toBe('00099');
  });

  it('F-reja «faqat yacheyka kesimi» — `cellId` va nomi HAR DOIM yoziladi', () => {
    const row = buildCountSessionLine({
      ...base,
      expectedQty: '0',
      actualQty: '0',
      varianceQty: '0',
      autoDoc: null,
    });
    expect(row.cellId).toBe('cell-1');
    expect(row.cell).toBe('02-01-01-04');
  });

  it('avto-hujjat yo`q bo`lsa (delta = 0) uch maydon NULL, qator baribir yoziladi', () => {
    const row = buildCountSessionLine({
      ...base,
      expectedQty: '5',
      actualQty: '5',
      varianceQty: '0',
      autoDoc: null,
    });
    expect(row.autoDocType).toBeNull();
    expect(row.autoDocId).toBeNull();
    expect(row.autoDocName).toBeNull();
  });

  it('K5 — `pieceEntry` berilsa qatorga KO`CHIRILADI, berilmasa NULL', () => {
    const withEntry = buildCountSessionLine({
      ...base,
      expectedQty: '0',
      actualQty: '3',
      varianceQty: '3',
      pieceEntry: '250x3',
      autoDoc: null,
    });
    expect(withEntry.pieceEntry).toBe('250x3');
    const without = buildCountSessionLine({
      ...base,
      expectedQty: '0',
      actualQty: '3',
      varianceQty: '3',
      autoDoc: null,
    });
    expect(without.pieceEntry).toBeNull();
  });
});

describe('summarizeCountSessionLines — hisoblagichlar', () => {
  const line = (cellId: string | null, varianceQty: string) => ({ cellId, varianceQty });

  it('bo`sh sessiya — hammasi nol', () => {
    expect(summarizeCountSessionLines([])).toEqual({
      cellCount: 0,
      lineCount: 0,
      surplusLines: 0,
      shortageLines: 0,
    });
  });

  it('yacheyka ≠ qator: bitta yacheykada 3 tovar = 1 yacheyka, 3 qator', () => {
    const c = summarizeCountSessionLines([
      line('cell-1', '1'),
      line('cell-1', '0'),
      line('cell-1', '-2'),
    ]);
    expect(c.cellCount).toBe(1);
    expect(c.lineCount).toBe(3);
  });

  it('ortiqcha/kam qatorlar ishora bo`yicha ajraladi, NOL hech qayerga tushmaydi', () => {
    const c = summarizeCountSessionLines([
      line('cell-1', '5'),
      line('cell-2', '-3'),
      line('cell-3', '0'),
      line('cell-3', '0.5'),
      line('cell-3', '-0.25'),
    ]);
    expect(c).toEqual({ cellCount: 3, lineCount: 5, surplusLines: 2, shortageLines: 2 });
  });

  it('`Prisma.Decimal` kabi obyekt ham o`qiladi (`toString`)', () => {
    const decimal = (v: string) => ({ toString: () => v });
    const c = summarizeCountSessionLines([
      { cellId: 'cell-1', varianceQty: decimal('12.000000') },
      { cellId: 'cell-2', varianceQty: decimal('-0.500000') },
    ]);
    expect(c).toEqual({ cellCount: 2, lineCount: 2, surplusLines: 1, shortageLines: 1 });
  });

  it('yacheykasiz qator `cellCount` ga qo`shilmaydi (bunday qator yozilmasligi kerak)', () => {
    const c = summarizeCountSessionLines([line(null, '4'), line('cell-1', '4')]);
    expect(c.cellCount).toBe(1);
    expect(c.lineCount).toBe(2);
  });
});

describe('yopilgan sessiya holati', () => {
  it('🔴 `counted` — `posted` EMAS (post qilinsa qoldiq ikki karra siljirdi)', () => {
    expect(COUNT_SESSION_STATE).toBe('counted');
    expect(COUNT_SESSION_STATE).not.toBe('posted');
  });
});
