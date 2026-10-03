// The deciding run's machinery, on invented gold, captures and a frozen manifest in temporary
// directories (no network; nothing in ~/.noodle is read or written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as D from "./decide.mjs";
import { freeze } from "./freeze.mjs";

const repo = join(import.meta.dirname, "..");
const { c } = await import(join(repo, "dist", "runtime", "expr.js"));
const s = (value) => ({ kind: "string", value, pos: { line: 0, column: 0 } });
const run = (program, ...args) => c("Run", s(program), c("Args", ...args.map(s)));

test("the confirmatory set: captured after the freeze, labelled after capture, the latest label per id", () => {
  const caps = [
    { id: "old", at: "2026-11-30T00:00:00Z" },
    { id: "a", at: "2026-12-03T00:00:00Z", sessionId: "s1" },
    { id: "b", at: "2026-12-04T00:00:00Z" },
    { id: "n", at: "2026-12-05T00:00:00Z" },
  ];
  const gold = [
    { id: "old", class: "acts", labelledAt: "2026-12-10T00:00:00Z" },
    { id: "a", class: "none", labelledAt: "2026-12-10T00:00:00Z" },
    { id: "a", class: "acts", labelledAt: "2026-12-11T00:00:00Z" },
    { id: "b", class: "constraint", labelledAt: "2026-12-03T00:00:00Z" },
    { id: "n", class: "none", labelledAt: "2026-12-06T00:00:00Z" },
  ];
  const set = D.confirmatory(gold, caps, "2026-12-02T00:00:00Z");
  assert.deepEqual(set.real.map((g) => [g.id, g.conversation]), [["a", "s1"]]);
  assert.deepEqual(set.negative.map((g) => g.id), ["n"]);
});

test("refusals: nothing frozen, a differing system, n unset or not reached, a missing baseline", () => {
  const baselines = [{ role: "name-match" }, { role: "trained" }];
  const m = { preregistered: { n: 170 } };
  assert.deepEqual(D.refusals({ manifest: m, real: 170, baselines }), []);
  assert.ok(D.refusals({ manifest: m, real: 12, baselines }).includes("n is not reached: 12 of 170 real requests in the confirmatory set; 158 more needed"));
  assert.match(D.refusals({ manifest: { preregistered: null }, baselines }).join("\n"), /n is not set: the pilot/);
  assert.match(D.refusals({ baselines }).join("\n"), /no frozen system/);
  assert.match(D.refusals({ manifest: m, real: 170, baselines, differences: ["seed part core differs"] })[0], /differs from the frozen manifest: seed part core differs/);
  assert.equal(D.refusals({ manifest: m, real: 170, baselines: [] }).length, 2);
});

test("acts compare by the mapping: labels, arguments as a multiset, defaults optional, messages, order", () => {
  const defaults = D.defaultsOf({ repo: { branch: "feat/x", remotes: { origin: "git@x" } } });
  const commit = { program: "git", sub: "commit", files: ["src/a.ts", "src/b.ts"], flags: [], message: { constraints: ["answers-request"] } };
  const push = { program: "git", sub: "push", remote: "origin", branch: "feat/x", flags: [] };
  const sys = [D.sysAct(run("git", "commit", "-m", "Fix a and b", "./src/b.ts", "src/a.ts")), D.sysAct(run("git", "push"))];
  const r = D.scoreItem({ acts: [commit, push] }, { acts: sys }, defaults);
  assert.deepEqual(r, { label: true, end: true, unchecked: ["answers-request"] });
  // No message where the gold wants one; a wrong file; the wrong order; too many acts.
  assert.equal(D.scoreItem({ acts: [commit] }, { acts: [D.sysAct(run("git", "commit", "src/a.ts", "src/b.ts"))] }, defaults).end, false);
  assert.equal(D.scoreItem({ acts: [commit] }, { acts: [D.sysAct(run("git", "commit", "-m", "x", "src/a.ts"))] }, defaults).end, false);
  assert.equal(D.scoreItem({ acts: [push, commit] }, { acts: sys }, defaults).label, false);
  assert.equal(D.scoreItem({ acts: [push, commit], order: "any" }, { acts: sys }, defaults).end, true);
  assert.equal(D.scoreItem({ acts: [push] }, { acts: sys }, defaults).label, false);
  // A pushed branch that is not the current one must be named.
  assert.equal(D.scoreItem({ acts: [{ ...push, branch: "main" }] }, { acts: [D.sysAct(run("git", "push"))] }, defaults).end, false);
  // Flags as a set; a two-word subcommand; pull requests on the label only; read by file.
  assert.equal(D.sameAct({ program: "git", sub: "log", flags: ["--oneline", "-5"] }, D.sysAct(run("git", "log", "-5", "--oneline"))).ok, true);
  assert.deepEqual(D.sameAct({ program: "gh", sub: "pr-create", flags: ["--draft"] }, D.sysAct(run("gh", "pr", "create"))), { ok: true, labelOnly: true });
  assert.equal(D.sameAct({ sub: "read", files: ["README.md"] }, D.sysAct(c("Read", s("./README.md")))).ok, true);
  // Asking or abstaining: no act is wrong.
  assert.deepEqual(D.scoreItem({ acts: [push] }, { acts: [] }, defaults), { label: false, end: false, unchecked: [] });
});

