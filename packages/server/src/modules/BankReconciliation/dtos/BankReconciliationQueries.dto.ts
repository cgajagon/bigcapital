import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional } from 'class-validator';

export class GetBankReconciliationSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2035-01-31',
    description: 'Statement ending date (YYYY-MM-DD).',
  })
  @IsOptional()
  @IsDateString()
  statementDate?: string;
}

export class GetBankReconciliationTransactionsQueryDto {
  @ApiProperty({
    example: '2035-01-31',
    description: 'Statement ending date (YYYY-MM-DD).',
  })
  @IsNotEmpty()
  @IsDateString()
  statementDate: string;
}

export class GetBankReconciliationsQueryDto {
  @ApiProperty({ example: 1000, description: 'The account to list.' })
  @Type(() => Number)
  @IsInt()
  accountId: number;
}
