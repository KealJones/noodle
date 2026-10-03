#!/usr/bin/env node
// `pnpm freeze` (PLAN.md phase 6; design section 29; testing.md section 8): freezes the scored
// system as one unit into ~/.noodle/experiment/frozen/<id>/ and writes docs/frozen-<id>.md to
// publish. It refuses if the working tree is dirty (the commit would not be the code) or if the
// seed check fails, and never overwrites a frozen system.
//   pnpm freeze [--id ID] [--weights FILE]
//
// Frozen: the runtime's commit, version and source hash; the turn's settings; each seed part's hash
// and count; every pack in ~/.noodle/packs (copied, with its name, version, source and hash); the
// trained weights (--weights, a learned-weights pack, or else the learned weights in the store);
// Keal's stage-0 confirmations (for the variant reported beside the arms); the gold format and the
// mapping from gold to acts; the go and stop rules quoted from design section 29; and n, the margin
// and alpha from the pilot (~/.noodle/experiment/pilot.json), or null until the pilot sets them.
// Run the frozen system with NOODLE_FROZEN=<id>; score it with pnpm decide.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dist = join(import.meta.dirname, "..", "dist");
const F = await import(join(dist, "assistant", "frozen.js"));
const { check } = await import(join(dist, "seed", "check.js"));
const { DEFAULT_TURN } = await import(join(dist, "runtime", "turn.js"));
const { VERSION } = await import(join(dist, "version.js"));

/** The gold format (testing.md section 5.1); a change to it is a new version and a new freeze. */
export const GOLD = { format: "docs/specs/testing.md section 5.1", version: 1 };

/** How a gold act is compared with the act the system would run (scripts/decide.mjs implements it). */
export const MAPPING = {
  version: 1,
  rules: [
    "A system act is the act the winning reading would run or offer, evaluated in Suppose (a dry run): nothing effectful runs.",
    "Run(program, Args(...)) is the program and its argument list; the first argument is the subcommand, or the first two joined by a dash where the gold names a two-word subcommand (gh pr-view). Read is the act read and Edit or Write the act edit, with the file as its argument.",
    "Act label (metric a): program and subcommand equal, act by act.",
    "End state (metric b): the label, and the arguments as a multiset: the gold's flags, files, branch, remote, onto, base and any other value against the system's arguments after the subcommand, a commit message's flag and value aside. Paths compare after normalizing (./a is a). A value that is the fixture's default (its current branch, its only remote or origin) may be given or left out on either side.",
    "A commit message passes when the gold asks for one and the system gives one; its stated constraints are listed as unchecked until a checker exists (testing.md open question 2).",
    "Acts compare in the listed order, or as a permutation where the gold says order any; the number of acts must be equal.",
    "A constraint item is right when nothing would run and each gold rule is echoed as a stored Constraint with the same rule and act (and an until where the gold has one).",
    "Pull request acts (gh pr-*) are scored on the act label only (design section 29).",
    "Asking or abstaining (no act) is wrong for both metrics; an offered guarded act with the right target is right.",
    "Each item runs from its fixture restored into a sandbox (a clone of the captured commit and uncommitted work in a temporary directory, its remotes pointed at empty local bare repositories); an item whose fixture cannot be restored runs in an empty directory and is reported.",
    "Coverage of an item is the share of its words the winning readings used (WordsUsed against WordsUsed:Skipped); a win counts as understood at 70 percent or more.",
  ],
};

/** The go and stop rules, quoted from design section 29, and the floor they state. */
export function quoteRules(design) {
  const sec = design.slice(design.indexOf("## 29."), design.indexOf("## 30."));
  const bullet = (label) => {
    const at = sec.indexOf(`- **${label}**`);
    if (at < 0) throw new Error(`design section 29 has no ${label} rule`);
    const ends = ["\n- ", "\n\n"].map((x) => sec.indexOf(x, at + 1)).filter((x) => x > 0);
    return sec.slice(at, ends.length ? Math.min(...ends) : undefined).replace(/-\n\s*/g, "-").replace(/\s+/g, " ").trim();
  };
  const go = bullet("Go");
  const floor = /floor of (\d+) percent/.exec(go);
  if (!floor) throw new Error("the go rule states no floor");
  return { go, stop: bullet("Stop"), floor: Number(floor[1]) / 100 };
}

