// Read of a manual page (runtime.md section 9): parseSynopsis on invented usage lines, and the
// real local git pages through man and mandoc. The real-page tests skip where the pages are not
// installed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { c, isCall, key, n, positional, role, s } from "../expr.js";
import type { Call, Expr } from "../expr.js";
import type { World } from "../primitive.js";
import { Store } from "../store.js";
import { PRIMITIVES } from "./index.js";
import { parseSynopsis } from "./synopsis.js";

const usage = (text: string) => {
  const u = parseSynopsis(text);
  assert.equal(u.length, 1);
  return u[0];
};
const flat = (e: Expr): string => key(e);

test("parseSynopsis: the program, its subcommands, flags and placeholders", () => {
  assert.equal(flat(usage("git remote add -f <name> <url>")), flat(c("Usage", s("git"), s("remote"), s("add"), c("Flag", s("-f")), c("Placeholder", s("name")), c("Placeholder", s("url")))));
});

test("parseSynopsis: optional, choice and nested optional", () => {
  assert.equal(
    flat(usage("git push [--all | --tags] [<repository> [<refspec>...]]")),
    flat(
      c(
        "Usage",
        s("git"),
        s("push"),
        c("Optional", c("Choice", c("Flag", s("--all")), c("Flag", s("--tags")))),
        c("Optional", c("Placeholder", s("repository")), c("Optional", c("Repeat", c("Placeholder", s("refspec"))))),
      ),
    ),
  );
});

test("parseSynopsis: an alternative of several elements is a Group", () => {
  assert.equal(
    flat(usage("x [-o <string> | --push-option=<string>]")),
    flat(c("Usage", s("x"), c("Optional", c("Choice", c("Group", c("Flag", s("-o")), c("Placeholder", s("string"))), c("Option", s("--push-option"), ["value", c("Placeholder", s("string"))]))))),
  );
});

test("parseSynopsis: options with a value, a plain value, a choice of values", () => {
  assert.equal(flat(usage("x --receive-pack=<git-receive-pack>")), flat(c("Usage", s("x"), c("Option", s("--receive-pack"), ["value", c("Placeholder", s("git-receive-pack"))]))));
  assert.equal(flat(usage("x --sort=key")), flat(c("Usage", s("x"), c("Option", s("--sort"), ["value", c("Literal", s("key"))]))));
  assert.equal(
    flat(usage("x --signed=(true|false|if-asked)")),
    flat(c("Usage", s("x"), c("Option", s("--signed"), ["value", c("Choice", c("Literal", s("true")), c("Literal", s("false")), c("Literal", s("if-asked")))]))),
  );
});

test("parseSynopsis: [no-] makes a flag and its negation", () => {
  assert.equal(flat(usage("x --[no-]signed")), flat(c("Usage", s("x"), c("Choice", c("Flag", s("--signed")), c("Flag", s("--no-signed"))))));
  assert.equal(
    flat(usage("x [--[no-]signed|--signed=(true|false|if-asked)]")),
    flat(
      c(
        "Usage",
        s("x"),
        c("Optional", c("Choice", c("Choice", c("Flag", s("--signed")), c("Flag", s("--no-signed"))), c("Option", s("--signed"), ["value", c("Choice", c("Literal", s("true")), c("Literal", s("false")), c("Literal", s("if-asked")))]))),
      ),
    ),
  );
});

test("parseSynopsis: an optional value, itself holding an optional part", () => {
  assert.equal(
    flat(usage("x [--force-with-lease[=<refname>[:<expect>]]]")),
    flat(
      c(
        "Usage",
        s("x"),
        c("Optional", c("Option", s("--force-with-lease"), ["value", c("Optional", c("Placeholder", s("refname")), c("Optional", c("Literal", s(":")), c("Placeholder", s("expect"))))])),
      ),
    ),
  );
});

