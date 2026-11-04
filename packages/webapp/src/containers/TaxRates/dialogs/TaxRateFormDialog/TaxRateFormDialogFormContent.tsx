import { Button, InputGroup, Tag, Text } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { ChangeEvent, useMemo } from 'react';
import styled from 'styled-components';
import { useTaxRateFormDialogContext } from './TaxRateFormDialogBoot';
import {
  sumComponentRates,
  TaxRateFormValues,
  transformTaxRateCodeValue,
  useIsTaxRateChanged,
} from './utils';
import {
  AccountsSelect,
  FCheckbox,
  FFormGroup,
  FInputGroup,
  FMultiSelect,
  FSwitch,
  Hint,
} from '@/components';
import { ACCOUNT_TYPE } from '@/constants/accountTypes';
import { useAccounts } from '@/hooks/query/accounts';
import { useTaxRates } from '@/hooks/query/tax-rates';

const LOCKED_HELPER_TEXT =
  "Can't be changed: this tax is already used by transactions or items.";

/**
 * Tax rate form content.
 * @returns {JSX.Element}
 */
export function TaxRateFormDialogContent() {
  return (
    <div>
      <FFormGroup
        name={'name'}
        label={'Name'}
        labelInfo={<Tag minimal>Required</Tag>}
        subLabel={
          'The name as you would like it to appear in customers invoices.'
        }
        fastField={true}
      >
        <FInputGroup name={'name'} fastField={true} />
      </FFormGroup>

      <TaxRateCodeField />
      <TaxGroupField />
      <TaxRateTypeFields />

      <FFormGroup
        name={'description'}
        label={'Description'}
        labelInfo={
          <Hint content="This description is for internal use only and will not be visiable to your customers." />
        }
        fastField={true}
      >
        <FInputGroup name={'description'} fastField={true} />
      </FFormGroup>

      <CompoundFormGroup name={'isCompound'} fastField={true}>
        <FCheckbox label={'Is compound'} name={'isCompound'} fastField={true} />
      </CompoundFormGroup>

      <CompoundFormGroup name={'isNonRecoverable'} fastField={true}>
        <FCheckbox
          label={'Is non recoverable'}
          name={'isNonRecoverable'}
          fastField={true}
        />
      </CompoundFormGroup>

      <ConfirmEditingTaxRate />
    </div>
  );
}

/**
 * Tax group switch: editable on creation, read-only text on edit since a rate
 * never changes between a plain rate and a group.
 * @returns {JSX.Element}
 */
function TaxGroupField() {
  const { isNewMode } = useTaxRateFormDialogContext();
  const { values } = useFormikContext<TaxRateFormValues>();

  // The fields below depend on the switch, so these groups are not fastField.
  return (
    <FFormGroup
      name={'isGroup'}
      label={'Type'}
      subLabel={
        isNewMode
          ? 'A tax group combines several tax rates, e.g. GST + QST, into one.'
          : undefined
      }
    >
      {isNewMode ? (
        <FSwitch name={'isGroup'} label={'Tax group'} />
      ) : (
        <Text>{values.isGroup ? 'Tax group' : 'Tax rate'}</Text>
      )}
    </FFormGroup>
  );
}

/**
 * Fields depending on the type: components and total rate for a group, rate
 * and payable account for a plain rate.
 * @returns {JSX.Element}
 */
function TaxRateTypeFields() {
  const { values } = useFormikContext<TaxRateFormValues>();

  if (values.isGroup) {
    return (
      <>
        <TaxGroupComponentsField />
        <TaxGroupRateField />
      </>
    );
  }
  return (
    <>
      <FFormGroup
        name={'rate'}
        label={'Rate (%)'}
        labelInfo={<Tag minimal>Required</Tag>}
        fastField={true}
      >
        <RateFormGroup
          name={'rate'}
          rightElement={<Tag minimal>%</Tag>}
          fill={false}
          fastField={true}
        />
      </FFormGroup>
      <TaxPayableAccountField />
    </>
  );
}

/**
 * Active, non-group rates a group can be made of, plus the group's current
 * components so a component made inactive since stays visible while editing.
 */
function useComponentRates() {
  const { taxRate } = useTaxRateFormDialogContext();
  const { data: taxRates } = useTaxRates();

  return useMemo(() => {
    const all = new Map<
      number,
      { id: number; name: string; code: string; rate: number }
    >();
    (taxRates ?? [])
      .filter((r) => Boolean(r.active) && !r.isGroup && r.id !== taxRate?.id)
      .forEach((r) => all.set(r.id, r));
    (taxRate?.components ?? []).forEach((c) => all.set(c.id, c));

    return Array.from(all.values());
  }, [taxRates, taxRate]);
}

/**
 * Components multi-select of a group, keeps the order the user picked them.
 */
