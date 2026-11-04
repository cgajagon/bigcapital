import { Transformer } from '@/modules/Transformer/Transformer';

export class SaleInvoiceTaxEntryTransformer extends Transformer {
  /**
   * Included attributes.
   * @returns {Array}
   */
  public includeAttributes = (): string[] => {
    return [
      'id',
      'name',
      'taxRateCode',
      'taxRate',
      'taxRateId',
      'taxRateAmount',
      'taxRateAmountFormatted',
    ];
  };

  /**
   * Exclude attributes.
   * @returns {string[]}
   */
  public excludeAttributes = (): string[] => {
    return ['*'];
  };

  /**
   *  Retrieve  tax rate code.
   * @param taxEntry
   * @returns {string}
   */
  protected taxRateCode = (taxEntry) => {
    return taxEntry.taxRate.code;
  };

  /**
   * Retrieve the tax percentage stored on the document.
   * @param taxEntry
   * @returns {number}
   */
  protected taxRate = (taxEntry) => {
    return taxEntry.rate;
  };

  /**
   * Retrieve tax rate name.
   * @param taxEntry
   * @returns {string}
   */
  protected name = (taxEntry) => {
    return taxEntry.taxRate.name;
  };

  /**
   * Retrieve the sum of the document's rounded line taxes of this tax.
   * @param taxEntry
   */
  protected taxRateAmount = (taxEntry) => {
    return this.options.lineTaxesByTaxRateId[taxEntry.taxRateId] ?? 0;
  };

  /**
   * Retrieve formatted tax rate amount.
   * @returns {string}
   */
  protected taxRateAmountFormatted = (taxEntry) => {
    return this.formatNumber(this.taxRateAmount(taxEntry), {
      currencyCode: this.options.currencyCode,
    });
  };
}
