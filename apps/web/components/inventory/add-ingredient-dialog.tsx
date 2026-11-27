"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import type { IngredientUnit } from "@nodedr-restaurant/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { useCreateIngredient } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";
import { STOCK_CATEGORIES, STORAGE_AREAS } from "@/lib/restaurant-stock";

const UNITS: IngredientUnit[] = ["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"];

interface Conv { unit: IngredientUnit; per: string }

export function AddIngredientDialog({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"PURCHASED" | "PREPARED">("PURCHASED");
  const [unit, setUnit] = useState<IngredientUnit>("KG");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [location, setLocation] = useState("");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [approvalQty, setApprovalQty] = useState("");
  const [par, setPar] = useState("");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createIngredient = useCreateIngredient(branchId);

  const reset = () => {
    setName(""); setKind("PURCHASED"); setUnit("KG"); setCategory(""); setSku(""); setLocation("");
    setReorderLevel("0"); setApprovalQty(""); setPar(""); setConvs([]); setError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (convs.some((c) => !(Number(c.per) > 0))) return setError(t("Fill in every conversion, or remove the row."));
    createIngredient.mutate(
      {
        name,
        unit,
        kind,
        sku: sku || undefined,
        category: category || null,
        storageLocation: location || null,
        reorderLevel: Number(reorderLevel) || 0,
        wasteApprovalQty: approvalQty ? Number(approvalQty) : null,
        parLevel: par ? Number(par) : null,
        conversions: convs.map((c) => ({ unit: c.unit, per: Number(c.per) })),
        isActive: true,
      },
      {
        onSuccess: () => { toast.success(t("{name} added", { name })); setOpen(false); reset(); },
        onError: (err) => setError(err instanceof ApiError ? err.message : t("Could not add the item")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("New stock item")}</Button>} />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>{t("New stock item")}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-kind">{t("Type")}</Label>
            <select id="i-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as "PURCHASED" | "PREPARED")}>
              <option value="PURCHASED">{t("Raw material or purchased item")}</option>
              <option value="PREPARED">{t("Finished product made in the kitchen")}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-name">{t("Name")}</Label>
            <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-unit">{t("Stock unit")}</Label>
              <select id="i-unit" className={selectClass} value={unit} onChange={(e) => setUnit(e.target.value as IngredientUnit)}>
                {UNITS.map((u) => (<option key={u} value={u}>{fmt.unit(u)}</option>))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-reorder">{t("Minimum stock")}</Label>
              <Input id="i-reorder" inputMode="decimal" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-cat">{t("Category")}</Label>
              <Input id="i-cat" list="i-cat-list" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("Vegetables")} />
              <datalist id="i-cat-list">{STOCK_CATEGORIES.map((c) => (<option key={c} value={c} />))}</datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-par">{t("Order up to (par)")}</Label>
              <Input id="i-par" inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} placeholder={t("blank = 2x minimum")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-sku">{t("SKU / barcode")}</Label>
              <Input id="i-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-loc">{t("Storage location")}</Label>
              <Input id="i-loc" list="i-loc-list" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("Dry store")} />
              <datalist id="i-loc-list">{STORAGE_AREAS.map((c) => (<option key={c} value={c} />))}</datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-appr">{t("Waste needs approval above")}</Label>
              <Input id="i-appr" inputMode="decimal" value={approvalQty} onChange={(e) => setApprovalQty(e.target.value)} placeholder={t("in {unit}, blank = never", { unit })} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("Other units for this item")}</Label>
            <p className="text-xs text-muted-foreground">
              {unit === "KG" || unit === "G" || unit === "L" || unit === "ML" || unit === "PIECE" || unit === "DOZEN"
                ? t("Kilo/gram, litre/millilitre and piece/dozen already convert. Add a row only for something else.")
                : t("Say how much one stock unit holds, for example 1 PACK = 25000 G.")}
            </p>
            {convs.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm">1 {fmt.unit(unit)} =</span>
                <Input aria-label={t("Amount")} className="w-28" inputMode="decimal" value={c.per} onChange={(e) => setConvs(convs.map((x, j) => (j === i ? { ...x, per: e.target.value } : x)))} />
                <select aria-label={t("Unit")} className={`${selectClass} w-24`} value={c.unit} onChange={(e) => setConvs(convs.map((x, j) => (j === i ? { ...x, unit: e.target.value as IngredientUnit } : x)))}>
                  {UNITS.filter((u) => u !== unit).map((u) => (<option key={u} value={u}>{fmt.unit(u)}</option>))}
                </select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("Remove conversion")} onClick={() => setConvs(convs.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <div><Button type="button" variant="ghost" size="sm" onClick={() => setConvs([...convs, { unit: UNITS.find((u) => u !== unit) ?? "G", per: "" }])}>{t("+ Add a unit")}</Button></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createIngredient.isPending}>{createIngredient.isPending ? t("Adding…") : t("Add item")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
