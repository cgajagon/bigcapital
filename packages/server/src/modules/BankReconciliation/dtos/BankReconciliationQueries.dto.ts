import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY_MESSAGE = 'statementDate must be a date in YYYY-MM-DD format';

export class GetBankReconciliationSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2035-01-31',
    description: 'Statement ending date (YYYY-MM-DD).',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  @IsDateString({ strict: true }, { message: DATE_ONLY_MESSAGE })
  statementDate?: string;
}

export class GetBankReconciliationTransactionsQueryDto {
  @ApiProperty({
    example: '2035-01-31',
    description: 'Statement ending date (YYYY-MM-DD).',
  })
  @IsNotEmpty()
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  @IsDateString({ strict: true }, { message: DATE_ONLY_MESSAGE })
  statementDate: string;
}

export class GetBankReconciliationsQueryDto {
  @ApiProperty({ example: 1000, description: 'The account to list.' })
  @Type(() => Number)
  @IsInt()
  accountId: number;
}
