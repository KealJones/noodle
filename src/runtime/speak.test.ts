// Speaking (design sections 23 and 25b): realizations compose. A wrapper says the wrapping and puts
// its child in a sentence; the child says itself; a block inside a paragraph is the printer's to
// split. Over the seed alone; nothing here touches the network or ~/.noodle.

import assert from "node:assert/strict";
import { test } from "node:test";
import { c, s } from "./expr.js";
import { seededStore } from "./seed.js";
import { Speaker } from "./speak.js";

const speaker = new Speaker(seededStore());
const say = (e: Parameters<Speaker["say"]>[0], medium = "Markdown") => speaker.say(e, medium);

test("a clause in a sentence starts with a capital and ends with a period; a block stays a block", () => {
  assert.equal(say(c("Sentence", c("Paragraph", s("the square root of 81 is "), { kind: "number", value: 9, pos: { line: 0, column: 0 } }))), "The square root of 81 is 9.");
  assert.equal(say(c("Sentence", c("Paragraph", s("we're in "), c("Code", s("/tmp"))))), "We're in `/tmp`.");
  assert.equal(say(c("Sentence", c("List", s("a"), s("b")))), "- a\n- b");
  assert.equal(say(c("Sentence", c("Paragraph", s("x"))), "PlainText"), "X.");
});

test("a paragraph holding a block is split around it, in any medium", () => {
  const p = c("Paragraph", c("Code", s("notes.txt")), s(":"), c("CodeBlock", s("buy milk\n")));
  assert.equal(say(p), "`notes.txt`:\n\n```\nbuy milk\n```");
  assert.equal(say(p, "PlainText"), "notes.txt:\n\nbuy milk");
  // A paragraph inside a paragraph is the same run of text; the block is split out of both.
  const nested = c("Paragraph", s("I couldn't work out it. "), c("Paragraph", s("before "), c("List", s("a")), s(" after")));
  assert.equal(say(nested), "I couldn't work out it. before\n\n- a\n\nafter");
  // A sentence whose clause holds a block is a block: no period after it.
  assert.equal(say(c("Sentence", p)), "`notes.txt`:\n\n```\nbuy milk\n```");
});

test("what an act gave says itself; the outcome only says the wrapping", () => {
  const ran = c("Ran", s("git"), c("Args", s("commit")), ["exit", { kind: "number", value: 1, pos: { line: 0, column: 0 } }], ["output", s("nothing to commit")]);
  assert.equal(say(c("Outcome", c("Run", s("git"), c("Args", s("commit"))), ["result", ran])), "`git commit` failed (exit 1):\n\n```\nnothing to commit\n```");
  const ok = c("Ran", s("touch"), c("Args", s("a")), ["exit", { kind: "number", value: 0, pos: { line: 0, column: 0 } }]);
  assert.equal(say(c("Outcome", c("Run", s("touch"), c("Args", s("a"))), ["result", ok])), "Ran `touch a`.");
  assert.equal(say(c("Outcome", c("Run", s("touch"), c("Args", s("a"))), ["result", s("")])), "Done: run `touch a`.");
});
