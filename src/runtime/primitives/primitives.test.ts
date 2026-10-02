import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { b, c, isCall, key, n, positional, role, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { World } from "../primitive.js";
import { Store } from "../store.js";
import { PRIMITIVES } from "./index.js";

function tmp(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "noodle-prim-")));
}

function worldAt(root: string, extra: Partial<World> = {}): World & { said: Expr[]; asked: Expr[] } {
  const said: Expr[] = [];
  const asked: Expr[] = [];
  return { root, store: new Store(), now: () => new Date("2026-01-02T03:04:05Z"), say: (d) => said.push(d), ask: (q) => asked.push(q), said, asked, ...extra };
}

const prim = (name: string) => {
  const p = PRIMITIVES.get(name);
  assert.ok(p, name);
  return p;
};
const run = (world: World, name: string, ...args: Expr[]) => prim(name).run(args, world);
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" } });
const repo = () => {
  const root = tmp();
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "commit.gpgsign", "false");
  return root;
};
const blockText = (world: World, e: Expr | undefined) => {
  assert.ok(isCall(e));
  const id = positional(e)[0];
  assert.equal(id.kind, "string");
  return world.store.block((id as { value: string }).value)!.body;
};

test("the registry holds exactly the experiment's primitives", () => {
  assert.deepEqual([...PRIMITIVES.keys()].sort(), ["Arithmetic", "Ask", "Compare", "Contains", "Count", "Edit", "Filter", "Now", "Rank", "Read", "Remember", "Remove", "Run", "Say", "Schedule", "Sort", "Store", "Write"]);
});

test("Read a file keeps its content as a block with a media type", async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "a.md"), "# hi\n");
  const w = worldAt(root);
  const r = await run(w, "Read", s("a.md"));
  assert.ok(isCall(r) && r.head === "File");
  assert.deepEqual(role(r, "media"), s("text/markdown"));
  assert.equal(blockText(w, role(r, "content")), "# hi\n");
  assert.equal(await prim("Read").check!([s("a.md")], r, w), true);
});

test("Read a directory lists its entries by name", async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "b.txt"), "x");
  fs.writeFileSync(path.join(root, "a.txt"), "y");
  const r = await run(worldAt(root), "Read", s("."));
  assert.ok(isCall(r) && r.head === "Directory");
  assert.deepEqual(
    positional(r),
    [c("Entry", s("a.txt"), ["kind", c("File")]), c("Entry", s("b.txt"), ["kind", c("File")]), c("Entry", s("sub"), ["kind", c("Directory")])],
  );
  assert.deepEqual(await run(worldAt(root), "Count", r), n(3));
});

test("Read of a missing path says so", async () => {
  await assert.rejects(run(worldAt(tmp()), "Read", s("nope.txt")), /no such file/);
});

test("paths that leave the root are refused, including through symlinks", async () => {
  const root = tmp();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, "secret"), "s");
  fs.symlinkSync(outside, path.join(root, "link"));
  fs.symlinkSync(path.join(outside, "secret"), path.join(root, "file-link"));
  const w = worldAt(root);
  await assert.rejects(run(w, "Read", s("../x")), /escapes/);
  await assert.rejects(run(w, "Read", s(path.join(outside, "secret"))), /escapes/);
  await assert.rejects(run(w, "Read", s("link/secret")), /escapes/);
  await assert.rejects(run(w, "Read", s("file-link")), /escapes/);
  await assert.rejects(run(w, "Write", s("link/new"), s("x")), /escapes/);
  await assert.rejects(run(w, "Write", s("file-link"), s("x")), /escapes/);
  await assert.rejects(run(w, "Edit", s("file-link"), c("Inserted", s("x"))), /escapes/);
  await assert.rejects(run(w, "Contains", s("link"), s("secret")), /escapes/);
  assert.equal(fs.readFileSync(path.join(outside, "secret"), "utf8"), "s");
});

test("Write a new file: ChangesLocal, check passes, inverse removes it", async () => {
  const root = tmp();
  const w = worldAt(root);
  const args = [s("dir/new.txt"), s("hello")];
  assert.deepEqual(prim("Write").effects(args, w), ["ChangesLocal"]);
  const r = await prim("Write").run(args, w);
  assert.equal(fs.readFileSync(path.join(root, "dir/new.txt"), "utf8"), "hello");
  assert.equal(await prim("Write").check!(args, r, w), true);
  assert.deepEqual(await prim("Write").inverse!(args, r, w), c("Remove", s("dir"), s("new.txt")));
  fs.writeFileSync(path.join(root, "dir/new.txt"), "changed");
  assert.equal(await prim("Write").check!(args, r, w), false);
});

