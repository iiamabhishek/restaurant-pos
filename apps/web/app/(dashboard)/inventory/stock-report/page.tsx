"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useMemo, useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { csvUrl, useStockItems, useStockSummary } from "@/hooks/use-stock-journal";
import { monthToDate } from "@/lib/report-dates";

const n = (fmt: StaffFormat, v: string) => Number(v).toLocaleString(fmt.localeTag, { maximumFractionDigits: 3 });
const signed = (fmt: StaffFormat, v: string) => (Number(v) > 0 ? "+" : "") + n(fmt, v);

// Opening, receipts, manufacturing use, manufacturing output, sales, waste, adjustments, closing: all summed from
// the stock ledger, so every closing figure equals opening plus the movements beside it.
export default function StockReportPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { branchId } = useBranch();
  const [{ from, to }, setRange] = useState(monthToDate);
  const [ingredientId, setIngredientId] = useState("");
  const [kind, setKind] = useState("");
  const [location, setLocation] = useState("");
  const filters = {
    ingredientId,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const { data: items } = useStockItems(branchId);
  const { data, isLoading, isError } = useStockSummary(branchId, filters);
  const locations = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.location).filter(Boolean))] as string[], [data]);
  const rows = (data?.rows ?? []).filter((r) => (!kind || r.kind === kind) && (!location || r.location === location));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Inventory")}</h1>
        <p className="text-sm text-muted-foreground">{t("Stock, daily production, purchasing, and food waste")}</p>
      </div>
      <InventoryTabs />
      <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5"><Label htmlFor="s-from">{t("From")}</Label><Input id="s-from" type="date" value={from} onChange={(e) => setRange({ from: e.target.value, to })} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="s-to">{t("To")}</Label><Input id="s-to" type="date" value={to} onChange={(e) => setRange({ from, to: e.target.value })} /></div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-item">{t("Item")}</Label>
          <select id="s-item" className={selectClass} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
            <option value="">{t("All items")}</option>
            {(items ?? []).map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-kind">{t("Type")}</Label>
          <select id="s-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("Raw and finished")}</option><option value="PURCHASED">{t("Raw materials")}</option><option value="PREPARED">{t("Finished products")}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-loc">{t("Location")}</Label>
          <select id="s-loc" className={selectClass} value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">{t("All locations")}</option>
            {locations.map((l) => (<option key={l}>{l}</option>))}
          </select>
        </div>
        <div className="flex items-end"><a className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" href={csvUrl("journal/summary.csv", branchId, filters)}>{t("Export CSV")}</a></div>
      </Card>
      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
        ) : isError ? (
          <p className="p-6 text-sm text-destructive">{t("Could not load the stock report.")}</p>
        ) : rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Item")}</TableHead><TableHead>{t("Location")}</TableHead><TableHead className="text-right">{t("Opening")}</TableHead>
                <TableHead className="text-right">{t("Purchases / receipts")}</TableHead><TableHead className="text-right">{t("Manufacturing used")}</TableHead>
                <TableHead className="text-right">{t("Manufacturing produced")}</TableHead><TableHead className="text-right">{t("Sales")}</TableHead>
                <TableHead className="text-right">{t("Waste")}</TableHead><TableHead className="text-right">{t("Adjustments")}</TableHead><TableHead className="text-right">{t("Closing")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.ingredientId}>
                  <TableCell className="font-medium">{r.name} <span className="text-xs text-muted-foreground">{fmt.unit(r.unit)}</span></TableCell>
                  <TableCell className="text-muted-foreground">{r.location ?? "–"}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(fmt, r.opening)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(fmt, r.receipts)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(fmt, r.manufacturingUsed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(fmt, r.manufacturingProduced)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(fmt, r.sales)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(fmt, r.waste)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(fmt, r.adjustments)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{n(fmt, r.closing)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-14 text-center text-sm text-muted-foreground">{t("No stock items or movements match these filters.")}</p>
        )}
      </Card>
      {data && <p className="text-xs text-muted-foreground">{t(data.note)}</p>}
    </div>
  );
}
