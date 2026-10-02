#!/usr/bin/env node
// The blind labeller (PLAN.md phase 6; testing.md sections 5.1 and 6.3): shows captured prompts
// not yet labelled, in batches, and appends Keal's gold act for each to
// ~/.noodle/experiment/gold.jsonl in the gold format.
//   pnpm label [--batch N]
//
// Blind: it never loads or runs Noodle, so no answer of Noodle's can be seen while labelling. What
// it shows is what the labeller needs: the prompt, where it was sent (folder, branch) and the last
// turn of the assistant it was sent to. It reads the capture index and fixtures, and writes only
// gold.jsonl; the corpus and its holdout split (~/.noodle/experiment/split.json) are not read or
// touched. A later line for the same id supersedes an earlier one (to fix a label, label it again
// with --relabel ID).
//
// Answers, per prompt:
//   class:  a (acts), c (constraint), n (none: not a git or file act), s (skip for now), q (quit)
//   acts:   one per line, "program sub key=value ...", e.g. "git push remote=origin branch=feat/x"
//           or "read files=src/a.ts"; keys: files, branch, remote, flags (comma-separated lists for
//           files and flags), onto, base, message (a comma-separated list of message constraints).
//           An empty line ends the list.
//   constraint: "rule program sub [until X]", e.g. "not git push until told".
import { existsSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const ROOT = process.env.NOODLE_CAPTURE_DIR ?? join(homedir(), ".noodle", "experiment");

// The frozen list of design section 29 ("without the command's name"): the domain's command and
// subcommand names and their documented aliases, decided before any data was seen. It is the
// experiment's definition, not the runtime's knowledge, and changes only with the design.
const COMMAND_NAMES = ["commit", "push", "pull", "branch", "checkout", "switch", "merge", "revert", "reset", "stash", "diff", "status", "tag", "fetch", "clone", "pr", "pull request"];

const jsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8").split("\n").filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      })
    : [];

/** Every captured prompt a person typed, oldest first: the monthly index plus the older single file. */
export function captures(root = ROOT) {
  const dir = join(root, "capture");
  const monthly = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().flatMap((f) => jsonl(join(dir, f))) : [];
  const seen = new Set();
  return [...jsonl(join(root, "captures.jsonl")), ...monthly]
    .filter((c) => c.id && !c.automated && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The captures with no gold line yet. */
export function unlabelled(caps, gold) {
  const done = new Set(gold.map((g) => g.id));
  return caps.filter((c) => !done.has(c.id));
}

/** Whether the text contains a lemma of the frozen command-name list, as a whole word or phrase. */
export function namesCommand(text) {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // A lemma's regular inflections (pushes, pushed, committed, merging) are the lemma.
  const inflected = (w, p) => w === p || (w.startsWith(p) && ["s", "es", "ed", "ing", `${p.at(-1)}ed`, `${p.at(-1)}ing`].includes(w.slice(p.length)));
  return COMMAND_NAMES.some((name) => {
    const parts = name.split(" ");
    return words.some((_, i) => parts.every((p, k) => words[i + k] !== undefined && inflected(words[i + k], p)));
  });
}

const LISTS = new Set(["files", "flags", "message"]);
/** "git push remote=origin branch=x" -> { program: "git", sub: "push", remote: "origin", branch: "x" }. */
export function parseAct(line) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const plain = words.filter((w) => !w.includes("="));
  if (!plain.length || plain.length > 2) throw new Error(`an act is "program sub" or a bare act ("read"): ${line}`);
  const act = plain.length === 2 ? { program: plain[0], sub: plain[1] } : { sub: plain[0] };
  for (const w of words.filter((x) => x.includes("="))) {
    const [k, ...rest] = w.split("=");
    const v = rest.join("=");
    if (k === "message") act.message = { constraints: v.split(",").filter(Boolean) };
    else act[k] = LISTS.has(k) ? v.split(",").filter(Boolean) : v;
  }
  if (act.program && !act.flags) act.flags = [];
  return act;
}

/** "not git push until told" -> { rule: "not", act: { program: "git", sub: "push" }, until: "told" }. */
export function parseConstraint(line) {
  const [head, until] = line.trim().split(/\s+until\s+/);
  const [rule, ...rest] = head.split(/\s+/).filter(Boolean);
  if (!rule || !rest.length) throw new Error(`a constraint is "rule program sub [until X]": ${line}`);
  const act = rest.length === 2 ? { program: rest[0], sub: rest[1] } : { sub: rest[0] };
  return until ? { rule, act, until } : { rule, act };
}

/** A gold line in the format of testing.md section 5.1. */
export function goldLine(cap, { cls, acts = [], constraints = [], order, note }, at) {
  return {
    id: cap.id,
    fixture: cap.id,
    text: cap.prompt,
    namesCommand: namesCommand(cap.prompt ?? ""),
    class: cls,
    acts,
    ...(order ? { order } : {}),
    constraints,
    ...(note ? { note } : {}),
    labelledAt: at,
    labeller: "keal",
  };
}

function context(root, cap) {
  const turns = jsonl(join(root, "fixtures", cap.id, "turns.jsonl"));
  const last = [...turns].reverse().find((t) => t.role === "assistant" && t.text);
  return last ? last.text.replace(/\s+/g, " ").slice(-600) : undefined;
}

class EndOfInput extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const batch = Number(args.includes("--batch") ? args[args.indexOf("--batch") + 1] : 10);
  const relabel = args.includes("--relabel") ? args[args.indexOf("--relabel") + 1] : undefined;
  const goldPath = join(ROOT, "gold.jsonl");
  const caps = captures();
  const todo = relabel ? caps.filter((c) => c.id === relabel) : unlabelled(caps, jsonl(goldPath));
  console.log(`${todo.length} unlabelled of ${caps.length} captured prompts; this batch: ${Math.min(batch, todo.length)}`);
  // Lines are read from one iterator, so piped answers are not lost between questions.
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    process.stdout.write(q);
    const next = await lines.next();
    if (next.done) throw new EndOfInput();
    return next.value.trim();
  };
  let done = 0;
  try {
    done = await labelBatch(todo.slice(0, batch), ask, goldPath);
  } catch (e) {
    if (!(e instanceof EndOfInput)) throw e;
  }
  rl.close();
  console.log(`\nlabelled ${done}; gold is ${goldPath}`);
}

