# The runtime

Status: reviewed at checkpoint 0, 2026-10-01 (PLAN.md phase 0, item 4). Design sections 8, 9, 10,
13, 14, 15, 20, 21 and 28 are the source. This spec says what the runtime does, step by step, and
what it must never do.

## 1. What the runtime is

It does only this (design section 28):

1. **Store** concepts, facts, readings, content blocks, the conversation structure and the event
   record, with provenance and trust (`ncon.md`).
2. **Match** patterns over lemmas and roles; interpret **shape patterns** over characters; compute
   **spelling candidates** (edit distance, sound, squeezing repeated letters).
3. **Build and prune the chart** with six universal steps.
4. **Score** readings in two stages.
5. **Rewrite** expressions and **run primitives**.
6. **Remember** the conversation and the event record, and gather what is relevant through
   **Focus** (section 11b).
7. **Learn** weights (and the few structures of design section 17) from corrections and picks.

It must not contain (AGENTS.md rules 1 to 3; design section 28):

- **word lists** of any kind (pronouns, fillers, question words, number words, months, correction
  signals, tone words, stop words);
- **English wording** (every sentence it says is a Speaking reading in the seed);
- **grammar rules** or any rule about what a particular word does;
- **answer-shaping rules** (if the question looks like X, answer like Y);
- **concept names** beyond the structural ones in `built-ins.md`, section 4;
- an `if` that **picks a reading** (AGENTS.md rule 6): choices go through the score.

The runtime has a version (`src/version.ts`, semver). Every change to runtime code bumps it and the
commit message says the new version.

## 2. One turn

```
text
 -> Focus: gather the local candidate set       (section 11b)
 -> set aside what is not language              (section 3.1)
 -> segment into clauses, with alternatives     (section 3.2)
 -> per segment: token candidates, shapes       (sections 3.3, 3.4)
 -> chart: six steps, pruned to k per span      (section 4)
 -> heard expressions (full or partial)         (section 4.7)
 -> readings: rewrite toward an LF, scored      (sections 6, 7, 8.1)
    needs filled through Focus                  (section 11b)
 -> stage two: Suppose each of the top few      (section 8.2)
 -> act, ask, or say why stuck                  (sections 8.4, 9, 12)
 -> record: turn, choice points, reasons, events (section 11)
```

No step uses the network (design section 8). Lookups that understanding wants go on the to-do list
and happen after the turn, or in evaluation through Know with cached answers only (section 14).

## 3. Before the chart

### 3.1 Set aside what is not language

Tool wrappers, pasted file headers, image tags, transcript markers and pasted content are moved
into content blocks, and the turn keeps a reference (`Pasted(Block(...))`). What counts is decided
by **shape facts** (section 3.4) on the seed's shape kinds (`CodeFence`, `PastedTranscript`...), not
by code: the runtime runs every shape pattern marked `SetsAside()` and moves the spans it matches.

### 3.2 Segmentation

Long messages are cut into segments so each chart is short (design section 24). Boundaries are
proposed by facts on punctuation marks and clause-opening words (`OpensClause()`, `EndsClause()` in
the seed lexicon). A boundary is a scored choice: at most two segmentations per message are kept,
ranked by the stage-one score of their best parses. References across segments are resolved by the
conversation structure, not inside one chart.

**Line indent.** The runtime records each line's indent (its count of leading spaces, a tab counted
as the seed's tab width) as an `Indent(n)` fact on the line's first token. It is character mechanics,
the same in any language, like squeezing stretched letters, and the only layout the runtime reads.
What indent means (a nested list item, a continued quote) is on the marks' entries (design section
25b); nothing in code reads it.

### 3.3 Token candidates

Each token gets a set of **candidates**, every one a competing edge in the chart, each with a
feature saying where it came from:

| Candidate | How | Feature |
|---|---|---|
| exact | the token's lowercased form is a lemma or form in the store | `Exact` |
| case | the token's exact case matches a name (`HEAD`, `README`) | `CaseMatch` |
| spelling | Damerau-Levenshtein distance at most 1 (tokens of 4 or fewer letters) or 2 (longer), with substitution cost lowered for neighbouring keys | `SpellDistance(d)` |
| sound | a lemma whose pronunciation fact is within a phoneme edit distance of 1 of the token's likely pronunciation | `SoundDistance(d)` |
| stretch | every run of 3 or more of one letter squeezed to one and to two, all combinations up to 8 | `Stretched`, and the stretch is kept as tone |
| surroundings | a name in Focus's candidate set (a file, a branch, a remote, a thing in play) within spelling distance | `InPlay(d)` |
| shape | a shape pattern matches (section 3.4) | `Shape(K)` |
| unknown | none of the above | `Unknown`; the token can only be skipped or taken as a literal |

- The **keyboard layout** is data: facts on the user's input (`KeyNeighbours("q", "w")`), from the
  seed or the user's config, never a table in code.
- A token's **likely pronunciation**, when the store has none for it, comes from letter-to-sound
  readings in the seed (English realizations are in the seed; this is its hearing counterpart).
  Until those exist, sound candidates are only proposed for tokens that are forms with known
  pronunciations. See open question 3.
- Candidates are proposed, never chosen silently: "taht" yields *that* and *Taht*, and the chart and
  score decide (design section 8).
- Multi-word lemmas (idioms, phrasal verbs, names) are found by a trie over lemma sequences and
  enter as spans.

### 3.4 Shapes

A **shape pattern** is an expression over characters, interpreted by the runtime's one small shape
interpreter. Its heads are structural (`built-ins.md`, section 4.3):

```
Digits(5)                       exactly five digits
Seq(Literal("#"), Digits(1, 6)) '#' then one to six digits
OneOf(Letter(), Digit(), Literal("_"))
Repeat(x, min, max)
Lower() Upper() Letter() Digit() Space() Any()
```

Facts on kinds say which shapes propose them (`ZipCode HasShape(Digits(5))`, `Path HasShape(...)`),
with a source and a weight. A shape match proposes the kind as a soft candidate for the span; it
never decides. The span is heard as a literal string with its shape kinds attached to the edge.

## 4. The chart

A lexicalized, head-driven chart parser. Every rule is on a word (`ncon.md`, section 5); the runtime
has only the six steps below.

### 4.1 Edges

An edge is: a span (start, end); a category; an expression built so far; the Takes still pending
(with side, category, role); an optional gap (a role it is missing, threaded to where it is
filled); its features and stage-one score; backpointers to the edges it was built from.

A word edge is created for every candidate of every token, for every category the word or form has
a `Category` fact for. A word with no category facts gets none and can only be skipped or taken as a
literal (open question 1).

### 4.2 The six steps

1. **Take**: an edge with a pending Takes on side S, category C, combines with an adjacent complete
   edge on side S of category C. The argument is added to the head's expression (in the Takes'
   role, or positionally). Nearest Takes first, in the order of the word's Takes facts. A Takes with
   `head=` also requires the argument's head word to be that word (the preposition a frame needs).
2. **Modify**: an edge whose word has `Modifies(side, category)` attaches to an adjacent complete
   edge of that category on that side. The modifier becomes an argument of the modified edge's head
   (role `modifier` unless the fact names one), and the result keeps the modified edge's category.
3. **Join**: an edge whose word has `Joins` combines two adjacent complete edges of the same
   category, one on each side, into `Head(left, right)` (`And(A(), B())`) of that category. Joins
   of a join flatten (`And(A(), B(), C())`).
4. **Skip**: a token is left out. It costs its skip feature (`Skipped`, weighted by the token's kind
   of candidate); an unknown token costs less to skip than a known one. Skipped tokens are recorded.
5. **Compose**: two adjacent incomplete edges combine when one's nearest pending Takes wants the
   category the other will yield once its own Takes are filled (forward and backward composition, as
   in CCG). The result has the second edge's remaining Takes. This is how "commit the plan and push"
   and "the file I edited" get built.
