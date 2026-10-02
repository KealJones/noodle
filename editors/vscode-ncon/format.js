// @ts-check
/**
 * The .ncon formatter. `node format.js file.ncon...` prints the formatted text, `--write`
 * rewrites the files, and `--check` exits 1 when any would change. The extension formats with it
 * too (Format Document).
 *
 * The rules are the runtime's, not a copy: this loads the build of src/ncon (parse and format),
 * so what the editor writes and what Noodle writes cannot drift. Run `pnpm build` in the
 * repository root after changing the rules.
 *
 * Comments are not data (ncon-format.md section 5): the formatter drops them. A file that has
 * any is hand-edited and only checked, so formatting it is refused rather than losing them.
 */
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { scan } = require("./scan.js");

const RUNTIME = join(__dirname, "../../dist/ncon/index.js");

/** @type {Promise<{ parse: (text: string) => unknown, format: (file: any) => string, NconError: new (...args: any[]) => Error & { pos: { line: number, column: number } } }> | undefined} */
let loaded;
const runtime = () => {
  if (!existsSync(RUNTIME)) throw new Error(`the runtime is not built: run pnpm build in the repository root (${RUNTIME})`);
  return (loaded ??= import(pathToFileURL(RUNTIME).href));
};

/** Thrown when formatting would lose comments. */
class CommentsError extends Error {}

/** A file's text, formatted. Throws the runtime's NconError for text that does not parse. */
async function format(/** @type {string} */ text) {
  const { parse, format } = await runtime();
  const file = parse(text);
  if (scan(text).marks.some((m) => m.kind === "comment")) throw new CommentsError("the file has comments, which the formatter would drop");
  return format(file);
}

/**
 * Where the text stops parsing, or undefined when it parses.
 * @returns {Promise<{ message: string, line: number, column: number } | undefined>}
 */
async function problem(/** @type {string} */ text) {
  const { parse, NconError } = await runtime();
  try {
    parse(text);
    return undefined;
  } catch (error) {
    if (error instanceof NconError) return { message: error.message, line: error.pos.line, column: error.pos.column };
    throw error;
  }
}

module.exports = { format, problem, CommentsError, RUNTIME };

if (require.main === module) {
  (async () => {
    const { readFileSync, writeFileSync } = require("node:fs");
    const args = process.argv.slice(2);
    const write = args.includes("--write");
    const check = args.includes("--check");
    let changed = 0;
    for (const file of args.filter((a) => !a.startsWith("--"))) {
      const text = readFileSync(file, "utf8");
      let out;
      try {
        out = await format(text);
      } catch (error) {
        if (!(error instanceof CommentsError)) throw error;
        console.error(`skipped (has comments): ${file}`);
        continue;
      }
      if (out === text) continue;
      changed++;
      if (write) writeFileSync(file, out);
      else if (check) console.log(`would change: ${file}`);
      else process.stdout.write(out);
    }
    if (check && changed) process.exit(1);
  })();
}
