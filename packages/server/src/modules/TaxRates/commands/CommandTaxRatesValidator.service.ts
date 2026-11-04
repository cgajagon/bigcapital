import { Knex } from 'knex';
import { difference, isEmpty, keyBy, uniq } from 'lodash';
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
import { Account } from '@/modules/Accounts/models/Account.model';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { ACCOUNT_TYPE } from '@/constants/accounts';
import { TaxRateTransaction } from '../models/TaxRateTransaction.model';
import { TaxRateComponent } from '../models/TaxRateComponent.model';
import { EditTaxRateDto } from '../dtos/TaxRate.dto';
import { haveSameComponents } from '../TaxRateGroups';

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

    @Inject(TaxRateComponent.name)
    private readonly taxRateComponentModel: TenantModelProxy<
      typeof TaxRateComponent
    >,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,
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
   * Retrieves which of the given tax rates are used by a document line, a tax
   * transaction, a ledger entry or an item default tax.
   * @param {number[]} taxRateIds
   * @param {Knex.Transaction} trx
   * @returns {Promise<Set<number>>}
   */
  public async getTaxRatesInUse(
    taxRateIds: number[],
    trx?: Knex.Transaction,
  ): Promise<Set<number>> {
    // Route params arrive as strings, so ids are compared as numbers.
    const ids = uniq(taxRateIds.map(Number));
    const inUse = new Set<number>();

    if (ids.length === 0) return inUse;

    const markUsed = (taxRateId: number | null | undefined) => {
      if (ids.includes(Number(taxRateId))) inUse.add(Number(taxRateId));
    };
    const entries = await this.itemEntryModel()
      .query(trx)
      .distinct('taxRateId')
      .whereIn('taxRateId', ids);
    const taxTransactions = await this.taxRateTransactionModel()
      .query(trx)
      .distinct('taxRateId')
      .whereIn('taxRateId', ids);
    const ledgerEntries = await this.accountTransactionModel()
      .query(trx)
      .distinct('taxRateId')
      .whereIn('taxRateId', ids);
    const items = await this.itemModel()
      .query(trx)
      .select('sellTaxRateId', 'purchaseTaxRateId')
      .whereIn('sellTaxRateId', ids)
      .orWhereIn('purchaseTaxRateId', ids);

    [...entries, ...taxTransactions, ...ledgerEntries].forEach((row) =>
      markUsed(row.taxRateId),
    );
    items.forEach((item) => {
      markUsed(item.sellTaxRateId);
      markUsed(item.purchaseTaxRateId);
    });
    return inUse;
  }

  /**
   * Whether the given tax rate is used by a document line, a tax transaction,
   * a ledger entry or an item default tax.
   * @param {number} taxRateId
   * @param {Knex.Transaction} trx
   * @returns {Promise<boolean>}
   */
  public async isTaxRateInUse(
    taxRateId: number,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const inUse = await this.getTaxRatesInUse([taxRateId], trx);

    return inUse.has(Number(taxRateId));
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
    if (await this.isTaxRateInUse(taxRateId, trx)) {
      throw new ServiceError(
        ERRORS.TAX_RATE_IN_USE,
        "The tax rate is used by transactions or items and can't be deleted. Make it inactive instead.",
      );
    }
  }

  /**
   * Validates the component ids of a tax group: at least two distinct ids of
   * existing, active, non-group tax rates.
   * @param {number[]} componentIds
   * @param {Knex.Transaction} trx
   * @returns {Promise<TaxRateModel[]>} The component rates, in the given order.
   * @throws {ServiceError}
   */
  public async validateGroupComponents(
    componentIds: number[],
    trx?: Knex.Transaction,
  ): Promise<TaxRateModel[]> {
    const ids = (componentIds || []).map(Number);

    if (ids.length < 2 || uniq(ids).length !== ids.length) {
      throw new ServiceError(
        ERRORS.TAX_GROUP_COMPONENTS_INVALID,
        'A tax group needs at least two different component rates.',
      );
    }
    const components = await this.taxRateModel().query(trx).whereIn('id', ids);

    if (components.length !== ids.length) {
      throw new ServiceError(
        ERRORS.TAX_GROUP_COMPONENTS_INVALID,
        "Some of the tax group's component rates don't exist.",
      );
    }
    if (components.some((component) => component.isGroup)) {
      throw new ServiceError(
        ERRORS.TAX_GROUP_COMPONENT_IS_GROUP,
        "A tax group can't be a component of another tax group.",
      );
    }
    if (components.some((component) => !component.active)) {
      throw new ServiceError(
        ERRORS.TAX_GROUP_COMPONENT_INACTIVE,
        "An inactive tax rate can't be a component of a tax group.",
      );
    }
    const componentsById = keyBy(components, 'id');

    return ids.map((id) => componentsById[id]);
  }

  /**
   * Validates a plain tax rate has no component ids.
   * @param {number[]} componentIds
   * @throws {ServiceError}
   */
  public validatePlainRateComponents(componentIds?: number[]) {
    if (!isEmpty(componentIds)) {
      throw new ServiceError(
        ERRORS.TAX_GROUP_COMPONENTS_INVALID,
        'Only a tax group has component rates.',
      );
    }
  }

  /**
   * Validates the given payable account, when there's one, is a tax payable
   * account.
   * @param {number | null | undefined} accountId
   * @param {Knex.Transaction} trx
   * @throws {ServiceError}
   */
  public async validatePayableAccount(
    accountId: number | null | undefined,
    trx?: Knex.Transaction,
  ) {
    if (accountId === null || accountId === undefined) return;

    const account = await this.accountModel().query(trx).findById(accountId);

    if (!account || !account.isAccountType(ACCOUNT_TYPE.TAX_PAYABLE)) {
      throw new ServiceError(
        ERRORS.TAX_PAYABLE_ACCOUNT_INVALID,
        'The payable account of a tax rate must be a tax payable account.',
      );
    }
  }

  /**
   * Validates the given tax rate isn't a component of any tax group.
   * @param {number} taxRateId
   * @param {Knex.Transaction} trx
   * @throws {ServiceError}
   */
  public async validateTaxRateNotGroupComponent(
    taxRateId: number,
    trx?: Knex.Transaction,
  ) {
    const link = await this.taxRateComponentModel()
      .query(trx)
      .findOne({ componentId: taxRateId });

    if (link) {
      throw new ServiceError(
        ERRORS.TAX_RATE_IS_GROUP_COMPONENT,
        "The tax rate is a component of a tax group and can't be deleted. Remove it from the group first.",
      );
    }
  }

  /**
   * Validates the edit doesn't change what's locked: a rate never changes
   * between plain and group, and once used, a group keeps its components and
   * a rate keeps its payable account.
   * @param {TaxRateModel} oldTaxRate - The stored tax rate, with `components`.
   * @param {EditTaxRateDto} editTaxRateDTO
   * @param {Knex.Transaction} trx
   * @throws {ServiceError}
   */
  public async validateTaxRateEditLocks(
    oldTaxRate: TaxRateModel,
    editTaxRateDTO: EditTaxRateDto,
    trx: Knex.Transaction,
  ) {
    const { isGroup, componentIds, payableAccountId } = editTaxRateDTO;

    // `is_group` is read back as 0/1, so both sides are compared as booleans.
    if (
      isGroup !== undefined &&
      Boolean(isGroup) !== Boolean(oldTaxRate.isGroup)
    ) {
      throw new ServiceError(
        ERRORS.TAX_RATE_TYPE_LOCKED,
        "A tax rate can't change between a plain rate and a group.",
      );
    }
    const oldComponentIds = (oldTaxRate.components || []).map(
      (component) => component.id,
    );
    // A plain rate's component ids are refused as invalid, not as locked.
    const componentsChanged =
      Boolean(oldTaxRate.isGroup) &&
      componentIds !== undefined &&
      !haveSameComponents(oldComponentIds, (componentIds || []).map(Number));
    const payableAccountChanged =
      payableAccountId !== undefined &&
      (payableAccountId ?? null) !== (oldTaxRate.payableAccountId ?? null);

    if (!componentsChanged && !payableAccountChanged) return;
    if (!(await this.isTaxRateInUse(oldTaxRate.id, trx))) return;

    if (componentsChanged) {
      throw new ServiceError(
        ERRORS.TAX_GROUP_COMPONENTS_LOCKED,
        "The tax group is used by transactions or items, so its components can't change.",
      );
    }
    throw new ServiceError(
      ERRORS.TAX_RATE_PAYABLE_ACCOUNT_LOCKED,
      "The tax rate is used by transactions or items, so its payable account can't change.",
    );
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
