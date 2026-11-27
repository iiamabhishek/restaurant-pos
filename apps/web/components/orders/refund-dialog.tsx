"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { PaymentMethodButtons } from "@/components/pos/payment-method-buttons";
import type { PaymentMethodDto } from "@nodedr-restaurant/types";
import { RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRefundOrder } from "@/hooks/use-orders";
import { useGatewayRefund, useOrderGatewayPayments } from "@/hooks/use-payment-gateways";
import { fromMinorUnits } from "@/lib/money-units";
import { api, ApiError } from "@/lib/api";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "OTHER", "STORE_CREDIT"];

export function RefundDialog({
  branchId,
  orderId,
  orderNumber,
  maxAmount,
}: {
  branchId: string | null;
  orderId: string;
  orderNumber: string;
  maxAmount: number;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rawAmount, setAmount] = useState(String(maxAmount));
  const [method, setMethod] = useState<PaymentMethodDto>("CASH");
  const [reason, setReason] = useState("");
  const refund = useRefundOrder(branchId);
  const gatewayRefund = useGatewayRefund(branchId);
  // An online payment that can be sent back to the customer's own card/UPI.
  const gw = useOrderGatewayPayments(branchId, orderId, open);
  const online = gw.data?.find((p) => p.refundableMinor > 0) ?? null;
  const [viaGateway, setViaGateway] = useState(true);
  const useGateway = !!online && viaGateway;
  const onlineMax = online ? fromMinorUnits(online.refundableMinor, online.currency) : 0;
  const effectiveMax = useGateway ? Math.min(maxAmount, onlineMax) : maxAmount;
  // The prefilled full amount can exceed what the original online payment can still return; clamp it so the
  // form never starts in a state the browser silently refuses to submit.
  const amount = Number(rawAmount) > effectiveMax ? String(effectiveMax) : rawAmount;
  const pending = refund.isPending || gatewayRefund.isPending;
  // Units physically handed back; only these go back into stock.
  const [returned, setReturned] = useState<Record<string, number>>({});
  const { data: order } = useQuery({
    queryKey: ["orders", "refund-items", branchId, orderId],
    queryFn: () => api.get<{ items: { id: string; nameSnapshot: string; quantity: number }[] }>(`/orders/${orderId}?branchId=${branchId}`),
    enabled: open && !!branchId,
  });

  const returnedItems = () =>
    Object.entries(returned)
      .filter(([, quantity]) => quantity > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (useGateway && online) {
      gatewayRefund.mutate(
        { paymentId: online.id, amount: Number(amount), reason: reason || undefined, returnedItems: returnedItems() },
        {
          onSuccess: () => {
            toast.success(t("Sent {amount} back to the customer's original payment on order #{orderNumber}", { amount, orderNumber }));
            setOpen(false);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Refund failed")),
        },
      );
      return;
    }
    refund.mutate(
      {
        orderId,
        dto: {
          amount: Number(amount),
          method,
          reason: reason || undefined,
          returnedItems: Object.entries(returned)
            .filter(([, quantity]) => quantity > 0)
            .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        },
      },
      {
        onSuccess: () => {
          toast.success(t("Refunded {amount} on order #{orderNumber}", { amount, orderNumber }));
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Refund failed")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={t("Refund order {orderNumber}", { orderNumber })} title={t("Refund")} className="h-8 w-8 text-muted-foreground hover:text-destructive">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("Refund order #{orderNumber}", { orderNumber })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-amount">{t("Amount (max {effectiveMax})", { effectiveMax })}</Label>
            <Input
              id="refund-amount"
              type="number"
              min="0"
              max={effectiveMax}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </div>
          {online && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="refund-via-gw" className="font-medium">{t("Send it back to the customer's original payment")}</Label>
                  <p className="text-xs text-muted-foreground">{t("{provider} · up to {formatCurrency} of this online payment can still be refunded. It reaches the customer in the provider's normal refund time.", { provider: online.provider, formatCurrency: fmt.currency(onlineMax, online.currency) })}</p>
                </div>
                <Switch id="refund-via-gw" checked={viaGateway} onCheckedChange={setViaGateway} />
              </div>
              {useGateway && <p className="text-xs text-muted-foreground">{t("This is sent once and cannot be recalled. It is recorded here only after the provider accepts it.")}</p>}
            </div>
          )}
          {!useGateway && (
            <div className="flex flex-col gap-2">
              <Label>{t("Refund method")}</Label>
              <PaymentMethodButtons methods={METHODS} value={method} onChange={setMethod} label={t("Refund method")} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-reason">{t("Reason (optional)")}</Label>
            <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {order && order.items.length > 0 && (
            <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">{t("Returned to stock")}</legend>
              <p className="text-xs text-muted-foreground">
                {t("A refund alone does not change stock. Enter only the units that physically came back and can be reused.")}
              </p>
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <Label htmlFor={`ret-${item.id}`} className="min-w-0 flex-1 truncate">
                    {item.nameSnapshot} <span className="text-muted-foreground">{t("(sold {quantity})", { quantity: item.quantity })}</span>
                  </Label>
                  <Input
                    id={`ret-${item.id}`}
                    type="number"
                    min="0"
                    max={item.quantity}
                    step="1"
                    className="h-9 w-20"
                    value={returned[item.id] ?? 0}
                    onChange={(e) =>
                      setReturned({ ...returned, [item.id]: Math.max(0, Math.min(item.quantity, Math.floor(Number(e.target.value) || 0))) })
                    }
                  />
                </div>
              ))}
            </fieldset>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? t("Refunding…") : useGateway ? t("Refund {amount} to the original payment", { amount }) : t("Issue refund")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