6. **Gap**: an edge whose word has `FillsGap` leaves a gap: the next edge that would Take an argument
   of the gap's category may instead mark that Takes as filled by a gap variable, and the gap is
   threaded up through each edge that contains it (at most one open gap per edge). The displaced
   phrase fills it when the edge containing the gap meets it ("which branch did you push?").

No other step exists. Lexical rules (the passive, questions, fronting) are readings on words that
apply to edges (section 5), not steps.

### 4.3 Category and kind

Categories are hard: Take, Modify, Join and Compose require exact category identity (categories are
a closed seed list, `built-ins.md`, section 4.2). Kinds are soft: when an argument fills a role,
the head's readings' wants on that role become features (section 8.1). So "push the fix" and "kill
the server" are never ruled out.

### 4.4 Pruning

For each span and category, only the top k edges by stage-one score are kept (k from 4 to 8; fixed
after measuring chart size on real prompts, design section 8). Pruning happens as spans complete, so
ambiguity is cut at every level. The oracle recall at k (how often the gold survives) is reported.

### 4.5 Out of scope (reported, not parsed)

Ellipsis across sentences beyond fragments filling holes, gapping ("commit A and B too"),
comparatives with deleted material, nested quotations (design section 8). The chart records when it
meets one of these as a named problem on the turn, from facts on the words that signal them.

### 4.6 Tone

Tone words (the seed's `Tone(...)` facts on words), stretching and profanity are kept as the turn's
tone, not its content: an edge for a tone word may be skipped at zero cost and adds its tone to the
turn. Tone is evidence for everything downstream.

### 4.7 The result

The chart yields, per segment, the top-scored **covers**: sequences of complete edges spanning the
segment, with skips. A single edge is a full parse; several are a partial parse (fragments), which
is always allowed. The coverage (share of content tokens not skipped) is a feature and is reported.

## 5. Lexical rules

A lexical rule is a reading (`ncon.md`, section 5.1) whose pattern is over an edge and its words'
forms: `Be` with a participle form on its right, for the passive. When an edge matches, the rule's
result edge (roles rearranged) is added beside the original, and both compete. Lexical rules run
inside the chart, after Take and before the edge is pruned, and are applied at most once per edge.

## 6. Matching

### 6.1 Exact matching

A pattern matches an expression when:

- heads are equal, after `SameAs` (a variable head is not allowed);
- every roled argument in the pattern has an argument with the same role in the expression, and it
  matches;
- positional arguments match in order; the expression may have extra positional arguments only if
  the pattern ends with a rest variable (`$rest...`, open question 5);
- a variable binds any expression (the same variable must bind equal expressions); `_` binds
  nothing;
- extra roled arguments in the expression are allowed; they are reported as unmatched (a feature)
  and carried over to the result under the same role unless the becomes names that role.

Opaque nodes (`Quote`, `Mention`) are matched only as wholes, never inside.

### 6.2 The scored match (unification with slack)

For matching a request's reduction against a reading whose pattern is another text's reduction (a
documentation description, a definition; design section 9). Both are trees of predicates with
roles.

- **Alignment**: find the alignment of pattern nodes to request nodes that maximizes the match
  score, top-down: the roots align; a pattern node's role children align to the request node's
  children with the same role, or, failing that, to an unaligned child of the same category at a
  cost; nodes that cannot align are left unmatched.
- Aligned nodes must have the **same category**; their **kinds** may differ at a cost that grows
  with their kind distance (`ncon.md`, section 3.1).
- **Features** of a match: the fraction of the pattern's core-meaning nodes covered; the fraction of
  the request's nodes left unmatched; the kind distance of each aligned argument; whether the
  request fills the reading's required roles (a Run template's arguments).
- **Threshold**: a match whose score is below a threshold (set on the development set, frozen with
  the system) is not a candidate. Above it, the match's features enter the stage-one score.

The alignment is exact search for trees under 30 nodes (requests and descriptions are small) and
beam search above that.

## 7. Rewriting and evaluation

