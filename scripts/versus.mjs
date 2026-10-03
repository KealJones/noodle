// Noodle beside Napkin (`pnpm versus`): a fixed list of everyday prompts, written once (2026-10-01)
// without looking at the corpus and not tuned to either system, run through both, the replies
// printed side by side with a plain verdict for each, and the whole saved as docs/versus.md.
//
// How each system is run:
// - Noodle: createSession over packedStore() (the chat's store, with every imported pack), on an
//   instant copy of ~/.noodle/store.db so nothing the prompts teach or store is kept. The config is
//   the chat's (~/.noodle/config.json, Know on), except that corrections do not save weights.
// - Napkin: its CLI, `node ~/Git/Personal/napkin/packages/concept-runtime/dist/cli.js --graph
//   <copy of ~/.napkin/store.ncon> "<prompt>"`, one process per prompt; its reply is the block
//   after the `said` heading, ANSI stripped. Its graph copy is kept for the whole run, so what it
//   learns or stores carries over, as it does for Noodle's store copy.
// - Prompts come in sessions of related prompts. Each session gets a new Noodle session and, for
//   each system, a fresh copy of the same small workspace (a git repository with a few files),
//   which is the working directory for both.
//
// The verdict, by these criteria, applied the same way to both replies:
// 1. ERROR: the system crashed, timed out, or said nothing.
// 2. WRONG: the reply matches the prompt's `forbid` pattern (it did something it should not have:
//    a near-miss that ran or offered the act).
// 3. RIGHT: the reply matches the prompt's `expect` pattern (it answered, or did or offered the
//    act), or the prompt's `check` of the workspace holds afterwards (the act was done).
// 4. HONEST: the reply says it is stuck (it couldn't work it out, doesn't know, can't, wasn't
//    told, has nothing waiting), in a short paragraph of its own and not inside a page from a
//    source or an offer, and nothing above applied. The `expect` pattern of rule 3 is tested on
//    the reply without its stuck paragraphs, so an echo of the prompt is not an answer. Not a success, but not a wrong answer either.
// 5. Social prompts have no single right reply: RIGHT is a short reply (at most 160 characters)
//    that is not a stuck line, a link or a page from a source.
// 6. Near-misses with only a `forbid` are RIGHT when the reply does not match it.
// 7. Anything else is WRONG: an answer that is not the right one, a page about something else,
//    the wrong act.

import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const dist = join(ROOT, "dist");
const NAPKIN_CLI = join(homedir(), "Git", "Personal", "napkin", "packages", "concept-runtime", "dist", "cli.js");
const NAPKIN_GRAPH = join(homedir(), ".napkin", "store.ncon");
const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
const skipNapkin = process.argv.includes("--noodle-only");
// ChatGPT as a tutor (design section 17): --tutor=off (not asked, and what it taught not used),
// --tutor=learned (what it taught used, not asked), --tutor=on (both); the config's otherwise.
const TUTOR_MODE = process.argv.find((a) => a.startsWith("--tutor="))?.slice("--tutor=".length);
// --no-save: the report is printed only, and docs/versus.md is left as it is.
const save = !process.argv.includes("--no-save");

// ---------------------------------------------------------------------------------------------
// Dates the time prompts are judged against, from the clock at the run.

