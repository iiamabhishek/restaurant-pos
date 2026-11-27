import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicTrackService } from './public-track.service';

// Unauthenticated by design: the customer's tracking link. Reachable only with the signed, expiring token that
// DeliveryController.trackLink issues for one delivery.
@ApiTags('public')
@Controller('v1/public/track')
export class PublicTrackController {
  constructor(private readonly track: PublicTrackService) {}

  // One customer's delivery position: never store it in a shared cache or proxy. Polled every few seconds.
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  get(@Param('token') token: string) {
    return this.track.byToken(token);
  }
}
