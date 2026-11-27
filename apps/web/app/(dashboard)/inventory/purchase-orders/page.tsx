"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import Link from "next/link";
import { useState } from "react";
import { StockJournalVoucher } from "@/components/inventory/stock-journal-voucher";
import { Button } from "@/components/ui/button";
import { CreatePoDialog } from "@/components/inventory/create-po-dialog";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { usePurchaseOrders, type PurchaseOrder } from "@/hooks/use-inventory";

const STATUS_VARIANT: Record<PurchaseOrder["status"], "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "secondary",
  SENT: "outline",
  PARTIALLY_RECEIVED: "outline",
  RECEIVED: "default",
  CANCELLED: "destructive",
};

export default function PurchaseOrdersPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { branchId } = useBranch();
  const { data: orders, isLoading } = usePurchaseOrders(branchId);
  const [making, setMaking] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Inventory")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Stock, daily production, purchasing, and food waste")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setMaking(true)}>{t("Manufacturing")}</Button>
          <CreatePoDialog branchId={branchId} />
        </div>
      </div>

      <InventoryTabs />

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : orders && orders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("PO #")}</TableHead>
                <TableHead>{t("Supplier")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead className="text-right">{t("Items")}</TableHead>
                <TableHead className="text-right">{t("Total")}</TableHead>
                <TableHead>{t("Created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((po) => (
                <TableRow key={po.id} className="cursor-pointer" data-href={po.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/purchase-orders/${po.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {po.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{po.supplier.name}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[po.status]}>{fmt.code(po.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{po.items.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt.currency(po.totalAmount)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(po.createdAt).toLocaleDateString(fmt.localeTag)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">{t("No purchase orders yet")}</p>
            <p className="text-sm text-muted-foreground">
              {t("Create one to start tracking what you've ordered from suppliers.")}
            </p>
          </div>
        )}
      </Card>
      {making && <StockJournalVoucher branchId={branchId} open onOpenChange={setMaking} />}
    </div>
  );
}
