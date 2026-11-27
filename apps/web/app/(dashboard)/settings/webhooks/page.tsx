"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebhookActions, useWebhookDeliveries, useWebhookEvents, useWebhooks } from "@/hooks/use-webhooks";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Deliveries({ id }: { id: string }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data } = useWebhookDeliveries(id);
  if (!data) return <Skeleton className="h-10" />;
  if (data.length === 0) return <p className="text-xs text-muted-foreground">{t("Nothing sent yet.")}</p>;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {data.map((d) => (
        <li key={d.id} className="flex flex-wrap justify-between gap-2">
          <span className="font-mono text-foreground">{d.event}</span>
          <span
            className={cn(
              d.status === "SUCCESS" && "text-success",
              d.status === "FAILED" && "text-destructive",
              d.status === "PENDING" && "text-muted-foreground",
            )}
          >{(d.attempts === 1 ? t("{code} · {attempts} attempt", { code: fmt.code(d.status), attempts: d.attempts }) : t("{code} · {attempts} attempts", { code: fmt.code(d.status), attempts: d.attempts }))}{d.lastError && ` · ${d.lastError}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function WebhooksPage() {
  const { t } = useI18n();
  const { data: hooks, isLoading } = useWebhooks();
  const { data: allEvents } = useWebhookEvents();
  const { create, setActive, remove, test } = useWebhookActions();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(["order.paid"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (e: string) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Restaurant, branch, and staff configuration")}</p>
      </div>
      <SettingsTabs />

      <Card className="flex max-w-3xl flex-col gap-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("Webhooks")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Send signed events to a URL when something happens — connect accounting, WhatsApp/SMS, payment or delivery tools through an automation service (n8n, Zapier, Make) or your own server.")}
          </p>
        </div>

        {secret && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <p className="font-medium text-foreground">{t("Signing secret — copy it now, it won’t be shown again")}</p>
            <p className="mt-1 select-all break-all font-mono text-xs">{secret}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success(t("Copied")))}>
                {t("Copy")}
              </Button>
              <Button size="sm" onClick={() => setSecret(null)}>{t("Done")}</Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Input placeholder="https://example.com/orderrestro-hook" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Input placeholder={t("Description (optional)")} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {allEvents?.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => toggle(e)}
                className={cn(
                  "rounded-full border px-3 py-1 font-mono text-xs",
                  events.includes(e) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                )}
              >
                {e}
              </button>
            ))}
          </div>
          <div>
            <Button
              disabled={!url.trim() || events.length === 0 || create.isPending}
              onClick={() =>
                create.mutate(
                  { url: url.trim(), events, description: description.trim() || undefined },
                  {
                    onSuccess: (r) => {
                      setSecret(r.secret);
                      setUrl("");
                      setDescription("");
                    },
                    onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
                  },
                )
              }
            >
              {t("Add webhook")}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="flex max-w-3xl flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : hooks && hooks.length > 0 ? (
          hooks.map((h) => (
            <div key={h.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("truncate font-mono text-sm", !h.isActive && "text-muted-foreground line-through")}>{h.url}</p>
                  <p className="text-xs text-muted-foreground">{h.events.join(", ")}{h.description && ` · ${h.description}`}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={test.isPending}
                    onClick={() =>
                      test.mutate(h.id, {
                        onSuccess: (r) =>
                          r.status === "SUCCESS"
                            ? toast.success(t("Receiver answered {lastStatusCode}", { lastStatusCode: (r.lastStatusCode) ?? "" }))
                            : toast.error(r.lastError ?? t("Receiver did not accept the test (it will be retried)")),
                        onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
                      })
                    }
                  >
                    {t("Send test")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOpen(open === h.id ? null : h.id)}>{t("Log")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setActive.mutate({ id: h.id, isActive: !h.isActive })}>
                    {h.isActive ? t("Pause") : t("Resume")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => confirm(t("Delete this webhook?")) && remove.mutate(h.id)}>{t("Delete")}</Button>
                </div>
              </div>
              {open === h.id && <Deliveries id={h.id} />}
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No webhooks yet.")}</p>
        )}
      </Card>

      <Card className="max-w-3xl p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("Verifying a request")}</p>
        <p className="mt-1">
          {t("Each request has an")} <code>X-OrderRestro-Signature</code> {t("header:")} <code>t=&lt;unix time&gt;,v1=&lt;hex&gt;</code>{t(", where")} <code>v1</code> {t("is the HMAC-SHA256 of")} <code>{"{t}.{raw body}"}</code> {t("with your signing secret. Reject anything older than five minutes. Failed deliveries are retried up to 6 times (1 min, 5 min, 30 min, 2 h, 12 h). Respond with any 2xx to accept.")}
        </p>
      </Card>
    </div>
  );
}
