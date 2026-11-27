"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { ArrowLeft, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PayDueDialog } from "@/components/customers/pay-due-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useDues, type DueRow, type DuesStatus } from "@/hooks/use-dues";
import { useDisplaySettings } from "@/hooks/use-settings";
import { buildReminderLink } from "@/lib/dues";

const STATUS_OPTIONS: { value: DuesStatus; label: string }[] = [
  { value: "OUTSTANDING", label: "Everything owed" },
  { value: "UNPAID", label: "Unpaid (nothing paid yet)" },
  { value: "PARTIAL", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
];

const BADGE: Record<DueRow["status"], string> = {
  UNPAID: "bg-destructive/10 text-destructive",
  PARTIAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};
const BADGE_LABEL: Record<DueRow["status"], string> = { UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid" };

const fieldClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const day = (fmt: StaffFormat, iso: string) => new Date(iso).toLocaleDateString(fmt.localeTag, { day: "numeric", month: "short", year: "numeric" });

export default function CustomerDuesPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { branchId } = useBranch();
  const [status, setStatus] = useState<DuesStatus>("OUTSTANDING");
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paying, setPaying] = useState<string | null>(null);

  const { data, isLoading, isError, error, isFetching, refetch } = useDues(branchId, { status, customerId, from, to });
  // The customer dropdown always lists everyone who currently owes, whatever else is filtered.
  const { data: owing } = useDues(branchId, { status: "OUTSTANDING", customerId: "", from: "", to: "" });
  const { data: display } = useDisplaySettings(branchId);
  const restaurantName = display?.restaurant.name ?? null;
  const showPaid = status === "PAID";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("Customers")}
        </Link>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Customer dues")}</h1>
        <p className="text-sm text-muted-foreground">{t("Who still owes money, on which bill, and what they have paid so far.")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">{t("Total outstanding")}</p>
          <p className="text-2xl font-semibold tabular-nums">{fmt.currency(owing?.totalOutstanding ?? 0)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">{t("Customers who owe")}</p>
          <p className="text-2xl font-semibold tabular-nums">{owing?.customers.length ?? 0}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("Status")}</span>
          <select className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value as DuesStatus)}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{t(o.label)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("Customer")}</span>
          <select className={fieldClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">{t("All customers")}</option>
            {owing?.customers.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {c.name ?? t("Unnamed")} {t("· owes {currency}", { currency: fmt.currency(c.owed) })}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("From")}</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("To")}</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        {(customerId || from || to || status !== "OUTSTANDING") && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setStatus("OUTSTANDING"); setCustomerId(""); setFrom(""); setTo(""); }}>
            {t("Clear filters")}
          </Button>
        )}
      </div>

      {isError ? (
        <QueryError error={error} what={t("customer dues")} retrying={isFetching} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : !data || data.rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {showPaid ? t("No paid bills match these filters.") : t("No one owes anything for these filters.")}
        </Card>
      ) : (
        <Card className="flex flex-col divide-y divide-border p-0">
          {data.rowsTruncated && (
            <p role="status" className="p-3 text-sm text-muted-foreground">{t("Showing the oldest {count} of {totalCount} bills. The total above and the customer list include all of them; narrow the dates or pick a customer to see the rest.", { count: data.rows.length, totalCount: (data.totalCount) ?? "" })}</p>
          )}
          {data.rows.map((r) => {
            const reminder = buildReminderLink({
              customerName: r.customer.name,
              phone: r.customer.phone,
              orderNumber: r.orderNumber,
              balance: r.balance,
              balanceText: fmt.currency(r.balance),
              restaurantName,
            });
            return (
              <div key={r.orderId} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {r.customer.name ?? t("Unnamed customer")}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{fmt.label(BADGE_LABEL[r.status])}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{t("Bill #{orderNumber} · {code} · {day}", { orderNumber: r.orderNumber, code: fmt.code(r.type), day: day(fmt, r.createdAt) })}{r.customer.phone ? ` · ${r.customer.phone}` : t(" · no phone saved")}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    {showPaid ? (
                      <p className="font-semibold">{t("{formatCurrency} paid", { formatCurrency: fmt.currency(r.total) })}</p>
                    ) : (
                      <>
                        <p className="text-lg font-semibold">{t("{formatCurrency} due", { formatCurrency: fmt.currency(r.balance) })}</p>
                        <p className="text-xs text-muted-foreground">{t("of {formatCurrency} · paid {formatCurrency2}", { formatCurrency: fmt.currency(r.total), formatCurrency2: fmt.currency(r.paid) })}</p>
                      </>
                    )}
                  </div>
                </div>

                {r.payments.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{t("Payment history ({count})", { count: r.payments.length })}</summary>
                    <ul className="mt-2 flex flex-col gap-1 pl-1">
                      {r.payments.map((p) => (
                        <li key={p.id} className="flex justify-between gap-3 tabular-nums">
                          <span>{day(fmt, p.at)} · {fmt.code(p.method)}</span>
                          <span>{fmt.currency(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {!showPaid && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" onClick={() => setPaying(r.orderId)}>
                      {t("Record payment")}
                    </Button>
                    {reminder.ok ? (
                      <a
                        href={reminder.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm hover:bg-secondary"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> {t("Remind on WhatsApp")}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{reminder.reason}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <PayDueDialog branchId={branchId} orderId={paying} open={paying !== null} onOpenChange={(o) => !o && setPaying(null)} />
    </div>
  );
}
