"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { StockJournalVoucher } from "@/components/inventory/stock-journal-voucher";
import { toast } from "@/lib/toast";
import { ReceivePoDialog } from "@/components/inventory/receive-po-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import {
  usePurchaseOrder,
  useUpdatePurchaseOrderStatus,
  type PurchaseOrderDetail,
} from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { id } = use(params);
  const { branchId } = useBranch();
  const { data: po, isLoading, isError, error, refetch, isFetching } = usePurchaseOrder(branchId, id);
  const updateStatus = useUpdatePurchaseOrderStatus(branchId);
  const [making, setMaking] = useState(false);

  if (isError) {
    return <QueryError error={error} what={t("this purchase order")} onRetry={() => void refetch()} retrying={isFetching} />;
  }
  if (isLoading || !po) {
    return <Skeleton className="h-96 rounded-2xl" />;
  }

  const send = () =>
    updateStatus.mutate(
      { id: po.id, status: "SENT" },
      {
        onSuccess: () => toast.success(t("Marked as sent to supplier")),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not update")),
      },
    );

  const cancel = () =>
    updateStatus.mutate(
      { id: po.id, status: "CANCELLED" },
      {
        onSuccess: () => toast.success(t("Purchase order cancelled")),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not update")),
      },
    );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/inventory/purchase-orders"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("Purchase orders")}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{po.poNumber}</h1>
          <Badge>{fmt.code(po.status)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("{name} · created by {name2} on {toLocaleDateString}", { name: po.supplier.name, name2: po.createdBy.name, toLocaleDateString: new Date(po.createdAt).toLocaleDateString(fmt.localeTag) })}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {po.status === "DRAFT" && (
          <Button size="sm" onClick={send} disabled={updateStatus.isPending}>
            {t("Mark as sent")}
          </Button>
        )}
        {(po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && (
          <ReceivePoDialog branchId={branchId} po={po} />
        )}
        {po.status !== "CANCELLED" && (
          <Button size="sm" variant="outline" onClick={() => setMaking(true)}>{t("Manufacturing")}</Button>
        )}
        {(po.status === "DRAFT" || po.status === "SENT") && (
          <Button size="sm" variant="outline" onClick={cancel} disabled={updateStatus.isPending}>
            {t("Cancel order")}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Ingredient")}</TableHead>
              <TableHead className="text-right">{t("Ordered")}</TableHead>
              <TableHead className="text-right">{t("Received")}</TableHead>
              <TableHead className="text-right">{t("Cost / unit")}</TableHead>
              <TableHead className="text-right">{t("Line total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-foreground">
                  {item.ingredient?.name ?? item.ingredientId}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantityOrdered} {item.ingredient?.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantityReceived} {item.ingredient?.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmt.currency(item.unitCost)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt.currency(Number(item.quantityOrdered) * Number(item.unitCost))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t("Total")}</span>
          <span className="font-semibold text-foreground">{fmt.currency(po.totalAmount)}</span>
        </div>
      </Card>

      {po.goodsReceipts.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[18px] font-medium text-foreground">{t("Goods receipts")}</h2>
          <div className="flex flex-col divide-y divide-border">
            {po.goodsReceipts.map((grn: PurchaseOrderDetail["goodsReceipts"][number]) => (
              <div key={grn.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{grn.grnNumber}</span>
                  <span className="text-xs text-muted-foreground">{t("Received by {name} on {toLocaleDateString}", { name: grn.receivedBy.name, toLocaleDateString: new Date(grn.receivedAt).toLocaleDateString(fmt.localeTag) })}</span>
                </div>
                <span className="text-muted-foreground">{t("{count} line item(s)", { count: grn.items.length })}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {making && (
        <StockJournalVoucher
          branchId={branchId}
          open
          onOpenChange={setMaking}
          context={{
            poId: po.id,
            poNumber: po.poNumber,
            supplier: po.supplier.name,
            batchRef: po.poNumber,
            narration: `Manufacturing from ${po.poNumber} (${po.supplier.name})`,
            sourceIds: po.items.filter((i) => Number(i.quantityReceived) > 0).map((i) => i.ingredientId),
          }}
        />
      )}
    </div>
  );
}
