# TODO

- **Implied lemmas.** A word concept's name implies its lemma (`Moment` is "moment"), so the store
  derives it at load and an explicit `Lemma` is kept only where the name cannot give it: dashes,
  accents, apostrophes, renamed collisions (`Read_2`), and forms that differ from the name. Only
  for concepts that are words (they have a category or a part of speech), never structural names.
  Cuts the WordNet pack and the seed.
- **Concepts by folder.** Seed laid out one folder per concept (its lexicon entry, readings and
  realizations together), each item tagged with its seed part, collected into the part packs by a
  build step; seed counting and the protected-base check read the tag instead of the file.
- **Realizations compose, the rest of the way** (tasks/lessons.md, "Realizations compose"). Done
  for Run: Run says itself as "run `x`", Ran (what it gave) says itself, the Outcome says its
  result through Either(result, fallback), and the Offer, Echo, BlockedBy and Outcome patterns
  that reached into Run are gone. Still nested: Outcome(Read(..), result=File/Have/Be/Page),
  Outcome(Question(..), result=Found/At), Outcome(Store/Remove/Schedule ..). Each result should
  say itself; what is missing is a printer head for a sentence (capitalize a clause and end it
  with a period, unless it is a block), so a result that says itself as a clause can be put in a
  sentence by its wrapper. A child that needs block layout inside a paragraph (a code block) is
  the printer's to split, not a pattern's.
- **Benchmark against published models** (after the plan is built). GSM8K first (exact numbers,
  scores published from small Qwens to frontier models), then BFCL (tool definitions imported the
  way man pages are), then SimpleQA. Keal's method: run once with learning on (Noodle researches
  live, which is its training, done in real time), then again with learning off but the learned
  graph kept; track speed in both runs. No pre-loading a corpus: it is built to figure things out
  live, knowing just enough to solve the problem and say so.
- **Teaching procedures together** (next, after CLI learning lands). Keal: "when I say kill 8080,
  find what's running on port 8080 and kill it". (1) Taught phrases with slots ("kill <port>"),
  echoed and confirmed. (2) Taught steps that chain: one step's output (a pid) is the next step's
  input. (3) Asking when a step has no known command ("How do I find the process on a port?"),
  keeping the answer as a learned command for that step, reusable anywhere; or learning the step
  from a man page. Everything from=User, trust 1; acts that change things are still offered until
  granted.
