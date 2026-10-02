// Runtime helpers over N-Con expressions (ncon.md section 1). Expressions are immutable values
// with structural equality; positions are only for parse errors and are ignored here.

import type { Arg, Call, Expr, Pos } from "../ncon/index.js";

export type { Arg, Call, Expr };

const P0: Pos = { line: 0, column: 0 };

/** A call: c("Push", [theme, x]) or c("Push", x, y) for positional arguments. */
export function c(head: string, ...args: (Expr | [string, Expr])[]): Call {
  return {
    kind: "call",
    head,
    args: args.map((a) => (Array.isArray(a) ? { name: a[0], value: a[1] } : { value: a })),
    pos: P0,
  };
}

export const s = (value: string): Expr => ({ kind: "string", value, pos: P0 });
export const n = (value: number): Expr => ({ kind: "number", value, pos: P0 });
export const b = (value: boolean): Expr => ({ kind: "boolean", value, pos: P0 });
export const v = (name: string): Expr => ({ kind: "variable", text: name.startsWith("$") || name === "_" ? name : `$${name}`, pos: P0 });
export const NULL: Expr = { kind: "null", pos: P0 };

export const isCall = (e: Expr | undefined): e is Call => e?.kind === "call";
export const isVar = (e: Expr | undefined): e is Extract<Expr, { kind: "variable" }> => e?.kind === "variable";
export const isHead = (e: Expr | undefined, head: string): e is Call => isCall(e) && e.head === head;

/**
 * A key that two expressions share exactly when they are equal: one line, JSON strings, roled
 * arguments in their written order (ncon.md: roled arguments compare by role regardless of order,
 * so `key` sorts them).
 */
const keys = new WeakMap<Expr, string>();

export function key(e: Expr): string {
  const have = keys.get(e);
  if (have !== undefined) return have;
  const k = computeKey(e);
  keys.set(e, k);
  return k;
}

function computeKey(e: Expr): string {
  switch (e.kind) {
    case "number":
      return JSON.stringify(e.value);
    case "string":
      return JSON.stringify(e.value);
    case "boolean":
      return String(e.value);
    case "null":
      return "null";
    case "variable":
      return e.text;
    case "call": {
      const pos = e.args.filter((a) => a.name === undefined).map((a) => key(a.value));
      const roled = e.args
        .filter((a) => a.name !== undefined)
        .map((a) => `${a.name}=${key(a.value)}`)
        .sort();
      return `${e.head}(${[...pos, ...roled].join(", ")})`;
    }
  }
}

export const same = (a: Expr, b2: Expr) => key(a) === key(b2);

export const positional = (e: Call): Expr[] => e.args.filter((a) => a.name === undefined).map((a) => a.value);

export function role(e: Expr | undefined, name: string): Expr | undefined {
  return isCall(e) ? e.args.find((a) => a.name === name)?.value : undefined;
}

export const roles = (e: Call): Arg[] => e.args.filter((a) => a.name !== undefined);

/** e with these roles set (replacing any it had), positional arguments untouched. */
export function withRoles(e: Call, set: Record<string, Expr>): Call {
  const names = new Set(Object.keys(set));
  return {
    ...e,
    args: [...e.args.filter((a) => a.name === undefined || !names.has(a.name)), ...Object.entries(set).map(([name, value]) => ({ name, value }))],
  };
}

/** Every sub-expression, outermost first. */
export function* walk(e: Expr): Generator<Expr> {
  yield e;
  if (e.kind === "call") for (const a of e.args) yield* walk(a.value);
}

/** The heads named anywhere in e. */
export function heads(e: Expr): Set<string> {
  const out = new Set<string>();
  for (const x of walk(e)) if (x.kind === "call") out.add(x.head);
  return out;
}

/** Replace every sub-expression for which f returns a value; f sees outermost first. */
export function rewrite(e: Expr, f: (x: Expr) => Expr | undefined): Expr {
  const r = f(e);
  if (r !== undefined) return r;
  if (e.kind !== "call") return e;
  let changed = false;
  const args = e.args.map((a) => {
    const value = rewrite(a.value, f);
    if (value !== a.value) changed = true;
    return value === a.value ? a : { ...a, value };
  });
  return changed ? { ...e, args } : e;
}

export const size = (e: Expr): number => [...walk(e)].length;
