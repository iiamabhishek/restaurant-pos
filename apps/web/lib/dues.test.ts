import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReminderLink, whatsappDigits } from "./dues.ts";

const base = { customerName: "Anna", phone: "+91 98765 43210", orderNumber: "A-102", balance: 700, balanceText: "₹700.00", restaurantName: "Spice Hut" };

test("builds a prefilled wa.me link with name, bill and amount, digits only", () => {
  const r = buildReminderLink(base);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.href.startsWith("https://wa.me/919876543210?text="));
  assert.match(r.message, /Anna/);
  assert.match(r.message, /A-102/);
  assert.match(r.message, /₹700\.00/);
  assert.match(r.message, /Spice Hut/);
  assert.equal(decodeURIComponent(r.href.split("text=")[1]), r.message);
});

test("a missing, blank or invalid phone gives a reason, not a link", () => {
  for (const phone of [null, "", "   "]) {
    const r = buildReminderLink({ ...base, phone });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /no phone/);
  }
  for (const phone of ["12345", "abc", "+1 (23)", "1234567890123456"]) {
    const r = buildReminderLink({ ...base, phone });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /valid/);
  }
});

test("a bill with nothing owed has no reminder", () => {
  assert.equal(buildReminderLink({ ...base, balance: 0 }).ok, false);
});

test("a nameless customer is still greeted, and the message is safely encoded", () => {
  const r = buildReminderLink({ ...base, customerName: null, restaurantName: "A & B's" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.message, /Hello there/);
  assert.ok(!r.href.includes("&B"));
});

test("accepts valid international numbers", () => {
  assert.equal(whatsappDigits("+44 20 7946 0958"), "442079460958");
  assert.equal(whatsappDigits("+1 (415) 555-0132"), "14155550132");
});
