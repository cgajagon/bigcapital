import { Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { I18nService } from 'nestjs-i18n';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { formatNumber } from '@/utils/format-number';
import { BankReconciliationRepository } from '../BankReconciliationRepository';
import { preselectRefs, refKey } from '../_utils';
import {
  BankReconciliationTransactionRowDto,
  BankReconciliationTransactionsResponseDto,
} from '../dtos/BankReconciliationResponses.dto';

@Injectable()
export class GetBankReconciliationTransactions {
  constructor(
    private readonly repository: BankReconciliationRepository,
    private readonly i18n: I18nService,
    private readonly tenancyContext: TenancyContext,
  ) {}

  /**
   * Every transaction of the account that is not in a completed
   * reconciliation, one row per source transaction, with the rows to tick.
   */
  public async getTransactions(
    accountId: number,
    statementDate: string,
  ): Promise<BankReconciliationTransactionsResponseDto> {
    const account = await this.repository.getAccountOrThrow(accountId);
    const metadata = await this.tenancyContext.getTenantMetadata();
    const dateFormat = metadata?.dateFormat || 'YYYY MMM DD';

    const [ledger, reconciledRows, draft, bankFeedLinks] = await Promise.all([
      this.repository.getLedgerSummaries(account),
      this.repository.getReconciledTransactions(accountId),
      this.repository.getDraft(accountId),
      this.repository.getBankFeedLinks(accountId),
    ]);
    const reconciledKeys = new Set(reconciledRows.map(refKey));

    const rows: BankReconciliationTransactionRowDto[] = [...ledger.entries()]
      .filter(([key, row]) => !reconciledKeys.has(key) && row.amount !== 0)
      .map(([key, row]) => ({
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        date: row.date,
        formattedDate: moment(row.date).format(dateFormat),
        transactionType: row.transactionTypeKey
          ? (this.i18n.t(row.transactionTypeKey) as string)
          : null,
        transactionNumber: row.transactionNumber,
        referenceNumber: row.referenceNumber,
        contactName: row.contactName,
        description: row.description,
        amount: row.amount,
        formattedAmount: formatNumber(row.amount, { money: false }),
        isFromBankFeed: bankFeedLinks.has(key),
        isAfterStatementDate: row.date > statementDate,
      }))
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.referenceId - b.referenceId,
      );

    const { selected, droppedCount } = preselectRefs(
      rows,
      statementDate,
      draft ? (draft.selectedTransactions ?? []) : null,
    );

    return {
      transactions: rows,
      selected,
      droppedFromDraftCount: droppedCount,
    };
  }
}
