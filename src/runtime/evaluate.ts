// Evaluation (runtime.md sections 7, 10 and 12; logical-form.md sections 2 and 7): each speech
// act has one rule. Directives plan and run their act under the standing rules and the guards;
// questions are answered; constraints are stored; assertions are checked or kept. Suppose runs the
// same evaluation with effectful primitives captured instead of applied. Everything the assistant
// says is handed to Say as structure (Outcome, Offer, Echo, the reasons it is stuck); the words
// are the seed's.

import { type Call, type Expr, c, isCall, isHead, key, n, positional, rewrite as mapExpr, role, s, v, walk } from "./expr.js";
import type { Conversation, StandingRule } from "./conversation.js";
import { match } from "./match.js";
import { GUARDED, type EffectClass, type Primitive, type World } from "./primitive.js";
import type { Mode, Step } from "./rewrite.js";
import type { Store } from "./store.js";
import { type Features, Weights, addFeature, mergeFeatures, scoreOf } from "./score.js";
import { isThing, things } from "./primitives/hold.js";
import { STRUCTURAL, STRUCTURAL_NAMES } from "../structural.js";
import { type Lesson, lessonsOf } from "./lesson.js";

/** What a primitive can be given inside its arguments: the structures primitives make, and blocks. */
const DATA: ReadonlySet<string> = new Set([...STRUCTURAL.primitiveResults.names, "Block", "Args"]);
/** The time heads of the logical form a primitive can be given (logical-form.md section 3.3), and
 * the set heads a duration can come in ("an hour" is Some(Hour()), "an hour and ten minutes" And). */
const TIME: ReadonlySet<string> = new Set(["Now", "At", "After", "Before", "Some", "And"]);

export interface Outcome {
  /** What would be or was said, in order. */
  said: Expr[];
  /** Effectful calls captured in Suppose, or run in Doing. */
  acts: Expr[];
  reachedAct: boolean;
  unworked: number;
  blocked: number;
  checksPassed: number;
}

/** A pure call inside an act's arguments that could not be worked out. */
class Failed extends Error {
  constructor(
    readonly call: Expr,
    message: string,
  ) {
    super(message);
  }
}

/** An act inside another's arguments that a standing rule forbids. */
class Blocked extends Error {
  constructor(
    readonly call: Expr,
    readonly rule: StandingRule,
  ) {
    super("blocked");
  }
}

/** Who each participant is, as the answer names them: the assistant itself, and the user. */
const PARTICIPANT = { Addressee: "Self", Speaker: "User" } as const;
const SPEECH_ACTS = new Set(["Question", "Assert", "Directive", "Advice", "Constraint"]);
/** Pure primitives Suppose may run, within this many calls (runtime.md 10.1). */
const SUPPOSE_CALLS = 20;

export class Evaluator {
  private calls = 0;
  /** Offer every act that is not pure, whatever its effects allow: its reading was chosen without confidence. */
  offerAll = false;
  /** Checks that passed for pure calls worked out inside other acts' arguments. */
  private innerChecks = 0;

  constructor(
    readonly store: Store,
    readonly primitives: ReadonlyMap<string, Primitive>,
    readonly world: World,
    readonly conversation: Conversation,
    readonly mode: Mode,
    /** The rewrite steps that led to the LF being evaluated, for rule checks on ancestors. */
    readonly steps: Step[] = [],
    /** What the user said, for the honest "I couldn't work out" (design section 23). */
    readonly said = "",
    /** Something the realizations can say (checked by the caller's Speaker). */
    readonly canSay: (e: Expr) => boolean = () => true,
    /** An expression in the words the user said it in, where there are some (the caller's). */
    readonly inWords?: (e: Expr) => Expr,
  ) {}

  private out(): Outcome {
    return { said: [], acts: [], reachedAct: false, unworked: 0, blocked: 0, checksPassed: 0 };
  }

  private merge(a: Outcome, b: Outcome): Outcome {
    return {
      said: [...a.said, ...b.said],
      acts: [...a.acts, ...b.acts],
      reachedAct: a.reachedAct || b.reachedAct,
      unworked: a.unworked + b.unworked,
      blocked: a.blocked + b.blocked,
      checksPassed: a.checksPassed + b.checksPassed,
    };
  }

  async run(lf: Expr): Promise<Outcome> {
    if (!isCall(lf)) return this.stuck(lf);
    switch (lf.head) {
      case "Constraint":
        return this.constraint(lf);
      case "Directive":
        return this.directive(positional(lf)[0]);
      case "Question":
        return this.question(lf);
      case "Assert":
        return this.assert(positional(lf)[0]);
      case "Advice":
        return this.stuck(lf);
      case "Aside":
        return this.out();
      case "If":
        return this.conditional(lf);
      case "And":
      case "Then": {
        let o = this.out();
        for (const x of positional(lf)) o = this.merge(o, await this.run(x));
        return o;
      }
    }
    // No speech act: a social turn gets its reply if the seed has one, else nothing is run. The
    // reply is the turn's answer (runtime.md 8.2: an act or an answer), so a reading that has one
    // does not rest on Unworked alone to beat an imported sense that has none.
    const reply = c("Reply", lf);
    if (this.canSay(reply)) return { ...this.out(), said: [reply], reachedAct: true };
    return this.stuck(lf);
  }

  private stuck(e: Expr, because?: Expr): Outcome {
    const what = this.said ? s(this.said) : e;
    return { ...this.out(), said: [because ? c("Unworked", what, ["because", because]) : c("Unworked", what)], unworked: 1 };
  }

  // -------------------------------------------------------------------------------------------
  // Constraint: store it as a standing rule for its scope; run nothing now.

  private constraint(lf: Call): Outcome {
    const [rule] = positional(lf);
    // A rule against the proposal ("no" after an offer) declines it; with nothing proposed it is
    // not a rule about anything, and the turn is left to the correction operation.
    const target = isCall(rule) ? positional(rule)[0] : undefined;
    if (isHead(target, "Ref") && isHead(role(target, "kind"), "Proposal")) {
      const prop = this.conversation.proposal;
      if (!prop) return { ...this.out(), unworked: 1 };
      if (this.mode === "Doing") {
        this.conversation.proposal = undefined;
        // Kept, so the turn can offer what else it could have meant (the try, offer, learn loop).
        this.conversation.declined = { act: prop.act, offered: prop.turn, turn: this.conversation.turnIndex };
      }
      return { ...this.out(), said: [c("Echo", c("Constraint", c("Not", prop.act)))], reachedAct: true };
    }
    const until = role(lf, "until");
    const over = role(lf, "over");
    const sr: StandingRule = { rule, until, over, from: c("Turn", { kind: "number", value: this.conversation.turnIndex, pos: { line: 0, column: 0 } }) };
    if (this.mode === "Doing") this.conversation.rules.push(sr);
    const echo = c("Constraint", rule, ...(until ? ([["until", until]] as [string, Expr][]) : []), ...(over ? ([["over", over]] as [string, Expr][]) : []));
    return { ...this.out(), said: [c("Echo", echo)], reachedAct: true };
  }

  // -------------------------------------------------------------------------------------------
  // Directive: plan and run the act.

