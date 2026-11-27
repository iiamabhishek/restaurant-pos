"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type DailyVoucher, dailyCsvUrl, useDailyReport } from "@/hooks/use-manufacturing";
import { usePlaces, useStockItems } from "@/hooks/use-stock-journal";

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const n2 = (fmt: StaffFormat, v: string | null | undefined) => (v == null || v === "" ? "–" : Number(v).toLocaleString(fmt.localeTag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sgn = (v: string | null) => (v == null ? "–" : `${Number(v) > 0 ? "+" : ""}${v}`);

/** "On this day, what was consumed and what was produced": one block per local date, posted vouchers only, with filters, drill-down and CSV. */
export function DailyProduction({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [productId, setProductId] = useState("");
  const [batchRef, setBatchRef] = useState("");
  const [po, setPo] = useState("");
  const [locationId, setLocationId] = useState("");
  const filters = { from, to, productId, batchRef, po, locationId };
  const { data: items } = useStockItems(branchId);
  const { data: places } = usePlaces(branchId);
  const { data, isLoading, isError } = useDailyReport(branchId, filters);

  return (
    <section aria-label={t("Daily production")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("Daily production: what was consumed and what was made")}</h2>
        <a className="text-xs underline" href={dailyCsvUrl(branchId, filters)}>{t("Export CSV (these filters)")}</a>
      </div>
      <Card className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-from">{t("From")}</Label><Input id="d-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-to">{t("To")}</Label><Input id="d-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-prod">{t("Product")}</Label><select id="d-prod" className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">{t("All")}</option>{(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-batch">{t("Batch / reference")}</Label><Input id="d-batch" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} placeholder={t("contains…")} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-po">{t("PO or supplier")}</Label><Input id="d-po" value={po} onChange={(e) => setPo(e.target.value)} placeholder={t("PO-0001 or name")} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-place">{t("Place")}</Label><select id="d-place" className={selectClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">{t("All")}</option>{(places ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </Card>
      {isLoading ? <Card className="py-8 text-center text-sm text-muted-foreground">{t("Loading…")}</Card>
        : isError ? <Card className="p-4 text-sm text-destructive">{t("Could not load the daily report (it needs the report permission).")}</Card>
        : data && data.days.length ? (
          <>
            {data.days.map((d) => (
              <Card key={d.date} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
                  <span className="font-semibold">{new Date(`${d.date}T12:00:00`).toLocaleDateString(fmt.localeTag, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="text-xs text-muted-foreground">{(d.vouchers.length === 1 ? t("{count} voucher · total production cost", { count: d.vouchers.length }) : t("{count} vouchers · total production cost", { count: d.vouchers.length }))} <b className="text-foreground">{n2(fmt, d.totalCost)}</b></span>
                </div>
                <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
                  <div><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("Consumed (all vouchers this day)")}</h3><ul className="divide-y divide-border">{d.consumed.map((c) => <li key={c.ingredientId} className="flex justify-between gap-2 py-1"><span>{c.name}</span><span className="tabular-nums">{fmt.quantity(c.quantity)} {fmt.unit(c.unit)} · {n2(fmt, c.cost)}</span></li>)}</ul></div>
                  <div><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("Produced (good · rejected)")}</h3><ul className="divide-y divide-border">{d.produced.map((p) => <li key={p.ingredientId} className="flex justify-between gap-2 py-1"><span>{p.name}</span><span className="text-right tabular-nums">{fmt.quantity(p.good)} {fmt.unit(p.unit)}{Number(p.rejected) > 0 ? t(" · {rejected} rejected", { rejected: p.rejected }) : ""}<span className="block text-xs text-muted-foreground">{t("cost {n2} · {n22} per good unit", { n2: n2(fmt, p.allocatedCost), n22: n2(fmt, p.unitCost) })}</span></span></li>)}</ul></div>
                </div>
                <ul className="divide-y divide-border border-t border-border">{d.vouchers.map((v) => <VoucherBlock key={v.id} v={v} />)}</ul>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">{t("Range total: {vouchers} vouchers, production cost {n2}. {note} Days are cut in {timezone}.", { vouchers: data.totals.vouchers, n2: n2(fmt, data.totals.totalCost), note: t(data.note), timezone: data.timezone })}</p>
          </>
        ) : <Card className="py-8 text-center text-sm text-muted-foreground">{t("No posted vouchers match these filters.")}</Card>}
    </section>
  );
}

function VoucherBlock({ v }: { v: DailyVoucher }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  return (
    <li className="px-4 py-2 text-sm">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{v.entryNo}</span>
          {v.batchRef && <span className="text-muted-foreground">{t("batch {batchRef}", { batchRef: v.batchRef })}</span>}
          {v.sourcePo && <Badge variant="outline">{v.sourcePo}{v.sourceSupplier ? ` · ${v.sourceSupplier}` : ""}</Badge>}
          <Badge variant="outline">{v.recipe ? t("Recipe: {name}", { name: v.recipe.name }) : t("No recipe baseline")}</Badge>
          <span className="ml-auto tabular-nums">{t("{join} · cost {n2}", { join: v.outputs.map((o) => `${o.good} ${fmt.unit(o.unit)} ${o.name}`).join(", "), n2: n2(fmt, v.totalCost) })}</span>
        </summary>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-1 text-xs font-semibold">{t("Source (Consumption)")}</h4>
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">{t("Item")}</th><th className="text-right font-medium">{t("Used")}</th><th className="text-right font-medium">{t("Expected")}</th><th className="text-right font-medium">{t("Var %")}</th><th className="text-right font-medium">{t("Rate")}</th><th className="text-right font-medium">{t("Cost")}</th></tr></thead>
              <tbody>{v.inputs.map((i) => <tr key={i.ingredientId} className="border-t border-border"><td className="py-1">{i.name}{i.location ? ` · ${i.location}` : ""}{i.lot ? t(" · lot {lot}", { lot: i.lot }) : ""}{i.directTo ? t(" · only {directTo}", { directTo: i.directTo }) : ""}</td><td className="text-right tabular-nums">{fmt.quantity(i.quantity)} {fmt.unit(i.unit)}</td><td className="text-right tabular-nums">{i.expected ?? "–"}</td><td className="text-right tabular-nums">{i.variancePercent ? `${sgn(i.variancePercent)}%` : "–"}</td><td className="text-right tabular-nums">{n2(fmt, i.rate)}</td><td className="text-right tabular-nums">{n2(fmt, i.cost)}</td></tr>)}</tbody></table>
            {v.additionalCosts.length > 0 && <ul className="mt-1 text-xs text-muted-foreground">{v.additionalCosts.map((c, i) => <li key={i}>{c.category}{c.included ? "" : t(" (not in cost)")}: {n2(fmt, c.amount)}</li>)}</ul>}
          </div>
          <div>
            <h4 className="mb-1 text-xs font-semibold">{t("Destination (Production)")}</h4>
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">{t("Item")}</th><th className="text-right font-medium">{t("Good")}</th><th className="text-right font-medium">{t("Rejected")}</th><th className="text-right font-medium">{t("Yield")}</th><th className="text-right font-medium">{t("Allocated")}</th><th className="text-right font-medium">{t("Per unit")}</th></tr></thead>
              <tbody>{v.outputs.map((o) => <tr key={o.ingredientId} className="border-t border-border"><td className="py-1">{o.name}{o.location ? ` · ${o.location}` : ""}{o.lot ? t(" · lot {lot}", { lot: o.lot }) : ""}</td><td className="text-right tabular-nums">{fmt.quantity(o.good)} {fmt.unit(o.unit)}</td><td className="text-right tabular-nums">{Number(o.rejected) > 0 ? `${fmt.quantity(o.rejected)} (${fmt.percent(Number(o.rejectRate))})` : "–"}</td><td className="text-right tabular-nums">{o.yieldPercent ? `${fmt.percent(Number(o.yieldPercent))}` : "–"}</td><td className="text-right tabular-nums">{n2(fmt, o.allocatedCost)}{o.percent && v.allocationMethod ? ` (${fmt.percent(Number(o.percent), 1)})` : ""}</td><td className="text-right font-semibold tabular-nums">{n2(fmt, o.unitCost)}</td></tr>)}</tbody></table>
            <p className="mt-1 text-xs text-muted-foreground">{t("Materials {n2} + additional {n22} =", { n2: n2(fmt, v.ingredientCost), n22: n2(fmt, v.additionalCost) })} <b className="text-foreground">{n2(fmt, v.totalCost)}</b>{v.allocationMethod ? t(" · split {value}", { value: v.allocationMethod === "QUANTITY" ? t("by quantity") : t("by manual percent") }) : ""}.</p>
            {v.quality && <p className="text-xs text-muted-foreground">{t("Quality: {result}", { result: v.quality.result })}{v.quality.grade ? ` · ${v.quality.grade}` : ""}{v.quality.notes ? ` · ${v.quality.notes}` : ""}</p>}
            {v.notes && <p className="text-xs text-muted-foreground">{t("Narration: {notes}", { notes: v.notes })}</p>}
          </div>
        </div>
      </details>
    </li>
  );
}
