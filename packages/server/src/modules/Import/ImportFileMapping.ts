import { Inject, Injectable } from '@nestjs/common';
import { fromPairs, isPlainObject, isUndefined } from 'lodash';
import * as Yup from 'yup';
import {
  ImportDateFormats,
  ImportFileMapPOJO,
  ImportMappingAttr,
} from './interfaces';
import { ResourceService } from '../Resource/ResourceService';
import { ServiceError } from '../Items/ServiceError';
import { ERRORS } from './_utils';
import { ImportModel } from './models/Import';
import { ImportableRegistry } from './ImportableRegistry';

@Injectable()
export class ImportFileMapping {
  constructor(
    private readonly resource: ResourceService,
    private readonly importableRegistry: ImportableRegistry,

    @Inject(ImportModel.name)
    private readonly importModel: typeof ImportModel,
  ) {}

  /**
   * Mapping the excel sheet columns with resource columns.
   * @param {number} importId
   * @param {ImportMappingAttr} maps
   * @param {Record<string, any>} params - Optional params merged into the
   *   import's stored params (validated by the importable's params schema).
   */
  public async mapping(
    importId: string,
    maps: ImportMappingAttr[],
    params?: Record<string, any>,
  ): Promise<ImportFileMapPOJO> {
    const importFile = await this.importModel
      .query()
      .findOne('filename', importId)
      .throwIfNotFound();

    // Invalidate the from/to map attributes.
    await this.validateMapsAttrs(importFile, maps);

    // @todo validate the required fields.

    // Validate the diplicated relations of map attrs.
    this.validateDuplicatedMapAttrs(maps);

    // Validate the date format mapping.
    this.validateDateFormatMapping(importFile.resource, maps);

    // Let the importable refuse mappings it can't import.
    const importable = await this.importableRegistry.getImportable(
      importFile.resource,
    );
    importable.validateMapping(maps);

    const patch: Record<string, string> = { mapping: JSON.stringify(maps) };

    if (!isUndefined(params) && params !== null) {
      const allowedParams = await this.validateMappingParams(
        importable.mappingParamsSchema(),
        params,
      );
      patch.params = JSON.stringify({
        ...importFile.paramsParsed,
        ...allowedParams,
      });
    }
    await this.importModel.query().findById(importFile.id).patch(patch);
    return {
      import: {
        importId: importFile.importId,
        resource: importFile.resource,
      },
    };
  }

  /**
   * Validates the params sent with the mapping against the importable's
   * mapping params schema: a plain object with only the allowed keys and
   * exact types (no casting), so stored params can't be overwritten.
   * @param {Yup.ObjectSchema<object> | null} schema
   * @param {unknown} params
   * @throws {ServiceError(ERRORS.INVALID_IMPORT_PARAMS)}
   */
  private async validateMappingParams(
    schema: Yup.ObjectSchema<object> | null,
    params: unknown,
  ): Promise<Record<string, unknown>> {
    if (!schema || !isPlainObject(params)) {
      throw new ServiceError(ERRORS.INVALID_IMPORT_PARAMS);
    }
    try {
      return (await schema.validate(params, { strict: true })) as Record<
        string,
        unknown
      >;
    } catch {
      throw new ServiceError(ERRORS.INVALID_IMPORT_PARAMS);
    }
  }

  /**
   * Validate the mapping attributes.
   * @param {} importFile -
   * @param {ImportMappingAttr[]} maps
   * @throws {ServiceError(ERRORS.INVALID_MAP_ATTRS)}
   */
  private async validateMapsAttrs(importFile: any, maps: ImportMappingAttr[]) {
    const fields = await this.resource.getResourceFields2(importFile.resource);
    const columnsMap = fromPairs(
      importFile.columnsParsed.map((field) => [field, '']),
    );
    const invalid = [];

    // is not empty, is not undefined or map.group
    maps.forEach((map) => {
      let _invalid = true;

      if (!map.group && fields[map.to]) {
        _invalid = false;
      }
      if (map.group && fields[map.group] && fields[map.group]?.fields[map.to]) {
        _invalid = false;
      }
      if (columnsMap[map.from]) {
        _invalid = false;
      }
      if (_invalid) {
        invalid.push(map);
      }
    });
    if (invalid.length > 0) {
      throw new ServiceError(ERRORS.INVALID_MAP_ATTRS);
    }
  }

  /**
   * Validate the map attrs relation should be one-to-one relation only.
   * @param {ImportMappingAttr[]} maps
   */
  private validateDuplicatedMapAttrs(maps: ImportMappingAttr[]) {
    const fromMap = {};
    const toMap = {};

    maps.forEach((map) => {
      if (fromMap[map.from]) {
        throw new ServiceError(ERRORS.DUPLICATED_FROM_MAP_ATTR);
      } else {
        fromMap[map.from] = true;
      }
      const toPath = !isUndefined(map?.group)
        ? `${map.group}.${map.to}`
        : map.to;

      if (toMap[toPath]) {
        throw new ServiceError(ERRORS.DUPLICATED_TO_MAP_ATTR);
      } else {
        toMap[toPath] = true;
      }
    });
  }

  /**
   * Validates the date format mapping.
   * @param {string} resource
   * @param {ImportMappingAttr[]} maps
   */
  private validateDateFormatMapping(
    resource: string,
    maps: ImportMappingAttr[],
  ) {
    const fields = this.resource.getResourceImportableFields(resource);
    // @todo Validate date type of the nested fields.
    maps.forEach((map) => {
      if (
        typeof fields[map.to] !== 'undefined' &&
        fields[map.to].fieldType === 'date'
      ) {
        if (
          typeof map.dateFormat !== 'undefined' &&
          ImportDateFormats.indexOf(map.dateFormat) === -1
        ) {
          throw new ServiceError(ERRORS.INVALID_MAP_DATE_FORMAT);
        }
      }
    });
  }
}
