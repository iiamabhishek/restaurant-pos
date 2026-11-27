"use client";

import { useI18n } from "@/lib/i18n/context";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useDeleteOrders } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api";

// Admin-only, password-gated permanent delete of finished transactions.
export function DeleteOrdersDialog({
  branchId,
  orderIds,
  open,
  onOpenChange,
  onDeleted,
}: {
  branchId: string | null;
  orderIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const del = useDeleteOrders(branchId);
  const count = orderIds.length;

  const close = (next: boolean) => {
    if (!next) {
      setPassword("");
      setError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    del.mutate(
      { orderIds, password },
      {
        onSuccess: (res) => {
          toast.success((res.deleted === 1 ? t("Deleted {deleted} transaction", { deleted: res.deleted }) : t("Deleted {deleted} transactions", { deleted: res.deleted })));
          close(false);
          onDeleted();
        },
        onError: (err) => {
          setPassword("");
          setError(err instanceof ApiError ? err.message : t("Could not delete transactions"));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />{(count === 1 ? t("Delete {count} transaction?", { count }) : t("Delete {count} transactions?", { count }))}</DialogTitle>
            <DialogDescription>
              {t("You can permanently delete finished bills that have no payment history, refund history or VERI*FACTU invoice. Every selected bill must qualify. The Audit Log records each deletion. Enter your admin password to confirm.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-orders-password">{t("Admin password")}</Label>
            <PasswordInput
              id="delete-orders-password"
              
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "delete-orders-error" : undefined}
              required
              autoFocus
            />
            <p
              id="delete-orders-error"
              role="alert"
              className="min-h-5 text-sm text-destructive"
            >
              {error ?? ""}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t("Keep them")}
            </Button>
            <Button type="submit" variant="destructive" disabled={del.isPending || !password}>
              {del.isPending ? t("Deleting…") : t("Delete {count}", { count })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
