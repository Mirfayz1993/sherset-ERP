/**
 * J3 — SINOV SANOG'INING SOF YADROSI (Prisma yo'q, HTTP yo'q, SQL yo'q).
 * Reja: `docs/plans/2026-09-04-bolak-hisobi-jonli-ishga-tushirish.md` → J3.
 *
 * NEGA ALOHIDA YADRO: sinov sanog'ining butun qiymati — «qadamdan keyin
 * sverka AYNAN shuncha bo'lishi kerak edi» degan KUTILMANI oldindan yozib
 * qo'yishda. Agar kutilma skriptning ichida, jonli javobdan KEYIN
 * hisoblansa, u har qanday natijaga moslashib ketardi va sinov hech nimani
 * isbotlamasdi. Shuning uchun qadamlar ham, kutilgan sonlar ham SHU YERDA,
 * jonliga bir marta ham qaramasdan quriladi va test bilan qulflanadi.
 *
 * 🔴 BU YADRO HAQIQIY SANOQ EMAS. U J3 ning 1–2-vazifalarini (omborchining
 * jismoniy sanog'i) BAJARMAYDI va bajara olmaydi. U faqat K2 oqimining
 * ishlashini sanoqdan OLDIN isbotlaydi: kiritish → yorliq → skaner →
 * sverka → yopish → sverka. Sinov qatorlari o'sha yugurishning oxirida
 * `consumed` qilinadi.
 */
import { addDecimals, compareDecimals, subtractDecimals } from '../modules/shared/decimal.js';

/** Sinov butun rulonining uzunligi — yorliqsiz qator (K-Q3). */
export const TRIAL_WHOLE_LENGTH = '250';

/**
 * Sinov bo'lagi ATAYLAB kasrli va ATAYLAB VERGULLI kiritiladi: uz/ru
 * klaviaturasi vergul beradi va `parseLengthInput` uni nuqtaga o'giradi
 * (K2 hisobotining «vergul nuqtaga» bandi). Jonli sanoqda aynan shu tuzoq
 * birinchi kuni chiqadi — sinov uni oldindan bosib ko'radi.
 */
export const TRIAL_PIECE_INPUT = '37,5';

/** Yuqoridagi kiritmaning kutilgan normal shakli. */
export const TRIAL_PIECE_LENGTH = '37.5';

/**
 * Yorliq makonidan TASHQARIDAGI kod — 7.3 ning sinovi. `lookup` buni
 * topmasligi emas, **RAD ETISHI** kerak (400), aks holda bo'lak skaneri
 * tovar multi-hit tanloviga tushib ketardi.
 */
export const FOREIGN_CODE = '4780000000001';

/**
 * «Tugadi» marshrutining tanasi. Marshrut hech qanday maydon KUTMAYDI, lekin
 * tana BUTUNLAY bo'lmasa Fastify `content-type: application/json` ni ko'rib
 * 400 beradi. Shuning uchun bo'sh OBYEKT yuboriladi — K2 ekrani ham shunday
 * qiladi (`api.post('/stock-pieces/:id/close', {})`).
 */
export const CLOSE_BODY: Record<string, unknown> = {};

export interface TrialBaseline {
  /** `Stock.qty` — sinovdan OLDINGI ombor qoldig'i. */
  stockQty: string;
  /** Reyestrdagi FAOL bo'laklar yig'indisi (jonlida sinovdan oldin `0`). */
  registryQty: string;
  /** Reyestrdagi faol qatorlar soni. */
  activePieces: number;
}

export type TrialStepKey =
  | 'create-whole'
  | 'create-piece'
  | 'lookup-label'
  | 'lookup-foreign'
  | 'close-piece'
  | 'close-whole';

export interface TrialStep {
  key: TrialStepKey;
  /** Hisobotda ko'rinadigan sarlavha. */
  title: string;
  method: 'GET' | 'POST';
  /** `:id` va `:label` — yugurish paytida to'ldiriladigan o'rinbosarlar. */
  path: string;
  body?: Record<string, unknown>;
  /** Shu qadamdan keyin reyestr yig'indisi qanchaga o'zgaradi. */
  registryDelta: string;
  /** Shu qadamdan keyin faol qatorlar soni qanchaga o'zgaradi. */
  pieceDelta: number;
  /** 🔴 Qadam MUVAFFAQIYATSIZ bo'lishi KUTILADIMI (7.3 sinovi). */
  expectFailure: boolean;
}

export interface TrialScope {
  storeId: string;
  assortmentId: string;
}

/**
 * Sinov zanjiri — TARTIB MUHIM va u ataylab «qo'shdim-o'chirdim» emas:
 *
 *   1. butun rulon qo'shiladi   → sverka farq berishi SHART (reyestr < qoldiq)
 *   2. bo'lak qo'shiladi        → yorliq beriladi (`BLK-…`)
 *   3. o'sha yorliq skanerlanadi → AYNAN o'sha bo'lak ochilishi shart (7.3)
 *   4. begona kod skanerlanadi  → RAD etilishi shart (400), topilmasligi emas
 *   5–6. ikkala qator yopiladi  → sverka boshlang'ich holatiga QAYTADI
 *
 * Yopish oxirida turgani ham ataylab: sinov izi jonlida `active` bo'lib
 * qolsa, ertaga omborchining haqiqiy sanog'i o'sha soxta 287,5 m ustiga
 * qo'shilardi va birinchi kunning farqi soxta bo'lardi.
 */
