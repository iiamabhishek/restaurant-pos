"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRestoreBackup, type BackupEntry } from "@/hooks/use-backups";
import { ApiError } from "@/lib/api";

const CONFIRM_WORD = "RESTORE";

// Mounted only while a specific backup is targeted for restore (see
// BackupPage) — conditional mount, not an open-prop + reset-effect, so the
// typed confirmation text always starts empty on a fresh open, same
// pattern as CreateRoleDialog/EditRoleDialog. Mirrors zulivio's actual
// type-"RESTORE"-to-confirm interaction (~/zulivio/apps/web/src/app/(app)/
// settings/page.tsx) rather than reinventing the confirmation UX.
export function RestoreBackupDialog({
  backup,
  onClose,
}: {
  backup: BackupEntry;
  onClose: () => void;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [confirmText, setConfirmText] = useState("");
  const restoreBackup = useRestoreBackup();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText !== CONFIRM_WORD) return;
    restoreBackup.mutate(
      { id: backup.id, dto: { confirm: CONFIRM_WORD } },
      {
        onSuccess: () => {
          toast.success(t("Restore completed — database and uploads reverted to this backup"));
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("Restore failed")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("Restore this backup?")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p>{t("This overwrites the entire database and uploaded files — for every restaurant on this instance — with the contents of the backup taken {toLocaleString}. This cannot be undone.", { toLocaleString: new Date(backup.createdAt).toLocaleString(fmt.localeTag) })}</p>
            <p>
              {t("Type")} <code className="rounded bg-background/50 px-1 font-mono">RESTORE</code> {t("to confirm.")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="restore-confirm">{t("Confirmation")}</Label>
            <Input
              id="restore-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t("RESTORE")}
              autoFocus
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={restoreBackup.isPending}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmText !== CONFIRM_WORD || restoreBackup.isPending}
            >
              {restoreBackup.isPending ? t("Restoring…") : t("Confirm restore")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
