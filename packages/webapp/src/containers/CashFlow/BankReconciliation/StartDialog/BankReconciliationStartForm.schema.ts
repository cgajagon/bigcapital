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
        ({ label }) => `${label} must be after ${lastStatementDate}`,
        (value) =>
          !value ||
          !lastStatementDate ||
          moment(value, 'YYYY-MM-DD').isAfter(
            moment(lastStatementDate, 'YYYY-MM-DD'),
            'day',
          ),
      ),
    endingBalance: Yup.number()
      .typeError(({ label }) => `${label} must be a number`)
      .required()
      .label(intl.get('bank_reconciliation.statement_ending_balance')),
  });
