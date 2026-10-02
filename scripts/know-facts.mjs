// What Know understands of what it fetches (docs/know-facts.md): Wikipedia's page for each topic
// (one per line on stdin, chosen before the run), its opening heard into facts and its Wikidata
// entity's claims kept as facts, on a copy of the store at NOODLE_STORE. Prints every fact with its
// source, and the counts; a sample is graded by hand.
import { readFileSync } from "node:fs";
import { packedStore } from "../dist/assistant/index.js";
import { key } from "../dist/runtime/expr.js";
import { Learner } from "../dist/runtime/know/learn.js";
import { wikidataClaims, wikipediaTopic } from "../dist/runtime/know/sources.js";

const store = packedStore();
const learner = new Learner(store);
const totals = { pages: 0, opening: 0, openingDropped: 0, claims: 0, claimsDropped: 0, openingPages: 0, ms: 0 };
for (const topic of readFileSync(0, "utf8").split("\n").map((x) => x.trim()).filter(Boolean)) {
  const f = await wikipediaTopic(topic);
  if (!f) {
    console.log(`# ${topic}: no page`);
    continue;
  }
  const claims = f.entity ? await wikidataClaims(f.entity) : [];
  const t0 = performance.now();
  const l = learner.learn(f, claims);
  totals.ms += performance.now() - t0;
  const opening = l.facts.filter((x) => !key(x.meta.from).startsWith("Wikidata"));
  totals.pages++;
  totals.opening += opening.length;
  totals.openingPages += opening.length ? 1 : 0;
  totals.openingDropped += l.dropped.opening;
  totals.claims += l.facts.length - opening.length;
  totals.claimsDropped += l.dropped.claims;
  console.log(`# ${topic} -> ${f.title} (${claims.length} claims fetched)`);
  console.log(`  opening: ${f.text.replace(/\s+/g, " ").slice(0, 200)}`);
  for (const x of l.facts) console.log(`  ${key(x.claim)}  <- ${key(x.meta.from).startsWith("Wikidata") ? "Wikidata" : f.source}`);
  console.log(`  claims: ${claims.map((cl) => `${cl.property}=${cl.value}${cl.unit ? " " + cl.unit : ""}`).join(" | ")}`);
}
console.log(JSON.stringify(totals));
process.exit(0);
