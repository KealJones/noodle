# What manual pages say of kinds, heard into facts

Measured 2026-10-04 (design sections 21 and 25: `Learner.statements`, read by `learnTool` from a
page's DESCRIPTION sentences and each option's sentences after its first). This was run on a
copy of the store with every pack loaded. A real import hears with the tool packs taken out, so
the counts may differ a little.

## How many

| | programs | sentences | heard whole | clause pieces | clauses about a kind ("a/an X") | statements |
|---|---|---|---|---|---|---|
| DESCRIPTION, 13 programs (lsof ps kill netstat ls du df find grep chmod tar ssh curl) | 13 | 124 | 20 | 130 | 1 | 3 |
| DESCRIPTION, 89 more programs (cat ... security) | 89 | 1001 (38 over 40 words) | 269 | 1080 | 3 | 13 |

Option sentences after the first, for the 13 imported programs, added none. Hearing costs about
0.5 s a sentence: lsof's import went from 64 s to 78 s.

Most manual sentences are not about a kind said generically. Their subject is the program
("lsof lists ..."), "this option", "the file", or they have no subject at all (625 of 1080
clause pieces have none: an imperative, or a fragment). Few of those that are about a kind are
heard whole.

## Graded: every statement (16; there were not 30 to sample)

| page | sentence (start) | statement | status | grade |
|---|---|---|---|---|
| lsof | An open file may be a regular file, a directory, ... | Directory: IsA(open file) | Active | right |
| awk | An action is a sequence of statements. | Action: IsA(sequence of statements), three readings | Active | right (x3) |
| sort | A line is a record separated from the subsequent record by a newline ... | Line: IsA(Aside(option z, character)), three readings | Active | wrong (x3): the bracket was heard as the kind |
| tar | Patterns are shell-style globbing patterns ... | Pattern: Be("shell-style") | Pending | true, but says nothing usable |
| ssh | A complete command line may be specified as command ... | AsProgram: IsA(complete command line) | Pending | wrong |
| dd | A partial input block is one where ... (three sentences) | Block: Be(1) | Pending | wrong (x3): "one" heard as the number |
| awk | A relational expression is one of the following: | Expression: Be(1) | Pending | wrong |
| less, more | Less is a program similar to more (1) ... | Lesbian: IsA(Program) | Pending | wrong: "Less" heard as a misspelt word |
| traceroute | A reply that returns with a ttl of 1 is a clue ... | Rep: IsA(Clue) | Pending | wrong |

Active: 4 right of 7 (57%). Pending: 0 right of 9 (1 true but not useful). Pending is therefore
the right place for a statement heard from part of a sentence. An Active statement is wrong
where a bracketed aside is heard as the kind.

## Why lsof's example is not there

The sentence is "An open file may be a regular file, a directory, a block special file, a
character special file, an executing text reference, a library, a stream or a network file
(Internet socket, NFS file or UNIX domain socket.)". It gives "a directory is a kind of open file".
It does not give "a network file is an open file" or "an Internet socket is a network file",
for two reasons:

- "or a network file" is heard as the verb "file" with "a network" as its subject. The
  bracketed list then becomes that verb's theme. On its own, "A network file is a file." is heard
  the same way.
- A bracketed list after a noun is heard as an aside, not as kinds of the noun. Saying so is a
  chart or seed matter (apposition), not done here.

What the one lsof fact does: with lsof's pack loaded, "list open directories" now offers `lsof`.
The request's directory steps to lsof's "open files" through "a directory is a kind of open
file". Without the step, nothing is reached. "list the open directories" is still not reached:
there "the open directories" is a referent, and that reading wins. The fresh prompts ("what's
using port 3000", "which process is listening on port 8080", "what files does process 1234 have
open", "show network connections", "kill the process on port 3000") still fail at hearing,
before any match: "port" as a verb, "what's using X" losing X, "show" heard as `git show`.
`pnpm versus:noodle` (store and pack copies, ChatGPT off) gives 38/50/6/0 before and after, with
no prompt's verdict changed and a median turn time of 0.26 s both times.

On their own, "An Internet socket is a network file." gives Socket: IsA(network file), and "A port
is part of an Internet address." gives Port: PartOf(Internet address). The machinery works where
hearing does.
