import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExpr } from "../ncon/index.js";
import { seededStore } from "./seed.js";
import { softMatch } from "./softmatch.js";

const store = seededStore();
store.load(`Pack(name="test-kinds", version="0", from=Seed("test"))
Concept(Remote(), IsA(Place()))
Concept(Server(), IsA(Place()))
Concept(Commit(), IsA(Change()))
`);
const m = (p: string, r: string) => softMatch(store, parseExpr(p), parseExpr(r));

test("identical reductions match fully", () => {
  const x = "Cause(result=Become(Have(Remote(), Commit())))";
  const r = m(x, x)!;
  assert.equal(r.features.patternCovered, 1);
  assert.equal(r.features.requestUnmatched, 0);
});

test("a kind a step away aligns at a cost; an unrelated head does not", () => {
  const near = m("Cause(result=Become(Have(Remote(), Commit())))", "Cause(result=Become(Have(Server(), Commit())))")!;
  const same = m("Cause(result=Become(Have(Remote(), Commit())))", "Cause(result=Become(Have(Remote(), Commit())))")!;
  assert.ok(near.score < same.score && near.score > 0);
  // Unrelated roots align only below, and what is left unexplained counts against it.
  const far = m("Cause(result=Become(Have(Remote(), Commit())))", "Want(experiencer=Speaker(), theme=Commit())")!;
  assert.ok(far.score < near.score);
  assert.equal(m("Cause(result=Become(Have(Remote(), Commit())))", "Want(experiencer=Speaker(), theme=Moment())"), undefined);
});

test("extra words in the request count against it; a pattern variable is filled by anything", () => {
  const extra = m("Cause(result=Become(Have($where, Commit())))", "Cause(result=Become(Have(Remote(), Commit())), time=Now(), manner=Very())")!;
  assert.equal(extra.features.rolesFilled, 1);
  assert.ok(extra.features.requestUnmatched > 0);
});

test("a role child can align to another role at a cost", () => {
  const off = m("See(experiencer=Speaker(), stimulus=Change())", "See(experiencer=Speaker(), theme=Change())")!;
  const on = m("See(experiencer=Speaker(), stimulus=Change())", "See(experiencer=Speaker(), stimulus=Change())")!;
  assert.ok(off.score < on.score && off.score > 0.5);
});
