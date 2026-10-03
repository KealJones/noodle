// What the user teaches by picking, typing or confirming an act for something they said (design
// section 17: "a new reading made only of existing concepts", from the user, level 1). The reading's
// pattern is what they said, as meaning: its concepts and roles, not its words (a referent is its
// kind, whatever words named it, so "list my open prs" and "list the open prs" are one request).
// A value said in the request and given to the act (a number, a name) becomes a variable, so the
// same request said of another value comes to the same act with that value: whole, or as a piece
// of an argument ("8080" in ":8080" is Joined(":", $a1), a structure, not text pasted together).

import { type Call, type Expr, c, isCall, isHead, key, rewrite, role, v, walk } from "./expr.js";

export interface Lesson {
  pattern: Call;
  becomes: Expr;
  /** What a variable wants, where the user's own wording said its kind ("pr 1748": a number). */
  wants?: Expr;
  /** The values that became variables, in order (said back as the slots). */
  slots: Expr[];
}

/**
 * What was said, at its meaning: no agent (whoever's words, the addressee does it), and a
 * referent with a kind matches whatever words it is said with (`said=_`: any, or none).
 */
export function meaning(said: Call): Call {
  const bare: Call = { ...said, args: said.args.filter((a) => a.name !== "agent") };
  return rewrite(bare, (x) => (isHead(x, "Ref") && role(x, "kind") ? { ...x, args: [...x.args.filter((a) => a.name !== "said"), { name: "said", value: v("_") }] } : undefined)) as Call;
}

const literal = (x: Expr) => x.kind === "number" || x.kind === "string";
const text = (x: Expr) => (x.kind === "number" ? String(x.value) : x.kind === "string" ? x.value : "");

/**
 * The reading(s) that take what was said to the act. `kind` names a concept for a role, where the
 * store has one (the variable's want: the role "number" wants a Number).
 */
export function lessonsOf(said: Call, act: Expr, kind: (role: string) => string | undefined = () => undefined): Lesson[] {
  const bare = meaning(said);
  const values: Expr[] = [];
  for (const y of walk(bare)) if (literal(y) && text(y) && !values.some((x) => key(x) === key(y))) values.push(y);
  // A value of the request found in the act: whole, or as a piece of a string argument.
  const vars = new Map<string, Expr>();
  const used: Expr[] = [];
  const slot = (x: Expr) => {
    let w = vars.get(key(x));
    if (!w) {
      w = v(`a${vars.size + 1}`);
      vars.set(key(x), w);
      used.push(x);
    }
    return w;
  };
  const inAct = (y: Expr): Expr | undefined => {
    if (!literal(y)) return undefined;
    // The same value, as a number or as the text it was typed as ("8080").
    const whole = values.find((x) => key(x) === key(y) || text(x) === text(y));
    if (whole) return slot(whole);
    if (y.kind !== "string") return undefined;
    // A piece of an argument: the value's text, not inside a longer word or number.
    for (const x of values) {
      const t = text(x);
      const i = y.value.indexOf(t);
      if (i < 0 || t === y.value) continue;
      const before = y.value.slice(0, i);
      const after = y.value.slice(i + t.length);
      const joins = (ch: string | undefined) => ch === undefined || !/[\p{L}\p{N}]/u.test(ch);
      if (!joins(before.at(-1)) || !joins(after[0])) continue;
      return c("Joined", ...[...(before ? [{ ...y, value: before }] : []), slot(x), ...(after ? [{ ...y, value: after }] : [])]);
    }
    return undefined;
  };
  // Inside a quotation or the words a referent was said with, nothing is the act's to fill.
  const becomes = rewrite(act, (y) => (isHead(y, "Quote") ? y : inAct(y)));
  const sub = (e: Expr) => rewrite(e, (x) => (literal(x) ? vars.get(key(x)) : undefined));
  // A value said that the act does not use stays as it was said: the reading is for that value.
  const pattern = sub(bare) as Call;
  // A number said in a slot wants a number there (the kind digits are of), so the rewrite is not
  // taken for "it" in its own meaning ("... and kill it").
  const number = used.findIndex((x) => x.kind === "number");
  const out: Lesson[] = [{ pattern, becomes, slots: used, wants: number >= 0 ? c("IsA", [...vars.values()][number], c("Numeral")) : undefined }];
  for (const [k, x] of vars) {
    // The thing the value was said with ("pr 1748": the pr), taken out for the value alone.
    const holder = [...walk(bare)].find((y) => y !== bare && isCall(y) && y.args.some((a) => key(a.value) === k));
    if (!holder) continue;
    const alone = sub(rewrite(bare, (y) => (key(y) === key(holder) ? used[[...vars.keys()].indexOf(k)] : undefined))) as Call;
    // The kind it wants is the role it filled there, a kind of its own ("pr 1748": a number).
    const filled = isCall(holder) ? holder.args.find((a) => key(a.value) === k)?.name : undefined;
    const want = filled ? kind(filled) : undefined;
    out.push({ pattern: alone, becomes, wants: want ? c("IsA", x, c(want)) : undefined, slots: used });
  }
  return out;
}
