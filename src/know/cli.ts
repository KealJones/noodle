// `pnpm import <source> <path>`: turn a downloaded data file into a pack in ~/.noodle/packs/
// (design section 22). Packs are generated, versioned and kept out of the repository; the
// assistant loads every pack there after the seed.
//   pnpm import wordnet ~/.noodle/sources/english-wordnet-2024.xml.gz
//   pnpm import verbnet ~/.noodle/sources/verbnet/verbnet3.4
//   pnpm import frames ~/.noodle/sources/english-wordnet-2025.xml.gz   (after wordnet: its verb frames)
//   pnpm import wiktionary ~/.noodle/sources/kaikki-English.jsonl.gz
//   pnpm import tool git       (from the local man pages, or where there are none, its --help)
//   pnpm import definitions [count] [verb|all]   (the imported senses' definitions, understood)
//   pnpm import openapi <description.json> <name> --cli "gh api" --method -X --field -f --typed-field -F --fills owner,repo

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { seededStore } from "../runtime/seed.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { learnTool } from "./tooldocs.js";
import { learnOpenApi } from "./openapi.js";
import { importVerbNet } from "./verbnet.js";
import { importWiktionary, importWiktionaryPhrases } from "./wiktionary.js";
import { STORE, packedStore } from "../assistant/index.js";
import { importFrames, importWordNet } from "./wordnet.js";
import { Understander, coverage, definitionsPack, firstSenses } from "./definitions.js";
import { frequencyPack, wordfreqWords } from "./wordfreq.js";
import { format } from "../ncon/index.js";

export const PACKS = process.env.NOODLE_PACKS ?? join(homedir(), ".noodle", "packs");

