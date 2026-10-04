# TODO

- **Implied lemmas.** A word concept's name implies its lemma (`Moment` is "moment"), so the store
  derives it at load and an explicit `Lemma` is kept only where the name cannot give it: dashes,
  accents, apostrophes, renamed collisions (`Read_2`), and forms that differ from the name. Only
  for concepts that are words (they have a category or a part of speech), never structural names.
  Cuts the WordNet pack and the seed.
- **Concepts by folder.** Seed laid out one folder per concept (its lexicon entry, readings and
  realizations together), each item tagged with its seed part, collected into the part packs by a
  build step; seed counting and the protected-base check read the tag instead of the file.
- **Realizations compose, the rest of the way** (tasks/lessons.md, "Realizations compose"). Done
  for Run: Run says itself as "run `x`", Ran (what it gave) says itself, the Outcome says its
  result through Either(result, fallback), and the Offer, Echo, BlockedBy and Outcome patterns
  that reached into Run are gone. Still nested: Outcome(Read(..), result=File/Have/Be/Page),
  Outcome(Question(..), result=Found/At), Outcome(Store/Remove/Schedule ..). Each result should
  say itself; what is missing is a printer head for a sentence (capitalize a clause and end it
  with a period, unless it is a block), so a result that says itself as a clause can be put in a
  sentence by its wrapper. A child that needs block layout inside a paragraph (a code block) is
  the printer's to split, not a pattern's.
- **Benchmark against published models** (after the plan is built). GSM8K first (exact numbers,
  scores published from small Qwens to frontier models), then BFCL (tool definitions imported the
  way man pages are), then SimpleQA. Keal's method: run once with learning on (Noodle researches
  live, which is its training, done in real time), then again with learning off but the learned
  graph kept; track speed in both runs. No pre-loading a corpus: it is built to figure things out
  live, knowing just enough to solve the problem and say so.
- **Try, offer, learn: what is left** (the loop, scored match, taught procedures and step chaining
  are built). Option values the CLI builder could not fill ("with the message 'x'", "saying x",
  quoted text to --body or -m) and a correction naming a flag ("no, use --squash") are not built:
  the chart does not yet hear a quotation in single quotes, nor "the message X" as the message X.
  A step nothing does is said as "one of its steps" when its meaning has no words of its own.
  "find what is listening on port 3000" is not parsed (no free relative "what X" after a verb).
  Confidence is not calibrated (askBelow 0.5 is a stated default). Know.ask (ChatGPT, trust 4)
  as a source of candidates for a step with none is not wired.
- **Teaching procedures together** (built; see above for what is left). Keal: "when I say kill 8080,
  find what's running on port 8080 and kill it". (1) Taught phrases with slots ("kill <port>"),
  echoed and confirmed. (2) Taught steps that chain: one step's output (a pid) is the next step's
  input. (3) Asking when a step has no known command ("How do I find the process on a port?"),
  keeping the answer as a learned command for that step, reusable anywhere; or learning the step
  from a man page. Everything from=User, trust 1; acts that change things are still offered until
  granted.
- **Try, offer, learn: the built-in loop for anything not known with high confidence** (build right
  after CLI learning lands, together with teaching procedures). Keal: it figures out what it
  could do on its own (every command on the machine learned with what it does, from man pages or
  --help), offers the closest candidate as "Can I run `exact command`?"; on "no, that's not
  right" it offers its next candidates as a numbered list (pick a number), or takes the right
  answer from the user. Not only for commands: any reading or act chosen without high
  confidence goes through the same offer, pick or correct loop. What the user confirms or
  corrects raises confidence (the learned weights and a reading from=User), so the same ask is
  done directly next time, and it carries over to new asks through the concepts it shares
  (concept reuse), not as a stored phrase.
- **ChatGPT as a tutor for choices (the oracle arm, design phase 7)** (after gptb and the learn loop
  land). Keal: when a choice has no clear evidence path, ask gptb to choose given the same context
  and explain why, in a fixed structure that parses. Ask with the request, context and numbered
  candidates; reply as `choice: N` and `because: ...`. The choice is a weak training signal
  (from=ChatGPT, trust 4, through the replay gate, never overriding the user); the because is heard
  by Noodle's own pipeline into proposed facts, Pending until they prove out or Keal confirms. It
  never picks an effectful act for the user. Everything it teaches is tagged so it can be switched
  off and its share measured; the scored experiment runs with it off. Built (design section 17,
  src/runtime/tutor.ts, `pnpm tutor:report`). Left: a numbered option lists a Run inside a
  referent's kind as an act ("run `git show`run `git stash`"), so ChatGPT is shown, and picks,
  options that would not run what they say; Keal confirming a proposal by hand has no path yet.
- **Reason through what a tool's manual says, not only its one-line summary** (after the stuck-to-
  local-or-ChatGPT builder lands). Keal's lsof example: "what's listening on port 3000" should reach
  `lsof -i :3000` because lsof's own page says "an open file may be ... a network file (Internet
  socket ...)" and `-i` "selects the listing of files any of whose Internet address matches".
  (a) The scored match also matches option descriptions (cheap; the data is imported). (b) A
  manual's DESCRIPTION paragraphs are heard into facts (IsA: an Internet socket is a network file,
  a network file is a file) with the pipeline Know uses for page openings, from=ToolDoc, so "list
  open files" covers sockets and the reasoning carries to other tools and asks. ChatGPT's "because"
  proposals (Pending) feed the same facts once confirmed. (a) is built: each option's description
  (first sentence) is a Describes of the command run with it, and mdoc pages' options are read now
  (mandoc's ".TP 8n" width had made every BSD option term "8n -A"). lsof's -i is still not reached:
  "selects the listing of files any of whose Internet address matches" is not heard (a third-person
  verb and a "whose" clause), and "what's using port 3000" shares only "port" with any description.
  (b) is open.
- **All of the machine's tools, without crowding English**: fixed in the importer and the score,
  and measured (ChatGPT off, store and pack copies): versus 39/51/4/0 with the re-imported set
  loaded, the same as without it, not one prompt different (it was 36/48/10). A program learned in
  bulk (`pnpm import tools`) whose name English has is its own concept (`DateProgram`, named "the
  date command" or `date`), and its summary is only a description for the scored match; tldr names
  programs the same way. The scored match costs `Match:Ambiguity`, the log of how many different
  acts fit as well. To install: re-run `pnpm import tools` (the packs in packs-pending were made by
  the old importer) and re-import git, gh, jq, pwd and tldr. Open: "run X" with X a bare English
  word is not reached (only "the X command" and backticks), and `run \`date\`` does not use the
  program's documented effects.
- **Plain requests and questions still mostly fail at hearing**, not at matching (2026-10-03, fresh
  prompts with every tool loaded): "show disk usage of this folder" splits into `git show` plus a
  fragment; "display ..." is heard as a noun; "port 3000" as the verb port; "how much disk space is
  left" is not a question; "what branch am i on" is a question whose proposition already holds `git
  branch` inside a referent; "this folder" is never the workspace (the graph does not connect a
  folder to what reading "." gives); "find" in a summary still comes out as Store (its get frame and
  its discover frame tie, and the first wins).
