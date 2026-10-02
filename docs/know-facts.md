# Know understands what it fetched (2026-10-02)

Measured on this machine with the store at `~/.noodle/store.db` (WordNet 2025, VerbNet 3.4, the
Wiktionary forms, the git and gh man pages, the definitions pack), each run on a copy of it.
Development data; nothing here decides go. How it works is in `docs/design.md` section 21
("Understanding what came back, as built"); the code is `src/runtime/know/learn.ts`.

## What it gets: 30 pages

`node scripts/know-facts.mjs < topics` over 30 topics chosen before the run (Hamlet, France,
Mitochondrion, Mount Everest, Berlin Wall, Albert Einstein, Photosynthesis, Python (programming
language), Amazon River, Tokyo, The Beatles, Jupiter, Penicillin, Leonardo da Vinci, Chess,
Volcano, Moby-Dick, Great Wall of China, Oxygen, Bicycle, Pizza, Brazil, Marie Curie, Saturn,
Honey bee, Linux, Wolfgang Amadeus Mozart, Pacific Ocean, Eiffel Tower, William Shakespeare):
Wikipedia's page, its opening sentence heard into facts, and the Wikidata entity's claims (entity,
quantity and time values only) kept as facts.

| | Count |
|---|---|
| pages | 30 |
| facts from opening sentences | 18, on 12 of the 30 pages (ties kept: some say one thing two ways) |
| pieces of openings heard that said nothing of the subject (dropped) | 366 |
| claims fetched | 1,037 |
| claims kept as facts | 677 (65%) |
| claims dropped: the label was not heard as one phrase | 360 |
| time to understand all 30 (hearing and storing, fetching aside) | 13.5 s |

The opening sentence is where the chart is weakest. Openings that start with the title and say
"is a" a kind come through (`Be(Oxygen#Topic(), Some(ChemicalElement()))`). Most do not: the
subject is a longer name than the title ("The Tragedy of Hamlet, Prince of Denmark, ..."), an
appositive sits between subject and verb ("France, officially the French Republic, is ..."), or
the sentence is not heard as one clause at all. No IsA facts are made: the seed reads "X is a Y"
as `Be(X, Some(Y))`, and turning that into `IsA` would be a reading the frozen seed does not have
(writing it in code would be grammar in the runtime). Wikidata's "instance of" is heard as
`Instance(theme=Of(...))`, for the same reason.

## How many are right: graded samples

Graded by hand: a fact is right when its structure says what the source said (the label, or the
sentence) and asserts nothing false; stray pieces that change nothing are tolerated.

**All 18 opening facts: 11 right (61%).** Right: mitochondrion an organelle; photosynthesis a
system of biological processes (two of three readings); Jupiter the fifth planet from the Sun;
Saturn the sixth; penicillin an antibiotic; chess a board game for two; oxygen a chemical
element; pizza an Italian dish; the honey bee a flying insect (one of two); Linux a family of free
and open-source software (one of three). Wrong: "every biological process"; the Beatles "a form"
of English rock band with Liverpool as a time (twice); "genu" for genus; two Linux readings with
"an" heard as a word; the Pacific "the five oceanic division" ("largest and deepest" lost).

