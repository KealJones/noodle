// Exact matching (runtime.md section 6.1) and template instantiation. A pattern matches an
// expression when heads are equal (after SameAs), every roled argument in the pattern has a
// matching argument with that role, positional arguments match in order, and variables bind
// consistently. Extra roled arguments in the expression are allowed and reported.

import { type Call, type Expr, c, isCall, isVar, key, positional, roles, withRoles } from "./expr.js";
import type { Store } from "./store.js";

export type Bindings = Map<string, Expr>;

export interface MatchResult {
  bindings: Bindings;
  /** Roled arguments of the matched expression's top level that the pattern did not name. */
  extra: { name: string; value: Expr }[];
}

const OPAQUE = new Set(["Quote", "Mention"]);

export function sameHead(store: Store | undefined, a: string, b: string): boolean {
  if (a === b) return true;
  if (!store) return false;
  return canonical(store, a) === canonical(store, b);
}

/** The canonical representative of a concept's SameAs class (ncon.md section 3.3). */
export function canonical(store: Store, name: string): string {
  const seen = new Set([name]);
  const stack = [name];
  while (stack.length) {
    const x = stack.pop()!;
    for (const f of [...store.facts(x, "SameAs"), ...store.factsNaming(x).filter((f) => isCall(f.claim) && f.claim.head === "SameAs")]) {
      const other = f.subject === x ? positional(f.claim as Call)[0] : { kind: "call", head: f.subject, args: [], pos: f.claim.pos } as Expr;
      if (isCall(other) && !seen.has(other.head)) {
        seen.add(other.head);
        stack.push(other.head);
      }
    }
  }
  return [...seen].sort()[0];
}

export function match(pattern: Expr, expr: Expr, store?: Store, bindings: Bindings = new Map()): MatchResult | undefined {
  const b = new Map(bindings);
  const extra: { name: string; value: Expr }[] = [];
  if (!go(pattern, expr, b, store, true, extra)) return undefined;
  return { bindings: b, extra };
}

function go(p: Expr, e: Expr, b: Bindings, store: Store | undefined, top: boolean, extra: { name: string; value: Expr }[]): boolean {
  if (isVar(p)) {
    if (p.text === "_") return true;
    const have = b.get(p.text);
    if (have) return key(have) === key(e);
    b.set(p.text, e);
    return true;
  }
  if (p.kind !== "call") return e.kind === p.kind && key(p) === key(e);
  if (!isCall(e) || !sameHead(store, p.head, e.head)) return false;
  // Inside an opaque node only variables match: nothing looks inside a quotation.
  if (OPAQUE.has(e.head) && !p.args.every((a) => isVar(a.value))) return false;
  const pp = positional(p);
  const ep = positional(e);
  if (pp.length !== ep.length) return false;
  for (let i = 0; i < pp.length; i++) if (!go(pp[i], ep[i], b, store, false, extra)) return false;
  const named = new Set<string>();
  for (const a of roles(p)) {
    named.add(a.name!);
    const value = e.args.find((x) => x.name === a.name)?.value;
    if (value === undefined) {
      // A pattern role bound to `_` matches an absent argument too.
      if (isVar(a.value) && a.value.text === "_") continue;
      return false;
    }
    if (!go(a.value, value, b, store, false, extra)) return false;
  }
  // Roles the pattern did not name are carried over (runtime.md 6.1), from any depth of the
  // pattern's own structure, so "don't push yet" keeps its "yet" when Dont is read away.
  for (const a of roles(e)) if (!named.has(a.name!) && !extra.some((x) => x.name === a.name)) extra.push({ name: a.name!, value: a.value });
  void top;
  return true;
}

/**
 * Fills a template with its bindings. Variables the pattern did not bind stay (`$it`, the logical
 * form's bound variable). WithRoles(e, role=x) is computed: e with those roles set.
 */
export function instantiate(template: Expr, b: Bindings): Expr {
  if (isVar(template)) return template.text === "_" ? template : (b.get(template.text) ?? template);
  if (!isCall(template)) return template;
  const filled: Call = { ...template, args: template.args.map((a) => ({ ...a, value: instantiate(a.value, b) })) };
  if (filled.head === "WithRoles") return applyWithRoles(filled);
  return filled;
}

export function applyWithRoles(e: Call): Expr {
  const target = positional(e)[0];
  if (!isCall(target)) return e;
  const set: Record<string, Expr> = {};
  for (const a of roles(e)) set[a.name!] = a.value;
  return withRoles(target, set);
}

/** Carries a match's unmatched roles over to a result, unless the result names them already. */
export function carry(result: Expr, extra: { name: string; value: Expr }[]): Expr {
  if (!isCall(result) || !extra.length) return result;
  const set: Record<string, Expr> = {};
  for (const x of extra) if (!result.args.some((a) => a.name === x.name)) set[x.name] = x.value;
  return Object.keys(set).length ? withRoles(result, set) : result;
}

export { c };
