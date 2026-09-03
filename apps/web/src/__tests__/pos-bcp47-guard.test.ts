import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FAZA 3 (kassa ikki tilli, 2026-09-01) — QATTIQ BCP-47 TEG QO'RIQCHISI.
 *
 * ── QANDAY XATO-SINFINI QULFLAYDI
 *
 * Kassa yuzasida 13 joyda sana/vaqt `toLocaleDateString('uz-UZ', …)` bilan
 * chizilardi. Kassir tilni RU ga o'tkazganda ham sana o'zbekcha chiqardi
 * (`01-sen, 2026` vs `01 сент. 2026 г.`). Faza 3 ularni `useBcp47()` ga
 * o'tkazdi. Bu qo'riqchi 14-chi shunday joy qo'shilmasin deb turadi:
 * kassa doirasidagi HAR QANDAY qattiq BCP-47 teg (til-mintaqa identifikatori)
 * taqiqlanadi, faqat quyidagi HUJJATLANGAN istisnolar bundan mustasno.
 *
 * ── NEGA MAVJUD QO'RIQCHIGA QO'SHILMADI
 *
 * `i18n-no-hardcoded.test.ts` FOYDALANUVCHI MATNINI qidiradi (JSX tugunlari,
 * ko'rinadigan atributlar, xabar argumentlari). `'uz-UZ'` esa foydalanuvchi
 * matni EMAS — u format identifikatori va u skanerning hech bir pozitsiyasiga
 * tushmaydi. Ya'ni o'sha qo'riqchi bu sinfga ko'r, va uni «kengaytirish»
 * pozitsiya-asosli skanerni qiymat-asosli qilib buzardi. Shuning uchun —
 * alohida fayl, `pos-i18n-guard.test.ts` bilan bir xil sabab bo'yicha.
 *
 * ── QAMROV: FAQAT KASSA DOIRASI
 *
 * ERP'ning qolgan qismida ~200 ta `'ru-RU'` bor — u ALOHIDA ish va bu faza
 * chegarasidan tashqarida. Skaner ataylab to'rt papka bilan chegaralangan;
 * kengaytirilsa gate darhol qizarardi va foydasiz shovqinga aylanardi.
 */

const WEB_SRC = join(__dirname, '..');

/** Kassa yuzasi — faqat shu papkalar skanerlanadi (reja «FAZA 3» chegarasi). */
const BCP47_SCAN_DIRS = [
  'components/pos',
  'app/(app)/sotuv',
  'app/customer-display',
  'app/kassa-kirish',
];

/**
 * ATAYLAB QATTIQ QOLDIRILGAN teglar — har biri SABAB bilan, fayl bo'yicha.
 * Ro'yxatga qo'shish = QAROR; jimgina o'tkazib yuborish emas.
 *
 * 🔴 Bularni «izchillik uchun» `useBcp47()` ga o'tkazish REGRESSIYA bo'ladi:
 * pul ko'rinishi tilga qarab o'zgarardi va ICU versiyasiga bog'liq bo'lib
 * qolardi (`packages/design-system/src/lib/format.ts:36-39` izohi, reja §2.5).
 */
const BCP47_ALLOWED: Record<string, { tags: string[]; reason: string }> = {
  'components/pos/pos-rate-chip.tsx': {
    tags: ['ru-RU'],
    reason:
      'Kurs raqami — PUL sinfi. `formatMoney` bilan bir xil moysklad pariteti ' +
      "(ingichka probel + vergul). Lokalga bog'lansa kurs chipi yonidagi pul " +
      'maydonidan farq qilib qolardi. Reja §2.5 — bu nomuvofiqlik emas, QAROR.',
  },
  'components/pos/payment-dialog.tsx': {
    tags: ['uz-UZ'],
    reason:
      '`quickLabel()` — banknot NOMINALI («100 000»), sana emas. U locale chiqishini ' +
      "ataylab denormallashtiradi (U+00A0 → oddiy probel, «testlar/qidiruv matn bo'yicha " +
      "topa olsin»), ya'ni locale'ga ergashish niyati yo'q — pul sinfi, §2.5 doirasi. " +
      "QOLDIQ NOMUVOFIQLIK (faza tashqarisi): pul sinfi boshqa joyda 'ru-RU' da turadi, " +
      "bu esa 'uz-UZ' da. Bugun chiqish AYNAN bir xil (reja §1.3: son formati ikki " +
      'lokalda teng), shuning uchun tegilmadi — o‘zgartirish pul ko‘rinishiga tegadi va ' +
      'o‘z qarori/tekshiruvini talab qiladi.',
  },
};

/**
 * BCP-47 til-mintaqa tegi: `uz-UZ`, `ru-RU`, `en-US`, `sr-Latn-RS`.
 *
 * Mintaqa ATAYLAB ikki BOSH harf, skript esa `Latn` shaklida: shusiz naqsh
 * tailwind sinflarini yutib yuborardi (`bg-teal-500` = `[a-z]{2}` + `-teal` +
 * `-500`). O'lchandi: hozirgi kassa daraxtida 0 yolg'on-pozitiv.
 */
const BCP47_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?-[A-Z]{2}$/;

interface Bcp47Leak {
  file: string;
  line: number;
  tag: string;
}

/**
 * Sof funksiya — manba MATNI ustida ishlaydi, shuning uchun mutant-fikstura
 * bilan sinash mumkin (`i18n-no-hardcoded.test.ts` dagi `scanPosSource` naqshi).
 *
 * TypeScript AST bo'yicha ishlaydi, regex bo'yicha emas: shu sababdan IZOHDA
 * yozilgan `'uz-UZ'` (masalan shu faylning o'z hujjati yoki reja iqtibosi)
 * yolg'on-pozitiv bermaydi — faqat KODGA tushgan satr literali tutiladi.
 */
function scanBcp47Source(source: string, name: string): Bcp47Leak[] {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const allowed = new Set(BCP47_ALLOWED[name]?.tags ?? []);
  const leaks: Bcp47Leak[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const tag = node.text;
      if (BCP47_RE.test(tag) && !allowed.has(tag)) {
        leaks.push({
          file: name,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          tag,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaks;
}

/**
 * Skanerlanadigan fayllar — `BCP47_SCAN_DIRS` ostidagi barcha `.ts`/`.tsx`.
 *
 * Reyestr YO'Q (`POS_DONE_FILES` dan farqli): bu yerda a'zolik mezoni
 * «papkada turibdi» — ya'ni yangi fayl qo'shgan odam hech nima qilmasa ham
 * qo'riqchi ostiga tushadi. Reyestr bo'lsa u qo'riqchining teshigi bo'lardi.
 *
 * Testlar CHIQARIB TASHLANADI: test faylida konkret lokal chiqishini tasdiqlash
 * (`'01 сент. 2026 г.'`) MAQSADGA MUVOFIQ — aynan shu faza shunday tekshiriladi.
 * Test kassirning ekraniga chizilmaydi, ya'ni bu sinfning zarari u yerda yo'q.
 */
function bcp47ScannedFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(WEB_SRC, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== '__tests__') walk(child);
      } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
        out.push(child);
      }
    }
  };
  for (const dir of BCP47_SCAN_DIRS) walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Qo'riqchining O'ZI sinaladi (mutantlar) — «qo'riqchi bor» deb o'ylab, aslida
// yo'q bo'lib qolmasin.
// ---------------------------------------------------------------------------
describe('BCP-47 skaneri — the guard is itself guarded (mutants)', () => {
  it("CATCHES a hardcoded 'uz-UZ' date format", () => {
    const leaks = scanBcp47Source(
      "const s = new Date(x).toLocaleDateString('uz-UZ', { day: '2-digit' });",
      'm.tsx',
    );
    expect(leaks.map((l) => l.tag)).toEqual(['uz-UZ']);
  });

  it("CATCHES 'ru-RU' and any other language-region tag", () => {
    expect(scanBcp47Source("x.toLocaleString('ru-RU');", 'm.tsx')).toHaveLength(1);
    expect(scanBcp47Source("new Intl.DateTimeFormat('en-US');", 'm.tsx')).toHaveLength(1);
    expect(scanBcp47Source("const L = 'sr-Latn-RS';", 'm.tsx')).toHaveLength(1);
  });

  it('reports the LINE the tag sits on (report is actionable)', () => {
    const leaks = scanBcp47Source("const a = 1;\nconst b = 2;\nconst L = 'uz-UZ';", 'm.tsx');
    expect(leaks[0]?.line).toBe(3);
  });

  it('does NOT flag the helper call, tailwind classes or format options', () => {
    const clean = [
      'const bcp47 = useBcp47();',
      "const s = d.toLocaleDateString(bcp47, { day: '2-digit', month: '2-digit', year: 'numeric' });",
      'const A = () => <div className="flex-1 bg-teal-500 border-blue-400 text-[14px]" />;',
      "const l = locale === 'ru' ? 'ru' : 'uz';",
      "api.get('/retail-sales?limit=20');",
    ].join('\n');
    expect(scanBcp47Source(clean, 'm.tsx')).toEqual([]);
  });

  it('does NOT flag a tag written inside a COMMENT (AST, not regex)', () => {
    const src =
      "// eski kod: toLocaleDateString('uz-UZ')\n/* ru-RU ham shu yerda edi */\nconst a = 1;";
    expect(scanBcp47Source(src, 'm.tsx')).toEqual([]);
  });

  it('respects the documented allow-list — and ONLY the listed file+tag pair', () => {
    // ro'yxatdagi fayl + ro'yxatdagi teg → o'tadi
    expect(
      scanBcp47Source("const g = n.toLocaleString('ru-RU');", 'components/pos/pos-rate-chip.tsx'),
    ).toEqual([]);
    expect(
      scanBcp47Source("const g = n.toLocaleString('uz-UZ');", 'components/pos/payment-dialog.tsx'),
    ).toEqual([]);
    // AYNI fayl, BOSHQA teg → hamon tutiladi (istisno teg bo'yicha, fayl bo'yicha emas)
    expect(
      scanBcp47Source("const g = n.toLocaleString('uz-UZ');", 'components/pos/pos-rate-chip.tsx'),
    ).toHaveLength(1);
    // AYNI teg, BOSHQA fayl → hamon tutiladi
    expect(
      scanBcp47Source("const g = n.toLocaleString('ru-RU');", 'components/pos/customers-panel.tsx'),
    ).toHaveLength(1);
  });

  /**
   * 🔴 ENG MUHIM MUTANT: soxta teg HAQIQIY qo'riqlanadigan faylga qo'shilsa
   * gate qizarishi kerak. Yuqoridagi testlar skanerni o'z-o'zicha sinaydi;
   * bu esa BUTUN yo'lni — fayl ro'yxati + skaner — sinaydi. Shusiz skaner
   * to'g'ri ishlab, lekin hech bir haqiqiy faylga tegmayotgan bo'lishi mumkin.
   */
  it('a fake tag injected into a REAL guarded file turns the gate red', () => {
    const victim = 'app/(app)/sotuv/_components/sotuv-mode.tsx';
    expect(bcp47ScannedFiles(), 'nishon fayl skaner qamrovida emas').toContain(victim);

    const clean = readFileSync(join(WEB_SRC, victim), 'utf8');
    expect(scanBcp47Source(clean, victim), 'nishon fayl mutantsiz ham qizil').toEqual([]);

    const mutant = `${clean}\nconst FAKE = new Date().toLocaleDateString('uz-UZ');\n`;
    const leaks = scanBcp47Source(mutant, victim);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.tag).toBe('uz-UZ');
  });
});

