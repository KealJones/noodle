import assert from "node:assert/strict";
import { test } from "node:test";
import { seededStore } from "../runtime/seed.js";
import { Store } from "../runtime/store.js";
import { importWordNet } from "./wordnet.js";
import { encodeLemma } from "./names.js";

// An invented WN-LMF fragment in the shape of Open English WordNet's release.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE LexicalResource SYSTEM "http://globalwordnet.github.io/schemas/WN-LMF-1.3.dtd">
<LexicalResource xmlns:dc="https://globalwordnet.github.io/schemas/dc/">
<Lexicon id="oewn" label="Open English WordNet" language="en" email="x" license="https://creativecommons.org/licenses/by/4.0/" version="2024">
  <LexicalEntry id="oewn-list-n"><Lemma writtenForm="list" partOfSpeech="n"/><Sense id="oewn-list__1.10.00.." synset="oewn-06493721-n"/></LexicalEntry>
  <LexicalEntry id="oewn-list-v"><Lemma writtenForm="list" partOfSpeech="v"/><Form writtenForm="listed"/><Sense id="oewn-list__2.32.00.." synset="oewn-01003570-v"/></LexicalEntry>
  <LexicalEntry id="oewn-listing-n"><Lemma writtenForm="listing" partOfSpeech="n"/><Sense id="oewn-listing__1.10.00.." synset="oewn-06493721-n"/></LexicalEntry>
  <LexicalEntry id="oewn-series-n"><Lemma writtenForm="series" partOfSpeech="n"/><Sense id="s1" synset="oewn-08476615-n"/></LexicalEntry>
  <LexicalEntry id="oewn-enumerate-v"><Lemma writtenForm="enumerate" partOfSpeech="v"/><Sense id="s2" synset="oewn-01003570-v"/></LexicalEntry>
  <LexicalEntry id="oewn-run-v"><Lemma writtenForm="run" partOfSpeech="v"/><Sense id="s3" synset="oewn-02000001-v"/></LexicalEntry>
  <Synset id="oewn-06493721-n" ili="i1" partOfSpeech="n" members="oewn-list-n oewn-listing-n"><Definition>a database containing an ordered array of items &amp; such</Definition><SynsetRelation relType="hypernym" target="oewn-08476615-n"/></Synset>
  <Synset id="oewn-08476615-n" ili="i2" partOfSpeech="n"><Definition>similar things placed in order</Definition></Synset>
  <Synset id="oewn-01003570-v" ili="i3" partOfSpeech="v"><Definition>give an itemized list of</Definition></Synset>
  <Synset id="oewn-02000001-v" ili="i4" partOfSpeech="v"><Definition>move fast by using one's feet</Definition></Synset>
</Lexicon>
</LexicalResource>`;

test("lemmas encode to names as ncon.md says", () => {
  assert.equal(encodeLemma("e-mail"), "EMail");
  assert.equal(encodeLemma("don't"), "Dont");
  assert.equal(encodeLemma("work in progress"), "WorkInProgress");
  assert.equal(encodeLemma("3"), undefined);
});

test("WordNet imports words, shared senses named by kind, definitions as blocks", () => {
  const seed = seededStore();
  const r = importWordNet(XML, seed, { version: "2024" });
  const store = new Store();
  store.load(r.text);
  // The noun sense is shared by "list" and "listing", named from its hypernym.
  assert.ok(store.facts("List", "Sense").some((f) => JSON.stringify(f.claim).includes("List#Series")));
  assert.ok(store.facts("Listing", "Sense").some((f) => JSON.stringify(f.claim).includes("List#Series")));
  assert.ok(store.facts("List#Series", "IsA").length === 1);
  // With no hypernym, the closest synonym names it.
  assert.ok(store.facts("List", "Sense").some((f) => JSON.stringify(f.claim).includes("List#Enumerate")));
  // A definition is content, referred to, not a string on the concept.
  const said = store.facts("List#Series", "Said")[0];
  assert.ok(said);
  assert.match(JSON.stringify(said.claim), /b_[0-9a-f]{16}/);
  // "list" is the seed's core concept List (seed decision 1); the seed gives it no chart entries,
  // so its parts of speech do. "the" has the seed's entries, so it gets none from an import.
  assert.ok(store.facts("List", "Category").length >= 2);
  // "run" is not the primitive Run.
  assert.ok(store.lookup("run").every((h) => h.concept !== "Run"));
  assert.ok(store.facts("Enumerate", "Category").length >= 1);
});
