"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useSearchParams } from "next/navigation";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { AdjustLineDialog, PayRunDialog, SlipButton } from "@/components/team/payroll-dialogs";
import { Suspense, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import {
  useHrActions,
  useLeave,
  usePay,
  usePayrollRun,
  usePayrollRuns,
  usePerformance,
  useShifts,
} from "@/hooks/use-hr";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const fmtDate = (fmt: StaffFormat, s: string) => new Date(s).toLocaleDateString(fmt.localeTag, { day: "numeric", month: "short" });
const fmtTime = (fmt: StaffFormat, s: string) => new Date(s).toLocaleTimeString(fmt.localeTag, { hour: "2-digit", minute: "2-digit" });
const TABS = ["schedule", "leave", "payroll", "performance"] as const;
type Tab = (typeof TABS)[number];

function Schedule({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [from, setFrom] = useState(() => iso(new Date()));
  const to = iso(addDays(new Date(from), 6));
  const { data: shifts, isLoading } = useShifts(branchId, from, to);
  const { data: staff } = usePay(branchId);
  const { addShift, deleteShift } = useHrActions(branchId);
  const [form, setForm] = useState({ userId: "", date: iso(new Date()), start: "09:00", end: "17:00" });

  const submit = () => {
    if (!form.userId) return toast.error(t("Pick a staff member"));
    addShift.mutate(
      {
        userId: form.userId,
        startsAt: new Date(`${form.date}T${form.start}`).toISOString(),
        endsAt: new Date(`${form.date}T${form.end}`).toISOString(),
      },
      { onSuccess: () => toast.success(t("Shift added")), onError: (e) => toast.error(errMsg(e, t("Something went wrong"))) },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-5">
        <select
          aria-label={t("Staff")}
          value={form.userId}
          onChange={(e) => setForm({ ...form, userId: e.target.value })}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">{t("Staff…")}</option>
          {staff?.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
            </option>
          ))}
        </select>
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <Button onClick={submit} disabled={addShift.isPending}>{t("Add shift")}</Button>
      </Card>
      <div className="flex items-center gap-2 text-sm">
        <Button size="sm" variant="outline" onClick={() => setFrom(iso(addDays(new Date(from), -7)))}>{t("← Prev")}</Button>
        <span className="text-muted-foreground">{fmtDate(fmt, from)} – {fmtDate(fmt, to)}</span>
        <Button size="sm" variant="outline" onClick={() => setFrom(iso(addDays(new Date(from), 7)))}>{t("Next →")}</Button>
      </div>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : shifts && shifts.length > 0 ? (
          shifts.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-medium text-foreground">{s.user.name}</span>
              <span className="text-muted-foreground">
                {fmtDate(fmt, s.startsAt)} · {fmtTime(fmt, s.startsAt)} – {fmtTime(fmt, s.endsAt)}
              </span>
              <Button size="sm" variant="outline" onClick={() => deleteShift.mutate(s.id)}>{t("Remove")}</Button>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("No shifts this week.")}</p>
        )}
      </Card>
    </div>
  );
}

function Leave({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data, isLoading } = useLeave(branchId);
  const { decideLeave } = useHrActions(branchId);
  return (
    <Card className="flex flex-col divide-y divide-border p-2">
      {isLoading ? (
        <Skeleton className="m-4 h-12" />
      ) : data && data.length > 0 ? (
        data.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-foreground">
                {l.user?.name} · {fmt.code(l.type)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(fmt, l.startDate)} – {fmtDate(fmt, l.endDate)}
                {l.reason && ` · ${l.reason}`}
              </p>
            </div>
            {l.status === "PENDING" ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decideLeave.mutate({ id: l.id, status: "APPROVED" }, { onError: (e) => toast.error(errMsg(e, t("Something went wrong"))) })}>
                  {t("Approve")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => decideLeave.mutate({ id: l.id, status: "REJECTED" }, { onError: (e) => toast.error(errMsg(e, t("Something went wrong"))) })}>
                  {t("Reject")}
                </Button>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{fmt.code(l.status)}</span>
            )}
          </div>
        ))
      ) : (
        <p className="p-6 text-center text-sm text-muted-foreground">{t("No leave requests.")}</p>
      )}
    </Card>
  );
}

