# Learnings for the next iteration (2026-10-04)

What this round of Noodle taught, for whatever comes next (Noodle continued, Napkin, or a new
core). Gathered from the build sessions of 2026-10-01 to 10-04, the measurements in docs/, and
Keal's corrections. Read with tasks/handoff.md (state and plan), tasks/lessons.md (rules from
corrections) and docs/napkin-vs-noodle.md (the comparison).

## The goal, restated (Keal)

A small local agent that learns how to do things in real time and keeps them: no MCP servers, no
tool harness, no LLM in the loop; asked to do something, it works out how, and next time it knows.
It runs on any host (Node, browser/WASM, Rust); the language is not the point. It should not need
to know everything up front.

## What worked, keep it

- **Score with senses and readings** (Keal prefers this to Napkin's context facets). A word has
  senses; readings say what a pattern becomes; a log-linear score with named features, plus dry
  runs (Suppose), chooses. Context should enter as evidence (kind fit of arguments, what the
  conversation is about), not as a separate selection mechanism.
- **Learning live, and keeping it.** Lazy lexicon: unknown words looked up once per word at prompt
  time (Kaikki per-word JSONL, Wiktionary REST as the browser-safe fallback) and kept as facts with
  their source. Two-pass test: pass 1 learned 101 words in about 36 s total, pass 2 gave identical
  answers about 50x faster with zero lookups; store 7 MB instead of 1 GB; cold start under 0.1 s.
- **The try, offer, learn loop.** Low-confidence or effectful acts are offered as their exact
  command; "no" gives numbered alternatives; a pick, a typed command in backticks, or a correction
  ("no, use --squash") is kept as the user's reading, from what the request meant, and recalled
  next time. Taught procedures with slots ("kill 8080" for any port) and steps whose output feeds
  the next (`kill $(lsof -ti :3000)`).
- **Learning tools from their own documentation**, on demand: man page or --help (asking first,
  since --help runs the program), options and their descriptions, placeholders as typed slots,
  effects from what the summary says (only-reads commands run confined with sandbox-exec).
- **Safety model.** Effect classes and guards; offers before anything that changes things; trust
  levels per source (seed 0, user 1, VerbNet/WordNet 2, tool docs 3, web/ChatGPT 4); untrusted
  readings never grant permissions; everything stored carries its source; rules like "don't push
  without asking" wait for a yes and lift for good until revoked (Keal's meaning).
- **Know answers from the graph after the first time** (facts learned from Wikipedia openings and
  Wikidata claims): "capital of france" 6.7 s the first time, 0.1 s offline after.
- **ChatGPT as a learning source and tutor**, through `gptb serve`, one persistent chat, a strict
  reply format (`choice:`, `suggest:`, `ask:`, `because:`; `kind: command|answer`), tagged from
  ChatGPT, never deciding effectful acts, measurable with it off. Live research is learning, not
  cheating (Keal).
- **Realizations compose**: wrappers say the wrapping, children say themselves; a sentence head
  and block splitting in the printer instead of nested patterns per combination.
- **Measure everything, on real prompts.** The 94-prompt harness against Napkin
  (`pnpm versus:noodle`, with per-turn and per-stage times), ablations (remove one pack, rerun),
  the two-pass learning test, and Keal's real coding corpus with baselines. Ablation showed only
  WordNet, VerbNet and the git pack moved the harness; most bulk imports did nothing.

## What went wrong, avoid it

- **Bulk importing knowledge up front.** 1 GB store, 10-minute first load, 1,870 packs, and many of
  them hurt: 1,860 tool descriptions made everyday verbs (add, show, help, fetch) into commands
  ("add 45 and 38" offered `git add`, "play fetch with my dog" became git fetch). Fetch what a
  prompt needs, when it needs it.
- **Command readings beat everyday senses**, because reaching an act is rewarded and command
  readings want nothing. Fixes: a slot takes only what its placeholder's kind allows (a pathspec is
  a file, not "45"); tool readings want what their docs say they act on (git fetch: a repository);
  everyday senses must reach meanings too, so they can compete; weights tuned by corrections and
  the trainer.
- **Host-bound runtime** (node:sqlite, child_process, mandoc, sandbox-exec). Keep capabilities
  behind primitives a host may or may not provide; keep understanding rules as data (N-Con), not
  TypeScript importers.
- **Phrase lists and test-fitting** (multi-word Forms, entries for one prompt): forbidden; fix how
  words are understood instead.
- **Hearing is the bottleneck on real prompts**, not knowledge: on Keal's coding prompts Noodle
  stayed far below simple baselines (nearest neighbour ~27 percent first act right vs ~2 to 4), and
  parse coverage stayed under the plan's stop line. Plain requests failed on hearing: "port 3000"
  as a verb, "find" as Store, "show me what's in X" as two fragments, "how much X is left".
- **Offering incomplete acts.** "commit my changes" offered `git commit` with no message and
  nothing staged; the user's yes then ran a command that could only fail. An offer should be
  runnable as offered, or say what it still needs.
- **Statements turned into rules or memories without asking**: "you didnt pull it down" stored
  "I won't run git pull it"; a stray word became the user's name. Remembering from a statement
  needs a check; rules from negations need an echo and a yes.
- **Operational lessons**: long jobs must run detached outside session scratch space (it is wiped);
  never chain cleanup after an install step that can fail; subagents share the scratchpad and must
  each use their own folder; store copies (1 GB each) fill the disk fast; `pnpm import` is pnpm's
  own command (use `pnpm run import`); measure speed as well as correctness (the harness missed a
  10x slowdown until timing was added).

## What both Noodle and Napkin lack

- **Goals and planning**: setting a goal and working out the steps to reach it. Napkin's `Pursue`
  (try candidates hypothetically, keep the route that worked as a chunk) is the closest seed.
- **Situation from conversation**: what we are doing (playing with a dog vs working in a repo)
  should weigh senses. In a score-based design this is a feature over what the conversation is
  about, not a context facet.
- **A real lazy lexicon in Napkin** (designed, never built). Noodle now has the first version.

## Worth taking from Napkin

- Small packs plus a journal instead of a big database; a node and browser platform split (it
  already has an OPFS browser build); behaviour written in the graph; an agenda of things to learn
  computed from what was left unworked; forgetting; recall and consolidation of past conversation;
  `Pursue`; short Wikidata answers.

## Next steps that the evidence supports

1. Per-word fetches for what the lazy lexicon still misses (each measured with the two-pass test):
   phrases from a word's entry (or 2 to 4 word spans), VerbNet frames per verb as small static
   files, a program's docs on first use (one subcommand at a time), sense order and frequency per
   word, capitalized retries for proper nouns. Target: the full store's 39 right at about 10 MB.
2. Kind-checked slots and wants on tool readings, so commands stop swallowing everyday sentences.
3. Situation from conversation as a score feature; Pursue-style trying of candidates.
4. Understanding rules (man page, --help, web page, dictionary entry to concepts) moved into N-Con;
   the store behind an interface; then any host.
