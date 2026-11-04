import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { uniq } from 'lodash';
import { events } from '@/common/events/events';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { ITaxRateEditedPayload } from '../TaxRates.types';
import { TaxRateModel } from '../models/TaxRate.model';
import { TaxRateComponent } from '../models/TaxRateComponent.model';
import { sumComponentRates } from '../TaxRateGroups';

@Injectable()
export class SyncTaxGroupRatesSubscriber {
  constructor(
    @Inject(TaxRateModel.name)
    private readonly taxRateModel: TenantModelProxy<typeof TaxRateModel>,

    @Inject(TaxRateComponent.name)
    private readonly taxRateComponentModel: TenantModelProxy<
      typeof TaxRateComponent
    >,
  ) {}

  /**
   * Recomputes the rate of every tax group the edited rate is a component of,
   * in the edit's transaction. Errors aren't suppressed, so a failed sync
   * rolls the edit back rather than leaving a group's rate stale.
   * @param {ITaxRateEditedPayload} payload
   */
  @OnEvent(events.taxRates.onEdited, { suppressErrors: false })
  async handleSyncTaxGroupRates({ taxRate, trx }: ITaxRateEditedPayload) {
    if (taxRate.isGroup) return;

    const links = await this.taxRateComponentModel()
      .query(trx)
      .where('componentId', taxRate.id);
    const groupIds = uniq(links.map((link) => link.groupId));

    for (const groupId of groupIds) {
      const group = await this.taxRateModel()
        .query(trx)
        .findById(groupId)
        .withGraphFetched('components');
      const rate = sumComponentRates(
        (group.components || []).map((component) => component.rate),
      );
      await this.taxRateModel().query(trx).findById(groupId).patch({ rate });
    }
  }
}
