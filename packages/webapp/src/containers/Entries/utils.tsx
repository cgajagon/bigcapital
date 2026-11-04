import {
  aggregateComponentTaxes,
  computeLineComponentTaxes,
  computeLineTaxAmount,
  roundHalfAwayFromZero,
} from '@bigcapital/utils';
import * as FF from 'fp-ts/function';
import { sumBy, isEmpty, last, keyBy } from 'lodash';
import React, { useCallback } from 'react';
import { useItemEntriesTableContext } from './ItemEntriesTableProvider';
import type { ItemEntry } from '@/interfaces/ItemEntries';
import type { TaxRate } from '@bigcapital/sdk-ts';
import type { TaxComponentAmount, TaxComponentRate } from '@bigcapital/utils';
import { isInactiveTaxRate } from '@/components/TaxRates/utils';
import { useItem } from '@/hooks/query';
import {
  toSafeNumber,
  saveInvoke,
  updateTableCell,
  updateAutoAddNewLine,
  updateMinEntriesLines,
  orderingLinesIndexes,
  updateTableRow,
  formattedAmount,
  updateRemoveLineByIndex,
} from '@/utils';

export const ITEM_TYPE = {
  SELLABLE: 'SELLABLE',
  PURCHASABLE: 'PURCHASABLE',
};

/**
 * Minimal items entry shape the entries table utilities operate on.
 */
interface ItemsEntryRow {
  index?: number;
  itemId?: string | number;
  description?: string;
  quantity?: string | number;
  rate?: string | number;
  discount?: string | number;
  amount?: string | number;
  taxRateId?: string | number;
  taxRate?: string | number;
  taxAmount?: string | number;
}

/**
 * Retrieve item entry total from the given rate, quantity and discount.
 * @param {number} rate
 * @param {number} quantity
 * @param {number} discount
 * @return {number}
 */
export const calcItemEntryTotal = (
  discount?: string | number,
  quantity?: string | number,
  rate?: string | number,
): number => {
  const _quantity = toSafeNumber(quantity);
  const _rate = toSafeNumber(rate);
  const _discount = toSafeNumber(discount);

  return _quantity * _rate - (_quantity * _rate * _discount) / 100;
};

/**
 * Updates the items entries total.
 */
export function updateItemsEntriesTotal<T extends ItemsEntryRow>(
  rows: T[],
): Array<T & { amount: number }> {
  return rows.map((row) => ({
    ...row,
    amount: calcItemEntryTotal(row.discount, row.quantity, row.rate),
  }));
}

/**
 * Retrieve total of the given items entries.
 */
export function getEntriesTotal<T extends { amount?: string | number }>(
  entries: T[],
): number {
  return sumBy(entries, 'amount');
}

/**
 * Ensure the given entries have enough empty line on the last.
 * @param {Object} defaultEntry - Default entry.
 * @param {Array} entries - Entries.
 * @return {Array}
 */
export const ensureEntriesHaveEmptyLine =
  <T,>(defaultEntry: T) =>
  (entries: T[]): T[] => {
    // The entries are heterogenous between the different document types and
    // only the account and amount attributes are read by the empty line check.
    const lastEntry = last(entries) as
      | (T & { account_id?: unknown; amount?: unknown })
      | undefined;

    if (isEmpty(lastEntry!.account_id) || isEmpty(lastEntry!.amount)) {
      return [...entries, defaultEntry];
    }
    return entries;
  };

/**
 * Disable landed cost checkbox once the item type is not service or non-inventorty.
 * @returns {boolean}
 */
export const isLandedCostDisabled = (item: unknown) =>
  ['service', 'non-inventory'].indexOf(
    (item as { type?: string }).type as string,
  ) === -1;

interface FetchedItemRow {
  rate: number | undefined;
  description: string | undefined;
  quantity: number;
  taxRateId: number | null | undefined;
  landedCost?: boolean;
  landedCostDisabled?: boolean;
}

interface ItemRowMeta {
  rowIndex: number;
  columnId: string;
  itemId: number;
}

