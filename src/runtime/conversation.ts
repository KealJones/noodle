// The conversation structure and the event record (runtime.md section 11), kept as data: turns,
// standing rules with their scope and source, the last proposal and question, what is in play, and
// every primitive run with its result and check.

import type { Expr } from "./expr.js";
import type { ChoicePoint } from "./score.js";

/**
 * What Focus pulled in this turn (runtime.md 11b): each lookup, the need that asked for it, the
 * source, what came back and which won, as a choice point for the reasons log; and how many
 * lookups each source has had, against the turn's budget.
 */
export interface FocusRecord {
  lookups: Map<string, number>;
  log: ChoicePoint[];
}

export interface StandingRule {
  /** Not(x) or Only(x) (logical-form.md section 7). */
  rule: Expr;
  until?: Expr;
  over?: Expr;
  /** Where it came from: the turn that said it, or the seed for a default policy. */
  from: Expr;
}

export interface Event {
  turn: number;
  act: Expr;
  result?: Expr;
  checked?: boolean;
  error?: string;
  /** Whether the act changed something (an effect beyond reading and speaking). */
  effectful?: boolean;
  /** What would undo it, from its primitive's inverse, when it has one (built-ins.md section 2). */
  undo?: Expr;
  /** Undone already, or itself an undoing: not what a later "undo" takes back. */
  undone?: boolean;
}

export interface Proposal {
  act: Expr;
  /** Expressions the act was rewritten from, for rule checks when it finally runs. */
  ancestry: Expr[];
  /** Readings from untrusted sources that led to it: a yes confirms them (runtime.md 13). */
  untrusted?: string[];
  turn: number;
}

export interface TurnRecord {
  index: number;
  who: "User" | "Self";
  text: string;
  heard: Expr[];
  lf: Expr[];
  said: Expr[];
  reasons: ChoicePoint[];
  tone: string[];
  asides: Expr[];
}

export class Conversation {
  readonly turns: TurnRecord[] = [];
  readonly rules: StandingRule[] = [];
  readonly events: Event[] = [];
  /** What is in play, and for a literal, the kind of thing an act found it to be (a file). */
  readonly inPlay = new Map<string, { expr: Expr; salience: number; kind?: string }>();
  proposal?: Proposal;
  /** The last proposal the user said no to: what it was, the turn it was offered in, and the turn of the no. */
  declined?: { act: Expr; offered: number; turn: number };
  /** The turn a proposal was last permitted in. */
  permittedTurn?: number;
  lastQuestion?: Expr;
  /** This turn's Focus: started afresh each turn. */
  focus: FocusRecord = { lookups: new Map(), log: [] };

  /** A copy to work on without changing this one (a dry run). Expressions are immutable values. */
  clone(): Conversation {
    const c = new Conversation();
    c.turns.push(...this.turns);
    c.rules.push(...this.rules.map((r) => ({ ...r })));
    c.events.push(...this.events);
    for (const [k, v] of this.inPlay) c.inPlay.set(k, { ...v });
    c.proposal = this.proposal && { ...this.proposal };
    c.declined = this.declined;
    c.permittedTurn = this.permittedTurn;
    c.lastQuestion = this.lastQuestion;
    return c;
  }

  get turnIndex(): number {
    return this.turns.length;
  }

  /** Salience decays per turn (runtime.md 11; the rate is a weight, here its starting value). */
  decay(rate = 0.5) {
    for (const [k, v] of this.inPlay) {
      v.salience *= rate;
      if (v.salience < 0.01) this.inPlay.delete(k);
    }
  }
}
