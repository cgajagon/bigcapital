/**
 * Creates the bank statement reconciliation schema.
 *
 * - `bank_reconciliations`: one row per reconciliation (draft or completed).
 * - `bank_reconciliation_transactions`: snapshot of every ledger transaction
 *   cleared by a reconciliation. The unique key guarantees a transaction is
 *   reconciled at most once per account.
 * - `bank_reconciliation_bank_rows`: links a cleared transaction to the
 *   imported bank rows matched with it.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('bank_reconciliations', (table) => {
    table.increments();
    table.integer('account_id').unsigned().notNullable();
    table.date('statement_date').notNullable();
    table.decimal('ending_balance', 13, 3).notNullable();
    table.string('status', 20).notNullable();
    table.json('selected_transactions').nullable();
    table.decimal('beginning_balance', 13, 3).nullable();
    table.decimal('cleared_increases', 13, 3).nullable();
    table.decimal('cleared_decreases', 13, 3).nullable();
    table.decimal('book_balance', 13, 3).nullable();
    table.decimal('uncleared_total', 13, 3).nullable();
    table.integer('uncleared_count').nullable();
    table.datetime('completed_at').nullable();
    table.integer('completed_by_user_id').unsigned().nullable();
    table.timestamps();

    // Reconciliation data has no meaning without its account.
    table
      .foreign('account_id', 'fk_bank_rec_account')
      .references('accounts.id')
      .onDelete('CASCADE');
    table.index(['account_id', 'status'], 'bank_rec_account_status_index');
    table.index(
      ['account_id', 'statement_date'],
      'bank_rec_account_statement_date_index',
    );
  });

  await knex.schema.createTable('bank_reconciliation_transactions', (table) => {
    table.increments();
    table.integer('reconciliation_id').unsigned().notNullable();
    table.integer('account_id').unsigned().notNullable();
    table.string('reference_type').notNullable();
    table.integer('reference_id').unsigned().notNullable();
    table.decimal('amount', 13, 3).notNullable();
    table.date('date').notNullable();
    table.string('transaction_type_key').nullable();
    table.string('transaction_number').nullable();
    table.string('reference_number').nullable();
    table.string('contact_name').nullable();
    table.timestamps();

    table
      .foreign('reconciliation_id', 'fk_bank_rec_txn_reconciliation')
      .references('bank_reconciliations.id')
      .onDelete('CASCADE');
    table.unique(
      ['account_id', 'reference_type', 'reference_id'],
      'bank_rec_txn_account_ref_unique',
    );
    table.index(['reconciliation_id'], 'bank_rec_txn_reconciliation_index');
  });

  await knex.schema.createTable('bank_reconciliation_bank_rows', (table) => {
    table.integer('reconciliation_transaction_id').unsigned().notNullable();
    // No FK on purpose: imported bank rows can be deleted independently.
    table.integer('uncategorized_transaction_id').unsigned().notNullable();

    table.primary(
      ['reconciliation_transaction_id', 'uncategorized_transaction_id'],
      'bank_rec_bank_rows_primary',
    );
    table
      .foreign('reconciliation_transaction_id', 'fk_bank_rec_rows_txn')
      .references('bank_reconciliation_transactions.id')
      .onDelete('CASCADE');
    table.index(
      ['uncategorized_transaction_id'],
      'bank_rec_bank_rows_uncategorized_index',
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bank_reconciliation_bank_rows');
  await knex.schema.dropTableIfExists('bank_reconciliation_transactions');
  await knex.schema.dropTableIfExists('bank_reconciliations');
};
