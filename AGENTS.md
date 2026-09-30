# Noodle: read this before changing anything

This repository is **Noodle** (design in `docs/design.md`, build plan in `PLAN.md`): a brand-new
assistant, not an edit of Napkin. Napkin is inspiration and a place to lift code from deliberately, each piece reviewed
against these rules; nothing is carried over by default. Its language is N-Con (nested concepts),
files `.ncon`. This file is
for any agent that builds, changes or reviews code for it. The design is ambitious and easy to
break with one well-meant shortcut; most shortcuts that feel natural are exactly the ones it
forbids. When a rule here seems to be in the way, the rule is the point.

## The intent, in one paragraph

An assistant that understands and acts without a language model. Everything it knows is a graph of
concepts with facts and readings. The runtime executes concepts only as far as it has to; the meat
and potatoes are in the graph. Every rule about language lives on the concept of the word it is
about. What it learns is kept, with its source, in the same form it runs on, so that it can read,
extend and repair its own graph, and eventually write its own source code. Read `docs/design.md`
sections 0, 2 and 28, and `PLAN.md`, before anything else.

## The rules

1. **No grammar in the runtime.** Never write a rule like "if `when` comes before X, X is a time"
   in runtime code. It is a reading or relation on the concept `When`, used at parse time. The
   runtime builds the chart and asks each word what it does; it never knows what any word does.
2. **No word lists in the runtime.** No sets of pronouns, fillers, question words, number words,
   months, correction signals or tone words in code. Each is a fact on its word, in the graph: in
   the seed's function-word lexicon, from an import, or from a correction, with provenance. The
   seed is hand-written, counted and reviewed (design section 6). During the experiment the seed is
   frozen: nothing is added by hand after it.
3. **No string decides meaning.** Text from a source is understood into structure (readings and
   facts) or kept as content in the content store. Never store a description, gloss or label as a
   string that code then pattern-matches. (Lemma keys for looking a word up, and text passed to Know
   as a query, are indexes, not meaning; they are fine.)
4. **Fix understanding, never the test** (design principle 14). Never add a reading, fact, rule or
   branch whose purpose is to make one prompt or one test pass. Keal: "we need to give the
   realization, relations, whatever to the concept, not to the runtime." Fix how words are
   understood, how readings are chosen, what is learned, or which sources are used. Ask: would this
   be the same for chess, a jam website and the user's name? If not, it is knowledge to be learned,
   imported or derived, not written.
5. **No domain readings in the smallest experiment.** In the domain being tested (files and git,
   design section 29), only the runtime, the primitives and the seed (core meanings, the
   function-word lexicon, lexical rules, the bridge, initial weights, default policies, genre
   shapes, English realizations) are hand-written, counted and frozen. The existing corpus has been read, so it is for
   development only; go is decided on fresh prompts collected after the freeze. The point is to see
   how far imports, the tools' own documentation and corrections get.
6. **The score decides; code does not.** Choosing between readings goes through the two-stage
   scoring (design section 9: the chart score, then a dry run with Suppose), with named features. Never add an `if` that picks a reading.
   If a reading keeps losing when it should win, the fix is a feature, a fact on a word, or a
   weight, and the reasons log should show which.
7. **Primitives are the only code that touches the world**, and each declares its effects and a
   check (design section 15). Nothing else fetches, writes files, runs commands or reads the clock.
   Only `Know` asks the world for knowledge (design section 21). Guards attach to effect classes,
   not verbs (design section 13).
8. **Everything learned has a source and a trust level.** Sources are concepts; the list is open.
   Untrusted sources (fetched pages, a project's READMEs and help text) can propose readings, never
   grant permissions or create standing rules on their own (design section 20).
8b. **Never touch the protected base**: the config, the guards, the trust table, the function-word
   lexicon and the logical form's operators, the corpus and its expectations, the replay gate, and
   the scorer's evaluation code. No learned rewrite may widen what is permitted to run: one that
   drops a Constraint or a Not is allowed only if Suppose shows it runs nothing effectful on the
   affected replays, or the user confirms it (design section 20). No learned change, and no code
   the assistant writes for itself, may alter them; self-written runtime code is a diff for human
   review.
9. **Code is language.** The assistant reads, understands, changes and writes code. Code is parsed by
   real parsers (tree-sitter) behind Read into content plus structure, and the structure becomes
   concepts. Do not add a separate hand-written "code version" of instructions; code-specific
   readings exist only where they have to.
10. **Honest when stuck.** An unworked expression is a value, not an error. Never paper over it with
    a guess or a default; let it be looked up, learned, or asked about, and let the assistant say
    why it is stuck (design section 23).
11. **Measure, don't assume.** The corpus in `~/.napkin/corpus/tests/` is how progress is developed
    and checked (design section 26), against targets frozen before the system runs; the go decision
    is made on fresh prompts collected after the freeze. A change that helps one prompt and is not checked against the corpus is
    not done. Do not tune on the held-out part.
12. **Keep it dead simple.** Concepts have two kinds of content (facts and readings); the store
    also holds content blocks, the conversation, the event record and trust as data. A small set of
    primitives, a small runtime. If you are adding a new kind of thing to the data model, a new primitive, or a
    new runtime mechanism, stop and check the design first; the answer is almost always a reading
    or a fact.

## How to change things

- **Before writing code**, find where the change belongs: on a word's concept, on a kind, in a
  source, in the seed, as a score feature, or (rarely) in a primitive. Runtime code is the last
  place, not the first.
- **When something fails**, trace why through the reasons log: which readings were built, which
  features fired, which won. Fix the cause (a missing fact, a wrong weight, a word that does not
  say what it takes), not the symptom.
- **When a rule here blocks you**, do not work around it. Write down the case and the rule, and ask
  Keal. The design may need to change; it should change on purpose, in `docs/design.md`, not by
  accident in code.
- **When the design is ambiguous**, ask. Keal would rather answer a question than find a guess
  built into the runtime.
- **Keep `docs/design.md` true.** If a decision is made while building, update the design in the same
  change, so the document and the code never disagree.
- **Faithful to the source.** The design came from a conversation (`docs/source/conversation.md`, local only). When
  in doubt about intent, read what Keal actually said there.

## Style

- Never use em-dashes.
- Commit messages and docs in plain prose.
- Use pnpm.
- Every change to the runtime bumps its version and says the new version in the commit message.