test("parseSynopsis: repeats, with the ellipsis spaced, bare or the one character", () => {
  assert.equal(flat(usage("x <path>...")), flat(c("Usage", s("x"), c("Repeat", c("Placeholder", s("path"))))));
  assert.equal(flat(usage("x [<path> ...]")), flat(c("Usage", s("x"), c("Optional", c("Repeat", c("Placeholder", s("path")))))));
  assert.equal(flat(usage("x [<path>…​]")), flat(c("Usage", s("x"), c("Optional", c("Repeat", c("Placeholder", s("path")))))));
});

test("parseSynopsis: a parenthesized choice, and a lone double dash", () => {
  assert.equal(
    flat(usage("x (-m | -M) [--] <name>")),
    flat(c("Usage", s("x"), c("Choice", c("Flag", s("-m")), c("Flag", s("-M"))), c("Optional", c("Flag", s("--"))), c("Placeholder", s("name")))),
  );
});

test("parseSynopsis: indented lines continue the line before, others start a usage", () => {
  const u = parseSynopsis("git branch [-v]\n        [--list]\ngit branch -d <name>");
  assert.equal(u.length, 2);
  assert.equal(flat(u[0]), flat(c("Usage", s("git"), s("branch"), c("Optional", c("Flag", s("-v"))), c("Optional", c("Flag", s("--list"))))));
});

test("parseSynopsis: what it cannot read stays Unparsed, and the rest still parses", () => {
  const u = usage("x [(-c | -C) <commit> | --fixup <commit>)] -v ]");
  const args = positional(u as never);
  assert.equal(flat(args[0]), flat(s("x")));
  assert.ok(find(u, (x) => x.head === "Unparsed").length > 0);
  assert.ok(args.some((a) => flat(a) === flat(c("Flag", s("-v")))));
  assert.doesNotThrow(() => parseSynopsis("x [ (( <"));
});

// ---- the real pages ------------------------------------------------------------------------------

