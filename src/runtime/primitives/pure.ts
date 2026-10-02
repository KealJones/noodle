// The pure primitives over structure: Count, Filter, Sort, Rank, Compare and Now (built-ins.md
// section 2). A set is a call; its members are its positional arguments (And(...), Directory,
// GitStatus, GitLog, GitBranches all read the same way), and what is returned keeps the head and
// roles of the set it was given.

import { b, c, isCall, isHead, key, n, positional, role, s } from "../expr.js";
import type { Call, Expr } from "../expr.js";
import type { Primitive } from "../primitive.js";

function members(set: Expr | undefined, what: string): Call {
  if (!isCall(set)) throw new Error(`${what} takes a set (a call with members)`);
  return set;
}

const withMembers = (set: Call, items: Expr[]): Call => ({ ...set, args: [...set.args.filter((a) => a.name !== undefined), ...items.map((value) => ({ value }))] });

export const Count: Primitive = {
  name: "Count",
  params: ["set"],
  pure: true,
  effects: () => [],
  async run([set]) {
    return n(positional(members(set, "Count")).length);
  },
};

/**
 * Whether item matches where. A call matches an item of the same head when each of its positional
 * arguments equals the item's at that position and each role equals the item's. And, Or and Not
 * combine conditions.
 */
function matches(item: Expr, where: Expr): boolean {
  if (!isCall(where)) return false;
  if (where.head === "And") return positional(where).every((w) => matches(item, w));
  if (where.head === "Or") return positional(where).some((w) => matches(item, w));
  if (where.head === "Not") return !matches(item, positional(where)[0]);
  if (!isCall(item) || where.head !== item.head) return false;
  const have = positional(item);
  if (!positional(where).every((w, i) => have[i] !== undefined && key(have[i]) === key(w))) return false;
  return where.args.filter((a) => a.name !== undefined).every((a) => {
    const v = role(item, a.name!);
    return v !== undefined && key(v) === key(a.value);
  });
}

export const Filter: Primitive = {
  name: "Filter",
  params: ["set", "where"],
  pure: true,
  effects: () => [],
  async run([set, where]) {
    const call = members(set, "Filter");
    return withMembers(call, positional(call).filter((m) => matches(m, where)));
  },
};

/** What an item is ordered by: c("Name") is its first positional string, c("Role", s(r)) its role r. */
function orderKey(item: Expr, by: Expr | undefined): Expr | undefined {
  if (isHead(by, "Name")) {
    const first = isCall(item) ? positional(item)[0] : undefined;
    return first?.kind === "string" ? first : undefined;
  }
  if (isHead(by, "Role")) {
    const name = positional(by)[0];
    if (name?.kind !== "string") throw new Error("Role takes a role name");
    return role(item, name.value);
  }
  throw new Error("order by Name or Role(name)");
}

function compareKeys(x: Expr, y: Expr): number {
  if (x.kind === "number" && y.kind === "number") return Math.sign(x.value - y.value);
  if (x.kind === "string" && y.kind === "string") return x.value < y.value ? -1 : x.value > y.value ? 1 : 0;
  if (x.kind === "boolean" && y.kind === "boolean") return Number(x.value) - Number(y.value);
  throw new Error("cannot order these values against each other");
}

// Items without the key go last, in their original order.
function ordered(set: Expr, by: Expr | undefined, direction: 1 | -1, what: string): Expr {
  const call = members(set, what);
  const keyed = positional(call).map((item, i) => ({ item, i, k: orderKey(item, by) }));
  keyed.sort((x, y) => {
    if (x.k && y.k) return direction * compareKeys(x.k, y.k) || x.i - y.i;
    return x.k ? -1 : y.k ? 1 : x.i - y.i;
  });
  return withMembers(call, keyed.map((e) => e.item));
}

export const Sort: Primitive = {
  name: "Sort",
  params: ["set", "by"],
  pure: true,
  effects: () => [],
  // Ascending by the key.
  async run([set, by]) {
    return ordered(set, by, 1, "Sort");
  },
};

export const Rank: Primitive = {
  name: "Rank",
  params: ["set", "by"],
  pure: true,
  effects: () => [],
  // Best first: descending by the key.
  async run([set, by]) {
    return ordered(set, by, -1, "Rank");
  },
};

export const Compare: Primitive = {
  name: "Compare",
  params: ["a", "b", "by"],
  pure: true,
  effects: () => [],
  // by = Same: whether the two are structurally equal (a boolean). Otherwise the two must be
  // numbers and the result is -1, 0 or 1.
  async run([a, other, by]) {
    if (a === undefined || other === undefined) throw new Error("Compare takes two values");
    if (isHead(by, "Same")) return b(key(a) === key(other));
    if (a.kind !== "number" || other.kind !== "number") throw new Error("Compare orders numbers; use Same for equality");
    return n(Math.sign(a.value - other.value));
  },
};

export const Now: Primitive = {
  name: "Now",
  params: [],
  pure: true,
  effects: () => [],
  async run(_args, world) {
    return c("At", s(world.now().toISOString()));
  },
};
