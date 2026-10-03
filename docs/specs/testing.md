# The test strategy

Status: reviewed at checkpoint 0, 2026-10-01 (PLAN.md phase 0, item 6). Design sections 26 and 29
are the source. This spec says what is tested, on which data, against what, and what keeps the
scored system honest.

## 1. Layers

| Layer | Data | Decides | Section |
|---|---|---|---|
| Runtime unit tests | hand-written, in `src/**/*.test.ts` | whether the mechanism works | 2 |
| Rule lints | the repository's own source | whether the runtime obeys AGENTS.md | 2.3 |
| The corpus | `~/.napkin/corpus/tests/` (exploratory) | development progress | 3 |
| The replay gate | hand-checked corpus items | whether a learned change is kept | 4 |
| The experiment | fixtures, gold acts, fresh prompts | go or stop | 5 to 8 |

Runtime unit tests never read the corpus, and the corpus never tests the runtime's internals: a
unit test that passes because of one corpus prompt is a test aimed at a case (AGENTS.md rule 4).

## 2. Runtime unit tests

`node:test`, run by `pnpm test`. Every runtime component has tests against its spec, written first
(PLAN.md phase 2), using **invented words and concepts** where the mechanism is the point (a chart
test uses `Blick` and `Florp` with made-up Takes facts, so no test can pass because of what an
English word means).

### 2.1 Per component

- **Format** (`ncon-format.md`, section 6): the round-trip rules, property-checked over generated
  expressions (random heads, roles, literals, nesting to depth 8, raw and JSON strings, `#` heads),
  and run over every `.ncon` file in the repository; parse errors report line and column; files
  import atomically.
- **Store**: facts and readings round-trip with meta; indexes find by lemma, by fact head, by named
  concept, by pattern head; retracting a source retracts everything derived from it, transitively;
  derived trust is the minimum; protected items reject learned writes.
- **Matching**: exact matching with roles, positions, variables, `_`, extra roles, opaque nodes;
  the scored match's features on hand-built trees, with kind distances from a small invented
  hierarchy.
- **Shapes and candidates**: each shape head; edit distance with neighbouring keys from facts;
  stretch squeezing; surroundings from an invented directory listing.
- **Chart**: each of the six steps in isolation and in combination on invented lexicons; category is
  hard and kind is soft; pruning keeps the top k; partial parses exist for garbled input; lexical
  rules add competing edges.
- **Score**: feature values per template; the log-linear sum; the reasons log records every choice
  point; the perceptron update and its cap; calibration maps scores to probabilities.
- **Rewriting**: expand and collapse compete; senses chosen only when a want needs one; the step
  budget and cycle stop; unworked expressions stay as values.
- **Logical form**: canonicalization, each rule of `logical-form.md` section 8, and the worked
  examples as canonical-equality tests on hand-built LFs (not parsed from English: the seed is not
  written yet when these tests are).
- **Primitives**: each check and inverse, in a temporary directory or sandbox repository; Run never
  receives a shell string; Suppose captures effectful calls and runs pure ones within budget.
- **Focus**: the pre-chart candidate set is bounded per source and uses no network; a need searches
  sources in order and asks only when all fail; the budget stops lookups; dropped candidates are
  not kept; everything pulled in is in the reasons log; cloned-repository files come in at level 3.
- **Guards and trust**: guarded classes are offered; only level 1 grants; levels 3 and 4 readings
  do not run effectful acts unconfirmed (outside the sandbox switch); the constraint invariant
  rejects a learned rewrite that drops a `Not` and would run an effectful primitive on a replay.

### 2.2 Seed tests

Once the seed exists: it parses and round-trips; every entry has a source; the counts per part are
printed; every bridge entry names no domain command (checked against the frozen command-name list
of design section 29); every core meaning is in the closed list.

### 2.3 Rule lints

Tests over the repository's own source, so the AGENTS.md rules are enforced by more than review:

- **Structural names only**: runtime code (everything in `src/` except primitive modules' own
  declarations and tests) names no concept outside `src/structural.ts` (`built-ins.md`, section 4).
  Checked by scanning for head-shaped string literals and `c("...")`-style constructors.
- **No word lists**: no array, set or map literal in `src/` with three or more string elements that
  are all lowercase words, and no regular expression that alternates over words. False positives
  are fixed by moving the data into the graph. An exception needs Keal's approval and is listed in
  the lint with its reason.
- **World access**: only primitive modules and Know's source adapters import `node:fs`,
  `node:child_process`, `node:net`, `node:http(s)` or call `fetch`, or read the clock
  (`Date.now`, `new Date()` without an argument, `performance.now` outside the performance harness).
