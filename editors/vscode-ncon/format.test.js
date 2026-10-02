// node --test format.test.js: the editor formats with the runtime's formatter (needs `pnpm build`),
// and refuses what it would damage.
const assert = require("node:assert/strict");
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { format, problem, CommentsError, RUNTIME } = require("./format.js");

const built = existsSync(RUNTIME);
const SEED = join(__dirname, "../../seed");

test("the editor's formatting is the runtime's", { skip: !built }, async () => {
  const { parse, format: runtime } = await import(join(__dirname, "../../dist/ncon/index.js"));
  const text = 'Concept(The(),Lemma("the"))';
  assert.equal(await format(text), runtime(parse(text)));
  assert.equal(await format(text), 'Concept(The(), Lemma("the"))\n');
});

test("text that does not parse is reported with its position", { skip: !built }, async () => {
  const found = await problem("Concept(X(),\n  Foo(");
  assert.ok(found && found.line >= 1 && found.column >= 1, JSON.stringify(found));
  assert.equal(await problem("Concept(X())"), undefined);
});

test("comments are never dropped silently", { skip: !built }, async () => {
  await assert.rejects(format("// why\nConcept(X())"), CommentsError);
});

test("every seed file parses", { skip: !built }, async () => {
  for (const f of readdirSync(SEED).filter((f) => f.endsWith(".ncon"))) {
    assert.equal(await problem(readFileSync(join(SEED, f), "utf8")), undefined, f);
  }
});
