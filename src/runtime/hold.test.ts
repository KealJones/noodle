// Holding and remembering (built-ins.md section 2): holders that are things in the graph, the
// referents that find them again, and facts the user tells about themselves. An invented lexicon
// stands in for the imports (testing.md section 2.1); nothing here touches the network or ~/.noodle.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { c, isCall, key, positional } from "./expr.js";
import { PRIMITIVES } from "./primitives/index.js";
import { isThing, things } from "./primitives/hold.js";
import type { World } from "./primitive.js";
import { seededStore } from "./seed.js";
import type { Store } from "./store.js";

// Verbs in VerbNet's shape (a caused location, and its end), a tool's reading competing for one of
// them, and nouns with WordNet's sense shape.
const LEXICON = `Pack(name="test-holding", version="0", from=Seed("test"))
Concept(Stash(), Lemma("stash"),
  Category(Act(), Takes(side=Right(), category=Thing(), role=Theme()), Takes(side=Right(), category=Relation(), role=Destination())),
  Category(Act()))
Reading(on=Stash(), pattern=Stash(agent=$a, theme=$t, destination=$d), becomes=Cause(agent=$a, result=Become(HasLocation($t, $d))))
Reading(on=Stash(), pattern=Stash(), becomes=Run("tool", Args("stash")), effects=UnknownEffects())
Concept(Drop(), Lemma("drop"),
  Category(Act(), Takes(side=Right(), category=Thing(), role=Theme()), Takes(side=Right(), category=Relation(), role=Source(), head=From())))
Reading(on=Drop(), pattern=Drop(agent=$a, theme=$t, source=$s), becomes=Cause(agent=$a, result=Become(Not(HasLocation($t, $s)))))
Concept(Basket(), Lemma("basket"), Category(Noun()), Sense(Basket#Container()))
Concept(Basket#Container(), SenseOf(Basket()), IsA(Container#Thing()))
Concept(Milk(), Lemma("milk"), Category(Noun()))
Concept(Bread(), Lemma("bread"), Category(Noun()))
Fact(Name(), Category(Noun()))
`;

function store(): Store {
  const st = seededStore();
  st.load(LEXICON);
  return st;
}

const root = () => mkdtempSync(join(tmpdir(), "noodle-hold-"));

test("putting things in my basket keeps them in the graph, and asking reads them back", async () => {
  const st = store();
  const s = createSession(st, root());
  assert.equal((await s.turn("stash milk in my basket")).text, "Added milk to your basket.");
  assert.equal((await s.turn("stash bread in my basket")).text, "Added bread to your basket.");
  assert.equal((await s.turn("what is in my basket?")).text, "Your basket has milk and bread.");
  // One basket, found again by its kind and its words.
  assert.equal(things(st).length, 1);
  assert.equal((await s.turn("drop milk from the basket")).text, "Removed milk from your basket.");
  assert.equal((await s.turn("what is in it?")).text, "Your basket has bread.");
  // Another session over the same store: the basket is still the user's.
  const later = createSession(st, root());
  assert.equal((await later.turn("what is in my basket?")).text, "Your basket has bread.");
});

test("the tool's reading of the verb loses to the one whose arguments it reads", async () => {
  const s = createSession(store(), root());
  const r = await s.turn("stash milk in my basket");
  assert.ok(r.acts.some((a) => isCall(a) && a.head === "Store"), r.record.lf.map(key).join("; "));
  assert.ok(!r.acts.some((a) => isCall(a) && a.head === "Run"));
});

test("what I say about myself is remembered and recalled", async () => {
  const st = store();
  const s = createSession(st, root());
  assert.equal((await s.turn("my name is Zed")).text, "Got it: your name is Zed.");
  assert.equal((await s.turn("what is my name?")).text, "Your name is Zed.");
  assert.equal((await createSession(st, root()).turn("what's my name")).text, "Your name is Zed.");
});

test("Store, Remove and Contains on a holder in the graph; Remove retracts and Store restores", async () => {
  const st = store();
  const world: World = { root: root(), store: st, now: () => new Date(0), say() {}, ask() {} };
  const [Store, Remove, Contains] = ["Store", "Remove", "Contains"].map((n) => PRIMITIVES.get(n)!);
  const ref = c("Ref", ["kind", c("Basket")], ["said", c("My", c("Basket"))]);
  const kept = await Store.run([ref, c("And", c("Milk"), c("Bread"))], world);
  const basket = positional(kept as never)[0];
  assert.ok(isThing(st, basket));
  assert.ok(await Store.check!([basket, c("Milk")], kept, world));
  assert.deepEqual(Store.effects([basket, c("Milk")], world), ["ChangesGraph"]);
  // Taking out what the user put in loses nothing: it is retracted, not deleted, and not guarded.
  assert.deepEqual(Remove.effects([basket, c("Milk")], world), ["ChangesGraph"]);
  const left = await Remove.run([basket, c("Milk")], world);
  assert.ok(await Remove.check!([basket, c("Milk")], left, world));
  assert.equal(key(await Contains.run([basket, c("Milk")], world)), key({ kind: "boolean", value: false, pos: { line: 0, column: 0 } }));
  const undo = await Remove.inverse!([basket, c("Milk")], left, world);
  assert.equal(key(undo!), key(c("Store", basket, c("Milk"))));
  await Store.run([basket, c("Milk")], world);
  assert.equal(key(await Contains.run([basket, c("Milk")], world)), key({ kind: "boolean", value: true, pos: { line: 0, column: 0 } }));
  // Something not there cannot be taken out, and a word is not a holder.
  await assert.rejects(Remove.run([basket, c("Pear")], world));
  await assert.rejects(Store.run([c("Basket"), c("Milk")], world));
});