  private async directive(a: Expr): Promise<Outcome> {
    if (isHead(a, "Permit")) return this.permit(positional(a)[0]);
    if (isHead(a, "Undo")) return this.undo(a);
    if (isHead(a, "Then") || isHead(a, "And") || isHead(a, "Sequence")) return this.sequence(positional(a));
    if (isHead(a, "If")) return this.conditional(a);
    const blocked = this.blockedBy(a);
    if (blocked) {
      // A rule that waits to be told ("not yet", "not without asking") asks: what it blocked is
      // proposed, so a yes lifts the rule and does it (logical-form.md section 7).
      if (this.mode === "Doing" && blocked.rule.until && isHead(blocked.rule.until, "Told"))
        this.conversation.proposal = { act: a, ancestry: this.ancestry(a), untrusted: this.untrustedReadings(this.ancestry(a)), turn: this.conversation.turnIndex };
      return { ...this.out(), said: [c("Echo", c("BlockedBy", a, blocked.rule.until ? c("Constraint", blocked.rule.rule, ["until", blocked.rule.until]) : c("Constraint", blocked.rule.rule)))], blocked: 1, reachedAct: true };
    }
    const prim = this.primitiveCall(a);
    if (!prim) {
      const reply = c("Reply", a);
      if (this.canSay(reply)) return { ...this.out(), said: [reply], reachedAct: true };
      return this.stuck(a, c("NoReading", a));
    }
    const o = await this.call(prim.p, prim.args, a);
    // Told to make something hold (logical-form.md 3.1), a check that finds it does not hold has
    // not done what was asked: nothing made it hold.
    const r = prim.p.pure ? o.said.map((x) => role(x, "result")).find((x) => x?.kind === "boolean") : undefined;
    if (r?.kind === "boolean" && !r.value) return { ...o, said: [], reachedAct: false, unworked: o.unworked + 1 };
    return o;
  }

  private async sequence(steps: Expr[]): Promise<Outcome> {
    let o = this.out();
    let ran: Expr | undefined;
    for (const st0 of steps) {
      // What a command step printed is what the next step points at ("find the process on port
      // 8080 and kill it": it is the pid the first step printed): Output(the step's act), a
      // structure worked out when the step has run, never text pasted into the next command.
      const st = ran ? mapExpr(st0, (x) => (this.pointer(x) ? c("Output", ran!) : undefined)) : st0;
      const r = await this.directive(st);
      o = this.merge(o, r);
      // A failed step or a block stops the plan (runtime.md 10.2). A step that is offered is not
      // run, so later steps are offered with it, as one proposal: the user says yes to the plan.
      if (r.unworked || r.blocked) break;
      const last = r.acts.at(-1);
      ran = isHead(last, "Run") ? last : undefined;
    }
    return o;
  }

  /** A referent that only points ("it"): no kind, and no name said. */
  private pointer(x: Expr): boolean {
    return isHead(x, "Ref") && !role(x, "kind") && ![...walk(role(x, "said") ?? x)].some((y) => y.kind === "string");
  }

  private async conditional(lf: Call): Promise<Outcome> {
    const [cond] = positional(lf);
    const then = role(lf, "then");
    const otherwise = role(lf, "else");
    const holds = await this.decide(cond);
    if (holds === undefined) return this.stuck(cond, c("NeedUnmet", cond));
    const branch = holds ? then : otherwise;
    if (!branch) return { ...this.out(), reachedAct: true };
    return SPEECH_ACTS.has((branch as Call).head) ? this.run(branch) : this.directive(branch);
  }

  /** Decide a proposition with pure primitives only, or not at all. */
  private async decide(p: Expr): Promise<boolean | undefined> {
    const prim = this.primitiveCall(p);
    if (!prim || !this.pureFor(prim.p, p)) return undefined;
    try {
      const r = await prim.p.run(await Promise.all(prim.args.map((x) => this.value(x))), this.world, this.held(prim.p, p));
      return r.kind === "boolean" ? r.value : undefined;
    } catch {
      return undefined;
    }
  }

  private async permit(x: Expr): Promise<Outcome> {
    // Permission lifts every rule that waits for it and blocks what was permitted (logical-form 7).
    const target = this.resolveProposal(x);
    if (this.mode === "Doing")
      for (let i = this.conversation.rules.length - 1; i >= 0; i--) {
        const r = this.conversation.rules[i];
        if (r.until && isHead(r.until, "Told") && target && this.ruleMatches(r, target)) this.conversation.rules.splice(i, 1);
      }
    const prop = this.conversation.proposal;
    // A second go-ahead in the same turn ("ok, go ahead") has nothing left to permit; it is not stuck.
    if (!prop && this.conversation.permittedTurn === this.conversation.turnIndex) return { ...this.out(), reachedAct: true };
    if (!prop || !target) return this.stuck(x, c("NeedUnmet", c("Proposal")));
    if (this.mode === "Doing") this.conversation.permittedTurn = this.conversation.turnIndex;
    if (this.mode === "Doing") this.conversation.proposal = undefined;
    // The user's yes is a level 1 grant for what was offered (runtime.md 12); several acts offered
    // together run in order, stopping at the first that fails.
    let o = this.out();
    // What the user confirmed is trusted from now on: readings from documentation that led to it
    // need no confirmation again (design section 20).
    if (this.mode === "Doing") for (const k of prop.untrusted ?? []) this.world.confirm?.(k);
    for (const act of isHead(prop.act, "Sequence") ? positional(prop.act) : [prop.act]) {
      // A rule said since the offer still holds: a yes does not lift a prohibition it does not name.
      const blocked = this.blockedBy(act, [...prop.ancestry, act]);
      if (blocked) return this.merge(o, { ...this.out(), said: [c("Echo", c("BlockedBy", act, c("Constraint", blocked.rule.rule)))], blocked: 1, reachedAct: true });
      const prim = this.primitiveCall(act);
      if (!prim) return this.merge(o, this.stuck(act, c("NoReading", act)));
      const r = await this.call(prim.p, prim.args, act, true);
      // A command the user said yes to, that documentation led to, is how they say it from now on.
      if (prop.untrusted?.length) await this.rememberCommand(act, prop.ancestry);
      o = this.merge(o, r);
      if (r.unworked || r.checksPassed === 0) break;
    }
    return o;
  }

  /**
   * What the user said, and the command line it came to, kept as the user's own reading (design
   * section 17: a reading made only of existing concepts, from the user, level 1), so the next time
   * it is said, or said of another value, the same command, flags and argument places come back
   * without being worked out again. A value said in the request and given to the command (a
   * number, a name) becomes a variable; where it was said with a noun ("pr 1748"), the value said
   * alone ("approve 1760") is kept too, wanting a value of the same kind. Through Remember, the
   * path everything the user teaches takes; it changes nothing that runs (a Run is guarded by its
   * effects whoever's reading led to it).
   */
  private async rememberCommand(act: Expr, ancestry: Expr[]): Promise<void> {
    const said = this.saidOf(ancestry);
    if (this.mode !== "Doing" || !said || !isHead(act, "Run")) return;
    await this.teach(said, { ...act, args: act.args.filter((a) => a.name === undefined) });
  }

  /** What the user said an act came from: the expression just before it that is neither a primitive call nor structure. */
  saidOf(ancestry: Expr[]): Call | undefined {
    const said = ancestry.slice(1).find((x) => isCall(x) && !this.primitives.has(x.head) && !STRUCTURAL_NAMES.has(x.head));
    return isCall(said) ? said : undefined;
  }

  /**
   * Keeps what the user taught: readings from what they said to the act (lesson.ts), through
   * Remember, the path everything the user teaches takes. A reading already there is not kept
   * twice. Returns the main lesson, where one was kept or was there.
   */
  async teach(said: Call, act: Expr, wants?: Expr): Promise<Lesson | undefined> {
    const remember = this.primitives.get("Remember");
    if (this.mode !== "Doing" || !remember) return undefined;
    // The kind a role names, where the graph has it ("pr 1748": the role number wants a Number).
    const kind = (r: string) => {
      const k = r[0].toUpperCase() + r.slice(1);
      return this.store.has(k) ? k : undefined;
    };
    let main: Lesson | undefined;
    for (const l0 of lessonsOf(said, act, kind)) {
      const l = wants && !l0.wants ? { ...l0, wants } : l0;
      const there = this.store.readingsOn(l.pattern.head).some((r) => key(r.pattern) === key(l.pattern) && r.becomes !== undefined && key(r.becomes) === key(l.becomes));
      if (there) {
        main ??= l;
        continue;
      }
      try {
        await remember.run([c("Rewrite", l.pattern, l.becomes, ...(l.wants ? ([["wants", l.wants]] as [string, Expr][]) : []))], this.world);
        main ??= l;
      } catch {
        // Not something to keep (a function word, a primitive): the act still stands.
      }
    }
    return main;
  }


