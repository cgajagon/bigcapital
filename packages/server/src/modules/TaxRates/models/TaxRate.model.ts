// import TenantModel from 'models/TenantModel';
// import ModelSearchable from './ModelSearchable';
// import SoftDeleteQueryBuilder from '@/collection/SoftDeleteQueryBuilder';
// import TaxRateMeta from './TaxRate.settings';
// import ModelSetting from './ModelSetting';
import { Model } from 'objection';
import { BaseModel } from '@/models/Model';
import { ExportableModel } from '@/modules/Export/decorators/ExportableModel.decorator';

@ExportableModel()
export class TaxRateModel extends BaseModel {
  active!: boolean;
  code!: string;
  name!: string;
  rate!: number;
  isGroup!: boolean;
  payableAccountId!: number | null;
  description?: string;

  /**
   * Table name
   */
  static get tableName() {
    return 'tax_rates';
  }

  /**
   * Soft delete query builder.
   */
  // static get QueryBuilder() {
  // return SoftDeleteQueryBuilder;
  // }

  /**
   * Timestamps columns.
   */
  get timestamps() {
    return ['createdAt', 'updatedAt'];
  }

  /**
   * Retrieves the tax rate meta.
   */
  // static get meta() {
  // return TaxRateMeta;
  // }

  /**
   * Virtual attributes.
   */
  static get virtualAttributes() {
    return [];
  }

  /**
   * Model modifiers.
   */
  static get modifiers() {
    return {};
  }

  /**
   * Relationship mapping.
   */
  static get relationMappings() {
    return {
      /**
       * The component rates of a tax group, in their saved order.
       */
      components: {
        relation: Model.ManyToManyRelation,
        modelClass: TaxRateModel,
        join: {
          from: 'tax_rates.id',
          through: {
            from: 'tax_rate_components.groupId',
            to: 'tax_rate_components.componentId',
            extra: ['index'],
          },
          to: 'tax_rates.id',
        },
        filter: (query) => query.orderBy('tax_rate_components.index'),
      },
    };
  }
}
