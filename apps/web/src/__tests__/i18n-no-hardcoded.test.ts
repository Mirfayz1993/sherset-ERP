import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * i18n no-hardcoded gate for COMPLETED document forms (regression guard).
 *
 * Once a document form (`/new` + `/[id]`) has been internationalised, it must
 * stay that way: no hardcoded Russian (Cyrillic) or Uzbek-latin user-facing
 * strings may creep back in. This test asserts that invariant over an explicit
 * registry of done forms (it grows as each group is completed). In-progress
 * forms are intentionally NOT listed, so the gate never false-fails on
 * known-incomplete work — the registry is the single source of truth for "done".
 *
 * Cyrillic in a finished form (after comment-stripping) is, by construction, a
 * leak — every user-facing string goes through t(). Uzbek-latin is detected via
 * a small high-signal marker list (those words only appear in un-i18n'd source).
 */

const APP = join(__dirname, '..', 'app', '(app)');

// Completed document-form groups — both /new and /[id] are checked per route.
const DONE_ROUTES = [
  // money
  'cash-in',
  'cash-out',
  'payments-in',
  'payments-out',
  'prepayments',
  'prepayment-returns',
  'counterparty-adjustments',
  // sales
  'customer-orders',
  'demands',
  'invoices-out',
  'sales-returns',
  // purchase
  'supplies',
  'purchase-orders',
  'invoices-in',
  'purchase-returns',
  // inventory
  'moves',
  'losses',
  'enters',
  'inventories',
  'internal-orders',
  // production
  'processings',
  'processing-orders',
  'productions',
  'production/work-orders',
  'production/boms',
  'production/processes',
  'production/stages',
  // catalog items (Cohort F)
  'bundles',
  'services',
  'variants',
  'tracking-codes',
  // crm (Cohort G)
  'opportunities',
  'pipelines',
  'contact-persons',
  'tasks',
  // e-commerce / pricing (Cohort H)
  'ecommerce/channels',
  'ecommerce/orders',
  'discounts',
  'price-lists',
  // hr
  'payrolls',
  'hr/employees',
  // analytics (Cohort J)
  'analitika/buyurtmalar',
  'analitika/kontragentlar',
  'analitika/xodimlar',
  // settings-finance (Cohort K)
  'settings/bank-accounts',
  'settings/cash-desks',
  'settings/expense-items',
  'settings/tax-rates',
  'settings/price-types',
  // settings-org (Cohort L)
  'settings/organizations',
  'settings/regions',
  'settings/custom-entities',
  'settings/publications',
  'settings/label-templates',
  'settings/users',
  'analitika/sozlamalar/rollar',
];

// Completed SINGLE-page routes (no /new + /[id] split — the route's own
// page.tsx is the form). Added 2026-06-11 with the /labels/print whole-page
// i18n: the DONE_ROUTES loop only probes `<route>/{new,[id]}/page.tsx`, so a
// plain page could never be registered before this list existed.
const DONE_PAGES = ['labels/print', 'settings/profile'];

// Source-only Uzbek markers: these words appear in un-i18n'd hardcoded strings,
// never after wiring (placeholders/labels become tForm/tFields calls).
const UZ_MARKERS = [
  'tanlang',
  'tanlash',
  'Yangi kontragent',
  'Yangi loyiha',
  "qo'shing",
  'kutyapmiz',
  'provedeno qiling',
  'Hujjatni saqlang',
  'Avval ',
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1) => p1);
}

interface Leak {
  file: string;
  line: number;
  snippet: string;
  kind: 'cyrillic' | 'uzbek';
}

/**
 * Blank out regex literals that are syntactically consumed as MATCHERS
 * (MASTER-TODO #17, 2026-07-28).
 *
 * The scanner is line-granular and syntax-blind: any Cyrillic codepoint on a
 * line is reported as a hardcoded label. That is right for a string literal and
 * wrong for a pattern that MATCHES SERVER DATA and is never rendered — e.g.
 * supplies picks the retail price type with
 *   items.find((t) => /sotil|розничн|retail|продaж/i.test(t.name))
 * where «розничн» must be Cyrillic precisely because the seeded price type is
 * «Розничная цена». Localising it would BREAK the match.
 *
 * Narrow on purpose: only a `/…/flags` immediately consumed by `.test(`/`.exec(`
 * or passed as the first argument of a String matcher is blanked. A Cyrillic
 * STRING literal anywhere on the line is still reported, so the guard keeps its
 * full power over real labels.
 */
