import { ToNumber } from '@/common/decorators/Validators';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CommandTaxRateDto {
  /**
   * Tax rate name.
   */
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The name of the tax rate.', example: 'VAT' })
  name: string;

  /**
   * Tax rate code.
   */
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The code of the tax rate.', example: 'VAT' })
  code: string;

  /**
   * Tax rate percentage. Required for a plain rate; a group's rate is the sum
   * of its components' rates, so it's ignored for a group.
   */
  @ValidateIf((dto) => !dto.isGroup)
  @IsNumber()
  @IsNotEmpty()
  @ToNumber()
  @ApiProperty({
    description:
      "The rate of the tax rate. Required for a plain rate; ignored for a group, whose rate is the sum of its components' rates.",
    example: 10,
    required: false,
  })
  rate: number;

  /**
   * Tax rate description.
   */
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'The description of the tax rate.',
    example: 'VAT',
  })
  description?: string;

  /**
   * Whether the tax is non-recoverable.
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value ?? false)
  @ApiProperty({
    description: 'Whether the tax is non-recoverable.',
    example: false,
  })
  isNonRecoverable?: boolean;

  /**
   * Whether the tax is compound.
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value ?? false)
  @ApiProperty({
    description: 'Whether the tax is compound.',
    example: false,
  })
  isCompound?: boolean;

  /**
   * Whether the tax rate is active.
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value ?? false)
  @ApiProperty({
    description: 'Whether the tax rate is active.',
    example: false,
  })
  active?: boolean;

  /**
   * Whether the tax rate is a group of component rates. Set on creation only.
   */
  @IsBoolean()
  @IsOptional()
  @ApiProperty({
    description:
      'Whether the tax rate is a group of component rates. Set on creation; a rate never changes between plain and group.',
    example: false,
    required: false,
  })
  isGroup?: boolean;

  /**
   * The component rate ids of a group, in order.
   */
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  @ApiProperty({
    description:
      'The ids of the component tax rates of a group, in the order they are shown and posted. At least two distinct, active, non-group rates.',
    example: [1, 2],
    type: [Number],
    required: false,
  })
  componentIds?: number[];

  /**
   * The tax payable account the rate posts to.
   */
  @IsInt()
  @IsOptional()
  @ToNumber()
  @ApiProperty({
    description:
      'The tax payable account the rate posts to. Null posts to the default Tax Payable account.',
    example: 1,
    type: Number,
    nullable: true,
    required: false,
  })
  payableAccountId?: number | null;
}

export class CreateTaxRateDto extends CommandTaxRateDto {}
export class EditTaxRateDto extends CommandTaxRateDto {}
