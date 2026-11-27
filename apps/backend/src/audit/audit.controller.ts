import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  auditLogListQuerySchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  EXPORT_TYPES,
  isExportFormat,
  renderReport,
} from '../modules/reports/export';
import { AuditService } from './audit.service';

@ApiTags('audit-logs')
@Controller('v1/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Auth('audit_log.view')
  @Get()
  async list(
    @CurrentUser() user: SessionUser,
    @Query() query: Record<string, string>,
  ) {
    const result = auditLogListQuerySchema.safeParse(query);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return this.auditService.list(user.restaurantId, result.data);
  }

  @Auth('audit_log.view')
  @Get('entities')
  async entities(@CurrentUser() user: SessionUser) {
    return this.auditService.listEntities(user.restaurantId);
  }

  // Read-only export of the trail. There is deliberately no update or delete
  // route for audit entries anywhere, and the database refuses both as well.
  @Auth('audit_log.view', 'data.export')
  @Get('export')
  async export(
    @CurrentUser() user: SessionUser,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const format = query.format ?? 'xlsx';
    if (!isExportFormat(format))
      throw new BadRequestException('format must be csv, xlsx or pdf');
    const result = auditLogListQuerySchema.safeParse(query);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    const rows = await this.auditService.listForExport(
      user.restaurantId,
      result.data,
    );
    await this.auditService.record({
      userId: user.id,
      action: 'audit_log.exported',
      entity: 'AuditLog',
      metadata: { format, rows: rows.length, filters: query },
    });
    const body = await renderReport(
      {
        key: 'audit-log',
        title: 'Audit log',
        columns: ['When', 'Who', 'Action', 'What', 'Reference', 'Details'],
        rows: rows.map((e) => [
          e.createdAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
          e.user?.name ?? 'System',
          e.action,
          e.entity,
          e.entityId ?? '',
          e.metadata == null ? '' : JSON.stringify(e.metadata),
        ]),
      },
      format,
      `${rows.length} entries${query.from ? ` from ${query.from}` : ''}${query.to ? ` to ${query.to}` : ''}`,
    );
    const t = EXPORT_TYPES[format];
    res.setHeader('Content-Type', t.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-log.${t.ext}"`,
    );
    res.send(body);
  }
}
