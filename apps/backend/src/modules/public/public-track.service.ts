import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillShareService } from '../bill-share/bill-share.service';
import { trackView } from '../delivery/tracking';

/**
 * What a customer sees when they open their tracking link: order number, status and, while the delivery is live and the
 * rider is sharing a fresh position, how far away they are. No rider phone, no other orders, no internal ids.
 */
@Injectable()
export class PublicTrackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: BillShareService,
  ) {}

  async byToken(token: string) {
    const { orderId, branchId } = this.links.verifyTrackToken(token);
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, branchId, type: 'DELIVERY' },
      select: {
        orderNumber: true,
        status: true,
        deliveryStatus: true,
        deliveryEtaAt: true,
        deliveryLat: true,
        deliveryLng: true,
        branch: { select: { name: true, phone: true } },
        driver: {
          select: {
            name: true,
            riderOnline: true,
            riderLat: true,
            riderLng: true,
            riderLocationAt: true,
          },
        },
      },
    });
    if (!o) throw new NotFoundException('Delivery not found');
    const view = trackView({
      deliveryStatus: o.deliveryStatus,
      orderStatus: o.status,
      destination: { lat: o.deliveryLat, lng: o.deliveryLng },
      rider: o.driver
        ? {
            name: o.driver.name,
            online: o.driver.riderOnline,
            lat: o.driver.riderLat,
            lng: o.driver.riderLng,
            at: o.driver.riderLocationAt,
          }
        : null,
      now: new Date(),
    });
    return {
      orderNumber: o.orderNumber,
      restaurant: o.branch.name,
      restaurantPhone: o.branch.phone,
      promisedAt: o.deliveryEtaAt,
      destination:
        o.deliveryLat != null && o.deliveryLng != null
          ? { lat: o.deliveryLat, lng: o.deliveryLng }
          : null,
      ...view,
    };
  }
}
