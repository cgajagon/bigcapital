import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import {
  ITaxRateDeletedPayload,
  ITaxRateDeletingPayload,
} from '../TaxRates.types';
import { CommandTaxRatesValidators } from './CommandTaxRatesValidator.service';
import { TaxRateModel } from '../models/TaxRate.model';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { events } from '@/common/events/events';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';

@Injectable()
export class DeleteTaxRateService {
  /**
   * @param {EventEmitter2} eventEmitter - The event emitter.
   * @param {UnitOfWork} uow - The unit of work.
   * @param {CommandTaxRatesValidators} validators - The tax rates validators.
   * @param {typeof TaxRateModel} taxRateModel - The tax rate model.
   */
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly uow: UnitOfWork,
    private readonly validators: CommandTaxRatesValidators,

    @Inject(TaxRateModel.name)
    private readonly taxRateModel: TenantModelProxy<typeof TaxRateModel>,
  ) {}

  /**
   * Deletes the given tax rate.
   * @param {number} taxRateId
   * @returns {Promise<void>}
   */
  public async deleteTaxRate(taxRateId: number): Promise<void> {
    const oldTaxRate = await this.taxRateModel().query().findById(taxRateId);

    // Validates the tax rate existance.
    this.validators.validateTaxRateExistance(oldTaxRate);

    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      // Validates no document, ledger entry or item uses the tax rate, inside
      // the transaction so nothing can start using it before the delete.
      await this.validators.validateTaxRateNotInUse(taxRateId, trx);

      // Validates no tax group has the rate as a component. Deleting a group
      // itself unlinks its components (the links cascade).
      await this.validators.validateTaxRateNotGroupComponent(taxRateId, trx);

      // Triggers `onTaxRateDeleting` event.
      await this.eventEmitter.emitAsync(events.taxRates.onDeleting, {
        oldTaxRate,
        trx,
      } as ITaxRateDeletingPayload);

      await this.taxRateModel().query(trx).findById(taxRateId).delete();

      // Triggers `onTaxRateDeleted` event.
      await this.eventEmitter.emitAsync(events.taxRates.onDeleted, {
        oldTaxRate,
        trx,
      } as ITaxRateDeletedPayload);
    });
  }
}