**30 claims, every 22nd of the 677: 21 right (70%).** Right, for example: `Author(Hamlet, "William
Shakespeare")`, `Age(France, "18 years old", modifier=Marriageable())`, `Have(Jupiter, "planetary
surface", Part(), modifier=Not())` (from "does not have part"), `Place(Mozart, "St. Marx Cemetery",
theme=Burial())`, `Moment(Oxygen, "1774", theme=Or(Discovery(), Invention()))`. Wrong: the head
taken from the wrong word ("total fertility rate" as a Total, "work location" as Work, "BTI Status
Index" as Status), "has" heard as the abbreviation HA ("has characteristic", "topic has
template"), and "at" read as a concept of its own ("archives at", "educated at", twice), "related
category".

## Asked twice: learning, then the graph alone

`node scripts/know-pass.mjs` runs prompts through one session. Pass 1 on a fresh copy of the
store, Know online (it fetches, learns, answers); pass 2 in a new session on a copy of what pass 1
left, with `know: "offline"` (Know never goes out). Times include hearing and evaluation.

| prompt | pass 1 (online, learning) | pass 2 (offline) |
|---|---|---|
| who wrote hamlet | "William Shakespeare", from Wikidata, 2.70 s | the same, from the graph, 0.16 s |
| what is the capital of france | the "List of capitals of France" page, 6.69 s | "Paris", from Wikidata, 0.10 s |
| what is a mitochondria | "Mitochondria is organelle", from the opening, 0.77 s | the same, 0.04 s |
| when did the berlin wall fall | the "Fall of the Berlin Wall" page, 4.33 s | the same page, kept, 0.72 s |
| how tall is mount everest | not worked out, 0.08 s | not worked out, 0.10 s |

Store open: 0.93 s, then 0.23 s. Pass 1 answers "who wrote hamlet" from the claim learned a
moment earlier: "wrote" reaches the claim `Author(...)` because a verb sense of "author" is a kind
of a sense of "write" in WordNet (compose, create verbally). "The capital of france" is answered
from the graph only on pass 2: on pass 1 "france" is heard as a misspelling of "fiance", since the
store has no word "france"; learning the France page gives the topic that word, so the next
session hears it.

Eight more prompts after the five, the same two passes (pass 1 online, pass 2 offline): "who is
the author of hamlet" (William Shakespeare, both passes, 0.06 s), "what is the population of
france" (68605616, both), "what is the capital of germany" (the "Capital of Germany" page, 5.26 s,
then "Berlin" from Wikidata, 0.07 s), "what is france" and "what is hamlet" (the topic's page, as
kept, both). Near-misses that must not be answered from a claim are not: "what did hamlet write"
and "who wrote the berlin wall" get pages (the second a page about the wall, which says who built
it), "what is the currency of france" is not worked out (the question is not heard as one).

## Beside Napkin

`pnpm versus:noodle` (94 prompts, Napkin's replies reused), before and after, on the same base:

| Noodle | RIGHT | HONEST | WRONG | ERROR |
|---|---|---|---|---|
| before | 37 | 47 | 10 | 0 |
| after | 38 | 45 | 11 | 0 |

Changed: "what's the boiling point of water in celsius" went from stuck to "99.98 degree Celsius"
(Wikidata, learned while asking: the claim's own qualifier "boiling" is a word of the question);
"what is the capital of japan" is now answered "Tokyo" from Wikidata (it was right before, from a
page). "how many days until christmas" went from stuck to a page about the carol, from Know's page
search, a path this change does not touch; main at 0.31.0 gives the same page now, so it is the
search's answer that changed.

## What still fails

- **The Berlin Wall.** Wikidata has the date, under "dissolved, abolished or demolished date",
  heard as `Demolish(...)`; nothing in the graph says falling is being demolished, so the page is
  the answer.
- **Mount Everest.** "how tall is mount everest" is not heard as a question about a thing (the
  chart reads "mount" as an act and "everest" as a name to store), so Know is never asked. The
  claim it would need ("elevation above sea level") does not relate to "tall" in the graph either.
- **Openings** give a fact on 12 of 30 pages, 61% right.
- **Realizations.** Facts are said by the seed's realizations, which have no article and no way
  to say a noun with modifiers: "Mitochondria is organelle"; a fact the realizations would say
  only in part ("photosynthesis is" a system of biological processes) is kept and not said, and
  the page is said instead.
- **Wiktionary definitions** are kept as before and not understood: no question reaches Know's
  dictionary. A search snippet that answers a question is learned like a page (its title as the
  topic), but none in the runs above was.
- **Role direction is not checked.** A claim answers a question by its relation's word, not by
  which side of it the gap is on.
