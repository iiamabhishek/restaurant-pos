"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import {
  useAudience,
  useCampaigns,
  useCoupons,
  useMarketingActions,
  usePromotions,
} from "@/hooks/use-marketing";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TABS = ["coupons", "happy hour", "campaigns"] as const;
type Tab = (typeof TABS)[number];
const discountText = (fmt: StaffFormat, kind: string, value: string) =>
  fmt.label("{discount} off", { discount: kind === "PERCENT" ? fmt.percent(Number(value)) : fmt.currency(value) });

function Coupons({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading } = useCoupons(branchId);
  const { createCoupon, couponActive, deleteCoupon } = useMarketingActions(branchId);
  const [f, setF] = useState({ code: "", kind: "PERCENT", value: "", minOrderAmount: "", usageLimit: "" });

  const submit = () => {
    createCoupon.mutate(
      {
        code: f.code,
        kind: f.kind,
        value: Number(f.value),
        minOrderAmount: f.minOrderAmount ? Number(f.minOrderAmount) : 0,
        usageLimit: f.usageLimit ? Number(f.usageLimit) : undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("Coupon created"));
          setF({ ...f, code: "", value: "", minOrderAmount: "", usageLimit: "" });
        },
        onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Input placeholder={t("CODE")} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        <select aria-label={t("Type")} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
          <option value="PERCENT">{t("Percent")}</option>
          <option value="FLAT">{t("Flat amount")}</option>
        </select>
        <Input placeholder={t("Value")} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        <Input placeholder={t("Min order")} inputMode="decimal" value={f.minOrderAmount} onChange={(e) => setF({ ...f, minOrderAmount: e.target.value })} />
        <Input placeholder={t("Max uses")} inputMode="numeric" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} />
        <Button onClick={submit} disabled={createCoupon.isPending}>{t("Create")}</Button>
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : data && data.length > 0 ? (
          data.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className={cn("font-mono font-medium", !c.isActive && "text-muted-foreground line-through")}>{c.code}</p>
                <p className="text-xs text-muted-foreground">
                  {discountText(fmt, c.kind, c.value)}
                  {Number(c.minOrderAmount) > 0 && t(" · min {formatCurrency}", { formatCurrency: fmt.currency(c.minOrderAmount) })}
                  {t(" · used {usedCount}{value}", { usedCount: c.usedCount, value: c.usageLimit ? ` / ${c.usageLimit}` : "" })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => couponActive.mutate({ id: c.id, isActive: !c.isActive })}>
                  {c.isActive ? t("Disable") : t("Enable")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => confirm(t("Delete coupon {code}?", { code: c.code })) && deleteCoupon.mutate(c.id)}>
                  {t("Delete")}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No coupons yet.")}</p>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        {t("Cashiers enter a code at checkout. A coupon never stacks with a happy-hour discount — the bigger one applies.")}
      </p>
    </div>
  );
}

