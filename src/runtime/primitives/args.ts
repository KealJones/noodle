// Reading primitive arguments (runtime.md section 9): arguments are expressions, never strings
// pasted into a command.

import { c, isHead, positional, s } from "../expr.js";
import type { Expr } from "../expr.js";
import type { World } from "../primitive.js";

/** The provenance of content a primitive keeps as a block: the assistant itself. */
export const SELF: Expr = c("Self");

export function str(e: Expr | undefined, what: string): string {
  if (e?.kind !== "string") throw new Error(`${what} must be a string`);
  return e.value;
}

/** Text as a string expression, or kept content as c("Block", s(id)) resolved through the store. */
export function contentOf(e: Expr | undefined, world: World): string {
  if (e?.kind === "string") return e.value;
  if (isHead(e, "Block")) {
    const id = str(positional(e)[0], "a Block's id");
    const block = world.store.block(id);
    if (!block) throw new Error(`no content block ${id}`);
    return block.body;
  }
  throw new Error("content must be a string or a Block");
}

export const blockRef = (id: string): Expr => c("Block", s(id));
