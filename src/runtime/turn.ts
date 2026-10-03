// One turn (runtime.md section 2): Focus's candidate set, hearing, segments, the chart, readings
// rewritten toward a logical form and scored in two stages (the chart and rewriting, then a dry
// run with Suppose), the winner evaluated, and what it says realized and printed. Every choice is
// recorded with its candidates and features.

import { type Call, type Expr, c, isCall, isHead, key, positional, rewrite as mapExpr, role, s } from "./expr.js";
import { alike } from "./canonical.js";
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

/**
 * Learning a program on demand (design section 25): what the channel gives a session to learn a
 * tool from its documentation and keep it. Reading the documentation is a primitive's (Read of a
 * manual page, or of a program's help, held to reading); turning it into readings is the import's.
 */
export interface ToolLearner {
  /** Whether the graph has learned this program already. */
  known(program: string): boolean;
  /** Learn a program from its manual pages or its help, keep it, and load it into the store. */
  learn(program: string, how: "manual" | "help"): Promise<void>;
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
  onLearn?: (weights: Weights, changed: string[]) => void;
  /** Learning a program a request names that the graph does not know (design section 25). */
  tools?: ToolLearner;
  /** A request waiting for a program to be learned from its help, which was offered. */
  private pendingTool?: { program: string; text: string };
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

  /**
   * What was scheduled and has fallen due (Schedule; built-ins.md section 2), through a pure
   * primitive. The chat has no timer, so a due act is done at the start of the next turn: what it
   * says is said first, and it is taken off the schedule (retracted, so the record keeps it).
   */
  private async due(): Promise<Expr[]> {
    const read = this.primitives.get("Read");
    if (!read) return [];
    let schedule: Expr;
    try {
      schedule = await read.run([c("Schedule")], this.world);
    } catch {
      return [];
    }
    const out: Expr[] = [];
    for (const item of isCall(schedule) ? positional(schedule) : []) {
      const due = role(item, "due");
      const id = role(item, "item");
      if (!(due?.kind === "boolean" && due.value) || id?.kind !== "number") continue;
      out.push(c("Due", positional(item as Call)[0]));
      this.store.retract(id.value);
    }
    return out;
  }

