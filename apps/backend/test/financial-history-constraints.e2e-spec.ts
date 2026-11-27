import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const run = process.env.FINANCIAL_HISTORY_E2E ? describe : describe.skip;

run('Financial history foreign keys (PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const branchId = 'demo-branch';
  let ownerId: string;

  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { email: 'owner@demo.local' },
    });
    ownerId = owner.id;
  });

  afterAll(() => prisma.$disconnect());

  it.each(['payment', 'refund'] as const)(
    'rejects a direct order deletion with a recorded %s',
    async (kind) => {
      await expect(
        prisma.$transaction(async (tx) => {
          const order = await tx.order.create({
            data: { branchId, createdById: ownerId, orderNumber: randomUUID() },
          });
          const data = {
            orderId: order.id,
            amount: 25,
            method: 'CASH' as const,
          };
          if (kind === 'payment') await tx.payment.create({ data });
          else
            await tx.refund.create({ data: { ...data, createdById: ownerId } });
          return tx.order.delete({ where: { id: order.id } });
        }),
      ).rejects.toMatchObject({
        code: 'P2003',
        meta: { constraint: `${kind}s_orderId_fkey` },
      });
    },
  );

  it('rejects a direct supplier invoice deletion after a partial payment', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({
          data: { branchId, name: 'Financial history test' },
        });
        const invoice = await tx.supplierInvoice.create({
          data: {
            branchId,
            supplierId: supplier.id,
            recordedById: ownerId,
            invoiceNumber: randomUUID(),
            invoiceDate: new Date(),
            totalAmount: 100,
            amountPaid: 25,
            status: 'PARTIALLY_PAID',
          },
        });
        await tx.supplierPayment.create({
          data: {
            branchId,
            supplierInvoiceId: invoice.id,
            recordedById: ownerId,
            amount: 25,
            paymentMethod: 'CASH',
          },
        });
        return tx.supplierInvoice.delete({ where: { id: invoice.id } });
      }),
    ).rejects.toMatchObject({
      code: 'P2003',
      meta: { constraint: 'supplier_payments_supplierInvoiceId_fkey' },
    });
  });
});