// ---------------------------------------------------------------------------
// Qamrov qulfi — skaner haqiqatan to'rt yuzani ko'radi
// ---------------------------------------------------------------------------
describe('BCP-47 qo`riqchisi — qamrov', () => {
  it('covers all four kassa surfaces (and nothing outside the phase)', () => {
    expect(BCP47_SCAN_DIRS).toEqual([
      'components/pos',
      'app/(app)/sotuv',
      'app/customer-display',
      'app/kassa-kirish',
    ]);
    for (const dir of BCP47_SCAN_DIRS) {
      expect(existsSync(join(WEB_SRC, dir)), `qo'riqlanadigan papka ko'chgan: ${dir}`).toBe(true);
    }
  });

  it('actually collects files from every surface (no silently empty scan)', () => {
    const files = bcp47ScannedFiles();
    for (const dir of BCP47_SCAN_DIRS) {
      expect(
        files.filter((f) => f.startsWith(`${dir}/`)).length,
        `papkadan bitta ham fayl yig'ilmadi: ${dir}`,
      ).toBeGreaterThan(0);
    }
    // Ichma-ich papkalar ham (rekursiv yurish ishlayotganini isbotlaydi).
    expect(files).toContain('app/(app)/sotuv/_components/cheklar-mode.tsx');
    expect(files).toContain('app/(app)/sotuv/page.tsx');
  });

  it('every allow-listed file still exists (a stale exception is a hole)', () => {
    for (const rel of Object.keys(BCP47_ALLOWED)) {
      expect(existsSync(join(WEB_SRC, rel)), `istisno fayli yo'q: ${rel}`).toBe(true);
      expect(bcp47ScannedFiles(), `istisno fayli qamrovda emas: ${rel}`).toContain(rel);
    }
  });
});