Evaluating an expression rewrites it until it reaches primitives, which run (design section 10).

- **Candidates**: for an expression, the candidate readings are those whose pattern matches it
  exactly (section 6.1) or, for documentation readings, by the scored match (section 6.2). Each
  candidate application is a **choice point**, scored like everything else. There is no fixed order
  (not "code first", not "idioms first"): the score picks. Leaving a node as it is and reading its
  arguments is always one of the candidates: a reading that applies is a choice, not an obligation
  (an inner "is in" may be part of an outer "cause to be in" rather than a question of its own).
- **Direction**: expanding readings replace a concept by what it means; collapsing readings replace
  a multi-word expression by the concept it names. Both are candidates at the same choice point.
- **Senses**: when a reading's want on a role names a kind, and the argument in that role is a word
  concept, the word's senses that satisfy the want (by kind distance) are candidates for it, scored
  by sense frequency and evidence. The chosen sense replaces the word. A word no sense fits stays a
  word and is a **gap** (design section 5): unworked, not an error.
- **Order**: rewriting is outermost first, then arguments; an argument whose value a reading needs
  is evaluated before it is used.
- **Bounds**: at most 32 rewrite steps per expression (a stated, tunable budget); a rewrite that
  produces an expression already seen on the same path is a cycle and stops there.
- **The beam** keeps the best few alternatives at each node, ranked by their features plus
  `Unworked` (minus the expressions left that have readings of their own, none applied), so an
  alternative that reads every word is not cut on a tie with one that leaves a word unread.
- **Unworked is a value**: an expression no reading applies to stays as it is, and the turn records
  why (no sense, no reading, need not met; design section 23). It is never replaced by a guess or a
  default (AGENTS.md rule 10).
- **Opaque nodes** are not rewritten.
- **Modes**: the mode is set only by the primitive being run (Say runs Speaking, Suppose runs
  Supposing, every other primitive runs Doing). A reading with a `mode` applies only in that mode.

## 8. The score

### 8.1 Stage one: in the chart and in rewriting

