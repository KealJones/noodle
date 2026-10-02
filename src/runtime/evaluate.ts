// Evaluation (runtime.md sections 7, 10 and 12; logical-form.md sections 2 and 7): each speech
// act has one rule. Directives plan and run their act under the standing rules and the guards;
// questions are answered; constraints are stored; assertions are checked or kept. Suppose runs the
// same evaluation with effectful primitives captured instead of applied. Everything the assistant
// says is handed to Say as structure (Outcome, Offer, Echo, the reasons it is stuck); the words
// are the seed's.

import { type Call, type Expr, c, isCall, isHead, key, positional, rewrite as mapExpr, role, s, walk } from "./expr.js";
import type { Conversation, StandingRule } from "./conversation.js";
import { match } from "./match.js";
import { GUARDED, type EffectClass, type Primitive, type World } from "./primitive.js";
import type { Mode, Step } from "./rewrite.js";
import type { Store } from "./store.js";
import { STRUCTURAL } from "../structural.js";

/** What a primitive can be given inside its arguments: the structures primitives make, and blocks. */
const DATA: ReadonlySet<string> = new Set([...STRUCTURAL.primitiveResults.names, "Block", "Args"]);

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

const SPEECH_ACTS = new Set(["Question", "Assert", "Directive", "Advice", "Constraint"]);
/** Pure primitives Suppose may run, within this many calls (runtime.md 10.1). */
const SUPPOSE_CALLS = 20;

