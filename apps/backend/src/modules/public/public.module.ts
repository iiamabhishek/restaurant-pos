import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PaymentGatewaysModule } from '../../payment-gateways/payment-gateways.module';
import { BillShareModule } from '../bill-share/bill-share.module';
import { OrdersModule } from '../orders/orders.module';
import { RatingsModule } from '../ratings/ratings.module';
import { TablesModule } from '../tables/tables.module';
import { PublicTrackController } from './public-track.controller';
import { PublicTrackService } from './public-track.service';
import { PublicBillController } from './public-bill.controller';
import { PublicBillService } from './public-bill.service';
import { PublicKioskController } from './public-kiosk.controller';
import { PublicKioskService } from './public-kiosk.service';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [
    OrdersModule,
    NotificationsModule,
    PaymentGatewaysModule,
    TablesModule,
    RatingsModule,
    BillShareModule,
  ],
  controllers: [
    PublicMenuController,
    PublicKioskController,
    PublicBillController,
    PublicTrackController,
  ],
  providers: [
    PublicMenuService,
    PublicKioskService,
    PublicBillService,
    PublicTrackService,
  ],
})
export class PublicModule {}
