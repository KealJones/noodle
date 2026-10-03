// `pnpm tutor:report`: what ChatGPT, asked as a tutor for choices (design section 17), has taught
// the store: its weights, readings and facts (Pending or confirmed), all kept from ChatGPT(Tutor()).
// Then the versus score (scripts/versus.mjs, Noodle only, nothing saved) with what it taught used
// and with it removed, ChatGPT not asked in either, so the difference is its learning's share.
// --counts prints the counts only.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const dist = join(ROOT, "dist");
const { STORE } = await import(join(dist, "assistant", "index.js"));
const { Store } = await import(join(dist, "runtime", "store.js"));
const { isTutor } = await import(join(dist, "runtime", "score.js"));
const { key } = await import(join(dist, "runtime", "expr.js"));

const store = existsSync(STORE) ? new Store(STORE) : new Store();
const weights = store.facts("Feature", "Weight").filter((f) => isTutor(f.meta.from));
// A weight kept again is the same weight: the last value counts.
const named = new Map(weights.map((f) => [key(f.claim.args[0].value), f]));
const user = new Set(store.facts("Feature", "Weight").filter((f) => !isTutor(f.meta.from) && f.meta.from.head !== "Seed").map((f) => key(f.claim.args[0].value)));
const readings = store.readingsAdded().filter((r) => isTutor(r.meta.from));
// Its proposals (Proposes on Tutor), Pending until they prove out, and the facts they became.
const proposals = store.factsAdded().filter((f) => isTutor(f.meta.from) && f.subject === "Tutor" && f.claim.head === "Proposes");
const pending = proposals.filter((f) => f.meta.status === "Pending");
const facts = store.factsAdded().filter((f) => isTutor(f.meta.from) && f.subject !== "Tutor" && !(f.subject === "Feature" && f.claim.head === "Weight"));
store.close();

console.log(`From ChatGPT as a tutor, in ${STORE}:`);
console.log(`  weights:  ${named.size} (${[...named.keys()].filter((k) => user.has(k)).length} of them since taught by the user, whose weight is used)`);
console.log(`  readings: ${readings.length}`);
console.log(`  facts:    ${facts.length} confirmed; ${pending.length} proposed and pending`);

if (!process.argv.includes("--counts")) {
  const score = (mode) => {
    const r = spawnSync("node", [join(ROOT, "scripts", "versus.mjs"), "--noodle-only", "--no-save", `--tutor=${mode}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600000 });
    const row = /^\| Noodle \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/m.exec(r.stdout ?? "");
    return row ? { RIGHT: +row[1], HONEST: +row[2], WRONG: +row[3], ERROR: +row[4] } : undefined;
  };
  const say = (x) => (x ? `${x.RIGHT} right, ${x.HONEST} honest, ${x.WRONG} wrong, ${x.ERROR} errors` : "(the run failed)");
  const kept = score("learned");
  const removed = score("off");
  console.log(`versus, with what the tutor taught: ${say(kept)}`);
  console.log(`versus, with it removed:            ${say(removed)}`);
  if (kept && removed) console.log(`its share: ${kept.RIGHT - removed.RIGHT >= 0 ? "+" : ""}${kept.RIGHT - removed.RIGHT} right, ${kept.WRONG - removed.WRONG >= 0 ? "+" : ""}${kept.WRONG - removed.WRONG} wrong`);
}
