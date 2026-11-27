"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { SyncConflictsCard, SyncPeersCard } from "@/components/settings/sync-review";
import {
  describeSyncState,
  useDisableSync,
  useEnableSync,
  useSyncNow,
  useSyncStatus,
  useTestSync,
} from "@/hooks/use-sync";
import { ApiError } from "@/lib/api";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function SyncSettingsPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading, isError, error, refetch, isFetching } = useSyncStatus();
  const test = useTestSync();
  const enable = useEnableSync();
  const syncNow = useSyncNow();
  const disable = useDisableSync();
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"adopt" | "merge">("adopt");

  const conn = { serverUrl: serverUrl.trim(), apiKey: apiKey.trim() };

  const connect = () => {
    if (
      mode === "adopt" &&
      !window.confirm(
        t("This PC's current data will be replaced by the server's data, and you will be signed out. Sign in again with an account from the server. Continue?"),
      )
    )
      return;
    enable.mutate(
      { ...conn, mode },
      {
        onSuccess: () => {
          toast.success(t("Connected — syncing. Sign in again if you are asked to."));
          setApiKey("");
        },
        onError: (e) => toast.error(errMsg(e, t("Could not connect"))),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs />

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-medium">{t("Server sync")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Keep this PC and your central server in step, both ways. Work continues offline and catches up when the connection returns. If two devices change the same record while apart, the newest edit is used and the other version is kept for a manager to review.")}
          </p>
        </div>

        {isError ? (
          <QueryError error={error} what={t("sync status")} onRetry={() => void refetch()} retrying={isFetching} />
        ) : isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.role === "server" ? (
          <p className="text-sm text-muted-foreground">
            {t("This installation is the sync server. Other PCs connect to it with the sync key set in its")} <code>SYNC_API_KEY</code> {t("setting.")}
          </p>
        ) : data.enabled ? (
          <div className="flex flex-col gap-3">
            {(() => {
              const st = describeSyncState(t, data.state, data.pendingChanges, data.openConflicts);
              return (
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={st.tone === "bad" ? "destructive" : st.tone === "warn" ? "outline" : "secondary"}>
                      {st.label}
                    </Badge>
                    <span className="text-muted-foreground">{data.serverUrl}</span>
                  </div>
                  <p>{st.text}</p>
                </div>
              );
            })()}
            <p className="text-sm text-muted-foreground">
              {t("Last time the server accepted changes from this PC:")}{" "}
              {data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString(fmt.localeTag) : t("never")} {t("· saved here, not yet on the server: {pendingChanges}", { pendingChanges: data.pendingChanges })}</p>
            {data.lastError && <p className="text-sm text-destructive">{data.lastError}</p>}
            {data.conflicts.length > 0 && (
              <details className="text-sm">
                <summary>{t("{count} change(s) could not be applied", { count: data.conflicts.length })}</summary>
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {data.conflicts.slice(0, 10).map((c, i) => (
                    <li key={i}>
                      {c.tbl}: {c.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={syncNow.isPending}
                onClick={() =>
                  syncNow.mutate(undefined, {
                    onSuccess: (r) => toast.success(t("Synced: {pulled} down, {pushed} up", { pulled: r.pulled, pushed: r.pushed })),
                    onError: (e) => toast.error(errMsg(e, t("Sync failed"))),
                  })
                }
              >
                {syncNow.isPending ? t("Syncing…") : t("Sync now")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disable.isPending}
                onClick={() => disable.mutate(undefined, { onSuccess: () => toast.success(t("Sync turned off")) })}
              >
                {t("Turn off")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex max-w-xl flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sync-url">{t("Server address")}</Label>
              <Input
                id="sync-url"
                placeholder="https://orders.example.com"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sync-key">{t("Sync key")}</Label>
              <Input
                id="sync-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">{t("First sync")}</legend>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "adopt"} onChange={() => setMode("adopt")} />
                <span>
                  {t("Use the server's data")}
                  <span className="block text-muted-foreground">
                    {t("Replaces this PC's data. Pick this for a new PC.")}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />
                <span>
                  {t("Merge both")}
                  <span className="block text-muted-foreground">
                    {t("Keeps this PC's data and adds it to the server.")}
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!conn.serverUrl || !conn.apiKey || test.isPending}
                onClick={() =>
                  test.mutate(conn, {
                    onSuccess: () => toast.success(t("Server reachable, key accepted")),
                    onError: (e) => toast.error(errMsg(e, t("Could not reach the server"))),
                  })
                }
              >
                {test.isPending ? t("Testing…") : t("Test connection")}
              </Button>
              <Button
                size="sm"
                disabled={!conn.serverUrl || !conn.apiKey || enable.isPending}
                onClick={connect}
              >
                {enable.isPending ? t("Connecting…") : t("Connect & sync")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <SyncConflictsCard />
      {data?.role === "server" && <SyncPeersCard />}
    </div>
  );
}
