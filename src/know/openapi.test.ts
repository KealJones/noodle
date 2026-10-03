import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { seededStore } from "../runtime/seed.js";
import { learnOpenApi, patternsFor } from "./openapi.js";
import { c, v } from "../runtime/expr.js";
import { format } from "../ncon/index.js";

// What the imports would give these words: two acts that take what they are done to, and nouns.
const WORDS = `Pack(name="test-words", version="0", from=Seed("test"))
Concept(Submit(), Lemma("submit"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Tally(), Lemma("tally"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Review(), Lemma("review"), Category(Noun()))
Concept(Note(), Lemma("note"), Category(Noun()))
`;

// A tiny invented service: its paths, methods, parameters and summaries, in OpenAPI 3.
const DOC = {
  openapi: "3.0.3",
  info: { title: "Invented service", version: "1.0" },
  paths: {
    "/shelves/{owner}/reviews": {
      post: {
        operationId: "reviews/submit",
        summary: "Submit a review",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/review" } } } },
      },
    },
    "/shelves/{owner}/notes/{note_id}": {
      parameters: [{ $ref: "#/components/parameters/note-id" }],
      get: { operationId: "notes/tally", summary: "Tally a note" },
    },
  },
  components: {
    parameters: { "note-id": { name: "note_id", in: "path", required: true, description: "The note.", schema: { type: "integer" } } },
    schemas: {
      review: {
        type: "object",
        properties: {
          event: { type: "string", enum: ["APPROVE", "COMMENT"], description: "What the review does." },
          line: { type: "integer", description: "The line." },
        },
      },
    },
  },
};

const CLI = { command: ["svc", "call"], method: "-X", field: "-f", typedField: "-F", fills: ["owner"] };

async function learned() {
  const words = seededStore();
  words.load(WORDS);
  const store = seededStore();
  store.load(WORDS);
  const r = await learnOpenApi(DOC, "invented", CLI, store, words);
  return { store, r };
}

test("each operation is a concept with its parameters as roles, its effects from its method", async () => {
  const { r } = await learned();
  assert.equal(r.operations, 2);
  assert.equal(r.understood, 2);
  // The parameters a request fills: in the path (minus what the program fills), the body.
  assert.equal(r.parameters, 3);
  const text = r.text.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/,\s+/g, ", ");
  assert.match(text, /Field\("note_id"\), In\("path"\), Required\(\), Type\("integer"\)/);
  assert.match(text, /Field\("event"\), In\("body"\), Type\("string"\), OneOf\("APPROVE", "COMMENT"\)/);
  // The program, configured: from the user, not the description.
  assert.match(text, /Cli\("svc", Args\("call"\), method="-X", field="-f", typedField="-F"\), CliFills\("owner"\), from=User\(\)/);
  // A change to what others see, and a read from a service elsewhere.
  assert.match(text, /becomes=Run\("svc", Args\("call", "-X", "POST", "shelves\/\{owner\}\/reviews"\)\), effects=All\(Publishes\(\), SendsOutside\(\)\)/);
  assert.match(text, /becomes=Run\("svc", Args\("call", "-X", "GET", Joined\("shelves\/\{owner\}\/notes\/", \$note_id\)\)\), effects=All\(Reads\(\), SendsOutside\(\)\)/);
  // Nothing the description says names any service in code: the from is the description's.
  assert.match(text, /from=ApiDoc\("invented", "reviews\/submit"\)/);
  // One hierarchy: the API is a sense of its name's word, served by its program; each operation
  // is part of it, each parameter part of its operation, each called by its own name.
  assert.match(text, /Concept\(Invented\(\), Lemma\("invented"\), Sense\(Invented#Api\(\)\), Category\(Thing\(\)\)/);
  assert.match(text, /IsA\(Api\(\)\), Name\("invented"\), ServedBy\(Svc\(\)\)/);
  assert.match(text, /IsA\(Operation\(\)\), PartOf\(Invented#Api\(\)\), Name\("reviews\/submit"\)/);
  assert.match(text, /IsA\(Parameter\(\)\), PartOf\([A-Za-z#]+\(\)\), Name\("event"\)/);
});

test("a pattern is the summary's act, done to its kind of thing however that thing is said", () => {
  const what = c("Submit", ["theme", c("Some", c("Review", ["purpose", c("Some", c("Note"))], ["modifier", c("Note")]))], ["agent", c("Addressee")]);
  const noun = (h: string) => h === "Review" || h === "Note";
  const shown = patternsFor(what, noun).map((p) => format({ forms: [p] }).trim());
  assert.deepEqual(shown, [
    "Submit(theme=Ref(kind=Review(modifier=Note())))",
    "Submit(theme=Review(modifier=Note()))",
    "Submit(theme=Some(Review(modifier=Note())))",
    "Submit(theme=Every(Review(modifier=Note())))",
  ]);
  // An agent said first stays a place anything fills.
  assert.equal(format({ forms: [patternsFor(c("Remove", c("Addressee"), c("Some", c("Review"))), noun)[0]] }).trim(), "Remove(_, Ref(kind=Review()))");
  // Either of two acts; never an act done to an act, or to nothing.
  assert.equal(patternsFor(c("Or", what, c("Tally", ["theme", c("Note")])), noun).length, 8);
  assert.deepEqual(patternsFor(c("Tally", ["theme", c("Submit", ["theme", c("Review")])]), noun), []);
  assert.deepEqual(patternsFor(v("x"), noun), []);
});

test("an operation is offered before it runs, even where what it claims is granted", async () => {
  const { store, r } = await learned();
  store.load(r.text);
  const root = mkdtempSync(join(tmpdir(), "noodle-openapi-"));
  const s = createSession(store, root, { grants: ["Publishes", "SendsOutside", "Deletes"] });
  const said = (await s.turn("submit the review")).text;
  assert.match(said, /`svc call -X POST shelves\/\{owner\}\/reviews`/);
  assert.match(said, /Go ahead\?$/);
  // A placeholder the request does not fill is not guessed: the act is not worked out.
  assert.doesNotMatch((await s.turn("tally the note")).text, /svc call/);
});
