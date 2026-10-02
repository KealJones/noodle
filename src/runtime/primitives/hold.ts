// Holding (built-ins.md section 2): Store, Remove and Contains for holders that are concepts in
// the graph, and the things the user's words point at (a list, their name), kept across sessions.
//
// A thing in the graph is a concept minted the first time the user's words point at it and
// nothing fits: Fact(X, IsA(kind)) and Fact(X, Said(how it was said)), so it is found again by its
// kind and its words, and Fact(Speaker, Have(Speaker, X)), the user's things, which is where
// referents are looked for. What a holder holds is Fact(H, Have(H, item)). All of it comes from the
// user (level 1). Nothing is ever deleted: Remove retracts the fact, which stays in the store with
// its source, and Store brings it back. That is why taking out what the user put in is ChangesGraph
// (unguarded, like Remember) and not Deletes: nothing is lost, and the inverse restores it.

import { type Call, type Expr, c, isCall, isHead, key, positional, role } from "../expr.js";
import type { Primitive, World } from "../primitive.js";
import type { FactItem, Store as Graph } from "../store.js";

const USER: Expr = c("User");
const fromUser = (f: FactItem) => key(f.meta.from) === key(USER);

/** The user's things in the graph, most recent first. */
export function things(store: Graph): Call[] {
  return store
    .facts("Speaker", "Have")
    .filter(fromUser)
    .map((f) => positional(f.claim as Call)[1])
    .filter(isCall)
    .reverse();
}

/** A thing in the graph: a concept the user's words were minted into. */
export function isThing(store: Graph, e: Expr | undefined): boolean {
  return isCall(e) && e.args.length === 0 && store.facts(e.head, "IsA").some(fromUser) && things(store).some((t) => t.head === e.head);
}

/** A new thing for a referent nothing fits: its kind and the words it was said with. */
function mint(store: Graph, ref: Call): Call {
  const kind = role(ref, "kind");
  const said = role(ref, "said");
  const base = isCall(kind) ? kind.head : "Thing";
  let n = 1;
  while (store.has(`${base}_${n}`)) n++;
  const name = `${base}_${n}`;
  if (isCall(kind)) store.addFact(name, c("IsA", kind), USER);
  if (said) store.addFact(name, c("Said", said), USER);
  store.addFact("Speaker", c("Have", c("Speaker"), c(name)), USER);
  return c(name);
}

/** The thing an argument is: one already in the graph, or (where allowed) one made for a referent. */
export function thingOf(store: Graph, e: Expr | undefined, make: boolean): Call {
  if (isThing(store, e)) return e as Call;
  if (make && isHead(e, "Ref")) return mint(store, e);
  throw new Error(isHead(e, "Ref") ? "there is nothing like that yet" : "a holder must be something kept in the graph");
}

/** The members of an item: And(a, b) is a and b; on a list, every egg, or some, is eggs. */
export function members(e: Expr | undefined): Expr[] {
  if (!isCall(e)) return e === undefined ? [] : [e];
  if (e.head === "And") return positional(e).flatMap(members);
  if ((e.head === "Every" || e.head === "Some") && e.args.length === 1 && e.args[0].name === undefined) return members(e.args[0].value);
  return [e];
}

/** Two items are the same when they are equal, or are words that share a sense ("eggs", "egg"). */
function same(store: Graph, a: Expr, b: Expr): boolean {
  if (key(a) === key(b)) return true;
  if (!isCall(a) || !isCall(b) || a.args.length || b.args.length) return false;
  const senses = new Set(store.facts(a.head, "Sense").map((f) => key(f.claim)));
  return store.facts(b.head, "Sense").some((f) => senses.has(key(f.claim)));
}

/** The facts saying what a holder holds. */
function held(store: Graph, h: Call): FactItem[] {
  return store.facts(h.head, "Have").filter((f) => fromUser(f) && isCall(f.claim) && key(positional(f.claim)[0]) === key(h));
}

const itemOf = (f: FactItem) => positional(f.claim as Call)[1];

/** Have(holder, items), the items as one And, or Have(holder) when it holds nothing. */
function holding(store: Graph, h: Call): Call {
  const items = held(store, h).map(itemOf);
  return items.length ? c("Have", h, items.length === 1 ? items[0] : c("And", ...items)) : c("Have", h);
}

/** What the graph says of a thing the user has: what it holds, and what else they said of it. */
export function readThing(store: Graph, h: Call): Expr {
  const claims = store.facts(h.head).filter((f) => fromUser(f) && isCall(f.claim) && f.claim.head !== "IsA" && f.claim.head !== "Said" && f.claim.head !== "Have");
  const parts: Expr[] = held(store, h).length || !claims.length ? [holding(store, h)] : [];
  for (const f of claims) parts.push(f.claim);
  return parts.length === 1 ? parts[0] : c("And", ...parts);
}

export function holds(store: Graph, holder: Expr, item: Expr): boolean {
  if (!isThing(store, holder)) return false;
  const have = held(store, holder as Call).map(itemOf);
  return members(item).every((m) => have.some((x) => same(store, x, m)));
}

export const Store: Primitive = {
  name: "Store",
  params: ["holder", "item"],
  concepts: ["item"],
  makes: ["holder"],
  pure: false,
  effects: () => ["ChangesGraph"],
  async run([holder, item], world) {
    const h = thingOf(world.store, holder, true);
    for (const m of members(item)) if (!holds(world.store, h, m)) world.store.addFact(h.head, c("Have", h, m), USER);
    return holding(world.store, h);
  },
  async check([, item], result, world) {
    const h = isCall(result) ? positional(result)[0] : undefined;
    return holds(world.store, h as Expr, item);
  },
  async inverse([, item], result) {
    return c("Remove", positional(result as Call)[0], item);
  },
};

export const Remove: Primitive = {
  name: "Remove",
  params: ["holder", "item"],
  concepts: ["item"],
  pure: false,
  // Retracting what the user put in loses nothing (see the head of this file).
  effects: () => ["ChangesGraph"],
  async run([holder, item], world: World) {
    const h = thingOf(world.store, holder, false);
    for (const m of members(item)) {
      const hits = held(world.store, h).filter((f) => same(world.store, itemOf(f), m));
      if (!hits.length) throw new Error("it isn't there");
      for (const f of hits) world.store.retract(f);
    }
    return holding(world.store, h);
  },
  async check([, item], result, world) {
    const h = isCall(result) ? positional(result)[0] : undefined;
    return members(item).every((m) => !holds(world.store, h as Expr, m));
  },
  async inverse([, item], result) {
    return c("Store", positional(result as Call)[0], item);
  },
};
