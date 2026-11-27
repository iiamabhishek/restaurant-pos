import type { BackupSchedule } from "@nodedr-restaurant/types";

interface ScheduleDraft {
  mode: BackupSchedule["mode"];
  time: string;
  timeZone: string;
  weekday: number;
  dayOfMonth: number;
  intervalDays: number;
}

export function createScheduleDraft(schedule: BackupSchedule, localZone: string): ScheduleDraft {
  return {
    time: "03:00",
    timeZone: localZone,
    weekday: 0,
    dayOfMonth: 1,
    intervalDays: 3,
    ...schedule,
  };
}

export function scheduleFromDraft(draft: ScheduleDraft): BackupSchedule {
  const { mode, intervalDays, time, timeZone, weekday, dayOfMonth } = draft;
  switch (mode) {
    case "interval":
      return { mode, intervalDays };
    case "daily":
      return { mode, time, timeZone };
    case "weekly":
      return { mode, weekday, time, timeZone };
    case "monthly":
      return { mode, dayOfMonth, time, timeZone };
  }
}

export function formatNextBackup(instant: string, locale: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    hourCycle: "h23",
  };
  const date = new Date(instant);
  try {
    return date.toLocaleString(locale, { ...options, timeZone });
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return date.toLocaleString(locale, { ...options, timeZone: "UTC" });
  }
}

export function scheduleTimeZoneName(timeZone: string, locale: string): string {
  try {
    const format = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "longGeneric" });
    return format.formatToParts().find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return timeZone;
  }
}
