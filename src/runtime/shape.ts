// The shape interpreter (runtime.md section 3.4): shape patterns over characters, compiled to
// sticky regular expressions. The heads are structural (built-ins.md section 4.3).

import { type Expr, isCall, positional } from "./expr.js";

export class ShapeError extends Error {}

function esc(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function num(e: Expr | undefined, fallback?: number): number {
  if (e?.kind === "number") return e.value;
  if (fallback !== undefined) return fallback;
  throw new ShapeError("a shape count must be a number");
}

/** The regular expression source a shape pattern means. */
export function shapeSource(e: Expr): string {
  if (!isCall(e)) throw new ShapeError("a shape is a call");
  const args = positional(e);
  switch (e.head) {
    case "Digits": {
      const lo = num(args[0]);
      const hi = num(args[1], lo);
      return `\\p{Nd}{${lo},${hi}}`;
    }
    case "Letter":
      return "\\p{L}";
    case "Digit":
      return "\\p{Nd}";
    case "Lower":
      return "\\p{Ll}";
    case "Upper":
      return "\\p{Lu}";
    case "Space":
      return "\\s";
    case "Any":
      return "[\\s\\S]";
    case "Literal": {
      const t = args[0];
      if (t?.kind !== "string") throw new ShapeError("Literal takes a string");
      return esc(t.value);
    }
    case "Capture":
      // The part of a match that is its value (a code span's name, without its backticks).
      return `(?<value>${args.map(shapeSource).join("")})`;
    case "Seq":
      return args.map((a) => `(?:${shapeSource(a)})`).join("");
    case "OneOf":
      return `(?:${args.map(shapeSource).join("|")})`;
    case "Repeat": {
      // Greedy unless shortest=true (a fence's body stops at the first closing fence).
      const lo = num(args[1], 0);
      const hi = num(args[2], lo);
      const shortest = e.args.some((a) => a.name === "shortest" && a.value.kind === "boolean" && a.value.value);
      return `(?:${shapeSource(args[0])}){${lo},${hi}}${shortest ? "?" : ""}`;
    }
  }
  throw new ShapeError(`"${e.head}" is not a shape head`);
}

const cache = new Map<string, RegExp>();

/** The match of a shape at position i: its length, and the captured value if the shape has one. */
export function matchShapeValue(shape: Expr, text: string, i: number): { len: number; value?: string } {
  const src = shapeSource(shape);
  let re = cache.get(src);
  if (!re) {
    re = new RegExp(src, "uy");
    cache.set(src, re);
  }
  re.lastIndex = i;
  const m = re.exec(text);
  return m ? { len: m[0].length, value: m.groups?.value } : { len: 0 };
}

/** The longest match of the shape at position i of text, or 0 characters. Greedy, like the regex. */
export function matchShape(shape: Expr, text: string, i: number): number {
  const src = shapeSource(shape);
  let re = cache.get(src);
  if (!re) {
    re = new RegExp(src, "uy");
    cache.set(src, re);
  }
  re.lastIndex = i;
  const m = re.exec(text);
  return m ? m[0].length : 0;
}
