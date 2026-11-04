import * as moment from 'moment';
import { Knex } from 'knex';
import { uniq } from 'lodash';
import { BillPaymentAccrualGL } from './BillPaymentAccrualGL';
import { BillPaymentCashGL } from './BillPaymentCashGL';
import { Inject, Injectable } from '@nestjs/common';
import { LedgerStorageService } from '@/modules/Ledger/LedgerStorage.service';
import { Ledger } from '@/modules/Ledger/Ledger';
import { Account } from '@/modules/Accounts/models/Account.model';
import { BillPayment } from '../models/BillPayment';
import { BillPaymentEntry } from '../models/BillPaymentEntry';
import { AccountRepository } from '@/modules/Accounts/repositories/Account.repository';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';

@Injectable()
export class BillPaymentGLEntries {
  constructor(
    private readonly ledgerStorage: LedgerStorageService,
    private readonly accountRepository: AccountRepository,
    private readonly tenancyContext: TenancyContext,

    @Inject(BillPayment.name)
    private readonly billPaymentModel: TenantModelProxy<typeof BillPayment>,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(BillPaymentEntry.name)
    private readonly billPaymentEntryModel: TenantModelProxy<
      typeof BillPaymentEntry
    >,
  ) {}

  /**
   * Creates a bill payment GL entries.
   * @param {number} billPaymentId - Bill payment id.
   * @param {Knex.Transaction} trx - Knex transaction.
   */
  public writePaymentGLEntries = async (
    billPaymentId: number,
    trx?: Knex.Transaction,
  ): Promise<void> => {
    // Retrieves the bill payment details with associated entries.
    const payment = await this.billPaymentModel()
      .query(trx)
      .findById(billPaymentId)
      .withGraphFetched('entries.bill.entries.item');

    // Retrieves the given tenant metadata.
    const tenantMeta = await this.tenancyContext.getTenantMetadata();

    // Retrieves the bill payment ledger.
    const ledger = await this.getBillPaymentGLedger(
      payment,
      tenantMeta.baseCurrency,
      trx,
    );
    // Commits the ledger on the storage.
    await this.ledgerStorage.commit(ledger, trx);
  };

  /**
   * Rewrites the bill payment GL entries.
   * @param {number} tenantId
   * @param {number} billPaymentId
   * @param {Knex.Transaction} trx
   */
  public rewritePaymentGLEntries = async (
    billPaymentId: number,
    trx?: Knex.Transaction,
  ): Promise<void> => {
    // Revert payment GL entries.
    await this.revertPaymentGLEntries(billPaymentId, trx);

    // Write payment GL entries.
    await this.writePaymentGLEntries(billPaymentId, trx);
  };

  /**
   * Reverts the bill payment GL entries.
   * @param {number} tenantId
   * @param {number} billPaymentId
   * @param {Knex.Transaction} trx
   */
  public revertPaymentGLEntries = async (
    billPaymentId: number,
    trx?: Knex.Transaction,
  ): Promise<void> => {
    await this.ledgerStorage.deleteByReference(
      billPaymentId,
      'BillPayment',
      trx,
    );
  };

  /**
   * Retrieves the amount of each bill of the given payment that was paid
   * before it, in the bill currency: the sum of the other payments' entries
   * on the bill dated earlier, or on the same date with a lower id. The order
   * is fixed, so rewriting any payment's journal gives the same amounts.
   * @param {BillPayment} billPayment - Bill payment, with entries.
   * @param {Knex.Transaction} trx - Knex transaction.
   * @returns {Promise<Record<number, number>>} Paid amount by bill id.
   */
  public getBillsPaidBefore = async (
    billPayment: BillPayment,
    trx?: Knex.Transaction,
  ): Promise<Record<number, number>> => {
    const billsIds = uniq(
      (billPayment.entries || []).map((entry) => entry.billId),
    );
    if (billsIds.length === 0) {
      return {};
    }
    const paymentDate = moment(billPayment.paymentDate).format('YYYY-MM-DD');

    const paidEntries = await this.billPaymentEntryModel()
      .query(trx)
      .joinRelated('payment')
      .whereIn('bills_payments_entries.billId', billsIds)
      .whereNot('payment.id', billPayment.id)
      .where((query) =>
        query
          .where('payment.paymentDate', '<', paymentDate)
          .orWhere((sameDateQuery) =>
            sameDateQuery
              .where('payment.paymentDate', paymentDate)
              .where('payment.id', '<', billPayment.id),
          ),
      )
      .groupBy('bills_payments_entries.billId')
      .select('bills_payments_entries.billId')
      .sum('bills_payments_entries.paymentAmount as paymentAmount');

    return Object.fromEntries(
      paidEntries.map((entry) => [entry.billId, Number(entry.paymentAmount)]),
    );
  };

  /**
   * Retrieves the bill payment general ledger.
   * The ledger contains both the accrual basis entries (payment/A/P)
   * and the cash basis entries (payment/expenses) flagged by the basis.
   * @param {BillPayment} billPayment - Bill payment.
   * @param {string} baseCurrency - Base currency code.
   * @param {Knex.Transaction} trx - Knex transaction.
   * @returns {Ledger}
   */
  public getBillPaymentGLedger = async (
    billPayment: BillPayment,
    baseCurrency: string,
    trx?: Knex.Transaction,
  ): Promise<Ledger> => {
    // Finds or creates a new A/P account of the given currency.
    const APAccount = await this.accountRepository.findOrCreateAccountsPayable(
      billPayment.currencyCode,
      {},
      trx,
    );
    // Exchange gain or loss account.
    const EXGainLossAccount = await this.accountModel()
      .query(trx)
      .modify('findBySlug', 'exchange-grain-loss')
      .first();

    const billPaymentAccrualGL = new BillPaymentAccrualGL(billPayment)
      .setAPAccountId(APAccount.id)
      .setGainLossAccountId(EXGainLossAccount.id)
      .setBaseCurrency(baseCurrency);

    // Accrual basis ledger entries.
    const accrualLedger = billPaymentAccrualGL.getBillPaymentLedger();

    // Find or create tax payable account.
    const taxPayableAccount =
      await this.accountRepository.findOrCreateTaxPayable({}, trx);
    // Find or create purchase discount account.
    const purchaseDiscountAccount =
      await this.accountRepository.findOrCreatePurchaseDiscountAccount({}, trx);
    // Find or create other expenses account.
    const otherExpensesAccount =
      await this.accountRepository.findOrCreateOtherExpensesAccount({}, trx);

    // The amount of each bill paid by earlier payments.
    const paidBeforeByBillId = await this.getBillsPaidBefore(billPayment, trx);

    const billPaymentCashGL = new BillPaymentCashGL(
      billPayment,
      paidBeforeByBillId,
    )
      .setTaxPayableAccountId(taxPayableAccount.id)
      .setPurchaseDiscountAccountId(purchaseDiscountAccount.id)
      .setOtherExpensesAccountId(otherExpensesAccount.id);

    // Cash basis ledger entries.
    const cashLedger = billPaymentCashGL.getLedger();

    return new Ledger([
      ...accrualLedger.getEntries(),
      ...cashLedger.getEntries(),
    ]);
  };
}