test("Write over a file outside git is Deletes, and the inverse restores the old content", async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "f.txt"), "old");
  const w = worldAt(root);
  const args = [s("f.txt"), s("new")];
  assert.deepEqual(prim("Write").effects(args, w), ["Deletes"]);
  const r = await prim("Write").run(args, w);
  assert.equal(fs.readFileSync(path.join(root, "f.txt"), "utf8"), "new");
  const inv = await prim("Write").inverse!(args, r, w);
  assert.ok(isCall(inv) && inv.head === "Write");
  await run(w, "Write", ...positional(inv));
  assert.equal(fs.readFileSync(path.join(root, "f.txt"), "utf8"), "old");
});

test("Write over a git file is Deletes only when its content is not saved", async () => {
  const root = repo();
  const w = worldAt(root);
  fs.writeFileSync(path.join(root, "tracked.txt"), "v1");
  fs.writeFileSync(path.join(root, "other.txt"), "o");
  sh(root, "add", ".");
  sh(root, "commit", "-q", "-m", "one");
  assert.deepEqual(prim("Write").effects([s("tracked.txt"), s("v2")], w), ["ChangesLocal"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "uncommitted");
  assert.deepEqual(prim("Write").effects([s("tracked.txt"), s("v2")], w), ["Deletes"]);
  assert.deepEqual(prim("Write").effects([s("tracked.txt"), s("uncommitted")], w), ["ChangesLocal"]);
  fs.writeFileSync(path.join(root, "untracked.txt"), "u");
  assert.deepEqual(prim("Write").effects([s("untracked.txt"), s("v2")], w), ["Deletes"]);
  assert.deepEqual(prim("Write").effects([s("other.txt"), s("v2")], w), ["ChangesLocal"]);
});

test("Write takes content from a block", async () => {
  const root = tmp();
  const w = worldAt(root);
  const blk = w.store.addBlock("from a block", "text/plain", c("Self"));
  await run(w, "Write", s("x.txt"), c("Block", s(blk.id)));
  assert.equal(fs.readFileSync(path.join(root, "x.txt"), "utf8"), "from a block");
  await assert.rejects(run(w, "Write", s("y.txt"), c("Block", s("b_missing"))), /no content block/);
});

test("Edit: Replace, Inserted and Withdrawn, each checked and undone", async () => {
  const root = tmp();
  const f = path.join(root, "e.txt");
  const w = worldAt(root);
  const original = "one two three\n";
  fs.writeFileSync(f, original);
  const undo = async (args: Expr[], r: Expr) => {
    const inv = await prim("Edit").inverse!(args, r, w);
    assert.ok(isCall(inv));
    await run(w, inv.head, ...positional(inv));
    assert.equal(fs.readFileSync(f, "utf8"), original);
    return inv;
  };
  for (const [change, expected, reverseHead] of [
    [c("Replace", ["old", s("two")], ["new", s("2")]), "one 2 three\n", "Edit"],
    [c("Inserted", s("four\n")), "one two three\nfour\n", "Edit"],
    [c("Withdrawn", s("two ")), "one three\n", "Write"],
  ] as [Expr, string, string][]) {
    const args = [s("e.txt"), change];
    const r = await prim("Edit").run(args, w);
    assert.equal(fs.readFileSync(f, "utf8"), expected);
    assert.equal(await prim("Edit").check!(args, r, w), true);
    const inv = await undo(args, r);
    assert.equal(isCall(inv) && inv.head, reverseHead);
  }
});

test("Edit refuses an old text that is not exactly once, and an inverse falls back to the old content", async () => {
  const root = tmp();
  const f = path.join(root, "e.txt");
  const w = worldAt(root);
  fs.writeFileSync(f, "a b a");
  await assert.rejects(run(w, "Edit", s("e.txt"), c("Replace", ["old", s("a")], ["new", s("x")])), /more than once/);
  await assert.rejects(run(w, "Edit", s("e.txt"), c("Replace", ["old", s("z")], ["new", s("x")])), /does not occur/);
  await assert.rejects(run(w, "Edit", s("e.txt"), c("Withdrawn", s("z"))), /does not occur/);
  assert.equal(fs.readFileSync(f, "utf8"), "a b a");
  // The new text also occurs elsewhere after the edit, so the reverse Replace would be ambiguous.
  const args = [s("e.txt"), c("Replace", ["old", s("b")], ["new", s("a")])];
  const r = await prim("Edit").run(args, w);
  const inv = await prim("Edit").inverse!(args, r, w);
  assert.ok(isCall(inv) && inv.head === "Write");
  await run(w, "Write", ...positional(inv));
  assert.equal(fs.readFileSync(f, "utf8"), "a b a");
});

test("Run passes arguments literally and never through a shell", async () => {
  const root = tmp();
  const w = worldAt(root);
  fs.writeFileSync(path.join(root, "x"), "keep");
  const args = c("Args", s("-e"), s("console.log(process.argv.slice(1).join('|'))"), s("; rm -rf x"), s("$(echo hi)"), s("a b"));
  const r = await run(w, "Run", s("node"), args);
  assert.ok(isCall(r) && r.head === "Ran");
  assert.deepEqual(role(r, "exit"), n(0));
  assert.equal(blockText(w, role(r, "output")), "; rm -rf x|$(echo hi)|a b\n");
  assert.equal(fs.readFileSync(path.join(root, "x"), "utf8"), "keep");
  assert.equal(await prim("Run").check!([s("node"), args], r, w), true);
  assert.deepEqual(prim("Run").effects([s("node"), args], w), ["UnknownEffects"]);
  assert.equal(prim("Run").inverse, undefined);
});

test("Run reports a failing exit, starts in the root, and honours the program grant and the timeout", async () => {
  const root = tmp();
  const w = worldAt(root, { programs: new Set(["node"]) });
  const fail = await run(w, "Run", s("node"), c("Args", s("-e"), s("console.error('bad'); process.exit(3)")));
  assert.deepEqual(role(fail, "exit"), n(3));
  assert.equal(blockText(w, role(fail, "error")), "bad\n");
  assert.equal(await prim("Run").check!([], fail, w), false);
  const here = await run(w, "Run", s("node"), c("Args", s("-p"), s("process.cwd()")));
  assert.equal(blockText(w, role(here, "output")).trim(), root);
  await assert.rejects(run(w, "Run", s("git"), c("Args", s("--version"))), /not a program/);
  await assert.rejects(run(worldAt(root, { timeoutMs: 100 }), "Run", s("node"), c("Args", s("-e"), s("setTimeout(()=>{},5000)"))), /timed out/);
  await assert.rejects(run(worldAt(root), "Run", s("no-such-program-here"), c("Args")), /could not start/);
});

test("Say and Ask hand their expression to the channel and are not pure", async () => {
  const w = worldAt(tmp());
  const doc = c("Reply", s("hi"));
  assert.deepEqual(await run(w, "Say", doc), doc);
  assert.deepEqual(await run(w, "Ask", c("Question")), c("Question"));
  assert.deepEqual(w.said, [doc]);
  assert.deepEqual(w.asked, [c("Question")]);
  for (const name of ["Say", "Ask"]) {
    assert.equal(prim(name).pure, false);
    assert.deepEqual(prim(name).effects([], w), ["Speaks"]);
  }
});

test("Now reads the clock only through the world, as a moment in the user's time", async () => {
  const t = new Date(2026, 9, 1, 21, 5);
  assert.deepEqual(
    await run(worldAt(tmp(), { now: () => t }), "Now"),
    c("At", s(t.toISOString()), ["year", n(2026)], ["month", n(10)], ["day", n(1)], ["weekday", n(4)], ["hour", n(21)], ["minute", n(5)]),
  );
});

test("Schedule keeps an act for a time it works out, and Read lists the schedule", async () => {
  const t = new Date(2026, 9, 1, 21, 5);
  let now = t;
  const w = worldAt(tmp(), { now: () => now });
  w.store.load(`Pack(name="units", version="0", from=Seed("test"))
Concept(Minute(), Lasts(60))
Concept(Day(), Lasts(86400))`);
  const act = c("Say", c("Quote", s("stretch")));
  // "in 10 minutes": that long from now; "tomorrow": a day after now.
  assert.deepEqual(prim("Schedule").effects([c("Minute", ["modifier", c("Number", s("10"))]), act], w), ["ChangesLocal"]);
  const r = await run(w, "Schedule", c("Minute", ["modifier", c("Number", s("10"))]), act);
  assert.equal(role(role(r, "at"), "minute")?.kind === "number" && (role(role(r, "at"), "minute") as { value: number }).value, 15);
  assert.deepEqual(role(r, "on"), n(0));
  assert.equal(await prim("Schedule").check!([], r, w), true);
  const r2 = await run(w, "Schedule", c("After", c("Now"), ["extent", c("Day")]), c("Say", c("Quote", s("call mom"))));
  assert.deepEqual(role(r2, "on"), n(1));
  // What it cannot work out as a time, or a time gone by, is not scheduled.
  assert.throws(() => prim("Schedule").effects([c("Mom"), act], w), /not a time/);
  assert.throws(() => prim("Schedule").effects([c("Before", c("Now"), ["extent", c("Day")]), act], w), /passed/);
  const list = await run(w, "Read", c("Schedule"));
  assert.deepEqual(positional(list as never).map((x) => key(positional(x as never)[0])), [key(act), key(c("Say", c("Quote", s("call mom"))))]);
  assert.deepEqual(positional(list as never).map((x) => role(x, "due")), [b(false), b(false)]);
  now = new Date(2026, 9, 1, 21, 20);
  assert.deepEqual(positional((await run(w, "Read", c("Schedule"))) as never).map((x) => role(x, "due")), [b(true), b(false)]);
});

test("Count, Filter, Sort and Rank over a set", async () => {
  const w = worldAt(tmp());
  const set = c("And", c("Entry", s("b"), ["kind", c("File")], ["size", n(2)]), c("Entry", s("a"), ["kind", c("Directory")], ["size", n(9)]), c("Entry", s("c"), ["kind", c("File")]));
  assert.deepEqual(await run(w, "Count", set), n(3));
  assert.deepEqual(await run(w, "Count", c("And")), n(0));
  const files = await run(w, "Filter", set, c("Entry", ["kind", c("File")]));
  assert.deepEqual(positional(files as never).map((e) => positional(e as never)[0]), [s("b"), s("c")]);
  const byName = await run(w, "Sort", set, c("Name"));
  assert.deepEqual(positional(byName as never).map((e) => positional(e as never)[0]), [s("a"), s("b"), s("c")]);
  const bySize = await run(w, "Sort", set, c("Role", s("size")));
  assert.deepEqual(positional(bySize as never).map((e) => positional(e as never)[0]), [s("b"), s("a"), s("c")]);
  const ranked = await run(w, "Rank", set, c("Role", s("size")));
  assert.deepEqual(positional(ranked as never).map((e) => positional(e as never)[0]), [s("a"), s("b"), s("c")]);
  const none = await run(w, "Filter", set, c("Not", c("Entry")));
  assert.deepEqual(await run(w, "Count", none), n(0));
});

test("Contains: directory entries, file text, and set members", async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "d"));
  fs.writeFileSync(path.join(root, "d", "f.txt"), "needle in hay");
  const w = worldAt(root);
  assert.deepEqual(await run(w, "Contains", s("d"), s("f.txt")), b(true));
  assert.deepEqual(await run(w, "Contains", s("d"), c("Entry", s("f.txt"))), b(true));
  assert.deepEqual(await run(w, "Contains", s("d"), s("g.txt")), b(false));
  assert.deepEqual(await run(w, "Contains", s("d/f.txt"), s("needle")), b(true));
  assert.deepEqual(await run(w, "Contains", s("d/f.txt"), s("thread")), b(false));
  assert.deepEqual(await run(w, "Contains", s("missing"), s("x")), b(false));
  assert.deepEqual(await run(w, "Contains", c("And", s("a"), s("b")), s("b")), b(true));
  assert.equal(prim("Contains").pure, true);
});

