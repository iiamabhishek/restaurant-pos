"use client";

import type { Translate } from "@/lib/i18n/context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SyncStatus {
  enabled: boolean;
  role: "client" | "server";
  serverUrl: string | null;
  hasKey: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingChanges: number;
  conflicts: { tbl: string; pk: string; error: string; at: string }[];
  /** Versions kept for a manager's decision (see SyncConflict). */
  openConflicts: number;
  /** What staff should be told: see describeSyncState(). */
  state: SyncStateName;
}

export type SyncStateName = "off" | "server" | "synced" | "pending" | "conflict" | "offline";

export interface SyncConflict {
  id: string;
  createdAt: string;
  kind: "SUPERSEDED_INCOMING" | "OVERWRITTEN_LOCAL" | "EXCESS_REFUND" | "CLOCK_SKEW";
  tbl: string;
  pkKey: string;
  origin: string;
  loser: Record<string, unknown> | null;
  loserOp: "U" | "D" | null;
  loserTs: string | null;
  winner: Record<string, unknown> | null;
  winnerTs: string | null;
  detail: Record<string, unknown> | null;
  status: "OPEN" | "RESOLVED";
  resolution: string | null;
  reason: string | null;
  resolvedAt: string | null;
}

export interface SyncPeer {
  deviceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastPushCount: number;
  revokedAt: string | null;
}

export interface SyncConnection {
  serverUrl: string;
  apiKey: string;
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 10_000,
  });
}

export function useTestSync() {
  return useMutation({
    mutationFn: (body: SyncConnection) => api.post<{ ok: boolean }>("/sync/test", body),
  });
}

export function useEnableSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncConnection & { mode: "adopt" | "merge" }) =>
      api.put<SyncStatus>("/sync/settings", body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}

export function useSyncNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncStatus & { pulled: number; pushed: number }>("/sync/run"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}

export function useDisableSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncStatus>("/sync/disable"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}

export function useSyncConflicts(status: "OPEN" | "RESOLVED" = "OPEN") {
  return useQuery({
    queryKey: ["sync", "conflicts", status],
    queryFn: () => api.get<SyncConflict[]>(`/sync/conflicts?status=${status}`),
    refetchInterval: 15_000,
  });
}

export function useResolveSyncConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "KEEP_CURRENT" | "APPLY_LOSER"; reason: string }) =>
      api.post(`/sync/conflicts/${encodeURIComponent(v.id)}/resolve`, { action: v.action, reason: v.reason }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}

export function useSyncPeers(enabled: boolean) {
  return useQuery({
    queryKey: ["sync", "peers"],
    queryFn: () => api.get<SyncPeer[]>("/sync/peers"),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useSetSyncPeerRevoked() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { deviceId: string; revoked: boolean }) =>
      api.post(`/sync/peers/${encodeURIComponent(v.deviceId)}/${v.revoked ? "revoke" : "restore"}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sync", "peers"] }),
  });
}

/** Plain wording for staff. "Synced" is only said when the server has everything and nothing is disputed. */
export function describeSyncState(t: Translate, state: SyncStateName, pending: number, open: number) {
  switch (state) {
    case "synced":
      return { label: t("Synced"), tone: "ok" as const, text: t("The central server has everything from this PC.") };
    case "pending":
      return {
        label: t("Saved on this PC"),
        tone: "warn" as const,
        text: (pending === 1 ? t("{pending} change saved on this PC, waiting to reach the central server.", { pending }) : t("{pending} changes saved on this PC, waiting to reach the central server.", { pending })),
      };
    case "conflict":
      return {
        label: t("Needs review"),
        tone: "warn" as const,
        text: (open === 1 ? t("{open} item where two devices disagreed need a manager's decision.", { open }) : t("{open} items where two devices disagreed need a manager's decision.", { open })),
      };
    case "offline":
      return {
        label: t("Working offline"),
        tone: "bad" as const,
        text: t("Cannot reach the central server. Orders and bills are still saved on this PC and will be sent when the connection returns."),
      };
    case "server":
      return { label: t("Server"), tone: "ok" as const, text: t("This installation is the central server.") };
    default:
      return { label: t("Not connected"), tone: "bad" as const, text: t("Sync is off. This PC works on its own.") };
  }
}
