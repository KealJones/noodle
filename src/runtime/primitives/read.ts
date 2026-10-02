// Read and Contains (built-ins.md section 2; runtime.md section 9). Read turns a path, a git
// state or a manual page into structure; both only observe.

import * as fs from "node:fs";
import * as path from "node:path";
import { b, c, isCall, key, positional, role, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { Primitive } from "../primitive.js";
import { blockRef, SELF, str } from "./args.js";
import { logCount, readBranches, readLog, readStatus } from "./git.js";
import { readManPage } from "./manpage.js";
import { mediaFor, resolveInside } from "./paths.js";

const entryKind = (dir: string, d: fs.Dirent): Expr => {
  let isDir = d.isDirectory();
  if (d.isSymbolicLink()) {
    try {
      isDir = fs.statSync(path.join(dir, d.name)).isDirectory();
    } catch {
      isDir = false;
    }
  }
  return isDir ? c("Directory") : c("File");
};

export const Read: Primitive = {
  name: "Read",
  params: ["source"],
  pure: true,
  // A page on the web is read through Know, the one door to outside knowledge: its URL leaves the
  // machine (SendsOutside, guarded unless granted).
  effects: ([source]) => (source?.kind === "string" && /^https?:\/\//i.test(source.value) ? ["Reads", "SendsOutside"] : ["Reads"]),
  async run([source], world) {
    if (source?.kind === "string" && /^https?:\/\//i.test(source.value)) {
      if (!world.know) throw new Error("reading a page needs Know, and this session has none");
      const k = await world.know.page(source.value);
      if (!k) throw new Error(`could not read ${source.value}`);
      return c("Page", ["path", s(source.value)], ["title", s(k.title)], ["content", c("Block", s(k.block))]);
    }
    if (isCall(source)) {
      switch (source.head) {
        case "GitStatus":
          return readStatus(world);
        case "GitLog":
          return readLog(world, logCount(source));
        case "GitBranches":
          return readBranches(world);
        case "ManPage":
          return readManPage(world, source);
      }
      throw new Error(`Read does not know how to read ${source.head}`);
    }
    const rel = str(source, "Read's source");
    const abs = resolveInside(world, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error(`no such file or directory: ${rel}`);
    }
    if (stat.isDirectory()) {
      const entries = fs
        .readdirSync(abs, { withFileTypes: true })
        .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
        .map((d) => c("Entry", s(d.name), ["kind", entryKind(abs, d)]));
      return c("Directory", ["path", s(rel)], ...entries);
    }
    const media = mediaFor(rel);
    const block = world.store.addBlock(fs.readFileSync(abs, "utf8"), media, SELF);
    return c("File", ["path", s(rel)], ["content", blockRef(block.id)], ["media", s(media)]);
  },
  // A block or structure came back.
  async check(_args, result, world) {
    if (!isCall(result)) return false;
    if (result.head !== "File") return true;
    const content = role(result, "content");
    const id = isCall(content) ? positional(content)[0] : undefined;
    return id?.kind === "string" && world.store.block(id.value) !== undefined;
  },
};

export const Contains: Primitive = {
  name: "Contains",
  params: ["holder", "item"],
  pure: true,
  effects: () => [],
  async run([holder, item], world) {
    if (isCall(holder)) return b(positional(holder).some((m) => item !== undefined && key(m) === key(item)));
    const rel = str(holder, "Contains's holder");
    const abs = resolveInside(world, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return b(false);
    }
    if (stat.isDirectory()) {
      const name = isCall(item) ? str(positional(item)[0], "an entry's name") : str(item, "Contains's item");
      try {
        fs.lstatSync(resolveInside(world, path.join(rel, name)));
        return b(true);
      } catch (e) {
        if (/escapes|dangling/.test((e as Error).message)) throw e;
        return b(false);
      }
    }
    return b(fs.readFileSync(abs, "utf8").includes(str(item, "Contains's item")));
  },
};
