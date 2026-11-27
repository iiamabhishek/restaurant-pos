import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GoodsReceiptDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round3, round4 } from '../../common/money';

type PurchaseOrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: { items: true };
}>;

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  listGoodsReceipts(branchId: string) {
    return this.prisma.goodsReceipt.findMany({
      where: { branchId },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
        receivedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getGoodsReceipt(branchId: string, id: string) {
    const grn = await this.prisma.goodsReceipt.findFirst({
      where: { id, branchId },
      include: {
        supplier: true,
        purchaseOrder: { select: { id: true, poNumber: true } },
        receivedBy: { select: { id: true, name: true } },
        items: { include: { ingredient: true, stockBatch: true } },
      },
    });
    if (!grn) throw new NotFoundException('Goods receipt not found');
    return grn;
  }

  // Creates the GRN, one StockBatch + StockMovement per line, updates each
  // Ingredient's cached currentStock/costPerUnit (weighted-average, read-
  // then-set — never a DB `increment`, see the schema comment for why), and
  // — if linked to a PO — the PO item's quantityReceived and the PO's
  // overall status. All in one transaction: a GRN is either fully applied
  // to stock or not applied at all, never half-way.
  async createGoodsReceipt(
    branchId: string,
    userId: string,
    dto: GoodsReceiptDto,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, branchId },
    });
    if (!supplier)
      throw new BadRequestException('Supplier not found in this branch');

    return this.prisma.$transaction(async (tx) => {
      // Serializes GRN numbering without blocking foreign-key key-share locks.
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR NO KEY UPDATE`;

      let purchaseOrder: PurchaseOrderWithItems | null = null;
      if (dto.purchaseOrderId) {
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${dto.purchaseOrderId} AND "branchId" = ${branchId} FOR UPDATE`;
        purchaseOrder = await tx.purchaseOrder.findFirst({
          where: { id: dto.purchaseOrderId, branchId },
          include: { items: true },
        });
        if (!purchaseOrder)
          throw new BadRequestException(
            'Purchase order not found in this branch',
          );
        if (
          purchaseOrder.status === 'CANCELLED' ||
          purchaseOrder.status === 'RECEIVED'
        ) {
          throw new BadRequestException(
            `Cannot receive against a purchase order that is already ${purchaseOrder.status}`,
          );
        }
      }

      const ingredientIds = dto.items.map((i) => i.ingredientId);
      for (const ingredientId of [...new Set(ingredientIds)].sort()) {
        await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} AND "branchId" = ${branchId} FOR UPDATE`;
      }
      const ingredients = await tx.ingredient.findMany({
        where: { id: { in: ingredientIds }, branchId },
      });
      if (ingredients.length !== new Set(ingredientIds).size) {
        throw new BadRequestException(
          'One or more ingredients not found in this branch',
        );
      }

      // purchaseOrderItemId, if provided, must belong to this PO and this ingredient.
      if (purchaseOrder) {
        for (const item of dto.items) {
          if (!item.purchaseOrderItemId) continue;
          const poItem = purchaseOrder.items.find(
            (pi) => pi.id === item.purchaseOrderItemId,
          );
          if (!poItem || poItem.ingredientId !== item.ingredientId) {
            throw new BadRequestException(
              'purchaseOrderItemId does not match this purchase order / ingredient',
            );
          }
        }
      }

      const grnNumber = await this.nextGrnNumber(tx, branchId);
      const grn = await tx.goodsReceipt.create({
        data: {
          branchId,
          supplierId: dto.supplierId,
          purchaseOrderId: dto.purchaseOrderId,
          grnNumber,
          notes: dto.notes,
          receivedById: userId,
        },
      });

      // Accumulate per-PO-item received quantities in JS first, in case two
      // lines in the same GRN target the same purchaseOrderItemId — then
      // apply as a single `set` per item (never `increment`, same
      // no-float-drift discipline as the Ingredient cost/stock update below).
      const receivedByPoItem = new Map<string, number>();

      for (const [index, item] of dto.items.entries()) {
        const ingredient = ingredients.find((i) => i.id === item.ingredientId)!;
        const batchNumber = item.batchNumber || `${grnNumber}-${index + 1}`;

        const grnItem = await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: grn.id,
            ingredientId: item.ingredientId,
            purchaseOrderItemId: item.purchaseOrderItemId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            batchNumber,
            expiryDate: item.expiryDate,
          },
        });

        const batch = await tx.stockBatch.create({
          data: {
            branchId,
            ingredientId: item.ingredientId,
            goodsReceiptItemId: grnItem.id,
            batchNumber,
            quantityReceived: item.quantity,
            quantityRemaining: item.quantity,
            unitCost: item.unitCost,
            expiryDate: item.expiryDate,
          },
        });

        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: item.ingredientId,
            batchId: batch.id,
            type: 'RECEIPT',
            quantity: item.quantity,
            note: `GRN ${grnNumber}`,
            createdById: userId,
          },
        });

        // These balances were read after locking the ingredient rows above.
        // Use the real signed balance. Clamping to zero here made the cached
        // stock disagree with the movement ledger (and distorted the weighted
        // average cost) whenever an earlier sale had driven stock negative.
        const oldStock = new Prisma.Decimal(ingredient.currentStock);
        const newStockDec = oldStock.plus(item.quantity);
        const newStock = round3(newStockDec.toNumber());
        const newCost =
          newStock > 0
            ? oldStock.gt(0)
              ? round4(
                  oldStock
                    .mul(ingredient.costPerUnit)
                    .plus(new Prisma.Decimal(item.quantity).mul(item.unitCost))
                    .div(newStockDec)
                    .toNumber(),
                )
              : // Prior stock was nonpositive: an average over a negative base
                // is meaningless (and can overflow Decimal(12,4)). Use the
                // receipt cost for the new positive balance instead.
                round4(Number(item.unitCost))
            : Number(ingredient.costPerUnit);

        await tx.ingredient.update({
          where: { id: item.ingredientId },
          data: { currentStock: newStock, costPerUnit: newCost },
        });
        // Keep the in-memory ingredient snapshot current for subsequent
        // lines in this same GRN referencing the same ingredient twice.
        ingredient.currentStock = new Prisma.Decimal(newStock);
        ingredient.costPerUnit = new Prisma.Decimal(newCost);

        if (item.purchaseOrderItemId) {
          receivedByPoItem.set(
            item.purchaseOrderItemId,
            (receivedByPoItem.get(item.purchaseOrderItemId) ?? 0) +
              item.quantity,
          );
        }
      }

      for (const [poItemId, addedQty] of receivedByPoItem) {
        const poItem = purchaseOrder!.items.find((pi) => pi.id === poItemId)!;
        await tx.purchaseOrderItem.update({
          where: { id: poItemId },
          data: {
            quantityReceived: round3(
              Number(poItem.quantityReceived) + addedQty,
            ),
          },
        });
      }

      if (purchaseOrder) {
        const items = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: purchaseOrder.id },
        });
        const fullyReceived = items.every(
          (i) => Number(i.quantityReceived) >= Number(i.quantityOrdered),
        );
        const anyReceived = items.some((i) => Number(i.quantityReceived) > 0);
        await tx.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: {
            status: fullyReceived
              ? 'RECEIVED'
              : anyReceived
                ? 'PARTIALLY_RECEIVED'
                : purchaseOrder.status,
          },
        });
      }

      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: grn.id },
        include: { items: { include: { ingredient: true, stockBatch: true } } },
      });
    });
  }

  private async nextGrnNumber(
    tx: Prisma.TransactionClient,
    branchId: string,
  ): Promise<string> {
    // Count-based allocation raced: two concurrent receipts in one branch could
    // pick the same number and one insert failed with P2002. Lock per branch,
    // then use the highest existing number (not the row count) so deletions
    // cannot cause a collision either.
    // pg_advisory_xact_lock() returns `void`, which $queryRaw cannot
    // deserialize (P2010). Every other advisory lock in the app uses
    // $executeRaw for exactly this reason — a $queryRaw here made *every*
    // goods receipt fail with a 500.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`grn:${branchId}`}))`;
    const last = await tx.goodsReceipt.findFirst({
      where: { branchId },
      orderBy: { grnNumber: 'desc' },
      select: { grnNumber: true },
    });
    const seq = last ? Number(last.grnNumber.split('-')[1] ?? 0) + 1 : 1;
    return `GRN-${String(seq).padStart(4, '0')}`;
  }
}
