// Write and Edit (built-ins.md section 2; runtime.md sections 9 and 12). Both keep the content
// before and after as blocks, so each can be undone from its own result.

import * as fs from "node:fs";
import * as path from "node:path";
import { c, isHead, positional, role, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { EffectClass, Primitive, World } from "../primitive.js";
import { blockRef, contentOf, SELF, str } from "./args.js";
import { savedInGit } from "./git.js";
import { mediaFor, resolveInside } from "./paths.js";

const exists = (abs: string) => fs.existsSync(abs);

function readText(abs: string, rel: string): string {
  if (!exists(abs) || fs.statSync(abs).isDirectory()) throw new Error(`no such file: ${rel}`);
  return fs.readFileSync(abs, "utf8");
}

function writeText(abs: string, text: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const keep = (world: World, text: string, rel: string) => world.store.addBlock(text, mediaFor(rel), SELF);

export const Write: Primitive = {
  name: "Write",
  params: ["target", "content"],
  pure: false,
  // Replacing content that is not saved elsewhere loses it: that is Deletes. Saved elsewhere means
  // tracked by git with no uncommitted change; outside a git repository nothing is saved.
  effects([target, content], world): EffectClass[] {
    const abs = resolveInside(world, str(target, "Write's target"));
    if (!exists(abs)) return ["ChangesLocal"];
    if (fs.statSync(abs).isDirectory()) throw new Error("Write's target is a directory");
    if (fs.readFileSync(abs, "utf8") === contentOf(content, world)) return ["ChangesLocal"];
    return savedInGit(world, path.dirname(abs), path.basename(abs)) ? ["ChangesLocal"] : ["Deletes"];
  },
  async run([target, content], world) {
    const rel = str(target, "Write's target");
    const abs = resolveInside(world, rel);
    const text = contentOf(content, world);
    let previous: Expr[] = [];
    if (exists(abs)) {
      if (fs.statSync(abs).isDirectory()) throw new Error("Write's target is a directory");
      previous = [blockRef(keep(world, fs.readFileSync(abs, "utf8"), rel).id)];
    }
    writeText(abs, text);
    return c("Wrote", s(rel), ["content", blockRef(keep(world, text, rel).id)], ...previous.map((p): [string, Expr] => ["previous", p]));
  },
  async check([target, content], _result, world) {
    const abs = resolveInside(world, str(target, "Write's target"));
    return exists(abs) && fs.readFileSync(abs, "utf8") === contentOf(content, world);
  },
  // A file that was there is restored from its block. A file that was not is removed with
  // Remove(directory, name), which the runtime does not implement yet.
  async inverse([target], result) {
    const rel = str(target, "Write's target");
    const previous = role(result, "previous");
    if (previous) return c("Write", target, previous);
    return c("Remove", s(path.posix.dirname(rel.split(path.sep).join("/"))), s(path.basename(rel)));
  },
};

function once(text: string, part: string, what: string): number {
  if (part === "") throw new Error(`${what} is empty`);
  const at = text.indexOf(part);
  if (at < 0) throw new Error(`${what} does not occur in the file`);
  if (text.indexOf(part, at + 1) >= 0) throw new Error(`${what} occurs more than once`);
  return at;
}

/** The text after a change: Replace(old, new) swaps the one occurrence, Inserted appends, Withdrawn removes the one occurrence. */
export function applyChange(text: string, change: Expr | undefined): string {
  if (isHead(change, "Replace")) {
    const old = str(role(change, "old"), "Replace's old");
    const at = once(text, old, "Replace's old");
    return text.slice(0, at) + str(role(change, "new"), "Replace's new") + text.slice(at + old.length);
  }
  if (isHead(change, "Inserted")) return text + str(positional(change)[0], "Inserted's text");
  if (isHead(change, "Withdrawn")) {
    const part = str(positional(change)[0], "Withdrawn's text");
    const at = once(text, part, "Withdrawn's text");
    return text.slice(0, at) + text.slice(at + part.length);
  }
  throw new Error("an Edit's change is Replace, Inserted or Withdrawn");
}

export const Edit: Primitive = {
  name: "Edit",
  params: ["target", "change"],
  pure: false,
  effects: () => ["ChangesLocal"],
  async run([target, change], world) {
    const rel = str(target, "Edit's target");
    const abs = resolveInside(world, rel);
    const before = readText(abs, rel);
    const after = applyChange(before, change);
    const beforeBlock = keep(world, before, rel);
    writeText(abs, after);
    return c("Edited", s(rel), ["change", change], ["before", blockRef(beforeBlock.id)], ["after", blockRef(keep(world, after, rel).id)]);
  },
  async check([target], result, world) {
    const rel = str(target, "Edit's target");
    return contentOf(role(result, "after"), world) === readText(resolveInside(world, rel), rel);
  },
  // The reverse edit when applying it to the edited text gives back the original exactly;
  // otherwise (a withdrawn middle, or text that also occurs elsewhere) the old content is written back.
  async inverse([target, change], result, world) {
    const before = contentOf(role(result, "before"), world);
    const after = contentOf(role(result, "after"), world);
    const reverse = isHead(change, "Replace")
      ? c("Replace", ["old", role(change, "new")!], ["new", role(change, "old")!])
      : isHead(change, "Inserted")
        ? c("Withdrawn", positional(change)[0])
        : undefined;
    if (reverse) {
      try {
        if (applyChange(after, reverse) === before) return c("Edit", target, reverse);
      } catch {
        // fall through to restoring the old content
      }
    }
    return c("Write", target, role(result, "before")!);
  },
};
