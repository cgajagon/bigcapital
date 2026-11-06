import { Button, Classes, Intent, Position } from '@blueprintjs/core';
import { Form, Formik } from 'formik';
import * as FF from 'fp-ts/function';
import React, { useMemo } from 'react';
import intl from 'react-intl-universal';
import { useBankReconciliationDateFormat } from '../format';
import { getBankReconciliationStartSchema } from '../StartDialog/BankReconciliationStartForm.schema';
import { useBankReconciliationContext } from './BankReconciliationProvider';
import type { DialogBaseProps } from '@/components/DialogReduxConnect';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import {
  Dialog,
  FDateInput,
  FFormGroup,
  FMoneyInputGroup,
  Icon,
} from '@/components';
import withDialogRedux from '@/components/DialogReduxConnect';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useDateInputFormatter } from '@/hooks';

interface EditInfoValues {
  statementDate: string;
  endingBalance: string | number;
}

interface EditInfoDialogProps
  extends DialogBaseProps,
    Pick<WithDialogActionsProps, 'closeDialog'> {
  dialogName: string;
}

/**
 * Changes the statement date and ending balance. Must render under the
 * page provider. A new date refetches the transactions (ticks are kept).
 */
function BankReconciliationEditInfoDialogRoot({
  dialogName,
  isOpen,
  closeDialog,
}: EditInfoDialogProps) {
  const { statementDate, endingBalance, lastStatementDate, setStatementInfo } =
    useBankReconciliationContext();
  const dateInputFormatter = useDateInputFormatter();
  const formatDate = useBankReconciliationDateFormat();
  const schema = useMemo(
    () => getBankReconciliationStartSchema(lastStatementDate, formatDate),
    [lastStatementDate, formatDate],
  );

  const close = () => closeDialog(dialogName);

  const handleSubmit = (values: EditInfoValues) => {
    setStatementInfo({
      statementDate: values.statementDate,
      endingBalance: Number(values.endingBalance),
    });
    close();
  };

  return (
    <Dialog
      name={dialogName}
      title={intl.get('bank_reconciliation.edit_info')}
      isOpen={isOpen}
      autoFocus={true}
      canEscapeKeyClose={true}
      style={{ width: 400 }}
    >
      <Formik
        enableReinitialize
        onSubmit={handleSubmit}
        validationSchema={schema}
        initialValues={{ statementDate, endingBalance }}
      >
        <Form>
          <div className={Classes.DIALOG_BODY}>
            <FFormGroup
              name={'statementDate'}
              label={intl.get('bank_reconciliation.statement_ending_date')}
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
            >
              <FMoneyInputGroup name={'endingBalance'} minimal={true} />
            </FFormGroup>
          </div>
          <div className={Classes.DIALOG_FOOTER}>
            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
              <Button type="submit" intent={Intent.PRIMARY}>
                {intl.get('save')}
              </Button>
              <Button onClick={close}>{intl.get('cancel')}</Button>
            </div>
          </div>
        </Form>
      </Formik>
    </Dialog>
  );
}

export const BankReconciliationEditInfoDialog = FF.pipe(
  BankReconciliationEditInfoDialogRoot,
  withDialogActions,
  withDialogRedux(),
);
