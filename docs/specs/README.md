# Specs (PLAN.md phase 0)

Written before any runtime code; each is a draft for Keal's review. Checkpoint 0 is all six
reviewed, with their open questions answered or listed.

| Spec | What | Status |
|---|---|---|
| `ncon.md` | the data model: expressions, concepts, facts, readings, chart entries, blocks, roles, provenance and trust | draft |
| `ncon-format.md` | the `.ncon` grammar, top-level forms, metadata, the formatter, round-trip rules | draft |
| `logical-form.md` | speech acts, operators, time, referents, opaque nodes, scope, rule evaluation, canonicalization | draft |
| `runtime.md` | what the runtime does and must not; before the chart; the six steps; matching; rewriting; the score; primitives; Suppose and Sequence; the conversation; Focus; guards; trust; Know; learning | draft |
| `built-ins.md` | the test, the primitives, the seed's eight parts, the structural concepts, how to add one | draft |
| `testing.md` | unit tests and rule lints, the corpus, the replay gate, the gold and fixtures, splits, baselines, statistics, the freeze | draft |

Each spec ends with its open questions (and a Decided list once some are answered). The ones that most change what gets built:

- The chart's seven categories (`built-ins.md` 1).
- About 130 structural names, not "a handful" (`built-ins.md` 4).
- `Permit` as a new LF head for lifting `until=Told()` (`logical-form.md` 3).
- Corrections as a runtime operation, not a speech act (`logical-form.md` 2).
- Where the experiment's gold and fixtures live (`testing.md` 1).
