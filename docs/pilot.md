# The pilot (PLAN.md phase 5; design section 29, stage 1)

Written by `pnpm pilot` (`scripts/pilot.mjs`) on 2026-10-03, runtime 0.35.0. Development side of
`~/.noodle/experiment/split.json` only (the holdout is never read); the labels that exist (the
exploratory labels in `~/.napkin/corpus/tests/labels.jsonl`, the later label where a prompt was
labelled twice; `~/.noodle/experiment/gold.jsonl` does not exist yet: no captured prompt has been labelled). Prompts of at most 150 words, heartbeats
left out. Nothing here is the confirmatory set or decides go.

**n available: 312 act items and 331 no-act items** (643 labelled; PLAN.md asked for about 50).
36 of the act items carry a label Keal wrote or checked; the rest are model drafts
(`claude-subagent`, `claude-assumed`) he has not checked, so every number below inherits their error.

## What the pilot can and cannot measure

The deciding metric is **end state** (design section 29). It cannot be measured on these labels:
their arguments are prose ("PR 152 pending review comments"), not typed files, branches and refs.
0 of 312 act items have typed arguments, 54 have a fixture that can be rebuilt, and
**0** have both and are not pull requests. So everything here is on **act label accuracy**
(the exact set of acts, the stricter of the act metrics), which bounds end state from above: an
item cannot reach the right end state with the wrong acts.

## The ceiling

What a perfect reader could score on act labels, given what the scorer gives it (the prompt alone,
no prior turns, no fixture):

| | items | share of act items |
|---|---|---|
| act items | 312 | 100% |
| the command is named only in the turns before (`noname-real.jsonl`: nameIn = prior-turns) | 29 | 9.3% |
| an act outside the experiment's act set (`outsideActSet`) | 129 | 41.3% |
| a pull-request act (scored on the act label only, design section 29) | 160 | 51.3% |
| requests without the command's name (the frozen list, `namesCommand`) | 87 | 27.9% |

- **Act label ceiling, prompt only: 90.7%.** Only the no-name items were marked for
  where the name is, so this is an upper bound; other items may lean on earlier turns too.
- **Act label ceiling within the act set: 55.4%** (also dropping items with an act outside it).
- **End state ceiling on these labels: 0.0%**: what is not typed or not rebuildable cannot be checked.
  End state needs the experiment's gold (testing.md section 5.1), which `pnpm label` writes.

## Every system, act items and no-act items

Exact act set on act items (95% Wilson interval), by stratum, and "no act" on the no-act items.
Baselines are as `scripts/baseline.mjs` defines them; trained ones by 5-fold cross-validation
with folds by conversation.

| | act items: exact | named | no name | no-act items: none |
|---|---|---|---|---|
| **Noodle A** | 0.0% (0/312; 0.0 to 1.2) | 0.0% (0/225) | 0.0% (0/87) | 97.3% (322/331) |
| **Noodle A+ zero-shot** | 1.9% (6/312; 0.9 to 4.1) | 2.2% (5/225) | 1.1% (1/87) | 91.2% (302/331) |
| name | 5.4% (17/312; 3.4 to 8.6) | 7.1% (16/225) | 1.1% (1/87) | 64.0% (212/331) |
| bm25 | 0.0% (0/312; 0.0 to 1.2) | 0.0% (0/225) | 0.0% (0/87) | 100.0% (331/331) |
| bm25 (always top) | 1.9% (6/312; 0.9 to 4.1) | 2.2% (5/225) | 1.1% (1/87) | 0.6% (2/331) |
| bm25+wn | 0.0% (0/312; 0.0 to 1.2) | 0.0% (0/225) | 0.0% (0/87) | 99.7% (330/331) |
| bm25+wn (always top) | 1.6% (5/312; 0.7 to 3.7) | 1.8% (4/225) | 1.1% (1/87) | 0.6% (2/331) |
| knn | 16.7% (52/312; 12.9 to 21.2) | 16.9% (38/225) | 16.1% (14/87) | 61.0% (202/331) |
| classifier | 12.2% (38/312; 9.0 to 16.3) | 12.4% (28/225) | 11.5% (10/87) | 90.6% (300/331) |
| classifier+man | 12.5% (39/312; 9.3 to 16.6) | 12.0% (27/225) | 13.8% (12/87) | 87.3% (289/331) |
| classifier+man+wn | 9.9% (31/312; 7.1 to 13.8) | 8.0% (18/225) | 14.9% (13/87) | 69.8% (231/331) |

- **Noodle A**: imports alone (WordNet, VerbNet, Wiktionary, definitions, word frequencies), seed weights. 3 prompts errored (counted as no act), of which 2 took the process down (out of memory; corpus ids 962, 2123), a runtime bug to fix.
- **Noodle A+ zero-shot**: the same plus the documentation readings (git, gh and the other learned tools), seed weights. 3 prompts errored (counted as no act), of which 2 took the process down (out of memory; corpus ids 962, 2123), a runtime bug to fix.
- **Noodle A+ trained** (the arm go is decided on) **cannot be run yet.** The runtime's perceptron
  learns only from a user's correction in a session (`Session.correct` in `src/runtime/turn.ts`). What
  is missing is a trainer: for each exploratory label, hear the prompt, take the best reading whose
  acts equal the gold (the latent-variable step of runtime.md 15) and update toward it, by
  cross-validation folds so it is scored like the classifier. Until then A+ zero-shot stands in, and
  training can only add to it.
