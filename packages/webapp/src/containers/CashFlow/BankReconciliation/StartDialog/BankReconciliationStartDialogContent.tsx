import { Button, Classes, Intent, Position } from '@blueprintjs/core';
import { Form, Formik, useFormikContext } from 'formik';
import * as FF from 'fp-ts/function';
import moment from 'moment';
import React, { useMemo } from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import { BankReconciliationNotices } from '../components/BankReconciliationNotices';
import { getBankReconciliationStartSchema } from './BankReconciliationStartForm.schema';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import {
  FDateInput,
  FFormGroup,
  FMoneyInputGroup,
  Icon,
  Money,
} from '@/components';
import { DialogsName } from '@/constants/dialogs';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useDateInputFormatter } from '@/hooks';
import { useBankReconciliationSummary } from '@/hooks/query/banking';

interface StartFormValues {
  statementDate: string;
  endingBalance: string | number;
}

const initialValues: StartFormValues = {
  statementDate: '',
  endingBalance: '',
};

interface StartDialogContentProps
  extends Pick<WithDialogActionsProps, 'closeDialog'> {
  accountId: number;
  dialogName?: string;
}

/**
 * Notices that depend on the picked statement date.
 */
function StartFormNotices({
  accountId,
  currencyCode,
}: {
  accountId: number;
  currencyCode?: string;
}) {
  const { values } = useFormikContext<StartFormValues>();
  const date = moment(values.statementDate, 'YYYY-MM-DD', true).isValid()
    ? values.statementDate
    : undefined;

  const { data } = useBankReconciliationSummary(accountId, date);

  if (!date || !data) return null;

  return (
    <BankReconciliationNotices
      mismatch={data.mismatch}
      uncategorizedCount={data.uncategorizedCount}
      accountId={accountId}
      beginningBalance={data.beginningBalance}
      lastEndingBalance={data.lastReconciliation?.endingBalance}
      currencyCode={currencyCode}
    />
  );
}

function BankReconciliationStartDialogContentInner({
  accountId,

  // #withDialogActions
  closeDialog,
}: StartDialogContentProps) {
  const history = useHistory();
  const dateInputFormatter = useDateInputFormatter();
  const { data: summary, isLoading } = useBankReconciliationSummary(accountId);

  const lastStatementDate = summary?.lastReconciliation?.statementDate;
  const schema = useMemo(
    () => getBankReconciliationStartSchema(lastStatementDate),
    [lastStatementDate],
  );

  const close = () => closeDialog(DialogsName.BankReconciliationStart);

  const handleResume = () => {
    history.push(`/cashflow-accounts/${accountId}/reconcile`);
    close();
  };

  const handleSubmit = (values: StartFormValues) => {
    const params = new URLSearchParams({
      statementDate: values.statementDate,
      endingBalance: String(values.endingBalance),
    });
    history.push(`/cashflow-accounts/${accountId}/reconcile?${params}`);
    close();
  };

  if (isLoading || !summary) {
    return <div className={Classes.DIALOG_BODY} />;
  }
  const currencyCode = summary.account?.currencyCode;

  const summaryLines = (
    <div style={{ marginBottom: 12 }}>
      <div>
        {intl.get('bank_reconciliation.beginning_balance')}:{' '}
        <strong>
          <Money amount={summary.beginningBalance} currency={currencyCode} />
        </strong>
      </div>
      {summary.lastReconciliation && (
        <div className={Classes.TEXT_MUTED}>
          {summary.lastReconciliation.statementDate}
          {' · '}
          <Money
            amount={summary.lastReconciliation.endingBalance}
            currency={currencyCode}
          />
        </div>
      )}
    </div>
  );

  // A draft exists: offer to resume it instead of the form.
  if (summary.draft) {
    return (
      <>
        <div className={Classes.DIALOG_BODY}>
          {summaryLines}
          <div>
            {summary.draft.statementDate}
            {' · '}
            <Money
              amount={summary.draft.endingBalance}
              currency={currencyCode}
            />
          </div>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button intent={Intent.PRIMARY} onClick={handleResume}>
              {intl.get('bank_reconciliation.resume')}
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <Formik
      onSubmit={handleSubmit}
      validationSchema={schema}
      initialValues={initialValues}
    >
      <Form>
        <div className={Classes.DIALOG_BODY}>
          {summaryLines}

          <FFormGroup
            name={'statementDate'}
            label={intl.get('bank_reconciliation.statement_ending_date')}
            fastField
          >
            <FDateInput
              name={'statementDate'}
              popoverProps={{ position: Position.BOTTOM, minimal: true }}
              {...dateInputFormatter}
              inputProps={{
                fill: true,
                leftElement: <Icon icon={'date-range'} />,
              }}
            />
          </FFormGroup>

          <FFormGroup
            name={'endingBalance'}
            label={intl.get('bank_reconciliation.statement_ending_balance')}
            fastField
          >
            <FMoneyInputGroup name={'endingBalance'} minimal={true} fastField />
          </FFormGroup>

          <StartFormNotices accountId={accountId} currencyCode={currencyCode} />
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button type="submit" intent={Intent.PRIMARY}>
              {intl.get('bank_reconciliation.reconcile')}
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </div>
      </Form>
    </Formik>
  );
}

export const BankReconciliationStartDialogContent = FF.pipe(
  BankReconciliationStartDialogContentInner,
  withDialogActions,
);
