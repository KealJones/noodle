// Remember (built-ins.md section 2): keep something the user taught in the graph. Its item is a
// rewrite, Rewrite(from, to), which becomes a reading on the word it starts from (design section
// 17: a correction may create "a new reading made only of existing concepts"), or a fact on a
// concept. A word the store has never seen becomes a word concept first, named by its lemma, with
// the chart entries of what it is taught to mean. What is remembered comes from the user (level 1).

import { type Call, type Expr, c, isCall, isHead, key, positional, rewrite, role, s, walk } from "../expr.js";
import { STRUCTURAL, STRUCTURAL_NAMES } from "../../structural.js";
import type { Primitive, World } from "../primitive.js";
import { isThing, thingOf } from "./hold.js";

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

/** A claim fits its head's Frame: a core meaning, with the positions and roles it takes. */
function fits(item: Call, world: World): boolean {
  const frames = world.store.facts(item.head, "Frame").map((f) => f.claim).filter(isCall);
  const roles = item.args.filter((a) => a.name !== undefined && a.name !== "time").map((a) => a.name!);
  return frames.some((fr) => positional(fr).length === positional(item).length && roles.every((r) => fr.args.some((a) => a.name === r)));
}

const ACTS_HEADS: ReadonlySet<string> = new Set(STRUCTURAL.primitives.names);

function keepable(item: Call, world: World): boolean {
  if (STRUCTURAL_NAMES.has(item.head) || !fits(item, world) || item.args.some((a) => a.name === "time")) return false;
  const parts = [...walk(item)];
  // No act in it, and no clause of its own inside (a word taking roles): a fact, not a report.
  if (parts.some((y) => isCall(y) && (ACTS_HEADS.has(y.head) || (y !== item && y.head !== "Ref" && y.args.some((a) => a.name !== undefined))))) return false;
  const referent = (y: Expr) =>
    isCall(y) && ((y.head === "Speaker" && !y.args.length) || isThing(world.store, y) || (y.head === "Ref" && isCall(role(y, "kind")) && (role(y, "kind") as Call).head !== "Thing"));
  const refs = item.args.map((a) => a.value).filter(referent);
  if (!refs.length) return false;
  // The referents' own words, and what lies outside every referent and participant.
  const inside = new Set(refs.flatMap((r) => [...walk(r)]).filter(isCall).map((y) => y.head));
  const outside: Expr[] = [];
  const visit = (e: Expr) => {
    const head = isCall(e) ? e.head : undefined;
    if (head === "Ref" || referent(e) || ((head === "Speaker" || head === "Addressee") && isCall(e) && !e.args.length)) return;
    if (e !== item) outside.push(e);
    if (isCall(e)) for (const a of e.args) visit(a.value);
  };
  visit(item);
  // A word of the function-word lexicon ("it", "that") says nothing of them.
  const functionWord = (h: string) => world.store.facts(h).some((f) => key(f.meta.from) === key(c("Seed", s("function-words"))));
  return outside.some((y) => !isCall(y) || (!STRUCTURAL_NAMES.has(y.head) && !inside.has(y.head) && !functionWord(y.head)));
}

/**
 * What a claim is about: the first thing in the graph it names, or the user (Speaker). Referents in
 * it that nothing fits yet become things ("my name is Keal": the user's name, from now on).
 */
function about(item: Call, world: World): { subject: Call; claim: Expr } | undefined {
  const claim = rewrite(item, (x) => (isHead(x, "Ref") ? thingOf(world.store, x, true) : undefined));
  for (const y of walk(claim)) if (isCall(y) && (isThing(world.store, y) || (y.head === "Speaker" && !y.args.length))) return { subject: y, claim };
  return undefined;
}

