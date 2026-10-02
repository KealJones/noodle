// The conversation structure and the event record (runtime.md section 11), kept as data: turns,
// standing rules with their scope and source, the last proposal and question, what is in play, and
// every primitive run with its result and check.

import type { Expr } from "./expr.js";
import type { ChoicePoint } from "./score.js";

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
}

export interface Proposal {
  act: Expr;
  /** Expressions the act was rewritten from, for rule checks when it finally runs. */
  ancestry: Expr[];
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
  readonly inPlay = new Map<string, { expr: Expr; salience: number }>();
  proposal?: Proposal;
  /** The turn a proposal was last permitted in. */
  permittedTurn?: number;
  lastQuestion?: Expr;

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
