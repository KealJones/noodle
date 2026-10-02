# Noodle: the build plan

The design is `docs/design.md`; the rules for building it are `AGENTS.md`. This file is the order
of work: what gets done, in what order, what has to be true before moving on, and what is Keal's to
do. Each phase ends at a checkpoint with a written result. A phase that fails its checkpoint is a
finding, reported, and the plan changes on purpose, never by drift.

The first goal is not a working assistant. It is the smallest experiment of design section 29: can
a no-model assistant understand real file and git requests, without hand-written domain knowledge,
better than simple baselines? Everything before that experiment is built only as far as the
experiment needs.

## Phase 0: specs before code

Nothing in `src/` beyond a stub until these exist and Keal has reviewed them (design section 27).

1. **The N-Con spec** (`docs/specs/ncon.md`): concepts, facts, readings (pattern, wants, becomes,
   needs, effects and checks, mode), content blocks, provenance and trust, words and senses
   (`Word#WhatItIs`), as data.
2. **The N-Con text format** (`docs/specs/ncon-format.md`): the grammar of `.ncon` files (a file
   format has a grammar; the no-grammar rule is about language), a formatter, and round-trip tests
   (parse, format, parse gives the same thing).
3. **The logical form** (`docs/specs/logical-form.md`): the speech acts (Question, Assert,
   Directive, Advice, Constraint), the operators (Not, Only, Every, Some, If, time), their argument
   kinds, scope constraints, opaque nodes (quotation, mention), and the canonicalization that makes
   "same normal form" decidable.
4. **The runtime rules** (`docs/specs/runtime.md`): what the runtime may and must not do (design
   section 28); the six chart steps; the two-stage score and its feature interface; the match
   relation (design section 9); primitives, marked pure or effectful, with effects and checks;
   Suppose and Sequence; the conversation structure and the event record; guards by effect class;
   trust levels and the protected base.
