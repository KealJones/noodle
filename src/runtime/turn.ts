// One turn (runtime.md section 2): Focus's candidate set, hearing, segments, the chart, readings
// rewritten toward a logical form and scored in two stages (the chart and rewriting, then a dry
// run with Suppose), the winner evaluated, and what it says realized and printed. Every choice is
// recorded with its candidates and features.

import { type Call, type Expr, c, isCall, key, positional, rewrite as mapExpr, role, s } from "./expr.js";
import { Chart, type Cover, type Edge } from "./chart.js";
import { Conversation, type TurnRecord } from "./conversation.js";
import { Evaluator, type Outcome } from "./evaluate.js";
import { hear, segmentations, type Hearing } from "./hear.js";
import type { Primitive, World } from "./primitive.js";
import { type Derivation, Rewriter, type Step } from "./rewrite.js";
import { type ChoicePoint, type Features, Weights, addFeature, mergeFeatures, scoreOf } from "./score.js";
import { Speaker } from "./speak.js";
import type { Store } from "./store.js";

export interface TurnOptions {
  /** Readings per segment taken to stage two (runtime.md 8.2; default 3, here a little wider). */
  stageTwo: number;
  /** Derivations per cover edge. */
  derivations: number;
}

export const DEFAULT_TURN: TurnOptions = { stageTwo: 16, derivations: 6 };

interface Reading {
  lfs: Expr[];
  steps: Step[];
  features: Features;
  score: number;
  cover: Cover;
}

export interface TurnResult {
  text: string;
  record: TurnRecord;
  /** The acts the winner ran, or in a dry run would have run. */
  acts: Expr[];
}

/** The last user turn's choice, kept so a correction can flip it (design section 17). */
interface LastChoice {
  segText: string;
  readings: Reading[];
  winner: Reading;
  words: Map<string, string>;
}

export class Session {
  readonly conversation = new Conversation();
  private last?: LastChoice;
  /** Called after learning changes the weights, so the channel can keep them (no file access here). */
  onLearn?: (weights: Weights) => void;
  /**
   * The replay gate (testing.md section 4): given the features an update changed, whether the
   * hand-checked items they touch still come out right. A change it vetoes is put back.
   */
  gate?: (changed: ReadonlySet<string>, after: Weights, before: Weights) => Promise<boolean>;
  readonly weights: Weights;
  readonly speaker: Speaker;
  private medium: string;

  constructor(
    readonly store: Store,
    readonly primitives: ReadonlyMap<string, Primitive>,
    readonly world: World,
    readonly opts: TurnOptions = DEFAULT_TURN,
    weights?: Weights,
  ) {
    this.weights = weights ?? new Weights(store);
    this.speaker = new Speaker(store);
    const m = store.facts("Conversation", "Medium").map((f) => positional(f.claim as Call)[0])[0];
    this.medium = isCall(m) ? m.head : "";
  }

  /** Focus, phase 1 (runtime.md 11b): names in the workspace, through a pure primitive. */
  private async surroundings(): Promise<string[]> {
    const read = this.primitives.get("Read");
    if (!read) return [];
    try {
      const dir = await read.run([s(".")], this.world);
      return isCall(dir) ? positional(dir).flatMap((e) => (isCall(e) && positional(e)[0]?.kind === "string" ? [(positional(e)[0] as { value: string }).value] : [])) : [];
    } catch {
      return [];
    }
  }

