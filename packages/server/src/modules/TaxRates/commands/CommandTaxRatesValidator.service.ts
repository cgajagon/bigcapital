import { Knex } from 'knex';
import { difference } from 'lodash';
// import { IItemEntryDTO } from '@/modules/Items/';
import { ERRORS } from '../constants';
import { TaxRateModel } from '../models/TaxRate.model';
import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { ItemEntryDto } from '@/modules/TransactionItemEntry/dto/ItemEntry.dto';
import { FeaturesManager } from '@/modules/Features/FeaturesManager';
import { Features } from '@/common/types/Features';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { Item } from '@/modules/Items/models/Item';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { TaxRateTransaction } from '../models/TaxRateTransaction.model';

@Injectable()
export class CommandTaxRatesValidators {
  /**
   * @param {TenantModelProxy<typeof TaxRateModel>} taxRateModel - The tax rate model.
   */
  constructor(
    @Inject(TaxRateModel.name)
    private readonly taxRateModel: TenantModelProxy<typeof TaxRateModel>,

    private readonly featuresManager: FeaturesManager,

    @Inject(ItemEntry.name)
    private readonly itemEntryModel: TenantModelProxy<typeof ItemEntry>,

    @Inject(TaxRateTransaction.name)
    private readonly taxRateTransactionModel: TenantModelProxy<
      typeof TaxRateTransaction
    >,

    @Inject(AccountTransaction.name)
    private readonly accountTransactionModel: TenantModelProxy<
      typeof AccountTransaction
    >,

    @Inject(Item.name)
    private readonly itemModel: TenantModelProxy<typeof Item>,
  ) {}

  /**
   * Validates the tax rate existance.
   * @param {TaxRate | undefined | null} taxRate
   */
  public validateTaxRateExistance(taxRate: TaxRateModel | undefined | null) {
    if (!taxRate) {
      throw new ServiceError(ERRORS.TAX_RATE_NOT_FOUND);
    }
  }

  /**
   * Validates the given tax rate active.
   * @param {TaxRateModel} taxRate
   */
  public validateTaxRateNotActive(taxRate: TaxRateModel) {
    if (taxRate.active) {
      throw new ServiceError(ERRORS.TAX_RATE_ALREADY_ACTIVE);
    }
  }

  /**
   * Validates the given tax rate inactive.
   * @param {TaxRateModel} taxRate
   */
  public validateTaxRateNotInactive(taxRate: TaxRateModel) {
    if (!taxRate.active) {
      throw new ServiceError(ERRORS.TAX_RATE_ALREADY_INACTIVE);
    }
  }

  /**
   * Validates the given tax rate isn't used by any document line, tax
   * transaction, ledger entry or item default tax.
   * @param {number} taxRateId
   * @param {Knex.Transaction} trx
   * @throws {ServiceError}
   */
  public async validateTaxRateNotInUse(
    taxRateId: number,
    trx?: Knex.Transaction,
  ) {
    const usages = [
      () => this.itemEntryModel().query(trx).findOne({ taxRateId }),
      () => this.taxRateTransactionModel().query(trx).findOne({ taxRateId }),
      () => this.accountTransactionModel().query(trx).findOne({ taxRateId }),
      () =>
        this.itemModel()
          .query(trx)
          .where('sellTaxRateId', taxRateId)
          .orWhere('purchaseTaxRateId', taxRateId)
          .first(),
    ];
    for (const findUsage of usages) {
      if (await findUsage()) {
        throw new ServiceError(
          ERRORS.TAX_RATE_IN_USE,
          "The tax rate is used by transactions or items and can't be deleted. Make it inactive instead.",
        );
      }
    }
  }

  /**
   * Validates the tax code uniquiness.
   * @param {string} taxCode
   * @param {Knex.Transaction} trx -
   * @param {number} exceptTaxRateId - The tax rate being edited, ignored.
   */
  public async validateTaxCodeUnique(
    taxCode: string,
    trx?: Knex.Transaction,
    exceptTaxRateId?: number,
  ) {
    const query = this.taxRateModel().query(trx).findOne({ code: taxCode });

    if (exceptTaxRateId) {
      query.whereNot('id', exceptTaxRateId);
    }
    const foundTaxCode = await query;

    if (foundTaxCode) {
      throw new ServiceError(ERRORS.TAX_CODE_NOT_UNIQUE);
    }
  }

  /**
   * Validates the tax codes of the given item entries DTO.
   * @param {IItemEntryDTO[]} itemEntriesDTO
   * @throws {ServiceError}
   */
  public async validateItemEntriesTaxCode(itemEntriesDTO: ItemEntryDto[]) {
    const isSalesTaxEnabled = await this.featuresManager.accessible(
      Features.SALES_TAX,
    );
    if (!isSalesTaxEnabled) return;

    const filteredTaxEntries = itemEntriesDTO.filter((e) => e.taxCode);
    const taxCodes = filteredTaxEntries.map((e) => e.taxCode);

    // Can't validate if there is no tax codes.
    if (taxCodes.length === 0) return;

    const foundTaxCodes = await this.taxRateModel()
      .query()
      .whereIn('code', taxCodes);
    const foundCodes = foundTaxCodes.map((tax) => tax.code);

    const notFoundTaxCodes = difference(taxCodes, foundCodes);

    if (notFoundTaxCodes.length > 0) {
      throw new ServiceError(ERRORS.ITEM_ENTRY_TAX_RATE_CODE_NOT_FOUND);
    }
  }

  /**
   * Validates the tax rate id of the given item entries DTO.
   * @param {ItemEntryDto[]} itemEntriesDTO
   * @throws {ServiceError}
   */
  public async validateItemEntriesTaxCodeId(itemEntriesDTO: ItemEntryDto[]) {
    const isSalesTaxEnabled = await this.featuresManager.accessible(
      Features.SALES_TAX,
    );
    if (!isSalesTaxEnabled) return;

    const filteredTaxEntries = itemEntriesDTO.filter((e) => e.taxRateId);
    const taxRatesIds = filteredTaxEntries.map((e) => e.taxRateId);

    // Can't validate if there is no tax codes.
    if (taxRatesIds.length === 0) return;

    const foundTaxCodes = await this.taxRateModel()
      .query()
      .whereIn('id', taxRatesIds);
    const foundTaxRatesIds = foundTaxCodes.map((tax) => tax.id);

    const notFoundTaxCodes = difference(taxRatesIds, foundTaxRatesIds);

    if (notFoundTaxCodes.length > 0) {
      throw new ServiceError(ERRORS.ITEM_ENTRY_TAX_RATE_ID_NOT_FOUND);
    }
  }
}
