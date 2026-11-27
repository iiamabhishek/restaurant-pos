import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InstanceAuth } from '../common/decorators/instance-auth.decorator';
import { SyncKeyGuard } from './sync-key.guard';
import { SyncService } from './sync.service';

/** Called by other installs (key-authenticated). */
@ApiTags('sync')
@Controller('v1/sync-peer')
@UseGuards(SyncKeyGuard)
export class SyncPeerController {
  constructor(private readonly sync: SyncService) {}

  @Get('ping')
  async ping() {
    return {
      ok: true,
      role: 'server',
      schema: await this.sync.schemaVersion(),
    };
  }

  @Get('pull')
  pull(@Query('since') since = '0', @Query('device') device = '') {
    if (!/^\d+$/.test(since) || !device)
      throw new BadRequestException('since and device are required');
    return this.sync.pull(BigInt(since), device);
  }

  @Post('push')
  push(@Body() body: { device?: string; changes?: unknown }) {
    if (!body?.device || !Array.isArray(body.changes))
      throw new BadRequestException('device and changes are required');
    return this.sync.push(body.device, body.changes);
  }
}

/** Used by the settings page on this install. */
@ApiTags('sync')
@Controller('v1/sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly audit: AuditService,
  ) {}

  /** Versions that lost a concurrent edit, and flagged anomalies, for manager review. */
  @InstanceAuth('settings.manage')
  @Get('conflicts')
  conflicts(@Query('status') status = 'OPEN') {
    if (status !== 'OPEN' && status !== 'RESOLVED' && status !== 'ALL')
      throw new BadRequestException('status must be OPEN, RESOLVED or ALL');
    return this.sync.listConflicts(status);
  }

  @InstanceAuth('settings.manage')
  @Post('conflicts/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: { action?: string; reason?: string },
    @CurrentUser() user: SessionUser,
  ) {
    const done = await this.sync.resolveConflict(
      id,
      body?.action as 'KEEP_CURRENT' | 'APPLY_LOSER',
      body?.reason ?? '',
      user.id,
    );
    await this.audit.record({
      userId: user.id,
      action: 'SYNC_CONFLICT_RESOLVED',
      entity: 'sync_conflict',
      entityId: id,
      metadata: {
        resolution: done.action,
        kind: done.kind,
        table: done.tbl,
        record: done.pkKey,
        reason: (body?.reason ?? '').trim(),
      },
    });
    return done;
  }

  /** Devices that have synced with this server (server role only). */
  @InstanceAuth('settings.manage')
  @Get('peers')
  peers() {
    return this.sync.listPeers();
  }

  @InstanceAuth('settings.manage')
  @Post('peers/:device/revoke')
  async revoke(
    @Param('device') device: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.sync.setPeerRevoked(device, true);
    await this.audit.record({
      userId: user.id,
      action: 'SYNC_PEER_REVOKED',
      entity: 'sync_peer',
      entityId: device,
    });
    return { ok: true };
  }

  @InstanceAuth('settings.manage')
  @Post('peers/:device/restore')
  async restore(
    @Param('device') device: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.sync.setPeerRevoked(device, false);
    await this.audit.record({
      userId: user.id,
      action: 'SYNC_PEER_RESTORED',
      entity: 'sync_peer',
      entityId: device,
    });
    return { ok: true };
  }

  @InstanceAuth('settings.manage')
  @Get('status')
  status() {
    return this.sync.publicStatus();
  }

  @InstanceAuth('settings.manage')
  @Post('test')
  async test(@Body() body: { serverUrl?: string; apiKey?: string }) {
    try {
      return await this.sync.testConnection(this.url(body), this.key(body));
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Connection failed',
      );
    }
  }

  @InstanceAuth('settings.manage')
  @Put('settings')
  async enable(
    @Body() body: { serverUrl?: string; apiKey?: string; mode?: string },
  ) {
    if (body.mode !== 'adopt' && body.mode !== 'merge')
      throw new BadRequestException('mode must be adopt or merge');
    try {
      await this.sync.enable(this.url(body), this.key(body), body.mode);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Sync failed',
      );
    }
    return this.sync.publicStatus();
  }

  @InstanceAuth('settings.manage')
  @Post('run')
  async run() {
    try {
      const r = await this.sync.runOnce();
      return { ...r, ...(await this.sync.publicStatus()) };
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Sync failed',
      );
    }
  }

  @InstanceAuth('settings.manage')
  @Post('disable')
  async disable() {
    await this.sync.disable();
    return this.sync.publicStatus();
  }

  private url(b: { serverUrl?: string }) {
    const u = (b.serverUrl ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u))
      throw new BadRequestException(
        'Enter the server address, e.g. https://orders.example.com',
      );
    return u;
  }

  private key(b: { apiKey?: string }) {
    const k = (b.apiKey ?? '').trim();
    if (k.length < 16)
      throw new BadRequestException('Sync key must be at least 16 characters');
    return k;
  }
}
