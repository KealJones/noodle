// The freeze, on invented packs, weights and pilot in a temporary experiment directory (nothing in
// ~/.noodle is read or written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freeze, quoteRules, summary } from "./freeze.mjs";

const repo = join(import.meta.dirname, "..");
const dist = join(repo, "dist");
const F = await import(join(dist, "assistant", "frozen.js"));
const design = readFileSync(join(repo, "docs", "design.md"), "utf8");

const DOC = 'Pack(name="tool-demo", version="local", from=ToolDoc("demo"))\n\nConcept(Demo(), Lemma("demo"))\n';
const IMPORT = 'Pack(\n  name="words-demo",\n  version="1",\n  from=Wordfreq("demo")\n)\n\nConcept(Zebrine(), Lemma("zebrine"))\n';
const WEIGHTS = 'Pack(name="learned-weights", version="1", from=Correction())\n\nFact(Feature(), Weight("WordsUsed:Demo", 2.5))\n';

function invented(pilot = { n: 5, margin: 0.1, alpha: 0.05, at: "2026-12-01" }) {
  const root = mkdtempSync(join(tmpdir(), "freeze-"));
  const packsDir = join(root, "packs-src");
  mkdirSync(packsDir);
  writeFileSync(join(packsDir, "tool-demo.ncon"), DOC);
  writeFileSync(join(packsDir, "words-demo.ncon"), IMPORT);
  const m = freeze({ id: "t1", root, commit: "abc1234def", repo, seedDir: join(repo, "seed"), packsDir, weightsText: WEIGHTS, confirmed: ["k2", "k1"], design, pilot, now: new Date("2026-12-02T00:00:00Z") });
  return { root, m };
}

test("the go and stop rules are quoted from design section 29, with the floor they state", () => {
  const r = quoteRules(design);
  assert.match(r.go, /^- \*\*Go\*\*, decided on \(b\), end state/);
  assert.match(r.go, /command-name match/);
  assert.equal(r.floor, 0.6);
  assert.equal(r.stop, "- **Stop**: otherwise. Go and stop are complements.");
});

test("freeze writes one unit: packs copied and classified, weights, confirmations, seed counts, pre-registration", () => {
  const { root, m } = invented();
  assert.equal(m.commit, "abc1234def");
  assert.deepEqual(m.packs.map((p) => [p.name, p.kind]), [["tool-demo", "documentation"], ["words-demo", "import"]]);
  assert.equal(m.weights.count, 1);
  assert.equal(m.confirmations.count, 2);
  assert.equal(m.seed.length, 8);
  assert.ok(m.seed.every((s) => s.entries > 0 && s.hash.length === 64));
  assert.deepEqual(m.preregistered, { n: 5, margin: 0.1, alpha: 0.05, floor: 0.6, from: "pilot.json, 2026-12-01" });
  assert.deepEqual(JSON.parse(readFileSync(join(root, "frozen", "t1", "freeze.json"), "utf8")), m);
  assert.deepEqual(F.differences(m, join(root, "frozen", "t1")), []);
  assert.throws(() => freeze({ id: "t1", root, commit: "x", repo, seedDir: join(repo, "seed"), packsDir: root, weightsText: WEIGHTS, confirmed: [], design, pilot: null }), /never overwritten/);
  const text = summary(m);
  assert.match(text, /# Frozen system t1/);
  assert.match(text, /n = 5 real requests/);
  assert.ok(!text.includes("—"));
});

test("without the pilot, n is not set", () => {
  assert.equal(invented(null).m.preregistered, null);
});

test("the frozen system refuses to start when anything differs from its manifest", () => {
  const { root, m } = invented();
  const dir = join(root, "frozen", "t1");
  assert.ok(new F.FrozenSystem("t1", root));
  writeFileSync(join(dir, "packs", "tool-demo.ncon"), DOC + "\nConcept(Other())\n");
  writeFileSync(join(dir, "packs", "stray.ncon"), IMPORT);
  writeFileSync(join(dir, "weights.ncon"), WEIGHTS.replace("2.5", "3"));
  writeFileSync(join(dir, "freeze.json"), JSON.stringify({ ...m, version: "0.0.1" }));
  const diff = F.differences({ ...m, version: "0.0.1" }, dir);
  assert.ok(diff.some((d) => /version is .*frozen 0.0.1/.test(d)));
  assert.ok(diff.includes("pack tool-demo.ncon differs"));
  assert.ok(diff.includes("pack stray.ncon is not in the manifest"));
  assert.ok(diff.includes("the weights (weights.ncon) differ"));
  assert.throws(() => new F.FrozenSystem("t1", root), /is not frozen system t1/);
  assert.throws(() => new F.FrozenSystem("nope", root), /no frozen system nope/);
});

test("the arms: A has the imports only, A+ the documentation too; seed weights unless trained", () => {
  const { root } = invented();
  const sys = new F.FrozenSystem("t1", root);
  const a = sys.arm("A", true);
  assert.ok(a.store.packNames().includes("words-demo"));
  assert.ok(!a.store.packNames().includes("tool-demo"));
  assert.equal(a.weights.learned.size, 0);
  const zero = sys.arm("A+ zero-shot", true);
  assert.ok(zero.store.packNames().includes("tool-demo"));
  assert.equal(zero.weights.learned.size, 0);
  const trained = sys.arm("A+ trained", true);
  assert.equal(trained.weights.get("WordsUsed:Demo"), 2.5);
  assert.deepEqual(sys.confirmations(), ["k1", "k2"]);
});

test("NOODLE_FROZEN: the assistant refuses to start on a frozen system that does not match", () => {
  const { root } = invented();
  const run = (id) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", `const { packedStore } = await import(${JSON.stringify(join(dist, "assistant", "index.js"))}); try { packedStore(); console.log("started"); } catch (e) { console.log(e.message); }`], {
      env: { ...process.env, NOODLE_FROZEN: id, NOODLE_EXPERIMENT: root, NOODLE_STORE: ":memory:" },
      encoding: "utf8",
      timeout: 120000,
    });
  assert.match(run("missing"), /no frozen system missing/);
  writeFileSync(join(root, "frozen", "t1", "confirmed.json"), "[]\n");
  assert.match(run("t1"), /is not frozen system t1:\n  the confirmations \(confirmed.json\) differ/);
});
