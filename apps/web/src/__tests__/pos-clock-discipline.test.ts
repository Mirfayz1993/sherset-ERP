import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * S-reja S4 — KASSA SOAT INTIZOMI QO'RIQCHISI
 * (`docs/plans/2026-09-04-kassa-vaqt-ishonchliligi.md`).
 *
 * ── QANDAY XATO-SINFLARINI QULFLAYDI
 *
 * Egasining shikoyati (2026-09-04): «kassada vaqt qurilma vaqti bilan
 * ishlayapti va qurilmada vaqt xato bo'lsa xato ko'rsatmoqda». S1–S4 uni uch
 * qatlamda yopdi. Bu qo'riqchi uchalasini ham MEXANIK qiladi — aks holda
 * qoidalar faqat rejada qolib, keyingi komponentda qaytadan buzilardi:
 *
 *   1. **Qurilma SOATI** — POS doirasida `new Date()` / `Date.now()` yo'q,
 *      o'rniga `serverNow()` (§2 qoida 4). Istisnolar oq ro'yxatda, SABAB bilan.
 *   2. **Qurilma MINTAQASI** — sana ustidagi `toLocale…` chaqiruvi `timeZone`siz
 *      qolmaydi (§1.3). Soati to'g'ri, mintaqasi xato mashinada sana bir KUNGA
 *      siljib ko'rinardi.
 *   3. **Qizil chiziq** — POS serverga `moment` YUBORMAYDI (§2 qoida 3). Bugun
 *      yubormaydi; bu tekshiruv «boshlab yuborilmasin» deb turadi.
 *
 * ── NEGA MAVJUD QO'RIQCHILARGA QO'SHILMADI
 *
 * `pos-bcp47-guard.test.ts` — LOKAL (til-mintaqa tegi) haqida, ya'ni butunlay
 * boshqa o'lchov: u `'uz-UZ'` ni tutadi, `timeZone` ning bor-yo'qligini emas.
 * Uning qamrovi ham boshqa (`app/kassa-kirish` bor, `lib/pos` va `app/print`
 * yo'q). Ikkisini birlashtirish har ikkalasining hisobotini ham tushunarsiz
 * qilardi. Alohida fayl — `pos-i18n-guard.test.ts` bilan bir xil sabab.
 *
 * ── USLUB
 *
 * `kassa-default-printer.test.ts` naqshi (manba-skaner + anti-vacuity), lekin
 * tekshiruv REGEX emas, TypeScript AST bo'yicha — `pos-bcp47-guard.test.ts`
 * dagidek. Sabab: shu faylning O'ZI izohlarda `new Date()` va `moment` ni
 * o'nlab marta eslatadi; regex skaner o'zidan-o'zi qizarardi. AST'da izoh
 * tugun emas, ya'ni `stripComments` ham keraksiz — izohlar hech qachon
 * tekshiruvga tushmaydi.
 */

const WEB_SRC = join(__dirname, '..');

/**
 * Kassa doirasi — vaqt SERVERNIKI bo'lishi shart bo'lgan yuzalar.
 *
 * `app/print/cash-in` va `cash-out` ham kiradi: ular QOG'OZ hujjat (PKO/RKO),
 * ya'ni xato sana mijozning qo'lida qoladi — eng qimmat xato sinfi (§5 S2).
 * `app/kassa-kirish` (login ekrani) ATAYLAB yo'q: unda sana ham, vaqt ham
 * chizilmaydi va u sessiyagacha ishlaydi, ya'ni skew hali o'lchanmagan.
 */
const CLOCK_SCAN_DIRS = [
  'app/(app)/sotuv',
  'components/pos',
  'lib/pos',
  'app/customer-display',
  'app/print/cash-in',
  'app/print/cash-out',
];

/**
 * QOIDA 1 ning oq ro'yxati — ATAYLAB qurilma soatida qolgan chaqiruvlar.
 *
 * 🔴 Ro'yxatga qo'shish = QAROR, jim o'tkazib yuborish emas. Mezon (§2 qoida 4):
 * qiymat EKRANGA yoki QOG'OZGA vaqt bo'lib chiqsa — serverniki bo'lishi shart;
 * bitta qurilmaning ichida qolsa (ikki nuqta orasidagi FARQ yoki
 * IDENTIFIKATOR) — qurilma soati yetarli va skew unga ta'sir qilmaydi.
 */
const CLOCK_ALLOWED: Record<string, string> = {
  'app/(app)/sotuv/_components/sotuv-mode.tsx':
    'NISBIY O`LCHOV: skaner «topilmadi» signalining 800 ms takror-oynasi ' +
    '(`now - last.at`). Ikki nuqta ham AYNI qurilmada olinadi, ya`ni skew ' +
    'ayirmada qisqaradi va natija o`zgarmaydi. Ekranga vaqt bo`lib chiqmaydi. ' +
    '`serverNow()` bu yerda faqat qimmatroq bo`lardi.',
  'lib/pos/cart-drafts.ts':
    'IDENTIFIKATOR: `newDraftId()` da `crypto.randomUUID` bo`lmasa zaxira ' +
    'kalit `Date.now().toString(36)` + tasodifdan yasaladi. Bu qoralamaning ' +
    'ICHKI kaliti — ekranda ham, serverda ham ko`rinmaydi (qoralama ' +
    '`localStorage` da qoladi). Vaqt manbasi almashsa kalitning ' +
    'takrorlanmasligi yaxshilanmaydi, faqat modul `lib/clock.ts` ga bog`lanib ' +
    'qolardi. S3 qabul mezoni buni ATAYLAB tegilmagan deb qulflagan.',
};

/**
 * 🔴 OQ RO'YXATGA TUSHMAGAN, TUZATILGAN nomzod (S4 qarori, hujjat sifatida):
 * `app/customer-display/page.tsx:344` — `?demo=1` ko'rgazma rejimida qoralama
 * «yoshi» (`Date.now() - DEMO_PARKED_AGO_MS`). Reja uni nisbiy o'lchov deb
 * oq ro'yxatga nomzod qilgan edi, lekin o'lchov ko'rsatdi: qiymat nisbiy
 * EMAS — `HoldCard` uni `toLocaleTimeString` bilan ABSOLYUT soat qilib
 * chizadi. Qurilma soati adashsa demo kartasi yonidagi sarlavha soatidan
 * (S1 — server vaqti) aynan skew qadar farq qilardi, ya'ni ko'rgazma rejimi
 * o'z-o'zi bilan ziddiyatda ko'rinardi. Shuning uchun `serverNow()` ga
 * o'tkazildi — haqiqiy qoralamalar ham (S3) shu manbadan.
 */

/** Sana ustida `timeZone` talab qilinadigan metodlar. */
const LOCALE_METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);

