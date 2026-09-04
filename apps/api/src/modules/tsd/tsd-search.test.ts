import { describe, expect, it } from 'vitest';
import {
  RANK_CONTAINS,
  RANK_EXACT,
  RANK_PREFIX,
  SEARCH_MAX_LEN,
  SEARCH_MIN_LEN,
  SEARCH_TAKE,
  normalizeSearchQuery,
  searchRank,
  sortSearchHits,
} from './tsd-search.js';

/**
 * TSD nom-qidiruvining sof yadrosi (T-reja T3).
 *
 * Qulflanadigan shartnomalar:
 *   1. so'rov TOZALANADI — LIKE metabelgisi qidiruvni butun jadvalga ochmasin;
 *   2. tartib: aynan moslik → boshida moslik → ichida moslik;
 *   3. **arxivlanganlar eng oxirida** — bosqichidan qat'i nazar;
 *   4. teng kalitlarda tartib O'ZGARMAYDI (serverning `name asc` i saqlanadi).
 */

function row(over: Partial<Parameters<typeof searchRank>[0]> = {}) {
  return {
    name: 'Kabel 2x1.5',
    code: null,
    article: null,
    barcodes: null,
    archived: false,
    ...over,
  };
}

describe('normalizeSearchQuery', () => {
  it('chekka bo`shliqlarni oladi va ichkilarini bittaga siqadi', () => {
    expect(normalizeSearchQuery('  kabel   2x1.5  ')).toBe('kabel 2x1.5');
  });

  it('🔴 `%` OLIB TASHLANADI — aks holda so`rov BUTUN jadvalga mos kelardi', () => {
    // Prisma `contains` qiymatni `ILIKE '%' || $1 || '%'` ga qo'yadi va LIKE
    // metabelgilarini ekranlamaydi: bitta `%` yozilsa filtr ma'nosini
    // yo'qotib, tasodifiy 30 ta tovar qaytarardi.
    expect(normalizeSearchQuery('%')).toBe('');
    expect(normalizeSearchQuery('ka%bel')).toBe('kabel');
    expect(normalizeSearchQuery('kabel\\')).toBe('kabel');
  });

  it('`_` QOLDIRILADI — u artikullarda haqiqatan uchraydi', () => {
    expect(normalizeSearchQuery('KAB_2x1.5')).toBe('KAB_2x1.5');
  });

  it('uzun matn kesiladi (rad etilmaydi)', () => {
    const long = 'a'.repeat(SEARCH_MAX_LEN + 50);
    expect(normalizeSearchQuery(long)).toHaveLength(SEARCH_MAX_LEN);
  });

  it('registrni O`ZGARTIRMAYDI (DB filtri o`zi `insensitive`)', () => {
    expect(normalizeSearchQuery('Kabel')).toBe('Kabel');
  });
});

describe('chegaralar', () => {
  it('min 2 / max 100 / take 30', () => {
    expect(SEARCH_MIN_LEN).toBe(2);
    expect(SEARCH_MAX_LEN).toBe(100);
    expect(SEARCH_TAKE).toBe(30);
  });
});

describe('searchRank', () => {
  it('nom AYNAN teng — eng yuqori bosqich', () => {
    expect(searchRank(row({ name: 'Kabel' }), 'kabel')).toBe(RANK_EXACT);
  });

  it('artikul/kod/shtrix AYNAN teng ham eng yuqori bosqich', () => {
    // Omborchi artikulni to'liq yozsa u BIRINCHI qatorda turishi kerak,
    // garchi nomida u umuman bo'lmasa ham.
    expect(searchRank(row({ article: 'ART-15' }), 'art-15')).toBe(RANK_EXACT);
    expect(searchRank(row({ code: 'K-15' }), 'K-15')).toBe(RANK_EXACT);
    expect(searchRank(row({ barcodes: ['4780001'] }), '4780001')).toBe(RANK_EXACT);
  });

  it('boshida moslik — ikkinchi bosqich', () => {
    expect(searchRank(row({ name: 'Kabel 2x1.5' }), 'kab')).toBe(RANK_PREFIX);
  });

  it('ichida moslik — uchinchi bosqich', () => {
    expect(searchRank(row({ name: 'Mis kabel 2x1.5' }), 'kabel')).toBe(RANK_CONTAINS);
  });

  it('eng YAXSHI maydon g`olib (nomida ichida, artikulida boshida)', () => {
    expect(searchRank(row({ name: 'Mis kabel', article: 'KAB-15' }), 'kab')).toBe(RANK_PREFIX);
  });

  it('bo`sh so`rov va mos kelmagan qator — eng past bosqich', () => {
    expect(searchRank(row(), '')).toBe(RANK_CONTAINS);
    expect(searchRank(row({ name: 'Shlang' }), 'kabel')).toBe(RANK_CONTAINS);
  });
});

describe('sortSearchHits', () => {
  it('aynan → boshida → ichida', () => {
    const items = [
      row({ name: 'Mis kabel 2x1.5' }), // contains
      row({ name: 'Kabel' }), // exact
      row({ name: 'Kabel 2x1.5' }), // prefix
    ];
    expect(sortSearchHits(items, 'kabel').map((i) => i.name)).toEqual([
      'Kabel',
      'Kabel 2x1.5',
      'Mis kabel 2x1.5',
    ]);
  });

  it('🔴 arxivlangan AYNAN moslik ham tirik tovardan PASTDA turadi', () => {
    // Omborchi kundalik ishda arxivlanganni QIDIRMAYDI — u ro'yxatda faqat
    // «bor ekan» deb turishi kerak.
    const items = [
      row({ name: 'Kabel', archived: true }), // exact, lekin arxiv
      row({ name: 'Mis kabel 2x1.5' }), // contains, tirik
    ];
    expect(sortSearchHits(items, 'kabel').map((i) => i.archived)).toEqual([false, true]);
  });

  it('arxiv guruhi ichida ham bosqich ishlaydi', () => {
    const items = [
      row({ name: 'Mis kabel', archived: true }),
      row({ name: 'Kabel', archived: true }),
    ];
    expect(sortSearchHits(items, 'kabel').map((i) => i.name)).toEqual(['Kabel', 'Mis kabel']);
  });

  it('teng kalitlarda kirish tartibi SAQLANADI (barqaror saralash)', () => {
    // Server `name asc` beradi; bir xil bosqichdagi qatorlar shu tartibda
    // qolishi kerak, aks holda ro'yxat har so'rovda sakrab turardi.
    const items = [row({ name: 'Kabel A' }), row({ name: 'Kabel B' }), row({ name: 'Kabel C' })];
    expect(sortSearchHits(items, 'kabel').map((i) => i.name)).toEqual([
      'Kabel A',
      'Kabel B',
      'Kabel C',
    ]);
  });

  it('kirish massivini O`ZGARTIRMAYDI', () => {
    const items = [row({ name: 'Mis kabel' }), row({ name: 'Kabel' })];
    sortSearchHits(items, 'kabel');
    expect(items.map((i) => i.name)).toEqual(['Mis kabel', 'Kabel']);
  });

  it('bo`sh ro`yxat yiqilmaydi', () => {
    expect(sortSearchHits([], 'kabel')).toEqual([]);
  });
});
