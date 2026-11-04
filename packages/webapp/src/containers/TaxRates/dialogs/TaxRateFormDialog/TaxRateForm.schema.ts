import * as Yup from 'yup';

const getSchema = () =>
  Yup.object().shape({
    name: Yup.string().required().label('Name'),
    code: Yup.string().required().label('Code'),
    active: Yup.boolean().optional().label('Active'),
    description: Yup.string().optional().label('Description'),
    isGroup: Yup.boolean().optional().label('Tax group'),
    // A group's rate is computed from its components; only a plain rate has one.
    rate: Yup.mixed().when('isGroup', {
      is: true,
      then: Yup.mixed().notRequired(),
      otherwise: Yup.number()
        .min(0, 'Enter a rate percentage of at least 0%')
        .max(100, 'Enter a rate percentage of at most 100%')
        .required()
        .label('Rate'),
    }),
    componentIds: Yup.array().when('isGroup', {
      is: true,
      then: Yup.array()
        .of(Yup.number())
        .min(2, 'Choose at least two tax rates as components.')
        .required('Choose at least two tax rates as components.'),
      otherwise: Yup.array().notRequired(),
    }),
    payableAccountId: Yup.number()
      .nullable()
      .optional()
      .label('Payable account'),
    isCompound: Yup.boolean().optional().label('Is Compound'),
    isNonRecoverable: Yup.boolean().optional().label('Is Non Recoverable'),
    confirmEdit: Yup.boolean().optional(),
  });

export const CreateTaxRateFormSchema = getSchema;
export const EditTaxRateFormSchema = getSchema;
