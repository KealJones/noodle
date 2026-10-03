// The slot filler (design section 29: "every act baseline gets a simple slot filler (recency plus
// shape match)"; testing.md section 7). It turns an act label ("git merge") into an act with its
// arguments, in the form the scorer reads ({ program, argv } or { sub, argv, files }; decide.mjs
// sysAct), by the same stated rules for every baseline. It is baseline code, not Noodle's: the
// tables below are the experimenter's, written once, and never seen by the runtime.
//
// The rules:
// 1. Typed values are taken from the request text, in order of appearance:
//    - url: anything starting http:// or https://;
//    - number: "#123", or a number right after "pr", "pull request", "issue" or "number";
//    - message: a span in double or single quotes that contains a space;
//    - path: a word (backticks, quotes and trailing punctuation stripped) that names a file or
//      folder in the workspace, or, with no workspace to look in, has a path's shape (a slash
//      with a file extension, or a name with an extension of 1 to 5 letters);
//    - branch: a word that names a branch of the fixture (local, or a remote's without the remote's
//      name), or, if it is not a path or a url, has a branch's shape (word/word);
//    - remote: a word that names one of the fixture's remotes.
// 2. Each act takes the kinds its row in TAKES lists, all that were found, in order.
// 3. Recency: where an act needs a kind (NEEDS) and the request has none, the latest one in the
//    turns before the request (the assistant's turns, newest first) is taken, if any.
// 4. Nothing else: no flags, no defaults (the scorer drops the current branch and the remote a
//    plain push or pull leaves out).
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

/** Which kinds each act takes, in argv order. An act not listed takes nothing. */
export const TAKES = {
  "git checkout": ["branch", "path"],
  "git switch": ["branch"],
  "git merge": ["branch"],
  "git rebase": ["branch"],
  "git branch": ["branch"],
  "git push": ["remote", "branch"],
  "git pull": ["remote", "branch"],
  "git fetch": ["remote", "branch"],
  "git cherry-pick": [],
  "git add": ["path"],
  "git commit": ["path", "message"],
  "git diff": ["branch", "path"],
  "git log": ["branch", "path"],
  "git restore": ["path"],
  "git rm": ["path"],
  "git stash": ["path"],
  "git clone": ["url"],
  read: ["path"],
  edit: ["path"],
};
for (const sub of ["view", "checkout", "merge", "diff", "review", "comment", "close", "edit", "checks", "ready", "approve"]) TAKES[`gh pr-${sub}`] = ["number", "url"];
/** The kinds an act cannot do without (rule 3). */
export const NEEDS = {
  "git checkout": "branch",
  "git switch": "branch",
  "git merge": "branch",
  "git rebase": "branch",
  "git clone": "url",
  read: "path",
  edit: "path",
  "gh pr-checkout": "number",
};

/** The fixture's branch names and remotes, from its meta.json (testing.md section 5.2). */
export function namesOf(meta) {
  const refs = Object.keys(meta?.repo?.refs ?? {});
  const remotes = Object.keys(meta?.repo?.remotes ?? {});
  const branches = new Set();
  for (const r of refs) {
    if (r.startsWith("refs/heads/")) branches.add(r.slice(11));
    const m = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(r);
    if (m && m[2] !== "HEAD") branches.add(m[2]);
  }
  if (meta?.repo?.branch) branches.add(meta.repo.branch);
  return { branches, remotes: new Set(remotes) };
}

const strip = (w) => w.replace(/^[`'"(<[]+|[`'")>\],.;:!?]+$/g, "");
const PATH_SHAPE = /^(?:[\w.@-]+\/)*[\w@-][\w.@-]*\.[A-Za-z]{1,5}$/;
const BRANCH_SHAPE = /^[\w.-]+\/[\w./-]+$/;

/**
 * The typed values in a text: [{ kind, value, at }] in order of appearance. `root` is the workspace
 * (paths must exist in it), `names` the fixture's branches and remotes (namesOf).
 */
export function extract(text, { root, names = { branches: new Set(), remotes: new Set() } } = {}) {
  const out = [];
  const taken = [];
  const add = (kind, value, at, len) => {
    out.push({ kind, value, at });
    taken.push([at, at + len]);
  };
  const free = (at) => !taken.some(([a, b]) => at >= a && at < b);
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]"'`]+/g)) add("url", m[0].replace(/[.,;:]+$/, ""), m.index, m[0].length);
  for (const m of text.matchAll(/(["'])([^"'\n]*\s[^"'\n]*)\1/g)) if (free(m.index)) add("message", m[2].trim(), m.index, m[0].length);
  for (const m of text.matchAll(/#(\d+)\b|\b(?:pr|pull request|issue|number)\s*#?\s*(\d+)\b/gi)) if (free(m.index)) add("number", Number(m[1] ?? m[2]), m.index, m[0].length);
  for (const m of text.matchAll(/\S+/g)) {
    if (!free(m.index)) continue;
    const w = strip(m[0]);
    if (!w || /^https?:/.test(w)) continue;
    const local = w.replace(/^\.\//, "");
    const exists = root && !isAbsolute(local) && !local.includes("..") && local.length > 1 && existsSync(join(root, local));
    if (names.remotes.has(w)) add("remote", w, m.index, m[0].length);
    else if (names.branches.has(w)) add("branch", w, m.index, m[0].length);
    else if (root ? exists && /[./]/.test(local) : PATH_SHAPE.test(local)) add("path", normalize(local).replace(/\/$/, ""), m.index, m[0].length);
    else if (BRANCH_SHAPE.test(w) && !PATH_SHAPE.test(w) && !exists) add("branch", w, m.index, m[0].length);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The values an act takes from what was found (rules 2 and 3). `before` is the turns' values, newest first. */
export function fill(label, found, before = []) {
  const takes = TAKES[label] ?? [];
  const got = {};
  for (const kind of takes) {
    const vs = [...new Set(found.filter((x) => x.kind === kind).map((x) => x.value))];
    if (vs.length) got[kind] = vs;
  }
  const need = NEEDS[label];
  if (need && !got[need]) {
    const recent = before.find((x) => x.kind === need);
    if (recent) got[need] = [recent.value];
  }
  return got;
}

/** An act label and its values as the scorer reads an act (decide.mjs sysAct). */
export function asAct(label, got) {
  const [a, b] = label.split(" ");
  const program = b === undefined ? undefined : a;
  const sub = b === undefined ? a : b;
  const values = (TAKES[label] ?? []).flatMap((kind) => (kind === "message" ? [] : (got[kind] ?? []).map(String)));
  const message = got.message?.length ? ["-m", got.message[0]] : [];
  if (!program) return sub === "read" || sub === "edit" ? { sub, argv: [], files: values } : { sub, argv: [] };
  return { program, argv: [...sub.split("-"), ...values, ...message] };
}

/** The values in the turns before a request (the assistant's, newest first). */
export function recentValues(turns, opts) {
  return [...(turns ?? [])]
    .reverse()
    .filter((t) => t.role === "assistant" && t.text)
    .flatMap((t) => extract(t.text, opts));
}

/**
 * Acts with their arguments for an item: the act labels a baseline chose, filled from the request
 * and, where an act needs a kind the request lacks, from the turns before it.
 */
export function slotFill(labels, { text, root, meta, turns }) {
  const names = namesOf(meta);
  const found = extract(text ?? "", { root, names });
  const before = recentValues(turns, { root, names });
  return labels.map((label) => asAct(label, fill(label, found, before)));
}
