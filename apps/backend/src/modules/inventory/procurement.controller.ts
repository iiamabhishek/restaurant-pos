import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  purchaseReturnSchema,
  type PurchaseReturnDto,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { AuditAction } from '../../audit/audit-action';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { PriceVarianceService } from './price-variance.service';
import { PurchaseReturnsService } from './purchase-returns.service';

@ApiTags('procurement')
@Controller('v1/inventory/procurement')
export class ProcurementController {
  constructor(
    private readonly returns: PurchaseReturnsService,
    private readonly variance: PriceVarianceService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private access(u: SessionUser, branchId: string) {
    return this.branchAccess.assertAccess(u.restaurantId, branchId);
  }

  @Auth('inventory.manage')
  @Get('returns')
  async list(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('supplierId') supplierId?: string,
  ) {
    await this.access(u, branchId);
    return this.returns.list(branchId, supplierId);
  }

  @Auth('inventory.manage')
  @AuditAction('purchase.returned', 'PurchaseReturn')
  @Post('returns')
  @UsePipes(new ZodValidationPipe(purchaseReturnSchema))
  async create(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: PurchaseReturnDto,
  ) {
    await this.access(u, branchId);
    return this.returns.create(branchId, u.id, body);
  }

  @Auth('inventory.manage')
  @Get('suppliers/:supplierId/balance')
  async balance(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('supplierId') supplierId: string,
  ) {
    await this.access(u, branchId);
    return this.returns.supplierBalance(branchId, supplierId);
  }

  @Auth('inventory.manage')
  @Get('price-variance')
  async priceVariance(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('supplierId') supplierId?: string,
    @Query('threshold') threshold?: string,
  ) {
    await this.access(u, branchId);
    const t = threshold === undefined ? undefined : Number(threshold);
    if (t !== undefined && Number.isNaN(t))
      throw new BadRequestException('threshold must be a number');
    return this.variance.report(branchId, from, to, {
      supplierId,
      thresholdPct: t,
    });
  }
}
