// Tax groups: a `tax_rates` row can be a group of component rates, a rate can
// post to its own payable account, and every document line keeps a JSON
// snapshot of its group's components (so editing a rate later never rewrites
// saved documents).

exports.up = async function (knex) {
  await knex.schema.alterTable('tax_rates', (table) => {
    table.boolean('is_group').notNullable().defaultTo(false);
    table.integer('payable_account_id').unsigned().nullable();
    table
      .foreign('payable_account_id', 'fk_tax_rates_payable_account')
      .references('accounts.id')
      .onDelete('SET NULL');
  });

  await knex.schema.createTable('tax_rate_components', (table) => {
    table.increments();
    table.integer('group_id').unsigned().notNullable();
    table.integer('component_id').unsigned().notNullable();
    table.integer('index').unsigned().defaultTo(0);

    table.unique(['group_id', 'component_id'], 'tax_rate_components_unique');
    table
      .foreign('group_id', 'fk_tax_rate_components_group')
      .references('tax_rates.id')
      .onDelete('CASCADE');
    table
      .foreign('component_id', 'fk_tax_rate_components_component')
      .references('tax_rates.id');
  });

  await knex.schema.alterTable('items_entries', (table) => {
    table.json('tax_components').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('items_entries', (table) => {
    table.dropColumn('tax_components');
  });

  await knex.schema.dropTableIfExists('tax_rate_components');

  await knex.schema.alterTable('tax_rates', (table) => {
    table.dropForeign('payable_account_id', 'fk_tax_rates_payable_account');
    table.dropColumn('payable_account_id');
    table.dropColumn('is_group');
  });
};
