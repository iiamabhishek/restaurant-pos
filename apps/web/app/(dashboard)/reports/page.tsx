"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { api, ApiError } from "@/lib/api";
import { localDate, monthToDate } from "@/lib/report-dates";
import { cn } from "@/lib/utils";
import { SchedulesPanel } from "@/components/reports/schedules-panel";
import { openEntity } from "@/lib/entity-events";
import { BillViewDialog } from "@/components/reports/bill-view-dialog";

interface CatalogEntry {
  key: string;
  title: string;
  group: string;
}
interface ReportResult {
  key: string;
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
  totals?: (string | number | null)[];
  rowOrderIds?: string[];
}

const daysAgo = (n: number) => localDate(new Date(Date.now() - n * 86_400_000));
const PRESETS: { label: string; get: () => { from: string; to: string } }[] = [
  { label: "Today", get: () => ({ from: daysAgo(0), to: daysAgo(0) }) },
  { label: "Yesterday", get: () => ({ from: daysAgo(1), to: daysAgo(1) }) },
  { label: "Last 7 days", get: () => ({ from: daysAgo(6), to: daysAgo(0) }) },
  { label: "This month", get: monthToDate },
  { label: "Last 30 days", get: () => ({ from: daysAgo(29), to: daysAgo(0) }) },
  { label: "Last 90 days", get: () => ({ from: daysAgo(89), to: daysAgo(0) }) },
  {
    label: "This year",
    get: () => ({ from: `${new Date().getFullYear()}-01-01`, to: daysAgo(0) }),
  },
  // The server accepts up to five years in one report, so every old invoice is reachable.
  { label: "All time", get: () => ({ from: daysAgo(1829), to: daysAgo(0) }) },
];
const MONEY_COLS = /sales|tax|discount|tips|total|amount|refund|revenue|cost|margin|value|price/i;
function reportCell(fmt: StaffFormat, value: string | number | null, column: string) {
  if (typeof value === "number") {
    if (["Bill no.", "Order", "Table"].includes(column)) return value;
    return fmt.number(value, MONEY_COLS.test(column) ? 2 : undefined);
  }
  const billCount = column === "Bill no." && value?.match(/^(\d+) bills(?: \(first (\d+) only - narrow the dates\))?$/);
  if (billCount) {
    const count = fmt.number(Number(billCount[1]));
    return billCount[2]
      ? fmt.label("{count} bills (first {limit} only - narrow the dates)", { count, limit: fmt.number(Number(billCount[2])) })
      : fmt.label("{count} bills", { count });
  }
  if (column === "Date" && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return fmt.day(value);
  if (column === "Month" && value && /^\d{4}-\d{2}$/.test(value)) return fmt.day(value + "-01", { month: "long", year: "numeric" });
  if (value && ["Day", "Status", "Method", "Reason", "Type"].includes(column)) return fmt.code(value.toUpperCase().replaceAll(" ", "_"));
  if (value && column === "Unit") return fmt.unit(value);
  if (value && column === "Paid by") return value.split(" + ").map(fmt.code).join(" + ");
  return value ?? "—";
}

export default function ReportsPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canExport = hasPermission(me?.user, "data.export");
  const [key, setKey] = useState("sales-daily");
  const [find, setFind] = useState("");
  const [viewBill, setViewBill] = useState<string | null>(null);
  const canTakeOrders = hasPermission(me?.user, "orders.create");
  const [range, setRange] = useState(() => ({
    from: daysAgo(6),
    to: daysAgo(0),
  }));

  const { data: catalog } = useQuery({
    queryKey: ["reports", "catalog"],
    queryFn: () => api.get<CatalogEntry[]>("/reports"),
  });
  const qs = `branchId=${branchId}&from=${range.from}&to=${range.to}`;
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", key, branchId, range.from, range.to],
    queryFn: () => api.get<ReportResult>(`/reports/${key}?${qs}`),
    enabled: !!branchId && range.from <= range.to,
    retry: false,
  });

  const groups = [...new Set(catalog?.map((c) => c.group))];

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Reports")}</h1>
        <p className="text-sm text-muted-foreground">{t("Pick a day or range, open any bill, then print or export to Excel, PDF or CSV")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-4 print:hidden" aria-label={t("Reports")}>
          {groups.map((g) => (
            <div key={g} className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{fmt.label(g)}</p>
              {catalog
                ?.filter((c) => c.group === g)
                .map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setKey(c.key)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                      key === c.key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
                    )}
                  >
                    {fmt.label(c.title)}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2 print:hidden">
            {PRESETS.map((p) => {
              const r = p.get();
              const on = r.from === range.from && r.to === range.to;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {t(p.label)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Input aria-label={t("Report from date")} type="date" className="w-40" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <Input aria-label={t("Report to date")} type="date" className="w-40" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            {data?.rowOrderIds && (
              <Input aria-label={t("Find a bill")} placeholder={t("Find bill, customer, payment…")} className="w-56" value={find} onChange={(e) => setFind(e.target.value)} />
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> {t("Print")}
            </Button>
            {canExport &&
              (["xlsx", "pdf", "csv"] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/v1/reports/${key}/export?${qs}&format=${f}`}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-secondary"
                >
                  <Download className="mr-2 h-4 w-4" /> {f === "xlsx" ? t("Excel") : f.toUpperCase()}
                </a>
              ))}
          </div>

          <Card className="overflow-x-auto p-4">
            <h2 className="mb-3 text-lg font-semibold text-foreground">{fmt.label(data?.title ?? catalog?.find((c) => c.key === key)?.title ?? "")}</h2>
            <p className="mb-3 hidden text-xs text-muted-foreground print:block">{t("{from} to {to}", { from: fmt.day(range.from), to: fmt.day(range.to) })}</p>
            {isLoading ? (
              <Skeleton className="h-32" />
            ) : error ? (
              <p className="text-sm text-destructive">{error instanceof ApiError ? error.message : t("Could not load report")}</p>
            ) : data && data.rows.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c} className="py-1 pr-4 font-medium">{fmt.label(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => {
                    const orderId = data.rowOrderIds?.[i];
                    if (find.trim() && orderId && !r.some((c) => String(c ?? "").toLowerCase().includes(find.trim().toLowerCase()))) return null;
                    const dayDrill = key === "sales-daily" && typeof r[0] === "string";
                    const go = () => {
                      if (orderId) {
                        if (canTakeOrders) openEntity("Order", orderId);
                        else setViewBill(orderId);
                      }
                      else if (dayDrill) {
                        setKey("invoices");
                        setRange({ from: String(r[0]), to: String(r[0]) });
                      }
                    };
                    const clickable = !!orderId || dayDrill;
                    return (
                      <tr
                        key={i}
                        className={cn("border-t border-border", clickable && "cursor-pointer hover:bg-secondary/50")}
                        {...(clickable
                          ? {
                              onClick: go,
                              tabIndex: 0,
                              role: "button",
                              "aria-label": orderId ? t("Open bill {value}", { value: (r[2]) ?? "" }) : t("Show every bill on {value}", { value: (r[0]) ?? "" }),
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  go();
                                }
                              },
                            }
                          : {})}
                      >
                        {r.map((cell, j) => (
                          <td key={j} className="py-1.5 pr-4 tabular-nums">{reportCell(fmt, cell, data.columns[j])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                {data.totals && (
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      {data.totals.map((cell, j) => (
                        <td key={j} className="py-2 pr-4 tabular-nums">{j === 0 && cell === "Total" ? t("Total") : reportCell(fmt, cell, data.columns[j])}</td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("No data for this period.")}</p>
            )}
          </Card>

          <BillViewDialog branchId={branchId} orderId={viewBill} onClose={() => setViewBill(null)} />

          {canExport && (
            <SchedulesPanel
              branchId={branchId}
              reportKey={key}
              titles={Object.fromEntries((catalog ?? []).map((c) => [c.key, fmt.label(c.title)]))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
