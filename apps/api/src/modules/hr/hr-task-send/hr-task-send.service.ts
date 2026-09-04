import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  HR_EVENT,
  type HrTaskDispatchedEvent,
  type HrTaskLogDeadlineExpiredEvent,
  type HrTaskLogFinalizedEvent,
} from '../hr-shared/hr-events.types.js';
import type {
  AnswerTaskInput,
  DispatchTemplateInput,
  HrTaskLogStatus,
  ListLogsFilter,
  MyTasksQuery,
} from './hr-task-send.schema.js';

interface DispatchOptions {
  triggeredBy: 'manual' | 'scheduled' | 'event';
  /** Override default assignee (manual re-dispatch). */
  employeeIdOverride?: string;
  sourceEventType?: string;
  sourceDocId?: string;
}

type FinalizedStatus = 'answered_yes' | 'answered_no' | 'answered_text' | 'approved' | 'rejected';

/**
 * What action caused this finalize. Drives bonus/fine source naming, chain
 * suppression for negative outcomes, and which domain event is emitted.
 */
export type FinalizeOriginSource = 'answer' | 'review' | 'deadline_expire';

@Injectable()
export class HrTaskSendService {
  private readonly logger = new Logger(HrTaskSendService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  /** Admin manual dispatch endpoint (POST /hr/tasks/send). */
  async dispatch(accountId: string, input: DispatchTemplateInput) {
    return this.dispatchTemplate(accountId, input.templateId, {
      triggeredBy: 'manual',
      employeeIdOverride: input.employeeId,
    });
  }

  /** Core dispatch — used by manual, scheduled cron, depends_on chain. */
  async dispatchTemplate(accountId: string, templateId: string, opts: DispatchOptions) {
    const tpl = await this.prisma.client.hrTaskTemplate.findFirst({
      where: { id: templateId, accountId, isActive: true },
    });
    if (!tpl) throw new NotFoundException('Faol shablon topilmadi');

    const employeeId = await this.resolveAssignee(accountId, tpl, opts.employeeIdOverride);

    const emp = await this.prisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, telegramPhone: true },
    });
    if (!emp) throw new BadRequestException('Tayinlangan xodim topilmadi');

    const result = await this.prisma.client.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          accountId,
          assigneeId: employeeId,
          title: tpl.title,
          description: tpl.description,
          status: 'open',
          priority: this.mapPriority(tpl.priority),
          kind: 'HR',
          hrTemplateId: tpl.id,
          hrCheckerId: tpl.checkerId,
          hrResponseType: tpl.responseType,
          hrDeadlineMinutes: tpl.deadlineMinutes,
          hrRewardMinor: tpl.rewardMinor,
          hrFineMinor: tpl.fineMinor,
          hrDependsOnId: tpl.dependsOnId,
        },
      });

      const log = await tx.hrTaskLog.create({
        data: {
          accountId,
          templateId: tpl.id,
          taskId: task.id,
          employeeId,
          status: 'sent',
          sentAt: new Date(),
        },
      });

      let telegramQueued = false;
      if (emp.telegramPhone) {
        await tx.hrTelegramOutbox.create({
          data: {
            accountId,
            employeeId,
            toPhone: emp.telegramPhone,
            messageText: this.renderTaskMessage(tpl.title, tpl.description),
            status: 'pending',
            sourceEventType: opts.sourceEventType ?? `hr.task.${opts.triggeredBy}`,
            sourceDocId: opts.sourceDocId ?? log.id,
          },
        });
        telegramQueued = true;
      }

      return { task, log, telegramQueued };
    });

    // Domain event AFTER tx commits — WebSocket subscribers see only persisted state.
    const dispatchedPayload: HrTaskDispatchedEvent = {
      accountId,
      taskLogId: result.log.id,
      templateId: tpl.id,
      employeeId,
      triggeredBy: opts.triggeredBy,
    };
    this.events.emit(HR_EVENT.HR_TASK_DISPATCHED, dispatchedPayload);

    return result;
  }

  /** Xodim javob beradi. Caller must scope to acting employee. */
  async recordAnswer(
    accountId: string,
    taskLogId: string,
    actingEmployeeId: string,
    input: AnswerTaskInput,
  ) {
    const log = await this.prisma.client.hrTaskLog.findFirst({
      where: { id: taskLogId, accountId },
      include: { template: true },
    });
    if (!log) throw new NotFoundException('Vazifa topilmadi');
    if (log.employeeId !== actingEmployeeId) {
      throw new ForbiddenException('Bu vazifa sizniki emas');
    }
    if (log.status !== 'sent') {
      throw new BadRequestException(`Bu vazifaga allaqachon javob berilgan (${log.status})`);
    }

    const hasChecker = !!log.template.checkerId;
    const requiresReview = hasChecker && (input.type === 'yes' || input.type === 'text');
    const newStatus: HrTaskLogStatus = requiresReview
      ? 'pending_review'
      : input.type === 'yes'
        ? 'answered_yes'
        : input.type === 'no'
          ? 'answered_no'
          : 'answered_text';

    const updated = await this.prisma.client.hrTaskLog.update({
      where: { id: log.id },
      data: {
        status: newStatus,
        responseText: input.text ?? null,
        answeredAt: new Date(),
      },
    });

    // Live WS notification: the employee answered (real-time log refresh).
    this.events.emit(HR_EVENT.HR_TASK_ANSWERED, {
      accountId,
      taskLogId: updated.id,
      templateId: log.templateId,
      employeeId: log.employeeId,
      status: newStatus,
      requiresReview,
    });
    // When the answer needs a checker, ping that checker's review queue.
    if (requiresReview && log.template.checkerId) {
      this.events.emit(HR_EVENT.HR_TASK_PENDING_REVIEW, {
        accountId,
        taskLogId: updated.id,
        templateId: log.templateId,
        employeeId: log.employeeId,
        checkerId: log.template.checkerId,
      });
    }

    if (!requiresReview) {
      await this.finalize(
        accountId,
        updated.id,
        newStatus as FinalizedStatus,
        log.templateId,
        log.employeeId,
        null,
      );
    }
    return updated;
  }

  /**
   * Finalize side-effects: bonus/fine + depends_on chain + domain event.
   *
   * @param originSource Which action caused this finalize:
   *   - 'answer' — xodim "no" javob berdi (no checker yo'l) → fine source 'auto_task_fine'
   *   - 'review' — checker rejected/approved → fine source 'auto_task_fine'
   *   - 'deadline_expire' — 60s cron timed out → fine source 'auto_expire_fine',
   *      no depends_on chain (negative outcome), emits HR_TASK_LOG_DEADLINE_EXPIRED.
   */
  async finalize(
    accountId: string,
    taskLogId: string,
    status: FinalizedStatus,
    templateId: string,
    employeeId: string,
    reviewedById: string | null,
    originSource: FinalizeOriginSource = 'answer',
  ) {
    const tpl = await this.prisma.client.hrTaskTemplate.findUnique({
      where: { id: templateId },
    });
    if (!tpl) {
      this.logger.warn(`finalize: template ${templateId} disappeared`);
      return;
    }

    // Snapshot the employee name onto the auto bonus/fine rows (§13.17).
    const emp = await this.prisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { name: true },
    });
    const employeeName = emp?.name ?? null;

    const isReward =
      status === 'answered_yes' || status === 'answered_text' || status === 'approved';
    const isFine = status === 'answered_no' || status === 'rejected';
    const fineSource = originSource === 'deadline_expire' ? 'auto_expire_fine' : 'auto_task_fine';
    const fineReason =
      originSource === 'deadline_expire'
        ? `Vazifa muddati o'tdi: ${tpl.title}`
        : status === 'rejected'
          ? `Tekshiruv rad etildi: ${tpl.title}`
          : `Vazifa bajarilmadi: ${tpl.title}`;

    if (isReward && tpl.rewardMinor && tpl.rewardMinor > 0n) {
      await this.prisma.client.hrBonusFineLog.create({
        data: {
          accountId,
          employeeId,
          employeeName,
          kind: 'bonus',
          source: 'auto_task_reward',
          amountMinor: tpl.rewardMinor,
          reason: `Vazifa: ${tpl.title}`,
          taskLogId,
          createdById: null,
        },
      });
    }
    if (isFine && tpl.fineMinor && tpl.fineMinor > 0n) {
      await this.prisma.client.hrBonusFineLog.create({
        data: {
          accountId,
          employeeId,
          employeeName,
          kind: 'fine',
          source: fineSource,
          amountMinor: tpl.fineMinor,
          reason: fineReason,
          taskLogId,
          createdById: null,
        },
      });
    }

    // depends_on chain — only on positive finalize, dispatch dependents for same employee
    if (isReward) {
      const dependents = await this.prisma.client.hrTaskTemplate.findMany({
        where: { dependsOnId: templateId, isActive: true, accountId },
      });
      for (const dep of dependents) {
        try {
          await this.dispatchTemplate(accountId, dep.id, {
            triggeredBy: 'event',
            employeeIdOverride: employeeId,
            sourceEventType: 'hr.task.chain',
            sourceDocId: taskLogId,
          });
        } catch (e) {
          this.logger.warn(`Dependent dispatch failed (tpl=${dep.id}): ${(e as Error).message}`);
        }
      }
    }

    if (originSource === 'deadline_expire') {
      const expirePayload: HrTaskLogDeadlineExpiredEvent = {
        accountId,
        taskLogId,
        templateId,
        employeeId,
      };
      this.events.emit(HR_EVENT.HR_TASK_LOG_DEADLINE_EXPIRED, expirePayload);
      return;
    }

    const payload: HrTaskLogFinalizedEvent = {
      accountId,
      taskLogId,
      templateId,
      employeeId,
      status:
        status === 'approved' ? 'answered_yes' : status === 'rejected' ? 'answered_no' : status,
      ...(reviewedById !== null ? { reviewedById } : {}),
    };
    this.events.emit(HR_EVENT.HR_TASK_LOG_FINALIZED, payload);
  }

  /**
   * Vazifa jurnali.
   *
   * 🔴 `scopeEmployeeId` — QAT'IY SHIFT (X3 tuzatishi). Chaqiruvchi qamrov
   * bergan bo'lsa (ya'ni «bu odam FAQAT o'zinikini ko'radi» degan bo'lsa),
   * so'rovdagi `?employeeId=` HECH QACHON uni qayta yozmaydi.
   *
   * Ilgari uch qator shu tartibda turardi:
   *   `if (scopeEmployeeId) where.employeeId = scopeEmployeeId;`
   *   … `if (filter.employeeId) where.employeeId = filter.employeeId;`
   * — ikkinchisi birinchisini bosib ketardi, ya'ni o'ziga bog'langan
   * chaqiruvchi ham bitta query-param bilan O'ZGA xodimning vazifalarini
   * so'rab olardi. Endi param FAQAT qamrovsiz (`null`) chaqiruvda ishlaydi;
   * o'zgani so'rash huquqi kontrollerda, ruxsat darajasi bo'yicha beriladi
   * (X-reja 0-bo'lim 7-qoidasi).
   */
  async listLogs(accountId: string, scopeEmployeeId: string | null, filter: ListLogsFilter) {
    const where: Record<string, unknown> = { accountId };
    if (scopeEmployeeId) where.employeeId = scopeEmployeeId;
    if (filter.templateId) where.templateId = filter.templateId;
    // Qamrov qo'yilgan bo'lsa param E'TIBORSIZ — 403 emas, jimgina o'ziniki.
    if (!scopeEmployeeId && filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status;
    if (filter.dateFrom || filter.dateTo) {
      where.sentAt = {
        ...(filter.dateFrom && { gte: filter.dateFrom }),
        ...(filter.dateTo && { lte: filter.dateTo }),
      };
    }
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.hrTaskLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          template: { select: { id: true, title: true, responseType: true } },
          employee: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.client.hrTaskLog.count({ where }),
    ]);
    return { rows, total, page: filter.page, limit: filter.limit };
  }

  /**
   * «Ishlarim» — xodimning O'Z vazifalari (`GET /hr/tasks/my`, X3).
   *
   * `employeeId` MAJBURIY parametr va kontrollerda FAQAT `user.sub` dan
   * beriladi — bu yerda qamrovni bo'shatadigan yo'l YO'Q (`listLogs` dan
   * ataylab ajratilgan: u menejer jurnali, bu esa own-only ekran).
   *
   * Javob ekran uchun tayyorlangan: shablon matni, muddat, holat. Xodimga
   * KERAKSIZ maydonlar (mukofot/jarima summasi, tekshiruvchi kim ekani)
   * ATAYLAB yuborilmaydi.
   *
   * 🔴 Halol raqamlar (X-reja 8-qoidasi): shablonda muddat belgilanmagan
   * bo'lsa `deadlineAt = null` («muddatsiz»), 0 yoki `sentAt` EMAS.
   */
  async listMyTasks(
    accountId: string,
    employeeId: string,
    query: MyTasksQuery,
    now: Date = new Date(),
  ) {
    const where: Record<string, unknown> = { accountId, employeeId };
    if (query.status) where.status = query.status;

    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.hrTaskLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        take: query.limit,
        select: {
          id: true,
          templateId: true,
          status: true,
          responseText: true,
          sentAt: true,
          answeredAt: true,
          reviewedAt: true,
          reviewComment: true,
          failReason: true,
          template: {
            select: {
              title: true,
              description: true,
              priority: true,
              responseType: true,
              deadlineMinutes: true,
            },
          },
        },
      }),
      this.prisma.client.hrTaskLog.count({ where }),
    ]);

    const nowMs = now.getTime();
    return {
      rows: rows.map((r) => {
        const dl = r.template.deadlineMinutes;
        const deadlineAt = dl != null && dl > 0 ? new Date(r.sentAt.getTime() + dl * 60_000) : null;
        return {
          id: r.id,
          templateId: r.templateId,
          title: r.template.title,
          description: r.template.description,
          priority: r.template.priority,
          responseType: r.template.responseType,
          status: r.status,
          sentAt: r.sentAt,
          answeredAt: r.answeredAt,
          reviewedAt: r.reviewedAt,
          reviewComment: r.reviewComment,
          responseText: r.responseText,
          failReason: r.failReason,
          deadlineAt,
          /** Muddati o'tgan va HAMON javob kutmoqda (yopilgan vazifa qizarmaydi). */
          overdue: deadlineAt !== null && r.status === 'sent' && deadlineAt.getTime() < nowMs,
          /** Javob tugmalari chizilsinmi — `responseType: 'none'` da vazifa faqat xabar. */
          needsAnswer: r.status === 'sent' && r.template.responseType !== 'none',
        };
      }),
      total,
    };
  }

  // ─── private helpers ────────────────────────────────────────────────────

  private async resolveAssignee(
    accountId: string,
    tpl: { assignedEmployeeId: string | null; assignedRole: string | null },
    override: string | undefined,
  ): Promise<string> {
    if (override) {
      const emp = await this.prisma.client.employee.findFirst({
        where: { id: override, accountId, archived: false },
        select: { id: true },
      });
      if (!emp) throw new BadRequestException('Override xodim topilmadi');
      return emp.id;
    }
    if (tpl.assignedEmployeeId) return tpl.assignedEmployeeId;
    if (tpl.assignedRole) {
      const candidate = await this.prisma.client.employee.findFirst({
        where: { accountId, archived: false, hrRoles: { has: tpl.assignedRole } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) {
        throw new BadRequestException(`'${tpl.assignedRole}' rolida xodim topilmadi`);
      }
      return candidate.id;
    }
    throw new BadRequestException('Shablonda assignee belgilanmagan');
  }

  /** HrTaskTemplate {low,medium,high,urgent} → Task {low,normal,high,urgent}. */
  private mapPriority(hrPriority: string): string {
    return hrPriority === 'medium' ? 'normal' : hrPriority;
  }

  private renderTaskMessage(title: string, description: string | null): string {
    return description ? `📋 ${title}\n\n${description}` : `📋 ${title}`;
  }
}
