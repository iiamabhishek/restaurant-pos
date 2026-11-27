"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useMemo, useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { QUALITY_LABEL, QualityDialog } from "@/components/inventory/quality-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { type MfgReport, mfgCsvUrl, useMfgReport, useMfgSettings } from "@/hooks/use-manufacturing";
import { useStockItems } from "@/hooks/use-stock-journal";
import { DailyProduction } from "@/components/inventory/daily-production";

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (fmt: StaffFormat, v: string | null | undefined, dp = 2) => (v == null ? "–" : Number(v).toLocaleString(fmt.localeTag, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const STATUS: Record<string, string> = { DRAFT: "Draft", POSTED: "Posted", VOIDED: "Reversed" };

function Section({ title, csv, children }: { title: string; csv?: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{csv && <a className="text-xs underline" href={csv}>{t("Export CSV")}</a>}</div>
      {children}
    </section>
  );
}
const Empty = ({ t }: { t: string }) => <Card className="py-8 text-center text-sm text-muted-foreground">{t}</Card>;

export function ManufacturingReportsView({ embedded = false }: { embedded?: boolean }) {
  const fmt = useStaffFormat();
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const { data: s } = useMfgSettings(branchId);
  const { data: items } = useStockItems(branchId);
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => day(new Date()));
  const [itemId, setItemId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"date" | "cost">("date");
  const [inspect, setInspect] = useState<MfgReport["batches"][number] | null>(null);
  const filters = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString(), itemId, status };
  const { data, isLoading, isError, error } = useMfgReport(branchId, filters);
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    const rows = (data?.batches ?? []).filter((b) => !t || `${b.entryNo} ${b.item ?? ""} ${b.batchRef ?? ""}`.toLowerCase().includes(t));
    return sort === "cost" ? [...rows].sort((a, b) => Number(b.unitCost ?? 0) - Number(a.unitCost ?? 0)) : rows;
  }, [data, search, sort]);

  return (
    <div className="flex flex-col gap-6">
      {!embedded && (
        <>
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Stock Journal Reports")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Production, costs and menu price changes, from posted batches")}</p>
      </div>
      <InventoryTabs />
        </>
      )}
      {s && !s.enabled && <Card className="p-4 text-sm text-muted-foreground">{translate("Manufacturing is switched off. Past batches are kept and still shown here; turn it on under Inventory > Stock journal > Entries to record new costed batches.")}</Card>}
      <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-from">{translate("From")}</Label><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-to">{translate("To")}</Label><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-item">{translate("Finished item")}</Label><select id="r-item" className={selectClass} value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">{translate("All")}</option>{(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-st">{translate("Status")}</Label><select id="r-st" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{translate("All")}</option><option value="POSTED">{translate("Posted")}</option><option value="DRAFT">{translate("Draft")}</option><option value="VOIDED">{translate("Reversed")}</option></select></div>
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1"><Label htmlFor="r-search">{translate("Search")}</Label><Input id="r-search" className="h-9" type="search" placeholder={translate("Batch, item or batch ref")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-sort">{translate("Sort by")}</Label><select id="r-sort" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as "date" | "cost")}><option value="date">{translate("Newest first")}</option><option value="cost">{translate("Highest cost per unit")}</option></select></div>
      </Card>

      <DailyProduction branchId={branchId} />

      {isLoading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : isError ? (
        <Card className="p-6 text-sm text-destructive">{(error as Error)?.message?.includes("permission") || (error as { status?: number })?.status === 403 ? translate("You do not have permission to view manufacturing reports.") : translate("Could not load the reports. Try again.")}</Card>
      ) : data ? (
        <>
          <p className="text-xs text-muted-foreground">{translate(data.note)}</p>
          <div className="flex flex-wrap gap-2">{data.statusCounts.map((c) => (<Badge key={c.status} variant="outline">{fmt.label(STATUS[c.status])}: {c.count}</Badge>))}</div>

          <Section title={translate("Batches by day")} csv={mfgCsvUrl(branchId, "days", filters)}>
            {data.batchesByDay.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.batchesByDay.map((d) => (<li key={d.date} className="flex justify-between px-4 py-2"><span>{d.batches === 1 ? translate("{date} · 1 batch", { date: d.date }) : translate("{date} · {batches} batches", { date: d.date, batches: d.batches })}</span><span className="tabular-nums">{num(fmt, d.totalCost)}</span></li>))}</ul></Card> : <Empty t={translate("No posted batches in this period.")} />}
          </Section>

          <Section title={translate("Finished items: quantity and cost per unit")} csv={mfgCsvUrl(branchId, "produced", filters)}>
            {data.produced.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.produced.map((p) => (<li key={p.itemId} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2"><span className="font-medium">{p.name}<span className="block text-xs font-normal text-muted-foreground">{p.batches === 1 ? translate("1 batch · total cost {cost}", { cost: num(fmt, p.totalCost) }) : translate("{batches} batches · total cost {cost}", { batches: p.batches, cost: num(fmt, p.totalCost) })}</span></span><span className="text-right tabular-nums">{fmt.quantity(p.quantity)} {fmt.unit(p.unit)}<span className="block text-xs text-muted-foreground">{translate("{num} per unit", { num: num(fmt, p.avgUnitCost, 4) })}</span></span></li>))}</ul></Card> : <Empty t={translate("Nothing produced in this period.")} />}
          </Section>

          <Section title={translate("Ingredients consumed")} csv={mfgCsvUrl(branchId, "consumed", filters)}>
            {data.consumed.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.consumed.map((c, i) => (<li key={i} className="flex justify-between gap-3 px-4 py-2"><span>{fmt.day(c.date)} · {c.name}</span><span className="tabular-nums">{fmt.quantity(c.quantity)} {fmt.unit(c.unit)} · {num(fmt, c.cost)}</span></li>))}</ul></Card> : <Empty t={translate("No ingredients consumed in this period.")} />}
          </Section>

          <Section title={translate("Additional production costs by category")} csv={mfgCsvUrl(branchId, "costs", filters)}>
            {data.additionalByCategory.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.additionalByCategory.map((c) => (<li key={c.category} className="flex justify-between px-4 py-2"><span>{c.category}</span><span className="tabular-nums">{num(fmt, c.amount)}</span></li>))}</ul></Card> : <Empty t={translate("No additional costs were counted in this period.")} />}
          </Section>

          <Section title={translate("Production history")} csv={mfgCsvUrl(branchId, "batches", filters)}>
            {shown.length ? <ul className="flex flex-col gap-2">{shown.map((b) => (
              <li key={b.id}><Card className="flex flex-col gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{b.entryNo}</span><Badge variant={b.status === "POSTED" ? "default" : "outline"}>{fmt.label(STATUS[b.status])}</Badge><span className="text-muted-foreground">{new Date(b.producedAt).toLocaleString(fmt.localeTag)}</span></div>
                <div>{fmt.quantity(b.quantity)} {fmt.unit(b.unit)} {b.item}</div>
                <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-4"><span>{translate("Ingredients {num}", { num: num(fmt, b.ingredientCost) })}</span><span>{translate("Additional {num}", { num: num(fmt, b.additionalCost) })}</span><span>{translate("Total {num}", { num: num(fmt, b.totalCost) })}</span><span>{translate("Per unit")} <b className="text-foreground">{num(fmt, b.unitCost, 4)}</b></span></div>
                {b.status !== "DRAFT" && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                    <span>{translate("Menu price at posting")} <b className="text-foreground">{b.sellingPriceAtPost == null ? translate("not recorded") : num(fmt, b.sellingPriceAtPost)}</b></span>
                    <span>{translate("Price changed to")} <b className="text-foreground">{b.priceChange ? num(fmt, b.priceChange.newPrice) : translate("no change")}</b></span>
                    <span>{translate("Batch ref")} <b className="text-foreground">{b.batchRef ?? "–"}</b></span>
                    <span>{translate("Made")} {b.manufacturedOn ? new Date(b.manufacturedOn).toLocaleDateString(fmt.localeTag) : "–"} {translate("· expires")} {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString(fmt.localeTag) : "–"}</span>
                  </div>
                )}
                {b.status === "POSTED" && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{translate("Quality:")}</span>
                    {b.quality ? <Badge variant={b.quality.result === "PASS" ? "default" : "outline"}>{fmt.label(QUALITY_LABEL[b.quality.result])}{b.quality.grade ? ` · ${b.quality.grade}` : ""}</Badge> : <span className="font-medium text-foreground">{translate("Not recorded")}</span>}
                    {b.quality?.notes && <span className="text-muted-foreground">{b.quality.notes}</span>}
                    {s?.canQuality && <Button type="button" variant="outline" className="ml-auto h-9" onClick={() => setInspect(b)}>{b.quality ? translate("Change inspection") : translate("Record inspection")}</Button>}
                  </div>
                )}
                {b.corrects && <div className="text-xs text-muted-foreground">{translate("Corrects {corrects}", { corrects: b.corrects })}</div>}
                {b.correctedBy.length > 0 && <div className="text-xs text-muted-foreground">{translate("Replaced by {join}", { join: b.correctedBy.join(", ") })}</div>}
                {b.voidReason && <div className="text-xs text-muted-foreground">{translate("Reversed: {voidReason}", { voidReason: b.voidReason })}</div>}
                <details className="mt-1 text-xs">
                  <summary className="flex h-9 cursor-pointer items-center font-medium text-foreground">{translate("View full voucher")}</summary>
                  <div className="grid gap-3 pt-1 md:grid-cols-2">
                    <div><h3 className="mb-1 font-semibold">{translate("Source (Consumption)")}</h3><ul className="divide-y divide-border">{b.lines.filter((l) => l.role === "INPUT").map((l, i) => (<li key={i} className="flex justify-between gap-2 py-1"><span>{l.item}<span className="block text-muted-foreground">{fmt.quantity(l.quantity)} {fmt.unit(l.unit)}{l.rate ? ` × ${num(fmt, l.rate, 4)}` : ""}</span></span><span className="tabular-nums">{num(fmt, l.amount)}</span></li>))}</ul>
                      {b.additionalCosts.length > 0 && <ul className="mt-1 divide-y divide-border border-t border-border">{b.additionalCosts.map((c, i) => (<li key={i} className="flex justify-between gap-2 py-1"><span>{c.category}{c.included ? "" : translate(" (not counted)")}</span><span className="tabular-nums">{num(fmt, c.amount)}</span></li>))}</ul>}</div>
                    <div><h3 className="mb-1 font-semibold">{translate("Destination (Production)")}</h3><ul className="divide-y divide-border">{b.lines.filter((l) => l.role === "OUTPUT").map((l, i) => (<li key={i} className="flex justify-between gap-2 py-1"><span>{l.item}</span><span className="tabular-nums">{fmt.quantity(l.quantity)} {fmt.unit(l.unit)}</span></li>))}</ul>
                      <p className="mt-1 text-muted-foreground">{translate("Cost per unit {num} · total {num2}", { num: num(fmt, b.unitCost, 4), num2: num(fmt, b.totalCost) })}</p></div>
                  </div>
                </details>
              </Card></li>))}</ul> : <Empty t={translate("No batches match these filters.")} />}
          </Section>

          <Section title={translate("Menu price changes made from the Stock Journal")} csv={mfgCsvUrl(branchId, "prices", filters)}>
            {data.priceChanges.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.priceChanges.map((p) => (<li key={p.id} className="grid gap-1 px-4 py-2 sm:grid-cols-[1fr_auto]"><span className="font-medium">{p.item}<span className="block text-xs font-normal text-muted-foreground">{translate("{by} · {toLocaleString} · batch", { by: p.by ?? "", toLocaleString: new Date(p.changedAt).toLocaleString(fmt.localeTag) })} {p.entryNo ?? "–"}</span></span><span className="tabular-nums">{num(fmt, p.oldPrice)} → <b>{num(fmt, p.newPrice)}</b><span className="block text-xs text-muted-foreground">{translate("unit cost then {num}", { num: num(fmt, p.unitCost, 4) })}</span></span></li>))}</ul></Card> : <Empty t={translate("No menu prices were changed from the Stock Journal in this period.")} />}
          </Section>
        </>
      ) : null}
    {inspect && <QualityDialog branchId={branchId} batch={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}
