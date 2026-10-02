import assert from "node:assert/strict";
import { test } from "node:test";
import { c, key } from "../runtime/expr.js";
import { Rewriter } from "../runtime/rewrite.js";
import { Weights } from "../runtime/score.js";
import { seededStore } from "../runtime/seed.js";
import { Understander, definitionsPack } from "./definitions.js";
import { importWordNet } from "./wordnet.js";

// An invented WN-LMF fragment: "remind" is defined through "remember", which is defined in core
// meanings; "glorp" and "blick" are defined only through each other; "frob" through a word nobody
// defines.
const entry = (lemma: string, ...synsets: string[]) =>
  `<LexicalEntry id="e-${lemma}"><Lemma writtenForm="${lemma}" partOfSpeech="v"/>${synsets.map((s, i) => `<Sense id="s-${lemma}-${i}" synset="${s}"/>`).join("")}</LexicalEntry>`;
const synset = (id: string, definition: string) => `<Synset id="${id}" ili="" partOfSpeech="v"><Definition>${definition}</Definition></Synset>`;
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<LexicalResource><Lexicon id="oewn" label="test" language="en" email="x" license="x" version="2024">
  ${entry("know", "v-know")}
  ${entry("remember", "v-remember")}
  ${entry("remind", "v-remind")}
  ${entry("glorp", "v-glorp")}
  ${entry("blick", "v-blick")}
  ${entry("frob", "v-frob")}
  ${synset("v-know", "be aware of")}
  ${synset("v-remember", "know")}
  ${synset("v-remind", "cause to remember")}
  ${synset("v-glorp", "blick")}
  ${synset("v-blick", "glorp")}
  ${synset("v-frob", "zorble")}
</Lexicon></LexicalResource>`;

function setup() {
  const store = seededStore();
  store.load(importWordNet(XML, store, { version: "2024" }).text);
  const u = new Understander(store);
  const sense = (lemma: string) => u.sensesOf(store.lookup(lemma).find((h) => store.facts(h.concept, "Sense").length)!.concept, "PartOfSpeechVerb")[0];
  return { store, u, sense };
}

test("a definition bottoms out through the senses of its words", () => {
  const { u, sense } = setup();
  const remind = sense("remind");
  const [d] = u.understandAll([remind]).filter((x) => x.sense === remind);
  assert.equal(d.status, "Active");
  assert.equal(d.via, "Definition");
  assert.equal(d.depth, 1);
  // Cause, with what is reminded remembering: the open argument is the object's variable, and
  // "remember" is its sense, not the word.
  assert.match(key(d.becomes!), /^Cause\(result=Remember_2#\w+\(agent=\$x\)\)$/);
  assert.ok(d.patterns.length >= 1 && d.patterns.every((p) => key(p).includes("$x")));
  const remember = u.understand(sense("remember"));
  assert.equal(remember.status, "Active");
  assert.equal(remember.depth, 0);
});

test("definitions that only define each other, or use a word nobody defines, stay Pending", () => {
  const { u, sense } = setup();
  const defs = u.understandAll([sense("glorp"), sense("frob")]);
  const glorp = defs.find((d) => d.sense === sense("glorp"))!;
  assert.equal(glorp.status, "Pending");
  assert.deepEqual(glorp.unknown, ["Blick"]);
  const frob = defs.find((d) => d.sense === sense("frob"))!;
  assert.equal(frob.status, "Pending");
  assert.deepEqual(frob.unknown, ['"zorble"']);
});

test("a learned definition is a reading on the sense, used when a request has the word", () => {
  const { store, u, sense } = setup();
  const defs = u.understandAll([sense("remind"), sense("glorp")]);
  const text = definitionsPack(store, defs, "test");
  assert.match(text, /from=Derived\(WordNet\("v-remind"\), Seed\("core"\)\)/);
  assert.match(text, /status=Pending/);
  store.load(text);
  // "remind me": the word's sense is a candidate for the word, and its definition rewrites it.
  const rw = new Rewriter(store, new Weights(store).get);
  const out = rw.normalize(c("Remind", ["theme", c("Speaker")])).map((d) => key(d.expr));
  assert.ok(out.some((x) => /^Cause\(result=.*Know.*Speaker\(\)/.test(x)), out.join("\n"));
  // A Pending definition is kept but not used.
  assert.ok(rw.normalize(c("Glorp")).every((d) => !key(d.expr).includes("#")));
});
