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

Status: design done, specs next. No runtime yet.
