import { flow } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import { isEmpty, sumBy } from 'lodash';
import {
  SalesTaxLiabilitySummaryQuery,
  SalesTaxLiabilitySummaryRate,
  SalesTaxLiabilitySummaryReportData,
  SalesTaxLiabilitySummaryTotal,
} from './SalesTaxLiability.types';
import { FinancialSheet } from '../../common/FinancialSheet';
import { ModelObject } from 'objection';
import { TaxRateModel } from '@/modules/TaxRates/models/TaxRate.model';
import { SalesTaxLiabilitySummaryRepository } from './SalesTaxLiabilitySummaryRepository';
import {
  IFinancialReportMeta,
  DEFAULT_REPORT_META,
} from '../../types/Report.types';

export class SalesTaxLiabilitySummary extends FinancialSheet {
  private query: SalesTaxLiabilitySummaryQuery;
  private repository: SalesTaxLiabilitySummaryRepository;

  /**
   * Sales tax liability summary constructor.
   * @param {SalesTaxLiabilitySummaryQuery} query
   * @param {SalesTaxLiabilitySummaryRepository} repository
   * @param {IFinancialReportMeta} meta
   */
  constructor(
    query: SalesTaxLiabilitySummaryQuery,
    repository: SalesTaxLiabilitySummaryRepository,
    meta: IFinancialReportMeta,
  ) {
    super();

    this.query = query;
    this.repository = repository;
    this.baseCurrency = meta.baseCurrency;
    this.dateFormat = meta.dateFormat || DEFAULT_REPORT_META.dateFormat;
    this.numberFormat = {
      ...this.numberFormat,
      ...this.query.numberFormat,
    };
  }

  /**
   * Retrieves the taxable sales of a rate: its own sales plus the sales of
   * every tax group containing it (group lines are tagged with the group id).
   * @param {number} taxRateId
   * @returns {number}
   */
  private taxableSalesAmount = (taxRateId: number): number => {
    const groups = this.repository.taxGroupComponentIds ?? {};
    const groupIds = Object.keys(groups)
      .map(Number)
      .filter((groupId) => groups[groupId].includes(taxRateId));

    return [taxRateId, ...groupIds].reduce((sum, id) => {
      const sales = this.repository.accountTransactionsByTaxRateId[id];
      return sum + (sales ? sales.credit - sales.debit : 0);
    }, 0);
  };

  /**
   * Retrieves the tax rate liability node.
   * @param {ITaxRate} taxRate
   * @returns {SalesTaxLiabilitySummaryRate}
   */
  private taxRateLiability = (
    taxRate: ModelObject<TaxRateModel>,
  ): SalesTaxLiabilitySummaryRate => {
    const payableTax = this.repository.taxesPayableByTaxRateId[taxRate.id];
    const salesPayable =
      this.repository.salesTaxesPayableByTaxRateId[taxRate.id];
    const purchasePayable =
      this.repository.purchaseTaxesPayableByTaxRateId[taxRate.id];

    const payableTaxAmount = payableTax
      ? payableTax.credit - payableTax.debit
      : 0;
    const salesTaxAmount = this.taxableSalesAmount(taxRate.id);

    // Calculates the tax percentage.
    const taxPercentage = this.getPercentageBasis(
      salesTaxAmount,
      payableTaxAmount,
    );

    // Tax of the sales documents, net of reductions.
    const taxOnSalesAmount = salesPayable
      ? salesPayable.credit - salesPayable.debit
      : 0;
    // Tax of the purchase documents, net of reductions.
    const collectedTaxAmount = purchasePayable
      ? purchasePayable.debit - purchasePayable.credit
      : 0;

    return {
      id: taxRate.id,
      taxName: `${taxRate.name} (${taxRate.rate}%)`,
      taxableAmount: this.getAmountMeta(salesTaxAmount),
      taxOnSalesAmount: this.getAmountMeta(taxOnSalesAmount),
      taxAmount: this.getAmountMeta(payableTaxAmount),
      taxPercentage: this.getPercentageTotalAmountMeta(taxPercentage),
      collectedTaxAmount: this.getAmountMeta(collectedTaxAmount),
    };
  };

  /**
   * Filters the non-transactions tax rates.
   * @param {SalesTaxLiabilitySummaryRate[]} nodes
   * @returns {SalesTaxLiabilitySummaryRate[]}
   */
  private filterNonTransactionsTaxRates = (
    nodes: SalesTaxLiabilitySummaryRate[],
  ): SalesTaxLiabilitySummaryRate[] => {
    return nodes.filter((node) => {
      const salesTrxs = this.repository.accountTransactionsByTaxRateId[node.id];
      const payableTrxs = this.repository.taxesPayableByTaxRateId[node.id];

      // Sales may reach the rate only through a group containing it.
      return (
        !isEmpty(salesTrxs) ||
        !isEmpty(payableTrxs) ||
        node.taxableAmount.amount !== 0
      );
    });
  };

  /**
   * Retrieves the tax rates liability nodes.
   * @returns {SalesTaxLiabilitySummaryRate[]}
   */
  private taxRatesLiability = (): SalesTaxLiabilitySummaryRate[] => {
    return flow(
      A.map(this.taxRateLiability),
      this.filterNonTransactionsTaxRates,
    )(this.repository.taxRates);
  };

  /**
   * Retrieves the tax rates total node. The total "Taxable" sums each tax's
   * taxable base, so a group's sales count once per component; the tax totals
   * are exact.
   * @param {SalesTaxLiabilitySummaryRate[]} nodes
   * @returns {SalesTaxLiabilitySummaryTotal}
   */
  private taxRatesTotal = (
    nodes: SalesTaxLiabilitySummaryRate[],
  ): SalesTaxLiabilitySummaryTotal => {
    const taxableAmount = sumBy(nodes, 'taxableAmount.amount');
    const taxOnSalesAmount = sumBy(nodes, 'taxOnSalesAmount.amount');
    const taxAmount = sumBy(nodes, 'taxAmount.amount');
    const collectedTaxAmount = sumBy(nodes, 'collectedTaxAmount.amount');

    return {
      taxableAmount: this.getTotalAmountMeta(taxableAmount),
      taxOnSalesAmount: this.getTotalAmountMeta(taxOnSalesAmount),
      taxAmount: this.getTotalAmountMeta(taxAmount),
      collectedTaxAmount: this.getTotalAmountMeta(collectedTaxAmount),
    };
  };

  /**
   * Retrieves the report data.
   * @returns {SalesTaxLiabilitySummaryReportData}
   */
  public reportData = (): SalesTaxLiabilitySummaryReportData => {
    const taxRates = this.taxRatesLiability();
    const total = this.taxRatesTotal(taxRates);

    return { taxRates, total };
  };
}