test("Compare: structural equality and numeric order", async () => {
  const w = worldAt(tmp());
  assert.deepEqual(await run(w, "Compare", c("X", ["a", n(1)], ["b", n(2)]), c("X", ["b", n(2)], ["a", n(1)]), c("Same")), b(true));
  assert.deepEqual(await run(w, "Compare", s("a"), s("b"), c("Same")), b(false));
  assert.deepEqual(await run(w, "Compare", n(1), n(2), c("Order")), n(-1));
  assert.deepEqual(await run(w, "Compare", n(2), n(2), c("Order")), n(0));
  assert.deepEqual(await run(w, "Compare", n(3), n(2)), n(1));
  await assert.rejects(run(w, "Compare", s("a"), s("b"), c("Order")), /numbers/);
});

test("Read GitStatus parses branch, upstream counts, changes, renames and untracked files", async () => {
  const root = repo();
  const w = worldAt(root);
  fs.writeFileSync(path.join(root, "a.txt"), "1");
  fs.writeFileSync(path.join(root, "old name.txt"), "a long enough body to be seen as a rename\n");
  sh(root, "add", ".");
  sh(root, "commit", "-q", "-m", "first");
  const clean = await run(w, "Read", c("GitStatus"));
  assert.deepEqual(role(clean, "branch"), s("main"));
  assert.equal(role(clean, "upstream"), undefined);
  assert.deepEqual(await run(w, "Count", clean), n(0));

  fs.writeFileSync(path.join(root, "a.txt"), "2");
  fs.writeFileSync(path.join(root, "new.txt"), "n");
  fs.writeFileSync(path.join(root, "un tracked.txt"), "u");
  sh(root, "add", "new.txt");
  sh(root, "mv", "old name.txt", "renamed.txt");
  const st = await run(w, "Read", c("GitStatus"));
  assert.ok(isCall(st));
  const items = positional(st);
  assert.ok(items.some((e) => JSON.stringify(e) === JSON.stringify(c("Changed", s("a.txt"), ["index", s(".")], ["tree", s("M")]))));
  assert.ok(items.some((e) => JSON.stringify(e) === JSON.stringify(c("Changed", s("new.txt"), ["index", s("A")], ["tree", s(".")]))));
  assert.ok(items.some((e) => JSON.stringify(e) === JSON.stringify(c("Changed", s("renamed.txt"), ["index", s("R")], ["tree", s(".")], ["from", s("old name.txt")]))));
  assert.ok(items.some((e) => JSON.stringify(e) === JSON.stringify(c("Untracked", s("un tracked.txt")))));
  assert.deepEqual(await run(w, "Count", st), n(4));

  // With a local remote: upstream, ahead and behind.
  const remote = tmp();
  sh(remote, "init", "-q", "--bare", "-b", "main");
  sh(root, "add", ".");
  sh(root, "commit", "-q", "-m", "second");
  sh(root, "remote", "add", "origin", remote);
  sh(root, "push", "-q", "-u", "origin", "main");
  fs.writeFileSync(path.join(root, "z.txt"), "z");
  sh(root, "add", ".");
  sh(root, "commit", "-q", "-m", "third");
  const ahead = await run(w, "Read", c("GitStatus"));
  assert.deepEqual(role(ahead, "upstream"), s("origin/main"));
  assert.deepEqual(role(ahead, "ahead"), n(1));
  assert.deepEqual(role(ahead, "behind"), n(0));
});

