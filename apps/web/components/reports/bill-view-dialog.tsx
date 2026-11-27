"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";

interface Bill {
  orderNumber: string;
  type: string;
  status: string;
  billedAt: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  tipAmount: string;
  totalAmount: string;
  guestName: string | null;
  customer: { name: string; phone: string | null } | null;
  table: { number: string; name: string | null } | null;
  createdBy: { name: string } | null;
  items: { id: string; quantity: number; nameSnapshot: string; lineTotal: string; status: string }[];
  payments: { id: string; method: string; amount: string; reference: string | null }[];
  refunds: { id: string; amount: string; method: string; reason: string | null }[];
}

// Read-only view of one bill for people who can see sales reports but cannot take orders (an accountant opening a
// line of the day book). Staff who run the till open the full bill window instead.
export function BillViewDialog({
  branchId,
  orderId,
  onClose,
}: {
  branchId: string | null;
  orderId: string | null;
  onClose: () => void;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "bill", branchId, orderId],
    queryFn: () => api.get<Bill>(`/reports/bills/${orderId}?branchId=${branchId}`),
    enabled: !!branchId && !!orderId,
    retry: false,
  });
  const money = (v: string) => fmt.currency(Number(v));
  return (
    <Dialog open={!!orderId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("Bill")} {data?.orderNumber ?? ""}
            {data && <Badge variant="secondary" className="font-normal">{fmt.code(data.status)}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : error ? (
          <p className="text-sm text-destructive">{error instanceof ApiError ? error.message : t("Could not load this bill")}</p>
        ) : data ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              {data.billedAt ? new Date(data.billedAt).toLocaleString(fmt.localeTag) : t("Not billed")} · {fmt.code(data.type)}
              {data.table && t(" · table {number}", { number: data.table.number })} · {data.guestName ?? data.customer?.name ?? t("Walk-in")}
              {data.createdBy && t(" · billed by {name}", { name: data.createdBy.name })}
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.items.map((i) => (
                <li key={i.id} className="flex justify-between px-3 py-2">
                  <span className={i.status === "CANCELLED" ? "text-muted-foreground line-through" : ""}>{i.quantity}× {i.nameSnapshot}</span>
                  <span className="tabular-nums">{money(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-1 rounded-lg bg-secondary/40 px-3 py-2 tabular-nums">
              <div className="flex justify-between"><dt>{t("Subtotal")}</dt><dd>{money(data.subtotal)}</dd></div>
              {Number(data.discountAmount) > 0 && <div className="flex justify-between"><dt>{t("Discount")}</dt><dd>−{money(data.discountAmount)}</dd></div>}
              {Number(data.taxAmount) > 0 && <div className="flex justify-between"><dt>{t("Tax included")}</dt><dd>{money(data.taxAmount)}</dd></div>}
              {Number(data.tipAmount) > 0 && <div className="flex justify-between"><dt>{t("Tip")}</dt><dd>{money(data.tipAmount)}</dd></div>}
              <div className="flex justify-between font-semibold"><dt>{t("Total")}</dt><dd>{money(data.totalAmount)}</dd></div>
            </dl>
            {data.payments.length > 0 && (
              <p className="text-muted-foreground">{t("Paid: {join}", { join: data.payments.map((p) => `${fmt.code(p.method)} ${money(p.amount)}${p.reference ? ` (${p.reference})` : ""}`).join(" + ") })}</p>
            )}
            {data.refunds.length > 0 && (
              <p className="text-muted-foreground">{t("Refunded: {join}", { join: data.refunds.map((r) => `${money(r.amount)} by ${fmt.code(r.method)}${r.reason ? ` — ${r.reason}` : ""}`).join("; ") })}</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
