// node --test scan.test.js: the scanner against hand cases and every seed file.
const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { scan, callAt } = require("./scan.js");
const { indexPack, describe } = require("./describe.js");

const kinds = (text) => scan(text).marks.map((m) => `${m.kind}:${text.slice(m.start, m.end)}@${m.depth}`);
const SEED = join(__dirname, "../../seed");

test("heads and parentheses carry their depth", () => {
  assert.deepEqual(kinds("A(B(C()))").filter((k) => k.startsWith("head")), ["head:A@0", "head:B@1", "head:C@2"]);
  assert.deepEqual(kinds("X(A(B(C())))").filter((k) => k.startsWith("head")), ["head:X@0", "head:A@1", "head:B@2", "head:C@3"]);
  assert.deepEqual(kinds("A(B())").filter((k) => /open|close/.test(k)), ["open:(@0", "open:(@1", "close:)@1", "close:)@0"]);
});

test("only the six top-level heads are forms, and only at depth 0", () => {
  assert.deepEqual(kinds("Concept(Game(), Concept())").filter((k) => /head|form/.test(k)), ["form:Concept@0", "head:Game@1", "head:Concept@1"]);
  assert.equal(scan("Foo()").marks[0].kind, "head");
});

test("a form's parentheses belong to the form", () => {
  const parens = scan("Concept(Game(), IsA(X()))").marks.filter((m) => m.kind === "open" || m.kind === "close");
  assert.deepEqual(parens.map((m) => !!m.form), [true, false, false, false, false, false, false, true]);
});

test("a sense is one head", () => {
  assert.deepEqual(kinds("Concept(List#Series(), SenseOf(List()))").filter((k) => k.startsWith("head")), ["head:List#Series@1", "head:SenseOf@1", "head:List@2"]);
});

test("nothing inside a string, raw string or comment is nesting", () => {
  const { marks, unbalanced } = scan('A("(", """ ) ( """) // B(\nC()');
  assert.deepEqual(unbalanced, []);
  assert.deepEqual(marks.filter((m) => m.kind === "head" || m.kind === "form").map((m) => m.depth), [0, 0]);
});

test("variables, the anonymous variable, roles, numbers and constants are told apart", () => {
  const found = kinds('X($a, _, theme=true, -1.5, null, "a\\nb")').filter((k) => !/open|close|comma|head/.test(k));
  assert.deepEqual(found, ["variable:$a@1", "anonymous:_@1", "name:theme@1", "equals:=@1", "constant:true@1", "number:-1.5@1", "constant:null@1", "escape:\\n@1", 'string:"a\\nb"@1']);
});

test("metadata names are metadata only directly on a top-level form", () => {
  const m = (text) => scan(text).marks.filter((k) => k.kind === "meta" || k.kind === "name").map((k) => `${k.kind}:${text.slice(k.start, k.end)}`);
  assert.deepEqual(m('Concept(X(), Near(at=Home()), from=Seed("a"), weight=2)'), ["name:at", "meta:from", "meta:weight"]);
});

test("a comma knows whose arguments it separates", () => {
  assert.deepEqual(scan("And(Equals($a, 1), $b)").marks.filter((m) => m.kind === "comma").map((m) => m.of), ["Equals", "And"]);
});

test("an unbalanced parenthesis is found", () => {
  assert.deepEqual(scan("A(B()").unbalanced, [1]);
  assert.deepEqual(scan("A())").unbalanced, [3]);
});

test("every seed file scans balanced", () => {
  for (const f of readdirSync(SEED).filter((f) => f.endsWith(".ncon"))) {
    assert.deepEqual(scan(readFileSync(join(SEED, f), "utf8")).unbalanced, [], f);
  }
});

test("callAt finds the call and the argument being written", () => {
  const text = "Reading(on=Can(), pattern=Can(agent=You(), act=$x), be";
  assert.deepEqual(callAt(text, text.length), { head: "Reading", index: 2, argument: " be" });
});

test("a concept's comment, facts and readings come from the files that write about it", () => {
  const text = [
    "// What is wanted.",
    "Concept(Can(), Lemma(\"can\"), Category(Act()))",
    "Fact(Can(), Lemma(\"could\"))",
    "Reading(on=Can(), pattern=Can(agent=You(), act=$x), becomes=$x)",
    "Concept(List#Series(), SenseOf(List()))",
  ].join("\n");
  const index = indexPack(text, "t.ncon");
  assert.deepEqual([...index.keys()], ["Can", "List#Series"]);
  const out = describe("Can", index.get("Can"));
  assert.match(out, /What is wanted\./);
  assert.match(out, /Lemma\("could"\)/);
  assert.match(out, /Can\(agent=You\(\), act=\$x\)  =>  \$x/);
  assert.equal(index.get("Can").find((d) => d.form === "Reading").line, 3);
});

test("every seed file indexes, and its concepts are found", () => {
  for (const f of readdirSync(SEED).filter((f) => f.endsWith(".ncon"))) {
    const text = readFileSync(join(SEED, f), "utf8");
    const forms = scan(text).marks.filter((m) => m.kind === "form" && /^(Concept|Fact|Reading)$/.test(m.of)).length;
    const found = [...indexPack(text, f).values()].flat().length;
    assert.ok(found > 0 || forms === 0, f);
    assert.ok(found <= forms, f);
  }
});
