import { Knex } from 'knex';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { TaxRateModel } from './models/TaxRate.model';

/**
 * Loads the payable account of each tax rate that has one. A rate missing from
 * the map posts to the default tax payable account.
 * @param {TenantModelProxy<typeof TaxRateModel>} taxRateModel
 * @param {Knex.Transaction} trx
 * @returns {Promise<Record<number, number>>} Payable account id by tax rate id.
 */
export const loadTaxPayableAccountsByRateId = async (
  taxRateModel: TenantModelProxy<typeof TaxRateModel>,
  trx?: Knex.Transaction,
): Promise<Record<number, number>> => {
  const taxRates = await taxRateModel()
    .query(trx)
    .select('id', 'payableAccountId')
    .whereNotNull('payableAccountId');

  return Object.fromEntries(
    taxRates.map((taxRate) => [taxRate.id, taxRate.payableAccountId]),
  );
};
