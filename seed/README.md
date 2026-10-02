# The seed

Draft 0.1.0, for Keal's review (PLAN.md phase 1). Hand-written, counted, and frozen before the
experiment (design section 6; `docs/specs/built-ins.md` section 3). One file per part. `pnpm
seed:count` prints the counts and fails if a check fails (`src/seed/check.ts`): every entry is
sourced from its part, every name used is declared in the seed or structural (`src/structural.ts`),
and the bridge names no domain command.

## Counts

| Part | File | Entries | Estimate |
|---|---|---|---|
| 1. Core meanings | `core.ncon` | 141 | ~300 |
| 2. Function-word lexicon | `function-words.ncon` | 529 | ~400 |
| 3. The bridge | `bridge.ncon` | 75 | ~50 |
| 4. Lexical rules | `lexical-rules.ncon` | 33 | ~30 |
| 5. Initial weights | `weights.ncon` | 17 | ~10 |
| 6. Default policies | `policies.ncon` | 13 | ~20 |
| 7. Genre shapes | `genres.ncon` | 13 | ~10 |
| 8. English realizations | `realizations.ncon` | 107 | ~90 |
| Total | | 928 | ~1,000 |

These are the counts after building the first runtime against the draft (the draft committed at
859); every change since is in the git history. The bridge grew by VerbNet's predicates (design
section 6 names them as part of the bridge) and two domain-general entries; the lexicon by
contractions of "is" and readings found missing by running it; the realizations by outcomes of
commands and declines.

Findings against the estimates (design section 6: a part far from its estimate is reported):

- **Core meanings are about half the estimate.** The list is the semantic primes and VerbNet's
  general predicates, minus what is already structural (the LF's operators and time heads, the
  primitives, Speaker and Addressee) and with no composite meanings (give, fix, delete): those
  are learned from definitions, and adding them here would be hand-writing knowledge. The kill
  test is what says whether 141 is enough.
