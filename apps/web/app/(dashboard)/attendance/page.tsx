"use client";

import { useStaffFormat, type StaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useAttendance, useClock, useMyShift } from "@/hooks/use-attendance";
import { useBranch } from "@/hooks/use-branch";
import { useHrActions, useMyLeave } from "@/hooks/use-hr";
import { toast } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const time = (fmt: StaffFormat, iso: string) =>
  new Date(iso).toLocaleTimeString(fmt.localeTag, { hour: "2-digit", minute: "2-digit" });

function duration(from: string, to: string | null) {
  const mins = Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function LeaveRequestCard({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: mine } = useMyLeave();
  const { requestLeave } = useHrActions(branchId);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: "ANNUAL", startDate: today, endDate: today, reason: "" });
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="text-sm font-medium text-foreground">{t("Request leave")}</p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={t("Leave type")}
          value={f.type}
          onChange={(e) => setF({ ...f, type: e.target.value })}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="ANNUAL">{t("Annual")}</option>
          <option value="SICK">{t("Sick")}</option>
          <option value="UNPAID">{t("Unpaid")}</option>
          <option value="OTHER">{t("Other")}</option>
        </select>
        <input aria-label={t("Leave start date")} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
        <input aria-label={t("Leave end date")} type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
        <input aria-label={t("Reason (optional)")} placeholder={t("Reason (optional)")} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="min-w-40 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
        <Button
          size="sm"
          disabled={!branchId || requestLeave.isPending}
          onClick={() =>
            requestLeave.mutate(
              { ...f, reason: f.reason || undefined },
              {
                onSuccess: () => toast.success(t("Leave requested")),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Could not request leave")),
              },
            )
          }
        >
          {t("Request")}
        </Button>
      </div>
      {mine && mine.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {mine.slice(0, 5).map((l) => (
            <li key={l.id}>
              {fmt.day(l.startDate)} → {fmt.day(l.endDate)} · {fmt.code(l.type)} · {fmt.code(l.status)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AttendancePage() {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canManage = hasPermission(me?.user, "attendance.manage");
  const { data: shift, isLoading: shiftLoading } = useMyShift();
  const { clockIn, clockOut } = useClock(branchId);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: records, isLoading } = useAttendance(branchId, date, canManage);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Attendance")}</h1>
        <p className="text-sm text-muted-foreground">{t("Clock in and out of your shift")}</p>
      </div>

      <Card className="flex items-center justify-between gap-4 p-5">
        {shiftLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : shift ? (
          <>
            <div>
              <p className="text-sm font-medium text-foreground">{t("On shift since {time}", { time: time(fmt, shift.clockInAt) })}</p>
              <p className="text-xs text-muted-foreground">{t("{duration} so far", { duration: duration(shift.clockInAt, null) })}</p>
            </div>
            <Button variant="outline" disabled={clockOut.isPending} onClick={() => clockOut.mutate()}>
              {t("Clock out")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("You are not clocked in.")}</p>
            <Button disabled={!branchId || clockIn.isPending} onClick={() => clockIn.mutate()}>
              {t("Clock in")}
            </Button>
          </>
        )}
      </Card>

      <LeaveRequestCard branchId={branchId} />

      {canManage && (
        <>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label={t("Date")}
            className="w-fit rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          />
          <Card className="flex flex-col divide-y divide-border p-2">
            {isLoading ? (
              <div className="p-4">
                <Skeleton className="h-14 rounded-lg" />
              </div>
            ) : records && records.length > 0 ? (
              records.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="font-medium text-foreground">{r.user.name}</span>
                  <span className="text-muted-foreground">
                    {time(fmt, r.clockInAt)} – {r.clockOutAt ? time(fmt, r.clockOutAt) : t("on shift")} ·{" "}
                    {duration(r.clockInAt, r.clockOutAt)}
                  </span>
                </div>
              ))
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("No attendance records for this day.")}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
