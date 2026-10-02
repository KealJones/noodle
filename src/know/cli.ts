// `pnpm import <source> <path>`: turn a downloaded data file into a pack in ~/.noodle/packs/
// (design section 22). Packs are generated, versioned and kept out of the repository; the
// assistant loads every pack there after the seed.
//   pnpm import wordnet ~/.noodle/sources/english-wordnet-2024.xml.gz
//   pnpm import verbnet ~/.noodle/sources/verbnet/verbnet3.4
//   pnpm import wiktionary ~/.noodle/sources/kaikki-English.jsonl.gz
//   pnpm import tool git       (from the local man pages)
//   pnpm import definitions [count] [verb|all]   (the imported senses' definitions, understood)

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { seededStore } from "../runtime/seed.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { learnTool } from "./tooldocs.js";
import { importVerbNet } from "./verbnet.js";
import { importWiktionary } from "./wiktionary.js";
import { packedStore } from "../assistant/index.js";
import { importWordNet } from "./wordnet.js";
import { Understander, coverage, definitionsPack, firstSenses } from "./definitions.js";
import { wordfreqWords } from "./wordfreq.js";
import { format } from "../ncon/index.js";

export const PACKS = join(homedir(), ".noodle", "packs");

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
} else if (source === "tool" && path) {
  // A tool's own documentation, read from the local man pages: no download.
  const world = { root: process.cwd(), store, now: () => new Date(), say() {}, ask() {} };
  const r = await learnTool(path, PRIMITIVES.get("Read")!, world, store);
  writeFileSync(join(PACKS, `tool-${path}.ncon`), r.text);
  console.log(`tool-${path}: ${r.commands.length} commands learned, ${r.skipped.length} pages skipped -> ${join(PACKS, `tool-${path}.ncon`)}`);
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
  writeFileSync(join(homedir(), ".noodle", "stage0.json"), JSON.stringify(report, null, 1));
  const reduced = defs.filter((d) => d.status === "Active" && d.via === "Definition").length;
  console.log(`definitions: ${defs.length} senses, ${reduced} bottomed out through their definitions, ${defs.filter((d) => d.via === "Kind").length} nouns through their kinds -> ${join(PACKS, "definitions.ncon")}`);
  for (const cv of cov)
    console.log(`  ${cv.pos}: ${cv.lemmas} first senses, ${cv.reduced} reduced (${((100 * cv.reduced) / cv.lemmas).toFixed(1)}%), ${cv.kinds} by kinds, ${cv.unparsed} unparsed, ${cv.depth} stopped by depth`);
} else {
  console.error("usage: pnpm import tool <program> | pnpm import wordnet <english-wordnet-YYYY.xml[.gz]> | pnpm import verbnet <dir of class .xml files> | pnpm import definitions [count] [verb|all]");
  process.exitCode = 1;
}