const [source, path, version] = process.argv.slice(2);
const read = (p: string) => {
  const buf = readFileSync(p);
  return (p.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
};
mkdirSync(PACKS, { recursive: true });
const store = seededStore();

if (source === "wordnet" && path) {
  const r = importWordNet(read(path), store, { version: version ?? basename(path).match(/\d{4}/)?.[0] ?? "unknown" });
  writeFileSync(join(PACKS, "oewn.ncon"), r.text);
  console.log(`oewn: ${r.words} words, ${r.senses} senses -> ${join(PACKS, "oewn.ncon")}`);
} else if (source === "frames" && path) {
  // WordNet's subcategorization frames, on the senses of the oewn pack already in the store.
  const r = importFrames(read(path), packedStore(PACKS), { version: version ?? basename(path).match(/\d{4}/)?.[0] ?? "unknown" });
  writeFileSync(join(PACKS, "oewn-frames.ncon"), r.text);
  console.log(`oewn-frames: ${r.frames} frames -> ${join(PACKS, "oewn-frames.ncon")}`);
} else if (source === "verbnet" && path) {
  const files = readdirSync(path)
    .filter((f) => f.endsWith(".xml"))
    .map((f) => ({ name: f, xml: read(join(path, f)) }));
  if (!files.length || !statSync(path).isDirectory()) throw new Error(`no VerbNet class files (*.xml) in ${path}`);
  const r = importVerbNet(files, store, { version: version ?? "3.4" });
  writeFileSync(join(PACKS, "verbnet.ncon"), r.text);
  console.log(`verbnet: ${r.classes} classes, ${r.verbs} verbs, ${r.frames} frames read, ${r.skippedFrames} skipped -> ${join(PACKS, "verbnet.ncon")}`);
} else if (source === "wiktionary" && path) {
  // Forms and sounds for the words the seed and the other packs already have.
  const words = packedStore(PACKS);
  const r = await importWiktionary(path, words, { version: version ?? "latest" });
  writeFileSync(join(PACKS, "wiktionary.ncon"), r.text);
  console.log(`wiktionary: ${r.forms} forms for ${r.words} words -> ${join(PACKS, "wiktionary.ncon")}`);
} else if (source === "wiktionary-phrases" && path) {
  // Alternative forms, idioms and phrasal verbs, over the words the other packs have (import
  // wordnet and wiktionary first). Two packs, so either can be taken out on its own.
  const words = packedStore(PACKS);
  const r = await importWiktionaryPhrases(path, words, { version: version ?? "latest" });
  writeFileSync(join(PACKS, "wiktionary-alternatives.ncon"), r.alternatives.text);
  writeFileSync(join(PACKS, "wiktionary-idioms.ncon"), r.idioms.text);
  console.log(`wiktionary-alternatives: ${r.alternatives.forms} forms for ${r.alternatives.words} words -> ${join(PACKS, "wiktionary-alternatives.ncon")}`);
  console.log(`wiktionary-idioms: ${r.idioms.phrases} phrases (${r.idioms.known} already words, given their parts), ${r.idioms.senses} senses with definitions, ${r.idioms.skipped} skipped (a part with no word) -> ${join(PACKS, "wiktionary-idioms.ncon")}`);
} else if (source === "wordfreq" && path) {
  // How common each word is, for the words the other packs have (WordFrequency, runtime.md 8.1).
  const r = frequencyPack(gunzipSync(readFileSync(path)), packedStore(PACKS), { version: version ?? "3.0" });
  writeFileSync(join(PACKS, "wordfreq.ncon"), r.text);
  console.log(`wordfreq: frequencies for ${r.words} words -> ${join(PACKS, "wordfreq.ncon")}`);
} else if (source === "tool" && path) {
  // A tool's own documentation, read from the local man pages: no download. Its summaries are
  // understood over the words the other packs give, without any tool's readings (a command is not
  // understood through itself, nor through another tool's word for it).
  const world = { root: process.cwd(), store, now: () => new Date(), say() {}, ask() {} };
  const words = packedStore(PACKS);
  for (const name of words.packNames()) if (name.startsWith("tool-")) words.unload(name);
  const r = await learnTool(path, PRIMITIVES.get("Read")!, world, store, words);
  writeFileSync(join(PACKS, `tool-${path}.ncon`), r.text);
  console.log(`tool-${path}: ${r.commands.length} commands learned, ${r.skipped.length} pages skipped -> ${join(PACKS, `tool-${path}.ncon`)}`);
} else if (source === "tools") {
  // Every program on the PATH that has a manual page, each learned as `import tool` learns one,
  // into its own pack (so each can be taken out on its own). Manual pages only: learning from a
  // program's --help runs it, which is asked for, one program at a time, in the chat. Programs
  // with a pack already are skipped, so a run can be stopped and started again. `pnpm import
  // tools [count]` learns at most count programs.
  const world = { root: process.cwd(), store, now: () => new Date(), say() {}, ask() {} };
  const words = packedStore(PACKS);
  for (const name of words.packNames()) if (name.startsWith("tool-")) words.unload(name);
  const read = PRIMITIVES.get("Read")!;
  const programs = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) if (/^[A-Za-z0-9_][\w.+-]*$/.test(f)) programs.add(f);
  }
  const have = new Set(readdirSync(PACKS).filter((f) => f.startsWith("tool-")).map((f) => f.slice(5, -5)));
  const limit = path ? Number(path) : Infinity;
  const t0 = Date.now();
  let learned = 0;
  let bytes = 0;
  let commands = 0;
  const failed: string[] = [];
  const large: string[] = [];
  /** Bytes of a manual page's source (compressed or not) above which it is left out. */
  const BOOK = 64 * 1024;
  for (const name of [...programs].sort()) {
    if (learned >= limit) break;
    if (have.has(name)) continue;
    let found;
    try {
      found = await read.run([{ kind: "call", head: "Program", args: [{ value: { kind: "string", value: name, pos: { line: 0, column: 0 } } }], pos: { line: 0, column: 0 } }], world);
    } catch {
      continue;
    }
    const manual = found.kind === "call" ? found.args.find((a) => a.name === "manual")?.value : undefined;
    if (!(manual?.kind === "boolean" && manual.value)) continue;
    // A manual the size of a book (a compiler's, a shell's) takes minutes to understand: it is
    // left for `pnpm import tool <name>`, one at a time, and listed.
    let size = 0;
    try {
      size = statSync(execFileSync("man", ["-w", name], { encoding: "utf8", timeout: 10000 }).trim().split("\n")[0]).size;
    } catch {
      size = 0;
    }
    if (size > BOOK) {
      large.push(name);
      continue;
    }
    const t1 = Date.now();
    try {
      const r = await learnTool(name, read, world, store, words, "manual");
      if (!r.commands.length) {
        failed.push(name);
        continue;
      }
      writeFileSync(join(PACKS, `tool-${name}.ncon`), r.text);
      learned++;
      commands += r.commands.length;
      bytes += Buffer.byteLength(r.text);
      console.error(`  tool-${name}: ${r.commands.length} commands, ${Math.round(Buffer.byteLength(r.text) / 1024)} KB, ${Date.now() - t1} ms (${learned} learned, ${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (err) {
      failed.push(name);
      console.error(`  ${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  console.log(`tools: ${learned} programs learned from their manual pages (${commands} commands, ${(bytes / 1024 / 1024).toFixed(1)} MB of packs) in ${Math.round((Date.now() - t0) / 1000)} s; ${failed.length} with a page nothing could be learned from; ${large.length} left out for their size (${large.join(" ")}) -> ${PACKS}`);
} else if (source === "openapi" && path && version) {
  // An HTTP API's published description (OpenAPI 3), its operations' summaries understood over
  // the words the other packs give. How the API is spoken to is the user's to say here: the
  // program and its leading arguments, its options for the method and for fields, and the path
  // placeholders it fills itself.
  const opt = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const command = opt("--cli")?.split(/\s+/).filter(Boolean);
  const method = opt("--method");
  const field = opt("--field");
  if (!command?.length || !method || !field) throw new Error('say how the API is spoken to: --cli "<program> [args]" --method <option> --field <option> [--typed-field <option>] [--fills a,b]');
  const words = packedStore(PACKS);
  for (const name of words.packNames()) if (name.startsWith("tool-") || name.startsWith("openapi-")) words.unload(name);
  const doc = JSON.parse(read(path));
  const t0 = Date.now();
  const r = await learnOpenApi(doc, version, { command, method, field, typedField: opt("--typed-field"), fills: opt("--fills")?.split(",").filter(Boolean) }, store, words, (n, all) => n % 200 === 0 && console.error(`  ${n} of ${all} operations, ${Math.round((Date.now() - t0) / 1000)} s`));
  writeFileSync(join(PACKS, `openapi-${version}.ncon`), r.text);
  console.log(`openapi-${version}: ${r.operations} operations, ${r.understood} summaries understood, ${r.readings} readings, ${r.parameters} parameters, ${r.skipped.length} not understood -> ${join(PACKS, `openapi-${version}.ncon`)}`);
} else if (source === "definitions") {
  // Stage 0 (design section 6): the definitions of the first senses of the most common words, and
  // of every sense they need, understood into Expand readings on the senses. The words come from
  // wordfreq's list (docs/imports.md). The report of what bottomed out goes beside the store.
  const words = packedStore(PACKS);
  const count = Number(path ?? 5000);
  const parts = version === "all" ? ["PartOfSpeechVerb", "PartOfSpeechAdjective", "PartOfSpeechNoun"] : ["PartOfSpeechVerb"];
  const freq = join(homedir(), ".noodle", "sources", "wordfreq-large_en.msgpack.gz");
  const lemmas = wordfreqWords(gunzipSync(readFileSync(freq)))
    .filter((w) => /^[a-z]+$/.test(w))
    .slice(0, count);
  const u = new Understander(words);
  const targets = firstSenses(u, lemmas, parts);
  const t0 = Date.now();
  const defs = u.understandAll(
    targets.map((t) => t.sense),
    (n) => n % 500 === 0 && console.error(`  ${n} definitions heard, ${Math.round((Date.now() - t0) / 1000)} s`),
  );
  writeFileSync(join(PACKS, "definitions.ncon"), definitionsPack(words, defs, "stage0"));
  const cov = coverage(targets, new Map(defs.map((d) => [d.sense, d])));
  const shown = (e: unknown) => (e ? format({ forms: [e as never] }).trim() : undefined);
  const report = { lemmas: lemmas.length, targets, coverage: cov, heard: u.stats.heard, ms: Math.round(u.stats.ms), definitions: defs.map((d) => ({ ...d, becomes: shown(d.becomes), patterns: d.patterns.map(shown) })) };
  writeFileSync(join(dirname(STORE), "stage0.json"), JSON.stringify(report, null, 1));
  const reduced = defs.filter((d) => d.status === "Active" && d.via === "Definition").length;
  console.log(`definitions: ${defs.length} senses, ${reduced} bottomed out through their definitions, ${defs.filter((d) => d.via === "Kind").length} nouns through their kinds -> ${join(PACKS, "definitions.ncon")}`);
  for (const cv of cov)
    console.log(`  ${cv.pos}: ${cv.lemmas} first senses, ${cv.reduced} reduced (${((100 * cv.reduced) / cv.lemmas).toFixed(1)}%), ${cv.kinds} by kinds, ${cv.unparsed} unparsed, ${cv.depth} stopped by depth`);
} else {
  console.error("usage: pnpm import tool <program> | pnpm import wordnet <english-wordnet-YYYY.xml[.gz]> | pnpm import verbnet <dir of class .xml files> | pnpm import definitions [count] [verb|all]");
  process.exitCode = 1;
}
