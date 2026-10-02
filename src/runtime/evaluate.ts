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
      // A failed step or a block stops the plan (runtime.md 10.2). A step that is offered is not
      // run, so later steps are offered with it, as one proposal: the user says yes to the plan.
      if (r.unworked || r.blocked) break;
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
      o = this.merge(o, r);
      if (r.unworked || r.checksPassed === 0) break;
    }
    return o;
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
    // word (an unresolved "file" is not something a primitive can be given).
    // A rewrite to remember is expressions by nature, kept as they are, like a quotation.
    const unready = (y: Expr): boolean =>
      y.kind === "variable" || (isCall(y) && (y.head === "Rewrite" || y.head === "Quote" ? false : !DATA.has(y.head) || y.args.some((a) => unready(a.value))));
    if (args.some(unready)) return undefined;
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
    return this.store.readingsOn(head).some((r) => !r.mode && r.becomes !== undefined && [...walk(r.becomes)].some((y) => isCall(y) && (y.head === "Not" || y.head === "Only" || y.head === "Constraint" || y.head === "If")));
  }

  /**
   * Readings from sources below level 2 (a project's help text, documentation, the web; runtime.md
   * 13) that led to these expressions and are not yet confirmed. Their acts are offered even
   * under a grant.
   */
  private untrustedReadings(ancestry: Expr[]): string[] {
    const keys = new Set(ancestry.map(key));
    const out: string[] = [];
    for (const st of this.steps) if (keys.has(key(st.after)) && this.trustLevel(st.from) >= 3 && !this.world.confirmed?.has(st.key)) out.push(st.key);
    return out;
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
    try {
      effects = p.effects(args, this.world);
    } catch (err) {
      return { ...this.out(), said: [c("Outcome", act, ["error", s(err instanceof Error ? err.message : String(err))])], unworked: 1 };
    }
    // An effectful act a reading from documentation or the web led to is a proposal until the
    // user confirms it, whatever the config grants (runtime.md 13).
    const untrusted = !p.pure && this.untrustedReadings(this.ancestry(act)).length > 0;
    const guarded = untrusted ? effects.filter((e) => e !== "Reads" && e !== "Speaks") : effects.filter((e) => GUARDED.has(e) && !this.world.grants?.has(e));
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
      if (!p.pure || effects.includes("SendsOutside") || this.calls >= SUPPOSE_CALLS) return { ...this.out(), acts: p.pure ? [] : [act], reachedAct: true };
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
    // Nothing here answers it: the need is knowledge, and Know is the one door to it (runtime.md
    // 11b, phase 2; 14). The question's words are the query. In Suppose it answers from the cache
    // only; a lookup that would go out counts as reaching an answer.
    const know = this.world.know;
    if (!know || !this.said) return this.stuck(lf);
    const topic = this.topicText() ?? this.topicOf(p);
    // What shape of answer the question's words ask for is a fact on them (seed: AnswerShape): an
    // explanation is found by the whole question, a description by the thing it is about.
    const about = this.asksExplanation() ? "reason" : "thing";
    const cached = know.cached("answer", this.said);
    // In Suppose nothing goes out, so a lookup not already answered is not known to reach an answer;
    // only what the graph holds counts. A question nothing else reaches still wins, and is looked up.
    if (this.mode === "Supposing") return cached ? { ...this.out(), said: [this.found(lf, cached)], reachedAct: true } : this.out();
    if (!cached && GUARDED.has("SendsOutside") && !this.world.grants?.has("SendsOutside"))
      return { ...this.out(), said: [c("Offer", c("Know", s(this.said)))], reachedAct: true };
    try {
      const k = cached ?? (await know.answer(this.said, topic, about));
      if (k) return { ...this.out(), said: [this.found(lf, k)], reachedAct: true };
    } catch {
      // A source that fails is no answer, not an error to show.
    }
    return this.stuck(lf);
  }

  private found(lf: Expr, k: { block: string; title: string; url: string; source: string }): Expr {
    return c("Outcome", lf, ["result", c("Found", c("Block", s(k.block)), ["title", s(k.title)], ["to", s(k.url)], ["from", c(k.source)])]);
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

  /** What a question is about, in words: its first named thing (a literal, or a word's lemma). */
  private topicOf(p: Expr): string | undefined {
    for (const y of walk(p)) {
      if (y.kind === "string") return y.value;
      if (isCall(y) && !STRUCTURAL.logicalForm.names.includes(y.head as never) && y.head !== "Gap") {
        const l = this.store.facts(y.head, "Lemma").map((f) => positional(f.claim as Call)[0])[0];
        if (l?.kind === "string" && !this.store.facts(y.head).some((f) => key(f.meta.from) === key(c("Seed", s("function-words"))))) return l.value;
      }
    }
    return undefined;
  }

  private async assert(p: Expr): Promise<Outcome> {
    if (isHead(p, "Aside")) return this.out();
    // A claim is checked if a pure primitive can decide it; otherwise it is not something to run.
    const holds = await this.decide(p);
    if (holds !== undefined) return { ...this.out(), said: [c("Outcome", c("Assert", p), ["result", { kind: "boolean", value: holds, pos: { line: 0, column: 0 } }])], reachedAct: true };
    return this.stuck(p);
  }
}
