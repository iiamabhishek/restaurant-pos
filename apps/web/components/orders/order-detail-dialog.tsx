"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Check, MessageCircle, Pencil, Phone, X } from "lucide-react";
import { useState } from "react";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChannelBadge, TypeBadge } from "@/components/orders/channel-badges";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { CancelOrderDialog, useCanCancelOrders } from "@/components/orders/cancel-order-dialog";
import { DeliveryWhere } from "@/components/orders/delivery-where";
import { EditBillDialog } from "@/components/orders/edit-bill-dialog";
import { DeleteOrdersDialog } from "@/components/orders/delete-orders-dialog";
import { SplitBillDialog } from "@/components/orders/split-bill-dialog";
import { openEntity } from "@/lib/entity-events";
import { ReasonDialog } from "@/components/orders/reason-dialog";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useAcceptOrder, useOrder, useRejectOrder } from "@/hooks/use-orders";
import { cn } from "@/lib/utils";

const CANCEL_SOURCE_LABEL = {
  STAFF: "Cancelled by staff",
  CUSTOMER: "Cancelled at the guest's request",
  KITCHEN_REJECTED: "Rejected by the kitchen",
  ONLINE_DECLINED: "Declined when it came in",
} as const;

export function OrderDetailDialog({
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
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: order, isLoading, isError, error, refetch, isFetching } = useOrder(branchId, open ? orderId : null);
  const accept = useAcceptOrder(branchId);
  const reject = useRejectOrder(branchId);
  const { note, clear: clearNote, toast } = useNoteToast();
  const canCancelRole = useCanCancelOrders();
  const { data: me } = useCurrentUser();
  const canEditRole = hasPermission(me?.user, "orders.edit");
  const canAnswer = hasPermission(me?.user, "orders.accept");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // Same rule as the Orders page: permission AND an admin role; the server re-checks the password.
  const canDeleteFinished =
    hasPermission(me?.user, "orders.delete") && ["OWNER", "ADMINISTRATOR"].includes(me?.user.roleName ?? "");
  const customerName = order?.guestName ?? order?.customer?.name ?? t("Walk-in guest");
  const pending = order?.status === "OPEN" && order?.acceptance === "PENDING";
  const canCancel = order?.status === "OPEN" && !pending;
  const run = (fn: () => Promise<unknown>, done: string) =>
    fn().then(
      () => {
        toast.success(done);
        onOpenChange(false);
      },
      (err: unknown) => toast.error(err instanceof Error ? err.message : t("Something went wrong")),
    );
  const phone = order?.customer?.phone ?? null;
  const waHref = phone
    ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
        `Hi, this is regarding your order #${order?.orderNumber}.`,
      )}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order ? t("Order #{orderNumber}", { orderNumber: order.orderNumber }) : t("Order details")}
            {order && <ChannelBadge channel={order.channel} />}
          </DialogTitle>
        </DialogHeader>
        <StatusNote note={note} onClear={clearNote} />

        {isError ? (
          <QueryError error={error} what={t("this order")} onRetry={() => void refetch()} retrying={isFetching} />
        ) : isLoading || !order ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <TypeBadge type={order.type} />
              <Badge variant="secondary" className="font-normal">
                {pending ? t("Awaiting acceptance") : order.acceptance === "REJECTED" ? t("Rejected") : fmt.code(order.status)}
              </Badge>
              {order.table && (
                <span>{t("Table")} {order.table.name ?? order.table.number}</span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Items")}
              </div>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {item.quantity}× {item.nameSnapshot}
                      </span>
                      {item.modifiers.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {item.modifiers.map((m) => m.nameSnapshot).join(", ")}
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-foreground">
                      {fmt.currency(item.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-lg bg-secondary/40 px-3 py-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t("Subtotal")}</span>
                <span className="tabular-nums">{fmt.currency(order.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t("Tax")}</span>
                <span className="tabular-nums">{fmt.currency(order.taxAmount)}</span>
              </div>
              <div className="flex items-center justify-between font-medium text-foreground">
                <span>{t("Total")}</span>
                <span className="tabular-nums">{fmt.currency(order.totalAmount)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Customer")}
              </div>
              <span className="font-medium text-foreground">{customerName}</span>
              {phone ? (
                <>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" /> {phone}
                  </span>
                  <div className="flex gap-2">
                    <a href={`tel:${phone}`} className={cn(buttonVariants({ size: "sm" }), "flex-1")}>
                      <Phone className="mr-1.5 h-4 w-4" /> {t("Call")}
                    </a>
                    <a
                      href={waHref ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" /> {t("WhatsApp")}
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("No phone number on file.")}</p>
              )}
            </div>

            <DeliveryWhere order={order} />

            {order.notes && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">{t("Note: {notes}", { notes: order.notes })}</p>
            )}

            {pending && canAnswer && (
              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  disabled={accept.isPending}
                  onClick={() => run(() => accept.mutateAsync(order.id), t("Order accepted — sent to the kitchen"))}
                >
                  <Check className="mr-1.5 h-4 w-4" /> {t("Accept order")}
                </Button>
                <Button variant="destructive" className="h-11 flex-1" onClick={() => setDeclineOpen(true)}>
                  <X className="mr-1.5 h-4 w-4" /> {t("Decline")}
                </Button>
              </div>
            )}
            {pending && !canAnswer && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                {t("Waiting for someone with permission to accept or decline orders.")}
              </p>
            )}
            {order.status === "CANCELLED" && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                {fmt.label(CANCEL_SOURCE_LABEL[order.cancelSource ?? "STAFF"])}
                {order.cancelReason ? `: ${order.cancelReason}` : ""}
              </p>
            )}
            {order.status === "PAID" && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                {t("To correct this paid bill, issue a refund from the Dashboard. Bills with payment or refund history stay on record.")}
              </p>
            )}
            {canDeleteFinished && order.payments.length === 0 && (order.status === "PAID" || order.status === "CANCELLED") && (
              <Button variant="outline" className="border-destructive/40 text-destructive" onClick={() => setDeleteOpen(true)}>
                {t("Delete this bill (admin)")}
              </Button>
            )}
            {canCancel && (
              <div className="flex gap-2">
                {canEditRole && (
                  <Button variant="outline" className="flex-1" onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-1.5 h-4 w-4" /> {t("Edit bill")}
                  </Button>
                )}
                {canEditRole && order.type !== "DELIVERY" && order.channel !== "ONLINE" && order.items.length > 0 && (
                  <Button variant="outline" className="flex-1" onClick={() => setSplitOpen(true)}>
                    {t("Split bill")}
                  </Button>
                )}
                {canCancelRole ? (
                  <Button variant="destructive" className="flex-1" onClick={() => setCancelOpen(true)}>
                    <X className="mr-1.5 h-4 w-4" /> {t("Cancel order")}
                  </Button>
                ) : (
                  <p className="flex-1 self-center text-xs text-muted-foreground">
                    {t("Cancelling needs a manager — ask one to cancel this order.")}
                  </p>
                )}
              </div>
            )}
            {order && (
              <>
                <CancelOrderDialog
                  branchId={branchId}
                  orderId={order.id}
                  orderNumber={order.orderNumber}
                  open={cancelOpen}
                  onOpenChange={setCancelOpen}
                  />
                <EditBillDialog branchId={branchId} orderId={order.id} open={editOpen} onOpenChange={setEditOpen} />
                <SplitBillDialog
                  branchId={branchId}
                  orderId={order.id}
                  items={order.items}
                  open={splitOpen}
                  onOpenChange={setSplitOpen}
                  onSplit={(newId) => {
                    setSplitOpen(false);
                    onOpenChange(false);
                    // Open the new bill so it can be paid straight away.
                    openEntity("Order", newId);
                  }}
                />
                <DeleteOrdersDialog
                  branchId={branchId}
                  orderIds={[order.id]}
                  open={deleteOpen}
                  onOpenChange={setDeleteOpen}
                  onDeleted={() => onOpenChange(false)}
                />
                <ReasonDialog
                  open={declineOpen}
                  onOpenChange={setDeclineOpen}
                  title={t("Decline order #{orderNumber}?", { orderNumber: order.orderNumber })}
                  description={t("The guest's order is not made. It stays in History with your reason and name, and nothing is charged.")}
                  reasons={["Closing soon", "Out of stock", "Too busy", "Outside delivery area"].map((reason) => t(reason))}
                  confirmLabel={t("Decline order")}
                  keepLabel={t("Go back")}
                  onSubmit={(reason) =>
                    reject.mutateAsync({ orderId: order.id, reason }).then(() => {
                      toast.success(t("Order declined"));
                      onOpenChange(false);
                    })
                  }
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
