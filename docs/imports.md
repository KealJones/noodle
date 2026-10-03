# Imports: what to download, and how to load it

Noodle's seed knows only function words and core meanings. Content words ("push", "file",
"commit") come from imports (design section 22; PLAN.md phase 3). Keal approved the downloads on
2026-10-01, and these are imported on this machine: Open English WordNet 2025 (128,001 words,
107,519 senses), VerbNet 3.4 (4,325 verbs, 1,533 frames read, 69 skipped), and Wiktionary's forms
and sounds from the Kaikki extract (99,639 forms for 58,928 words). `pnpm chat` and `pnpm serve`
load every pack in `~/.noodle/packs/` after the seed (about 4 seconds).

| Source | Where | License | What it gives |
|---|---|---|---|
| Open English WordNet 2025, WN-LMF XML | the `english-wordnet-2025.xml.gz` asset on <https://github.com/globalwordnet/english-wordnet/releases> (tens of MB compressed; check the page) | CC BY 4.0 | words, parts of speech, irregular forms, senses (synsets) with their kinds and definitions |
| VerbNet 3.4 | the `verbnet3.4/` directory of <https://github.com/cu-clear/verbnet> (a `git clone --depth 1` of the repository) | VerbNet license (permissive) | what verbs take (frames) and what they do (event semantics), which the bridge relates to core meanings |

```bash
mkdir -p ~/.noodle/sources && cd ~/.noodle/sources
```

```bash
git clone --depth 1 https://github.com/cu-clear/verbnet
```

Download the WordNet asset from the release page into `~/.noodle/sources/`, then:

```bash
pnpm run import wordnet ~/.noodle/sources/english-wordnet-2025.xml.gz 2025
```

```bash
pnpm run import verbnet ~/.noodle/sources/verbnet/verbnet3.4
```

## Not yet

- **Wiktionary forms** are imported (`pnpm run import wiktionary ~/.noodle/sources/kaikki-English.jsonl.gz`,
  from the 523 MB gzipped Kaikki extract).
- **Sense frequency** needs counts per sense, which neither wordfreq nor WordNet's release has;
  `SenseFrequency` uses WordNet's own sense order as a rank. wordfreq's word order also picks the
  most common words for stage 0's coverage measure (`pnpm import definitions`, docs/stage0.md).

## Wiktionary beyond forms, and wordfreq

`pnpm run import wiktionary-phrases ~/.noodle/sources/kaikki-English.jsonl.gz` (after wordnet and
wiktionary; about 30 seconds) writes two packs, so either can be taken out on its own:

- **`wiktionary-alternatives.ncon`**: alternative forms ("pls" of please, "fav" of fave) as Forms
  of the word they are forms of (design section 5: identity for understanding), from senses whose
  tags say so (`alt_of`). Misspellings and forms tagged obsolete, archaic, nonstandard, dialectal,
  rare, dated or pronunciation spellings are left out, and so is a form some word in the store
  already has: an alternative form fills a gap, and never makes a known word ambiguous ("me" as
  my, "git" as get, "u" as you). On 2026-10-02: 12,605 forms for 5,485 words.
- **`wiktionary-idioms.ncon`**: idioms and phrasal verbs (a sense tagged idiomatic, an entry in a
  phrasal verbs category, or a phrase) whose every part is a word the store has: 15,045 phrases,
  2,705 of them already WordNet lemmas (given only their parts), with 16,858 senses whose
  definitions are content blocks for the definition understander; 4,909 skipped for a part with no
  word ("one's", hyphens).

  *The design addition* (2026-10-02). The data model had no way to say "said as these words in
  order" except a multi-word Lemma string, which the runtime matches as exact text (so "spilled
  the beans" was not "spill the beans"), and tasks/lessons.md forbids phrases as strings. The
  smallest addition is one fact, no new mechanism: `Words(part, ...)` on the phrase's concept,
  each part a word concept, a part fixed in a form written with its feature
  (`Words(Spill(), The(), Bean(Plural()))`). Hearing's existing multi-word span step (runtime.md
  3.3) proposes the span where the parts are heard in order, in any form, so the phrase competes
  in the chart beside its words, and the score picks. New phrases get no Lemma string. Not yet:
  separated phrasal verbs ("give it up"), and readings for the idioms' senses (the definition
  understander makes those, `pnpm import definitions`).

`pnpm run import wordfreq ~/.noodle/sources/wordfreq-large_en.msgpack.gz` (seconds) writes
**`wordfreq.ncon`**: a `Frequency(zipf)` fact on each word concept whose lemma the list has
(48,798 words). The `WordFrequency` feature (runtime.md 8.1, seed weight 0.25) uses it where the
score wants how common a word is: of the words a token may be heard as but was not written as
(spelling corrections, another case, a stretch), the more common scores higher, by its Zipf
frequency below the most common of them, so it ranks corrections without making a correction
likelier than the word as written ("Sam" stays a name rather than "fam", family). Its license is
CC BY-SA 4.0 (it includes Wikipedia and other ShareAlike text counts), so it is a separable pack.
- **gitglossary(7) and the git man pages** need no download: they are read from the local `man`
  pages by `Read(ManPage(...))` (phase 4). `pnpm run import tool <program>` also reads the tool's
  overview pages' terms (one-word glossary terms no other pack has a noun for become its nouns),
  and understands each summary over the other packs' words (import WordNet and VerbNet first) to
  decide whether the command only shows something (design section 15).

## What the importers do, and do not

- Word concepts are named by lemma; a lemma the seed already has is the seed's concept (seed
  decision 1). A lemma whose name is a structural concept (`Run`, `Form`) gets the next free name,
  so a word is never a primitive.
- A word the seed gives chart entries to (a function word) gets none from an import.
- VerbNet frames that do not start with a subject and the verb are skipped and counted, never
  guessed. VerbNet's predicates stay its own concepts; the bridge says which core meanings they are.
- The imports were written against the documented formats and tested on invented fixtures in their
  shape. The first run on the real files is the real test; expect to adjust.

## Definitions

- **Definitions** (`pnpm run import definitions`, `docs/stage0.md`) write `definitions.ncon`. Its
  strict precision is 54 percent (84 counting partial), still below PLAN.md phase 4's 70 percent
  line, but the harness scores the same with it as without, so it is loaded. A pack whose file
  leaves `~/.noodle/packs/` is taken out of the store on the next start.

## HTTP APIs from their OpenAPI descriptions

GitHub's REST API description (`api.github.com.json` from the `descriptions/api.github.com/`
directory of <https://github.com/github/rest-api-description>, about 13 MB, MIT) is downloaded
once into `~/.noodle/sources/`. How the API is spoken to is given on the command line:

```bash
pnpm run import openapi ~/.noodle/sources/api.github.com.json github --cli "gh api" --method -X --field -f --typed-field -F --fills owner,repo
```

This writes `openapi-github.ncon` (about 2 minutes; on 2026-10-03: 1,232 operations, 1,107
summaries understood, 4,276 readings, 3,680 parameters). Its source is `ApiDoc(...)`, which the
trust table does not list, so it is level 4: every operation is a proposal.
