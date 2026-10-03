// Regression tests for the runtime review of 2026-10-01: each finding, as an input that failed.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAssistant, createSession } from "../assistant/index.js";
import { seededStore } from "./seed.js";

const ZAP = `Pack(name="test-review", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act()))
Reading(on=Zap(), pattern=Zap(), becomes=Run("touch", Args("zapped")), effects=UnknownEffects())
Concept(Push(), Lemma("push"), Category(Act()))
Reading(on=Push(), pattern=Push(), becomes=Run("touch", Args("pushed")), effects=UnknownEffects())
Concept(Escape(), Lemma("escape"), Category(Act()))
Reading(on=Escape(), pattern=Escape(), becomes=Write("../escape.txt", "hi"))
`;
const DOC = `Pack(name="test-doc", version="0", from=ToolDoc("tool"))
Concept(Blip(), Lemma("blip"), Category(Act()))
Reading(on=Blip(), pattern=Blip(), becomes=Run("touch", Args("blipped")), effects=UnknownEffects())
`;
function session(grants?: ("UnknownEffects")[]) {
  const store = seededStore();
  store.load(ZAP);
  store.load(DOC);
  const root = mkdtempSync(join(tmpdir(), "noodle-review-"));
  return { s: createSession(store, root, grants ? { grants } : {}), root };
}

test("a yes does not run an offered act that a rule said since forbids", async () => {
  const { s, root } = session();
  await s.turn("zap");
  await s.turn("dont zap, go ahead");
  assert.ok(!existsSync(join(root, "zapped")));
});

test("a never left on an act is not dropped: never push offers nothing to run", async () => {
  const { s, root } = session(["UnknownEffects"]);
  const r = await s.turn("never push", { dry: true });
  assert.ok(!r.acts.some((a) => JSON.stringify(a).includes("pushed")), r.text);
  assert.ok(!existsSync(join(root, "pushed")));
});

test("a primitive whose effects cannot be worked out does not crash the turn", async () => {
  const { s } = session();
  const r = await s.turn("escape");
  assert.ok(typeof r.text === "string");
});

test("a dry run leaves the conversation as it was", async () => {
  const { s } = session();
  await s.turn("zap");
  const turns = s.conversation.turns.length;
  await s.turn("dont zap yet", { dry: true });
  await s.turn("thanks", { dry: true });
  assert.equal(s.conversation.turns.length, turns);
  assert.equal(s.conversation.rules.length, 0);
  assert.ok(s.conversation.proposal);
});

test("a reading from documentation is offered even under a grant, and runs once confirmed", async () => {
  const { s, root } = session(["UnknownEffects"]);
  assert.match((await s.turn("blip")).text, /Go ahead\?/);
  await s.turn("yes");
  assert.ok(existsSync(join(root, "blipped")));
  // Confirmed once, the grant applies.
  assert.doesNotMatch((await s.turn("blip")).text, /Go ahead\?/);
});

test("an offer of three acts is a list", async () => {
  const { s } = session();
  const r = await s.turn("zap and push and blip");
  assert.match(r.text, /^I can do these, in order:\n\n- run `touch zapped`\n- run `touch pushed`\n- run `touch blipped`\n\nGo ahead\?$/);
});

test("two chats that start alike do not share a session", async () => {
  const store = seededStore();
  store.load(ZAP);
  const root = mkdtempSync(join(tmpdir(), "noodle-review-"));
  const a = createAssistant({ store, root });
  const say = async (msgs: { role: "user" | "assistant"; content: string }[]) => {
    let out = "";
    for await (const x of a.reply(msgs)) out += x;
    return out;
  };
  const offer = await say([{ role: "user", content: "zap" }]);
  await say([{ role: "user", content: "zap" }, { role: "assistant", content: "something else" }, { role: "user", content: "yes" }]);
  assert.ok(!existsSync(join(root, "zapped")), "another chat's yes must not permit this chat's offer");
  await say([{ role: "user", content: "zap" }, { role: "assistant", content: offer }, { role: "user", content: "yes" }]);
  assert.ok(existsSync(join(root, "zapped")));
});

// Found 2026-10-03: a documentation reading whose pattern binds an argument lost its untrusted
// mark once that argument was rewritten after it, so under a grant it ran unoffered.
test("a reading from documentation stays untrusted when a part of its act is rewritten after it", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-doc2", version="0", from=ToolDoc("tool2"))
Concept(Frob(), Lemma("frob"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Reading(on=Frob(), pattern=Frob(theme=$x), becomes=Run("touch", Args($x)), effects=UnknownEffects())
`);
  store.load(`Pack(name="test-words2", version="0", from=Seed("test"))
Concept(Gadget(), Lemma("gadget"), Category(Thing()))
Reading(on=Gadget(), pattern=Gadget(), becomes="frobbed")
`);
  const root = mkdtempSync(join(tmpdir(), "noodle-review-"));
  const s = createSession(store, root, { grants: ["UnknownEffects"] });
  assert.match((await s.turn("frob gadget")).text, /Go ahead\?/);
  assert.ok(!existsSync(join(root, "frobbed")));
});
