import { Model } from 'objection';
import { BaseModel } from '@/models/Model';

export class BankReconciliationTransaction extends BaseModel {
  public reconciliationId!: number;
  public accountId!: number;
  public referenceType!: string;
  public referenceId!: number;
  public amount!: number;
  public date!: Date | string;
  public transactionTypeKey!: string | null;
  public transactionNumber!: string | null;
  public referenceNumber!: string | null;
  public contactName!: string | null;

  /**
   * Table name.
   */
  static get tableName() {
    return 'bank_reconciliation_transactions';
  }

  /**
   * Timestamps columns.
   */
  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  /**
   * Virtual attributes.
   */
  static get virtualAttributes() {
    return [];
  }

  /**
   * Relationship mapping.
   */
  static get relationMappings() {
    const { BankReconciliation } = require('./BankReconciliation');
    const {
      BankReconciliationBankRow,
    } = require('./BankReconciliationBankRow');

    return {
      reconciliation: {
        relation: Model.BelongsToOneRelation,
        modelClass: BankReconciliation,
        join: {
          from: 'bank_reconciliation_transactions.reconciliationId',
          to: 'bank_reconciliations.id',
        },
      },
      bankRows: {
        relation: Model.HasManyRelation,
        modelClass: BankReconciliationBankRow,
        join: {
          from: 'bank_reconciliation_transactions.id',
          to: 'bank_reconciliation_bank_rows.reconciliationTransactionId',
        },
      },
    };
  }
}
