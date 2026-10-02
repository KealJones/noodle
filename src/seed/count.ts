// `pnpm seed:count`: prints the seed's entries per part (built-ins.md section 3) and fails if a
// seed check does not pass.

import { join } from "node:path";
import { check } from "./check.js";

const dir = join(import.meta.dirname, "..", "..", "seed");
const r = check(dir);
for (const p of r.parts) console.log(`${p.name.padEnd(16)} ${String(p.entries).padStart(5)}`);
console.log(`${"total".padEnd(16)} ${String(r.total).padStart(5)}`);

let failed = false;
for (const [head, files] of r.undeclared) {
  failed = true;
  console.error(`undeclared: ${head} (${[...files].join(", ")})`);
}
for (const u of r.unsourced) {
  failed = true;
  console.error(`not sourced from its part: ${u}`);
}
for (const c of r.domainInBridge) {
  failed = true;
  console.error(`the bridge names a domain command: ${c}`);
}
if (failed) process.exitCode = 1;
