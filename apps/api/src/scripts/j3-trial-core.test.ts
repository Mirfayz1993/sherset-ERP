import { describe, expect, it } from 'vitest';

import {
  FOREIGN_CODE,
  TRIAL_PIECE_INPUT,
  TRIAL_PIECE_LENGTH,
  TRIAL_WHOLE_LENGTH,
  type TrialBaseline,
  expectAfter,
  isRestored,
  matches,
  planTrial,
  stockVerdict,
} from './j3-trial-core.js';

const SCOPE = {
  storeId: '968f9da2-6dbb-4375-b5e2-d19799b51de6',
  assortmentId: '3390fd94-2526-4a52-b02b-0c6bed54f485',
};

/** Jonli boshlang'ich: `Uz apunp 2x4` — 5 854,5 m, reyestr BO'SH. */
const LIVE: TrialBaseline = { stockQty: '5854.5', registryQty: '0', activePieces: 0 };

describe('J3 sinov zanjiri — planTrial', () => {
  it('olti qadam, ATAYLAB shu tartibda', () => {
    expect(planTrial(SCOPE).map((s) => s.key)).toEqual([
      'create-whole',
      'create-piece',
      'lookup-label',
      'lookup-foreign',
      'close-piece',
      'close-whole',
    ]);
  });

  it('yopish qadamlari OXIRIDA turadi — sinov izi `active` bo‘lib qolmaydi', () => {
    const keys = planTrial(SCOPE).map((s) => s.key);
    const lastCreate = Math.max(keys.indexOf('create-whole'), keys.indexOf('create-piece'));
    const firstClose = Math.min(keys.indexOf('close-piece'), keys.indexOf('close-whole'));
    expect(firstClose).toBeGreaterThan(lastCreate);
  });

  it('bo‘lak uzunligi VERGUL bilan yuboriladi (uz/ru klaviaturasi tuzog‘i)', () => {
    const step = planTrial(SCOPE).find((s) => s.key === 'create-piece');
    expect(step?.body?.length).toBe(TRIAL_PIECE_INPUT);
    expect(TRIAL_PIECE_INPUT).toContain(',');
    // Kutilgan reyestr o'zgarishi esa NORMAL shaklda.
    expect(step?.registryDelta).toBe(TRIAL_PIECE_LENGTH);
  });

  it('butun rulon YORLIQSIZ (`whole: true`), bo‘lak esa yorliqli', () => {
    const steps = planTrial(SCOPE);
    expect(steps.find((s) => s.key === 'create-whole')?.body?.whole).toBe(true);
    expect(steps.find((s) => s.key === 'create-piece')?.body?.whole).toBe(false);
  });

  it('ikkala kiritish ham YACHEYKASIZ — jonlida qoldiq hovuzda turibdi', () => {
    for (const key of ['create-whole', 'create-piece'] as const) {
      expect(planTrial(SCOPE).find((s) => s.key === key)?.body?.cellId).toBeNull();
    }
  });

  it('🔴 «tugadi» qadamlari TANA bilan yuboriladi (2026-09-05 regressiyasi)', () => {
    // Tanasiz POST + `content-type: application/json` = Fastify 400
    // («Body cannot be empty…»). Birinchi jonli yugurishda zanjir aynan shu
    // yerda uzilib, ikkita sinov qatori omborda `active` bo'lib qolgan edi.
    for (const key of ['close-piece', 'close-whole'] as const) {
      const step = planTrial(SCOPE).find((s) => s.key === key);
      expect(step?.body).toBeDefined();
      expect(JSON.stringify(step?.body)).toBe('{}');
    }
  });

  it('begona kod qadami MUVAFFAQIYATSIZLIKNI kutadi (7.3) — topilmaslikni emas', () => {
    const step = planTrial(SCOPE).find((s) => s.key === 'lookup-foreign');
    expect(step?.expectFailure).toBe(true);
    expect(step?.path).toContain(FOREIGN_CODE);
    expect(FOREIGN_CODE.startsWith('BLK-')).toBe(false);
  });

  it('faqat begona kod qadami muvaffaqiyatsizlikni kutadi', () => {
    const failing = planTrial(SCOPE).filter((s) => s.expectFailure);
    expect(failing.map((s) => s.key)).toEqual(['lookup-foreign']);
  });

  it('skaner qadamlari reyestrni O‘ZGARTIRMAYDI', () => {
    for (const key of ['lookup-label', 'lookup-foreign'] as const) {
      const step = planTrial(SCOPE).find((s) => s.key === key);
      expect(step?.registryDelta).toBe('0');
      expect(step?.pieceDelta).toBe(0);
      expect(step?.method).toBe('GET');
    }
  });

  it('birorta qadam `/stock-pieces/flag` ga tegmaydi — bayroq J4 ning ishi', () => {
    for (const step of planTrial(SCOPE)) {
      expect(step.path).not.toContain('flag');
      expect(JSON.stringify(step.body ?? {})).not.toContain('pieceTracked');
    }
  });

  it('birorta qadam qoldiq/inventarizatsiya marshrutiga bormaydi', () => {
    for (const step of planTrial(SCOPE)) {
      expect(step.path.startsWith('/stock-pieces')).toBe(true);
    }
  });
});

