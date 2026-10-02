# Results

Numbers as they are measured, dated, with what produced them. Development data only: the
exploratory corpus (`~/.napkin/corpus/tests/cases.jsonl`) and the development side of the split
(`~/.noodle/experiment/split.json`, written 2026-10-01 before any act was scored). Nothing here is
the confirmatory set, and nothing here decides go (design section 29).

## 2026-10-01: seed 0.1.0 plus edits, runtime 0.11 to 0.13, no imports

What Noodle knew: the seed (function words, core meanings, bridge, realizations), and what
`pnpm import tool git` and `pnpm import tool gh` learned from the local man pages (138 git
commands, 142 gh commands). No WordNet, VerbNet or Wiktionary: almost every content word that is
not a command name is unknown.

### Hearing (`pnpm measure`, 1,784 corpus cases under 80 tokens, seed only)

| Measure | Value |
|---|---|
| tokens with a candidate other than "unknown" | 77.2% |
| tokens read by the best cover | 61.8% |
| full parses (one edge, nothing skipped) | 2.1% |
| median / p95 time per message (hearing and chart) | 2.9 ms / 18.3 ms |

### Acts (`pnpm score:acts`, 713 labelled prompts on the development side, dry run)

Each prompt heard in a fresh session; the acts the winner would run or offer, against Keal's
labels (program and subcommand). 20 prompts over 150 words were not heard.

| Measure | Value |
|---|---|
| prompts labelled with acts: exact act set | 2.4% (8/335) |
| prompts labelled with acts: first act right | 6.0% (20/335) |
| prompts labelled with acts: any act right | 13.7% (46/335) |
| prompts labelled no act: no act | 74.9% (268/358) |
| prompts labelled no act: a false act | 25.1% (90/358) |

The most common misses are PR acts (`gh pr view`, `gh pr list`) and file reads and edits, phrased
in words Noodle does not know yet; and multi-act requests whose steps include an edit. The false
acts are mostly command names used as ordinary English ("add", "show", "log", "list"), which
WordNet's senses and the score's evidence are meant to separate.

### Against command-name match (`node scripts/baseline.mjs`)

The zero-effort baseline of design section 29: every learned command whose name appears in the
prompt as a word. Same labels, same split, same learned commands, same 150-word limit.

| Measure | Noodle | Command-name match |
|---|---|---|
| acts: exact act set | 2.4% | 5.1% |
| acts: first act right | 6.0% | 11.3% |
| acts: any act right | 13.7% | 23.6% |
| no act: no act | 74.9% | 65.4% |
| no act: a false act | 25.1% | 34.6% |

Command-name match finds more of the labelled acts; Noodle makes fewer false acts. With no content
words, a request Noodle cannot parse around its command word does not reach the act, where a name
match does not need to parse at all. The other baselines (Napkin, BM25) have not been run yet.
