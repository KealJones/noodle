// Prints the settings that register the capture hook (scripts/capture.mjs) in Claude Code, for
// ~/.claude/settings.json. It edits nothing: merge the printed entry into "hooks" yourself.
//   pnpm capture:install
// The hook path is the main checkout's, not a worktree's, so the hook survives deleted worktrees.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const here = join(import.meta.dirname, "..");
let main = here;
try {
  const common = execFileSync("git", ["-C", here, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 5000 }).trim();
  main = dirname(common);
} catch {
  /* not a repository: use this checkout */
}
const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(join(main, "scripts", "capture.mjs"))}`;
console.log(
  JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command, timeout: 10 }] }] } }, null, 2),
);
console.error(
  "\nMerge the entry into the \"hooks\" of ~/.claude/settings.json (append to UserPromptSubmit if it exists).\n" +
    "The hook writes only under ~/.noodle/experiment/ and never touches the network.",
);
