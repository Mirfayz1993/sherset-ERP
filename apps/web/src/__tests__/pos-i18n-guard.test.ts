import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * POS i18n guard (Faza 32 / `FE-08`).
 *
 * Two invariants, both of which the pre-existing gates MISS:
 *
 *  1. **Key existence for components.** `i18n-key-existence.test.ts` walks
 *     `app/(app)` only — `src/components/**` is never scanned. The POS payment
 *     flow lives almost entirely in `components/pos/*`, so a `t('typo_key')`
 *     there shipped as a raw key string on the cashier's screen with every gate
 *     green. This file resolves every POS `t()` reference in BOTH locales.
 *
 *  2. **No hardcoded user-facing text.** `i18n-no-hardcoded.test.ts` only
 *     probes `<route>/{new,[id]}/page.tsx` for a registry of document forms, so
 *     `/sotuv` (a single `page.tsx`) and the POS dialogs were outside it
 *     entirely. Before this phase the POS screen was hardcoded Uzbek-latin: a
 *     cashier switching the app to RU kept seeing «Smena yopish», «Qaytim»,
 *     «Omborchiga yuborish».
 *
 * The hardcoded scan is deliberately POSITION-BASED, not word-based: it looks
 * only where user-visible text can appear (JSX text nodes, user-facing props,
 * toast/alert/Error arguments). Test-ids, query keys, API paths and CSS class
 * names are structurally excluded rather than allow-listed one by one, so the
 * guard cannot be defeated by renaming a `data-test-id`.
 */

const SRC = join(__dirname, '..');
const RU = JSON.parse(readFileSync(join(SRC, 'messages', 'ru.json'), 'utf8'));
const UZ = JSON.parse(readFileSync(join(SRC, 'messages', 'uz.json'), 'utf8'));

const POS_FILES = [
  join(SRC, 'app', '(app)', 'sotuv', 'page.tsx'),
  // F1 (POS redizayn) — page.tsx dan ajratilgan rejim-komponentlar ham POS
  // yuzasi: ular ro'yxatga kirmasa, ko'chirilgan matn qo'riqchidan chiqib qolardi.
  join(SRC, 'app', '(app)', 'sotuv', '_components', 'smena-mode.tsx'),
  join(SRC, 'app', '(app)', 'sotuv', '_components', 'cheklar-mode.tsx'),
  join(SRC, 'app', '(app)', 'sotuv', '_components', 'zakazlar-mode.tsx'),
  join(SRC, 'app', '(app)', 'sotuv', '_components', 'navbat-mode.tsx'),
  join(SRC, 'app', '(app)', 'sotuv', '_components', 'sotuv-mode.tsx'),
  join(SRC, 'app', '(app)', 'sotuv', '_components', 'use-print-outcome.ts'),
  join(SRC, 'components', 'pos', 'cash-out-dialog.tsx'),
  join(SRC, 'components', 'pos', 'debt-payment-dialog.tsx'),
  join(SRC, 'components', 'pos', 'payment-dialog.tsx'),
  join(SRC, 'components', 'pos', 'rasmilashtirish-modal.tsx'),
  // F2 (POS redizayn) — sidebar/header qobiq komponentlari.
  join(SRC, 'components', 'pos', 'pos-sidebar.tsx'),
  join(SRC, 'components', 'pos', 'pos-header.tsx'),
  // F6 (POS redizayn) — headerga singdirilgan oyna-tugmalari.
  join(SRC, 'components', 'pos', 'window-controls.tsx'),
  // F8 (POS redizayn) — kassir-tanlash ekrani (ko'p-kassir).
  join(SRC, 'components', 'pos', 'cashier-select-screen.tsx'),
  // A1 (2026-08-25) — «Mijozlar» tabi endi PUL YO'LI ham (G1 vozvrat to'lovi,
  // A1 avans qabuli). Ro'yxatga qo'shilmasa yangi kalitlar va matnlar
  // qo'riqchidan chetda qolardi — aynan shu fayl uchun mo'ljallangan bug-klass.
  join(SRC, 'components', 'pos', 'customers-panel.tsx'),
  // FAZA 1 (kassa ikki tilli, 2026-09-01) — kioskdagi til almashtirgich.
  // Ikkala reyestrga ham kiradi: bu yerda kalit MAVJUDLIGI (uz+ru) tekshiriladi,
  // `i18n-no-hardcoded.test.ts` da esa AST bo'yicha hardcoded matn. Yangi
  // kalitlar (`pages.pos.language`, `pages.pos.locale_change_failed`) shu
  // qatorsiz faqat bitta bandlda qolib ketishi mumkin edi.
  join(SRC, 'components', 'pos', 'pos-locale-toggle.tsx'),
];

