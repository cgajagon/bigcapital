import { Injectable } from '@nestjs/common';
import { GetBankReconciliationSummary } from './queries/GetBankReconciliationSummary.service';
import { GetBankReconciliationTransactions } from './queries/GetBankReconciliationTransactions.service';
import { GetBankReconciliations } from './queries/GetBankReconciliations.service';
import { GetBankReconciliation } from './queries/GetBankReconciliation.service';

@Injectable()
export class BankReconciliationApplication {
  constructor(
    private readonly getSummaryService: GetBankReconciliationSummary,
    private readonly getTransactionsService: GetBankReconciliationTransactions,
    private readonly getReconciliationsService: GetBankReconciliations,
    private readonly getReconciliationService: GetBankReconciliation,
  ) {}

  public getSummary(accountId: number, statementDate?: string) {
    return this.getSummaryService.getSummary(accountId, statementDate);
  }

  public getTransactions(accountId: number, statementDate: string) {
    return this.getTransactionsService.getTransactions(
      accountId,
      statementDate,
    );
  }

  public getList(accountId: number) {
    return this.getReconciliationsService.getList(accountId);
  }

  public getDetail(reconciliationId: number) {
    return this.getReconciliationService.getDetail(reconciliationId);
  }
}
