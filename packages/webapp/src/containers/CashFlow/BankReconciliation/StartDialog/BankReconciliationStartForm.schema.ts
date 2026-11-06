import moment from 'moment';
import intl from 'react-intl-universal';
import * as Yup from 'yup';

/**
 * Builds the start form schema. The statement date must be after the last
 * completed reconciliation's statement date, when there is one.
 */
export const getBankReconciliationStartSchema = (
  lastStatementDate?: string | null,
) =>
  Yup.object().shape({
    statementDate: Yup.string()
      .required()
      .label(intl.get('bank_reconciliation.statement_ending_date'))
      .test(
        'after-last-reconciliation',
        () =>
          intl.get('bank_reconciliation.statement_date_not_after_last', {
            date: moment(lastStatementDate, 'YYYY-MM-DD').format('YYYY MMM DD'),
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
      // The server accepts at most 2 decimal places.
      .test(
        'max-two-decimals',
        () => intl.get('bank_reconciliation.ending_balance_invalid'),
        (_value, context) =>
          // `originalValue` is what the user typed, before the number cast.
          !/^-?\d*\.\d{3,}$/.test(String(context.originalValue ?? '').trim()),
      )
      .label(intl.get('bank_reconciliation.statement_ending_balance')),
  });
