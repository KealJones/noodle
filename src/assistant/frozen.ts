// The frozen system (design section 29; testing.md section 8; PLAN.md phase 6): the scored system
// as one unit, in ~/.noodle/experiment/frozen/<id>/. `pnpm freeze` writes it; `NOODLE_FROZEN=<id>`
// runs it and `pnpm decide` scores it, each refusing if anything differs from its manifest
// (freeze.json). Development continues on the working version, which is never the one scored.
//
// What is frozen, each by content hash: the runtime's source, the seed's eight parts, every pack
// (copied into the frozen directory, so later imports cannot change it), the trained weights and
// Keal's stage-0 confirmations (used only by the variant reported beside the arms). The gold
// format, the mapping from gold to acts and the pre-registered go and stop rules are recorded with
// it, so what is published is what is scored.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { PARTS } from "../seed/check.js";
import { SEED_DIR, seededStore } from "../runtime/seed.js";
import { Weights } from "../runtime/score.js";
import { Store } from "../runtime/store.js";
import { DEFAULT_TURN } from "../runtime/turn.js";
import { VERSION } from "../version.js";

export const EXPERIMENT = process.env.NOODLE_EXPERIMENT ?? join(homedir(), ".noodle", "experiment");
/** The repository the runtime was built from: dist/ and src/ sit side by side in it. */
export const REPO = join(import.meta.dirname, "..", "..");

/**
 * The sources whose packs are documentation readings (the "+" of arm A+, design section 29); every
 * other pack is an import. A pack says its source in its header (`from=ToolDoc("git")`).
 */
export const DOCUMENTATION_SOURCES = ["ToolDoc", "ApiDoc"];

export type Arm = "A" | "A+ zero-shot" | "A+ trained";
export const ARMS: Arm[] = ["A", "A+ zero-shot", "A+ trained"];

export interface PackEntry {
  file: string;
  name: string;
  version: string;
  from: string;
  kind: "import" | "documentation";
  hash: string;
}

export interface Preregistered {
  /** Items in the confirmatory set of real requests, from the pilot's power calculation. */
  n: number;
  /** The margin of the superiority and non-inferiority tests, as a proportion. */
  margin: number;
  /** The family-wise error rate the Holm correction holds. */
  alpha: number;
  /** The absolute floor, as a proportion, read from the quoted go rule. */
  floor: number;
  /** Where n, margin and alpha came from (the pilot's file) and when it was written. */
  from: string;
}

export interface Manifest {
  id: string;
  frozenAt: string;
  commit: string;
  version: string;
  /** sha256 over the runtime's source files (src/, tests aside), path and content. */
  runtime: string;
  /** The turn's settings that affect scoring (the stage-two width, derivations per edge). */
  turn: typeof DEFAULT_TURN;
  seed: { part: string; file: string; hash: string; entries: number }[];
  packs: PackEntry[];
  /** ChatGPT as a tutor (design section 17): off in the scored experiment, and nothing it taught is frozen. */
  tutor?: "off";
  weights: { file: "weights.ncon"; hash: string; count: number; from: string };
  confirmations: { file: "confirmed.json"; hash: string; count: number };
  gold: { format: string; version: number };
  mapping: { version: number; rules: string[] };
  /** The go and stop rules, quoted from design section 29 at the freeze. */
  rules: { go: string; stop: string };
  /** Null until the pilot (stage 1) has set n and the margin; decide refuses without them. */
  preregistered: Preregistered | null;
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** A pack's name, version and source, from its header. */
export function packHeader(text: string): { name?: string; version?: string; from?: string } {
  const head = /^\s*(?:\/\/[^\n]*\n\s*)*Pack\(([\s\S]*?)\)\s*\n\s*\n/.exec(text)?.[1] ?? /^\s*Pack\(([^\n]*)/.exec(text)?.[1] ?? "";
  return {
    name: /name\s*=\s*"([^"]*)"/.exec(head)?.[1],
    version: /version\s*=\s*"([^"]*)"/.exec(head)?.[1],
    from: /from\s*=\s*([A-Za-z#]+)\(/.exec(head)?.[1],
  };
}

/** The order packs load in: WordNet, then VerbNet, then Wiktionary, then the rest, by name. */
export function packOrder(a: string, b: string): number {
  const o = (f: string) => (f.startsWith("oewn") ? 0 : f.startsWith("verbnet") ? 1 : f.startsWith("wiktionary") ? 2 : 3);
  return o(a) - o(b) || a.localeCompare(b);
}

export function packEntry(file: string, text: string): PackEntry {
  const h = packHeader(text);
  if (!h.name) throw new Error(`${file} has no Pack(name=...) header`);
  return {
    file,
    name: h.name,
    version: h.version ?? "",
    from: h.from ?? "",
    kind: DOCUMENTATION_SOURCES.includes(h.from ?? "") ? "documentation" : "import",
    hash: sha256(text),
  };
}

/** sha256 over every source file of the runtime under src/ (tests aside), by path, in order. */
export function runtimeHash(repo = REPO): string {
  const src = join(repo, "src");
  if (!existsSync(src)) throw new Error(`the runtime's source is not at ${src}`);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) files.push(p);
    }
  };
  walk(src);
  const h = createHash("sha256");
  for (const f of files.map((x) => relative(repo, x)).sort()) h.update(`${f}\0`).update(readFileSync(join(repo, f))).update("\0");
  return h.digest("hex");
}

/** Each seed part's file and hash (the counts come from the seed check). */
export function seedHashes(dir = SEED_DIR): { part: string; file: string; hash: string }[] {
  return PARTS.map(([part, file]) => ({ part, file, hash: sha256(readFileSync(join(dir, file), "utf8")) }));
}

