import { Knex } from 'knex';
import * as Yup from 'yup';
import {
  ImportableContext,
  ImportMappingAttr,
  ImportOperSuccess,
  ImportPreparedRows,
  ImportRowSkip,
} from './interfaces';
import { ImportModelShape } from './models/Import';

export abstract class Importable {
  /**
   *
   * @param {number} tenantId
   * @param {any} createDTO
   * @param {Knex.Transaction} trx
   */
  public importable(_createDTO: any, _trx?: Knex.Transaction) {
    throw new Error(
      'The `importable` function is not defined in service importable.',
    );
  }

  /**
   * Transformes the DTO before passing it to importable and validation.
   * @param {Record<string, any>} createDTO
   * @param {ImportableContext} context
   * @returns {Record<string, any>}
   */
  public transform(
    createDTO: Record<string, any>,
    _context: ImportableContext,
  ) {
    return createDTO;
  }

  /**
   * The params the mapping step may set, merged into the import's params.
   * Only the keys and types it describes are accepted. None by default.
   * @returns {Yup.ObjectSchema<object> | null}
   */
  public mappingParamsSchema(): Yup.ObjectSchema<object> | null {
    return null;
  }

  /**
   * Validates the column mapping at the mapping step; throws a ServiceError
   * to refuse it. Accepts every mapping by default.
   * @param {ImportMappingAttr[]} _maps
   */
  public validateMapping(_maps: ImportMappingAttr[]): void {}

  /**
   * Prepares the parsed rows once per import, before anything else sees them
   * (skips, transform, validation). Rows it rejects are reported as errors and
   * not imported. Rows are passed through unchanged by default.
   * The returned `rows` must keep the length and order of `parsedData`: a
   * row's index is its row in the file (row numbers, skips and errors use it).
   * @param {Record<string, any>[]} parsedData - Parsed rows, in file order.
   * @param {ImportModelShape} _importFile - The import being run.
   * @returns {Promise<ImportPreparedRows>}
   */
  public async prepareRows(
    parsedData: Record<string, any>[],
    _importFile: ImportModelShape,
  ): Promise<ImportPreparedRows> {
    return { rows: parsedData, rowErrors: [] };
  }

  /**
   * Retrieves totals of the rows to be created, shown in the import preview.
   * Nothing by default.
   * @param {ImportOperSuccess[]} _success - The rows to be created.
   * @returns {Record<string, number> | undefined}
   */
  public getPreviewSummary(
    _success: ImportOperSuccess[],
  ): Record<string, number> | undefined {
    return undefined;
  }

  /**
   * Retrieves the rows to skip before importing, with the reason for each.
   * Runs once per import with all parsed rows; skipped rows are reported as
   * skipped, not as errors. No rows are skipped by default.
   * @param {Record<string, any>[]} _parsedData - Parsed rows, in file order.
   * @param {ImportModelShape} _importFile - The import being run.
   * @returns {Promise<ImportRowSkip[]>}
   */
  public async getSkippedRows(
    _parsedData: Record<string, any>[],
    _importFile: ImportModelShape,
  ): Promise<ImportRowSkip[]> {
    return [];
  }

  /**
   * Concurrency controlling of the importing process.
   * @returns {number}
   */
  public get concurrency() {
    return 10;
  }

  /**
   * Retrieves the sample data of importable.
   * @returns {Array<any>}
   */
  public sampleData(): Array<any> {
    return [];
  }

  // ------------------
  // # Params
  // ------------------
  /**
   * Params Yup validation schema.
   * @returns {Yup.ObjectSchema<object, object>}
   */
  public paramsValidationSchema(): Yup.ObjectSchema<object, object> {
    return Yup.object().nullable();
  }

  /**
   * Validates the params of the importable service.
   * @param {Record<string, any>}
   * @returns {Promise<boolean>} - True means passed and false failed.
   */
  public async validateParams(_params: Record<string, any>): Promise<void> {}

  /**
   * Transformes the import params before storing them.
   * @param {Record<string, any>} parmas
   */
  public transformParams(parmas: Record<string, any>) {
    return parmas;
  }
}
