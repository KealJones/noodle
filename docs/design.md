# Meaning and learning: a design for an assistant made of concepts

Status: design, written 2026-09-29 from a working session with Keal, revised after independent
critiques (appendix A lists what each round changed). Not a build plan. It is written for a new
project, built from nothing: the existing prototype (Napkin) is inspiration and a place to lift
code from deliberately, never a constraint. Each section says what is decided, the evidence
behind it, and what is still open.

Source material, next to this file:

- `source/conversation.md` and `source/conversation.jsonl`: the session this came from (local;
  kept local; not committed, because they include summaries of work prompts and the repo is public).
- `~/.napkin/corpus/`: the analysed corpus (local only; it holds work messages). See section 26.

## 0. What we are building, and why

An assistant that understands and acts without a language model. Everything it knows is a graph
of concepts; understanding a message means turning it into concepts and working it out; acting
means reaching small pieces of code that do real things. It learns from sources and from being
corrected, and everything it learns is kept as the same kind of structure it runs on, so it can
read, extend and repair itself.

The long-term aim is explicit: the assistant should eventually **write its own source code**, to
fix its own issues and add features, the way it writes readings into its graph. The first experiment tests only a narrow part
of it (understanding requests for tool acts); what it proves and does not prove is stated in section
29. Self-writing code is not
part of the first experiment, and when it comes it works inside a protected base it can never
change (section 20).

In Keal's words:

> "the runtime should be so small ... the graph should be the thing crafting all this knowledge
> and actionable shit ... this isn't a rule implementer. I don't want grammars. I don't want to
> collect a bunch of pointless shit that we don't need in the graph ... it should still be dead
> simple."

> "the whole point of it being able to research and output in the same form as input is so it
> can write [its own graph] and add to or edit itself."

> "how can we get it so that i can stop asking you to fix it and IT can fix itself?"

### The core bet

Stated so it can fail. On single-act file and git requests, including ones that carry constraints
("don't push yet", "commit everything except the plan"), taken from conversations collected **after
the seed is frozen**:

1. A lexicalized chart parser whose only hand-written structure is a counted, frozen seed (core
   meanings, the function-word lexicon, lexical rules, a bridge from meanings to primitives that
   names no command, and initial weights), whose content-word entries come automatically from
   VerbNet, WordNet and Wiktionary, and whose command readings come automatically from git's own
   documentation, **reaches the correct end state** (the right command, files, branch, referents,
   constraints and order, checked in a sandbox) **on real requests, single-act and multi-act, more
   often than command-name matching with a slot filler, and at least as often as a word classifier
   with the same slot filler.** In real use Keal nearly always names the command (only about 2 of
   27 single-act git requests in a labelled sample did not), so the understanding that matters is
   everything around the verb: which files, which branch, "everything except the plan", "don't push
   yet", "it", commit before push.
   A second result, reported but not deciding: on real requests that do not name the command (mostly
   carried by the conversation, "do it" after the assistant proposed a push), the right act is
   reached more often than retrieval over the same documentation.
2. Nothing is written by hand for the domain along the way; corrections create only the learned
   structure listed in section 17, counted.

Secondary, not deciding go: with gold normal forms on training conversations, it also resolves
referents better than a learned salience ranker.

Section 29 is the experiment that tests this, with go and stop numbers.

## 1. The project, the language, the files

- **A new project**, not an edit of Napkin. Napkin's store, journal and provenance stamps, its
  JavaScript-to-IR importer and formatter, its selection by specificity, its corpus runner and its
  Wikidata and Wiktionary fetchers are worth lifting, each deliberately and each reviewed against
  this design and the builder guide (`AGENTS.md` at the repository root). Nothing is carried over by
  default. Before code, the new project writes its specs (section 27).
- **The language is N-Con**, the language of nested concepts, and its files are `.ncon`. (The name
  began as "napkin concept"; the N now stands for nested, which is what the language is:
  `Add(Milk(), To(My(List())))`.) N-Con is what the assistant hears into, reasons in, speaks from
  and acts on, and what its graph is written in.
- **The project's name is Noodle.** Keal: "thats usin' the old noodle". Noodles are what is in the
  soup you eat with the spoon, with the napkin beside the bowl; "use your noodle" is what it does; a
  tangle of strands is what its graph looks like; and N-Con reads as "Noodle concepts" too. Home
  folder `~/.noodle/`, instruction file `NOODLE.md`. (Other candidates are in `names.md` and
  `names-n.md`.)
- **The store** is SQLite, indexed for tens of thousands of concepts (lookups by lemma, lazy
  loading); `.ncon` files are its readable, diffable text form, used for the seed, packs, export and
  import. The graph is always readable and writable in N-Con.

## 2. Principles

1. **Everything is a concept.** A word, a sense, a thing, a kind, an action, a mode, a rule, a
   source.
2. **No string decides meaning.** Text from any source is understood into structure, or kept as
   content in a content store that concepts refer to (section 4). Keal: "just a straight up string
   that is never used is not helpful."
3. **Meaning is rewriting; acting is code at the bottom.** A word means what it expands to. It acts
   when the expansion reaches primitives, and only primitives are code.
4. **Words name states and results, not operations.** "left" in "how many are left" names what
   remains; subtraction is how it is computed.
5. **Kinds are weighted guesses, decided by evidence.**
6. **Several readings; a learned score picks** (section 9). Ask when the expected cost of acting on
   the top reading exceeds the cost of asking, and never when the top readings lead to the same act.
7. **Honest when stuck**, and saying why (section 23).
8. **Answer by kind.**
9. **Everything learned carries provenance and a trust level** (section 20). Sources are concepts,
   and the list of sources is open: the user can add one, and the assistant can add one it found
   through its own research.
10. **Corrections are the main teacher.**
11. **The runtime executes concepts only as far as it has to.** The meat and potatoes are in the
    graph. The runtime knows no English and owns no meaning; it is a handful of algorithms (store,
    match, parse, score, rewrite, run, remember the conversation), and nothing in it is about any
    particular word.
12. **No grammar in the runtime; every rule lives on its word.** A rule like "When before something
    makes it a time" is not in the runtime. It is a fact or reading on the concept When, used at
    parse time. Taken together, the words' entries are a lexicalized grammar (every rule on a word,
    as in CCG or HPSG); that is exactly what Keal means by "no grammar": there is no grammar
    *outside* the words. The runtime has only a few universal combining steps that no word owns,
    listed in section 8.
13. **Same meaning, same reading.** Keal's phrasing, a plain paraphrase and a benchmark phrasing of
    one request are understood as the same expression (section 26 defines "same").
14. **Fix understanding, never the test.** Keal:

    > "we never use grammars or structures explicitly to address test issues. we try to address the
    > UNDERSTANDING on a grander scale or the interpretation or learning or whatever other avenue
    > could be used ... rather than writing in the code like `if (args == "do this") then call
    > Do_This(...)`. we need to give the realization, relations, whatever to the concept, not to the
    > runtime."

    A failing case is never fixed by a rule, reading, fact or branch aimed at that case. It is fixed
    by improving how words are understood, how readings are chosen, what is learned, or which
    sources are used, and the fix lives on concepts, never in the runtime. This is also the guard
    against tuning to test data the author has seen.

## 3. What the data says

1,595 items were analysed, each with a drafted expectation of what it means. The drafts, and the
tags behind the table below, were written by model subagents from a shared schema; they set
priorities, and they are validated by Keal's hand-check (section 26) before anything rests on them.

- **Real** (700): Keal's own prompts to AI coding assistants (Claude Code, Codex), across 50
  projects.
- **Bench** (775): 25 items from each of 31 benchmarks and assistant datasets: MASSIVE, CLINC150,
  SNIPS, MultiWOZ, Schema-Guided Dialogue, Taskmaster, Natural Questions, TriviaQA, HotpotQA,
  SQuAD v2, BoolQ, StrategyQA, GSM8K, ARC, CommonsenseQA, PIQA, SIQA, HellaSwag, WinoGrande,
  COPA, MMLU, TruthfulQA, WiC, DROP, FLUTE, PIE, IFEval, MT-Bench, WildChat, Dolly, Alpaca.
- **Test prompts** (120): prompts Keal typed while testing the prototype. Low weight.

Denominators: 3,346 is every message Keal typed that was extracted (223 automated Codex heartbeats,
which contain no git words, are excluded); 3,226 of them are to coding assistants (the rest to the
prototype); 700 were sampled for analysis. The benchmark analysis is
background for the design as a whole, not input to the experiment.

Percent of items with each feature (model-tagged):

