import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';
import { RequirePermission } from '../Roles/RequirePermission.decorator';
import { AbilitySubject } from '../Roles/Roles.types';
import { CashflowAction } from '../BankingTransactions/types/BankingTransactions.types';
import { BankReconciliationApplication } from './BankReconciliationApplication';
import {
  GetBankReconciliationsQueryDto,
  GetBankReconciliationSummaryQueryDto,
  GetBankReconciliationTransactionsQueryDto,
} from './dtos/BankReconciliationQueries.dto';
import {
  BankReconciliationIdResponseDto,
  BankReconciliationInputDto,
} from './dtos/BankReconciliationInput.dto';
import {
  BankReconciliationDetailResponseDto,
  BankReconciliationListItemDto,
  BankReconciliationSummaryResponseDto,
  BankReconciliationTransactionsResponseDto,
  BankReconciliationUndoResponseDto,
} from './dtos/BankReconciliationResponses.dto';

@Controller('banking/reconciliations')
@ApiTags('Bank Reconciliation')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BankReconciliationController {
  constructor(
    private readonly bankReconciliationApplication: BankReconciliationApplication,
  ) {}

  @Get('accounts/:accountId/summary')
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({
    summary:
      'Retrieves the reconciliation start data of the account: beginning balance, last reconciliation, draft and mismatch.',
  })
  @ApiResponse({
    status: 200,
    description: 'The reconciliation summary of the account.',
    type: BankReconciliationSummaryResponseDto,
  })
  public getSummary(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Query() query: GetBankReconciliationSummaryQueryDto,
  ) {
    return this.bankReconciliationApplication.getSummary(
      accountId,
      query.statementDate,
    );
  }

  @Get('accounts/:accountId/transactions')
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({
    summary:
      'Retrieves the account transactions that are not reconciled yet, with the rows to tick.',
  })
  @ApiResponse({
    status: 200,
    description: 'The transactions to reconcile.',
    type: BankReconciliationTransactionsResponseDto,
  })
  public getTransactions(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Query() query: GetBankReconciliationTransactionsQueryDto,
  ) {
    return this.bankReconciliationApplication.getTransactions(
      accountId,
      query.statementDate,
    );
  }

  @Get()
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({
    summary: 'Retrieves the completed reconciliations of the account.',
  })
  @ApiResponse({
    status: 200,
    description: 'The reconciliation history, newest first.',
    type: [BankReconciliationListItemDto],
  })
  public getList(@Query() query: GetBankReconciliationsQueryDto) {
    return this.bankReconciliationApplication.getList(query.accountId);
  }

  @Get(':id')
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({
    summary: 'Retrieves a completed reconciliation with its transactions.',
  })
  @ApiResponse({
    status: 200,
    description: 'The reconciliation detail.',
    type: BankReconciliationDetailResponseDto,
  })
  public getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.bankReconciliationApplication.getDetail(id);
  }

  @Put('accounts/:accountId/draft')
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({
    summary: 'Saves the reconciliation in progress as the account draft.',
  })
  @ApiResponse({
    status: 200,
    description: 'The saved draft id.',
    type: BankReconciliationIdResponseDto,
  })
  public saveDraft(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: BankReconciliationInputDto,
  ) {
    return this.bankReconciliationApplication.saveDraft(accountId, dto);
  }

  @Delete('accounts/:accountId/draft')
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({ summary: 'Discards the account draft, if there is one.' })
  @ApiResponse({ status: 200, description: 'The draft is discarded.' })
  public async discardDraft(
    @Param('accountId', ParseIntPipe) accountId: number,
  ) {
    await this.bankReconciliationApplication.discardDraft(accountId);
  }

  @Post('accounts/:accountId/finish')
  @RequirePermission(CashflowAction.Reconcile, AbilitySubject.Cashflow)
  @ApiOperation({
    summary:
      'Finishes the reconciliation. Allowed only when the difference is exactly zero.',
  })
  @ApiResponse({
    status: 201,
    description: 'The completed reconciliation id.',
    type: BankReconciliationIdResponseDto,
  })
  public finish(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: BankReconciliationInputDto,
  ) {
    return this.bankReconciliationApplication.finish(accountId, dto);
  }

  @Post(':id/undo')
  @RequirePermission(CashflowAction.UndoReconciliation, AbilitySubject.Cashflow)
  @ApiOperation({
    summary:
      'Undoes the reconciliation, every later one of the account and the account draft.',
  })
  @ApiResponse({
    status: 201,
    description: 'The ids of the undone reconciliations.',
    type: BankReconciliationUndoResponseDto,
  })
  public undo(@Param('id', ParseIntPipe) id: number) {
    return this.bankReconciliationApplication.undo(id);
  }
}