export class Evaluator {
  private calls = 0;

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
    // No speech act: a social turn gets its reply if the seed has one, else nothing is run.
    const reply = c("Reply", lf);
    if (this.canSay(reply)) return { ...this.out(), said: [reply] };
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
      if (this.mode === "Doing") this.conversation.proposal = undefined;
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
    if (isHead(a, "Then") || isHead(a, "And") || isHead(a, "Sequence")) return this.sequence(positional(a));
    if (isHead(a, "If")) return this.conditional(a);
    const blocked = this.blockedBy(a);
    if (blocked) return { ...this.out(), said: [c("Echo", c("BlockedBy", a, blocked.rule.until ? c("Constraint", blocked.rule.rule, ["until", blocked.rule.until]) : c("Constraint", blocked.rule.rule)))], blocked: 1, reachedAct: true };
    const prim = this.primitiveCall(a);
    if (!prim) {
      const reply = c("Reply", a);
      if (this.canSay(reply)) return { ...this.out(), said: [reply], reachedAct: true };
      return this.stuck(a, c("NoReading", a));
    }
    return this.call(prim.p, prim.args, a);
  }

  private async sequence(steps: Expr[]): Promise<Outcome> {
    let o = this.out();
    for (const st of steps) {
      const r = await this.directive(st);
      o = this.merge(o, r);
      // A failed step, a block or an offer stops the plan (runtime.md 10.2).
      if (r.unworked || r.blocked || r.said.some((x) => isHead(x, "Offer"))) break;
    }
    return o;
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
    if (!prim || !prim.p.pure) return undefined;
    try {
      const r = await prim.p.run(prim.args, this.world);
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
    const prim = this.primitiveCall(prop.act);
    if (!prim) return this.stuck(prop.act, c("NoReading", prop.act));
    // The user's yes is a level 1 grant for this act (runtime.md 12).
    return this.call(prim.p, prim.args, prop.act, true);
  }

  private resolveProposal(x: Expr): Expr | undefined {
    const kind = role(x, "kind");
    if (isHead(x, "Ref") && isHead(kind, "Proposal")) return this.conversation.proposal?.act;
    if (isHead(x, "Ref")) return this.conversation.proposal?.act;
    return x;
  }

  /**
   * Referents (logical-form.md section 4; design section 16): a referent whose words name
   * something (a literal) is that; one that only points ("it", "that") is the most salient thing in
   * play. A referent nothing fits stays a referent, and the act stays unworked.
   */
  resolve(e: Expr): Expr {
    return mapExpr(e, (x) => {
      if (!isHead(x, "Ref")) return undefined;
      const said = role(x, "said");
      const named = said && [...walk(said)].find((y) => y.kind === "string");
      if (named) return named;
      const top = [...this.conversation.inPlay.values()].sort((a, b) => b.salience - a.salience)[0];
      return top ? top.expr : x;
    });
  }

  private primitiveCall(a0: Expr): { p: Primitive; args: Expr[] } | undefined {
    if (!isCall(a0)) return undefined;
    const p = this.primitives.get(a0.head);
    if (!p) return undefined;
    const a = this.resolve(a0) as Call;
    const args = positional(a);
    if (args.length !== p.params.length) return undefined;
    // A primitive is given data: no variable, gap or referent left, and no concept that is still a
    // word (an unresolved "file" is not something a primitive can be given).
    const unready = (y: Expr) => y.kind === "variable" || (isCall(y) && !DATA.has(y.head));
    if (args.some((x) => [...walk(x)].some(unready))) return undefined;
    return { p, args };
  }

  // -------------------------------------------------------------------------------------------
  // Rules and guards

  private ancestry(a: Expr): Expr[] {
    const out: Expr[] = [a];
    const seen = new Set([key(a)]);
    for (let i = 0; i < out.length; i++)
      for (const st of this.steps)
        if (key(st.after) === key(out[i]) && !seen.has(key(st.before))) {
          seen.add(key(st.before));
          out.push(st.before);
        }
    return out;
  }

  private ruleMatches(r: StandingRule, a: Expr): boolean {
    const [x] = positional(r.rule as Call);
    return this.ancestry(a).some((y) => !!x && !!match(x, y, this.store));
  }

  /** The first active rule that forbids this act: Not(x) matching it, or Only(x) not matching it. */
  private blockedBy(a: Expr): { rule: StandingRule } | undefined {
    for (const r of this.conversation.rules) {
      if (isHead(r.rule, "Not") && this.ruleMatches(r, a)) return { rule: r };
      if (isHead(r.rule, "Only") && !this.ruleMatches(r, a)) return { rule: r };
    }
    return undefined;
  }

  private async call(p: Primitive, args: Expr[], act: Expr, granted = false): Promise<Outcome> {
    const o = await this.callInner(p, args, act, granted);
    // Roles still on a primitive call are input it was handed and does not take: what the user
    // said that this reading does not use (runtime.md 6.1, unmatched roles), counted as unworked.
    const unused = isCall(act) && this.primitives.has(act.head) ? act.args.filter((a) => a.name !== undefined && a.name !== "agent").length : 0;
    return { ...o, unworked: o.unworked + unused };
  }

  private async callInner(p: Primitive, args: Expr[], act: Expr, granted = false): Promise<Outcome> {
    const effects: EffectClass[] = p.effects(args, this.world);
    const guarded = effects.filter((e) => GUARDED.has(e) && !this.world.grants?.has(e));
    if (guarded.length && !granted) {
      if (this.mode === "Doing") this.conversation.proposal = { act, ancestry: this.ancestry(act), turn: this.conversation.turnIndex };
      const offer = effects.includes("UnknownEffects") ? c("Offer", act, ["effects", c("UnknownEffects")]) : c("Offer", act);
      return { ...this.out(), said: [offer], acts: [act], reachedAct: true };
    }
    if (this.mode === "Supposing") {
      if (!p.pure || this.calls >= SUPPOSE_CALLS) return { ...this.out(), acts: [act], reachedAct: true };
      this.calls++;
    }
    try {
      const result = await p.run(args, this.world);
      const checked = p.check ? await p.check(args, result, this.world) : undefined;
      if (this.mode === "Doing") {
        this.conversation.events.push({ turn: this.conversation.turnIndex, act, result, checked });
        // What an act was done to is in play (runtime.md 11): a later "it" can point at it.
        for (const x of args) if (x.kind === "string") this.conversation.inPlay.set(key(x), { expr: x, salience: 1 });
      }
      const outcome = c(
        "Outcome",
        act,
        ["result", result],
        ...(checked !== undefined ? ([["checked", { kind: "boolean", value: checked, pos: { line: 0, column: 0 } }]] as [string, Expr][]) : []),
      );
      // Say is the act itself: what it says is its outcome, not a report about saying.
      if (effects.includes("Speaks")) return { ...this.out(), acts: [act], reachedAct: true, checksPassed: checked ? 1 : 0 };
      return { ...this.out(), said: [outcome], acts: [act], reachedAct: true, checksPassed: checked ? 1 : 0 };
    } catch (err) {
      if (this.mode === "Doing") this.conversation.events.push({ turn: this.conversation.turnIndex, act, error: String(err) });
      return { ...this.out(), said: [c("Outcome", act, ["error", s(err instanceof Error ? err.message : String(err))])], unworked: 1 };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Questions and assertions

  private async question(lf: Call): Promise<Outcome> {
    const [p] = positional(lf);
    const prim = this.primitiveCall(p);
    if (prim && prim.p.pure) {
      const r = await this.call(prim.p, prim.args, p);
      // A yes or no is the answer to the question; anything else is what the act found.
      return { ...r, said: r.said.map((x) => (isHead(x, "Outcome") && role(x, "result")?.kind === "boolean" ? ({ ...x, args: [{ value: lf }, ...x.args.slice(1)] } as Call) : x)) };
    }
    if (this.mode === "Doing") this.conversation.lastQuestion = lf;
    return this.stuck(lf, c("NoSource", p));
  }

  private async assert(p: Expr): Promise<Outcome> {
    if (isHead(p, "Aside")) return this.out();
    // A claim is checked if a pure primitive can decide it; otherwise it is not something to run.
    const holds = await this.decide(p);
    if (holds !== undefined) return { ...this.out(), said: [c("Outcome", c("Assert", p), ["result", { kind: "boolean", value: holds, pos: { line: 0, column: 0 } }])], reachedAct: true };
    return this.stuck(p);
  }
}
