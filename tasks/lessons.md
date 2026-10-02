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
