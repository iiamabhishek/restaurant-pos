import { DateTime } from 'luxon';
import type { BackupSchedule } from '@nodedr-restaurant/types';

type CalendarSchedule = Exclude<BackupSchedule, { mode: 'interval' }>;

// Luxon moves nonexistent local times forward by the length of the DST gap.
// Pick the first instant of a repeated local time, even if today is on the
// other side of the offset change.
export function nextCalendarOccurrence(
  schedule: CalendarSchedule,
  after: Date,
): Date {
  const local = DateTime.fromJSDate(after, { zone: schedule.timeZone });
  const [hour, minute] = schedule.time.split(':').map(Number);

  function occurrence(date: DateTime): Date {
    const day =
      schedule.mode === 'monthly'
        ? Math.min(schedule.dayOfMonth, date.daysInMonth!)
        : date.day;
    const at = date.set({ day, hour, minute, second: 0, millisecond: 0 });
    return new Date(
      Math.min(...at.getPossibleOffsets().map((dt) => dt.toMillis())),
    );
  }

  let date = local;
  if (schedule.mode === 'weekly') {
    date = local.plus({ days: (schedule.weekday - local.weekday + 7) % 7 });
  }
  const candidate = occurrence(date);
  if (candidate > after) return candidate;
  if (schedule.mode === 'monthly') return occurrence(date.plus({ months: 1 }));
  return occurrence(date.plus({ days: schedule.mode === 'weekly' ? 7 : 1 }));
}

// Manual or scheduled VERIFIED backups reset the legacy elapsed-day interval.
// A failed attempt retries after an hour. While a run is pending the UI
// projects the normal interval. The worker checks its lease before retrying.
export function nextIntervalOccurrence(
  days: number,
  lastVerifiedAt: Date | null,
  lastAttempt: {
    status: 'PENDING' | 'VERIFIED' | 'FAILED';
    createdAt: Date;
  } | null,
): Date | null {
  const hour = 60 * 60 * 1000;
  const interval = days * 24 * hour;
  const verifiedDue = lastVerifiedAt
    ? lastVerifiedAt.getTime() + interval
    : null;
  if (!lastAttempt || lastAttempt.status === 'VERIFIED')
    return verifiedDue === null ? null : new Date(verifiedDue);
  const retryDue =
    lastAttempt.createdAt.getTime() +
    (lastAttempt.status === 'FAILED' ? hour : interval);
  return new Date(Math.max(retryDue, verifiedDue ?? retryDue));
}
