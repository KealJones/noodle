# Build brief (2026-10-01): for the agents building Noodle's missing pieces

Noodle is an assistant without a language model (read `AGENTS.md` first, then `tasks/lessons.md`).
It runs end to end today but is weak on everyday prompts, because pieces of the plan were never
built. This brief is the map of the code so each builder can start fast.

## The pipeline (one turn), and where each part lives

| Step | File | What it does |
|---|---|---|
| store | `src/runtime/store.ts` | SQLite store (`~/.noodle/store.db` for chat; in-memory for tests): facts, readings, blocks; `lookup(lemma)`, `facts(subject, head)`, `readingsOn(owner)`, `readingsFor(patternHead)`, `addFact`, `addReading`, `addBlock` |
| seed | `seed/*.ncon` | the hand-written base: core meanings, function words, bridge (core meanings to primitives), lexical rules, weights, policies (and the trust table), genres, realizations (all wording) |
| hearing | `src/runtime/hear.ts` | tokens, candidates (exact, case, inflection, spelling, stretched, workspace names, shapes), segments |
| chart | `src/runtime/chart.ts` | the six steps over chart entries (`Category(C(), Takes(...)...)` facts on words), lexical rules, covers |
| rewriting | `src/runtime/rewrite.ts` | readings applied outermost first, alternatives in a beam |
| turn | `src/runtime/turn.ts` | segments, per-fragment readings, stage-two dry runs (Suppose), the winner evaluated, corrections, what is said |
| evaluation | `src/runtime/evaluate.ts` | speech acts: Directive runs its act (rules, guards, trust, offers), Question answers (pure primitives, then Know), Constraint stores a rule, Assert checks |
| primitives | `src/runtime/primitives/` | the only code that touches the world; registry in `index.ts`; interface in `src/runtime/primitive.ts` |
| Know | `src/runtime/know/` | the door to outside knowledge (Wikipedia, Wikidata, Wiktionary, web, URLs) |
| Speaking | `src/runtime/speak.ts` + `seed/realizations.ncon` | realization readings (mode=Speaking) into a document, printed as markdown |
| imports | `src/know/` | WordNet, VerbNet, Wiktionary forms, tool man pages into packs (`~/.noodle/packs/`); `pnpm run import ...` |
| chat | `src/assistant/` | `createSession`, `packedStore()`, `pnpm chat -- --why` (shows the reasons log) |

Packs imported on this machine: WordNet 2025, VerbNet 3.4, Wiktionary forms, git and gh man pages.
`packedStore()` opens `~/.noodle/store.db` with all of them (0.25 s). Tests use `seededStore()`
(seed only) and must not touch the network or `~/.noodle`.

## Rules that bite (see AGENTS.md for all of them)

- Runtime code names no concept outside `src/structural.ts`, has no word lists, and only
  primitives and Know's adapters touch the world. `src/lint.test.ts` enforces this.
- English lives in the seed, on its words, as facts and readings. Never add a multi-word `Form` or
  `Lemma`, a misspelling, or any entry whose purpose is to make one prompt pass (`tasks/lessons.md`).
  Fix how words are understood, what primitives exist, or what is learned.
- Choices go through the score, never an `if` that picks a reading.
- Every runtime change bumps `src/version.ts` and `package.json` (minor for a feature). Commit in
  plain prose, no em-dashes, ending with the Co-Authored-By line you are given.
- `pnpm test` must pass (it builds first). Check your work by running real, fresh prompts through
  `node dist/assistant/chat.js` (pipe lines in; add `-- --why` for reasons), not by tuning tests.

## How to know it works

Use prompts you have not seen fail, phrased several ways, and include near-misses that should NOT
trigger your feature. Report the before and after honestly, including what still fails.