/** Writes the frozen directory and returns its manifest. Everything it reads comes in as arguments. */
export function freeze({ id, root, commit, repo, seedDir, packsDir, weightsText, confirmed, design, pilot, now = new Date() }) {
  const dir = join(root, "frozen", id);
  if (existsSync(dir)) throw new Error(`frozen system ${id} exists; a freeze is never overwritten`);
  const seedCheck = check(seedDir);
  const failures = [...seedCheck.undeclared.keys(), ...seedCheck.unsourced, ...seedCheck.domainInBridge];
  if (failures.length) throw new Error(`the seed check fails (pnpm seed:count): ${failures.length} problems`);
  const counts = new Map(seedCheck.parts.map((p) => [p.name, p.entries]));
  const rules = quoteRules(design);
  const weightsHeader = F.packHeader(weightsText);
  if (weightsText && weightsHeader.name !== "learned-weights") throw new Error("the weights must be a learned-weights pack");
  mkdirSync(join(dir, "packs"), { recursive: true });
  const packs = existsSync(packsDir)
    ? readdirSync(packsDir).filter((f) => f.endsWith(".ncon")).sort(F.packOrder).map((f) => {
        copyFileSync(join(packsDir, f), join(dir, "packs", f));
        return F.packEntry(f, readFileSync(join(dir, "packs", f), "utf8"));
      })
    : [];
  const weights = weightsText || 'Pack(name="learned-weights", version="1", from=Correction())\n';
  writeFileSync(join(dir, "weights.ncon"), weights);
  const confirmedText = JSON.stringify([...confirmed].sort(), null, 1) + "\n";
  writeFileSync(join(dir, "confirmed.json"), confirmedText);
  const manifest = {
    id,
    frozenAt: now.toISOString(),
    commit,
    version: VERSION,
    runtime: F.runtimeHash(repo),
    turn: DEFAULT_TURN,
    seed: F.seedHashes(seedDir).map((s) => ({ ...s, entries: counts.get(s.part) ?? 0 })),
    packs,
    weights: { file: "weights.ncon", hash: F.sha256(weights), count: (weights.match(/Weight\(/g) ?? []).length, from: weightsHeader.from ?? "Correction" },
    confirmations: { file: "confirmed.json", hash: F.sha256(confirmedText), count: [...confirmed].length },
    gold: GOLD,
    mapping: MAPPING,
    rules: { go: rules.go, stop: rules.stop },
    preregistered: pilot ? { n: pilot.n, margin: pilot.margin, alpha: pilot.alpha, floor: rules.floor, from: `pilot.json, ${pilot.at ?? "undated"}` } : null,
  };
  writeFileSync(join(dir, "freeze.json"), JSON.stringify(manifest, null, 1) + "\n");
  return manifest;
}

/** The summary to publish, docs/frozen-<id>.md. */
export function summary(m) {
  const pct = (x) => `${Math.round(x * 1000) / 10} percent`;
  const lines = [
    `# Frozen system ${m.id}`,
    "",
    `Frozen ${m.frozenAt} from commit ${m.commit}, runtime ${m.version} (source hash ${m.runtime.slice(0, 16)}). This is the system every confirmatory item is scored against (design section 29); development continues on a separate version. Run it with \`NOODLE_FROZEN=${m.id}\`; score it with \`pnpm decide\`.`,
    "",
    "## Seed",
    "",
    "| Part | Entries | Hash |",
    "|---|---|---|",
    ...m.seed.map((s) => `| ${s.part} | ${s.entries} | ${s.hash.slice(0, 16)} |`),
    `| total | ${m.seed.reduce((a, s) => a + s.entries, 0)} | |`,
    "",
    "## Packs",
    "",
    "| Pack | Version | Source | Kind | Hash |",
    "|---|---|---|---|---|",
    ...m.packs.map((p) => `| ${p.name} | ${p.version} | ${p.from} | ${p.kind} | ${p.hash.slice(0, 16)} |`),
    "",
    `Arm A runs on the seed and the imports with the seed's weights; A+ zero-shot adds the documentation readings; A+ trained adds the trained weights (${m.weights.count} learned feature weights, from ${m.weights.from}, hash ${m.weights.hash.slice(0, 16)}). All documentation readings run unconfirmed; a variant with Keal's ${m.confirmations.count} stage-0 confirmations is reported beside.`,
    "",
    `Turn settings: ${JSON.stringify(m.turn)}.`,
    "",
    "## Gold format and mapping",
    "",
    `Gold format version ${m.gold.version} (${m.gold.format}). Mapping version ${m.mapping.version}:`,
    "",
    ...m.mapping.rules.map((r) => `- ${r}`),
    "",
    "## Pre-registered",
    "",
    m.preregistered
      ? `n = ${m.preregistered.n} real requests in the confirmatory set; margin ${pct(m.preregistered.margin)}; alpha ${m.preregistered.alpha} (Holm); floor ${pct(m.preregistered.floor)} (${m.preregistered.from}).`
      : "n and the margin are not set: the pilot (stage 1) sets them, and decide refuses until it has.",
    "",
    `> ${m.rules.go}`,
    ">",
    `> ${m.rules.stop}`,
    "",
  ];
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const repo = join(import.meta.dirname, "..");
  const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
  if (git("status", "--porcelain")) {
    console.error("refusing: the working tree is dirty, so the commit would not be the code. Commit or set aside the changes first.");
    process.exit(1);
  }
  const commit = git("rev-parse", "HEAD");
  const id = opt("--id") ?? `v${VERSION}-${commit.slice(0, 7)}`;
  return (async () => {
    const { STORE, PACKS } = await import(join(dist, "assistant", "index.js"));
    const { Store } = await import(join(dist, "runtime", "store.js"));
    const { Weights } = await import(join(dist, "runtime", "score.js"));
    // The learned weights and the confirmations are read from the store as it is; nothing is loaded into it.
    const store = existsSync(STORE) ? new Store(STORE) : new Store();
    const weightsText = opt("--weights") ? readFileSync(opt("--weights"), "utf8") : new Weights(store).toNcon();
    const confirmed = store.facts("Confirmation", "Confirmed").flatMap((f) => (f.claim.args[0]?.value?.kind === "string" ? [f.claim.args[0].value.value] : []));
    const pilotPath = join(F.EXPERIMENT, "pilot.json");
    const pilot = existsSync(pilotPath) ? JSON.parse(readFileSync(pilotPath, "utf8")) : null;
    const m = freeze({ id, root: F.EXPERIMENT, commit, repo, seedDir: join(repo, "seed"), packsDir: PACKS, weightsText, confirmed, design: readFileSync(join(repo, "docs", "design.md"), "utf8"), pilot });
    writeFileSync(join(repo, "docs", `frozen-${id}.md`), summary(m));
    console.log(`froze ${id} into ${join(F.EXPERIMENT, "frozen", id)}: ${m.packs.length} packs, ${m.weights.count} weights, seed ${m.seed.reduce((a, s) => a + s.entries, 0)} entries`);
    console.log(`publish docs/frozen-${id}.md (commit it).${pilot ? "" : " n and the margin are not set: decide refuses until the pilot writes pilot.json and the system is frozen again."}`);
  })();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
