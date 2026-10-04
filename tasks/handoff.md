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
- [x] 1c. Session.turn pre-pass (0.50.0): Session.hearLearning in turn.ts hears once, takes the
      words nothing hears (hear.ts `unheard`: a letters-only token with an Unknown candidate, not
      inside a Shape, SetAside or InPlay span), drops ones known missing, looks up at most
      `Budget(Lexicon(), lookups=8)` (seed/policies.ncon) in parallel through Know.word, logs each
      as `focus: the word "x" looked up in the lexicon: N facts (0.41 s)` (stage "words" in the
      turn's times), and hears again if anything was learned. Skipped in dry runs, offline and
      without the SendsOutside grant. Know takes `fetchWord` as an option (tests:
      src/runtime/lexicon.test.ts, a fake dictionary). versus.mjs got `--store=<path>` (run on
      that store, no copy), `--learn` (keep tool packs and weights) and `--json=<path>`.
- [x] 1d. Measured 2026-10-04 on 0.50.0, ChatGPT off, Know online, NOODLE_PACKS an empty folder,
      NOODLE_STORE a fresh file (`node scripts/versus.mjs --reuse-napkin --no-save
      --store=<db> --json=<out>`, pass 1 with `--learn`):

      | | R / H / W | median turn | p90 | lookups |
      |---|---|---|---|---|
      | seed only, no pre-pass (docs/napkin-vs-noodle.md) | 22 / 66 / 6 | 0.01 s | | 0 |
      | seed only, pass 1 (learning) | 27 / 62 / 5 | 0.24 s | 3.7 s | 101 words (90 found) in 60 turns, 35.9 s in all, 0.42 s per word median, worst turn 4.9 s |
      | seed only, pass 2 (same store) | 27 / 62 / 5 | 0.01 s | 0.08 s | 0 |
      | installed full store, rerun on 0.50.0 | 39 / 50 / 5 | 0.50 s | 4.5 s | 19 (8 found) |

      Pass 2 gave the same verdict on every prompt and fetched nothing. Cold start: the seed-only
      store is 1.76 MB and builds in under 0.1 s; after pass 1 it is 7.05 MB (words plus Know's
      pages), unchanged by pass 2. The only tool learned was tabs (a pack of 4.7 KB).
      What the full store has and pass 2 lacks (16 prompts differ; 12 are full-store wins):
      - **Multi-word idioms** (Wiktionary idioms pack): "what time is it" and "what day is it"
        are `WhatTimeIsIt`, "my name is" is `MyNameIs`; seed-only reads `Be(It)` and is stuck.
        Per word: Kaikki's entry for a word lists its derived terms and phrases; keep those whose
        words are all in the prompt as `Words(...)`, or look up the prompt's 2 to 4 word spans
        (Kaikki has a file per phrase) after the single words.
      - **Verb frames and their bridge** (VerbNet): "show me the readme" is `Show(theme=Speaker)`
        with no route to Read; the full store gets there through show's VerbNet class. Per word:
        slice VerbNet into one small file per verb lemma (classes, frames, roles) served
        statically, fetched the first time a verb is learned.
      - **Tool docs** (the git pack): git log, commit, push, status and "what does git commit do"
        are all stuck. In the versus workspace "git" is never unheard: hear's InPlay proposes
        `.git` a spelling step away, so neither the pre-pass nor learnPrograms sees it, and
        learnPrograms only takes tokens whose every candidate is Unknown. Per word: when an
        unheard word is a program on the PATH, learn it from `--help` or its man page in the same
        pre-pass (learning git's whole manual set is ~50 minutes, so per subcommand, on first
        use: `git help log`).
      - **Sense ranking** (WordNet sense order, wordfreq): "sam" learned from Kaikki as a rare verb
        took "my name is sam" (`Directive(Sam)`); the full store lost that to the idiom. Per word:
        keep the dictionary's sense order and the word's frequency (one number per word) as facts
        with the entry, and weight rare senses down.
      - Lowercase-only lookup misses proper nouns (france, italy, christmas, fahrenheit, lisa
        were "not found"): try the capitalized title when the lowercase file is missing.
      Seed-only beat the full store on "add 45 and 38" (no git reading to win) and "yes go ahead"
      (no failed commit).
- [ ] 2, 3, 4 as above.

### Paused 2026-10-04: deciding Noodle vs Napkin vs new

Keal asked for an in-depth Napkin vs Noodle comparison of raw-string parsing before going further
("maybe I should abandon noodle and take the learnings back to napkin? or start an entirely new
thing"). A subagent is writing docs/napkin-vs-noodle.md (how each parses, where each wins on the
same inputs with failure causes, sizes and times, fit with Keal's goal, a recommendation). 1c
(the hearing pre-pass) is paused until Keal decides; 1a and 1b are committed (0.49.0) and are
small and reusable either way.

### Comparison done (docs/napkin-vs-noodle.md)

Recommendation: a small new core taking Noodle's learn/offer loop, guards, trust, --help learning,
scored choice and per-word lookup, and Napkin's platform split (node and browser), packs plus a
journal, behaviour in the graph, agenda and forgetting. Cheaper check first: finish 1c and 1d on a
seed-only Noodle and run Keal's two passes; if the second pass matches the installed store's 39
right, the lazy lexicon is proven and carries over. New safety bug found: a negated statement or a
"without" becomes a stored rule with no confirmation ("you didnt pull it down" stored "I won't run
git pull it"). Waiting on Keal's decision.

### Keal's call on concept architecture (2026-10-04)

Keal prefers Noodle's score with senses and readings over Napkin's context facets (mode,
situation): "it just might be weighted incorrectly right now". Keep it. Context in Napkin's sense
(Walking(Dog())) becomes evidence the score uses: kind fit of a reading's arguments. The "fetch"
case ("im going to go play fetch with my dog" read as git fetch) needs: (1) wants on tool readings
from what their docs say they act on (git fetch: a repository or remote), so a dog costs WantedKind;
(2) the game sense of fetch, from the lazily learned dictionary entry, reaching play's slot (VerbNet
play frames want a game); (3) weights: reaching an act is rewarded, so command readings beat
everyday senses; tune with corrections and the trainer, not by hand. Napkin designed a lazy lexicon
too but never built it. Worth carrying from Napkin: Pursue (try candidates hypothetically, keep the
route that worked), recall and consolidation of past conversation, the agenda of things to learn.

See docs/learnings.md for everything this round taught, gathered for the next iteration.
