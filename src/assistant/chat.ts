// `pnpm chat`: talk to Noodle in the terminal. `--why` prints the reasons log after each reply.

import { createInterface } from "node:readline";
import { createSession, packedStore, readConfig } from "./index.js";

const why = process.argv.includes("--why");
const config = readConfig();
const session = createSession(packedStore(), process.env.NOODLE_ROOT ?? config.root ?? process.cwd(), { ...config, learn: config.learn ?? true, know: config.know ?? true });
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
let closed = false;
rl.on("close", () => (closed = true));
rl.prompt();
for await (const line of rl) {
  if (line.trim()) {
    const { text, record } = await session.turn(line);
    console.log(text);
    if (why)
      for (const r of record.reasons) {
        console.log(`  ${r.what}`);
        r.candidates.slice(0, 4).forEach((cand, i) => console.log(`    ${i === r.winner ? "*" : " "} ${cand.score.toFixed(2)} ${cand.label}`));
      }
  }
  if (!closed) rl.prompt();
}