export function planTrial(scope: TrialScope): TrialStep[] {
  return [
    {
      key: 'create-whole',
      title: `Butun rulon qo'shish (${TRIAL_WHOLE_LENGTH} m, yorliqsiz)`,
      method: 'POST',
      path: '/stock-pieces',
      body: {
        storeId: scope.storeId,
        assortmentId: scope.assortmentId,
        cellId: null,
        whole: true,
        length: TRIAL_WHOLE_LENGTH,
        count: 1,
      },
      registryDelta: TRIAL_WHOLE_LENGTH,
      pieceDelta: 1,
      expectFailure: false,
    },
    {
      key: 'create-piece',
      title: `Bo'lak qo'shish (${TRIAL_PIECE_INPUT} — vergul bilan, yorliq beriladi)`,
      method: 'POST',
      path: '/stock-pieces',
      body: {
        storeId: scope.storeId,
        assortmentId: scope.assortmentId,
        cellId: null,
        whole: false,
        length: TRIAL_PIECE_INPUT,
        count: 1,
      },
      registryDelta: TRIAL_PIECE_LENGTH,
      pieceDelta: 1,
      expectFailure: false,
    },
    {
      key: 'lookup-label',
      title: "Yorliqni skanerlash — AYNAN o'sha bo'lak ochilishi shart (7.3)",
      method: 'GET',
      path: '/stock-pieces/lookup?code=:label',
      registryDelta: '0',
      pieceDelta: 0,
      expectFailure: false,
    },
    {
      key: 'lookup-foreign',
      title: `Begona kodni skanerlash (${FOREIGN_CODE}) — RAD etilishi shart`,
      method: 'GET',
      path: `/stock-pieces/lookup?code=${FOREIGN_CODE}`,
      registryDelta: '0',
      pieceDelta: 0,
      expectFailure: true,
    },
    {
      key: 'close-piece',
      title: "Bo'lakni «tugadi» qilish",
      method: 'POST',
      path: '/stock-pieces/:pieceId/close',
      // 🔴 BO'SH TANA EMAS, `{}`. Fastify `content-type: application/json`
      // bilan kelgan TANASIZ so'rovni 400 bilan rad etadi va K2 ekrani ham
      // aynan `{}` yuboradi (`api.post('/stock-pieces/:id/close', {})`).
      // Birinchi yugurishda (2026-09-05) zanjir shu yerda uzilgan edi.
      body: CLOSE_BODY,
      registryDelta: `-${TRIAL_PIECE_LENGTH}`,
      pieceDelta: -1,
      expectFailure: false,
    },
    {
      key: 'close-whole',
      title: 'Butun rulonni «tugadi» qilish',
      method: 'POST',
      path: '/stock-pieces/:wholeId/close',
      body: CLOSE_BODY,
      registryDelta: `-${TRIAL_WHOLE_LENGTH}`,
      pieceDelta: -1,
      expectFailure: false,
    },
  ];
}

export interface TrialExpectation {
  /** Reyestr yig'indisi shu qadamdan keyin. */
  registryQty: string;
  /** Faol qatorlar soni shu qadamdan keyin. */
  activePieces: number;
  /** Sverka farqi: reyestr − qoldiq. */
  diffQty: string;
}

/**
 * `stepIndex` qadamigacha (o'sha qadam KIRADI) to'plangan kutilma.
 * `stepIndex = -1` — boshlang'ich holat.
 */
export function expectAfter(
  baseline: TrialBaseline,
  steps: readonly TrialStep[],
  stepIndex: number,
): TrialExpectation {
  let registryQty = baseline.registryQty;
  let activePieces = baseline.activePieces;
  for (let i = 0; i <= stepIndex && i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    registryQty = addDecimals(registryQty, step.registryDelta);
    activePieces += step.pieceDelta;
  }
  return {
    registryQty,
    activePieces,
    diffQty: subtractDecimals(registryQty, baseline.stockQty),
  };
}

/**
 * Sinov TUGAGACH holat boshlang'ichga qaytdimi.
 *
 * 🔴 «Qatorlar soni» emas, aynan FAOL qatorlar soni tekshiriladi: `close`
 * qatorni o'chirmaydi, `consumed` qiladi (K2 da `DELETE` ataylab yo'q), ya'ni
 * `stock_pieces` da ikkita iz ABADIY qoladi va bu KUTILGAN natija.
 */
export function isRestored(baseline: TrialBaseline, actual: TrialExpectation): boolean {
  return (
    compareDecimals(actual.registryQty, baseline.registryQty) === 0 &&
    actual.activePieces === baseline.activePieces
  );
}

/**
 * Stok-neytrallik: K2 ning butun poydevori — reyestrga yozish `Stock.qty` ga
 * TEGMAYDI. Sinov buni jonlida o'lchaydi.
 *
 * ⚠️ Bu tekshiruv «sinov paytida savdo bo'lmagan» degan taxminga tayanadi.
 * Farq chiqsa — bu darhol «nosozlik» degani EMAS: shu tovar sotilgan bo'lishi
 * mumkin. Shuning uchun natija `'farq'` deb qaytadi va sababini ODAM ajratadi.
 */
export function stockVerdict(before: string, after: string): 'neytral' | 'farq' {
  return compareDecimals(before, after) === 0 ? 'neytral' : 'farq';
}

/** Kutilgan va o'lchangan sonni solishtirish — hisobotning ✔/✘ ustuni. */
export function matches(expected: string, actual: string): boolean {
  return compareDecimals(expected, actual) === 0;
}
