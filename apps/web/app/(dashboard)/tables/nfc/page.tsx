"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useBranch } from "@/hooks/use-branch";
import {
  type NfcTag,
  type Provisioning,
  type TagWithBundle,
  useCreateNfcTag,
  useDisableNfcTag,
  useNfcSettings,
  useNfcTags,
  useNfcTaps,
  useReplaceNfcTag,
  useRotateNfcTag,
  useTestNfcTag,
  useUpdateNfcSettings,
} from "@/hooks/use-nfc";
import { useFloors } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const STATUS: Record<NfcTag["status"], { label: string; variant: "default" | "outline" | "secondary" }> = {
  PROVISIONING: { label: "Not proven yet", variant: "secondary" },
  ACTIVE: { label: "Active", variant: "default" },
  DISABLED: { label: "Disabled", variant: "outline" },
};

function Copy({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 font-mono text-xs" aria-label={label} />
        <Button type="button" variant="outline" className="h-11" onClick={() => { void navigator.clipboard?.writeText(value); toast.success(t("Copied")); }}>{t("Copy")}</Button>
      </div>
    </div>
  );
}

/** Shown once: after this the keys cannot be read back. */
function ProvisioningDialog({ result, onClose }: { result: TagWithBundle; onClose: () => void }) {
  const { t } = useI18n();
  const p: Provisioning | null = result.provisioning;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p ? t("Write this tag") : t("Tag added")}</DialogTitle>
          <DialogDescription>{t("Table {tableNumber}", { tableNumber: result.tag.tableNumber })}{result.tag.label ? ` · ${result.tag.label}` : ""}</DialogDescription>
        </DialogHeader>
        {p ? (
          <div className="flex flex-col gap-3 text-sm">
            <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">{t("These keys are shown")} <b>{t("once")}</b>{t(". The server keeps only sealed copies and cannot show them again. Write them to the tag now; if you lose them, rotate the keys.")}</p>
            <Copy label={t("Link to write (with the two placeholders)")} value={p.urlTemplate} />
            <Copy label={t("SDM meta-read key (decrypts the UID and counter)")} value={p.keys.sdmMetaReadKey} />
            <Copy label={t("SDM file-read key (checks the MAC)")} value={p.keys.sdmFileReadKey} />
            <Copy label={t("Application master key (never stored here; keep it if you will re-configure the tag)")} value={p.keys.appMasterKey} />
            <p className="text-xs text-muted-foreground">{t("{note} Mirror the encrypted UID + read counter at", { note: p.note })} <b>e=</b> {t("and the MAC at")} <b>c=</b>{t(", and set the MAC input offset equal to the MAC offset. See the NFC provisioning guide.")}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{result.basicLink?.note}{result.basicLink?.requiresTableQr ? t(" This table has no QR link yet: create one first under Tables.") : ""}</p>
        )}
        <DialogFooter><Button className="h-11" onClick={onClose}>{p ? t("I have written the keys") : t("Done")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ branchId, tag, onClose }: { branchId: string | null; tag: NfcTag; onClose: () => void }) {
  const { t } = useI18n();
  const test = useTestNfcTag(branchId);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    let e = "", c = "";
    try {
      const u = new URL(url.trim());
      e = u.searchParams.get("e") ?? "";
      c = u.searchParams.get("c") ?? "";
    } catch { /* not a URL: the checks below explain it */ }
    if (!e || !c) return setErr(t("Paste the full link the tag opened (it ends with ?e=…&c=…)."));
    setErr(null);
    test.mutate({ id: tag.id, e, c }, { onSuccess: () => { toast.success(t("Tag verified")); onClose(); }, onError: (x) => setErr(msg(x, t("That tap did not verify."))) });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("Test tap")}</DialogTitle><DialogDescription>{t("Tap the tag with a phone, copy the address it opens, and paste it here. The first good test proves the tag and ties it to its chip.")}</DialogDescription></DialogHeader>
        {err && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}
        <div className="flex flex-col gap-1.5"><Label htmlFor="tt-url">{t("Link the tag opened")}</Label><Textarea id="tt-url" rows={3} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/t/abc123?e=…&c=…" /></div>
        <DialogFooter className="gap-2"><Button variant="outline" className="h-11" onClick={onClose}>{t("Cancel")}</Button><Button className="h-11" disabled={test.isPending} onClick={submit}>{test.isPending ? t("Checking…") : t("Verify")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogDialog({ branchId, tag, onClose }: { branchId: string | null; tag: NfcTag; onClose: () => void }) {
  const fmt = useStaffFormat();
  const { t: translate } = useI18n();
  const { data, isLoading } = useNfcTaps(branchId, tag.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>{translate("Tap log")}</DialogTitle><DialogDescription>{translate("Table {tableNumber}. The latest 100 taps, good and bad.", { tableNumber: tag.tableNumber })}</DialogDescription></DialogHeader>
        {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <p className="text-sm text-muted-foreground">{translate("No taps yet.")}</p> : (
          <ul className="divide-y divide-border text-sm">{data.map((t) => (<li key={t.id} className="flex justify-between gap-3 py-1.5"><span className={t.result === "OK" || t.result === "TEST_OK" ? "" : "font-medium text-destructive"}>{fmt.code(t.result)}</span><span className="text-muted-foreground">{t.counter != null ? `#${t.counter} · ` : ""}{new Date(t.createdAt).toLocaleString(fmt.localeTag)}</span></li>))}</ul>
        )}
        <DialogFooter><Button className="h-11" onClick={onClose}>{translate("Close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NfcTablesPage() {
  const fmt = useStaffFormat();
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const { data: settings, isLoading: sl, isError: se } = useNfcSettings();
  const update = useUpdateNfcSettings();
  const { data: tags, isLoading: tl } = useNfcTags(branchId);
  const { data: floors } = useFloors(branchId);
  const create = useCreateNfcTag(branchId);
  const rotate = useRotateNfcTag(branchId);
  const disable = useDisableNfcTag(branchId);
  const replace = useReplaceNfcTag(branchId);
  const [tableId, setTableId] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"SECURE" | "BASIC">("SECURE");
  const [shown, setShown] = useState<TagWithBundle | null>(null);
  const [testing, setTesting] = useState<NfcTag | null>(null);
  const [log, setLog] = useState<NfcTag | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rotate" | "replace" | "disable"; tag: NfcTag } | null>(null);
  const [reason, setReason] = useState("");
  const tables = (floors ?? []).flatMap((f) => f.tables.map((t) => ({ id: t.id, label: translate("{name} · Table {number}", { name: f.name, number: t.number }) })));

  const setFlag = (v: { nfcTablesEnabled?: boolean; autoTableSessions?: boolean }) => update.mutate(v, { onError: (e) => toast.error(msg(e, translate("Could not change that setting"))) });
  const add = () => {
    if (!tableId) return toast.error(translate("Choose a table"));
    create.mutate({ tableId, label: label.trim() || undefined, mode }, { onSuccess: (r) => { setShown(r); setLabel(""); }, onError: (e) => toast.error(msg(e, translate("Could not add the tag"))) });
  };
  const runConfirmed = () => {
    if (!confirm) return;
    const { kind, tag } = confirm;
    const done = { onSettled: () => { setConfirm(null); setReason(""); }, onError: (e: unknown) => toast.error(msg(e, translate("That did not work"))) };
    if (kind === "rotate") rotate.mutate(tag.id, { ...done, onSuccess: (r) => setShown(r) });
    else if (kind === "replace") replace.mutate({ id: tag.id }, { ...done, onSuccess: (r) => setShown(r) });
    else disable.mutate({ id: tag.id, reason }, { ...done, onSuccess: () => toast.success(translate("Tag disabled")) });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Table ordering mode")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Choose how guests start ordering at a table. The simple way needs nothing extra; NFC tags are optional.")}</p>
      </div>

      {sl ? <Skeleton className="h-40 rounded-xl" /> : se || !settings ? (
        <Card className="p-4 text-sm text-muted-foreground">{translate("You need the permission to manage NFC table tags to see this page.")}</Card>
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2"><Badge>{settings.mode === "ADVANCED" ? translate("Advanced") : translate("Basic")}</Badge><span className="text-sm text-muted-foreground">{settings.mode === "ADVANCED" ? translate("Guests can tap a secure tag; the first order opens the table.") : translate("Guests scan the table QR and enter the table code staff give them.")}</span></div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div><Label htmlFor="sw-nfc" className="font-medium">{translate("Secure NFC tags")}</Label><p className="text-xs text-muted-foreground">{translate("Guests tap the card on the table with their own phone. Needs NTAG 424 DNA tags; ordinary cards stay as low-security QR links. Works over the guest’s mobile data, no restaurant Wi-Fi.")}</p></div>
            <Switch id="sw-nfc" checked={settings.nfcTablesEnabled} disabled={update.isPending || (settings.autoTableSessions && settings.nfcTablesEnabled)} onCheckedChange={(v) => setFlag({ nfcTablesEnabled: v })} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div><Label htmlFor="sw-auto" className="font-medium">{translate("Open and close tables automatically")}</Label><p className="text-xs text-muted-foreground">{translate("The first valid guest order opens the table; settling the last order closes it. Staff no longer open tables by hand. An unpaid table is never closed by a timer. Needs secure NFC tags.")}</p></div>
            <Switch id="sw-auto" checked={settings.autoTableSessions} disabled={update.isPending || !settings.nfcTablesEnabled} onCheckedChange={(v) => setFlag({ autoTableSessions: v })} />
          </div>
          <p className="text-xs text-muted-foreground">{translate("Turning these off never deletes anything: tags, taps and past sessions are kept.")}</p>
        </Card>
      )}

      {settings?.nfcTablesEnabled && (
        <>
          <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
            <div className="flex flex-col gap-1.5"><Label htmlFor="nt-table">{translate("Table")}</Label><select id="nt-table" className={`${selectClass} h-11`} value={tableId} onChange={(e) => setTableId(e.target.value)}><option value="">{translate("Choose…")}</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="nt-label">{translate("Label (optional)")}</Label><Input id="nt-label" className="h-11" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder={translate("Window side")} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="nt-mode">{translate("Type")}</Label><select id="nt-mode" className={`${selectClass} h-11`} value={mode} onChange={(e) => setMode(e.target.value as "SECURE" | "BASIC")}><option value="SECURE">{translate("Secure (NTAG 424)")}</option><option value="BASIC">{translate("Ordinary card")}</option></select></div>
            <Button className="h-11" disabled={create.isPending} onClick={add}>{create.isPending ? translate("Adding…") : translate("Add tag")}</Button>
          </Card>

          {tl ? <Skeleton className="h-32 rounded-xl" /> : !tags?.length ? (
            <Card className="py-10 text-center text-sm text-muted-foreground">{translate("No tags yet. Add one above, write it with an NTAG 424 DNA tool, then press Test tap.")}</Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {tags.map((t) => (
                <li key={t.id}>
                  <Card className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{translate("Table {tableNumber}", { tableNumber: t.tableNumber })}</span>{t.label && <span className="text-sm text-muted-foreground">{t.label}</span>}
                      <Badge variant={STATUS[t.status].variant}>{translate(STATUS[t.status].label)}</Badge>
                      <Badge variant="outline">{t.mode === "SECURE" ? translate("Secure") : translate("Ordinary card")}</Badge>
                      {t.replacesId && <span className="text-xs text-muted-foreground">{translate("replaces an older tag")}</span>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                      <div><dt>{translate("Chip")}</dt><dd className="break-all font-mono text-foreground">{t.uid ?? translate("not bound yet")}</dd></div>
                      <div><dt>{translate("Keys")}</dt><dd className="text-foreground">{t.mode === "SECURE" ? translate("version {keyVersion}", { keyVersion: t.keyVersion }) : translate("none")}</dd></div>
                      <div><dt>{translate("Last good tap")}</dt><dd className="text-foreground">{t.lastAuthAt ? new Date(t.lastAuthAt).toLocaleString(fmt.localeTag) : translate("never")}</dd></div>
                      <div><dt>{translate("Counter")}</dt><dd className="text-foreground">{t.lastCounter >= 0 ? t.lastCounter : "–"}</dd></div>
                    </dl>
                    {t.disabledReason && <p className="text-xs text-muted-foreground">{translate("Disabled: {disabledReason}", { disabledReason: t.disabledReason })}</p>}
                    <div className="flex flex-wrap gap-2">
                      {t.mode === "SECURE" && t.status !== "DISABLED" && <Button variant="outline" className="h-11" onClick={() => setTesting(t)}>{translate("Test tap")}</Button>}
                      <Button variant="outline" className="h-11" onClick={() => setLog(t)}>{translate("Tap log")}</Button>
                      {t.mode === "SECURE" && <Button variant="outline" className="h-11" onClick={() => setConfirm({ kind: "rotate", tag: t })}>{translate("Rotate keys")}</Button>}
                      <Button variant="outline" className="h-11" onClick={() => setConfirm({ kind: "replace", tag: t })}>{translate("Replace tag")}</Button>
                      {t.status !== "DISABLED" && <Button variant="outline" className="h-11 text-destructive" onClick={() => setConfirm({ kind: "disable", tag: t })}>{translate("Disable")}</Button>}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {shown && <ProvisioningDialog result={shown} onClose={() => setShown(null)} />}
      {testing && <TestDialog branchId={branchId} tag={testing} onClose={() => setTesting(null)} />}
      {log && <LogDialog branchId={branchId} tag={log} onClose={() => setLog(null)} />}
      {confirm && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirm.kind === "rotate" ? translate("Rotate keys?") : confirm.kind === "replace" ? translate("Replace this tag?") : translate("Disable this tag?")}</DialogTitle>
              <DialogDescription>
                {confirm.kind === "rotate" && translate("The old keys stop working immediately and the tag must be written with the new keys and tested again before guests can use it.")}
                {confirm.kind === "replace" && translate("The old tag is disabled for good and a new tag record is made for the same table.")}
                {confirm.kind === "disable" && translate("Taps on this tag stop working immediately. Use this for a lost, copied or photographed tag.")}
              </DialogDescription>
            </DialogHeader>
            {confirm.kind === "disable" && <div className="flex flex-col gap-1.5"><Label htmlFor="dis-reason">{translate("Why (kept in the record)")}</Label><Input id="dis-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={translate("Lost, copied, damaged…")} /></div>}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" onClick={() => setConfirm(null)}>{translate("Cancel")}</Button>
              <Button className="h-11" variant={confirm.kind === "disable" ? "destructive" : "default"} disabled={confirm.kind === "disable" && reason.trim().length < 3} onClick={runConfirmed}>{confirm.kind === "rotate" ? translate("Rotate keys") : confirm.kind === "replace" ? translate("Replace") : translate("Disable tag")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
