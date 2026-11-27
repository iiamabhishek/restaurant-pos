"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { DocumentFiles } from "@/components/operations/document-files";
import { useDocument, useDocuments, useEquipment, useOpsActions } from "@/hooks/use-marketing";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const today = () => new Date().toISOString().slice(0, 10);
const CATEGORIES = ["SOP", "CONTRACT", "RECIPE", "PURCHASE", "OTHER"] as const;

function EquipmentTab({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading } = useEquipment(branchId);
  const { createEquipment, retireEquipment, logService } = useOpsActions(branchId);
  const [f, setF] = useState({ name: "", location: "", serviceIntervalDays: "", lastServicedAt: "" });

  const submit = () =>
    createEquipment.mutate(
      {
        name: f.name,
        location: f.location || undefined,
        serviceIntervalDays: f.serviceIntervalDays ? Number(f.serviceIntervalDays) : undefined,
        lastServicedAt: f.lastServicedAt || undefined,
      },
      {
        onSuccess: () => { toast.success(t("Equipment added")); setF({ name: "", location: "", serviceIntervalDays: "", lastServicedAt: "" }); },
        onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input placeholder={t("Equipment name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder={t("Location")} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        <Input placeholder={t("Service every (days)")} inputMode="numeric" value={f.serviceIntervalDays} onChange={(e) => setF({ ...f, serviceIntervalDays: e.target.value })} />
        <Input type="date" aria-label={t("Last serviced")} value={f.lastServicedAt} onChange={(e) => setF({ ...f, lastServicedAt: e.target.value })} />
        <Button onClick={submit} disabled={createEquipment.isPending}>{t("Add")}</Button>
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : data && data.length > 0 ? (
          data.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {e.name}
                  {e.overdue && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{t("Overdue")}</span>}
                  {e.dueSoon && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t("Due soon")}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.location && `${e.location} · `}
                  {e.nextDueAt ? t("next service {slice}", { slice: fmt.day(e.nextDueAt) }) : t("no schedule")}
                  {e.lastServicedAt && t(" · last {slice}", { slice: fmt.day(e.lastServicedAt) })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => logService.mutate({ id: e.id, servicedAt: today() }, { onSuccess: () => toast.success(t("Service logged")), onError: (err) => toast.error(errMsg(err, t("Something went wrong"))) })}>
                  {t("Serviced today")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => confirm(t("Retire {name}?", { name: e.name })) && retireEquipment.mutate(e.id)}>
                  {t("Retire")}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No equipment tracked yet.")}</p>
        )}
      </Card>
    </div>
  );
}

function DocumentsTab({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading } = useDocuments(branchId);
  const { createDocument, updateDocument, deleteDocument } = useOpsActions(branchId);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: doc } = useDocument(branchId, openId);
  const [draft, setDraft] = useState<{ title: string; category: string; body: string } | null>(null);

  const startNew = () => { setOpenId(null); setDraft({ title: "", category: "SOP", body: "" }); };
  const startEdit = () => doc && setDraft({ title: doc.title, category: doc.category, body: doc.body });
  const save = () => {
    if (!draft) return;
    const done = { onSuccess: () => { toast.success(t("Saved")); setDraft(null); }, onError: (e: unknown) => toast.error(errMsg(e, t("Something went wrong"))) };
    if (openId) updateDocument.mutate({ id: openId, dto: draft }, done);
    else createDocument.mutate(draft, done);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="flex flex-col gap-1 p-2">
        <Button size="sm" className="m-2" onClick={startNew}>{t("New document")}</Button>
        {isLoading ? <Skeleton className="m-2 h-10" /> : data?.map((d) => (
          <button key={d.id} type="button" onClick={() => { setOpenId(d.id); setDraft(null); }} className={cn("rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary", openId === d.id && "bg-secondary")}>
            <span className="block font-medium text-foreground">{d.title}</span>
            <span className="text-xs text-muted-foreground">{fmt.code(d.category)}</span>
          </button>
        ))}
        {data && data.length === 0 && <p className="p-3 text-xs text-muted-foreground">{t("No documents yet.")}</p>}
      </Card>
      <Card className="min-h-64 p-4">
        {draft ? (
          <div className="flex flex-col gap-3">
            <Input placeholder={t("Title")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <select aria-label={t("Category")} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="w-fit rounded-lg border border-border bg-background px-2 py-2 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{fmt.code(c)}</option>)}
            </select>
            <textarea aria-label={t("Body")} className="min-h-56 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="flex gap-2">
              <Button onClick={save} disabled={!draft.title.trim() || !draft.body.trim()}>{t("Save")}</Button>
              <Button variant="outline" onClick={() => setDraft(null)}>{t("Cancel")}</Button>
            </div>
          </div>
        ) : doc ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{doc.title}</h2>
                <p className="text-xs text-muted-foreground">{t("{code} · updated {day}", { code: fmt.code(doc.category), day: fmt.day(doc.updatedAt) })}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={startEdit}>{t("Edit")}</Button>
                <Button size="sm" variant="outline" onClick={() => confirm(t("Delete \"{title}\"?", { title: doc.title })) && deleteDocument.mutate(doc.id, { onSuccess: () => setOpenId(null) })}>{t("Delete")}</Button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{doc.body}</pre>
            <DocumentFiles branchId={branchId} docId={doc.id} files={doc.files ?? []} />
          </div>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">{t("Select a document, or create one — SOPs, contracts, recipes, purchase paperwork.")}</p>
        )}
      </Card>
    </div>
  );
}

export default function OperationsPage() {
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const [tab, setTab] = useState<"equipment" | "documents">("equipment");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Operations")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Equipment servicing and your digital documents")}</p>
      </div>
      <div className="flex gap-2">
        {(["equipment", "documents"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-full border px-3.5 py-1 text-xs capitalize transition-colors", tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary")}>
            {translate(t)}
          </button>
        ))}
      </div>
      {tab === "equipment" ? <EquipmentTab branchId={branchId} /> : <DocumentsTab branchId={branchId} />}
    </div>
  );
}