5. **Built-in concepts** (`docs/specs/built-ins.md`): the seed's eight parts, the primitives, the
   structural concepts (about 130); how to add one; the test for whether something belongs there
   (same for chess, a jam website and the user's name? if not, it is learned).
6. **The test strategy** (`docs/specs/testing.md`): runtime unit tests, the corpus, the hand-check,
   the fresh confirmatory set, the replay gate, and the frozen-system rule.

**Checkpoint 0**: all six reviewed by Keal; open questions in them listed, not guessed.

**Result (closed 2026-10-01)**: all six reviewed by Keal. Decided: roles and modifier shape in the
heard form, corrections as a runtime operation (five speech acts), `Permit` as an LF head, about 130
structural names with the time heads kept structural, and the experiment's files under
`~/.noodle/experiment/`. The chart's categories are settled with the seed draft. Still open and
listed at the end of each spec: `ncon.md` 1 to 3, `ncon-format.md` 1 and 2, `logical-form.md` 1, 4
and 5, `runtime.md` 1 to 6, `built-ins.md` 1 to 3, `testing.md` 2 to 5. None blocks phase 1; each is
answered when the work that needs it starts.

## Phase 1: week 1 (cheap tests that can end or redirect the project)

Run in parallel with the end of phase 0. Mostly Keal's work, with help.

- **Keal: the labelling session** (prompt in the session notes; results in
  `~/.napkin/corpus/tests/`): verify the draft git labels, label every git-ish prompt and a sample
  of the rest, confirm fixtures, check 100 across the corpus, and, while he has not seen the seed,
  write blind paraphrases that do not use the command's word (stopped at 15; see design section 29).
- **The seed draft** (`seed/`): the closed list of core meanings (each passing the "not
  domain-specific" check), the function-word lexicon, the lexical rules, the bridge, the initial
  weights, the default policies, the genre shapes, the English realizations. Every entry counted.
  Keal reviews it.
- **Representability and convergence (the kill test)**: Keal hand-writes target reductions for 30
  git documentation descriptions (with the glossary) and, blind to them, for 30 real requests that do not name the command;
  the match relation is run on the hand-written pairs. **Stop or redesign if fewer than 70 percent
  can be expressed with the seed, or fewer than 60 percent match the right documentation reading.**
- **The capture hook**: whenever Keal sends a prompt to a coding assistant, snapshot the working
  tree, branches, remotes and the assistant turns before it into a fixture. Confirmatory data only
  starts once this runs.
- **The baseline**: score Napkin (the prototype) and the simple baselines on the labelled items with
  `scripts/corpus.mjs`, so every later number has something to be compared with.

**Progress (2026-10-01)**: the seed is drafted (0.1.0, `seed/README.md`, counted by `pnpm
seed:count`). On Keal's instruction to keep going without waiting, phase 2's core was built ahead of
the kill test, piece by piece against its spec: the store, hearing, the chart, rewriting, the
two-stage score, evaluation with rules and guards, Speaking, the primitives, corrections with the
capped perceptron, and the chat endpoints (design section 25c); also phase 3's importers (WordNet,
VerbNet: written and tested on invented fixtures, not yet run on the real files, `docs/imports.md`)
and the first part of phase 4 (a tool's man pages give its commands' words senses that run them,
offered first). The seed changed while building (now 928 entries); those changes are before its
first review, so they are in the git history, not `seed/CHANGES.md`. The kill test is still Keal's,
and the seed is still unreviewed: if either moves, the core moves with it. Since then: teaching
("X means Y", echoed and confirmed), corrections that flip and teach the weights, the scored match
and a kill test checker (`pnpm killtest`, `docs/killtest.md`), canonicalization, the holdout split,
act scoring against Keal's labels and the command-name baseline (`docs/results.md`), the
replay gate (on with `"replay": true` in the config), and the fixes from a review of the runtime.

Not built yet, in rough order of need: the real imports (waiting on downloads, `docs/imports.md`);
understanding a documentation description into core meanings, so a command's effects are known and
a request can reach it without its name (phase 4 proper); Know and live sources; Focus beyond the workspace's
names; the default policies as runtime behaviour (seed/README.md, question 4); writing (a commit
message from the change, genre shapes); past conversations.

**Checkpoint 1**: the kill test passes; the seed is drafted and counted; the capture hook is
running; the baseline numbers exist; the accrual rate of qualifying requests is measured.

## Phase 2: the core

Built only as far as the experiment needs, test first, each piece against its spec.

1. **The store**: SQLite, indexed by lemma, with provenance, trust and pack versions; import and
   export as `.ncon`.
2. **Concepts, facts, readings, content blocks**, and the pattern matcher over lemmas and roles,
   plus the shape pattern interpreter and the character mechanics of spelling candidates (edit
   distance, sound, squeezed stretches).
3. **The chart**: word lookup, spelling, sound, stretch and surroundings candidates, shapes,
   segmentation with alternatives, the six steps, pruning, partial parses.
4. **The score**: stage one (log-linear, named features, the seed's initial weights); the match
   relation; stage two (Suppose dry run and its score); the reasons log.
5. **Evaluation**: rewriting, both directions, down to primitives; the logical form; Sequence; the
   conversation structure and event record; guards by effect class; the protected base and its
   invariant check.
6. **Primitives** for the domain: Read (files and git porcelain output, as structure), Run (with
   arguments as separate values, never shell strings), Write/Edit, Say, Ask, Suppose, Sequence;
   each with effects, checks and, where possible, an inverse.
7. **Focus** over the current conversation and the workspace (design section 14b): the pre-chart
   candidate set and needs-driven lookups, scored, budgeted and recorded. Past conversations and
   long-term user facts come after the experiment.
8. **Learning**: the latent-variable structured perceptron with its caps, calibration on its own
   data slice, and the replay gate on hand-checked items.

**Lifting from Napkin**: worth reading or lifting, each piece reviewed against `AGENTS.md` before it
comes in, never by default: the store, journal and provenance stamps (as ideas for the SQLite
store), the JavaScript-to-IR importer and the formatter (for the N-Con format), selection by
specificity, the Wikidata and Wiktionary fetchers (as reference for Know's sources), and the corpus
runner (already here). Nothing from Napkin's hearing, its packs or its host English comes over.

**Checkpoint 2**: runtime unit tests pass; the core handles the hand-written seed on the phase 1
examples; the chart's size and speed are measured on the short in-domain prompts.

## Phase 3: imports and Know

1. **Know** and its sources (Senses, Claims, Dictionary, Pages, Query, Web), with one Fetch (cached,
   throttled, retrying) and saving with provenance and trust.
2. **Imports**: wordfreq (top 5,000), Open English WordNet (coarsened), VerbNet, Wiktionary via
   Kaikki (forms, alternative forms, pronunciations, idioms and phrasal verbs), and for the domain:
   `gitglossary(7)`, `gitcli(7)` and git's man pages. ShareAlike sources in separable packs.
3. **Understanding definitions at import**, domain vocabulary first, the rest queued; coverage and
   graded precision measured.

**Checkpoint 3**: import coverage of the domain's words, and the precision of 50 hand-graded
bottomed-out senses, are reported.

## Phase 4: stage 0 (documentation to readings, automatically)

The 30 descriptions from phase 1, understood by the pipeline, graded against Keal's hand-written
targets. **Stop if fewer than 50 percent match, if sense precision is under 70 percent, or if fewer
than 60 percent of in-domain development prompts get a full or near-full parse.**

## Phase 5: stage 1 (the pilot)

About 50 labelled items: the ceiling, every baseline (name match, BM25 over the man pages, the word
classifier with and without man-page and WordNet features, nearest neighbours, the salience ranker,
slot fillers), the margin and n from a power calculation with its assumptions stated. If n cannot
be reached in about four months, the domain widens to files in general now.

## Phase 6: stage 2 (the deciding run)

Freeze the scored system as one unit (runtime commit hash, pack versions, trained weights) and
publish the seed counts, the gold format and the mapping. Accrue the confirmatory set from the
capture hook, labelled blind, until n is reached. Arms A, A+ zero-shot, A+ trained; go and stop as
pre-registered in design section 29, on end state for real requests, with the blind paraphrase set
reported beside it. Development continues on a separate version that is never the one scored.

## Phase 7: stage 3 and after

The oracle arm (reported, not deciding), then typed corrections in Keal's own words. Only after a
go: multi-step plans, writing, code editing, and the rest of the assistant, each with its own
experiment.

## Keal's tasks, in order

1. Review the phase 0 specs as they land.
2. The labelling session, including blind paraphrases before seeing the seed (15 written).
3. Review the seed draft.
4. Hand-write the 30 documentation reductions and the 30 no-name request reductions (phase 1 kill test).
5. Grade the stage 0 results and 50 bottomed-out senses.
6. Keep using coding assistants as usual once the capture hook runs; label fresh prompts in batches.
7. After a delay, re-label a random 20 percent, for reliability.