  /**
   * Undo (built-ins.md section 2; design section 26b): the last act of this conversation that
   * changed something, and was not undone, is reversed by the inverse recorded with it, run as any
   * act is (under the rules and the guards, and checked). An inverse that is guarded is offered
   * instead; an act with no inverse is said so.
   */
  private async undo(a: Call): Promise<Outcome> {
    const events = this.conversation.events;
    let at = -1;
    for (let i = events.length - 1; i >= 0 && at < 0; i--) if (events[i].effectful && !events[i].undone && !events[i].error) at = i;
    const ev = events[at];
    // Nothing to take back, or nothing that undoes it, is the answer: said, and not a correction of
    // the last reading (the user asked to undo an act, not to read the last message again).
    if (!ev) return { ...this.stuck(a, c("NoInverse")), reachedAct: true };
    const inverse = ev.undo;
    const prim = inverse && this.primitiveCall(inverse);
    if (!inverse || !prim) return { ...this.stuck(a, c("NoInverse", ev.act)), reachedAct: true };
    const before = events.length;
    const o = await this.call(prim.p, prim.args, inverse);
    if (this.mode === "Doing" && events.length > before) {
      // Done: the act is undone, and the undoing is not itself what the next "undo" takes back.
      ev.undone = !events[before].error;
      events[before].undone = true;
    }
    const wrap = (x: Expr): Expr => {
      if (isCall(x) && x.head === "Offer") return c("Outcome", c("Undo", ev.act));
      if (isCall(x) && x.head === "Outcome" && key(positional(x)[0]) === key(inverse)) return { ...x, args: [{ value: c("Undo", ev.act) }, ...x.args.slice(1)] };
      return x;
    };
    return { ...o, said: o.said.map(wrap) };
  }

  private resolveProposal(x: Expr): Expr | undefined {
    const kind = role(x, "kind");
    if (isHead(x, "Ref") && isHead(kind, "Proposal")) return this.conversation.proposal?.act;
    if (isHead(x, "Ref")) return this.conversation.proposal?.act;
    return x;
  }

  /**
   * Referents (logical-form.md section 4; design section 16): a referent whose words name
   * something (a literal) is that; otherwise it is the best of its candidates (referent). A
   * referent nothing fits stays a referent: the act stays unworked, unless its primitive makes the
   * thing (a list the user starts by adding to it).
   */
  resolve(e: Expr): Expr {
    return mapExpr(e, (x) => {
      // A quotation keeps what was said: an act kept to be said later ("remind me to call mom")
      // is kept in the user's words.
      // Nothing inside a quotation is resolved: it is what was said.
      if (isHead(x, "Quote")) {
        const q = this.inWords && positional(x)[0]?.kind !== "string" ? this.inWords(x) : x;
        return isHead(q, "Quote") && positional(q)[0]?.kind === "string" ? q : x;
      }
      if (!isHead(x, "Ref")) return undefined;
      // A referent of a kind that is worked out by reading alone is what that gives: a command
      // that only shows something is named by what it shows ("the git log" is what git log shows).
      const kind = role(x, "kind");
      if (isCall(kind) && this.pureCall(kind)) return kind;
      // A referent said by its name ("the README.md") is the name; a string deeper in what was
      // said ("the boiling point of water in celsius") is a word it was said with, not its name.
      const said = role(x, "said");
      const named = said?.kind === "string" ? said : isCall(said) ? positional(said).find((y) => y.kind === "string") : undefined;
      if (named) return named;
      return this.referent(x) ?? x;
    });
  }

  private weights?: Weights;

  /**
   * A referent's candidates (design sections 14b and 16): what is in play, and the user's things in
   * the graph, kept across sessions. Each is scored: by kind (WantedKind, minus how far up the
   * candidate's kinds, as a noun, the kind it was said as is; a thing that is not of that kind is not a
   * candidate, nor is a literal an act found to be of another kind, and a literal whose kind the graph
   * does not know counts as far), by the words it was
   * said with (Match:Said, "my shopping list" again), and by where it came from, with its salience
   * (FocusSource). Ties go to the more salient, then the more recent.
   */
  private referent(ref: Call): Expr | undefined {
    const kind = role(ref, "kind");
    const said = role(ref, "said");
    const cands: { expr: Expr; salience: number; source: string; kind?: string }[] = [];
    // Each source gives at most its budget of candidates: the most salient, then the most recent,
    // kept in the order they came (runtime.md 11b).
    const inPlay = [...this.conversation.inPlay.values()];
    const salient = new Set(inPlay.map((v, i) => ({ v, i })).sort((x, y) => y.v.salience - x.v.salience || y.i - x.i).slice(0, this.budget("CurrentConversation", "candidates")).map((x) => x.v));
    for (const v of inPlay) if (salient.has(v)) cands.push({ expr: v.expr, salience: v.salience, source: "CurrentConversation", kind: v.kind });
    // The user's things are the speaker's: "your name" (of the addressee) is none of them.
    const of = role(ref, "of");
    if (!of || isHead(of, "Speaker")) {
      const mine = things(this.store);
      for (const t of mine.slice(Math.max(0, mine.length - this.budget("UserFacts", "candidates")))) if (!cands.some((x) => key(x.expr) === key(t))) cands.push({ expr: t, salience: 0, source: "UserFacts" });
    }
    const scored: { expr: Expr; source: string; score: number; f: Features }[] = [];
    this.weights ??= new Weights(this.store);
    let best: { expr: Expr; score: number; salience: number; f: Features } | undefined;
    for (const cand of cands) {
      const f: Features = new Map();
      if (isCall(kind)) {
        // What "the list" points at is a list: the referent's kind is one of the candidate's kinds.
        const kindOf = isCall(cand.expr) ? cand.expr.head : cand.kind;
        const d = kindOf ? this.store.kinds(kindOf, "Noun").get(kind.head) : undefined;
        if (d === undefined && kindOf) continue;
        addFeature(f, "WantedKind", -Math.min(d ?? 4, 4));
      }
      if (said && isCall(cand.expr) && this.store.facts(cand.expr.head, "Said").some((x) => key(positional(x.claim as Call)[0]) === key(said))) addFeature(f, "Match:Said", 1);
      // One of the user's things kept from before is meant only when it is named as it was said, or
      // by its kind or the one above it ("the list" for the shopping list, two steps up): "that" is not
      // the user's name, nor is "the git status" (a name is a status only far up WordNet).
      if (cand.source === "UserFacts" && !f.get("Match:Said") && (!isCall(kind) || kind.head === "Thing" || (f.get("WantedKind") ?? 0) < -2)) continue;
      addFeature(f, `FocusSource:${cand.source}`, cand.salience);
      const score = scoreOf(f, this.weights.get) + (f.get("Match:Said") ?? 0) * 1e-6;
      scored.push({ expr: cand.expr, source: cand.source, score, f });
      if (!best || score > best.score || (score === best.score && cand.salience > best.salience)) best = { expr: cand.expr, score, salience: cand.salience, f };
    }
    // How well what was chosen fits its kind is part of the reading that chose it (runtime.md 8.1:
    // Focus's candidates are scored with the rest): "the git log" is not the folder last read.
    const fit = best?.f.get("WantedKind");
    if (fit) this.focus.set(key(ref), new Map([["FocusFit", fit]]));
    // Recorded (runtime.md 11b): what was pulled in for this referent, from where, and what won.
    const what = `focus: the referent ${key(ref)}`;
    const log = this.conversation.focus.log;
    if (this.mode === "Doing" && !log.some((x) => x.what === what))
      log.push({ what, candidates: scored.map((x) => ({ label: `${x.source}: ${key(x.expr)}`, features: [...x.f], score: x.score })), winner: best ? scored.findIndex((x) => x.expr === best!.expr) : -1 });
    return best?.expr;
  }

