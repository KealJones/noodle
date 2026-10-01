# The logical form

Status: reviewed at checkpoint 0, 2026-10-01 (PLAN.md phase 0, item 3). Design section 11 is the
source. The logical form (LF) is written in N-Con (`ncon.md`); this spec says which heads it uses,
what they take, how scope is left open and settled, and when two LFs are the same.

The LF is internal to Noodle. The experiment's gold is an executable act, not an LF (design section
29; `testing.md`, section 5), so the LF can change without moving a frozen target.

## 1. Where the LF sits

```
message --chart--> heard expression --readings (rewriting)--> LF --evaluation--> primitives
```

- The **heard expression** stays close to the words (`Dont(Push(Yet()))`). It has word concepts
  only, no senses and no speech act.
- Readings on the words build the **LF**: a speech act at the top, operators from the function-word
  lexicon, concept expressions under them, senses chosen where a reading wanted one. "don't push
  yet" becomes `Constraint(Not(Push(_)), until=Told())` because the seed's entries for "do", "not"
  and "yet" say so, not because the runtime knows.
- **Evaluation** runs the LF by its speech act's rule (section 2).

The operators and speech acts below are in the **protected base** (design section 20): no learned
reading may rewrite their meaning. Learned readings may produce them.

## 2. Speech acts

Every message's LF is one or more speech acts, in order. Each has one evaluation rule.

| Act | Takes | Evaluation rule |
|---|---|---|
| `Question(p, about=?)` | `p` a proposition; `about` a variable in `p` for wh-questions (`about=$x`), absent for yes/no | answer it: find bindings of `about` that make `p` hold, or decide `p`; presuppositions are checked first and a failed one is the answer (design section 14) |
| `Assert(p)` | a proposition | a claim: check it against what is known or observable; remember it if it is about the user or the world and does not contradict; report a contradiction |
| `Directive(a, to=?)` | an act; `to` defaults to the assistant | something to do: plan and run `a` under the active constraints and guards |
| `Advice(a, for=?)` | an act, usually with an `Or` choice in it; `for` defaults to the speaker | a request for a recommendation: answer conditionally, run nothing |
| `Constraint(r, until=?, over=?)` | `r` a rule over plans (section 3.2); `until` a lifting condition; `over` the scope it applies to | store it as a standing rule for its scope; run nothing now |

- A message with several asks is several speech acts: `Directive(Commit(...))`,
  `Directive(Push(...))`. Their order is the message's order unless an ordering word says otherwise
  (section 3.4).
- "should" said to the assistant is a Directive; "should I" is Advice (design section 11). That is
  the seed's entry for "should", which takes the addressee into account through the speaker and
  addressee roles; the runtime has no rule for it.
- **Tone and asides** (profanity, "lol", "i haven't read your response") are not speech acts. They
  are kept on the turn as its tone and asides (runtime spec, section 11) and are evidence for the
  score. A message with only tone and asides has no speech act and runs nothing.

## 3. Operators

### 3.1 Argument kinds

LF arguments have one of these kinds. They are LF kinds, checked when an LF is built; they are not
the chart's categories.

| Kind | What it is | Examples |
|---|---|---|
| **Prop** | a proposition: something that holds or not | `Broken(It())`, `SetUp(It())`, `Mentions($f, "X")` |
| **Act** | something doable: a concept expression whose readings reach primitives | `Push(_)`, `Commit(Every(File(), ...))` |
| **Thing** | a referent or a set of them | `The(Plan())`, `Every(Branch(), except=Main())`, `"docs/design.md"` |
| **Time** | a time or interval | `Now()`, `Since(LastChange())`, `Until(Told())` |
| **Kind** | a concept used as a kind | `File()`, `Branch()` |
| **Rule** | a restriction on plans | `Not(Push(_))`, `Only(Suggest(_))` |

An act used where a Prop is wanted means "the act happened" (`Before(Commit(_))`); a Prop used where
an Act is wanted means "make it hold" (`Directive(Passing(Tests()))`). Both are conversions the seed
declares; there is no silent coercion.

### 3.2 The operators

| Operator | Takes | Means |
|---|---|---|
| `Not(x)` | Prop, or Act inside a Rule | negation; under a Rule, a prohibition: no act matching `x` runs |
| `Only(x)` | Act inside a Rule, or Thing | under a Rule: every step of the plan must match `x`; on a Thing: exactly that set |
| `Every(k, where=?, except=?)` | Kind; `where` a Prop over `$it`; `except` a Thing | the set of all things of kind `k` satisfying `where`, minus `except` |
| `Some(k, where=?)` | Kind; Prop | there is at least one; as a Thing, one chosen member (a choice point) |
| `If(c, then=, else=?)` | Prop; speech acts or acts | check `c` (in Suppose if it needs a look); run the branch that holds |
| `And(x, y, ...)` | same kind throughout | conjunction of Props, union of Things, both of Acts (in order, section 3.4) |
| `Or(x, y, ...)` | same kind throughout | disjunction; as a Thing or an Act, a choice point the score or the user settles |
| `Then(x, y, ...)` | Acts | do them in this order, later ones seeing earlier results |
| `Quote(b)` | a content block | opaque: the text itself, section 5 |
| `Mention(x)` | a word or expression | opaque: the word or concept as a topic, not as an instruction, section 5 |

