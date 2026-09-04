import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { nextInventoryName } from '../inventory/inventory-number.js';
import { resolveCreatorGroupId } from '../shared/group-stamp.js';
import {
  COUNT_SESSION_LINE_SELECT,
  COUNT_SESSION_SELECT,
  COUNT_SESSION_STATE,
  type CountSessionAutoDoc,
  type CountSessionCounters,
  type CountSessionRow,
  EMPTY_COUNTERS,
  buildCountSessionLine,
  summarizeCountSessionLines,
} from './count-session.js';

export const OpenCountSessionSchema = z.object({
  storeId: z.string().uuid(),
});

/** `setCellStock` ilgagining kirishi — HAMMA son STRING (javobdagi aynan o'sha). */
export interface RecordCountInput {
  accountId: string;
  userId: string;
  storeId: string;
  cellId: string;
  cellName: string;
  assortmentId: string;
  expectedQty: string;
  actualQty: string;
  varianceQty: string;
  pieceEntry?: string | null;
  autoDoc: CountSessionAutoDoc | null;
}

/** Javob shakli: sessiya + hisoblagichlar. NARX YO'Q (`count-session.ts` izohi). */
export interface CountSessionView extends CountSessionRow {
  counters: CountSessionCounters;
}

/**
 * Sanash sessiyasi servisi — N-reja §5-N2.
 *
 * Sessiya mavjud `Inventory` hujjatida yashaydi (Q1), lekin u ODDIY
 * inventarizatsiya EMAS: `countSession = true` bayrog'i uni post/cancel/update/
 * delete dan qo'riqlaydi (`inventory.service.ts` — N1). Shuning uchun bu servis
 * ATAYLAB `InventoryService` ni chaqirmaydi: uning `create()` yo'li
 * `attributes` ni normalizatsiya qiladi, qatorlarni majburlaydi va bayroqni
 * bilmaydi. Yagona umumiy narsa — hujjat RAQAMI (`nextInventoryName`), u
 * `inventory-number.ts` da bitta manbada turadi.
 *
 * 🔴 QOLDIQQA TEGMAYDI. Bu faylda qoldiq yozadigan hech bir chaqiruv YO'Q va
 * bo'lmasligi kerak — sanoq izi qatlami hech qachon qoldiqni
 * harakatlantirmaydi (N-reja §3 qoida 3). Buni `count-session.service.test.ts`
 * MANBA MATNINI o'qib tekshiradi (K-reja naqshi), shuning uchun taqiqlangan
 * identifikatorlar bu izohda ham ATAYLAB yozilmagan.
 */
