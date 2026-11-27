import { z } from "zod";

// Literal-string confirm, matching zulivio's restore safety gate exactly —
// a deliberate speed bump before the single most destructive action in
// this app (drops and recreates the entire shared Postgres instance).
export const restoreBackupSchema = z.object({
  confirm: z.literal("RESTORE"),
});
export type RestoreBackupDto = z.infer<typeof restoreBackupSchema>;

// Not @IsUrl-style strict URL validation on `endpoint` — deliberately a
// loose http(s):// prefix check (same reasoning as zulivio's
// SetBackupConfigDto): a real S3-compatible endpoint can be a bare IP with
// a port, and the actual validation that matters is the live connectivity
// probe `BackupService.setConfig()` performs before persisting anything.
export const setBackupConfigSchema = z.object({
  endpoint: z
    .string()
    .min(1)
    .regex(/^https?:\/\/.+/, "Endpoint must start with http:// or https://"),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  region: z.string().min(1).optional(),
  intervalDays: z.coerce.number().int().min(1).max(30).optional(),
  retainCount: z.coerce.number().int().min(1).max(10).optional(),
});
export type SetBackupConfigDto = z.infer<typeof setBackupConfigSchema>;

const backupTimeZone = z
  .string()
  .min(1)
  .refine((timeZone) => {
    // Some Intl implementations also accept raw offsets. Calendar schedules
    // use named zones so future offset changes follow the local clock.
    if (/^[+-]/.test(timeZone)) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone });
      return true;
    } catch {
      return false;
    }
  }, "Expected an IANA time zone");

const backupClock = {
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm"),
  timeZone: backupTimeZone,
};

export const backupScheduleSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("interval"),
    intervalDays: z.number().int().min(1).max(30),
  }),
  z.object({ mode: z.literal("daily"), ...backupClock }),
  z.object({
    mode: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
    ...backupClock,
  }),
  z.object({
    mode: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(31),
    ...backupClock,
  }),
]);
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

export const setBackupScheduleSchema = z.object({
  schedule: backupScheduleSchema,
  retainCount: z.number().int().min(1).max(10),
});
export type SetBackupScheduleDto = z.infer<typeof setBackupScheduleSchema>;
