// The primitives' interface (runtime.md section 9; built-ins.md section 2). Primitives are the
// only code that touches the world. Each declares what it is, whether it is pure, the effect
// classes it may cause, its check and, where it has one, its inverse. Arguments are expressions,
// never strings pasted into a shell.

import type { Expr } from "./expr.js";
import type { Know } from "./know/know.js";
import type { Store } from "./store.js";

export type EffectClass =
  | "Deletes"
  | "OverwritesHistory"
  | "Publishes"
  | "SendsOutside"
  | "Spends"
  | "UnknownEffects"
  | "ChangesLocal"
  | "ChangesGraph"
  | "Speaks"
  | "Reads";

/** Effect classes held by guards (runtime.md section 12); protected base. */
export const GUARDED: ReadonlySet<EffectClass> = new Set(["Deletes", "OverwritesHistory", "Publishes", "SendsOutside", "Spends", "UnknownEffects"]);

/** What a primitive may reach: a root it may not leave, the store, the clock, and the channel. */
export interface World {
  /** Every path a primitive touches is resolved inside this directory. */
  root: string;
  store: Store;
  now(): Date;
  /** Say and Ask hand their document to the conversation's channel. */
  say(doc: Expr): void;
  ask(question: Expr): void;
  /** Programs Run may start (the config's grant, design section 20); undefined means any. */
  programs?: ReadonlySet<string>;
  /** Effect classes a level 1 grant (the config, design section 20) lets run without an offer. */
  grants?: ReadonlySet<EffectClass>;
  /** Keys of readings from untrusted sources the user has confirmed (runtime.md 13). */
  confirmed?: ReadonlySet<string>;
  /** Records a confirmation of a reading, by its key. */
  confirm?(readingKey: string): void;
  /** Keeps what the user taught beyond this session (a top-level N-Con form); the channel decides where. */
  keep?(form: Expr): void;
  /** The door to outside knowledge (runtime.md 14), if this session may use it. */
  know?: Know;
  /** Run's time limit in milliseconds. */
  timeoutMs?: number;
}

export interface Primitive {
  /** The concept it is (a structural name). */
  name: string;
  /** Its parameters, in the order its positional arguments come. */
  params: readonly string[];
  /**
   * Parameters that take concepts as they are: a word's concept ("milk" on a list), or a claim made
   * of words (a fact to remember). Other parameters take data only (built-ins.md section 2).
   */
  concepts?: readonly string[];
  /** Parameters that may be a referent nothing fits yet: the primitive makes the thing (a new list). */
  makes?: readonly string[];
  /** Parameters that take an act to be done later (a plan), kept as it is: Schedule's act. */
  plans?: readonly string[];
  /** Parameters that name what the act is done with, not what it is done to (Run's program). */
  instruments?: readonly string[];
  /** Parameters that take a time expression (logical-form.md 3.3): Schedule's when. */
  times?: readonly string[];
  /** Pure primitives only read; Suppose may run them. */
  pure: boolean;
  /** The effect classes this call may cause, given its arguments. */
  effects(args: readonly Expr[], world: World): EffectClass[];
  /**
   * Whether this primitive can hold a call to these effects while it runs. A reading may claim
   * narrower effects than its primitive's (a command its documentation says only shows
   * something); a claim from an untrusted source is never taken on its word (design section 20),
   * but one the primitive can hold is not taken on its word either: it is made true.
   */
  holds?(effects: readonly EffectClass[], world: World): boolean;
  /** Runs the call; with held, held to those effects (only where holds said it can be). */
  run(args: readonly Expr[], world: World, held?: readonly EffectClass[]): Promise<Expr>;
  /** The effect check: after running, did it do what it declared? Observes, never trusts. */
  check?(args: readonly Expr[], result: Expr, world: World): Promise<boolean>;
  /** An expression that would undo this call, if there is one. */
  inverse?(args: readonly Expr[], result: Expr, world: World): Promise<Expr | undefined>;
}
