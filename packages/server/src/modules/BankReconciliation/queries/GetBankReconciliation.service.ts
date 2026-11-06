import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { I18nService } from 'nestjs-i18n';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { TenantUser } from '@/modules/Tenancy/TenancyModels/models/TenantUser.model';
import {
  BankReconciliationRepository,
  toDateString,
} from '../BankReconciliationRepository';
import { BankReconciliation } from '../models/BankReconciliation';
import { BankReconciliationTransaction } from '../models/BankReconciliationTransaction';
import { refKey, roundAmount } from '../_utils';
import { BankReconciliationStatus, ERRORS } from '../types';
import { BankReconciliationDetailResponseDto } from '../dtos/BankReconciliationResponses.dto';

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

@Injectable()
export class GetBankReconciliation {
  constructor(
    private readonly repository: BankReconciliationRepository,
    private readonly i18n: I18nService,

    @Inject(BankReconciliation.name)
    private readonly bankReconciliationModel: TenantModelProxy<
      typeof BankReconciliation
    >,

    @Inject(BankReconciliationTransaction.name)
    private readonly bankReconciliationTransactionModel: TenantModelProxy<
      typeof BankReconciliationTransaction
    >,

    @Inject(TenantUser.name)
    private readonly tenantUserModel: TenantModelProxy<typeof TenantUser>,
  ) {}

  /**
   * A completed reconciliation: header, the numbers stored at finish and its
   * transactions with their snapshot and current amounts.
   * @throws {ServiceError} NOT_FOUND
   */
  public async getDetail(
    reconciliationId: number,
  ): Promise<BankReconciliationDetailResponseDto> {
    const reconciliation = await this.bankReconciliationModel()
      .query()
      .findById(reconciliationId);

    if (
      !reconciliation ||
      reconciliation.status !== BankReconciliationStatus.Completed
    ) {
      throw new ServiceError(ERRORS.NOT_FOUND);
    }
    const account = await this.repository.getAccount(reconciliation.accountId);

    const [rows, ledger, user] = await Promise.all([
      this.bankReconciliationTransactionModel()
        .query()
        .where('reconciliation_id', reconciliation.id)
        .orderBy([
          { column: 'date', order: 'asc' },
          { column: 'id', order: 'asc' },
        ]),
      this.repository.getLedgerSummaries(account),
      reconciliation.completedByUserId
        ? this.tenantUserModel()
            .query()
            .findById(reconciliation.completedByUserId)
        : Promise.resolve(null),
    ]);

    return {
      id: reconciliation.id,
      accountId: reconciliation.accountId,
      status: reconciliation.status,
      statementDate: toDateString(reconciliation.statementDate),
      endingBalance: Number(reconciliation.endingBalance),
      completedAt: reconciliation.completedAt
        ? moment(reconciliation.completedAt).toISOString()
        : null,
      completedByUserId: reconciliation.completedByUserId ?? null,
      completedByName: user?.fullName ?? null,
      beginningBalance: toNumberOrNull(reconciliation.beginningBalance),
      clearedIncreases: toNumberOrNull(reconciliation.clearedIncreases),
      clearedDecreases: toNumberOrNull(reconciliation.clearedDecreases),
      bookBalance: toNumberOrNull(reconciliation.bookBalance),
      unclearedTotal: toNumberOrNull(reconciliation.unclearedTotal),
      unclearedCount: toNumberOrNull(reconciliation.unclearedCount),
      transactions: rows.map((row) => {
        const current = ledger.get(refKey(row));
        // Display fields follow the transaction while it exists (after a
        // take-over the reference points to a new transaction); the snapshot
        // is the fallback once it is deleted. `amount` stays the snapshot.
        const display = current
          ? {
              date: current.date,
              transactionTypeKey: current.transactionTypeKey,
              transactionNumber: current.transactionNumber,
              referenceNumber: current.referenceNumber,
              contactName: current.contactName,
            }
          : {
              date: toDateString(row.date),
              transactionTypeKey: row.transactionTypeKey,
              transactionNumber: row.transactionNumber,
              referenceNumber: row.referenceNumber,
              contactName: row.contactName,
            };
        return {
          reconciliationId: row.reconciliationId,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          amount: Number(row.amount),
          date: display.date,
          transactionTypeKey: display.transactionTypeKey,
          transactionType: display.transactionTypeKey
            ? (this.i18n.t(display.transactionTypeKey) as string)
            : null,
          transactionNumber: display.transactionNumber,
          referenceNumber: display.referenceNumber,
          contactName: display.contactName,
          currentAmount: current ? roundAmount(current.amount) : 0,
          isDeleted: !current,
        };
      }),
    };
  }
}
