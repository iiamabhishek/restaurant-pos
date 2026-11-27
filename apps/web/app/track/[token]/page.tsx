"use client";

import { useQuery } from "@tanstack/react-query";
import { Bike, CheckCircle2, MapPin, Phone, XCircle } from "lucide-react";
import { use } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Track {
  orderNumber: string;
  restaurant: string;
  restaurantPhone: string | null;
  promisedAt: string | null;
  destination: { lat: number; lng: number } | null;
  status: "UNASSIGNED" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED" | "CANCELLED";
  rider: { firstName: string; lat: number; lng: number; updatedSecondsAgo: number } | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  note: string | null;
}

const STEPS = [
  { key: "UNASSIGNED", label: "Preparing" },
  { key: "ASSIGNED", label: "Rider assigned" },
  { key: "PICKED_UP", label: "On the way" },
  { key: "DELIVERED", label: "Delivered" },
] as const;

// Public page behind the link the restaurant sends. It refreshes by itself while the delivery is live, and shows the
// rider's distance and a rough arrival only while the rider is sharing a fresh position.
export default function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, error, isLoading } = useQuery({
    queryKey: ["track", token],
    queryFn: () => api.get<Track>(`/public/track/${encodeURIComponent(token)}`),
    retry: false,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "DELIVERED" || s === "FAILED" || s === "CANCELLED" ? false : 10_000;
    },
  });

  if (isLoading)
    return <main className="mx-auto max-w-md p-6"><Skeleton className="h-64 rounded-2xl" /></main>;
  if (error || !data)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-semibold text-foreground">This link has expired</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError && error.status === 404 ? "We could not find this delivery." : "Ask the restaurant for a new tracking link."}
        </p>
      </main>
    );

  const idx = STEPS.findIndex((s) => s.key === data.status);
  const closed = data.status === "FAILED" || data.status === "CANCELLED";
  const map = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-5">
      <header>
        <p className="text-sm text-muted-foreground">{data.restaurant}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Order {data.orderNumber}</h1>
      </header>

      {closed ? (
        <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-4" role="status">
          <XCircle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm font-medium text-foreground">
            {data.status === "CANCELLED" ? "This order was cancelled." : "We could not deliver this order. The restaurant will contact you."}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Delivery progress">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-3" aria-current={i === idx ? "step" : undefined}>
              {i < idx || data.status === "DELIVERED" ? (
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
              ) : (
                <span className={cn("h-5 w-5 rounded-full border-2", i === idx ? "border-primary bg-primary/20" : "border-border")} aria-hidden />
              )}
              <span className={cn("text-sm", i === idx ? "font-semibold text-foreground" : "text-muted-foreground")}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      {data.rider ? (
        <section className="flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-foreground/10" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Bike className="h-4 w-4" aria-hidden /> {data.rider.firstName} is on the way
          </p>
          {data.distanceKm != null && data.etaMinutes != null && (
            <p className="text-3xl font-semibold tabular-nums text-foreground">
              about {data.etaMinutes} min <span className="text-base font-normal text-muted-foreground">· {data.distanceKm} km away</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Position updated {data.rider.updatedSecondsAgo < 60 ? "just now" : `${Math.round(data.rider.updatedSecondsAgo / 60)} min ago`}. The time is an estimate.
          </p>
          <a className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline" href={map(data.rider.lat, data.rider.lng)} target="_blank" rel="noopener noreferrer">
            <MapPin className="h-4 w-4" aria-hidden /> See where they are
          </a>
        </section>
      ) : (
        data.note && <p className="rounded-2xl bg-secondary/40 p-4 text-sm text-foreground" role="status">{data.note}</p>
      )}

      {data.status === "DELIVERED" && <p className="text-sm text-muted-foreground">Delivered. Enjoy your meal.</p>}

      {data.restaurantPhone && (
        <a className="mt-auto inline-flex items-center gap-2 text-sm text-muted-foreground" href={`tel:${data.restaurantPhone}`}>
          <Phone className="h-4 w-4" aria-hidden /> Call {data.restaurant}
        </a>
      )}
    </main>
  );
}
