import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY_MESSAGE = 'statementDate must be a date in YYYY-MM-DD format';

export class ReconcileRefDto {
  @ApiProperty({ example: 'Expense', description: 'Source transaction type.' })
  @IsString()
  @MaxLength(64)
  referenceType: string;

  @ApiProperty({ example: 12, description: 'Source transaction id.' })
  @IsInt()
  referenceId: number;
}

export class BankReconciliationInputDto {
  @ApiProperty({
    example: '2035-01-31',
    description: 'Statement ending date (YYYY-MM-DD).',
  })
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  @IsDateString({ strict: true }, { message: DATE_ONLY_MESSAGE })
  statementDate: string;

  @ApiProperty({ example: 750, description: 'Statement ending balance.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  endingBalance: number;

  @ApiProperty({
    type: [ReconcileRefDto],
    description: 'The ticked transactions.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconcileRefDto)
  selectedTransactions: ReconcileRefDto[];
}

export class BankReconciliationIdResponseDto {
  @ApiProperty({ example: 1 })
  id: number;
}