describe('J3 sinov zanjiri — kutilgan sonlar', () => {
  const steps = planTrial(SCOPE);

  it('boshlang‘ich holatda farq NOL emas: reyestr bo‘sh, qoldiq bor', () => {
    const start = expectAfter(LIVE, steps, -1);
    expect(start.registryQty).toBe('0');
    expect(start.activePieces).toBe(0);
    expect(start.diffQty).toBe('-5854.5');
  });

  it('butun ruloncha qo‘shilgach reyestr 250 bo‘ladi', () => {
    const after = expectAfter(LIVE, steps, 0);
    expect(after.registryQty).toBe(TRIAL_WHOLE_LENGTH);
    expect(after.activePieces).toBe(1);
    expect(after.diffQty).toBe('-5604.5');
  });

  it('bo‘lak qo‘shilgach reyestr 287,5 bo‘ladi (vergul to‘g‘ri o‘qilsa)', () => {
    const after = expectAfter(LIVE, steps, 1);
    expect(after.registryQty).toBe('287.5');
    expect(after.activePieces).toBe(2);
    expect(after.diffQty).toBe('-5567');
  });

  it('skaner qadamlaridan keyin sonlar O‘ZGARMAYDI', () => {
    const beforeScan = expectAfter(LIVE, steps, 1);
    expect(expectAfter(LIVE, steps, 2)).toEqual(beforeScan);
    expect(expectAfter(LIVE, steps, 3)).toEqual(beforeScan);
  });

  it('ikkala qator yopilgach boshlang‘ich holat QAYTADI', () => {
    const end = expectAfter(LIVE, steps, steps.length - 1);
    expect(end.registryQty).toBe('0');
    expect(end.activePieces).toBe(0);
    expect(isRestored(LIVE, end)).toBe(true);
  });

  it('yarim yo‘lda to‘xtagan sinov «qaytdi» deb hisoblanmaydi', () => {
    expect(isRestored(LIVE, expectAfter(LIVE, steps, 1))).toBe(false);
    // Faqat bo'lak yopilgan, butun rulon `active` qolgan holat ham qaytmagan.
    expect(isRestored(LIVE, expectAfter(LIVE, steps, 4))).toBe(false);
  });

  it('reyestri BO‘SH bo‘lmagan tovarda ham qaytish o‘sha boshlang‘ichga bo‘ladi', () => {
    const filled: TrialBaseline = { stockQty: '1000', registryQty: '640.25', activePieces: 3 };
    const end = expectAfter(filled, steps, steps.length - 1);
    expect(end.registryQty).toBe('640.25');
    expect(end.activePieces).toBe(3);
    expect(isRestored(filled, end)).toBe(true);
  });
});

describe('J3 sinov zanjiri — hukmlar', () => {
  it('stok-neytrallik: qoldiq o‘zgarmasa `neytral`', () => {
    expect(stockVerdict('5854.5', '5854.5')).toBe('neytral');
    expect(stockVerdict('5854.500000', '5854.5')).toBe('neytral');
  });

  it('qoldiq o‘zgarsa `farq` — «nosozlik» deb ATALMAYDI', () => {
    expect(stockVerdict('5854.5', '5834.5')).toBe('farq');
  });

  it('`matches` kasr shaklidan qat‘i nazar solishtiradi', () => {
    expect(matches('287.5', '287.500000')).toBe(true);
    expect(matches('287.5', '287.6')).toBe(false);
  });
});
