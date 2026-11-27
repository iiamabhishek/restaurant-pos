"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { type ProducibleMenuItem, useMakeProducible } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";

const UNITS: IngredientUnit[] = ["PIECE", "KG", "G", "L", "ML", "DOZEN", "PACK", "BOX"];

/**
 * A menu item (Fried Rice, Momo) picked as a finished product has no stock item yet. This creates one with the same
 * name and links it to the menu item, so what you make is stocked and each sale takes it down. The menu price and
 * tax are not touched, and nothing is saved until the operator confirms.
 */
export function MakeProducibleDialog({ branchId, item, onDone, onCancel }: {
  branchId: string | null;
  item: ProducibleMenuItem;
  onDone: (stockItemId: string, unit: IngredientUnit) => void;
  onCancel: () => void;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const make = useMakeProducible(branchId);
  const [unit, setUnit] = useState<IngredientUnit>("PIECE");
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    setError(null);
    make.mutate({ menuItemId: item.id, unit }, {
      onSuccess: (r) => onDone(r.id, unit),
      onError: (e) => setError(e instanceof ApiError ? e.message : t("Could not link this menu item. Nothing was changed.")),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !make.isPending && onCancel()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Produce {name} into stock", { name: item.name })}</DialogTitle>
          <DialogDescription>{t("{name} is on your menu but not tracked in stock yet. This adds a stock item with the same name and links it, so the quantity you make is kept in stock and each sale takes one off.", { name: item.name })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mp-unit">{t("Count it in")}</Label>
          <SearchSelect id="mp-unit" value={unit} onChange={(v) => v && setUnit(v as IngredientUnit)} options={UNITS.map((u) => ({ value: u, label: fmt.unit(u) }))} />
          <p className="text-xs text-muted-foreground">{t("One sale takes one {value} off stock. Menu price and tax stay as they are.", { value: fmt.unit(unit) })}</p>
        </div>
        {item.inventoryTracking === "RECIPE" && (
          <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">{t("Sales of {name} currently take its recipe ingredients off stock. After this they take the finished {name2} you produce instead, so the ingredients are used up when you post the voucher, not at each sale.", { name: item.name, name2: item.name })}</p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={make.isPending}>{t("Cancel")}</Button>
          <Button type="button" onClick={confirm} disabled={make.isPending}>{make.isPending ? t("Linking…") : t("Use {name} as finished product", { name: item.name })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