const RE_BODY = String.raw`(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+`;
const RE_TEST_EXEC = new RegExp(`/${RE_BODY}/[dgimsuvy]*(?=\\s*\\.\\s*(?:test|exec)\\s*\\()`, 'g');
const RE_STR_METHOD = new RegExp(
  `(\\.\\s*(?:match|matchAll|replace|replaceAll|split|search)\\s*\\(\\s*)/${RE_BODY}/[dgimsuvy]*`,
  'g',
);

function stripRegexMatchers(line: string): string {
  return line.replace(RE_TEST_EXEC, '/RE/').replace(RE_STR_METHOD, '$1/RE/');
}

function scan(file: string): Leak[] {
  const raw = readFileSync(file, 'utf8');
  const stripped = stripComments(raw);
  const leaks: Leak[] = [];
  const lines = stripped.split('\n').map(stripRegexMatchers);
  lines.forEach((line, i) => {
    if (/[А-Яа-яЁё]/.test(line)) {
      leaks.push({ file, line: i + 1, snippet: line.trim().slice(0, 100), kind: 'cyrillic' });
    } else if (UZ_MARKERS.some((m) => line.includes(m))) {
      leaks.push({ file, line: i + 1, snippet: line.trim().slice(0, 100), kind: 'uzbek' });
    }
  });
  return leaks;
}

describe('stripRegexMatchers — narrow enough to keep the guard sharp', () => {
  it('blanks a Cyrillic pattern that only MATCHES data (.test / .exec)', () => {
    const line = 'items.find((t) => /sotil|розничн|retail|продаж/i.test(t.name))';
    expect(/[А-Яа-яЁё]/.test(stripRegexMatchers(line))).toBe(false);
  });

  it('blanks a Cyrillic pattern passed to a String matcher', () => {
    expect(/[А-Яа-яЁё]/.test(stripRegexMatchers("s.replace(/сум/g, '')"))).toBe(false);
    expect(/[А-Яа-яЁё]/.test(stripRegexMatchers('s.split(/из/)'))).toBe(false);
  });

  it('STILL reports a real hardcoded label (the bug this file exists for)', () => {
    for (const leak of [
      '<span>Розничная цена</span>',
      "const label = 'Оплачено';",
      'placeholder="Контрагент"',
      // a regex that is NOT consumed as a matcher is not a matcher
      'const RE = /Наименование/;',
      // …and a label sitting on the same line as a legitimate matcher must
      // still be caught, or the strip would become a loophole.
      "/розничн/i.test(t.name) ? 'Розничная' : ''",
    ]) {
      expect(/[А-Яа-яЁё]/.test(stripRegexMatchers(leak)), leak).toBe(true);
    }
  });
});

