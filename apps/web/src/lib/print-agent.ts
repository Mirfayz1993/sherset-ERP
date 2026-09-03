/**
 * Sherset local print-agent client.
 *
 * The agent (tools/print-agent) runs on the cashier PC and prints raw ESC/POS to
 * a NAMED Windows printer, so each warehouse's picking sheet can be routed to its
 * own printer. It listens on http://127.0.0.1:17777; localhost is a "potentially
 * trustworthy" origin, so the HTTPS site may call it without mixed-content errors.
 *
 * Every call fails soft (short timeout, no throw on network error) — the agent is
 * optional infrastructure that may simply not be running.
 */

import { api } from './api-client';
// P05: chek oxiridagi qarz qoldig'i — ikkala chop-nuqta bitta helper'dan.
import { fetchDebtAfter } from './pos/receipt-debt';
// Qarz to'lovi cheki — server javobi → tovar-chek modeli (2026-08-16).
import { type DebtReceiptPayload, debtReceiptToSaleInput } from './pos/receipt-debt-model';
// Chek modeli — uchala renderer uchun YAGONA manba (qaror + formatlash).
import {
  RECEIPT_LABELS,
  type ReceiptSaleInput,
  buildReceiptModel,
  fmtSom,
  wrapText,
} from './pos/receipt-model';
import {
  type ZReceiptLabels,
  type ZReportPayload,
  buildZReceipt,
  renderZReceiptHtml,
  renderZReceiptText,
} from './z-report-receipt';

export const PRINT_AGENT_URL = 'http://127.0.0.1:17777';

// ─── Electron desktop shell bridge (optional) ────────────────────────────────
// When the web app runs inside the Sherset desktop app (Electron), the shell
// exposes window.electronAPI for NATIVE per-printer printing — no HTTP agent,
// no ESC/POS codepage (the Windows driver renders the HTML, Cyrillic included).
// Outside Electron (a normal browser) this is undefined and everything falls
// back to the localhost print-agent over HTTP.
interface ElectronBridge {
  isSherset: boolean;
  version: string;
  listPrinters: () => Promise<string[]>;
  printSheet: (
    printerName: string,
    html: string,
    // v1.0.3+: label kabi qat'iy qog'oz o'lchami (mikron). Eski exe'lar
    // qo'shimcha argumentni bilmaydi — jim e'tiborsiz qoldiradi (80mm legacy).
    // `height` ixtiyoriy: berilmasa exe (v1.4.0 `resolvePageSize` dan tasdiqlangan)
    // balandlikni chek MAZMUNIDAN o'zi o'lchaydi — chek uzunligi oldindan noma'lum.
    pageSizeMicrons?: { width: number; height?: number },
  ) => Promise<{ ok: boolean; error?: string }>;
  // v1.0.4+: kassir savati → mijoz-ekran (orqadagi 2-monitor). Savat har
  // o'zgarganda chaqiriladi; eski exe'lar bu funksiyani bilmaydi (optional).
  pushCart?: (payload: {
    // `quantity` — `Decimal(20,6)` SATRi (F8 audit): og'irlik tovarida u
    // `'1.5'` bo'ladi va mijoz-ekran uni `BigInt()` ga bermaydi. Eski exe
    // versiyalari raqamni ham yuborishi mumkin, shu sababdan union.
    lines: Array<{
      productId: string;
      name: string;
      quantity: number | string;
      priceMinor: string;
    }>;
    discountPct: number;
  }) => void;
  // v1.0.5+: mijoz ekranini och/yop (Sotuv panelidagi tugma; F9 ham shu ish).
  // Tashqi ekran topilmasa { open:false, error } qaytadi.
  toggleCustomerDisplay?: () => Promise<{ open: boolean; error?: string }>;
  // Mijoz ekrani hozir ochiqmi (tugma holatini ko'rsatish uchun).
  customerDisplayStatus?: () => Promise<{ open: boolean }>;
  // v1.5.0+: qurilma holati — kirish ekranidagi belgi (K06). `?` ATAYLAB:
  // eski qobiqda (1.4.0) bu metod yo'q — web undan qulamasligi kerak.
  shellStatus?: () => Promise<{
    version: string;
    updateReady: boolean;
    defaultPrinter: string;
  }>;
}
declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}
function electron(): ElectronBridge | null {
  if (typeof window === 'undefined') return null;
  const el = window.electronAPI;
  return el?.isSherset ? el : null;
}

/**
 * Termal chek sahifasining ENI (mikron) — printSheet'ga OSHKORA beriladi.
 *
 * 80mm termal printerning BOSILADIGAAN eni ~72mm (576 nuqta @203dpi): drayver
 * 72mm'dan tashqarini KESADI, masshtablamaydi. Exe sukuti esa 80mm
 * (main.js `DEFAULT_WIDTH_MICRONS`) — o'sha sukutga tayanilganda 72mm'lik
 * markazlangan body ~4mm o'ngga surilib, «Summa» ustuni qog'ozdan chiqib
 * ketdi (2026-08-14, egasining fotosi). Balandlik ATAYLAB berilmaydi — exe
 * uni mazmundan o'lchaydi. Qulf: receipt-print-width.test.ts.
 */
