import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createScheduleDraft,
  scheduleFromDraft,
  formatNextBackup,
  scheduleTimeZoneName,
} from "./backup-schedule.ts";

test("a saved weekly schedule reopens with its own timezone and Sunday", () => {
  const saved = { mode: "weekly", weekday: 0, time: "03:00", timeZone: "America/Sao_Paulo" } as const;
  const draft = createScheduleDraft(saved, "Asia/Tokyo");
  assert.deepEqual(scheduleFromDraft(draft), saved);
  assert.deepEqual(scheduleFromDraft({ ...draft, mode: "daily" }), {
    mode: "daily",
    time: "03:00",
    timeZone: "America/Sao_Paulo",
  });
});

test("a legacy interval stays relative and a calendar draft starts in the operator's zone", () => {
  const saved = { mode: "interval", intervalDays: 5 } as const;
  const draft = createScheduleDraft(saved, "America/Bahia");
  assert.deepEqual(scheduleFromDraft(draft), saved);
  assert.deepEqual(scheduleFromDraft({ ...draft, mode: "monthly", dayOfMonth: 31, time: "23:17" }), {
    mode: "monthly",
    dayOfMonth: 31,
    time: "23:17",
    timeZone: "America/Bahia",
  });
});

test("the confirmed run is displayed on its local date even across midnight UTC", () => {
  const result = formatNextBackup("2026-11-30T01:45:00.000Z", "pt-BR", "America/Sao_Paulo");
  assert.match(result, /29/);
  assert.match(result, /22:45/);
});

test("an IANA zone newer than the browser falls back to an explicitly UTC timestamp", () => {
  const result = formatNextBackup("2026-11-30T01:45:00.000Z", "en-GB", "Unknown/Zone");
  assert.match(result, /30/);
  assert.match(result, /01:45/);
  assert.match(result, /UTC|GMT/);
});

test("the Portuguese summary gives the operator the local name for the São Paulo zone", () => {
  assert.match(scheduleTimeZoneName("America/Sao_Paulo", "pt-BR"), /horário.*brasília/i);
});

test("the summary preserves the saved identifier if this browser does not know the zone", () => {
  assert.equal(scheduleTimeZoneName("Unknown/Zone", "pt-BR"), "Unknown/Zone");
});
