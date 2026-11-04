import { ApiProperty } from '@nestjs/swagger';

export class TaxRateComponentResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the component tax rate',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'The name of the component tax rate',
    example: 'TPS',
  })
  name: string;

  @ApiProperty({
    description: 'The code of the component tax rate',
    example: 'TPS',
  })
  code: string;

  @ApiProperty({
    description: 'The current rate of the component tax rate',
    example: 5,
  })
  rate: number;
}

export class TaxRateResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the tax rate',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'The name of the tax rate',
    example: 'VAT',
  })
  name: string;

  @ApiProperty({
    description:
      'The formatted name of the tax rate including the rate percentage',
    example: 'VAT [10%]',
  })
  nameFormatted: string;

  @ApiProperty({
    description: 'The code of the tax rate',
    example: 'VAT',
  })
  code: string;

  @ApiProperty({
    description: 'The rate of the tax rate as a decimal number',
    example: 10,
  })
  rate: number;

  @ApiProperty({
    description: 'The formatted rate of the tax rate with percentage symbol',
    example: '10%',
  })
  rateFormatted: string;

  @ApiProperty({
    description: 'The description of the tax rate',
    example: 'Value Added Tax',
    required: false,
  })
  description?: string;

  @ApiProperty({
    description: 'Whether the tax is non-recoverable',
    example: false,
  })
  isNonRecoverable: boolean;

  @ApiProperty({
    description: 'Whether the tax is compound',
    example: false,
  })
  isCompound: boolean;

  @ApiProperty({
    description: 'Whether the tax rate is active',
    example: true,
  })
  active: boolean;

  @ApiProperty({
    description:
      "Whether the tax rate is a group of component rates; a group's rate is the sum of its components' rates",
    example: false,
  })
  isGroup: boolean;

  @ApiProperty({
    description:
      'The tax payable account the rate posts to; null posts to the default Tax Payable account',
    example: null,
    type: Number,
    nullable: true,
  })
  payableAccountId: number | null;

  @ApiProperty({
    description:
      'The component tax rates of a group, in order; empty for a plain rate',
    type: [TaxRateComponentResponseDto],
  })
  components: TaxRateComponentResponseDto[];

  @ApiProperty({
    description:
      "Whether a document line, tax transaction, ledger entry or item default uses the tax rate; a used group's components and a used rate's payable account can't change. Returned when retrieving tax rates.",
    example: false,
    required: false,
  })
  isUsed?: boolean;

  @ApiProperty({
    description: 'The date when the tax rate was created',
    example: '2024-03-20T10:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The date when the tax rate was last updated',
    example: '2024-03-20T10:00:00Z',
  })
  updatedAt: Date;
}
