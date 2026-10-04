import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import type { WordEntry } from "../know/word.js";
import { Know } from "./know/know.js";
import { seededStore } from "./seed.js";

// The lazy lexicon's hearing pre-pass (tasks/handoff.md 1c), with an invented dictionary standing
// in for Kaikki and Wiktionary: no network.
const DICTIONARY: Record<string, WordEntry> = {
  blicket: { word: "blicket", url: "test:blicket", parts: [{ pos: "noun", glosses: ["A small invented gadget."], forms: [{ form: "blickets", tags: ["plural"] }] }] },
};

function session(opts: { grant?: boolean; offline?: boolean; files?: string[] } = {}) {
  const store = seededStore();
  const root = mkdtempSync(join(tmpdir(), "noodle-lexicon-"));
  for (const f of opts.files ?? []) writeFileSync(join(root, f), "x\n");
  const s = createSession(store, root, { grants: opts.grant === false ? [] : ["SendsOutside"], know: true, chatgpt: false });
  const asked: string[] = [];
  s.world.know = new Know(store, () => new Date(0), {
    offline: opts.offline,
    fetchWord: async (w) => (asked.push(w), DICTIONARY[w]),
  });
  return { s, store, asked };
}

const lookups = (r: { record: { reasons: { what: string }[] } }) => r.record.reasons.filter((x) => x.what.startsWith("focus: the word "));

test("a word nothing hears is looked up before the chart, kept, and never asked for again", async () => {
  const { s, store, asked } = session();
  assert.equal(store.lookup("blicket").length, 0);
  const r = await s.turn("what is a blicket");
  assert.deepEqual(asked, ["blicket"]);
  assert.match(lookups(r)[0].what, /"blicket" looked up in the lexicon: \d+ facts \(\d+\.\d+ s\)/);
  assert.ok(store.lookup("blicket").length > 0, "the word is in the store");
  assert.ok(r.record.times?.has("words"));
  // Heard from the store now, in its forms too: nothing more is fetched.
  const again = await s.turn("what are blickets");
  assert.deepEqual(asked, ["blicket"]);
  assert.equal(lookups(again).length, 0);
});

test("a word no dictionary has is remembered as missing and not asked for again", async () => {
  const { s, asked } = session();
  await s.turn("zorp the thing");
  await s.turn("zorp it again");
  assert.deepEqual(asked, ["zorp"]);
});

test("no lookups in a dry run, offline, or without the SendsOutside grant", async () => {
  for (const { opts, dry } of [{ opts: {}, dry: true }, { opts: { offline: true }, dry: false }, { opts: { grant: false }, dry: false }]) {
    const { s, asked } = session(opts);
    await s.turn("what is a blicket", { dry });
    assert.deepEqual(asked, [], JSON.stringify({ opts, dry }));
  }
});

test("names in the workspace, quotations and numbers are not looked up; the lexicon's budget caps a turn", async () => {
  const { s, asked } = session({ files: ["plover"] });
  await s.turn(`plover with "quux" and 42`);
  assert.deepEqual(asked, []);
  const r = await s.turn("zab zac zad zae zaf zag zah zai zaj zak");
  assert.equal(asked.length, 8);
  assert.ok(r.record.reasons.some((x) => /over the turn's budget of 8: zaj, zak/.test(x.what)));
});
