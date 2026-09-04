import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  TSD_PRODUCT_SELECT,
  classifyScanCode,
  normalizeScanCode,
  pickExactHits,
} from './tsd-scan.js';
import { SEARCH_MIN_LEN, SEARCH_TAKE, normalizeSearchQuery, sortSearchHits } from './tsd-search.js';

export const TsdScanQuerySchema = z.object({
  code: z.string().min(1).max(200),
});

/**
 * T3 — nom/artikul qidiruvi.
 *
 * Ikki chegara ATAYLAB ikki xil vazifada: bu yerdagi `1000` — MUDOFAA
 * (megabaytlik matn umuman qabul qilinmasin), ma'noli chegara esa
 * `SEARCH_MAX_LEN` (100) va u rad ETMAYDI, KESADI. Omborchi tasodifan uzun
 * matn qo'yib yuborsa qidiruv ishlashda davom etsin — 400 bilan to'xtash
 * uning ishini uzardi.
 */
export const TsdSearchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
});

/**
 * `TSD_PRODUCT_SELECT` bilan o'qilgan XOM qator — `buildProductHits` kirishi.
 *
 * Tur oq ro'yxatning aksi: narx maydoni bu yerda ham YO'Q, ya'ni kimdir
 * `select` ga narx ustuni qo'shsa TypeScript uni bu turdan o'tkazmaydi.
 */
interface TsdProductRow {
  id: string;
  name: string;
  code: string | null;
  article: string | null;
  barcodes: string[];
  uom: string | null;
  archived: boolean;
  attributes: unknown;
}

/** Bitta skan natijasidagi tovar — NARX MAYDONI YO'Q (`tsd-scan.ts` izohi). */
interface TsdProductHit {
  id: string;
  name: string;
  code: string | null;
  article: string | null;
  barcodes: string[];
  uom: string | null;
  archived: boolean;
  /** Tovarning «uy» yacheykasi (`attributes.__yacheyka`) — picking shundan yuradi. */
  homeCell: string | null;
  /** Butun tizim bo'yicha jami qoldiq (ombor kesimisiz — terminalga yetarli). */
  totalQty: string;
  /** Yacheyka kesimidagi haqiqiy qoldiq (`StockByCell`). */
  cells: Array<{
    storeId: string;
    storeName: string;
    cellId: string;
    cellName: string;
    qty: string;
  }>;
}

/**
 * TSD skan-qidiruvi (G-reja G5).
 *
 * Bu servis ATAYLAB `ProductService` ni chaqirmaydi: uning har bir o'quv yo'li
 * to'liq tovar qatorini (kirim narxi bilan) qaytaradi va bir kun kimdir u
 * yerga yangi maydon qo'shsa narx jimgina terminalga oqib chiqardi. Bu yerdagi
 * so'rov `select` bilan OQ RO'YXAT ustida ishlaydi.
 */
