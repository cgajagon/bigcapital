import { BaseModel } from '@/models/Model';

/**
 * Links a tax group (a `tax_rates` row with `is_group`) to one of its component
 * rates. `index` keeps the order in which the components were given.
 */
export class TaxRateComponent extends BaseModel {
  public id: number;
  public groupId: number;
  public componentId: number;
  public index: number;

  /**
   * Table name
   */
  static get tableName() {
    return 'tax_rate_components';
  }

  /**
   * Timestamps columns.
   */
  get timestamps() {
    return [];
  }
}