- **The function-word lexicon is about a third over.** Most of the excess is messy spellings and
  contractions as forms (Keal's "dont", "cna", "taht"), tone words, and markdown marks; the closed
  classes themselves are about the size expected. An entry is one top-level form, so a word with
  many forms is still one entry.
- **Weights** are 17 because every template is written out, including the zeros, so the frozen set
  is explicit.

## Decisions this draft proposes

Each changes or fills in a spec; the specs are updated to match.

1. **A core meaning is the concept of its English exponent.** `Want` is both the core meaning and
   the word "want" (its `Lemma` fact says so), the way the specs already treat `The`, `And`, `Not`
   and `Can`. A core meaning whose exponent is a phrase or is ambiguous gets a name of its own and
   the exponent as a lemma (`BeIn` "be in", `Excess` "too"). Lookup is by lemma, so a token finds
   every concept with that lemma as a candidate. The word's other senses are senses
   (`Break#Damage`). Risk: an unresolved word whose name is a core meaning looks reduced; the
   reduction check must count a word as core only where no reading wanted another sense of it.
   `Break` (a line break) became `LineBreak` so the verb "break" does not collide (design 25b).
2. **Chart entries are grouped.** A word with two behaviours needs two entries ("that" is a
   determiner, a pronoun, a complementizer and a relative), so `Category(C(), Takes(...),
   Modifies(...), FillsGap(...))` is one entry, with its Takes nested. `Joins(...)` is an entry of
   its own. The flat `Category` plus separate `Takes` facts of `ncon.md` section 5 could not say
   which Takes went with which category.
3. **The categories** (built-ins.md open question 1): the seven, plus `Mark` for marks that only
   close or pair (`)`, the closing `*`). Determiners are Things that take a Noun, auxiliaries are
   Acts that take an Act, "if" is a Clause that takes two, as built-ins.md guessed.
   `category=Any()` in a Takes or Joins takes any category; `Category(Any())` yields the category
   of its first argument (paired marks and parentheses, which wrap whatever they enclose).
4. **`wraps=`** on an entry wraps what it built in a head: an inverted auxiliary wraps
   `Interrogative`, `?` wraps `Interrogative`, `**` wraps `Important`. This is how mood and stress
   get into the heard expression without a rule in the runtime.
5. **Moods, then speech acts.** Lexical rules on the category concepts give every clause the
   moods it could have (`Declarative`, `Imperative`, `Interrogative`); readings on the moods give
   the speech acts, and readings on words like "should", "can you", "please", "let's" and "I want"
   turn them into the act they usually are. The score picks among them.
6. **Lexical rules are readings on a category, a form feature or a word**, with pattern and
   becomes wrapped in the edge's category (`Act($e)`), so a rule can change an edge's category.
   The `Rule(...)` fact head of `ncon.md` section 5 is dropped; `Rule` is only the LF argument kind.
   Predication (a Thing on the left of an Act is its agent) is an entry on the category `Act`.
7. **`WithRoles($e, role=x)`**: an expression with roles filled, when the head is not known
   ("it is broken" is `WithRoles(Broken(), theme=It)`; the passive puts the subject in `theme`).
   Patterns still never have a variable head.
8. **`Gap()`** is the gap filler in a heard expression; a wh-word's entry takes the clause with
   the gap, and its reading makes `Question(p, about=Gap())`.
9. **Form features** are structural: `Plural`, `Past`, `Present`, `PastParticiple`, `Gerund`,
   `ThirdSingular`. They trigger lexical rules and come from imports. (`ncon.md`'s example used
   `Participle` for "listing"; it is `Gerund`.)
10. **`Corrects()` and `Aside()`** are new fact heads: the runtime binds a correction signal to a
    choice point (runtime.md 15) and keeps asides on the turn (design 14), so it has to read them.
11. **`Frame(...)`** on a core meaning says what it takes and of what LF kind; the LF kind check
    reads it. Values are the LF kinds (`Prop`, `Act`, `Thing`, `Time`, `Kind`), which are now
    listed as structural.
12. **Standing rules carry variables.** A policy is a `Constraint` with `_` and pattern variables in
    it, stored as a fact on a policy concept; `ncon.md` said claims have no variables. Rule claims
    are now the exception.
13. **Stuck reasons and what Say is handed** are structural: `NoSense`, `NoReading`, `NeedUnmet`,
    `NoSource`, `NoPermission`, `TooClose`, `BlockedBy`, `Unworked`; `Offer`, `Echo`, `Outcome`,
    `Reply`. Realizations are Speaking readings on them.
14. **Printing**: `Print(doc, medium=M)` is the last step of Say; `Printed(...)` joins text,
    `Escaped(s)` escapes the medium's `Escapes(...)` marks, `Fenced(s, mark=)` fences code with a
    run longer than any inside it. The marks to escape are facts on `Markdown`, not code.
15. **Documentation pages** reach the bridge through `Describes(program, what)`,
    `Usage(program, args)` and `EffectsOf(program)`, which the documentation reader writes. They are
    declared in the bridge; when phase 4 builds that reader they become structural.

## Left out, on purpose

- **Paths, versions and issue references** (`#123`) as shapes: they are the domain's (files, git
  hosting), so they are learned or come from the workspace (Focus's surroundings candidates), not
  written here. URLs, e-mail addresses, numbers, dates, times, handles, colors and code-style
  names are shapes, because they are the same for chess, a jam website and the user's name.
- **Months and weekdays**: not needed by the experiment, and an import supplies them.
- **Composite meanings** (give, send, fix, break, delete, create): learned from definitions.
- **Pasted transcripts and tool wrappers** as set-aside shapes: their shapes come from the
  fixtures, which this draft has not been written from.

## Open questions for review

1. Decision 1 (core meaning = exponent concept) against the alternative of separate concepts with
   `Sense` links. The alternative keeps words and meanings apart but makes every reduction harder
   to read (`Cause#Core(...)`).
2. Is 141 core meanings enough? The kill test answers it; anything Keal reaches for and does not
   find while writing the 60 reductions should be listed, not added on the spot.
3. Should composite VerbNet predicates (transfer, has_possession) be core, so imported frames
   meet the bridge directly, or stay derived from Cause, Become and Have as here?
4. The policies are the weakest part: several (stay in scope, act on what was named) are
   checkable only loosely in the LF. Keep them as written, or move the ones that are really
   runtime behaviour (keep going, verify before done) out of the seed and into the runtime spec?
5. The function-word lexicon has 505 entries before the labelling data has been looked at for
   coverage. Its misspellings and contractions are the author's guesses at common ones, written
   without looking at the corpus; how many the corpus actually needs is measured, not assumed.

## Writing it

Written from the design and the specs, not from the test data (AGENTS.md rule 4). The author has
seen the corpus, and that is stated with the results (design section 26). Changes after the first
review are logged in `CHANGES.md` with their reason and counted.
