# Built-in concepts

Status: reviewed at checkpoint 0, 2026-10-01 (PLAN.md phase 0, item 5). Design sections 6, 10, 20
and 28 are the source. This spec lists everything that is built in (the primitives, the seed's eight
parts, the structural concepts the runtime names), how to add one, and the test for whether
something belongs here.

## 1. The test

Before anything becomes built in, ask: **would it be the same for chess, a jam website and the
user's name?** If not, it is knowledge, and it is learned, imported or derived, never written
(AGENTS.md rule 4).

- `Before`, `Cause`, `Not`, `Store`: the same everywhere. Candidates.
- `Remote`, `Commit`, `Branch`: git's. Learned from `gitglossary(7)` and the man pages.
- `Recipe`, `Checkmate`: a domain's. Learned.
- "the" takes a noun on its right: the same for every topic, and English. Seed (function-word
  lexicon), not runtime: English lives in the seed, never in code.
- Squeezing repeated letters: the same for every topic and every alphabetic language. Runtime
  mechanism (design section 8).

Where a thing passes the test, a second question decides **where**: runtime code only if it is
mechanism about no word (a combining step, a feature template, a primitive, the shape
interpreter); otherwise the seed, as data on its word.

## 2. The primitives

The only code that touches the world (runtime spec, section 9). Pure primitives only read; Suppose
may run them.

| Primitive | Pure | Effect classes | Check | Inverse | Experiment |
|---|---|---|---|---|---|
| `Store(holder, item)` | no | ChangesLocal | holder contains item | Remove | later |
| `Remove(holder, item)` | no | Deletes | holder does not contain item | Store (if the item was kept) | later |
| `Contains(holder, item)` | yes | none | none | none | later |
| `Set(thing, property, value)` | no | ChangesLocal | property has value | Set to old value | later |
| `Remember(item)` | no | ChangesGraph | the fact or reading is in the store | Retract | **yes**: a fact, or a rewrite the user taught (`Rewrite(from, to)`), confirmed first |
| `Compare(a, b, by)` | yes | none | none | none | later |
| `Count(set)` | yes | none | none | none | yes |
| `Rank(set, by)`, `Sort(set, by)`, `Filter(set, where)` | yes | none | none | none | yes |
| `Arithmetic(op, args)` | yes | none | none | none | later |
| `Now()` | yes | none | none | none | yes |
| `Read(source)` | yes | none (Reads) | a block or structure came back | none | **yes** |
| `Write(target, content)` | no | ChangesLocal, or Deletes if it replaces content not saved elsewhere | the target has the content | restore the old block | **yes** |
| `Edit(target, change)` | no | ChangesLocal | the target has the change | reverse the change | **yes** |
| `Run(program, args)` | no | from the program's learned effects; Unknown if none | exit status and expected output | where the program's documentation gives one | **yes** |
| `Schedule(when, act)` | no | ChangesLocal | the schedule holds it | cancel | later |
| `Say(expr)` | no | Speaks | none | none | **yes** |
| `Ask(question)` | no | Speaks | none | none | **yes** |
| `Suppose(expr)` | yes | none (captures others) | none | none | **yes** |
| `Sequence(steps...)` | as its steps | as its steps | each step's | each step's, in reverse | **yes** |

- **Know** is not a primitive that readings call directly (design section 10); it is the runtime's
  one door to outside knowledge (runtime spec, section 14), and its source adapters declare
  `SendsOutside`.
