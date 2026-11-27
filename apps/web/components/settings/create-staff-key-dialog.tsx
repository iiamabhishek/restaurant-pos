"use client";

import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateStaffApiKey } from "@/hooks/use-api-keys";
import { ApiError } from "@/lib/api";

export function CreateStaffKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const createKey = useCreateStaffApiKey();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createKey.mutate(
      { name: name.trim() },
      {
        onSuccess: (created) => onCreated(created.token),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not create API key")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("New personal API key")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sk-name">{t("Name")}</Label>
            <Input
              id="sk-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("e.g. Claude Desktop")}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t("This key lets an AI client (like Claude Desktop) or any script act as you, with your exact permissions — see the MCP connection details below once created.")}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={createKey.isPending}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={createKey.isPending}>
              {createKey.isPending ? t("Creating…") : t("Create key")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