  /**
   * Focus, phase 1 (runtime.md 11b): names in the workspace, through a pure primitive, one lookup
   * and at most the workspace's budget of candidates, recorded.
   */
  private async surroundings(conv: Conversation): Promise<string[]> {
    const read = this.primitives.get("Read");
    if (!read) return [];
    const budget = this.store.facts("Focus", "Budget").find((f) => isCall(f.claim) && isHead(positional(f.claim)[0], "Workspace"));
    const cap = budget && role(budget.claim, "candidates");
    let names: string[] = [];
    try {
      const dir = await read.run([s(".")], this.world);
      names = isCall(dir) ? positional(dir).flatMap((e) => (isCall(e) && positional(e)[0]?.kind === "string" ? [(positional(e)[0] as { value: string }).value] : [])) : [];
    } catch {
      return [];
    }
    conv.focus.lookups.set("Workspace", (conv.focus.lookups.get("Workspace") ?? 0) + 1);
    const kept = cap?.kind === "number" ? names.slice(0, cap.value) : names;
    conv.focus.log.push({ what: `focus: names in the workspace (${kept.length} of ${names.length})`, candidates: [], winner: -1 });
    return kept;
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
    conv.focus = { lookups: new Map(), log: [] };
    const record: TurnRecord = { index: conv.turnIndex, who: "User", text, heard: [], lf: [], said: [], reasons: [], tone: [], asides: [] };
    conv.turns.push(record);

    const due = opts.dry ? [] : await this.due();
    // A program the request names that the graph does not know is learned first, from its manual
    // page (reading documentation), or offered to be learned from its help (which runs it).
    const learning = opts.dry || !this.tools ? undefined : await this.learnPrograms(text, conv);
    const names = await this.surroundings(conv);
    const hearing = hear(this.store, text, { names });
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
    const chosen = learning?.offered ? [] : (segs[0] ?? []);
    if (segs.length > 1)
      record.reasons.push(choice("segmentation", segs.map((ss, i) => ({ label: `segmentation ${i + 1}: ${ss.length} segments`, features: [], score: segScore(ss) })), 0));

    const rewriter = new Rewriter(this.store, this.weights.get);
    const said: Expr[] = [...(learning?.said ?? [])];
    const words = new Map<string, string>();
    const allSteps: Step[] = [];
    let anything = !!learning?.offered;
    const choices: LastChoice[] = [];
    const acts: Expr[] = [];
    for (const seg of chosen) {
      const segText = textOf(text, hearing, seg.a, seg.b2);
      const top = await this.readings(seg.covers, seg.chart, rewriter, segText, conv);
      if (!top.length) continue;
      const win = top[0];
      // Two readings too close (design sections 9 and 23): when the best readings tie exactly and
      // lead to different acts, nothing says which was meant, so it asks instead of picking one.
      // The rival is the first tied reading whose act differs: ties among ways of saying the same
      // act are not a choice.
      const actsOf = (r: Reading) => ((r.features.get("ReachedAct") ?? 0) > 0 ? r.lfs : []).flatMap((lf) => [...walkCalls(lf)].filter((x) => this.primitives.has(x.head) && !this.primitives.get(x.head)!.pure));
      // Acts that run the same are one act: roles left on a primitive call are input it does not
      // take, two words for the same thing ("eggs", and "egg" in the plural) are one thing, and two
      // readings that differ only inside what is quoted ("to call mom", read two ways) do the same
      // thing, compared in the user's words.
      const given = (x: Expr): Expr => (isCall(x) ? { ...x, args: x.args.filter((a) => a.name === undefined) } : x);
      const inWords = (r: Reading) => {
        const w = new Map<string, string>();
        for (const e of r.cover.edges) collectWords(e, text, hearing, w);
        return actsOf(r).map((x) => key(this.inWords(given(x), w, r.steps))).join();
      };
      const differ = (r1: Reading, r2: Reading) => {
        const a = actsOf(r1), b2 = actsOf(r2);
        return (a.length !== b2.length || a.some((x, i) => !alike(this.store, given(x), given(b2[i])))) && inWords(r1) !== inWords(r2);
      };
      const runner = actsOf(win).length ? top.slice(1).find((r) => r.score === win.score && actsOf(r).length && differ(win, r)) : undefined;
      if (opts.ask !== false && runner) {
        const a = win.lfs.flatMap((lf) => [...walkCalls(lf)].filter((x) => this.primitives.has(x.head)))[0];
        const b2 = runner.lfs.flatMap((lf) => [...walkCalls(lf)].filter((x) => this.primitives.has(x.head)))[0];
        record.reasons.push(choice(`reading of "${segText}" (too close)`, [win, runner].map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), -1));
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
      const ev = new Evaluator(this.store, this.primitives, this.world, conv, opts.dry ? "Supposing" : "Doing", win.steps, segText, (x) => this.canSay(x), (x) => this.inWords(x, words, win.steps, true));
      const segSaid: Expr[] = [];
      let reached = false;
      for (const lf of win.lfs) {
        const o = await ev.run(lf);
        segSaid.push(...o.said);
        acts.push(...o.acts);
        if (o.reachedAct) reached = anything = true;
      }
      // Honest when stuck (design section 23): a segment nothing worked for says why once, and
      // the most useful why is a word it has no sense for, a need, or there being no source.
      const specific = segSaid.filter((x) => isCall(x) && x.head === "Unworked" && isCall(role(x, "because")) && ["NeedUnmet", "NoSource", "NoInverse"].includes((role(x, "because") as Call).head));
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
    // A program's help read on the user's yes is learned, and the request that named it read again.
    const rerun = opts.dry ? undefined : await this.learnFromHelp(conv, said);
    // What Focus pulled in, and why, is part of the turn's reasons (runtime.md 8.3 and 11b).
    record.reasons.push(...conv.focus.log);
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
    // Being stuck is said once, about the whole message, however many parts of it were stuck.
    const stuckSaid = said.filter((x) => isCall(x) && x.head === "Unworked" && !role(x, "because"));
    if (stuckSaid.length > 1) {
      const at = said.indexOf(stuckSaid[0]);
      const rest = said.filter((x) => !stuckSaid.includes(x));
      rest.splice(at, 0, c("Unworked", s(text.trim())));
      said.length = 0;
      said.push(...rest);
    }
    // The same answer from outside is said once, whichever part of the message asked for it.
    const seenFound = new Set<string>();
    for (let i = 0; i < said.length; i++) {
      const r = isCall(said[i]) && (said[i] as Call).head === "Outcome" ? role(said[i], "result") : undefined;
      if (!r || !isCall(r) || r.head !== "Found") continue;
      const k = key(positional(r)[0]);
      if (seenFound.has(k)) said.splice(i--, 1);
      else seenFound.add(k);
    }
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
    said.unshift(...due);
    const spoken = said.map((x) => this.inWords(x, words, allSteps));
    record.said = spoken;
    const out = spoken.map((x) => this.speaker.say(x, this.medium)).filter(Boolean).join("\n\n");
    conv.turns.push({ index: conv.turnIndex, who: "Self", text: out, heard: [], lf: [], said: spoken, reasons: [], tone: [], asides: [] });
    if (rerun !== undefined) {
      const again = await this.turn(rerun, opts);
      return { text: [out, again.text].filter(Boolean).join("\n\n"), record, acts: [...acts, ...again.acts] };
    }
    return { text: out, record, acts };
  }

  /**
   * The programs a request names that the graph has not learned: a word nothing knows, or a name
   * in backticks, that Read finds on the PATH. One with a manual page is learned from it now; one
   * without is offered to be learned from its help, since that runs it (held to reading).
   */
  private async learnPrograms(text: string, conv: Conversation): Promise<{ said: Expr[]; offered: boolean }> {
    const out = { said: [] as Expr[], offered: false };
    const read = this.primitives.get("Read");
    if (!read || !this.tools) return out;
    const h = hear(this.store, text, { names: [] });
    const named = new Set<string>();
    h.tokens.forEach((tok, i) => {
      if (h.candidates[i].every((x) => x.source === "Unknown")) named.add(tok.text);
    });
    // Code in the request (markup heard, design section 25b) is a name as written.
    for (const m of text.matchAll(/`([^`\s]+)[^`]*`/g)) named.add(m[1]);
    for (const name of named) {
      if (!/^[A-Za-z0-9_][\w.+-]*$/.test(name) || this.tools.known(name)) continue;
      let found: Expr;
      try {
        found = await read.run([c("Program", s(name))], this.world);
      } catch {
        continue;
      }
      const manual = role(found, "manual");
      if (manual?.kind === "boolean" && manual.value) {
        try {
          await this.tools.learn(name, "manual");
          out.said.push(c("Learned", s(name), ["from", c("ManPage")]));
        } catch (err) {
          conv.focus.log.push({ what: `learning ${name} from its manual page failed: ${err instanceof Error ? err.message : String(err)}`, candidates: [], winner: -1 });
        }
        continue;
      }
      const act = c("Read", c("Help", s(name)));
      conv.proposal = { act, ancestry: [act], untrusted: [], turn: conv.turnIndex };
      this.pendingTool = { program: name, text };
      out.said.push(c("Offer", act));
      out.offered = true;
      break;
    }
    return out;
  }

