import moment from 'moment';
import intl from 'react-intl-universal';
import * as Yup from 'yup';

/**
 * Builds the start form schema. The statement date must be after the last
 * completed reconciliation's statement date, when there is one.
 * `formatDate` renders that date in the message (the organization's format).
 */
export const getBankReconciliationStartSchema = (
  lastStatementDate: string | null | undefined,
  formatDate: (date: string) => string,
) =>
  Yup.object().shape({
    statementDate: Yup.string()
      .required()
      .label(intl.get('bank_reconciliation.statement_ending_date'))
      .test(
        'after-last-reconciliation',
        () =>
          intl.get('bank_reconciliation.statement_date_not_after_last', {
            date: lastStatementDate ? formatDate(lastStatementDate) : '',
          }),
        (value) =>
          !value ||
          !lastStatementDate ||
          moment(value, 'YYYY-MM-DD').isAfter(
            moment(lastStatementDate, 'YYYY-MM-DD'),
            'day',
          ),
      ),
    endingBalance: Yup.number()
      .transform((value, original) => (original === '' ? undefined : value))
      .typeError(() => intl.get('bank_reconciliation.ending_balance_invalid'))
      .required()
      // The server accepts at most 2 decimal places. Yup 0.28 gives tests the
      // cast number only (no `originalValue`), so check the cents numerically.
      .test(
        'max-two-decimals',
        () => intl.get('bank_reconciliation.ending_balance_invalid'),
        (value) =>
          value === undefined ||
          value === null ||
          Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      )
      .label(intl.get('bank_reconciliation.statement_ending_balance')),
  });
