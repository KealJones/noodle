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