`Not(Not(p))` is `p` for Props only. Under a Rule, `Not` is never simplified away.

### 3.3 Time

Time is an index on propositions and acts, not a separate concept per tense (design section 11).

- `time=` on a Prop or Act: `Now()`, `Past()`, `Future()`, or an interval.
- Intervals and points: `At(t)`, `Since(x)`, `Until(x)`, `During(x)`, `Before(x)`, `After(x)`, where
  `x` is a time or an event (an Act, meaning the time it happened: `Since(LastChange())`).
- `LastChange()` and other event references resolve against the event record (runtime spec,
  section 11).
- "still" is `during=Since(LastChange())` on a Question about a state (design section 11 example);
  "yet" in a constraint is `until=Told()`. Both are the seed's entries for those words.

### 3.4 Order

`Then` orders acts. Words like "then", "first", "after that" produce it (seed lexicon). Two
Directives with no ordering word run in message order. "commit and push" is `And` of two Acts, which
evaluation runs in order, because `And` over Acts is ordered (the only ordered `And`).

## 4. Referents

- A referring word is heard as itself (`It()`, `That()`, `The(Plan())`) and becomes a **referent
  slot** in the LF: `Ref(said=It(), kind=?)`, where `kind` is what the reading that holds it wants
  (`Push` wants something pushable).
- Referents are resolved during evaluation by the score (design section 16): kind match, salience
  from the event record, recency, the conversation's things in play. The resolution is a choice
  point.
- In a resolved LF, a slot is replaced by what it points to: a concept (`Plan_3`), a file path, a
  branch name, or a set of them.

## 5. Opaque nodes

Inside `Quote(...)` and `Mention(...)`, nothing is rewritten and nothing runs (design section 11).

- `Quote(Block("b_..."))`: quoted text, text to be written, a commit message the user dictated.
- `Mention(Push())`: "what does push mean", "don't say X". The word is the topic.
- The chart produces them from the seed's entries for quotation marks, "say", "mean", "called",
  code spans. A reading may produce an opaque node; no reading may look inside one.

## 6. Scope: left open, settled by the score

Scope is underspecified at parse time and settled at evaluation, in the style of Minimal Recursion
Semantics and Hole Semantics (design section 11).

- An LF may contain **holes**, `Hole(h1)`, where an operator's argument is not yet decided, and
  labelled pieces, `Label(l1, x)`.
- **Scope constraints** say what may go where: `Outscopes(h1, l2)` means the piece `l2` must end up
  somewhere under hole `h1`.
