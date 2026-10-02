// Remember (built-ins.md section 2): keep something the user taught in the graph. Its item is a
// rewrite, Rewrite(from, to), which becomes a reading on the word it starts from (design section
// 17: a correction may create "a new reading made only of existing concepts"), or a fact on a
// concept. A word the store has never seen becomes a word concept first, named by its lemma, with
// the chart entries of what it is taught to mean. What is remembered comes from the user (level 1).

import { type Call, type Expr, c, isCall, isHead, positional, s } from "../expr.js";
import type { Primitive, World } from "../primitive.js";

const USER: Expr = c("User");

/** Primitive calls are acts. */
const ACTS: Record<string, true> = { Run: true, Read: true, Write: true, Edit: true, Say: true, Ask: true, Remember: true, Count: true };

/** The concept a taught word or phrase starts from, created when it is new. */
function owner(from: Expr, to: Expr, world: World): { head: string; pattern: Expr } | undefined {
  if (isCall(from)) return { head: from.head, pattern: from };
  if (from.kind !== "string") return undefined;
  const lemma = from.value.toLowerCase();
  const known = world.store.lookup(lemma)[0];
  if (known) return { head: known.concept, pattern: c(known.concept) };
  let name = lemma.replace(/(^|[^a-z0-9])([a-z0-9])/g, (_m, _p, ch: string) => ch.toUpperCase()).replace(/[^A-Za-z0-9]/g, "");
  if (!/^[A-Z]/.test(name)) return undefined;
  while (world.store.has(name)) name += "_2";
  world.store.addFact(name, c("Lemma", s(lemma)), USER);
  // It is used as what it means is used: the chart entries of the meaning's head word.
  const head = isHead(to, "And") || isHead(to, "Then") ? positional(to)[0] : to;
  const entries = isCall(head) ? world.store.facts(head.head, "Category") : [];
  for (const f of entries) world.store.addFact(name, f.claim, USER);
  // Taught to mean an act that runs (a primitive call), it is an act that may take a thing.
  if (!entries.length && isCall(head) && head.head in ACTS)
    world.store.addFact(name, c("Category", c("Act"), c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c("Theme")], ["optional", { kind: "boolean", value: true, pos: { line: 0, column: 0 } }])), USER);
  return { head: name, pattern: c(name) };
}

export const Remember: Primitive = {
  name: "Remember",
  params: ["item"],
  pure: false,
  effects: () => ["ChangesGraph"],
  async run([item], world) {
    if (isHead(item, "Rewrite")) {
      const [from0, to] = positional(item);
      const from = isHead(from0, "Quote") ? positional(from0)[0] : from0;
      const o = owner(from, to, world);
      if (!o || !to) throw new Error("a rewrite needs something to start from and something it means");
      const r = world.store.addReading({ owner: o.head, pattern: o.pattern, wants: [], becomes: to, needs: [], effects: [], checks: [], direction: "Expand" }, USER);
      for (const f of world.store.facts(o.head).filter((x) => x.meta.from === USER)) world.keep?.(c("Fact", c(o.head), f.claim, ["from", USER]));
      world.keep?.(c("Reading", ["on", c(o.head)], ["pattern", o.pattern], ["becomes", to], ["from", USER]));
      return c("Remembered", c("Reading", { kind: "number", value: r.meta.id, pos: { line: 0, column: 0 } }));
    }
    if (isHead(item, "Fact")) {
      const [subject, claim] = positional(item);
      if (!isCall(subject) || !claim) throw new Error("a fact needs a subject and a claim");
      const f = world.store.addFact(subject.head, claim, USER);
      world.keep?.(c("Fact", subject, claim, ["from", USER]));
      return c("Remembered", c("Fact", { kind: "number", value: f.meta.id, pos: { line: 0, column: 0 } }));
    }
    throw new Error("Remember keeps a Rewrite(from, to) or a Fact(subject, claim)");
  },
  async check(_args, result) {
    return isHead(result, "Remembered");
  },
};

export type { Call };
