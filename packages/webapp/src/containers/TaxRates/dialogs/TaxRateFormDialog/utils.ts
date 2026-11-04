import { useFormikContext } from 'formik';
import type { TaxRate } from '@bigcapital/sdk-ts';
import { transformToForm } from '@/utils';

export interface TaxRateFormValues {
  name: string;
  code: string;
  rate: string;
  description: string;
  isCompound: boolean;
  isNonRecoverable: boolean;
  isGroup: boolean;
  componentIds: number[];
  payableAccountId: number | null;
  confirmEdit: boolean;
}

export interface TaxRateFormRequestBody {
  name: string;
  code: string;
  rate?: number;
  description: string;
  isCompound: boolean;
  isNonRecoverable: boolean;
  active: boolean;
  isGroup: boolean;
  componentIds?: number[];
  payableAccountId?: number | null;
}

// Default initial form values.
export const defaultInitialValues: TaxRateFormValues = {
  name: '',
  code: '',
  rate: '',
  description: '',
  isCompound: false,
  isNonRecoverable: false,
  isGroup: false,
  componentIds: [],
  payableAccountId: null,
  confirmEdit: false,
};

/**
 * Transformers response errors to form errors.
 * @returns {Record<string, string>}
 */
export const transformApiErrors = (
  errors: Array<{ type?: string }>,
): Record<string, string> => {
  const fields: Record<string, string> = {};

  if (errors.find((e) => e.type === 'TAX_CODE_NOT_UNIQUE')) {
    fields.code = 'The tax rate is not unique.';
  }
  if (errors.find((e) => e.type === 'TAX_GROUP_COMPONENTS_INVALID')) {
    fields.componentIds =
      'Choose at least two different, existing tax rates as components.';
  }
  if (errors.find((e) => e.type === 'TAX_GROUP_COMPONENT_IS_GROUP')) {
    fields.componentIds = "A tax group can't contain another tax group.";
  }
  if (errors.find((e) => e.type === 'TAX_GROUP_COMPONENT_INACTIVE')) {
    fields.componentIds = 'The components must be active tax rates.';
  }
  if (errors.find((e) => e.type === 'TAX_GROUP_COMPONENTS_LOCKED')) {
    fields.componentIds =
      "The components can't be changed: this tax is already used by transactions or items.";
  }
  if (errors.find((e) => e.type === 'TAX_RATE_TYPE_LOCKED')) {
    fields.isGroup =
      "A tax rate can't be changed between a plain rate and a tax group.";
  }
  if (errors.find((e) => e.type === 'TAX_RATE_IS_GROUP_COMPONENT')) {
    fields.isGroup = 'This tax rate is a component of a tax group.';
  }
  if (errors.find((e) => e.type === 'TAX_RATE_PAYABLE_ACCOUNT_LOCKED')) {
    fields.payableAccountId =
      "The payable account can't be changed: this tax is already used by transactions or items.";
  }
  if (errors.find((e) => e.type === 'TAX_PAYABLE_ACCOUNT_INVALID')) {
    fields.payableAccountId = 'Choose an account of type Tax Payable.';
  }
  return fields;
};

/**
 * Tranformes form values to request values.
 * @param {TaxRateFormValues} form - The form values.
 * @param {boolean} active - Whether the tax rate is active: true for a new
 *  rate, the rate's current state on edit so editing doesn't reactivate it.
 */
export const transformFormToReq = (
  form: TaxRateFormValues,
  active: boolean,
): TaxRateFormRequestBody => {
  const common = {
    name: form.name,
    code: form.code,
    description: form.description,
    isCompound: form.isCompound,
    isNonRecoverable: form.isNonRecoverable,
    active,
    // Always sent: the server requires `rate` unless `isGroup` is true.
    isGroup: form.isGroup,
  };
  // A group has no rate of its own and posts to its components' accounts.
  if (form.isGroup) {
    return { ...common, componentIds: form.componentIds };
  }
  return {
    ...common,
    rate: Number(form.rate),
    payableAccountId: form.payableAccountId ?? null,
  };
};

/**
 * Sums the rates of the given components, rounded to 4 decimals like the
 * server does.
 */
export const sumComponentRates = (
  componentIds: number[],
  rates: Array<{ id: number; rate: number | string }>,
): number => {
  const total = componentIds.reduce((sum, id) => {
    const found = rates.find((r) => r.id === id);
    return sum + (found ? Number(found.rate) : 0);
  }, 0);
  return Math.round(total * 10000) / 10000;
};

/**
 * Detarmines whether the tax rate changed.
 * @param initialValues
 * @param formValues
 * @returns {boolean}
 */
export const isTaxRateChange = (
  initialValues: TaxRateFormValues,
  formValues: TaxRateFormValues,
): boolean => {
  // A group's rate is computed from its components, there is nothing to confirm.
  if (formValues.isGroup) return false;

  return initialValues.rate !== formValues.rate;
};

/**
 * Detarmines whether the tax rate changed.
 * @returns {boolean}
 */
export const useIsTaxRateChanged = (): boolean => {
  const { initialValues, values } = useFormikContext<TaxRateFormValues>();

  return isTaxRateChange(initialValues, values);
};

const convertFormAttrsToBoolean = (
  form: TaxRateFormValues,
): TaxRateFormValues => {
  return {
    ...form,
    isCompound: !!form.isCompound,
    isNonRecoverable: !!form.isNonRecoverable,
    isGroup: !!form.isGroup,
  };
};

export const transformTaxRateToForm = (
  taxRate?: TaxRate,
): TaxRateFormValues => {
  return convertFormAttrsToBoolean({
    ...defaultInitialValues,
    ...transformToForm(taxRate, defaultInitialValues),
    rate:
      taxRate?.rate != null ? String(taxRate.rate) : defaultInitialValues.rate,
    componentIds: (taxRate?.components ?? []).map((c) => c.id),
    payableAccountId: taxRate?.payableAccountId ?? null,
  });
};

export const transformTaxRateCodeValue = (input: string): string => {
  // Remove non-alphanumeric characters and spaces using a regular expression
  const cleanedString = input.replace(/\s+/g, '');

  // Convert the cleaned string to uppercase
  const uppercasedString = cleanedString.toUpperCase();

  return uppercasedString;
};
