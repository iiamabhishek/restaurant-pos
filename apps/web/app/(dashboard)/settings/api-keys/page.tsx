"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { CreateIntegrationKeyDialog } from "@/components/settings/create-integration-key-dialog";
import { CreateStaffKeyDialog } from "@/components/settings/create-staff-key-dialog";
import { NewApiKeyDialog } from "@/components/settings/new-api-key-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import {
  useIntegrationApiKeys,
  useRevokeIntegrationApiKey,
  useRotateIntegrationApiKey,
  useRevokeStaffApiKey,
  useStaffApiKeys,
  type IntegrationApiKey,
  type StaffApiKey,
} from "@/hooks/use-api-keys";
import { ApiError } from "@/lib/api";

export default function ApiKeysPage() {
  const { t } = useI18n();
  const { data } = useCurrentUser();
  const user = data?.user;
  const canManageIntegrations = hasPermission(user, "settings.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Restaurant, branch, and staff configuration")}</p>
      </div>

      <SettingsTabs />

      <StaffApiKeysCard />
      {canManageIntegrations ? <IntegrationApiKeysCard /> : null}
    </div>
  );
}

function StaffApiKeysCard() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: keys, isLoading } = useStaffApiKeys();
  const revokeKey = useRevokeStaffApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const onRevoke = (key: StaffApiKey) => {
    if (!confirm(t("Revoke \"{name}\"? Anything using this key stops working immediately.", { name: key.name }))) return;
    revokeKey.mutate(key.id, {
      onSuccess: () => toast.success(t("Key revoked")),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not revoke key")),
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">{t("Personal API keys & MCP")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Personal access tokens that act as you, with your exact permissions. Use one to connect an MCP client (Claude Desktop, etc.) or any script.")}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          {t("New key")}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("MCP server URL")}</p>
        <code className="mt-1 block overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
          {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/mcp
        </code>
        <p className="mt-2">
          {t("Point your MCP client at that URL with header")} <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>{t(". See")} <a href="/docs/api" className="underline">{t("API docs")}</a> {t("for the full tool list.")}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : keys && keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead>{t("Key")}</TableHead>
              <TableHead>{t("Last used")}</TableHead>
              <TableHead className="text-right">{t("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">…{key.lastFour}</TableCell>
                <TableCell className="text-muted-foreground">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString(fmt.localeTag) : t("Never")}
                </TableCell>
                <TableCell className="text-right">
                  {key.revokedAt ? (
                    <Badge variant="outline">{t("Revoked")}</Badge>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => onRevoke(key)}>
                      {t("Revoke")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("No personal API keys yet.")}</p>
      )}

      {showCreate ? (
        <CreateStaffKeyDialog
          onClose={() => setShowCreate(false)}
          onCreated={(token) => {
            setShowCreate(false);
            setNewToken(token);
          }}
        />
      ) : null}
      {newToken ? <NewApiKeyDialog token={newToken} onClose={() => setNewToken(null)} /> : null}
    </Card>
  );
}

function IntegrationApiKeysCard() {
  const { t } = useI18n();
  const { data: keys, isLoading } = useIntegrationApiKeys();
  const revokeKey = useRevokeIntegrationApiKey();
  const rotateKey = useRotateIntegrationApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const onRotate = (key: IntegrationApiKey) => {
    if (!confirm(t("Rotate \"{name}\"? A new key replaces it; update your website with it, as the old one stops working immediately.", { name: key.name }))) return;
    rotateKey.mutate(key.id, {
      onSuccess: (created) => setNewToken(created.token),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not rotate key")),
    });
  };

  const onRevoke = (key: IntegrationApiKey) => {
    if (!confirm(t("Revoke \"{name}\"? Any external website using this key stops working immediately.", { name: key.name }))) return;
    revokeKey.mutate(key.id, {
      onSuccess: () => toast.success(t("Key revoked")),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not revoke key")),
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">{t("Integration API keys")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Credentials for an external website or system to use OrderRestro as a backend — browse the menu, place orders, and book tables for a location. Not tied to any staff account.")}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          {t("New key")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : keys && keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead>{t("Key")}</TableHead>
              <TableHead>{t("Location")}</TableHead>
              <TableHead>{t("Permissions")}</TableHead>
              <TableHead className="text-right">{t("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">…{key.lastFour}</TableCell>
                <TableCell className="text-muted-foreground">{key.branch?.name ?? t("All locations")}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {key.revokedAt ? (
                    <Badge variant="outline">{t("Revoked")}</Badge>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => onRotate(key)}>
                        {t("Rotate")}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onRevoke(key)}>
                        {t("Revoke")}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("No integration API keys yet.")}</p>
      )}

      {showCreate ? (
        <CreateIntegrationKeyDialog
          onClose={() => setShowCreate(false)}
          onCreated={(token) => {
            setShowCreate(false);
            setNewToken(token);
          }}
        />
      ) : null}
      {newToken ? <NewApiKeyDialog token={newToken} onClose={() => setNewToken(null)} /> : null}
    </Card>
  );
}
