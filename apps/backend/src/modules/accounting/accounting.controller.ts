import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  cashClosingSchema,
  permissionSatisfied,
  expenseDecisionSchema,
  expenseSchema,
  type CashClosingDto,
  type ExpenseDto,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { AuditAction } from '../../audit/audit-action';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { EXPORT_TYPES, renderReport } from '../reports/export';
import { AccountingService } from './accounting.service';

@ApiTags('accounting')
@Controller('v1/accounting')
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private access(u: SessionUser, branchId: string) {
    return this.branchAccess.assertAccess(u.restaurantId, branchId);
  }

  @Auth('accounting.manage')
  @Get('expenses')
  async expenses(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.listExpenses(branchId, from, to);
  }

  // Anyone who may submit an expense. Approvers' expenses are recorded as approved, everyone else's wait.
  @Auth('expenses.submit')
  @AuditAction('expense.created', 'Expense')
  @Post('expenses')
  @UsePipes(new ZodValidationPipe(expenseSchema))
  async createExpense(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: ExpenseDto,
  ) {
    await this.access(u, branchId);
    return this.accounting.createExpense(
      branchId,
      u.id,
      body,
      permissionSatisfied(u.permissions, 'expenses.approve'),
    );
  }

  @Auth('expenses.submit')
  @Get('expenses/mine')
  async myExpenses(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.myExpenses(branchId, u.id);
  }

  @Auth('expenses.approve')
  @Get('expenses/pending')
  async pendingExpenses(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.pendingExpenses(branchId);
  }

  @Auth('expenses.approve')
  @AuditAction('expense.approved', 'Expense')
  @Post('expenses/:id/approve')
  async approveExpense(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body?: unknown,
  ) {
    await this.access(u, branchId);
    const { note } = expenseDecisionSchema.parse(body ?? {});
    return this.accounting.decideExpense(branchId, id, u.id, true, note);
  }

  @Auth('expenses.approve')
  @AuditAction('expense.rejected', 'Expense')
  @Post('expenses/:id/reject')
  async rejectExpense(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body?: unknown,
  ) {
    await this.access(u, branchId);
    const { note } = expenseDecisionSchema.parse(body ?? {});
    return this.accounting.decideExpense(branchId, id, u.id, false, note);
  }

  // Journal for an accountant: CSV or Excel, balanced vouchers. Needs the export permission as well.
  @Auth('accounting.manage', 'data.export')
  @AuditAction('accounting.exported', 'Journal')
  @Get('export/journal')
  async exportJournal(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format = 'csv',
    @Res() res: Response,
  ) {
    if (format !== 'csv' && format !== 'xlsx')
      throw new BadRequestException('format must be csv or xlsx');
    await this.access(u, branchId);
    const j = await this.accounting.journalExport(branchId, from, to);
    const body = await renderReport(j, format, `${from} to ${to}`);
    const t = EXPORT_TYPES[format];
    res.setHeader('Content-Type', t.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="journal_${from}_${to}.${t.ext}"`,
    );
    res.send(body);
  }

  @Auth('accounting.manage')
  @AuditAction('expense.deleted', 'Expense')
  @Delete('expenses/:id')
  async deleteExpense(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.deleteExpense(branchId, id);
  }

  @Auth('accounting.manage')
  @Get('closing/preview')
  async preview(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('date') date: string,
    @Query('openingFloat') openingFloat?: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.closingPreview(
      branchId,
      date,
      Number(openingFloat ?? 0) || 0,
    );
  }

  @Auth('accounting.manage')
  @Get('closing')
  async closings(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.listClosings(branchId);
  }

  @Auth('accounting.manage')
  @AuditAction('cash.closed', 'CashClosing')
  @Post('closing')
  @UsePipes(new ZodValidationPipe(cashClosingSchema))
  async close(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: CashClosingDto,
  ) {
    await this.access(u, branchId);
    return this.accounting.closeDay(branchId, u.id, body);
  }

  @Auth('accounting.manage')
  @Get('profit-loss')
  async pnl(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.profitAndLoss(branchId, from, to);
  }

  @Auth('accounting.manage')
  @Get('gst')
  async gst(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    await this.access(u, branchId);
    return this.accounting.gstReport(branchId, from, to);
  }

  @Auth('accounting.manage')
  @Get('branches')
  branches(
    @CurrentUser() u: SessionUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.accounting.branchOverview(u.restaurantId, from, to);
  }
}
