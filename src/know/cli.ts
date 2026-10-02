// `pnpm import <source> <path>`: turn a downloaded data file into a pack in ~/.noodle/packs/
// (design section 22). Packs are generated, versioned and kept out of the repository; the
// assistant loads every pack there after the seed.
//   pnpm import wordnet ~/.noodle/sources/english-wordnet-2024.xml.gz
//   pnpm import verbnet ~/.noodle/sources/verbnet/verbnet3.4

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { seededStore } from "../runtime/seed.js";
import { importVerbNet } from "./verbnet.js";
import { importWordNet } from "./wordnet.js";

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
} else {
  console.error("usage: pnpm import wordnet <english-wordnet-YYYY.xml[.gz]> | pnpm import verbnet <dir of class .xml files>");
  process.exitCode = 1;
}