| | Test prompts | Real | Bench |
|---|---|---|---|
| Needs an expansion (indirect request, idiom, filler, slang, typo) | 58 | 75 | 33 |
| Points at something ("it", "that", "the plan") | 43 | 62 | 31 |
| Real ambiguity to decide | 23 | 39 | 34 |
| Several asks in one message | 8 | 23 | 3 |
| Conditions ("if", "unless", "only if") | 1 | 22 | 2 |
| Constraints (don't X, length, format, scope) | 3 | 27 | 17 |
| Negation | 0 | 16 | 5 |
| Typo / slang / profanity | 8 / 8 / 0 | 20 / 21 / 14 | 3 / 0 / 0 |
| Comparison / quantity / date-time | 3 / 6 / 8 | 12 / 15 / 5 | 16 / 13 / 11 |
| Code / file / UI reference | 3 / 0 / 0 | 23 / 12 / 11 | 1 / 0 / 0 |
| Correction | 4 | 10 | 1 |

- Real prompts are hard on **understanding and the conversation**; benchmarks on **knowledge**.
- The analysts guessed how many benchmark items a concept graph could handle (372 fully, 359
  partly, 44 not at all). That is a **model-estimated upper bound, unvalidated**; several of these
  benchmarks were built to defeat knowledge-base methods, which have historically scored near
  chance on them.
- **Lists and reminders are almost absent from real use**: 8 of Keal's 3,226 prompts to coding
  assistants. Files and git are common: 265 of those 3,226 mention a git word, 126 of them short. Many of those are
  compound or reach outside a small act set (merge, pull, checkout, pull requests), so the
  experiment's act set is widened to what the labelled data contains, and n is counted, not assumed
  (section 29).
- **A labelled sample** of 300 git-ish prompts (read, not keyword-matched): 27 single-act git or
  file requests, 25 multi-act (mostly "commit and push"), the rest reviews, discussion, questions or
  pasted content; only 2 of the 27 single-act requests did not name the command. Projected: about 6
  single-act and 5 multi-act requests a week, and about 0.4 a week that do not name the command. In
  real use the command is named; what needs understanding is everything around it (section 29).
- **The full labelling** (every git-ish prompt plus a random 100, labelled by Keal and model drafts
  he spot-checked): of 216 requests with a git act, 173 name the command in the prompt, 33 name it
  only in the four turns before (usually the assistant's own proposal, then "do it" or "go"), and 10
  nowhere (mostly the default chain inferred, as in "ci failing"; genuinely different words only
  about 3 times: "undo" twice, "use work trees"). Keal: he would not phrase these any other way.
  When the name is missing, the conversation carries it, not a synonym.
- The real prompts were written to language models; prompts to an assistant without one may be
  shorter and more command-like. The distribution shift runs both ways and is noted, not corrected.

Focused cuts of the real prompts:

- **Call-outs** (120 real, from 180 candidates, each paired with what the assistant had just done):
  underdid 19, misread intent 18, did not verify 14, ignored an instruction 13, overreach (acted
  when it should have asked, or did more than asked) 10, asked instead of acting 8, hallucinated 7.
  **Both directions of the ask-or-act error occur**: too cautious (asked instead of acting 8,
  plus stopping early inside "underdid" 19) and too bold (overreach 10). The cautious direction is
  called out more often, and it is the one the threshold should lean against, while guards
  (section 13) keep the bold direction safe for consequential acts.
- **Files** (150): edit 22, read 20, create 9, fix 8, review 6, find 6, refactor 5. Named by path,
  as "the plan / the doc / the PR", by URL, by @mention, by convention, or as a bare path meaning
  "look at this and act on it".
- **Explanations** (150): about 45 need a record of what the assistant did and why; about 13% are
  really challenges, where the right answer corrects first.

## 4. The shape of a concept, and the content store

A concept has two kinds of content:

- **Facts**: what is true of it. A fact can hold only in a sense (section 5), and can carry a time.
- **Readings**: what it, applied to things, becomes.

A reading has:

- a **pattern** over lemmas and roles, so "spilled the beans", "the beans were spilled" and "don't
  spill the beans" match the same reading;
- **wants**: what it prefers of its arguments and neighbours (kinds, shapes), which become score
  features (section 9);
- **becomes**: another expression (a rewrite) or code (a primitive);
- **needs**: what must be known or obtained before it can act;
- **effects and checks**, for readings that act (section 15);
- a **mode**, when it only applies while speaking, supposing or doing (section 7).

Everything that turns into something else is a reading: a synonym, a multi-word name, an idiom
(`Let(Cat(Out(Of(Bag()))))` becomes `Reveal(Secret())` unless a literal cat is in play), an
indirect request (`Can(You(), $x)` becomes `$x` when `$x` is doable), a definition, a behaviour
(`Add($x, To($c))` with `$c` a Holder becomes the code that stores it).

**Rewriting runs both ways.** Expanding turns a concept into what it means (a definition, an
indirect request). **Collapsing** turns words into the one concept they name together: a multi-word
name (`Work(In(Progress()))` to `WorkInProgress`), an idiom, a title or a nickname
(`Man(Of(Steel()))` to Superman, or to the 2013 film). Collapse candidates come from names, aliases
and titles in the sources (Wikidata lists "Man of Steel" as an alias of Superman and as the title of
the film; Wiktionary lists idioms) and enter the chart as competing readings beside the literal one.
Evidence picks: capitalization or quotes raise the name readings, "watch" or "the new" raise the
film, and "he's a real man of steel" keeps the literal reading; close ones are asked about like any
other.

**The content store** keeps text that is content, not meaning (file contents, a draft, a quote, a
URL, a source's original words) as blocks with ids that concepts refer to. Blocks never decide
meaning.

## 5. Words, senses, forms

- **A word is its forms.** "Alternative form of X" is identity for understanding. Forms come from a
  lexicon.
- **Senses are coarse, and split only where behaviour differs.** Fine-grained sense
  disambiguation has a long-standing ceiling around 65 to 72 percent; coarse groupings reach about
  80 percent in the literature, which is better, not solved. Senses start from WordNet synsets
  grouped where OntoNotes sense groupings exist, and elsewhere clustered by shared VerbNet class (for
  verbs) or shared near hypernym (for nouns); coverage of the domain's lemmas is reported. A word
  keeps two senses apart where they lead to different facts or acts. Since acts are what the assistant does, the test "does the act differ" is applied as acts
  are added: two senses merged at import are split the first time a correction shows they need
  different acts.
- **Hearing stays close to the words; senses come later.** Keal: "the original intent was to make
  the parser [turn] messy human english [into a] nearly super obvious or close to obvious
  representation in ncon so that its easy to parse human english and get a close to correct parse
  without needing to look everything up ... and then concepts that miss something can be identified
  and filled". So the heard N-Con uses **word concepts**, as close to what was said as possible:
  "add milk to my shopping list" is `Add(Milk(), To(My(List(Shopping()))))`. Senses never appear in
  it. A sense is chosen during evaluation, only when a reading needs one: `Add($x, To($c))` wants a
  holder, so `List` resolves to its holding sense; if nothing needs a sense, none is picked. A word
  with no sense that fits is the gap: a residual, filled by looking it up, learning it, or asking.
- **A concept per sense, named by what it is.** A word is a concept of its own (its forms and its
  senses); each sense is its own concept, named `Word#WhatItIs` from the sense's own meaning (its
  nearest broader kind or closest synonym), with part of speech as a fact, not part of the name:

  ```
  Word("list", forms: List(lists, listed, listing), senses: List(List#Series, List#Enumerate, List#Lean))
  List#Series     IsA(Series), Holds(Item()), Category(Noun), from: WordNet("list.n.01")
  List#Enumerate  IsA(Say), Takes(Thing(), Order()), Category(Verb)
  Push#Publish    IsA(Send), To(Remote()), from: gitglossary / git-push(1)
  Ears#HearingLayer  from: Keal
  ```

  If two senses would get the same name, the next broader kind breaks the tie. Sense names are
  plumbing: they show in traces and the reasons log, not in what is heard.
- **A sense can be the user's own** ("ears means the hearing layer"), mapped to the same concept
  anyone else would use for that meaning, so the user's words and a paraphraser's reach one
  concept.
- **Part of speech is a fact about a word**; a statistical tagger is at most a tiebreak for words
  the graph does not know yet.
- **Pronunciation is a fact about a word** (from Wiktionary's IPA), so the assistant can match by
  sound (section 8).

## 6. The seed

Definitions are understood by the understander, which needs definitions. The circle needs a base,
and the base is hand-written, small, counted and frozen:

1. **Core meanings**: a few hundred, in the style of semantic primes and VerbNet's semantic
   predicates (someone, something, do, happen, have, be in, part of, cause, before, after, more,
   not, can, want, know, say, and similar).
2. **The function-word lexicon**: the entries for closed-class words, which no import supplies with
   machine-usable valence. "the" takes a thing after it; "when" opens a time; "near" takes a place;
   "if", "then", "only", "not", "every", "except" build the logical form (section 11); "and" joins
   two of the same kind; "then", "first", "after that" order steps; correction signals and tone
   words are marked as such. This is part of the seed, not the runtime; it lives on the words.
3. **The bridge**: a table from verb meanings (VerbNet predicates and frames) to primitives:
   `has_state` of containment to Store or Remove, `transfer` to Send, and so on. Without it, import
   alone reaches no primitive at all, so it is named, written once from the design (never from the
   test data), frozen before the experiment, and its entries are counted. Results are reported
   with and without it.

Every learned meaning must **bottom out** in the seed within a bounded number of expansion steps.
A definition that cannot is kept pending, and its unknown words go on the to-do list.

**Two different base cases, measured separately:**

- **Reduces to core meanings**: the expansion is made only of core meanings ("to make a set of
  changes permanent" reduces to cause, become, permanent, change). This is understanding.
- **Reaches a primitive**: the expansion ends in something that runs. This is acting.

**The step between them is the bridge.** Bridge entries map patterns of core meanings (and VerbNet
frames) to primitives: `Cause(Become(Contains($holder, $thing)))` to Store, `Cause(Not(Exist($x)))`
to Remove, `Cause(Become(Known($x, $someone)))` to Say or Send. Commands reach primitives through
the tools' own documentation (section 25): git's `--help` and man pages, understood, give readings
like "`git push` sends local commits to a remote", which reduce to core meanings and meet the
bridge at Run. The bridge never names a domain command; a command is always learned from its
documentation. The route to Run, exactly: understanding a documentation page yields a reading whose
pattern is the page's description, reduced to core meanings (for `git push`, roughly
`Cause(Become(Has(Remote(), Commits(Local()))))`), and whose becomes is `Run(Command(page), args)`,
with the argument template from its SYNOPSIS. The bridge entry that reaches Run is general, the
same for any documented tool: *a reading learned from a tool's documentation page becomes Run of
that page's command*. A request reaches it when its own reduction matches the description's; the
command's name is one way to match (a sense learned from the page), and paraphrases with no
command word must match through core meanings. That is why go is judged on the requests without the
command's name. The bridge is where the hard part lives, so it is small, counted, written from the
design, and frozen.

**Coverage and precision are both measured**: the fraction of the domain's lemmas whose senses
bottom out after import, and, for a sample of 50 bottomed-out senses graded by hand, whether the
expansion is right. Earlier "read the dictionary" projects (Cyc's knowledge acquisition, MindNet,
Extended WordNet's logical forms) reached coverage with poor precision; precision is the number
that matters.

**Also in the seed:**

4. **Lexical rules**: how forms line up roles (the passive: "be" plus a past participle swaps who does
   and who is done to; questions and imperatives; fronted phrases). In lexicalized grammars these are
   lexical rules; here they are readings on forms and on the auxiliary words, written by hand,
   counted.
5. **Initial weights**: the score's starting weights before any learning (the sense-frequency prior,
   words used, roles filled with a wanted kind, shape fit, and, in stage two, "reached an act or an
   answer" at weight 1; everything else at 0), counted and frozen for arm A. "Reached an act" is a
   strong prior toward the executable reading (it is what lets the git sense of "push" beat the
   physical one); it is named, and ablated in the experiment.
6. **Default policies**: the lessons of section 17 that act as defaults ("keep going until done",
   "verify before claiming done", "stop means no further steps"), written as standing rules at seed
   level, counted, and overridable by the user's own.
7. **Genre shapes** for writing (what a summary of a change, a letter, a plan usually has), loose,
   counted. A commit message is the summary-of-a-change shape, which is the same for any project,
   not a git-specific template.
8. **English realizations**: the wordings the assistant says (an honest "I don't know", an offer
   before a guarded act, the echo of a rule it heard, a result), as readings in Speaking, counted;
   and the media realizations that turn a document into markdown or plain text (section 25).

The **core meanings are a closed list**, published before stage 0, so "reduces to core meanings" has
a fixed floor; a reduction that needs a word outside the list does not reduce.

**Default policies compile to plan rules**: "keep going until done" means a Sequence runs every step
without asking between them unless a guard or a failed check stops it; "verify before claiming
done" means Say of a completion requires the goal check (section 15) to have passed; "stop means no
further steps" means a stop marks the plan interrupted at the current checkpoint.

**Size estimate, by part** (an estimate to be checked when the seed is drafted, and a cap
that makes growth a decision): core meanings about 300; function-word lexicon about 400 entries;
lexical rules about 30; bridge about 50; initial weights about 10; default policies about 20; genre
shapes about 10; English realizations about 60. About 1,000 entries in total. There is no hard cap: every entry is counted and reported,
and if drafting shows a part needs far more than its estimate (the function-word lexicon for messy
prompts, most likely), that is a finding, reported.
Parse coverage is reported per construction type (questions, imperatives, passives, conditionals,
constraints, fragments), not only overall.

**Definitions are understood at import**, once, starting with the experiment's vocabulary and the
most common words; the rest are queued and understood in the background, so nothing waits on it in
a conversation. **Imported senses are candidates**: they compete on their sense-frequency prior,
and use (picks, corrections, acts that worked) quickly outweighs it.

**Domain vocabulary** beyond the top 5,000 words (rebase, stash, HEAD, remote, ref, index, working
tree), whose tool senses no dictionary has, is **prefetched at import** from the tools' own
glossaries first (for git: `gitglossary(7)` and `gitcli(7)`), then the tools' documentation, then
Wiktionary. A glossary definition is understood like any definition: it reduces to core meanings
and to other glossary terms, recursively, to a bounded depth; a cycle between glossary terms (a ref
defined through an object, an object through a ref) is kept as mutually defined terms, grounded
wherever one of them reduces to core meanings; a term that cannot be grounded that way stays
pending, and its readings reach no primitive.

**No core meaning is domain-specific.** Every core meaning passes a check reviewed before the
freeze: would it be in the list for a cooking assistant or a calendar? `Remote` and `Commits` would
not, so they can never be core meanings; they are learned from the glossary. so understanding never waits on the network. A
word met for the first time mid-parse is skipped (at its cost) and goes on the to-do list; it is
learned after the turn.

**Understanding definitions is needed by arm A+** (a documentation page is definitions), so it is
part of the first round, not the second.

**A documented command's name gives its word a sense.** git's documentation says the command
`git-push` "updates remote refs"; that teaches the word "push" a new sense, the git one, at the
documentation's trust level, exactly as a user teaching a word does. That is learning a sense from a
source, not a string match on a command name, and it is how "push" in a request reaches
`git push`.

The seed is reviewed by Keal and every entry is counted.
The function-word lexicon and the meaning of the logical form's operators (section 11) are part of
the protected base (section 20): no learned reading may rewrite them.

## 7. Modes and evidence

"Context" was being used for two different things. Keal:

> "what I originally wanted for context was something more like that than like a very strict,
> this is what this means in this context"

- **Modes** are how something is being run: **Speaking** (saying a result), **Supposing** (working
  out what would happen, changing nothing), **Doing** (acting). A mode is set only by the
  primitive being run: Say runs Speaking, Suppose runs Supposing, and every other primitive runs
  Doing. Nothing in understanding sets a mode; a reading may *require* a mode (a Speaking realization), which is not setting one.
  Quotation and mention are not modes: they are node types in the logical form (section 11), inside
  which nothing is evaluated.
- **Evidence** is everything a thing is next to: other words, their kinds, what the conversation is
  about, what the user has been doing, the message's tone. Evidence is scored, never a switch.

## 8. Understanding a message

**Before the chart.**

- **Gather the candidate set** (section 14b): a small, bounded set of names and things from the
  conversation, recent conversations, the user's own words and the workspace, used below for
  surroundings candidates, neighbour and kind features, and reference candidates.
- **Set aside what is not language**: tool wrappers, pasted file headers, image tags, transcript
  markers, pasted content (into the content store).
- **Segment** long messages into sentences and clauses, using facts on punctuation and on
  clause-opening words (section 6), so each chart is short (section 24). A segment boundary is a
  scored choice, not a cut: alternatives are kept where a boundary is unclear (at most two
  segmentations per message, chosen by the score of their best parses), and references
  across segments ("fix it. then commit it") are resolved by the conversation structure (section
  14), not inside one chart.
- **Look up words** (lemma, forms, parts of speech, the user's own words) and propose corrections as
  competing tokens, never silently:
  - **by spelling**: edit distance, swapped letters and neighbouring keys ("teh", "taht", "cna"); the
    keyboard layout is data (a fact on the user's input), not code;
  - **by sound**: words that sound alike, from pronunciation facts ("fone", "tuff");
  - **by stretching**: exaggerated words ("sooooooo", "looooollll", "llllooolllll") propose the forms
    with each run of a repeated letter squeezed to one or two ("so", "lol", "lool"), and the stretch
    itself is kept as tone (emphasis, intensity). Keal: "noodle also needs to be able to handle my
    stupid bs like `sooooooo` and `looooollll`". Squeezing letter runs is character mechanics, the
    same for any language, so it is runtime mechanism, not an English rule;
  - **from the surroundings**: names in Focus's candidate set (files in the folder, branches, things in
    play), so "agent.md" where `agents.md` exists is the obvious reading;
  - and **the chart decides**: "taht" proposes *that* and *Taht* (a family name in Wikidata); *that*
    wins because it fits the sentence and is far more common, with no special rule.
- **Shapes propose kinds** (five digits, `#` and digits, a path, a URL, `snake_case`, "5pm"), from
  facts on shape kinds (`ZipCode HasShape(Digits(5))`), sourced where a source has them.
- **Markup is heard, not stripped** (section 25b): markdown's marks are tokens with entries in the
  function-word lexicon, like punctuation, and the chart reads them as it reads quotation marks.

**The chart.** Lexicalized, head-driven chart parsing: every rule is on a word (principle 12). The
runtime's only universal combining steps are:

The chart's size is measured on real prompts (with spelling, sound and stretch alternatives and
several senses per token) before k is fixed.

1. **Take**: a word whose entry takes an argument on a side (left or right, as its entry says)
   combines with an adjacent span that fits the argument's kind.
2. **Modify**: a word whose entry modifies a kind attaches to an adjacent span of that kind.
3. **Join**: a word whose entry joins (such as "and") combines two adjacent spans of the same kind.
4. **Skip**: a token is left out, at a learned cost, so a message with an unknown or garbled word
   still gets a partial parse instead of none.

5. **Compose**: two adjacent partial heads combine when one takes what the other still lacks
   (forward and backward composition, as in CCG), which is what "commit the plan and push" and
   "the file I edited" need.
6. **Gap**: a phrase whose argument is displaced (an object relative, a wh-question: "which branch
   did you push?") leaves a gap that the displaced phrase fills, threaded through the chart.

These six steps are universal: none is about a word. Everything else (which side a head takes its
arguments on, how passive or fronted phrases line up their roles, what "the" or "when" do) is
facts on words and forms.

**Category and kind are different.** A word's **syntactic category** (what it combines with) is a
hard constraint in the chart; its **semantic kind** (a branch, a file, a place) is a soft feature in
the score, so metaphor and domain senses ("push the fix", "kill the server") are not ruled out.

**Declared out of scope for the experiment** (reported when met, not parsed): ellipsis across
sentences beyond fragments filling holes, gapping ("commit A and B too"), comparatives with deleted
material, and nested quotations. Multi-word names, idioms and
phrasal verbs are spans matched over lemmas and roles.

**Pruning**: the top k readings per span (k small, such as 4 to 8) by stage-one score. Spans give
pruning its constituents, so ambiguity is cut at every level instead of at the end.

**Partial parses** are always allowed. Keal's prompts are long, fragmentary and messy; a strict
parser that needs every word to fit is brittle in exactly the way symbolic language systems were
in the 1990s. So the first number measured is how often any parse (full or partial) exists on the
real prompts.

**Neighbours vote** through features: "server" near 8080 raises Port; "store near me" near 85257
raises ZipCode; "the author of" raises Dune the novel; "kill" makes Hamlet the character.

**Tone** (profanity, "lol", "like", "idk") is kept as the message's tone, not its content, and is
evidence available to everything downstream. Tone words are seed facts with weights. Sarcasm
detection is out of scope for the experiment; a sarcastic correction there is treated as a plain
one only if its words already signal a correction.

**No network during understanding.**

## 9. Choosing a reading: the score

Keal:

> "maybe we give it like a score ... this version is really good score. This version, yeah, it
> doesn't make a ton of sense how it's being said ... if they have almost the same score ... we
> just ask the user"

**Two stages, one after the other:**

1. **Stage one, in the chart**: a log-linear score over named features picks the top k readings
   per span and for the whole message, with no network and no effects. Features:
   - words used (and a cost per skipped word);
   - each role filled with a wanted kind;
   - shape fit;
   - neighbour features, with backoff: exact neighbour word, then its kind, then the conversation's
     topic;
   - sense frequency (from imported sense counts);
   - evidence from past picks and corrections: counts of (word, neighbour, chosen sense) and (word,
     neighbour, chosen reading), with backoff from exact neighbour to neighbour kind.
2. **Stage two, a dry run**: each of the top few readings is evaluated with **Suppose**: effectful
   primitives are captured and not applied; **pure** primitives (reading a file, the repo's status
   or diff, the graph, the cache) run, within a small budget; network lookups use only what is
   cached. A second score reranks the readings using what the dry run found: whether it reached an
   act or an answer, whether its needs could be met, whether its effects' checks would pass. The
   stage-two score is a log-linear model too, trained by the same update on its own features.

Only then does **Doing** run, on the winner, or the assistant asks.

**Learning** is latent-variable structured perceptron. A typed correction or a pick gives the
right act, not the right parse, so the update moves toward the highest-scoring derivation that
reaches the right act, and away from the chosen one. That signal reaches scope, constraint
attachment and referents only when they change the act, so the experiment's oracle arm supplies
the **full normal form** (act, arguments, referents, constraints), and the report states which
parts of the reading were learned from which signal. Known risk: a wrong derivation that happens to reach the
right act gets reinforced. Mitigations: few feature templates in the experiment, a cap on how much
one correction can move a weight, and learning curves reported rather than one number (section
29).

**Calibration data**: a slice of the exploratory labels is held apart from the perceptron's training
and used only to calibrate; asking is evaluated there on a risk-coverage curve, at a pre-registered
operating point.

**Asking** is a decision with an explicit cost. The top reading's probability is calibrated against
how often it was right; the assistant asks when the expected cost of acting on the top reading
(the probability it is wrong, times the cost of that mistake) exceeds the cost of asking. The ratio
of those two costs is a stated parameter, not a finding: the call-out counts (asking or stopping
called out more than overreach) suggest asking is the more annoying error, so the starting ratio
leans against asking, and results are reported across a range of ratios. Consequential acts are
held by guards (section 13) whatever the score. If the top readings lead to the same act, the
assistant never asks.

**Matching a request to a reading.** Most of the bet rests on this step: a request's reduction
reaching a reading whose pattern is another text's reduction (a documentation description, a
definition). Two reductions built separately from different texts rarely come out identical (the
failure of Extended WordNet's logical forms and of conceptual-dependency paraphrase systems), so the
match is **scored, not exact**:

- **Unification with slack**: the request's reduction and the reading's pattern are aligned node by
  node (a predicate with its roles); aligned nodes must agree on category; kinds may differ at a
  cost that grows with their distance in the kind hierarchy.
- **Features of a match**: the fraction of the pattern's core-meaning nodes the request covers;
  the fraction of the request's nodes left unmatched; the kind distance of each aligned argument;
  whether the request's arguments fill the reading's required roles (a Run template's arguments).
- **Threshold**: a match below a threshold is not a candidate; above it, the match features enter
  the stage-one score like any other.

Week 1 tests exactly this, by hand, before a parser exists (section 29).

Every decision can be explained by which features fired.

## 10. Acting, expanding, and the primitives

Evaluating a reading rewrites it until it reaches primitives, which run. There is no fixed order of
"code first, then rewrite": the score picked the reading, and the reading says what it becomes. An
idiom reading like `Add(Value())` beats arithmetic because it scored higher (its pattern and wants
fit), not because idioms go first.

**Primitives** (the only code that touches the world, each declaring effects and checks, and each
marked **pure** (reads only) or **effectful** (changes something), which decides what Suppose may
run):

- Holding: Store, Remove, Contains, Set (a property).
- Knowing: Remember (a fact about the user), Compare, Count, Rank, Filter, Sort, Arithmetic, Now.
  Knowledge from the world comes only through Know (section 21), which is not a primitive callers
  use directly.
- Reading and writing: Read (a file, a page, an image, into the content store), Write/Edit.
- Doing: Run (a command), Schedule. Operate (driving a UI or a browser) is a project of its own and
  is deferred.
- Talking: Say, Ask.
- Supposing: Suppose (evaluate with effects captured, not applied).
- Sequencing: Sequence (run steps in order, passing results). Planning is not a primitive: a plan
  is what expansion with needs produces (section 12).

Git verbs, Teach, Watch, Speak, Revert, Constrain and Delegate are readings over these.

## 11. States, time, negation, scope and modality

Keal, correcting "left/remaining means subtract":

> "fairly certain these mean like the result AFTER something like subtraction"

**Words name states.** "how many are left" names the remaining quantity; "turn left" a direction;
"he left" departed; "left it on the counter" was put somewhere. Neighbours score which state fits.

Readings produce a **small logical form** over concept expressions. Its top level is always one of a
few **speech acts**, each with its own evaluation rule: **Question** (answer it), **Assert** (a claim
to check or remember), **Directive** (something to do), **Advice** (a request for a
recommendation), **Constraint** (a filter or prohibition on a plan, deciding what may run).
Assertions and constraints are kept apart: "nothing is failing" is a claim; "don't delete" is a rule
on the plan.

**Its type system and canonicalization are written in the N-Con spec (section 27) before any target
is frozen**: the operators and their argument kinds; role order is irrelevant (arguments are named
by role); sets are normalized (sorted, deduplicated); synonyms reach one canonical concept (Remove
and Delete, where they are the same act); tense is a time index, not a separate concept. "Same
normal form" is then decidable.

Scope is left open at parse time and settled by the score at evaluation, the way underspecified
semantics (MRS, Hole Semantics) does it: the logical form keeps scope constraints (which operator
may scope over which); the scoped readings they allow are enumerated (few, since requests are
short); and features choose among them (the operator's position, its word, past picks). Seed rewrites may go under any operator; learned rewrites
are held to the constraint invariant (section 20); an act under a prohibition is never run.
**Opaque contexts stop rewriting**: inside a quotation, a mention ("what does push mean", "don't say
X"), or text to be written, words are content or the topic, not instructions, and nothing inside
them runs.

Worked examples (the first ones to pass in the experiment):

| Said | Normal form | Evaluation rule |
|---|---|---|
| "don't push yet" | `Constraint(Not(Push(_)), until: Told())` | Push is blocked until the user lifts it in words the chart reads as permission for push ("ok push", "go ahead"); it lasts the session, and is echoed back if the user asks to push later |
| "only suggest, don't delete" | `Constraint(Only(Suggest(_)))`, `Constraint(Not(Delete(Any())))` over the plan | every step must be a suggestion; no Delete runs |
| "commit everything except the plan" | `Commit(Every(File, changed, except: Plan()))` | the set is the changed files minus the referent of "the plan" |
| "if it's already set up, add it to the readme" | `If(SetUp(It()), then: Add(It(), To(Readme())))` | check the condition in Suppose; run the branch only if true |
| "without committing, fix X" | `Constraint(Not(Commit(_)))` fronted, scoped over `Fix(X)` | scope is an attachment, scored; fronted constraints apply to what follows |
| "is it still broken?" | `Question(Holds(Broken(It()), during: Since(LastChange())))` | "still" means from the last change until now; LastChange comes from the event record |
| "you should run the tests" (said to the assistant) | `Directive(Run(Tests()))` | "should" said to the assistant is a Directive |
| "should I use tabs or spaces?" | `Advice(Choose(Tabs(), Spaces()), for: Me())` | "should I" asks for advice, answered conditionally |
| "delete all the branches except main" | `Delete(Every(Branch, except: Main()))` | guarded: a delete of many, offered first unless granted |
| "nothing is failing" | `Assert(Not(Some(Failing(_))))` | an assertion, checked, not a constraint |
| "any file that mentions X" | `Every(File, where: Mentions(X))` | a quantifier with a restriction |
| "revert that" | `Revert(That())` | "that" resolves to the last change made (section 16) |

## 12. Needs, plans and asking

A reading can say what it needs. When a need is not met: try to get it (through Focus, section 14b: the conversation, past
conversations, the user's facts, the workspace, then Know); if that fails, ask; if
that fails, stay unworked, honestly.

**Implied wants.** A bad state said to a helper implies wanting the good state ("ci is failing"
wants a fix; lost keys want finding, which needs a place last seen). Offer when the action has
consequences; act when it is only a lookup.

**A message is a plan**: ordered steps, later steps pointing at earlier results (including results
that do not exist yet when the message is heard, filled when the earlier step runs), conditions,
alternatives, constraints over the plan (scope scored like any attachment), mid-message
retraction ("actually nevermind"), and checkable output constraints with check-and-redo.

**State tracking**: who holds what, what is in what, a running balance, kept as facts with times,
changed only by primitives' declared effects.

## 13. Guards

Guards attach to **effect classes**, not to verbs or commands: deleting, overwriting history,
publishing, sending outside, spending money. Any primitive whose declared effects fall in a guarded
class is offered first ("I can delete these 12 branches; go ahead?") and runs when told, unless a
trusted grant lifts the guard (section 20). Because guards are by effect, a generic `Run` of a
shell command is guarded by what the command is known to do; an unknown command's effects are
unknown, and unknown is guarded.

## 14. The conversation is a structure

- **The last few readings with their choice points** and scores.
- **Past conversations**, kept in the graph as structure, not only the current one: their readings,
  what was in play in them, and the holders and things they created (a list started on Tuesday, a
  plan written last week), with the conversation and time they came from, so Focus (section 14b)
  can search them.
- **What is in play** (the list, the PR, the plan, the doc, the branch, the file just edited), with
  decay.
- **The last proposal and question**, so "sounds good", "1", "5b" resolve.
- **Open questions**, **standing rules**, **the reasons log**.
- **An event record** of what was done and what happened (edited, ran, failed), which references
  and salience need (section 16).
- **The assistant's own utterances, understood**: everything the assistant said (a plan, a list of
  options, an explanation) is understood into concepts too, so "the plan", "option 2" and "that
  approach" can refer to it. In the experiment's fixtures, the turns of the assistant the prompts
  were originally written to (another model) are understood the same way, so references into its
  prose can be graded; referent accuracy is reported separately for referents that depend on those
  foreign turns and ones that do not, and the foreign-turn referents never feed the go decision.

**Asides are not answers.** Keal:

> "i havent read your response (i do this alot, we should ensure that if a response says it
> hasnt read or acknowledged a prior message that its not interpreted as a response)"

**The reasons log** records why: which reading won and on which features, which need drove a
lookup, which rule or grant allowed an action.

**Presuppositions are checked**; a failed premise is itself the answer.

## 14b. Focus: what is relevant, and getting it

The prototype called this Focus. The pieces of "what is relevant to this message" are used in
sections 8, 12, 14, 16 and 21; this is the one mechanism that gathers them.

Keal's framing:

> "what Napkin called Focus or Attention, that did the pulling in of relevant data for each prompt
> from files, prior conversation history, fetching web sources etc. to help inform, fill gaps ... so
> you can like add to a list you started or have it do web research and tell you about that."

**Focus is how the assistant decides what, beyond the message's own words, is relevant to it, and
gets it.** It is not a retrieval step that runs before understanding and stuffs context in (that is
how language-model systems work, and it would make relevance a guess made before the meaning is
known). Here, **what a reading needs decides what is worth pulling in**, and everything pulled in is
scored, budgeted, and recorded.

**Where relevant things come from.**

1. **The current conversation** (section 14): what is in play, the last proposal and question, the
   event record, the assistant's own words understood into concepts.
2. **Past conversations**: earlier conversations' readings, what was in play in them, and the
   holders and things they created (a list started on Tuesday, a plan written last week, a branch
   discussed yesterday). Stored in the graph like everything else, with the conversation and time
   they came from.
3. **Long-term facts about the user**: what the user told the assistant or the assistant learned
   (their name, their projects, their own senses of words, their standing rules), with dates, since
   they can go stale (section 21's freshness).
4. **The workspace**: the files that exist, their names and kinds, the repository's state (branch,
   changes, remotes), what was recently edited. Read only through pure primitives (Read, git
   porcelain output as structure), so looking never changes anything.
5. **The world**: through `Know` only (section 21): the graph first, then the live sources, in order
   of trust.

**Two phases.**

**Before the chart: cheap, local, no network.** A small candidate set is gathered from sources 1 to
4: things in play, names from recent conversations, the user's own words and senses, and the
workspace's names (files, branches). It is used for:

- spelling and surroundings candidates (section 8: "agent.md" where `agents.md` exists);
- neighbour and kind features in the score (a branch name in play raises the git sense of "push");
- reference candidates (section 16).

It is bounded (a fixed number of candidates per source, most salient first) so understanding keeps
its budget (section 24).

**During evaluation: driven by needs.** When a chosen reading needs something the message did not
say, Focus fetches it:

- **a referent** ("the list I started", "that doc", "the PR from yesterday"): searched in the current
  conversation, then past conversations, then the workspace, scored by kind, salience and recency;
- **a fact** ("what's my manager's name?"): the long-term user facts, then Know;
- **a state** ("what changed?", "is it pushed?"): the workspace, through pure primitives;
- **knowledge** ("tell me about X", "what does Y cost?"): Know, across its sources.

Only when every source fails does the need become a question to the user (section 12's order: get
it, then ask, then stay unworked honestly).

**Scoring and budget.**

- Every candidate from Focus is scored with the same log-linear score as everything else (section
  9), with features for its source (current conversation, past conversation, user facts, workspace,
  world), its kind match, its salience in the event record, its recency, and its trust.
- Each turn has a budget: a bounded number of lookups per source, a time limit for the network, and
  a cap on how far back past conversations are searched unless the words ask for it ("the list from
  last month").
- A candidate that fits no need and no reference is dropped, not kept "in case".

**Recorded.**

Everything Focus pulled in, and why (which need or reference asked for it, which feature won), goes
into the reasons log (section 14), so "why did you think I meant that list?" has an answer, and a
correction ("no, the other list") can shift the features that chose it (section 17).

**Worked examples.**

| Said | What Focus does |
|---|---|
| "add eggs to the list I started Tuesday" | `Add(Eggs(), To(List(Started(By(Me()), On(Tuesday())))))`; Add wants a holder; the referent is searched in past conversations with the date restriction; the list found is used; the reasons log records the conversation it came from |
| "add eggs" (a list is in play) | no need to search: the list in play fills the holder (section 16) |
| "what changed?" | a state need; Focus reads the repository's status and diff (pure); the answer is built from that structure |
| "look into sourdough starters and tell me about them" | a knowledge need; Focus asks Know across sources (Wikidata, Wiktionary, sister-project pages, the web), within the budget; the writing pipeline (section 25) turns what came back into an explanation, with its sources named |
| "open the plan" | a referent of kind document; the most recent plan in play or in the workspace; if two are close, asked |
| "remember I'm allergic to peanuts" | a long-term user fact, stored with its date and source; later "can I eat this?" finds it through Focus |

**Research as a task.**

"Research X and tell me about it" was not written anywhere. It is Focus plus writing:

1. Know gathers facts about X from its sources, in order of trust, within the turn's budget (or a
   larger budget when the user asks for depth).
2. What comes back is understood into structure (section 2's principle), not pasted.
3. The writing pipeline (section 25) orders the facts into an explanation, says which source each
   came from, and says plainly what it could not find.

**Trust and privacy.**

- Past conversations and user facts are the user's own data: level 1 trust when the user said them,
  never shared outside the machine.
- Workspace files are read at the trust of their origin (section 20): the project's instruction file
  at level 2, its AGENTS.md, READMEs and help text at level 3, other files of the user's own project
  at level 2, and every file of a cloned or unfamiliar repository at level 3, so a file cannot
  inject behaviour just by being found.
- What Focus fetches from the world keeps its source's trust level.

**In the experiment.**

The experiment (section 29) needs sources 1 and 4 (the current conversation and the workspace, both
captured in each fixture). Past-conversation memory and long-term user facts are out of its scope,
except where a fixture's prior turns include them. Research as a task comes after a go.

## 15. Effects, goals and verification

Two different checks:

- **The effect check**: did the primitive do what it declared? (Store: the holder contains the item.
  Edit: the file has the change. Run: the exit status and expected output.)
- **The goal check**: did the user's want get met? It comes from the implied want (section 12): "fix
  the failing test" means the test passes afterwards; "push it" means the remote ref matches.
  Where a goal check cannot be derived from the words and the kinds involved, the assistant says so
  ("I made the change; I can't tell whether that fixes it") instead of claiming done. In the
  experiment, goal checks exist only for acts whose goal is a git or file state (committed, pushed,
  branch exists, file contains); "fix the failing test" style goals are out of scope.

In the experiment, git commands get their declared effects from their documentation (section 25)
and run only in a sandbox repository per fixture, with a local bare remote, so push, revert and
branch deletion can be checked without touching anything real.

"Done" means both checks passed. This is the structural fix for Keal's most common call-outs (did
not verify 14, underdid 19, "still broken"). Declared effects bound the frame problem only as well
as they are declared: effects learned from documentation are uncertain (a pull merges, hooks run,
config changes behaviour), so effectful commands are followed by observing the state, not by
trusting the declaration; observation reads tools' machine formats (git's porcelain and plumbing
output) through Read, as structure, not as language to understand; changes by others are observed, not assumed.

## 16. References and fragments

- **Referents are scored**, not ranked by a fixed order: kind match ("push it" wants something
  pushable), salience from the event record (mentioned, acted on, just failed: "fix the test"
  means the one that failed) and recency are features in the score (section 9), like everything
  else.
- **Candidates come from Focus** (section 14b): what is in play first; past conversations and the
  workspace when the words or a need ask for them ("the list I started Tuesday", "that doc"),
  scored by kind, salience and recency like any other candidate.
- **Fragments fill holes**: a fragment ("github link", "look again?") fills the open need or choice
  point of the last reading whose kind it best matches; if its best match scores below a threshold set on the
  development set, it is a new message.

## 17. Corrections and learning from picks

A correction is an operation on the last reading: go back to its choice points, flip the one the
correction names, run again, and update the score (section 9).

**Signals** ("no", "I said", "when I said X I meant Y", "still", "again", "stop", questions that are
corrections, sarcasm read from tone) are facts on words in the seed's function-word lexicon.

**What a correction records**: the chosen reading and its alternatives with scores; the wanted
reading or broken rule; the signal words and what they bind to; which features moved; one-off or
standing; provenance. A correction can target behaviour, not only the last answer.

**What a correction may create** (all counted, all with provenance "correction", none hand-written):

- **weights** on the score's features;
- **a link from a word to an existing sense or concept** (the user's own sense of a word);
- **a sense split**, when one imported sense turns out to need two different acts;
- **a new reading made only of existing concepts** (a rewrite), as a proposal until confirmed
  (section 20).

**Split or weight**: a correction changes weights by default. It splits a sense only when the same
sense has been confirmed to need two different acts in two different cases; the split is then
proposed, and counted.

A correction never creates a primitive, a seed entry or a bridge entry. The bet's "nothing written
by hand" is about hand-written structure; learned structure is expected, and is counted apart.

**Picks teach the same way.**

**Lessons the call-outs taught**, most frequent first: don't stop mid-task once told to keep going;
verify before claiming done (section 15); when told "still broken", drop the last hypothesis; act on
exactly what the user named; check the real source when a claim is contradicted; take a term to
mean what the user says it means; stay inside the asked scope; "stop" and "discuss" mean no changes
until told; follow standing rules; finish every item asked.

## 18. Word lists live in the graph, and are counted

Order words, correction signals, tone words, question words, aside markers and shape kinds exist as
lexical facts. They live on words, in the graph (most in the seed's function-word lexicon), come from
imports, the seed or corrections, carry provenance, and every hand-written one is counted. In the
experiment, the seed is frozen: nothing is added by hand after it.

## 19. The instruction file

Keal:

> "what if napkin had its own agents.md style file that could be written in english and
> interpreted using napkins hearing and interpretation layers"

- The home instruction file (`~/.noodle/NOODLE.md`) and the project's own `NOODLE.md` are both
  read; the project's wins on conflict, within its trust level. A level without one
  falls back to that level's `AGENTS.md` (never CLAUDE.md).
- Each line is understood into a standing rule with its provenance; deleting the line deletes the
  rule; a line that cannot be understood is flagged.
- "From now on" corrections are written into the nearest instruction file (created if needed),
  never into AGENTS.md, as a proposal: the assistant echoes the rule it understood ("From now on I
  will keep PRs as drafts. Right?") and writes it once confirmed. **Interpretation confidence is
  kept apart from source trust**: a rule heard from the user is only as trustworthy as the
  assistant's understanding of it, so a misheard rule never silently becomes a top-trust behaviour.
- A project's instruction file can add standing rules for that project; it can never revoke or widen
  a grant from the home file, the config or the user. In a cloned or unfamiliar repository, an
  unreviewed project `NOODLE.md` is treated as level 3 until the user approves it once.
- Standing rules are checked before acting.

## 20. Trust and the protected base

Every fact carries a **trust level** from its source:

1. the user in the conversation, the home instruction file, and the config file;
2. the project's instruction file;
3. the project's `AGENTS.md`, READMEs, help text;
4. the web and other fetched pages.

- **Only level 1 grants permissions or lifts guards.** Level 2 sets standing rules for its project.
- **Readings from levels 3 and 4 are proposals**: they may not rewrite into a guarded effect class,
  and may not change the weights of readings from levels 1 and 2, until the user confirms them. A
  README that says "always force-push", or a page that redefines "clean up" as delete, cannot
  become behaviour on its own.
- **Derived trust is the minimum** of its inputs.
- **Trust and the shared score**: the score's features are shared across readings, so they are not
  partitioned by trust (that would stop generalising). Trust acts on readings instead: a reading
  from levels 3 and 4 carries a trust feature, may be scored and offered, but is not run until
  confirmed. The cost: a user correction that moves a shared weight also moves proposed readings'
  ranks; the confirmation gate, not the weights, is what keeps untrusted readings from acting.
- **What applies on its own and what waits.** So that Noodle can fix itself without Keal as a
  bottleneck: weights apply on their own (checked by the replay gate); word-to-sense links and sense splits taught
  by the user apply once two cases agree (a single correction is held as pending); rewrites taught by the user apply after the echo-and-confirm of
  section 19; readings from documentation and the web wait for confirmation only if they would run
  something effectful. The share of learned structure that needed confirmation is reported.
- **Weights are guarded too**: a learned weight change that would change the top reading of any
  hand-checked replay item must pass the replay gate; a guarded act always shows its target ("delete
  these 12 branches") so a wrong referent is caught at the offer.
- **The protected base** is outside everything the assistant can write: the config, the guards, the
  trust table, the function-word lexicon and the meaning of the logical form's operators, the
  corpus and its expectations (at `~/.napkin/corpus/`), the replay gate, and the scorer's evaluation
  code. One invariant is checked on every learned change: **no learned rewrite may widen what is
  permitted to run.** How it is checked: if a learned rewrite's output lacks a Constraint or a Not
  node its input had, the rewrite is run under Suppose on every replay item it applies to; it is
  allowed on its own only if none of those runs would execute an effectful primitive, and otherwise
  only after the user confirms it. That still lets Noodle learn "don't forget to push" (a push),
  "why not just rebase?" (a suggestion), "not bad" (good), "don't you think we should commit?" (a
  directive), while nothing learned can quietly turn a prohibition into an act. The seed lists these
  common constructions as function-word entries from the start. The graph plus Sequence is as expressive as code, so readings
  the assistant writes for itself are held to the same review as code it writes: proposals, until
  confirmed.
  No learned fact, reading or (later) self-written code can change them. Self-written runtime code,
  when it comes, is proposed as a diff for human review, never applied on its own. Self-modifying
  systems game their own checks (Eurisko's heuristic that credited itself is the classic case); the
  protected base is the answer to that.

**In the experiment**, the trust rules are relaxed on purpose: documentation readings are level 3,
but in the sandbox they run unconfirmed, because nothing there is real and the point is to measure
the system without human curation. Outside the sandbox the rules above apply unchanged.

**The config** (`~/.noodle/config.json`) grants access: which commands may run, credentials, and
blanket permissions ("bypass permissions" for an effect class or all). How to use a tool is
knowledge, in the graph.

## 21. Learning: one door

> "couldnt we have a LookUp or Research or Learn that has multiple sources for looking shit up and
> adding it to the graph ... it feels crazy to have just rawdog calls everywhere"

```
anything that needs to know:  Know(Cake(), Recipe())   Know("commit", Senses())
                 |
  Know ---- 1. does the graph hold it (and is it fresh)? return it
            2. else ask the live sources, in order of trust
            3. UNDERSTAND what came back (down to the seed), or keep it as content
            4. save it with provenance and trust; return it
                 |
  Live sources: Senses (Wikidata) · Claims (Wikidata) · Dictionary (Wiktionary)
                · Pages (sister projects) · Query (SPARQL) · Web
                 |
  Fetch (inside Know only): cached per URL, throttled, retrying, one polite user agent
```

- **Know is Focus's route to the world** (section 14b): Focus never fetches on its own.
- **Imported sources** (WordNet, VerbNet, wordfreq, ConceptNet, ATOMIC, Kaikki) are loaded once
  into packs (section 22); **live sources** answer at run time through Know.
- Sources are concepts with facts (what they answer, how they are reached, license, trust, whether
  their answers are kept, how long they stay fresh). The user can add one; the assistant can add
  one it found, at low trust until proven.
- One implementation per question; what comes back is understood or kept as content; saved once,
  one way (an import record, then facts stamped from it).
- What each live source returns, from what uses need: Senses (id, label, description, popularity,
  kinds with ids and labels, sister-page titles, main-article flag), Dictionary (senses per part of
  speech in page order, pointers parsed once, pronunciations), Claims (batched, labelled), Pages
  (namespaces, search, text, sections and lists, license as a fact), Query (SPARQL), Web (search,
  page lists and text).

## 22. The base graph

> "we need to teach like a lot of the basics, like the very most common English words and the most
> common phrasings ... build that base so that it can actually do things properly"

| Need | Source | License |
|---|---|---|
| Which words (top ~5000) | wordfreq | data CC BY-SA 4.0 |
| Senses and sense relations | Open English WordNet (coarsened) | CC BY 4.0 |
| Forms, alternative forms, pronunciations, idioms, phrasal verbs | Wiktionary (Kaikki / wiktextract) | CC BY-SA |
| What verbs do to their arguments | VerbNet 3.4 (through the bridge, section 6) | permissive |
| Frames and roles, fallback | FrameNet | to confirm before import |
| Commonsense needs and effects | ConceptNet 5.7, ATOMIC 2020 | CC BY-SA / CC BY 4.0 |
| Senses tied to things | Wikidata lexemes | CC0 |

- Measured before building on it: the share of the domain's words that get a sense with a reading
  reaching a primitive after import, and the graded precision (section 6).
- ConceptNet and ATOMIC enter at low trust; they are noisy and free text.
- ShareAlike sources stay in separable packs.
- Imported senses are candidates, weighed by use.
- **Packs are versioned**; learned facts refer to the pack version they were built on; a migration
  path exists before the first real import.

## 23. How it talks when it does not know

Honest responses in Speaking, keyed by why it is stuck: no sense for a word; no source; no
permission; a need not met; two readings too close. The rate of "I don't know" on the real prompts
is tracked alongside accuracy.

## 24. Performance

- Understanding a segment takes under 200 ms, with no network. Long messages are segmented first
  (section 8), because chart cost grows with the cube of the length, multiplied by the number of
  entries per token (senses, spelling and sound alternatives). The budget is measured on the short
  in-domain prompts before it is committed to; if it is missed, k, the lattice width or
  segmentation is tuned, and the cost is reported, not hidden.
- Lookups happen in evaluation, cached, throttled, cancellable.
- The base graph loads fast enough to start a session without waiting: indexed by lemma, senses
  loaded lazily.
- The replay gate replays only the cases that touch what changed, plus a full replay in batches.

## 25. Tools, code, writing

**Tools are learned readings.** Keal:

> "commit and push assumes git is in the house and then it sequences git commit (with a decent
> message describing the committed code and only including the correct code) along with pushing
> after that. It shouldn't need tools to do that ... I'd prefer the graph since it is adaptable to
> be able to learn a tool or learn how to use them effectively when provided."

- "commit and push" is a composition: Commit needs a repository (checked by looking); it chooses the
  files this work changed (from the event record), writes a message, runs the commit, then Push;
  effects, goal checks and guards apply.
- **Learning a tool is understanding its documentation** (`--help`, a man page, a README) into
  readings realized as commands, at trust level 3, so proposals until confirmed.

**Code is language.** The assistant reads, understands, changes and writes code as it does English:
code becomes concepts (what a function takes, gives and does), changes are readings over them, and
the result is written back out. Programming languages have real grammars, and a four-step chart is
not the right tool for them: code is parsed by real parsers (tree-sitter) behind Read, which yield
content plus structure, and the structure becomes concepts. What the code *means* (what a function
is for, how a change relates to a request) is understood like any other meaning. There is no
hand-written "code version" of each instruction.

**Writing** is facts, an outline (genre shapes as loose defaults, never rigidly prescriptive), wording
(readings in Speaking), and a check against the stated constraints. What Speaking produces is a document, not a string; markup and media are
section 25b. Generating good prose without a
model is a research problem in its own right. The honest scope is letters, plans, summaries,
explanations, lists, reviews, and transforming given text. A commit message is a template over the
change's concepts (which files, what kind of change, the request it answers), and its constraint is
that it names every changed file's area and the request; it is not free prose. For long invented stories and scripts, the assistant says what it cannot do.

**Research as a task** ("research X and tell me about it") is Focus plus writing (section 14b):
Know gathers, what comes back is understood into structure, and writing orders it into an
explanation that names its sources and says what it could not find.

## 25b. Markup, heard and spoken

Markdown is how people stress, quote, list and link in text, and it is the chat's output format. So
it is heard as language and spoken as structure, with no markdown parser in the runtime and no rule
in code that says what a mark means. The inventory below is GitHub's
([basic writing and formatting syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)).

**One set of document heads, both ways.** `Paragraph`, `Heading(level)`, `List`, `Item`, `Task(done)`,
`Contrast`, `Important`, `Withdrawn`, `Inserted`, `Quote`, `Callout(kind)`, `Code`, `CodeBlock(language)`,
`Link(to)`, `Image(alt)`, `Note` (a footnote), `Break`. They are core meanings: hearing produces them
and Speaking's output is made of them.

**Hearing.** Each mark is an entry in the function-word lexicon; marks are as ambiguous as words and
the chart decides the same way (`*` between numbers is multiplication, `_` inside `snake_case` is part
of a name, `#` before digits is an issue reference), each a competing entry chosen by the score.

| Mark | Heard as |
|---|---|
| `*x*`, `_x_` | `Contrast(x)`: this, as against the alternatives ("I didn't say *he* did it" denies it was him, not that it was done). Proposes which part `Not` and `Only` are about (section 11), as a scored feature. Also titles and terms, as competing entries |
| `**x**`, `__x__` | `Important(x)`: do not miss this. Raises salience (section 14b) and the weight of a constraint it is on; still the same constraint |
| `***x***` | `Important(Contrast(x))`: a different kind from either, not a degree |
| `~~x~~`, `~x~` | `Withdrawn(x)`: a correction inside the message ("~~push~~ commit" asks for a commit), the operation of section 17 |
| `<ins>x</ins>` | `Inserted(x)`: the added side of a correction |
| `<sub>`, `<sup>` | part of the name or number they are in (H<sub>2</sub>O, x<sup>2</sup>), no tone |
| `` `x` `` | a name or a mention (`Mention`, section 11): `` `agents.md` `` is an exact name, never a spelling candidate. A color (`` `#0969DA` ``) is a shape |
| fenced code | set aside as content with its language (`SetsAside()`), never heard. Markdown inside a fence is content too: "make the README look like this" points at it, it does not stress anything |
| `#` to `######` | `Heading(level)`: names what the lines under it are about |
| `>` | `Quote`: someone else's words, opaque |
| `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | `Callout(kind)`, a competing entry on `>`: the writer's own words, flagged, not a quote |
| `-`, `*`, `+`, `1.` | `Item`s of one `List`; "commit these:" followed by a list takes the list as its argument |
| `- [ ]`, `- [x]` | `Task(done=false)`, `Task(done=true)`: a list of things to do and their state |
| `[text](to)` | `Link(text, to)`: the text names the target. The target is a shape: a URL, a path relative to the file (a workspace candidate, section 14b), a `#section` anchor (a heading in the same document) |
| bare URL, `@name`, `#123` | shapes: a URL, a person or team, an issue or pull request |
| `![alt](src)` | `Image(alt)`: the alt text is heard, the image is a block |
| `[^1]`, `[^1]: text` | `Note`: the text belongs to the place that cites it |
| `:name:` | an emoji by name, tone |
| `\*` | the escaped mark is a plain character, not a mark |
| `<!-- -->` | hidden from the reader: set aside, never heard as said to the assistant |
| blank line, two trailing spaces, `\` at line end, `<br/>` | `Paragraph` and `Break`: segment boundaries (section 8) |

**Nesting by indent** (a list inside a list) is the one place markdown's structure is layout, not
marks. Indentation is character mechanics, the same in any language, so the runtime records each
line's indent as a fact on its first token, and the list entry takes items by it. Nothing else reads
layout.

**Speaking.** Wordings never contain markup. A realization says `Important(x)`, `Link(text, to)` or
`CodeBlock(content, language)`, and a last step prints the document in the **medium** of where it
goes: markdown for the chat and `.md` files, plain text for commit messages and terminals that do not
render markdown. Each medium is a set of seed realizations of the document heads (about 20 for
markdown, about 10 for plain text); the medium is a fact on the destination, never a guess from the
words. In markdown:

- **Content never becomes markup by accident.** Text from a block, a name or the user's words is
  escaped where it would otherwise be read as a mark (`\*`), or printed as code.
- **Names of things are code.** Files, branches, commands and identifiers print as `` `x` ``, so they
  are copyable and never re-read as stress.
- **Code shows source, not rendering.** `CodeBlock` prints its content verbatim in a fence longer
  than any run of backticks inside it, with its language. That is how markdown is shown as markdown
  (`CodeBlock(content, language=Markdown())`) instead of rendered: showing a README's source and
  writing a README are different requests, so different documents. Inline `Code` uses enough
  backticks, and pads with a space when the content starts or ends with one.
- **Links.** `Link(text, to)` prints `[text](to)`; a link whose text is its target prints the bare
  target; a workspace file prints as a path relative to where the output is read. In plain text a
  link prints as "text (to)", or the bare target.
- **Stress keeps its kind.** `Contrast` prints `*x*`, `Important` prints `**x**`, both print
  `***x***`; in plain text stress prints nothing, since the words have to carry it.
- **Callouts and tasks** print as GitHub's alerts and task lists, in plain text as a leading word
  ("Warning:") and "[ ]" / "[x]".

What a request asks to produce decides the document; the medium decides only how it is printed. A
file written to disk is written in its own medium (a `.md` file as markdown source, never wrapped in
a fence).

## 26. Evaluation

**The corpus**: 1,595 items with model-drafted expectations, normalized into test cases in
`~/.napkin/corpus/tests/` (1,895 cases with the focused cuts, plus 299 paraphrases).

**Making it trustworthy:**

- **Keal hand-checks** every item the experiment uses and a stratified sample of 100 across the
  corpus, in a separate session, recording verdicts to `checked.jsonl`. The agreement rate is
  reported and bounds how far the unchecked rest can be trusted.
- **Freeze before running**: the normal form and the mapping from drafted `acts` onto primitives are
  written and frozen before the system is run, so the target is not shaped by the system.
- **Argument match per kind**: exact for referents, times and files; for free text (a commit
  message, a draft), a content block that exists and passes its stated constraints, not a string
  match.
- **Understanding and task completion** are measured separately.
- **Same meaning, same reading** passes when a prompt and its paraphrase reach the same normal form.
- **Holdout**: 30 percent of the real prompts, never tuned on; in the experiment, split by
  conversation, not by prompt, so near-duplicates do not leak.
- **Intervals**: every number is reported with its confidence interval; conclusions only where the
  intervals allow.
- **Runtime tests** exist independently of the corpus (unit tests of the chart, the score, the
  primitives' checks, the trust rules).
- **The replay gate** keeps a learned change only if affected replays pass, and it replays only
  **hand-checked** items, so unchecked model drafts never veto a change. It proves nothing
  regressed; the holdout and the hand-check measure rightness.
- **Statistics**: comparisons between systems on the same items use a paired bootstrap on per-item
  correctness; the sample size needed for the go margin is computed before the experiment.
- **The paraphrases were written by models**, so they test robustness to model-style rewording;
  15 Keal-written paraphrases are added for the experiment's domain, and its no-name stratum comes
  mainly from real requests (section 29).
- **Reliability of the labels**: Keal re-labels a random 20 percent after a delay, and the agreement
  with his own first labels (kappa) is reported; agreement with the model drafts is reported too, as
  a check on the drafts, not as reliability.
- **A rolling fresh test set.** Keal:

  > "maybe also sample NEW prompts daily that can be used to test against but we need at least a
  > baseline and not every benchmark prompt was used so those arent all gimmies anyway"

  - **New prompts, sampled daily** from Keal's own sessions after the seed is frozen. Nobody reads
    them before they are scored, so they are clean of the author's knowledge; they are labelled in
    batches in the separate checking session, and scores are reported per week as the set grows.
  - **Unused benchmark items.** Only 25 items per dataset were analysed; the rest of every dataset
    is untouched and serves as held-out data drawn fresh for each report.
  - **A baseline first.** Before the new system is built, the simple baselines (keywords, the word
    classifier, recency) and the existing prototype are scored on the same sets, so every later
    number has something to be compared with.
- **Blindness has limits**: Keal types the fresh prompts himself, so he is not blind to them as their
  author, and knowing he is being tested can shift his phrasing. Both are stated; a second user's
  prompts are welcome whenever available.
- **The confirmatory set is the fresh one.** Go is decided on prompts collected after the seed is
  frozen and never read before scoring. The existing corpus, including its holdout, is exploratory:
  Keal has read the analysis of all of it.
- **Contamination is stated plainly**: Keal wrote these prompts and has seen their analysis, and the
  seed is written with that knowledge. The guards are principle 14 (fix understanding, never the
  test), the frozen seed, and the conversation-level split.

## 26b. Operational safety

- **Commands are never built by pasting text into a shell string.** Arguments are passed as
  separate values; user text is data, never code.
- **A plan that fails partway** stops at the failing step, reports what ran and what did not, and
  offers to undo what it can.
- **Undo**: primitives declare an inverse where one exists (a created branch can be deleted, an edit
  reverted); where none exists, the guard says so before acting.
- **Interruption**: a plan checkpoints between steps; "stop" means no further steps.
- **Other processes**: the world is observed before acting (the file and the branch as they are
  now), not assumed from the last look.
- **Privacy**: the corpus and anything from work sessions stay local, outside the repo; deleting a
  source deletes what was learned from it.

## 27. What the new project writes before code

Keal:

> "We should really lay out exactly everything from the IR structure/grammar tests and runtime rules
> and the best way to build a new concept if it has to be part of the built-in concepts."

1. **The N-Con spec**: concepts, facts, readings, the content store, provenance and trust, as data.
2. **The N-Con text format**: its grammar (of the file format, which is fine: the rule is about
   language, not file syntax), a formatter, and round-trip tests.
3. **The runtime rules**: what the runtime may and must not do (section 28), the six chart steps,
   the score interface, the primitives with effects and checks, the modes.
4. **Built-in concepts**: what is built in (the seed's eight parts, the primitives, a handful of
   structural concepts), how to add one, and the test for whether something belongs there
   (would it be the same for chess, a jam website and the user's name? if not, it is learned).
5. **The test strategy**: the corpus, the hand-check, the holdout, the replay gate, runtime tests.

They are in `docs/specs/` (with the logical form as a sixth, per PLAN.md phase 0). Where a spec
decides something this document left open, the spec says so; decisions that change this design
are copied back here once Keal confirms them.

## 28. The runtime

It does only this: store concepts, facts, readings, content blocks, the conversation structure and
the event record, with provenance and trust; match patterns over lemmas and roles, and shape
patterns over characters (the one small pattern interpreter shapes need), plus the character
mechanics of spelling candidates (edit distance, squeezing repeated letters); build and prune the chart
with its six steps; gather what is relevant through Focus (section 14b: gather, score, budget,
record), with what counts as relevant decided by readings' needs, never by rules in the runtime;
score readings in two stages; rewrite and run primitives; learn weights from
corrections and picks. Concepts have two kinds of content (facts and readings); the store also holds
content blocks, the conversation structure, the event record and trust, as data.

It must not contain word lists, English wording, answer-shaping rules, special-cased concept names
beyond a handful of structural ones, or grammar rules. Each is a fact or a reading on a word.

## 29. The smallest experiment

**Domain**: files and git. The act set is what the labelled data contains, starting from status,
diff, commit, push, pull, branch, checkout, merge, revert, read or open a named file, find in files,
and pull requests, trimmed to acts with enough items. Items are real requests, **single-act and multi-act** (a
labelled sample found about 6 single-act and 5 multi-act git requests a week, mostly "commit and
push" and "merge master"), **including ones with constraints or conditions**, so the logical form
(section 11) and plans (section 12) are exercised.
A constraint on its own ("don't push yet") is an act class of its own: the gold is "nothing runs
now, the rule is stored".

**The gold is an executable act**, not a logical form: the command and subcommand, its flags, its
typed arguments (files, branches, refs), and any stored constraint. The logical form is internal to
the system. That way the gold can be frozen before the concepts it would be expressed in are learned.

**"Without the command's name"** is defined before any data is seen: the request contains no lemma
from a frozen list of the domain's command and subcommand names and their documented aliases
(commit, push, pull, branch, checkout, switch, merge, revert, reset, stash, diff, status, tag,
fetch, clone, "pr", "pull request").

**Pull requests** go through the GitHub API, which a local sandbox cannot check; they are scored on
the act label only, not on end state, unless a mock of the API is built. For pull and merge, the
fixture snapshots the remote's refs and objects at capture time into the sandbox's bare remote.

**Week 1: representability, and capture.**

- Keal writes by hand the target readings for 30 git documentation descriptions and 30 real
  requests whose prompt does not name the command (from the labelled exploratory set; the name, if
  anywhere, is in the turns before, which come with the request), using only the drafted seed's vocabulary and bridge. **If
  under 70 percent can even be expressed, the seed design is fixed before any code.**
- **Convergence, not only representability.** For the 30 requests, Keal also writes the
  reductions **blind to the documentation reductions**, then the match of section 9 is run on the
  hand-written pairs. The kill test is top-1 match accuracy: **if under 60 percent of the requests
  match the right documentation reading, stop**: careful hand reductions do not converge, so
  automatic ones will not. Every change made to the seed during week 1 and stage 0 is logged and
  counted.
- In parallel, a **capture hook** is built: whenever Keal sends a prompt to a coding assistant, it
  snapshots the working tree, branches and remotes and the assistant turns before it, into a
  fixture. Until it exists, no confirmatory data is being collected. Historical fixtures are drafted
  from transcripts where the state can be reconstructed, and the prior assistant's tool calls stand
  in for its event record.
- **The accrual rate** is measured from the logs: about 37 git-ish prompts a week since August
  (by a loose keyword match); if about a third qualify, about 12 a week.

**Stage 0: documentation to readings, automatically.** The same 30 descriptions, understood by the
pipeline (definition understanding is in this round, with the glossary), graded against the week-1
targets. **Stop** if fewer than 50 percent of the 30 automatic reductions equal their hand-written
targets, or if the hand-graded precision of 50 bottomed-out senses (section 6) is under 70 percent,
or if fewer than 60 percent of in-domain development prompts get a full or near-full parse (at least
70 percent of their content words covered).

**Stage 1: pilot.** About 50 labelled items: the ceiling, the share of requests without the
command's name, and every baseline on each stratum. The margin and n are set here, **for the
deciding metric** (end state on real requests), with the calculation's assumptions
stated (the expected rate of pairs where the two systems disagree). With a 10-point margin, paired,
and about 20 percent disagreeing pairs, it needs on the order of 170 items. At about 11 qualifying
requests a week, that is about four months; if the pilot shows a slower rate, the domain widens to
files in general before the freeze, not after. Requests without the command's name are about 0.4 a
week in real use, too few to decide anything, so they are tested on the real ones in the
exploratory labels (about 43) and on Keal's 15 written paraphrases, reported beside.

**Baselines** (the arm and the baselines are told apart by stratum and by metric, and each baseline
gets what it can use):

- **acts, zero effort**: command-name match, and BM25 from the request to the man pages;
- **acts, trained**: a word classifier on the same labels; the same classifier plus features from
  the man page of each act (TF-IDF); nearest neighbours over the exploratory set;
- **acts, with the same lexical resources**: BM25 and the word classifier with the request and the
  man pages expanded by WordNet synonyms and hypernyms, so a win cannot come from the imports alone;
- **arguments**: every act baseline gets a simple slot filler (recency plus shape match), so the end
  state metric has a comparison;
- **referents**: a learned salience ranker over the same features the system uses, and recency;
- **reference only, not deciding**: a language model, reported as a ceiling, so the gap is known.

**Stage 2: the deciding run.**

- **Data**: the exploratory set is the existing corpus, labelled by Keal (every git-ish prompt plus a
  random sample), for development and training. **The confirmatory set** is fresh prompts from the
  capture hook after the freeze, from sessions with other assistants, **labelled blind** to the
  system's output and before scoring, with label and score times logged, and nothing in the seed or
  the protected base changed between labelling and scoring.
- **Frozen first, counted, published**: the seed (all eight parts), the gold format, and the mapping
  of expectations onto it. **The scored system is frozen as one unit**: a runtime commit hash, the
  pack versions and the trained weights. Every confirmatory item is scored against that single
  frozen system; development continues on a separate version that is never the one scored.
- **Arms**: **A** (import alone, seed weights); **A+ zero-shot** (plus the documentation readings,
  seed weights); **A+ trained** (the same, trained by the perceptron on the exploratory labels, the
  same labels the classifier gets). **All documentation readings run unconfirmed** in the sandbox;
  a variant with Keal's stage-0 confirmations is reported beside it, so human curation is never
  mistaken for the system.
- **Metrics, pre-registered**: (a) act label accuracy; (b) end state in the sandbox fixture equals
  the gold end state. Asking or abstaining counts as wrong for both; a guarded act offered with the
  correct target counts as correct; a risk-coverage curve is reported beside. Asking is disabled
  in A and A+ zero-shot, which have no calibration.
- **A negative set**: fresh prompts that contain git words but are not git acts ("push back on the
  reviewer", "commit to this approach"); the false-act rate is reported for every arm and baseline.
- **The no-name set** (reported, not deciding): real requests whose prompt does not name the
  command, with their prior turns, from the exploratory labels, plus 15 paraphrases Keal wrote blind
  before seeing the seed; act accuracy against BM25 over the documentation. Written paraphrases
  stopped at 15: Keal names the command when he means it, so made-up rewordings test a phrasing he
  does not use.
- **Go**, decided on (b), end state, for **A+ trained**, on the confirmatory set of real requests:
  at least a pre-registered absolute floor of 60 percent (a level worth using); better than command-
  name match with the slot filler by at least the margin; not worse than the best trained classifier
  with the slot filler (including the WordNet-expanded one) by more than the margin (TOST); and with the wins
  mostly coming from parses covering at least 70 percent of content words (accuracy is reported by
  skip rate, so skipping plus the "reached an act" prior cannot pass for understanding). The
  multiple tests are corrected (Holm).
- **Stop**: otherwise. Go and stop are complements.

**What go licenses.** Go shows that a no-model assistant can understand requests for a narrow set of
tool acts, phrased in its user's own words, better than simple baselines, without hand-written
domain knowledge. It does not show that it can edit code meaningfully, which is most of real use;
that is the next experiment, and a go here is not read as more.

**Stage 3: the oracle arm, reported, not deciding.** B: gold normal forms on the training
conversations; referents and end states on the confirmatory set against the learned salience
ranker. Typed corrections (Keal's own phrasings) come after.

**Also reported**: everything on the requests *with* the command's name too; parse coverage per
construction type; chart size and oracle recall at k; sense accuracy on the domain's lemmas; the
ablation of "reached an act"; label reliability; counts of seed entries by part, confirmations and
learned structures by kind.

**Time**: months. Week 1 first, because it can end or redirect the project cheaply.

## 30. Open questions

Decided in the session (recorded so they are not reopened): the project is named Noodle; a new
project, with Napkin as inspiration; the language is N-Con (nested concepts), files `.ncon`; "no grammar" means no rule in
the runtime, every rule on its word; the runtime executes only as far as it has to; sources are
concepts, the list is open; writing its own code is a long-term aim, outside the first experiment,
inside a protected base; code is understood as language; facts and readings as the whole data
model; modes set only by primitives, everything else evidence; text understood into structure,
content kept as content; offer for consequential implied actions, act for lookups; corrections and
picks as the main teacher; the corpus kept in `~/.napkin`; writing from facts and loose templates;
tools as learned readings, config for access; the instruction file falls back to AGENTS.md, never
CLAUDE.md; permissions grantable up to all actions, by the user only; the experiment's domain is
files and git; Keal labels every git-ish prompt plus a sample and confirms fixtures, in a separate
session; typed corrections and definitions are the experiment's second round; fix understanding,
never the test (principle 14); the existing corpus, split by conversation, is used, with its
contamination stated; the confirmatory set is fresh prompts after the seed freeze; a documented
command's name gives its word a sense.

Also decided (after the review loop): the store is SQLite with N-Con as its text form; a concept per
sense, named `Word#WhatItIs`, with hearing kept close to the words and senses chosen only when a
reading needs one; definitions understood at import, domain vocabulary first; imported senses are
candidates on a frequency prior; the seed is counted, with no hard cap; the config is
`~/.noodle/config.json`; the source transcripts stay local. Markdown is heard through seed entries on its
marks and spoken through media realizations of document heads, which are core meanings (section
25b); `*x*`, `**x**` and `***x***` are different kinds of stress (contrast, importance, both);
strikethrough is a correction; the runtime records each line's indent as a fact on its first token,
the only layout it reads, so nested lists are heard by their marks' entries.

Open:

1. **A definition that cannot be understood yet**: kept pending (the current default), or dropped?

## Appendix A. What the critiques changed

**Round 1**: the score defined; understanding given an algorithm; definitions given a base case;
evaluation honest about circularity; feasibility numbers relabelled; the core made precise; word
lists counted; modes set by primitives; a content store; coarse senses; a logical form; effects and
checks; ranked referents; trust levels; freshness; versioned packs; honest responses; performance;
the core bet and the smallest experiment. Kept as decided: "no grammars" and a small core, made
precise rather than dropped.

**Round 2**:

- The experiment's domain moved to files and git (lists have almost no real prompts), with both
  correction arms, a definitions arm, baselines, learning curves, a correction-rate curve, intervals,
  a conversation-level split, and months rather than weeks.
- The function-word lexicon and the verb-to-primitive bridge are named as parts of the seed,
  hand-written, counted, frozen, and reported with and without.
- Principle 12 says plainly that the words' entries form a lexicalized grammar, and the chart's four
  universal steps (take, modify, join, skip) are listed.
- Learning is latent-variable structured perceptron, with its known risk stated.
- The ask-or-act evidence was misstated; it now gives both directions with counts, and asking is a
  cost-based decision.
- Scoring and evaluation are two stages (chart score, then a dry run with Suppose), removing the
  fixed "code first" order; Suppose is a primitive; Fetch is internal to Know; Operate is deferred.
- The logical form separates assertions from constraints, leaves scope open until evaluation, and
  has worked examples.
- Trust closes the injection hole through readings; guards attach to effect classes; a protected
  base is outside the self-writable surface; self-writing is outside the first experiment.
- Partial parses, segmentation and skipped tokens handle messy input; spelling correction adds sound
  and surroundings.
- Effect checks and goal checks are separate.
- The evaluation freezes its targets first, matches arguments by kind, and separates understanding
  from task completion.
- Added: the event record, runtime tests independent of the corpus, what the new project writes
  before code, and a seed-size question.

**Round 3**:

- The route from import to a git command is named: the tools' own documentation, understood, meets
  the bridge at Run, and the bridge never names a command (section 6). "Reduces to core meanings"
  and "reaches a primitive" are measured separately.
- The experiment labels every git-ish prompt, builds fixtures so references can be graded, widens
  the act set to the data, counts n against a power calculation, adds a trained word classifier and
  a recency heuristic as baselines in the go criterion, uses paired tests, and says which arm and
  metric go is judged on. Typed corrections and definitions move to a second round.
- What a correction may create is listed and counted (section 17).
- The oracle arm gives the full normal form, so scope, constraints and referents get a signal; the
  stage-two score is trained the same way; Suppose may run pure reads.
- Rules written back are proposals, echoed and confirmed, with interpretation confidence kept apart
  from source trust; a project file cannot revoke a grant. (Partitioning the score's features by
  trust was tried here and replaced in round 4 by a confirmation gate on readings.)
- The protected base includes the function-word lexicon and the logical form's operators, with an
  invariant that no learned rewrite removes a Constraint or a Not.
- The cost ratio of asking is a stated parameter with a sensitivity range.
- The logical form has a speech-act top level, and its type system and canonicalization are
  written before targets are frozen; the ad hoc examples were fixed.
- References are scored as features, not ranked by a fixed order; segmentation keeps alternatives.
- Code is parsed by real parsers behind Read; commit messages are templates with a stated
  constraint; sarcasm is out of the experiment's scope.
- Added: operational safety (no shell strings, partial failure, undo, interruption, observing before
  acting, privacy), the replay gate on hand-checked items only, and principle 14 from Keal.

**Round 4**:

- The core bet is restated so the novel part decides go: arm A+ (import plus the tools'
  documentation) against a trained word classifier and zero-effort retrieval, on fresh prompts
  after the freeze; the oracle arm is secondary.
- The experiment gets a stage 0 kill test (documentation to readings, graded by hand), a stage 1
  baseline pilot that finds the ceiling and sets the margin and n, baselines with equal information
  (name match, BM25 over the man pages, a word classifier, a learned salience ranker), pre-registered
  metric, margin and tests (paired bootstrap, TOST), go and stop as complements, waiting rather than
  moving the margin when n is short, constrained single acts in scope, and label reliability.
- The seed gains lexical rules, initial weights, default policies and genre shapes, with a size
  estimate and a cap by part; domain vocabulary enters from documentation; a documented command's
  name gives its word a sense.
- The assistant's own utterances, and the prior assistant's turns in fixtures, are understood into
  concepts so references into them resolve.
- Trust acts on readings through a confirmation gate, not by partitioning shared weights; weight
  changes that move hand-checked replays pass the gate; guarded acts show their target.
- The constraint invariant is a syntactic subtree check; opaque contexts (quotes, mentions, text to
  write) stop rewriting; a correction splits a sense only on two confirmed cases.
- Goal checks are scoped to git and file states in the experiment; effects learned from documents
  are followed by observing, not trusted.
- The runtime's components are named in full, including the shape pattern interpreter.

**Round 5**:

- Go is decided on the requests without the command's name, where understanding rather than name
  matching does the work; the exact route to Run is written (a documentation reading becomes Run of
  its page's command, reached when a request's reduction matches the description).
- Two pre-registered metrics (act label, end state in a sandbox), with asking scored as wrong and a
  guarded offer with the right target scored as right; A+ is run zero-shot and trained, go decided on
  trained; documentation readings run unconfirmed, with a confirmed variant beside.
- The experiment is re-sequenced: week 1 hand-written representability and a capture hook for fresh
  fixtures, stage 0 automatic, a pilot that sets margin and n, the accrual rate measured (about 12
  qualifying prompts a week), and a 10-point margin that fits in months.
- Stronger baselines (classifier plus man-page features, nearest neighbours, a language model as a
  non-deciding ceiling); blind labelling of the confirmatory set.
- The chart gains composition and gaps; category (hard) and kind (soft) are separate; out-of-scope
  constructions are listed; chart size is measured before k is fixed.
- The constraint invariant is semantic (no learned rewrite widens what may run), so "don't forget to
  push" can be learned.
- The seed gains English realizations as part 8, a closed list of core meanings, compiled default
  policies, and the named "reached an act" prior, ablated; sense coarsening is named.
- Domain vocabulary is prefetched; definition understanding moves into the first round; tool output
  is read as structure; what learned structure applies on its own versus waits for confirmation is
  stated; an unreviewed project file starts at level 3.

**Round 6**:

- The deciding metric moved to end state on all real requests (single and multi-act), because a
  labelled sample showed Keal nearly always names the command; requests without the name are tested
  on a blind-written paraphrase set, reported beside (Keal chose both).
- The match between a request's reduction and a reading is defined: scored unification with slack,
  its features, a threshold (section 9); week 1 tests convergence of blind hand reductions, with a
  kill threshold.
- Domain vocabulary comes from the tools' own glossaries (gitglossary, gitcli), with how glossary
  definitions reduce and how cycles are grounded; no core meaning may be domain-specific.
- The scored system is frozen as one unit (runtime hash, packs, weights); the gold is an executable
  act, frozen before the concepts are learned; "without the command's name" is defined before data.
- Go has an absolute floor, baselines with WordNet expansion and slot fillers, a negative set, a
  skip-rate split, Holm correction, and states what it licenses; stage 0 has exact stop thresholds
  for reductions, precision and parse coverage; pull requests and remote state in the sandbox are
  specified.
- The constraint invariant has one statement and one check (Suppose on the affected replays); the
  experiment's relaxation of trust is stated; quotation is a node type, not a mode; scope has
  constraints and enumeration; "until told" has semantics; calibration has its own data; user-taught
  links need two agreeing cases; blindness limits are stated.

**Round 7** (after the review loop, from a question Keal asked):

- Focus (section 14b) gathers what is relevant to a message: a cheap local candidate set before the
  chart, and needs-driven lookups during evaluation, across the current conversation, past
  conversations, the user's facts, the workspace, and the world through Know; scored, budgeted and
  recorded. Past conversations are kept as structure; research is Focus plus writing. The
  experiment uses only the current conversation and the workspace.