type CellLoadingCoords = Array<[number, string]>;

interface UseFetchItemRowProps {
  landedCost?: boolean;
  itemType?: string;
  taxRates?: TaxRate[];
  notifyNewRow: (newRow: FetchedItemRow, rowIndex: number) => void;
}

/**
 * Handle fetch item row details and retrieves the new table row.
 */
export function useFetchItemRow({
  landedCost,
  itemType,
  taxRates,
  notifyNewRow,
}: UseFetchItemRowProps) {
  const [itemRow, setItemRow] = React.useState<ItemRowMeta | null>(null);
  const [cellsLoading, setCellsLoading] =
    React.useState<CellLoadingCoords | null>(null);

  // Fetches the item details.
  const {
    data: item,
    isFetching: isItemFetching,
    isSuccess: isItemSuccess,
  } = useItem(itemRow && itemRow.itemId, {
    enabled: !!(itemRow && itemRow.itemId),
  });

  // Once the item start loading give the table cells loading state.
  React.useEffect(() => {
    if (itemRow && isItemFetching) {
      setCellsLoading([
        [itemRow.rowIndex, 'rate'],
        [itemRow.rowIndex, 'description'],
        [itemRow.rowIndex, 'quantity'],
        [itemRow.rowIndex, 'discount'],
      ]);
    } else {
      setCellsLoading(null);
    }
  }, [isItemFetching, setCellsLoading, itemRow]);

  // Once the item selected and fetched set the initial details to the table.
  React.useEffect(() => {
    if (isItemSuccess && item && itemRow) {
      const { rowIndex } = itemRow;
      const price =
        itemType === ITEM_TYPE.PURCHASABLE ? item.costPrice : item.sellPrice;

      const description =
        itemType === ITEM_TYPE.PURCHASABLE
          ? item.purchaseDescription
          : item.sellDescription;

      // Detarmines whether the landed cost checkbox should be disabled.
      const landedCostDisabled = isLandedCostDisabled(item);

      const defaultTaxRateId =
        itemType === ITEM_TYPE.PURCHASABLE
          ? item.purchaseTaxRateId
          : item.sellTaxRateId;

      // An inactive default tax rate isn't applied to new lines.
      const taxRateId = isInactiveTaxRate(taxRates, defaultTaxRateId)
        ? null
        : defaultTaxRateId;

      // The new row.
      const newRow = {
        rate: price,
        description,
        quantity: 1,
        ...(landedCost
          ? {
              landedCost: false,
              landedCostDisabled: landedCostDisabled,
            }
          : {}),
        taxRateId,
      };
      setItemRow(null);
      saveInvoke(notifyNewRow, newRow, rowIndex);
    }
  }, [
    item,
    itemRow,
    itemType,
    isItemSuccess,
    landedCost,
    notifyNewRow,
    taxRates,
  ]);

  return {
    isItemFetching,
    isItemSuccess,
    item,
    setItemRow,
    itemRow,
    cellsLoading,
  };
}

/**
 * Compose table rows when edit specific row index of table rows.
 */
export const composeRowsOnEditCell = (
  rowIndex: number,
  columnId: string,
  value: unknown,
  defaultEntry: unknown,
  rows: unknown[],
) => {
  return FF.pipe(rows);
};

/**
 * Compose table rows when insert a new row to table rows.
 */
export const useComposeRowsOnNewRow = () => {
  const { taxRates, documentTaxRates, isInclusiveTax } =
    useItemEntriesTableContext();

  return React.useMemo(() => {
    return (
      rowIndex: number,
      newRow: FetchedItemRow,
      rows: ItemEntry[],
    ): ItemEntry[] => {
      return FF.pipe(
        rows,
        updateTableRow(rowIndex, newRow),
        updateItemsEntriesTotal,
        orderingLinesIndexes,
        assignEntriesTaxRate(taxRates, documentTaxRates),
        assignEntriesTaxAmount(isInclusiveTax),
      ) as unknown as ItemEntry[];
    };
  }, [isInclusiveTax, taxRates, documentTaxRates]);
};

