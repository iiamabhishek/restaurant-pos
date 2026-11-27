"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Online = guest ordered via website/QR; Offline = entered by staff.
export function ChannelBadge({ channel }: { channel: "STAFF" | "ONLINE" }) {
  const { t } = useI18n();
  const online = channel === "ONLINE";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-normal",
        online ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {online ? t("Online") : t("Offline")}
    </Badge>
  );
}

export const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  DRIVE_THRU: "Drive-thru",
  QR_ORDER: "QR order",
  KIOSK: "Kiosk",
  PHONE: "Phone",
};

export function TypeBadge({ type }: { type: string }) {
  const fmt = useStaffFormat();
  return (
    <Badge variant="secondary" className="font-normal">
      {ORDER_TYPE_LABEL[type] ? fmt.label(ORDER_TYPE_LABEL[type]) : fmt.code(type)}
    </Badge>
  );
}