function TaxGroupComponentsField() {
  const { taxRate } = useTaxRateFormDialogContext();
  const rates = useComponentRates();
  const isLocked = Boolean(taxRate?.isUsed);

  const items = useMemo(
    () =>
      rates.map((r) => ({
        id: r.id,
        text: r.name,
        label: `${r.code} (${Number(r.rate)}%)`,
      })),
    [rates],
  );

  return (
    <FFormGroup
      name={'componentIds'}
      label={'Components'}
      labelInfo={<Tag minimal>Required</Tag>}
      subLabel={
        isLocked
          ? LOCKED_HELPER_TEXT
          : 'Choose at least two active tax rates. They are applied in the order selected.'
      }
    >
      <FMultiSelect
        name={'componentIds'}
        items={items}
        valueAccessor={'id'}
        textAccessor={'text'}
        labelAccessor={'label'}
        tagAccessor={'text'}
        placeholder={'Select tax rates ...'}
        popoverProps={{ minimal: true, disabled: isLocked }}
        tagInputProps={{ disabled: isLocked, tagProps: { minimal: true } }}
        fill={true}
      />
    </FFormGroup>
  );
}

/**
 * Read-only total rate of a group: the sum of its components' rates.
 */
function TaxGroupRateField() {
  const { values } = useFormikContext<TaxRateFormValues>();
  const rates = useComponentRates();
  const total = sumComponentRates(values.componentIds, rates);

  return (
    <FFormGroup
      name={'rate'}
      label={'Rate (%)'}
      subLabel={"The sum of the components' rates."}
    >
      <RateInput
        value={String(total)}
        readOnly={true}
        rightElement={<Tag minimal>%</Tag>}
      />
    </FFormGroup>
  );
}

/**
 * Optional tax payable account of a plain rate.
 */
function TaxPayableAccountField() {
  const { taxRate } = useTaxRateFormDialogContext();
  const { values, setFieldValue } = useFormikContext<TaxRateFormValues>();
  const { data: accounts } = useAccounts();
  const isLocked = Boolean(taxRate?.isUsed);

  return (
    <FFormGroup
      name={'payableAccountId'}
      label={'Payable account'}
      subLabel={
        isLocked ? LOCKED_HELPER_TEXT : 'Leave empty to use Tax Payable.'
      }
    >
      <AccountSelectRow>
        <AccountsSelect
          name={'payableAccountId'}
          items={accounts ?? []}
          placeholder={'Tax Payable'}
          filterByTypes={[ACCOUNT_TYPE.TAX_PAYABLE]}
          disabled={isLocked}
        />
        {values.payableAccountId != null && !isLocked && (
          <Button
            minimal
            small
            icon={'cross'}
            title={'Use Tax Payable'}
            onClick={() => setFieldValue('payableAccountId', null)}
          />
        )}
      </AccountSelectRow>
    </FFormGroup>
  );
}

/**
 * Tax rate code input group
 * @returns {JSX.Element}
 */
function TaxRateCodeField() {
  const { setFieldValue } = useFormikContext<TaxRateFormValues>();

  // Handle the field change.
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const transformedValue = transformTaxRateCodeValue(event.target.value);
    setFieldValue('code', transformedValue);
  };

  return (
    <FFormGroup
      name={'code'}
      label={'Code'}
      labelInfo={<Tag minimal>Required</Tag>}
      fastField={true}
    >
      <FInputGroup name={'code'} fastField={true} onChange={handleChange} />
    </FFormGroup>
  );
}

function ConfirmEditingTaxRate() {
  const isTaxRateChanged = useIsTaxRateChanged();
  const { isNewMode } = useTaxRateFormDialogContext();

  // Can't continue if it is new mode or tax rate not changed.
  if (!isTaxRateChanged || isNewMode) return null;

  return (
    <EditWarningWrap>
      <Text color={'#766f58'}>Please Note:</Text>
      <ConfirmEditFormGroup name={'confirmEdit'} helperText={''}>
        <FCheckbox
          name={'confirmEdit'}
          label={`I understand that transactions already saved keep the rate they were saved with, and new transactions use the new rate.`}
        />
      </ConfirmEditFormGroup>
    </EditWarningWrap>
  );
}

const RateFormGroup = styled(FInputGroup)`
  max-width: 100px;
`;

const RateInput = styled(InputGroup)`
  max-width: 100px;
`;

const AccountSelectRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const CompoundFormGroup = styled(FFormGroup)`
  margin-bottom: 0;
`;

const EditWarningWrap = styled(`div`)`
  background: #fcf8ec;
  margin-left: -20px;
  margin-right: -20px;
  padding: 14px 20px;
  font-size: 13px;
  margin-top: 8px;
  border-top: 1px solid #f2eddf;
  border-bottom: 1px solid #f2eddf;
`;

const ConfirmEditFormGroup = styled(FFormGroup)`
  margin-bottom: 0;
`;
