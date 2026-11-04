import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import {
  ITaxRateEditedPayload,
  ITaxRateEditingPayload,
} from '../TaxRates.types';
import { CommandTaxRatesValidators } from './CommandTaxRatesValidator.service';
import { TaxRateModel } from '../models/TaxRate.model';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { events } from '@/common/events/events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { EditTaxRateDto } from '../dtos/TaxRate.dto';

@Injectable()
export class EditTaxRateService {
  /**
   * @param {EventEmitter2} eventEmitter - The event emitter.
   * @param {UnitOfWork} uow - The unit of work.
   * @param {CommandTaxRatesValidators} validators - The tax rates validators.
   * @param {TenantModelProxy<typeof TaxRateModel>} taxRateModel - The tax rate model.
   */
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly uow: UnitOfWork,
    private readonly validators: CommandTaxRatesValidators,

    @Inject(TaxRateModel.name)
    private readonly taxRateModel: TenantModelProxy<typeof TaxRateModel>,
  ) {}

  /**
   * Edits the given tax rate.
   * @param {number} taxRateId - The tax rate id.
   * @param {IEditTaxRateDTO} editTaxRateDTO - The tax rate data to edit.
   * @returns {Promise<ITaxRate>}
   */
  public async editTaxRate(taxRateId: number, editTaxRateDTO: EditTaxRateDto) {
    const oldTaxRate = await this.taxRateModel().query().findById(taxRateId);

    // Validates the tax rate existance.
    this.validators.validateTaxRateExistance(oldTaxRate);

    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      // Triggers `onTaxRateEditing` event.
      await this.eventEmitter.emitAsync(events.taxRates.onEditing, {
        editTaxRateDTO,
        trx,
      } as ITaxRateEditingPayload);

      // Validates the tax code uniqueness against the other tax rates.
      await this.validators.validateTaxCodeUnique(
        editTaxRateDTO.code,
        trx,
        taxRateId,
      );
      // Edits the tax rate in place, so documents keep pointing at the same id.
      const taxRate = await this.taxRateModel()
        .query(trx)
        .patchAndFetchById(taxRateId, { ...editTaxRateDTO });

      // Triggers `onTaxRateEdited` event.
      await this.eventEmitter.emitAsync(events.taxRates.onEdited, {
        editTaxRateDTO,
        oldTaxRate,
        taxRate,
        trx,
      } as ITaxRateEditedPayload);

      return taxRate;
    });
  }
}
