# N-Con: the data model

Status: reviewed at checkpoint 0, 2026-10-01 (PLAN.md phase 0, item 1). Design sections 4, 5, 20 and
28 are the source; where this spec decides something the design left open, it says so, and open
questions are listed at the end rather than guessed.

N-Con (nested concepts) is what Noodle hears into, reasons in, speaks from and acts on, and what its
graph is written in. This file says what the data is. Its text form is `ncon-format.md`; the
logical form built on top of it is `logical-form.md`.

## 1. Expressions

Everything in N-Con is built from one value type, the **expression**:

```
expr := number | string | boolean | null | variable | call
call := Head "(" [ arg { "," arg } ] ")"
arg  := [ role "=" ] expr
```

- A **call** is a head (the name of a concept) applied to arguments. `Milk()` is the concept Milk
  with nothing applied; `To(My(List()))` is To applied to My applied to List.
- An **argument** has an optional **role**. A role is a concept (section 7); the text form writes it
  in lower camel case (`theme=`), and it names the concept `Theme`. An argument with no role is
  positional.
- A **variable** (`$x`) appears only in patterns and templates (readings, section 4). `_` is the
  anonymous variable: it matches anything and binds nothing.
- **Literals** (numbers, strings, booleans, null) are values, not concepts. A literal never decides
  meaning (AGENTS.md rule 3); it is data passed to a primitive, a key used for lookup, or content.
  Long or verbatim text is not a literal but a content block (section 6).
- There is no list, object or infix syntax. A collection is a concept (`And(A(), B())`,
  `Set(...)`), a keyed collection uses roles.

Expressions are immutable values with structural equality: same head, same arguments in the same
roles, same literal values. Positional arguments compare by position; roled arguments compare by
role regardless of their order (`logical-form.md`, section 8, goes further).

## 2. Concepts

A **concept** is an identity with two kinds of content:

- **facts**: what is true of it (section 3);
- **readings**: what it, applied to things, becomes (section 4).

That is the whole of a concept. There is no gloss, description or label field: a label that code
reads would be a string deciding meaning. Text a source said about a concept is kept as a content
block the concept refers to (`Said(Block(...))` as a fact), never matched against.

### 2.1 Names

A concept's identity is its **name**, the head used to call it. Names are:

- **Word concepts**: the capitalized lemma, `List`, `Push`, `When`. A lemma that is not a plain
  identifier is encoded deterministically (letters and digits kept, each other character dropped
  and the next letter capitalized: `e-mail` is `EMail`, `don't` is `Dont`). The lemma itself is a
  fact on the word (`Lemma("don't")`), and lookup is by lemma, never by name. Two lemmas that encode
  to the same name get `_2`, `_3` in order of arrival.
- **Senses**: `Word#WhatItIs`, where `WhatItIs` is the sense's nearest broader kind or closest
  synonym (design section 5): `List#Series`, `Push#Publish`. If two senses would collide, the next
  broader kind breaks the tie (`List#Series`, `List#SeriesOfNames`); if the kinds run out, `_2`.
  Sense names are plumbing; they appear in traces and the reasons log, never in what is heard.
- **Named things and kinds** that are not words: whatever name their source gives, encoded the same
  way (`Superman`, `WorkInProgress`).
- **Minted instances**: things the assistant makes during a conversation (a user, a turn, a file it
  is tracking): the kind's name plus `_` plus a counter, `User_1`, `Turn_42`. The counter is per
  store and never reused.

A name is unique in a store. Renaming is not an operation; a concept that turned out to be the same
as another gets a `SameAs` fact (section 3.3), and both names keep working.

### 2.2 Words and senses

A **word** is its forms and its senses (design section 5):

```
Concept(List(),
  Lemma("list"),
  Form("lists", Plural()), Form("listed", Past()), Form("listing", Participle()),
  PartOfSpeech(Noun()), PartOfSpeech(Verb()),
  Sense(List#Series), Sense(List#Enumerate))

Concept(List#Series(), SenseOf(List()), IsA(Series()), Holds(Item()), from=WordNet("list.n.01"))
```

- A **form** is a spelling of the word with the grammatical features it carries. "Alternative form
  of X" from a lexicon is a form with no features: identity for understanding.
- **Part of speech** and **pronunciation** (`Sounds("/lɪst/")`, from Wiktionary IPA) are facts on
  the word.
