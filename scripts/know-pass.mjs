// Know, asked twice (docs/know-facts.md): prompts (one per line on stdin) through one session over
// the store at NOODLE_STORE, each reply printed with its time. Pass --offline for Know with its
// network off; otherwise it may go out (the SendsOutside grant is given). With --facts, what Know
// learned is printed after each reply.
import { readFileSync } from "node:fs";
import { createSession, packedStore } from "../dist/assistant/index.js";
import { key } from "../dist/runtime/expr.js";

const offline = process.argv.includes("--offline");
const showFacts = process.argv.includes("--facts");
const t0 = performance.now();
const store = packedStore();
const session = createSession(store, process.cwd(), { grants: ["SendsOutside"], know: offline ? "offline" : true });
console.log(`store open: ${((performance.now() - t0) / 1000).toFixed(2)} s, Know ${offline ? "offline" : "online"}`);
for (const line of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
  const t = performance.now();
  const before = session.world.know.learned.length;
  const { text } = await session.turn(line);
  console.log(`\n> ${line}  (${((performance.now() - t) / 1000).toFixed(2)} s)\n${text}`);
  if (showFacts)
    for (const l of session.world.know.learned.slice(before)) {
      console.log(`  learned ${l.topic}: ${l.facts.length} facts (dropped: ${l.dropped.opening} of the opening, ${l.dropped.claims} claims)`);
      for (const f of l.facts) console.log(`    ${key(f.claim)}  <- ${key(f.meta.from)}`);
    }
}
process.exit(0);