test("Read GitLog and GitBranches on a real repository", async () => {
  const root = repo();
  const w = worldAt(root);
  assert.deepEqual(await run(w, "Read", c("GitLog", n(5))), c("GitLog"));
  fs.writeFileSync(path.join(root, "a"), "1");
  sh(root, "add", ".");
  sh(root, "commit", "-q", "-m", "first; with | odd chars");
  fs.writeFileSync(path.join(root, "a"), "2");
  sh(root, "commit", "-q", "-a", "-m", "second");
  const log = await run(w, "Read", c("GitLog", n(5)));
  const commits = positional(log as never);
  assert.equal(commits.length, 2);
  assert.deepEqual(role(commits[0], "subject"), s("second"));
  assert.deepEqual(role(commits[1], "subject"), s("first; with | odd chars"));
  assert.deepEqual(role(commits[1], "parents"), c("And"));
  const second = role(commits[0], "parents") as never;
  assert.deepEqual(positional(second), [role(commits[1], "hash")]);
  assert.deepEqual(role(commits[0], "author"), s("T"));
  assert.match((role(commits[0], "date") as { value: string }).value, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(await run(w, "Count", await run(w, "Read", c("GitLog", n(1)))), n(1));
  await assert.rejects(run(w, "Read", c("GitLog")), /count/);

  sh(root, "branch", "feature/x");
  const remote = tmp();
  sh(remote, "init", "-q", "--bare", "-b", "main");
  sh(root, "remote", "add", "origin", remote);
  sh(root, "push", "-q", "-u", "origin", "main");
  const branches = await run(w, "Read", c("GitBranches"));
  assert.deepEqual(positional(branches as never), [
    c("GitBranch", s("feature/x"), ["current", b(false)], ["remote", b(false)]),
    c("GitBranch", s("main"), ["current", b(true)], ["remote", b(false)], ["upstream", s("origin/main")]),
    c("GitBranch", s("origin/main"), ["current", b(false)], ["remote", b(true)]),
  ]);
});

test("Read of git state outside a repository says so", async () => {
  await assert.rejects(run(worldAt(tmp()), "Read", c("GitStatus")), /git status failed/);
});
