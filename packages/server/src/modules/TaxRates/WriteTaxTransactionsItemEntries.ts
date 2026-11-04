import { keyBy } from 'lodash';
import { Knex } from 'knex';
import { ModelObject } from 'objection';
import { TenantModelProxy } from '../System/models/TenantBaseModel';
import { TaxRateModel } from './models/TaxRate.model';
import { Inject, Injectable } from '@nestjs/common';
import { ItemEntry } from '../TransactionItemEntry/models/ItemEntry';
import { TaxRateTransaction } from './models/TaxRateTransaction.model';
import { FeaturesManager } from '../Features/FeaturesManager';
import { Features } from '@/common/types/Features';

@Injectable()
export class WriteTaxTransactionsItemEntries {
  constructor(
    @Inject(TaxRateTransaction.name)
    private readonly taxRateTransactionModel: TenantModelProxy<
      typeof TaxRateTransaction
    >,

    @Inject(TaxRateModel.name)
    private readonly taxRateModel: TenantModelProxy<typeof TaxRateModel>,

    private readonly featuresManager: FeaturesManager,
  ) {}

  /**
   * Writes the tax transactions from the given item entries.
   * @param {number} tenantId
   * @param {IItemEntry[]} itemEntries
   */
  public async writeTaxTransactionsFromItemEntries(
    itemEntries: ModelObject<ItemEntry>[],
    trx?: Knex.Transaction,
  ) {
    const isSalesTaxEnabled = await this.featuresManager.accessible(
      Features.SALES_TAX,
    );
    if (!isSalesTaxEnabled) return;

    const components = this.collectDistinctComponents(itemEntries);
    const entriesTaxRateIds = components.map((entry) => entry.taxRateId);

    const taxRates = await this.taxRateModel()
      .query(trx)
      .whereIn('id', entriesTaxRateIds);
    const taxRatesById = keyBy(taxRates, 'id');

    const taxTransactions = components.map((entry) => ({
      taxRateId: entry.taxRateId,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      // A line's stored 0 % is a real percentage, not a missing one.
      rate: entry.rate ?? (taxRatesById[entry.taxRateId]?.rate as number),
    }));
    await this.taxRateTransactionModel()
      .query(trx)
      .upsertGraph(
        taxTransactions as unknown as ModelObject<TaxRateTransaction>[],
      );
  }

  /**
   * Rewrites the tax rate transactions from the given item entries.
   * @param {number} tenantId
   * @param {IItemEntry[]} itemEntries
   * @param {string} referenceType
   * @param {number} referenceId
   * @param {Knex.Transaction} trx
   */
  public async rewriteTaxRateTransactionsFromItemEntries(
    itemEntries: ModelObject<ItemEntry>[],
    referenceType: string,
    referenceId: number,
    trx?: Knex.Transaction,
  ) {
    await Promise.all([
      this.removeTaxTransactionsFromItemEntries(
        referenceId,
        referenceType,
        trx,
      ),
      this.writeTaxTransactionsFromItemEntries(itemEntries, trx),
    ]);
  }

  /**
   * Lists the distinct tax rates used by the entries, in line-then-component
   * order. A group line counts for its snapshot components, never for the
   * group; a plain line is one component with its own rate.
   * @param {IItemEntry[]} itemEntries
   */
  private collectDistinctComponents = (
    itemEntries: ModelObject<ItemEntry>[],
  ) => {
    const byRateId = new Map<
      number,
      {
        taxRateId: number;
        rate: number | null | undefined;
        referenceType: string;
        referenceId: ItemEntry['referenceId'];
      }
    >();
    itemEntries
      .filter((item) => item.taxRateId)
      .forEach((item) => {
        const components = item.taxComponents?.length
          ? item.taxComponents
          : [{ taxRateId: item.taxRateId, rate: item.taxRate }];

        components.forEach((component) => {
          if (byRateId.has(component.taxRateId)) return;
          byRateId.set(component.taxRateId, {
            taxRateId: component.taxRateId,
            rate: component.rate,
            referenceType: item.referenceType,
            referenceId: item.referenceId,
          });
        });
      });
    return [...byRateId.values()];
  };

  /**
   * Removes the tax transactions from the given item entries.
   * @param {number} tenantId   - Tenant id.
   * @param {string} referenceType - Reference type.
   * @param {number} referenceId - Reference id.
   */
  public async removeTaxTransactionsFromItemEntries(
    referenceId: number,
    referenceType: string,
    trx?: Knex.Transaction,
  ) {
    const isSalesTaxEnabled = await this.featuresManager.accessible(
      Features.SALES_TAX,
    );
    if (!isSalesTaxEnabled) return;

    await this.taxRateTransactionModel()
      .query(trx)
      .where({ referenceType, referenceId })
      .delete();
  }
}