/**
 * Retrieves the percentage a saved document stored for each tax it uses,
 * keyed by tax rate id. A stored 0 is kept; lines without one are skipped.
 * @param entries - The saved document's entries.
 * @returns {Record<string, number>}
 */
export const getEntriesDocumentTaxRates = (
  entries?: Array<{
    taxRateId?: number | string | null;
    taxRate?: number | string | null;
    taxComponents?: Array<{
      taxRateId?: number | string | null;
      rate?: number | string | null;
    }> | null;
  }>,
): Record<string, number> => {
  const documentTaxRates: Record<string, number> = {};

  (entries || []).forEach((entry) => {
    const key = String(entry.taxRateId ?? '');

    if (
      key &&
      entry.taxRate !== null &&
      entry.taxRate !== undefined &&
      !(key in documentTaxRates)
    ) {
      documentTaxRates[key] = Number(entry.taxRate);
    }
    // A group line's saved snapshot of each component's percentage.
    (entry.taxComponents || []).forEach((component) => {
      const componentKey = String(component.taxRateId ?? '');

      if (
        componentKey &&
        component.rate !== null &&
        component.rate !== undefined &&
        !(componentKey in documentTaxRates)
      ) {
        documentTaxRates[componentKey] = Number(component.rate);
      }
    });
  });
  return documentTaxRates;
};

/**
 * Associate tax rate to entries. Taxes the saved document already uses keep
 * the document's percentage, like the server does when it saves.
 * @param {TaxRate[]} taxRates - The current tax rates.
 * @param {Record<string, number>} documentTaxRates - The saved document's percentages.
 */
export const assignEntriesTaxRate =
  (taxRates?: TaxRate[], documentTaxRates: Record<string, number> = {}) =>
  <T extends { taxRateId?: string | number }>(entries: T[]) => {
    const taxRatesById = keyBy(taxRates, 'id');

    return entries.map((entry) => {
      const documentTaxRate = documentTaxRates[entry.taxRateId as string];
      const taxRate = taxRatesById[entry.taxRateId as string];

      // A group line carries a snapshot of each component's percentage; its
      // own rate is their sum.
      if (taxRate?.isGroup && taxRate.components?.length) {
        const taxComponents = taxRate.components.map((component) => ({
          taxRateId: component.id,
          rate: documentTaxRates[component.id] ?? Number(component.rate),
        }));
        return {
          ...entry,
          taxComponents,
          taxRate: roundHalfAwayFromZero(
            taxComponents.reduce((sum, c) => sum + c.rate, 0),
            4,
          ),
        };
      }
      return {
        ...entry,
        taxComponents: null,
        taxRate:
          documentTaxRate !== undefined ? documentTaxRate : taxRate?.rate || 0,
      };
    });
  };

interface TaxableEntry {
  amount?: string | number;
  taxRate?: string | number;
  taxRateId?: string | number;
  taxComponents?: TaxComponentRate[] | null;
}

type TaxedEntry<T> = T & {
  taxAmount: number;
  componentTaxes: TaxComponentAmount[];
};

/**
 * Assign tax amount to entries.
 * @param {boolean} isInclusiveTax
 * @param entries
 * @returns
 */
export function assignEntriesTaxAmount<T extends TaxableEntry>(
  isInclusiveTax: boolean | undefined,
  entries: T[],
): Array<TaxedEntry<T>>;
export function assignEntriesTaxAmount<T extends TaxableEntry>(
  isInclusiveTax: boolean | undefined,
): (entries: T[]) => Array<TaxedEntry<T>>;
export function assignEntriesTaxAmount<T extends TaxableEntry>(
  isInclusiveTax: boolean | undefined,
  entries?: T[],
) {
  const assignToEntries = (list: T[]) =>
    list.map((entry) => {
      const amount = entry.amount as number;
      const taxRate = entry.taxRate as number;
      // Rounded to the cent like the server so the tax footer matches the
      // saved document.
      if (entry.taxComponents?.length) {
        const componentTaxes = computeLineComponentTaxes(
          amount,
          entry.taxComponents,
          !!isInclusiveTax,
        );
        return {
          ...entry,
          componentTaxes,
          taxAmount: roundHalfAwayFromZero(
            componentTaxes.reduce((sum, c) => sum + c.amount, 0),
          ),
        };
      }
      const taxAmount = computeLineTaxAmount(amount, taxRate, !!isInclusiveTax);
      const componentTaxes: TaxComponentAmount[] = entry.taxRateId
        ? [
            {
              taxRateId: entry.taxRateId as number,
              rate: Number(taxRate) || 0,
              amount: taxAmount,
            },
          ]
        : [];

      return {
        ...entry,
        componentTaxes,
        taxAmount,
      };
    });
  return entries === undefined ? assignToEntries : assignToEntries(entries);
}

