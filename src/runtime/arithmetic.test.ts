import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { key } from "./expr.js";
import { seededStore } from "./seed.js";

// The seed alone: operator words and marks in the function-word lexicon, the bridge from a
// question about a computation to Arithmetic, and the realizations.
const store = seededStore();
const session = () => createSession(store, mkdtempSync(join(tmpdir(), "noodle-arith-")));

test("questions about a computation are answered by working it out", async () => {
  const s = session();
  const cases: [string, string][] = [
    ["what is 17 times 23?", "17 times 23 is 391."],
    ["what is 2 + 2?", "2 plus 2 is 4."],
    ["what is 2+2", "2 plus 2 is 4."],
    ["what's 15% of 80", "15% of 80 is 12."],
    ["what is 20 percent of 50", "20% of 50 is 10."],
    ["how much is 12 divided by 4", "12 divided by 4 is 3."],
    ["what is 100 / 8", "100 divided by 8 is 12.5."],
    ["what's 3.5 times 2", "3.5 times 2 is 7."],
    ["what is 7 minus 10", "7 minus 10 is -3."],
    ["what is 5 squared", "5 squared is 25."],
    ["what's 2^10", "2 to the power of 10 is 1024."],
    ["what is two plus three", "2 plus 3 is 5."],
    ["what is the square root of 81", "The square root of 81 is 9."],
    ["what is the cube root of 27", "The cube root of 27 is 3."],
    ["what is the remainder of 17 divided by 5", "17 mod 5 is 2."],
  ];
  for (const [ask, answer] of cases) assert.equal((await s.turn(ask)).text, answer, ask);
});

test("a computation said on its own is worked out too", async () => {
  const s = session();
  assert.equal((await s.turn("17 * 23")).text, "17 times 23 is 391.");
  assert.equal((await s.turn("square root of 81")).text, "The square root of 81 is 9.");
});

test("what cannot be worked out is said, not guessed", async () => {
  const s = session();
  assert.equal((await s.turn("what is 10 divided by 0")).text, "I couldn't work out 10 divided by 0: division by zero.");
});

test("operator words between things that are not numbers are not arithmetic", async () => {
  const s = session();
  for (const said of ["I have two times this week", "plus the readme", "add the readme plus the license", "it took two times as long"]) {
    const r = await s.turn(said, { dry: true });
    assert.ok(!r.record.lf.some((x) => key(x).includes("Arithmetic(")), `${said}: ${r.record.lf.map(key).join("; ")}`);
  }
});
