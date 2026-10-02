// The replay gate (testing.md section 4; design section 20): a learned weight change is kept only if
// no hand-checked item it touches goes from right to wrong. The items are Keal's act labels on the
// development side of the split (~/.napkin/corpus/tests/labels.jsonl, ~/.noodle/experiment/
// split.json), heard as dry runs. Which items a change touches is known from an index of the
// features each item's readings had, built once, the first time the gate is asked.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type Expr, isCall, positional } from "../runtime/expr.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import type { World } from "../runtime/primitive.js";
import type { Weights } from "../runtime/score.js";
import type { Store } from "../runtime/store.js";
import { Session } from "../runtime/turn.js";

interface Item {
  i: number;
  text: string;
  want: string[];
}

interface Indexed {
  item: Item;
  right: boolean;
  features: Set<string>;
}

const CORPUS = join(homedir(), ".napkin", "corpus");
const SPLIT = join(homedir(), ".noodle", "experiment", "split.json");

/** The hand-checked items, or none when the corpus is not on this machine. */
export function replayItems(): Item[] {
  const labels = join(CORPUS, "tests", "labels.jsonl");
  if (!existsSync(labels) || !existsSync(SPLIT) || !existsSync(join(CORPUS, "all.jsonl"))) return [];
  const jsonl = (p: string) =>
    readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const all = jsonl(join(CORPUS, "all.jsonl")) as { text?: string }[];
  const holdout = new Set((JSON.parse(readFileSync(SPLIT, "utf8")) as { holdout: number[] }).holdout);
  return (jsonl(labels) as { i: unknown; class?: string; verdict?: string; acts?: { program?: string; sub?: string }[] }[])
    .filter((l) => typeof l.i === "number" && !holdout.has(l.i) && l.verdict !== "drop" && (l.class === "acts" || l.class === "none"))
    .map((l) => ({ i: l.i as number, text: all[l.i as number]?.text ?? "", want: (l.acts ?? []).map((a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim()) }))
    .filter((x) => x.text && x.text.split(/\s+/).length <= 150 && !x.text.trimStart().startsWith("<heartbeat>"));
}

/** An act as the labels name it (the same naming as scripts/acts.mjs). */
function named(act: Expr): string[] {
  if (!isCall(act)) return [];
  if (act.head === "Run") {
    const [program, a] = positional(act);
    const words = isCall(a) ? positional(a).flatMap((x) => (x.kind === "string" ? [x.value] : [])) : [];
    const p = program?.kind === "string" ? program.value : "";
    return [`${p} ${words[0] ?? ""}`.trim(), ...(words.length > 1 ? [`${p} ${words[0]}-${words[1]}`] : [])];
  }
  if (act.head === "Read") return ["read"];
  if (act.head === "Write" || act.head === "Edit") return ["edit"];
  return [act.head.toLowerCase()];
}

export class ReplayGate {
  private index?: Indexed[];

  constructor(
    private readonly store: Store,
    private readonly items: Item[] = replayItems(),
  ) {}

  private async hear(item: Item, weights: Weights): Promise<{ right: boolean; features: Set<string> }> {
    const world: World = { root: mkdtempSync(join(tmpdir(), "noodle-replay-")), store: this.store, now: () => new Date(), say() {}, ask() {} };
    const session = new Session(this.store, PRIMITIVES, world, undefined, weights);
    const r = await session.turn(item.text, { dry: true });
    const got = new Set(r.acts.flatMap(named));
    const right = item.want.length ? item.want.every((w) => got.has(w)) : r.acts.length === 0;
    const features = new Set(r.record.reasons.flatMap((c) => c.candidates.flatMap((x) => x.features.map(([k]) => k))));
    return { right, features };
  }

  /** Whether the change keeps every touched item that was right still right. */
  async check(changed: ReadonlySet<string>, weights: Weights, before: Weights): Promise<boolean> {
    if (!this.items.length) return true;
    if (!this.index) {
      this.index = [];
      for (const item of this.items) this.index.push({ item, ...(await this.hear(item, before)) });
    }
    for (const x of this.index) {
      if (!x.right || ![...changed].some((k) => x.features.has(k))) continue;
      if (!(await this.hear(x.item, weights)).right) return false;
    }
    return true;
  }
}