const have = (() => {
  try {
    execFileSync("man", ["-w", "git-push"], { stdio: "ignore" });
    execFileSync("mandoc", ["-T", "tree"], { input: "", stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
})();
const real = { skip: have ? false : "man or the git manual pages are not installed" };

function world(): World {
  return { root: ".", store: new Store(), now: () => new Date(0), say: () => {}, ask: () => {} };
}

async function page(w: World, name: string, section?: number): Promise<Expr> {
  const source = section === undefined ? c("ManPage", s(name)) : c("ManPage", s(name), n(section));
  return PRIMITIVES.get("Read")!.run([source], w);
}

const sections = (p: Expr) => positional(p as never).filter((e) => isCall(e) && e.head === "Section");
const titled = (p: Expr, title: string) => sections(p).find((e) => flat(positional(e as never)[0]) === flat(s(title)));
const text = (w: World, block: Expr | undefined) => {
  assert.ok(isCall(block) && block.head === "Block");
  return w.store.block((positional(block)[0] as { value: string }).value)!.body;
};
const find = (e: Expr, test: (x: Call) => boolean, out: Call[] = []): Call[] => {
  if (!isCall(e)) return out;
  if (test(e)) out.push(e);
  for (const a of e.args) find(a.value, test, out);
  return out;
};
const unparsed = (e: Expr | undefined) => (e ? find(e, (x) => isCall(x) && x.head === "Unparsed") : []);

test("Read a manual page: git-push", real, async () => {
  const w = world();
  const p = await page(w, "git-push");
  assert.equal(flat(role(p, "name")!), flat(s("git-push")));
  assert.equal(flat(role(p, "section")!), flat(n(1)));
  assert.equal(flat(role(p, "command")!), flat(s("git-push")));
  assert.equal(text(w, role(p, "summary")), "Update remote refs along with associated objects");

  const synopsis = positional(titled(p, "SYNOPSIS")! as never)[1];
  assert.ok(isCall(synopsis) && synopsis.head === "Synopsis");
  const first = positional(synopsis)[0];
  assert.ok(isCall(first) && first.head === "Usage");
  assert.deepEqual(positional(first).slice(0, 2).map(flat), [flat(s("git")), flat(s("push"))]);
  const all = c("Flag", s("--all"));
  const optionals = positional(first).filter((e) => isCall(e) && e.head === "Optional");
  assert.ok(
    optionals.some((o) =>
      find(o, (x) => isCall(x) && x.head === "Choice").some((ch) => positional(ch).some((a) => flat(a) === flat(all))),
    ),
    "--all is in a Choice inside an Optional",
  );
  assert.ok(find(first, (x) => flat(x) === flat(c("Placeholder", s("repository")))).length > 0);
  assert.equal(unparsed(titled(p, "SYNOPSIS")).length, 0);
  assert.ok(titled(p, "DESCRIPTION") && titled(p, "OPTIONS"));
});

test("Read a manual page: the options list gives Items with terms", real, async () => {
  const w = world();
  const p = await page(w, "git-push");
  const items = find(titled(p, "OPTIONS")!, (x) => isCall(x) && x.head === "Item");
  const terms = items.map((i) => (role(i, "term") ? text(w, role(i, "term")) : ""));
  assert.ok(terms.some((t) => t.includes("--force")), terms.slice(0, 8).join(" | "));
  assert.ok(items.every((i) => find(i, (x) => isCall(x) && x.head === "Paragraph").length > 0));
});

test("Read a manual page: an mdoc page's option terms are the flags, without the list's width (du)", real, async () => {
  const w = world();
  const p = await page(w, "du");
  const terms = find(p, (x) => isCall(x) && x.head === "Item").map((i) => (role(i, "term") ? text(w, role(i, "term")) : ""));
  assert.ok(terms.includes("-A") && terms.some((t) => t.startsWith("-B")), terms.slice(0, 8).join(" | "));
});

for (const name of ["git-commit", "git-branch", "git-status"]) {
  test(`Read a manual page: ${name} parses, with nothing unparsed in NAME or DESCRIPTION`, real, async () => {
    const w = world();
    const p = await page(w, name);
    assert.equal(flat(role(p, "command")!), flat(s(name)));
    assert.ok(role(p, "summary"));
    assert.equal(unparsed(titled(p, "NAME")).length, 0);
    assert.equal(unparsed(titled(p, "DESCRIPTION")).length, 0);
    const synopsis = positional(titled(p, "SYNOPSIS")! as never)[1];
    assert.ok(isCall(synopsis) && synopsis.head === "Synopsis");
    for (const u of positional(synopsis)) assert.ok(isCall(u) && u.head === "Usage");
  });
}

test("Read a manual page: git-branch has several usage lines", real, async () => {
  const p = await page(world(), "git-branch");
  const synopsis = positional(titled(p, "SYNOPSIS")! as never)[1];
  assert.ok(positional(synopsis as never).length >= 5);
});

test("Read a manual page: git-status has subsections", real, async () => {
  const p = await page(world(), "git-status");
  assert.ok(find(p, (x) => isCall(x) && x.head === "Subsection").length > 0);
});

test("Read a manual page: gitglossary (section 7) is a list of terms", real, async () => {
  const w = world();
  const p = await page(w, "gitglossary", 7);
  assert.equal(flat(role(p, "section")!), flat(n(7)));
  assert.equal(unparsed(titled(p, "NAME")).length, 0);
  assert.equal(unparsed(titled(p, "DESCRIPTION")).length, 0);
  const terms = find(titled(p, "DESCRIPTION")!, (x) => isCall(x) && x.head === "Item").filter((i) => role(i, "term")).map((i) => text(w, role(i, "term")));
  assert.ok(terms.some((t) => t === "ref" || t === "refs"), terms.slice(0, 10).join(" | "));
});

test("Read a manual page: a missing page and a bad name are errors", real, async () => {
  await assert.rejects(() => page(world(), "no-such-page-anywhere"), /no manual page/);
  await assert.rejects(() => page(world(), "-k"), /not a manual page name/);
  await assert.rejects(() => page(world(), "../etc/passwd"), /not a manual page name/);
});
