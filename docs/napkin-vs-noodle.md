# Napkin beside Noodle: what each does, where each wins, and what to do next

Written 2026-10-04 for the decision Keal is weighing (tasks/handoff.md, "Keal is reconsidering the
direction"): continue Noodle with the lazy lexicon, take Noodle's learnings back to Napkin, or
start something new. Everything here was measured on this machine on 2026-10-04 unless it says
otherwise. Noodle is 0.49.0 (a4b7793), Napkin is its last commit (8bc14b4). Noodle ran with
ChatGPT off (a copy of the config with `"chatgpt": false`, SendsOutside granted, so Know could
still read Wikipedia, Wikidata and the dictionaries); Napkin ran its CLI on a copy of
`~/.napkin/store.ncon`. A detached re-import (6 shards) was running the whole time, so the machine
load was about 10 and every time below is on a busy machine.

Scratch harness (not committed): one script ran 82 prompts through both systems, each prompt group
in a fresh copy of the versus workspace (a small git repository with README.md, notes.txt,
package.json, src/app.js and a second branch). Napkin is one process per prompt, as its CLI is.

## The short version

- **On everyday prompts Noodle is ahead, but by less than docs/versus.md says, and much of its lead
  is the 1 GB of imports Keal now wants to drop.** Strictly regraded by hand, the 94 versus
  prompts are Noodle 33 right / 9 wrong, Napkin 28 right / 16 wrong. Noodle on the seed alone
  (no packs) is 22 right / 6 wrong by the script's own (generous) verdicts.
- **On Keal's coding prompts Noodle is the only one that can act at all.** Napkin has no way to
  run a command (no Run primitive, no child_process in its source), so every git request is
  "I don't know how to commit yet". Noodle offers or runs the right git act on 3 of 8 dev-corpus
  prompts and is still far below the trained baselines (pilot: 2 to 4 percent first act against
  27 for nearest neighbour).
- **Neither does reasoning.** 0 of 40 benchmark items with gold answers from Napkin's own test
  corpus, for both. Napkin says more confident nonsense (13 wrong, 3 timeouts); Noodle abstains
  more (9 wrong).
- **Napkin does more of the "small, learns live, runs anywhere" goal today**: 2 MB of packs, about
  1 s per process start, a browser Worker build with OPFS already shipping, its hearing written in
  the graph as code, an agenda it works on unprompted, and forgetting. **Noodle does the "learns
  how to do things" part that Napkin never had**: taught commands with slots that persist across
  processes, learning a tool from its manual or `--help`, offers with yes and no, guards on effects,
  and a scored choice between readings with a reasons log.
- **Recommendation: start a new small core, built mostly from Noodle's learn-to-act loop and
  Napkin's portable, self-describing graph runtime**, not a continuation of either as they are.
  Reasons and costs are in section 5. If a new project is too much churn, the next best is to
  continue Noodle on a seed-only store with the lazy lexicon, and measure it the way Keal proposed,
  before anything else is built.

## 1. How each turns a string into meaning

### Napkin

```
text -> straight quotes, expand bare words, SymSpell spelling (an-array-of-english-words, 275k words)
     -> Hear() in packs/hearing.ncon: each word is a Concept; under the Hearing() context each word
        proposes Links (Modifies, Takes, Joins, Absorbs, Marks, AskedAbout, Adds, PointsAt) to other
        words; unknown words hear as their compromise POS tags do; rounds until nothing changes
     -> Phrases(...) lines -> lift.ts (mend numbers, dates, words; drop articles) -> ONE expression
        e.g. ContextScope(Imperative(), Add(45, 38))
     -> check: a question must contain an interrogative (looksLikeQuestion, a regex list in ears.ts)
     -> evaluate under Execution(): pick the realization whose facet context is most specific
        (selection by specificity), recurse; no applicable realization = residual (a value)
     -> residuals become gaps -> learn: graph, Wikidata, Wiktionary, sister projects -> re-read
     -> Speaking() realizations in packs/english.ncon say the result
```

- **Tokenizing and lexicon**: compromise (a third-party POS tagger with its own lexicon, 4 MB in
  node_modules) and SymSpell. Spelling is corrected before hearing, silently: "a blicket is a kind
  of tool" was heard as `Blanket(IsA(Kind(Of(Tool()))))` (it still answered right, because the
  text is kept).
