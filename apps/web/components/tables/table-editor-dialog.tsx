"use client";

import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useBulkCreateTables,
  useCreateTable,
  useUpdateTable,
  type RestaurantTable,
} from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function TableEditorDialog({
  branchId,
  floorId,
  table,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  floorId: string;
  table: RestaurantTable | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const isEdit = !!table;
  const [number, setNumber] = useState(table?.number ?? "");
  const [name, setName] = useState(table?.name ?? "");
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4));
  const [shape, setShape] = useState<"square" | "round" | "rect" | "booth" | "counter" | "other">(table?.shape ?? "square");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkStart, setBulkStart] = useState("1");
  const [bulkCount, setBulkCount] = useState("5");
  const createTable = useCreateTable(branchId);
  const updateTable = useUpdateTable(branchId);
  const bulkCreateTables = useBulkCreateTables(branchId);
  const isPending = createTable.isPending || updateTable.isPending || bulkCreateTables.isPending;

  const bulkStartNum = Number(bulkStart);
  const bulkCountNum = Number(bulkCount);
  const bulkNumbers =
    Number.isInteger(bulkStartNum) && bulkStartNum > 0 && Number.isInteger(bulkCountNum) && bulkCountNum > 0
      ? Array.from({ length: Math.min(bulkCountNum, 100) }, (_, i) => String(bulkStartNum + i))
      : [];

  const reset = () => {
    setNumber(table?.number ?? "");
    setName(table?.name ?? "");
    setCapacity(String(table?.capacity ?? 4));
    setShape(table?.shape ?? "square");
    setBulkMode(false);
    setBulkStart("1");
    setBulkCount("5");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isEdit && bulkMode) {
      if (bulkNumbers.length === 0) {
        toast.error(t("Enter a valid starting number and count"));
        return;
      }
      bulkCreateTables.mutate(
        { floorId, numbers: bulkNumbers, capacity: Number(capacity) || 1, shape },
        {
          onSuccess: () => {
            toast.success(t("{count} tables added", { count: bulkNumbers.length }));
            onOpenChange(false);
          },
          onError: (err) =>
            toast.error(err instanceof ApiError ? err.message : t("Could not add tables")),
        },
      );
      return;
    }

    const dto = {
      number,
      name: name || undefined,
      capacity: Number(capacity) || 1,
      shape,
    };

    if (isEdit) {
      updateTable.mutate(
        { id: table.id, dto },
        {
          onSuccess: () => {
            toast.success(t("Table updated"));
            onOpenChange(false);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not update table")),
        },
      );
      return;
    }

    createTable.mutate(
      { floorId, ...dto, posX: 20, posY: 20, width: 80, height: 80, rotation: 0 },
      {
        onSuccess: () => {
          toast.success(t("Table {number} added", { number }));
          onOpenChange(false);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not add table")),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? t("Edit table") : bulkMode ? t("Add multiple tables") : t("New table")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {!isEdit && (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <Label htmlFor="bulk-mode" className="text-sm font-normal">
                  {t("Add multiple tables at once")}
                </Label>
                <Switch id="bulk-mode" checked={bulkMode} onCheckedChange={setBulkMode} />
              </div>
            )}

            {!isEdit && bulkMode ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bulk-start">{t("Starting number")}</Label>
                  <Input
                    id="bulk-start"
                    type="number"
                    min="1"
                    value={bulkStart}
                    onChange={(e) => setBulkStart(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bulk-count">{t("How many")}</Label>
                  <Input
                    id="bulk-count"
                    type="number"
                    min="1"
                    max="100"
                    value={bulkCount}
                    onChange={(e) => setBulkCount(e.target.value)}
                    required
                  />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  {bulkNumbers.length > 0
                    ? t("Will create tables numbered {value}–{value2} ({count} tables).", { value: bulkNumbers[0], value2: bulkNumbers[bulkNumbers.length - 1], count: bulkNumbers.length })
                    : t("Enter a starting number and count.")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="table-number">{t("Number")}</Label>
                  <Input
                    id="table-number"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder="e.g. 9"
                    required
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="table-capacity">{t("Capacity")}</Label>
                  <Input
                    id="table-capacity"
                    type="number"
                    min="1"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            {bulkMode && !isEdit && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="table-capacity-bulk">{t("Capacity (each table)")}</Label>
                <Input
                  id="table-capacity-bulk"
                  type="number"
                  min="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  required
                />
              </div>
            )}

            {(!bulkMode || isEdit) && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="table-name">{t("Label (optional)")}</Label>
                <Input
                  id="table-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("e.g. Window booth")}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label>{t("Shape")}</Label>
              <Select value={shape} onValueChange={(v) => setShape(v as typeof shape)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">{t("Square")}</SelectItem>
                  <SelectItem value="round">{t("Round")}</SelectItem>
                  <SelectItem value="rect">{t("Rectangle")}</SelectItem>
                  <SelectItem value="booth">{t("Booth")}</SelectItem>
                  <SelectItem value="counter">{t("Counter / bar seat")}</SelectItem>
                  <SelectItem value="other">{t("Other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t("Saving…")
                : isEdit
                  ? t("Save changes")
                  : bulkMode
                    ? t("Add {value} tables", { value: bulkNumbers.length || "" })
                    : t("Add table")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
