"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePurchaseRequest, useIngredients } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

interface Row {
  ingredientId: string;
  quantityRequested: string;
}

const emptyRow: Row = { ingredientId: "", quantityRequested: "" };

export function CreatePurchaseRequestDialog({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);
  const { data: ingredients } = useIngredients(branchId);
  const createRequest = useCreatePurchaseRequest(branchId);

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const canSubmit =
    rows.length > 0 && rows.every((r) => r.ingredientId && Number(r.quantityRequested) > 0);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createRequest.mutate(
      {
        notes: notes || undefined,
        items: rows.map((r) => ({
          ingredientId: r.ingredientId,
          quantityRequested: Number(r.quantityRequested),
        })),
      },
      {
        onSuccess: (request) => {
          toast.success(t("{requestNumber} created", { requestNumber: request.requestNumber }));
          setOpen(false);
          setNotes("");
          setRows([{ ...emptyRow }]);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("Could not create purchase request")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("New request")}</Button>} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("New purchase request")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label>{t("Items")}</Label>
            <div className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={row.ingredientId}
                    onValueChange={(v) => updateRow(index, { ingredientId: v ?? "" })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t("Ingredient")} />
                    </SelectTrigger>
                    <SelectContent>
                      {ingredients?.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} ({fmt.unit(i.unit)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder={t("Qty")}
                    className="w-24"
                    value={row.quantityRequested}
                    onChange={(e) => updateRow(index, { quantityRequested: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={rows.length === 1}
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1"
              onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
            >
              <Plus className="h-4 w-4" />
              {t("Add item")}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("Notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Optional")} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || createRequest.isPending}>
              {createRequest.isPending ? t("Creating…") : t("Create request")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