- **Not run**: the slot filler and the salience ranker (they need typed argument and referent gold,
  above), the language model ceiling and Napkin (scored elsewhere: `pnpm versus`).

## The margin

The best Noodle arm is **Noodle A+ zero-shot** at 1.9%; the best baseline is **knn** at 16.7%;
the best trained classifier is **knn**. Paired on the 312 act items, 10,000 bootstrap
resamples of conversations (project directory and day):

- Noodle A+ zero-shot minus command-name match: -3.5 points (95% bootstrap -5.8 to -1.8; 4.2% of pairs disagree; 62 conversations)
- Noodle A+ zero-shot minus knn (the best baseline): -14.7 points (95% bootstrap -20.0 to -10.5; 16.7% of pairs disagree; 62 conversations)
- the same against knn, on the 36 items Keal labelled or checked: -30.6 points (95% bootstrap -47.2 to -16.7; 30.6% of pairs disagree; 17 conversations)

## The n for the go decision

Go (design section 29), on end state for A+ trained on the confirmatory set, needs all of: (1) at
least the 60 percent floor; (2) better than command-name match with the slot filler by at least the
margin; (3) not worse than the best trained classifier with the slot filler by more than the
margin; corrected by Holm. Stop is the complement.

Assumptions, every one:

- margin 10 points, as the design's example; one-sided alpha 0.025 per test (the 95 percent
  intervals of testing.md section 7), Holm over the 3 tests planned at its first step,
  0.0083, the conservative case; power 0.8 per test, or 0.928 per test for 0.8 that all three pass
  (tests taken as independent);
- paired tests by the normal approximation, n = (z_alpha + z_power)^2 (p_disagree - delta^2) / (delta - bound)^2;
  the floor as a one-sample test of a proportion;
- the rate of disagreeing pairs is the pilot's on act labels (4.2% against name match,
  16.7% against knn) but at least the design's 20.0%, so 20.0% and 20.0%: the
  pilot's Noodle almost never acts, which makes it agree with any system on most items by both
  being wrong; end state disagrees at least as often as act labels; the deciding run replaces this guess;
- clustering by conversation is ignored in n (the design effect is unknown until there are
  confirmatory conversations), so n is a floor;
- labels are taken as correct.

| | n |
|---|---|
| the design's example: a 10-point difference from zero, 20% disagreeing, alpha 0.025 | 150 |
| the same with Holm's first step | 199 |
| (2) a true 10-point win over name match, tested against zero (the design's reading) | 199 |
| (2) as written, "better by at least the margin": a true 20-point win tested against 10 | 168 |
| (3) a true tie with knn, tested against minus 10 | 210 |
| (1) a true 70% tested against the 60% floor | 243 |
| **n needed (the largest of (1), (2) as the design reads it, (3)), power 0.8 per test** | **243** |
| the same with 0.8 that all three pass | 340 |
| (2) with the pilot's own effect, -3.5 points | no n (the pilot's effect is on the wrong side of the bound) |
| (3) with the pilot's own effect, -14.7 points | no n (the pilot's effect is on the wrong side of the bound) |
| (1) with the pilot's own rate, 1.9% | no n (the pilot's effect is on the wrong side of the bound) |

**With the effect the pilot measured, no n reaches go**: Noodle is below name match, more than the
margin below the best trained classifier, and far under the floor, so more items only make stop
more certain. The planned n is what the deciding run needs if Noodle first gets to where the design
assumed; it is the n used for the time below.

## The accrual rate and the time to n

Qualifying means a git or gh request with no act outside the act set, or a constraint on its own.
The share is estimated from the development labels: **36.1%** of the 346 labelled prompts that contain a
frozen command name qualify, and **2.9%** of the 69 randomly sampled prompts without one
(`sample: "non"`) do. Rates are on the development side scaled up by its share of prompts (73.9%).
The share without a name rests on 2 of 69 items, so the prompts with a name alone give a floor:
10.0, 20.0 and 33.5 a week on the three rows below.

| source | weeks | prompts a week | with a command name | qualifying a week |
|---|---|---|---|---|
| the corpus, 2026-06-03 on | 17.0 | 194.2 | 27.8 | **14.9** |
| the corpus, August on | 8.5 | 367.9 | 55.4 | **29.1** |
| the capture hook (200 prompts a person typed) | 0.4 | 529.2 | 92.6 | **46.1** |

The capture hook has run for 2.6 days, 29.0% of it in the Noodle repository itself, so its rate is a snapshot, not a trend; the corpus rate is the
longer record of the same person's use.

| n | at the capture rate | at the corpus rate since August | at the design's 11 a week |
|---|---|---|---|
| 150 (design example) | 3.3 weeks | 5.2 weeks | 13.6 weeks |
| 243 (needed, Holm) | 5.3 weeks | 8.4 weeks | 22.1 weeks |
| 340 (all three at 0.8) | 7.4 weeks | 11.7 weeks | 30.9 weeks |

## The decision PLAN.md asks for

PLAN.md phase 5: "If n cannot be reached in about four months, the domain widens to files in
general now." Four months is about 17.4 weeks.

- **n = 243 is reached in 5.3 weeks to 8.4 weeks at the measured rates (12.1 weeks counting only prompts with a name at the slower one): "about four months" holds and the domain does not need to widen for n.**
- Widening does not touch the other finding: on today's system the pilot's own effect gives no n at
  all. Go needs Noodle to get from 1.9% to above the floor and past the trained baselines first;
  freezing now would be scoring a known stop.