A log-linear score: `score(d) = sum over features f of w(f) * value(f, d)`, for a derivation d (a
chart edge or a rewrite choice). The runtime has a fixed set of **feature templates** (mechanism,
generic, about no word); each template yields named features (`Feature(Template, key...)`), and the
**weights are data** (the seed's initial weights, then learned).

Templates (design section 9):

| Template | Value |
|---|---|
| `WordsUsed` | tokens covered (+1 each), `Skipped` per skipped token by candidate type (-1 each; a tone word 0), `Fragments` (-0.5 per edge of a cover after the first, so a partial parse is allowed but one reading of the same words is preferred), and `Joined` (+1 per token past the first of a noun the lexicon lists as one word, "shopping list", so the compound is preferred to the same nouns put together) |
| `CandidateSource` | the token candidate's source and distance (section 3.3) |
| `WantedKind` | per filled role with a want: minus the kind distance to the wanted kind |
| `ShapeFit` | per shape want: whether it fits |
| `Neighbour` | per want naming a neighbour: exact word, else its kind, else the conversation topic (backoff) |
| `SenseFrequency` | log of the imported sense count, smoothed |
| `Evidence` | log counts of (word, neighbour, chosen sense) and (word, neighbour, chosen reading), with backoff from neighbour to neighbour kind |
| `Match` | the scored match's features (section 6.2) |
| `Trust` | the reading's source trust level (a feature, not a gate; section 13) |
| `Coverage` | share of content tokens covered by the cover |
| `FocusSource` | for a candidate Focus supplied: its source (current conversation, past conversation, user facts, workspace, world), salience, recency |

Adding a template is a runtime change (a version bump, and a design check: AGENTS.md rule 12).
A reading keeps losing when it should win: the fix is a feature, a fact on a word, or a weight, and
the reasons log shows which (AGENTS.md rule 6).

### 8.2 Stage two: the dry run

The top few complete readings of each segment (16 for now: with the seed weights most readings tie at stage one, and 3 cut off the right one in the first runs; to be measured, open question 4) are each evaluated with **Suppose**
(section 10.1). A second log-linear score reranks them on what the dry run found:

| Template | Value |
|---|---|
| `ReachedAct` | the reading reached an act or an answer (seed weight 1; ablated in the experiment) |
| `NeedsMet` | share of needs met |
| `ChecksWouldPass` | the effect checks that could be checked in Suppose passed |
| `Blocked` | a standing rule blocked an act |
| `UnknownEffects` | an act's effects are unknown (a Run of an undocumented command) |
| `Unworked` | minus the number of unworked expressions left: steps that stayed stuck, and expressions in the logical form with readings of their own of which none applied (seed weight 1) |

The final score is stage one plus stage two. Both are trained by the same update (section 15).

### 8.3 The reasons log

Every choice point records: the candidates, their features with values, the weights, the scores,
the winner. Every lookup records which need drove it. Every action records which rule or grant
allowed it. The log is part of the turn (section 11) and is how failures are traced (AGENTS.md: when
something fails, trace why through the reasons log).

### 8.4 Asking

The top reading's probability is the softmax of the final scores over the candidates, calibrated
on the calibration slice (design section 9; `testing.md`, section 6). The assistant asks when
`P(wrong) * cost(mistake) > cost(ask)`. The cost ratio is a parameter in the config (a stated
setting, not learned), defaulting to lean against asking. It never asks when the top readings lead to
the same act. Consequential acts are held by guards whatever the score (section 12). In arms A and A+
zero-shot, asking is off.

## 9. Primitives

The only code that touches the world (AGENTS.md rule 7). Each primitive is a TypeScript module that
declares:

```
name        the concept it is (built-ins.md, section 2)
params      its roles and the kinds they take
pure        true if it only reads (Suppose may run it)
effects     the effect classes it may cause (section 12), and the state changes it declares
check       the effect check: after running, did it do what it declared?
inverse     optional: how to undo it
run         the code
```

- Arguments are values, never strings pasted into a shell (design section 26b). Run takes a
  program and an argument array.
- A primitive's effects are declared; after an effectful primitive runs, the world is **observed**
  (a pure Read of the state it changed), not trusted from the declaration (design section 15).
  Observation reads tools' machine formats (git porcelain and plumbing) as structure.
- Read also understands a tool's documentation as structure: `Read(ManPage(name))` or
  `Read(ManPage(name, section))` finds the page with `man -w` and parses it with mandoc (a real
  roff parser), giving sections, tagged items and the SYNOPSIS as Usage structures (design
  section 25). What the SYNOPSIS grammar cannot read stays `Unparsed`.
- The list of primitives is in `built-ins.md`, section 2. Adding one is a design change.

## 10. Suppose and Sequence

### 10.1 Suppose

`Suppose(x)` evaluates `x` in Supposing mode:

- effectful primitives are **captured**, not applied: the call, its arguments and its declared
  effects are recorded as planned effects, and the result is a placeholder of the declared kind;
- **pure** primitives run, within a budget (default 200 ms and 20 calls per Suppose);
- Know answers only from the graph and the cache; the network is never used;
- standing rules and guards are checked as if Doing, and blocks are recorded.

The result is the value (or placeholders), the planned effects, blocks, needs met and unmet, and
checks that could be evaluated.

### 10.2 Sequence

`Sequence(steps...)` runs steps in order, each step's result bound for the later ones (`$1`, `$2`,
or named). Between steps it **checkpoints**: a "stop" marks the plan interrupted at the current
checkpoint and nothing further runs (design section 26b). A failing step (its check fails, or it
throws) stops the sequence; the assistant reports what ran and what did not, and offers to undo
what has an inverse. The seed's default policies compile to Sequence behaviour (design section 6):
no asking between steps unless a guard or a failed check stops it; Say of completion requires the
goal check to have passed.

## 11. The conversation and the event record

Kept in the store as data (design section 14):

