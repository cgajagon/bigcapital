import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { AuthorizationGuard } from '../Roles/Authorization.guard';
import { PermissionGuard } from '../Roles/Permission.guard';

@Controller('banking/reconciliations')
@ApiTags('Bank Reconciliation')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BankReconciliationController {}
