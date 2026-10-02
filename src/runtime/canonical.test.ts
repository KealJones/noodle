import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExpr } from "../ncon/index.js";
import { canonicalize, sameMeaning } from "./canonical.js";
import { key } from "./expr.js";
import { seededStore } from "./seed.js";

// Hand-built LFs, not parsed from English (testing.md section 2.1).
const store = seededStore();
store.load(`Pack(name="test-canonical", version="0", from=Seed("test"))
Concept(Delete(), SameAs(Remove()))
Concept(Push(), Category(Act()))
Concept(Commit(), Category(Act()))
`);
const P = new Set(["Run", "Read"]);
const same = (a: string[], b: string[]) => sameMeaning(store, a.map(parseExpr), b.map(parseExpr), P);
const canon = (x: string) => key(canonicalize(store, parseExpr(x), P));

test("roles compare regardless of order", () => {
  assert.ok(same(["Directive(Add(theme=Milk(), destination=List()))"], ["Directive(Add(destination=List(), theme=Milk()))"]));
});

test("sameness resolves to one representative: Remove and Delete, where they are the same act", () => {
  assert.ok(same(["Directive(Delete(Every(Branch(), except=Main())))"], ["Directive(Remove(Every(Branch(), except=Main())))"]));
});

test("sets of things are sets; acts joined by And keep their order", () => {
  assert.ok(same(["Question(Be(And(Tabs(), Spaces())))"], ["Question(Be(And(Spaces(), Tabs(), Tabs())))"]));
  assert.ok(!same(["Directive(And(Commit(), Push()))"], ["Directive(And(Push(), Commit()))"]));
});

test("time Now is the default; a double negation of a proposition is the proposition, not under a rule", () => {
  assert.equal(canon("Question(Broken(theme=It()), time=Now())"), canon("Question(Broken(theme=It()))"));
  assert.equal(canon("Assert(Not(Not(Broken(theme=It()))))"), canon("Assert(Broken(theme=It()))"));
  assert.notEqual(canon("Constraint(Not(Not(Push())))"), canon("Constraint(Push())"));
});

test("a message's constraints are a set, its directives keep their order", () => {
  assert.ok(same(["Constraint(Only(Suggest(_)))", "Constraint(Not(Delete(_)))"], ["Constraint(Not(Delete(_)))", "Constraint(Only(Suggest(_)))", "Constraint(Not(Delete(_)))"]));
  assert.ok(!same(["Directive(Commit())", "Directive(Push())"], ["Directive(Push())", "Directive(Commit())"]));
});

test("inside a quotation nothing is canonicalized", () => {
  assert.notEqual(canon('Mention(And(B(), A()))'), canon('Mention(And(A(), B()))'));
});