describe('i18n no-hardcoded (completed document forms)', () => {
  const checked: string[] = [];
  const allLeaks: Leak[] = [];
  for (const route of DONE_ROUTES) {
    for (const variant of ['new', '[id]']) {
      const file = join(APP, route, variant, 'page.tsx');
      if (!existsSync(file)) continue;
      checked.push(`${route}/${variant}`);
      allLeaks.push(...scan(file));
    }
  }
  for (const route of DONE_PAGES) {
    const file = join(APP, route, 'page.tsx');
    if (!existsSync(file)) continue;
    checked.push(route);
    allLeaks.push(...scan(file));
  }

  it('finds every registered single-page route (no silent skips)', () => {
    for (const route of DONE_PAGES) {
      expect(checked, `DONE_PAGES route missing on disk: ${route}`).toContain(route);
    }
  });

  it('checks every completed document form', () => {
    // 19 routes × 2 variants = 38 expected
    expect(checked.length).toBeGreaterThanOrEqual(36);
  });

  it('has zero hardcoded RU/UZ literals', () => {
    const report = allLeaks.map(
      (l) => `[${l.kind}] ${l.file.replace(APP, '(app)')}:${l.line}  ${l.snippet}`,
    );
    expect(report, `Hardcoded strings in completed forms:\n${report.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POS (kassa) no-hardcoded guard — FAZA P8, 2026-08-12
// ---------------------------------------------------------------------------
/**
 * Nega ALOHIDA skaner (yuqoridagi qator-skanerni qayta ishlatmasdan).
 *
 * Yuqoridagi guard ikki narsani qidiradi: kirill harflar va qisqa UZ-marker
 * ro'yxati. POS ekranlari esa **o'zbek-lotin** da yozilgan edi — u yerda kirill
 * ham, marker so'zlar ham yo'q, ya'ni qator-skaner POS'ni ko'rgan taqdirda ham
 * hech nima topmasdi (yolg'on qo'riqchi). Shuning uchun bu yerda **sintaksis**
 * bo'yicha ishlaydigan skaner turadi: TypeScript parseri bilan AYNAN
 * foydalanuvchiga chiqadigan pozitsiyalar tekshiriladi —
 *   1. JSX matn tugunlari (`<span>Matn</span>`);
 *   2. foydalanuvchi ko'radigan atributlar (`placeholder`, `title`, `label`…);
 *   3. xabar chaqiruvlari argumenti (`new Error(...)`, `toast.error(...)`,
 *      `setError(...)`, `alert(...)`).
 * `className` va boshqa uslub/texnik satrlar sintaktik jihatdan bu
 * pozitsiyalarga tushmaydi ⇒ tailwind yolg'on-pozitiv bermaydi (o'lchandi:
 * hozirgi POS daraxtida 0 yolg'on-pozitiv).
 *
 * Qamrov: `i18n-key-existence` kalit MAVJUDLIGINI tekshiradi, bu esa matn
 * umuman `t()` dan o'tganini — ikkovi birgalikda `i18n-gate-blind-to-components`
 * xotirasidagi ko'r zonani yopadi.
 */
const WEB_SRC = join(__dirname, '..');

/** i18n QILINGAN POS fayllari — ro'yxatga kirgan fayl ortga qaytmaydi. */
const POS_DONE_FILES = [
  'components/pos/cart-line-edit-modal.tsx',
  'components/pos/cash-out-dialog.tsx',
  'components/pos/customer-card-panel.tsx',
  'components/pos/customers-panel.tsx',
  'components/pos/debt-payment-dialog.tsx',
  'components/pos/payment-dialog.tsx',
  'components/pos/pin-keypad.tsx',
  // F2 (POS redizayn) — sidebar/header qobiq komponentlari.
  'components/pos/pos-sidebar.tsx',
  'components/pos/pos-header.tsx',
  // Kurs-chipi (egasi, 2026-08-17) — headerda dollar kursi + egaga tahrir.
  'components/pos/pos-rate-chip.tsx',
  // F6 (POS redizayn) — headerga singdirilgan oyna-tugmalari.
  'components/pos/window-controls.tsx',
  // F8 (POS redizayn) — kassir-tanlash ekrani (ko'p-kassir).
  'components/pos/cashier-select-screen.tsx',
  'components/pos/rasmilashtirish-modal.tsx',
  'components/pos/shell-version-badge.tsx',
  // K3 (bo'linadigan tovar) — kassirga bo'lak tarkibi va taklif.
  'components/pos/piece-offer-panel.tsx',
  // FAZA 1 (kassa ikki tilli, 2026-09-01) — kioskdagi til almashtirgich.
  // Faza 0 da yoyilgan qochish-qulfi bu faylni MEXANIK talab qiladi:
  // `components/pos/` ichidagi har bir `.tsx` shu ro'yxatda turishi shart.
  'components/pos/pos-locale-toggle.tsx',
  'app/(app)/sotuv/page.tsx',
  // F1 (POS redizayn) — page.tsx dan ajratilgan rejim-komponentlar.
  'app/(app)/sotuv/_components/smena-mode.tsx',
  'app/(app)/sotuv/_components/cheklar-mode.tsx',
  'app/(app)/sotuv/_components/zakazlar-mode.tsx',
  'app/(app)/sotuv/_components/navbat-mode.tsx',
  'app/(app)/sotuv/_components/sotuv-mode.tsx',
  'app/(app)/sotuv/_components/use-print-outcome.ts',
  'app/kassa-kirish/page.tsx',
];

/** Foydalanuvchi ko'radigan JSX atributlari. */
const POS_UI_ATTRS = new Set([
  'placeholder',
  'title',
  'aria-label',
  'alt',
  'label',
  'confirmText',
  'cancelText',
  'emptyText',
  'heading',
  'submitLabel',
  'cancelLabel',
  'okText',
  'tooltip',
  'hint',
]);

/** Argumenti ekranga chiqadigan chaqiruvlar. */
const POS_MSG_CALLS = new Set([
  'Error',
  'alert',
  'confirm',
  'setError',
  'setMessage',
  'toast.error',
  'toast.success',
  'toast.info',
  'toast.warning',
]);

/**
 * ATAYLAB i18n QILINMAYDIGAN satrlar — har biri sabab bilan.
 * Ro'yxatga qo'shish = qaror; jimgina o'tkazib yuborish emas.
 */
const POS_ALLOWED: Record<string, string> = {
  // Hujjatning DB'da saqlanadigan izohi (ekran matni EMAS). Kassirning tiliga
  // bog'lansa bir xil hujjat kim yaratganiga qarab turlicha yozilib qolardi va
  // hisobot/qidiruv buzilardi — `sotuv/page.tsx` dagi izohga qarang.
  'POS qaytarish': 'DB hujjat izohi, ekran matni emas',
  // F2 — header matn-logotipi. Brend nomi ikkala tilda ham AYNAN shu yozuvda
  // turadi (tarjima qilinsa brend buziladi); public/ da rasm-asset yo'q.
  SHERSET: 'brend logotipi — tarjima qilinmaydi',
};

interface PosLeak {
  file: string;
  line: number;
  kind: string;
  text: string;
}

function posCalleeName(node: ts.CallExpression | ts.NewExpression): string {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    const obj = ts.isIdentifier(e.expression) ? e.expression.text : '';
    return obj ? `${obj}.${e.name.text}` : e.name.text;
  }
  return '';
}

const hasLetter = (s: string) => /[A-Za-zА-Яа-яЁё]/.test(s);
const cleanJsxText = (s: string) =>
  s
    .replace(/&[a-zA-Z]+;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Sof funksiya — manba MATNI ustida ishlaydi, shuning uchun mutant-fikstura
 *  bilan sinash mumkin (guard'ning o'zi sinaladi, ishonch bilan emas). */
function scanPosSource(source: string, name: string): PosLeak[] {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const leaks: PosLeak[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (n: ts.Node, kind: string, raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (POS_ALLOWED[text]) return;
    leaks.push({ file: name, line: lineOf(n), kind, text: text.slice(0, 90) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = cleanJsxText(node.text);
      if (hasLetter(text)) push(node, 'jsx-text', text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      const p = node.parent;
      if (/[А-Яа-яЁё]/.test(text)) {
        push(node, 'cyrillic', text);
      } else if (ts.isJsxAttribute(p) && POS_UI_ATTRS.has(p.name.getText(sf)) && hasLetter(text)) {
        push(node, `attr:${p.name.getText(sf)}`, text);
      } else if (
        (ts.isCallExpression(p) || ts.isNewExpression(p)) &&
        POS_MSG_CALLS.has(posCalleeName(p)) &&
        hasLetter(text)
      ) {
        push(node, `msg:${posCalleeName(p)}`, text);
      }
    } else if (ts.isTemplateExpression(node)) {
      const chunks = [node.head, ...node.templateSpans.map((s) => s.literal)];
      const p = node.parent;
      const isMsg =
        (ts.isCallExpression(p) || ts.isNewExpression(p)) && POS_MSG_CALLS.has(posCalleeName(p));
      for (const c of chunks) {
        if (/[А-Яа-яЁё]/.test(c.text)) push(node, 'cyrillic', c.text);
        else if (isMsg && hasLetter(c.text)) push(node, `msg:${posCalleeName(p)}`, c.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaks;
}

describe('POS no-hardcoded scanner — the guard is itself guarded (mutants)', () => {
  it('CATCHES a hardcoded JSX text node', () => {
    const leaks = scanPosSource('const A = () => <span>Qarzni toʻlash</span>;', 'm.tsx');
    expect(leaks.map((l) => l.kind)).toContain('jsx-text');
  });

  it('CATCHES a hardcoded user-facing attribute', () => {
    const leaks = scanPosSource('const A = () => <input placeholder="Telefon raqam" />;', 'm.tsx');
    expect(leaks.map((l) => l.kind)).toContain('attr:placeholder');
  });

  it('CATCHES a hardcoded message argument (Error / toast / setError)', () => {
    expect(scanPosSource("throw new Error('mijoz tanlanmagan');", 'm.tsx')).toHaveLength(1);
    expect(scanPosSource("toast.error('Chek chop etilmadi');", 'm.tsx')).toHaveLength(1);
    expect(scanPosSource("setError('Smena yopilmagan');", 'm.tsx')).toHaveLength(1);
  });

  it('CATCHES Cyrillic anywhere', () => {
    expect(scanPosSource("const x = 'Розничная цена';", 'm.tsx')).toHaveLength(1);
  });

  it('does NOT flag tailwind classes, enums, api paths or t() calls', () => {
    const clean = [
      'const A = () => <div className="flex flex-1 items-center gap-2 border-emerald-400" />;',
      "const A = () => <span>{t('title')}</span>;",
      "api.get('/retail-sales?limit=20');",
      "const [f, setF] = useState<'cash' | 'card'>('cash');",
      "const A = () => <input placeholder={t('search_placeholder')} />;",
    ].join('\n');
    expect(scanPosSource(clean, 'm.tsx')).toEqual([]);
  });

  it('respects the documented allow-list (and only it)', () => {
    expect(scanPosSource("api.post('/x', { description: 'POS qaytarish' });", 'm.tsx')).toEqual([]);
    // yonidagi, ro'yxatda BO'LMAGAN matn hamon tutiladi
    expect(scanPosSource("toast.error('POS qaytarishda xato');", 'm.tsx')).toHaveLength(1);
  });
});

describe('POS (kassa) i18n — zero hardcoded user-facing text', () => {
  it('every registered POS file exists (no silent skip)', () => {
    for (const rel of POS_DONE_FILES) {
      expect(existsSync(join(WEB_SRC, rel)), `POS registry file missing: ${rel}`).toBe(true);
    }
  });

  /**
   * Reyestr TESHIGI qulfi: `components/pos/` ga YANGI fayl qo'shilsa, u
   * ro'yxatda bo'lmagani uchun skanerdan jimgina chetda qolardi — ya'ni
   * guard yangi kod uchun ishlamasdi. Shuning uchun papkadagi har bir
   * komponent ro'yxatda turishi SHART (yangi fayl qo'shgan odam uni ro'yxatga
   * ham qo'shadi yoki gate qizaradi).
   */
  it('no POS component escapes the registry (new files must be registered)', () => {
    const dir = join(WEB_SRC, 'components', 'pos');
    const onDisk = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.includes('.test.'))
      .map((e) => `components/pos/${e.name}`);
    const registry = new Set(POS_DONE_FILES);
    const unregistered = onDisk.filter((f) => !registry.has(f));
    expect(
      unregistered,
      `Unregistered POS components (add them to POS_DONE_FILES):\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('has zero hardcoded user-facing strings', () => {
    const leaks: PosLeak[] = [];
    for (const rel of POS_DONE_FILES) {
      const file = join(WEB_SRC, rel);
      if (!existsSync(file)) continue;
      leaks.push(...scanPosSource(readFileSync(file, 'utf8'), rel));
    }
    const report = leaks.map((l) => `[${l.kind}] ${l.file}:${l.line}  ${l.text}`);
    expect(report, `Hardcoded POS strings:\n${report.join('\n')}`).toEqual([]);
  });
});
