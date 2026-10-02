// Arithmetic(op, a, b) (built-ins.md section 2): pure, no effects. The operation is a structural
// head (Addition, Subtraction, Multiplication, Division, Exponentiation, Modulo; structural.ts,
// primitiveResults) and its two operands are numbers. A root is a power with a fractional
// exponent, a percent a division by a hundred: the words that say them build those (seed).
//
// Integers are exact: sums, differences, products, whole powers and remainders are worked in
// BigInt and are a number while that number is exact. Results that are not whole are rounded to
// fifteen significant digits (as many as a double holds exactly), so 0.1 + 0.2 is 0.3 and the
// cube root of 27 is 3.

import { isCall, n } from "../expr.js";
import type { Expr } from "../expr.js";
import type { Primitive } from "../primitive.js";

const operand = (x: Expr | undefined): number => {
  if (x?.kind !== "number") throw new Error("Arithmetic works on numbers");
  return x.value;
};

const whole = (x: number) => Number.isSafeInteger(x);

function exact(op: string, a: bigint, b: bigint): bigint | undefined {
  switch (op) {
    case "Addition":
      return a + b;
    case "Subtraction":
      return a - b;
    case "Multiplication":
      return a * b;
    case "Exponentiation":
      return b >= 0n && b <= 4096n ? a ** b : undefined;
    case "Modulo":
      return b === 0n ? undefined : a % b;
  }
  return undefined;
}

function approx(op: string, a: number, b: number): number {
  switch (op) {
    case "Addition":
      return a + b;
    case "Subtraction":
      return a - b;
    case "Multiplication":
      return a * b;
    case "Division":
      if (b === 0) throw new Error("division by zero");
      return a / b;
    case "Exponentiation":
      // An odd root of a negative number is real: the cube root of -27 is -3.
      if (a < 0 && !Number.isInteger(b)) {
        const k = Math.round(1 / b);
        if (Math.abs(1 / b - k) < 1e-9 && k % 2 !== 0) return -Math.pow(-a, b);
      }
      return Math.pow(a, b);
    case "Modulo":
      if (b === 0) throw new Error("division by zero");
      return a % b;
  }
  throw new Error(`"${op}" is not an arithmetic operation`);
}

/** The value of op on a and b. */
export function compute(op: string, a: number, b: number): number {
  if (whole(a) && whole(b)) {
    const r = exact(op, BigInt(a), BigInt(b));
    if (r !== undefined) {
      const x = Number(r);
      if (Number.isSafeInteger(x)) return x;
    }
  }
  const r = approx(op, a, b);
  if (!Number.isFinite(r)) throw new Error("the result is not a finite number");
  return Number.isInteger(r) ? r : Number(r.toPrecision(15));
}

export const Arithmetic: Primitive = {
  name: "Arithmetic",
  params: ["op", "a", "b"],
  pure: true,
  effects: () => [],
  async run([op, a, b]) {
    if (!isCall(op) || op.args.length) throw new Error("Arithmetic takes an operation");
    return n(compute(op.head, operand(a), operand(b)));
  },
};
