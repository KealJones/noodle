// Write the holdout split once (testing.md section 3): 30 percent of the real prompts in
// ~/.napkin/corpus/all.jsonl, by conversation, never tuned on. It refuses to overwrite an existing
// split. A prompt's conversation is not recorded in all.jsonl, so it is approximated by its
// project directory and its day (where + the date of at): prompts of one working session land on
// the same side. The assignment is a hash of that key with a fixed salt, so it is reproducible.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const out = join(homedir(), ".noodle", "experiment", "split.json");
if (existsSync(out)) {
  console.error(`${out} exists; the split is written once and never regenerated.`);
  process.exit(1);
}
const SALT = "noodle-split-2026-10-01";
const rows = readFileSync(join(homedir(), ".napkin", "corpus", "all.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const holdout = [];
const groups = new Map();
rows.forEach((r, i) => {
  const key = `${r.where ?? ""}|${String(r.at ?? "").slice(0, 10)}`;
  const h = createHash("sha256").update(`${SALT}|${key}`).digest();
  const inHoldout = h.readUInt32BE(0) / 0xffffffff < 0.3;
  groups.set(key, inHoldout);
  if (inHoldout) holdout.push(i);
});
writeFileSync(
  out,
  JSON.stringify({ salt: SALT, by: "where + day of at (conversation not recorded in all.jsonl)", share: 0.3, prompts: rows.length, groups: groups.size, holdout }, null, 1) + "\n",
);
console.log(`wrote ${out}: ${holdout.length} of ${rows.length} prompts held out, ${[...groups.values()].filter(Boolean).length} of ${groups.size} groups`);
