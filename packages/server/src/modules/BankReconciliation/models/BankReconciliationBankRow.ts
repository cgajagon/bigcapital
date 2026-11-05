import { BaseModel } from '@/models/Model';

export class BankReconciliationBankRow extends BaseModel {
  public reconciliationTransactionId!: number;
  public uncategorizedTransactionId!: number;

  /**
   * Table name.
   */
  static get tableName() {
    return 'bank_reconciliation_bank_rows';
  }

  /**
   * This table has no timestamps columns.
   */
  get timestamps() {
    return [];
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
    return {};
  }
}
