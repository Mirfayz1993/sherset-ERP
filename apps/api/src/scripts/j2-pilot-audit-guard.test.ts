/**
 * J2 — `ops-j2-piece-pilot-audit.ts` skriptining KOD-SHAKL qo'riqchisi.
 *
 * 🔴 NEGA BU FAYL BOR. Skriptni testda yugurtirib bo'lmaydi (jonli baza va
 * ishlab turgan API kerak), lekin uning ikkita XULQI shartnoma darajasida:
 *
 *   1. **DRY SUKUT** — `--apply` siz bir bayt ham yozilmaydi;
 *   2. **SQL EMAS, MARSHRUT** — bayroq faqat `POST /stock-pieces/flag`
 *      orqali o'zgaradi (J2 promptining 3-bandi). To'g'ridan-to'g'ri
 *      `product.update` yoki `$executeRaw` bilan yozish qaror muhrini
 *      (`piece_tracked_decided_at`) chetlab o'tardi va K6 ning butun
 *      «kim qaror qildi» qatlamini yolg'on qilardi.
 *   3. **YOQISH YO'LI YO'Q** — skript bayroqni faqat O'CHIRADI. Yoqish
 *      jonli kassa xulqini o'zgartiradi (7.1) va u J4 ning ishi.
 *
 * Naqsh: `j1-piece-aware-scripts-guard.test.ts` / `q5-backfill-scripts-guard.test.ts`
 * — izohlar OLIB TASHLANGAN holda skanerlanadi, chunki izohdagi so'z dalil emas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SCRIPT = read('./ops-j2-piece-pilot-audit.ts');
const CODE = stripComments(SCRIPT);
const CORE = stripComments(read('./j2-pilot-audit-core.ts'));

describe('J2 skripti — DRY sukut', () => {
  it('🔴 `--apply` bo‘lmasa yozish yo‘li OCHILMAYDI', () => {
    expect(CODE).toContain("const APPLY = process.argv.includes('--apply')");
    // Yagona yozuv chaqirig'i `if (APPLY)` shoxida turishi kerak.
    expect(CODE).toMatch(/} else \{[\s\S]*?JWT_SECRET[\s\S]*?stock-pieces\/flag/);
  });

  it('DRY shoxi aynan yuboriladigan tanani BOSIB CHIQARADI (bashorat ko‘rinsin)', () => {
    expect(CODE).toContain('DRY  POST /stock-pieces/flag');
  });
});

describe('J2 skripti — SQL EMAS, UI marshruti', () => {
  it('🔴 bayroq FAQAT `POST /stock-pieces/flag` orqali o‘zgaradi', () => {
    expect(CODE).toContain("await call(token, 'POST', '/stock-pieces/flag'");
    expect(CODE).toContain('pieceTracked: false');
  });

  it('🔴 to‘g‘ridan-to‘g‘ri yozadigan birorta Prisma chaqirig‘i YO‘Q', () => {
    for (const forbidden of [
      'prisma.product.update',
      'prisma.stockPiece.update',
      'prisma.stockPiece.create',
      'prisma.stock.update',
      '$executeRaw',
      '$queryRaw',
      '$transaction',
      'updateMany',
      'createMany',
      'deleteMany',
    ]) {
      expect(CODE, `taqiqlangan yozuv: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('Prisma FAQAT o‘qiydi (`findMany` / `findFirst` / `groupBy` / `count`)', () => {
    const calls = [...CODE.matchAll(/prisma\.[A-Za-z]+\.([A-Za-z]+)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(
        ['findMany', 'findFirst', 'findFirstOrThrow', 'groupBy', 'count'].includes(c ?? ''),
        `prisma.*.${c} — bu skript FAQAT o‘qiydi`,
      ).toBe(true);
    }
  });
});

describe('J2 skripti — bayroqni YOQMAYDI (yoqish J4 ning ishi)', () => {
  it('🔴 `/stock-pieces/flag` ga `pieceTracked: true` yuboradigan yo‘l YO‘Q', () => {
    // `pieceTracked: true` matni skriptda BOR — lekin faqat O'QISH filtrida
    // (`prisma.product.count({ where: { …, pieceTracked: true } })`, 5-bo'lim
    // qabul mezoni). Bu yerda o'lchanadigan narsa — marshrutga ketadigan TANA.
    for (const m of CODE.matchAll(/stock-pieces\/flag'[\s\S]{0,200}/g)) {
      expect(m[0]).not.toContain('pieceTracked: true');
    }
    // Skriptdagi IKKALA `pieceTracked: true` ham Prisma O'QISHIning argumenti:
    // biri `select:` da (1-bo'lim jadvali), biri `where:` da (5-bo'lim
    // qabul mezoni «soni 0» ni JONLIDAN o'lchaydi).
    expect([...CODE.matchAll(/pieceTracked: true/g)]).toHaveLength(2);
    expect(CODE).toMatch(/where: \{[^}]*pieceTracked: true/);
    expect(CODE).toMatch(/select: \{[\s\S]{0,400}?pieceTracked: true/);
  });
});

describe('J2 skripti — hisobot qatorlari (qabul mezoni shu qatorlardan o‘qiladi)', () => {
  it('uchala bo‘lim ham HAR DOIM chiqadi', () => {
    expect(CODE).toContain('1. HOZIRGI HOLAT');
    expect(CODE).toContain('2. GIGIENA');
    expect(CODE).toContain('3. PILOT NOMZODLARI');
    expect(CODE).toContain('5. QABUL MEZONI');
  });

  it('🔴 skript pilot ro‘yxatini TANLAMAYDI — buni ochiq yozadi', () => {
    expect(CODE).toContain('RO‘YXATNI SKRIPT TANLAMAYDI');
  });

  it('nomzodlar jadvali kesilsa — kesilgani AYTILADI (jim kesish YO‘Q)', () => {
    expect(CODE).toMatch(/ko‘rsatilmadi \(chegara/);
  });
});

describe('J2 yadrosi — sof (Prisma/HTTP yo‘q)', () => {
  it('yadroda Prisma ham, `fetch` ham YO‘Q', () => {
    for (const forbidden of ['PrismaClient', 'prisma.', 'fetch(', '@moysklad/db']) {
      expect(CORE, `yadro sof emas: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('🔴 manba sanog‘i taqsimot dvigateli bilan BIR XIL semantikada', () => {
    // `retail-allocation.ts` dagi `buildSources`: har yacheyka + ombordagi
    // yacheykasiz qoldiq = psevdo-manba. Yadro shu ikkalasini ham yaratadi.
    expect(CORE).toContain('cellId: null');
    expect(CORE).toContain('remainder');
  });
});