  /**
   * One turn. With dry, the winner is evaluated in Suppose instead of Doing: nothing effectful
   * runs and nothing is stored, and the acts it would run are returned (for scoring against labels).
   * With ask false it never asks which of two tied readings was meant (the zero-shot arms, design
   * section 29: asking is off where there is no calibration).
   */
  async turn(text: string, opts: { dry?: boolean; ask?: boolean } = {}): Promise<TurnResult> {
    // A dry run works on a copy of the conversation, so nothing of it is kept.
    const conv = opts.dry ? this.conversation.clone() : this.conversation;
    conv.decay();
    const record: TurnRecord = { index: conv.turnIndex, who: "User", text, heard: [], lf: [], said: [], reasons: [], tone: [], asides: [] };
    conv.turns.push(record);

    const hearing = hear(this.store, text, { names: await this.surroundings() });
    record.tone = toneOf(this.store, hearing);

    // Segmentations: at most two, ranked by the score of their best covers (runtime.md 3.2).
    const segs = segmentations(this.store, hearing).map((ss) =>
      ss.map(([a, b2]) => {
        const chart = new Chart(this.store, hearing, a, b2, this.weights.get).build();
        return { a, b2, chart, covers: chart.covers() };
      }),
    );
    const segScore = (ss: typeof segs[number]) => ss.reduce((n, x) => n + (x.covers[0]?.score ?? 0), 0);
    segs.sort((x, y) => segScore(y) - segScore(x));
    const chosen = segs[0] ?? [];
    if (segs.length > 1)
      record.reasons.push(choice("segmentation", segs.map((ss, i) => ({ label: `segmentation ${i + 1}: ${ss.length} segments`, features: [], score: segScore(ss) })), 0));

    const rewriter = new Rewriter(this.store, this.weights.get);
    const said: Expr[] = [];
    const words = new Map<string, string>();
    const allSteps: Step[] = [];
    let anything = false;
    const choices: LastChoice[] = [];
    const acts: Expr[] = [];
    for (const seg of chosen) {
      const segText = textOf(text, hearing, seg.a, seg.b2);
      const top = await this.readings(seg.covers, seg.chart, rewriter, segText, conv);
      if (!top.length) continue;
      const win = top[0];
      // Two readings too close (design sections 9 and 23): when the best two tie exactly and lead
      // to different acts, nothing says which was meant, so it asks instead of picking one.
      const runner = top[1];
      const actsOf = (r: Reading) => r.lfs.flatMap((lf) => [...walkCalls(lf)].filter((x) => this.primitives.has(x.head) && !this.primitives.get(x.head)!.pure)).map(key);
      if (opts.ask !== false && runner && runner.score === win.score && actsOf(win).length && actsOf(runner).length && actsOf(win).join() !== actsOf(runner).join()) {
        const a = win.lfs.flatMap((lf) => [...walkCalls(lf)].filter((x) => this.primitives.has(x.head)))[0];
        const b2 = runner.lfs.flatMap((lf) => [...walkCalls(lf)].filter((x) => this.primitives.has(x.head)))[0];
        record.reasons.push(choice(`reading of "${segText}" (too close)`, top.slice(0, 2).map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), -1));
        said.push(c("TooClose", a, b2));
        anything = true;
        continue;
      }
      record.reasons.push(choice(`reading of "${segText}"`, top.map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), 0));
      record.heard.push(...win.cover.edges.map((e) => e.expr));
      record.lf.push(...win.lfs);
      for (const e of win.cover.edges) collectWords(e, text, hearing, words);
      allSteps.push(...win.steps);
      choices.push({ segText, readings: top, winner: win, words });
      const ev = new Evaluator(this.store, this.primitives, this.world, conv, opts.dry ? "Supposing" : "Doing", win.steps, segText, (x) => this.canSay(x));
      const segSaid: Expr[] = [];
      let reached = false;
      for (const lf of win.lfs) {
        const o = await ev.run(lf);
        segSaid.push(...o.said);
        acts.push(...o.acts);
        if (o.reachedAct) reached = anything = true;
      }
      // Honest when stuck (design section 23): a segment nothing worked for says why once, and
      // the most useful why is a word it has no sense for.
      const specific = segSaid.filter((x) => isCall(x) && x.head === "Unworked" && role(x, "because") && isCall(role(x, "because")) && (role(x, "because") as Call).head === "NeedUnmet");
      if (!reached && specific.length) said.push(...specific);
      else if (!reached && segSaid.length && segSaid.every((x) => isCall(x) && x.head === "Unworked")) {
        const unknown = unknownWords(hearing, seg.a, seg.b2);
        said.push(unknown.length ? c("NoSense", pairs(unknown.map((w) => s(w)))) : c("Unworked", s(segText)));
      } else if (reached) {
        // Where part of the segment did something, a fragment beside it that worked out nothing on
        // its own is left out of the reply and kept in the reasons log.
        const kept = segSaid.filter((x) => !(isCall(x) && x.head === "Unworked" && !role(x, "because")));
        if (kept.length < segSaid.length) record.reasons.push(choice(`fragments left unworked in "${segText}"`, segSaid.filter((x) => !kept.includes(x)).map((x) => ({ label: key(x), features: [], score: 0 })), -1));
        said.push(...kept);
      } else said.push(...segSaid);
    }
    // A proposal not taken up this turn lapses (runtime.md 11: the last proposal).
    const permitted = record.lf.some((x) => key(x).includes("Permit("));
    if (!permitted && conv.proposal && conv.proposal.turn < record.index) conv.proposal = undefined;

    // A correction (design section 17): a turn that did nothing of its own and carries a correction
    // signal is about the last reading. Flip its choice point to the best alternative that reaches
    // an act, run that, and move the weights toward it and away from what was chosen.
    if (!opts.dry && !anything && this.last && hasSignal(this.store, hearing)) {
      const flipped = await this.correct(this.last, record);
      if (flipped) {
        said.length = 0;
        said.push(...flipped.said);
        anything = true;
        allSteps.push(...flipped.steps);
        for (const [k, w] of this.last.words) words.set(k, w);
      }
    }
    if (choices.length && !opts.dry) this.last = choices[choices.length - 1];

    if (!said.length && !anything && text.trim()) said.push(c("Unworked", s(text.trim())));
    // The same thing is said once.
    const once = new Set<string>();
    for (let i = said.length - 1; i >= 0; i--) {
      const k = key(said[i]);
      if (once.has(k)) said.splice(i, 1);
      else once.add(k);
    }
    // Words it has no sense for, across segments, are said once.
    const unknownSaid = said.filter((x) => isCall(x) && x.head === "NoSense");
    if (unknownSaid.length > 1) {
      const flat = (w: Expr): Expr[] => (isCall(w) && w.head === "And" ? positional(w).flatMap(flat) : [w]);
      const words = unknownSaid.flatMap((x) => flat(positional(x as Call)[0]));
      const at = said.indexOf(unknownSaid[0]);
      const rest = said.filter((x) => !unknownSaid.includes(x));
      rest.splice(at, 0, c("NoSense", pairs(words)));
      said.length = 0;
      said.push(...rest);
    }
    // Several offers in one turn are said as one offer of all of them, as they are one proposal.
    const offers = said.filter((x) => isCall(x) && x.head === "Offer");
    if (offers.length > 1) {
      const first = said.indexOf(offers[0]);
      const rest = said.filter((x) => !offers.includes(x));
      const acts = offers.map((x) => positional(x as Call)[0]);
      const nested = (xs: Expr[]): Expr => (xs.length === 1 ? xs[0] : c("Sequence", xs[0], nested(xs.slice(1))));
      rest.splice(first, 0, c("Offer", nested(acts)));
      said.length = 0;
      said.push(...rest);
    }
    const spoken = said.map((x) => this.inWords(x, words, allSteps));
    record.said = spoken;
    const out = spoken.map((x) => this.speaker.say(x, this.medium)).filter(Boolean).join("\n\n");
    conv.turns.push({ index: conv.turnIndex, who: "Self", text: out, heard: [], lf: [], said: spoken, reasons: [], tone: [], asides: [] });
    return { text: out, record, acts };
  }

  private async correct(last: LastChoice, record: TurnRecord): Promise<{ said: Expr[]; steps: Step[] } | undefined> {
    const was = last.winner.lfs.map(key).join(";");
    const alts = last.readings.filter((r) => r !== last.winner && r.lfs.map(key).join(";") !== was && (r.features.get("ReachedAct") ?? 0) > 0);
    const alt = alts.sort((a, b) => b.score - a.score)[0];
    if (!alt) return undefined;
    // The latent-variable perceptron's step (runtime.md 15), capped, kept only if the replay gate
    // passes; the flip itself happens either way, since the user said so.
    const snapshot = this.gate ? this.weights.clone() : undefined;
    const before = this.weights.update(alt.features, last.winner.features);
    const kept = !this.gate || !snapshot || (await this.gate(new Set(before.keys()), this.weights, snapshot));
    if (kept) this.onLearn?.(this.weights);
    else this.weights.revert(before);
    record.reasons.push(choice(kept ? "weights updated" : "weights update vetoed by the replay gate", [...before.keys()].map((k) => ({ label: k, features: [], score: this.weights.get(k) })), -1));
    record.reasons.push(choice(`correction of "${last.segText}"`, [last.winner, alt].map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), 1));
    record.lf.push(...alt.lfs);
    const ev = new Evaluator(this.store, this.primitives, this.world, this.conversation, "Doing", alt.steps, last.segText, (x) => this.canSay(x));
    const said: Expr[] = [];
    for (const lf of alt.lfs) said.push(...(await ev.run(lf)).said);
    last.winner = alt;
    return { said, steps: alt.steps };
  }

  /**
   * The readings of a segment, scored in both stages. A cover's edges are fragments that do not
   * depend on each other, so each edge's derivations are dry run on their own and the best kept
   * (stage one plus stage two, runtime.md 8): linear in the fragments, where taking the product
   * of their alternatives crowded the right reading out of the dry runs.
   */
  private async readings(covers: Cover[], chart: Chart, rewriter: Rewriter, segText: string, conv: Conversation): Promise<Reading[]> {
    type Alt = { expr: Expr; steps: Step[]; features: Features; reached: boolean };
    const perEdge = new Map<string, Alt[]>();
    const out: Reading[] = [];
    for (const cv of covers) {
      const chosen: Alt[][] = [];
      for (const e of cv.edges) {
        const k = key(e.expr);
        let alts: Alt[] | undefined = perEdge.get(k);
        if (!alts) {
          alts = [] as Alt[];
          for (const d of chart.variants(e).flatMap((v) => rewriter.normalize(v.expr).slice(0, this.opts.derivations))) {
            const o = await this.suppose({ lfs: [d.expr], steps: d.steps, features: d.features, score: 0, cover: cv }, segText, conv);
            const f2: Features = new Map();
            addFeature(f2, "Unworked", -o.unworked);
            addFeature(f2, "Blocked", o.blocked);
            addFeature(f2, "ChecksWouldPass", o.checksPassed);
            alts.push({ expr: d.expr, steps: d.steps, features: mergeFeatures(d.features, f2), reached: o.reachedAct });
          }
          // An edge's best alternative, counting what reaching an act is worth.
          const value = (x: Alt) => scoreOf(x.features, this.weights.get) + (x.reached ? this.weights.get("ReachedAct") : 0);
          alts.sort((x, y) => value(y) - value(x));
          perEdge.set(k, alts);
        }
        if (alts.length) chosen.push(alts);
      }
      // The cover's best reading, and beside it each fragment's runners-up with the others at
      // their best: the alternatives a correction can flip to (design section 17).
      const assemble = (pick: Alt[]) => {
        let features = cv.features;
        for (const a of pick) features = mergeFeatures(features, a.features);
        features = mergeFeatures(features, new Map([["ReachedAct", pick.some((a) => a.reached) ? 1 : 0]]));
        out.push({ lfs: pick.map((a) => a.expr), steps: pick.flatMap((a) => a.steps), features, score: scoreOf(features, this.weights.get), cover: cv });
      };
      const best = chosen.map((alts) => alts[0]);
      assemble(best);
      chosen.forEach((alts, i) => {
        // Runners-up: the next few, and every alternative that reaches an act (what a correction
        // would flip to), even if it scored lower.
        const ups = [...new Set([...alts.slice(1, 3), ...alts.slice(1).filter((a) => a.reached).slice(0, 6)])];
        ups.forEach((alt) => assemble(best.map((b, j) => (j === i ? alt : b))));
      });
    }
    const seen = new Set<string>();
    return out
      .sort((x, y) => y.score - x.score)
      .filter((r) => {
        const k = r.lfs.map(key).join(";");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }

  private async suppose(r: Reading, segText: string, conv: Conversation = this.conversation): Promise<Outcome> {
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Supposing", r.steps, segText, (x) => this.canSay(x));
    let o: Outcome = { said: [], acts: [], reachedAct: false, unworked: 0, blocked: 0, checksPassed: 0 };
    for (const lf of r.lfs) {
      const x = await ev.run(lf);
      o = { said: [...o.said, ...x.said], acts: [...o.acts, ...x.acts], reachedAct: o.reachedAct || x.reachedAct, unworked: o.unworked + x.unworked, blocked: o.blocked + x.blocked, checksPassed: o.checksPassed + x.checksPassed };
    }
    return o;
  }

  /** Whether the seed has words for this (a Reply to a social turn, say). */
  canSay(e: Expr): boolean {
    const before = key(e);
    const after = key(this.speaker.realize(e));
    return before !== after && !after.startsWith(before.split("(")[0] + "(");
  }

  /** Acts and referents are said in the words the user used for them, where there are some. */
  private inWords(e: Expr, words: Map<string, string>, steps: Step[]): Expr {
    if (!isCall(e)) return e;
    const find = (x: Expr): string | undefined => {
      const seen = new Set<string>();
      const stack = [x];
      while (stack.length) {
        const y = stack.pop()!;
        const k = key(y);
        if (seen.has(k)) continue;
        seen.add(k);
        const w = words.get(k);
        if (w) return w;
        for (const st of steps) if (key(st.after) === k) stack.push(st.before);
      }
      return undefined;
    };
    if (e.head === "Reply") return e;
    return {
      ...e,
      args: e.args.map((a) => ({
        ...a,
        value: mapExpr(a.value, (x) => {
          // A primitive call is said by its own realization (a command line, a file's content).
          if (!isCall(x) || this.primitives.has(x.head) || x.head === "Constraint" || x.head === "BlockedBy" || x.head === "Reply") return undefined;
          const w = find(x);
          return w ? s(w) : undefined;
        }),
      })),
    };
  }
}

function choice(what: string, candidates: ChoicePoint["candidates"], winner: number): ChoicePoint {
  return { what, candidates, winner };
}

function textOf(text: string, h: Hearing, a: number, b2: number): string {
  if (a >= b2) return "";
  return text.slice(h.tokens[a].start, h.tokens[b2 - 1].end).trim();
}

/** Every edge in a derivation, by its expression, mapped to the words it spans. */
function collectWords(e: Edge, text: string, h: Hearing, out: Map<string, string>) {
  const k = key(e.expr);
  const w = textOf(text, h, e.start, e.end);
  if (!out.has(k) && w && !/^[\p{P}\p{S}\s]+$/u.test(w)) out.set(k, w);
  for (const b2 of e.back) collectWords(b2, text, h, out);
}

/** One thing, or nested pairs And(a, And(b, c)): a set said pairwise. */
function pairs(xs: Expr[]): Expr {
  return xs.length === 1 ? xs[0] : c("And", xs[0], pairs(xs.slice(1)));
}

function* walkCalls(e: Expr): Generator<Call> {
  if (!isCall(e)) return;
  yield e;
  for (const a of e.args) yield* walkCalls(a.value);
}

function hasSignal(store: Store, h: Hearing): boolean {
  return h.candidates.some((cs) => cs.some((x) => x.concept && x.source === "Exact" && store.facts(x.concept, "Corrects").length > 0));
}

function unknownWords(h: Hearing, a: number, b2: number): string[] {
  const out: string[] = [];
  for (let i = a; i < b2; i++) if (h.candidates[i].every((x) => x.source === "Unknown")) out.push(h.tokens[i].text);
  return [...new Set(out)];
}

function toneOf(store: Store, h: Hearing): string[] {
  const out = new Set<string>();
  h.candidates.forEach((cs) => {
    for (const x of cs)
      if (x.concept && x.source !== "SpellDistance")
        for (const f of store.facts(x.concept, "Tone")) {
          const t = positional(f.claim as Call)[0];
          if (isCall(t)) out.add(t.head);
        }
  });
  return [...out];
}

export { Rewriter };
