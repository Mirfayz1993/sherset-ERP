/**
 * Sanash sessiyasi — SOF yadro (DB yo'q, Nest yo'q). N-reja §5-N2.
 *
 * Sessiya — omborchi TSD'da yacheykalarni sanagan payt oynasi. U mavjud
 * `Inventory` hujjatida yashaydi (N-reja Q1: yangi jadval YO'Q), qatorlari esa
 * `inventory_positions` da. Hujjat HECH QACHON post qilinmaydi — qoldiq
 * `setCellStock` yozgan avto-Оприходование / avto-Списание bilan ALLAQACHON
 * tenglashgan (N-reja §2.1, qo'riqchi — `inventory.service.ts`).
 *
 * 🔴 NARX QOIDASI (T-reja qoida 3 / N-reja §3 qoida 4). Bu sirt TSD'ga ochiladi,
 * ya'ni «bu javobda narx bormi?» degan savolga TUZILMAVIY javob kerak — ekranda
 * ko'rsatmaslik isbot EMAS. Shuning uchun:
 *   · javob har doim quyidagi `select` OQ RO'YXATI ustida quriladi
 *     (`Inventory.sumMinor` — «Стоимость» ustuni — unda ATAYLAB YO'Q);
 *   · `CountSessionRow` / `CountSessionLineRow` turlari oq ro'yxatning aksi:
 *     kimdir `select` ga narx ustuni qo'shsa TypeScript uni bu turdan
 *     o'tkazmaydi (`tsd.service.ts` dagi `TsdProductRow` naqshi);
 *   · sessiya qatorlarida `cost_minor` **NULL** qoladi — `buildCountSessionLine`
 *     u kalitni umuman YOZMAYDI va `count-session.test.ts` shuni qulflaydi.
 */

/** Yopilgan sessiyaning holati. `posted` EMAS — hujjat post qilinmaydi. */
export const COUNT_SESSION_STATE = 'counted' as const;

/**
 * Sessiya hujjatining javob maydonlari — OQ RO'YXAT.
 *
 * 🔴 Bu yerga `sumMinor`, `costMinor` yoki boshqa pul maydoni QO'SHILMAYDI.
 * Prisma default `select` HAMMA skalyar ustunni beradi (`sumMinor` ham) —
 * shuning uchun har so'rovda AYNAN shu ro'yxat beriladi.
 */
export const COUNT_SESSION_SELECT = {
  id: true,
  name: true,
  storeId: true,
  state: true,
  countSession: true,
  countedBy: true,
  closedAt: true,
  confirmedBy: true,
  confirmedAt: true,
  moment: true,
  createdAt: true,
} as const;

/** `COUNT_SESSION_SELECT` bilan o'qilgan XOM qator — narx maydoni YO'Q. */
export interface CountSessionRow {
  id: string;
  name: string;
  storeId: string;
  state: string;
  countSession: boolean;
  countedBy: string | null;
  closedAt: Date | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  moment: Date;
  createdAt: Date;
}

/**
 * Hisoblagichlar uchun o'qiladigan qator maydonlari — OQ RO'YXAT.
 * `costMinor` bu yerda ham YO'Q (qator narxi TSD'ga chiqmaydi).
 */
export const COUNT_SESSION_LINE_SELECT = {
  cellId: true,
  varianceQty: true,
} as const;

/** Hisoblagich uchun yetarli bo'lgan minimal qator. */
export interface CountSessionLineRow {
  cellId: string | null;
  /** `Prisma.Decimal` ham, string ham keladi — `Number()` ikkalasini oladi. */
  varianceQty: { toString(): string };
}

/** `GET /tsd/count-sessions/active` hisoblagichlari. NARX YO'Q — faqat sanoq. */
export interface CountSessionCounters {
  /** Nechta HAR XIL yacheyka sanaldi. */
  cellCount: number;
  /** Jami sanoq qatori. */
  lineCount: number;
  /** `varianceQty > 0` — tizimda kam edi, omborchi ko'proq topdi. */
  surplusLines: number;
  /** `varianceQty < 0` — tizimda ko'p edi, omborchi kamroq topdi. */
  shortageLines: number;
}

