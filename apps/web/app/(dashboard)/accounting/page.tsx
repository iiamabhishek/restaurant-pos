"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { ReasonDialog } from "@/components/orders/reason-dialog";
import { PettyCashTab } from "@/components/accounting/petty-cash-tab";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusNote, useStatusNote } from "@/components/ui/status-note";
import {
  useAccountingActions,
  useBranchOverview,
  useClosingPreview,
  useClosings,
  usePhoneTills,
  useExpenses,
  useMyExpenses,
  usePendingExpenses,
  useGst,
  useProfitLoss,
} from "@/hooks/use-accounting";
import { useBranch } from "@/hooks/use-branch";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BalanceSheetTab, BankTab, BudgetsTab } from "@/components/accounting/finance-tabs";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const TABS = ["expenses", "petty cash", "cash close", "profit & loss", "balance sheet", "budgets", "bank", "gst", "branches"] as const;
type Tab = (typeof TABS)[number];

function monthRange() {
  const now = new Date();
  return {
    from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    to: iso(now),
  };
}

function RangePicker({
  range,
  onChange,
}: {
  range: { from: string; to: string };
  onChange: (r: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex gap-2">
      <Input type="date" className="w-40" value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })} />
      <Input type="date" className="w-40" value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between py-1.5 text-sm", strong && "border-t border-border font-semibold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: "Awaiting approval",
  REJECTED: "Rejected",
};

function Expenses({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const canManage = hasPermission(me?.user, "accounting.manage");
  const canApprove = hasPermission(me?.user, "expenses.approve");
  const [range, setRange] = useState(monthRange);
  const all = useExpenses(branchId, range.from, range.to);
  const mine = useMyExpenses(branchId);
  const pending = usePendingExpenses(branchId, canApprove);
  const { data, isLoading } = canManage ? all : mine;
  const { addExpense, deleteExpense, decideExpense } = useAccountingActions(branchId);
  const [f, setF] = useState({ spentOn: iso(new Date()), category: "", amount: "", note: "", paidFromCash: false });
  // One key per attempt, renewed after success: a double tap or retry never adds a second expense.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [rejecting, setRejecting] = useState<string | null>(null);
  const total = data?.filter((e) => e.status === "APPROVED").reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const { note: status, show, clear } = useStatusNote();

  const submit = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const amount = Number(f.amount);
    if (!f.category.trim() || !(amount > 0)) return show("error", t("Enter a category and an amount"));
    addExpense.mutate(
      { spentOn: f.spentOn, category: f.category.trim(), amount, note: f.note || undefined, paidFromCash: f.paidFromCash, clientRequestId: key },
      {
        onSuccess: (r) => {
          const waiting = (r as { status?: string })?.status === "PENDING";
          show("success", waiting ? t("Expense of {currency} sent for approval.", { currency: fmt.currency(amount) }) : t("Expense of {currency} added.", { currency: fmt.currency(amount) }));
          setF({ ...f, category: "", amount: "", note: "" });
          setKey(crypto.randomUUID());
        },
        onError: (e) => show("error", errMsg(e, t("Something went wrong"))),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {canApprove && pending.data && pending.data.length > 0 && (
        <Card className="flex flex-col divide-y divide-border p-2">
          <h3 className="px-4 py-2 text-sm font-medium text-foreground">{t("Waiting for your approval ({count})", { count: pending.data.length })}</h3>
          {pending.data.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{e.category}</span>
                <span className="text-muted-foreground">
                  {" "}· {fmt.day(e.spentOn)} · {e.createdBy?.name}
                  {e.note && ` · ${e.note}`}
                  {e.paidFromCash && t(" · till")}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{fmt.currency(e.amount)}</span>
                <Button size="sm" disabled={decideExpense.isPending} onClick={() => decideExpense.mutate({ id: e.id, approve: true }, { onError: (err) => show("error", errMsg(err, t("Something went wrong"))) })}>
                  {t("Approve")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(e.id)}>{t("Reject")}</Button>
              </span>
            </div>
          ))}
        </Card>
      )}
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={t("Reject this expense?")}
        description={t("The person who submitted it sees your reason. It does not count anywhere.")}
        reasons={["No receipt", "Not a business cost", "Amount looks wrong", "Duplicate"].map((reason) => t(reason))}
        confirmLabel={t("Reject expense")}
        keepLabel={t("Go back")}
        onSubmit={(reason) =>
          decideExpense.mutateAsync({ id: rejecting as string, approve: false, note: reason }).then(() => setRejecting(null))
        }
      />
      <form onSubmit={submit} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label={t("Expense date")} type="date" value={f.spentOn} onChange={(e) => setF({ ...f, spentOn: e.target.value })} />
        <Input aria-label={t("Expense category")} placeholder={t("Category (Rent, Supplies…)")} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <Input aria-label={t("Expense amount")} placeholder={t("Amount")} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input aria-label={t("Expense note")} placeholder={t("Note")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.paidFromCash} onChange={(e) => setF({ ...f, paidFromCash: e.target.checked })} />
          {t("Paid from till")}
        </label>
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="submit" disabled={addExpense.isPending}>{canApprove ? t("Add expense") : t("Submit for approval")}</Button>
        </div>
        <div className="sm:col-span-2 lg:col-span-5"><StatusNote note={status} onClear={clear} /></div>
      </form>
      {canManage && <RangePicker range={range} onChange={setRange} />}
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : data && data.length > 0 ? (
          <>
            {data.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{e.category}</span>
                  <span className="text-muted-foreground"> · {fmt.day(e.spentOn)}{e.note && ` · ${e.note}`}{e.paidFromCash && t(" · till")}{e.status === "REJECTED" && e.decisionNote && ` · ${e.decisionNote}`}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {e.status !== "APPROVED" && (
                    <Badge variant={e.status === "PENDING" ? "outline" : "secondary"} className={e.status === "PENDING" ? "border-warning font-normal text-warning" : "font-normal"}>
                      {fmt.label(STATUS_BADGE[e.status])}
                    </Badge>
                  )}
                  <span className="tabular-nums">{fmt.currency(e.amount)}</span>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => deleteExpense.mutate(e.id, { onError: (err) => toast.error(errMsg(err, t("Something went wrong"))) })}>
                      {t("Delete")}
                    </Button>
                  )}
                </span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-2.5 text-sm font-semibold">
              <span>{t("Total (approved)")}</span>
              <span>{fmt.currency(total)}</span>
            </div>
          </>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{canManage ? t("No expenses in this range.") : t("You have not submitted any expenses.")}</p>
        )}
      </Card>
    </div>
  );
}

