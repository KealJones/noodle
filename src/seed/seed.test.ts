import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { check } from "./check.js";

const r = check(join(import.meta.dirname, "..", "..", "seed"));

test("every seed part parses and has entries", () => {
  for (const p of r.parts) assert.ok(p.entries > 0, p.file);
});

test("every seed entry is sourced from its own part", () => {
  assert.deepEqual(r.unsourced, []);
});

test("every name the seed uses is declared in the seed or structural", () => {
  assert.deepEqual([...r.undeclared.keys()], []);
});

test("the bridge names no domain command", () => {
  assert.deepEqual(r.domainInBridge, []);
});