@Injectable()
export class CountSessionService {
  private readonly logger = new Logger(CountSessionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * «Sanashni boshlash». **Idempotent:** omborchida shu omborda ochiq sessiya
   * bo'lsa — o'sha qaytadi (yangi hujjat OCHILMAYDI). Terminal aloqasi
   * uzilib qayta yuborsa ham ro'yxatda ikkita bo'sh hujjat paydo bo'lmaydi.
   *
   * Boshqa omborda ochiq sessiya bo'lsa — 400. Sabab: bir omborchida bir
   * vaqtda BITTA ochiq sessiya (N-reja §5-N2.1), va jim «boshqa ombordagi
   * sessiyani qaytarish» eng yomon variant bo'lardi — omborchi 02-ombor
   * yacheykalarini sanab, izi 01-omborning hujjatiga tushardi.
   */
  async open(accountId: string, userId: string, raw: unknown): Promise<CountSessionView> {
    const { storeId } = this.parse(OpenCountSessionSchema, raw);
    const store = await this.prisma.client.store.findFirst({
      where: { id: storeId, accountId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Ombor topilmadi');

    const existing = await this.findOpen(accountId, userId);
    if (existing) {
      if (existing.storeId !== storeId) {
        throw new BadRequestException(
          `Boshqa omborda ochiq sanash sessiyasi bor (${existing.name}) — avval uni yoping`,
        );
      }
      return this.withCounters(existing);
    }

    // `setCellStock` dagi bilan AYNI qoida: birinchi tashkilot. Sessiya
    // hujjati buxgalteriya hujjati emas (post qilinmaydi), lekin
    // `organization_id` ustuni NOT NULL — hujjat ro'yxatda ko'rinishi uchun
    // shu qiymat kerak.
    const org = await this.prisma.client.organization.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!org) throw new BadRequestException('Tashkilot topilmadi');

    const name = await nextInventoryName(this.prisma.client, accountId);
    const groupId = await resolveCreatorGroupId(this.prisma.client, accountId, userId);
    const created = await this.prisma.client.inventory.create({
      data: {
        accountId,
        ownerId: userId,
        groupId,
        name,
        organizationId: org.id,
        storeId,
        moment: new Date(),
        state: 'draft',
        description: 'TSD sanash sessiyasi',
        // 🔴 Bayroq — HAQIQIY ustun (§2.2). `attributes` ga yozilsa
        // `validateAndNormalize` uni birinchi web-tahrirda tashlab yuborardi.
        countSession: true,
        countedBy: userId,
      },
      select: COUNT_SESSION_SELECT,
    });
    return { ...created, counters: EMPTY_COUNTERS };
  }

  /** Ochiq sessiya + hisoblagichlar; sessiya bo'lmasa `null`. */
  async active(accountId: string, userId: string): Promise<{ session: CountSessionView | null }> {
    const open = await this.findOpen(accountId, userId);
    return { session: open ? await this.withCounters(open) : null };
  }

  /**
   * «Yopish» — `closedAt` va `state = 'counted'`.
   *
   * Yopilgan sessiyani qayta yopish XATO EMAS: terminal javobni olmasdan
   * qayta yuborishi mumkin va o'sha zahoti 400 ko'rsatish omborchini
   * chalg'itardi. Ikkinchi so'rov o'sha hujjatni O'ZGARTIRMASDAN qaytaradi
   * (`closedAt` birinchi yopishnikidek qoladi).
   */
  async close(accountId: string, userId: string, id: string): Promise<CountSessionView> {
    const session = await this.prisma.client.inventory.findFirst({
      where: { id, accountId, countSession: true, deletedAt: null },
      select: COUNT_SESSION_SELECT,
    });
    if (!session) throw new NotFoundException('Sanash sessiyasi topilmadi');
    if (session.countedBy !== userId) {
      throw new ForbiddenException('Bu sanash sessiyasi boshqa omborchiniki');
    }
    if (session.closedAt) return this.withCounters(session);

    const closed = await this.prisma.client.inventory.update({
      where: { id, accountId },
      data: { closedAt: new Date(), state: COUNT_SESSION_STATE },
      select: COUNT_SESSION_SELECT,
    });
    return this.withCounters(closed);
  }

  /**
   * 🔴 `setCellStock` ILGAGI — sanoq izini sessiyaga QO'SHADI.
   *
   * Ikki qattiq qoida:
   *
   * 1. **APPEND**, `InventoryService.update()` EMAS. `update()` `positions`
   *    berilganda avval `deleteMany` qiladi (`inventory.service.ts:588`) —
   *    ya'ni har yangi sanoq oldingi hamma izni o'chirib tashlardi. Bu yerda
   *    faqat `inventoryPosition.create` bor.
   * 2. **Bu metod HECH QACHON tashqariga xato chiqarmaydi.** Sanoq yo'li
   *    sessiyaga BOG'LIQ EMAS: iz yozilmasa ham omborchining sanog'i
   *    muvaffaqiyatli qaytadi (chaqiruvchi ham `try/catch` bilan o'ralgan —
   *    ikki qavat, chunki bu qatlam omborchini bloklamasligi shart).
   *    Xato `logger.error` ga tushadi.
   */
  async recordCount(input: RecordCountInput): Promise<{ recorded: boolean }> {
    try {
      const session = await this.prisma.client.inventory.findFirst({
        where: {
          accountId: input.accountId,
          countSession: true,
          countedBy: input.userId,
          storeId: input.storeId,
          closedAt: null,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      // Sessiyasiz sanash — BUGUNGI yo'l. Hech narsa yozilmaydi, xato ham yo'q.
      if (!session) return { recorded: false };

      // Qator tartibi. `@@index([inventoryId, position])` unikal EMAS, ya'ni
      // ikki parallel sanoq bir xil raqam olsa ham yozuv yiqilmaydi — eng
      // yomoni ikki qator bir tartib raqamida turadi (iz uchun zararsiz).
      const last = await this.prisma.client.inventoryPosition.aggregate({
        where: { inventoryId: session.id },
        _max: { position: true },
      });
      await this.prisma.client.inventoryPosition.create({
        data: buildCountSessionLine({
          accountId: input.accountId,
          inventoryId: session.id,
          position: (last._max.position ?? 0) + 1,
          assortmentId: input.assortmentId,
          cellId: input.cellId,
          cellName: input.cellName,
          expectedQty: input.expectedQty,
          actualQty: input.actualQty,
          varianceQty: input.varianceQty,
          pieceEntry: input.pieceEntry ?? null,
          autoDoc: input.autoDoc,
        }),
      });
      return { recorded: true };
    } catch (e) {
      this.logger.error(
        `Sanash sessiyasiga iz yozilmadi (cell=${input.cellId}, product=${input.assortmentId}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { recorded: false };
    }
  }

  /** Omborchining ochiq sessiyasi (ombordan qat'i nazar) — bittadan ko'p bo'lmasligi kerak. */
  private async findOpen(accountId: string, userId: string): Promise<CountSessionRow | null> {
    return this.prisma.client.inventory.findFirst({
      where: { accountId, countSession: true, countedBy: userId, closedAt: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: COUNT_SESSION_SELECT,
    });
  }

  private async withCounters(session: CountSessionRow): Promise<CountSessionView> {
    const lines = await this.prisma.client.inventoryPosition.findMany({
      where: { inventoryId: session.id },
      select: COUNT_SESSION_LINE_SELECT,
    });
    return { ...session, counters: summarizeCountSessionLines(lines) };
  }

  private parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
    const r = schema.safeParse(raw);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join(', '));
    return r.data;
  }
}