@Injectable()
export class TsdService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * K4 — skanerlangan `BLK-` yorlig'i bo'yicha BITTA bo'lak.
   *
   * Multi-hit YO'Q va bo'lishi ham mumkin emas: yorliq akkaunt ichida unikal
   * (K1, `@@unique([accountId, label])`) — K-reja 7.3 ning butun ma'nosi
   * shunda. Topilmasa `found: false` qaytadi va terminal aniq xabar beradi;
   * jimgina boshqa tovar OCHILMAYDI.
   */
  private async findPiece(accountId: string, code: string) {
    const label = code.trim().toUpperCase();
    const piece = await this.prisma.client.stockPiece.findFirst({
      where: { accountId, label },
      select: {
        id: true,
        label: true,
        length: true,
        whole: true,
        status: true,
        assortmentId: true,
        storeId: true,
        store: { select: { name: true } },
        cell: { select: { name: true } },
        reservedPositionId: true,
      },
    });
    if (!piece) return { code, supported: true as const, found: false as const };

    // Tovar nomi — NARXSIZ oq ro'yxatdan (`TSD_PRODUCT_SELECT` bilan bir qoida).
    const product = await this.prisma.client.product.findFirst({
      where: { accountId, id: piece.assortmentId },
      select: { id: true, name: true, code: true, uom: true, pieceTracked: true },
    });

    return {
      code,
      supported: true as const,
      found: true as const,
      id: piece.id,
      label: piece.label,
      length: piece.length.toString(),
      whole: piece.whole,
      status: piece.status,
      /** Boshqa chek uchun ajratilganmi (omborchi buni ko'rishi kerak). */
      reserved: piece.reservedPositionId !== null,
      storeId: piece.storeId,
      storeName: piece.store?.name ?? null,
      cellName: piece.cell?.name ?? null,
      product,
    };
  }

  async scan(accountId: string, rawQuery: unknown) {
    const parsed = TsdScanQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException('Skan kodi kiritilmadi');
    const code = normalizeScanCode(parsed.data.code);
    const kind = classifyScanCode(code);

    // K-reja 7.3 — bo'lak kodi tovar qidiruviga TUSHMAYDI (izoh `tsd-scan.ts`).
    //
    // K4 (2026-08-26): shox TO'LDIRILDI. K1–K3 davrida bu yerda
    // `supported: false` turardi — bo'lakni ochadigan ekran hali yo'q edi va
    // terminal «hali qo'llab-quvvatlanmaydi» derdi. Endi bo'lak topiladi.
    //
    // 🔴 NARX YO'Q va bu TUZILMAVIY: `stock_pieces` da narx tushunchasi
    // umuman yo'q, tovar nomi esa oq ro'yxatdagi ustunlardan olinadi — ya'ni
    // `Product` ga yangi narx ustuni qo'shilsa ham bu yo'lga kirmaydi.
    if (kind === 'piece') {
      return {
        code,
        kind: 'piece' as const,
        piece: await this.findPiece(accountId, code),
        products: [],
      };
    }

    // Yacheyka kodi — terminal `/admin/stores/cells/by-barcode` ga o'tadi
    // (allowlist'da bor, narxsiz). Bu yerda tovar qidirilmaydi: yacheyka
    // kodi tovar shtrixi bo'lib qolishi mumkin emas.
    if (kind === 'cell') {
      return { code, kind: 'cell' as const, products: [] };
    }

    const rows = await this.prisma.client.product.findMany({
      where: {
        accountId,
        deletedAt: null,
        OR: [{ barcodes: { has: code } }, { code }, { article: code }],
      },
      select: TSD_PRODUCT_SELECT,
      take: 20,
    });
    if (rows.length === 0) return { code, kind: 'none' as const, products: [] };

    // Multi-hit qoidasi — G-reja majburiy bandi (`pickExactHits` izohi).
    const winners = pickExactHits(
      rows.map((r) => ({ ...r, barcodes: r.barcodes ?? [] })),
      code,
    );

    return {
      code,
      kind: 'product' as const,
      products: await this.buildProductHits(accountId, winners),
    };
  }

  /**
   * T3 — NOM / ARTIKUL bo'yicha qidiruv (`GET /tsd/search`).
   *
   * `scan` dan farqi bitta: bu yerda moslik AYNAN emas, ICHIDA
   * (`contains`) — ya'ni shtrixi yirtilgan yoki bazaga kiritilmagan tovar
   * ham topiladi (T-reja §1.2 dagi boshi berk ko'chaning ildizi).
   *
   * 🔴 NARX: so'rov `TSD_PRODUCT_SELECT` oq ro'yxati ustida ketadi va javob
   * `scan` bilan BIR XIL `buildProductHits` dan chiqadi — ya'ni qidiruv
   * o'zining alohida javob shakliga EGA EMAS va narx maydonini qo'shib
   * yuborishi tuzilmaviy jihatdan mumkin emas.
   *
   * 🔴 MULTI-HIT qoidasi kuchda: bu yo'l HECH QACHON o'zi tovar tanlamaydi —
   * hatto bitta natija qaytganda ham. Tanlovni ODAM qiladi (ilova ro'yxatni
   * ko'rsatadi), `pickExactHits` bu yerda ATAYLAB chaqirilmaydi: u
   * skanerlangan token uchun («aynan mos kelgan shtrix ustun»), qidiruv
   * so'rovi esa ataylab noaniq.
   */
  async search(accountId: string, rawQuery: unknown) {
    const parsed = TsdSearchQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException('Qidiruv so`rovi kiritilmadi');
    const query = normalizeSearchQuery(parsed.data.q);
    if (query.length < SEARCH_MIN_LEN) {
      throw new BadRequestException(`Kamida ${SEARCH_MIN_LEN} belgi yozing`);
    }

    const rows = await this.prisma.client.product.findMany({
      where: {
        accountId,
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { article: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } },
          { barcodes: { has: query } },
        ],
      },
      select: TSD_PRODUCT_SELECT,
      // Kesish DB tomonda bo'lgani uchun tartib ham DB tomonda aniq bo'lishi
      // SHART: usiz `take` har safar boshqa 30 tani olib kelardi. Arxiv shu
      // yerdayoq pastga tushadi, ya'ni kesilgan 30 ta tirik tovarga to'g'ri
      // keladi; nozik saralash (aynan/boshida/ichida) esa xotirada.
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
      take: SEARCH_TAKE,
    });

    return {
      query,
      products: await this.buildProductHits(
        accountId,
        sortSearchHits(
          rows.map((r) => ({ ...r, barcodes: r.barcodes ?? [] })),
          query,
        ),
      ),
      // Ro'yxat kesilgan bo'lsa omborchi «hammasi shu» deb o'ylamasin.
      truncated: rows.length === SEARCH_TAKE,
    };
  }

  /**
   * SKAN va QIDIRUV uchun YAGONA hit-quruvchi (T3).
   *
   * 🔴 Nega umumiy: ilova bitta renderer va bitta `PickProductScreen` bilan
   * ishlaydi. Ikki sirt ikki xil shakl qaytarsa, ikkinchisida `cells` yoki
   * `homeCell` yo'q bo'lib qolgan kun ekran jimgina bo'sh joy chizardi va
   * buni test emas, omborchi topardi. Shuning uchun shakl BU YERDA, bir
   * marta quriladi va `tsd.service.test.ts` ikkala yo'l bir xil kalitlar
   * to'plamini berishini qulflaydi.
   *
   * 🔴 NARX YO'Q: kirish qatorlari `TSD_PRODUCT_SELECT` bilan o'qiladi,
   * qo'shimcha so'rovlar esa faqat `Stock`/`StockByCell` ga boradi — ularda
   * narx ustuni umuman yo'q (qoldiq jadvallari).
   */
  private async buildProductHits(
    accountId: string,
    rows: readonly TsdProductRow[],
  ): Promise<TsdProductHit[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const [stocks, cellRows] = await Promise.all([
      this.prisma.client.stock.findMany({
        where: { accountId, assortmentKind: 'product', assortmentId: { in: ids } },
        select: { assortmentId: true, qty: true },
      }),
      this.prisma.client.stockByCell.findMany({
        where: { accountId, assortmentKind: 'product', assortmentId: { in: ids } },
        select: {
          assortmentId: true,
          storeId: true,
          cellId: true,
          qty: true,
          store: { select: { name: true } },
          cell: { select: { name: true } },
        },
      }),
    ]);

    return rows.map((w) => {
      const total = stocks
        .filter((s) => s.assortmentId === w.id)
        .reduce((sum, s) => sum + Number(s.qty), 0);
      const attrs = (w.attributes ?? {}) as Record<string, unknown>;
      const home = typeof attrs.__yacheyka === 'string' ? attrs.__yacheyka : null;
      return {
        id: w.id,
        name: w.name,
        code: w.code,
        article: w.article,
        barcodes: w.barcodes,
        uom: w.uom,
        archived: w.archived,
        homeCell: home,
        totalQty: String(total),
        cells: cellRows
          .filter((c) => c.assortmentId === w.id)
          .map((c) => ({
            storeId: c.storeId,
            storeName: c.store?.name ?? '',
            cellId: c.cellId,
            cellName: c.cell?.name ?? '',
            qty: c.qty.toString(),
          })),
      };
    });
  }
}
