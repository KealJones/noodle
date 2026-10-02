# Stage 0: definitions understood (design section 6; PLAN.md phase 4)

Measured 2026-10-01 on this machine, with Open English WordNet 2025, VerbNet 3.4, the Wiktionary
forms and the git and gh man pages imported, and the seed as it stands plus the two entries in
`seed/CHANGES.md`. Development data only; nothing here decides go.

## What was built

- **The understander** (`src/know/definitions.ts`, `pnpm import definitions [count] [verb|all]`).
  A sense's definition (its `Said(Block)`) is heard by the same pipeline as a request: hearing,
  the chart, rewriting. A definition is said of something it does not name ("make visible" is said
  of what is shown), so its chart is built with open arguments (`ChartOptions.open`): an argument
  the definition leaves open is a `Gap()`, and becomes the variable `$x` the sense's object fills.
  Whole-span readings of the sense's category (Act for verbs, Property for adjectives, Noun or
  Thing for nouns) are kept, best first by the chart's score, each as heard and as rewriting
  reduces it (readings that act are not applied: a definition stops at core meanings). A
  definition that is a choice ("remove or make invisible") is each of its alternatives. Where the
  whole definition is not heard as one phrase, its head before the first comma is tried (WordNet's
  "cause to have, in the abstract sense").
- **Bottoming out** is computed level by level over everything the targets need, to depth 3: a
  definition is at level 0 when it is made of the seed alone (core meanings, function words,
  structural concepts); at level d when every other word in it resolves to a sense, among the
  word's two most frequent senses of the part of speech it was heard as, that bottomed out at a
  lower level. A cycle never grounds itself. A noun also grounds through its kinds (a WordNet
  hypernym is a sense of a word the seed has, such as "someone", "place", "part"); that is counted
  apart from reduction. A sense that does not bottom out is kept `Pending` with
  `NoReading(words it is stuck on)`.
- **The readings** go to `~/.noodle/packs/definitions.ncon` (loaded into `~/.noodle/store.db` like
  every pack), one `Expand` reading per object role the sense's words take:
  `Reading(on=Ingeminate#Tell(), pattern=Ingeminate#Tell(), becomes=Say(), from=Derived(WordNet("oewn-..."), Seed("core")))`.
  Only verb senses get readings: a noun or a property in a definition is a kind it names, checked
  to bottom out but not rewritten later, since a request's word heard as an act must not become
  what its noun sense means.