  /** After a yes to learning a program from its help: learn it, and give back the request to read again. */
  private async learnFromHelp(conv: Conversation, said: Expr[]): Promise<string | undefined> {
    const pending = this.pendingTool;
    if (!pending || !this.tools) return undefined;
    const isHelp = (x: Expr | undefined) => isHead(x, "Read") && isHead(positional(x as Call)[0], "Help");
    const ev = conv.events.find((e) => e.turn === conv.turnIndex && isHelp(e.act) && e.result);
    if (!ev) {
      // Not taken up: the offer lapses with the proposal.
      if (!conv.proposal || !isHelp(conv.proposal.act)) this.pendingTool = undefined;
      return undefined;
    }
    this.pendingTool = undefined;
    // What was read is not said: what was learned from it is.
    for (let i = said.length - 1; i >= 0; i--) if (isHead(said[i], "Outcome") && isHelp(positional(said[i] as Call)[0])) said.splice(i, 1);
    try {
      await this.tools.learn(pending.program, "help");
    } catch (err) {
      said.push(c("Outcome", ev.act, ["error", s(err instanceof Error ? err.message : String(err))]));
      return undefined;
    }
    said.push(c("Learned", s(pending.program), ["from", c("Help")]));
    return pending.text;
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
    if (kept) this.onLearn?.(this.weights, [...before.keys()]);
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
        const k = `${e.category}:${key(e.expr)}`;
        let alts: Alt[] | undefined = perEdge.get(k);
        if (!alts) {
          alts = [] as Alt[];
          for (const d of chart.variants(e).flatMap((v) => rewriter.normalize(v.expr).slice(0, this.opts.derivations))) {
            const o = await this.suppose({ lfs: [d.expr], steps: d.steps, features: d.features, score: 0, cover: cv }, segText, conv);
            const f2: Features = new Map(o.focus);
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

  private async suppose(r: Reading, segText: string, conv: Conversation = this.conversation): Promise<Outcome & { focus: Features }> {
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Supposing", r.steps, segText, (x) => this.canSay(x));
    let o: Outcome = { said: [], acts: [], reachedAct: false, unworked: 0, blocked: 0, checksPassed: 0 };
    for (const lf of r.lfs) {
      const x = await ev.run(lf);
      o = { said: [...o.said, ...x.said], acts: [...o.acts, ...x.acts], reachedAct: o.reachedAct || x.reachedAct, unworked: o.unworked + x.unworked, blocked: o.blocked + x.blocked, checksPassed: o.checksPassed + x.checksPassed };
    }
    return { ...o, focus: ev.focusFeatures() };
  }

  /** Whether the seed has words for this (a Reply to a social turn, say). */
  canSay(e: Expr): boolean {
    const before = key(e);
    const after = key(this.speaker.realize(e));
    return before !== after && !after.startsWith(before.split("(")[0] + "(");
  }

  /** Acts and referents are said in the words the user used for them, where there are some. */
  private inWords(e: Expr, words: Map<string, string>, steps: Step[], parts = false): Expr {
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
        // What is kept in the user's words (a reminder) is found as a whole even where its parts
        // were read on their own ("check the oven", whose "the oven" became a referent): with its
        // parts put back as they were heard.
        if (parts && isCall(y)) {
          const back = mapExpr(y, (z) => (z === y ? undefined : steps.find((st) => key(st.after) === key(z))?.before));
          if (key(back) !== k) stack.push(back);
        }
      }
      return undefined;
    };
    if (e.head === "Reply") return e;
    const said = (x: Expr): Expr | undefined => {
      // A primitive call is said by its own realization (a command line, a file's content).
      if (!isCall(x) || this.primitives.has(x.head) || x.head === "Constraint" || x.head === "BlockedBy" || x.head === "Reply") return undefined;
      // A question is said by its answer's realization, which is keyed on it ("From Wikipedia,
      // ..."). The kind a question asks for decides how its answer is said ("what day is it" is
      // said as a day), so it stays a kind, and the rest of that question is in the user's words.
      if (x.head === "Question") {
        const about = role(x, "about");
        if (!about || (isCall(about) && about.head === "Gap")) return undefined;
        return { ...x, args: x.args.map((a) => (a.name === "about" ? a : { ...a, value: mapExpr(a.value, said) })) };
      }
      const w = find(x);
      return w ? s(w) : undefined;
    };
    return { ...e, args: e.args.map((a) => ({ ...a, value: mapExpr(a.value, said) })) };
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
