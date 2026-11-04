import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { omit } from 'lodash';
import {
  ITaxRateEditedPayload,
  ITaxRateEditingPayload,
} from '../TaxRates.types';
import { CommandTaxRatesValidators } from './CommandTaxRatesValidator.service';
import { TaxRateModel } from '../models/TaxRate.model';
import { TaxRateComponent } from '../models/TaxRateComponent.model';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { events } from '@/common/events/events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { EditTaxRateDto } from '../dtos/TaxRate.dto';
import { haveSameComponents, sumComponentRates } from '../TaxRateGroups';

@Injectable()
export class EditTaxRateService {
  /**
   * @param {EventEmitter2} eventEmitter - The event emitter.
   * @param {UnitOfWork} uow - The unit of work.
   * @param {CommandTaxRatesValidators} validators - The tax rates validators.
   * @param {TenantModelProxy<typeof TaxRateModel>} taxRateModel - The tax rate model.
   * @param {TenantModelProxy<typeof TaxRateComponent>} taxRateComponentModel - The tax group component model.
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
   * Edits the given tax rate.
   * @param {number} taxRateId - The tax rate id.
   * @param {EditTaxRateDto} editTaxRateDTO - The tax rate data to edit.
   * @returns {Promise<TaxRateModel>}
   */
  public async editTaxRate(taxRateId: number, editTaxRateDTO: EditTaxRateDto) {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      // Loads the stored rate inside the transaction, so the locks see what's
      // committed when the edit runs.
      const oldTaxRate = await this.taxRateModel()
        .query(trx)
        .findById(taxRateId)
        .withGraphFetched('components');

      // Validates the tax rate existance.
      this.validators.validateTaxRateExistance(oldTaxRate);

      // Validates the type, and a used rate's components and payable account,
      // don't change.
      await this.validators.validateTaxRateEditLocks(
        oldTaxRate,
        editTaxRateDTO,
        trx,
      );
      // Triggers `onTaxRateEditing` event.
      await this.eventEmitter.emitAsync(events.taxRates.onEditing, {
        editTaxRateDTO,
        oldTaxRate,
        trx,
      } as ITaxRateEditingPayload);

      // Validates the tax code uniqueness against the other tax rates.
      await this.validators.validateTaxCodeUnique(
        editTaxRateDTO.code,
        trx,
        taxRateId,
      );
      const rate = oldTaxRate.isGroup
        ? await this.saveGroupComponents(oldTaxRate, editTaxRateDTO, trx)
        : this.plainRate(editTaxRateDTO);

      await this.validators.validatePayableAccount(
        editTaxRateDTO.payableAccountId,
        trx,
      );
      // Edits the tax rate in place, so documents keep pointing at the same id.
      const taxRate = await this.taxRateModel()
        .query(trx)
        .patchAndFetchById(taxRateId, {
          ...omit(editTaxRateDTO, ['componentIds', 'isGroup']),
          rate,
        });

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

  /**
   * Replaces a group's components when the edit changes them, and returns
   * the group's rate: the sum of its components' current rates. A rate sent
   * with a group is ignored.
   * @param {TaxRateModel} oldTaxRate - The stored group, with `components`.
   * @param {EditTaxRateDto} editTaxRateDTO
   * @param {Knex.Transaction} trx
   * @returns {Promise<number>}
   */
  private async saveGroupComponents(
    oldTaxRate: TaxRateModel,
    editTaxRateDTO: EditTaxRateDto,
    trx: Knex.Transaction,
  ): Promise<number> {
    const oldComponents = oldTaxRate.components || [];
    const { componentIds } = editTaxRateDTO;
    const componentsChanged =
      componentIds !== undefined &&
      !haveSameComponents(
        oldComponents.map((component) => component.id),
        (componentIds || []).map(Number),
      );
    if (!componentsChanged) {
      return sumComponentRates(
        oldComponents.map((component) => component.rate),
      );
    }
    const components = await this.validators.validateGroupComponents(
      componentIds,
      trx,
    );
    await this.taxRateComponentModel()
      .query(trx)
      .where('groupId', oldTaxRate.id)
      .delete();

    for (const [index, component] of components.entries()) {
      await this.taxRateComponentModel().query(trx).insert({
        groupId: oldTaxRate.id,
        componentId: component.id,
        index,
      });
    }
    return sumComponentRates(components.map((component) => component.rate));
  }

  /**
   * Retrieves a plain rate's edited rate; a plain rate has no components.
   * @param {EditTaxRateDto} editTaxRateDTO
   * @returns {number}
   */
  private plainRate(editTaxRateDTO: EditTaxRateDto): number {
    this.validators.validatePlainRateComponents(editTaxRateDTO.componentIds);

    return editTaxRateDTO.rate;
  }
}