- **No shell strings**: no call to `exec` or `spawn` with `shell: true`, anywhere.
- **Version bump**: a change under `src/` without a change to `src/version.ts` fails the pre-commit
  check.

## 3. The corpus

`~/.napkin/corpus/tests/` (design section 26): 1,895 cases, 299 paraphrases, model-drafted
expectations, implementation-neutral (its README). It is **exploratory**: Keal has read its
analysis, so it develops and checks progress but never decides go.

- **The runner** is `scripts/corpus.mjs`. Today it is an adapter for Napkin (the baseline, PLAN.md
  phase 1). Noodle gets its own adapter over the same files, exposing what Napkin's could not
  (intent, acts, kinds, referents, behaviour checks), selected by `--system noodle`.
- **Checks** are the corpus README's, scored per case and per group. `reading-sketch` stays
  informational: the analysts' vocabulary is not Noodle's.
- **Holdout**: 30 percent of the real prompts, split **by conversation**, never tuned on. The split is
  a file (`~/.noodle/experiment/split.json`) written once, before development starts, with a fixed
  seed, and never regenerated.
- **Every change is checked against the corpus** (AGENTS.md rule 11): a change that helps one prompt
  and is not run on the development set is not done. The runner prints the before and after per
  group, and the diff of which cases changed.

## 4. The replay gate

- **Items**: only hand-checked items (`checked.jsonl`, section 6.1), so unchecked model drafts never
  veto a change.
- **When**: every learned change (a weight update, a link, a split, a rewrite) and every seed change
  after the freeze of its part.
- **What**: the items the change touches (their derivations used a changed weight, word or reading)
  are replayed, plus a full replay in batches. A change is kept only if no affected item's top
  reading changes from right to wrong.
- **It proves nothing regressed.** The holdout and the hand-check measure rightness.
- The gate's code and its item list are in the protected base.

## 5. The experiment's gold

The gold is an **executable act**, not a logical form (design section 29), so it can be frozen before
the concepts it would be expressed in are learned.

### 5.1 Gold format

One JSON object per item, in `~/.noodle/experiment/gold.jsonl`:

```
{
  "id": "x_0042",
  "fixture": "fx_0042",
  "text": "commit everything except the plan and push",
  "namesCommand": true,              // contains a frozen command-name lemma (design section 29)
  "class": "acts",                   // "acts" | "constraint" | "none" (not a git act: negative set)
  "acts": [
    { "program": "git", "sub": "commit",
      "files": ["src/a.ts", "src/b.ts"],   // exact, as paths
      "flags": [],
      "message": { "constraints": ["names-changed-areas", "answers-request"] } },
    { "program": "git", "sub": "push",
      "remote": "origin", "branch": "feat/x", "flags": [] }
  ],
  "constraints": [],                 // e.g. [{ "rule": "not", "act": { "sub": "push" }, "until": "told" }]
  "labelledAt": "2026-10-12T09:00:00Z",
  "labeller": "keal"
}
```

- **Arguments match per kind**: exact for files, branches, refs and remotes; flags as a set; a
  commit message is any message that passes its stated constraints (design section 26), never a
  string match.
- **Order**: acts in the listed order; an item whose acts may run in any order says
  `"order": "any"`.
- **A constraint on its own** ("don't push yet") has `class: "constraint"`, no acts, and the stored
  rule. The gold end state is "nothing ran, the rule is stored".
- **Pull requests** are scored on the act label only, unless a mock of the GitHub API exists (design
  section 29).

### 5.2 Fixtures and the sandbox

A fixture is what the world was when the prompt was sent: the working tree, the index, branches,
the remote's refs and objects, and the conversation before it (the prior assistant's turns and its
tool calls, standing in for the event record).

- Stored as a directory per fixture: a git bundle of the repository with all refs, a bundle of the
  remote (restored as a local bare repository), a tarball of untracked and modified files, and
  `turns.jsonl`.
- Written by the **capture hook** (PLAN.md phase 1) for fresh prompts; drafted from transcripts for
  historical ones where the state can be reconstructed.
