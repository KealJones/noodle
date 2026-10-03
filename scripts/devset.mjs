// The development side of the exploratory labels (testing.md sections 3 and 6.2), shared by the
// scorers (scripts/acts.mjs, scripts/baseline.mjs, scripts/pilot.mjs) so they score the same items:
// Keal's labels in ~/.napkin/corpus/tests/labels.jsonl on prompts outside the holdout in
// ~/.noodle/experiment/split.json (the holdout is never returned), heartbeats left out. A prompt
// labelled twice keeps its later label (a fix supersedes what it fixes).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const jsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
export const corpus = () => jsonl(join(homedir(), ".napkin", "corpus", "all.jsonl"));
export const split = () => JSON.parse(readFileSync(join(homedir(), ".noodle", "experiment", "split.json"), "utf8"));

/** A prompt's conversation, as the split approximates it: project directory and day. */
export const conversation = (row) => `${row.where ?? ""}|${String(row.at ?? "").slice(0, 10)}`;
/** The cross-validation fold of a prompt, by conversation. */
export const fold = (row) => createHash("sha256").update(conversation(row)).digest().readUInt32BE(0) % 5;

/**
 * The development labels of the given classes, one per prompt, with its text and corpus row.
 * Prompts longer than maxWords are kept but marked, so a scorer can report them.
 */
export function devLabels({ classes = ["acts", "none"], maxWords = Infinity, all = corpus() } = {}) {
  const holdout = new Set(split().holdout);
  const latest = new Map();
  for (const l of jsonl(join(homedir(), ".napkin", "corpus", "tests", "labels.jsonl")))
    if (typeof l.i === "number" && !holdout.has(l.i)) latest.set(l.i, l);
  return [...latest.values()]
    .filter((l) => l.verdict !== "drop" && classes.includes(l.class) && all[l.i]?.text && !all[l.i].text.trimStart().startsWith("<heartbeat>"))
    .map((l) => ({ ...l, text: all[l.i].text, row: all[l.i], tooLong: all[l.i].text.split(/\s+/).length > maxWords }));
}

/**
 * Whether Keal wrote or checked a label: labelled by him, or a draft he reviewed in a labelling
 * session (ok, fixed, resolved, or spot-checked). Drafts nobody reviewed carry verdict "label".
 */
export const reviewedByKeal = (l) => l.labeller === "keal" || ["ok", "fixed", "resolved", "spot-ok", "spot-fixed"].includes(l.verdict);