// ---------------------------------------------------------------------------
// Asosiy invariant
// ---------------------------------------------------------------------------
describe('kassa doirasi — zero hardcoded BCP-47 tags', () => {
  it('has no hardcoded language-region tag outside the documented exceptions', () => {
    const leaks: Bcp47Leak[] = [];
    for (const rel of bcp47ScannedFiles()) {
      leaks.push(...scanBcp47Source(readFileSync(join(WEB_SRC, rel), 'utf8'), rel));
    }
    const report = leaks.map(
      (l) => `${l.file}:${l.line}  '${l.tag}'  →  useBcp47() (@/lib/i18n-format)`,
    );
    const howToFix =
      "Sana/vaqt uchun `useBcp47()` ishlating. Agar bu ATAYLAB bo'lsa — " +
      'BCP47_ALLOWED ga SABAB bilan yozing, jim qoldirmang.';
    expect(report, `Kassa doirasida qattiq BCP-47 teg:\n${report.join('\n')}\n${howToFix}`).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Teskari qulf — istisnolar «izchillik uchun» tuzatilib buzilmasin
// ---------------------------------------------------------------------------
/**
 * Yuqoridagi qo'riqchi «yangi qattiq teg qo'shilmasin» deydi. Bu esa TESKARI
 * xatoni tutadi: kimdir istisnolarni «izchillik uchun» `useBcp47()` ga
 * o'tkazsa — pul ko'rinishi tilga qarab o'zgaradi. §2.5 aynan buni taqiqlaydi,
 * lekin taqiq faqat hujjatda tursa mexanik emas. Endi mexanik.
 */
describe('pul-formati lokaldan MUSTAQIL qoladi (reja §2.5 qulfi)', () => {
  it("formatMoney still pins 'ru-RU' (moysklad parity, NOT a locale bug)", () => {
    const src = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'design-system',
        'src',
        'lib',
        'format.ts',
      ),
      'utf8',
    );
    expect(src).toContain("wholes.toLocaleString('ru-RU')");
    expect(src).not.toContain('useBcp47');
  });

  it("pos-rate-chip still pins 'ru-RU'", () => {
    const src = readFileSync(join(WEB_SRC, 'components/pos/pos-rate-chip.tsx'), 'utf8');
    expect(src).toContain("toLocaleString('ru-RU')");
  });
});

// ---------------------------------------------------------------------------
// Helper shartnomasi
// ---------------------------------------------------------------------------
describe('useBcp47 helper — Locale → BCP-47 xaritasi', () => {
  it('maps every locale in i18n/config to a language-region tag', async () => {
    const { locales } = await import('@/i18n/config');
    const { BCP47 } = await import('@/lib/i18n-format');
    for (const l of locales) {
      expect(BCP47[l], `xaritada yo'q: ${l}`).toMatch(BCP47_RE);
    }
    expect(BCP47.uz).toBe('uz-UZ');
    expect(BCP47.ru).toBe('ru-RU');
  });
});
