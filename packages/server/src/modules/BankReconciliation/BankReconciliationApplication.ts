import { Injectable } from '@nestjs/common';
import { GetBankReconciliationSummary } from './queries/GetBankReconciliationSummary.service';
import { GetBankReconciliationTransactions } from './queries/GetBankReconciliationTransactions.service';
import { GetBankReconciliations } from './queries/GetBankReconciliations.service';
import { GetBankReconciliation } from './queries/GetBankReconciliation.service';
import { SaveBankReconciliationDraft } from './commands/SaveBankReconciliationDraft.service';
import { DiscardBankReconciliationDraft } from './commands/DiscardBankReconciliationDraft.service';
import { FinishBankReconciliation } from './commands/FinishBankReconciliation.service';
import { UndoBankReconciliation } from './commands/UndoBankReconciliation.service';
import { BankReconciliationInputDto } from './dtos/BankReconciliationInput.dto';

@Injectable()
export class BankReconciliationApplication {
  constructor(
    private readonly getSummaryService: GetBankReconciliationSummary,
    private readonly getTransactionsService: GetBankReconciliationTransactions,
    private readonly getReconciliationsService: GetBankReconciliations,
    private readonly getReconciliationService: GetBankReconciliation,
    private readonly saveDraftService: SaveBankReconciliationDraft,
    private readonly discardDraftService: DiscardBankReconciliationDraft,
    private readonly finishService: FinishBankReconciliation,
    private readonly undoService: UndoBankReconciliation,
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

  public saveDraft(accountId: number, dto: BankReconciliationInputDto) {
    return this.saveDraftService.save(accountId, dto);
  }

  public discardDraft(accountId: number) {
    return this.discardDraftService.discard(accountId);
  }

  public finish(accountId: number, dto: BankReconciliationInputDto) {
    return this.finishService.finish(accountId, dto);
  }

  public undo(reconciliationId: number) {
    return this.undoService.undo(reconciliationId);
  }
}
