# Noodle

An assistant that understands and acts without a language model. Everything it knows is a graph of
nested concepts, written in **N-Con** (`.ncon`). A message is heard into N-Con close to the words
that were said, worked out by rewriting (expanding what words mean, collapsing words into what they
name) down to a small set of primitives that do real things, and chosen among by a learned score.
It learns from sources (WordNet, VerbNet, Wiktionary, Wikidata, a tool's own documentation) and,
above all, from being corrected, and keeps what it learns in the same form it runs on, so it can
read, extend and repair itself.

The lineage: spoon, soup, napkin, and now noodle.

- `docs/design.md`: the design, and why.
- `PLAN.md`: the order of work.
- `AGENTS.md`: the rules for anyone (or any agent) building it. Read it first.
- `docs/specs/`: the phase 0 specs (data model, format, logical form, runtime, built-ins, testing).

Status: specs reviewed (checkpoint 0), seed drafted (0.1.0, `seed/README.md`), and a first runtime
running end to end: hearing, the chart, rewriting, the two-stage score, evaluation, Speaking, the
primitives, and the chat endpoints. It knows only the seed's function words and core meanings, plus
what it learns from a tool's own man pages; content words wait on the imports (`docs/imports.md`).

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
`pnpm chat -- --why` prints the reasons log after each reply. Other commands:

- `pnpm import tool git`: learn git's commands from the local man pages (no download), into
  `~/.noodle/packs/`. `pnpm import wordnet ...` and `pnpm import verbnet ...` take downloaded data
  (`docs/imports.md`).
- `pnpm seed:count`: the seed's entries per part, and its checks.
- `pnpm measure`: hearing and chart numbers on the local corpus (ids only).

What it can do today, with git's pages learned: "git status", "show me the diff", "add b.txt",
"what's in README.md?", "whats in it?", "don't push yet" (and then refusing a "push"), "thanks",
"sorry byeeee". Anything it cannot work out, it says so, naming the word it has no sense for.

### Knowing things

A question nothing in the graph or the workspace answers goes to Know (runtime.md section 14):
Wikipedia (a thing's own page for "what is X" and "who is X", a search on the whole question for
"why" and "how"), then Wikidata, then a web search. "what's on <url>" and "what is <url>" read the
page. Answers say where they came from, are kept as content with their source (trust level 4, the
web), and are reused from the graph for 30 days. Looking things up sends the question off the
machine, which is the guarded effect class SendsOutside: it is offered first unless the config
grants it (`"grants": ["SendsOutside"]`).

### Permissions

Every command a tool's documentation taught it has unknown effects, and documentation is a level 3
source, so the command is offered before it runs ("I can run `git status`, but I don't know yet
what it changes. Go ahead?") and runs on "yes", "ok" or "go ahead". Once you have said yes to a
command, that reading is confirmed (kept in `~/.noodle/taught.ncon`), and from then on only the
grants below decide. `~/.noodle/config.json` is the user's own grant (design section 20):

```json
{ "grants": ["UnknownEffects"], "programs": ["git"] }
```

`grants` lists effect classes that run without an offer; `programs` limits what Run may start;
`root` and `timeoutMs` are optional; `"replay": true` checks every weight change a correction makes
against your labelled prompts (the replay gate, testing.md section 4) and puts back any change that
would turn a right answer wrong (the first check takes about half a minute while it indexes them).
Nothing Noodle learns can write this file.

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
