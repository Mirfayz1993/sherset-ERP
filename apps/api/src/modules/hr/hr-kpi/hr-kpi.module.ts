import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../../prisma/prisma.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { HrAuthModule } from '../hr-auth/hr-auth.module.js';
import { HrSalaryModule } from '../hr-salary/hr-salary.module.js';
import { HrKpiCron } from './hr-kpi-cron.service.js';
import { HrKpiController } from './hr-kpi.controller.js';
import { HrKpiService } from './hr-kpi.service.js';
import { MyKpiController } from './my-kpi.controller.js';
import { MyKpiService } from './my-kpi.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AuthModule, HrAuthModule, HrSalaryModule],
  // X5 — `MyKpiController` ro'yxatga TUSHISHI shart: yetim kontrollerning
  // barcha yo'li 404 qaytaradi va buni na typecheck, na birlik testlar
  // ushlaydi (`app-boot.test.ts` shu klass uchun bor).
  controllers: [HrKpiController, MyKpiController],
  providers: [HrKpiService, HrKpiCron, MyKpiService],
  exports: [HrKpiService],
})
export class HrKpiModule {}
