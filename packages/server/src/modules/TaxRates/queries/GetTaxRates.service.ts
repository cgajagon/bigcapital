import { Inject, Injectable } from '@nestjs/common';
import { TaxRateTransformer } from './TaxRate.transformer';
import { TransformerInjectable } from '@/modules/Transformer/TransformerInjectable.service';
import { TaxRateModel } from '../models/TaxRate.model';
import { CommandTaxRatesValidators } from '../commands/CommandTaxRatesValidator.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';

@Injectable()
export class GetTaxRatesService {
  constructor(
    private transformer: TransformerInjectable,
    @Inject(TaxRateModel.name)
    private taxRateModel: TenantModelProxy<typeof TaxRateModel>,
    private readonly validators: CommandTaxRatesValidators,
  ) {}

  /**
   * Retrieves the tax rates list, with their components and whether each is
   * used.
   * @returns {Promise<ITaxRate[]>}
   */
  public async getTaxRates() {
    // Retrieves the tax rates.
    const taxRates = await this.taxRateModel()
      .query()
      .withGraphFetched('components')
      .orderBy('name', 'ASC');

    const inUse = await this.validators.getTaxRatesInUse(
      taxRates.map((taxRate) => taxRate.id),
    );
    // Transforms the tax rates.
    return this.transformer.transform(
      taxRates.map((taxRate) =>
        Object.assign(taxRate, { isUsed: inUse.has(taxRate.id) }),
      ),
      new TaxRateTransformer(),
    );
  }
}
