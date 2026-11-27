"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { type Translate, useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeviceAction, usePosDevices } from "@/hooks/use-pos-devices";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const ago = (t: Translate, fmt: StaffFormat, iso: string | null) => {
  if (!iso) return t("never");
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return t("just now");
  if (m < 60) return t("{m} min ago", { m });
  if (m < 1440) return t("{round} h ago", { round: Math.round(m / 60) });
  return new Date(iso).toLocaleDateString(fmt.localeTag);
};

export default function DevicesPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading, isError } = usePosDevices();
  const act = useDeviceAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  const run = (id: string, action: "revoke" | "restore") =>
    act.mutate({ id, action }, {
      onSuccess: () => { toast.success(action === "revoke" ? t("Phone removed") : t("Phone allowed again")); setConfirm(null); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Could not update")),
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Phones that take orders for this restaurant")}</p>
      </div>
      <SettingsTabs />
      <p className="text-sm text-muted-foreground">
        {t("A phone appears here the first time it syncs. Removing a phone stops it at once, even if the person is still signed in; the same person can keep working on another phone or the web.")}
      </p>
      {isLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : isError ? (
        <Card className="p-6 text-sm text-destructive">{t("Could not load the phones.")}</Card>
      ) : data && data.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.map((d) => (
            <Card key={d.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.name}</span>
                {d.revokedAt ? <Badge variant="outline">{t("Removed")}</Badge> : <Badge>{t("Active")}</Badge>}
                <span className="text-sm text-muted-foreground">{d.user.name} · {d.platform ?? t("phone")} {d.appVersion ?? ""}</span>
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">{t("Last seen")}</dt><dd>{ago(t, fmt, d.lastSeenAt)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("Last synced")}</dt><dd>{ago(t, fmt, d.lastSyncAt)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("Waiting to send")}</dt><dd className="tabular-nums">{d.pendingCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("Needs attention")}</dt><dd className={`tabular-nums ${d.failedCount ? "font-semibold text-destructive" : ""}`}>{d.failedCount}</dd></div>
              </dl>
              {d.lastError && <p className="text-sm text-destructive">{t("Last problem: {lastError}", { lastError: d.lastError })}</p>}
              <div className="flex gap-2">
                {d.revokedAt ? (
                  <Button size="sm" variant="outline" onClick={() => run(d.id, "restore")}>{t("Allow again")}</Button>
                ) : confirm === d.id ? (
                  <><span className="self-center text-sm">{t("Stop this phone now?")}</span><Button size="sm" variant="destructive" onClick={() => run(d.id, "revoke")}>{t("Yes, remove")}</Button><Button size="sm" variant="outline" onClick={() => setConfirm(null)}>{t("No")}</Button></>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => setConfirm(d.id)}>{t("Remove this phone")}</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="py-14 text-center text-sm text-muted-foreground">{t("No phones yet. They appear after the app syncs once.")}</Card>
      )}
    </div>
  );
}