const rel = (f: string) => f.replace(SRC, 'src').replace(/\\/g, '/');

function lookup(bundle: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], bundle);
}

/** Strip block comments (keeping line count) and line comments. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1) => p1);
}

// ── 1. Key existence ────────────────────────────────────────────────────────

interface Ref {
  file: string;
  line: number;
  key: string;
}

/**
 * Collect `const <name> = useTranslations('<ns>')` bindings, then every
 * `<name>('key')` call resolved against its namespace. Template literals and
 * variable keys are dynamic — counted, not resolved (reported so the coverage
 * gap is never silent).
 */
function collectRefs(file: string): { refs: Ref[]; dynamic: number } {
  const src = stripComments(readFileSync(file, 'utf8'));
  const ns = new Map<string, string>();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)) {
    const [, name, namespace] = m;
    if (name && namespace) ns.set(name, namespace);
  }
  const refs: Ref[] = [];
  let dynamic = 0;
  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length;
  for (const [name, namespace] of ns) {
    const call = new RegExp(`\\b${name}\\(\\s*(?:'([^']+)'|\`([^\`]*)\`|([A-Za-z_$][\\w$]*))`, 'g');
    for (const m of src.matchAll(call)) {
      if (m[1]) refs.push({ file, line: lineOf(m.index), key: `${namespace}.${m[1]}` });
      else dynamic++;
    }
  }
  return { refs, dynamic };
}

describe('POS i18n — every t() key resolves in ru AND uz', () => {
  const all: Ref[] = [];
  let dynamicTotal = 0;
  for (const file of POS_FILES) {
    const { refs, dynamic } = collectRefs(file);
    all.push(...refs);
    dynamicTotal += dynamic;
  }

  it('scans the whole POS surface (page + dialogs), not just the route', () => {
    // Guards against the file list silently shrinking to nothing.
    expect(all.length).toBeGreaterThan(100);
    const filesWithRefs = new Set(all.map((r) => r.file));
    // Every POS file must contribute — a file that stops using t() has either
    // been re-hardcoded or dropped from the list.
    for (const f of POS_FILES) {
      expect(filesWithRefs, `no t() calls found in ${rel(f)}`).toContain(f);
    }
    // Dynamic keys (`t(\`type_${kind}\`)`) cannot be resolved statically — held
    // to a hard ceiling so the checked surface can never quietly become dynamic.
    expect(dynamicTotal, 'too many dynamic t() keys — coverage is going dark').toBeLessThanOrEqual(
      3,
    );
  });

  it('has no missing keys', () => {
    const missing = all
      .filter((r) => lookup(RU, r.key) === undefined || lookup(UZ, r.key) === undefined)
      .map((r) => {
        const where = [
          lookup(RU, r.key) === undefined ? 'ru' : null,
          lookup(UZ, r.key) === undefined ? 'uz' : null,
        ]
          .filter(Boolean)
          .join('+');
        return `${rel(r.file)}:${r.line}  ${r.key}  (missing in ${where})`;
      });
    expect(missing, `Unresolved POS i18n keys:\n${missing.join('\n')}`).toEqual([]);
  });
});

// ── 2. No hardcoded user-facing text ────────────────────────────────────────

/**
 * Non-UI string literals that legitimately carry Uzbek words. Kept tiny and
 * justified — anything added here must be text the USER NEVER SEES.
 */
const ALLOWED_NON_UI = new Set([
  // Document description persisted in the DB. Localising it would make the
  // same document read differently depending on which cashier created it,
  // breaking search and reports. See the comment at the call site.
  'POS qaytarish',
]);