export const Remember: Primitive = {
  name: "Remember",
  params: ["item"],
  // A claim to keep is made of words, and of referents it may make into things.
  concepts: ["item"],
  makes: ["item"],
  pure: false,
  // A claim is kept (logical-form.md section 2: Assert remembers what is about the user) when it
  // is understood: its head a core meaning whose Frame it fits, told as it is now, with no act in
  // it; it is about the user or their things: one of its own arguments is the user, a thing of
  // theirs, or a referent said with a kind ("my name"); and it says something of them: a literal,
  // or a word that is not the referent's own words ("my name is Keal", not "the review is a
  // review", not "we are us"). Anything else is not this act.
  effects: ([item], world) => {
    if (!isCall(item) || (item.head !== "Rewrite" && item.head !== "Fact" && item.head !== "Retract" && !keepable(item, world))) throw new Error("that is not something to keep about you");
    return ["ChangesGraph"];
  },
  async run([item], world) {
    // Taking back what was kept (Remember's inverse, and Schedule's): Retract(Fact(id)) or
    // Retract(Reading(id)) retracts that item, which stays in the store with its source. Only what
    // the user said may be taken back this way, never the seed's or an import's.
    if (isHead(item, "Retract")) {
      const id = retracted(item);
      const it = id === undefined ? undefined : world.store.item(id);
      if (!it || key(it.meta.from) !== key(USER)) throw new Error("that is not something you told me");
      world.store.retract(it.meta.id);
      // What it had replaced is brought back ("my name is Sam", undone, leaves it Keal again).
      const back = role(item, "restore");
      const old = isCall(back) ? positional(back)[0] : undefined;
      const was = old?.kind === "number" ? world.store.item(old.value) : undefined;
      if (was && key(was.meta.from) === key(USER)) world.store.restore(was.meta.id);
      return c("Remembered", item);
    }
    if (isHead(item, "Rewrite")) {
      const [from0, to] = positional(item);
      const from = isHead(from0, "Quote") ? positional(from0)[0] : from0;
      const o = owner(from, to, world);
      if (!o || !to) throw new Error("a rewrite needs something to start from and something it means");
      // What it wants of its variables, where the user's own wording said it (a number).
      const wants = role(item, "wants");
      const r = world.store.addReading({ owner: o.head, pattern: o.pattern, wants: wants ? [wants] : [], becomes: to, needs: [], effects: [], checks: [], direction: "Expand" }, USER);
      for (const f of world.store.facts(o.head).filter((x) => x.meta.from === USER)) world.keep?.(c("Fact", c(o.head), f.claim, ["from", USER]));
      world.keep?.(c("Reading", ["on", c(o.head)], ["pattern", o.pattern], ...(wants ? ([["wants", wants]] as [string, Expr][]) : []), ["becomes", to], ["from", USER]));
      return c("Remembered", c("Reading", { kind: "number", value: r.meta.id, pos: { line: 0, column: 0 } }));
    }
    if (isHead(item, "Fact")) {
      const [subject, claim] = positional(item);
      if (!isCall(subject) || !claim) throw new Error("a fact needs a subject and a claim");
      const f = world.store.addFact(subject.head, claim, USER);
      world.keep?.(c("Fact", subject, claim, ["from", USER]));
      return c("Remembered", c("Fact", { kind: "number", value: f.meta.id, pos: { line: 0, column: 0 } }));
    }
    // A claim the user made about themselves or their things: a fact on what it is about.
    const a = isCall(item) ? about(item, world) : undefined;
    if (a) {
      // What a thing is, said again, replaces what it was said to be ("my name is Sam" after "my
      // name is Keal"); the earlier claim is retracted, not deleted.
      const replaced: Expr[] = [];
      if (isHead(a.claim, "Be")) {
        const [x] = positional(a.claim as Call);
        for (const old of world.store.facts(a.subject.head, "Be"))
          if (key(positional(old.claim as Call)[0]) === key(x)) {
            world.store.retract(old);
            replaced.push(c("Fact", { kind: "number", value: old.meta.id, pos: { line: 0, column: 0 } }));
          }
      }
      const f = world.store.addFact(a.subject.head, a.claim, USER);
      world.keep?.(c("Fact", a.subject, a.claim, ["from", USER]));
      // What was kept, with the things it now names, so it can be said back.
      return c("Remembered", c("Fact", { kind: "number", value: f.meta.id, pos: { line: 0, column: 0 } }), a.claim, ...replaced.slice(0, 1).map((r): [string, Expr] => ["replaced", r]));
    }
    throw new Error("Remember keeps a Rewrite(from, to), a Fact(subject, claim), or a claim about you or your things");
  },
  async check([item], result, world) {
    if (isHead(item, "Retract")) {
      const id = retracted(item);
      return id !== undefined && world.store.item(id)?.meta.status === "Retracted";
    }
    return isHead(result, "Remembered");
  },
  // What was kept is taken back by its id.
  async inverse(_args, result) {
    const kept = isHead(result, "Remembered") ? positional(result)[0] : undefined;
    const replaced = role(result, "replaced");
    if (!isHead(kept, "Fact") && !isHead(kept, "Reading")) return undefined;
    return c("Remember", replaced ? c("Retract", kept, ["restore", replaced]) : c("Retract", kept));
  },
};

/** The id of the item a Retract(Fact(id)) or Retract(Reading(id)) names. */
function retracted(item: Call): number | undefined {
  const x = positional(item)[0];
  const id = isCall(x) ? positional(x)[0] : undefined;
  return id?.kind === "number" ? id.value : undefined;
}

export type { Call };
