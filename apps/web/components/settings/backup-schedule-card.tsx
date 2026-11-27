"use client";

import type { BackupSchedule } from "@nodedr-restaurant/types";
import { CalendarClock, ChevronDown, Clock3, Eye, Globe2, Pencil } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetBackupSchedule, type BackupStatus } from "@/hooks/use-backups";
import { ApiError } from "@/lib/api";
import {
  createScheduleDraft,
  formatNextBackup,
  scheduleFromDraft,
  scheduleTimeZoneName,
} from "@/lib/backup-schedule";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";
import { toast } from "@/lib/toast";

const MODES = ["daily", "weekly", "monthly", "interval"] as const;
const days = Array.from({ length: 31 }, (_, i) => i + 1);

function weekdayName(locale: string, weekday: number) {
  // This UTC week starts on a Sunday, matching BackupSchedule.weekday.
  return new Date(Date.UTC(2023, 0, 1 + weekday)).toLocaleDateString(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
}

function ScheduleSummary({ schedule, retainCount }: { schedule: BackupSchedule; retainCount: number }) {
  const { t, locale } = useI18n();
  let cadence: string;
  switch (schedule.mode) {
    case "interval":
      cadence = t(
        schedule.intervalDays === 1 ? "backup.cadence.intervalOne" : "backup.cadence.interval",
        { days: schedule.intervalDays },
      );
      break;
    case "daily":
      cadence = t("backup.cadence.daily", { time: schedule.time });
      break;
    case "weekly":
      cadence = t("backup.cadence.weekly", {
        day: weekdayName(LOCALE_TAGS[locale], schedule.weekday),
        time: schedule.time,
      });
      break;
    case "monthly":
      cadence = t("backup.cadence.monthly", { day: schedule.dayOfMonth, time: schedule.time });
      break;
  }
  return (
    <div className="space-y-2.5">
      <p className="text-xl font-semibold leading-snug tracking-tight text-foreground">{cadence}</p>
      {schedule.mode !== "interval" && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" title={schedule.timeZone}>
          <Globe2 aria-hidden className="size-3.5 shrink-0" />
          <span className="break-words">
            {scheduleTimeZoneName(schedule.timeZone, LOCALE_TAGS[locale])}
          </span>
        </p>
      )}
      <p className="text-sm text-foreground">
        {t(retainCount === 1 ? "backup.keepOne" : "backup.keepMany", { count: retainCount })}
      </p>
      {schedule.mode === "monthly" && schedule.dayOfMonth > 28 && (
        <p className="text-sm text-muted-foreground">{t("backup.shortMonth")}</p>
      )}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function ScheduleSelect(props: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        {...props}
        className="h-10 w-full appearance-none truncate rounded-lg border border-input bg-card px-3 pr-8 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm"
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-muted-foreground"
      />
    </div>
  );
}

function ScheduleEditor({
  schedule,
  retainCount,
  onClose,
}: {
  schedule: BackupSchedule;
  retainCount: number;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const save = useSetBackupSchedule();
  const [draft, setDraft] = useState(() =>
    createScheduleDraft(schedule, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
  );
  const [retention, setRetention] = useState(retainCount);
  const [zones] = useState(() => {
    const supported = Intl.supportedValuesOf?.("timeZone") ?? [
      "America/New_York",
      "America/Sao_Paulo",
      "Europe/Paris",
      "Asia/Kolkata",
    ];
    return [...new Set(["UTC", draft.timeZone, ...supported])].sort();
  });
  const next = scheduleFromDraft(draft);
  const complete = next.mode === "interval" || Boolean(next.time);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete) return;
    save.mutate(
      { schedule: next, retainCount: retention },
      {
        onSuccess: () => {
          toast.success(t("backup.saved"));
          onClose();
        },
      },
    );
  };
  return (
    <form onSubmit={submit}>
      <fieldset disabled={save.isPending} className="min-w-0 space-y-5">
        <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(15rem,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid items-start gap-4 sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
              <Field id="backup-frequency" label={t("backup.frequency")}>
                <ScheduleSelect
                  id="backup-frequency"
                  value={draft.mode}
                  onChange={(e) =>
                    setDraft({ ...draft, mode: e.target.value as BackupSchedule["mode"] })
                  }
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`backup.mode.${mode}`)}
                    </option>
                  ))}
                </ScheduleSelect>
              </Field>
              {draft.mode === "weekly" && (
                <Field id="backup-weekday" label={t("backup.weekday")}>
                  <ScheduleSelect
                    id="backup-weekday"
                    value={draft.weekday}
                    onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
                  >
                    {Array.from({ length: 7 }, (_, i) => (
                      <option key={i} value={i}>
                        {weekdayName(LOCALE_TAGS[locale], i)}
                      </option>
                    ))}
                  </ScheduleSelect>
                </Field>
              )}
              {draft.mode === "monthly" && (
                <Field id="backup-month-day" label={t("backup.monthDay")}>
                  <ScheduleSelect
                    id="backup-month-day"
                    value={draft.dayOfMonth}
                    onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })}
                  >
                    {days.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </ScheduleSelect>
                </Field>
              )}
              {draft.mode === "interval" ? (
                <Field id="backup-interval" label={t("backup.intervalDays")}>
                  <ScheduleSelect
                    id="backup-interval"
                    value={draft.intervalDays}
                    onChange={(e) => setDraft({ ...draft, intervalDays: Number(e.target.value) })}
                  >
                    {days.slice(0, 30).map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </ScheduleSelect>
                </Field>
              ) : (
                <Field id="backup-time" label={t("backup.time")}>
                  <Input
                    type="time"
                    id="backup-time"
                    required
                    className="h-10 bg-card px-3 tabular-nums dark:scheme-dark"
                    value={draft.time}
                    onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                  />
                </Field>
              )}
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              {draft.mode !== "interval" && (
                <Field id="backup-timezone" label={t("backup.timeZone")}>
                  <ScheduleSelect
                    id="backup-timezone"
                    value={draft.timeZone}
                    onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
                  >
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </ScheduleSelect>
                </Field>
              )}
              <Field id="backup-retention" label={t("backup.retention")}>
                <ScheduleSelect
                  id="backup-retention"
                  value={retention}
                  onChange={(e) => setRetention(Number(e.target.value))}
                >
                  {days.slice(0, 10).map((n) => (
                    <option key={n} value={n}>
                      {t(n === 1 ? "backup.copyOne" : "backup.copyMany", { count: n })}
                    </option>
                  ))}
                </ScheduleSelect>
              </Field>
            </div>
          </div>
          <div
            aria-live="polite"
            aria-atomic="true"
            className="space-y-3 rounded-xl border border-primary/20 bg-accent/55 p-5"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-accent-foreground">
              <Eye aria-hidden className="size-4" />
              {t("backup.preview")}
            </p>
            {complete ? (
              <ScheduleSummary schedule={next} retainCount={retention} />
            ) : (
              <p>{t("backup.chooseTime")}</p>
            )}
          </div>
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-destructive">
            {save.error instanceof ApiError ? save.error.message : t("backup.saveError")}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!complete || save.isPending}>
            {t(save.isPending ? "backup.saving" : "backup.saveSchedule")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export function BackupScheduleCard({ status }: { status: BackupStatus }) {
  const [editing, setEditing] = useState(false);
  const { t, locale } = useI18n();
  const schedule = status.schedule ?? { mode: "interval", intervalDays: status.intervalDays };
  return (
    <Card className="gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
            <CalendarClock aria-hidden className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t("backup.scheduleTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("backup.scheduleDescription")}</p>
          </div>
        </div>
        {!editing && (
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="size-4" />
            {t("backup.editSchedule")}
          </Button>
        )}
      </div>
      {editing ? (
        <ScheduleEditor
          schedule={schedule}
          retainCount={status.retainCount}
          onClose={() => setEditing(false)}
        />
      ) : (
        <div className="grid items-start gap-5 rounded-xl border border-border bg-muted/35 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("backup.current")}</p>
            <ScheduleSummary schedule={schedule} retainCount={status.retainCount} />
          </div>
          <div className="space-y-2 sm:border-l sm:border-border sm:pl-5">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Clock3 aria-hidden className="size-3.5" />
              {t("backup.nextRun")}
            </p>
            {status.nextScheduledAt ? (
              <time dateTime={status.nextScheduledAt} className="text-sm font-medium">
                {formatNextBackup(
                  status.nextScheduledAt,
                  LOCALE_TAGS[locale],
                  schedule.mode === "interval" ? undefined : schedule.timeZone,
                )}
              </time>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