const CYRILLIC = /[А-Яа-яЁё]/;
/** Uzbek-latin markers, matched as whole words inside user-facing text only. */
const UZ_WORD =
  /\b(?:va|yoki|uchun|bilan|yo'q|bor|kerak|xato|xatolik|saqla|saqlash|saqlandi|bekor|qilish|qilindi|tanla|tanlang|tanlash|kiriting|qo'sh|qo'shing|topilmadi|topildi|mavjud|jami|summa|summasi|miqdor|miqdori|narx|narxi|chegirma|mijoz|mijozni|omborchi|omborchiga|kassa|kassir|kassadan|to'lov|to'lovi|to'la|qarz|qarzga|naqd|karta|chek|cheklar|savat|savatni|mahsulot|tovar|tovarlar|buyurtma|hujjat|sana|izoh|nomi|soni|dona|smena|smenani|ochish|yopish|yopildi|ochildi|tasdiq|tasdiqlash|o'chirish|tahrir|qidirish|qidiruv|yuklanmoqda|yuklandi|kutilmoqda|amalga|oshirildi|ruxsat|parol|kirish|chiqish|foydalanuvchi|xodim|sotuv|sotuvlar|sotildi|qaytarish|qaytarildi|qaytim|hisobot|filial|ombor|yacheyka|skaner|barkod|shtrix|birlik|valyuta|so'm|kun|oy|yil|soat|daqiqa|hammasi|barcha|boshqa|yangi|eski|joriy|oldingi|keyingi|kamomad|ortiqcha|farq|inkassatsiya|xarajat|kirim|chiqim|yuborish|yuborildi|chiqarish|yig'ilmoqda|tayyor|jarayonda)\b/i;

interface Leak {
  file: string;
  line: number;
  kind: 'cyrillic' | 'uzbek';
  where: string;
  text: string;
}

/** Props whose value is rendered to the user. */
const UI_PROPS =
  /\b(placeholder|title|aria-label|alt|label|confirmLabel|cancelLabel|successMessage|errorMessage)\s*=\s*(["'])([^"'\n]{2,})\2/g;
/** Functions whose first string argument is shown to the user. */
const UI_CALLS =
  /\b(?:toast(?:\.\w+)?|alert|confirm|new Error)\s*\(\s*(["'])((?:\\.|(?!\1)[^\\\n]){2,})\1/g;
/**
 * JSX text node: `>text<` with no braces/tags inside.
 *
 * The `>` that closes a TS generic looks identical to a JSX tag close
 * (`useState<'savat' | 'smena'>('savat')` → the scanner read `('savat');…` as
 * screen text and reported a phantom leak). Code fragments are rejected below
 * by shape — `;`/`=` never appear in a rendered text node, and a node never
 * opens with `(`. Apostrophes are deliberately NOT excluded: «Do'kon», «yo'q»
 * are exactly the Uzbek spellings this guard exists to catch.
 */
const JSX_TEXT = />\s*([^<>{}\n][^<>{}]*?)\s*</g;
const CODE_SHAPE = /[;=]/;

function scanUserFacing(file: string): Leak[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length;
  const leaks: Leak[] = [];
  const push = (where: string, idx: number, raw: string) => {
    const text = raw.trim();
    if (text.length < 2 || ALLOWED_NON_UI.has(text)) return;
    // Pure punctuation / emoji / numbers carry no language.
    if (!/[A-Za-zА-Яа-яЁё]/.test(text)) return;
    if (CYRILLIC.test(text)) leaks.push({ file, line: lineOf(idx), kind: 'cyrillic', where, text });
    else if (UZ_WORD.test(text))
      leaks.push({ file, line: lineOf(idx), kind: 'uzbek', where, text });
  };

  for (const m of src.matchAll(UI_PROPS)) push(`prop:${m[1] ?? '?'}`, m.index, m[3] ?? '');
  for (const m of src.matchAll(UI_CALLS)) push('call', m.index, m[2] ?? '');
  for (const m of src.matchAll(JSX_TEXT)) {
    const text = (m[1] ?? '').trim();
    if (CODE_SHAPE.test(text) || text.startsWith('(')) continue;
    push('jsx-text', m.index, text);
  }
  return leaks;
}

describe('POS i18n — no hardcoded user-facing RU/UZ text', () => {
  it('detects a hardcoded label (the guard actually bites)', () => {
    // Sanity: the scanner must fire on the shapes this phase removed.
    const probe = (s: string) => UZ_WORD.test(s) || CYRILLIC.test(s);
    for (const leak of ['Smena yopish', 'Omborchiga yuborish', 'Qaytim', 'Наличные']) {
      expect(probe(leak), leak).toBe(true);
    }
    // …and must NOT fire on structural strings.
    for (const ok of ['flex items-center', 'application/json', 'retail-sales']) {
      expect(probe(ok), ok).toBe(false);
    }
  });

  it('rejects TS-generic fragments but keeps real JSX text (regression)', () => {
    const isCode = (s: string) => CODE_SHAPE.test(s) || s.startsWith('(');
    // The false positive that made this guard read a generic close as screen text.
    expect(isCode("('savat');\n  const [search, setSearch] = useState('')")).toBe(true);
    // Real text nodes — including apostrophe spellings — must survive.
    for (const text of ["Do'kon", "Qarz yo'q", 'Qaytadi:', 'Mijoz (ixtiyoriy)']) {
      expect(isCode(text), text).toBe(false);
    }
  });

  it('has zero leaks across the POS surface', () => {
    const leaks = POS_FILES.flatMap(scanUserFacing).map(
      (l) => `[${l.kind}/${l.where}] ${rel(l.file)}:${l.line}  ${l.text}`,
    );
    expect(leaks, `Hardcoded POS strings:\n${leaks.join('\n')}`).toEqual([]);
  });
});