- The **scoped readings** are the ways to plug every hole with a piece so that all constraints hold
  and the result is a tree. Requests are short, so these are few; they are enumerated, and each is a
  candidate for the score (features: the operator's position, its word, past picks).

Example, "without committing, fix X":

```
Label(l1, Constraint(Not(Commit(_)), over=Hole(h1)))
Label(l2, Directive(Fix(X())))
Outscopes(h1, l2)?     // one candidate: the constraint scopes over the fix
                       // the other: the constraint is session-wide (over=Session())
```

**Constraint rules.** Seed readings may go under any operator. A learned rewrite may not widen what
is permitted to run (runtime spec, section 13): an act under a prohibition is never run.

## 7. Evaluation of rules

- A `Constraint` is stored in the conversation's standing rules with its scope: the message
  (`over=` a piece of this message), the session (default), or longer if the user said so ("from now
  on", design section 19, as a proposal).
- **Before any act runs** (in Doing, and simulated in Suppose), each active rule is checked:
  `Not(x)` blocks every act that matches `x`; `Only(x)` blocks every act that does not. Matching is
  the runtime's exact match with wildcards (runtime spec, section 6.1), over the act and its
  arguments.
- A blocked act is not run. The assistant says what rule blocked it, and where the rule came from.
- `until=Told()` is lifted when a later user message is read as **permission** for an act the rule
  blocks: a `Directive(Permit(a))` (the seed's entries for "ok", "go ahead", "you can now") where
  `a` matches, or the user's yes to an echo of the rule. A plain later Directive to do the blocked
  act does not lift it: the rule is echoed ("You said not to push yet. Push now?").

## 8. Canonicalization: when two LFs are the same

"Same normal form" is decidable (design section 11): canonicalize both, then compare as data.

1. **Choose a scoped reading.** Only fully scoped LFs are compared (no holes).
2. **Resolve referents** to what they point to (section 4). An unresolved slot compares equal only
   to an unresolved slot with the same `said` and `kind`.
3. **Resolve sameness.** Every concept is replaced by its `SameAs` class's canonical representative
   (`ncon.md`, section 3.3): Remove and Delete, where they are the same act, become one.
4. **Senses, not words.** Word concepts that a reading resolved to a sense are the sense. A word that
   resolved to no sense stays the word (and is reported as a gap).
5. **Roles, not order.** Roled arguments are sorted by role name. Positional arguments keep their
   order.
6. **Sets are sets.** The arguments of `And` and `Or` over Things and Props, and the members of a
   resolved Thing set, are sorted (by canonical text) and deduplicated. `And` over Acts is ordered
   and is not sorted.
7. **Time is an index.** Tense marking becomes `time=`; `time=Now()` is dropped (it is the default).
8. **Negation.** `Not(Not(p))` becomes `p` for Props only.
9. **Opaque nodes.** `Quote` compares by block id (content hash); `Mention` by its canonicalized
   content with no rewriting inside.
10. **Rules are a set.** A message's Constraints are sorted and deduplicated; its Directives keep
    their order.
11. **Free text.** A block argument that the assistant writes (a commit message) compares equal to
    any block that passes the same stated constraints; for LF comparison it canonicalizes to
    `Written(constraints)`.

Two LFs are the same when their canonical forms are equal expressions. The canonical text of an
expression is its `format` output (`ncon-format.md`, section 5), which is what sorting uses.

## 9. Worked examples

Canonical LFs, with senses and referents left as words where they are not the point. These are the
first cases to pass (design section 11).

| Said | Canonical LF |
|---|---|
| "don't push yet" | `Constraint(Not(Push(_)), until=Told())` |
| "only suggest, don't delete" | `Constraint(Only(Suggest(_)))`, `Constraint(Not(Delete(_)))` |
| "commit everything except the plan" | `Directive(Commit(Every(File(), where=Changed($it), except=Ref(said=The(Plan()), kind=File()))))` |
| "if it's already set up, add it to the readme" | `If(SetUp(Ref(said=It())), then=Directive(Add(theme=Ref(said=It()), destination=Readme())))` |
| "without committing, fix X" | `Constraint(Not(Commit(_)), over=l2)`, `Label(l2, Directive(Fix(X())))` |
| "is it still broken?" | `Question(Broken(Ref(said=It())), during=Since(LastChange()))` |
| "you should run the tests" | `Directive(Run(Tests()))` |
| "should I use tabs or spaces?" | `Advice(Use(Or(Tabs(), Spaces())))` |
| "delete all the branches except main" | `Directive(Delete(Every(Branch(), except=Main())))` (guarded at evaluation) |
| "nothing is failing" | `Assert(Not(Some(Thing(), where=Failing($it))))` |
| "any file that mentions X" | `Every(File(), where=Mentions($it, X()))` (a Thing, inside whatever act holds it) |
| "revert that" | `Directive(Revert(Ref(said=That(), kind=Change())))` |

`$it` is the bound variable of `Every` and `Some`: the member being tested.

## Open questions

1. **Speech acts beyond the five.** Thanks, greetings and "sounds good" are not Question, Assert,
   Directive, Advice or Constraint. "sounds good" is permission for the last proposal (a Directive
   of it); "thanks" has no act. Is that enough, or does the LF need an `Express` act so that social
   turns get a realization?
2. **Corrections.** Design section 17 makes a correction an operation on the last reading, not a
   speech act. This spec leaves them out of the LF: a correction signal on a word triggers the
   correction operation (runtime spec, section 15), and the corrected content is read as a normal LF.
   Confirm, or add `Correct(target, with)` as a sixth act.
3. **Permit.** `Permit(a)` (section 7) is new: the design says permission lifts `until=Told()` but
   not how permission is represented. Confirm it as an LF head in the protected base.
4. **Constraint scope defaults.** A constraint with no scope word lasts the session (design: "don't
   push yet" lasts the session). Is that right for "don't delete anything" mid-task, or should
   unmarked constraints last until the task they came with is done?
5. **`Only` on Things vs Rules.** "only the tests" (a Thing) and "only suggest" (a Rule) share a head.
   They are told apart by argument kind. Keep one head or split into two?

## Decided

Keal (2026-10-01):

- **Corrections (2):** a runtime operation on the last reading, not a sixth act. The LF keeps five acts.
- **Permit (3):** `Permit(a)` is an LF head in the protected base.
