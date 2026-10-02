import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { seededStore } from "../runtime/seed.js";
import { learnTool } from "./tooldocs.js";

const hasDocs = (() => {
  try {
    execFileSync("man", ["-w", "git-push"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("a tool's documentation gives its commands' words a sense that runs them, offered first", { skip: !hasDocs && "no git man pages here" }, async () => {
  const store = seededStore();
  const world = { root: tmpdir(), store, now: () => new Date(), say() {}, ask() {} };
  const r = await learnTool("git", PRIMITIVES.get("Read")!, world, store);
  assert.ok(r.commands.includes("push") && r.commands.includes("status"));
  // "am" is a form of the protected "be": never given a learned reading.
  assert.ok(!r.commands.includes("am"));
  store.load(r.text);

  const repo = mkdtempSync(join(tmpdir(), "noodle-git-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.txt"), "hi\n");
  const s = createSession(store, repo);
  const offer = await s.turn("git status");
  assert.equal(offer.text, "I can run `git status`, but I don't know yet what it changes. Go ahead?");
  const ran = await s.turn("yes");
  assert.match(ran.text, /^```\ngit status\n```\n\n```\n[\s\S]*a\.txt[\s\S]*```$/);
  await s.turn("dont push yet");
  assert.equal((await s.turn("push")).text, "You said not to push yet. Do it now?");
});
