# Noodle

An assistant that understands and acts without a language model. Everything it knows is a graph of
nested concepts, written in **N-Con** (`.ncon`). A message is heard into N-Con close to the words
that were said, worked out by rewriting (expanding what words mean, collapsing words into what they
name) down to a small set of primitives that do real things, and chosen among by a learned score.
It learns from sources (WordNet, VerbNet, Wiktionary, Wikidata, a tool's own documentation) and,
above all, from being corrected, and keeps what it learns in the same form it runs on, so it can
read, extend and repair itself.

The lineage: spoon, soup, napkin, and now noodle.

- `docs/design.md`: the design, and why.
- `PLAN.md`: the order of work.
- `AGENTS.md`: the rules for anyone (or any agent) building it. Read it first.
- `docs/specs/`: the phase 0 specs (data model, format, logical form, runtime, built-ins, testing).

Status: design done, specs drafted and in review. No runtime yet.

## Talking to it from a chat UI

`pnpm serve` builds and starts an HTTP server (default `127.0.0.1:8787`; pass `--port`, `--host` and
`--api-key` after it) that any chat UI speaking the OpenAI or Anthropic API can use. Both streaming
and non-streaming requests work.

- OpenAI-style clients: set the base URL to `http://127.0.0.1:8787/v1`.
- Anthropic-style clients: set the base URL to `http://127.0.0.1:8787`.
- The model name is `noodle`.
- The API key is optional. Set one with `--api-key KEY` or the `NOODLE_API_KEY` environment variable
  and clients must send it as a bearer token or an `x-api-key` header. Without one, any key a client
  insists on sending is accepted.

Token counts in the usage fields are whitespace-separated words, since there is no tokenizer.