function HappyHour({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading } = usePromotions(branchId);
  const { createPromotion, promotionActive, deletePromotion } = useMarketingActions(branchId);
  const [f, setF] = useState({ name: "", kind: "PERCENT", value: "", start: "16:00", end: "19:00", days: [1, 2, 3, 4, 5] as number[] });
  const toggleDay = (d: number) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] });

  const submit = () =>
    createPromotion.mutate(
      { name: f.name, kind: f.kind, value: Number(f.value), daysOfWeek: f.days, startTime: f.start, endTime: f.end },
      {
        onSuccess: () => { toast.success(t("Happy hour created")); setF({ ...f, name: "", value: "" }); },
        onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder={t("Name (e.g. Weekday happy hour)")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select aria-label={t("Type")} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
            <option value="PERCENT">{t("Percent")}</option>
            <option value="FLAT">{t("Flat amount")}</option>
          </select>
          <Input placeholder={t("Value")} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          <Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          <Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DAY_NAMES.map((n, d) => (
            <button key={n} type="button" onClick={() => toggleDay(d)} className={cn("rounded-full border px-3 py-1 text-xs", f.days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>
              {t(n)}
            </button>
          ))}
          <Button className="ml-auto" onClick={submit} disabled={createPromotion.isPending}>{t("Create")}</Button>
        </div>
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : data && data.length > 0 ? (
          data.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className={cn("font-medium", !p.isActive && "text-muted-foreground line-through")}>{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {discountText(fmt, p.kind, p.value)} · {p.daysOfWeek.map((d) => t(DAY_NAMES[d])).join(", ")} · {p.startTime}–{p.endTime}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => promotionActive.mutate({ id: p.id, isActive: !p.isActive })}>
                  {p.isActive ? t("Pause") : t("Resume")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => confirm(t("Delete {name}?", { name: p.name })) && deletePromotion.mutate(p.id)}>
                  {t("Delete")}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No happy hours yet.")}</p>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t("Applied automatically at checkout during the window, in the restaurant’s timezone.")}</p>
    </div>
  );
}

function AudienceCount({ branchId, id }: { branchId: string | null; id: string }) {
  const { t } = useI18n();
  const { data } = useAudience(branchId, id);
  return <span>{data ? t("{count} recipients", { count: data.count }) : "…"}</span>;
}

function Campaigns({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading } = useCampaigns(branchId);
  const { createCampaign, deleteCampaign, sendCampaign } = useMarketingActions(branchId);
  const [f, setF] = useState({ name: "", channel: "SMS", segment: "ALL", message: "" });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input placeholder={t("Campaign name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select aria-label={t("Channel")} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
            <option value="SMS">{t("SMS")}</option>
            <option value="WHATSAPP">{t("WhatsApp")}</option>
            <option value="EMAIL">{t("Email")}</option>
          </select>
          <select aria-label={t("Audience")} value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
            <option value="ALL">{t("All customers")}</option>
            <option value="LOYAL">{t("Loyal (5+ orders)")}</option>
            <option value="LAPSED">{t("Lapsed (60+ days)")}</option>
            <option value="BIRTHDAY_MONTH">{t("Birthday this month")}</option>
          </select>
        </div>
        <textarea
          aria-label={t("Message")}
          placeholder={t("Message")}
          maxLength={600}
          value={f.message}
          onChange={(e) => setF({ ...f, message: e.target.value })}
          className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <div>
          <Button
            disabled={createCampaign.isPending}
            onClick={() =>
              createCampaign.mutate(f, {
                onSuccess: () => { toast.success(t("Campaign saved")); setF({ ...f, name: "", message: "" }); },
                onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
              })
            }
          >
            {t("Save campaign")}
          </Button>
        </div>
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : data && data.length > 0 ? (
          data.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{c.name} <span className="text-xs text-muted-foreground">· {fmt.code(c.channel)} · {fmt.code(c.segment)}</span></p>
                <p className="text-xs text-muted-foreground">{c.message}</p>
                <p className="text-xs text-muted-foreground">
                  <AudienceCount branchId={branchId} id={c.id} />
                  {c.lastSentAt && t(" · last sent {toLocaleString} to {value}", { toLocaleString: new Date(c.lastSentAt).toLocaleString(fmt.localeTag), value: c.lastSentCount ?? 0 })}
                </p>
              </div>
              <div className="flex gap-2">
                <a href={`/api/v1/marketing/campaigns/${c.id}/audience.csv?branchId=${branchId}`} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-secondary">
                  <Download className="mr-2 h-4 w-4" /> {t("Audience CSV")}
                </a>
                <Button
                  size="sm"
                  disabled={sendCampaign.isPending}
                  onClick={() =>
                    confirm(t("Send \"{name}\" now to everyone in this audience?", { name: c.name })) &&
                    sendCampaign.mutate(c.id, {
                      onSuccess: (r) => toast.success(t("Sent to {sent}{value}", { sent: r.sent, value: r.failed ? t(", {failed} failed", { failed: r.failed }) : "" })),
                      onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
                    })
                  }
                >
                  {t("Send now")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => confirm(t("Delete {name}?", { name: c.name })) && deleteCampaign.mutate(c.id)}>{t("Delete")}</Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No campaigns yet.")}</p>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        {t("Email is sent through your SMTP server (set")} <code>SMTP_URL</code> {t("and")} <code>SMTP_FROM</code> {t("on the server). SMS and WhatsApp are handed to a webhook subscribed to")} <code>campaign.message</code> {t("(Settings > Webhooks) for your messaging service to deliver. Customers marked “do not send marketing” are always excluded.")}
      </p>
    </div>
  );
}

export default function MarketingPage() {
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const [tab, setTab] = useState<Tab>("coupons");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Marketing")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Coupons, happy hours and customer campaigns")}</p>
      </div>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-full border px-3.5 py-1 text-xs capitalize transition-colors", tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary")}>
            {translate(t)}
          </button>
        ))}
      </div>
      {tab === "coupons" && <Coupons branchId={branchId} />}
      {tab === "happy hour" && <HappyHour branchId={branchId} />}
      {tab === "campaigns" && <Campaigns branchId={branchId} />}
    </div>
  );
}
