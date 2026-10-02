import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../../assistant/index.js";
import { key } from "../expr.js";
import { seededStore } from "../seed.js";
import { Learner } from "./learn.js";
import type { Found } from "./sources.js";

// An invented lexicon standing in for imports (testing.md section 2.1), and an invented page about
// an invented place, with an invented claim: nothing here touches the network.
const LEXICON = `Pack(name="test-lexicon", version="0", from=WordNet("test"))
Concept(Capital(), Lemma("capital"), Category(Noun()))
Concept(Glorp(), Lemma("glorp"), Category(Noun()))
`;
const PAGE: Found = {
  title: "Zorbia",
  text: "Zorbia (an invented place) is a glorp. It has many hills.",
  url: "https://en.wikipedia.org/wiki/Zorbia",
  source: "Wikipedia",
  entity: "Q0",
};

function store() {
  const st = seededStore();
  st.load(LEXICON);
  return st;
}

test("a page's opening and its entity's claims become facts on what it is about, with their sources", () => {
  const st = store();
  const learned = new Learner(st).learn(PAGE, [{ property: "capital", value: "Quuxton" }, { property: "frobnitz", value: "x" }]);
  assert.equal(learned.topic, "Zorbia#Topic");
  const facts = learned.facts.map((f) => `${key(f.claim)} <- ${key(f.meta.from)}`);
  assert.ok(facts.includes('Be(Zorbia#Topic(), Some(Glorp())) <- Wikipedia("https://en.wikipedia.org/wiki/Zorbia")'), facts.join("\n"));
  assert.ok(facts.includes('Capital(Zorbia#Topic(), "Quuxton") <- Wikidata("https://www.wikidata.org/wiki/Q0")'), facts.join("\n"));
  // A label nothing knows is not a claim the graph can hold; it is counted, not guessed.
  assert.equal(learned.dropped.claims, 1);
  // The title, a word nothing knew, is now the topic's own word.
  assert.ok(st.lookup("zorbia").some((h) => h.concept === "Zorbia#Topic"));
});

test("a question about what was learned is answered from the facts, with Know offline", async () => {
  const st = store();
  new Learner(st).learn(PAGE, [{ property: "capital", value: "Quuxton" }]);
  const s = createSession(st, mkdtempSync(join(tmpdir(), "noodle-know-")), { know: "offline", grants: ["SendsOutside"] });
  assert.equal((await s.turn("what is the capital of zorbia")).text, "From Wikidata:\n\nQuuxton");
  // Said through the realizations, the topic in the user's own word for it.
  assert.equal((await s.turn("what is zorbia")).text, "From Wikipedia:\n\nzorbia is glorp");
  // Nothing was learned about what was not asked before, and offline nothing goes out for it.
  assert.doesNotMatch((await s.turn("what is the capital of blorpia")).text, /Quuxton|From /);
});
