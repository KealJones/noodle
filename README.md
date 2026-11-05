# Noodle

An assistant that understands and acts without a language model. Everything it knows is a graph of
nested concepts, written in **N-Con** (`.ncon`). A message is heard into N-Con close to the words
that were said, worked out by rewriting (expanding what words mean, collapsing words into what they
name) down to a small set of primitives that do real things, and chosen among by a learned score.
It learns from sources (WordNet, VerbNet, Wiktionary, Wikidata, a tool's own documentation) and,
above all, from being corrected, and keeps what it learns in the same form it runs on, so it can
read, extend and repair itself.

- `docs/design.md`: the design, and why.
- `PLAN.md`: the order of work.
- `AGENTS.md`: the rules for anyone (or any agent) building it. Read it first.
- `docs/specs/`: the phase 0 specs (data model, format, logical form, runtime, built-ins, testing).
- `docs/results.md`: how it scores against a baseline on labelled prompts, and where it falls short.
- `docs/learnings.md`: what this round taught, for whatever comes next.
- `tasks/handoff.md`: where things were left, and the direction under review.

Status: runtime 0.50.0, last code change 2026-10-04. Specs reviewed (checkpoint 0), seed drafted
(0.1.0, `seed/README.md`, changes logged in `seed/CHANGES.md`), and a runtime running end to end:
hearing, the chart, rewriting, the two-stage score, evaluation, Speaking, the primitives, Know, and
the chat endpoints. Out of the box it knows the seed's function words and core meanings; content
words come from imports (`docs/imports.md`) or, with lookups allowed, are learned one word at a time
the first time a prompt needs them (below).

## Where it stands

Measured 2026-10-01 to 10-04 (`docs/results.md`, `docs/pilot.md`, `docs/napkin-vs-noodle.md`):

- On Keal's own coding prompts it stays below simple baselines: first act right 8.7 percent against
  11.3 for plain command-name matching (runtime 0.14.1), and about 2 to 4 percent against about 27
  for a nearest-neighbour classifier in the pilot. Hearing, not knowledge, is the bottleneck.
- On 94 everyday prompts it is ahead of Napkin, regraded strictly by hand: 33 right and 9 wrong,
  against Napkin's 28 right and 16 wrong (ChatGPT off).
- The lazy lexicon works as hoped: a store with only the seed learned 101 words in one pass and gave
  the same answers about 50 times faster on the second pass, fetching nothing, in a 7 MB store
  instead of the 1 GB one built by bulk imports.

The comparison with Napkin recommends a new small core built from Noodle's learn-to-act loop and
Napkin's portable runtime, rather than continuing either as it is; see `docs/learnings.md`.

## Running it

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm chat
```

`pnpm chat` talks to it in the terminal, in the directory it is started from (or `NOODLE_ROOT`);
`pnpm chat -- --why` prints the reasons log and the time each stage took after each reply. Other
commands:

- `pnpm run import tool git`: learn git's commands from the local man pages (no download), into
  `~/.noodle/packs/`. (Use `pnpm run import`: plain `pnpm import` is pnpm's own command.) Every pack
  there, and the seed, is imported into the store, `~/.noodle/store.db` (SQLite), the first time it
  is opened after a pack changes; after that it opens quickly and looks things up as it needs them.
  What it learns, is taught, confirms and looks up is kept in the store too. `pnpm run import
  wordnet ...` and `pnpm run import verbnet ...` take downloaded data (`docs/imports.md`). Bulk
  imports are not the recommended setup any more: the full set is about 1,870 packs and a 1 GB
  store with a first load of about 10 minutes, and many of them made everyday verbs into commands
  (`docs/learnings.md`).
- `pnpm seed:count`: the seed's entries per part, and its checks.
- `pnpm measure`: hearing and chart numbers on the local corpus (ids only).
- `pnpm build`: compile the TypeScript. The other scripts in `package.json` (`label`, `freeze`,
  `decide`, `baseline`, `score:acts`, `killtest`, `versus`, `versus:noodle`, `pilot`, `train`,
  `tutor:report` and `capture:install`) are the evaluation and training tools; see
  `docs/results.md`, `docs/pilot.md`, `docs/killtest.md` and the `docs/versus*.md` notes.

`NOODLE_STORE`, `NOODLE_PACKS` and `NOODLE_CONFIG` point the store, the packs folder and the config
somewhere else.

What it can do today, with git's pages learned: "git status", "show me the diff", "add b.txt",
"what's in README.md?", "whats in it?", "don't push yet" (and then refusing a "push"), "thanks",
"sorry byeeee". Taught a command once ("count the words in notes.txt", then `` `wc -w notes.txt` ``),
it does the same for other files in later sessions. Anything it cannot work out, it says so, naming
the word it has no sense for.

### Learning words when a prompt needs them

Before the chart, Noodle hears the message once and takes the words nothing in the store hears (not
shapes, code spans or names in the workspace). It looks up at most eight of them through Know, one
word at a time (Kaikki's per-word entry, then Wiktionary's REST API), keeps each entry as facts on
the word with its source, and hears the message again. A word no dictionary has is remembered as
missing, so it is not asked for twice. It runs only when lookups are allowed (the `SendsOutside`
grant, below) and never in a dry run.

### Knowing things

A question nothing in the graph or the workspace answers goes to Know (runtime.md section 14):
Wikipedia (a thing's own page for "what is X" and "who is X", a search on the whole question for
"why" and "how"), then Wikidata, then a web search. "what's on <url>" and "what is <url>" read the
page. Answers say where they came from, are kept as content with their source (trust level 4, the
web), and are reused from the graph for 30 days. Looking things up sends the question off the
machine, which is the guarded effect class SendsOutside: it is offered first unless the config
grants it (`"grants": ["SendsOutside"]`).

### ChatGPT, optional

When no other source answers, Know can ask ChatGPT through `gptb` (its local server, `gptb serve` on
127.0.0.1:7778, first; otherwise the `gptb` program). It is also a tutor for choices: asked which
reading was meant where nothing else says, before you are. What it says is tagged as coming from
ChatGPT (trust level 4), never decides an effectful act, and can be switched off with
`"chatgpt": false` (or just the tutor with `"tutor": false`). The measured experiment runs with it
off.

### Permissions

Every command a tool's documentation taught it has unknown effects, and documentation is a level 3
source, so the command is offered before it runs ("I can run `git status`, but I don't know yet
what it changes. Go ahead?") and runs on "yes", "ok" or "go ahead". Once you have said yes to a
command, that reading is confirmed and kept, and from then on only the grants below decide.
`~/.noodle/config.json` is the user's own grant (design section 20):

```json
{ "grants": ["UnknownEffects"], "programs": ["git"] }
```

`grants` lists effect classes that run without an offer; `programs` limits what Run may start;
`root` and `timeoutMs` are optional; `askBelow` is how sure the top reading must be for its act to
be done without asking (default 0.5); `know` (`true`, `false` or `"offline"`) and `learn` turn
lookups and keeping corrections on or off (the chat and the endpoints turn both on); `chatgpt`,
`chatgptPort`, `chatgptTimeoutMs`, `tutor` and `tutorRate` control ChatGPT; `"replay": true`
checks every weight change a correction makes against your labelled prompts (the replay gate,
testing.md section 4) and puts back any change that would turn a right answer wrong (the first
check takes about half a minute while it indexes them). Nothing Noodle learns can write this file.

## Talking to it from a chat UI

`pnpm serve` builds and starts an HTTP server (default `127.0.0.1:8787`; pass `--port`, `--host` and
`--api-key` after it) that any chat UI speaking the OpenAI or Anthropic API can use. Both streaming
and non-streaming requests work.

- OpenAI-style clients: set the base URL to `http://127.0.0.1:8787/v1`.
- Anthropic-style clients: set the base URL to `http://127.0.0.1:8787`.
- The model name is `noodle`.
- The API key is optional. Set one with `--api-key KEY` or the `NOODLE_API_KEY` environment variable
  and clients must send it as a bearer token or an `x-api-key` header. Without one, any key a client
  insists on sending is accepted.
- Browser pages are refused unless their origin is allowed: a chat UI that calls the API from the
  browser needs `--cors http://localhost:3000` (comma-separated, or `*`). Server-side UIs need
  nothing. This is because Noodle can run commands, and any page you visit could otherwise post to
  it.
- Each chat is its own conversation: a request continues the session whose history is exactly the
  messages before its last one, so two chats never share rules, offers or referents, and an edited
  or regenerated message starts fresh rather than running anything twice.

Token counts in the usage fields are whitespace-separated words, since there is no tokenizer.

## Editor support

`editors/vscode-ncon/` adds VS Code support for `.ncon` files. To try it, symlink the folder into
`~/.vscode/extensions/` (as `noodle.vscode-ncon-0.1.0`); `pnpm test:editor` runs its tests.

## History

Noodle is the fifth in a line of experiments toward the same thing: a small local assistant that
keeps what it knows in a graph it can read and grow, learns how to do something the first time it
is asked, and keeps it.

| Project | Active (2026) | What it was |
| --- | --- | --- |
| [EKG AI](https://github.com/KealJones/ekg-ai) | Aug 15 to 20 | Typed Blueprint programs, a learner loop (run, adapt, build, teach) and an LLM Teacher, in TypeScript |
| [Spoon](https://github.com/KealJones/spoon) | Aug 22 to Sep 9 | EKG renamed and rebuilt in Rust: LLM ears, mouth and Teacher; then everything as one Concept term |
| [Soup](https://github.com/KealJones/soup) | Sep 10 to 15 | Concepts as Python-style calls; a local model only hears, and Soup defines what it is missing |
| [Napkin](https://github.com/KealJones/napkin) | Sep 16 to Oct 17 | Nothing privileged: behaviour written in the graph, in `.ncon` packs, with no model hearing or speaking |
| Noodle | Sep 29 to Oct 4 | This repository |

**The name.** Noodles are what is in the soup you eat with the spoon, with the napkin beside the
bowl; "use your noodle" is what it does; and a tangle of strands is what its graph looks like.
N-Con began in Napkin as "napkin concept", the name of its `.ncon` packs; here it became a specified
language, and the N now stands for nested: `Add(Milk(), To(My(List())))`.

**How it came about.** The design was written on 2026-09-29 in Napkin's planning folder, from a
working session with Keal, as a new project rather than an edit of Napkin. It narrowed the goal from
doing what a language model does to one bet that could fail: understanding real file and git
requests well enough to reach the right end state, with nothing written by hand for that domain. The
specs came first (checkpoint 0), then the seed, then the runtime, built from 2026-09-30 to
2026-10-04 (runtime 0.1.0 to 0.50.0). What it added over Napkin: several readings chosen by a
learned score, primitives that act in the world with declared effects and guards, offers before
anything effectful, learning a tool from its own documentation, taught commands with slots, trust
levels per source, and measurement against frozen baselines.

**Where it led.** On 2026-10-04 Keal stepped back ("I think I lost that a little bit this time"):
the bulk imports had made it big and slow, and the runtime had become tied to Node. That day the
lazy lexicon landed (0.50.0), `docs/napkin-vs-noodle.md` measured the two side by side, and
`docs/learnings.md` recommended a new small core built from Noodle's learn-to-act loop and Napkin's
portable runtime. Napkin then had a final week of work (2026-10-11 to 10-17) that took in Noodle's
ideas: keeping several readings, and choosing a word's sense by the words around it and the
conversation.
