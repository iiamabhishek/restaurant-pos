"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { type Translate, useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useResolveSyncConflict,
  useSetSyncPeerRevoked,
  useSyncConflicts,
  useSyncPeers,
  type SyncConflict,
} from "@/hooks/use-sync";
import { ApiError } from "@/lib/api";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const TABLE_NAMES: Record<string, string> = {
  orders: "Order",
  order_items: "Order line",
  order_item_modifiers: "Order line option",
  payments: "Payment",
  refunds: "Refund",
  gateway_payments: "Online payment",
  gateway_refunds: "Online refund",
  shifts: "Shift",
  cash_closings: "Cash closing",
  petty_cash_entries: "Petty cash entry",
  stock_movements: "Stock movement",
  stock_levels: "Stock level",
  stock_takes: "Stock count",
  stock_journal_entries: "Stock journal entry",
  stock_journal_lines: "Stock journal line",
  supplier_payments: "Supplier payment",
  points_ledger: "Loyalty points entry",
};

const IGNORED = new Set(["updatedAt", "createdAt"]);

function changedFields(a: Record<string, unknown> | null, b: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys]
    .filter((k) => !IGNORED.has(k) && JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]))
    .slice(0, 6)
    .map((k) => ({ key: k, saved: a?.[k], current: b?.[k] }));
}

const show = (v: unknown) => (v === null || v === undefined ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v));

function headline(t: Translate, c: SyncConflict) {
  const what = TABLE_NAMES[c.tbl] ? t(TABLE_NAMES[c.tbl]) : c.tbl;
  switch (c.kind) {
    case "SUPERSEDED_INCOMING":
      return t("{what}: a change from {value} was not applied because a newer change was already here.", { what, value: c.origin === "central-server" ? t("the central server") : t("another device") });
    case "OVERWRITTEN_LOCAL":
      return t("{what}: an edit made on this PC was replaced by a newer one from the central server.", { what });
    case "EXCESS_REFUND":
      return t("Refunds on one order add up to more than was paid ({show} refunded, {show2} paid). Both refunds are kept.", { show: show(c.detail?.refunded), show2: show(c.detail?.paid) });
    default:
      return what;
  }
}

function ConflictRow({ c }: { c: SyncConflict }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const resolve = useResolveSyncConflict();
  const [reason, setReason] = useState("");
  const canRestore = c.kind === "SUPERSEDED_INCOMING" || c.kind === "OVERWRITTEN_LOCAL";
  const diff = canRestore ? changedFields(c.loser, c.winner) : [];
  const go = (action: "KEEP_CURRENT" | "APPLY_LOSER") =>
    resolve.mutate(
      { id: c.id, action, reason: reason.trim() },
      {
        onSuccess: () => toast.success(t("Decision recorded")),
        onError: (e) => toast.error(errMsg(e, t("Could not record the decision"))),
      },
    );
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">{headline(t, c)}</p>
      <p className="text-xs text-muted-foreground">{t("Found {toLocaleString}", { toLocaleString: new Date(c.createdAt).toLocaleString(fmt.localeTag) })}{c.loserTs ? t(" · saved version edited {toLocaleString}", { toLocaleString: new Date(c.loserTs).toLocaleString(fmt.localeTag) }) : ""}
        {c.winnerTs ? t(" · current version edited {toLocaleString}", { toLocaleString: new Date(c.winnerTs).toLocaleString(fmt.localeTag) }) : ""}
      </p>
      {diff.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">{t("Field")}</th>
              <th className="py-1 font-normal">{t("Saved version")}</th>
              <th className="py-1 font-normal">{t("Current version")}</th>
            </tr>
          </thead>
          <tbody>
            {diff.map((d) => (
              <tr key={d.key} className="border-t">
                <td className="py-1 pr-2">{d.key}</td>
                <td className="py-1 pr-2">{show(d.saved)}</td>
                <td className="py-1">{show(d.current)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("Reason for your decision")}
          className="h-8 max-w-xs"
          placeholder={t("Reason (required)")}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {canRestore && (
          <Button
            size="sm"
            variant="outline"
            disabled={reason.trim().length < 3 || resolve.isPending}
            onClick={() => go("APPLY_LOSER")}
          >
            {t("Use the saved version")}
          </Button>
        )}
        <Button size="sm" disabled={reason.trim().length < 3 || resolve.isPending} onClick={() => go("KEEP_CURRENT")}>
          {canRestore ? t("Keep the current version") : t("Mark as checked")}
        </Button>
      </div>
    </li>
  );
}

/** Items two devices disagreed about. Nothing here has been lost: the other version is stored until a manager decides. */
export function SyncConflictsCard() {
  const { t } = useI18n();
  const { data, isLoading } = useSyncConflicts("OPEN");
  if (isLoading || !data || data.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div>
        <h2 className="text-base font-medium">
          {t("Needs review")} <Badge variant="destructive">{data.length}</Badge>
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("Two devices changed the same record while they could not talk to each other. The newest edit is in place; the other version is saved here. Your decision and reason are kept permanently.")}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {data.map((c) => (
          <ConflictRow key={c.id} c={c} />
        ))}
      </ul>
    </Card>
  );
}

/** Devices that sync with this server; an owner can cut one off (a lost or retired PC). */
export function SyncPeersCard() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data } = useSyncPeers(true);
  const setRevoked = useSetSyncPeerRevoked();
  if (!data) return null;
  const when = (v: string | null) => (v ? new Date(v).toLocaleString(fmt.localeTag) : t("never"));
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div>
        <h2 className="text-base font-medium">{t("Connected devices")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Every PC that has synced with this server. Removing a PC stops it syncing; anything it has not yet sent stays on that PC.")}
        </p>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No device has synced yet.")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.map((p) => (
            <li key={p.deviceId} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <code className="text-xs">{p.deviceId.slice(0, 10)}…</code>
              {p.revokedAt && <Badge variant="destructive">{t("Removed")}</Badge>}
              <span className="text-muted-foreground">{t("last seen {when}", { when: when(p.lastSeenAt) })}</span>
              <span className="text-muted-foreground">{t("· last upload {when}", { when: when(p.lastPushAt) })}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={setRevoked.isPending}
                onClick={() => {
                  if (!p.revokedAt && !window.confirm(t("Stop this PC from syncing? Changes it has not sent stay on that PC.")))
                    return;
                  setRevoked.mutate(
                    { deviceId: p.deviceId, revoked: !p.revokedAt },
                    { onError: (e) => toast.error(errMsg(e, t("Could not change this device"))) },
                  );
                }}
              >
                {p.revokedAt ? t("Allow again") : t("Remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
