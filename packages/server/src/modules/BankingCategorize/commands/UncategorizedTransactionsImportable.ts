import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as yup from 'yup';
import * as uniqid from 'uniqid';
import { Importable } from '../../Import/Importable';
import { CreateUncategorizedTransactionService } from './CreateUncategorizedTransaction.service';
import { ImportableContext } from '../../Import/interfaces';
import { BankTransactionsSampleData } from '../../BankingTransactions/constants';
import { Account } from '@/modules/Accounts/models/Account.model';
import { CreateUncategorizedTransactionDTO } from '../types/BankingCategorize.types';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { ImportableService } from '../../Import/decorators/Import.decorator';
import { UncategorizedBankTransaction } from '../../BankingTransactions/models/UncategorizedBankTransaction';
import {
  ImportMappingAttr,
  ImportOperSuccess,
  ImportPreparedRows,
  ImportRowSkip,
} from '../../Import/interfaces';
import { ImportModelShape } from '../../Import/models/Import';
import { ServiceError } from '../../Items/ServiceError';
import {
  getBankAmountLayout,
  prepareBankRows,
  summarizeBankAmounts,
} from '../utils/bankImportAmounts';
import {
  BANK_IMPORT_DUPLICATE_ERROR_CODE,
  findDuplicateRowIndexes,
  formatDuplicateRowMessage,
  parseBankRowDate,
} from '../utils/bankImportDuplicates';

@Injectable()
@ImportableService({ name: UncategorizedBankTransaction.name })
export class UncategorizedTransactionsImportable extends Importable {
  constructor(
    private readonly createUncategorizedTransaction: CreateUncategorizedTransactionService,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(UncategorizedBankTransaction.name)
    private readonly uncategorizedBankTransactionModel: TenantModelProxy<
      typeof UncategorizedBankTransaction
    >,
  ) {
    super();
  }

  /**
   * Passing the sheet DTO to create uncategorized transaction.
   * @param {CreateUncategorizedTransactionDTO,} createDTO
   * @param {Knex.Transaction} trx
   */
  public async importable(
    createDTO: CreateUncategorizedTransactionDTO,
    trx?: Knex.Transaction,
  ) {
    return this.createUncategorizedTransaction.create(createDTO, trx);
  }

  /**
   * Skips the file rows already in the bank account, counting occurrences so
   * identical rows in one file still import.
   * @param {Record<string, any>[]} parsedData - Parsed rows, in file order.
   * @param {ImportModelShape} importFile
   * @returns {Promise<ImportRowSkip[]>}
   */
  public async getSkippedRows(
    parsedData: Record<string, any>[],
    importFile: ImportModelShape,
  ): Promise<ImportRowSkip[]> {
    const dates = parsedData
      .map((row) => parseBankRowDate(row.date))
      .filter(Boolean)
      .sort();

    if (dates.length === 0) return [];

    // Read committed rows only, outside the import's read-uncommitted
    // transaction, so rows a concurrent preview inserts then rolls back
    // never count as already imported.
    const existingRows = await this.uncategorizedBankTransactionModel()
      .query()
      .where('accountId', importFile.paramsParsed.accountId)
      .whereBetween('date', [dates[0], dates[dates.length - 1]])
      .select('date', 'amount', 'payee', 'description', 'referenceNo');

    return findDuplicateRowIndexes(parsedData, existingRows).map((index) => ({
      index,
      errorCode: BANK_IMPORT_DUPLICATE_ERROR_CODE,
      errorMessage: formatDuplicateRowMessage(parsedData[index]),
    }));
  }

  /**
   * Refuses Amount mapped together with Deposit or Withdrawal: a file gives
   * either one signed Amount column or separate Deposit/Withdrawal columns.
   * @param {ImportMappingAttr[]} maps
   */
  public validateMapping(maps: ImportMappingAttr[]): void {
    const mapsTo = (key: string) => maps.some((map) => map.to === key);

    if (mapsTo('amount') && (mapsTo('deposit') || mapsTo('withdrawal'))) {
      throw new ServiceError(
        'IMPORT_AMOUNT_MAPPING_CONFLICT',
        'Map either Amount, or Deposit and Withdrawal, not both.',
      );
    }
  }

  /**
   * Turns each row into one signed amount (Deposit/Withdrawal columns and
   * reverse signs), before the duplicate check, transform and validation.
   * @param {Record<string, any>[]} parsedData - Parsed rows, in file order.
   * @param {ImportModelShape} importFile
   * @returns {Promise<ImportPreparedRows>}
   */
  public async prepareRows(
    parsedData: Record<string, any>[],
    importFile: ImportModelShape,
  ): Promise<ImportPreparedRows> {
    return prepareBankRows(parsedData, {
      layout: getBankAmountLayout(importFile.mappingParsed || []),
      reverseSigns: !!importFile.paramsParsed?.reverseSigns,
    });
  }

  /**
   * Retrieves the money in / money out totals of the rows to be created.
   * @param {ImportOperSuccess[]} success
   */
  public getPreviewSummary(success: ImportOperSuccess[]) {
    return summarizeBankAmounts(
      success.map((oper) => Number((oper.data as { amount?: number })?.amount)),
    );
  }

  /**
   * Transformes the DTO before validating and importing.
   * @param {CreateUncategorizedTransactionDTO} createDTO
   * @param {ImportableContext} context
   * @returns {CreateUncategorizedTransactionDTO}
   */
  public transform(
    createDTO: CreateUncategorizedTransactionDTO,
    context?: ImportableContext,
  ): CreateUncategorizedTransactionDTO {
    return {
      ...createDTO,
      accountId: context.import.paramsParsed.accountId,
      batch: context.import.paramsParsed.batch,
    };
  }

  /**
   * Sample data used to download sample sheet.
   * @returns {Record<string, any>[]}
   */
  public sampleData(): Record<string, any>[] {
    return BankTransactionsSampleData;
  }

  // ------------------
  // # Params
  // ------------------
  /**
   * Params validation schema.
   * @returns {ValidationSchema[]}
   */
  public paramsValidationSchema() {
    return yup.object().shape({
      accountId: yup.number().required(),
      reverseSigns: yup.boolean(),
    });
  }

  /**
   * Validates the params existance asyncly.
   * @param {number} tenantId -
   * @param {Record<string, any>} params -
   */
  public async validateParams(params: Record<string, any>): Promise<void> {
    if (params.accountId) {
      await this.accountModel()
        .query()
        .findById(params.accountId)
        .throwIfNotFound({});
    }
  }

  /**
   * Transforms the import params before storing them.
   * @param {Record<string, any>} parmas
   */
  public transformParams(parmas: Record<string, any>) {
    const batch = uniqid();

    return {
      ...parmas,
      batch,
    };
  }
}