- **Operate** (driving a UI or a browser) is deferred.
- **Read** covers files, git's porcelain and plumbing output, pages and images, into blocks and,
  where a real parser exists (tree-sitter for code, git's machine formats), into structure.
- **Run** takes a program and an argument array; it never builds a shell string (design section 26b).
  In the experiment it runs only inside a fixture's sandbox repository with a local bare remote.
- Git verbs, Teach, Watch, Speak, Revert, Constrain and Delegate are readings over these, never
  primitives.

## 3. The seed

Hand-written, counted, reviewed by Keal, frozen before the experiment (design section 6). Each part
is one file in `seed/`, with a `Pack` header naming the part. **An entry** is one top-level form
(one `Concept`, `Fact` or `Reading`); the count per part is the number of top-level forms, and the
counts are printed by `pnpm seed:count` and published with the freeze.

| Part | File | What | Estimate |
|---|---|---|---|
| 1. Core meanings | `seed/core.ncon` | the closed list of meanings everything bottoms out in, in the style of semantic primes and VerbNet predicates (someone, something, do, happen, have, be in, part of, cause, before, after, more, not, can, want, know, say, become, exist...), and the document heads both hearing and speaking use (design section 25b). Each passes the test in section 1 | ~300 |
| 2. Function-word lexicon | `seed/function-words.ncon` | closed-class words: their forms, categories, Takes, Modifies, Joins, FillsGap facts, and the readings that build the LF (section 4.4). Correction signals, tone words, aside markers, order words, clause openers | ~400 |
| 3. The bridge | `seed/bridge.ncon` | patterns of core meanings (and VerbNet frames) to primitives: `Cause(Become(Contains($h, $x)))` to Store, `Cause(Not(Exist($x)))` to Remove, and the one general entry that a reading learned from a tool's documentation page becomes `Run` of that page's command. Names no domain command | ~50 |
| 4. Lexical rules | `seed/lexical-rules.ncon` | the passive, questions, imperatives, fronting; the part-of-speech-to-category mapping for imported words | ~30 |
| 5. Initial weights | `seed/weights.ncon` | the starting weight of every feature: sense frequency, words used, wanted kind, shape fit, `ReachedAct` and `Unworked` at 1; the rest 0 | ~10 |
| 6. Default policies | `seed/policies.ncon` | standing rules at seed level: keep going until done, verify before claiming done, stop means no further steps (and the rest of design section 17's lessons that act as defaults) | ~20 |
| 7. Genre shapes | `seed/genres.ncon` | loose outlines for writing: summary of a change (a commit message is one), a plan, a letter | ~10 |
| 8. English realizations | `seed/realizations.ncon` | Speaking readings for what the assistant says: an honest "I don't know" per reason stuck, an offer before a guarded act, the echo of a heard rule, a result; and the media realizations that print a document as markdown or plain text (design section 25b) | ~60, plus ~20 for markdown and ~10 for plain text |

- **No hard cap**; every part is counted, and a part that needs far more than its estimate is a
  finding, reported (design section 6).
- **The core meanings are a closed list**, published before stage 0. A reduction that needs a word
  outside it does not reduce.
- **Frozen**: during the experiment nothing is added to the seed by hand (AGENTS.md rule 2). Every
  change to the seed during week 1 and stage 0 is logged in `seed/CHANGES.md` with its reason and
  counted.
- **Protected**: the function-word lexicon and the LF's meaning are in the protected base; no learned
  reading rewrites them (design section 20). The whole seed is outside what learning writes.
- **Written from the design, never from the test data**: seed entries are not tuned to corpus items
  (AGENTS.md rule 4). The seed's author has seen the corpus; that contamination is stated in the
  results (design section 26).

## 4. Structural concepts

The concepts the runtime's code refers to by name. Nothing else is named in runtime code. They are
listed in `src/structural.ts`, each with the reason it is structural; a test fails if runtime code
names any concept not in that list (`testing.md`, section 2). This is more than a handful; the count
is reported, and each group below says why it cannot be data on a word.

### 4.1 The data model

`Concept`, `Fact`, `Reading`, `Block`, `Pack`, `Retract`; the fact heads the store and matcher
interpret: `Lemma`, `Form`, `Sense`, `SenseOf`, `PartOfSpeech`, `Sounds`, `IsA`, `SameAs`,
`Said`; statuses `Active`, `Proposed`, `Pending`, `Retracted`; reading parts `Expand`, `Collapse`,
`All`; modes `Speaking`, `Supposing`, `Doing`.

Why structural: they are the shape of the data (`ncon.md`). The runtime cannot store or match
without them.

### 4.2 The chart's vocabulary and its categories

Fact heads: `Category`, `Takes`, `Modifies`, `Joins`, `FillsGap`, `Tone`, `OpensClause`,
`EndsClause`, `SetsAside`, `KeyNeighbours`, `HasShape`, `Corrects`, `Aside`; sides `Left`, `Right`;
the role `Modifier`; `Wraps` (an entry's wrapper), `Gap` (the gap filler), `WithRoles` (roles
filled on an expression whose head is not known), `Indent`; the form features `Plural`, `Past`,
`Present`, `PastParticiple`, `Gerund`, `ThirdSingular`.

Categories (a closed list; the chart's hard constraint):

| Category | Is roughly | Example |
|---|---|---|
| `Noun` | a bare noun (CCG N) | "list", "shopping list" |
| `Thing` | a noun phrase (NP) | "the plan", "it", "docs/design.md" |
| `Act` | a predicate still missing its subject (S\NP) | "push the branch" |
| `Clause` | a sentence (S) | "it is broken" |
| `Relation` | a prepositional phrase (PP) | "to my list" |
| `Property` | an adjective phrase | "broken", "already set up" |
| `Manner` | an adverbial | "yet", "quickly" |
| `Mark` | a mark that only closes or pairs | `)`, the closing `*` |

Why structural: the six steps compare categories by identity. Which word has which category is data;
the list itself is what the steps range over.

### 4.3 Shapes

`Digits`, `Letter`, `Digit`, `Lower`, `Upper`, `Space`, `Any`, `Literal`, `Seq`, `OneOf`,
`Repeat`. Why structural: the shape interpreter reads them (runtime spec, section 3.4).

### 4.4 The logical form

LF argument kinds `Prop`, `Act`, `Thing`, `Time`, `Kind`, `Rule`, and `Frame` (what a core meaning
takes, read by the kind check). Speech acts `Question`, `Assert`, `Directive`, `Advice`, `Constraint`; operators `Not`, `Only`,
`Every`, `Some`, `If`, `And`, `Or`, `Then`, `Quote`, `Mention`, `Permit`; scope `Hole`, `Label`,
`Outscopes`; referents `Ref`; time `Now`, `Past`, `Future`, `At`, `Since`, `Until`, `During`,
`Before`, `After`, `Told`, `LastChange`; `Written` (canonical free text). Participants `Speaker`
and `Addressee` (bound per turn to the user and the assistant, so "should" and "I" can be read by
the seed without the runtime knowing who "I" is).

Why structural: evaluation has one rule per speech act, and rule checking reads `Not` and `Only`
(`logical-form.md`). They are in the protected base.

### 4.5 Wants, features, effects

- Want heads the runtime computes: `IsA` (kind distance), `HasShape`, `Near` (neighbour), `Doable`
  (the expression has a reading that reaches an act in Suppose).
- Feature templates: the names in runtime spec sections 8.1 and 8.2.
- Focus's sources, as `FocusSource` keys: `CurrentConversation`, `PastConversation`, `UserFacts`,
  `Workspace`, `World` (runtime spec, section 11b).
- Effect classes: guarded `Deletes`, `OverwritesHistory`, `Publishes`, `SendsOutside`, `Spends`,
  `UnknownEffects`; unguarded `ChangesLocal`, `ChangesGraph`, `Speaks`, `Reads`. The guards (which
  classes are guarded) are in the protected base.

### 4.6 Sources, trust and the conversation

`Source`, `TrustLevel`, `Seed`, `Derived`, `Correction`, `Config`, `User`, `Self`; `Conversation`,
`Turn`, `Event`, `InPlay`, `StandingRule`, `Proposal`, `Grant`. Why structural: the trust rules and
the conversation structure are runtime mechanism over them (runtime spec, sections 11 to 13).

### 4.7 The primitives

The names in section 2.

### 4.8 Saying and printing

The reasons an expression is unworked (`NoSense`, `NoReading`, `NeedUnmet`, `NoSource`,
`NoPermission`, `TooClose`, `BlockedBy`, `Unworked`), what Say is handed to realize (`Offer`,
`Echo`, `Outcome`, `Reply`), and the printing step (`Print`, `Medium`, `Printed`, `Escaped`,
`Escapes`, `Fenced`, `Repeated`, `Uppercase`, `Capitalized`). Why structural: the runtime records
the reasons and calls Say with them; the realizations that word them are seed readings (part 8).

The full list, with each group's reason, is `src/structural.ts`.

## 5. How to add a built-in

1. **Run the test** (section 1). If it fails, it is learned: stop.
2. **Decide where**: seed (data on a word or a core meaning) or runtime (mechanism about no word).
   Almost always seed. A new primitive, a new category, a new feature template, a new speech act or
   operator, or a new data-model head is a design change (AGENTS.md rule 12): write it in
   `docs/design.md` first, and ask Keal.
3. **Seed entries**: add the form to its part's file with a source (`from=Seed("part")`), log it in
   `seed/CHANGES.md` if the seed is past its first review, and recount.
4. **Structural concepts**: add the name to `src/structural.ts` with its reason and group; the lint
   test (section 4) then allows runtime code to name it.
5. **Primitives**: a module with its declaration (runtime spec, section 9), unit tests for its check
   and inverse, and a row in section 2.
6. **Runtime changes** bump the runtime version, and the commit message says the new version.

## Open questions

1. **The category list.** Seven categories is a guess from CCG's basic types. Missing ones will show
   up when the function-word lexicon is drafted (determiners are Things that take a Noun; auxiliaries
   are Acts that take an Act). Settle the list with the seed draft.
2. **Is `Write` of unsaved content `Deletes`?** Overwriting a file loses what was there if it is not
   committed or saved elsewhere. This spec classes it as `Deletes` in that case. The design's list
   of guarded classes does not mention it.
3. **`Doable` as a want.** Computing it needs a Suppose, which is stage two. In the chart it can only
   be estimated (the expression's head has an acting reading at all). Confirm that estimate for
   stage one and the real check for stage two.
4. **Structural count.** About 130 names, not "a handful". Most are the LF's and the data model's
   heads, which the design already fixes. Is that acceptable, or should some (the time heads) move
   to the seed as ordinary concepts that only seed readings use?

## Decided

Keal (2026-10-01):

- **Categories (1):** deferred to the seed draft. Nothing in the parser or runtime treats the list as closed.
  The seed draft (0.1.0) proposes the seven plus `Mark` (`seed/README.md`, decision 3).
- **Structural count (4):** about 130 names accepted, time heads stay structural. The design's "a
  handful" is to be reworded to the real count.
