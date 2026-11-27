"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusNote, useStatusNote } from "@/components/ui/status-note";
import { api, ApiError } from "@/lib/api";

interface Line { id: string; quantity: number; nameSnapshot: string; lineTotal: string; status?: string }

// Move some of an open bill onto a new bill, so one guest can pay their share. Quantities move one at a time.
export function SplitBillDialog({
  branchId,
  orderId,
  items,
  open,
  onOpenChange,
  onSplit,
}: {
  branchId: string | null;
  orderId: string;
  items: Line[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSplit: (newOrderId: string, newOrderNumber: string) => void;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { note, show, clear } = useStatusNote();
  const [move, setMove] = useState<Record<string, number>>({});
  // One key per attempt, renewed after success: a double tap splits once.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const lines = items.filter((i) => i.status !== "CANCELLED");
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const moving = Object.values(move).reduce((n, q) => n + q, 0);
  const split = useMutation({
    mutationFn: () =>
      api.post<{ id: string; orderNumber: string }>(`/orders/${orderId}/split?branchId=${branchId}`, {
        requestId: key,
        lines: Object.entries(move).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["tables"] });
      setMove({});
      setKey(crypto.randomUUID());
      onSplit(r.id, r.orderNumber);
    },
    onError: (e) => show("error", e instanceof ApiError ? e.message : t("Could not split the bill")),
  });
  const step = (id: string, d: number, max: number) => setMove((m) => ({ ...m, [id]: Math.min(max, Math.max(0, (m[id] ?? 0) + d)) }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) clear(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Split this bill")}</DialogTitle>
          <DialogDescription>{t("Choose what goes on the new bill. Each bill is paid on its own, with any payment method.")}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{l.nameSnapshot}</span>
                <span className="block text-xs text-muted-foreground">{t("{quantity} on this bill · {formatCurrency}", { quantity: l.quantity, formatCurrency: fmt.currency(l.lineTotal) })}</span>
              </span>
              <span className="flex items-center gap-1">
                <Button type="button" size="icon" variant="outline" aria-label={t("Move one fewer {nameSnapshot}", { nameSnapshot: l.nameSnapshot })} onClick={() => step(l.id, -1, l.quantity)}><Minus className="h-4 w-4" /></Button>
                <span className="w-6 text-center tabular-nums" aria-live="polite">{move[l.id] ?? 0}</span>
                <Button type="button" size="icon" variant="outline" aria-label={t("Move one more {nameSnapshot}", { nameSnapshot: l.nameSnapshot })} onClick={() => step(l.id, 1, l.quantity)}><Plus className="h-4 w-4" /></Button>
              </span>
            </li>
          ))}
        </ul>
        <StatusNote note={note} onClear={clear} />
        <Button disabled={split.isPending || moving === 0 || moving >= total} onClick={() => split.mutate()}>
          {moving === 0 ? t("Choose items to move") : moving >= total ? t("Leave at least one item") : t("Move {moving} to a new bill", { moving })}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
