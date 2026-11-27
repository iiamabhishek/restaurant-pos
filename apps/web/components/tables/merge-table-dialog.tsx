"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMergeOrder, useOpenOrders } from "@/hooks/use-orders";
import type { RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function MergeTableDialog({
  branchId,
  table,
  allTables,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  table: RestaurantTable;
  allTables: RestaurantTable[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fmt = useStaffFormat();
  const { t: translate } = useI18n();
  const { data: openOrders } = useOpenOrders(branchId);
  const merge = useMergeOrder(branchId);

  const thisOrder = openOrders?.find((o) => o.tableId === table.id);
  const otherOccupiedTables = allTables.filter(
    (t) => t.id !== table.id && openOrders?.some((o) => o.tableId === t.id),
  );

  const handleMerge = (otherTableId: string) => {
    const otherOrder = openOrders?.find((o) => o.tableId === otherTableId);
    if (!thisOrder || !otherOrder) return;
    merge.mutate(
      { targetOrderId: thisOrder.id, sourceOrderId: otherOrder.id },
      {
        onSuccess: () => {
          toast.success(translate("Merged into {value}", { value: table.name ?? translate("Table {number}", { number: table.number }) }));
          onOpenChange(false);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : translate("Could not merge orders")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {translate("Merge into")} {table.name ?? translate("Table {number}", { number: table.number })}
          </DialogTitle>
        </DialogHeader>

        {!thisOrder ? (
          <p className="py-4 text-sm text-muted-foreground">
            {translate("This table has no open order to merge into.")}
          </p>
        ) : otherOccupiedTables.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {translate("No other tables have an open order right now.")}
          </p>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {otherOccupiedTables.map((t) => {
              const order = openOrders?.find((o) => o.tableId === t.id);
              return (
                <Button
                  key={t.id}
                  variant="outline"
                  className="justify-between"
                  disabled={merge.isPending}
                  onClick={() => handleMerge(t.id)}
                >
                  <span>{t.name ?? translate("Table {number}", { number: t.number })}</span>
                  <span className="text-muted-foreground">
                    {order && fmt.currency(order.totalAmount)}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
