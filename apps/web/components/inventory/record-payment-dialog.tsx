"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
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
import { PaymentMethodButtons } from "@/components/pos/payment-method-buttons";
import { Label } from "@/components/ui/label";
import { useRecordSupplierPayment, type SupplierInvoice } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

const METHODS = ["CASH", "CARD", "UPI", "BANK_TRANSFER", "WALLET", "OTHER"] as const;

export function RecordPaymentDialog({
  branchId,
  invoice,
}: {
  branchId: string | null;
  invoice: SupplierInvoice;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const remaining = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  const [amount, setAmount] = useState(() => String(remaining));
  const [method, setMethod] = useState<(typeof METHODS)[number]>("CASH");
  const [reference, setReference] = useState("");
  const recordPayment = useRecordSupplierPayment(branchId);

  const canSubmit = Number(amount) > 0 && Number(amount) <= remaining;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    recordPayment.mutate(
      {
        invoiceId: invoice.id,
        dto: { amount: Number(amount), paymentMethod: method, reference: reference || undefined },
      },
      {
        onSuccess: () => {
          toast.success(t("Payment recorded"));
          setOpen(false);
          setReference("");
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("Could not record payment")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">{t("Record payment")}</Button>} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("Record a payment")}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">{t("{invoiceNumber} — {formatCurrency} remaining of {formatCurrency2}", { invoiceNumber: invoice.invoiceNumber, formatCurrency: fmt.currency(remaining), formatCurrency2: fmt.currency(Number(invoice.totalAmount)) })}</p>

          <div className="flex flex-col gap-2">
            <Label>{t("Amount")}</Label>
            <Input
              type="number"
              min="0"
              max={remaining}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("Method")}</Label>
            <PaymentMethodButtons methods={METHODS} value={method} onChange={setMethod} label={t("Payment method")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("Reference")}</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("UTR / cheque no. (optional)")}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || recordPayment.isPending}>
              {recordPayment.isPending ? t("Recording…") : t("Record payment")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
