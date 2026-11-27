"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import {
  useAssignmentHistory,
  useDeliveries,
  useDeliveryActions,
  useDrivers,
  useZoneActions,
  useZones,
  type DeliveryOrder,
  type DeliveryStatus,
} from "@/hooks/use-delivery";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Rider assigned",
  PICKED_UP: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Failed",
};

const time = (fmt: StaffFormat, iso: string) => new Date(iso).toLocaleTimeString(fmt.localeTag, { hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function DeliveryCard({ order, branchId }: { order: DeliveryOrder; branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: drivers } = useDrivers(branchId);
  const { assign, setStatus, trackLink } = useDeliveryActions(branchId);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const status = order.deliveryStatus ?? "UNASSIGNED";
  const [pending, setPending] = useState<string | null>(null); // rider chosen for a reassignment, waiting for a reason
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const { data: history } = useAssignmentHistory(branchId, order.id, showHistory);
  const chosen = drivers?.find((d) => d.id === pending);
  const doAssign = (driverId: string, why?: string) =>
    assign.mutate(
      { orderId: order.id, driverId, reason: why },
      { onSuccess: () => { setPending(null); setReason(""); }, onError: (err) => toast.error(errMsg(err, t("Something went wrong"))) },
    );
  // A link the customer opens to watch their delivery. Shared with the phone's share sheet where there is one, else copied.
  const shareLink = () =>
    trackLink.mutate(order.id, {
      onSuccess: async (r) => {
        const url = `${window.location.origin}/track/${r.token}`;
        try {
          if (navigator.share) await navigator.share({ title: t("Order {orderNumber}", { orderNumber: order.orderNumber }), url });
          else {
            await navigator.clipboard.writeText(url);
            setLinkNote(t("Link copied. Send it to the customer."));
          }
        } catch {
          setLinkNote(url); // clipboard blocked: show it so it can be copied by hand
        }
      },
      onError: (e) => setLinkNote(errMsg(e, t("Something went wrong"))),
    });
  const move = (next: DeliveryStatus) =>
    setStatus.mutate({ orderId: order.id, status: next }, { onError: (e) => toast.error(errMsg(e, t("Something went wrong"))) });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            #{order.orderNumber} · {order.guestName ?? t("Guest")}
          </p>
          <p className="text-xs text-muted-foreground">
            {order.deliveryAddress ?? t("Address in notes")}
            {order.deliveryPincode && ` · ${order.deliveryPincode}`}
          </p>
          {order.deliveryPlace && <p className="text-xs text-foreground">{t("Landmark: {deliveryPlace}", { deliveryPlace: order.deliveryPlace })}</p>}
          {order.deliveryLat != null && order.deliveryLng != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${order.deliveryLat},${order.deliveryLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-primary underline underline-offset-2"
            >
              {t("Customer shared their location — open map")}
            </a>
          )}
          {order.deliveryFailedReason && <p className="text-xs text-destructive">{t("Not delivered: {deliveryFailedReason}", { deliveryFailedReason: order.deliveryFailedReason })}</p>}
          {order.deliveryPhone && (
            <a href={`tel:${order.deliveryPhone}`} className="text-xs text-primary underline underline-offset-2">
              {order.deliveryPhone}
            </a>
          )}
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
          {fmt.label(STATUS_LABEL[status])}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t("{currency} + {currency2} delivery", { currency: fmt.currency(order.totalAmount), currency2: fmt.currency(order.deliveryFee) })}{order.deliveryZone && ` · ${order.deliveryZone.name}`}
        {order.deliveryEtaAt && t(" · ETA {time}", { time: time(fmt, order.deliveryEtaAt) })}
        {order.scheduledFor && t(" · scheduled {time}", { time: time(fmt, order.scheduledFor) })}
      </p>
      {order.notes && <p className="text-xs italic text-muted-foreground">{order.notes}</p>}
      {linkNote && <p className="break-all text-xs text-muted-foreground" role="status">{linkNote}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {(status === "UNASSIGNED" || status === "ASSIGNED") && (
          <select
            aria-label={t("Rider")}
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id || id === order.driver?.id) return;
              if (order.driver) setPending(id); // moving it to someone else: ask why first
              else doAssign(id);
            }}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{order.driver ? t("Reassign rider…") : t("Assign rider…")}</option>
            {drivers?.filter((d) => d.id !== order.driver?.id).map((d) => (
              <option key={d.id} value={d.id}>
                {d.riderOnline ? t("● On shift") : t("○ Off shift")} · {d.name}
                {d.activeDeliveries > 0 ? t(" ({activeDeliveries} active)", { activeDeliveries: d.activeDeliveries }) : t(" (free)")}
              </option>
            ))}
          </select>
        )}
        {order.driver && status !== "UNASSIGNED" && (
          <span className="text-xs font-medium text-foreground">{t("Rider: {name}", { name: order.driver.name })}</span>
        )}
        {status === "UNASSIGNED" && <span className="text-xs font-medium text-muted-foreground">{t("Unassigned")}</span>}
        {status !== "DELIVERED" && status !== "FAILED" && (
          <Button size="sm" variant="outline" disabled={trackLink.isPending} onClick={shareLink}>{t("Customer link")}</Button>
        )}
        {status === "ASSIGNED" && <Button size="sm" onClick={() => move("PICKED_UP")}>{t("Picked up")}</Button>}
        {status === "PICKED_UP" && <Button size="sm" onClick={() => move("DELIVERED")}>{t("Delivered")}</Button>}
        {status !== "DELIVERED" && status !== "FAILED" && (
          <Button size="sm" variant="outline" onClick={() => move("FAILED")}>
            {t("Mark failed")}
          </Button>
        )}
      </div>
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <Input aria-label={t("Reason for reassigning")} className="h-8 min-w-48 flex-1" placeholder={t("Why move this to {value}? (required)", { value: chosen?.name ?? t("another rider") })} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <Button size="sm" disabled={reason.trim().length < 3 || assign.isPending} onClick={() => doAssign(pending, reason)}>{t("Reassign")}</Button>
          <Button size="sm" variant="outline" onClick={() => { setPending(null); setReason(""); }}>{t("Cancel")}</Button>
        </div>
      )}
      {(order.driver || showHistory) && (
        <div className="text-xs">
          <button type="button" className="text-primary underline underline-offset-2" onClick={() => setShowHistory((v) => !v)}>{showHistory ? t("Hide rider history") : t("Rider history")}</button>
          {showHistory && (
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {(history ?? []).length === 0 && <li>{t("No rider changes yet.")}</li>}
              {(history ?? []).map((h) => (
                <li key={h.id}>{time(fmt, h.at)} · {h.from ?? t("Unassigned")} → {h.to ?? t("Unassigned")} {t("· by {by}", { by: h.by })}{h.reason ? ` · ${h.reason}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function ZonesTab({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: zones, isLoading } = useZones(branchId);
  const { create, remove, update } = useZoneActions(branchId);
  const [form, setForm] = useState({ name: "", fee: "40", minOrderAmount: "0", etaMinutes: "45", pincodes: "" });

  const submit = () => {
    const pincodes = form.pincodes.split(/[\s,]+/).filter(Boolean);
    if (!form.name.trim() || pincodes.length === 0) return toast.error(t("Enter a name and at least one pincode"));
    create.mutate(
      {
        name: form.name.trim(),
        fee: form.fee,
        minOrderAmount: form.minOrderAmount,
        etaMinutes: Number(form.etaMinutes),
        pincodes,
        isActive: true,
      },
      {
        onSuccess: () => {
          toast.success(t("Zone added"));
          setForm({ ...form, name: "", pincodes: "" });
        },
        onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input placeholder={t("Zone name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder={t("Fee")} inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
        <Input placeholder={t("Min order")} inputMode="decimal" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} />
        <Input placeholder={t("ETA (min)")} inputMode="numeric" value={form.etaMinutes} onChange={(e) => setForm({ ...form, etaMinutes: e.target.value })} />
        <Input placeholder={t("Pincodes, comma separated")} value={form.pincodes} onChange={(e) => setForm({ ...form, pincodes: e.target.value })} />
        <div className="sm:col-span-2 lg:col-span-5">
          <Button onClick={submit} disabled={create.isPending}>{t("Add zone")}</Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Until you add a zone, delivery orders are accepted from anywhere with no fee. Once a zone exists, only its pincodes can order delivery.")}
          </p>
        </div>
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : zones && zones.length > 0 ? (
          zones.map((z) => (
            <div key={z.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className={cn("font-medium", !z.isActive && "text-muted-foreground line-through")}>{z.name}</p>
                <p className="text-xs text-muted-foreground">{t("{formatCurrency} fee · min {formatCurrency2} · {etaMinutes} min · {join}", { formatCurrency: fmt.currency(z.fee), formatCurrency2: fmt.currency(z.minOrderAmount), etaMinutes: z.etaMinutes, join: z.pincodes.join(", ") })}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate({ id: z.id, dto: { isActive: !z.isActive } }, { onError: (e) => toast.error(errMsg(e, t("Something went wrong"))) })}
                >
                  {z.isActive ? t("Disable") : t("Enable")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirm(t("Delete zone {name}?", { name: z.name })) && remove.mutate(z.id)}
                >
                  {t("Delete")}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No delivery zones yet.")}</p>
        )}
      </Card>
    </div>
  );
}

function RidersPanel({ branchId }: { branchId: string | null }) {
  const { t } = useI18n();
  const { data: drivers, dataUpdatedAt } = useDrivers(branchId);
  if (!drivers || drivers.length === 0) return null;
  const ago = (iso: string | null) => {
    if (!iso) return t("no location yet");
    const m = Math.max(Math.round((dataUpdatedAt - new Date(iso).getTime()) / 60_000), 0);
    return m < 1 ? t("just now") : m < 60 ? t("{m} min ago", { m }) : t("{round} h ago", { round: Math.round(m / 60) });
  };
  return (
    <section aria-labelledby="riders-h" className="flex flex-col gap-2">
      <h2 id="riders-h" className="text-sm font-medium text-foreground">{t("Riders ({count} online)", { count: drivers.filter((d) => d.riderOnline).length })}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {drivers.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                <span className={d.riderOnline ? "text-success" : "text-muted-foreground"} aria-hidden>
                  ●
                </span>{" "}
                {d.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {d.riderOnline ? t("Online") : t("Offline")} {t("· {activeDeliveries} active", { activeDeliveries: d.activeDeliveries })}{d.riderOnline && ` · ${ago(d.riderLocationAt)}`}
              </p>
            </div>
            {d.riderOnline && d.riderLat != null && d.riderLng != null && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${d.riderLat},${d.riderLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-primary underline underline-offset-2"
              >
                {t("Map")}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DeliveryPage() {
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const [tab, setTab] = useState<"active" | "history" | "zones">("active");
  const { data: orders, isLoading } = useDeliveries(branchId, tab === "history");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Delivery")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Assign drivers, track deliveries, and manage zones")}</p>
      </div>
      <RidersPanel branchId={branchId} />
      <div className="flex gap-2">
        {(["active", "history", "zones"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs capitalize transition-colors",
              tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {translate(t)}
          </button>
        ))}
      </div>
      {tab === "zones" ? (
        <ZonesTab branchId={branchId} />
      ) : isLoading ? (
        <Skeleton className="h-24" />
      ) : orders && orders.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((o) => (
            <DeliveryCard key={o.id} order={o} branchId={branchId} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {tab === "active" ? translate("No active deliveries.") : translate("No completed deliveries yet.")}
        </Card>
      )}
    </div>
  );
}