- **Parsing**: link proposals in rounds, written as IR code inside the graph (hearing.ncon, 5,235
  lines, 198 KB). One reading comes out; there is no chart and no second reading.
- **Choosing a reading**: none to choose. Ambiguity shows up later as "matched 4 equally specific
  realizations on different facets", resolved by declaration order or a sense picker
  (individuals.ts).
- **Acting**: realizations are code (IR compiled from JavaScript by `importTypeScript`), so
  arithmetic, file read and write, running JavaScript in isolation, Wikidata SPARQL and web pages
  are all reachable. Shell commands are not.
- **Sizes**: 14,057 lines of TypeScript (runtime 3,872, ears 1,892, store 2,092, code 2,516,
  learn 821), 5,099 lines of tests; 36 packs, 56,950 lines, 2.0 MB (code-hearing 402 KB, code
  216 KB, hearing 198 KB, basic 193 KB); store journal 80 KB. Dependencies: compromise, SymSpell,
  an-array-of-english-words, web-tree-sitter.
- **Time**: about 1.0 s for a process to start and answer "hi" (it loads every pack each time).
  Per prompt, median 5.96 s on the versus sample and 6.1 s on the raw strings, because a gap sends
  it researching: "how tall is mount everest" took 89 s, three benchmark items hit the 120 s
  timeout, and the benchmark median was 46 s.

### Noodle

```
text -> set aside what is not language (shapes with SetsAside) -> tokenize (character mechanics)
     -> candidates per token from the store: Exact, CaseMatch, Inflected, SpellDistance,
        Stretched, InPlay (workspace names), Shape, Unknown (hear.ts)
     -> segmentations (at most two, from boundary facts on punctuation and clause words)
     -> chart (chart.ts): Take, Modify, Join, Skip, Compose, Gap over entries on words; top k=6 per
        span, 8 covers
     -> rewriting (rewrite.ts): readings and bridge rules expand covers toward acts
     -> scored match (softmatch.ts): each reading aligned against every Describes in the store
        (1,860 tool packs' summaries, taught readings), IDF-weighted, costs for uncovered,
        unexplained, distance, ambiguity
     -> stage one score (log-linear, named features) -> stage two: dry runs with Suppose
     -> Session.turn (turn.ts): offers, yes and no, corrections, numbered choices, taught commands,
        guards, Know lookups, tool learning -> evaluate (evaluate.ts) -> speak (speak.ts, realizations)
```

- **Tokenizing and lexicon**: no word list in code; every word is a fact in the store, from the
  seed (1,359 counted entries, 192 KB) or from imports. Installed: 1,870 packs, 121 MB of .ncon
  (WordNet 66 MB, Wiktionary idioms 8 MB, VerbNet 7.2 MB, Wiktionary 5.4 MB, the GitHub OpenAPI
  pack 4.6 MB, tldr 4.5 MB, 1,861 tool packs), loaded into a 1.0 GB SQLite store.
- **Parsing**: a lexicalized chart, many readings kept and pruned by score.
- **Choosing a reading**: two-stage scoring with named features, a reasons log (`--why`), a
  perceptron that moves on corrections.
- **Acting**: primitives with declared effects (Read, Run, Write, Know ...), guards on effect
  classes, Suppose for dry runs, offers before effectful acts it does not know.
- **Sizes**: 15,089 lines of TypeScript (runtime 9,997 of which turn.ts 1,311, evaluate.ts 1,283,
  chart.ts 794, store.ts 645, rewrite.ts 480, softmatch.ts 461, hear.ts 364; know 3,289 for
  importers), 3,581 lines of tests. No runtime dependencies; leans on node:sqlite,
  child_process, mandoc and sandbox-exec.
