import {
  Alert,
  Button,
  Classes,
  Intent,
  Position,
  Spinner,
} from '@blueprintjs/core';
import { Form, Formik, useFormikContext } from 'formik';
import * as FF from 'fp-ts/function';
import moment from 'moment';
import React, { useMemo, useState } from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import { BankReconciliationNotices } from '../components/BankReconciliationNotices';
import { formatSignedAmount, useBankReconciliationDateFormat } from '../format';
import { getBankReconciliationErrorMessage } from '../ReconcilePage/utils';
import { getBankReconciliationStartSchema } from './BankReconciliationStartForm.schema';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import {
  AppToaster,
  FDateInput,
  FFormGroup,
  FMoneyInputGroup,
  Icon,
} from '@/components';
import { DialogsName } from '@/constants/dialogs';
import { DRAWERS } from '@/constants/drawers';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useDateInputFormatter } from '@/hooks';
import {
  useBankReconciliationSummary,
  useDiscardBankReconciliationDraft,
} from '@/hooks/query/banking';
import { useDrawerActions } from '@/hooks/state';

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
  onNavigate,
}: {
  accountId: number;
  currencyCode?: string;
  onNavigate: () => void;
}) {
  const { values } = useFormikContext<StartFormValues>();
  const date = moment(values.statementDate, 'YYYY-MM-DD', true).isValid()
    ? values.statementDate
    : undefined;

  const { data } = useBankReconciliationSummary(accountId, date);

  if (!date || !data) return null;

  const common = {
    uncategorizedCount: data.uncategorizedCount,
    accountId,
    currencyCode,
    onNavigate,
  };
  // A mismatch always comes with a last reconciliation.
  if (data.mismatch && data.lastReconciliation) {
    return (
      <BankReconciliationNotices
        {...common}
        mismatch={data.mismatch}
        beginningBalance={data.beginningBalance}
        lastEndingBalance={data.lastReconciliation.endingBalance}
      />
    );
  }
  return <BankReconciliationNotices {...common} />;
}

function BankReconciliationStartDialogContentInner({
  accountId,

  // #withDialogActions
  closeDialog,
}: StartDialogContentProps) {
  const history = useHistory();
  const { openDrawer } = useDrawerActions();
  const dateInputFormatter = useDateInputFormatter();
  const formatDate = useBankReconciliationDateFormat();
  const [isDiscardOpen, setDiscardOpen] = useState(false);
  const { mutateAsync: discardDraft, isPending: isDiscarding } =
    useDiscardBankReconciliationDraft();
  const {
    data: summary,
    isLoading,
    isError,
  } = useBankReconciliationSummary(accountId);

  const lastStatementDate = summary?.lastReconciliation?.statementDate;
  const schema = useMemo(
    () => getBankReconciliationStartSchema(lastStatementDate, formatDate),
    [lastStatementDate, formatDate],
  );

  const close = () => closeDialog(DialogsName.BankReconciliationStart);

  // Close the dialog first, then open the drawer.
  const handleViewHistory = () => {
    close();
    openDrawer(DRAWERS.BANK_RECONCILIATION_HISTORY, { accountId });
  };

  const handleResume = () => {
    history.push(`/cashflow-accounts/${accountId}/reconcile`);
    close();
  };

  // The summary refetch clears `draft`, which brings back the start form.
  const handleDiscardConfirm = () => {
    discardDraft(accountId)
      .then(() => {
        AppToaster.show({
          message: intl.get('bank_reconciliation.draft_discarded_toast'),
          intent: Intent.SUCCESS,
        });
        setDiscardOpen(false);
      })
      .catch((error) => {
        AppToaster.show({
          message: getBankReconciliationErrorMessage(error),
          intent: Intent.DANGER,
        });
        setDiscardOpen(false);
      });
  };

  const handleSubmit = (values: StartFormValues) => {
    const params = new URLSearchParams({
      statementDate: values.statementDate,
      endingBalance: String(values.endingBalance),
    });
    history.push(`/cashflow-accounts/${accountId}/reconcile?${params}`);
    close();
  };

  const cancelButton = <Button onClick={close}>{intl.get('cancel')}</Button>;

  if (isLoading) {
    return (
      <div className={Classes.DIALOG_BODY}>
        <Spinner size={30} />
      </div>
    );
  }
  if (isError || !summary) {
    return (
      <>
        <div className={Classes.DIALOG_BODY}>
          {intl.get('bank_reconciliation.summary_load_failed')}
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>{cancelButton}</div>
        </div>
      </>
    );
  }
  const currencyCode = summary.account?.currencyCode;
  const fmt = (amount: number) => formatSignedAmount(amount, currencyCode);

  const summaryLines = (
    <div style={{ marginBottom: 12 }}>
      <div>
        {intl.get('bank_reconciliation.beginning_balance')}:{' '}
        <strong>{fmt(summary.beginningBalance)}</strong>
      </div>
      {summary.lastReconciliation && (
        <div className={Classes.TEXT_MUTED}>
          {formatDate(summary.lastReconciliation.statementDate)}
          {' · '}
          {fmt(summary.lastReconciliation.endingBalance)}
          {' · '}
          <Button
            minimal
            small
            intent={Intent.PRIMARY}
            onClick={handleViewHistory}
          >
            {intl.get('bank_reconciliation.history')}
          </Button>
        </div>
      )}
    </div>
  );

  // A draft exists: offer to resume or discard it instead of the form.
  if (summary.draft) {
    const draftDate = formatDate(summary.draft.statementDate);
    return (
      <>
        <div className={Classes.DIALOG_BODY}>
          {summaryLines}
          <p data-testid="reconcile-draft-in-progress">
            {intl.get('bank_reconciliation.draft_in_progress', {
              date: draftDate,
              balance: fmt(summary.draft.endingBalance),
            })}
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button
              intent={Intent.PRIMARY}
              disabled={isDiscarding}
              onClick={handleResume}
            >
              {intl.get('bank_reconciliation.resume')}
            </Button>
            <Button
              intent={Intent.DANGER}
              minimal
              data-testid="reconcile-discard-draft"
              loading={isDiscarding}
              disabled={isDiscarding}
              onClick={() => setDiscardOpen(true)}
            >
              {intl.get('bank_reconciliation.discard_draft')}
            </Button>
            {cancelButton}
          </div>
        </div>
        <Alert
          isOpen={isDiscardOpen}
          intent={Intent.DANGER}
          cancelButtonText={intl.get('cancel')}
          confirmButtonText={intl.get('bank_reconciliation.discard_draft')}
          loading={isDiscarding}
          onCancel={() => setDiscardOpen(false)}
          onConfirm={handleDiscardConfirm}
        >
          <p>
            {intl.get('bank_reconciliation.discard_draft_confirm', {
              date: draftDate,
            })}
          </p>
        </Alert>
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

          <StartFormNotices
            accountId={accountId}
            currencyCode={currencyCode}
            onNavigate={close}
          />
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button type="submit" intent={Intent.PRIMARY}>
              {intl.get('bank_reconciliation.reconcile')}
            </Button>
            {cancelButton}
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
