import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CountSessionController } from './count-session.controller.js';
import { CountSessionService } from './count-session.service.js';
import { TsdController } from './tsd.controller.js';
import { TsdService } from './tsd.service.js';

/**
 * TSD sirti (G-reja G5). `PrismaModule` global, shuning uchun import
 * qilinmaydi — repo konventsiyasi (`product.module.ts` naqshi).
 *
 * `CountSessionService` EKSPORT qilinadi: `StoreModule` uni `setCellStock`
 * ilgagi uchun oladi (N-reja §5-N2). Yo'nalish ATAYLAB shu tomonga —
 * `TsdModule` `StoreModule` ni import QILMAYDI, aks holda halqa bo'lardi.
 */
@Module({
  imports: [AuthModule],
  controllers: [TsdController, CountSessionController],
  providers: [TsdService, CountSessionService],
  exports: [TsdService, CountSessionService],
})
export class TsdModule {}
