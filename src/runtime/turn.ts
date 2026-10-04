// One turn (runtime.md section 2): Focus's candidate set, hearing, segments, the chart, readings
// rewritten toward a logical form and scored in two stages (the chart and rewriting, then a dry
// run with Suppose), the winner evaluated, and what it says realized and printed. Every choice is
// recorded with its candidates and features.

import { type Call, type Expr, c, isCall, isHead, key, n, positional, rewrite as mapExpr, role, s, v } from "./expr.js";
import { STRUCTURAL_NAMES } from "../structural.js";
import { alike } from "./canonical.js";
import { Chart, type Cover, type Edge } from "./chart.js";
import { Conversation, type TurnRecord } from "./conversation.js";
import { Evaluator, type Outcome } from "./evaluate.js";
import { hear, segmentations, type Hearing } from "./hear.js";
import type { Primitive, World } from "./primitive.js";
import { type Derivation, Rewriter, type Step } from "./rewrite.js";
import { type ChoicePoint, type Features, type LearnedBy, TUTOR, Weights, addFeature, mergeFeatures, scoreOf } from "./score.js";
import { Speaker } from "./speak.js";
import type { Store } from "./store.js";
import { parseTutor, tutorPrompt } from "./tutor.js";

export interface TurnOptions {
  /** Readings per segment taken to stage two (runtime.md 8.2; default 3, here a little wider). */
  stageTwo: number;
  /** Derivations per cover edge. */
  derivations: number;
}

export const DEFAULT_TURN: TurnOptions = { stageTwo: 16, derivations: 6 };

/** How many readings a numbered choice offers at most (a stated, tunable number). */
const CHOICES = 5;

interface Reading {
  lfs: Expr[];
  steps: Step[];
  features: Features;
  score: number;
  cover: Cover;
  /** A command ChatGPT suggested, as written: not a reading of the request, offered only in the numbered choice. */
  suggested?: string;
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
  /** The user turn it was made in, and what was said in it. */
  turn: number;
  text: string;
  /** What ChatGPT, asked as a tutor, picked for it, if it was asked. */
  tutor?: Tutored;
}

/** What the tutor said for a choice (design section 17): its pick among the options, and why. */
interface Tutored {
  options: Reading[];
  pick?: Reading;
  /** The command it suggested where none of the options was right: a candidate at trust 4, offered only in the numbered choice. */
  suggestion?: Reading;
  because: string;
  /** The facts its because was heard into, Pending until they prove out. */
  facts: number[];
}

/**
 * Try, offer, learn: what the assistant asked at the end of a turn, waiting for the next one. A
 * numbered choice of readings (a number picks one), or a step of a request nothing could do (the
 * user may give the command for it, in backticks). What the user picks or gives is kept.
 */
interface Waiting {
  /** The user turn it was asked after. */
  turn: number;
  /** The request, read again once a step of it is learned. */
  text: string;
  /** The readings offered, by number. */
  options: Reading[];
  /** The choice they came from: what the perceptron moves away from, and what was said. */
  from?: LastChoice;
  /** What a typed command is learned for: the step nothing could do. */
  meaning?: Call;
}

export class Session {
  readonly conversation = new Conversation();
  private last?: LastChoice;
  /** Called after learning changes the weights, so the channel can keep them (no file access here). */
  onLearn?: (weights: Weights, changed: string[], by: LearnedBy) => void;
  /**
   * ChatGPT as a tutor for choices (design section 17): asked, through Know, which reading was
   * meant where nothing else says. Absent, it is not asked (the config's "tutor": false).
   */
  tutor?: (question: string) => Promise<string | undefined>;
  /** How far a tutor's pick moves the weights, as a fraction of a correction's step (a config value). */
  tutorRate = 0.25;
  /** Learning a program a request names that the graph does not know (design section 25). */
  tools?: ToolLearner;
  /** A request waiting for a program to be learned from its help, which was offered. */
  private pendingTool?: { program: string; text: string };
  /** What the last turn asked, waiting for this one (the try, offer, learn loop). */
  private waiting?: Waiting;
  /**
   * How sure the top reading must be for its act to be done without asking (design section 9:
   * the cost of asking over the cost of a mistake, a stated parameter of the config). Below it,
   * the act is offered, whatever its effects allow.
   */
  askBelow = 0.5;
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
    // What the last turn asked is answered in this one, or lapses.
    const waiting = this.waiting && this.waiting.turn === record.index - 2 ? this.waiting : undefined;
    if (!opts.dry) this.waiting = undefined;
    // The right command, given in backticks, for what the last turn could not do or offered wrong.
    const typed = !opts.dry && waiting ? await this.typed(text, waiting, conv) : undefined;

