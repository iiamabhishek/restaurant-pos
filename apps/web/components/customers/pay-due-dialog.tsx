"use client";

import { useI18n } from "@/lib/i18n/context";
import { CheckoutPanel } from "@/components/pos/checkout-panel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenOrders } from "@/hooks/use-orders";

/** Records a later payment against one specific outstanding bill, through the normal checkout (same checks, same retry safety). */
export function PayDueDialog({
  branchId,
  orderId,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: orders, isLoading } = useOpenOrders(open ? branchId : null);
  const order = orders?.find((o) => o.id === orderId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Record a payment")}{order ? t(" for bill #{orderNumber}", { orderNumber: order.orderNumber }) : ""}</DialogTitle>
          <DialogDescription>
            {t("Enter what the customer is paying now. Anything left stays on their account.")}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !order ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("This bill is no longer open. It may have been paid or cancelled from another till.")}
          </p>
        ) : (
          <CheckoutPanel
            key={order.id}
            order={order}
            branchId={branchId}
            initialCustomer={order.customer}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