function RunDetail({ branchId, id }: { branchId: string | null; id: string }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data } = usePayrollRun(branchId, id);
  const { finalizeRun, deleteRun } = useHrActions(branchId);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const { note, clear, toast: runToast } = useNoteToast();
  if (!data) return <Skeleton className="h-24" />;
  const editable = data.status === "DRAFT";
  const adjustingLine = data.lines.find((l) => l.user.id === adjusting);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t("{fmtDate} – {fmtDate2} · {code} · tip pool {currency}", { fmtDate: fmtDate(fmt, data.periodStart), fmtDate2: fmtDate(fmt, data.periodEnd), code: fmt.code(data.status), currency: fmt.currency(data.tipPool) })}{data.status === "PAID" && data.paidAt
            ? t(" · paid {fmtDate}{value}", { fmtDate: fmtDate(fmt, data.paidAt), value: data.paymentMethod ? t(" by {code}", { code: fmt.code(data.paymentMethod) }) : "" })
            : ""}
        </p>
        {data.status === "DRAFT" && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => finalizeRun.mutate(id, { onSuccess: () => runToast.success(t("Payroll finalized - adjustments are now locked")), onError: (e) => runToast.error(errMsg(e, t("Something went wrong"))) })}>
              {t("Finalize")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => deleteRun.mutate(id, { onError: (e) => runToast.error(errMsg(e, t("Something went wrong"))) })}>{t("Discard draft")}</Button>
          </div>
        )}
        {data.status === "FINALIZED" && (
          <Button size="sm" onClick={() => setPaying(true)}>{t("Mark as paid")}</Button>
        )}
      </div>
      <StatusNote note={note} onClear={clear} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">{t("Staff")}</th><th>{t("Hours")}</th><th>{t("Base")}</th><th>{t("Leave −")}</th><th>{t("Tips")}</th>
              <th>{t("Allow. +")}</th><th>{t("Bonus +")}</th><th>{t("Advance −")}</th><th>{t("Other −")}</th>
              <th className="text-right">{t("Net")}</th><th />
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-1.5">{l.user.name}</td>
                <td>{l.hoursWorked}</td>
                <td>{fmt.currency(l.basePay)}</td>
                <td>{fmt.currency(l.unpaidLeaveDeduction)}</td>
                <td>{fmt.currency(l.tipShare)}</td>
                <td>{fmt.currency(l.allowances)}</td>
                <td>{fmt.currency(l.bonus)}</td>
                <td>{fmt.currency(l.advanceRecovery)}</td>
                <td>{fmt.currency(l.otherDeductions)}</td>
                <td className="text-right font-medium">{fmt.currency(l.netPay)}</td>
                <td className="whitespace-nowrap text-right">
                  {editable && (
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setAdjusting(l.user.id)}>
                      {t("Adjust")}
                    </Button>
                  )}
                  <SlipButton branchId={branchId} runId={id} userId={l.user.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-right text-sm font-semibold">{t("Total {formatCurrency}", { formatCurrency: fmt.currency(data.totalNet) })}</p>
      {adjustingLine && (
        <AdjustLineDialog key={adjustingLine.id} branchId={branchId} runId={id} line={adjustingLine} onClose={() => setAdjusting(null)} />
      )}
      {paying && <PayRunDialog branchId={branchId} runId={id} total={data.totalNet} onClose={() => setPaying(false)} />}
    </Card>
  );
}