  /**
   * The turn's budget for a Focus source (runtime.md 11b): its lookups, or the candidates it gives
   * one search, from the policies' Budget facts on Focus. A source with none is unbounded.
   */
  private budget(source: string, what: "lookups" | "candidates"): number {
    for (const f of this.store.facts("Focus", "Budget")) {
      if (!isCall(f.claim) || !isHead(positional(f.claim)[0], source)) continue;
      const n = role(f.claim, what);
      if (n?.kind === "number") return n.value;
    }
    return Infinity;
  }

  /** The features of the referents this evaluation chose, one set per referent. */
  private focus = new Map<string, Features>();

  /** What choosing referents added to the reading's score. */
  focusFeatures(): Features {
    let out: Features = new Map();
    for (const f of this.focus.values()) out = mergeFeatures(out, f);
    return out;
  }

  private primitiveCall(a0: Expr): { p: Primitive; args: Expr[] } | undefined {
    if (!isCall(a0)) return undefined;
    const p = this.primitives.get(a0.head);
    if (!p) return undefined;
    const a = this.resolve(a0) as Call;
    // Input the primitive does not take is left over (and counted as unworked). What must never be
    // dropped is a word that limits what may run: one whose readings make a prohibition, a
    // restriction or a condition ("never", "yet", "only", "unless") would be silently ignored
    // (AGENTS.md rule 8b), so a call with one left on it does not run.
    const left = a.args.filter((x) => x.name !== undefined && x.name !== "agent" && x.name !== "instrument");
    if (left.some((x) => [...walk(x.value)].some((y) => isCall(y) && this.limits(y.head)))) return undefined;
    // An act told in the past or the future ("I pushed it") is a report or a plan, not something to
    // do now (logical-form.md 3.3: time is an index on the act).
    if (left.some((x) => x.name === "time" && isCall(x.value) && x.value.head !== "Now")) return undefined;
    const args = positional(a);
    if (args.length !== p.params.length) return undefined;
    // A primitive is given data: no variable, gap or referent left, and no concept that is still a
    // word (an unresolved "file" is not something a primitive can be given). A thing in the graph
    // is data. A parameter that takes concepts takes words as they are ("milk" on a list), and one
    // that makes things takes a referent nothing fits yet.
    // A rewrite to remember is expressions by nature, kept as they are, like a quotation.
    // A pure primitive's call among the arguments is data once its own arguments are: it is
    // worked out first (the value of "17 times 23" is what Compare or a question is given). Where a
    // primitive takes a time, a time is data too (logical-form.md 3.3: Now, At, After, Before),
    // counted in units whose length is known (a Lasts fact).
    const unready = (y: Expr, concepts: boolean, makes: boolean, time = false): boolean => {
      if (y.kind === "variable") return true;
      if (!isCall(y)) return false;
      if (y.head === "Rewrite" || y.head === "Quote" || y.head === "Output") return false;
      if (y.head === "Ref") return !makes;
      if (y.head === "Gap") return true;
      const data = DATA.has(y.head) || isThing(this.store, y) || this.pureCall(y) || (time && (TIME.has(y.head) || this.store.facts(y.head, "Lasts").length > 0));
      if (!concepts && !data) return true;
      return y.args.some((x) => unready(x.value, concepts, makes, time));
    };
    // An act a primitive keeps for later (Schedule's) is a primitive call; what it is given is
    // kept as it was said, a quotation in the user's words, to be read when its time comes.
    const plan = (y: Expr): Expr | undefined => {
      if (!isCall(y) || !this.primitives.has(y.head)) return undefined;
      const kept = positional(y).map((x) => (unready(x, false, false) ? (isHead(x, "Quote") ? x : (this.resolve(c("Quote", x)) as Call)) : x));
      return c(y.head, ...kept);
    };
    const ready: Expr[] = [];
    for (let i = 0; i < args.length; i++) {
      const name = p.params[i];
      // An act is not what an act is done with: "run git status" does not run a program named by
      // the command git status.
      if (p.instruments?.includes(name) && isCall(args[i]) && this.primitives.get((args[i] as Call).head)?.pure === false) return undefined;
      const x = p.plans?.includes(name)
        ? plan(positional(a0 as Call)[i])
        : unready(args[i], !!p.concepts?.includes(name), !!p.makes?.includes(name), !!p.times?.includes(name))
          ? undefined
          : args[i];
      if (x === undefined) return undefined;
      ready.push(x);
    }
    return { p, args: ready };
  }

  /** A call to a pure primitive with the arguments it takes, and no others. */
  private pureCall(y: Call): boolean {
    const p = this.primitives.get(y.head);
    return !!p && this.pureFor(p, y) && y.args.every((a) => a.name === undefined) && y.args.length === p.params.length;
  }

  /**
   * The effects the readings that led to an act claim for it (ncon.md section 4: an acting
   * reading's effects narrow its primitive's), when the primitive can hold the call to them as it
   * runs. A claim it cannot hold is not used: the primitive's own effects apply, whatever a reading
   * from documentation says (design section 20).
   */
  private held(p: Primitive, act: Expr): EffectClass[] | undefined {
    if (!p.holds) return undefined;
    const keys = new Set(this.ancestry(act).map(key));
    const claimed = new Set<EffectClass>();
    for (const st of this.steps) if (keys.has(key(st.after))) for (const e of st.effects) if (isCall(e)) claimed.add(e.head as EffectClass);
    const effects = [...claimed];
    return effects.length && p.holds(effects, this.world) ? effects : undefined;
  }

  /** Whether this call only reads: its primitive is pure, or it is held to reading. */
  private pureFor(p: Primitive, act: Expr): boolean {
    return p.pure || (this.held(p, act)?.every((e) => e === "Reads") ?? false);
  }

