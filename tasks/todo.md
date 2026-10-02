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
