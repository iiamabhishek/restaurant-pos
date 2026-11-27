import { setBackupScheduleSchema } from '@nodedr-restaurant/types';
import { nextCalendarOccurrence } from './backup-schedule';

const daily = {
  mode: 'daily',
  time: '02:30',
  timeZone: 'America/New_York',
} as const;
const monthly = {
  mode: 'monthly',
  dayOfMonth: 31,
  time: '23:55',
  timeZone: 'Asia/Kathmandu',
} as const;

describe('backup schedule', () => {
  it.each([
    [
      'gap moves forward by one hour',
      daily,
      '2026-03-08T05:00:00Z',
      '2026-03-08T07:30:00.000Z',
    ],
    [
      'first occurrence of a repeated hour',
      { ...daily, time: '01:30' },
      '2026-11-01T04:00:00Z',
      '2026-11-01T05:30:00.000Z',
    ],
    [
      'no second run in a repeated hour',
      { ...daily, time: '01:30' },
      '2026-11-01T05:30:00Z',
      '2026-11-02T06:30:00.000Z',
    ],
    [
      'Sunday in the selected timezone',
      { ...daily, mode: 'weekly', weekday: 0 },
      '2026-05-03T06:30:01Z',
      '2026-05-10T06:30:00.000Z',
    ],
    [
      'February in a leap year',
      monthly,
      '2028-02-01T00:00:00Z',
      '2028-02-29T18:10:00.000Z',
    ],
    [
      'February in a normal year',
      monthly,
      '2027-01-31T18:10:00Z',
      '2027-02-28T18:10:00.000Z',
    ],
    [
      '31st after a shorter month',
      monthly,
      '2027-02-28T18:10:00Z',
      '2027-03-31T18:10:00.000Z',
    ],
  ] as const)('%s', (_name, schedule, after, expected) => {
    expect(
      nextCalendarOccurrence(schedule, new Date(after)).toISOString(),
    ).toBe(expected);
  });

  it.each([
    { ...daily, time: '9:30' },
    { ...daily, time: '24:00' },
    { ...daily, timeZone: 'Mars/Olympus' },
    { ...daily, timeZone: '+03:00' },
    { ...daily, mode: 'weekly', weekday: 7 },
    { ...monthly, dayOfMonth: 0 },
    { mode: 'interval', intervalDays: 31 },
  ])('rejects an invalid schedule %j', (schedule) => {
    expect(
      setBackupScheduleSchema.safeParse({ schedule, retainCount: 2 }).success,
    ).toBe(false);
  });

  it('requires a retention count from 1 to 10', () => {
    expect(
      setBackupScheduleSchema.safeParse({ schedule: daily, retainCount: 11 })
        .success,
    ).toBe(false);
    expect(
      setBackupScheduleSchema.safeParse({ schedule: daily, retainCount: 10 })
        .success,
    ).toBe(true);
  });
});