- **What the capture hook records**, each point from a gap found drafting the historical fixtures
  (of 481, only 81 have a likely starting commit and none has its uncommitted changes):
  1. The commit: `git rev-parse HEAD` and the branch. Transcripts record the folder and branch
     name but never the commit, which is most of why historical state cannot be rebuilt.
  2. Uncommitted work, without changing anything: `git stash create` gives a commit of the index
     and the working tree and leaves the stash list alone; untracked files go into a tarball.
  3. A pin: `git update-ref refs/noodle/capture/<id>` on both commits, so they survive garbage
     collection and deleted worktrees (74 historical commit ids no longer resolve).
  4. The remote: `refs/remotes/*`, and `git ls-remote` when online, since push, pull and merge
     results depend on it.
  5. Both paths when the folder is a worktree: the worktree and its parent repository. Many
     historical fixtures were lost with deleted worktrees.
  6. Whether the message was typed: automated messages (scheduled heartbeats, harness blocks) are
     marked at capture and never counted as prompts; 223 heartbeats had inflated the corpus
     counts.
  7. Both assistants: Claude Code and Codex. The historical fixtures were drafted from Claude
     Code transcripts only, so Codex prompts have none.
  The hook is `scripts/capture.mjs` (tests: `pnpm test:capture`), registered as a `UserPromptSubmit`
  hook in both assistants. It writes `~/.noodle/experiment/fixtures/<id>/` (`meta.json`,
  `turns.jsonl`, `untracked.tar.gz`) and one line per prompt (time, folder, session id, the
  prompt) to the month's index, `capture/YYYY-MM.jsonl` (prompts before 2026-10-02 are in the older
  `captures.jsonl`), and takes about 0.3 seconds. It never uses the network. `pnpm capture:install`
  prints the settings entry; `pnpm label` is the blind labeller (section 6.3): it shows unlabelled
  typed prompts in batches with the assistant's last turn before them, never runs Noodle, and
  appends gold lines (section 5.1, `id` and `fixture` are the capture id) to `gold.jsonl`. Pins are refs in the user's own repositories (never pushed by a plain push); bundling
  a fixture for the sandbox happens later, only for the prompts that are labelled.
- **The sandbox** restores a fixture into a temporary directory with `HOME` set inside it,
  `GIT_CONFIG_NOSYSTEM=1`, a fixed author, committer and date, and the remote as a local path, so
  nothing reaches the network or the user's real repositories.

### 5.3 End state

For an item, the gold acts and the system's acts are each run in a fresh sandbox from the same
fixture. The end states are equal when all of these are:

- each branch's commit **tree** and the shape of its history since the fixture (commit hashes differ
  because of messages and times, so trees and parent structure are compared, not hashes);
- the index and the working tree status;
- the bare remote's refs, compared the same way;
- the stash list (by tree);
- the standing rules stored (for constraint items);
- commit messages pass their gold constraints.

Asking or abstaining is wrong for both metrics. A guarded act offered with the correct target is
correct (design section 29).

## 6. Data and labels

### 6.1 The hand-check

Keal checks every item the experiment uses and a stratified sample of 100 across the corpus, in a
separate session, writing `~/.napkin/corpus/tests/checked.jsonl`:

```
{ "id": 1177, "verdict": "ok" | "fixed" | "reject", "fields": { ... corrected expectation fields },
  "note": "...", "at": "..." }
```

The agreement rate with the model drafts is reported and bounds how far the unchecked rest can be
trusted.

### 6.2 Splits

| Set | From | Used for | Never used for |
|---|---|---|---|
| Development | exploratory corpus minus the rest | development, training the perceptron | calibration, go |
| Calibration | a slice of the exploratory labels, held apart | calibrating the ask threshold, the match threshold | training, go |
| Holdout | 30 percent of real prompts, by conversation | checking development honestly | tuning, go |
| Confirmatory | fresh prompts from the capture hook after the freeze, labelled blind | **go** | anything before scoring |
| No-name | real requests whose prompt does not name the command (exploratory labels), plus 15 paraphrases Keal wrote blind | reported beside go | go |
| Negative | fresh prompts with git words that are not git acts | false-act rate, reported | go on its own |

### 6.3 Blind labelling and reliability

- Confirmatory items are labelled **before** scoring and blind to the system's output; label and
  score times are logged; nothing in the seed or the protected base changes between labelling and
  scoring.
- Keal re-labels a random 20 percent after a delay; kappa with his first labels is reported, and
  agreement with the model drafts separately (design section 26).

## 7. Baselines and statistics

- **Baselines** (design section 29), each given what it can use: command-name match; BM25 from the
  request to the man pages; a word classifier on the same labels, with and without man-page TF-IDF
  features and WordNet expansion; nearest neighbours over the exploratory set; for arguments, a slot
  filler (recency plus shape match) for every act baseline; for referents, recency and a learned
  salience ranker; a language model as a non-deciding ceiling. Napkin is scored too.
