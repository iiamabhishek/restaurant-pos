"use client";

import { useI18n } from "@/lib/i18n/context";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateFloor } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function RenameFloorDialog({
  branchId,
  floorId,
  currentName,
}: {
  branchId: string | null;
  floorId: string;
  currentName: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const updateFloor = useUpdateFloor(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFloor.mutate(
      { id: floorId, name },
      {
        onSuccess: () => {
          toast.success(t("Floor renamed"));
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not rename floor")),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(currentName);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t("Rename floor")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="rename-floor">{t("Name")}</Label>
            <Input
              id="rename-floor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateFloor.isPending}>
              {updateFloor.isPending ? t("Saving…") : t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
