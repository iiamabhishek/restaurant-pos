import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  permissionSatisfied,
  pettyCashCountSchema,
  pettyCashTopupSchema,
  pettyCashVoucherSchema,
  type PettyCashCountDto,
  type PettyCashTopupDto,
  type PettyCashVoucherDto,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { AuditAction } from '../../audit/audit-action';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { PettyCashService } from './petty-cash.service';

@ApiTags('petty-cash')
@Controller('v1/accounting/petty-cash')
export class PettyCashController {
  constructor(
    private readonly petty: PettyCashService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private access(u: SessionUser, branchId: string) {
    return this.branchAccess.assertAccess(u.restaurantId, branchId);
  }

  @Auth('pettycash.manage')
  @Get()
  async overview(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.petty.overview(branchId);
  }

  @Auth('pettycash.manage')
  @AuditAction('pettycash.topup', 'PettyCashEntry')
  @Post('topups')
  @UsePipes(new ZodValidationPipe(pettyCashTopupSchema))
  async topup(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: PettyCashTopupDto,
  ) {
    await this.access(u, branchId);
    return this.petty.topup(branchId, u.id, body);
  }

  @Auth('pettycash.manage')
  @AuditAction('pettycash.voucher', 'PettyCashEntry')
  @Post('vouchers')
  @UsePipes(new ZodValidationPipe(pettyCashVoucherSchema))
  async voucher(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: PettyCashVoucherDto,
  ) {
    await this.access(u, branchId);
    return this.petty.voucher(
      branchId,
      u.id,
      body,
      permissionSatisfied(u.permissions, 'expenses.approve'),
    );
  }

  @Auth('pettycash.manage')
  @AuditAction('pettycash.count', 'PettyCashEntry')
  @Post('counts')
  @UsePipes(new ZodValidationPipe(pettyCashCountSchema))
  async count(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: PettyCashCountDto,
  ) {
    await this.access(u, branchId);
    return this.petty.count(branchId, u.id, body);
  }
}