- A **sense** is its own concept, linked both ways (`Sense` on the word, `SenseOf` on the sense; the
  store indexes one and derives the other, so there is one source of truth).
- The **chart entries** of a word (what it takes, what it modifies, its category; design section 8)
  are facts on the word or on one of its forms (section 5). Readings that need a sense are on the
  sense; readings about the word itself (its idioms, its function-word behaviour) are on the word.
- A **user's own sense** ("ears means the hearing layer") is a link from the word to an existing
  concept (`Sense(Ears#HearingLayer)` with `from=Keal()`), not a new kind of thing.

Heard N-Con uses word concepts only (`Add(Milk(), To(My(List(Shopping()))))`). Senses are chosen
during evaluation, when a reading wants one (runtime spec, section 7).

## 3. Facts

A **fact** is an expression stated about a subject:

```
Fact(subject: Name, claim: expr, inSense?: Name, holds?: Time, meta)
```

- **subject**: the concept the fact is about. Facts are stored on their subject and indexed by
  their claim's head and by every concept the claim names, so `IsA(Series())` on `List#Series` is
  found both from `List#Series` and from `Series`.
- **claim**: any expression without variables. Its head says what kind of fact it is (`IsA`,
  `Lemma`, `Takes`, `Holds`, `Named`...). The claim's head is itself a concept and can carry facts
  about how it behaves (`Transitive()`, `InverseOf(...)`, `Symmetric()`); the runtime uses only the
  ones listed in `built-ins.md`.