const now = new Date();
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const tomorrow = new Date(now.getTime() + 86400000);
const christmas = new Date(now.getFullYear() + (now.getMonth() === 11 && now.getDate() > 25 ? 1 : 0), 11, 25);
const untilChristmas = Math.ceil((christmas.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
const near = (n) => new RegExp(`\\b(${n - 1}|${n}|${n + 1})\\b`);
const clock = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(am|pm)\b/i;

// ---------------------------------------------------------------------------------------------
// The prompts. expect: what a right reply contains; forbid: what a reply must not do; check: what
// must hold in the workspace afterwards; social: a short conversational reply is right.

const SESSIONS = [
  ["small talk", [
    { p: "hey there", social: true },
    { p: "how are you doing today?", social: true },
    { p: "good morning!", social: true },
    { p: "what's up", social: true },
    { p: "lol ok", social: true },
    { p: "you're pretty smart", social: true },
    { p: "thanks a lot", expect: /welcome|no problem|anytime|glad|sure/i },
    { p: "see you later", expect: /bye|see you|later|take care/i },
  ]],
  ["facts", [
    { p: "what is the capital of japan?", expect: /tokyo/i },
    { p: "who wrote pride and prejudice", expect: /austen/i },
    { p: "how many legs does a spider have", expect: /\b(8|eight)\b/i },
    { p: "what's the boiling point of water in celsius", expect: /\b(100|99\.9\d*)\b/ },
    { p: "who painted the mona lisa?", expect: /leonardo|da vinci/i },
    { p: "what year did the berlin wall fall", expect: /1989/ },
    { p: "is a tomato a fruit?", expect: /\byes\b/i },
    { p: "what language do they speak in brazil", expect: /portuguese/i },
  ]],
  ["math", [
    { p: "what's 12 times 7", expect: /\b84\b/ },
    { p: "what is 15% of 200", expect: /\b30\b/ },
    { p: "add 45 and 38", expect: /\b83\b/ },
    { p: "whats 100 divided by 8", expect: /12\.5/ },
    { p: "square root of 144?", expect: /\b12\b/ },
    { p: "2+2", expect: /\b4\b/ },
    { p: "if i have 3 apples and eat one how many are left", expect: /\b(2|two)\b/i },
  ]],
  ["units", [
    { p: "how many inches in a foot", expect: /\b12\b/ },
    { p: "convert 5 km to miles", expect: /3\.1/ },
    { p: "what is 70 fahrenheit in celsius", expect: /\b21(\.\d+)?\b/ },
    { p: "how many grams are in a pound", expect: /45[34]/ },
    { p: "how many minutes are in 3 hours", expect: /\b180\b/ },
  ]],
  ["time and reminders", [
    { p: "what time is it", expect: clock },
    { p: "what day is it today", expect: new RegExp(DAYS[now.getDay()], "i") },
    { p: "what's the date tomorrow", expect: new RegExp(`${MONTHS[tomorrow.getMonth()]}\\s+${tomorrow.getDate()}\\b|\\b${tomorrow.getDate()}(st|nd|rd|th)?\\s+(of\\s+)?${MONTHS[tomorrow.getMonth()]}|${tomorrow.toISOString().slice(0, 10)}|\\b${tomorrow.getMonth() + 1}/${tomorrow.getDate()}\\b`, "i") },
    { p: "remind me to call the dentist at 3pm", expect: /remind|3\s?pm|15:00/i },
    { p: "how many days until christmas", expect: near(untilChristmas) },
  ]],
  ["lists and memory", [
    { p: "start a grocery list", expect: /list/i },
    { p: "add eggs and milk to it", expect: /eggs/i },
    { p: "also add bread", expect: /bread/i },
    { p: "what's on my grocery list?", expect: /(?=[\s\S]*eggs)(?=[\s\S]*milk)(?=[\s\S]*bread)/i },
    { p: "take milk off the list", expect: /remov|took|taken|deleted|done|off/i },
    { p: "remember that my sister's birthday is june 4", expect: /remember|got it|noted|ok|will/i },
    { p: "when is my sister's birthday?", expect: /june\s+4|4(th)?\s+(of\s+)?june/i },
    { p: "my name is sam", expect: /\bsam\b|nice to meet|got it|noted/i },
    { p: "what's my name", expect: /\bsam\b/i },
  ]],
  ["definitions", [
    { p: "what does ephemeral mean", expect: /short|brief|transient|fleeting|lasting a (very )?short/i },
    { p: "define ubiquitous", expect: /everywhere|present/i },
    { p: "what's a synonym for happy", expect: /glad|joyful|cheerful|content|felicitous|merry|pleased/i },
    { p: "what is photosynthesis", expect: /light|plants?|energy|sugar/i },
    { p: "what does idempotent mean in programming", expect: /same|repeat|again|more than once|unchanged/i },
    { p: "meaning of the word serendipity", expect: /chance|luck|accident|fortunate|unexpected/i },
  ]],
  ["files", [
    { p: "what files are in this folder", expect: /(?=[\s\S]*readme)(?=[\s\S]*notes)/i },
    { p: "show me the readme", expect: /shopping app/i },
    { p: "what's in notes.txt", expect: /buy milk/i },
    { p: "how many lines are in notes.txt", expect: /\b(3|three)\b/i },
    { p: "create a file called ideas.md with the text 'build a robot'", expect: /ideas\.md/i, check: (r) => has(r, "ideas.md", "build a robot") },
    { p: "yes", check: (r) => has(r, "ideas.md", "build a robot") },
    { p: "rename ideas.md to plans.md", expect: /plans\.md/i, check: (r) => has(r, "plans.md") },
    { p: "delete plans.md", expect: /plans\.md/i },
  ]],
  ["git", [
    { p: "what branch am i on", expect: /\bmain\b/i },
    { p: "what changed since the last commit", expect: /readme/i },
    { p: "show me the git log", expect: /first commit/i },
    { p: "commit my changes with the message 'update readme'", expect: /commit/i, check: (r) => lastCommit(r).includes("update readme") },
    { p: "yes go ahead", check: (r) => lastCommit(r).includes("update readme") },
    { p: "is the working tree clean now?", expect: /clean|nothing to commit|no changes|\byes\b/i },
    { p: "create a branch called feature-login", expect: /feature-login/i, check: (r) => branches(r).includes("feature-login") },
    { p: "push it", expect: /push|remote|origin|upstream/i },
  ]],
  ["instructions", [
    { p: "don't run any git commands without asking me first", expect: /got it|\bok\b|won't|will ask|understood|sure/i },
    { p: "show me the git status", expect: /\?/ },
    { p: "from now on, keep your answers short", expect: /got it|\bok\b|will|sure|understood/i },
    { p: "stop", expect: /stop|\bok\b|sure/i },
  ]],
  ["multi-step", [
    { p: "read notes.txt and tell me how many lines it has", expect: /\b(3|three)\b/i },
    { p: "make a file called a.txt, then another called b.txt", expect: /(?=[\s\S]*a\.txt)(?=[\s\S]*b\.txt)/i, check: (r) => has(r, "a.txt") && has(r, "b.txt") },
    { p: "yes", check: (r) => has(r, "a.txt") && has(r, "b.txt") },
    { p: "list the files and then show me package.json", expect: /"name"|\bshop\b/i },
    { p: "what's 6 times 7 and what's the capital of italy", expect: /(?=[\s\S]*\b42\b)(?=[\s\S]*rome)/i },
  ]],
  ["typos and messy phrasing", [
    { p: "waht is teh capitol of france", expect: /paris/i },
    { p: "hwo many days in a leap yeer", expect: /366/ },
    { p: "pls show me whats in teh readme", expect: /shopping app/i },
    { p: "whats 9 tims 9", expect: /\b81\b/ },
    { p: "remmber my fav color is green", expect: /remember|got it|noted|ok|will/i },
    { p: "wats my fav color", expect: /green/i },
    { p: "can u tell me the tiem", expect: clock },
    { p: "sooo how r u", social: true },
  ]],
  ["near-misses", [
    { p: "i pushed the code yesterday", forbid: /go ahead\?|^done|^ran|git push/im },
    { p: "my friend deleted his whole repo lol", forbid: /go ahead\?|^done|^ran|\brm\b/im },
    { p: "what does git commit do?", expect: /record|snapshot|save|changes|repository/i, forbid: /go ahead\?|^done|^ran/im },
    { p: "the word delete has six letters", forbid: /go ahead\?|^done|^ran/im },
    { p: "should i use tabs or spaces?", forbid: /go ahead\?|^done|^ran/im },
    { p: "how do i make a new branch in git", expect: /git (branch|checkout -b|switch -c)/i, forbid: /go ahead\?|^done|^ran/im },
    { p: "never mind", social: true },
  ]],
  ["conversation", [
    { p: "tell me a joke", social: true },
    { p: "what can you do?", expect: /\bfiles?\b|\bgit\b|questions|help|\bcan\b/i },
    { p: "that's not what I meant", expect: /\?|sorry|what did you mean|which/i },
    { p: "who made you", expect: /keal|\bmade\b|built|created|wrote/i },
    { p: "wow", social: true },
    { p: "nice", social: true },
  ]],
];

// ---------------------------------------------------------------------------------------------
// The workspace: a small git repository, the same for both systems.

const GIT_ENV = { GIT_AUTHOR_NAME: "Versus", GIT_AUTHOR_EMAIL: "versus@example.com", GIT_COMMITTER_NAME: "Versus", GIT_COMMITTER_EMAIL: "versus@example.com" };
Object.assign(process.env, GIT_ENV);

function git(root, ...args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).stdout ?? "";
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "versus-"));
  writeFileSync(join(root, "README.md"), "# Shopping app\n\nA tiny app that keeps a shopping list.\n");
  writeFileSync(join(root, "notes.txt"), "buy milk\ncall mom\nfix the bike\n");
  writeFileSync(join(root, "package.json"), '{\n  "name": "shop",\n  "version": "1.0.0"\n}\n');
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "app.js"), "console.log('hello');\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "first commit");
  // An uncommitted change, so status and diff have something to say.
  writeFileSync(join(root, "README.md"), "# Shopping app\n\nA tiny app that keeps a shopping list.\n\nRun it with node.\n");
  return root;
}