- **Time**: process start and "hi" in 0.40 s (1.2 s the first time the 1 GB file is touched);
  seed-only store, 0.24 to 0.29 s, 2.8 MB. A first load of all packs takes about 10 minutes
  (handoff; not re-measured). Per turn, median 0.40 s on versus with packs, 0.01 s seed-only;
  0.72 s on the raw strings, 5.8 s on benchmark paragraphs. Across all 82 harness prompts the time
  went to Know (243 s of 437 s) and the scored match against tool descriptions (107 s); the chart
  was 40 s, hearing 7 s. The first turn of a process pays about 2 to 3 s to build the scored-match
  index. One turn ("should i drink coffee or tea?") spent 95.6 s in Know at full CPU.

### Same prompt, both traces

"add 45 and 38":

```
Napkin   heard  ContextScope(Imperative(), Add(45, 38))     said  83
Noodle   * 9.25 Directive(Run("git", Args("add", 45)))       said  I can run `git add 45` ... Go ahead?
           9.00 Run("git", Args("add", And(45, 38)))
```

"what branch am i on":

```
Napkin   heard  What(Am(Branch(), On(Me())))                 said  I don't know what branch on you yet.
Noodle   * 8.09 Question(Contains(Gap(), Run("git", Args("branch")), theme=Speaker()))
                                                              said  You haven't told me that.
```

Napkin's one reading is usually the sensible surface reading and then has nothing to act with;
Noodle finds the git act among its readings and then loses it to the wrong frame or wins it on
the wrong word (the 1,860 tool descriptions make everyday verbs like add, help, show and fork
into commands).

## 2. Where each wins and loses

### The 94 versus prompts

Noodle was rerun in full today with ChatGPT off. Napkin's cached replies (docs/versus-napkin.json,
from its last full run on 2026-10-01) were checked by rerunning 46 of them in six sessions (small
talk, math, files, git, typos, near-misses): all 46 verdicts came out the same, so the cache is
current.

| | script verdicts (R / H / W) | strict, by hand (R / not wrong / W) |
|---|---|---|
| Noodle, installed packs, ChatGPT off | 39 / 50 / 5 | 33 / 52 / 9 |
| Noodle, seed only (no packs) | 22 / 66 / 6 | not regraded |
| Noodle, ChatGPT on (docs/versus.md, 2026-10-04 01:44) | 50 / 40 / 4 | not regraded |
| Napkin | 31 / 49 / 14 | 28 / 50 / 16 |

The script is generous to both: it counts as right "I couldn't add eggs and milk to it" (35),
"Added yesterday to code." (82), a list of git-extras subcommands for "what does git commit do?"
(84), "Got it: I won't first until you say so." (65), and for Napkin "You are welcome. In means
French department, ..." (7) and "A joke is a short fictional story ..." for "tell me a joke" (89),
while it marks wrong Napkin's correct list of what it can do (90). The strict column counts a reply
right only if a user would take it as the answer or the right act, and wrong if it says or does
something false; a run of an act that fails counts as wrong (61, `git commit` with nothing staged).

