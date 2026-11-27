"use client";

import { useI18n } from "@/lib/i18n/context";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadImage } from "@/components/ui/upload-image";
import { useBranch } from "@/hooks/use-branch";
import { useAds, useDisplayActions, useTerminals, type Terminal } from "@/hooks/use-display";
import { ApiError } from "@/lib/api";
import { getDisplayTerminal, setDisplayTerminal } from "@/lib/customer-display";
import { toast } from "@/lib/toast";

const link = (t: Terminal) => `${typeof window === "undefined" ? "" : window.location.origin}/customer-display?t=${t.token}`;
const seen = (iso: string | null) => (iso && Date.now() - new Date(iso).getTime() < 15_000 ? "Connected" : iso ? "Not seen for a while" : "Never connected");

export default function CustomerScreenSettings() {
  const { t: translate } = useI18n();
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : translate("Could not do that"));
  const { branchId } = useBranch();
  const { data: terminals, isLoading } = useTerminals(branchId);
  const { data: ads } = useAds(branchId);
  const act = useDisplayActions(branchId);
  const [name, setName] = useState("");
  const [mine, setMine] = useState<string>("");
  const [adTitle, setAdTitle] = useState("");
  const [adFor, setAdFor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [adErr, setAdErr] = useState<string | null>(null);

  useEffect(() => {
    const id = getDisplayTerminal()?.id ?? "";
    const t = setTimeout(() => setMine(id), 0);
    return () => clearTimeout(t);
  }, []);
  const driveFrom = (id: string) => {
    const t = terminals?.find((x) => x.id === id);
    setDisplayTerminal(t && branchId ? { id: t.id, branchId, name: t.name } : null);
    setMine(id);
    toast.success(id ? translate("This till will now drive that screen") : translate("This till no longer drives a separate screen"));
  };

  const addAd = async () => {
    if (!file) return;
    setAdErr(null);
    try {
      const up = await act.upload.mutateAsync(file);
      await act.createAd.mutateAsync({ kind: up.kind, url: up.url, title: adTitle.trim() || undefined, terminalId: adFor || null, sortOrder: (ads?.length ?? 0) + 1 });
      setFile(null); setAdTitle("");
      toast.success(translate("Advert added"));
    } catch (e) {
      setAdErr(e instanceof ApiError ? e.message : translate("Could not upload that file"));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{translate("The screen the customer sees, and the adverts it plays while idle")}</p>
      </div>
      <SettingsTabs />

      <Card className="flex flex-col gap-3 p-4 text-sm">
        <p className="font-medium">{translate("How it behaves")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><b className="text-foreground">{translate("Idle:")}</b> {translate("adverts play full screen. If there are no adverts it shows a welcome message.")}</li>
          <li><b className="text-foreground">{translate("Order started:")}</b> {translate("the moment staff add the first item, the adverts are removed and the live order shows, with quantities, prices and the total as it changes. Adverts never sit on top of an order and never delay it.")}</li>
          <li><b className="text-foreground">{translate("Payment:")}</b> {translate("the QR stays up for at least 3 minutes.")} <b className="text-foreground">{translate("Paid:")}</b> {translate("“Thank you” for a few seconds.")}</li>
          <li><b className="text-foreground">{translate("Left alone:")}</b> {translate("an order with no change for the idle time below goes back to adverts.")}</li>
          <li><b className="text-foreground">{translate("Connection lost:")}</b> {translate("the screen keeps its last picture and shows a small “Reconnecting” note. The till keeps working.")}</li>
        </ul>
      </Card>

      <section aria-label={translate("Screens")} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{translate("Screens")}</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) act.createTerminal.mutate({ name: name.trim() }, { onSuccess: () => setName(""), onError: fail }); }}>
          <Input aria-label={translate("New screen name")} className="max-w-xs" placeholder={translate("Name, e.g. Counter 1")} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!name.trim() || act.createTerminal.isPending}>{translate("Add screen")}</Button>
        </form>
        {isLoading ? <Skeleton className="h-28 rounded-xl" /> : terminals && terminals.length > 0 ? terminals.map((t) => (
          <Card key={t.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t.name}</span>
              <Badge variant={seen(t.lastSeenAt) === "Connected" ? "default" : "outline"}>{translate(seen(t.lastSeenAt))}</Badge>
              {!t.isActive && <Badge variant="outline">{translate("Switched off")}</Badge>}
              {mine === t.id && <Badge>{translate("This till drives it")}</Badge>}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`l-${t.id}`}>{translate("Open this link on the customer screen")}</Label>
                <div className="flex gap-2"><Input id={`l-${t.id}`} readOnly value={link(t)} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(link(t)); toast.success(translate("Copied")); }}>{translate("Copy")}</Button></div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">{translate("Back to adverts after (s)")}<Input inputMode="numeric" defaultValue={t.idleSeconds} onBlur={(e) => Number(e.target.value) !== t.idleSeconds && act.updateTerminal.mutate({ id: t.id, data: { idleSeconds: Number(e.target.value) } }, { onError: fail })} /></label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">{translate("Advert each (s)")}<Input inputMode="numeric" defaultValue={t.adSlideSeconds} onBlur={(e) => Number(e.target.value) !== t.adSlideSeconds && act.updateTerminal.mutate({ id: t.id, data: { adSlideSeconds: Number(e.target.value) } }, { onError: fail })} /></label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">{translate("Fit")}<select className={selectClass} defaultValue={t.adFit} onChange={(e) => act.updateTerminal.mutate({ id: t.id, data: { adFit: e.target.value as "contain" | "cover" } }, { onError: fail })}><option value="contain">{translate("Show whole picture")}</option><option value="cover">{translate("Fill screen (crops)")}</option></select></label>
                </div>
              </div>
              <div className="rounded-xl bg-white p-2"><QRCodeSVG value={link(t)} size={96} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={mine === t.id ? "outline" : "default"} onClick={() => driveFrom(mine === t.id ? "" : t.id)}>{mine === t.id ? translate("Stop driving it from this till") : translate("Drive it from this till")}</Button>
              <a className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-[0.8rem] hover:bg-muted" href={link(t)} target="_blank" rel="noreferrer">{translate("Open")}</a>
              <Button size="sm" variant="outline" onClick={() => act.updateTerminal.mutate({ id: t.id, data: { isActive: !t.isActive } }, { onError: fail })}>{t.isActive ? translate("Switch off") : translate("Switch on")}</Button>
              <Button size="sm" variant="outline" onClick={() => window.confirm(translate("The old link stops working. Open the new link on the screen.")) && act.rotate.mutate(t.id, { onSuccess: () => toast.success(translate("New link made")), onError: fail })}>{translate("New link")}</Button>
              <Button size="sm" variant="destructive" onClick={() => window.confirm(translate("Delete {name}?", { name: t.name })) && act.removeTerminal.mutate(t.id, { onError: fail })}>{translate("Delete")}</Button>
            </div>
          </Card>
        )) : <Card className="py-10 text-center text-sm text-muted-foreground">{translate("No customer screens yet. Add one, then open its link on the tablet or monitor facing the customer.")}</Card>}
      </section>

      <section aria-label={translate("Adverts")} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{translate("Adverts")}</h2>
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">{translate("Supported: pictures (JPG, PNG, WebP, GIF, up to 5 MB) and videos (MP4 with H.264, or WebM, up to 60 MB; videos play muted). Best size: 1920×1080 for a landscape screen, 1080×1920 for a portrait one; other sizes are fitted to the screen (see Fit above). Keep video short (under a minute) and compressed.")}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-sm">{translate("File")}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <label className="flex flex-col gap-1 text-sm">{translate("Shown on")}<select className={selectClass} value={adFor} onChange={(e) => setAdFor(e.target.value)}><option value="">{translate("Every screen")}</option>{(terminals ?? []).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}</select></label>
            <Button disabled={!file || act.upload.isPending || act.createAd.isPending} onClick={addAd}>{act.upload.isPending ? translate("Uploading…") : translate("Add advert")}</Button>
          </div>
          <Input aria-label={translate("Advert title")} className="max-w-sm" placeholder={translate("Title (optional, for your own list)")} value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
          {adErr && <p role="alert" className="text-sm text-destructive">{adErr}</p>}
        </Card>
        {ads && ads.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ads.map((a) => (
              <li key={a.id}><Card className="flex flex-col gap-2 p-3">
                {a.kind === "IMAGE" ? (
                  <UploadImage
                    src={a.url}
                    alt={a.title ?? translate("Advert")}
                    width={480}
                    height={270}
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="aspect-video w-full rounded-lg bg-black object-contain"
                  />
                ) : (
                  <video src={a.url} className="aspect-video w-full rounded-lg bg-black" muted controls />
                )}
                <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate font-medium">{a.title || (a.kind === "IMAGE" ? translate("Picture") : translate("Video"))}</span><Badge variant="outline">{a.terminalId ? terminals?.find((t) => t.id === a.terminalId)?.name ?? translate("One screen") : translate("All screens")}</Badge></div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={a.isActive} onChange={(e) => act.updateAd.mutate({ id: a.id, data: { isActive: e.target.checked } }, { onError: fail })} /> {translate("Playing")}</label>
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => window.confirm(translate("Delete this advert?")) && act.removeAd.mutate(a.id, { onError: fail })}>{translate("Delete")}</Button>
                </div>
              </Card></li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{translate("No adverts yet. Until you add some, an idle screen shows a welcome message.")}</p>}
      </section>
    </div>
  );
}