const has = (root, file, text) => existsSync(join(root, file)) && (text === undefined || readFileSync(join(root, file), "utf8").includes(text));
const lastCommit = (root) => git(root, "log", "-1", "--format=%s");
const branches = (root) => git(root, "branch", "--format=%(refname:short)").split("\n");

// ---------------------------------------------------------------------------------------------
// The two systems.

async function noodle() {
  const { createSession, packedStore, readConfig, STORE, PACKS } = await import(join(dist, "assistant", "index.js"));
  const dir = mkdtempSync(join(tmpdir(), "versus-store-"));
  const path = join(dir, "store.db");
  // An instant copy where the file system can clone (APFS), so the run keeps nothing.
  for (const ext of ["", "-wal"]) if (existsSync(STORE + ext)) copyFileSync(STORE + ext, path + ext, constants.COPYFILE_FICLONE);
  const store = packedStore(PACKS, path);
  const config = readConfig();
  return {
    name: "Noodle",
    session(root) {
      const tutor = TUTOR_MODE === undefined ? config.tutor : TUTOR_MODE !== "off";
      const s = createSession(store, root, { ...config, know: config.know ?? true, learn: false, tutor });
      if (TUTOR_MODE === "learned") s.tutor = undefined;
      return async (p) => (await s.turn(p)).text;
    },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function napkin() {
  const dir = mkdtempSync(join(tmpdir(), "versus-napkin-"));
  const graph = join(dir, "store.ncon");
  copyFileSync(NAPKIN_GRAPH, graph);
  return {
    name: "Napkin",
    session(root) {
      return async (p) => {
        const r = spawnSync("node", [NAPKIN_CLI, "--graph", graph, p], { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 1 << 28, env: { ...process.env, ...GIT_ENV, FORCE_COLOR: "1" } });
        if (r.error) throw r.error;
        return saidBlock(r.stdout ?? "");
      };
    },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Napkin's reply: the lines after the bold `said` heading, up to the next bold heading. */
function saidBlock(out) {
  const lines = out.split("\n");
  const bold = (l) => l.startsWith("\x1b[1m");
  const strip = (l) => l.replace(/\x1b\[[0-9;]*m/g, "");
  const at = lines.findIndex((l) => bold(l) && /^said\b/.test(strip(l)));
  if (at < 0) return "";
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (bold(l)) break;
    body.push(strip(l));
  }
  return body.join("\n").trim();
}

// ---------------------------------------------------------------------------------------------
// Verdicts

const STUCK = /\b((I )?(couldn't|could not|can't|cannot|don't|do not|didn't) (work (it |that |this )?out|know|understand|tell|find|follow|see)|not sure (what|how)|no idea|haven't told me|I'm not able|I am not able|nowhere to look|I'm not sure|put it another way|nothing (I'm|I am) waiting)\b/i;
/** An offer to do something ("... Go ahead?") proposes the act; it is not being stuck. */
const OFFER = /\b(go ahead|shall I|want me to)\?/i;
/** Stuck is said in a short paragraph of its own, not inside a page from a source or an offer. */
const isStuck = (x) => x.length <= 200 && STUCK.test(x) && !/https?:|\]\(/.test(x) && !OFFER.test(x);

function verdict(item, reply, root) {
  if (reply === undefined || reply === null || !String(reply).trim()) return item.check?.(root) ? "RIGHT" : "ERROR";
  const r = String(reply);
  const paras = r.split(/\n\s*\n/);
  const stuck = paras.some(isStuck);
  // What the reply says besides being stuck: an echo of the prompt inside "I couldn't work out
  // ..." is not an answer.
  const rest = paras.filter((x) => !isStuck(x)).join("\n\n");
  if (item.forbid?.test(r)) return "WRONG";
  if (item.expect?.test(rest)) return "RIGHT";
  if (item.check?.(root)) return "RIGHT";
  if (item.social && !stuck && r.length <= 160 && !/https?:|\]\(|From (Wikipedia|Wiktionary|Wikidata|the web)/i.test(r) && !/^(done|ran)\b/i.test(r)) return "RIGHT";
  if (stuck) return "HONEST";
  if (item.forbid && !item.expect) return "RIGHT";
  return "WRONG";
}

// ---------------------------------------------------------------------------------------------
// The run

// Napkin does not change between Noodle's runs, and its run is most of the hour: with
// --reuse-napkin its replies and verdicts come from the last full run (docs/versus-napkin.json).
const NAPKIN_CACHE = join(ROOT, "docs", "versus-napkin.json");
const reuse = process.argv.includes("--reuse-napkin") && existsSync(NAPKIN_CACHE) ? JSON.parse(readFileSync(NAPKIN_CACHE, "utf8")) : undefined;
const cached = (rows) => ({ name: "Napkin", cached: rows, session: () => async () => undefined, done() {} });
const systems = [await noodle(), ...(skipNapkin || !existsSync(NAPKIN_CLI) ? [] : [reuse ? cached(reuse) : napkin()])];
const rows = [];
let n = 0;
for (const [title, items] of SESSIONS) {
  if (only && !title.includes(only)) {
    n += items.length;
    continue;
  }
  const out = items.map((item) => ({ n: ++n, item, title, replies: {}, verdicts: {} }));
  for (const sys of systems) {
    if (sys.cached) {
      for (const row of out) {
        const was = sys.cached[row.n];
        row.replies[sys.name] = was?.reply;
        row.verdicts[sys.name] = was?.verdict ?? "ERROR";
      }
      continue;
    }
    const root = workspace();
    const say = sys.session(root);
    for (const row of out) {
      let reply;
      try {
        reply = await say(row.item.p);
      } catch (err) {
        reply = `(error: ${err instanceof Error ? err.message : String(err)})`;
        row.verdicts[sys.name] = "ERROR";
      }
      row.replies[sys.name] = reply;
      row.verdicts[sys.name] ??= verdict(row.item, reply, root);
      process.stderr.write(`${sys.name} ${row.n} ${row.verdicts[sys.name]}\n`);
    }
    rmSync(root, { recursive: true, force: true });
  }
  rows.push(...out);
}
for (const sys of systems) sys.done();

// ---------------------------------------------------------------------------------------------
// The report

const KINDS = ["RIGHT", "HONEST", "WRONG", "ERROR"];
const names = systems.map((s) => s.name);
const count = (name, rs = rows) => Object.fromEntries(KINDS.map((k) => [k, rs.filter((r) => r.verdicts[name] === k).length]));
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").slice(0, 400) + (String(s ?? "").length > 400 ? " ..." : "");

const md = [];
md.push("# Noodle beside Napkin", "");
md.push(`Run ${now.toISOString().slice(0, 16).replace("T", " ")} UTC with \`pnpm versus\` (scripts/versus.mjs): ${rows.length} everyday prompts in ${new Set(rows.map((r) => r.title)).size} sessions, written once without looking at the corpus and not tuned to either system. The criteria for each verdict are stated at the top of the script: RIGHT (answered, or did or offered the act), HONEST (said it was stuck), WRONG (a wrong answer, a page about something else, or an act it should not have done), ERROR (crashed, timed out or said nothing). Replies are cut at 400 characters here.`, "");
md.push("## Summary", "");
md.push(`| | ${KINDS.join(" | ")} |`, `|---|${KINDS.map(() => "---").join("|")}|`);
for (const name of names) md.push(`| ${name} | ${KINDS.map((k) => count(name)[k]).join(" | ")} |`);
md.push("", "By session (RIGHT / HONEST / WRONG / ERROR):", "");
md.push(`| session | ${names.join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
for (const title of new Set(rows.map((r) => r.title))) {
  const rs = rows.filter((r) => r.title === title);
  md.push(`| ${title} | ${names.map((name) => KINDS.map((k) => count(name, rs)[k]).join(" / ")).join(" | ")} |`);
}
for (const title of new Set(rows.map((r) => r.title))) {
  md.push("", `## ${title}`, "");
  md.push(`| # | prompt | ${names.map((x) => `${x} | verdict`).join(" | ")} |`, `|---|---|${names.map(() => "---|---").join("|")}|`);
  for (const r of rows.filter((x) => x.title === title)) md.push(`| ${r.n} | ${cell(r.item.p)} | ${names.map((x) => `${cell(r.replies[x])} | ${r.verdicts[x]}`).join(" | ")} |`);
}
const text = md.join("\n") + "\n";
if (!only && save) writeFileSync(join(ROOT, "docs", "versus.md"), text);
if (!only && save && systems.some((x) => x.name === "Napkin" && !x.cached))
  writeFileSync(NAPKIN_CACHE, JSON.stringify(Object.fromEntries(rows.map((r) => [r.n, { prompt: r.item.p, reply: r.replies.Napkin, verdict: r.verdicts.Napkin }])), null, 1) + "\n");
console.log(text);
