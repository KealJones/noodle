# The N-Con text format

Status: draft for review (PLAN.md phase 0, item 2). The data it writes is `ncon.md`.

A `.ncon` file is the readable, diffable text form of store contents: the seed, packs, exports and
imports. A file format has a grammar; AGENTS.md's no-grammar rule is about language, not about this.

The expression grammar is Napkin's (`ir-spec` part 3), lifted deliberately, with three changes:
`#` in heads (for senses), `_` as the anonymous variable, and roles on arguments meaning role
concepts. Nothing else of Napkin's file layout comes over.

## 1. Lexical syntax

```
file       := { form }
form       := expr                       // a top-level form, section 2
expr       := number | string | raw | boolean | null | variable | call
call       := head "(" [ arg { "," arg } [ "," ] ] ")"
arg        := [ name "=" ] expr
head       := upper { ident } [ "#" upper { ident } ]
name       := lower { ident }
variable   := "$" ( letter | "_" ) { ident } | "_"
ident      := letter | digit | "_"
string     := JSON string (double quotes, JSON escapes)
raw        := '"""' any text not containing '"""' '"""'   // no escapes
number     := JSON number
boolean    := "true" | "false"
null       := "null"
comment    := "//" to end of line
```

- Whitespace (including newlines) and comments are allowed between any two tokens and mean nothing.
- A trailing comma is allowed.
- `name` is lower camel case and names a role concept by capitalizing its first letter (`theme` is
  `Theme`). Metadata names (section 3) are the exception: they are not roles.
- A head is always followed by parentheses. A bare identifier is an error (it is almost always a
  forgotten `()`), except `true`, `false`, `null`, `_`.
- Files are UTF-8, LF line endings.

## 2. Top-level forms

A file is a sequence of top-level forms. Exactly these heads may appear at top level:

| Form | Writes |
|---|---|
| `Pack(name=, version=, from=?, license=?)` | the file's header: which pack this is. At most one, first. Its `from` is the default source for every item in the file |
| `Concept(Name(), claim, claim, ..., meta)` | a concept and facts about it. Each positional argument after the first is one fact's claim; the meta applies to all of them |
| `Fact(Name(), claim, inSense=?, holds=?, meta)` | one fact, when it needs its own meta, sense or time |
| `Reading(on=Name(), pattern=, wants=?, becomes=?, needs=?, effects=?, checks=?, mode=?, direction=?, meta)` | one reading. More than one want, need, effect or check is written as `All(...)` |
| `Block(id=, media=, body=, meta)` | a content block; `body` is a raw string for text or a base64 string for bytes (`media` says which) |
| `Retract(id=, meta)` | the item with that id stops holding (used in journals and exports, never in the seed) |

A `Concept` form with only a name declares the concept with no facts. The same concept may appear
in several `Concept` forms (in one file or many); their facts accumulate.

`Name()` in the first argument of `Concept` and `Fact`, and in `on=`, is the concept being written
about, written as a call with no arguments (`List#Series()`), like every other reference.

## 3. Metadata

Metadata is written as named arguments with reserved names, on top-level forms only:

| Name | Value |
|---|---|
| `from` | a source expression (`WordNet("list.n.01")`); defaults to the Pack's `from` |
| `at` | an ISO 8601 UTC string; defaults to the time of import |
| `status` | `Active()`, `Proposed()`, `Pending()`; defaults to `Active()` |
| `weight` | a number |
| `id` | a number; only in exports and journals, never hand-written |

Reserved names are never role names: no role concept may be called `From`, `At`, `Status`, `Weight`
or `Id`. A claim's own arguments are never metadata (in `Concept(X(), Near(at=Home()))`, `at` is a
role of Near, because it is inside the claim).

The `pack` of an item is the file's `Pack`; it is not written per item.

## 4. Example

```
// seed/function-words.ncon
Pack(name="seed-function-words", version="0.1.0", from=Seed("function-words"))

Concept(The(),
  Lemma("the"),
  Category(Thing()),
  Takes(side=Right(), category=Noun()))

Concept(And(),
  Lemma("and"),
  Joins())

Reading(on=Can(),
  pattern=Can(agent=You(), act=$x),
  wants=Doable($x),
  becomes=$x)

// packs/wordnet.ncon (excerpt)
Pack(name="wordnet-coarse", version="2024.1", from=WordNet(), license="CC BY 4.0")

Concept(List#Series(), SenseOf(List()), IsA(Series()), Holds(Item()), from=WordNet("list.n.01"))
Fact(List#Series(), SenseCount(912), weight=912)
```

The design's shorthand (`List#Series IsA(Series), from: WordNet("list.n.01")`) is illustrative;
this is the form it means.

## 5. The formatter

`format(file)` prints store contents or a parsed file in one canonical text:

- One top-level form per paragraph, separated by one blank line. A `Pack` header first.
- A form that fits in 100 columns is on one line. Otherwise its arguments go one per line, indented
  two spaces per level, and nested calls break the same way, outermost first.
- Arguments print in the order they are stored: positional first, then roled, in the order they
  were written. The formatter does not sort (fact order on a word carries meaning for Takes), and
  does not canonicalize (that is the logical form's job).
- Metadata prints last, in the order `from, at, status, weight, id`, and only where it differs from
  the file default.
- Strings print as JSON strings; a string with a newline or longer than 80 characters prints raw
  (`"""..."""`), unless it contains `"""`, in which case it stays JSON.
- Numbers print in shortest JSON form. Comments are not kept (they are not data); a file meant to
  keep its comments (the seed) is edited by hand and only checked by the formatter, never
  rewritten by it.

## 6. Round-trip rules

These are tests (`testing.md`, section 2), property-checked over generated expressions and run over
every `.ncon` file in the repository:

1. **Parse is stable under format**: `parse(format(parse(s)))` equals `parse(s)` as data (same
   forms, same arguments in the same order, same metadata), for every valid `s`.
2. **Format is idempotent**: `format(parse(format(x)))` equals `format(x)` as text.
3. **Store round trip**: exporting a store to `.ncon`, importing it into an empty store and
   exporting again gives the same text, ids aside.
4. **Errors have positions**: every parse error reports line and column and the form it was in; an
   invalid file never half-loads (a file imports atomically).

Roles print wherever the data has them (`ncon.md`, Decided).

## Open questions

1. **Comments in the seed.** The seed wants explanations beside entries, but comments are not data,
   so a formatter pass loses them. Options: accept that the seed is hand-edited only, or add a
   `Note(Block(...))` fact for explanations that must survive. This spec does the first.
2. **One file per seed part, or one per word?** One per part keeps counting simple (design section
   6); one per word keeps "the rule lives on its word" visible in the file tree. This spec assumes
   one per part (`seed/<part>.ncon`).