- **inSense** (optional): the fact holds of the subject only in one of its senses. This is for
  facts stated about a word by a source that did not say which sense (a glossary saying "a push
  updates remote refs" about the word, before the sense exists). When the sense is minted, such
  facts move to it.
- **holds** (optional): when the fact is true, as a time expression (`logical-form.md`, section 3.3).
  Without it, a fact holds from when it was recorded until it is retracted. State tracking (design
  section 12) is facts with `holds`, changed only by primitives' declared effects.
- **meta**: provenance and status (section 8).

Facts are never edited. A fact stops holding by a later fact (`holds` closing its interval) or is
**retracted** (its source withdrew it, or a correction removed it), which is itself recorded.

### 3.1 Kinds

A kind is an ordinary concept. `IsA(K())` on X makes K a kind of X; `IsA` is transitive. The
**kind hierarchy** is the `IsA` graph, and **kind distance** (used by the score and the match
relation) is the number of `IsA` steps between two concepts through their nearest common ancestor.
Kinds are weighted guesses (design principle 5): an `IsA` fact can carry a weight in its meta, which
enters the score as evidence, never as a switch.

### 3.2 Facts that are relations

A two-place relation is a fact whose claim has one argument: `Holds(Item())` on `List#Series` is
the relation Holds between List#Series and Item. Many-place relations use roles:
`Transfer(from=Local(), to=Remote(), theme=Commit())`.

### 3.3 Sameness

`SameAs(Y())` on X says X and Y are one concept. The store keeps a **canonical representative** for
each `SameAs` class (the member with the highest trust, then the earliest; a seed-designated one
wins over both) and canonicalization rewrites every member to it. `SameAs` is how "Remove and
Delete are the same act" is expressed, and how a user's word meets the concept a paraphraser's word
reaches.

## 4. Readings

A **reading** says what something, applied to things, becomes. It lives on one concept (its
**owner**: the word or sense it is about; AGENTS.md: every rule about language lives on the concept
of the word it is about) and has:

| Part | What it is |
|---|---|
| `pattern` | an expression with variables, over lemmas and roles, that the reading applies to |
| `wants` | soft preferences on what the variables are bound to (kinds, shapes, neighbours); each becomes a score feature, never a filter |
| `becomes` | the result: an expression template (a rewrite) or a primitive call |
| `needs` | what must be known or obtained before it can act (expressions over the variables) |
| `effects` | for readings that act: the effect classes and state changes it declares |
| `checks` | for readings that act: the effect check and, where derivable, the goal check |
| `mode` | the mode it applies in (`Speaking`, `Supposing`, `Doing`), if restricted |
| `direction` | `Expand` (a concept to what it means) or `Collapse` (words to what they name); default Expand |

```
Reading(on=Can(),
  pattern=Can(agent=You(), act=$x),
  wants=Doable($x),
  becomes=$x)

Reading(on=Work(), direction=Collapse(),
  pattern=Work(In(Progress())),
  becomes=WorkInProgress(),
  from=Wiktionary("work in progress"))
```

- **Patterns match over lemmas and roles**, not over surface order: the pattern
  `Spill(theme=The(Beans()))` matches "spilled the beans", "the beans were spilled" and "don't
  spill the beans" once the lexical rules have lined up the roles (runtime spec, section 5). The
  match relation (exact matching with variables, and the scored match with slack used against
  documentation readings) is defined in the runtime spec, section 6.
- **wants** are expressions over the pattern's variables: `Doable($x)`, `IsA($c, Holder())`,
  `Shape($n, Digits(5))`, `Near($n, Server())`. Each is a named feature whose value the runtime
  computes (kind distance, shape fit, neighbour presence). A want is never a hard condition; a
  reading whose wants all fail still exists, at a low score.
- **becomes** is either a template (variables are replaced by their bindings) or a call to a
  primitive. A reading whose becomes is a primitive call is an **acting reading** and must declare
  `effects` and `checks` (primitives declare their own; the reading may narrow them).
- **needs** are expressions evaluated before the result is used. An unmet need is tried (Know, a
  pure Read), then asked, then left unworked (design section 12).
- A reading may have **no becomes** only while it is pending (a definition that has not bottomed
  out yet, design section 6).

Readings are data, stored like facts (section 8 applies to them), and the text form writes them as
`Reading(...)` forms. A reading is never a string.

## 5. Chart entries

The chart (runtime spec, section 4) combines words using facts on the words; the runtime knows
none of them. These are the fact heads it reads:

| Fact | Meaning |
|---|---|
| `Category(C())` | the word or form, once every non-optional Takes is filled, yields a span of syntactic category C ("the" is a Thing that takes a Noun on its right: CCG's NP/N) |
| `Takes(side=, category=, role=?, head=?, optional=?)` | it takes an argument of category C on a side (`Left()`, `Right()`); with `role=` the argument fills that role, without it the argument is positional (`The(Beans())`); `head=` restricts the argument's head word (the preposition a verb frame requires) |
| `Modifies(side=, category=, role=?)` | it attaches to an adjacent span of category C and becomes an argument of that span's head (in role `modifier` unless said) |
| `Joins(category=?)` | it joins two adjacent spans of the same category (category omitted: any) |
| `FillsGap(role=?)` | it opens a gap that a displaced phrase fills (a wh-word, a relative pronoun) |
| `Rule(...)` | a lexical rule on a form or an auxiliary (the passive, questions, fronting): a reading over chart edges, section 5.1 |

**Category and kind are different** (design section 8). Categories are the chart's hard constraint:
a small closed set of structural concepts (`built-ins.md`, section 4.2). Kinds are soft: they enter only
through wants.

Takes, Modifies and Joins facts come from the seed's function-word lexicon for closed-class words
and from imports (VerbNet frames, WordNet and Wiktionary parts of speech) for content words. Order
of Takes facts on a word is their order of application (the first is the nearest argument).

### 5.1 Lexical rules

A lexical rule is a reading whose pattern is over a chart edge and a form or auxiliary, and whose
becomes rearranges roles: the passive (a form of "be" plus a past participle) swaps agent and theme
and moves "by" to agent; a question inverts; a fronted phrase fills the role it came from. They are
readings on the words that trigger them (`Be`, the participle form feature), written in the seed,
counted (design section 6, part 4).

## 6. Content blocks

A **content block** is text or bytes that are content, not meaning: file contents, a draft, a quote,
a URL, a source's original words, pasted text.

```
Block(id: string, media: string, hash: string, from: Source, body: bytes)
```

- The id is the content hash (sha-256, hex, first 16 characters, with `b_` in front); identical
  content is one block.
- Concepts refer to blocks with `Block("b_...")`. A block never decides meaning: nothing matches on
  a block's text. Read may **understand** a block into facts and readings (the result is structure,
  with the block as its source) or parse it with a real parser (code, git's porcelain output) into
  structure; the block itself stays content.
- A block may carry structure from its parser as facts on a minted concept that refers to it (a
  tree-sitter parse, a porcelain status record).

## 7. Roles

A role is a concept (`Agent`, `Theme`, `Destination`, `Modifier`, `Time`...). Roles come from the
seed's lexicon (the roles function words assign) and from VerbNet's thematic roles (imported, then
`SameAs` to the seed's where they are the same). Patterns name roles; the chart fills them from
Takes facts. A pattern that names no role matches positional arguments by position.

## 8. Provenance, trust and status

Every fact, reading and block carries **meta**:

| Field | What |
|---|---|
| `id` | a store-wide sequence number, never reused |
| `from` | the source: an expression naming a source concept and a locator (`WordNet("list.n.01")`, `GitDoc("git-push", "DESCRIPTION")`, `Seed("function-words")`, `Keal()`, `Correction(Turn_42)`, `Derived(12, 40)`) |
| `at` | when it was recorded (ISO 8601 UTC) |
| `pack` | the pack and version it came from, if any (`Pack("wordnet-coarse", "2024.1")`) |
| `status` | `Active`, `Proposed` (awaiting confirmation), `Pending` (a definition that has not bottomed out), `Retracted` |
| `weight` | optional, for weighted guesses (kinds, sense frequency counts) |

- **Sources are concepts** with facts: what they answer, how they are reached, license, whether
  their answers are kept, how long they stay fresh, and their trust level. The list is open
  (design section 21).
- **Trust** is not stored per item. It is looked up from the source's level in the **trust table**
  (data, in the protected base; design section 20: 1 user, home instruction file and config; 2 the
  project's instruction file; 3 a project's AGENTS.md, READMEs and help text; 4 the web and fetched
  pages). An item made from other items has `from=Derived(ids...)`, and its trust is the minimum
  of its inputs', computed on read. The seed has its own level, above 1 for what it may change and
  outside everything learned (the seed is protected, `built-ins.md`).
- **Deleting a source deletes what was learned from it**: retracting a source retracts every item
  whose `from` is that source or is derived from it, transitively.
- **Interpretation confidence** (how sure the assistant was that it understood a rule it heard) is
  kept apart from trust (design section 19): it is a fact on the item, `Understood(confidence)`,
  never mixed into the trust level.

## 9. The store

The store holds, as data (design section 28):

- concepts, facts, readings and content blocks, with meta;
- the **conversation structure** and the **event record** (runtime spec, section 11), for past
  conversations as well as the current one, so Focus can search them (runtime spec, section 11b);
- the trust table and the protected base's contents (runtime spec, section 13);
- packs and their versions.

It is SQLite, indexed by lemma, by fact head, by concepts named in claims, and by pattern heads, and
loads senses and readings lazily. `.ncon` files are its readable text form, used for the seed, packs,
export and import; export then import gives the same store contents (ids aside).

## 10. What N-Con is not

- Not a programming language with its own control flow: order is `Sequence`, choice is the score,
  conditions are `If` in the logical form.
- Not a place for grammar: no fact or reading in N-Con is consulted by the runtime by name except
  the structural concepts listed in `built-ins.md`.
- Not a store of strings with meaning: labels, glosses and descriptions are blocks or are
  understood into structure.

## Decided

Keal (2026-09-30): the heard form's exact shape does not matter, as long as super messy English is
consistently parsed into it. So the shape is chosen for consistency, and these are settled:

- **Roles.** Heard arguments carry a role only when the Takes fact that filled them names one:
  function words take positionally (`The(Beans())`, `To(My(List()))`), verbs take by the thematic
  roles of their frames ("add milk to my shopping list" is
  `Add(theme=Milk(), destination=To(My(List(Shopping()))))`). Roles are what let the passive,
  questions and fronting reach the same expression as the plain order, which is the consistency
  asked for. The text form prints the roles it has.
- **Modifiers inside heads.** "shopping list" is `List(Shopping())` (the modifier is an argument of
  its head, role `modifier`); "my list" is `My(List())` (determiners and possessives are heads).
  Either shape would do; this one is kept because it is Napkin's and nothing gains from changing it.

## Open questions

1. **Name encoding for lemmas with symbols** (`HEAD`, `.gitignore`, `c++`). The rule above drops
   symbols (`Gitignore`, `C`), which collides `c` and `c++`. Alternative: keep symbols spelled out
   (`CPlusPlus`) from a seed table, which is a word list. Or: names for such lemmas are opaque
   (`Word_381`), which is honest but unreadable in traces.
2. **inSense migration.** When a sense is minted, do `inSense` facts move (rewrite) or stay and get
   linked? Moving is simpler to read; linking keeps facts immutable. This spec says move, recorded
   as retract plus assert.
3. **The seed's trust level.** The seed sits outside the four levels. Is it its own level 0, or is it
   only "protected" (not writable) and otherwise level 1?
