"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { type Translate, useI18n } from "@/lib/i18n/context";
import { AlertTriangle, CheckCircle2, CircleDashed, Copy, ExternalLink, FlaskConical, ShieldAlert, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGatewayActions,
  useGatewayCatalog,
  useGatewayConnections,
  useRecentGatewayPayments,
  useRefundsToReview,
  useResolveRefund,
  type GatewayMode,
  type GatewayPaymentRow,
  type GatewayProvider,
} from "@/hooks/use-payment-gateways";
import { ApiError } from "@/lib/api";
import { countryOptions } from "@/lib/countries";
import { fromMinorUnits } from "@/lib/money-units";

const LIVE_PHRASE = "ENABLE LIVE PAYMENTS";
const when = (t: Translate, fmt: StaffFormat, s: string | null) => (s ? new Date(s).toLocaleString(fmt.localeTag) : t("Never"));
const SELECT =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={t("Copy {label}", { label })}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {done ? t("Copied") : t("Copy")}
    </Button>
  );
}

const PILL = "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-medium";
/** Words plus an icon, never colour alone. */
function StatusLine({ p }: { p: GatewayProvider }) {
  const { t } = useI18n();
  const c = p.connection;
  if (!p.integrated) return <span className="text-sm text-muted-foreground">{t("Not integrated with OrderRestro yet")}</span>;
  if (!c) return <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><CircleDashed className="h-4 w-4" aria-hidden />{t("Not set up")}</span>;
  if (c.lastTestOk === false)
    return <span className={`${PILL} bg-destructive/10 text-destructive`}><ShieldAlert className="h-4 w-4" aria-hidden />{t("Connection problem")}</span>;
  if (!c.enabled)
    return <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><CircleDashed className="h-4 w-4" aria-hidden />{t("Saved, not switched on")}</span>;
  if (c.mode === "TEST")
    return <span className={`${PILL} bg-warning/10 text-warning`}><FlaskConical className="h-4 w-4" aria-hidden />{t("On in Test mode — no real money moves")}</span>;
  return <span className={`${PILL} bg-success/10 text-success`}><Zap className="h-4 w-4" aria-hidden />{t("Live — customers are charged real money")}</span>;
}

function CredentialsForm({ p, country, mode }: { p: GatewayProvider; country: string; mode: GatewayMode }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { save, removeCredentials, test } = useGatewayActions();
  const { note, clear, toast } = useNoteToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const c = p.connection;
  const set = new Set(mode === "TEST" ? (c?.testKeys ?? []) : (c?.liveKeys ?? []));
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t("Something went wrong"));
  const hook = c?.webhookPaths[mode];
  const hookUrl = hook ? `${typeof window === "undefined" ? "" : window.location.origin}${hook}` : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const credentials = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
        if (!Object.keys(credentials).length) return toast.info(t("Nothing new to save"));
        save.mutate(
          { provider: p.key, country, mode, credentials },
          {
            onSuccess: () => {
              setValues({});
              toast.success(t("{value} credentials saved", { value: mode === "TEST" ? t("Test") : t("Live") }));
            },
            onError: fail,
          },
        );
      }}
    >
      {mode === "LIVE" && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("These are your Live keys. Payments taken with them are real.")}
        </p>
      )}
      {p.fields.map((f) => {
        const isSet = set.has(f.key);
        return (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`${p.key}-${mode}-${f.key}`}>
              {t(f.label)}
              {f.required ? "" : t(" (optional)")}
            </Label>
            <Input
              id={`${p.key}-${mode}-${f.key}`}
              // Secrets are write-only: the field is a password input, autofill is off and the saved value is never shown.
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              value={values[f.key] ?? ""}
              placeholder={isSet ? (f.secret ? t("Saved — leave blank to keep") : t("Saved — type to replace")) : ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            {f.help && <p className="text-xs text-muted-foreground">{t(f.help)}</p>}
            {isSet && (
              <p className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Saved")}
              </p>
            )}
          </div>
        );
      })}

      {hookUrl && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
          <p className="font-medium text-foreground">{mode === "TEST" ? t("Test webhook URL") : t("Live webhook URL")}</p>
          <p className="text-muted-foreground">{t("Add this URL to the webhooks for your {mode} account in the {name} dashboard. It must be reachable from the internet (a Cloudflare Tunnel works). Test and Live use different URLs so they never mix.", { name: p.name, mode: mode === "TEST" ? t("test") : t("live") })}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1 text-foreground">{hookUrl}</code>
            <CopyButton text={hookUrl} label={t("webhook URL")} />
          </div>
        </div>
      )}

      <StatusNote note={note} onClear={clear} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? t("Saving…") : t("Save credentials")}</Button>
        {c && (mode === "TEST" ? c.testKeys.length > 0 : c.liveKeys.length > 0) && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending || !(mode === "TEST" ? c.testComplete : c.liveComplete)}
              onClick={() =>
                test.mutate(
                  { provider: p.key, mode },
                  { onSuccess: (r) => (r.ok ? toast.success(t(r.message)) : toast.error(r.message)), onError: fail },
                )
              }
            >
              {test.isPending ? t("Checking…") : t("Test connection")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={removeCredentials.isPending}
              onClick={() => {
                if (window.confirm(t("Delete the saved {value} credentials for {name}?", { value: mode === "TEST" ? t("Test") : t("Live"), name: p.name }))) {
                  removeCredentials.mutate({ provider: p.key, mode }, { onSuccess: () => toast.success(t("Credentials deleted")), onError: fail });
                }
              }}
            >
              {t("Delete credentials")}
            </Button>
          </>
        )}
      </div>
      {c?.lastTestedAt && (
        <p className="text-xs text-muted-foreground">{t("Last check: {when} —", { when: when(t, fmt, c.lastTestedAt) })} {c.lastTestOk ? t("accepted") : (c.lastError ?? t("failed"))}
        </p>
      )}
    </form>
  );
}