- **Turns**: who said it (the user or the assistant), the text (a block), the segments, the tone
  and asides, the heard expressions, the LF, the choice points with scores, the reasons log, what
  ran. The assistant's own utterances are understood into concepts too, so "the plan" or "option 2"
  can point at them.
- **In play**: concepts mentioned or acted on (the plan, the PR, the branch, the file just edited),
  each with a salience that decays per turn (decay rate is a weight, learned).
- **The last proposal and the last question**, so "sounds good" and "1" resolve.
- **Open questions**, **standing rules** (with their scope and source), **pending proposals**.
- **The event record**: every primitive run, with time, arguments, result, check outcome, and the
  turn that caused it; also observed changes by others. `LastChange()` and salience read it.

## 11b. Focus

How the runtime gathers what, beyond the message's own words, is relevant to it (design section
14b). It is not retrieval before understanding: **what a reading needs decides what is pulled in**,
and everything pulled in is scored, budgeted and recorded. The runtime has no rule for what is
relevant.

- **Sources**, in the order searched: the current conversation (section 11); past conversations
  (kept as structure in the store); the user's long-term facts; the workspace, only through pure
  primitives (Read, git porcelain as structure); the world, only through Know (section 14).
- **Phase 1, before the chart** (local, no network): a candidate set from the first four sources
  (things in play, names from recent conversations, the user's own words and senses, the
  workspace's file, branch and remote names), at most N per source by salience (N a config value,
  frozen with the system). It feeds surroundings candidates (section 3.3), neighbour and kind
  features (section 8.1), and referent candidates.
- **Phase 2, during evaluation**: a chosen reading's unmet need (a referent, a fact, a state,
  knowledge) is searched across the sources in order; candidates are scored with `FocusSource`
  and the want features like any other. Only when every source fails does the need become an Ask;
  then it stays unworked (section 7).
- **Budget** per turn: lookups per source, a network time limit, and a cap on how far back past
  conversations are searched unless the words ask ("the list from last month").
- A candidate that fits no need and no reference is dropped.
- **Recorded**: what was pulled in, from where, for which need, and which features won go in the
  reasons log (section 8.3), so a correction can move them.
- **Trust**: past conversations and user facts are level 1 when the user said them; workspace files
  keep their origin's trust (section 13); world facts keep their source's.
- **In the experiment**: only the current conversation and the workspace, both from the fixture.

## 12. Guards

Guards attach to **effect classes**, not verbs or commands (design section 13). The effect classes
(`built-ins.md`, section 4.5) are in the protected base: deleting, overwriting history, publishing,
sending outside, spending, and unknown.

- Before Doing an act, its effect classes are computed from the primitive's declaration and, for
  Run, the command's learned effects. A Run whose command has no known effects is `Unknown`, and
  unknown is guarded.
- A guarded act is **offered** (an Ask with its target shown: "delete these 12 branches?"), and runs
  when the user says yes, unless a level 1 grant covers that effect class (config, or the user in
  this conversation). A guarded act offered with the correct target counts as correct in the
  experiment.
- A grant never comes from levels 2 to 4 (section 13).

## 13. Trust and the protected base

- **Levels** (design section 20): 1 the user, the home instruction file, the config; 2 the project's
  instruction file; 3 a project's AGENTS.md, READMEs, help text; 4 the web and fetched pages.
  Trust is looked up from the source (`ncon.md`, section 8); derived trust is the minimum.
- **Only level 1 grants** permissions or lifts guards. Level 2 sets standing rules for its project.
- **Readings from levels 3 and 4 are proposals**: they may be scored and offered, but are not run if
  they would run something effectful, until confirmed. In the experiment's sandbox they run
  unconfirmed (design section 20), by a config switch that exists only in the sandbox harness.
- **The protected base** is not writable by anything learned: the config, the guards and effect
  classes, the trust table, the function-word lexicon, the LF's operators and speech acts, the
  corpus and its expectations, the replay gate, and the scorer's evaluation code. The store rejects
  a write to a protected item from any source but the seed build, and the runtime refuses to load a
  seed pack whose hash does not match the frozen manifest when frozen mode is on.
