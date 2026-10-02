// The primitives' interface (runtime.md section 9; built-ins.md section 2). Primitives are the
// only code that touches the world. Each declares what it is, whether it is pure, the effect
// classes it may cause, its check and, where it has one, its inverse. Arguments are expressions,
// never strings pasted into a shell.

import type { Expr } from "./expr.js";
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
  /** Run's time limit in milliseconds. */
  timeoutMs?: number;
}

export interface Primitive {
  /** The concept it is (a structural name). */
  name: string;
  /** Its parameters, in the order its positional arguments come. */
  params: readonly string[];
  /** Pure primitives only read; Suppose may run them. */
  pure: boolean;
  /** The effect classes this call may cause, given its arguments. */
  effects(args: readonly Expr[], world: World): EffectClass[];
  run(args: readonly Expr[], world: World): Promise<Expr>;
  /** The effect check: after running, did it do what it declared? Observes, never trusts. */
  check?(args: readonly Expr[], result: Expr, world: World): Promise<boolean>;
  /** An expression that would undo this call, if there is one. */
  inverse?(args: readonly Expr[], result: Expr, world: World): Promise<Expr | undefined>;
}