test("a constraint item: nothing runs and the rule is stored", () => {
  const gold = { class: "constraint", acts: [], constraints: [{ rule: "not", act: { program: "git", sub: "push" }, until: "told" }] };
  const echo = (until) => c("Echo", c("Constraint", c("Not", run("git", "push")), ...(until ? [["until", c("Told")]] : [])));
  assert.equal(D.scoreItem(gold, { acts: [], said: [echo(true)] }).end, true);
  assert.equal(D.scoreItem(gold, { acts: [], said: [echo(false)] }).end, false);
  assert.equal(D.scoreItem(gold, { acts: [D.sysAct(run("git", "push"))], said: [echo(true)] }).end, false);
});

test("coverage and confidence come from the winning readings' features and scores", () => {
  const record = { reasons: [{ what: 'reading of "x"', winner: 0, candidates: [{ features: [["WordsUsed", 3], ["WordsUsed:Skipped:Unknown", -1]], score: 2 }, { features: [], score: 0.5 }] }] };
  assert.equal(D.coverage(record), 0.75);
  assert.equal(D.confidence(record), 1.5);
});

test("statistics: Wilson, the exact binomial, Holm, a reproducible paired bootstrap", () => {
  const [lo, hi] = D.wilson(60, 100);
  assert.ok(Math.abs(lo - 0.502) < 0.001 && Math.abs(hi - 0.691) < 0.001);
  assert.ok(Math.abs(D.binomialP(7, 10, 0.5) - 0.171875) < 1e-9);
  assert.deepEqual(D.holm([0.01, 0.04, 0.03], 0.05), [true, false, false]);
  assert.deepEqual(D.holm([0.01, 0.02, 0.03], 0.05), [true, true, true]);
  const a = [1, 1, 0, 1];
  const b = [0, 1, 0, 0];
  assert.deepEqual(D.bootstrap(a, b, ["x", "x", "y", "z"], 50), D.bootstrap(a, b, ["x", "x", "y", "z"], 50));
});

test("the go rule: go only when every test passes, stop otherwise", () => {
  const n = 170;
  const clusters = Array.from({ length: n }, (_, i) => `c${Math.floor(i / 2)}`);
  const at = (share) => Array.from({ length: n }, (_, i) => i < share * n);
  const prereg = { floor: 0.6, margin: 0.1, alpha: 0.05 };
  const base = { nameMatch: at(0.3), trainedBaselines: { words: at(0.7), "words+wn": at(0.72) }, coverage: Array(n).fill(0.9), clusters, prereg, resamples: 2000 };
  const go = D.applyRules({ ...base, trained: at(0.8) });
  assert.equal(go.go, true);
  assert.match(go.tests[2].name, /words\+wn/);
  // Below the floor.
  assert.equal(D.applyRules({ ...base, trained: at(0.55), trainedBaselines: { words: at(0.5) } }).go, false);
  // Not better than name match by the margin.
  assert.equal(D.applyRules({ ...base, trained: at(0.8), nameMatch: at(0.75) }).go, false);
  // Worse than the best classifier by more than the margin.
  assert.equal(D.applyRules({ ...base, trained: at(0.8), trainedBaselines: { words: at(0.97) } }).go, false);
  // Wins from skipping, not understanding.
  const stop = D.applyRules({ ...base, trained: at(0.8), coverage: Array(n).fill(0.5) });
  assert.equal(stop.go, false);
  assert.equal(stop.tests[3].passed, false);
});

