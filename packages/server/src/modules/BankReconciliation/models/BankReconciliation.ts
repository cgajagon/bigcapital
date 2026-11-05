import { Model } from 'objection';
import { BaseModel } from '@/models/Model';
import { ReconcileRef } from '../types';

export class BankReconciliation extends BaseModel {
  public accountId!: number;
  public statementDate!: Date | string;
  public endingBalance!: number;
  public status!: string;
  public selectedTransactions!: ReconcileRef[] | null;
  public beginningBalance!: number | null;
  public clearedIncreases!: number | null;
  public clearedDecreases!: number | null;
  public bookBalance!: number | null;
  public unclearedTotal!: number | null;
  public unclearedCount!: number | null;
  public completedAt!: Date | string | null;
  public completedByUserId!: number | null;

  /**
   * Table name.
   */
  static get tableName() {
    return 'bank_reconciliations';
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
   * JSON attributes.
   */
  static get jsonAttributes() {
    return ['selectedTransactions'];
  }

  /**
   * Relationship mapping.
   */
  static get relationMappings() {
    const {
      BankReconciliationTransaction,
    } = require('./BankReconciliationTransaction');

    return {
      transactions: {
        relation: Model.HasManyRelation,
        modelClass: BankReconciliationTransaction,
        join: {
          from: 'bank_reconciliations.id',
          to: 'bank_reconciliation_transactions.reconciliationId',
        },
      },
    };
  }
}
