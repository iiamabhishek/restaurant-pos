"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { AlertTriangle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ImportCsvDialog } from "@/components/imports/import-csv-dialog";
import { AddIngredientDialog } from "@/components/inventory/add-ingredient-dialog";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients, useTrackingStatus } from "@/hooks/use-inventory";
import { useExpiring } from "@/hooks/use-stock-journal";
import { rank, STOCK_CATEGORIES, STORAGE_AREAS } from "@/lib/restaurant-stock";

function InventoryView() {
  const fmt = useStaffFormat();
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canImport = hasPermission(me?.user, "inventory.manage");
  // A Stock Journal manager has no general inventory permission: this stock list would only show an error, so go to the journal.
  const router0 = useRouter();
  useEffect(() => {
    if (me?.user && !hasPermission(me.user, "inventory.manage") && hasPermission(me.user, "journal.manage")) router0.replace("/inventory/journal");
  }, [me, router0]);
  const [search, setSearch] = useState("");
  // Dashboard deep link: /inventory?filter=low starts on the low-stock view.
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<"all" | "raw" | "made" | "low" | "out">(() => (params.get("filter") === "low" ? "low" : "all"));
  const [area, setArea] = useState("");
  const [showValue, setShowValue] = useState(false);
  const { data: ingredients, isLoading } = useIngredients(branchId);
  const { data: trackingStatus } = useTrackingStatus(branchId);
  const { data: expiring } = useExpiring(branchId, 3);

  const isOut = (i: { currentStock: string }) => Number(i.currentStock) <= 0;
  const isLowish = (i: { currentStock: string; reorderLevel: string }) => !isOut(i) && Number(i.reorderLevel) > 0 && Number(i.currentStock) <= Number(i.reorderLevel);
  const active = (ingredients ?? []).filter((i) => i.isActive !== false);
  const lowCount = active.filter(isLowish).length;
  const outCount = active.filter((i) => isOut(i) && i.kind !== "PREPARED").length;
  const areas = [...new Set(active.map((i) => i.storageLocation).filter((x): x is string => !!x))].sort((a, b) => rank(STORAGE_AREAS, a) - rank(STORAGE_AREAS, b) || a.localeCompare(b));
  const filtered = active.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (!area || i.storageLocation === area) &&
      (view === "all" ||
        (view === "raw" && i.kind !== "PREPARED") ||
        (view === "made" && i.kind === "PREPARED") ||
        (view === "low" && (isLowish(i) || (isOut(i) && Number(i.reorderLevel) > 0))) ||
        (view === "out" && isOut(i) && i.kind !== "PREPARED")),
  );
  const preparedGroup = Symbol("prepared");
  const byCat = new Map<string | typeof preparedGroup, typeof filtered>();
  for (const i of filtered) {
    const c = i.kind === "PREPARED" ? preparedGroup : i.category || "";
    byCat.set(c, [...(byCat.get(c) ?? []), i]);
  }
  const groups = [...byCat.entries()].sort(([a], [b]) => (a === preparedGroup ? 1 : b === preparedGroup ? -1 : rank(STOCK_CATEGORIES, a) - rank(STOCK_CATEGORIES, b) || a.localeCompare(b)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Inventory")}</h1>
          <p className="text-sm text-muted-foreground">
            {translate("Stock, daily production, purchasing, and food waste")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImport && <ImportCsvDialog kind="ingredients" branchId={branchId} />}
          <AddIngredientDialog branchId={branchId} />
        </div>
      </div>

      <InventoryTabs />

      {trackingStatus && trackingStatus.problems.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">{(trackingStatus.problems.length === 1 ? translate("{count} stock-tracked menu item will deduct nothing when sold", { count: trackingStatus.problems.length }) : translate("{count} stock-tracked menu items will deduct nothing when sold", { count: trackingStatus.problems.length }))}</p>
            <p className="text-muted-foreground">{translate("Add a recipe or pick the stock item (Menu → Edit item → Stock when sold): {join}", { join: trackingStatus.problems.map((p) => p.name).join(", ") })}</p>
          </div>
        </div>
      )}

      <section aria-label={translate("Today")} className="grid grid-cols-3 gap-3">
        {[
          { label: translate("Running low"), n: lowCount, on: view === "low", set: "low" as const, tone: "text-warning" },
          { label: translate("Out of stock"), n: outCount, on: view === "out", set: "out" as const, tone: "text-destructive" },
          { label: translate("Expiring in 3 days"), n: expiring?.length ?? 0, on: false, set: null, tone: "text-destructive", href: "/inventory/shopping-list#expiring" },
        ].map((t) => (
          <button key={t.label} type="button" aria-pressed={t.on}
            onClick={() => (t.href ? router.push(t.href) : setView(view === t.set ? "all" : t.set!))}
            className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left sm:p-4 ${t.on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}>
            <span className={`text-2xl font-semibold tabular-nums ${t.n ? t.tone : "text-foreground"}`}>{t.n}</span>
            <span className="text-xs text-muted-foreground sm:text-sm">{t.label}</span>
          </button>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={translate("Search items…")} aria-label={translate("Search items")} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        {([["all", "All"], ["raw", "Raw materials"], ["made", "Finished food"]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            className={"rounded-full border px-3.5 py-1.5 text-sm " + (view === k ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary")}>{translate(label)}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showValue} onChange={(e) => setShowValue(e.target.checked)} /> {translate("Show purchase values")}</label>
      </div>
      {areas.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={translate("Storage area")}>
          <button type="button" aria-pressed={!area} onClick={() => setArea("")} className={"rounded-full border px-3 py-1 text-xs " + (!area ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>{translate("Everywhere")}</button>
          {areas.map((a) => (
            <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(area === a ? "" : a)} className={"rounded-full border px-3 py-1 text-xs " + (area === a ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>{a}</button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => (<Skeleton key={i} className="h-12 rounded-lg" />))}</div>
      ) : groups.length > 0 ? (
        groups.map(([key, rows]) => {
          const cat = key === preparedGroup ? translate("Made in the kitchen") : key || translate("Other");
          return <section key={key === preparedGroup ? "prepared" : `category-${key}`} aria-label={cat} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">{cat} <span className="font-normal text-muted-foreground">({rows.length})</span></h2>
            <Card className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{translate("Item")}</TableHead>
                    <TableHead className="text-right">{translate("In stock")}</TableHead>
                    <TableHead className="text-right">{translate("Minimum")}</TableHead>
                    {showValue && <TableHead className="text-right">{translate("Avg. cost / unit")}</TableHead>}
                    {showValue && <TableHead className="text-right">{translate("Stock value")}</TableHead>}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((i) => {
                    const out = Number(i.currentStock) <= 0;
                    const low = !out && Number(i.reorderLevel) > 0 && Number(i.currentStock) <= Number(i.reorderLevel);
                    return (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium text-foreground">
                          <div className="flex flex-wrap items-center gap-2">
                            {i.name}
                            {i.kind === "PREPARED" && <Badge variant="outline">{translate("Made here")}</Badge>}
                            {out && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{translate("Out")}</Badge>}
                            {low && <Badge variant="outline" className="gap-1 border-warning text-warning"><AlertTriangle className="h-3 w-3" />{translate("Low")}</Badge>}
                          </div>
                          {i.storageLocation && <span className="text-xs font-normal text-muted-foreground">{i.storageLocation}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt.quantity(i.currentStock)} <span className="text-muted-foreground">{fmt.unit(i.unit)}</span></TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{i.reorderLevel}</TableCell>
                        {showValue && <TableCell className="text-right tabular-nums">{fmt.currency(i.costPerUnit)}</TableCell>}
                        {showValue && <TableCell className="text-right tabular-nums">{fmt.currency(Number(i.currentStock) * Number(i.costPerUnit))}</TableCell>}
                        <TableCell><AdjustStockDialog branchId={branchId} ingredient={i} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </section>;
        })
      ) : (
        <Card className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-foreground">{ingredients && ingredients.length ? translate("Nothing matches") : translate("No stock items yet")}</p>
          <p className="text-sm text-muted-foreground">{ingredients && ingredients.length ? translate("Clear the filters to see everything.") : translate("Add your raw materials and the dishes you make in the kitchen to start tracking stock.")}</p>
        </Card>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <InventoryView />
    </Suspense>
  );
}
