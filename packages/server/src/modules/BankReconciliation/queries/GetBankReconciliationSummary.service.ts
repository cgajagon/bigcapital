import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import {
  BankReconciliationRepository,
  toDateString,
} from '../BankReconciliationRepository';
import { findChangedReconciled, roundAmount } from '../_utils';
import { ReconciledSnapshot } from '../types';
import {
  BankReconciliationHeaderDto,
  BankReconciliationSummaryResponseDto,
} from '../dtos/BankReconciliationResponses.dto';
import { BankReconciliation } from '../models/BankReconciliation';

const toHeader = (row: BankReconciliation): BankReconciliationHeaderDto => ({
  id: row.id,
  statementDate: toDateString(row.statementDate),
  endingBalance: Number(row.endingBalance),
});

@Injectable()
export class GetBankReconciliationSummary {
  constructor(
    private readonly repository: BankReconciliationRepository,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Start-screen data: the account, beginning balance, last reconciliation,
   * draft in progress, the changed-reconciled mismatch and the uncategorized
   * bank row count.
   */
  public async getSummary(
    accountId: number,
    statementDate?: string,
  ): Promise<BankReconciliationSummaryResponseDto> {
    const account = await this.repository.getAccountOrThrow(accountId);

    const [lastCompleted, draft, reconciledRows, ledger] = await Promise.all([
      this.repository.getLastCompleted(accountId),
      this.repository.getDraft(accountId),
      this.repository.getReconciledTransactions(accountId),
      this.repository.getLedgerSummaries(account),
    ]);

    const currentAmounts = new Map<string, number>(
      [...ledger.entries()].map(([key, row]) => [key, row.amount]),
    );
    const beginningBalance = this.repository.computeBeginningBalance(
      reconciledRows,
      ledger,
    );

    let mismatch: BankReconciliationSummaryResponseDto['mismatch'] = null;
    if (lastCompleted) {
      const lastEnding = roundAmount(Number(lastCompleted.endingBalance));

      if (beginningBalance !== lastEnding) {
        const snapshots: ReconciledSnapshot[] = reconciledRows.map((row) => ({
          reconciliationId: row.reconciliationId,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          amount: Number(row.amount),
          date: toDateString(row.date),
          transactionTypeKey: row.transactionTypeKey,
          transactionNumber: row.transactionNumber,
          referenceNumber: row.referenceNumber,
          contactName: row.contactName,
        }));
        mismatch = {
          amount: roundAmount(beginningBalance - lastEnding),
          items: findChangedReconciled(snapshots, currentAmounts).map(
            (item) => ({
              ...item,
              transactionType: item.transactionTypeKey
                ? (this.i18n.t(item.transactionTypeKey) as string)
                : null,
            }),
          ),
        };
      }
    }

    return {
      account: {
        id: account.id,
        name: account.name,
        accountType: account.accountType,
        accountNormal: account.accountNormal,
        currencyCode: account.currencyCode,
      },
      beginningBalance,
      lastReconciliation: lastCompleted ? toHeader(lastCompleted) : null,
      draft: draft ? toHeader(draft) : null,
      mismatch,
      uncategorizedCount: statementDate
        ? await this.repository.countUncategorized(accountId, statementDate)
        : null,
    };
  }
}
