"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useRealtimeState } from "@/lib/realtime-status";
import { BranchNotice } from "@/components/layout/branch-notice";
import { AlertTriangle, ChefHat, CircleDollarSign, SlidersHorizontal, ClipboardList, Flame, Globe, HandCoins, ReceiptText, Store, Timer, TrendingUp, Trash2, UserRound, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog";
import { RefundDialog } from "@/components/orders/refund-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { useManagedOrders } from "@/hooks/use-orders";
import { openEntity } from "@/lib/entity-events";
import { CustomizePanel } from "@/components/dashboard/customize-panel";
import {
  DEFAULT_DASHBOARD_PREFS,
  useDashboardPrefs,
  useDashboardSummary,
  useDashboardTrends,
  useSaveDashboardPrefs,
} from "@/hooks/use-dashboard";
import { cn } from "@/lib/utils";

const ONLINE_ORDER_TYPES = new Set(["QR_ORDER", "KIOSK"]);

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  href,
  size = "default",
  className,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  accent?: "success" | "warning";
  /** Where the full records behind this number live. */
  href: string;
  /** hero = the one number to look at first; compact = supporting figures. */
  size?: "hero" | "default" | "compact";
  className?: string;
}) {
  const { t } = useI18n();
  const hero = size === "hero";
  const compact = size === "compact";
  return (
    <Link
      href={href}
      aria-label={t("{label}: {value}. Open details", { label, value })}
      className={cn(
        "group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        className,
      )}
    >
    <Card
      className={cn(
        "flex h-full flex-col transition group-hover:border-primary/40 group-hover:shadow-md",
        hero
          ? "justify-between gap-3 border-success/25 bg-gradient-to-br from-success/10 via-card to-card p-5"
          : compact
            ? "gap-2 p-4"
            : "gap-3 p-4",
        accent === "warning" && !hero && "border-warning/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("font-medium text-muted-foreground", compact ? "text-xs" : "text-[13px]")}>{label}</span>
        <div
          className={cn(
            "flex items-center justify-center rounded-xl",
            compact ? "h-7 w-7" : "h-9 w-9",
            accent === "success" && "bg-success/10 text-success",
            accent === "warning" && "bg-warning/10 text-warning",
            !accent && "bg-primary/10 text-primary",
          )}
        >
          <Icon className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} />
        </div>
      </div>
      <span
        className={cn(
          "font-semibold tabular-nums tracking-tight text-foreground",
          hero ? "text-3xl sm:text-4xl" : compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl",
        )}
      >
        {value}
      </span>
    </Card>
    </Link>
  );
}

function TableStatusRow({
  label,
  count,
  dotClass,
  href,
}: {
  label: string;
  count: number;
  dotClass: string;
  href: string;
}) {
  const { t } = useI18n();
  return (
    <Link
      href={href}
      aria-label={t("{label}: {count}. Open", { label, count })}
      className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-sm outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="font-medium tabular-nums text-foreground">{count}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const realtime = useRealtimeState();
  const { branchId } = useBranch();
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboardSummary(branchId);
  const { data: prefsData } = useDashboardPrefs();
  const prefs = prefsData ?? DEFAULT_DASHBOARD_PREFS;
  const savePrefs = useSaveDashboardPrefs();
  const { data: trends, isLoading: trendsLoading } = useDashboardTrends(branchId, prefs.trendDays);
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const { data: me } = useCurrentUser();
  const [now] = useState(() => new Date());
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (me?.user?.name ?? "").trim().split(/\s+/)[0];
  const today = now.toLocaleDateString(fmt.localeTag, { weekday: "long", day: "numeric", month: "long" });

  // Layout only: where a widget sits and whether it shows. CSS `order` keeps
  // the existing markup in place, and a hidden widget is simply not displayed.
  const slot = (group: "top" | "card", id: string, className = "") => {
    const list = group === "top" ? prefs.topOrder : prefs.cardOrder;
    const index = Math.max(list.indexOf(id), 0);
    // Inline display:none always beats a utility class like `flex` or `grid`.
    return {
      className,
      style: {
        order: (group === "top" ? 10 : 100) + index,
        ...(prefs.hidden.includes(id) ? { display: "none" } : {}),
      },
    };
  };

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold lg:text-[28px] tracking-tight text-foreground">
            {t(greeting)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2" aria-hidden>
              {realtime === "live" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${realtime === "live" ? "bg-success" : realtime === "offline" ? "bg-destructive" : "bg-muted-foreground"}`} />
            </span>
            {realtime === "live" ? t("Live") : realtime === "offline" ? t("Not updating (server unreachable)") : t("Connecting…")} · {today}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={customizing}
          onClick={() => setCustomizing((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t("Customize")}
        </Button>
      </div>

      {customizing && (
        <CustomizePanel
          prefs={prefs}
          saving={savePrefs.isPending}
          onChange={(next) => savePrefs.mutate(next)}
          onClose={() => setCustomizing(false)}
        />
      )}

      <OrderDetailDialog
        branchId={branchId}
        orderId={viewingOrderId}
        open={!!viewingOrderId}
        onOpenChange={(open) => !open && setViewingOrderId(null)}
      />

      <BranchNotice />

      <PendingOrdersBanner branchId={branchId} />

      <QuickActions />

      <div {...slot("top", "kpis")}>
      {isError ? (
        <QueryError error={error} what={t("the dashboard")} onRetry={() => void refetch()} retrying={isFetching} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>a:last-child:nth-child(odd)]:col-span-2 xl:[&>a:last-child:nth-child(odd)]:col-span-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-[120px] rounded-2xl", i === 0 && "col-span-2 xl:col-span-2")} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>a:last-child:nth-child(odd)]:col-span-2 xl:[&>a:last-child:nth-child(odd)]:col-span-1">
          <StatCard
            label={t("Today's Revenue")}
            value={fmt.currency(data.todayRevenue)}
            icon={Wallet}
            accent="success"
            href="/reports"
            size="hero"
            className="col-span-2 xl:col-span-2"
          />
          <StatCard
            label={t("Today's Orders")}
            value={String(data.todayOrders)}
            icon={ReceiptText}
            href="/orders?tab=history"
          />
          {/* Rendered only for roles that can see accounting figures
              (server returns null otherwise) — cashiers see revenue, not
              outgoings. */}
          {data.todayExpenses !== null && (
            <StatCard
              label="Today's Expenses"
              value={fmt.currency(data.todayExpenses)}
              icon={CircleDollarSign}
              accent={data.todayExpenses > 0 ? "warning" : undefined}
              href="/accounting"
            />
          )}
          <StatCard
            label={t("Occupied Tables")}
            value={String(data.tables.occupied)}
            icon={ClipboardList}
            href="/tables"
          />
          <StatCard
            label={t("Kitchen Queue")}
            value={String(
              data.kitchenQueue.new + data.kitchenQueue.accepted + data.kitchenQueue.preparing,
            )}
            icon={Flame}
            accent="warning"
            href="/kds"
            className="col-span-2 xl:col-span-1"
          />
        </div>
      )}
      </div>

      {data && (
        <div {...slot("top", "attention", "grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>a:last-child:nth-child(odd)]:col-span-2 xl:[&>a:last-child:nth-child(odd)]:col-span-1")}>
          <StatCard
            size="compact"
            label={t("Pending payments")}
            value={
              data.pendingPayments.count === 0
                ? "0"
                : `${data.pendingPayments.count} · ${fmt.currency(data.pendingPayments.balance)}`
            }
            icon={HandCoins}
            accent={data.pendingPayments.count > 0 ? "warning" : undefined}
            href="/orders?tab=active"
          />
          {data.lowStock !== null && (
            <StatCard
            size="compact"
              label={t("Low stock")}
              value={String(data.lowStock)}
              icon={AlertTriangle}
              accent={data.lowStock > 0 ? "warning" : undefined}
              href="/inventory?filter=low"
            />
          )}
          {data.customers !== null && (
            <StatCard size="compact" label={t("Customers")} value={String(data.customers)} icon={Users} href="/customers" />
          )}
          {data.employees !== null && (
            <StatCard size="compact" label={t("Team members")} value={String(data.employees)} icon={UserRound} href="/team" />
          )}
          {data.unpaidPayrollRuns !== null && (
            <StatCard
            size="compact"
              label={t("Payroll to pay")}
              value={String(data.unpaidPayrollRuns)}
              icon={Wallet}
              accent={data.unpaidPayrollRuns > 0 ? "warning" : undefined}
              href="/team?tab=payroll"
            />
          )}
        </div>
      )}

      <div {...slot("top", "charts", "grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2")}>
        <TrendChart
          title={t("Revenue — last {trendDays} days", { trendDays: prefs.trendDays })}
          icon={TrendingUp}
          data={trends?.revenue ?? []}
          valueKey="amount"
          color="var(--success)"
          valueFormatter={(v) => fmt.currency(v)}
          isLoading={trendsLoading}
          emptyMessage={t("No paid orders in the last {trendDays} days yet.", { trendDays: prefs.trendDays })}
        />
        <TrendChart
          title={t("Food waste cost — last {trendDays} days", { trendDays: prefs.trendDays })}
          icon={Trash2}
          data={trends?.waste ?? []}
          valueKey="cost"
          color="var(--warning)"
          valueFormatter={(v) => fmt.currency(v)}
          isLoading={trendsLoading}
          emptyMessage={t("No waste logged in the last {trendDays} days — nice.", { trendDays: prefs.trendDays })}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4" style={{ order: 100 }}>
        <Card {...slot("card", "tables", "flex flex-col gap-1 p-4 lg:col-span-1")}>
          <h2 className="mb-3 text-base font-medium text-foreground">{t("Tables")}</h2>
          {data && (
            <>
              <TableStatusRow label={t("Available")} count={data.tables.available} dotClass="bg-success" href="/tables" />
              <TableStatusRow label={t("Occupied")} count={data.tables.occupied} dotClass="bg-primary" href="/tables" />
              <TableStatusRow label={t("Reserved")} count={data.tables.reserved} dotClass="bg-warning" href="/tables" />
              <TableStatusRow label={t("Cleaning")} count={data.tables.cleaning} dotClass="bg-muted-foreground" href="/tables" />
            </>
          )}
        </Card>

        <Card {...slot("card", "kitchen", "flex flex-col gap-1 p-4 lg:col-span-1")}>
          <h2 className="mb-3 flex items-center gap-2 text-base font-medium text-foreground">
            <ChefHat className="h-[18px] w-[18px] text-muted-foreground" />
            {t("Kitchen queue")}
          </h2>
          {data && (
            <>
              <TableStatusRow label={t("New")} count={data.kitchenQueue.new} dotClass="bg-primary" href="/kds" />
              <TableStatusRow label={t("Accepted")} count={data.kitchenQueue.accepted} dotClass="bg-warning" href="/kds" />
              <TableStatusRow label={t("Preparing")} count={data.kitchenQueue.preparing} dotClass="bg-warning" href="/kds" />
              <TableStatusRow label={t("Ready")} count={data.kitchenQueue.ready} dotClass="bg-success" href="/kds" />
            </>
          )}
        </Card>

        <Card {...slot("card", "recent", "flex flex-col gap-3 p-4 lg:col-span-1")}>
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Timer className="h-[18px] w-[18px] text-muted-foreground" />
            {t("Recent transactions")}
          </h2>
          <div className="flex flex-col divide-y divide-border">
            {data?.recentOrders.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">{t("No sales yet today.")}</p>
            )}
            {data?.recentOrders.map((order) => {
              const isOnline = ONLINE_ORDER_TYPES.has(order.type);
              return (
                <div key={order.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <button
                    type="button"
                    onClick={() => setViewingOrderId(order.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md text-left outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
                    title={t("View order details")}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">#{order.orderNumber}</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "mt-0.5 w-fit text-[11px] font-normal",
                          isOnline && "bg-primary/10 text-primary",
                        )}
                      >
                        {fmt.code(order.type)}
                      </Badge>
                    </div>
                    <span className="font-medium tabular-nums text-foreground">
                      {fmt.currency(order.totalAmount)}
                    </span>
                  </button>
                  <RefundDialog
                    branchId={branchId}
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    maxAmount={Number(order.totalAmount)}
                  />
                </div>
              );
            })}
          </div>
        </Card>

        <Card {...slot("card", "channels", "flex flex-col gap-3 p-4 lg:col-span-1")}>
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <ReceiptText className="h-[18px] w-[18px] text-muted-foreground" />
            {t("Order channels")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("Today, self-serve vs staff-entered")}</p>
          {data && (
            <>
              <Link
                href="/orders?tab=history&filter=online"
                aria-label={t("Online orders today: {online}. Open", { online: data.channels.online })}
                className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-sm outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Globe className="h-3.5 w-3.5" />
                  {t("Online (QR / kiosk)")}
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {data.channels.online}
                </span>
              </Link>
              <Link
                href="/orders?tab=history&filter=offline"
                aria-label={t("Offline orders today: {offline}. Open", { offline: data.channels.offline })}
                className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Store className="h-3.5 w-3.5" />
                  {t("Offline (dine-in / takeaway / phone)")}
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {data.channels.offline}
                </span>
              </Link>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${
                      data.channels.online + data.channels.offline === 0
                        ? 0
                        : (data.channels.online / (data.channels.online + data.channels.offline)) * 100
                    }%`,
                  }}
                />
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// Online orders waiting for a decision — shown on top so they can't be missed.
function PendingOrdersBanner({ branchId }: { branchId: string | null }) {
  const { t } = useI18n();
  const { data } = useManagedOrders(branchId, "pending");
  if (!data || data.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">{(data.length === 1 ? t("{count} online order waiting for you", { count: data.length }) : t("{count} online orders waiting for you", { count: data.length }))}</p>
        <p className="text-xs text-muted-foreground">{t("Accept or reject so the kitchen can start.")}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => openEntity("Order", data[0].id)}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >{t("Review #{orderNumber}", { orderNumber: data[0].orderNumber })}</button>
        <Link href="/orders" className="rounded-lg border border-border px-3 py-1.5 text-sm">
          {t("All orders")}
        </Link>
      </div>
    </Card>
  );
}