async function labelBatch(batch, ask, goldPath) {
  let done = 0;
  for (const cap of batch) {
    console.log(`\n---- ${cap.id}  ${cap.at}  ${cap.cwd ?? ""}${cap.branch ? `  (${cap.branch})` : ""}`);
    const before = context(ROOT, cap);
    if (before) console.log(`assistant before: ...${before}`);
    console.log(`\n${cap.prompt}\n`);
    const answer = (await ask("class [a]cts [c]onstraint [n]one [s]kip [q]uit: ")).toLowerCase()[0];
    if (answer === "q") break;
    const cls = { a: "acts", c: "constraint", n: "none" }[answer];
    if (!cls) continue;
    const label = { cls, acts: [], constraints: [] };
    try {
      if (cls === "acts") {
        for (let line; (line = await ask(`act ${label.acts.length + 1} (empty to end): `)); ) label.acts.push(parseAct(line));
        if (!label.acts.length) throw new Error("acts needs at least one act");
        if (label.acts.length > 1 && (await ask("any order? [y/N]: ")).toLowerCase() === "y") label.order = "any";
      }
      if (cls === "acts" || cls === "constraint")
        for (let line; (line = await ask("constraint (empty to end): ")); ) label.constraints.push(parseConstraint(line));
      if (cls === "constraint" && !label.constraints.length) throw new Error("constraint needs a rule");
    } catch (e) {
      console.log(`not recorded: ${e.message}`);
      continue;
    }
    label.note = (await ask("note (optional): ")) || undefined;
    appendFileSync(goldPath, JSON.stringify(goldLine(cap, label, new Date().toISOString())) + "\n");
    done++;
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
