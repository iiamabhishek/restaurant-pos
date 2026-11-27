"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Check, MessageCircle, Phone, Users, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChannelBadge } from "@/components/orders/channel-badges";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUpdateReservationStatus, type Reservation } from "@/hooks/use-reservations";
import { cn } from "@/lib/utils";

const when = (fmt: StaffFormat, iso: string) =>
  new Date(iso).toLocaleString(fmt.localeTag, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Manage window for a table booking: see who/when, call or WhatsApp the
// guest, and accept / reject / cancel it.
export function ReservationManageDialog({
  branchId,
  reservation,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  reservation: Reservation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const update = useUpdateReservationStatus(branchId);
  const r = reservation;
  const phone = r?.phone ?? null;
  const waHref =
    r && phone
      ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
          `Hi ${r.customerName}, this is regarding your table booking for ${r.guestCount} guests on ${when(fmt, r.reservedAt)}.`,
        )}`
      : null;
  const pending = r?.status === "RESERVED";
  const cancellable = r && (r.status === "RESERVED" || r.status === "CONFIRMED");

  const setStatus = (status: "CONFIRMED" | "CANCELLED", done: string) => {
    if (!r) return;
    update.mutate(
      { id: r.id, status },
      {
        onSuccess: () => {
          toast.success(done);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : t("Something went wrong")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("Table booking")}
            {r && <ChannelBadge channel={r.channel} />}
          </DialogTitle>
        </DialogHeader>
        {r && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-normal">
                {pending ? t("Awaiting acceptance") : fmt.code(r.status)}
              </Badge>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" /> {t("{guestCount} guests", { guestCount: r.guestCount })}</span>
              {r.table && <span>{t("· Table")} {r.table.name ?? r.table.number}</span>}
            </div>
            <div className="rounded-lg bg-secondary/40 px-3 py-2">
              <div className="font-medium text-foreground">{when(fmt, r.reservedAt)}</div>
              {r.specialRequests && (
                <p className="mt-1 text-xs text-muted-foreground">{t("Request: {specialRequests}", { specialRequests: r.specialRequests })}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Customer")}
              </div>
              <span className="font-medium text-foreground">{r.customerName}</span>
              {phone ? (
                <>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" /> {phone}
                  </span>
                  <div className="flex gap-2">
                    <a href={`tel:${phone}`} className={cn(buttonVariants({ size: "sm" }), "flex-1")}>
                      <Phone className="mr-1.5 h-4 w-4" /> {t("Call")}
                    </a>
                    <a
                      href={waHref ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" /> {t("WhatsApp")}
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("No phone number on file.")}</p>
              )}
            </div>

            {pending && (
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={update.isPending}
                  onClick={() => setStatus("CONFIRMED", t("Booking accepted"))}
                >
                  <Check className="mr-1.5 h-4 w-4" /> {t("Accept booking")}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={update.isPending}
                  onClick={() => setStatus("CANCELLED", t("Booking rejected"))}
                >
                  <X className="mr-1.5 h-4 w-4" /> {t("Reject")}
                </Button>
              </div>
            )}
            {cancellable && !pending && (
              <Button
                variant="destructive"
                disabled={update.isPending}
                onClick={() => setStatus("CANCELLED", t("Booking cancelled"))}
              >
                <X className="mr-1.5 h-4 w-4" /> {t("Cancel booking")}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
