import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MOJIBAKE + BOM QO'RIQCHISI (2026-09-01, jonli hodisa).
 *
 * 🔴 O'LCHANGAN XATO SINFI: `vozvrat-mode.tsx` PowerShell bilan tahrirlandi —
 *   (Get-Content -Raw) -replace … | Set-Content -Encoding utf8
 * Windows PowerShell 5.1 da `Get-Content` BOM'siz UTF-8 faylni **ANSI kod
 * sahifasida** (cp1251) o'qiydi, so'ng `Set-Content -Encoding utf8` o'sha
 * noto'g'ri o'qilgan belgilarni UTF-8 bo'lib qayta yozadi va **BOM qo'shadi**.
 * Natijada butun fayldagi lotin bo'lmagan belgilar buzildi:
 *   `›` → `вЂє` · `·` → `В·` · `«»` → `В«В»` · `—` → `вЂ”`
 * Kassir ekranida chek qatorining o'ng chetida `вЂє` bo'lib chiqdi va egasi
 * shuni ko'rsatdi. Typecheck, lint va 4460 test — HECH BIRI tutmadi
 * (mojibake sintaktik jihatdan mutlaqo to'g'ri JS satri).
 *
 * Qoida: manba fayllarda cp1251/cp1252-mojibake imzolari ham, UTF-8 BOM ham
 * bo'lmaydi. Fayl tahrirlashda Edit/Write ishlating; PowerShell'ning
 * `Get-Content`/`Set-Content` juftligi bilan manba fayl QAYTA YOZILMASIN.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');

/**
 * Mojibake imzolari — UTF-8 bayt ketma-ketligi cp1251/cp1252 da o'qilganda
 * hosil bo'ladigan barqaror boshlanishlar. `Ð`/`Ñ` kirill matnining, `вЂ`
 * tipografik tirelar/qo'shtirnoqlarning, `В` esa `·`/`«»`/`°` ning izi.
 * Har biri ikki belgidan iborat — yolg'iz `В` (masalan rus matnidagi «В»
 * predlogi) noto'g'ri qizartirmasin.
 */
const MOJIBAKE = [
  'вЂ', // — – ‘ ’ “ ” • ›
  'В«', // «
  'В»', // »
  'В·', // ·
  'Ð°', // а
  'Ñ€', // р
  'Ã©', // é (cp1252 yo'li)
  'Ã¼', // ü
];

const BOM = '﻿';

/** Skaner O'ZI — imzolar shu faylda literal turadi, aks holda o'zini tutadi. */
const SELF = '__tests__/no-mojibake.test.ts';

/**
 * BOM bilan yozilgan ESKI fayllar (bu qo'riqchidan OLDIN kirgan; 2026-09-01 da
 * o'lchandi). Ular tegishli ish doirasida tuzatilganda ro'yxatdan olib
 * tashlanadi — ro'yxat QISQARISHI kerak, o'sishi EMAS.
 */
const KNOWN_BOM = new Set<string>([
  'apps/web/src/app/(app)/getting-started/page.tsx',
  'apps/web/src/components/product-detail-widget.tsx',
  'apps/web/src/components/stores/stores-list-view.tsx',
]);

function sourceFiles(): string[] {
  return execSync('git ls-files "apps/web/src/**/*.ts" "apps/web/src/**/*.tsx"', { cwd: REPO })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !f.endsWith(SELF));
}

describe('Mojibake va BOM qo`riqchisi (2026-09-01 hodisasi)', () => {
  const files = sourceFiles();

  it('manba fayllarda buzilgan kodlash (mojibake) yo`q', () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(resolve(REPO, f), 'utf8');
      for (const sig of MOJIBAKE) {
        const at = src.indexOf(sig);
        if (at === -1) continue;
        const line = src.slice(0, at).split('\n').length;
        hits.push(`${f}:${line}  «${src.slice(at, at + 12).replace(/\n/g, ' ')}…»`);
        break;
      }
    }
    expect(
      hits,
      `Kodlash buzilgan (UTF-8 fayl ANSI deb o'qilgan). Faylni oxirgi TOZA commitdan tiklang (\`git show <sha>:<yo'l> > <yo'l>\`) va tahrirni Edit/Write bilan qayta qo'llang:\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  it('YANGI fayl UTF-8 BOM bilan boshlanmaydi', () => {
    const withBom = files
      .filter((f) => readFileSync(resolve(REPO, f), 'utf8').startsWith(BOM))
      .filter((f) => !KNOWN_BOM.has(f));
    expect(
      withBom,
      `BOM topildi (PowerShell \`Set-Content -Encoding utf8\` qo'shadi):\n${withBom.join('\n')}`,
    ).toEqual([]);
  });

  it('KNOWN_BOM ro`yxati eskirmaydi — tuzatilgan fayl ro`yxatda turmaydi', () => {
    const stale = [...KNOWN_BOM].filter(
      (f) => !readFileSync(resolve(REPO, f), 'utf8').startsWith(BOM),
    );
    expect(
      stale,
      `Bu fayllarda endi BOM yo'q — ro'yxatdan olib tashlang:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('skaner haqiqatan ishlaydi — sun`iy namuna tutiladi (non-vacuous)', () => {
    // Aynan jonlida chiqqan satr: `›` (U+203A) cp1251 da shunday ko'rinadi.
    const buzilgan = '<span>вЂє</span>';
    expect(MOJIBAKE.some((sig) => buzilgan.includes(sig))).toBe(true);
    // Toza satr esa tutilmaydi.
    expect(MOJIBAKE.some((sig) => '<span>›</span>'.includes(sig))).toBe(false);
  });
});
