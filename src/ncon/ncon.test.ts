import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type Arg, type Expr, type NconFile, NconError, filesEqual } from "./ast.js";
import { format } from "./format.js";
import { applyDefaults } from "./forms.js";
import { parse, parseExpr } from "./parse.js";

const P = { line: 0, column: 0 };
const sameData = (a: NconFile, b: NconFile) => filesEqual(applyDefaults(a), applyDefaults(b));

function roundTrip(src: string) {
  const a = parse(src);
  const text = format(a);
  const b = parse(text);
  assert.ok(sameData(a, b), `parse(format(parse(s))) differs for:\n${src}\n---\n${text}`);
  assert.equal(format(b), text, "format is not idempotent");
  return text;
}

test("parses every expression kind", () => {
  const e = parseExpr('Add(theme=Milk(), n=-1.5e2, ok=true, no=null, s="a\\n\\"b", r="""x "y" z""", v=$x, w=_, List#Series())');
  assert.equal(e.kind, "call");
  if (e.kind !== "call") return;
  const kinds = e.args.map((a) => [a.name, a.value.kind]);
  assert.deepEqual(kinds, [
    ["theme", "call"], ["n", "number"], ["ok", "boolean"], ["no", "null"], ["s", "string"],
    ["r", "string"], ["v", "variable"], ["w", "variable"], [undefined, "call"],
  ]);
  assert.equal((e.args[4].value as { value: string }).value, 'a\n"b');
  assert.equal((e.args[5].value as { value: string }).value, 'x "y" z');
  assert.equal((e.args[8].value as { head: string }).head, "List#Series");
});

test("whitespace, comments and trailing commas mean nothing", () => {
  const a = parseExpr("A(b=C(), // note\n  D(),\n)");
  assert.ok(parseExpr("A(b=C(),D())") && format({ forms: [] }) === "");
  assert.equal(JSON.stringify(strip(a)), JSON.stringify(strip(parseExpr("A( b = C() , D() )"))));
  assert.equal(parseExpr('A("// not a comment")').kind, "call");
});

test("errors have positions and the form they were in", () => {
  const bad: [string, RegExp][] = [
    ["Concept(A(), foo)", /bare identifier "foo"/],
    ["Concept(A()", /missing \)/],
    ["Concept A()", /followed by "\("/],
    ['Concept(A(), "x)', /unterminated string/],
    ['Concept(A(), """x)', /unterminated raw/],
    ['Concept(A(), "\\q")', /bad string escape/],
    ["Concept(A(), $)", /needs a name/],
    ["Concept(A(), 1 2)", /expected ","/],
    ["foo()", /bare identifier/],
    ["5", /top-level form must be a call/],
  ];
  for (const [src, re] of bad) {
    assert.throws(() => parse(src), (err) => err instanceof NconError && re.test(err.message) && err.pos.line >= 1, src);
  }
  try {
    parse("Pack(name=\"p\", version=\"1\")\n\nConcept(A(),\n  Lemma(\"a\"),\n  oops)");
    assert.fail("should throw");
  } catch (err) {
    assert.ok(err instanceof NconError);
    assert.equal(err.pos.line, 5);
    assert.equal(err.form, "Concept");
  }
});

test("top-level forms are checked", () => {
  const bad: [string, RegExp][] = [
    ["Lemma(\"x\")", /cannot appear at top level/],
    ['Concept(A())\nPack(name="p", version="1")', /Pack must be the first/],
    ["Concept()", /at least 1/],
    ["Concept(\"a\")", /written as Name\(\)/],
    ["Concept(A(x=1))", /written as Name\(\)/],
    ["Concept(A(), foo=1)", /does not take "foo"/],
    ["Fact(A())", /exactly 2/],
    ["Reading(on=A())", /needs "pattern"/],
    ["Block(media=\"text/plain\")", /needs "body"/],
    ["Retract(id=1, id=2)", /given twice/],
    ['Pack(name="p", version="1", weight=1)', /does not take "weight"/],
    ["Concept(A(), status=Done())", /Active\(\), Proposed\(\) or Pending\(\)/],
    ['Concept(A(), at="yesterday")', /ISO 8601/],
    ["Concept(A(), weight=\"x\")", /must be a number/],
  ];
  for (const [src, re] of bad) assert.throws(() => parse(src), (err) => err instanceof NconError && re.test(err.message), src);
  // inside a claim, reserved names are ordinary roles
  assert.doesNotThrow(() => parse("Concept(X(), Near(at=Home()))"));
});

test("an invalid file loads nothing", () => {
  assert.throws(() => parse('Concept(A())\nConcept(B(), 1 2)'));
});