test("the sandbox restores a fixture from a clone, never touching the repository it came from", () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-repo-"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: dir, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...a) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" }).trim();
  git("init", "--quiet", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "--quiet", "-m", "one");
  writeFileSync(join(dir, "a.txt"), "two\n");
  const head = git("rev-parse", "HEAD");
  const work = git("stash", "create");
  git("update-ref", "refs/noodle/capture/cap_t/head", head);
  git("update-ref", "refs/noodle/capture/cap_t/work", work);
  git("remote", "add", "origin", "git@example.com:x/y.git");
  const before = git("for-each-ref");
  const meta = { id: "cap_t", repo: { parentRepo: dir, head, branch: "main", pins: { head: "x", work: "y" }, remotes: { origin: "git@example.com:x/y.git" }, untracked: { archived: false } } };
  const box = D.sandbox(meta, dir);
  assert.equal(box.restored, true);
  assert.equal(readFileSync(join(box.root, "a.txt"), "utf8"), "two\n");
  assert.equal(execFileSync("git", ["remote", "get-url", "origin"], { cwd: box.root, encoding: "utf8" }).trim(), join(box.dir, "remotes", "origin"));
  assert.equal(git("for-each-ref"), before);
  const none = D.sandbox({ id: "x", repo: null }, dir);
  assert.equal(none.restored, false);
  assert.ok(existsSync(none.root));
});

test("pnpm decide refuses on invented data, quoting the frozen rules and saying how many more are needed", () => {
  const root = mkdtempSync(join(tmpdir(), "decide-exp-"));
  const design = readFileSync(join(repo, "docs", "design.md"), "utf8");
  freeze({ id: "t1", root, commit: "0000000", repo, seedDir: join(repo, "seed"), packsDir: join(root, "none"), weightsText: "", confirmed: [], design, pilot: { n: 5, margin: 0.1, alpha: 0.05 }, now: new Date("2026-12-02T00:00:00Z") });
  mkdirSync(join(root, "capture"));
  writeFileSync(join(root, "capture", "2026-12.jsonl"), ["a", "b"].map((id, i) => JSON.stringify({ id, at: `2026-12-0${3 + i}T00:00:00Z`, prompt: "commit and push" })).join("\n") + "\n");
  writeFileSync(join(root, "gold.jsonl"), ["a", "b"].map((id) => JSON.stringify({ id, fixture: id, class: "acts", acts: [{ program: "git", sub: "push" }], labelledAt: "2026-12-09T00:00:00Z" })).join("\n") + "\n");
  let out = "";
  try {
    execFileSync(process.execPath, [join(repo, "scripts", "decide.mjs"), "--frozen", "t1"], { env: { ...process.env, NOODLE_EXPERIMENT: root }, encoding: "utf8", timeout: 60000 });
  } catch (e) {
    out = e.stdout;
    assert.equal(e.status, 1);
  }
  assert.match(out, /Pre-registered \(design section 29\):\n\n {2}- \*\*Go\*\*/);
  assert.match(out, /checked out \w+, frozen 0000000/);
  assert.match(out, /n is not reached: 2 of 5 real requests in the confirmatory set; 3 more needed/);
  assert.match(out, /confirmatory: 2 real requests/);
});

test("every arm hears each item as a dry run on the frozen stores, beside each baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "decide-arms-"));
  const design = readFileSync(join(repo, "docs", "design.md"), "utf8");
  freeze({ id: "t1", root, commit: "0000000", repo, seedDir: join(repo, "seed"), packsDir: join(root, "none"), weightsText: "", confirmed: ["k"], design, pilot: null });
  const F = await import(join(repo, "dist", "assistant", "frozen.js"));
  const { createSession } = await import(join(repo, "dist", "assistant", "index.js"));
  const sys = new F.FrozenSystem("t1", root);
  const items = [{ id: "x1", class: "acts", text: "push my branch", acts: [{ program: "git", sub: "push", flags: [] }], conversation: "s" }];
  const baseline = { name: "always push", role: "name-match", predict: async () => [{ program: "git", argv: ["push"] }] };
  const rows = await D.scoreAll({ sys, items, baselines: [baseline], root, createSession, inMemory: true });
  assert.deepEqual(Object.keys(rows[0].arms), D.ARM_NAMES);
  assert.equal(rows[0].restored, false);
  for (const arm of D.ARM_NAMES) assert.equal(typeof rows[0].arms[arm].end, "boolean", JSON.stringify(rows[0].arms[arm]));
  assert.ok(D.ARM_NAMES.every((arm) => !rows[0].arms[arm].error), JSON.stringify(rows[0].arms));
  assert.equal(rows[0].baselines["always push"].end, true);
});