/**
 * `Intl.DateTimeFormat` opsiyalarining SANA/VAQT maydonlari.
 *
 * `toLocaleString` ni RAQAM chaqiruvidan ajratish uchun kerak (quyidagi
 * `isDateReceiver` ga qarang) — raqam opsiyalari (`maximumFractionDigits`,
 * `style: 'currency'`) bu ro'yxatga tushmaydi.
 */
const DATE_OPTION_KEYS = new Set([
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
  'dateStyle',
  'timeStyle',
  'hour12',
  'hourCycle',
  'calendar',
  'timeZone',
]);

interface ClockLeak {
  file: string;
  line: number;
  what: string;
}

const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const parse = (source: string, name: string): ts.SourceFile =>
  ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// ---------------------------------------------------------------------------
// QOIDA 1 — qurilma soati
// ---------------------------------------------------------------------------
/**
 * `new Date()` (ARGUMENTSIZ) va `Date.now()` ni tutadi.
 *
 * 🔴 `new Date(iso)` — argument BILAN — tutilmaydi va tutilmasligi kerak: u
 * qurilma soatini o'qimaydi, serverdan kelgan satrni parse qiladi. Aynan shu
 * shakl POS bo'ylab o'nlab joyda ishlatiladi (`new Date(sale.moment)`), ya'ni
 * farqni bilmaydigan skaner butunlay foydasiz shovqin bo'lardi.
 */
