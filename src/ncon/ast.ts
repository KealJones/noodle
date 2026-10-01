// The N-Con expression tree (docs/specs/ncon-format.md section 1). Positions are for error
// messages only; equality (`equal`) ignores them.

export interface Pos {
  line: number;
  column: number;
}

export interface Arg {
  name?: string;
  value: Expr;
}

export type Expr =
  | { kind: "number"; value: number; pos: Pos }
  | { kind: "string"; value: string; pos: Pos }
  | { kind: "boolean"; value: boolean; pos: Pos }
  | { kind: "null"; pos: Pos }
  // `text` is the source text: "_" or "$x".
  | { kind: "variable"; text: string; pos: Pos }
  | { kind: "call"; head: string; args: Arg[]; pos: Pos };

export type Call = Extract<Expr, { kind: "call" }>;

export interface NconFile {
  forms: Call[];
}

export class NconError extends Error {
  constructor(
    message: string,
    readonly pos: Pos,
    /** Head of the top-level form the error is in, when known. */
    readonly form?: string,
  ) {
    super(`${pos.line}:${pos.column}: ${message}${form ? ` (in ${form})` : ""}`);
    this.name = "NconError";
  }
}

export function equal(a: Expr, b: Expr): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "null":
      return true;
    case "number":
    case "string":
    case "boolean":
      return a.value === (b as typeof a).value;
    case "variable":
      return a.text === (b as typeof a).text;
    case "call": {
      const c = b as Call;
      return (
        a.head === c.head &&
        a.args.length === c.args.length &&
        a.args.every((x, i) => x.name === c.args[i].name && equal(x.value, c.args[i].value))
      );
    }
  }
}

export function filesEqual(a: NconFile, b: NconFile): boolean {
  return a.forms.length === b.forms.length && a.forms.every((f, i) => equal(f, b.forms[i]));
}
