import assert from "node:assert/strict";
import { test } from "node:test";
import { c, s } from "./expr.js";
import { seededStore } from "./seed.js";
import { Store } from "./store.js";

test("the seed loads, and lookup is by lemma and form", () => {
  const store = seededStore();
  assert.ok(store.lookup("don't").some((h) => h.concept === "Dont"));
  assert.ok(store.lookup("dont").some((h) => h.concept === "Dont"));
  assert.ok(store.lookup("WAS").some((h) => h.concept === "Be" && h.features.includes("Past")));
  assert.ok(store.readingsOn("Yet").length > 0);
  assert.equal(store.packList().length, 8);
});

test("kinds are transitive and kind distance goes through the nearest common ancestor", () => {
  const store = seededStore();
  assert.equal(store.kinds("People").get("Something"), 2);
  assert.equal(store.kindDistance("People", "Place"), 3);
});

test("export, import into an empty store, and export again gives the same text", () => {
  const a = seededStore();
  a.addFact("Plan_1", c("IsA", c("Plan")), c("User"));
  const text = a.export();
  const b = new Store();
  b.load(text);
  assert.equal(b.export(), text);
});

test("a file loads atomically: an invalid item writes nothing", () => {
  const store = new Store();
  assert.throws(() => store.load(`Pack(name="x", version="1", from=Seed("x"))\nConcept(A(), IsA(B()))\nRetract(id="x")\nBlock(media="text")`));
  assert.equal(store.export(), "");
});

test("identical content is one block", () => {
  const store = new Store();
  const a = store.addBlock("hello", "text/plain", c("User"));
  const b2 = store.addBlock("hello", "text/plain", c("User"));
  assert.equal(a.id, b2.id);
  assert.match(a.id, /^b_[0-9a-f]{16}$/);
  void s;
});
