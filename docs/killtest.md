# The kill test: how to write it down and run it

Week 1's test (design section 29; PLAN.md phase 1). Keal writes, by hand and in the seed's
vocabulary, the reductions of 30 git documentation descriptions and, blind to those, of 30 real
requests that do not name the command. `node scripts/killtest.mjs` (after `pnpm build`) then says
two things:

- **representable**: the share of reductions that use only core meanings (`seed/core.ncon`),
  structural concepts (`src/structural.ts`) and the glossary terms the file declares. Stop or
  redesign the seed under 70 percent.
- **convergence**: for each request, the documentation reductions ranked by the scored match
  (runtime.md section 6.2, `src/runtime/softmatch.ts`); top-1 accuracy against the documentation
  the request should reach. Stop under 60 percent.

The file lives at `~/.noodle/experiment/killtest.ncon` (private, never committed; it is built from
real requests) unless another path is given.

An agent's unreviewed draft of the file is at `~/.noodle/experiment/killtest-draft.ncon`, with a
checklist for Keal in `docs/killtest-review.md`. `pnpm killtest -- --draft` runs against it and
labels every number as an unreviewed draft; those numbers are not the kill test.

## Format

An `.ncon` file. Each reduction is a concept with a `Reduction(...)` fact; a request also says
which documentation it should reach with `Expects(...)`. Glossary terms (from `gitglossary(7)`)
that documentation reductions use are declared with `Glossary()`, and may say what kind they are
with `IsA(...)` so the match can measure kind distance.

```
Pack(name="killtest", version="1", from=Keal())

// Glossary terms a documentation reduction may use.
Concept(Remote(), Glossary(), IsA(Place()))
Concept(Commit(), Glossary(), IsA(Change()))

// git-push: "Update remote refs along with associated objects"
Concept(GitPush(), Reduction(Cause(result=Become(Have(Remote(), Every(Commit()))))))

// Request 1712, written blind to the documentation reductions.
Concept(Request_1712(), Reduction(Cause(result=Become(Have(Remote(), Commit())))), Expects(GitPush()))
```

## Notes

- Write requests at the level of what is asked ("cause the remote to have the commits"), or with
  the wrapper the words have ("I want to see the changes" as `Want(experiencer=Speaker(),
  theme=See(...))`); the match lets either root align below the other, and what is above is counted
  as unexplained.
- Anything reached for and not found in the vocabulary is listed by the script, per reduction.
  Those lists are the finding; do not add to the seed on the spot (seed/README.md, question 2).
- The scored match's coefficients are fixed for now (pattern covered minus request unexplained);
  the threshold and the weights of its features are to be set on the development set, then frozen.

## Result, 2026-10-02 (runtime 0.30.0, everything imported)

`node scripts/killtest.mjs` after `pnpm build`, against the stop lines of PLAN.md phase 4 (design
section 29, stage 0). Development data only.

| Stop line | Measured | Verdict |
|---|---|---|
| 50% of the 30 automatic description reductions equal Keal's hand-written targets | not measurable: the targets do not exist yet (`~/.noodle/experiment/killtest.ncon` is missing) | open |
| 70% sense precision on 50 bottomed-out senses | not graded by Keal. The builder's own grading (docs/stage0.md) was 38% strict, 70% right or partial | open; the provisional number is under the line |
| 60% of in-domain development prompts with a full or near-full parse | **50.2%** (160/319 heard); 45.5% (160/352) counting the 33 prompts over 60 tokens as failing | **under the line** |

The parse line, in detail. In-domain is every development prompt Keal labelled `acts` or
`constraint` (352; heartbeats and the holdout excluded). A full parse is one edge per segment with
nothing skipped: 87 of 319 (27.3%). A near-full parse has at least 70 percent of its content words
(word tokens that are not in the seed's function-word lexicon) inside the widest edge of each
segment's best cover. Counting words inside any edge of the cover instead gives 99.7%, which only
says that almost every word is read as something; it is not a parse, so it is not the number used.

What this says, honestly: by the design's own stage 0 line, the project is at a stop on parse
coverage today, and the other two lines cannot be judged until Keal's targets and grades exist. The
earlier representability and convergence test (phase 1) has also not been run, for the same reason.
Per PLAN.md, a failed checkpoint is a finding to report and decide on, not a number to tune toward;
nothing was changed to move it.
