"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { Download, Lock } from "lucide-react";
import { useState } from "react";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
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
  useAuditLog,
  useAuditLogEntities,
  type AuditLogEntry,
} from "@/hooks/use-audit-log";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

interface Filters {
  entity?: string;
  from?: string;
  to?: string;
  page: number;
}

export default function AuditLogPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters>({ page: 1 });
  const { data, isLoading, isFetching } = useAuditLog({
    ...filters,
    pageSize: PAGE_SIZE,
  });
  const { data: entities } = useAuditLogEntities();
  const { data: me } = useCurrentUser();
  const canExport = hasPermission(me?.user, "data.export");
  const exportQs = new URLSearchParams();
  if (filters.entity) exportQs.set("entity", filters.entity);
  if (filters.from) exportQs.set("from", filters.from);
  if (filters.to) exportQs.set("to", filters.to);

  const setEntityFilter = (entity: string | undefined) =>
    setFilters((prev) => ({ ...prev, entity, page: 1 }));

  const setDateFilter = (key: "from" | "to", value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value || undefined, page: 1 }));

  const clearDates = () =>
    setFilters((prev) => ({ ...prev, from: undefined, to: undefined, page: 1 }));

  const goToPage = (page: number) => setFilters((prev) => ({ ...prev, page }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Restaurant, branch, and staff configuration")}</p>
      </div>

      <SettingsTabs />

      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-medium text-foreground">{t("Audit log")}</h2>
            {data ? (
              <p className="text-sm text-muted-foreground">{t("{total} entries", { total: data.total })}</p>
            ) : null}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden /> {t("Entries are permanent: nobody, including admins, can edit or delete them.")}
          </p>
          {canExport && (
            <div className="flex flex-wrap gap-2">
              {(["xlsx", "pdf", "csv"] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/v1/audit-logs/export?${exportQs.toString()}${exportQs.size ? "&" : ""}format=${f}`}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-secondary"
                >
                  <Download className="mr-2 h-4 w-4" /> {f === "xlsx" ? t("Excel") : f.toUpperCase()}
                </a>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <EntityChip
              label={t("All")}
              active={!filters.entity}
              onClick={() => setEntityFilter(undefined)}
            />
            {entities?.map((entity) => (
              <EntityChip
                key={entity}
                label={entity}
                active={filters.entity === entity}
                onClick={() => setEntityFilter(entity)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="audit-from">{t("From")}</Label>
              <Input
                id="audit-from"
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => setDateFilter("from", e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="audit-to">{t("To")}</Label>
              <Input
                id="audit-to"
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => setDateFilter("to", e.target.value)}
                className="w-40"
              />
            </div>
            {filters.from || filters.to ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearDates}>
                {t("Clear dates")}
              </Button>
            ) : null}
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : data && data.data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Actor")}</TableHead>
                  <TableHead>{t("Action")}</TableHead>
                  <TableHead>{t("Entity")}</TableHead>
                  <TableHead>{t("Timestamp")}</TableHead>
                  <TableHead className="text-right">{t("Details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((entry) => (
                  <AuditLogRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">{t("Page {page} of {totalPages}", { page: data.page, totalPages: data.totalPages })}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1 || isFetching}
                  onClick={() => goToPage(data.page - 1)}
                >
                  {t("Previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.totalPages || isFetching}
                  onClick={() => goToPage(data.page + 1)}
                >
                  {t("Next")}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">{t("No audit log entries yet")}</p>
            <p className="text-sm text-muted-foreground">
              {t("Actions like staff changes, refunds, and price edits will show up here.")}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function EntityChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// Owns its own expand/collapse state so toggling one row's JSON metadata
// never touches the parent list's state (and doesn't need an effect to
// "reset" anything — each row is keyed by entry.id, so a fresh mount already
// starts collapsed).
function AuditLogRow({ entry }: { entry: AuditLogEntry }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = entry.metadata !== null && entry.metadata !== undefined;

  return (
    <>
      <TableRow>
        <TableCell className="font-medium text-foreground">
          {entry.user?.name ?? t("System")}
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className="font-normal">
            {entry.action}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {entry.entity}
          {entry.entityId ? (
            <span className="text-xs"> #{entry.entityId.slice(-8)}</span>
          ) : null}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {new Date(entry.createdAt).toLocaleString(fmt.localeTag)}
        </TableCell>
        <TableCell className="text-right">
          {hasMetadata ? (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t("Hide") : t("View")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>
      {expanded && hasMetadata ? (
        <TableRow>
          <TableCell colSpan={5} className="whitespace-normal bg-muted/30">
            <pre className="max-h-64 overflow-auto rounded-lg bg-background p-3 text-xs text-muted-foreground">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
