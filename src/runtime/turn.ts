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

export const DEFAULT_TURN: TurnOptions = { stageTwo: 16, derivations: 4 };

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
  readonly weights: Weights;
  readonly speaker: Speaker;
  private medium: string;

  constructor(
    readonly store: Store,
    readonly primitives: ReadonlyMap<string, Primitive>,
    readonly world: World,
    readonly opts: TurnOptions = DEFAULT_TURN,
  ) {
    this.weights = new Weights(store);
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

  async turn(text: string): Promise<TurnResult> {
    const conv = this.conversation;
    conv.decay();
    const record: TurnRecord = { index: conv.turnIndex, who: "User", text, heard: [], lf: [], said: [], reasons: [], tone: [], asides: [] };
    conv.turns.push(record);

    const hearing = hear(this.store, text, { names: await this.surroundings() });
    record.tone = toneOf(this.store, hearing);

    // Segmentations: at most two, ranked by the score of their best covers (runtime.md 3.2).
    const segs = segmentations(this.store, hearing).map((ss) => ss.map(([a, b2]) => ({ a, b2, covers: new Chart(this.store, hearing, a, b2, this.weights.get).build().covers() })));
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
    for (const seg of chosen) {
      const segText = textOf(text, hearing, seg.a, seg.b2);
      const readings = this.readings(seg.covers, rewriter);
      if (!readings.length) continue;
      // Stage two: Suppose the top few, rerank (runtime.md 8.2).
      const top = readings.slice(0, this.opts.stageTwo);
      for (const r of top) {
        const o = await this.suppose(r, segText);
        const f2: Features = new Map();
        addFeature(f2, "ReachedAct", o.reachedAct ? 1 : 0);
        addFeature(f2, "Unworked", -o.unworked);
        addFeature(f2, "Blocked", o.blocked);
        addFeature(f2, "ChecksWouldPass", o.checksPassed);
        r.features = mergeFeatures(r.features, f2);
        r.score = scoreOf(r.features, this.weights.get);
      }
      top.sort((x, y) => y.score - x.score);
      const win = top[0];
      record.reasons.push(choice(`reading of "${segText}"`, top.map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), 0));
      record.heard.push(...win.cover.edges.map((e) => e.expr));
      record.lf.push(...win.lfs);
      for (const e of win.cover.edges) collectWords(e, text, hearing, words);
      allSteps.push(...win.steps);
      choices.push({ segText, readings: top, winner: win, words });
      const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Doing", win.steps, segText, (x) => this.canSay(x));
      const segSaid: Expr[] = [];
      let reached = false;
      for (const lf of win.lfs) {
        const o = await ev.run(lf);
        segSaid.push(...o.said);
        if (o.reachedAct) reached = anything = true;
      }
      // Honest when stuck (design section 23): a segment nothing worked for says why once, and
      // the most useful why is a word it has no sense for.
      if (!reached && segSaid.length && segSaid.every((x) => isCall(x) && x.head === "Unworked")) {
        const unknown = unknownWords(hearing, seg.a, seg.b2);
        said.push(...(unknown.length ? unknown.map((w) => c("NoSense", s(w))) : [c("Unworked", s(segText))]));
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
    if (!anything && this.last && hasSignal(this.store, hearing)) {
      const flipped = await this.correct(this.last, record);
      if (flipped) {
        said.length = 0;
        said.push(...flipped.said);
        anything = true;
        allSteps.push(...flipped.steps);
        for (const [k, w] of this.last.words) words.set(k, w);
      }
    }
    if (choices.length) this.last = choices[choices.length - 1];

    if (!said.length && !anything && text.trim()) said.push(c("Unworked", s(text.trim())));
    const spoken = said.map((x) => this.inWords(x, words, allSteps));
    record.said = spoken;
    const out = spoken.map((x) => this.speaker.say(x, this.medium)).filter(Boolean).join("\n\n");
    conv.turns.push({ index: conv.turnIndex, who: "Self", text: out, heard: [], lf: [], said: spoken, reasons: [], tone: [], asides: [] });
    return { text: out, record };
  }

  private async correct(last: LastChoice, record: TurnRecord): Promise<{ said: Expr[]; steps: Step[] } | undefined> {
    const was = last.winner.lfs.map(key).join(";");
    const alts = last.readings.filter((r) => r !== last.winner && r.lfs.map(key).join(";") !== was && (r.features.get("ReachedAct") ?? 0) > 0);
    const alt = alts.sort((a, b) => b.score - a.score)[0];
    if (!alt) return undefined;
    // The latent-variable perceptron's step (runtime.md 15), capped.
    this.weights.update(alt.features, last.winner.features);
    record.reasons.push(choice(`correction of "${last.segText}"`, [last.winner, alt].map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), 1));
    record.lf.push(...alt.lfs);
    const ev = new Evaluator(this.store, this.primitives, this.world, this.conversation, "Doing", alt.steps, last.segText, (x) => this.canSay(x));
    const said: Expr[] = [];
    for (const lf of alt.lfs) said.push(...(await ev.run(lf)).said);
    last.winner = alt;
    return { said, steps: alt.steps };
  }

  /** Stage one: covers, each edge rewritten, combined; scored by chart and rewriting features. */
  private readings(covers: Cover[], rewriter: Rewriter): Reading[] {
    const out: Reading[] = [];
    for (const cv of covers) {
      let combos: { lfs: Expr[]; steps: Step[]; features: Features }[] = [{ lfs: [], steps: [], features: cv.features }];
      for (const e of cv.edges) {
        const ds: Derivation[] = rewriter.normalize(e.expr).slice(0, this.opts.derivations);
        combos = combos.flatMap((cmb) => ds.map((d) => ({ lfs: [...cmb.lfs, d.expr], steps: [...cmb.steps, ...d.steps], features: mergeFeatures(cmb.features, d.features) }))).slice(0, 24);
      }
      for (const cmb of combos) out.push({ ...cmb, score: scoreOf(cmb.features, this.weights.get), cover: cv });
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

  private async suppose(r: Reading, segText: string): Promise<Outcome> {
    const ev = new Evaluator(this.store, this.primitives, this.world, this.conversation, "Supposing", r.steps, segText, (x) => this.canSay(x));
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