- **The invariant** (design section 20): no learned rewrite may widen what is permitted to run. On
  every learned rewrite: if its output lacks a `Constraint` or `Not` node its input had, the rewrite
  is run under Suppose on every replay item it applies to; it is kept on its own only if none of
  those runs would execute an effectful primitive, and otherwise only after the user confirms.
- **Self-written runtime code**, when it comes, is a diff for human review, never applied.

## 14. Know

The one door to knowledge from outside (design section 21). `Know(what, how)`:

1. if the graph holds it and it is fresh (the source's freshness fact), return it;
2. else ask the live sources that answer that kind of question, in order of trust;
3. understand what came back (down to the seed) or keep it as content;
4. save it with provenance and trust; return it.

Fetch is inside Know only: cached per URL, throttled per host, retried with backoff, one user agent.
Sources are concepts; adding one is data, but each needs an adapter (code that reaches it and parses
its format into structure), which is a primitive-like module with declared effects (`SendsOutside`
for the network). During understanding and in Suppose, Know answers from the graph and cache only.
In the first experiment, Know is used for imports (phase 3), not in conversation. Know is Focus's
only route to the world (section 11b).

## 15. Learning

- **Latent-variable structured perceptron** (design section 9): a correction or pick gives the right
  act; the update moves weights toward the highest-scoring derivation that reaches that act and away
  from the chosen one. Stage two is trained by the same update on its own features.
- **Caps**: one update moves any weight by at most a fixed amount (a config value, frozen with the
  system); few feature templates in the experiment.
- **Corrections** (design section 17) are an operation on the last reading: signal words (facts in
  the seed lexicon) bind to a choice point; the runtime flips it, runs again, and updates. What a
  correction may create is only: weights; a link from a word to an existing sense or concept; a
  sense split (proposed after two confirmed cases); a new reading made of existing concepts (a
  proposal until confirmed). Never a primitive, a seed entry or a bridge entry.
- **What applies on its own** (design section 20): weights, through the replay gate; user-taught
  word-to-sense links and splits once two cases agree; user-taught rewrites after echo and confirm;
  documentation and web readings wait only if they would run something effectful.
- **The replay gate**: a learned change that would change the top reading of any hand-checked replay
  item is kept only if the affected replays still pass (`testing.md`, section 4).

## 16. Performance

- A segment is understood in under 200 ms, with no network, measured on the short in-domain prompts
  before the budget is committed; if missed, k, the candidate width or segmentation is tuned and the
  cost is reported (design section 24).
- The store is indexed by lemma; senses and readings load lazily; a session starts without waiting
  for the base graph.
- Lookups in evaluation are cached, throttled and cancellable.

## Open questions

1. **Words with no category.** An imported content word with a part of speech gets a category from
   it (the part-of-speech-to-category mapping is a seed table, counted, in lexical rules). A word
   with no part of speech at all: skipped only, or tried as every category at a cost?
2. **Composition and gaps budget.** Compose and Gap can blow up the chart. Proposed limits: Compose
   only between adjacent edges whose combined pending Takes is at most 2; one open gap per edge. To
   be measured.
3. **Letter-to-sound.** Sound candidates need a likely pronunciation for unknown tokens. Options: a
   seed of English letter-to-sound readings (hand-written, counted, and English-specific, so seed
   not runtime), or only sound-matching tokens that are forms with known pronunciations. This spec
   starts with the second.
4. **Stage-two width.** Suppose on the top 3 is a guess; measure oracle recall at 3 and 5.
5. **Rest variables.** Variadic patterns (`And($first, $rest...)`) need a rest syntax the format
   spec does not have yet. Needed only if a seed reading needs it; proposed as `$rest...`.
6. **Senses chosen late vs the chart's kind features.** Wants score kinds during the chart, but senses
   are chosen in evaluation. This spec lets the chart's `WantedKind` feature use the best-fitting
   sense's kind distance without committing to it. Confirm that this does not count as choosing a
   sense in the heard form.
