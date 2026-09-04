import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { HrAuthModule } from '../hr-auth/hr-auth.module.js';
import { HrBonusFineModule } from '../hr-bonus-fine/hr-bonus-fine.module.js';
import { HrPayrollService } from './hr-payroll.service.js';
import { HrSalaryController } from './hr-salary.controller.js';
import { HrSalaryService } from './hr-salary.service.js';
import { MyPayrollController } from './my-payroll.controller.js';
import { MyPayrollService } from './my-payroll.service.js';

// X6 — «Oyligim» (mobil ilova) shu modulga qo'shildi. Yetim kontroller =
// jim 404: `app-boot.test.ts` marshrutlarni manba matnidan skanlaydi, modul
// ro'yxati esa SHU YERDA to'g'ri bo'lishi kerak.
@Module({
  imports: [PrismaModule, AuthModule, HrAuthModule, HrBonusFineModule],
  controllers: [HrSalaryController, MyPayrollController],
  providers: [HrSalaryService, HrPayrollService, MyPayrollService],
  exports: [HrSalaryService, HrPayrollService],
})
export class HrSalaryModule {}
