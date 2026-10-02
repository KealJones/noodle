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
pnpm import wordnet ~/.noodle/sources/english-wordnet-2025.xml.gz 2025
```

```bash
pnpm import verbnet ~/.noodle/sources/verbnet/verbnet3.4
```

## Not yet

- **Wiktionary forms** are imported (`pnpm import wiktionary ~/.noodle/sources/kaikki-English.jsonl.gz`,
  from the 523 MB gzipped Kaikki extract); its idioms and definitions are not yet.
- **wordfreq** is downloaded (`~/.noodle/sources/wordfreq-large_en.msgpack.gz`) but not imported:
  sense frequency needs counts per sense, which neither it nor WordNet's release has, so
  `SenseFrequency` still has no data and senses tie.
- **gitglossary(7) and the git man pages** need no download: they are read from the local `man`
  pages by `Read(ManPage(...))` (phase 4).

## What the importers do, and do not

- Word concepts are named by lemma; a lemma the seed already has is the seed's concept (seed
  decision 1). A lemma whose name is a structural concept (`Run`, `Form`) gets the next free name,
  so a word is never a primitive.
- A word the seed gives chart entries to (a function word) gets none from an import.
- VerbNet frames that do not start with a subject and the verb are skipped and counted, never
  guessed. VerbNet's predicates stay its own concepts; the bridge says which core meanings they are.
- The imports were written against the documented formats and tested on invented fixtures in their
  shape. The first run on the real files is the real test; expect to adjust.