function Payroll({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: pay } = usePay(branchId);
  const { data: runs } = usePayrollRuns(branchId);
  const { setPay, createRun } = useHrActions(branchId);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { start: iso(first), end: iso(last) };
  });
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { payType: "MONTHLY" | "HOURLY"; rate: string; ot: string; mult: string; grace: string; absent: boolean }>>({});

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium text-foreground">{t("Pay rates")}</p>
        {pay?.map((p) => {
          const d = draft[p.userId] ?? { payType: p.payType ?? "MONTHLY", rate: String(p.rate ?? ""), ot: p.overtimeAfterHours != null ? String(p.overtimeAfterHours) : "", mult: String(p.overtimeMultiplier ?? 1.5), grace: p.lateGraceMinutes != null ? String(p.lateGraceMinutes) : "", absent: !!p.deductAbsence };
          return (
            <div key={p.userId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-40 truncate">{p.name}</span>
              <select
                aria-label={t("Pay type")}
                value={d.payType}
                onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, payType: e.target.value as "MONTHLY" | "HOURLY" } })}
                className="rounded-lg border border-border bg-background px-2 py-1.5"
              >
                <option value="MONTHLY">{t("Monthly")}</option>
                <option value="HOURLY">{t("Hourly")}</option>
              </select>
              <Input
                className="w-28"
                inputMode="decimal"
                placeholder={t("Rate")}
                value={d.rate}
                onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, rate: e.target.value } })}
              />
              {d.payType === "HOURLY" && (
                <>
                  <Input aria-label={t("Overtime after hours a day")} className="w-28" inputMode="decimal" placeholder={t("OT after h/day")} value={d.ot} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, ot: e.target.value } })} />
                  <Input aria-label={t("Overtime multiplier")} className="w-20" inputMode="decimal" placeholder="x1.5" value={d.mult} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, mult: e.target.value } })} />
                </>
              )}
              {d.payType === "MONTHLY" && (
                <>
                  <Input aria-label={t("Late grace minutes")} className="w-28" inputMode="numeric" placeholder={t("Late after (min)")} value={d.grace} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, grace: e.target.value } })} />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={d.absent} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, absent: e.target.checked } })} /> {t("Deduct absent days")}</label>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPay.mutate(
                    { userId: p.userId, payType: d.payType, rate: Number(d.rate), overtimeAfterHours: d.ot ? Number(d.ot) : null, overtimeMultiplier: d.mult ? Number(d.mult) : undefined, lateGraceMinutes: d.grace.trim() !== "" ? Number(d.grace) : null, deductAbsence: d.absent },
                    { onSuccess: () => toast.success(t("Saved")), onError: (e) => toast.error(errMsg(e, t("Something went wrong"))) },
                  )
                }
              >
                {t("Save")}
              </Button>
            </div>
          );
        })}
      </Card>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Input type="date" className="w-40" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
        <Input type="date" className="w-40" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
        <Button
          disabled={createRun.isPending}
          onClick={() =>
            createRun.mutate(
              { periodStart: period.start, periodEnd: period.end },
              {
                onSuccess: (r) => {
                  setOpen((r as { id: string }).id);
                  for (const w of (r as { warnings?: string[] }).warnings ?? []) toast.error(w);
                },
                onError: (e) => toast.error(errMsg(e, t("Something went wrong"))),
              },
            )
          }
        >
          {t("Run payroll")}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          {t("Uses clocked hours from Attendance, approved unpaid leave, and splits the period’s tips by hours worked.")}
        </p>
      </Card>
      {runs?.map((r) => (
        <div key={r.id} className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen(open === r.id ? null : r.id)}
            className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm hover:bg-secondary"
          >
            <span>{fmtDate(fmt, r.periodStart)} – {fmtDate(fmt, r.periodEnd)} · {fmt.code(r.status)}</span>
            <span className="font-medium">{fmt.currency(r.totalNet)}</span>
          </button>
          {open === r.id && <RunDetail branchId={branchId} id={r.id} />}
        </div>
      ))}
    </div>
  );
}

function Performance({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const [range, setRange] = useState(() => ({ from: iso(addDays(new Date(), -29)), to: iso(new Date()) }));
  const { data, isLoading } = usePerformance(branchId, range.from, range.to);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input type="date" className="w-40" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input type="date" className="w-40" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      <Card className="overflow-x-auto p-4">
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">{t("Staff")}</th><th>{t("Orders")}</th><th>{t("Sales")}</th><th>{t("Tips")}</th><th>{t("Hours")}</th><th className="text-right">{t("Sales / hour")}</th></tr>
            </thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.userId} className="border-t border-border">
                  <td className="py-1.5">{r.name}</td>
                  <td>{r.orders}</td>
                  <td>{fmt.currency(r.sales)}</td>
                  <td>{fmt.currency(r.tips)}</td>
                  <td>{r.hoursWorked}</td>
                  <td className="text-right">{r.salesPerHour == null ? "—" : fmt.currency(r.salesPerHour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TeamView() {
  const { t: translate } = useI18n();
  const { branchId } = useBranch();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab");
    return TABS.find((x) => x === t) ?? "schedule";
  });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{translate("Team")}</h1>
        <p className="text-sm text-muted-foreground">{translate("Schedules, leave, payroll and performance")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs capitalize transition-colors",
              tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {translate(t)}
          </button>
        ))}
      </div>
      {tab === "schedule" && <Schedule branchId={branchId} />}
      {tab === "leave" && <Leave branchId={branchId} />}
      {tab === "payroll" && <Payroll branchId={branchId} />}
      {tab === "performance" && <Performance branchId={branchId} />}
    </div>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <TeamView />
    </Suspense>
  );
}
