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
import { useUpdateRole, type RoleWithPermissions } from "@/hooks/use-roles";
import { ApiError } from "@/lib/api";

// Mounted only while a specific role is being edited (see RolesPage), keyed
// by role.id — a fresh mount per role means `label`/`permissionKeys` can be
// lazily initialized straight from `role` with no reset effect needed even
// when the user switches which role they're editing.
export function EditRoleDialog({
  role,
  onClose,
}: {
  role: RoleWithPermissions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(role.label);
  const [permissionKeys, setPermissionKeys] = useState<string[]>(() =>
    role.permissions.map((p) => p.permission.key),
  );
  const updateRole = useUpdateRole();

  const togglePermission = (key: string) =>
    setPermissionKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateRole.mutate(
      { id: role.id, dto: { label: label.trim(), permissionKeys } },
      {
        onSuccess: () => {
          toast.success(t("{trim} updated", { trim: label.trim() }));
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("Could not update role")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("Edit role")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="r-edit-name">{t("Name")}</Label>
            <Input id="r-edit-name" value={role.name} disabled />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="r-edit-label">{t("Display label")}</Label>
            <Input
              id="r-edit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("Permissions")}</Label>
            <PermissionChecklist selected={permissionKeys} onToggle={togglePermission} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={updateRole.isPending}>
              {updateRole.isPending ? t("Saving…") : t("Save changes")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
