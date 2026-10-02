// Run, Say and Ask (built-ins.md section 2; runtime.md section 9). Run starts a program with an
// argument array in world.root and never through a shell (design section 26b).

import { execFile } from "node:child_process";
import { c, isHead, n, positional, role, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { Primitive } from "../primitive.js";
import { blockRef, SELF, str } from "./args.js";
import { resolveInside } from "./paths.js";

function argv(args: Expr | undefined): string[] {
  if (!isHead(args, "Args")) throw new Error("Run's arguments are Args(...)");
  return positional(args).map((a) => {
    if (a.kind === "string") return a.value;
    if (a.kind === "number") return String(a.value);
    throw new Error("each of Run's arguments is a string or a number");
  });
}

export const Run: Primitive = {
  name: "Run",
  params: ["program", "args"],
  pure: false,
  // A program's effects are its learned effects (EffectsOf facts on the program's concept). The
  // runtime does not read them yet, so every Run is UnknownEffects, which is guarded.
  effects: () => ["UnknownEffects"],
  async run([program, args], world) {
    const name = str(program, "Run's program");
    const list = argv(args);
    if (world.programs && !world.programs.has(name)) throw new Error(`${name} is not a program Run may start`);
    const cwd = resolveInside(world, ".");
    // Run is not interactive: no terminal, no input, and no editor or pager to wait on, so a
    // program that would ask fails fast instead of hanging until the time limit.
    const env = { ...process.env, EDITOR: "false", VISUAL: "false", PAGER: "cat", TERM: "dumb" };
    const done = await new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
      const child = execFile(name, list, { cwd, shell: false, env, timeout: world.timeoutMs ?? 30000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (error, out, err) => {
        if (!error) return resolve({ code: 0, out, err });
        const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        if (typeof e.code === "number") return resolve({ code: e.code, out, err });
        if (e.killed) return reject(new Error(`${name} timed out`));
        if (e.signal) return resolve({ code: -1, out, err });
        reject(new Error(`could not start ${name}: ${e.message}`));
      });
      child.stdin?.end();
    });
    // Output and error are there only when the program wrote something: no output is structure
    // ("it said nothing"), not an empty block to look inside.
    const parts: [string, Expr][] = [["exit", n(done.code)]];
    if (done.out) parts.push(["output", blockRef(world.store.addBlock(done.out, "text/plain", SELF).id)]);
    if (done.err) parts.push(["error", blockRef(world.store.addBlock(done.err, "text/plain", SELF).id)]);
    return c("Ran", s(name), args as Expr, ...parts);
  },
  async check(_args, result) {
    return role(result, "exit")?.kind === "number" && (role(result, "exit") as { value: number }).value === 0;
  },
};

export const Say: Primitive = {
  name: "Say",
  params: ["expr"],
  pure: false,
  effects: () => ["Speaks"],
  async run([expr], world) {
    world.say(expr);
    return expr;
  },
};

export const Ask: Primitive = {
  name: "Ask",
  params: ["question"],
  pure: false,
  effects: () => ["Speaks"],
  async run([question], world) {
    world.ask(question);
    return question;
  },
};
