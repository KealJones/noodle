// Git state as structure (runtime.md section 9: observation reads tools' machine formats). Git is
// always started with an argument array and never through a shell. Reading must not write, so
// optional index locks are off.

import { execFileSync } from "node:child_process";
import { b, c, n, positional, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { World } from "../primitive.js";
import { resolveInside } from "./paths.js";

export function git(world: World, args: string[], cwd?: string): string {
  try {
    return execFileSync("git", args, {
      cwd: cwd ?? resolveInside(world, "."),
      encoding: "utf8",
      timeout: world.timeoutMs ?? 30000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`git ${args[0]} failed: ${(err.stderr || err.message).trim()}`);
  }
}

/** `git status --porcelain=v2 --branch -z`. Ahead and behind are only known with an upstream. */
export function readStatus(world: World): Expr {
  const tokens = git(world, ["status", "--porcelain=v2", "--branch", "-z"]).split("\0");
  const head: [string, Expr][] = [];
  const entries: Expr[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t.startsWith("# branch.head ")) head.push(["branch", s(t.slice(14))]);
    else if (t.startsWith("# branch.upstream ")) head.push(["upstream", s(t.slice(18))]);
    else if (t.startsWith("# branch.ab ")) {
      const m = /^\+(\d+) -(\d+)$/.exec(t.slice(12));
      if (m) head.push(["ahead", n(Number(m[1]))], ["behind", n(Number(m[2]))]);
    } else if (t.startsWith("1 ") || t.startsWith("2 ") || t.startsWith("u ")) {
      const parts = t.split(" ");
      const skip = t[0] === "1" ? 8 : t[0] === "2" ? 9 : 10;
      const extra: [string, Expr][] = t[0] === "2" ? [["from", s(tokens[++i])]] : [];
      entries.push(c("Changed", s(parts.slice(skip).join(" ")), ["index", s(parts[1][0])], ["tree", s(parts[1][1])], ...extra));
    } else if (t.startsWith("? ")) entries.push(c("Untracked", s(t.slice(2))));
  }
  return c("GitStatus", ...head, ...entries);
}

/** `git log` for k commits, newest first. A repository with no commits has none. */
export function readLog(world: World, k: number): Expr {
  let out: string;
  try {
    out = git(world, ["log", "-z", "-n", String(k), "--format=%H%x00%P%x00%an%x00%aI%x00%s"]);
  } catch (e) {
    if (/does not have any commits/.test((e as Error).message)) return c("GitLog");
    throw e;
  }
  const f = out.split("\0");
  const commits: Expr[] = [];
  for (let i = 0; i + 4 < f.length; i += 5) {
    const parents = f[i + 1] ? f[i + 1].split(" ").map(s) : [];
    commits.push(c("GitCommit", ["hash", s(f[i])], ["parents", c("And", ...parents)], ["author", s(f[i + 2])], ["date", s(f[i + 3])], ["subject", s(f[i + 4])]));
  }
  return c("GitLog", ...commits);
}

/** Local and remote branches. A remote branch is marked ["remote", true]; its name is `origin/x`. */
export function readBranches(world: World): Expr {
  const out = git(world, ["for-each-ref", "--format=%(refname)%00%(HEAD)%00%(upstream:short)", "refs/heads", "refs/remotes"]);
  const branches: Expr[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [ref, mark, upstream] = line.split("\0");
    const remote = ref.startsWith("refs/remotes/");
    if (remote && ref.endsWith("/HEAD")) continue;
    const name = ref.slice(remote ? 13 : 11);
    const extra: [string, Expr][] = upstream ? [["upstream", s(upstream)]] : [];
    branches.push(c("GitBranch", s(name), ["current", b(mark === "*")], ["remote", b(remote)], ...extra));
  }
  return c("GitBranches", ...branches);
}

export function logCount(call: Expr): number {
  const k = call.kind === "call" ? positional(call)[0] : undefined;
  if (k?.kind !== "number" || !Number.isInteger(k.value) || k.value < 0) throw new Error("GitLog takes a count of commits");
  return k.value;
}

/** True when the file is tracked and has no uncommitted change, so its content is saved in git. */
export function savedInGit(world: World, dir: string, name: string): boolean {
  try {
    const tracked = git(world, ["ls-files", "--error-unmatch", "-z", "--", name], dir) !== "";
    return tracked && git(world, ["status", "--porcelain=v1", "--ignored", "-z", "--", name], dir) === "";
  } catch {
    return false;
  }
}