/**
 * Re-derives the per-component taxes of a saved document's taxed lines, so the
 * tax footer previews them before any line is edited.
 * @param {boolean} isInclusiveTax
 */
export const assignSavedEntriesComponentTaxes =
  <T extends TaxableEntry>(isInclusiveTax: boolean | undefined) =>
  (entries: T[]): T[] =>
    entries.map((entry) =>
      entry.taxRateId
        ? assignEntriesTaxAmount(isInclusiveTax, [entry])[0]
        : entry,
    );

/**
 * Compose rows when edit a table cell.
 * @returns {Function}
 */
export const useComposeRowsOnEditTableCell = () => {
  const {
    taxRates,
    documentTaxRates,
    isInclusiveTax,
    localValue,
    defaultEntry,
  } = useItemEntriesTableContext();

  return useCallback(
    (rowIndex: number, columnId: string, value: unknown): ItemEntry[] => {
      return FF.pipe(
        localValue,
        updateTableCell(rowIndex, columnId, value),
        updateItemsEntriesTotal,
        updateAutoAddNewLine(defaultEntry, ['itemId']),
        orderingLinesIndexes,
        assignEntriesTaxRate(taxRates, documentTaxRates),
        assignEntriesTaxAmount(isInclusiveTax),
      ) as unknown as ItemEntry[];
    },
    [taxRates, documentTaxRates, isInclusiveTax, localValue, defaultEntry],
  );
};

/**
 * Compose rows when remove a table row.
 * @returns {Function}
 */
export const useComposeRowsOnRemoveTableRow = () => {
  const { minLinesNumber, defaultEntry, localValue } =
    useItemEntriesTableContext();

  return useCallback(
    (rowIndex: number): ItemEntry[] => {
      return FF.pipe(
        localValue, // Remove the line by the given index.
        updateRemoveLineByIndex(rowIndex), // Ensure minimum lines count.
        updateMinEntriesLines(minLinesNumber, defaultEntry),
      );
    },
    [minLinesNumber, defaultEntry, localValue],
  );
};

export interface AggregatedItemEntryTaxRate {
  taxRateId: string;
  taxRate: number;
  label: string;
  taxAmount: number;
  taxAmountFormatted: string;
}

/**
 * Retrieves the aggregate tax rates from the given item entries.
 * @param {string} currencyCode -
 * @param {any} taxRates -
 * @param {any} entries -
 */
export const aggregateItemEntriesTaxRates =
  (currencyCode: string, taxRates?: TaxRate[]) =>
  (
    entries: Array<{
      taxRateId?: string | number;
      componentTaxes?: TaxComponentAmount[];
    }>,
  ): AggregatedItemEntryTaxRate[] => {
    const taxRatesById = keyBy(taxRates, 'id');

    // One row per component; a group never shows as a row of its own.
    const aggregated = aggregateComponentTaxes(
      entries.map((e) => e.componentTaxes ?? []),
    );
    return aggregated.map((component) => {
      const rate = Number(component.rate);

      return {
        taxRateId: String(component.taxRateId),
        taxRate: rate,
        label: `${taxRatesById[component.taxRateId]?.name ?? ''} [${rate}%]`,
        taxAmount: component.amount,
        taxAmountFormatted: formattedAmount(component.amount, currencyCode),
      };
    });
  };
