import { ApiProperty } from '@nestjs/swagger';

export class BankReconciliationAccountDto {
  @ApiProperty({ example: 1000 })
  id: number;

  @ApiProperty({ example: 'Bank Account' })
  name: string;

  @ApiProperty({ example: 'bank', description: 'bank, cash or credit-card' })
  accountType: string;

  @ApiProperty({ enum: ['debit', 'credit'] })
  accountNormal: string;

  @ApiProperty({ example: 'USD' })
  currencyCode: string;
}

export class BankReconciliationHeaderDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '2035-01-31' })
  statementDate: string;

  @ApiProperty({ example: 1500 })
  endingBalance: number;
}

export class BankReconciliationChangedItemDto {
  @ApiProperty({ example: 'PaymentReceive' })
  referenceType: string;

  @ApiProperty({ example: 12 })
  referenceId: number;

  @ApiProperty({ example: 1 })
  reconciliationId: number;

  @ApiProperty({ description: 'Amount when it was reconciled.', example: 1200 })
  amount: number;

  @ApiProperty({ example: '2035-01-12' })
  date: string;

  @ApiProperty({ nullable: true, type: String })
  transactionTypeKey: string | null;

  @ApiProperty({
    description: 'Translated transaction type.',
    nullable: true,
    type: String,
  })
  transactionType: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionNumber: string | null;

  @ApiProperty({ nullable: true, type: String })
  referenceNumber: string | null;

  @ApiProperty({ nullable: true, type: String })
  contactName: string | null;

  @ApiProperty({ description: 'Amount on the account today.', example: 1100 })
  currentAmount: number;

  @ApiProperty({ description: 'The transaction is gone from the account.' })
  isDeleted: boolean;
}

export class BankReconciliationMismatchDto {
  @ApiProperty({
    description: 'Beginning balance minus the last ending balance.',
    example: -100,
  })
  amount: number;

  @ApiProperty({ type: () => [BankReconciliationChangedItemDto] })
  items: BankReconciliationChangedItemDto[];
}

export class BankReconciliationSummaryResponseDto {
  @ApiProperty({ type: () => BankReconciliationAccountDto })
  account: BankReconciliationAccountDto;

  @ApiProperty({
    description: 'Sum of the current amounts of the reconciled transactions.',
    example: 0,
  })
  beginningBalance: number;

  @ApiProperty({ type: () => BankReconciliationHeaderDto, nullable: true })
  lastReconciliation: BankReconciliationHeaderDto | null;

  @ApiProperty({ type: () => BankReconciliationHeaderDto, nullable: true })
  draft: BankReconciliationHeaderDto | null;

  @ApiProperty({
    type: () => BankReconciliationMismatchDto,
    nullable: true,
    description:
      'Present when the beginning balance differs from the last ending balance.',
  })
  mismatch: BankReconciliationMismatchDto | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Bank rows on or before the statement date still to categorize. Null without a statement date.',
  })
  uncategorizedCount: number | null;
}

export class BankReconciliationRefDto {
  @ApiProperty({ example: 'PaymentReceive' })
  referenceType: string;

  @ApiProperty({ example: 12 })
  referenceId: number;
}

export class BankReconciliationTransactionRowDto extends BankReconciliationRefDto {
  @ApiProperty({ example: '2035-01-12' })
  date: string;

  @ApiProperty({ example: '2035 Jan 12' })
  formattedDate: string;

  @ApiProperty({
    example: 'Payment received',
    nullable: true,
    type: String,
  })
  transactionType: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionNumber: string | null;

  @ApiProperty({ nullable: true, type: String })
  referenceNumber: string | null;

  @ApiProperty({ nullable: true, type: String })
  contactName: string | null;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({
    description:
      'Net amount on the account; positive raises the statement balance.',
    example: 1200,
  })
  amount: number;

  @ApiProperty({ example: '1,200.00' })
  formattedAmount: string;

  @ApiProperty({ description: 'Categorized or matched from a bank feed row.' })
  isFromBankFeed: boolean;

  @ApiProperty()
  isAfterStatementDate: boolean;
}

export class BankReconciliationTransactionsResponseDto {
  @ApiProperty({ type: () => [BankReconciliationTransactionRowDto] })
  transactions: BankReconciliationTransactionRowDto[];

  @ApiProperty({
    type: () => [BankReconciliationRefDto],
    description:
      'Transactions to tick: the draft selection, or the bank feed rows.',
  })
  selected: BankReconciliationRefDto[];

  @ApiProperty({
    description: 'Draft selections that no longer exist on the account.',
    example: 0,
  })
  droppedFromDraftCount: number;
}

export class BankReconciliationListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '2035-01-31' })
  statementDate: string;

  @ApiProperty({ example: 1500 })
  endingBalance: number;

  @ApiProperty({ nullable: true, type: String })
  completedAt: string | null;

  @ApiProperty({ nullable: true, type: Number })
  completedByUserId: number | null;

  @ApiProperty({ nullable: true, type: String })
  completedByName: string | null;
}

export class BankReconciliationDetailTransactionDto {
  @ApiProperty({ example: 'PaymentReceive' })
  referenceType: string;

  @ApiProperty({ example: 12 })
  referenceId: number;

  @ApiProperty({ example: 1 })
  reconciliationId: number;

  @ApiProperty({ description: 'Amount when it was reconciled.', example: 1200 })
  amount: number;

  @ApiProperty({ example: '2035-01-12' })
  date: string;

  @ApiProperty({ nullable: true, type: String })
  transactionTypeKey: string | null;

  @ApiProperty({
    description: 'Translated transaction type.',
    nullable: true,
    type: String,
  })
  transactionType: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionNumber: string | null;

  @ApiProperty({ nullable: true, type: String })
  referenceNumber: string | null;

  @ApiProperty({ nullable: true, type: String })
  contactName: string | null;

  @ApiProperty({ description: 'Amount on the account today.', example: 1200 })
  currentAmount: number;

  @ApiProperty({ description: 'The transaction is gone from the account.' })
  isDeleted: boolean;
}

export class BankReconciliationDetailResponseDto extends BankReconciliationListItemDto {
  @ApiProperty({ example: 1000 })
  accountId: number;

  @ApiProperty({ example: 'completed' })
  status: string;

  @ApiProperty({ nullable: true, type: Number })
  beginningBalance: number | null;

  @ApiProperty({
    description: 'Cleared deposits (charges on a credit card).',
    nullable: true,
    type: Number,
  })
  clearedIncreases: number | null;

  @ApiProperty({
    description: 'Cleared payments.',
    nullable: true,
    type: Number,
  })
  clearedDecreases: number | null;

  @ApiProperty({
    description: 'Book balance at the statement date.',
    nullable: true,
    type: Number,
  })
  bookBalance: number | null;

  @ApiProperty({
    description: 'Total of the uncleared transactions.',
    nullable: true,
    type: Number,
  })
  unclearedTotal: number | null;

  @ApiProperty({ nullable: true, type: Number })
  unclearedCount: number | null;

  @ApiProperty({ type: () => [BankReconciliationDetailTransactionDto] })
  transactions: BankReconciliationDetailTransactionDto[];
}
