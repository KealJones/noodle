// The experiment's primitives (built-ins.md section 2; runtime.md section 9): the only code that
// touches the world. Suppose and Sequence are the runtime's, not primitives here.
//
// Result and argument heads the primitives introduce, all listed in structural.ts under
// primitiveResults: File, Directory, Entry (Read of a path); GitStatus, GitLog, GitBranches,
// Changed, Untracked, GitCommit, GitBranch (Read of git state); ManPage, Section, Subsection,
// Paragraph, Item, Synopsis, Usage, Choice, Group, Flag, Option, Placeholder, Unparsed (Read of a
// manual page, manpage.ts and synopsis.ts); Ran, Args (Run); Wrote (Write);
// Edited, Replace, Inserted, Withdrawn (Edit); Name (Sort and Rank); Same (Compare); Addition,
// Subtraction, Multiplication, Division, Exponentiation, Modulo (Arithmetic's operations). Holding
// in the graph (hold.ts) keeps and returns Have, the core meaning, so what is kept can be asked
// about in the same words; it is not a structural name.
// Role is the chart's structural name, used by Sort and Rank to order by a role.

import type { Primitive } from "../primitive.js";
import { Arithmetic } from "./arithmetic.js";
import { Compare, Count, Filter, Now, Rank, Sort } from "./pure.js";
import { Contains, Read } from "./read.js";
import { Ask, Run, Say } from "./run.js";
import { Remember } from "./remember.js";
import { Remove, Store } from "./hold.js";
import { Edit, Write } from "./write.js";

export const PRIMITIVES: ReadonlyMap<string, Primitive> = new Map(
  [Read, Write, Edit, Run, Say, Ask, Count, Filter, Sort, Rank, Now, Contains, Compare, Remember, Arithmetic, Store, Remove].map((p) => [p.name, p]),
);
