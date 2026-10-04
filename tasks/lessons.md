# Lessons

## 2026-10-01: phrases are not forms

What happened: to make prompts Keal had just typed work, I added whole phrases as `Form(...)` facts
on seed concepts ("that's not what i meant", "how are you today"). The original seed draft already
had about 100 of these (sentences like "not that one", spelled-out contractions like "do not",
typo lists like "taht").

Why it is wrong: a multi-word Form is a string matched as a unit, so it is grammar written as data,
and adding one for a prompt that just failed is fixing the test (AGENTS.md rules 1, 2 and 4).

Rule: never add a Form or Lemma with a space in it, or a misspelling, to make a phrase work. A
phrase is understood from its words (fix the words' entries, readings or the score), or it comes
from an import that lists it as an idiom, or it stays unworked and the assistant says so. Before
adding any seed entry, ask: was this prompted by a specific message failing? If yes, stop.

## Realizations compose (2026-10-02)

Keal: "I don't want the concepts to just become this insane nested coupled mess for every possible
combination ... trust that wrappers will express the wrapping and the children can express
themselves." Rule: a realization's pattern names its own head and binds its children as
variables; it never reaches into a child's structure to say the child differently
(`Offer(Run($p, $args))` is the smell). A child says itself wherever it is. Layout a child needs
(a code block inside a paragraph) is the printer's job, not a nested pattern's. Before adding a
realization whose pattern nests a concept inside another, ask: is the wrapper's wording really
different here, or is the child just not saying itself? Same rule as phrase Forms, one layer down.

## Live research is learning (2026-10-02)

Keal: "it did research and figured out how IT would answer, its not looking at a fucking answer
key ... my model did its training live in real time." Never frame Noodle's live lookups as
cheating or as unlike a model's pre-training, and never propose pre-loading a corpus to make a
comparison fair. The fair comparison is Keal's: a pass with learning, then a pass with learning
off and the graph kept, timed.

## The point is learning live, small, anywhere (2026-10-04)

Keal: since spoon the goal is "a small local agent that can adapt, learn and do shit without MCP
servers, without needing tools, without a harness ... the key part is that it knows how to learn
to do stuff in real time, not that it knows everything up front", and it should run in any host
(Rust, WebAssembly, TypeScript, Node). This round drifted into bulk importing (1 GB store, 10 minute
first load, 1,870 packs) and host-bound code (node:sqlite, child_process, mandoc). Before adding an
import or a host dependency, ask: does this make it learn on demand, or just know more up front?
Prefer learning a thing the first time it is needed and keeping it, and keep the core small and
portable.