function LiveDialog({ p, open, onClose }: { p: GatewayProvider; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { setMode } = useGatewayActions();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Switch {name} to Live mode?", { name: p.name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <dl className="grid gap-2 rounded-lg border border-border bg-secondary/40 p-3">
            <div><dt className="font-medium text-foreground">{t("What changes")}</dt><dd className="text-muted-foreground">{t("New payment links use your Live {name} account. Customers are charged real money, and a paid link closes the bill.", { name: p.name })}</dd></div>
            <div><dt className="font-medium text-foreground">{t("What stays the same")}</dt><dd className="text-muted-foreground">{t("Your Test credentials, past test payments and every bill already paid.")}</dd></div>
            <div><dt className="font-medium text-foreground">{t("Can I undo it?")}</dt><dd className="text-muted-foreground">{t("Yes. Switch back to Test mode at any time. Money already collected is not reversed; refund it from the order.")}</dd></div>
            <div><dt className="font-medium text-foreground">{t("Before switching")}</dt><dd className="text-muted-foreground">{t("We check that {name} accepts your Live credentials. If it does not, nothing changes.", { name: p.name })}</dd></div>
          </dl>
          <Label htmlFor="live-confirm">{t("Type {LIVE_PHRASE} to confirm", { LIVE_PHRASE })}</Label>
          <Input id="live-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          {err && <p className="text-destructive" role="alert">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Stay in Test mode")}</Button>
          <Button
            disabled={text !== LIVE_PHRASE || setMode.isPending}
            onClick={() =>
              setMode.mutate(
                { provider: p.key, mode: "LIVE", confirm: text },
                { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : t("Failed")) },
              )
            }
          >
            {setMode.isPending ? t("Checking credentials…") : t("Switch to Live mode")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderSetup({ p, country, open, onToggle }: { p: GatewayProvider; country: string; open: boolean; onToggle: () => void }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { setEnabled, setMode, removeConnection, removeCustom } = useGatewayActions();
  const { note, clear, toast } = useNoteToast();
  const c = p.connection;
  const [tab, setTab] = useState<GatewayMode>("TEST");
  const [liveOpen, setLiveOpen] = useState(false);
  const integration = p.custom ? p.integration : t(p.integration);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t("Something went wrong"));

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[18px] font-medium text-foreground">{p.name}</h3>
          <StatusLine p={p} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
        {c && (
          <div className="flex items-center gap-2">
            <Label htmlFor={`en-${p.key}`} className="text-xs text-muted-foreground">{t("Accept online payments")}</Label>
            <Switch
              id={`en-${p.key}`}
              checked={c.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(enabled) => setEnabled.mutate({ provider: p.key, enabled }, { onError: fail })}
            />
          </div>
        )}
        <Button size="sm" variant={open || !p.integrated ? "outline" : "default"} aria-expanded={open} onClick={onToggle}>
          {open ? t("Close") : c ? t("Manage") : p.integrated ? t("Set up") : t("Details")}
        </Button>
        </div>
      </div>

      {!open && <p className="text-sm text-muted-foreground">{integration}</p>}

      {!open ? null : !p.integrated ? (
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">{t("OrderRestro cannot take payments through {name} yet, so no credentials are collected for it.", { name: p.name })} {p.custom ? t("This is a provider you added.") : ""}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>{t("How it works: {integration}. The customer pays on the provider's own page; card details never touch OrderRestro.", { integration })}</p>
            {p.limitations.map((l) => (
              <p key={l}>• {t(l)}</p>
            ))}
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as GatewayMode)}>
            <TabsList aria-label={t("Credential mode")} className="w-full">
              {(["TEST", "LIVE"] as const).map((m) => (
                <TabsTrigger key={m} value={m} className="min-h-11 flex-1">
                  {m === "TEST" ? t("Test credentials") : t("Live credentials")}
                  {c?.mode === m && <Badge className="ml-2" variant="secondary">{t("in use")}</Badge>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <CredentialsForm key={`${p.key}-${tab}`} p={p} country={country} mode={tab} />

          {c && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">{t("Mode for customer payments")}</p>
              {c.mode === "TEST" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    <strong>{t("Test mode.")}</strong> {t("Uses your Test credentials. A test payment verifies the setup without moving real money.")} <em>{t("It does not mark the bill as paid.")}</em>
                  </p>
                  <div><Button size="sm" variant="outline" disabled={!c.liveComplete} onClick={() => setLiveOpen(true)}>{t("Switch to Live…")}</Button>
                    {!c.liveComplete && <span className="ml-2 text-xs text-muted-foreground">{t("Save all Live credentials first.")}</span>}</div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground"><strong>{t("Live mode")}</strong> {t("since {when}. Real money is charged and a paid link settles the bill.", { when: when(t, fmt, c.liveConfirmedAt) })}</p>
                  <div><Button size="sm" variant="outline" disabled={setMode.isPending} onClick={() => setMode.mutate({ provider: p.key, mode: "TEST" }, { onError: fail })}>{t("Back to Test mode")}</Button></div>
                </>
              )}
            </div>
          )}
          {c && <LiveDialog p={p} open={liveOpen} onClose={() => setLiveOpen(false)} />}
        </>
      )}

      <StatusNote note={note} onClear={clear} />

      {open && (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a className="inline-flex items-center gap-1 font-medium underline underline-offset-2" href={p.docsUrl} target="_blank" rel="noopener noreferrer">{t("{name} setup documentation", { name: p.name })} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        {c && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={removeConnection.isPending}
            onClick={() => window.confirm(t("Remove {name} and delete all its saved credentials?", { name: p.name })) && removeConnection.mutate(p.key, { onError: fail })}>
            {t("Remove gateway")}
          </Button>
        )}
        {p.custom && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeCustom.mutate(p.key, { onError: fail })}>
            {t("Delete this custom entry")}
          </Button>
        )}
      </div>
      )}
    </Card>
  );
}

