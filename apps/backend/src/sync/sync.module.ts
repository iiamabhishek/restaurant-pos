import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SyncKeyGuard } from './sync-key.guard';
import { SyncController, SyncPeerController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AuditModule],
  controllers: [SyncPeerController, SyncController],
  providers: [SyncService, SyncKeyGuard],
})
export class SyncModule {}
