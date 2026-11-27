"use client";

import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { PermissionChecklist } from "@/components/settings/permission-checklist";
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
import { useCreateRole } from "@/hooks/use-roles";
import { ApiError } from "@/lib/api";

// Mounted only while the "Create role" dialog is open (see RolesPage) —
// conditional mount, not an open-prop + reset-effect, so every open starts
// with clean state for free.
export function CreateRoleDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const createRole = useCreateRole();

  const togglePermission = (key: string) =>
    setPermissionKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createRole.mutate(
      { name: name.trim(), label: label.trim(), permissionKeys },
      {
        onSuccess: () => {
          toast.success(t("{trim} role created", { trim: label.trim() }));
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("Could not create role")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("Create custom role")}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-name">{t("Name")}</Label>
              <Input
                id="r-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("DISPLAY")}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-label">{t("Display label")}</Label>
              <Input
                id="r-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("Display")}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("Permissions")}</Label>
            <PermissionChecklist selected={permissionKeys} onToggle={togglePermission} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createRole.isPending}>
              {createRole.isPending ? t("Creating…") : t("Create role")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
