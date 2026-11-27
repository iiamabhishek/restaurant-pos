"use client";

import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Floor, useLayoutActions } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

/** Saved arrangements of one floor (lunch, dinner, event). Switching hides the tables a layout leaves out. */
export function LayoutsBar({ branchId, floor }: { branchId: string | null; floor: Floor }) {
  const { t } = useI18n();
  const { save, activate, overwrite, remove } = useLayoutActions(branchId);
  const [name, setName] = useState("");
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t("Could not do that"));
  const layouts = floor.layouts ?? [];
  return (
    <section aria-label={t("Layouts for {name}", { name: floor.name })} className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">{t("Layouts")}</p>
      {layouts.length === 0 && <p className="text-xs text-muted-foreground">{t("Arrange the tables, then save the arrangement under a name such as Lunch or Event.")}</p>}
      <ul className="flex flex-wrap gap-2">
        {layouts.map((l) => (
          <li key={l.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
            <span className={l.isActive ? "font-semibold" : ""}>{l.name}{l.isActive ? t(" (in use)") : ""}</span>
            {!l.isActive && <Button size="xs" onClick={() => activate.mutate(l.id, { onSuccess: () => toast.success(t("{name} is now in use", { name: l.name })), onError: fail })}>{t("Use")}</Button>}
            {l.isActive && <Button size="xs" variant="outline" onClick={() => overwrite.mutate(l.id, { onSuccess: () => toast.success(t("Layout updated")), onError: fail })}>{t("Save changes")}</Button>}
            {!l.isActive && <Button size="xs" variant="ghost" aria-label={t("Delete layout {name}", { name: l.name })} onClick={() => remove.mutate(l.id, { onError: fail })}>×</Button>}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate({ floorId: floor.id, name: name.trim() }, { onSuccess: () => { setName(""); toast.success(t("Layout saved")); }, onError: fail }); }}>
        <Input aria-label={t("New layout name")} className="max-w-48" placeholder={t("Save this as…")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || save.isPending}>{t("Save layout")}</Button>
      </form>
    </section>
  );
}