test("formats the spec's example canonically", () => {
  const src = `Pack(name="seed", version="0.1.0", from=Seed("function-words"))
Concept(The(), Lemma("the"), Category(Thing()), Takes(side=Right(), category=Noun()), from=Seed("function-words"), status=Active())
Reading(on=Can(), pattern=Can(agent=You(), act=$x), wants=Doable($x), becomes=$x)
Concept(List#Series(), SenseOf(List()), IsA(Series()), Holds(Item()), from=WordNet("list.n.01"), weight=3, at="2026-01-01T00:00:00Z")`;
  const text = format(parse(src));
  assert.equal(
    text,
    `Pack(name="seed", version="0.1.0", from=Seed("function-words"))

Concept(The(), Lemma("the"), Category(Thing()), Takes(side=Right(), category=Noun()))

Reading(on=Can(), pattern=Can(agent=You(), act=$x), wants=Doable($x), becomes=$x)

Concept(
  List#Series(),
  SenseOf(List()),
  IsA(Series()),
  Holds(Item()),
  from=WordNet("list.n.01"),
  at="2026-01-01T00:00:00Z",
  weight=3
)
`,
  );
  roundTrip(src);
});

test("metadata goes last in order; arguments are not sorted", () => {
  const text = format(parse('Concept(A(), id=1, weight=2, B(), status=Proposed(), at="2026-01-01T00:00:00Z", C())'));
  assert.equal(text, 'Concept(A(), B(), C(), at="2026-01-01T00:00:00Z", status=Proposed(), weight=2, id=1)\n');
});

test("long strings and newlines print raw unless that is unsafe", () => {
  assert.match(format(parse('Concept(A(), Note("a\\nb"))')), /"""a\nb"""/);
  assert.match(format(parse(`Concept(A(), Note("${"x".repeat(81)}"))`)), /"""x{81}"""/);
  assert.match(format(parse('Concept(A(), Note("a\\n\\"\\"\\"b"))')), /Note\("a\\n\\"\\"\\"b"\)/);
  assert.match(format(parse('Concept(A(), Note("a\\nb\\""))')), /"a\\nb\\""/);
  for (const s of ['Concept(A(), Note("a\\nb\\""))', 'Concept(A(), Note("\\"q\\"\\n"))', "Concept(A(), Note(\"\"\"\"q\"\"\"))"]) roundTrip(s);
});

test("a form wider than 100 columns breaks, nested calls too", () => {
  const long = `Reading(on=Add(), pattern=Add(theme=$x, destination=To($y)), wants=All(Doable($x), Known($y), Allowed(Write(target=$y))), becomes=Write(target=$y, content=$x))`;
  const text = roundTrip(long);
  assert.ok(text.split("\n").every((l) => l.length <= 100));
  assert.match(text, /^Reading\(\n  on=Add\(\),/);
});

test("round trip over generated expressions", () => {
  let seed = 12345;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  const STR = ["", "a", "he said \"hi\"", "line1\nline2", "x".repeat(90), "tab\tand \\ slash", "ünï ☃", "\"\"\"", "ends\"", "// not comment"];
  const gen = (d: number): Expr => {
    const k = rnd(d > 3 ? 6 : 8);
    if (k === 0) return { kind: "number", value: [0, 1, -2, 3.5, 1e21, 0.1, -0.5e-7][rnd(7)], pos: P };
    if (k === 1) return { kind: "string", value: STR[rnd(STR.length)], pos: P };
    if (k === 2) return { kind: "boolean", value: rnd(2) === 0, pos: P };
    if (k === 3) return { kind: "null", pos: P };
    if (k === 4) return { kind: "variable", text: ["_", "$x", "$_y", "$a1"][rnd(4)], pos: P };
    const args: Arg[] = Array.from({ length: rnd(d > 3 ? 1 : 6) }, () => ({
      name: rnd(3) === 0 ? ["theme", "agent", "at", "x1"][rnd(4)] : undefined,
      value: gen(d + 1),
    }));
    return { kind: "call", head: ["Add", "List#Series", "A", "Takes", "Not"][rnd(5)], args, pos: P };
  };
  for (let n = 0; n < 500; n++) {
    // wrap each in a valid top-level form so the file validates
    const file: NconFile = {
      forms: Array.from({ length: 1 + rnd(3) }, () => ({
        kind: "call" as const,
        head: "Concept",
        args: [{ value: { kind: "call" as const, head: "N", args: [], pos: P } }, { value: gen(0) }],
        pos: P,
      })),
    };
    const text = format(file);
    const back = parse(text);
    assert.ok(sameData(file, back), text);
    assert.equal(format(back), text);
  }
});

test("every .ncon file in the repository round-trips", () => {
  const root = join(import.meta.dirname, "..", "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ncon")) files.push(p);
    }
  };
  walk(root);
  for (const f of files) roundTrip(readFileSync(f, "utf8"));
});

function strip(e: Expr): unknown {
  if (e.kind === "call") return { h: e.head, a: e.args.map((a) => [a.name, strip(a.value)]) };
  const { pos: _pos, ...rest } = e;
  return rest;
}