function CustomProviderDialog({ country, open, onClose, adapters }: { country: string; open: boolean; onClose: () => void; adapters: { key: string; name: string }[] }) {
  const { t } = useI18n();
  const { saveCustom } = useGatewayActions();
  const [name, setName] = useState("");
  const [docsUrl, setDocsUrl] = useState("");
  const [adapter, setAdapter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Add a custom provider")}</DialogTitle></DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
            saveCustom.mutate(
              { key: `custom-${key}`, name, countries: [country], docsUrl, adapter: adapter || null },
              { onSuccess: () => { setName(""); setDocsUrl(""); setAdapter(""); onClose(); }, onError: (e2) => setErr(e2 instanceof ApiError ? e2.message : t("Failed")) },
            );
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t("Adds a provider to this country's list. It can only take payments if you pick one of the integrations OrderRestro already has; otherwise it is kept as a reference with a link to its documentation.")}
          </p>
          <Label htmlFor="cp-name">{t("Provider name")}</Label>
          <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          <Label htmlFor="cp-docs">{t("Documentation link (https://)")}</Label>
          <Input id="cp-docs" type="url" value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} required />
          <Label htmlFor="cp-adapter">{t("Use an existing integration")}</Label>
          <select id="cp-adapter" className={SELECT} value={adapter} onChange={(e) => setAdapter(e.target.value)}>
            <option value="">{t("None — reference only")}</option>
            {adapters.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
          </select>
          {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("Cancel")}</Button>
            <Button type="submit" disabled={saveCustom.isPending}>{t("Add provider")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAY_LABEL: Record<string, string> = {
  NEEDS_REVIEW: "Needs review",
  SUCCEEDED: "Paid",
  CREATED: "Waiting for customer",
  EXPIRED: "Link expired",
  FAILED: "Could not create link",
};

function PaymentRow({ r }: { r: GatewayPaymentRow }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const attention = r.status === "NEEDS_REVIEW";
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="font-medium tabular-nums text-foreground">{fmt.currency(fromMinorUnits(r.amountMinor, r.currency), r.currency)}</span>
        <span className={`${PILL} ${attention ? "bg-destructive/10 text-destructive" : r.status === "SUCCEEDED" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
          {attention && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          {r.status === "SUCCEEDED" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
          {fmt.label(PAY_LABEL[r.status])}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {r.provider} · {r.mode === "TEST" ? t("Test payment, no real money") : t("Live payment")} · <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString(fmt.localeTag)}</time>
      </p>
      {r.note && <p className={`text-sm ${attention ? "text-foreground" : "text-muted-foreground"}`}>{r.note}</p>}
    </li>
  );
}

/** Closes a refund the owner has checked by hand; never moves money. */
function ResolveRefund({ id, linked }: { id: string; linked: boolean }) {
  const { t } = useI18n();
  const resolve = useResolveRefund();
  const [note, setNote] = useState("");
  const outcome = linked ? "SETTLED_OUTSIDE_GATEWAY" : "NOT_REFUNDED_AT_PROVIDER";
  const inputId = `resolve-note-${id}`;
  return (
    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor={inputId} className="text-xs">
          {linked ? t("How was the customer paid back?") : t("What did you check in the provider dashboard?")}
        </Label>
        <Input id={inputId} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={note.trim().length < 3 || resolve.isPending}
        onClick={() => resolve.mutate({ id, outcome, note: note.trim() })}
      >
        {linked ? t("Mark as settled outside the gateway") : t("No refund exists there: release the hold")}
      </Button>
      {resolve.isError && (
        <span role="alert" className="text-sm text-destructive">
          {resolve.error instanceof ApiError ? resolve.error.message : t("Could not close this entry.")}
        </span>
      )}
    </div>
  );
}

/** What needs a person comes first; the history sits below it. */
function RecentPayments() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const q = useRecentGatewayPayments();
  const rq = useRefundsToReview();
  const badRefunds = rq.data ?? [];
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError) return <p className="text-sm text-destructive" role="alert">{t("Could not load recent payments. Try again shortly.")}</p>;
  const rows = q.data ?? [];
  const review = rows.filter((r) => r.status === "NEEDS_REVIEW");
  return (
    <>
      {badRefunds.length > 0 && (
        <Card className="flex flex-col gap-2 border-destructive/40 p-5" role="region" aria-label={t("Refunds needing review")}>
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden /> {(badRefunds.length > 1 ? t("{count} refunds need review", { count: badRefunds.length }) : t("{count} refund needs review", { count: badRefunds.length }))}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Check each one in the provider dashboard before trying again. Refunding twice returns the customer's money twice.")}
          </p>
          <ul className="divide-y divide-border text-sm">
            {badRefunds.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3">
                <span className="font-medium tabular-nums">{fmt.currency(fromMinorUnits(r.amountMinor, r.currency), r.currency)} · {r.provider}{r.providerRefundId ? ` · ${r.providerRefundId}` : ""}</span>
                {r.note && <span className="text-muted-foreground">{r.note}</span>}
                {r.status === "NEEDS_REVIEW" && <ResolveRefund id={r.id} linked={r.hasLocalRefund} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {review.length > 0 && (
        <Card className="flex flex-col gap-2 border-destructive/40 p-5" role="region" aria-label={t("Payments needing review")}>
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden /> {(review.length > 1 ? t("{count} payments need review", { count: review.length }) : t("{count} payment needs review", { count: review.length }))}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Money reached the gateway but the bill could not be closed, or the amount did not match. Nothing was applied automatically. Check it in the provider dashboard, then settle or refund the order.")}
          </p>
          <ul className="divide-y divide-border">{review.map((r) => <PaymentRow key={r.id} r={r} />)}</ul>
        </Card>
      )}
      <Card className="flex flex-col gap-1 p-5">
        <h2 className="text-[18px] font-medium text-foreground">{t("Recent online payments")}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No online payments yet. When a cashier creates a payment link from the POS checkout, it appears here with its status and whether it was a test.")}
          </p>
        ) : (
          <ul className="divide-y divide-border">{rows.map((r) => <PaymentRow key={r.id} r={r} />)}</ul>
        )}
      </Card>
    </>
  );
}

export default function PaymentGatewaysPage() {
  const fmt = useStaffFormat();
  const { locale, t } = useI18n();
  const conns = useGatewayConnections();
  const saved = conns.data?.[0]?.country ?? "";
  const [picked, setPicked] = useState<string | null>(null);
  const country = picked ?? saved;
  const catalog = useGatewayCatalog(country);
  const options = useMemo(() => countryOptions(locale), [locale]);
  const [customOpen, setCustomOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <SettingsTabs />
      <header className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold text-foreground">{t("Payment gateways")}</h1>
        <p className="text-sm text-muted-foreground">{t("Take card, UPI and wallet payments online. Customers pay on the provider's own secure page.")}</p>
      </header>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[18px] font-medium text-foreground">{t("1. Where is your business based?")}</h2>
        <Label htmlFor="gw-country" className="sr-only">{t("Business country")}</Label>
        <select id="gw-country" className={SELECT} value={country} onChange={(e) => setPicked(e.target.value)}>
          <option value="" disabled>{t("Choose a country…")}</option>
          {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">
          {t("This only filters the list below. It does not decide where you may open an account: provider availability, merchant approval, payment methods and settlement depend on the provider's current rules and your merchant account.")}
        </p>
      </Card>

      {country && (
        <section className="flex flex-col gap-3" aria-labelledby="gw-choose">
          <h2 id="gw-choose" className="text-[18px] font-medium text-foreground">{t("2. Choose a gateway")}</h2>
          {catalog.isLoading && <Skeleton className="h-32 w-full" />}
          {catalog.data && (
            <>
              <p className="text-xs text-muted-foreground">{t("Listed in no particular order; integrated gateways come first. Availability checked from public sources on {researchedAt}.", { researchedAt: fmt.day(catalog.data.researchedAt) })}</p>
              {catalog.data.providers.length === 0 && (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
                  {t("No gateways are listed for this country yet. You can add one as a custom provider.")}
                </p>
              )}
              {catalog.data.providers.map((p) => (
                <ProviderSetup key={p.key} p={p} country={country} open={openKey === p.key} onToggle={() => setOpenKey(openKey === p.key ? null : p.key)} />
              ))}
              <div>
                <Button variant="outline" onClick={() => setCustomOpen(true)}>{t("Custom provider…")}</Button>
              </div>
              <CustomProviderDialog
                country={country}
                open={customOpen}
                onClose={() => setCustomOpen(false)}
                adapters={catalog.data.providers.filter((p) => p.integrated && !p.custom).map((p) => ({ key: p.key, name: p.name }))}
              />
            </>
          )}
        </section>
      )}

      <RecentPayments />
    </div>
  );
}
