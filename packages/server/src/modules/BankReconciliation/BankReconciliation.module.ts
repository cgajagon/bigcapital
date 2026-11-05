import { Module } from '@nestjs/common';
import { RegisterTenancyModel } from '../Tenancy/TenancyModels/Tenancy.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { BankReconciliationController } from './BankReconciliation.controller';
import { BankReconciliation } from './models/BankReconciliation';
import { BankReconciliationTransaction } from './models/BankReconciliationTransaction';
import { BankReconciliationBankRow } from './models/BankReconciliationBankRow';

const models = [
  RegisterTenancyModel(BankReconciliation),
  RegisterTenancyModel(BankReconciliationTransaction),
  RegisterTenancyModel(BankReconciliationBankRow),
];

@Module({
  controllers: [BankReconciliationController],
  imports: [...models],
  providers: [AuthorizationGuard, PermissionGuard],
  exports: [...models],
})
export class BankReconciliationModule {}