- **Wiring** (`src/runtime/rewrite.ts`, runtime.md section 7): a word's senses with readings are
  candidates for the word, the sense replacing it, scored by `SenseFrequency` (minus the sense's
  rank among the word's senses of its part of speech). Pending readings are not used. A word the
  seed gives meaning to is not expanded through its imported senses: that is where definitions
  bottom out, and without it "happen" is defined by "come to pass" and that by "happen", growing
  without end (it ran a turn out of memory before this rule).

## Coverage

The 5,000 most frequent words in wordfreq's English list (letters only); of those, the 1,184 that
the store has as words with a verb sense; their first (most frequent) verb sense. 8,039 senses were
heard in all (the targets and what they need), in 291 s, about 36 ms a definition.

| Measure | Value |
|---|---|
| first verb senses that bottom out through their definitions | **412 of 1,184 (34.8%)** |
| of those, made only of core meanings and verb senses that reduce (no noun grounded only by its kinds) | 98 (8.3%) |
| not heard as one whole phrase (Unparsed) | 190 (16.0%) |
| heard, but stuck on a word that does not bottom out | 582 (49.2%) |
| depth of those that bottomed out: 0 / 1 / 2 / 3 | 54 / 182 / 106 / 69 |
| all senses heard / bottomed out through definitions / nouns through kinds | 8,039 / 1,073 / 2,657 |

The "pure" 8.3% is the base case design section 6 calls "reduces to core meanings"; the 34.8%
lets a noun inside a definition stand as a kind once its kinds reach the seed.

### What the seed is missing (words most definitions are stuck on)

Counted over the 1,184 first verb senses, the words a stuck definition could not resolve:

| Word | Stuck definitions | Why |
|---|---|---|
| give | 24 | its definition "cause to have" leaves two arguments open; the chart opens one |
| provide | 22 | "give something useful or necessary to": through give |
| put | 21 | "put into a certain place": defined by itself |
| certain | 10 | an adjective with no definition that reduces |
| express | 8 | "articulate; either verbally or with a cry" |
| assign, raise, arrange, prepare, direct, deliver, utter | 5 or 6 each | |
| remove | 5 | "remove something concrete...": defined by itself, then a cycle |

None of these is a core meaning by the test of built-ins.md section 1 except, arguably, **give**
and **put** (transfer of having, and cause to be in), which VerbNet already relates to `transfer`
and `has_location`; they are listed here, not added. What is missing more than any meaning is
syntax: see the two entries below and "what fails".

### Seed entries added (seed/CHANGES.md)

| Entry | Count in WordNet verb definitions | Why no import gives it |
|---|---|---|
| "cause" takes something then "to" and an act; `Cause(patient=$p, result=$a)` is `Cause(result=WithRoles($a, agent=$p))` | "cause to" in 442 of 13,821 (361 start with it) | VerbNet has no "NP V NP to VP" frame for cause |
| "make" takes something then a property; `Make(patient=$p, result=$v)` is `Cause(result=Become(Be($p, $v)))` | "make" before an adjective-only word in 336 | VerbNet has no "NP V NP ADJP" frame for make |

Both pass the test: they are the same for chess, a jam website and the user's name.

## Precision

50 senses drawn at random (fixed seed) from the 412 first verb senses that bottomed out, graded
by hand (by the agent that built this, not by Keal: Keal's grading is PLAN.md task 5). **Right**:
says what the definition says, with the right senses for its words, roles allowed to be loose.
**Partial**: the head meaning is right but an argument or a word's sense is lost or wrong.
**Wrong**: the reduction does not mean the definition.

| Grade | Count |
|---|---|
| Right | 19 (38%) |
| Partial | 16 (32%) |
| Wrong | 15 (30%) |

Strict precision is **38%**, under PLAN.md phase 4's 70% stop line; right or partial is 70%.

Good reductions:

| Word | Definition | Reduction |
|---|---|---|
| joke | tell a joke | `Tell#Inform(theme=Some(Gag#Humor()))` |
| fence | enclose with a fence | `Enclose#Cover(instrument=Some(Fence#Barrier()))` |
| open | cause to open or to become open | `Cause(result=Or(Open(), Become(theme=Open()), agent=$x))` |
| shot | hit with a missile from a weapon | `Hit#Impel(instrument=Some(Missile#Projectile()), source=Some(Arm#Instrument()))` |
| ghost | move like a ghost | `Move(way=Like(Some(Ghost#Apparition())))` |
| register | record in writing | `Enter#Preserve(location=PieceOfWriting#BlackAndWhite())` |
| reiterate | to say | `Say()` |

Bad ones, and why:

| Word | Definition | Reduction | What went wrong |
|---|---|---|---|
| fill | make full | `Make(theme=Full#PhaseOfTheMoon())` | "full" heard as a noun (the full moon) at the same chart score as the adjective |
| kill | cause to die | `Cause(destination=Dice#Cube())` | "to die" heard as "to" a noun, "dice" |
| weekend | spend the weekend | `Drop#Pay(...)` | spend's first sense (money) |
| harm | cause or do harm to | `Cause()` | the alternative kept was the one that dropped everything |
| black | make or become black | `Make()` | the same: a bare alternative bottoms out trivially |
| perfect | make perfect or complete | `Complete#End(theme=$x)` | "complete" the verb, not the adjective |
| divorce | part | `Part()` | the core noun Part taken for the verb "part" (seed decision 1's stated risk) |
| attend | be present at | `Be(theme=Nowadays#Time(), ...)` | "present" the time |
| add (inside many) | | `Add#Say` | add's first two verb senses include "state or say further" |

The errors are mostly the chart's: a word that is both a noun and a verb or adjective ties, and
the tie goes to the noun; and the choice between alternatives prefers the one that bottoms out
first, which rewards saying less (`Make()`). Both are score problems (a feature for the part of
speech a definition's grammar expects, and one for the share of the definition kept), not
problems of the approach; neither is fixed here.

## Requests that work only through a learned definition

Dry runs in the noodle worktree (README.md in the workspace), with and without
`definitions.ncon` in the store, same code and seed otherwise.

| Request | Without definitions | With them |
|---|---|---|
| repeat the readme | stuck (`Occur(...)`, VerbNet's "recur") | `Say(README.md)`, through repeat = Ingeminate#Tell "to say" |
| restate the readme | stuck (no reading) | `Say(README.md)`, same sense |
| reiterate the readme | stuck (no reading) | `Say(README.md)`, same sense |

They reach the bridge entry "the assistant saying something: Say" through the definition. What
they say is still empty: `Say` of a file's reference realizes as nothing (that is the evaluator's,
not this piece's; "show me the readme" through the bridge's `Cause(See(Speaker))` entry would hit
the same).

Near misses that correctly do not act:

| Request | What the definitions offered | Why nothing ran |
|---|---|---|
| check the readme | `Store(Addressee(), Some(Examination))`, through "examine so as to determine accuracy" | a worse score than leaving "check" as it is |
| point out the readme | `Store(Addressee(), README.md)` | the same |
| build a document | `Store(Addressee(), Some(Document))`, through build's second sense | the same; build's first sense gives `Make(product=Some(Document))`, which the bridge's Write entry wants a document for, and `Some(Document())` is not one by kind |
| repeat the eggs | `Say(the eggs)` | no referent: nothing is said |
| quote the readme | `Say(Some(Passage), source=README.md)` | "a passage" is no referent |

Two that should have worked and did not: "notice the readme" picks `Store(Addressee(),
Something())` (from "discover or determine the existence...") and then cannot run it; "retell the
readme" has `Say(README.md)` tied with leaving "retell" as it is, and the tie goes the wrong way.

### On the corpus

`scripts/acts.mjs` (700 labelled development prompts, dry run), same code, with and without the
definitions in the store: acts first 19 of 335 both; acts any 39 both; none correct 318 to 319 of
345; false acts 27 to 26. Five prompts changed (two lost a wrong `git add`, one gained a wrong
`git tag`), and a second pair of runs differed by one prompt from these, so the effect is within
run-to-run noise: the definitions neither help nor hurt the git and gh prompts, as expected, since
those name their commands.

## What still fails, and why

- **"show me the readme"** and **"remove the eggs"**, the two examples in the brief, do not work
  through definitions. show's first verb sense is "give an exhibition of to an interested
  audience" (stuck on give); "make visible or noticeable" reduces to `Cause(result=Become(Be($x,
  Visible#...)))`, which does not say who sees, so it can never meet `Cause(See(Speaker))`.
  remove's verb senses are defined by "remove" itself or are not heard whole; "take away" is a
  synonym in the synset, not a definition.
- **Two open arguments.** "cause to have" (give), "put into" (put), "provide with": the chart lets
  one gap per edge, so a definition that leaves both its object and its recipient open is not heard.
  Transfer verbs fail first because of this.
- **Which role the object is.** A sense's reading is written once per role the word's chart
  entries give a single object (theme, patient, topic...). That is what lets "repeat the readme"
  (theme) match, but it cannot know that in "cause to have" the open argument is the recipient,
  not the theme.
- **Ties between parts of speech** in the chart, above; most wrong reductions start there.
- **Rewriting picks the shortest bottoming-out alternative**, so "make or become black" is `Make()`.
- **The bridge rarely meets a definition exactly.** Of about 1,000 words whose verb senses have
  readings, rewriting `Directive(Word(agent=Addressee(), theme=README.md))` (as theme, patient or
  topic) reaches a primitive through a sense for 442. Of the 1,087 such derivations in rewriting's
  top six, 412 are storing into the addressee (`Cause(Become(Have(Addressee(), x)))`, mostly a
  definition's "get" or "have" whose subject became the assistant), 260 are `Contains` (a state,
  read as a check), 112 `Write` (a definition's "make a ..."), and 28 `Say`. The bridge's acting
  patterns need `Cause(result=Become(...))` with the right
  arguments in the right roles, and definitions rarely come out that way. The scored match of
  runtime.md 6.2 (`softmatch.ts`, built, not used in rewriting) is the design's answer and is the
  next piece.

## What in the design I think is wrong or missing

- **"Bottoms out in core meanings" is too strict for nouns.** Almost no noun definition reduces to
  core meanings ("mind", "system", "audience"), so a strict reading leaves verb coverage at 8%.
  The design should say what a noun inside a definition has to be: a kind grounded through its
  hypernyms is what made the 34.8% possible, and it is reported apart.
- **Definitions need syntax the seed does not have.** The two seed entries above were needed before
  almost anything was heard whole, and two open arguments need a chart change. Design section 6
  lists what the seed has for words and meanings, but not that the core meanings' own words need
  the constructions definitions are written in.
- **A core meaning's word has senses too** (decision 1's risk, now concrete): "part" the verb
  reduced to the core noun `Part`. The rule that a seeded word is not expanded through its senses
  makes reduction terminate, at the cost that "make" in a request is always the core `Make`, never
  one of its 49 WordNet senses.
- **SenseFrequency is a rank, not a frequency.** WordNet's order is all there is; ties across parts
  of speech (noun "full" against adjective "full") have no data to break them.