    // Segmentations: at most two, ranked by the score of their best covers (runtime.md 3.2).
    const segs = segmentations(this.store, hearing).map((ss) =>
      ss.map(([a, b2]) => {
        const chart = new Chart(this.store, hearing, a, b2, this.weights.get).build();
        return { a, b2, chart, covers: chart.covers() };
      }),
    );
    const segScore = (ss: typeof segs[number]) => ss.reduce((n, x) => n + (x.covers[0]?.score ?? 0), 0);
    segs.sort((x, y) => segScore(y) - segScore(x));
    const chosen = learning?.offered || typed ? [] : (segs[0] ?? []);
    if (segs.length > 1)
      record.reasons.push(choice("segmentation", segs.map((ss, i) => ({ label: `segmentation ${i + 1}: ${ss.length} segments`, features: [], score: segScore(ss) })), 0));

    const rewriter = new Rewriter(this.store, this.weights.get, { mode: "Doing", beam: 6, maxSteps: 32, soft: true });
    const said: Expr[] = [...(learning?.said ?? []), ...(typed?.said ?? [])];
    const words = new Map<string, string>();
    const allSteps: Step[] = [];
    let anything = !!learning?.offered || !!typed;
    const choices: LastChoice[] = [];
    const acts: Expr[] = [];
    // A request read again once a suggestion picked from the numbered choice is taught.
    let pickedRerun: string | undefined;
    for (const seg of chosen) {
      const segText = textOf(text, hearing, seg.a, seg.b2);
      const top = await this.readings(seg.covers, seg.chart, rewriter, segText, conv);
      if (!top.length) continue;
      let win = top[0];
      // A number, said when a numbered choice is waiting, picks one of them (the loop).
      const number = waiting?.options.length && chosen.length === 1 ? top.map((r) => (r.lfs.length === 1 ? r.lfs[0] : undefined)).find((x) => x?.kind === "number") : undefined;
      if (waiting && number?.kind === "number" && Number.isInteger(number.value) && number.value >= 1 && number.value <= waiting.options.length) {
        // ChatGPT's suggestion, picked: the user gave that command, as if typed in backticks.
        const suggested = waiting.options[number.value - 1].suggested;
        if (suggested !== undefined) {
          const t = await this.typed(`\`${suggested}\``, waiting, conv);
          said.push(...(t?.said ?? [c("Unworked", s(suggested))]));
          pickedRerun = t?.rerun;
          anything = true;
          continue;
        }
        const picked = await this.pick(waiting, number.value - 1, record, conv);
        said.push(...picked.said);
        acts.push(...picked.acts);
        allSteps.push(...picked.steps);
        if (waiting.from) for (const [k, w] of waiting.from.words) words.set(k, w);
        anything = true;
        continue;
      }
      // Two readings too close (design sections 9 and 23): when the best readings tie exactly and
      // lead to different acts, nothing says which was meant, so it asks instead of picking one.
      // The rival is the first tied reading whose act differs: ties among ways of saying the same
      // act are not a choice.
      const actsOf = (r: Reading) => this.actsOf(r);
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
      // Asked as a numbered choice of every reading that does something different, so a number
      // answers it, and the answer is learned from (the loop). Readings that would be said the same
      // are one choice: the user cannot tell them apart, so neither can the question.
      const w = new Map<string, string>();
      for (const e of win.cover.edges) collectWords(e, text, hearing, w);
      const options = runner ? this.alternatives(top.filter((r) => r.score === win.score), [], w, differ) : [];
      // Where the top reading's act would be offered anyway, the offer is the question: a no to it
      // brings the others, numbered.
      const offered = options.length > 1 && (await this.suppose(win, segText, conv)).said.some((x) => isHead(x, "Offer"));
      const tie = opts.ask !== false && options.length > 1 && !offered;
      // How sure the winner is (design section 9): its probability among the readings that do
      // something different. Below the stated level its act is offered, whatever its effects allow.
      let sure = actsOf(win).length ? this.confidence(top, differ) : 1;
      // Where nothing says which reading was meant (a tie, or a winner below the level), ChatGPT is
      // asked as a tutor before the user is (design section 17). Its pick is taken for this turn
      // only where every option only reads or answers; otherwise it only orders the choice.
      const tutored = !opts.dry && this.tutor && (tie || sure < this.askBelow) ? await this.consult(text, segText, tie ? options : this.alternatives(top, [], w, differ), w, conv, record) : undefined;
      const took = tutored?.pick && tutored.options.every((r) => this.onlyReads(r, conv)) ? tutored.pick : undefined;
      if (tie && !took) {
        const listed = this.tutorFirst(options, tutored);
        record.reasons.push(choice(`reading of "${segText}" (too close)`, listed.map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), -1));
        for (const [k, x] of w) words.set(k, x);
        said.push(this.choicesOf(listed, tutored));
        if (!opts.dry) this.waiting = { turn: record.index, text, options: listed, from: { segText, readings: top, winner: win, words: w, turn: record.index, text, tutor: tutored } };
        anything = true;
        continue;
      }
      if (took) {
        win = took;
        sure = 1;
        said.push(c("Tutored", c("ChatGPT"), this.choiceAct(took)));
      }
      record.reasons.push(choice(`reading of "${segText}"`, top.map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), 0));
      record.heard.push(...win.cover.edges.map((e) => e.expr));
      record.lf.push(...win.lfs);
      for (const e of win.cover.edges) collectWords(e, text, hearing, words);
      allSteps.push(...win.steps);
      choices.push({ segText, readings: top, winner: win, words, turn: record.index, text, tutor: tutored });
      const ev = new Evaluator(this.store, this.primitives, this.world, conv, opts.dry ? "Supposing" : "Doing", win.steps, segText, (x) => this.canSay(x), (x) => this.inWords(x, words, win.steps, true));
      if (sure < this.askBelow) {
        ev.offerAll = true;
        record.reasons.push(choice(`not sure of "${segText}" (${sure.toFixed(2)} below ${this.askBelow}): offered`, [], -1));
      }
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
      const specific = segSaid.filter((x) => isCall(x) && x.head === "Unworked" && isCall(role(x, "because")) && ["NeedUnmet", "NoSource", "NoInverse", "NoReading"].includes((role(x, "because") as Call).head));
      // A step understood that nothing does is waiting to be taught: the user may give its command.
      const stuckOn = segSaid.map((x) => role(x, "because")).find((x) => isHead(x, "NoReading"));
      const step = isHead(stuckOn, "NoReading") ? positional(stuckOn)[0] : undefined;
      if (!opts.dry && isCall(step) && !STRUCTURAL_NAMES.has(step.head)) this.waiting = { turn: record.index, text, options: [], meaning: step };
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
    // So is a request whose step the user just gave the command for.
    const rerun = opts.dry ? undefined : ((await this.learnFromHelp(conv, said)) ?? typed?.rerun ?? pickedRerun);
    // What Focus pulled in, and why, is part of the turn's reasons (runtime.md 8.3 and 11b).
    record.reasons.push(...conv.focus.log);
    // A proposal not taken up this turn lapses (runtime.md 11: the last proposal).
    const permitted = record.lf.some((x) => key(x).includes("Permit("));
    // What a yes ran is said in the words it was asked for in.
    if (permitted && this.last) for (const [k, w] of this.last.words) if (!words.has(k)) words.set(k, w);
    if (!permitted && conv.proposal && conv.proposal.turn < record.index) conv.proposal = undefined;

    // A correction (design section 17): a turn that did nothing of its own and carries a correction
    // signal is about the last reading. Flip its choice point to the best alternative that reaches
    // an act, run that, and move the weights toward it and away from what was chosen.
    // A no to what the last turn offered: what else it could have meant is offered, numbered (the
    // loop). The no itself is said only where there is nothing else to offer.
    const declined = conv.declined;
    if (!opts.dry && declined?.turn === record.index + 1 && this.last && this.last.turn === declined.offered - 1) {
      const options = this.tutorFirst(this.alternatives(this.last.readings, [declined.act], this.last.words), this.last.tutor);
      if (options.length) {
        said.length = 0;
        said.push(this.choicesOf(options, this.last.tutor));
        for (const [k, w] of this.last.words) words.set(k, w);
        this.waiting = { turn: record.index, text: this.last.text, options, from: this.last };
        // What was chosen last is still what a number is picked against.
        choices.length = 0;
      }
    }
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
    // An offer waits for its answer too: a yes or a no, or the right command for it (in backticks,
    // or a flag of the command offered), kept as the user's correction.
    if (!opts.dry && !this.waiting && choices.length && said.some((x) => isHead(x, "Offer"))) this.waiting = { turn: record.index, text, options: [], from: this.last };

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
    // Two things that come out in the same words are said once.
    const out = [...new Set(spoken.map((x) => this.speaker.say(x, this.medium)).filter(Boolean))].join("\n\n");
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
    // More than one other thing it could have meant: they are offered, numbered, and the one
    // picked is learned from (the loop), rather than the next one guessed.
    const options = this.tutorFirst(this.alternatives(last.readings, this.actsOf(last.winner), last.words), last.tutor);
    if (options.length > 1) {
      this.waiting = { turn: record.index, text: last.text, options, from: last };
      return { said: [this.choicesOf(options, last.tutor)], steps: [] };
    }
    await this.learnWeights(alt, last.winner, record);
    record.reasons.push(choice(`correction of "${last.segText}"`, [last.winner, alt].map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), 1));
    record.lf.push(...alt.lfs);
    const ev = new Evaluator(this.store, this.primitives, this.world, this.conversation, "Doing", alt.steps, last.segText, (x) => this.canSay(x));
    const said: Expr[] = [];
    for (const lf of alt.lfs) said.push(...(await ev.run(lf)).said);
    last.winner = alt;
    return { said, steps: alt.steps };
  }

  /**
   * The latent-variable perceptron's step (runtime.md 15) toward the reading the user chose and away
   * from the one that was, capped, kept only if the replay gate passes.
   */
  private async learnWeights(good: Reading, bad: Reading, record: TurnRecord, by: LearnedBy = "user"): Promise<boolean> {
    const snapshot = this.gate ? this.weights.clone() : undefined;
    // A tutor's pick is a weak signal: a fraction of a correction's step, kept apart from the user's.
    const before = by === "tutor" ? this.weights.update(good.features, bad.features, this.tutorRate, this.tutorRate, "tutor") : this.weights.update(good.features, bad.features);
    const kept = !this.gate || !snapshot || (await this.gate(new Set(before.keys()), this.weights, snapshot));
    if (kept) this.onLearn?.(this.weights, [...before.keys()], by);
    else this.weights.revert(before, by);
    const what = kept ? `weights updated${by === "tutor" ? " (from ChatGPT's pick, weakly)" : ""}` : "weights update vetoed by the replay gate";
    record.reasons.push(choice(what, [...before.keys()].map((k) => ({ label: k, features: [], score: this.weights.get(k) })), -1));
    return kept;
  }

  /**
   * ChatGPT as a tutor (design section 17): asked which of the options was meant, with the request,
   * the conversation's last turns and the options said in plain words, never in N-Con. Its pick
   * moves the weights weakly (from ChatGPT, through the replay gate, never a weight the user
   * taught); its because is heard into proposals. A reply that does not parse is ignored.
   */
  private async consult(text: string, segText: string, options: Reading[], words: Map<string, string>, conv: Conversation, record: TurnRecord): Promise<Tutored | undefined> {
    if (!this.tutor || options.length < 2) return undefined;
    const said = options.map((r, i) => this.speaker.say(this.inWords(c("Choice", n(i + 1), this.choiceAct(r)), words, r.steps), this.medium));
    const turns = conv.turns.slice(0, -1).map((t) => ({ who: t.who, text: t.text }));
    const reply = parseTutor(await this.tutor(tutorPrompt(text, turns, said)).catch(() => undefined), options.length);
    if (!reply) {
      record.reasons.push(choice(`ChatGPT, asked about "${segText}", gave no answer in the asked shape`, [], -1));
      return undefined;
    }
    const pick = reply.choice ? options[reply.choice - 1] : undefined;
    record.reasons.push(choice(`ChatGPT's pick for "${segText}": ${reply.choice ?? "none"}, because ${reply.because}`, options.map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), pick ? options.indexOf(pick) : -1));
    // A command it suggested is a candidate as one the user typed would be, at its trust: it joins
    // the numbered choice and nothing else (never run or offered on its own).
    const argv = reply.suggest ? commandLine(reply.suggest) : [];
    const suggestion: Reading | undefined = argv.length ? { lfs: [c("Run", s(argv[0]), c("Args", ...argv.slice(1).map((a) => s(a))))], steps: [], features: new Map(), score: -Infinity, cover: options[0].cover, suggested: reply.suggest } : undefined;
    if (suggestion) record.reasons.push(choice(`ChatGPT suggested \`${reply.suggest}\` for "${segText}"`, [], -1));
    const t: Tutored = { options, pick, suggestion, because: reply.because, facts: pick ? this.propose(pick, reply.because, conv, record) : [] };
    if (pick) {
      const against = pick === options[0] ? options[1] : options[0];
      // What the replay gate passed has proved out (design section 20): the proposals are confirmed.
      if ((await this.learnWeights(pick, against, record, "tutor")) && this.gate) this.confirmTutor(t, record, "the replay gate passed");
    }
    return t;
  }

  /**
   * The tutor's because, heard by the same pipeline as a page's opening, into proposed facts on
   * what the picked reading means. Until they prove out they are kept as proposals, Pending, from
   * ChatGPT as a tutor (Proposes(about, claim) on Tutor), where nothing that reads the concept's
   * facts finds them.
   */
  private propose(pick: Reading, because: string, conv: Conversation, record: TurnRecord): number[] {
    const learner = this.world.know?.learner;
    const about = this.meaningOf(pick, conv)?.head ?? this.actsOf(pick)[0]?.head;
    if (!learner || !about) return [];
    const have = new Set([...this.store.facts(about).map((f) => key(f.claim)), ...this.store.facts("Tutor", "Proposes").map((f) => key(positional(f.claim as Call)[1]))]);
    const added = learner.claims(because).filter((x) => !have.has(key(x))).map((x) => this.store.addFact("Tutor", c("Proposes", c(about), x), TUTOR, { status: "Pending" }));
    if (added.length) record.reasons.push(choice("proposed from ChatGPT's because (pending)", added.map((f) => ({ label: key(f.claim), features: [], score: 0 })), -1));
    return added.map((f) => f.meta.id);
  }

  /** The tutor's proposals, proved out: each claim made a fact on what it is about (from ChatGPT), the proposal kept as confirmed. */
  private confirmTutor(t: Tutored, record: TurnRecord, why: string) {
    const confirmed: string[] = [];
    for (const id of t.facts) {
      const p = this.store.item(id);
      const [about, claim] = p?.kind === "fact" ? positional(p.claim as Call) : [];
      if (!isCall(about) || !claim) continue;
      this.store.addFact(about.head, claim, TUTOR);
      this.store.restore(id);
      confirmed.push(`${about.head}: ${key(claim)}`);
    }
    if (confirmed.length) record.reasons.push(choice(`ChatGPT's proposals confirmed (${why})`, confirmed.map((label) => ({ label, features: [], score: 0 })), -1));
    t.facts = [];
  }

  /** The tutor's pick first in a numbered choice, where it is one of them, and its suggestion last. */
  private tutorFirst(options: Reading[], t: Tutored | undefined): Reading[] {
    const ordered = t?.pick && options.includes(t.pick) ? [t.pick, ...options.filter((r) => r !== t.pick)] : options;
    return t?.suggestion ? [...ordered.slice(0, CHOICES - 1), t.suggestion] : ordered;
  }

  /** Whether a reading only reads or answers: each of its acts is pure, held to reading, or only reads. */
  private onlyReads(r: Reading, conv: Conversation): boolean {
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Supposing", r.steps);
    return this.actsOf(r).every((x) => ev.onlyReads(x));
  }

  /**
   * The acts a reading does: its calls to primitives that are not pure, where it reached an act.
   * One with a slot nothing filled (a Gap) is not done: it asks for what fills it.
   */
  private actsOf(r: Reading): Call[] {
    // Roles left on a primitive call are input it does not take ("saying ..." on a command): what
    // is in them is not an act of its own.
    const calls = function* (e: Expr, prims: ReadonlyMap<string, Primitive>): Generator<Call> {
      if (!isCall(e)) return;
      yield e;
      for (const a of e.args) if (a.name === undefined || !prims.has(e.head)) yield* calls(a.value, prims);
    };
    return ((r.features.get("ReachedAct") ?? 0) > 0 ? r.lfs : []).flatMap((lf) => [...calls(lf, this.primitives)].filter((x) => this.primitives.has(x.head) && !this.primitives.get(x.head)!.pure && ![...walkCalls(x)].some((y) => y.head === "Gap")));
  }

  /** Acts as a key: what each is given (roles left on a call are input it does not take). */
  private actsKey(acts: Expr[]): string {
    return acts
      .flatMap((x) => (isHead(x, "Sequence") ? positional(x) : [x]))
      .map((x) => key(isCall(x) ? { ...x, args: x.args.filter((a) => a.name === undefined) } : x))
      .join(";");
  }

  /**
   * The readings that do something different from each other and from the acts left out (what was
   * declined, or chosen and corrected), best first, a few at most: what the loop offers by number.
   */
  private alternatives(readings: Reading[], without: Expr[], words: Map<string, string>, differ?: (a: Reading, b: Reading) => boolean): Reading[] {
    const out: Reading[] = [];
    const left = this.actsKey(without);
    // Readings said the same are one choice: the user cannot tell them apart, so neither can the question.
    const shown = new Set<string>();
    // What was left out is not offered again, however it was reached.
    const acts = without.flatMap((x) => (isHead(x, "Sequence") ? positional(x) : [x]));
    if (acts.length) shown.add(this.speaker.say(this.inWords(c("Choice", n(1), acts.length === 1 ? acts[0] : c("Sequence", ...acts)), words, []), this.medium));
    for (const r of [...readings].sort((a, b2) => b2.score - a.score)) {
      const k = this.actsKey(this.actsOf(r));
      if (!k || k === left || out.some((o) => this.actsKey(this.actsOf(o)) === k || (differ && !differ(o, r)))) continue;
      const said = this.shown(r, words);
      if (shown.has(said)) continue;
      shown.add(said);
      out.push(r);
      if (out.length >= CHOICES) break;
    }
    return out;
  }

  /**
   * How likely the top reading is (design section 9; runtime.md 8.4): the softmax of the final
   * scores over what the readings would do, each different act (or answer) counted once at its
   * best reading.
   */
  private confidence(top: Reading[], differ: (a: Reading, b: Reading) => boolean): number {
    const win = top[0];
    const best = new Map<string, number>();
    for (const r of top) {
      if ((r.features.get("ReachedAct") ?? 0) <= 0) continue;
      const acts = this.actsOf(r);
      if (r !== win && acts.length && !differ(win, r)) continue;
      const k = r === win ? "win" : acts.length ? this.actsKey(acts) : "answer";
      if (k !== "win" && k === this.actsKey(this.actsOf(win))) continue;
      best.set(k, Math.max(best.get(k) ?? -Infinity, r.score));
    }
    let z = 0;
    for (const [k, sc] of best) if (k !== "win") z += Math.exp(sc - win.score);
    return 1 / (1 + z);
  }

  /** What a reading would be offered as, in a numbered choice: its act, or its acts in order. */
  private choiceAct(r: Reading): Expr {
    // Steps in order, what a command step printed given to the next as it will be (Output).
    const acts: Expr[] = [];
    for (const x of this.actsOf(r)) {
      const prev = acts.at(-1);
      const pointer = (y: Expr) => isHead(y, "Ref") && !role(y, "kind") && ![...walkCalls(role(y, "said") ?? y)].some((z) => z.args.some((a) => a.value.kind === "string"));
      acts.push(isHead(prev, "Run") ? mapExpr(x, (y) => (pointer(y) ? c("Output", prev) : undefined)) : x);
    }
    return acts.length === 1 ? acts[0] : acts.length ? c("Sequence", ...acts) : r.lfs[0];
  }

  /** How a reading's act would be said, in the user's words where there are some. */
  private shown(r: Reading, words: Map<string, string>): string {
    return this.speaker.say(this.inWords(c("Choice", n(1), this.choiceAct(r)), words, r.steps), this.medium);
  }

  /** A numbered choice, said: Choices(Sequence(Choice(1, act), Sequence(Choice(2, act), ...))). */
  private choicesOf(options: Reading[], t?: Tutored): Expr {
    // The tutor's pick is marked as its (Choice(n, act, by=ChatGPT())), and its suggestion as one (suggested=ChatGPT()).
    const mark = (r: Reading): [string, Expr][] => (r === t?.pick ? [["by", c("ChatGPT")]] : r.suggested !== undefined ? [["suggested", c("ChatGPT")]] : []);
    const items = options.map((r, i) => c("Choice", n(i + 1), this.choiceAct(r), ...mark(r)));
    const nest = (xs: Expr[]): Expr => (xs.length === 1 ? xs[0] : c("Sequence", xs[0], nest(xs.slice(1))));
    return c("Choices", nest(items));
  }

  /** What a request meant, where an act is learned for it: what led to its act, or the directive it was read as. */
  private meaningOf(r: Reading, conv: Conversation): Call | undefined {
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Doing", r.steps);
    for (const act of this.actsOf(r)) {
      const said = ev.saidOf(ev.ancestry(act));
      if (said) return said;
    }
    for (const lf of r.lfs) {
      const x = isHead(lf, "Directive") ? positional(lf)[0] : undefined;
      if (isCall(x) && !STRUCTURAL_NAMES.has(x.head)) return x;
    }
    return undefined;
  }

  /**
   * A number picked from the choice the last turn offered: the weights move toward it and away
   * from what was chosen (the perceptron); the user picked the very command, so the documentation
   * that led to it is confirmed (design section 20) and what they said is kept as meaning it (a
   * reading from the user); and it is done, or offered, as its effects allow.
   */
  private async pick(w: Waiting, i: number, record: TurnRecord, conv: Conversation): Promise<{ said: Expr[]; acts: Expr[]; steps: Step[] }> {
    const option = w.options[i];
    const from = w.from;
    const against = from && from.winner !== option ? from.winner : w.options.find((o) => o !== option);
    if (against) await this.learnWeights(option, against, record);
    // The user picked what the tutor picked: its proposals have proved out.
    if (from?.tutor && from.tutor.pick === option) this.confirmTutor(from.tutor, record, "the user picked the same");
    record.reasons.push(choice(`picked ${i + 1} for "${from?.segText ?? w.text}"`, w.options.map((r) => ({ label: r.lfs.map(key).join(" ; "), features: [...r.features], score: r.score })), i));
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Doing", option.steps, from?.segText ?? w.text, (x) => this.canSay(x));
    for (const act of this.actsOf(option)) {
      const ancestry = ev.ancestry(act);
      for (const k of ev.untrustedReadings(ancestry)) this.world.confirm?.(k);
      const said = ev.saidOf(ancestry);
      if (said) await ev.teach(said, { ...act, args: act.args.filter((a) => a.name === undefined) });
    }
    const out = { said: [] as Expr[], acts: [] as Expr[], steps: option.steps };
    for (const lf of option.lfs) {
      const o = await ev.run(lf);
      // A fragment beside the act that worked out nothing on its own is not said (as in a turn).
      out.said.push(...o.said.filter((x) => !(isHead(x, "Unworked") && !role(x, "because"))));
      out.acts.push(...o.acts);
    }
    if (from) {
      from.winner = option;
      this.last = from;
    }
    return out;
  }

  /**
   * The right command, given in backticks, after a choice the user did not want or a step nothing
   * could do: kept as what that request or step means (a reading from the user, its values
   * variables), and the request read again, so it goes on from there. The command line is read
   * into a program and its arguments, as written; the program must be there to run.
   */
  private async typed(text: string, w: Waiting, conv: Conversation): Promise<{ said: Expr[]; rerun?: string } | undefined> {
    const code = /`([^`]+)`/.exec(text)?.[1];
    if (!code) return this.flagged(text, w, conv);
    const argv = commandLine(code);
    const read = this.primitives.get("Read");
    if (!argv.length || !read) return undefined;
    try {
      await read.run([c("Program", s(argv[0]))], this.world);
    } catch {
      return undefined;
    }
    const said = w.meaning ?? (w.from ? this.meaningOf(w.from.winner, conv) : undefined);
    if (!said) return undefined;
    // What the step is done to, where the command given does not name it (a value said, or what
    // the step before printed), is the command's argument: "kill it", given `kill`, is kill with
    // it, whatever it is next time. The same as a documented command line that takes a positional
    // argument takes what its act is done to.
    const theme = role(said, "theme");
    const shown = theme?.kind === "number" ? String(theme.value) : theme?.kind === "string" ? theme.value : undefined;
    const named = shown !== undefined && argv.slice(1).some((a) => a.includes(shown));
    // (A referent the step is about, "the process", is what it finds or makes, not an argument.)
    const open = (isHead(theme, "Output") || shown !== undefined) && !named;
    const meaning = open ? ({ ...said, args: said.args.map((a) => (a.name === "theme" ? { ...a, value: v("it") } : a)) } as Call) : said;
    const act = c("Run", s(argv[0]), c("Args", ...argv.slice(1).map((a) => s(a)), ...(open ? [v("it")] : [])));
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Doing", [], w.text, (x) => this.canSay(x));
    // What the step before printed is what "it" is, there: a value said is not.
    const lesson = await ev.teach(meaning, act, open && isHead(theme, "Output") ? c("IsA", v("it"), c("Output")) : undefined);
    if (!lesson) return undefined;
    conv.focus.log.push({ what: `taught: ${key(lesson.pattern)} is ${key(lesson.becomes)}`, candidates: [], winner: -1 });
    return { said: [c("Taught", act)], rerun: w.text };
  }

  /**
   * Flags of the command offered, named instead of a whole command line ("no, use --squash"): the
   * command offered with them is what was meant, kept as the user's correction, and the request
   * read again. Only a flag the command's documentation lists for it counts: the command's
   * options are what can be added to it.
   */
  private async flagged(text: string, w: Waiting, conv: Conversation): Promise<{ said: Expr[]; rerun?: string } | undefined> {
    const flags = commandLine(text).map((x) => x.replace(/[.,;!?]+$/, "")).filter((x) => /^--?[A-Za-z][\w-]*(=\S+)?$/.test(x));
    const runs = w.from ? this.actsOf(w.from.winner) : [];
    const run = runs.length === 1 && isHead(runs[0], "Run") ? runs[0] : undefined;
    if (!flags.length || !run || !w.from) return undefined;
    const [program, argList] = positional(run);
    const args = isCall(argList) ? positional(argList) : [];
    // The command, by its words (the program and the words before any value), and the options its
    // documentation gives it.
    const words = [program, ...args].map((x) => (x?.kind === "string" ? x.value : ""));
    const options = new Set<string>();
    for (const st of w.from.winner.steps)
      for (const f of this.store.facts(st.owner, "Sense")) {
        const sense = positional(f.claim as Call)[0];
        if (!isCall(sense)) continue;
        const name = this.store.facts(sense.head, "Name").map((x) => positional(x.claim as Call)[0]).find((x) => x?.kind === "string");
        if (name?.kind !== "string" || name.value !== words.slice(0, name.value.split(" ").length).join(" ")) continue;
        for (const part of this.store.factsNaming(sense.head))
          if (isHead(part.claim, "PartOf") && this.store.facts(part.subject, "IsA").some((x) => isHead(positional(x.claim as Call)[0], "Option")))
            for (const n0 of this.store.facts(part.subject, "Name")) {
              const n1 = positional(n0.claim as Call)[0];
              if (n1?.kind === "string") options.add(n1.value);
            }
      }
    const given = flags.filter((x) => options.has(x.split("=")[0]) && !args.some((a) => a.kind === "string" && a.value === x));
    if (!given.length || given.length < flags.length) return undefined;
    const said = this.meaningOf(w.from.winner, conv);
    if (!said) return undefined;
    const act = c("Run", program, c("Args", ...args, ...given.map((x) => s(x))));
    const ev = new Evaluator(this.store, this.primitives, this.world, conv, "Doing", [], w.text, (x) => this.canSay(x));
    const lesson = await ev.teach(said, act);
    if (!lesson) return undefined;
    conv.focus.log.push({ what: `taught: ${key(lesson.pattern)} is ${key(lesson.becomes)}`, candidates: [], winner: -1 });
    return { said: [c("Taught", act)], rerun: w.text };
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

/**
 * A command line as the user wrote it, read into its words the way a shell splits them (quotes
 * group, and are not part of the word): the program and its arguments, never run through a shell.
 */
function commandLine(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
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