- Baselines live in `scripts/baselines/`, are run by the same scorer on the same items, and are
  frozen with the system.
- **Statistics**: every number with a 95 percent interval (Wilson for proportions); comparisons on
  the same items by paired bootstrap on per-item correctness (10,000 resamples, resampling
  conversations, not items); non-inferiority by TOST at the margin; the several go tests corrected
  by Holm. The sample size for the margin is computed in the pilot with its assumptions stated.

## 8. The frozen system

The scored system is one unit (design section 29): `freeze.json` records the runtime commit hash
and version, each pack's name, version and content hash, each seed part's hash and count, the
trained weights' hash, the match and ask thresholds, and the config values that affect scoring (the
cost ratio, the update cap, k, the stage-two width, the rewrite budget).

- The scorer refuses to score confirmatory items unless the loaded system's hashes match
  `freeze.json`.
- `pnpm freeze [--id ID] [--weights FILE]` writes `~/.noodle/experiment/frozen/<id>/`: `freeze.json`,
  a copy of every pack (classified by its source: `ToolDoc` and `ApiDoc` packs are the documentation
  readings of arm A+, the rest imports), `weights.ncon` (the trained weights; by default the learned
  weights in the store) and `confirmed.json` (Keal's confirmations, for the variant reported beside).
  The manifest also holds the runtime's commit, version and source hash, the turn's settings, each
  seed part's hash and count, the gold format version, the mapping from gold to acts, the go and stop
  rules quoted from design section 29, and n, the margin and alpha from the pilot
  (`~/.noodle/experiment/pilot.json`, `{"n", "margin", "alpha", "at"}`), null until the pilot writes it.
  It refuses on a dirty tree or a failing seed check and never overwrites a freeze; it writes
  `docs/frozen-<id>.md` to publish.
- `NOODLE_FROZEN=<id>` runs the frozen system (its stores are built in the frozen directory from the
  copies) and refuses to start if anything differs; a frozen system learns nothing.
- `pnpm decide [--frozen ID]` runs the arms (A, A+ zero-shot, A+ trained, and the confirmed
  variant) and the baselines in `scripts/baselines/` (each module's default export is
  `{ name, role: "name-match" | "trained" | ..., predict(item) }`, returning `{ program, argv }`
  acts) on the confirmatory set, each item as a dry run in a sandbox cloned from its fixture, and
  applies the go rule as frozen: the floor by an exact binomial test, superiority over command-name
  match and non-inferiority to the best trained classifier by paired bootstrap over conversations,
  Holm over the three, and the coverage condition. It refuses, saying why, when nothing is frozen,
  the checkout or anything else differs from the manifest, n is not set or not reached (with how
  many more are needed), or a baseline the go rule needs is missing. Results go to
  `~/.noodle/experiment/decided/`.
- Development continues on a separate version that is never the one scored.
- The freeze, the gold format and the mapping of expectations onto it are published before any
  confirmatory item is scored.

## 9. What is reported

Act accuracy and end state per arm and baseline, with intervals; everything also on the requests
with the command's name; parse coverage per construction type; chart size and oracle recall at k;
sense accuracy on the domain's lemmas; accuracy by skip rate; the ablation of `ReachedAct`; results
with and without the bridge; label reliability; seed counts by part; confirmations and learned
structures by kind; the false-act rate; the "I don't know" rate (design section 23); learning
curves, not one number.

## Open questions

1. **Where the experiment's files live.** This spec puts gold, fixtures and splits under
   `~/.napkin/corpus/`, beside the corpus, because they hold work data. Keep them there, or move to
   `~/.noodle/experiment/` now that the project is Noodle?
2. **Commit message constraints.** Which constraints does a gold commit message carry? This spec
   proposes two: it names every changed file's area, and it names the request (design section 25).
   "Names the request" needs a check that is not a string match; the proposal is that the message's
   understood concepts include the request's act and object.
3. **History shape in end states.** Comparing trees and parent structure treats a squash and a
   series of commits as different. Is that right for "commit and push" items where the gold does not
   care how many commits?
4. **Bootstrap clusters.** Resampling by conversation assumes items in a conversation are dependent.
   Confirm the unit (conversation, or day).
5. **The GitHub API mock.** Build one (PR items then score on end state), or score PRs on the act
   label only, as the design says?

## Decided

Keal (2026-10-01):

- **Where the experiment's files live (1):** `~/.noodle/experiment/` (gold, fixtures and captures,
  splits). The exploratory corpus and its labels stay in `~/.napkin/corpus/tests/`.