function CashClose({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t: translate } = useI18n();
  const [date, setDate] = useState(() => iso(new Date()));
  const [floor, setFloor] = useState("0");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const { data: preview } = useClosingPreview(branchId, date, Number(floor) || 0);
  const { data: closings } = useClosings(branchId);
  const { data: phoneTills } = usePhoneTills(branchId);
  const { closeDay } = useAccountingActions(branchId);
  const { note: status, show, clear } = useStatusNote();
  const variance = preview && counted !== "" ? Number(counted) - preview.expectedCash : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-3">
          <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input className="w-40" inputMode="decimal" placeholder={translate("Opening float")} value={floor} onChange={(e) => setFloor(e.target.value)} />
        </div>
        {preview && (
          <div>
            <Row label={translate("Opening float")} value={fmt.currency(preview.openingFloat)} />
            <Row label={translate("Cash sales (net of cash refunds)")} value={fmt.currency(preview.cashSales)} />
            <Row label={translate("Cash expenses")} value={`− ${fmt.currency(preview.cashExpenses)}`} />
            <Row strong label={translate("Expected in till")} value={fmt.currency(preview.expectedCash)} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Input className="w-40" inputMode="decimal" placeholder={translate("Counted cash")} value={counted} onChange={(e) => setCounted(e.target.value)} />
          {variance != null && (
            <span className={cn("text-sm", variance === 0 ? "text-success" : "text-destructive")}>
              {variance === 0 ? translate("Balanced") : translate("{value} by {formatCurrency}", { value: variance > 0 ? translate("Over") : translate("Short"), formatCurrency: fmt.currency(Math.abs(variance)) })}
            </span>
          )}
        </div>
        <Input placeholder={translate("Note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
        <div>
          <Button
            disabled={counted === "" || closeDay.isPending}
            onClick={() =>
              closeDay.mutate(
                { businessDate: date, openingFloat: Number(floor) || 0, countedCash: Number(counted), note: note || undefined },
                { onSuccess: () => { show("success", translate("Day {date} closed.", { date })); setCounted(""); setNote(""); }, onError: (e) => show("error", errMsg(e, translate("Something went wrong"))) },
              )
            }
          >
            {translate("Close day")}
          </Button>
        </div>
        <StatusNote note={status} onClear={clear} />
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {closings && closings.length > 0 ? (
          closings.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{fmt.day(c.businessDate)}</span>
              <span className="text-muted-foreground">{translate("expected {formatCurrency} · counted {formatCurrency2} · variance {formatCurrency3}", { formatCurrency: fmt.currency(c.expectedCash), formatCurrency2: fmt.currency(c.countedCash), formatCurrency3: fmt.currency(c.variance) })}</span>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{translate("No closed days yet.")}</p>
        )}
      </Card>
      {phoneTills && phoneTills.length > 0 && (
        <section aria-labelledby="phone-tills" className="flex flex-col gap-2">
          <h2 id="phone-tills" className="text-sm font-semibold">{translate("Phone tills")}</h2>
          <p className="text-xs text-muted-foreground">{translate("Each phone's own cash drawer, counted at the end of its day in the phone app. Their cash is already part of the branch figures above.")}</p>
          <Card className="overflow-x-auto p-2">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{translate("Day")}</th>
                  <th className="px-3 py-2 font-medium">{translate("Phone")}</th>
                  <th className="px-3 py-2 font-medium">{translate("Counted by")}</th>
                  <th className="px-3 py-2 text-right font-medium">{translate("Expected")}</th>
                  <th className="px-3 py-2 text-right font-medium">{translate("Counted")}</th>
                  <th className="px-3 py-2 text-right font-medium">{translate("Difference")}</th>
                </tr>
              </thead>
              <tbody>
                {phoneTills.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{t.businessDate}</td>
                    <td className="px-3 py-2">{t.deviceName}</td>
                    <td className="px-3 py-2">{t.closedByName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.currency(t.expectedCash)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.currency(t.countedCash)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", t.variance === 0 ? "text-success" : "text-destructive")}>
                      {t.variance === 0 ? translate("Matches") : `${t.variance > 0 ? "Over" : "Short"} ${fmt.currency(Math.abs(t.variance))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}

function ProfitLossTab({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [range, setRange] = useState(monthRange);
  const { data } = useProfitLoss(branchId, range.from, range.to);
  return (
    <div className="flex flex-col gap-4">
      <RangePicker range={range} onChange={setRange} />
      <Card className="p-4">
        {data ? (
          <div>
            <Row label={t("Collected from {orders} paid orders (excl. tips)", { orders: data.orders })} value={fmt.currency(data.grossCollected)} />
            <Row label={t("Tax collected")} value={`− ${fmt.currency(data.taxCollected)}`} />
            <Row label={t("Refunds")} value={`− ${fmt.currency(data.refunds)}`} />
            <Row strong label={t("Net sales")} value={fmt.currency(data.netSales)} />
            {data.expenses.map((e) => (
              <Row key={e.category} label={e.category} value={`− ${fmt.currency(e.amount)}`} />
            ))}
            <Row label={t("Payroll (finalized runs)")} value={`− ${fmt.currency(data.payrollCost)}`} />
            <Row strong label={t("Net profit")} value={fmt.currency(data.netProfit)} />
          </div>
        ) : (
          <Skeleton className="h-32" />
        )}
      </Card>
    </div>
  );
}

function GstTab({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [range, setRange] = useState(monthRange);
  const { data } = useGst(branchId, range.from, range.to);
  return (
    <div className="flex flex-col gap-4">
      <RangePicker range={range} onChange={setRange} />
      <Card className="overflow-x-auto p-4">
        {data ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">{t("Rate")}</th><th>{t("Taxable value")}</th><th>{t("Tax")}</th><th className="text-right">{t("Total")}</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.ratePercent} className="border-t border-border">
                  <td className="py-1.5">{r.ratePercent}%</td>
                  <td>{fmt.currency(r.taxableValue)}</td>
                  <td>{fmt.currency(r.tax)}</td>
                  <td className="text-right">{fmt.currency(r.total)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5">{t("Total")}</td>
                <td>{fmt.currency(data.totalTaxable)}</td>
                <td>{fmt.currency(data.totalTax)}</td>
                <td className="text-right">{fmt.currency(data.totalTaxable + data.totalTax)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Skeleton className="h-24" />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Based on paid orders in the range, with each bill’s discounts applied pro-rata. Use it as a working summary; have your accountant confirm filings.")}
        </p>
      </Card>
    </div>
  );
}

function BranchesTab() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [range, setRange] = useState(monthRange);
  const { data } = useBranchOverview(range.from, range.to);
  return (
    <div className="flex flex-col gap-4">
      <RangePicker range={range} onChange={setRange} />
      <Card className="overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1">{t("Branch")}</th><th>{t("Orders")}</th><th>{t("Sales")}</th><th>{t("Open")}</th><th>{t("Low stock")}</th><th className="text-right">{t("Inventory value")}</th></tr>
          </thead>
          <tbody>
            {data?.map((b) => (
              <tr key={b.branchId} className="border-t border-border">
                <td className="py-1.5">{b.name}</td>
                <td>{b.orders}</td>
                <td>{fmt.currency(b.sales)}</td>
                <td>{b.openOrders}</td>
                <td>{b.lowStockItems}</td>
                <td className="text-right">{fmt.currency(b.inventoryValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function AccountingPage() {
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const [tab, setTab] = useState<Tab>("expenses");
  const { data: me } = useCurrentUser();
  // Someone who may only submit expenses sees just that tab; the rest of accounting needs accounting.manage.
  const visible = TABS.filter((t) =>
    t === "expenses" ? true : t === "petty cash" ? hasPermission(me?.user, "pettycash.manage") : hasPermission(me?.user, "accounting.manage"),
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Accounting")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Expenses, cash close, profit & loss, balance sheet, budgets, bank reconciliation, tax and branches")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs capitalize transition-colors",
              tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {translate(t)}
          </button>
        ))}
      </div>
      {tab === "expenses" && <Expenses branchId={branchId} />}
      {tab === "petty cash" && <PettyCashTab branchId={branchId} />}
      {tab === "cash close" && <CashClose branchId={branchId} />}
      {tab === "profit & loss" && <ProfitLossTab branchId={branchId} />}
      {tab === "balance sheet" && <BalanceSheetTab branchId={branchId} />}
      {tab === "budgets" && <BudgetsTab branchId={branchId} />}
      {tab === "bank" && <BankTab branchId={branchId} />}
      {tab === "gst" && <GstTab branchId={branchId} />}
      {tab === "branches" && <BranchesTab />}
    </div>
  );
}
