import assert from "node:assert/strict";
import { test } from "node:test";
import { c, n, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { World } from "../primitive.js";
import { Store } from "../store.js";
import { PRIMITIVES } from "./index.js";

const world: World = { root: "/nonexistent", store: new Store(), now: () => new Date(0), say: () => {}, ask: () => {} };
const arithmetic = PRIMITIVES.get("Arithmetic")!;
const run = (op: string, a: Expr, b: Expr) => arithmetic.run([c(op), a, b], world);

test("Arithmetic is pure and has no effects", () => {
  assert.equal(arithmetic.pure, true);
  assert.deepEqual(arithmetic.effects([c("Addition"), n(1), n(2)], world), []);
});

test("Arithmetic works each operation", async () => {
  assert.deepEqual(await run("Addition", n(2), n(2)), n(4));
  assert.deepEqual(await run("Subtraction", n(7), n(10)), n(-3));
  assert.deepEqual(await run("Multiplication", n(17), n(23)), n(391));
  assert.deepEqual(await run("Division", n(12), n(4)), n(3));
  assert.deepEqual(await run("Division", n(100), n(8)), n(12.5));
  assert.deepEqual(await run("Exponentiation", n(2), n(10)), n(1024));
  assert.deepEqual(await run("Modulo", n(17), n(5)), n(2));
});

test("Arithmetic is exact for integers and sensible for decimals", async () => {
  assert.deepEqual(await run("Multiplication", n(1000000), n(1000000)), n(1000000000000));
  assert.deepEqual(await run("Exponentiation", n(3), n(33)), n(5559060566555523));
  assert.deepEqual(await run("Addition", n(0.1), n(0.2)), n(0.3));
  assert.deepEqual(await run("Exponentiation", n(81), n(0.5)), n(9));
  assert.deepEqual(await run("Exponentiation", n(27), await run("Division", n(1), n(3))), n(3));
  assert.deepEqual(await run("Exponentiation", n(-27), await run("Division", n(1), n(3))), n(-3));
});

test("Arithmetic refuses what it cannot work out", async () => {
  await assert.rejects(run("Division", n(1), n(0)), /division by zero/);
  await assert.rejects(run("Multiplication", s("readme"), n(2)), /numbers/);
  await assert.rejects(run("Frobnication", n(1), n(2)), /not an arithmetic operation/);
});
