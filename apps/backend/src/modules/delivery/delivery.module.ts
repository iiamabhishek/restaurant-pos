import { Module } from '@nestjs/common';
import { BillShareModule } from '../bill-share/bill-share.module';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [AuditModule, BillShareModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, BranchAccessService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
