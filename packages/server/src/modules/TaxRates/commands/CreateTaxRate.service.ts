import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { omit } from 'lodash';
import {
  ITaxRateCreatedPayload,
  ITaxRateCreatingPayload,
} from '../TaxRates.types';
import { CommandTaxRatesValidators } from './CommandTaxRatesValidator.service';
import { TaxRateModel } from '../models/TaxRate.model';
import { TaxRateComponent } from '../models/TaxRateComponent.model';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { events } from '@/common/events/events';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { CreateTaxRateDto } from '../dtos/TaxRate.dto';
import { sumComponentRates } from '../TaxRateGroups';

@Injectable()
export class CreateTaxRate {
  /**
   * @param {EventEmitter2} eventEmitter - The event emitter.
   * @param {UnitOfWork} uow - The unit of work.
   * @param {CommandTaxRatesValidators} validators - The tax rates validators.
   * @param {typeof TaxRateModel} taxRateModel - The tax rate model.
   * @param {typeof TaxRateComponent} taxRateComponentModel - The tax group component model.
   */
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly uow: UnitOfWork,
    private readonly validators: CommandTaxRatesValidators,

    @Inject(TaxRateModel.name)
    private readonly taxRateModel: TenantModelProxy<typeof TaxRateModel>,

    @Inject(TaxRateComponent.name)
    private readonly taxRateComponentModel: TenantModelProxy<
      typeof TaxRateComponent
    >,
  ) {}

  /**
   * Creates a new tax rate, or a tax group whose rate is the sum of its
   * components' rates.
   * @param {CreateTaxRateDto} createTaxRateDTO
   * @param {Knex.Transaction} trx
   */
  public async createTaxRate(
    createTaxRateDTO: CreateTaxRateDto,
    trx?: Knex.Transaction,
  ) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      // Validates the tax code uniquiness.
      await this.validators.validateTaxCodeUnique(createTaxRateDTO.code, trx);

      const isGroup = Boolean(createTaxRateDTO.isGroup);
      const components = isGroup
        ? await this.validators.validateGroupComponents(
            createTaxRateDTO.componentIds,
            trx,
          )
        : [];
      if (!isGroup) {
        this.validators.validatePlainRateComponents(
          createTaxRateDTO.componentIds,
        );
      }
      if (isGroup) {
        this.validators.validateGroupHasNoPayableAccount(
          createTaxRateDTO.payableAccountId,
        );
      }
      await this.validators.validatePayableAccount(
        createTaxRateDTO.payableAccountId,
        trx,
      );
      // Triggers `onTaxRateCreating` event.
      await this.eventEmitter.emitAsync(events.taxRates.onCreating, {
        createTaxRateDTO,
        trx,
      } as ITaxRateCreatingPayload);

      const taxRate = await this.taxRateModel()
        .query(trx)
        .insertAndFetch({
          ...omit(createTaxRateDTO, ['componentIds']),
          isGroup,
          // A group's rate is always computed; a rate sent with it is ignored.
          rate: isGroup
            ? sumComponentRates(components.map((component) => component.rate))
            : createTaxRateDTO.rate,
        });

      // Links the group to its components, in the given order.
      for (const [index, component] of components.entries()) {
        await this.taxRateComponentModel().query(trx).insert({
          groupId: taxRate.id,
          componentId: component.id,
          index,
        });
      }
      // Triggers `onTaxRateCreated` event.
      await this.eventEmitter.emitAsync(events.taxRates.onCreated, {
        createTaxRateDTO,
        taxRate,
        trx,
      } as ITaxRateCreatedPayload);

      return taxRate;
    }, trx);
  }
}
