# Baselines (PLAN.md phase 5; design section 29; testing.md section 7)

Measured 2026-10-02, runtime 0.30.0, everything imported (WordNet 2025, VerbNet 3.4, Wiktionary
forms, definitions, git and gh man pages). Development side of `~/.noodle/experiment/split.json`
only (the holdout is never read), Keal's labels in `~/.napkin/corpus/tests/labels.jsonl`, prompts
of at most 150 words, heartbeats left out: 335 prompts labelled with acts, 345 labelled no act. Nothing
here is the confirmatory set or decides go.

Produced by `pnpm baseline` (`scripts/baseline.mjs`) and `pnpm score:acts` (`scripts/acts.mjs`,
Noodle; 2 prompts errored there, so its no-act count is 343). Trained baselines and thresholds are
scored by 5-fold cross-validation with folds by conversation (project directory and day, the
split's key). "No name" is the 76 act prompts Keal marked as not naming the command.

| | exact act set | first act right | any act right | no act: none | no act: false act | no name: first right |
|---|---|---|---|---|---|---|
| **Noodle 0.30.0** | 1.8% (6) | 4.2% (14) | 8.1% (27) | 89.8% (308/343) | 10.2% (35/343) | 2.6% (2) |
| command-name match | 5.1% (17) | 11.3% (38) | 23.6% (79) | 64.1% (221) | 35.9% (124) | 0.0% (0) |
| BM25 over the man pages, CV threshold | 0.0% | 0.0% | 0.0% | 100% | 0.0% | 0.0% |
| BM25, always the top page | 1.8% (6) | 2.1% (7) | 9.6% (32) | 0.9% (3) | 99.1% (342) | 2.6% (2) |
| BM25 + WordNet, always the top page | 1.5% (5) | 1.8% (6) | 3.3% (11) | 0.9% (3) | 99.1% (342) | 2.6% (2) |
| nearest neighbour (TF-IDF, 1-NN) | 16.4% (55) | 27.5% (92) | 44.2% (148) | 59.7% (206) | 40.3% (139) | 21.1% (16) |
| word classifier (logistic, one-vs-rest) | 13.7% (46) | 22.4% (75) | 41.2% (138) | 86.7% (299) | 13.3% (46) | 21.1% (16) |
| classifier + man-page features | 14.9% (50) | 23.3% (78) | 42.1% (141) | 87.5% (302) | 12.5% (43) | 23.7% (18) |
| classifier + man pages + WordNet | 8.1% (27) | 21.2% (71) | 44.2% (148) | 69.9% (241) | 30.1% (104) | 15.8% (12) |

BM25's top 3 holds a right act for 20.9% (70) of act prompts, 6.9% (23) with WordNet. With the
threshold chosen by cross-validation BM25 never acts: its top page is right so rarely that saying
nothing scores better, so its useful rows are "always top" and top 3.

## What it says

- Noodle is below every baseline on finding acts, including command-name match (first act 4.2%
  against 11.3%), and below where it was at 0.17.1 (8.7% first, 17.3% any, docs/results.md).
  It makes the fewest false acts of anything that acts at all (10.2%), mostly by not acting.
- The trained baselines are far ahead: nearest neighbour and the classifier find a right act for
  41 to 44 percent and get the first act right for 22 to 28 percent, and do it on the no-name
  prompts too (21 to 24 percent first right, against Noodle's 2.6%). The classifier keeps false
  acts at 13%, close to Noodle's. These are the numbers design section 29's go criteria compare
  against ("not worse than the best trained classifier by more than the margin").
- Man pages help little: BM25 from Keal's phrasing to the documentation is near chance for the top
  page, and as features they add about one point to the classifier. WordNet expansion hurts both
  (it adds many loosely related words).
- Read, edit and find acts have no man page, so name match and BM25 cannot produce them; the
  trained baselines can, which is part of their lead.

## Not run, and why

- **Slot filler (arguments) and salience ranker (referents)**: they need typed gold arguments and
  referents (files, branches, remotes) checked against a fixture. The exploratory labels give
  targets as prose ("PR 152 pending review comments"), and only 149 of 482 historical fixtures are
  reconstructable, so there is nothing to score them on. They run on the experiment's gold
  (testing.md section 5.1), which `pnpm label` now writes from captured prompts.
- **Napkin** and the **language model ceiling**: not part of this script (Napkin is scored by
  `scripts/corpus.mjs` and `pnpm versus`).
- No intervals or paired bootstrap yet (testing.md section 7); with these gaps they would not change
  any conclusion.
