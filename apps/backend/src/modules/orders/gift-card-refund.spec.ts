/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- hand-built Prisma fakes */
import { OrdersService } from './orders.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';

function setup(
  redemptions: { giftCardId: string; amount: number }[] = [],
  priorRefunds: { method: string; amount: number }[] = [],
) {
  const credits: { giftCardId: string; amount: number }[] = [];
  const giftCards: any = {
    credit: jest.fn(
      async (_tx: any, _branch: string, giftCardId: string, amount: number) => {
        credits.push({ giftCardId, amount });
      },
    ),
  };
  const tx: any = {
    order: { update: jest.fn(async () => ({})) },
    refund: {
      findMany: jest.fn(async () => priorRefunds),
      create: jest.fn(async () => ({ id: 'ref1' })),
    },
    gatewayRefund: { findMany: jest.fn(async () => []) },
    giftCardRedemption: { findMany: jest.fn(async () => redemptions) },
    pointsLedger: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    giftCard: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = {
    order: {
      findFirst: jest.fn(async () => ({
        id: 'o1',
        status: 'PAID',
        totalAmount: 100,
        customerId: null,
        loyaltyPointsRedeemed: 0,
      })),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const verifactu: any = { recordRefund: jest.fn(async () => ({})) };
  const svc: any = Object.create(OrdersService.prototype);
  svc.prisma = prisma;
  svc.giftCards = giftCards;
  svc.verifactu = verifactu;
  svc.realtime = { emitToBranch: jest.fn() };
  svc.audit = { record: jest.fn(async () => ({})) };
  return { svc, tx, credits };
}

const refund = (svc: any, method: string, amount = 100) =>
  svc.refund('b1', 'o1', 'u1', {
    amount,
    method: method as never,
    reason: 'returned item',
  });

describe('gift card value on refund', () => {
  it('re-credits the full redeemed value when the whole refund goes back to the card', async () => {
    const s = setup([{ giftCardId: 'gc1', amount: 100 }]);
    await refund(s.svc, 'GIFT_CARD');
    expect(s.credits).toEqual([{ giftCardId: 'gc1', amount: 100 }]);
  });

  it('mixed tender: Rs100 paid 60 card + 40 cash, a Rs25 card refund credits exactly Rs25', async () => {
    const s = setup([{ giftCardId: 'gc1', amount: 60 }]);
    await refund(s.svc, 'GIFT_CARD', 25);
    expect(s.credits).toEqual([{ giftCardId: 'gc1', amount: 25 }]);
    expect(s.tx.refund.create.mock.calls[0][0].data.amount).toBe(25);
  });

  it('refuses to send more to the card than was paid with it, and credits nothing', async () => {
    const s = setup([{ giftCardId: 'gc1', amount: 60 }]);
    await expect(refund(s.svc, 'GIFT_CARD', 70)).rejects.toThrow(
      /Only 60\.00 can still go back to a gift card/,
    );
    expect(s.credits).toEqual([]);
  });

  it('counts earlier card refunds against the ceiling', async () => {
    const s = setup(
      [{ giftCardId: 'gc1', amount: 60 }],
      [{ method: 'GIFT_CARD', amount: 50 }],
    );
    await expect(refund(s.svc, 'GIFT_CARD', 20)).rejects.toThrow(
      /Only 10\.00 can still/,
    );
    await refund(s.svc, 'GIFT_CARD', 10);
    expect(s.credits).toEqual([{ giftCardId: 'gc1', amount: 10 }]);
  });

  it('several redemptions are filled in order, credits always sum to the refund', async () => {
    const redemptions = [
      { giftCardId: 'gc1', amount: 60 },
      { giftCardId: 'gc2', amount: 40 },
    ];
    const first = setup(redemptions);
    await refund(first.svc, 'GIFT_CARD', 25);
    expect(first.credits).toEqual([{ giftCardId: 'gc1', amount: 25 }]);

    const second = setup(redemptions, [{ method: 'GIFT_CARD', amount: 25 }]);
    await refund(second.svc, 'GIFT_CARD', 50);
    expect(second.credits).toEqual([
      { giftCardId: 'gc1', amount: 35 },
      { giftCardId: 'gc2', amount: 15 },
    ]);
  });

  it('two redemptions on the same card are merged into one credit', async () => {
    const s = setup([
      { giftCardId: 'gc1', amount: 30 },
      { giftCardId: 'gc1', amount: 20 },
    ]);
    await refund(s.svc, 'GIFT_CARD', 45);
    expect(s.credits).toEqual([{ giftCardId: 'gc1', amount: 45 }]);
  });

  it('repeated partial refunds never drift by a rounding cent', async () => {
    const redemptions = [{ giftCardId: 'gc1', amount: 33.33 }];
    const prior: { method: string; amount: number }[] = [];
    let credited = 0;
    for (const amount of [11.11, 11.11, 11.11]) {
      const s = setup(redemptions, [...prior]);
      await refund(s.svc, 'GIFT_CARD', amount);
      credited += s.credits[0].amount;
      prior.push({ method: 'GIFT_CARD', amount });
    }
    expect(Math.round(credited * 100)).toBe(3333);
    const over = setup(redemptions, prior);
    await expect(refund(over.svc, 'GIFT_CARD', 0.01)).rejects.toThrow();
  });

  it('refuses a gift-card refund on an order that was not paid with one', async () => {
    const s = setup([]);
    await expect(refund(s.svc, 'GIFT_CARD', 10)).rejects.toThrow(
      /not paid with a gift card/,
    );
    expect(s.credits).toEqual([]);
  });

  it('does not credit the card for a cash refund', async () => {
    const s = setup([{ giftCardId: 'gc1', amount: 100 }]);
    await refund(s.svc, 'CASH');
    expect(s.credits).toEqual([]);
    expect(s.tx.giftCardRedemption.findMany).not.toHaveBeenCalled();
  });
});

describe('GiftCardsService.credit', () => {
  it('increments the balance atomically and refuses a foreign card', async () => {
    const tx: any = {
      giftCard: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const service = new GiftCardsService({} as never);
    await service.credit(tx, 'b1', 'gc1', 12.345);
    expect(tx.giftCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'gc1', branchId: 'b1' },
      data: { balance: { increment: 12.35 } },
    });
    tx.giftCard.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.credit(tx, 'b1', 'gcX', 1)).rejects.toThrow(
      /not found for this branch/,
    );
  });
});
