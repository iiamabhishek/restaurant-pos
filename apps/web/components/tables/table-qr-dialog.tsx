"use client";

import { useI18n } from "@/lib/i18n/context";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRotateQrToken, type RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function TableQrDialog({
  table,
  branchId,
  open,
  onOpenChange,
}: {
  table: RestaurantTable;
  branchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const rotate = useRotateQrToken(branchId);

  const orderUrl =
    table.qrToken && typeof window !== "undefined"
      ? `${window.location.origin}/order/${table.qrToken}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{table.name ?? t("Table {number}", { number: table.number })} {t("— QR code")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {orderUrl ? (
            <>
              <div className="rounded-2xl border border-border bg-white p-4">
                <QRCodeSVG value={orderUrl} size={200} />
              </div>
              <p className="max-w-xs text-center text-xs text-muted-foreground break-all">
                {orderUrl}
              </p>
            </>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              {t("No QR code yet — generate one below.")}
            </p>
          )}

          <div className="flex gap-2">
            {orderUrl && (
              <Button variant="outline" onClick={() => window.print()}>
                {t("Print")}
              </Button>
            )}
            <Button
              variant={orderUrl ? "outline" : "default"}
              disabled={rotate.isPending}
              onClick={() =>
                rotate.mutate(table.id, {
                  onError: (err) =>
                    toast.error(err instanceof ApiError ? err.message : t("Could not generate QR code")),
                })
              }
            >
              {orderUrl ? t("Generate new code") : t("Generate QR code")}
            </Button>
          </div>
          {orderUrl && (
            <p className="text-center text-xs text-muted-foreground">
              {t("Generating a new code invalidates this one — reprint any table tents using it.")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
