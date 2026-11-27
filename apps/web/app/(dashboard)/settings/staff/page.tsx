"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { DepartmentsCard } from "@/components/settings/departments-card";
import { StaffAccessDialog } from "@/components/settings/staff-access-dialog";
import { AddStaffDialog } from "@/components/settings/add-staff-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";
import { useDeleteStaff, useDepartments, useStaff, useUpdateStaff, type StaffMember } from "@/hooks/use-staff";
import { api, ApiError } from "@/lib/api";
import { useState } from "react";

export default function StaffPage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: staff, isLoading } = useStaff();
  const { data: currentUser } = useCurrentUser();
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const { data: departments } = useDepartments();
  const [dept, setDept] = useState<string>("all");
  const visible = staff?.filter((m) => dept === "all" || (dept === "none" ? !m.departmentId : m.departmentId === dept));
  const canEditAccess = currentUser?.user.permissions.includes("roles.manage") ?? false;

  const onResetTwoFactor = (member: StaffMember) => {
    if (!confirm(t("Turn off two-factor authentication for {name}? They will sign in with just their password until they set it up again.", { name: member.name }))) return;
    api.post(`/auth/2fa/reset/${member.id}`).then(
      () => toast.success(t("Two-factor authentication reset for {name}", { name: member.name })),
      (err) => toast.error(err instanceof ApiError ? err.message : t("Could not reset")),
    );
  };

  const onDelete = (member: StaffMember) => {
    if (!confirm(t("Delete {name}? This cannot be undone.", { name: member.name }))) return;
    deleteStaff.mutate(member.id, {
      onSuccess: () => toast.success(t("{name} deleted", { name: member.name })),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : t("Could not delete staff account")),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Restaurant, branch, and staff configuration")}</p>
      </div>

      <SettingsTabs />

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-medium text-foreground">{t("Staff accounts")}</h2>
          <AddStaffDialog />
        </div>

        {departments && departments.length > 0 && (
          <div role="group" aria-label={t("Filter by department")} className="flex flex-wrap gap-1.5">
            {[{ id: "all", name: t("Everyone") }, ...departments, { id: "none", name: t("No department") }].map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={dept === d.id}
                onClick={() => setDept(d.id)}
                className={`min-h-8 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  dept === d.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : visible && visible.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Contact")}</TableHead>
                <TableHead>{t("Role")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Department")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("Branches")}</TableHead>
                <TableHead className="text-right">{t("Active")}</TableHead>
                <TableHead className="sm:w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium text-foreground">{member.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {member.email || member.phone || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {fmt.role(member.role.name, member.role.label)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{member.department?.name ?? "—"}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {member.branches.map((b) => b.branch.name).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      aria-label={t("{name} active", { name: member.name })}
                      checked={member.isActive}
                      onCheckedChange={(checked) =>
                        updateStaff.mutate(
                          { id: member.id, dto: { isActive: checked } },
                          {
                            onSuccess: () =>
                              toast.success(`${member.name} ${checked ? "enabled" : "disabled"}`),
                            onError: (err) =>
                              toast.error(err instanceof ApiError ? err.message : t("Could not update")),
                          },
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {member.id !== currentUser?.user.id && (
                      <div className="flex items-center justify-end gap-1">
                        {canEditAccess && <StaffAccessDialog member={member} />}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-muted-foreground"
                          title={t("Reset two-factor authentication (lost device)")}
                          onClick={() => onResetTwoFactor(member)}
                        >
                          {t("Reset 2FA")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title={t("Delete staff account")}
                          onClick={() => onDelete(member)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">{staff && staff.length > 0 ? t("No staff in this department") : t("No staff accounts yet")}</p>
            <p className="text-sm text-muted-foreground">{staff && staff.length > 0 ? t("Choose another filter above.") : t("Add your first staff account above.")}</p>
          </div>
        )}
      </Card>

      <DepartmentsCard />
    </div>
  );
}
