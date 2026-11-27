import assert from "node:assert/strict";
import { test } from "node:test";
import { monthToDate } from "./report-dates.ts";

for (const { zone, instant, from, to } of [
  { zone: "America/Sao_Paulo", instant: "2026-11-26T01:30:00Z", from: "2026-11-01", to: "2026-11-25" },
  { zone: "Asia/Kolkata", instant: "2026-11-30T18:45:00Z", from: "2026-12-01", to: "2026-12-01" },
  { zone: "UTC", instant: "2028-02-29T12:00:00Z", from: "2028-02-01", to: "2028-02-29" },
]) {
  test(`month to date uses the local calendar in ${zone}`, () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      assert.deepEqual(monthToDate(new Date(instant)), { from, to });
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}