  /** An argument with the pure primitive calls inside it worked out, innermost first. */
  private async value(x: Expr): Promise<Expr> {
    // What a step printed, once it has run: its output as content (a block), or nothing said.
    if (isCall(x) && x.head === "Output") {
      const act = positional(x)[0];
      const ev = act && [...this.conversation.events].reverse().find((e) => key(e.act) === key(act) && e.result);
      if (!ev) return x;
      return role(ev.result, "output") ?? c("Block");
    }
    if (!isCall(x) || x.head === "Rewrite" || x.head === "Quote") return x;
    const args = await Promise.all(x.args.map(async (a) => ({ ...a, value: await this.value(a.value) })));
    const y: Call = { ...x, args };
    if (!this.pureCall(y)) return y;
    const p = this.primitives.get(y.head)!;
    // An act that only reads because it is held to reading (a command, "the git log") is still an
    // act: the standing rules apply to it as to any other ("don't run git without asking").
    const blocked = p.pure ? undefined : this.blockedBy(y);
    if (blocked) throw new Blocked(y, blocked.rule);
    // In Suppose, within the budget and never out of the machine (runtime.md 10.1).
    if (this.mode === "Supposing") {
      if (this.calls >= SUPPOSE_CALLS || p.effects(positional(y), this.world).includes("SendsOutside")) return y;
      this.calls++;
    }
    try {
      const held = this.held(p, y);
      const result = await p.run(positional(y), this.world, held);
      if (p.check && (await p.check(positional(y), result, this.world))) this.innerChecks++;
      return result;
    } catch (err) {
      // What failed is the inner call, as it was said ("10 divided by 0"), not the act around it.
      throw new Failed(x, err instanceof Error ? err.message : String(err));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Rules and guards

  /** What an act was rewritten from, back to what was heard (whole-expression steps): rules match these. */
  ancestry(a: Expr): Expr[] {
    const out: Expr[] = [a];
    const seen = new Set([key(a)]);
    for (let i = 0; i < out.length; i++)
      for (const st of this.stepsMaking(key(out[i])))
        if (!seen.has(key(st.before))) {
          seen.add(key(st.before));
          out.push(st.before);
        }
    return out;
  }

  /**
   * Every step that contributed to an act: the steps that made it or any part of it, and the steps
   * that made what those started from, and so on. A reading that made the act is found even when a
   * part of the act was rewritten after it (a referent resolved, a role read), so the trust of the
   * readings that led to an act is checked over all of them.
   */
  private contributing(ancestry: Expr[]): Step[] {
    // What was made from the act's parts is followed back, and so is the act as it was before
    // each part was rewritten (the whole a reading made, before an argument inside it changed),
    // bounded so a long request cannot multiply them.
    const out = new Set<Step>();
    const done = new Set<string>();
    const wholes = new Set<string>();
    const stack = [...ancestry];
    while (stack.length && done.size < 5000) {
      const e = stack.pop()!;
      for (const y of walk(e)) {
        const k = key(y);
        if (done.has(k)) continue;
        done.add(k);
        for (const st of this.stepsMaking(k)) {
          if (!out.has(st)) {
            out.add(st);
            stack.push(st.before);
          }
          if (y !== e && wholes.size < 300) {
            const before = mapExpr(e, (z) => (key(z) === k ? st.before : undefined));
            const bk = key(before);
            if (!wholes.has(bk)) {
              wholes.add(bk);
              stack.push(before);
            }
          }
        }
      }
    }
    return [...out];
  }

  /** Steps by what they made, indexed once. */
  private stepsMaking(k: string): Step[] {
    if (!this.byAfter) {
      this.byAfter = new Map();
      for (const st of this.steps) {
        const sk = key(st.after);
        const list = this.byAfter.get(sk);
        if (list) list.push(st);
        else this.byAfter.set(sk, [st]);
      }
    }
    return this.byAfter.get(k) ?? [];
  }

  private byAfter?: Map<string, Step[]>;

  private ruleMatches(r: StandingRule, a: Expr, ancestry = this.ancestry(a)): boolean {
    const [x] = positional(r.rule as Call);
    return ancestry.some((y) => !!x && !!match(x, y, this.store));
  }

  /** The first active rule that forbids this act: Not(x) matching it, or Only(x) not matching it. */
  private blockedBy(a: Expr, ancestry = this.ancestry(a)): { rule: StandingRule } | undefined {
    for (const r of this.conversation.rules) {
      if (isHead(r.rule, "Not") && this.ruleMatches(r, a, ancestry)) return { rule: r };
      if (isHead(r.rule, "Only") && !this.ruleMatches(r, a, ancestry)) return { rule: r };
    }
    return undefined;
  }

  /** A word whose own readings make a prohibition, a restriction or a condition. */
  private limits(head: string): boolean {
    if (head === "Not" || head === "Only" || head === "If" || head === "Constraint") return true;
    // A Not in what an act results in (a verb's result=, "remove": no longer there) is a change it
    // makes, not a limit on what may run.
    const limiting = (e: Expr): boolean => isCall(e) && (e.head === "Not" || e.head === "Only" || e.head === "Constraint" || e.head === "If" || e.args.some((a) => a.name !== "result" && limiting(a.value)));
    return this.store.readingsOn(head).some((r) => !r.mode && r.becomes !== undefined && limiting(r.becomes));
  }

  /**
   * Readings from sources below level 2 (a project's help text, documentation, the web; runtime.md
   * 13) that led to these expressions and are not yet confirmed. Their acts are offered even
   * under a grant.
   */
  untrustedReadings(ancestry: Expr[]): string[] {
    const out: string[] = [];
    for (const st of this.contributing(ancestry)) if (this.trustLevel(st.from) >= 3 && !this.world.confirmed?.has(st.key)) out.push(st.key);
    return [...new Set(out)];
  }

  /** A source's trust level, from the TrustLevel facts on source concepts (the trust table). */
  private trustLevel(from: Expr): number {
    if (!isCall(from)) return 4;
    if (from.head === "Derived") return Math.max(0, ...positional(from).map((x) => this.trustLevel(x)));
    const f = this.store.facts(from.head, "TrustLevel")[0];
    const n = f && positional(f.claim as Call)[0];
    return n?.kind === "number" ? n.value : 4;
  }

  private async call(p: Primitive, args: Expr[], act: Expr, granted = false): Promise<Outcome> {
    const o = await this.callInner(p, args, act, granted);
    // Roles still on a primitive call are input it was handed and does not take: what the user
    // said that this reading does not use (runtime.md 6.1, unmatched roles), counted as unworked.
    const unused = isCall(act) && this.primitives.has(act.head) ? act.args.filter((a) => a.name !== undefined && a.name !== "agent").length : 0;
    // (An instrument left over, "git" on a gh command, counts too: the reading that names its tool wins.)
    return { ...o, unworked: o.unworked + unused };
  }

  private async callInner(p: Primitive, args: Expr[], act: Expr, granted = false): Promise<Outcome> {
    let effects: EffectClass[];
    const held = this.held(p, act);
    const pure = this.pureFor(p, act);
    try {
      effects = held ?? p.effects(args, this.world);
    } catch (err) {
      return { ...this.out(), said: [c("Outcome", act, ["error", s(err instanceof Error ? err.message : String(err))])], unworked: 1 };
    }
    // An effectful act a reading from documentation or the web led to is a proposal until the
    // user confirms it, whatever the config grants (runtime.md 13).
    const untrusted = !pure && this.untrustedReadings(this.ancestry(act)).length > 0;
    // A reading chosen without confidence is offered, whatever its effects allow (design section 9).
    const guarded = this.offerAll && !p.pure ? effects : untrusted ? effects.filter((e) => e !== "Reads" && e !== "Speaks") : effects.filter((e) => GUARDED.has(e) && !this.world.grants?.has(e));
    // A rewrite the user teaches applies after it is echoed and confirmed (design sections 19 and
    // 20): a misheard rule must not quietly become behaviour.
    const taught = p.name === "Remember" && isHead(args[0], "Rewrite");
    // The function-word lexicon is protected (design section 20): "I mean X" is not teaching "I".
    if (taught) {
      const from = positional(args[0] as Call)[0];
      if (isCall(from) && (STRUCTURAL.logicalForm.names.includes(from.head as never) || this.primitives.has(from.head) || this.store.facts(from.head).some((f) => key(f.meta.from) === key(c("Seed", s("function-words"))))))
        return this.stuck(act, c("NoPermission", act));
    }
    if ((guarded.length || taught) && !granted) {
      if (this.mode === "Doing") {
        // Acts offered in one turn are one proposal, in order ("show me the diff and the log").
        const prev = this.conversation.proposal;
        const untrusted = this.untrustedReadings(this.ancestry(act));
        this.conversation.proposal =
          prev && prev.turn === this.conversation.turnIndex
            ? {
                act: c("Sequence", ...(isHead(prev.act, "Sequence") ? positional(prev.act) : [prev.act]), act),
                ancestry: [...prev.ancestry, ...this.ancestry(act)],
                untrusted: [...(prev.untrusted ?? []), ...untrusted],
                turn: prev.turn,
              }
            : { act, ancestry: this.ancestry(act), untrusted, turn: this.conversation.turnIndex };
      }
      const offer = effects.includes("UnknownEffects") ? c("Offer", act, ["effects", c("UnknownEffects")]) : c("Offer", act);
      return { ...this.out(), said: [offer], acts: [act], reachedAct: true };
    }
    if (this.mode === "Supposing") {
      // Nothing leaves the machine in Suppose (runtime.md 10.1): a call that would send outside is
      // captured like an effectful one.
      if (!pure || effects.includes("SendsOutside") || this.calls >= SUPPOSE_CALLS) {
        // Captured, not run; what it would be given is worked out where that only reads, so a dry
        // run tells an act whose input would fail, or pass its checks, from one that would not
        // ("show me the git log": what git log shows, worked out).
        const before = this.innerChecks;
        if (!pure)
          try {
            for (const x of args) await this.value(x);
          } catch (err) {
            if (err instanceof Blocked) return { ...this.out(), acts: [act], reachedAct: true, blocked: 1 };
            return { ...this.out(), said: [c("Outcome", err instanceof Failed ? err.call : act, ["error", s(err instanceof Error ? err.message : String(err))])], unworked: 1 };
          }
        return { ...this.out(), acts: pure ? [] : [act], reachedAct: true, checksPassed: this.innerChecks - before };
      }
      this.calls++;
    }
    try {
      args = await Promise.all(args.map((x) => this.value(x)));
      const result = await p.run(args, this.world, held);
      const checked = p.check ? await p.check(args, result, this.world) : undefined;
      if (this.mode === "Doing") {
        // What undoes the act is recorded with it, from what it did (built-ins.md section 2).
        const effectful = !pure && effects.some((e) => e !== "Reads" && e !== "Speaks");
        const undo = effectful && p.inverse ? await p.inverse(args, result, this.world).catch(() => undefined) : undefined;
        this.conversation.events.push({ turn: this.conversation.turnIndex, act, result, checked, effectful, undo });
        // What an act was done to is in play (runtime.md 11): a later "it" can point at it. A thing
        // in the graph it was done to, or made, is in play too ("add eggs to it").
        // What it was done with (Run's program) is not what it was done to. A path the act found
        // to be a thing of a kind (Read found "notes.txt" a File, "." a Directory) is of that kind.
        const path = role(result, "path");
        args.forEach((x, i) => {
          if (x.kind !== "string" || p.instruments?.includes(p.params[i])) return;
          const kind = isCall(result) && path?.kind === "string" && path.value === x.value ? result.head : undefined;
          this.conversation.inPlay.set(key(x), { expr: x, salience: 1, kind });
        });
        for (const x of [...args, result].flatMap((y) => [...walk(y)])) if (isThing(this.store, x)) this.conversation.inPlay.set(key(x), { expr: x, salience: 1 });
      }
      const outcome = c(
        "Outcome",
        act,
        ["result", result],
        ...(checked !== undefined ? ([["checked", { kind: "boolean", value: checked, pos: { line: 0, column: 0 } }]] as [string, Expr][]) : []),
      );
      // Held to reading, it failed: the claim that it only reads may be what failed it (a command
      // that needs the network cannot reach it held). Running it unheld is offered, its effects
      // unknown; a yes runs it as it is (design section 20: the claim was made true, and was wrong).
      if (held && checked === false && this.mode === "Doing") {
        const ancestry = this.ancestry(act);
        this.conversation.proposal = { act, ancestry, untrusted: this.untrustedReadings(ancestry), turn: this.conversation.turnIndex };
        return { ...this.out(), said: [outcome, c("Offer", act, ["effects", c("UnknownEffects")], ["unheld", { kind: "boolean", value: true, pos: { line: 0, column: 0 } }])], acts: [act], reachedAct: true, checksPassed: 0 };
      }
      // Say is the act itself: what it says is what the turn says, not a report about saying.
      if (effects.includes("Speaks")) return { ...this.out(), said: args, acts: [act], reachedAct: true, checksPassed: checked ? 1 : 0 };
      return { ...this.out(), said: [outcome], acts: [act], reachedAct: true, checksPassed: checked ? 1 : 0 };
    } catch (err) {
      if (err instanceof Blocked) {
        const r = err.rule;
        return { ...this.out(), said: [c("Echo", c("BlockedBy", err.call, r.until ? c("Constraint", r.rule, ["until", r.until]) : c("Constraint", r.rule)))], blocked: 1, reachedAct: true };
      }
      if (this.mode === "Doing") this.conversation.events.push({ turn: this.conversation.turnIndex, act, error: String(err) });
      return { ...this.out(), said: [c("Outcome", err instanceof Failed ? err.call : act, ["error", s(err instanceof Error ? err.message : String(err))])], unworked: 1 };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Questions and assertions

  private async question(lf: Call): Promise<Outcome> {
    const [p] = positional(lf);
    const prim = this.primitiveCall(p);
    if (prim && this.pureFor(prim.p, p)) {
      const r = await this.call(prim.p, prim.args, p);
      // A yes or no is the answer to the question, and so is an answer to a question that names
      // the kind it asks for ("what day is it" is said as a day); anything else is what the act found.
      const about = role(lf, "about");
      const asked = about !== undefined && !isHead(about, "Gap");
      return { ...r, said: r.said.map((x) => (isHead(x, "Outcome") && (asked || role(x, "result")?.kind === "boolean") ? ({ ...x, args: [{ value: lf }, ...x.args.slice(1)] } as Call) : x)) };
    }
    if (this.mode === "Doing") this.conversation.lastQuestion = lf;
    // Where the answer is depends on what the question is about (design section 14b). A question
    // about someone in the conversation ("how are you", "what's my name") is answered from what the
    // graph holds about them, or honestly not at all: the world's sources know neither of them.
    const who = this.participant(p);
    if (who) {
      const r = this.fromGraph(p, who);
      if (r) return { ...this.out(), said: [c("Outcome", lf, ["result", r])], reachedAct: true };
      return this.stuck(lf, c("NoSource", lf, ["about", c(PARTICIPANT[who])]));
    }
    // A question about a command ("what does git commit do") is answered by what the command's
    // own documentation says it does: the summary its page gave the sense its reading came from.
    const doc = this.documentation(p);
    if (doc) return { ...this.out(), said: [c("Outcome", lf, ["result", c("Found", doc.said, ["from", doc.from])])], reachedAct: true };
    // A question about a kind ("what tools do you know") or about what a thing can do ("what can
    // git do") is answered by what the graph holds: the kind's members, or the thing's parts.
    const members = this.members(p);
    if (members) return { ...this.out(), said: [c("Outcome", lf, ["result", members])], reachedAct: true };
    // Nothing here answers it: the need is knowledge, and Know is the one door to it (runtime.md
    // 11b, phase 2; 14). The question's words are the query. In Suppose it answers from the cache
    // only; a lookup that would go out counts as reaching an answer. A question whose words name
    // nothing outside the conversation ("what's up"), or that asks about what a pointer ("it")
    // points at, has nothing to look up in the world.
    const know = this.world.know;
    const words = this.topicText();
    if (!know || !this.said || !words || this.asksOfPointer(p)) return this.stuck(lf);
    // What the graph learned answers first (Know, step 1): facts on what the question names, from
    // the pages and claims they came from. Nothing goes out for it, so it counts in Suppose too;
    // a page kept about what it names is only words looked up before, and does not (below).
    const recalled = know.recall(p);
    if (recalled && recalled.via !== "Page") return { ...this.out(), said: [this.recalled(lf, recalled)], reachedAct: true };
    // What shape of answer the question's words ask for is a fact on them (seed: AnswerShape): an
    // explanation is found by the whole question, a description by the thing it is about.
    const about = this.asksExplanation() ? "reason" : "thing";
    const cached = know.cached("answer", this.said);
    // In Suppose nothing goes out, and an answer from outside does not count as reaching one: a
    // reading is chosen by what the graph can do with it, not by whether its words were looked up
    // before (a question once answered from Wikipedia is read anew once the graph can answer it,
    // "what time is it"). A question nothing else reaches still wins, and is looked up.
    if (this.mode === "Supposing") return this.out();
    // A page kept about what the question names answers it before anything goes out.
    if (!cached && recalled) return { ...this.out(), said: [this.recalled(lf, recalled)], reachedAct: true };
    if (!cached && !know.opts.offline && GUARDED.has("SendsOutside") && !this.world.grants?.has("SendsOutside"))
      return { ...this.out(), said: [c("Offer", c("Know", s(this.said)))], reachedAct: true };
    // The world has a budget of lookups per turn (runtime.md 11b); past it the need stays unmet,
    // and says so. What was asked, and what came back, goes in the reasons log.
    const focus = this.conversation.focus;
    const used = focus.lookups.get("World") ?? 0;
    if (!cached && used >= this.budget("World", "lookups")) {
      focus.log.push({ what: `focus: "${this.said}" from the world, over the turn's budget of ${used}`, candidates: [], winner: -1 });
      return this.stuck(lf, c("NeedUnmet", c("Budget", c("World"))));
    }
    if (!cached) focus.lookups.set("World", used + 1);
    let k: Awaited<ReturnType<typeof know.answer>>;
    try {
      k = cached ?? (await know.answer(this.said, words, about));
      // What was found was understood as it was kept: the graph may answer now. Where it does
      // not, and the question is about a thing, what the question names is learned about (its
      // own page and claims), and the graph asked again; failing that, the page is the answer.
      // What the things it names are learned for is the relation asked about: a description of
      // one of them is not an answer to a question about something else ("a synonym for happy").
      // Each thing learned about is a lookup in the world, within the turn's budget.
      const facts = (vias: string[]) => {
        const r = know.recall(p);
        return r && vias.includes(r.via) ? r : undefined;
      };
      let again = k && !cached ? facts(["Relation", "Description"]) : undefined;
      if (!again && !cached && about === "thing") {
        let learned = false;
        for (const w of this.things(p)) {
          const n = focus.lookups.get("World") ?? 0;
          if (n >= this.budget("World", "lookups")) break;
          focus.lookups.set("World", n + 1);
          const got = await know.learnAbout(w);
          focus.log.push({ what: `focus: what "${w}" is, from the world`, candidates: got ? [{ label: w, features: [], score: 0 }] : [], winner: got ? 0 : -1 });
          learned = got || learned;
        }
        if (learned) again = facts(["Relation"]);
      }
      if (again) {
        focus.log.push({ what: `focus: "${this.said}" from the world, answered from what was learned`, candidates: [], winner: -1 });
        return { ...this.out(), said: [this.recalled(lf, again)], reachedAct: true };
      }
    } catch {
      // A source that fails is no answer, not an error to show.
    }
    focus.log.push({ what: `focus: "${this.said}" from the world${cached ? " (kept from before)" : ""}`, candidates: k ? [{ label: `${k.source}: ${k.title}`, features: [], score: 0 }] : [], winner: k ? 0 : -1 });
    // Where the page is the answer, what it says under a heading that names what was asked (the
    // question's own words its title does not have: "history" of a page titled "Git") answers
    // better than its opening. Reading the whole page is a lookup in the world, within the budget.
    if (k?.url && about === "thing") {
      const title = k.title.toLowerCase();
      const asked = words.split(/\s+/).filter((w) => w.length > 2 && !title.includes(w.toLowerCase().slice(0, Math.max(3, w.length - 2))));
      const used = focus.lookups.get("World") ?? 0;
      if (asked.length && used < this.budget("World", "lookups")) {
        focus.lookups.set("World", used + 1);
        const part = await know.look(k, asked).catch(() => undefined);
        focus.log.push({ what: `focus: what "${k.title}" says of "${asked.join(" ")}", by its headings`, candidates: part ? [{ label: part.title, features: [], score: 0 }] : [], winner: part ? 0 : -1 });
        if (part) return { ...this.out(), said: [this.found(lf, part)], reachedAct: true };
      }
    }
    if (k) return { ...this.out(), said: [this.found(lf, k)], reachedAct: true };
    return this.stuck(lf);
  }

  /** An answer from the graph, said with the source it was learned from. */
  private recalled(lf: Expr, r: { answer: Expr; from: Expr }): Expr {
    return c("Outcome", lf, ["result", c("Found", r.answer, ["from", isCall(r.from) ? c(r.from.head) : r.from])]);
  }

  /**
   * The things a question asks something of, in the user's words: each referent ("the berlin
   * wall", by its kind) and each word of its own that a relation of the question's own words is
   * said of ("france" in "the capital of france", "hamlet" in "who wrote hamlet"). A question with
   * no such relation ("tell me a joke") asks of nothing. The words are a query (an index).
   */
  private things(p: Expr): string[] {
    if (!this.inWords) return [];
    const out: string[] = [];
    const wordsOf = (x: Expr) => {
      const w = positional(this.inWords!(c("Echo", x)) as Call)[0];
      if (w?.kind === "string" && !out.includes(w.value)) out.push(w.value);
    };
    // A word the seed gives meaning to ("someone", for "who"; "of") is not a relation or a thing.
    const own = (x: Call) => !STRUCTURAL_NAMES.has(x.head) && !this.primitives.has(x.head) && !this.store.facts(x.head).some((f) => isCall(f.meta.from) && f.meta.from.head === "Seed");
    const visit = (x: Expr, under: boolean) => {
      if (!isCall(x) || x.head === "Gap") return;
      if (x.head === "Ref") {
        const k = role(x, "kind");
        if (k && under) wordsOf(k);
        if (k) visit(k, under);
        return;
      }
      if (!x.args.length && own(x) && under) return wordsOf(x);
      for (const a of x.args) visit(a.value, under || own(x));
    };
    visit(p, false);
    return out.slice(0, 3);
  }

  private found(lf: Expr, k: { block: string; title: string; url: string; source: string }): Expr {
    // A source with no address (an answer in its own words) is named, not linked.
    const at: [string, Expr][] = k.url ? [["title", s(k.title)], ["to", s(k.url)]] : [];
    return c("Outcome", lf, ["result", c("Found", c("Block", s(k.block)), ...at, ["from", c(k.source)])]);
  }

  private asksExplanation(): boolean {
    return this.said
      .split(/[^\p{L}\p{N}'’]+/u)
      .filter(Boolean)
      .some((w) => this.store.lookup(w).some((h) => this.store.facts(h.concept, "AnswerShape").some((f) => isHead(positional(f.claim as Call)[0], "Explanation"))));
  }

  /**
   * What a question is about, in its own words: the words of what was said that are not in the
   * function-word lexicon ("what is rayleigh scattering" is about "rayleigh scattering").
   */
  private topicText(): string | undefined {
    const words = this.said
      .split(/[^\p{L}\p{N}'’.-]+/u)
      .filter(Boolean)
      .filter((w) => !this.store.lookup(w).some((h) => this.store.facts(h.concept).some((f) => key(f.meta.from) === key(c("Seed", s("function-words"))))));
    return words.length ? words.join(" ") : undefined;
  }

  /**
   * The conversation participant a question is about, if any: one that stands beside the gap in
   * the same proposition ("how are you": State(Addressee(), Gap())), or owns the referent asked
   * about ("your name"). One nested deeper ("do you know who wrote it") is not what it is about.
   */
  private participant(p: Expr): "Addressee" | "Speaker" | undefined {
    const isWho = (x: Expr | undefined) => (isHead(x, "Addressee") ? "Addressee" : isHead(x, "Speaker") ? "Speaker" : undefined);
    for (const y of walk(p)) {
      if (!isCall(y)) continue;
      const vals = y.args.map((a) => a.value);
      const owner = isHead(y, "Ref") ? isWho(role(y, "of")) : undefined;
      if (owner) return owner;
      if (vals.some((v) => isHead(v, "Gap"))) for (const v of vals) if (isWho(v)) return isWho(v);
    }
    return undefined;
  }

  /**
   * What a command's documentation says of it, when the question is about the command: a call to
   * Run standing beside the gap in the same proposition ("what does git commit do": Do(agent=Run(
   * "git", Args("commit")), theme=Gap())), reached by a reading from a page of documentation. What
   * the page says is the summary the same page gave its word's sense (Said).
   */
  private documentation(p: Expr): { said: Expr; from: Expr } | undefined {
    for (const y of walk(p)) {
      if (!isCall(y) || !y.args.some((a) => isHead(a.value, "Gap"))) continue;
      for (const a of y.args) {
        if (!isHead(a.value, "Run")) continue;
        const step = this.steps.find((st) => key(st.after) === key(a.value) && this.trustLevel(st.from) >= 3);
        if (!step) continue;
        for (const f of this.store.facts(step.owner, "Sense")) {
          const sense = positional(f.claim as Call)[0];
          if (!isCall(sense) || key(f.meta.from) !== key(step.from)) continue;
          const said = this.store.facts(sense.head, "Said").map((x) => positional(x.claim as Call)[0])[0];
          if (said) return { said, from: step.from };
        }
      }
    }
    return undefined;
  }

  /**
   * What the graph holds that answers a question about a kind or about what a thing is made of.
   * The kind is a concept said beside the gap ("what tools do you know": Be(Gap(), Tool())), and
   * is every concept its word is ("source" is the core's KnowledgeSource too); its members are
   * what is said to be of it, by IsA, down to those with no members of their own. A thing the
   * question names elsewhere ("what can git do": Can(agent=Git(), theme=Do(theme=Gap()))) is
   * answered by its parts (PartOf it or one of its senses) that say what they are; with a kind
   * too, by those of its parts of that kind. Each is said by its name and what it says of itself.
   * Nothing goes out for it, so it counts in Suppose too.
   */
  // A long list is said as its first few and how many more (a list is spoken pairwise, by depth).
  private members(p: Expr, shown = 15): Expr | undefined {
    const besideGap = new Set<string>();
    for (const y of walk(p))
      if (isCall(y) && positional(y).some((x) => isHead(x, "Gap")))
        for (const x of positional(y)) if (isCall(x) && !x.args.length && x.head !== "Gap") besideGap.add(x.head);
    if (![...walk(p)].some((y) => isHead(y, "Gap"))) return undefined;
    const own = (h: string) => !STRUCTURAL_NAMES.has(h) && !this.primitives.has(h) && !this.store.facts(h).some((f) => isCall(f.meta.from) && f.meta.from.head === "Seed");
    // Said beside someone in the conversation, the gap is about them ("who are you"), not a kind.
    if ([...besideGap].some((k) => k in PARTICIPANT)) return undefined;
    const kinds = [...besideGap];
    const anchors = [...new Set([...walk(p)].flatMap((y) => (isCall(y) && !y.args.length && own(y.head) && !besideGap.has(y.head) ? [y.head] : [])))];
    if (!kinds.length && !anchors.length) return undefined;
    // What is said to be of a concept, or part of it. The core's own meanings are what everything
    // bottoms out in, not things held to list ("someone" is said of people there, not learned).
    const core = key(c("Seed", s("core")));
    const subjects = (concept: string, head: string) =>
      this.store
        .factsNaming(concept)
        .filter((f) => isHead(f.claim, head) && isHead(positional(f.claim as Call)[0], concept) && key(f.meta.from) !== core)
        .map((f) => f.subject);
    // The kind's members: every concept its word names, and what is of it, by IsA, to the leaves.
    // Of more than one kind (someone, and a president), of each of them.
    let found: string[] | undefined;
    for (const k of kinds) {
      const seen = new Set<string>();
      const leaves = new Set<string>();
      let frontier = [k, ...this.store.facts(k, "Lemma").flatMap((f) => { const l = positional(f.claim as Call)[0]; return l?.kind === "string" ? this.store.lookup(l.value).filter((h) => h.text === l.value).map((h) => h.concept) : []; })];
      for (let d = 0; frontier.length && d < 4; d++) {
        const next: string[] = [];
        for (const x of frontier) {
          if (seen.has(x)) continue;
          seen.add(x);
          const below = subjects(x, "IsA");
          if (!below.length && d > 0) leaves.add(x);
          next.push(...below);
        }
        frontier = next;
      }
      found = found ? found.filter((m) => leaves.has(m)) : [...leaves];
    }
    // The thing's parts: what is PartOf it or of one of its senses.
    if (anchors.length) {
      const wholes = anchors.flatMap((a) => [a, ...this.store.facts(a, "Sense").flatMap((f) => { const x = positional(f.claim as Call)[0]; return isCall(x) ? [x.head] : []; })]);
      const parts = new Set(wholes.flatMap((w) => subjects(w, "PartOf")));
      found = found ? found.filter((m) => parts.has(m)) : [...parts].filter((m) => this.store.facts(m, "Said").length);
    }
    if (process.env.DBG) console.error("members", JSON.stringify(p, (k, v) => (k === "pos" ? undefined : v)), kinds, anchors, found);
    if (!found?.length) return undefined;
    const first = (m: string, head: string) => positional(this.store.facts(m, head)[0]?.claim as Call ?? c(head))[0];
    const items = found
      .map((m) => {
        // A sense is said by its word; its own name (a command line, an operation's id) where it has one.
        const word = first(m, "SenseOf");
        const name = first(m, "Name");
        const said = first(m, "Said");
        const roles: [string, Expr][] = [];
        if (name) roles.push(["name", name]);
        if (said) roles.push(["said", said]);
        return { sort: name?.kind === "string" ? name.value : isCall(word) ? word.head : m, expr: c("Member", isCall(word) ? c(word.head) : c(m), ...roles) };
      })
      .sort((a, b) => a.sort.localeCompare(b.sort));
    const out: Expr[] = items.slice(0, shown).map((x) => x.expr);
    if (items.length > shown) out.push(c("More", n(items.length - shown)));
    return c("Members", ...out);
  }

  /** Whether the thing beside the gap is a referent that only points (no kind, no name said). */
  private asksOfPointer(p: Expr): boolean {
    const pointer = (x: Expr) => isHead(x, "Ref") && !role(x, "kind") && ![...walk(role(x, "said") ?? x)].some((y) => y.kind === "string");
    return [...walk(p)].some((y) => isCall(y) && y.args.some((a) => isHead(a.value, "Gap")) && y.args.some((a) => pointer(a.value)));
  }

  /**
   * What the graph holds about a participant that answers the question: a fact on the
   * participant whose claim is the relation the question asks for (the head beside the gap, or
   * the kind of the referent it owns). Said as that relation of the participant.
   */
  private fromGraph(p: Expr, who: keyof typeof PARTICIPANT): Expr | undefined {
    const relations: string[] = [];
    for (const y of walk(p)) {
      if (!isCall(y)) continue;
      if (isHead(y, "Ref") && isHead(role(y, "of"), who) && isCall(role(y, "kind"))) relations.push((role(y, "kind") as Call).head);
      const vals = y.args.map((a) => a.value);
      if (vals.some((v) => isHead(v, "Gap")) && vals.some((v) => isHead(v, who))) relations.push(y.head);
    }
    for (const rel of relations) {
      const f = this.store.facts(who, rel)[0];
      const v = f && positional(f.claim as Call)[0];
      if (v) return c(rel, c(PARTICIPANT[who]), v);
    }
    return undefined;
  }

  private async assert(p: Expr): Promise<Outcome> {
    if (isHead(p, "Aside")) return this.out();
    // A claim is checked if a pure primitive can decide it.
    const holds = await this.decide(p);
    if (holds !== undefined) return { ...this.out(), said: [c("Outcome", c("Assert", p), ["result", { kind: "boolean", value: holds, pos: { line: 0, column: 0 } }])], reachedAct: true };
    // Otherwise, a claim about the user or their things is remembered (logical-form.md section 2);
    // Remember says whether it is one.
    const keep = c("Remember", p);
    const prim = this.primitiveCall(keep);
    if (prim) return this.call(prim.p, prim.args, keep);
    return this.stuck(p);
  }
}