export const THERMAL_PAGE_MICRONS = { width: 72000 } as const;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function agentFetch(path: string, init?: RequestInit, timeoutMs = 4000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${PRINT_AGENT_URL}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Electron qobiqdamizmi — native (dialogsiz, printer-tanlab) chop bor-yo'qligi. */
export function hasNativePrinting(): boolean {
  return electron() != null;
}

/**
 * Tayyor HTML hujjatni tanlangan printerga JIM (dialogsiz) bosish — faqat
 * Electron qobiqda ishlaydi (offscreen BrowserWindow → webContents.print).
 * Senik/label kabi maxsus @page o'lchamli sahifalar uchun `pageSizeMm`
 * MAJBURIY berilsin (aks holda exe legacy 80mm-chek rejimida bosadi);
 * exe v1.0.3+ shu o'lchamni driver'ga uzatadi.
 */
export async function printHtmlNative(
  printerName: string,
  html: string,
  pageSizeMm?: { widthMm: number; heightMm: number },
): Promise<{ ok: boolean; error?: string }> {
  const el = electron();
  if (!el) return { ok: false, error: 'Electron qobiq emas' };
  const pageSizeMicrons = pageSizeMm
    ? {
        width: Math.round(pageSizeMm.widthMm * 1000),
        height: Math.round(pageSizeMm.heightMm * 1000),
      }
    : undefined;
  try {
    return await el.printSheet(printerName, html, pageSizeMicrons);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Is a printing backend available? (Electron native, or the HTTP agent /health) */
export async function checkPrintAgent(): Promise<boolean> {
  if (electron()) return true; // native printing is always available in the shell
  try {
    const r = await agentFetch('/health', {}, 2000);
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

/** Installed Windows printers on the cashier PC (Electron native, or GET /printers). */
export async function fetchAgentPrinters(): Promise<string[]> {
  const el = electron();
  if (el) {
    try {
      return await el.listPrinters();
    } catch {
      return [];
    }
  }
  try {
    const r = await agentFetch('/printers', {}, 3000);
    if (!r.ok) return [];
    const j = (await r.json()) as { printers?: string[] };
    return Array.isArray(j.printers) ? j.printers : [];
  } catch {
    return [];
  }
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}

/**
 * Chop zanjiri QAYSI qavatda uzilgani (`handled:false` bo'lganda).
 *
 * Ilgari uchala uzilish ham bir xil `{ handled:false }` edi va chaqiruvchi
 * hammasiga bitta javob berardi — brauzer popup'i (`?auto=1`). Qobiq ichida
 * o'sha popup `window.print()` chaqiradi ⇒ Chromium TASDIQ oynasi chiqadi.
 * Egasi monoblokda ko'rgan «chek avtomatik chiqmayapti» simptomi aynan shu
 * (2026-08-11, P7): prodda `company_settings` 0 qator ⇒ printer sozlanmagan.
 * Sabab ajratilgani chaqiruvchiga to'g'ri javob tanlash imkonini beradi
 * (`lib/pos/print-fallback.ts`).
 */
export type PrintIdleReason =
  /** Qobiq ham, HTTP print-agent ham yo'q — oddiy brauzer. */
  | 'no-agent'
  // `'printer-not-set'` (2026-08-12) va `'no-printer-mapped'` (2026-08-16)
  // olib tashlandi: UCHALA chek ham — mijoz cheki, Z-hisobot va omborga
  // chiqadigan yig'ish varag'i — printer biriktirilmagan bo'lsa qurilmaning
  // Windows sukut printeriga bosiladi. Ya'ni «sozlanmagan» degan uzilish
  // qavati BUTUNLAY yo'q; sozlama faqat marshrutni ANIQLASHTIRADI.
  /** Hujjat yuklanmadi (tarmoq/server xatosi) — chop etadigan narsa yo'q. */
  | 'load-failed';

/** Send a job to one named printer. Provide either `text` or base64 ESC/POS bytes. */
export async function agentPrint(
  printerName: string,
  payload: { text?: string; dataBase64?: string },
): Promise<PrintResult> {
  try {
    const r = await agentFetch(
      '/print',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer: printerName, ...payload }),
      },
      8000,
    );
    const j = (await r.json().catch(() => ({}))) as PrintResult;
    if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    return { ok: j.ok !== false, error: j.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'agent unreachable' };
  }
}

// ─── Per-warehouse picking-sheet routing (stage 3) ───────────────────────────

interface AgentPickingLine {
  productName: string;
  quantity: string;
  binLocation: string | null;
  uom?: string | null;
}
interface AgentPickingSheet {
  skladNo: number | null;
  /**
   * Varaq sarlavhasi — «01» / «Yacheykasiz», yoki **null = sarlavha yo'q**.
   *
   * Server bir necha omborni bitta qog'ozga birlashtirganda (bitta printer =
   * bitta qog'oz) yagona sarlavha yolg'on bo'lardi. `skladNo` dan HISOBLAB
   * bo'lmaydi — aynan shuning uchun server aytadi.
   */
  groupLabel: string | null;
  omborchiName: string | null;
  lines: AgentPickingLine[];
}
/**
 * `/restock-tasks/picking-sheets/:source/:id`. The header fields feed the
 * «Товарный чек» template (climart namunasi) — they are what turns a bare line
 * list into the receipt the owner asked for.
 */
export interface AgentPickingSheetsResponse {
  sourceName: string | null;
  docNumber?: string | null;
  /** ISO instant of the source document. */
  docDate?: string | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  sellerName?: string | null;
  comment?: string | null;
  sheets: AgentPickingSheet[];
}
// `AgentKeeperRow` OLIB TASHLANDI (2026-08-16): ombor→printer marshruti yo'q,
// ya'ni chop uchun `/sklad-keepers` UMUMAN o'qilmaydi.

// `pickGroupLabel` OLIB TASHLANDI (2026-08-16): sarlavhani endi SERVER
// hisoblaydi (`groupLabel`) — u varaqlar birlashtirilganini biladi, mijoz esa
// `skladNo` dan buni chiqara olmaydi. Ikki nusxa bo'lsa biri eskirardi.

/** ISO instant → «DD.MM.YYYY» (the receipt's «от» line). */
function receiptDateOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const RECEIPT_BRAND = 'Sherset - savdo va ombor boshqaruvi';

/**
 * Plain-text picking sheet for the raw ESC/POS agent — an APPROXIMATION of the
 * «Товарный чек» template, not a 1:1 copy: a raw thermal stream has no table
 * borders, so the same information is printed in the same ORDER (header block →
 * group heading → numbered lines with yacheyka + qty → «Jami nomlanish N» →
 * brand line). Labels stay Latin here because the ESC/POS codepage is not
 * negotiated by the agent — the Electron/browser paths render the real table.
 */
export function buildSheetText(sheet: AgentPickingSheet, res: AgentPickingSheetsResponse): string {
  const dash = '--------------------------------';
  const center = (s: string) =>
    s.length >= 32 ? s : ' '.repeat(Math.floor((32 - s.length) / 2)) + s;
  const L: string[] = [];
  if (res.buyerName) L.push(res.buyerName);
  L.push(center(`Tovar cheki № ${res.docNumber ?? res.sourceName ?? '—'}`));
  const dateStr = receiptDateOf(res.docDate);
  if (dateStr) L.push(center(dateStr));
  L.push(`Sotuvchi: ${res.sellerName ?? ''}`);
  L.push(`Xaridor: ${res.buyerName ?? ''}`);
  L.push(`Telefon: ${res.buyerPhone ?? ''}`);
  // Bo'sh izoh qatori chizilmaydi (2026-08-19).
  if (res.comment?.trim()) L.push(`Izoh: ${res.comment}`);
  L.push(dash);
  // Birlashtirilgan ro'yxatda sarlavha yo'q (server `null` yuboradi).
  if (sheet.groupLabel != null) L.push(sheet.groupLabel);
  sheet.lines.forEach((l, i) => {
    L.push(`${i + 1}. ${l.productName}`);
    L.push(`   ${l.binLocation ?? '-'}   ${Number(l.quantity)} ${l.uom ?? 'dona'}`);
  });
  L.push(dash);
  L.push(`Jami nomlanish ${sheet.lines.length}`);
  L.push(RECEIPT_BRAND);
  return L.join('\n');
}

/**
 * 80mm-thermal HTML picking sheet for Electron native printing — the «Товарный
 * чек» template 1:1 (the Windows driver renders it, so the bordered table and
 * Cyrillic both survive; no ESC/POS codepage involved). Mirrors
 * <PickReceiptBody> in components/pick-list/receipt-print-portal.tsx.
 */
export function buildSheetHtml(sheet: AgentPickingSheet, res: AgentPickingSheetsResponse): string {
  const rows = sheet.lines
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td class="nm">${escapeHtml(l.productName)}</td><td class="c">${escapeHtml(l.uom ?? 'шт')}</td><td class="c qty">${Number(l.quantity)}</td><td class="c cell">${escapeHtml(l.binLocation ?? '–')}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{margin:0}
*{box-sizing:border-box}
body{width:72mm;margin:0;padding:2mm 1mm;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;color:#000}
.agent{font-weight:700;font-size:14px}
.title{text-align:center;font-weight:700;font-size:16px;margin-top:2px}
.from{text-align:center;font-size:11px}
.req{margin-top:2px;font-weight:700;font-size:11px;line-height:1.2}
.grp{margin-top:6px;font-weight:700;font-size:15px}
table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px}
th,td{border:1.5px solid #000;padding:1px 2px;vertical-align:top}
th{text-align:center;font-weight:700}
.c{text-align:center}
.nm{font-size:11px;font-weight:700;word-break:break-word}
.qty{font-size:11px;font-weight:700;white-space:nowrap}
.cell{white-space:nowrap;font-weight:800;font-variant-numeric:tabular-nums}
.total{margin-top:3px;font-size:12px;font-weight:700}
.brand{margin-top:12px;border-top:1px solid #000;padding-top:3px;font-size:11px;font-weight:700;font-style:italic}
</style></head><body>
<div class="agent">${escapeHtml(res.buyerName ?? '')}</div>
<div class="title">Товарный чек № ${escapeHtml(res.docNumber ?? res.sourceName ?? '—')}</div>
<div class="from">от ${escapeHtml(receiptDateOf(res.docDate))}</div>
<div class="req">
<div>Продавец: ${escapeHtml(res.sellerName ?? '')}</div>
<div>Покупатель: ${escapeHtml(res.buyerName ?? '')}</div>
<div>Телефон: ${escapeHtml(res.buyerPhone ?? '')}</div>
${res.comment?.trim() ? `<div>Комментарий: ${escapeHtml(res.comment)}</div>` : ''}
</div>
${sheet.groupLabel != null ? `<div class="grp">${escapeHtml(sheet.groupLabel)}</div>` : ''}
<table><thead><tr><th style="width:7mm">№</th><th>Наименование</th><th style="width:7mm">Ед.изм</th><th style="width:11mm">Кол-во</th><th style="width:17mm">Yacheyka</th></tr></thead><tbody>${rows}</tbody></table>
<div class="total">Всего наименований ${sheet.lines.length}</div>
<div class="brand">${RECEIPT_BRAND}</div>
</body></html>`;
}

export interface PickingPrintOutcome {
  /** true = the agent handled printing (route to per-warehouse printers). */
  handled: boolean;
  printed: number;
  skipped: number; // sheets with no mapped printer
  errors: number;
  /** handled=false bo'lganda — uzilish qavati (`PrintIdleReason`). */
  reason?: PrintIdleReason;
}

/**
 * Omborga chiqadigan chekni QURILMANING O'Z printeriga jim chop etadi.
 *
 * 🔴 PRINTER TANLANMAYDI (egasi, 2026-08-16): «monobloklarga, notbuklarga
 * printer ulangan… saytdan hech biriga alohida printer ulanmaydi — kompyuter
 * o'ziga ulangan printerdan chop qilsin». Bo'sh nom = Windows sukut printeri
 * (`desktop/main.js` `printHtml` shartnomasi).
 *
 * TARIX (nega bu qaror): ilgari varaq FAQAT `sklad_keepers.printer_name`
 * biriktirilgan omborga chiqardi va aks holda chop BUTUNLAY to'xtardi. Prodda
 * o'sha jadval 0 qator edi, tovarlarning 89% ida yacheyka yo'q — ya'ni chek
 * hech qachon chiqmasdi. Sozlama semantik xato ham edi: printer nomi
 * QURILMANIKI, sozlama esa akkauntga yozilardi — ikki kassada bir vaqtda
 * to'g'ri bo'la olmasdi, nom mos kelmasa chop jim yiqilardi. Mijoz cheki va
 * Z-hisobot 2026-08-12 da shu sababdan sukut printerga o'tgan edi; endi
 * uchinchisi ham. Server ham bitta varaq qaytaradi (bo'linish sababi yo'q).
 *
 * Returns handled=false faqat ikki holatda: chop qatlami umuman yo'q
 * (`no-agent`) yoki varaqning O'ZI yuklanmadi (`load-failed`).
 */
export async function printPickingViaAgent(saleId: string): Promise<PickingPrintOutcome> {
  const idle = (reason: PrintIdleReason): PickingPrintOutcome => ({
    handled: false,
    printed: 0,
    skipped: 0,
    errors: 0,
    reason,
  });
  if (!(await checkPrintAgent())) return idle('no-agent');

  let sheetsRes: AgentPickingSheetsResponse;
  try {
    sheetsRes = await api.get<AgentPickingSheetsResponse>(
      `/restock-tasks/picking-sheets/retailsale/${saleId}`,
    );
  } catch {
    return idle('load-failed');
  }

  const sheets = sheetsRes.sheets ?? [];
  // Varaq umuman yo'q — chop etadigan narsa yo'q.
  if (sheets.length === 0) return idle('load-failed');

  const el = electron();
  const results = await Promise.all(
    sheets.map(async (sheet) => {
      // Electron shell → native driver print (HTML, Cyrillic-safe).
      // Plain browser → HTTP print-agent (raw ESC/POS).
      // Ikkalasida ham printer nomi BO'SH = qurilmaning sukut printeri.
      const r = el
        ? await el.printSheet('', buildSheetHtml(sheet, sheetsRes), THERMAL_PAGE_MICRONS)
        : await agentPrint('', { text: buildSheetText(sheet, sheetsRes) });
      return r.ok ? ('printed' as const) : ('error' as const);
    }),
  );

  return {
    handled: true,
    printed: results.filter((r) => r === 'printed').length,
    // Hech bir varaq tashlab ketilmaydi — maydon shakli chaqiruvchilar uchun
    // saqlanadi (hisobot qatori), qiymati doim 0.
    skipped: 0,
    errors: results.filter((r) => r === 'error').length,
  };
}

// ─── Customer sales receipt («mijoz cheki») routing ──────────────────────────
// The receipt counterpart of picking-sheet routing: the whole account has one
// configured receipt printer (Settings → Sklad-keepers → «Chek printeri»,
// stored on CompanySettings). When the agent (or Electron) is up and that
// printer is set, the receipt prints straight to it — one action, correct
// thermal size — exactly like the omborchi sheet. Otherwise the caller falls
// back to the browser popup print (/print/retail-sale/[id]).

/**
 * Chek modeli — `lib/pos/receipt-model.ts` da (sof, uchala renderer uchun
 * bitta manba). Bu yerdagi tiplar shunchaki uning kirishi.
 */
type ReceiptSale = ReceiptSaleInput;

/**
 * ESC/POS oddiy matn cheki — 32 ustun.
 *
 * Egasi bergan namuna (`chek.png`) tuzilishi tor lentaga MOSLASHTIRILGAN
 * holda saqlanadi: 6 ustunli chiziqli jadval 32 belgiga sig'maydi, shuning
 * uchun har pozitsiya ikki qatorda chiqadi — barcha OLTI maydon bilan
 * (№/nom · soni × o'lchov birligi × narx · summa). Yorliqlar, tartib va
 * pastki bloklar namunadagidek.
 *
 * Eksport qilingan — uchala renderer bir xil qatorlarni chiqarishi
 * `lib/__tests__/receipt-renderers.test.ts` da qulflangan.
 */
export function buildReceiptText(sale: ReceiptSale): string {
  const W = 32;
  const m = buildReceiptModel(sale);
  const bar = '-'.repeat(W);
  const center = (v: string) => {
    if (v.length >= W) return v;
    return ' '.repeat(Math.floor((W - v.length) / 2)) + v;
  };
  /** Uzun matnni lenta enida o'raydi — printer o'ng chetini qirqmasin. */
  const push = (dst: string[], text: string, centered = false) => {
    for (const line of wrapText(text, W)) dst.push(centered ? center(line) : line);
  };
  /**
   * Chap yorliq + o'ngga tekislangan qiymat.
   *
   * 🔴 Sig'masa qator UZAYMAYDI: yorliq o'z qator(lar)iga o'raladi, qiymat esa
   * keyingi qatorda o'ngga tekislanadi. Ilgari `l + ' ' + r` qaytarardi va
   * «Chek bo'yicha umumiy summa: 150 000» 35 belgi bo'lib chiqib, termal
   * printer o'ng chetini QIRQIB tashlardi — ya'ni summa yo'qolardi.
   */
  const pushRow = (dst: string[], l: string, r: string) => {
    if (l.length + 1 + r.length <= W) {
      dst.push(l + ' '.repeat(W - l.length - r.length) + r);
      return;
    }
    for (const line of wrapText(l, W)) dst.push(line);
    dst.push(' '.repeat(Math.max(0, W - r.length)) + r);
  };

  const L: string[] = [];
  // ── Shapka (namunadagi tartib) ──
  push(L, m.orgName, true);
  if (m.orgPhone) L.push(center(m.orgPhone));
  L.push(center(`${m.title} № ${m.docNumber}`));
  L.push(center(`${RECEIPT_LABELS.date}: ${m.dateLabel}`));
  L.push('');
  // ── Rekvizitlar ──
  push(L, `${RECEIPT_LABELS.seller}: ${m.sellerName}`);
  push(L, `${RECEIPT_LABELS.buyer}: ${m.buyerName}`);
  // Kontragent telefoni (2026-08-31, egasi) — kartochkada bo'lsagina chiqadi.
  if (m.buyerPhone) push(L, `${RECEIPT_LABELS.phone}: ${m.buyerPhone}`);
  // Izoh bo'sh bo'lsa qator UMUMAN chizilmaydi (2026-08-19): ilgari har
  // chekda bo'sh «Izoh:» chiqib turardi va qog'oz ham, o'qish ham behuda edi.
  if (m.comment.trim()) push(L, `${RECEIPT_LABELS.comment}: ${m.comment}`);
  L.push(bar);
  // ── Ustun sarlavhalari. Namunadagi 6 ustun 32 belgiga sig'maydi, shuning
  //    uchun ular ikki qatorli «legenda» bo'lib chiqadi — nomlar YO'QOLMAYDI,
  //    kassir va mijoz qaysi raqam nima ekanini o'qiy oladi.
  // `wrapText` bo'sh joyni yeydi, shuning uchun legenda QO'LDA tekislanadi —
  // uning chekinishi pastdagi ma'lumot qatoriga aynan to'g'ri kelishi kerak.
  L.push(`№ ${RECEIPT_LABELS.colName}`);
  L.push(
    `   ${RECEIPT_LABELS.colQty} ${RECEIPT_LABELS.colUom} x ${RECEIPT_LABELS.colPrice}`.slice(0, W),
  );
  L.push(' '.repeat(Math.max(0, W - RECEIPT_LABELS.colSum.length)) + RECEIPT_LABELS.colSum);
  L.push(bar);
  // ── Pozitsiyalar: nom alohida qatorda, keyin soni×birlik×narx → summa ──
  for (const r of m.rows) {
    push(L, `${r.index}. ${r.name}`);
    pushRow(L, `   ${r.qty} ${r.uom} x ${r.price}`, r.sum);
  }
  L.push(bar);
  // ── Jamilar: namunada uchalasi ham DOIM chiqadi (chegirma 0 bo'lsa ham) ──
  pushRow(L, `${RECEIPT_LABELS.subtotal}:`, m.subtotal);
  pushRow(L, `${RECEIPT_LABELS.discount}:`, m.discount);
  pushRow(L, `${RECEIPT_LABELS.total}:`, m.total);
  // ── To'lov turlari (namunadan tashqari — izohi `receipt-model.ts` da) ──
  if (m.payments.length > 0) {
    L.push(bar);
    for (const p of m.payments) {
      pushRow(L, `${p.label}:`, p.value);
      if (p.note) pushRow(L, `  ${p.note.left}`, p.note.right);
    }
  }
  // ── P05: mijozning qolgan qarzi — to'lovlardan keyin, footer'dan oldin.
  //    null = o'lchanmagan, 0 = qarz yo'q — savdo chekida ikkalasida qator
  //    chizilmaydi; qarz to'lovi chekida (showZeroDebt) 0 ham chiqadi.
  if (m.debtAfterMinor != null && (m.debtAfterMinor > 0n || m.showZeroDebt)) {
    L.push(bar);
    pushRow(L, `${RECEIPT_LABELS.debtAfter}:`, fmtSom(m.debtAfterMinor));
  }
  L.push(bar);
  push(L, `${RECEIPT_LABELS.itemsCount}: ${m.itemsCount} ${RECEIPT_LABELS.itemsUnit}`);
  push(L, `${RECEIPT_LABELS.inWords}: ${m.inWords}`);
  L.push(bar);
  push(L, RECEIPT_LABELS.footerLegal, true);
  push(L, RECEIPT_LABELS.footerThanks, true);
  return L.join('\n');
}

/**
 * 80mm-termal HTML cheki — Electron `printSheet` uchun (drayver chizadi).
 * Namunadagi CHIZIQLI jadval shu yerda 1:1 saqlanadi (matnli renderer'da
 * u 32 ustunga sig'maydi). Eksport qilingan — test bilan qulflangan.
 */
export function buildReceiptHtml(sale: ReceiptSale): string {
  const m = buildReceiptModel(sale);
  const e = escapeHtml;

  const rowsHtml = m.rows
    .map(
      (r) =>
        `<tr><td class="c nw">${r.index}</td><td class="c nm">${e(r.name)}</td>` +
        `<td class="c">${e(r.uom)}</td><td class="c nw">${e(r.qty)}</td>` +
        `<td class="r">${e(r.price)}</td><td class="r">${e(r.sum)}</td></tr>`,
    )
    .join('');

  const totalsHtml =
    `<tr><td colspan="5" class="c">${e(RECEIPT_LABELS.subtotal)}:</td><td class="r">${e(m.subtotal)}</td></tr>` +
    `<tr><td colspan="5" class="c">${e(RECEIPT_LABELS.discount)}:</td><td class="r">${e(m.discount)}</td></tr>` +
    `<tr class="tot"><td colspan="5" class="c">${e(RECEIPT_LABELS.total)}:</td><td class="r">${e(m.total)}</td></tr>`;

  const payHtml = m.payments
    .map(
      (p) =>
        `<tr><td colspan="5" class="c">${e(p.label)}:</td><td class="r">${e(p.value)}</td></tr>` +
        (p.note
          ? `<tr class="sub"><td colspan="5" class="c">${e(p.note.left)}</td><td class="r">${e(p.note.right)}</td></tr>`
          : ''),
    )
    .join('');

  // P05: qolgan qarz — to'lov qatorlari uslubida, ulardan keyin.
  // Qarz to'lovi chekida (showZeroDebt) 0 qoldiq ham chiziladi.
  const debtHtml =
    m.debtAfterMinor != null && (m.debtAfterMinor > 0n || m.showZeroDebt)
      ? `<tr><td colspan="5" class="c">${e(RECEIPT_LABELS.debtAfter)}:</td><td class="r">${e(fmtSom(m.debtAfterMinor))}</td></tr>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{margin:0}
*{box-sizing:border-box}
body{width:72mm;margin:0;padding:2mm 1mm;font-family:'Times New Roman',Times,serif;font-size:11px;line-height:1.3;color:#000}
.h{text-align:center}
.org{font-weight:700;font-size:16px}
.ttl{font-weight:700;font-size:15px;margin-top:2px}
.req{margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:4px;font-size:11px}
td{border:1px solid #000;padding:2px 3px;vertical-align:middle;overflow-wrap:anywhere}
.c{text-align:center}
.r{text-align:right;white-space:nowrap}
/* № va «Soni» — RAQAM ustunlari. td dagi overflow-wrap:anywhere («Nomi»
   uchun kerak) ularga ham tegib, 200 ni «20»+«0» qilib SINDIRARDI (egasining
   fotosi, 2026-09-02: CHEK-112159, «Gofra ko'k 32x» qatori). nowrap sinish
   NUQTASINI umuman yo'q qiladi — cheklov 4 xona emas, ixtiyoriy uzunlik;
   auto-layout ustunni raqam bo'yi kengaytiradi, «Nomi» qolganini oladi. */
.nw{white-space:nowrap}
.nm{text-align:center}
.tot{font-weight:700;font-size:13px}
.sub{font-size:10px}
.foot{margin-top:8px;overflow-wrap:anywhere}
.sep{border-top:1px solid #000;margin:14px 0 8px}
.thanks{text-align:center;line-height:1.5}
</style></head><body>
<div class="h org">${e(m.orgName)}</div>
${m.orgPhone ? `<div class="h">${e(m.orgPhone)}</div>` : ''}
<div class="h ttl">${e(m.title)} № ${e(m.docNumber)}</div>
<div class="h"><b>${e(RECEIPT_LABELS.date)}:</b> ${e(m.dateLabel)}</div>
<div class="req">
<div>${e(RECEIPT_LABELS.seller)}: ${e(m.sellerName)}</div>
<div>${e(RECEIPT_LABELS.buyer)}: ${e(m.buyerName)}</div>
${m.buyerPhone ? `<div>${e(RECEIPT_LABELS.phone)}: ${e(m.buyerPhone)}</div>` : ''}
${m.comment.trim() ? `<div>${e(RECEIPT_LABELS.comment)}: ${e(m.comment)}</div>` : ''}
</div>
<table>
<tr><td class="c nw">№</td><td class="c">${e(RECEIPT_LABELS.colName)}</td><td class="c">${e(RECEIPT_LABELS.colUom)}</td><td class="c nw">${e(RECEIPT_LABELS.colQty)}</td><td class="c">${e(RECEIPT_LABELS.colPrice)}</td><td class="c">${e(RECEIPT_LABELS.colSum)}</td></tr>
${rowsHtml}
${totalsHtml}
${payHtml}
${debtHtml}
</table>
<div class="foot">
<div>${e(RECEIPT_LABELS.itemsCount)}: <b>${m.itemsCount} ${e(RECEIPT_LABELS.itemsUnit)}</b></div>
<div>${e(RECEIPT_LABELS.inWords)}: <b>${e(m.inWords)}</b></div>
</div>
<div class="sep"></div>
<div class="thanks">
<div>${e(RECEIPT_LABELS.footerLegal)}</div>
<div>${e(RECEIPT_LABELS.footerThanks)}</div>
</div>
</body></html>`;
}

export interface ReceiptPrintOutcome {
  /** true = the agent/Electron handled printing → caller must NOT popup-print. */
  handled: boolean;
  ok: boolean;
  error?: string;
  /** handled=false bo'lganda — uzilish qavati (`PrintIdleReason`). */
  reason?: PrintIdleReason;
}

/**
 * Print the customer sales receipt straight to the device's default printer via
 * the local agent (or Electron native). Returns handled=false — so the caller
 * falls back to the browser popup — when the agent is down or the sale can't be
 * loaded.
 */
export async function printReceiptViaAgent(saleId: string): Promise<ReceiptPrintOutcome> {
  const idle = (reason: PrintIdleReason): ReceiptPrintOutcome => ({
    handled: false,
    ok: false,
    reason,
  });
  if (!(await checkPrintAgent())) return idle('no-agent');

  let sale: ReceiptSale;
  try {
    sale = await api.get<ReceiptSale>(`/retail-sales/${saleId}`);
  } catch {
    return idle('load-failed');
  }

  // P05 — kontragentli chekda qolgan qarz. Helper fail-open (`null`), ya'ni
  // summary yiqilsa chek qarz qatorisiz BARIBIR bosiladi.
  if (sale.agent?.id) sale.debtAfterMinor = await fetchDebtAfter(sale.agent.id);

  // Printer TANLANMAYDI: qobiq bo'sh nomni Windows sukut printeri deb tushunadi
  // (desktop v1.4.0+). Akkaunt-darajali sozlama butunlay olib tashlandi — u
  // ikki kassada bir vaqtda to'g'ri bo'la olmasdi va kiosk kassirda uni
  // sozlaydigan sahifa umuman yo'q edi.
  const el = electron();
  const r = el
    ? await el.printSheet('', buildReceiptHtml(sale), THERMAL_PAGE_MICRONS)
    : await agentPrint('', { text: buildReceiptText(sale) });
  return { handled: true, ok: r.ok, error: r.error };
}

/**
 * Qarz to'lovi chekini qurilmaning sukut printeriga JIM chop etadi
 * (2026-08-16, egasi) — tovar cheki bilan AYNI yo'l va AYNI shablon
 * (`debtReceiptToSaleInput` → `buildReceiptHtml`/`buildReceiptText`).
 *
 * Ilgari POS to'lovdan keyin `window.open('/print/debt-payment/…?auto=1')`
 * qilardi — kassa.exe'da chek ALOHIDA OYNADA ekranga chiqardi va dizayni
 * boshqa (PKO) edi. Endi chaqiruvchi tovar cheki naqshida `finishPrint`
 * bilan yakunlaydi: qobiq/agent o'lik bo'lsagina brauzer-zaxira ochiladi.
 *
 * Chek server javobidan TO'LIQ yig'iladi (qoldiq ham `outstandingAfterMinor`
 * ichida) — `fetchDebtAfter` ga o'xshash qo'shimcha so'rov KERAK EMAS va
 * qayta chop etishda ham AYNI raqamlar chiqadi (chek — moliyaviy hujjat).
 */
export async function printDebtReceiptViaAgent(batchId: string): Promise<ReceiptPrintOutcome> {
  const idle = (reason: PrintIdleReason): ReceiptPrintOutcome => ({
    handled: false,
    ok: false,
    reason,
  });
  if (!(await checkPrintAgent())) return idle('no-agent');

  let receipt: DebtReceiptPayload;
  try {
    receipt = await api.get<DebtReceiptPayload>(`/debts/pos/receipt/${batchId}`);
  } catch {
    return idle('load-failed');
  }

  const sale = debtReceiptToSaleInput(receipt);
  const el = electron();
  const r = el
    ? await el.printSheet('', buildReceiptHtml(sale), THERMAL_PAGE_MICRONS)
    : await agentPrint('', { text: buildReceiptText(sale) });
  return { handled: true, ok: r.ok, error: r.error };
}

/**
 * SOTUVSIZ CHEK (proforma, 2026-08-16 — egasi so'rovi): savatdan yig'ilgan
 * tayyor `ReceiptSaleInput` ni chop etadi — server so'rovi YO'Q (sotuv ham,
 * hujjat ham yaratilmagan; kirish `cartToProformaReceipt` dan keladi).
 *
 * Yo'l tovar cheki bilan AYNI: qobiq (Electron) → HTML, agent → ESC/POS matn.
 * Ikkalasi ham yo'q bo'lsa BRAUZER-ZAXIRA shu yerning o'zida: popup oynaga
 * chek-HTML yozilib `print()` chaqiriladi (tovar chekidagi `/print/...` URL
 * zaxirasining analogi — proformada server sahifasi yo'q, shuning uchun HTML
 * bevosita beriladi). Popup bloklangan bo'lsa `handled:false` qaytadi.
 */
export async function printProformaReceiptViaAgent(
  input: ReceiptSaleInput,
): Promise<ReceiptPrintOutcome> {
  const el = electron();
  if (el) {
    const r = await el.printSheet('', buildReceiptHtml(input), THERMAL_PAGE_MICRONS);
    return { handled: true, ok: r.ok, error: r.error };
  }
  if (await checkPrintAgent()) {
    const r = await agentPrint('', { text: buildReceiptText(input) });
    return { handled: true, ok: r.ok, error: r.error };
  }
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return { handled: false, ok: false, reason: 'no-agent' };
  w.document.write(buildReceiptHtml(input));
  w.document.close();
  w.focus();
  w.print();
  return { handled: true, ok: true };
}

// ─── Z-hisobot («Z-отчёт») chop etish ────────────────────────────────────────
// Chek bilan AYNI yo'l: agent/Electron tirik bo'lsa qog'oz to'g'ridan-to'g'ri
// qurilmaning sukut printeridan chiqadi, aks holda chaqiruvchi brauzer
// popup'iga (`/print/z-report/<id>?auto=1`) tushadi.
//
// 🔴 Raqamlar bu yerda ham HISOBLANMAYDI — server javobi to'g'ridan-to'g'ri
// `buildZReceipt` ga beriladi, ya'ni qog'oz, Electron-HTML va ekran bitta
// modeldan chiziladi (xotira: «Ombor cheki uch renderer»).

/**
 * Z-hisobotni qurilmaning sukut printeriga yuboradi.
 *
 * `labels` chaqiruvchidan keladi (`useZReceiptLabels()`) — print-agent
 * React kontekstida emas, i18n'ni o'zi o'qiy olmaydi.
 */
export async function printZReportViaAgent(
  sessionId: string,
  labels: ZReceiptLabels,
): Promise<ReceiptPrintOutcome> {
  const idle = (reason: PrintIdleReason): ReceiptPrintOutcome => ({
    handled: false,
    ok: false,
    reason,
  });
  if (!(await checkPrintAgent())) return idle('no-agent');

  // Ilgari bu yerda `/sklad-keepers` dan `receiptPrinterName` o'qilardi va
  // bo'sh bo'lsa `printer-not-set` qaytarilardi. Chek bilan bir xil yo'l:
  // sozlama olib tashlandi, printerni qobiq (Windows sukuti) tanlaydi.
  let z: ZReportPayload;
  try {
    z = await api.get<ZReportPayload>(`/cashier-sessions/${sessionId}/z-report`);
  } catch {
    return idle('load-failed');
  }

  // Qaytarishlar SONI — eski endpointda. Yiqilsa chek baribir chiqadi,
  // faqat son o'rnida «—» turadi (NOL EMAS).
  let returnsCount: number | null = null;
  try {
    const legacy = await api.get<{ returnsCount: number }>(
      `/retail-sales/z-report?sessionId=${sessionId}`,
    );
    if (typeof legacy.returnsCount === 'number') returnsCount = legacy.returnsCount;
  } catch {
    returnsCount = null;
  }

  const view = buildZReceipt(z, { labels, returnsCount });
  const el = electron();
  const r = el
    ? await el.printSheet('', renderZReceiptHtml(view), THERMAL_PAGE_MICRONS)
    : await agentPrint('', { text: renderZReceiptText(view) });
  return { handled: true, ok: r.ok, error: r.error };
}
