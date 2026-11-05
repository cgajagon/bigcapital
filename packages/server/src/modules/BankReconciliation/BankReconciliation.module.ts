import { Module } from '@nestjs/common';
import { RegisterTenancyModel } from '../Tenancy/TenancyModels/Tenancy.module';
import { TenancyModule } from '../Tenancy/Tenancy.module';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { BankReconciliationController } from './BankReconciliation.controller';
import { BankReconciliation } from './models/BankReconciliation';
import { BankReconciliationTransaction } from './models/BankReconciliationTransaction';
import { BankReconciliationBankRow } from './models/BankReconciliationBankRow';
import { BankReconciliationRepository } from './BankReconciliationRepository';
import { BankReconciliationApplication } from './BankReconciliationApplication';
import { GetBankReconciliationSummary } from './queries/GetBankReconciliationSummary.service';
import { GetBankReconciliationTransactions } from './queries/GetBankReconciliationTransactions.service';
import { GetBankReconciliations } from './queries/GetBankReconciliations.service';
import { GetBankReconciliation } from './queries/GetBankReconciliation.service';
import { SaveBankReconciliationDraft } from './commands/SaveBankReconciliationDraft.service';
import { DiscardBankReconciliationDraft } from './commands/DiscardBankReconciliationDraft.service';
import { FinishBankReconciliation } from './commands/FinishBankReconciliation.service';

const models = [
  RegisterTenancyModel(BankReconciliation),
  RegisterTenancyModel(BankReconciliationTransaction),
  RegisterTenancyModel(BankReconciliationBankRow),
];

@Module({
  controllers: [BankReconciliationController],
  imports: [...models, TenancyModule],
  providers: [
    AuthorizationGuard,
    PermissionGuard,
    BankReconciliationRepository,
    BankReconciliationApplication,
    GetBankReconciliationSummary,
    GetBankReconciliationTransactions,
    GetBankReconciliations,
    GetBankReconciliation,
    SaveBankReconciliationDraft,
    DiscardBankReconciliationDraft,
    FinishBankReconciliation,
  ],
  exports: [...models],
})
export class BankReconciliationModule {}
