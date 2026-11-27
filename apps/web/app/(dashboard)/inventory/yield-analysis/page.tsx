"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBranch } from "@/hooks/use-branch";
import { analysisCsvUrl, useAnalysis } from "@/hooks/use-manufacturing";
import { useStockItems } from "@/hooks/use-stock-journal";

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const n = (fmt: StaffFormat, v: string | null | undefined, dp = 2) => (v == null ? "–" : Number(v).toLocaleString(fmt.localeTag, { minimumFractionDigits: dp, maximumFractionDigits: dp }));

// Batch-to-batch comparison per finished product. It reports numbers side by side; it never ranks a batch as better.
export default function YieldAnalysisPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { branchId } = useBranch();
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [productId, setProductId] = useState("");
  const filters = { from, to, productId };
  const { data: items } = useStockItems(branchId);
  const { data, isLoading, isError } = useAnalysis(branchId, filters);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Yield analysis")}</h1>
        <p className="text-sm text-muted-foreground">{t("Actual batches against the recipe: ingredient use per 100 good units, yield, rejects and cost per good unit")}</p>
      </div>
      <InventoryTabs />
      <Card className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5"><Label htmlFor="y-from">{t("From")}</Label><Input id="y-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="y-to">{t("To")}</Label><Input id="y-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="y-prod">{t("Product")}</Label><select id="y-prod" className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">{t("All products")}</option>{(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <div className="flex items-end"><a className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" href={analysisCsvUrl(branchId, filters)}>{t("Export CSV")}</a></div>
      </Card>
      {isLoading ? <Card className="py-8 text-center text-sm text-muted-foreground">{t("Loading…")}</Card>
        : isError ? <Card className="p-4 text-sm text-destructive">{t("You need the report permission to see this analysis.")}</Card>
        : data && data.products.length ? (
          <>
            <p className="text-xs text-muted-foreground">{t(data.note)}</p>
            {data.products.map((p) => {
              const names = [...new Set(p.batches.flatMap((b) => b.ingredients.map((i) => `${i.name}|${i.unit}`)))];
              return (
                <Card key={p.productId} className="flex flex-col gap-3 p-4">
                  <h2 className="text-base font-semibold">{p.name}</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[44rem] text-sm">
                      <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">{t("Batch")}</th><th className="text-right font-medium">{t("Good")}</th><th className="text-right font-medium">{t("Rejected")}</th><th className="text-right font-medium">{t("Yield vs plan")}</th><th className="text-right font-medium">{t("Batch cost")}</th><th className="text-right font-medium">{t("Cost / good unit")}</th><th className="font-medium">{t("Quality")}</th></tr></thead>
                      <tbody>{p.batches.map((b) => (
                        <tr key={b.voucherId} className="border-t border-border"><td className="py-1.5">{fmt.day(b.date)} · {b.entryNo}{b.batchRef ? ` · ${b.batchRef}` : ""}{b.recipe ? <span className="block text-xs text-muted-foreground">{b.recipe}</span> : null}</td><td className="text-right tabular-nums">{fmt.quantity(b.good)}</td><td className="text-right tabular-nums">{Number(b.rejected) > 0 ? `${fmt.quantity(b.rejected)} (${fmt.percent(Number(b.rejectRate))})` : "–"}</td><td className="text-right tabular-nums">{b.yieldPercent ? `${fmt.percent(Number(b.yieldPercent))}` : "–"}</td><td className="text-right tabular-nums">{n(fmt, b.allocatedCost)}</td><td className="text-right font-semibold tabular-nums">{n(fmt, b.unitCost)}</td><td className="max-w-48 truncate pl-3 text-xs text-muted-foreground" title={b.quality ?? ""}>{b.quality ?? t("Not recorded")}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="overflow-x-auto">
                    <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("Ingredient used per 100 good units (recipe expectation in brackets)")}</h3>
                    <table className="w-full min-w-[44rem] text-sm">
                      <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">{t("Ingredient")}</th>{p.batches.map((b) => <th key={b.voucherId} className="text-right font-medium">{fmt.day(b.date, { day: "numeric", month: "short" })} {b.entryNo.slice(-3)}</th>)}</tr></thead>
                      <tbody>{names.map((key) => { const [name, unit] = key.split("|"); return (
                        <tr key={key} className="border-t border-border"><td className="py-1.5">{name} <span className="text-xs text-muted-foreground">{fmt.unit(unit)}</span></td>{p.batches.map((b) => { const i = b.ingredients.find((x) => x.name === name); return <td key={b.voucherId} className="text-right tabular-nums">{i ? n(fmt, i.per100Good, 2) : "–"}{i?.expectedPer100 ? <span className="block text-xs text-muted-foreground">({n(fmt, i.expectedPer100, 2)}){i.variancePercent ? ` ${Number(i.variancePercent) > 0 ? "+" : ""}${fmt.percent(Number(i.variancePercent))}` : ""}</span> : null}</td>; })}</tr>
                      ); })}</tbody>
                    </table>
                  </div>
                  {p.dailyCost.length > 0 && <p className="text-xs text-muted-foreground">{t("Weighted cost per good unit by day: {join}", { join: p.dailyCost.map((d) => `${fmt.day(d.date)}: ${n(fmt, d.weightedUnitCost)} (${t("produced: {quantity}", { quantity: fmt.quantity(d.good) })})`).join(" · ") })}</p>}
                </Card>
              );
            })}
          </>
        ) : <Card className="py-8 text-center text-sm text-muted-foreground">{t("No posted vouchers in this range.")}</Card>}
    </div>
  );
}