function scanDeviceClock(source: string, name: string): ClockLeak[] {
  const sf = parse(source, name);
  if (CLOCK_ALLOWED[name] !== undefined) return [];
  const leaks: ClockLeak[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'Date' && (node.arguments?.length ?? 0) === 0) {
        leaks.push({ file: name, line: lineOf(sf, node), what: 'new Date()' });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Date' &&
      node.expression.name.text === 'now'
    ) {
      leaks.push({ file: name, line: lineOf(sf, node), what: 'Date.now()' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaks;
}

// ---------------------------------------------------------------------------
// QOIDA 2 — qurilma mintaqasi
// ---------------------------------------------------------------------------
/**
 * Chaqiruv SANA ustidami yoki RAQAM ustidami?
 *
 * 🔴 Bu skanerning eng nozik joyi. `toLocaleString` ikkala sinfda ham bor va
 * POS'da to'rt joyda RAQAM uchun ishlatiladi (`sotuv-mode.tsx` — qoldiq,
 * `pos-rate-chip.tsx` — kurs, `receipt-model.ts` — miqdor,
 * `payment-dialog.tsx` — banknot nominali). Ularni ham tutsa qo'riqchi
 * shovqinga aylanardi: raqamda `timeZone` ning ma'nosi yo'q.
 *
 * Ajratish mezoni — ikkitadan biri yetarli:
 *   a) qabul qiluvchi `new Date(...)` (shakli o'zi aytib turibdi);
 *   b) opsiyalar obyektida SANA maydoni bor (`day`, `hour`, `dateStyle`…).
 *
 * `toLocaleDateString`/`toLocaleTimeString` esa `Number.prototype` da UMUMAN
 * yo'q — ular har doim sana, mezon talab qilmaydi.
 */
function isDateReceiver(call: ts.CallExpression, method: string): boolean {
  if (method !== 'toLocaleString') return true;
  const recv = (call.expression as ts.PropertyAccessExpression).expression;
  if (
    ts.isNewExpression(recv) &&
    ts.isIdentifier(recv.expression) &&
    recv.expression.text === 'Date'
  )
    return true;
  const opts = call.arguments[1];
  if (opts && ts.isObjectLiteralExpression(opts)) {
    return opts.properties.some(
      (p) => p.name !== undefined && ts.isIdentifier(p.name) && DATE_OPTION_KEYS.has(p.name.text),
    );
  }
  return false;
}

/** Sana ustidagi `toLocale…` chaqiruvi `timeZone`siz qolgan joylarni tutadi. */
function scanMissingTimeZone(source: string, name: string): ClockLeak[] {
  const sf = parse(source, name);
  const leaks: ClockLeak[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (LOCALE_METHODS.has(method) && isDateReceiver(node, method)) {
        const opts = node.arguments[1];
        const hasTz =
          opts !== undefined &&
          ts.isObjectLiteralExpression(opts) &&
          opts.properties.some(
            (p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'timeZone',
          );
        if (!hasTz) leaks.push({ file: name, line: lineOf(sf, node), what: `${method}(…)` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaks;
}

// ---------------------------------------------------------------------------
// QOIDA 3 — qizil chiziq: POS serverga `moment` yubormaydi
// ---------------------------------------------------------------------------
/**
 * Tana BILAN ketadigan `api` metodlari. `get` va `delete` ATAYLAB yo'q:
 * `sortBy=moment` GET parametri va javobni O'QISH bu qoidaning doirasida
 * emas (S2 hisobotining o'lchov usuli).
 */
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'postDownload', 'postOpenInBrowser']);

/**
 * `api.post(path, { … moment … })` shaklidagi YOZISHNI tutadi.
 *
 * §2 qoida 3: sotuv/qaytarish/kassa hujjatlarining `moment`ini SERVER qo'yadi
 * (`retail-sale.service.ts`). POS uni yuborishni boshlasa, kassa mashinasining
 * soati bazadagi savdo vaqtiga — smena jamlariga, kunlik hisobotlarga,
 * `document_sequences` ga — sizib kirardi. Bugun bunday yozuv YO'Q; qo'riqchi
 * shu holatni qulflaydi.
 *
 * Tekshiruv argument DARAXTI bo'yicha: `{ moment }` to'g'ridan-to'g'ri ham,
 * ichma-ich obyektda ham (`{ sale: { moment } }`) tutiladi.
 */
function scanMomentWrites(source: string, name: string): ClockLeak[] {
  const sf = parse(source, name);
  const leaks: ClockLeak[] = [];

  const findMoment = (node: ts.Node, out: ts.Node[]): void => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'moment'
    ) {
      out.push(node);
    }
    ts.forEachChild(node, (c) => findMoment(c, out));
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'api' &&
      WRITE_METHODS.has(node.expression.name.text)
    ) {
      const found: ts.Node[] = [];
      for (const arg of node.arguments) findMoment(arg, found);
      for (const f of found) {
        leaks.push({
          file: name,
          line: lineOf(sf, f),
          what: `api.${node.expression.name.text}(… moment …)`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaks;
}

// ---------------------------------------------------------------------------
// Skanerlanadigan fayllar
// ---------------------------------------------------------------------------
/**
 * Reyestr YO'Q — a'zolik mezoni «papkada turibdi» (`pos-bcp47-guard` naqshi):
 * yangi fayl qo'shgan odam hech nima qilmasa ham qo'riqchi ostiga tushadi.
 *
 * Testlar chiqarib tashlanadi: test faylida `new Date(2026, 8, 1)` fikstura
 * yasash yoki `vi.setSystemTime` bilan qurilma soatini siljitish — aynan shu
 * fazani TEKSHIRISH usuli. Chiqarish `__tests__` papkasi bo'yicha ham, fayl
 * nomi bo'yicha ham: `lib/pos` da testlar papkasiz, modul yonida turadi
 * (`receipt-model.test.ts`).
 */
function clockScannedFiles(): string[] {
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
  for (const dir of CLOCK_SCAN_DIRS) walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Qo'riqchining O'ZI sinaladi (mutantlar)
// ---------------------------------------------------------------------------
describe('soat intizomi skaneri — the guard is itself guarded', () => {
  it('QOIDA 1 tutadi: `new Date()` va `Date.now()`', () => {
    expect(scanDeviceClock('const a = new Date();', 'm.tsx').map((l) => l.what)).toEqual([
      'new Date()',
    ]);
    expect(scanDeviceClock('const t = Date.now();', 'm.tsx').map((l) => l.what)).toEqual([
      'Date.now()',
    ]);
    expect(scanDeviceClock('const a = 1;\nconst b = Date.now();', 'm.tsx')[0]?.line).toBe(2);
  });

  it('QOIDA 1 SANA-PARSE ni tutmaydi (`new Date(iso)` — qurilma soati emas)', () => {
    const clean = [
      'const d = new Date(sale.moment);',
      'const e = new Date(at);',
      'const f = new Date(2026, 8, 1);',
      'const g = serverNow();',
      'const h = new Date(d.getTime() + OFFSET);',
    ].join('\n');
    expect(scanDeviceClock(clean, 'm.tsx')).toEqual([]);
  });

  it('QOIDA 1 IZOHDAGI matnni tutmaydi (AST, regex emas)', () => {
    const src = '// ilgari bu yerda Date.now() turardi\n/* new Date() ham */\nconst a = 1;';
    expect(scanDeviceClock(src, 'm.tsx')).toEqual([]);
  });

  it('QOIDA 1 oq ro`yxatni hurmat qiladi — va FAQAT ro`yxatdagi faylni', () => {
    expect(scanDeviceClock('const t = Date.now();', 'lib/pos/cart-drafts.ts')).toEqual([]);
    expect(
      scanDeviceClock('const t = Date.now();', 'app/(app)/sotuv/_components/sotuv-mode.tsx'),
    ).toEqual([]);
    // qo'shni fayl — hamon tutiladi
    expect(scanDeviceClock('const t = Date.now();', 'lib/pos/cart-math.ts')).toHaveLength(1);
  });

  it('QOIDA 2 tutadi: `timeZone`siz sana formatlash', () => {
    const src = "const s = new Date(x).toLocaleDateString(bcp47, { day: '2-digit' });";
    expect(scanMissingTimeZone(src, 'm.tsx').map((l) => l.what)).toEqual(['toLocaleDateString(…)']);
    // opsiyasiz chaqiruv ham — `timeZone` berilmagan
    expect(scanMissingTimeZone('const s = d.toLocaleTimeString(bcp47);', 'm.tsx')).toHaveLength(1);
  });

  it('QOIDA 2 `timeZone` bo`lsa tutmaydi', () => {
    const ok = [
      "const s = new Date(x).toLocaleDateString(bcp47, { day: '2-digit', timeZone: POS_TZ });",
      "const u = d.toLocaleTimeString(bcp47, { hour: '2-digit', timeZone: POS_TZ });",
      "const v = new Date(x).toLocaleString('uz-UZ', { year: 'numeric', timeZone: POS_TZ });",
    ].join('\n');
    expect(scanMissingTimeZone(ok, 'm.tsx')).toEqual([]);
  });

  /**
   * 🔴 YOLG'ON-POZITIV QULFI. Bu to'rt qator POS'dagi HAQIQIY raqam
   * chaqiruvlari (reja §5 S4 da nomma-nom sanalgan). Skaner ularni tutsa
   * qo'riqchi shovqinga aylanardi va birinchi kunidayoq o'chirilardi.
   */
  it('QOIDA 2 RAQAM formatlashni tutmaydi (shovqin qulfi)', () => {
    const numbers = [
      'const a = onHand.toLocaleString(bcp47);',
      "const b = Number(whole).toLocaleString('ru-RU');",
      "const c = n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });",
      "const d = Number(v).toLocaleString('uz-UZ');",
      "const e = sum.toLocaleString(bcp47, { style: 'currency', currency: 'UZS' });",
    ].join('\n');
    expect(scanMissingTimeZone(numbers, 'm.tsx')).toEqual([]);
  });

  it('QOIDA 2 `new Date(...).toLocaleString` ni OPSIYASIZ ham sana deb biladi', () => {
    // Qabul qiluvchining shakli o'zi yetarli — opsiyalarga qaramaydi.
    expect(
      scanMissingTimeZone('const s = new Date(iso).toLocaleString(bcp47);', 'm.tsx'),
    ).toHaveLength(1);
  });

  it('QOIDA 3 tutadi: `api.post` tanasida `moment`', () => {
    const src = "await api.post('/retail-sales', { moment: now.toISOString(), lines });";
    expect(scanMomentWrites(src, 'm.tsx').map((l) => l.what)).toEqual(['api.post(… moment …)']);
    // ichma-ich obyektda ham
    expect(scanMomentWrites("api.put('/x', { sale: { moment: iso } });", 'm.tsx')).toHaveLength(1);
    // qisqartirilgan yozuv (`{ moment }`) ham
    expect(scanMomentWrites("api.patch('/x', { moment });", 'm.tsx')).toHaveLength(1);
  });

  it('QOIDA 3 O`QISHNI tutmaydi (`sortBy=moment`, javob, tip)', () => {
    const reads = [
      "api.get('/retail-sales?sortBy=moment&sortDir=desc');",
      'interface Row { moment: string }',
      'const label = fmt(sale.moment);',
      'const input = cartToProformaReceipt(cart, pct, { moment: now.toISOString() });',
      "api.delete('/x');",
    ].join('\n');
    expect(scanMomentWrites(reads, 'm.tsx')).toEqual([]);
  });

  /**
   * 🔴 ENG MUHIM MUTANTLAR: soxta buzilish HAQIQIY qo'riqlanadigan faylga
   * qo'shilsa gate qizarishi kerak. Yuqoridagilar skanerni o'z-o'zicha
   * sinaydi; bular BUTUN yo'lni — fayl ro'yxati + skaner — sinaydi. Shusiz
   * skaner to'g'ri ishlab, lekin hech bir haqiqiy faylni ko'rmayotgan
   * bo'lishi mumkin edi.
   */
  it('haqiqiy faylga qo`shilgan `Date.now()` gate`ni QIZARTIRADI', () => {
    const victim = 'app/(app)/sotuv/_components/cheklar-mode.tsx';
    expect(clockScannedFiles(), 'nishon fayl qamrovda emas').toContain(victim);

    const clean = readFileSync(join(WEB_SRC, victim), 'utf8');
    expect(scanDeviceClock(clean, victim), 'nishon fayl mutantsiz ham qizil').toEqual([]);

    const mutant = `${clean}\nconst FAKE = Date.now();\n`;
    expect(scanDeviceClock(mutant, victim).map((l) => l.what)).toEqual(['Date.now()']);
  });

  it('haqiqiy faylga qo`shilgan `timeZone`siz sana gate`ni QIZARTIRADI', () => {
    const victim = 'components/pos/customers-panel.tsx';
    expect(clockScannedFiles(), 'nishon fayl qamrovda emas').toContain(victim);

    const clean = readFileSync(join(WEB_SRC, victim), 'utf8');
    expect(scanMissingTimeZone(clean, victim), 'nishon fayl mutantsiz ham qizil').toEqual([]);

    const mutant = `${clean}\nconst FAKE = new Date(x).toLocaleDateString(bcp47, { day: '2-digit' });\n`;
    expect(scanMissingTimeZone(mutant, victim).map((l) => l.what)).toEqual([
      'toLocaleDateString(…)',
    ]);
  });

  it('haqiqiy faylga qo`shilgan `moment` yozuvi gate`ni QIZARTIRADI', () => {
    const victim = 'app/(app)/sotuv/page.tsx';
    expect(clockScannedFiles(), 'nishon fayl qamrovda emas').toContain(victim);

    const clean = readFileSync(join(WEB_SRC, victim), 'utf8');
    expect(scanMomentWrites(clean, victim), 'nishon fayl mutantsiz ham qizil').toEqual([]);

    const mutant = `${clean}\nasync function f() { await api.post('/retail-sales', { moment: now.toISOString() }); }\n`;
    expect(scanMomentWrites(mutant, victim)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Qamrov qulfi
// ---------------------------------------------------------------------------
describe('soat intizomi — qamrov', () => {
  it('oltala kassa yuzasini qamraydi va papkalar joyida', () => {
    expect(CLOCK_SCAN_DIRS).toEqual([
      'app/(app)/sotuv',
      'components/pos',
      'lib/pos',
      'app/customer-display',
      'app/print/cash-in',
      'app/print/cash-out',
    ]);
    for (const dir of CLOCK_SCAN_DIRS) {
      expect(existsSync(join(WEB_SRC, dir)), `qo'riqlanadigan papka ko'chgan: ${dir}`).toBe(true);
    }
  });

  it('har yuzadan haqiqatan fayl yig`iladi (jimgina bo`sh skaner emas)', () => {
    const files = clockScannedFiles();
    for (const dir of CLOCK_SCAN_DIRS) {
      expect(
        files.filter((f) => f.startsWith(`${dir}/`)).length,
        `papkadan bitta ham fayl yig'ilmadi: ${dir}`,
      ).toBeGreaterThan(0);
    }
    expect(files).toContain('app/(app)/sotuv/_components/smena-mode.tsx');
    expect(files).toContain('lib/pos/receipt-model.ts');
  });

  it('har bir oq ro`yxat bandi hamon mavjud va qamrovda (eskirgan istisno = teshik)', () => {
    for (const rel of Object.keys(CLOCK_ALLOWED)) {
      expect(existsSync(join(WEB_SRC, rel)), `istisno fayli yo'q: ${rel}`).toBe(true);
      expect(clockScannedFiles(), `istisno fayli qamrovda emas: ${rel}`).toContain(rel);
    }
  });

  /**
   * Oq ro'yxat «har ehtimolga qarshi» kengaymasin: har band SABAB bilan
   * yozilishi va HAQIQATAN kerak bo'lishi shart. Fayldan istisno qilingan
   * `Date.now()` olib tashlansa — bandning o'zi ham olinishi kerak.
   */
  it('oq ro`yxatdagi har fayl haqiqatan qurilma soatini o`qiydi (o`lik istisno yo`q)', () => {
    for (const [rel, reason] of Object.entries(CLOCK_ALLOWED)) {
      expect(reason.length, `sababsiz istisno: ${rel}`).toBeGreaterThan(80);
      const src = readFileSync(join(WEB_SRC, rel), 'utf8');
      // Istisnoni VAQTINCHA olib tashlab o'lchaymiz — fayl ro'yxatda
      // turgani uchun `scanDeviceClock` unga umuman qaramaydi.
      const leaks = scanDeviceClock(src, `__probe__/${rel}`);
      expect(
        leaks.length,
        `istisno kerak emas — faylda qurilma soati yo'q: ${rel}`,
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Asosiy invariantlar
// ---------------------------------------------------------------------------
describe('QOIDA 1 — kassa doirasida qurilma soati o`qilmaydi', () => {
  it('has no `new Date()` / `Date.now()` outside the documented allow-list', () => {
    const leaks: ClockLeak[] = [];
    for (const rel of clockScannedFiles()) {
      leaks.push(...scanDeviceClock(readFileSync(join(WEB_SRC, rel), 'utf8'), rel));
    }
    const report = leaks.map((l) => `${l.file}:${l.line}  ${l.what}  →  serverNow() (@/lib/clock)`);
    const howToFix =
      "Qurilma soati o'rniga `serverNow()` ishlating (S-reja §2 qoida 4). " +
      "Agar bu NISBIY o'lchov yoki IDENTIFIKATOR bo'lsa — CLOCK_ALLOWED ga " +
      'SABAB bilan yozing, jim qoldirmang.';
    expect(report, `Kassa doirasida qurilma soati:\n${report.join('\n')}\n${howToFix}`).toEqual([]);
  });
});

describe('QOIDA 2 — kassa doirasida sana qurilma MINTAQASIDA chizilmaydi', () => {
  it('every date-side toLocale… call pins a timeZone', () => {
    const leaks: ClockLeak[] = [];
    for (const rel of clockScannedFiles()) {
      leaks.push(...scanMissingTimeZone(readFileSync(join(WEB_SRC, rel), 'utf8'), rel));
    }
    const report = leaks.map((l) => `${l.file}:${l.line}  ${l.what}  →  timeZone: POS_TZ`);
    const howToFix =
      "Opsiyalarga `timeZone: POS_TZ` (@/lib/clock) qo'shing. Qurilma mintaqasi " +
      "adashgan mashinada sana butun bir KUNGA siljib ko'rinadi (§1.3). " +
      'LOKALGA (`bcp47`, `ru-RU`) TEGMANG — u alohida qaror, `pos-bcp47-guard` doirasi.';
    expect(report, `Mintaqasiz sana formatlash:\n${report.join('\n')}\n${howToFix}`).toEqual([]);
  });
});

describe('QOIDA 3 — 🔴 qizil chiziq: POS serverga `moment` yubormaydi', () => {
  it('no write-direction api call carries a `moment` field', () => {
    const leaks: ClockLeak[] = [];
    for (const rel of clockScannedFiles()) {
      leaks.push(...scanMomentWrites(readFileSync(join(WEB_SRC, rel), 'utf8'), rel));
    }
    const report = leaks.map((l) => `${l.file}:${l.line}  ${l.what}`);
    const howToFix =
      "Hujjat `moment`ini SERVER qo'yadi (`retail-sale.service.ts`). POS uni " +
      'yuborsa kassa mashinasining soati BAZAGA — smena jamlariga, kunlik ' +
      'hisobotlarga — sizib kirardi (S-reja §2 qoida 3).';
    expect(report, `POS'dan serverga moment:\n${report.join('\n')}\n${howToFix}`).toEqual([]);
  });

  /**
   * Anti-vacuity: yuqoridagi tekshiruv «hech qanday `api.post` yo'q» degani
   * uchun ham yashil bo'lishi mumkin edi. Bu esa skaner haqiqatan yozish
   * chaqiruvlarini KO'RAYOTGANINI isbotlaydi.
   */
  it('skaner haqiqatan yozish chaqiruvlarini ko`radi (vacuity emas)', () => {
    let writes = 0;
    for (const rel of clockScannedFiles()) {
      const sf = parse(readFileSync(join(WEB_SRC, rel), 'utf8'), rel);
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'api' &&
          WRITE_METHODS.has(node.expression.name.text)
        ) {
          writes += 1;
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(writes, 'POS doirasida bitta ham `api.post/put/patch` topilmadi').toBeGreaterThan(5);
  });
});
