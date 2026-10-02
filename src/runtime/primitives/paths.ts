// Path safety (AGENTS.md rule 7; runtime.md section 9): every path a primitive touches is resolved
// inside world.root, and a path that leaves it, lexically or through a symlink, is refused.

import * as fs from "node:fs";
import * as path from "node:path";
import type { World } from "../primitive.js";

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/** The absolute, symlink-free path for p under world.root; throws if it would leave the root. */
export function resolveInside(world: World, p: string): string {
  const root = fs.realpathSync(world.root);
  const abs = path.resolve(root, p);
  if (!inside(root, abs)) throw new Error(`path escapes the root: ${p}`);
  let probe = abs;
  let rest = "";
  for (;;) {
    let exists = true;
    try {
      fs.lstatSync(probe);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      exists = false;
    }
    if (exists) {
      let real: string;
      try {
        real = fs.realpathSync(probe);
      } catch {
        throw new Error(`path goes through a dangling link: ${p}`);
      }
      if (!inside(root, real)) throw new Error(`path escapes the root: ${p}`);
      return rest ? path.join(real, rest) : real;
    }
    rest = rest ? path.join(path.basename(probe), rest) : path.basename(probe);
    probe = path.dirname(probe);
  }
}

const MEDIA: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".csv": "text/csv",
};

export const mediaFor = (p: string) => MEDIA[path.extname(p).toLowerCase()] ?? "text/plain";
