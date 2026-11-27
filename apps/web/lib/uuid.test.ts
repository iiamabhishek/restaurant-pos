import assert from "node:assert/strict";
import { test } from "node:test";
import { uuid } from "./uuid.ts";

test("creates a fresh v4 order key when only getRandomValues is available", (t) => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  t.mock.getter(globalThis, "crypto", () => ({ getRandomValues }));

  const first = uuid();
  const second = uuid();
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(first, v4);
  assert.match(second, v4);
  assert.notEqual(first, second);
});
