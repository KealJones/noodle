// `pnpm chat`: talk to Noodle in the terminal. `--why` prints the reasons log after each reply.

import { createInterface } from "node:readline";
import { createSession, packedStore, readConfig } from "./index.js";

const why = process.argv.includes("--why");
const config = readConfig();
const session = createSession(packedStore(), process.env.NOODLE_ROOT ?? config.root ?? process.cwd(), { ...config, learn: config.learn ?? true, know: config.know ?? true });
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
// Every line is queued and answered in order, one turn at a time: lines typed (or piped) while a
// turn is still working are kept, not dropped, and the chat ends only when they are all answered.
const queue: string[] = [];
let closed = false;
let busy = false;
const next = async () => {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const line = queue.shift()!;
    if (!line.trim()) continue;
    const { text, record } = await session.turn(line);
    console.log(text);
    if (why && record.times)
      console.log(`  time: ${[...record.times].filter(([, ms]) => ms >= 1).map(([stage, ms]) => `${stage} ${(ms / 1000).toFixed(2)} s`).join(", ")}`);
    if (why)
      for (const r of record.reasons) {
        console.log(`  ${r.what}`);
        r.candidates.slice(0, Number(process.env.NOODLE_WHY ?? 4)).forEach((cand, i) => console.log(`    ${i === r.winner ? "*" : " "} ${cand.score.toFixed(2)} ${cand.label}`));
      }
  }
  busy = false;
  if (closed) process.exit(0);
  rl.prompt();
};
rl.on("line", (line) => {
  queue.push(line);
  void next();
});
rl.on("close", () => {
  closed = true;
  if (!busy) process.exit(0);
});
rl.prompt();