/** The learned weights in a pack's text, as a Weights over the seed weights. */
export function weightsFrom(store: Store, text?: string): Weights {
  const w = new Weights(store, false);
  w.learned.clear();
  if (text) {
    const s = new Store();
    s.load(text);
    w.loadLearned(s);
  }
  return w;
}

/**
 * Every way the system here differs from the manifest; empty when it is the frozen system. `dir` is
 * the frozen directory (its packs, weights and confirmations are the frozen copies).
 */
export function differences(m: Manifest, dir: string, repo = REPO, seedDir = SEED_DIR): string[] {
  const out: string[] = [];
  if (m.version !== VERSION) out.push(`runtime version is ${VERSION}, frozen ${m.version}`);
  try {
    if (runtimeHash(repo) !== m.runtime) out.push("the runtime's source differs from the frozen commit's");
  } catch (e) {
    out.push((e as Error).message);
  }
  if (JSON.stringify(m.turn) !== JSON.stringify(DEFAULT_TURN)) out.push(`the turn's settings are ${JSON.stringify(DEFAULT_TURN)}, frozen ${JSON.stringify(m.turn)}`);
  const seed = new Map(seedHashes(seedDir).map((s) => [s.part, s.hash]));
  for (const s of m.seed) if (seed.get(s.part) !== s.hash) out.push(`seed part ${s.part} differs`);
  const packsDir = join(dir, "packs");
  const present = existsSync(packsDir) ? readdirSync(packsDir).filter((f) => f.endsWith(".ncon")) : [];
  for (const p of m.packs) {
    const path = join(packsDir, p.file);
    if (!existsSync(path)) out.push(`pack ${p.file} is missing`);
    else if (sha256(readFileSync(path, "utf8")) !== p.hash) out.push(`pack ${p.file} differs`);
  }
  for (const f of present) if (!m.packs.some((p) => p.file === f)) out.push(`pack ${f} is not in the manifest`);
  for (const [what, file, hash] of [["weights", m.weights.file, m.weights.hash], ["confirmations", m.confirmations.file, m.confirmations.hash]]) {
    const path = join(dir, file);
    if (!existsSync(path) || sha256(readFileSync(path, "utf8")) !== hash) out.push(`the ${what} (${file}) differ`);
  }
  return out;
}

export function readManifest(id: string, root = EXPERIMENT): { manifest: Manifest; dir: string } {
  const dir = join(root, "frozen", id);
  const path = join(dir, "freeze.json");
  if (!existsSync(path)) throw new Error(`no frozen system ${id} (${path})`);
  return { manifest: JSON.parse(readFileSync(path, "utf8")) as Manifest, dir };
}

/**
 * The frozen system, checked against its manifest: refuses (throws) if anything differs. Its stores
 * are built from the frozen copies, each in the frozen directory: arm A's from the seed and the
 * imports, arm A+'s from those, the documentation readings and the trained weights. A store holding
 * any pack the manifest does not name is refused too.
 */
export class FrozenSystem {
  readonly manifest: Manifest;
  readonly dir: string;
  private stores = new Map<string, Store>();
  private readonly seedDir: string;

  constructor(id: string, root = EXPERIMENT, repo = REPO, seedDir = SEED_DIR) {
    const { manifest, dir } = readManifest(id, root);
    const diff = differences(manifest, dir, repo, seedDir);
    if (diff.length) throw new Error(`the system here is not frozen system ${id}:\n  ${diff.join("\n  ")}`);
    this.manifest = manifest;
    this.dir = dir;
    this.seedDir = seedDir;
  }

  /** The store an arm runs on: "A" (seed and imports) or "A+" (also documentation and weights). */
  store(which: "A" | "A+", inMemory = false): Store {
    const had = this.stores.get(which);
    if (had) return had;
    const store = seededStore(this.seedDir, inMemory ? undefined : join(this.dir, which === "A" ? "store-a.db" : "store-a-plus.db"));
    const packs = this.manifest.packs.filter((p) => which === "A+" || p.kind === "import").sort((a, b) => packOrder(a.file, b.file));
    for (const p of packs) store.load(readFileSync(join(this.dir, "packs", p.file), "utf8"));
    const weights = which === "A+" ? readFileSync(join(this.dir, this.manifest.weights.file), "utf8") : "";
    if (weights) store.load(weights);
    const allowed = new Set([...PARTS.map(([, f]) => packHeader(readFileSync(join(this.seedDir, f), "utf8")).name), ...packs.map((p) => p.name), packHeader(weights).name]);
    const extra = store.packNames().filter((n) => !allowed.has(n));
    if (extra.length) throw new Error(`frozen store ${which} holds packs the manifest does not name: ${extra.join(", ")}`);
    this.stores.set(which, store);
    return store;
  }

  /** An arm's store and weights: seed weights for A and A+ zero-shot, the trained ones for A+ trained. */
  arm(arm: Arm, inMemory = false): { store: Store; weights: Weights } {
    const store = this.store(arm === "A" ? "A" : "A+", inMemory);
    const text = arm === "A+ trained" ? readFileSync(join(this.dir, this.manifest.weights.file), "utf8") : undefined;
    return { store, weights: weightsFrom(store, text) };
  }

  /** Keal's stage-0 confirmations, for the variant reported beside the arms (never an arm). */
  confirmations(): string[] {
    return JSON.parse(readFileSync(join(this.dir, this.manifest.confirmations.file), "utf8")) as string[];
  }
}
