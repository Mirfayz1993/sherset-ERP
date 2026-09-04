/**
 * J3 — `ops-j3-trial-count.ts` skriptining KOD-SHAKL qo'riqchisi.
 *
 * 🔴 NEGA BU FAYL BOR. Skriptni testda yugurtirib bo'lmaydi (jonli baza va
 * ishlab turgan API kerak), lekin uning TO'RTTA xulqi shartnoma darajasida:
 *
 *   1. **DRY SUKUT** — `--apply` siz bir bayt ham yozilmaydi;
 *   2. **SQL EMAS, MARSHRUT** — reyestrga faqat `POST /stock-pieces` va
 *      `POST /stock-pieces/:id/close` orqali yoziladi. To'g'ridan-to'g'ri
 *      `stockPiece.create` yorliq ketma-ketligini, doira tekshiruvini va
 *      sverkani chetlab o'tardi;
 *   3. **BAYROQQA TEGMAYDI** — `/stock-pieces/flag` marshruti skriptda
 *      umuman yo'q (bayroq yoqish J4 ning ishi, J3 prompti taqiqlaydi);
 *   4. **IZ QOLDIRMAYDI** — sinov qatorlari o'sha yugurishda yopiladi va
 *      qaytganlik O'LCHANADI, «yopdim» deb e'lon qilinmaydi.
 *
 * Naqsh: `j2-pilot-audit-guard.test.ts` — izohlar OLIB TASHLANGAN holda
 * skanerlanadi, chunki izohdagi so'z dalil emas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CODE = stripComments(read('./ops-j3-trial-count.ts'));
const CORE = stripComments(read('./j3-trial-core.ts'));

describe('J3 skripti — DRY sukut', () => {
  it('🔴 `--apply` bo‘lmasa yugurish shoxi OCHILMAYDI', () => {
    expect(CODE).toContain("const APPLY = process.argv.includes('--apply')");
    // DRY dan qaytish YOZISHDAN OLDIN turishi shart.
    const guardAt = CODE.indexOf('if (!APPLY)');
    const firstWriteAt = CODE.indexOf('call(token, step.method');
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstWriteAt).toBeGreaterThan(guardAt);
  });

  it('DRY shoxi yuboriladigan tanani BOSIB CHIQARADI (bashorat ko‘rinsin)', () => {
    expect(CODE).toContain('Hech nima yozilmadi');
    expect(CODE).toContain('JSON.stringify(step.body)');
  });

  it('token FAQAT `--apply` shoxida imzolanadi', () => {
    const guardAt = CODE.indexOf('if (!APPLY)');
    expect(CODE.indexOf('JWT_SECRET')).toBeGreaterThan(guardAt);
  });
});

describe('J3 skripti — SQL EMAS, UI marshruti', () => {
  it('🔴 reyestrga yozadigan birorta Prisma chaqirig‘i YO‘Q', () => {
    for (const forbidden of [
      'stockPiece.create',
      'stockPiece.update',
      'stockPiece.delete',
      'stockPiece.upsert',
      'stock.update',
      'product.update',
      '$executeRaw',
      '$queryRaw',
      'updateMany',
      'createMany',
      'deleteMany',
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('Prisma FAQAT o‘qish metodlari bilan ishlatiladi', () => {
    const calls = [...CODE.matchAll(/prisma\.[A-Za-z]+\.([A-Za-z]+)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const method of calls) {
      expect(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate']).toContain(method);
    }
  });

  it('yozish FAQAT `/stock-pieces` marshrutlari orqali', () => {
    for (const step of [
      '/stock-pieces',
      '/stock-pieces/:pieceId/close',
      '/stock-pieces/:wholeId/close',
    ]) {
      expect(CORE).toContain(step);
    }
  });
});

describe('J3 skripti — bayroqqa tegmaydi (J4 ning ishi)', () => {
  it('🔴 `/stock-pieces/flag` skriptda ham, yadroda ham YO‘Q', () => {
    expect(CODE).not.toContain('stock-pieces/flag');
    expect(CORE).not.toContain('stock-pieces/flag');
  });

  it('🔴 birorta so‘rov tanasi `pieceTracked` yubormaydi', () => {
    // Tana QURADIGAN yagona joy — yadro. Unda bu so'z umuman yo'q.
    expect(CORE).not.toContain('pieceTracked');
    // Skriptda esa `pieceTracked` FAQAT o'qish (`select`) va tekshiruvda
    // uchraydi; tana sifatida hech qayerga uzatilmaydi — buni quyidagi
    // «tana faqat yadrodan» testi mexanik qulflaydi.
  });

  it('🔴 so‘rov tanasi FAQAT yadrodagi `step.body` dan keladi', () => {
    const invocations = [...CODE.matchAll(/await call\(([^;]*?)\);/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').trim(),
    );
    expect(invocations.length).toBeGreaterThan(0);
    // Ruxsat etilgan shakllar: tanasiz GET, yadro qurgan `step.body`, va
    // tozalash rejimidagi `close` (tanasi ham yadrodan — `CLOSE_BODY`).
    const ALLOWED = new Set([
      "token, 'GET', scopePath",
      'token, step.method, path, step.body',
      "token, 'POST', `/stock-pieces/${t.id}/close`, CLOSE_BODY",
    ]);
    for (const args of invocations) {
      expect(ALLOWED.has(args), `kutilmagan call(): ${args}`).toBe(true);
    }
  });

  it('bayrog‘i YOQIQ tovarda sinov `--force` siz to‘xtaydi', () => {
    expect(CODE).toMatch(/if \(product\.pieceTracked && !FORCE\)/);
  });
});

describe('J3 skripti — haqiqiy sanoq ustiga yozmaydi', () => {
  it('🔴 reyestrda FAOL qator bo‘lsa `--force` siz to‘xtaydi', () => {
    expect(CODE).toMatch(/if \(!CLEANUP && activeBefore > 0 && !FORCE\)/);
  });

  it('🔴 tozalash rejimi FAQAT `close` ni chaqiradi — o‘chirish ham, qoldiq ham yo‘q', () => {
    const block = CODE.slice(CODE.indexOf('if (CLEANUP) {'), CODE.indexOf('5-BO'));
    expect(block).toContain('/close`');
    expect(block).not.toContain('DELETE');
    expect(block).not.toMatch(/'POST', '\/stock-pieces'/);
  });

  it('qaytganlik E‘LON qilinmaydi, O‘LCHANADI', () => {
    // Yakuniy holat jonlidan QAYTA o'qiladi va hukm o'sha o'qishdan chiqadi.
    expect(CODE).toContain('const finalRes = await call(');
    expect(CODE).toContain('const finalTotals = totalsOf(finalRes.body)');
    expect(CODE).toContain('isRestored(baseline,');
  });

  it('zanjir yoki qaytganlik buzilsa EXIT kodi 1 bo‘ladi', () => {
    expect(CODE).toMatch(/if \(!allOk \|\| !restored\) \{\s*process\.exitCode = 1;/);
  });
});

describe('J3 yadrosi — sof', () => {
  it('yadroda Prisma ham, `fetch` ham YO‘Q', () => {
    expect(CORE).not.toContain('PrismaClient');
    expect(CORE).not.toContain('fetch(');
  });

  it('kutilmalar yadroda quriladi — jonli javobdan HOSILA emas', () => {
    expect(CORE).toContain('export function expectAfter');
    expect(CODE).toContain('expectAfter(baseline, steps, i)');
  });
});
