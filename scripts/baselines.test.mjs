import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, slotFill } from "./baselines/lib/slots.mjs";
import { parseAct, parseArgs, proposeArgs } from "./label.mjs";
import * as D from "./decide.mjs";

const meta = { repo: { branch: "main", refs: { "refs/heads/main": "a", "refs/heads/feat/login": "b", "refs/remotes/origin/fix-typo": "c", "refs/remotes/origin/HEAD": "a" }, remotes: { origin: "x" } } };

test("the slot filler finds typed values by shape and by the fixture's names", () => {
  const found = extract('merge fix-typo, see #152 and https://github.com/a/b/pull/3; commit src/a.ts with "fix the typo"', { meta, names: { branches: new Set(["main", "fix-typo"]), remotes: new Set(["origin"]) } });
  assert.deepEqual(found.map((x) => [x.kind, x.value]), [["branch", "fix-typo"], ["number", 152], ["url", "https://github.com/a/b/pull/3"], ["path", "src/a.ts"], ["message", "fix the typo"]]);
});

test("acts take their kinds; a needed kind comes from the turns before; paths must be in the workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "slots-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "");
  const acts = slotFill(["git merge", "git commit", "gh pr-view", "read"], {
    text: 'merge it, commit src/a.ts and src/b.ts with "fix the typo", then show me pr 7',
    root,
    meta,
    turns: [{ role: "assistant", text: "Pushed to feat/login." }, { role: "user", text: "ok" }],
  });
  assert.deepEqual(acts, [
    { program: "git", argv: ["merge", "feat/login"] },
    { program: "git", argv: ["commit", "src/a.ts", "-m", "fix the typo"] },
    { program: "gh", argv: ["pr", "view", "7"] },
    { sub: "read", argv: [], files: ["src/a.ts"] },
  ]);
});

test("a filled act scores against typed gold by the mapping", () => {
  const [merge] = slotFill(["git merge"], { text: "merge feat/login", meta });
  assert.equal(D.sameAct({ program: "git", sub: "merge", branch: "feat/login", flags: [] }, merge).ok, true);
  const [commit] = slotFill(["git commit"], { text: 'commit with "fix the typo"', meta });
  assert.equal(D.sameAct(parseAct('git commit message="fix the typo"'), commit).ok, true);
  assert.equal(D.sameAct(parseAct('git commit message="something else"'), commit).ok, false);
  assert.equal(D.sameAct(parseAct("git commit message=answers-request"), commit).ok, true);
});

test("the labeller proposes typed arguments from the request text, and they parse back", () => {
  const proposed = proposeArgs({ program: "git", sub: "merge" }, "merge feat/login into this", meta);
  assert.equal(proposed, "branch=feat/login");
  assert.deepEqual(parseArgs(proposed), { branch: "feat/login" });
  assert.equal(proposeArgs({ program: "gh", sub: "pr-view" }, "what did they say on PR #152", meta), "number=152");
  assert.deepEqual(parseArgs(proposeArgs({ program: "git", sub: "commit" }, 'commit a.ts with "fix it"', meta)), { files: ["a.ts"], message: { text: "fix it", constraints: [] } });
  assert.deepEqual(parseAct("gh pr-view number=152 url=https://x.y/1"), { program: "gh", sub: "pr-view", number: 152, url: "https://x.y/1", flags: [] });
  assert.throws(() => parseArgs("colour=blue"));
  assert.throws(() => parseArgs("number=seven"));
});

test("the decide baselines are modules with a name, a role and predict", async () => {
  for (const f of ["name-match", "trained-knn", "trained-classifier", "trained-classifier-man", "trained-classifier-man-wn"]) {
    const b = (await import(`./baselines/${f}.mjs`)).default;
    assert.equal(typeof b.name, "string");
    assert.ok(["name-match", "trained"].includes(b.role));
    assert.equal(typeof b.predict, "function");
  }
});
