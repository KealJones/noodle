// Loading the seed (seed/, built-ins.md section 3) into a store, in part order.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARTS } from "../seed/check.js";
import { Store } from "./store.js";

export const SEED_DIR = join(import.meta.dirname, "..", "..", "seed");

export function seededStore(dir = SEED_DIR, path?: string): Store {
  const store = new Store(path);
  for (const [, file] of PARTS) store.load(readFileSync(join(dir, file), "utf8"));
  return store;
}
