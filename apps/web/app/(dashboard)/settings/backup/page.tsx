"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { BackupScheduleCard } from "@/components/settings/backup-schedule-card";
import { RestoreBackupDialog } from "@/components/settings/restore-backup-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  backupDownloadUrl,
  LOCAL_BACKUP_URL,
  useBackups,
  useBackupStatus,
  useClearBackupConfig,
  useSetBackupConfig,
  useTriggerBackup,
  type BackupEntry,
  type BackupStatusValue,
} from "@/hooks/use-backups";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";
import { ApiError } from "@/lib/api";

const STATUS_VARIANT: Record<BackupStatusValue, "outline" | "secondary" | "destructive"> = {
  PENDING: "outline",
  VERIFIED: "secondary",
  FAILED: "destructive",
};

function formatBytes(fmt: StaffFormat, bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${fmt.number((bytes / 1024), 1)} KB`;
  return `${fmt.number((bytes / (1024 * 1024)), 1)} MB`;
}

interface ConfigFormState {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

const EMPTY_CONFIG_FORM: ConfigFormState = {
  endpoint: "",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  region: "auto",
};

export default function BackupPage() {
  const fmt = useStaffFormat();
  const { t, locale } = useI18n();
  const dateLocale = LOCALE_TAGS[locale];
  const { data: status, isLoading: statusLoading } = useBackupStatus();
  const { data: backups, isLoading: backupsLoading } = useBackups();
  const setConfig = useSetBackupConfig();
  const clearConfig = useClearBackupConfig();
  const triggerBackup = useTriggerBackup();

  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configForm, setConfigForm] = useState<ConfigFormState>(EMPTY_CONFIG_FORM);
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);

  const openConfigForm = () => {
    setConfigForm(
      status
        ? {
            endpoint: status.endpoint ?? "",
            bucket: status.bucket ?? "",
            accessKeyId: "",
            secretAccessKey: "",
            region: status.region ?? "auto",
          }
        : EMPTY_CONFIG_FORM,
    );
    setShowConfigForm(true);
  };

  const onSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setConfig.mutate(
      {
        endpoint: configForm.endpoint.trim(),
        bucket: configForm.bucket.trim(),
        accessKeyId: configForm.accessKeyId.trim(),
        secretAccessKey: configForm.secretAccessKey.trim(),
        region: configForm.region.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("backup.connectedToast"));
          setShowConfigForm(false);
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.message : t("backup.connectError"),
          ),
      },
    );
  };

  const onDisconnect = () => {
    if (!confirm(t("backup.disconnectConfirm"))) {
      return;
    }
    clearConfig.mutate(undefined, {
      onSuccess: () => toast.success(t("backup.disconnectedToast")),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : t("backup.disconnectError")),
    });
  };

  const onTrigger = () => {
    triggerBackup.mutate(undefined, {
      onSuccess: () => toast.success(t("backup.startedToast")),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : t("backup.startError")),
    });
  };

  const localDownload = (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">{t("backup.downloadTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("backup.downloadDescription")}
          </p>
        </div>
        <Button nativeButton={false} render={<a href={LOCAL_BACKUP_URL} download />}>{t("backup.downloadLocal")}</Button>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("nav.settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("backup.pageDescription")}</p>
      </div>

      <SettingsTabs />

      {status?.configured ? <BackupScheduleCard status={status} /> : localDownload}

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[min(100%,15rem)] flex-1">
            <h2 className="text-[18px] font-medium text-foreground">{t("backup.storageTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("backup.storageDescription")}
            </p>
          </div>
          {status ? (
            <Badge variant={status.configured ? "secondary" : "outline"}>
              {t(status.configured ? "backup.connected" : "backup.disconnected")}
            </Badge>
          ) : null}
        </div>

        {statusLoading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : !status?.configured || showConfigForm ? (
          <form onSubmit={onSaveConfig} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t("backup.connectHelp")}
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-endpoint">{t("backup.endpoint")}</Label>
                <Input
                  id="b-endpoint"
                  placeholder="https://s3.example.com"
                  value={configForm.endpoint}
                  onChange={(e) => setConfigForm((f) => ({ ...f, endpoint: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-bucket">{t("backup.bucket")}</Label>
                <Input
                  id="b-bucket"
                  value={configForm.bucket}
                  onChange={(e) => setConfigForm((f) => ({ ...f, bucket: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-key">{t("backup.key")}</Label>
                <Input
                  id="b-key"
                  value={configForm.accessKeyId}
                  onChange={(e) => setConfigForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-secret">{t("backup.secret")}</Label>
                <Input
                  id="b-secret"
                  type="password"
                  value={configForm.secretAccessKey}
                  onChange={(e) =>
                    setConfigForm((f) => ({ ...f, secretAccessKey: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-region">{t("backup.region")}</Label>
                <Input
                  id="b-region"
                  placeholder={t("auto")}
                  value={configForm.region}
                  onChange={(e) => setConfigForm((f) => ({ ...f, region: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={setConfig.isPending}>
                {t(setConfig.isPending ? "backup.testing" : "backup.connect")}
              </Button>
              {status?.configured ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowConfigForm(false)}
                >
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="break-all text-foreground">
                  {status.bucket}{" "}
                  <span className="text-muted-foreground">· {status.endpoint}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("backup.maskedKey", { key: status.accessKeyIdMasked ?? "—" })} ·{" "}
                  {t(status.source === "environment" ? "backup.envSource" : "backup.dbSource")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={openConfigForm}>
                  {t("backup.change")}
                </Button>
                {status.source === "database" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={clearConfig.isPending}
                    onClick={onDisconnect}
                  >
                    {t("backup.disconnect")}
                  </Button>
                ) : null}
              </div>
            </div>

            <Stat
              label={t("backup.last")}
              value={status.lastBackup ? new Date(status.lastBackup.createdAt).toLocaleString(dateLocale) : t("backup.never")}
            />

            <div>
              <Button onClick={onTrigger} disabled={triggerBackup.isPending}>
                {t(triggerBackup.isPending ? "backup.starting" : "backup.run")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {status?.configured && localDownload}

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[18px] font-medium text-foreground">{t("backup.history")}</h2>

        {backupsLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : backups && backups.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("backup.started")}</TableHead>
                <TableHead>{t("backup.status")}</TableHead>
                <TableHead>{t("backup.size")}</TableHead>
                <TableHead className="text-right">{t("backup.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-foreground">
                    {new Date(b.createdAt).toLocaleString(dateLocale)}
                    <div className="text-xs font-normal text-muted-foreground">
                      {t(b.triggeredById ? "backup.manual" : "backup.scheduled")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status]}>{t(`backup.status.${b.status}`)}</Badge>
                    {b.status === "FAILED" && b.failureReason ? (
                      <div className="mt-1 max-w-xs truncate text-xs text-destructive" title={b.failureReason}>
                        {b.failureReason}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(fmt, b.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {b.status === "VERIFIED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          nativeButton={false} render={<a href={backupDownloadUrl(b.id)} />}
                        >
                          {t("backup.download")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled>
                          {t("backup.download")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={b.status !== "VERIFIED"}
                        onClick={() => setRestoreTarget(b)}
                      >
                        {t("backup.restore")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">{t("backup.empty")}</p>
            <p className="text-sm text-muted-foreground">
              {t(status?.configured ? "backup.emptyConnected" : "backup.emptyNew")}
            </p>
          </div>
        )}
      </Card>

      {restoreTarget ? (
        <RestoreBackupDialog
          key={restoreTarget.id}
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
