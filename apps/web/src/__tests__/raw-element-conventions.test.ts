import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Raw form-element ban — permanent drift-lock (UI Convention 8).
 *
 * Bug-class (2026-06-11b migration): ~290 sites hand-rolled `<select>` (138),
 * `<textarea>` (31), `<input type="checkbox">` (42) and other `<input>`s (83)
 * with ~30 divergent className shapes for the SAME roles (filter select/input,
 * document description, boolean field) — heights drifted h-6/h-7/h-8/h-9/h-11,
 * focus rings mixed brand/border-focus, radii mixed sm/default/lg/xl. Migrated
 * to the DS primitives (`NativeSelect` / `Textarea` / `Checkbox` / `Input` from
 * '@moysklad/ui'), which provide the canonical look by construction.
 *
 * This guard locks:
 *   1. NO new raw `<select>` / `<textarea>` / `<input type="checkbox">` and NO
 *      raw `<input>` of the migrated types in apps/web/src outside the EXEMPT
 *      registries below;
 *   2. the scanner itself flags a synthetic offender (non-vacuous);
 *   3. migrated adoption floors (the import counts can only grow);
 *   4. DS Checkbox keeps its `indeterminate` rendering (Minus icon + filled box)
 *      — hr/employees select-all relies on it (was a ref-based native
 *      `.indeterminate` before the migration).
 *
 * Comments are stripped before scanning — two files mention raw input tags in
 * JSDoc (productions/[id] `isoToLocal`, analitika/kontragentlar `toISODate`);
 * prose must not trip the ban.
 *
 * EXEMPT registries (each entry has a concrete reason — shrink, don't grow):
 *   - permission-matrix.tsx `<select>`: per-value ordinal SCOPE_TONE palette on
 *     a dense matrix pill-select — pending DS/product decision (_UI-CONVENTIONS
 *     Conv-6 EXEMPT).
 *   - role-multi-select.tsx `<input type="checkbox">`: decorative display-only
 *     checkbox INSIDE an option `<button>` row — Radix Checkbox is itself a
 *     <button>; button-in-button is invalid HTML.
 *   - EXEMPT_INPUT_TEXTNUM (text/number only): 8 document /new pages carry the
 *     h-6 w-24 currency-RATE micro-input inside a DocumentMetaField helper line
 *     (DS Input h-9 would not fit a helper caption — needs a DS size decision);
 *     saved-filters-pills' borderless inline-rename + pill-shaped new-pill
 *     input; retail/page.tsx POS register touch-skin (h-11 rounded-xl search,
 *     rounded-lg bg-input fields — deliberate POS density).
 *   - radio: the 6 segmented-toggle sites (counterparty-adjustments direction,
 *     label-templates page-size + barcode-format) were the "sr-only radio +
 *     styled box-label" idiom — NOT a RadioGroup dot-list — and had drifted
 *     between radius-sm/radius-default; consolidated onto DS `SegmentedControl`.
 *     hr/employees permissions stays a bespoke radio MATRIX (one dot-radio per
 *     table cell, shared row name) → EXEMPT_RADIO. file (5: hidden/`file:`
 *     pseudo pickers) → no DS FileInput.
 *
 * 2026-07-28 (MASTER-TODO #12) — the last 17 raw sites were resolved:
 *   - textarea (3) → DS `Textarea`; select (5) → DS `NativeSelect` (the two
 *     dense inline VAT cells keep an h-7 override, which twMerge honours).
 *   - input text/number (6) → DS `Input`. The demands / invoices-in /
 *     serial-numbers FILTER fields also dropped their hand-rolled `h-7` class:
 *     the audited sibling (cash-in) renders a bare `<Input>` inside
 *     `InlineFilterPanel.Field`, so those pages were the visual outliers.
 *   - input date (5) → DS `DatePicker` (a BANNED type — no exemptions). The two
 *     task fields used the "invisible native date input over a styled div"
 *     overlay; DatePicker's `trigger` prop expresses that directly, and the
 *     `showPicker()` workaround died with it — we now open OUR calendar, which
 *     is what moysklad shows, instead of the browser's native widget.
 *   - checkbox (7) → DS `Checkbox` in the established `<label><Checkbox/><span>`
 *     shape (103 existing call-sites).
 *   - radio (11 of 14) → DS `RadioGroup`, incl. three sites whose value-control
 *     sits INSIDE the option label — expressible because `RadioOption.label` is
 *     a ReactNode and the DS renders `<label htmlFor>`, so a click on the field
 *     still selects its option. `RadioOption.testId` was added to the DS for
 *     this (price-rate-dialog.test.tsx asserts `toBeChecked()` on the input).
 */

const SRC = join(__dirname, '..');

const EXEMPT_SELECT = ['analitika/sozlamalar/_components/permission-matrix.tsx'];
const EXEMPT_CHECKBOX = ['hr/employees/_components/role-multi-select.tsx'];
// The only raw radios left after the SegmentedControl migration: a permission
// MATRIX (one dot-radio per table cell, shared row name) — not the segmented
// single-select idiom SegmentedControl expresses, and not a RadioGroup list.
// hr/employees permissions = a bespoke radio MATRIX (one dot-radio per table
// cell). assortment bulk-actions = moysklad's #bulkEdit mass-edit + bulk-price
// forms, where a conditional value-control (MoneyInput / NativeSelect / Input)
// is interleaved DIRECTLY beneath the selected radio option; the flat RadioGroup
// dot-list renders options contiguously and cannot host these interleaved
// controls without breaking the moysklad-mirrored layout. (Simple boolean fields
// in the same form already use the DS RadioGroup; only the interleaved sets stay
// native.)
const EXEMPT_RADIO = [
  'hr/employees/[id]/permissions/page.tsx',
  'components/assortment/bulk-actions-dropdown.tsx',
  // product «Неснижаемый остаток» mode set — the SAME interleaved-control class
  // as bulk-actions, in its sibling-of-label variant: option 1 («Общий») shows
  // an `ml-auto` <Input> as a SIBLING of the label inside the option's flex row
  // (right-aligned to the card edge), and a conditional react-hook-form error
  // <p> renders BETWEEN option 1 and option 2. RadioGroup's `options` array can
  // host a control inside the label node (see currency-rate-modal /
  // price-rate-dialog / position-discount-menu, migrated 2026-07-28) but has no
  // slot for a sibling element or for content between two options.
  'components/products/product-form-left-cards.tsx',
];
const EXEMPT_INPUT_TEXTNUM = [
  'customer-orders/new/page.tsx',
  // demands/invoices-in/invoices-out/purchase-orders/purchase-returns/
  // sales-returns/supplies '/new' pages — their rate micro-inputs moved onto the
  // shared DS path during the 2026-07 sales-doc reworks (scan() finds no raw
  // text/number input in them any more); exemptions retired 2026-07-17.
  'components/customer-orders/saved-filters-pills.tsx',
  // moysklad «Выбор товара» modal: per-row h-6 w-20 quantity micro-input in a
  // dense product table (one per row) — same dense-numeric rationale as the
  // doc /new rate micro-input; a full DS Input row would break the table density.
  'components/products/product-select-modal.tsx',
  // moysklad «Проверить комплектацию» window: per-row h-6 w-24 «Количество по
  // факту» micro-input in the dense check table + the barcode-scan capture line
  // — same dense-numeric rationale as product-select-modal.
  'components/documents/completeness-check-modal.tsx',
  'retail/page.tsx',
  // /sotuv POS (sherset'ning o'z kassasi, 2026-08-01 da qaytarildi) —
  // `retail/page.tsx` bilan AYNAN bir xil sabab: teginish uchun mo'ljallangan
  // zich kassa terisi (miqdor/narx mikro-maydonlari, chegirma). Sahifa
  // sherset.biznesjon.uz bilan 1:1 saqlanadi, shuning uchun DS Input'ga
  // ko'chirish uni ataylab o'zgartirgan bo'lardi. Faqat text/number —
  // taqiqlangan turlar (date/password/…) yo'q.
  //
  // F1 (POS redizayn): `page.tsx` dagi barcha mikro-maydonlar rejim-
  // komponentlarga ko'chdi (kirim/chiqim summasi, yopish sanog'i, farq izohi —
  // smena; chek qidiruv, qaytarish miqdori — cheklar; chegirma — sotuv), sahifa
  // o'zi endi raw input tutmaydi va ro'yxatdan CHIQARILDI. Sabab o'zgargani
  // yo'q: teginish uchun zich kassa terisi.
  'app/(app)/sotuv/_components/smena-mode.tsx',
  'app/(app)/sotuv/_components/cheklar-mode.tsx',
  'app/(app)/sotuv/_components/sotuv-mode.tsx',
  // V2 — Vozvrat rejimi qidiruv maydoni: cheklar-mode'dagi chek-qidiruv bilan
  // AYNAN bir xil sabab (zich kassa terisi, 48px sensorli maydon, skaner Enter).
  'app/(app)/sotuv/_components/vozvrat-mode.tsx',
  'components/pos/rasmilashtirish-modal.tsx',
  // F2 — savat qatorining sensorli tahrir oynasi. Yagona maydon: numpad
  // yozadigan faol qiymat (`type="text"` ATAYLAB — `type="number"` oraliq
  // «1.» holatini yeydi va kasr miqdor kiritib bo'lmasdi, FE-02). DS Input
  // o'z paddingi/o'lchami bilan keladi, bu yerda esa maydon 3xl raqamli va
  // numpad grid'i bilan bir butun — `rasmilashtirish-modal.tsx` bilan
  // AYNAN bir xil sabab.
  'components/pos/cart-line-edit-modal.tsx',
];
// Types every site of which is migrated — banned outright, no exemptions.
const BANNED_INPUT_TYPES = [
  'date',
  'datetime-local',
  'time',
  'month',
  'search',
  'password',
  'email',
  'tel',
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.tsx') && !p.includes('__tests__') && !/\.test\.tsx$/.test(p))
    .map((p) => join(dir, p));
}

const files = tsxFiles(SRC);

type Offender = { file: string; family: string };

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Shared scanner — also exercised against a synthetic offender (non-vacuous). */
function scan(raw: string): string[] {
  const src = stripComments(raw);
  const found: string[] = [];
  if (/<select\b/.test(src)) found.push('select');
  if (/<textarea\b/.test(src)) found.push('textarea');
  // bound the attr window so a tag match can't span unrelated code
  if (/<input\b[\s\S]{0,400}?type="checkbox"/.test(src)) found.push('checkbox');
  if (/<input\b[\s\S]{0,400}?type="radio"/.test(src)) found.push('radio');
  for (const t of BANNED_INPUT_TYPES) {
    if (new RegExp(`<input\\b[\\s\\S]{0,400}?type="${t}"`).test(src)) found.push(`input:${t}`);
  }
  if (/<input\b[\s\S]{0,400}?type="(text|number)"/.test(src)) found.push('input:textnum');
  return found;
}

function offenders(): Offender[] {
  const out: Offender[] = [];
  for (const f of files) {
    const rel = f.replaceAll('\\', '/');
    const fams = scan(readFileSync(f, 'utf8'));
    for (const fam of fams) {
      if (fam === 'select' && EXEMPT_SELECT.some((e) => rel.endsWith(e))) continue;
      if (fam === 'checkbox' && EXEMPT_CHECKBOX.some((e) => rel.endsWith(e))) continue;
      if (fam === 'radio' && EXEMPT_RADIO.some((e) => rel.endsWith(e))) continue;
      if (fam === 'input:textnum' && EXEMPT_INPUT_TEXTNUM.some((e) => rel.endsWith(e))) continue;
      out.push({ file: rel.slice(rel.indexOf('src/') + 4), family: fam });
    }
  }
  return out;
}

describe('raw-element ban (select / textarea / checkbox / input types)', () => {
  it('no raw form elements outside the EXEMPT registries', () => {
    expect(offenders()).toEqual([]);
  });

  it('the scanner flags a synthetic offender for every family (non-vacuous)', () => {
    expect(scan('<select value={x} onChange={f}><option/></select>')).toContain('select');
    expect(scan('<textarea value={x} />')).toContain('textarea');
    expect(scan('<input\n  type="checkbox"\n  checked={x}\n/>')).toContain('checkbox');
    expect(scan('<input type="radio" name="x" checked={x} />')).toContain('radio');
    expect(scan('<select\n  value={x}\n>')).toContain('select');
    expect(scan('<input type="date" value={x} />')).toContain('input:date');
    expect(scan('<input\n  type="text"\n  value={x}\n/>')).toContain('input:textnum');
    expect(scan('<input type="number" value={x} />')).toContain('input:textnum');
  });

  it('comments mentioning raw tags do NOT trip the scan (productions/analitika JSDoc class)', () => {
    expect(scan('// For <input type="date"> value: LOCAL YYYY-MM-DD')).toEqual([]);
    expect(scan('/** ISO datetime → for <input type="datetime-local">. */')).toEqual([]);
    expect(scan('{/* a <select> goes here later */}')).toEqual([]);
  });

  it('EXEMPT files still contain exactly the element they are exempted for', () => {
    // if an exempt site gets migrated, DELETE its registry entry (don't let it rot)
    const mustContain = (list: string[], fam: string) => {
      for (const e of list) {
        const f = files.find((p) => p.replaceAll('\\', '/').endsWith(e));
        expect(f, `exempt file missing: ${e}`).toBeTruthy();
        expect(
          scan(readFileSync(f as string, 'utf8')),
          `${e} no longer needs its exemption`,
        ).toContain(fam);
      }
    };
    mustContain(EXEMPT_SELECT, 'select');
    mustContain(EXEMPT_CHECKBOX, 'checkbox');
    mustContain(EXEMPT_RADIO, 'radio');
    mustContain(EXEMPT_INPUT_TEXTNUM, 'input:textnum');
  });
});

describe('DS-primitive adoption floors (imports from @moysklad/ui)', () => {
  const counts = { NativeSelect: 0, Textarea: 0, Checkbox: 0, Input: 0, SegmentedControl: 0 };
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const names = src.match(/import \{([^}]+)\} from '@moysklad\/ui';/)?.[1] ?? '';
    for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
      if (new RegExp(`\\b${name}\\b`).test(names)) counts[name]++;
    }
  }
  it('NativeSelect adopted by ≥ 90 files (was ~6 pre-migration)', () => {
    expect(counts.NativeSelect).toBeGreaterThanOrEqual(90);
  });
  it('Textarea adopted by ≥ 28 files', () => {
    expect(counts.Textarea).toBeGreaterThanOrEqual(28);
  });
  it('Checkbox adopted by ≥ 18 files', () => {
    expect(counts.Checkbox).toBeGreaterThanOrEqual(18);
  });
  it('Input adopted by ≥ 90 files', () => {
    expect(counts.Input).toBeGreaterThanOrEqual(90);
  });
  it('SegmentedControl adopted by the 4 segmented-toggle pages', () => {
    // counterparty-adjustments {new,[id]} + label-templates {new,[id]}
    expect(counts.SegmentedControl).toBeGreaterThanOrEqual(4);
  });
});

describe('DS Checkbox indeterminate contract (hr/employees select-all depends on it)', () => {
  const dsCheckbox = readFileSync(
    join(SRC, '..', '..', '..', 'packages', 'design-system', 'src', 'primitives', 'Checkbox.tsx'),
    'utf8',
  );
  it('renders Minus for indeterminate and fills the box', () => {
    expect(dsCheckbox).toContain("checked === 'indeterminate'");
    expect(dsCheckbox).toContain('Minus');
    expect(dsCheckbox).toContain('data-[state=indeterminate]:bg-[var(--ms-action-primary)]');
  });
  it('hr/employees select-all passes the indeterminate third state', () => {
    const page = readFileSync(join(SRC, 'app', '(app)', 'hr', 'employees', 'page.tsx'), 'utf8');
    expect(page).toContain("'indeterminate'");
    expect(page).not.toContain('el.indeterminate');
  });
});
