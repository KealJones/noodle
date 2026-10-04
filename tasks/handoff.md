# Handoff (2026-10-04)

For the next agent. Read AGENTS.md, tasks/lessons.md and tasks/todo.md first; this file says where
things stand and what Keal is reconsidering.

## Keal is reconsidering the direction (read this first)

Keal's words, 2026-10-04: since spoon, the project was meant to be "a small local agent that can
adapt, learn and do shit without MCP servers, without needing tools, without a harness ... it gets
asked to do something, it figures out HOW to do that thing and then persists that, so the key part
is that it knows how to learn to do stuff in real time, not that it knows everything up front."
And: it should run in any host environment (Rust, WebAssembly, TypeScript, Node; the runtime
language is not what matters). "I think I lost that a little bit this time."

What drifted, honestly:
- **Size and load time.** The installed state is ~1,870 packs (~120 MB of .ncon) loaded into a
  1 GB SQLite store; a first load takes ~10 minutes. Most of it is bulk import (WordNet 69 MB,
  Wiktionary, 1,860 man-page tool packs, tldr, the GitHub OpenAPI pack), i.e. knowing things up
  front. The ablation (docs/versus.md history) showed only WordNet, VerbNet and the git pack moved
  the harness; Wiktionary packs, wordfreq, definitions and most tools did not.
- **Host-bound.** The runtime leans on node:sqlite, node:fs, child_process, mandoc and
  sandbox-exec. A browser/OPFS port was scoped (store behind an interface, sqlite-wasm in OPFS, a
  browser World with no Run) but Keal said hold off.
- The learn-on-demand pieces that fit the vision exist and are worth keeping as the center:
  on-demand tool learning from a man page or --help (offered first), the try/offer/learn loop
  (numbered alternatives, typed commands kept), taught procedures with slots and chained steps
  ("kill 8080"), corrections and recall of confirmed commands, Know learning facts from pages and
  answering from the graph offline, the ChatGPT tutor and stuck-request asks (one gptb chat), all
  tagged with their source.

Do not start the browser port or more bulk imports. Ask Keal what he wants first; likely
directions: a small core (seed + only what is learned on demand), packs fetched or learned lazily
when a word or tool is first needed, the store abstracted from node:sqlite, and the harness
measuring "learned it live and kept it" (Keal's benchmark method in tasks/todo.md).

## State

- main is at fe73b92 (0.48.1), pushed, clean. `pnpm test` passes (214).
- versus (scripts/versus.mjs, `pnpm versus:noodle`, ChatGPT off via NOODLE_CONFIG copy with
  "chatgpt": false): 39 right / 50 honest / 5 wrong on the installed packs; median turn ~0.25 s.
  With ChatGPT on (gptb serve on 127.0.0.1:7778): about 50 / 40 / 4. Napkin: 31 / 49 / 14.
- On Keal's real coding corpus Noodle is far below the baselines (pilot: first act ~2 to 4 percent
  vs nearest neighbour ~27); the phase 4 stop lines are not met (parse coverage 50 vs 60, sense
  precision 54 vs 70). docs/pilot.md, docs/baselines.md, docs/killtest.md.
- Installed packs (~/.noodle/packs): the 0.44 to 0.46-era set; ~/.noodle/packs-backup is empty.
- **A re-import is running detached** in ~/.noodle/reimport (run.sh, log.txt): VerbNet, 1,860
  tools in 6 shards, git alone, then gh lsof curl jq pwd and tldr, on code 0.48.1 (.dist-tools/).
  When done (log says DONE), measure versus on a store copy (NOODLE_PACKS=~/.noodle/reimport/packs)
  and only then install, in separate checked steps (an earlier install chained with && after a
  failing glob and a trailing cleanup deleted the new packs). Given Keal's reconsideration, it may
  be better not to install it at all; ask. It measured 40/49/5 before it was lost the first time.
- opencode: ~/.config/opencode/opencode.jsonc has providers noodle (127.0.0.1:8787, `pnpm serve`)
  and gptb, default noodle/noodle. Run with `pnpm dlx --allow-build=opencode-ai opencode-ai`.
- Disk: ~60 GB free. Scratch copies of the 1 GB store add up fast; delete them.

## Practical notes

- Subagents stall if a command runs long without output; tell them to use `timeout` and run long
  work detached. They share the session scratchpad: give each its own folder.
- Long imports must run detached (nohup) outside the session scratchpad (it is wiped on restart).
- `pnpm import` is pnpm's own command: use `pnpm run import ...`.
- Bulk tool learning (`pnpm run import tools`) skips programs that already have a pack; delete the
  tool packs first to redo them. Bulk mode gives everyday verbs no readings, so git and gh must be
  learned alone (`pnpm run import tool git`), which reads every sentence and takes ~50 minutes.
- Seed changes are logged in seed/CHANGES.md; the seed is no longer frozen in practice (dev copy).

## Proposed direction, agreed with Keal 2026-10-04: learn the missing pieces at prompt time

Keal: "instead of downloading the entirety of wordnet verbnet or whatever we figure out how to
learn the missing pieces of a prompt in real time so that it goes and gets them right after the
prompt is said? slower up front cost at prompt time the first time it uses new phrasings but once
it knew it it stuck." And move man page learning and web understanding into N-Con, with the
runtime connecting concepts to the environment where it can; some capabilities are missing in some
hosts, and that is fine.

1. **Lazy lexicon.** Hearing in two passes: before the chart, tokens with no entry (only Unknown or
   spelling candidates; not shapes, code spans or workspace names) are looked up through Know, one
   word at a time, and what comes back is imported for just that word (forms, part of speech and
   so chart categories through the seed's mapping, senses with their glosses), kept with its source;
   then the prompt is heard again. A word looked up and not found is remembered too. Sources: Kaikki's
   per-word JSONL (kaikki.org/dictionary/English/meaning/<a>/<ab>/<word>.jsonl, rich; no CORS) in
   Node; Wiktionary's REST API (/api/rest_v1/page/definition/<word>, CORS, POS and definitions) as
   the fallback that works in a browser. Later: VerbNet frames and WordNet kinds per word, sliced
   into small static files.
2. **Understanding as N-Con.** How a man page, --help, a web page or a dictionary entry becomes
   concepts is moved from TypeScript importers into readings over their structure; the runtime only
   provides the primitives that read them (Read(ManPage), Know's fetches), and a host without one
   lacks that route and says so.
3. **Store behind an interface** (node:sqlite now; sqlite-wasm in OPFS for a browser) once it is
   small.
4. **Measure** with Keal's two passes: a store with only the seed, the versus prompts with learning
   on (timed, counting lookups), then again: as good, fast, nothing new fetched. Plus cold-start
   size and time.

### Progress (keep this current)

- [x] 1a. Know.word(lemma): fetch one word (Kaikki, then Wiktionary REST), return its entry. Done: sources.ts wordEntry, know.ts word() (yeet 0.6 s, 37 facts; unknown words remembered as NotFound on Lexicon).
- [x] 1b. Importer for one word's entry into N-Con forms (src/know/word.ts), reusing the seed's
      part-of-speech to category mapping (categoriesFor in src/know/wordnet.ts) and Names.
- [ ] 1c. Session.turn pre-pass: unknown tokens looked up and imported before the chart; budgeted
      (Focus), never in Suppose, only with SendsOutside granted and Know online.
- [ ] 1d. Test on a seed-only store (no packs): two-pass versus, timings, lookups; unit test with a
      fake fetch.
- [ ] 2, 3, 4 as above.