Where they differ, by session (strict right): Noodle wins facts (who wrote, Mona Lisa, Brazil),
files (show the readme, what's in notes.txt), git (log, commit, push, status as offers), and
instructions (stop, never mind). Napkin wins units (12 inches, 5 km in miles), dates (tomorrow,
days until Christmas), "add 45 and 38", short definitions from Wiktionary ("ephemeral",
"ubiquitous"), "what can you do?". Neither does lists, reminders, file creation, rename or delete.

### 30 raw strings

Written for this comparison, not from either test set: 22 across small talk, questions, math,
files and git, multi-step and messy spelling, and 8 of Keal's real coding prompts from the
development side of `~/.noodle/experiment/split.json` (corpus ids 3212, 1566, 1374, 867, 940, 1169,
1618, 1697; checked against the holdout list, none is in it). Graded by hand.

| # | prompt | Noodle | Napkin |
|---|---|---|---|
| 1 | yo whats good | W: "Hi." then the Wikipedia page for Good | W: "Hello!" then a definition of a good |
| 2 | thank you so much! | R: "You're welcome." (plus "couldn't work out so much!") | R |
| 3 | good night | R: "Bye." | R: "Goodbye!" |
| 4 | what is the capital of australia | R: Canberra page section | R: "Canberra." |
| 5 | how tall is mount everest | H (read "tall" as a topic of Store) | H, after 89 s |
| 6 | what does recursion mean | R: Wikipedia lead | R: Wiktionary gloss |
| 7 | who is the president of france | W: page about the office, no name | W: "Sébastien Lecornu." (the prime minister) |
| 8 | what is 7 times 8 | R | R |
| 9 | what's 250 minus 75 | R | R |
| 10 | what is 3 squared | R | H |
| 11 | what is half of 90 | W: the page for 900 | R: "45." |
| 12 | show me src/app.js | R | R |
| 13 | what's the current branch | H | W: "Ocean and sea." |
| 14 | how many files are in src | H | H |
| 15 | list the branches | W: offers `gh api ... /branches` (remote, not local) | H |
| 16 | show me the diff | R: numbered choice, `git diff` is option 3 | H: "don't know how to say it yet: Diff()" |
| 17 | show me notes.txt and then the readme | half: notes shown, readme stuck | H |
| 18 | add 2 and 3 then multiply by 4 | H (read as `git add`) | R: "That makes 20." |
| 19 | what time is it and what day is it | W: "- calendardate - clock time" | half: the time only |
| 20 | wat time iz it | W: a Eurovision page | W: "I see." |
| 21 | whats teh capital of germny | R: Berlin page | R: "Berlin and Berlin." |
| 22 | shwo me the readme pls | R | H |
| 23 | commit whats there first (git commit) | R: offers `git commit` (plus a stray Wikipedia page) | H |
| 24 | commit and push what you have so far | R: offers commit then push | H |
| 25 | is the local branch up to date with maste?R (status) | H | H |
| 26 | status update (git status) | R: ran `git status` | W: "Which status update do you mean: the film ...?" |
| 27 | oh you didnt pull it down can you switch me to that branch then? (checkout) | **W, safety**: "Got it: I won't run `git pull it`." (a standing rule from a negated statement) | H |
| 28 | does some other branch fix the draft vs live logic? | H | H, after 66 s |
| 29 | k generate (no act) | H, no act: right | H, no act: right |
| 30 | it still has errors dude pull up a browser (no act) | H, no act: right | H |

Totals (right / half or honest / wrong): **Noodle 14 / 9 / 7, Napkin 10 / 15 / 5.** On Keal's
8 prompts: Noodle 3 right, 1 unsafe; Napkin 0 right, 1 wrong. Median time: Noodle 0.72 s, Napkin
6.1 s.

### Napkin's own test corpus, on both

Napkin's unit tests (5,099 lines of `node --test`) test Napkin's internals and cannot run on
Noodle; they were not run, to leave Napkin's build untouched. Its implementation-neutral corpus
(`~/.napkin/corpus/tests/cases.jsonl`, 2,075 cases) was sampled instead:

- **40 benchmark items with gold answers** (10 each of number, yes/no, text and multiple choice,
  seeded random): **0 right for both.** Noodle: 31 abstained, 9 confident and wrong (Wikipedia pages
  beside the point, "Got it: .", "7.1% is 0.071.", and from "How to cook meat on a fire pit without
  a grill?" the standing rule "Got it: I won't a grill."). Napkin: 24 abstained, 13 confident and
  wrong ("Financial transaction.", "1.", "Leg.", "Jenolan Caves.", "2009"), 3 timed out at 120 s.
  Medians 5.8 s and 46 s.
- **12 of Keal's messages to Napkin** (the `napkin` group): **Napkin 7 right, Noodle 4.** Napkin
  makes the shopping lists, answers "Who are you?", and gives a conditional answer to "should i
  drink coffee or tea?" (if you want a lower pH ..., coffee); Noodle offers `git help` for "Can you
  help me make a shopping list?", and spent 97 s in Know on the coffee question before saying it
  was stuck. Napkin's misses are its trademark: Wikidata dumps appended ("Okay. In means Canadian
  rapper ...").

This group was written to Napkin and its replies were tuned on it, so it favours Napkin, the same
way the git prompts favour Noodle.

### Failures by cause

Counted by hand over the strict versus regrade and the 30 raw strings (one cause each, the first
that explains it). The counts are approximate: one reader, and several failures have more than
one plausible cause.

| cause | Noodle | Napkin | typical case |
|---|---|---|---|
| tokenizing or spelling | 6 | 5 | Noodle: "waht is teh capitol", "hwo many", "can u tell me the tiem" stuck; Napkin: "see you later" heard as "noted later", "blicket" as Blanket |
| unknown word | 5 | 4 | Noodle: new file names ("I don't know what `ideas.md` means here"), "define"; Napkin: "sooo", "letters", "k" |
| parse | 6 | 3 | Noodle: "is the local branch up to date with maste?R", long clauses; Napkin: "how many legs does have spider" |
| wrong reading chosen | 12 | 8 | Noodle: add, help, show, list read as git or gh commands, "half of 90" as 900, "what's the current branch" as a fact about the user; Napkin: "status update" and "what's up" as films, "current branch" as ocean |
| missing act | 21 | 38 | Noodle: units, reminders, lists, create, rename, delete, line counts; Napkin: every git and shell act, plus file listing |
| wrong act or junk said | 6 | 10 | Noodle: Wikipedia pages beside the point; Napkin: Wikidata property dumps appended to answers |
| safety | 4 | 0 | Noodle: wrong standing rules ("won't run `git pull it`", "won't first", "won't a grill"), `git commit` run on a yes with nothing staged |

Noodle's safety failures are its most serious finding here: a negated statement or a "without"
becomes a standing rule with no confirmation. Each is a rule that blocks, not one that permits, so
nothing dangerous ran, but they persist and silently stop later requests.

## 3. Mechanism by mechanism

### What Napkin has that Noodle lost or does worse

| mechanism | Napkin | Noodle |
|---|---|---|
| Portability | `#platform` imports: node.ts and browser.ts; the studio runs the runtime in a Worker with OPFS and ships a static Pages build | node:sqlite, child_process, mandoc, sandbox-exec; browser port scoped and on hold |
| Size and start | 2 MB packs, 1 s per process, nothing to import | 1 GB store, 10 minute first load; 0.29 s seed-only |
| Hearing in the graph | Hear() is IR inside hearing.ncon; changing how a word hears is editing a concept | chart and candidate logic in TypeScript; words carry facts, but the combining steps and dialogue handling are code (turn.ts alone is 1,311 lines of offers, yes/no, corrections, numbered choices) |
| Code as data | realizations are IR compiled from JavaScript, formatted, provenance-stamped; it explains, fixes, runs and synthesizes code ("make g so that g(2) = 5 ...") and reads source with tree-sitter | no code reading yet (AGENTS rule 9 asks for tree-sitter; none in src) |
| Self-directed work | `--agenda` (residuals and orphans are the work list), `--exist` (works on it within a budget, research only) | none: learning happens only inside a turn |
| Forgetting | collects a realization only when another covers the same pattern and it is older and unused | none: the store only grows |
| Derivation | SynonymOf derives forwarding; Pursue keeps a route that worked as a realization (Chunk) | taught readings and weights; no derived forwarding |
| Conditional and comparative answers | "if you want X, A; if Y, B"; NoCommonKind | asks, or says it is stuck |
| Short answers from structured sources | "Tokyo.", "Canberra.", "12 inches.", "5 km is 3.1 miles." from Wikidata and units | pages: the Wikipedia lead with the answer somewhere inside |
| Social range | DailyDialog corpus answers "wow", "nice", "lol ok" | "I couldn't work out 'wow'." |

### What Noodle has that Napkin lacks or does worse

| mechanism | Noodle | Napkin |
|---|---|---|
| Acting in the world | Run primitive with effects, sandbox, guards on effect classes, Suppose dry runs | no shell; files and isolated JavaScript only |
| Learning how to do a thing, live | "count the words in notes.txt" stuck, then `` `wc -w notes.txt` ``, then "count the words in README.md" became `wc -w README.md`, and a new process still knew it. Learning a program from its manual or `--help` when a request names it | learns what words and things are (Wikidata, Wiktionary, "X is Y"); never how to do something new |
| Several readings, scored | chart, top k per span, two-stage score, perceptron updates from corrections and picks, reasons log | one parse; ties resolved by declaration order |
| Offers and consent | "I can run `git push`. Go ahead?", numbered alternatives on a no, typed commands kept | none needed, as it does nothing effectful |
| Trust and provenance as policy | sources with trust; untrusted sources cannot create standing rules or permissions (design section 20); protected base | provenance stamps, no trust levels |
| No word lists in code | every function word, tone word and correction signal is a counted fact | looksLikeQuestion and INTERROGATIVES are regex and set literals in ears.ts; compromise brings its own lexicon |
| Measurement discipline | frozen seed, corpus split with holdout, baselines, pilot, kill test, versus | corpus runner and scoreboard, no holdout |
| Honesty | abstains more (9 confident wrong of 40 benchmark items against 13, and more "couldn't work out") | more confident nonsense, especially appended Wikidata facts |

## 4. Fit with the goal

Keal's goal (handoff, lessons 2026-10-04): a small local agent that, asked to do something,
figures out how, does it and keeps how; no MCP servers, no harness; runs on any host; it does not
need to know everything up front.

| part of the goal | Napkin | Noodle |
|---|---|---|
| small | yes (2 MB) | no as installed (1 GB); yes seed-only (192 KB seed, 2.8 MB store) |
| local, no model, no harness | yes | yes with ChatGPT off; the ChatGPT tutor is an optional outside model |
| figures out how to do things | no: no act it was not written for | partly: tool docs, taught commands, the try/offer/learn loop |
| persists what it learned | yes (journal, stamped) | yes (store, sourced) |
| learns in real time | facts and words, yes; procedures, no | procedures yes; words only through bulk imports until the lazy lexicon (1c) lands |
| any host | closest: browser Worker build exists | furthest: four host-only dependencies |
| understands Keal's phrasing | weak | weak (pilot first act 2 to 4 percent, parse coverage 50 against a 60 stop line) |

Napkin is closer on the shape of the system (small, portable, its behaviour in the graph, working
on its own gaps). Noodle is closer on the point of the system (learning to do things and keeping
them). Neither is close on understanding Keal's real requests, and the evidence that the chart plus
imports will get there is thin: on Keal's corpus Noodle sits below command-name matching and far
below a nearest-neighbour baseline trained on the same labels (docs/baselines.md, docs/pilot.md).

What each would need:

- **Napkin**: a Run primitive with effects, guards and a dry run; the teach loop (stuck, give the
  command, slot it, keep it); tool learning from `--help` and man pages; offers and consent;
  trust levels on sources so untrusted text never makes rules; more than one reading with a score,
  or at least a way to keep a second reading when the first has no act; stop appending Wikidata
  dumps to answers. Its hearing would have to stop silently respelling and stop depending on
  compromise's built-in lexicon if Noodle's no-word-lists rule is kept.
- **Noodle**: the lazy lexicon (handoff 1c and 1d) and a seed-only default store; the store behind an
  interface; Run and the man-page reader as optional host capabilities; a fix to standing rules
  from negated statements (confirm before keeping a rule); fewer everyday verbs turned into tool
  commands (the 1,860-pack description pool is behind most of the wrong-reading failures and about a
  quarter of the turn time); and an honest answer to whether the chart can reach Keal's phrasing at all.

## 5. Recommendation

**Start a new, small core that takes the learn-to-act loop from Noodle and the runtime shape from
Napkin.** Concretely:

- From Napkin: the platform split (node and browser behind one surface), packs and a journal
  instead of a 1 GB database, realizations as code in the graph (so the agent can read and change
  its own behaviour, which is design section 0's long-term aim), residual-as-value, the agenda and
  forgetting, short answers from Wikidata, and its test corpus runner.
- From Noodle: primitives with declared effects, guards and Suppose; the try / offer / learn loop
  with taught commands, slots and chained steps; tool learning from `--help` and man pages, as a
  host capability; corrections and recall; trust and the protected base; the scored choice and
  reasons log, but over a much smaller candidate pool; the lazy lexicon (Know.word) instead of bulk
  imports; and the measurement setup (split, holdout, baselines, Keal's two-pass benchmark).
- Leave behind: bulk imports by default (WordNet, Wiktionary idioms, the 1,860 tool packs), the
  dialogue machinery hard-coded in turn.ts, Napkin's regex question detection and silent
  respelling, and appended Wikidata dumps.

Why not the other two:

- **Continue Noodle as is.** The direction is agreed and 1a and 1b are done, so this is the
  cheapest next step, and the seed-only run (22 right, 0.01 s median) is a real baseline to grow
  from. But the parts Keal says drifted are structural, not just the packs: node:sqlite and
  child_process are in the store and the primitives, 10,000 lines of runtime mostly serve the chart
  and the turn's dialogue code, and the chart-plus-imports bet is under its own stop lines. Lazy
  loading fixes size and start time; it does not fix portability or the core understanding gap.
- **Port Noodle's learnings into Napkin.** Napkin's shape is the better starting point, but its
  hearing is one-reading-only and leans on compromise and a 275k word list, its learning has no
  notion of acting, and Noodle's AGENTS rules (no word lists, no grammar in code, the score
  decides) would flag much of its ears. Porting the act loop is moderate work (Noodle's primitives are 2,870 lines, plus the teach
  loop's share of turn.ts and lesson.ts); porting
  the scored chart is a rewrite of Napkin's ears. Most of the effort lands in the same place a new
  core would, with Napkin's history attached.

Costs of starting new, honestly: weeks before it does what either does today; both test sets and
the versus script carry over, but replies regress at first; the risk that the new core repeats the
drift (a lesson to write down: no bulk import and no host dependency without a measured reason).
A cheap check before committing: build the seed-only Noodle with the lazy lexicon (1c, 1d) and run
Keal's two passes on versus and on the 8 dev prompts above. If the second pass is as good as the
installed store (39 right) and fast, the lazy lexicon idea is proven and can move into the new
core as is; if not, that is a finding about the chart, not about the packs.

## Where the evidence is thin

- The 30 raw strings, 40 benchmark items and 12 Napkin-group messages are small samples, graded by
  one agent; the versus strict regrade is one reader's judgement with the reasons given above.
- Napkin's replies on the versus prompts outside the 46 rerun come from its 2026-10-01 run.
- Times were taken while a six-shard import ran in the background; absolute numbers are high, the
  ratios between the systems are more trustworthy than the values.
- Noodle's 10 minute first load is from the handoff, not re-measured. Napkin's unit tests were not
  run.
- Neither system was scored on the corpus's act labels side by side here; the pilot numbers are
  Noodle's own from 2026-10-03 (runtime 0.35.0), and Napkin cannot produce shell acts by
  construction.
- Know reaches live Wikipedia and Wikidata for both, so answers to fact questions depend on the
  network and those pages on the day.