/** Bo'sh sessiyaning hisoblagichlari (qator yo'q). */
export const EMPTY_COUNTERS: CountSessionCounters = {
  cellCount: 0,
  lineCount: 0,
  surplusLines: 0,
  shortageLines: 0,
};

/**
 * Qatorlardan hisoblagichlarni yig'adi.
 *
 * `cellCount` — HAR XIL yacheykalar soni: bitta yacheykada 5 ta tovar sanalsa
 * bu «5 ta yacheyka» EMAS, «1 ta yacheyka, 5 ta qator». Bosh omborchi
 * «14 yacheyka · 37 qator» deb o'qiydi.
 *
 * Farqi NOL bo'lgan qator (`varianceQty = 0`) ikkala tomonga ham qo'shilmaydi —
 * u «sanadim, hammasi joyida» degan iz va `lineCount` da hisoblanadi.
 */
export function summarizeCountSessionLines(
  lines: ReadonlyArray<CountSessionLineRow>,
): CountSessionCounters {
  const cells = new Set<string>();
  let surplusLines = 0;
  let shortageLines = 0;
  for (const line of lines) {
    if (line.cellId) cells.add(line.cellId);
    const variance = Number(line.varianceQty.toString());
    if (variance > 0) surplusLines += 1;
    else if (variance < 0) shortageLines += 1;
  }
  return { cellCount: cells.size, lineCount: lines.length, surplusLines, shortageLines };
}

/** `setCellStock` yozgan avto-hujjat izi (denormal — hujjat o'chsa ham qoladi). */
export interface CountSessionAutoDoc {
  type: 'enter' | 'loss';
  id: string | null;
  name: string;
}

/** `buildCountSessionLine` kirishi — HAMMASI string, `setCellStock` javobidagidek. */
export interface CountSessionLineInput {
  accountId: string;
  inventoryId: string;
  position: number;
  assortmentId: string;
  cellId: string;
  cellName: string;
  /**
   * 🔴 Uchalasi ham `setCellStock` javobidagi AYNI stringlar:
   *   · `expectedQty` = `previousQty` (sanashdan oldingi yacheyka qoldig'i);
   *   · `actualQty`   = `qty` (sanashdan keyingi YAKUNIY qoldiq);
   *   · `varianceQty` = server hisoblagan `delta` (ishorali).
   * `mode: 'add'` da ham shu qoida: kiritilgan son 100 bo'lsa ham qatorda
   * `26 → 126`, farq `100` turadi — hisobot ikkala rejimda BIR XIL o'qiladi.
   */
  expectedQty: string;
  actualQty: string;
  varianceQty: string;
  /** K5 — omborchi sanagan bo'lak tarkibi (bo'lsa). */
  pieceEntry?: string | null;
  autoDoc: CountSessionAutoDoc | null;
}

/**
 * Sanoq izi qatorining Prisma `data` obyekti.
 *
 * 🔴 `costMinor` kaliti bu yerda UMUMAN YO'Q ⇒ ustun NULL qoladi. Uni
 * `product.buyPrice` dan to'ldirish oson vasvasa (avto-hujjat aynan shundan
 * yoziladi), lekin u kirim narxi va bu qator TSD sirtidan o'qiladi.
 */
export function buildCountSessionLine(input: CountSessionLineInput) {
  return {
    accountId: input.accountId,
    inventoryId: input.inventoryId,
    position: input.position,
    assortmentKind: 'product',
    assortmentId: input.assortmentId,
    productId: input.assortmentId,
    expectedQty: input.expectedQty,
    actualQty: input.actualQty,
    varianceQty: input.varianceQty,
    cellId: input.cellId,
    cell: input.cellName,
    pieceEntry: input.pieceEntry ?? null,
    autoDocType: input.autoDoc?.type ?? null,
    autoDocId: input.autoDoc?.id ?? null,
    autoDocName: input.autoDoc?.name ?? null,
  };
}
