import { Transformer } from '@/modules/Transformer/Transformer';
import { TaxRateModel } from '../models/TaxRate.model';

export class TaxRateTransformer extends Transformer {
  /**
   * Include these attributes to tax rate object.
   * @returns {Array}
   */
  public includeAttributes = (): string[] => {
    return [
      'nameFormatted',
      'rateFormatted',
      'isGroup',
      'isUsed',
      'components',
    ];
  };

  /**
   * Retrieve the formatted rate.
   * @param taxRate
   * @returns {string}
   */
  public rateFormatted = (taxRate: TaxRateModel): string => {
    return `${taxRate.rate}%`;
  };

  /**
   * Formats the tax rate name.
   * @param taxRate
   * @returns {string}
   */
  protected nameFormatted = (taxRate: TaxRateModel): string => {
    return `${taxRate.name} [${taxRate.rate}%]`;
  };

  /**
   * Whether the tax rate is a group, as a boolean (the column reads back as
   * 0/1).
   * @param taxRate
   * @returns {boolean}
   */
  protected isGroup = (taxRate: TaxRateModel): boolean => {
    return Boolean(taxRate.isGroup);
  };

  /**
   * Whether the tax rate is used, as set by the query before transforming.
   * @param taxRate
   * @returns {boolean}
   */
  protected isUsed = (
    taxRate: TaxRateModel & { isUsed?: boolean },
  ): boolean => {
    return Boolean(taxRate.isUsed);
  };

  /**
   * A group's component rates, in order; empty for a plain rate.
   * @param taxRate
   * @returns {Array<{ id: number; name: string; code: string; rate: number }>}
   */
  protected components = (taxRate: TaxRateModel) => {
    return (taxRate.components || []).map((component) => ({
      id: component.id,
      name: component.name,
      code: component.code,
      rate: component.rate,
    }));
  };
}
