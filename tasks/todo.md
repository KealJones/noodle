# TODO

- **Implied lemmas.** A word concept's name implies its lemma (`Moment` is "moment"), so the store
  derives it at load and an explicit `Lemma` is kept only where the name cannot give it: dashes,
  accents, apostrophes, renamed collisions (`Read_2`), and forms that differ from the name. Only
  for concepts that are words (they have a category or a part of speech), never structural names.
  Cuts the WordNet pack and the seed.
- **Concepts by folder.** Seed laid out one folder per concept (its lexicon entry, readings and
  realizations together), each item tagged with its seed part, collected into the part packs by a
  build step; seed counting and the protected-base check read the tag instead of the file.
- **Realizations compose, what is left** (tasks/lessons.md, "Realizations compose"). Built: the
  Sentence head, the printer splitting a paragraph around a block, and results, moments, rules and
  remembered claims that say themselves (seed/CHANGES.md, 2026-10-03). Still reaching into a
  child: the Store and Remove outcomes ("Added milk to your basket"), because the act names the
  holder in the user's words ("my basket") and only the result has the thing it resolved to; they
  can go once the act said back carries its resolved referents. The Schedule outcome and the
  scheduled item ("I'll remind you at 3 PM to x", "x, at 3 PM") have two wordings of Scheduled,
  and Say(Quote(..)) is still matched through. Echo(Directive) and the three Echo(BlockedBy(..,
  Constraint ..)) say a rule in the user's voice ("you said not to push") where the rule says
  itself in the assistant's ("I won't push"): a head for voice would let the rule say itself in
  both. Offer(Remember(Rewrite)) keeps its own order ("when you say x, you mean y").
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
  (b) is built (2026-10-04): a manual's DESCRIPTION sentences and each option's beyond the first
  are heard (`Learner.statements`) into facts on the kinds they speak of, from the page, Pending
  where only part of a sentence was heard; the seed's bridge says what "is a", "may be" and "part
  of" are (IsA, PartOf); the scored match steps from a request's concept through its own IsA and
  PartOf facts (Match:Distance per step, the node covered whole); a tutor's because of that shape
  is proposed on the kind. Measured in docs/manual-facts.md. lsof is still not reached, at
  hearing: "a network file" is heard as the verb "file" with "a network" its subject, so the
  bracketed list after it ("(Internet socket, NFS file or UNIX domain socket.)") is the verb's
  theme and no "a socket is a network file" comes out (and a bracketed list after a noun is not
  yet heard as kinds of it); "selects" is heard as Store; "-i"'s first sentence (a "whose"
  clause) is not heard; and the prompts themselves ("port 3000" a verb, "what's using X" losing X)
  fail before the match.
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
- **Plain requests and questions: what is left** (2026-10-04). Done: "show me what's in the readme"
  is one act ("what's" has the after-a-verb entries "what" has; being shown or told the answer to a
  question is asking it); "add 45 and 38" adds (VerbNet's plural members, Patient_I and Patient_J,
  are read as And of the two, so mix-22.1's together reaches the arithmetic reading); "what does
  tar do" answers from tar's page (a program named by an English word is that word's newest sense,
  a noun, chosen by the score; an answer uses a word's senses only when it has one); "display the
  readme" reads it; "how many X <clause>" is a question (how many of a kind fills the clause's
  gap). Done since (2026-10-04, hearing): "port 3000", "process 1234" are the noun named by the
  numeral (a lexical rule on Noun, by the value's shape), and a WithRoles that overwrites a role
  said costs Unworked:Dropped, so "what's using port 3000" keeps the port; "this folder", "the
  current directory" are "." (the core's Directory is "directory" and "folder"; deixis on "this"
  and "current"); a bracket is an aside, never an argument, and after a noun lists kinds of it;
  "whose" relatives; "lists" shows. Left: "what's using port 3000" ties between Use's VerbNet
  readings (consume: Remove) and "using" the noun, and reaches no command; "which process is
  listening on port 8080" is heard (Listen of Port(8080)) but reaches no command (lsof's pack is not
  installed); "show network connections" ties between Read and `git show <them>` (the git show
  reading's slot has no kind, so a concept fills a command line; the importer could want a name
  there); "what files does process 1234 have open" is not heard: the gap is Have's theme before a
  secondary predicate ("have _ open"), and a gap passes up only through Compose, so no entry
  carries it; "selects" in lsof's -i is still obtain-13.5.2 (Store), and the -i sentence ("files
  any of whose Internet address matches the address specified in i") is heard only in pieces
  ("whose Internet" and "address matches" as a verb, "specified" as a past tense); lsof's whole
  DESCRIPTION sentence with eight kinds gives only Directory (its "an executing text reference" is
  heard as a participle taking the rest of the list). "find X" ties between finding (Read) and getting (Store
  into the addressee) and the order decides, and VerbNet's encounter frame for find is never
  matched (its subject is an Experiencer, and the chart names every subject agent); "how many grams
  are in a pound" and "how many minutes are in 3 hours" are now questions whose lookups find wrong
  pages (versus 27 and 28, HONEST before); "how much disk space is left" is a question but reaches
  no command; "what does date do" (date is Day's form) and "what does which do" (a function word)
  do not reach their programs; "find files bigger than 100MB", "show disk usage of this folder" and
  "extract this tar.gz" reach no command. Installing needs VerbNet, tldr and the bulk tools
  re-imported. "what branch am i on" is a question whose proposition already holds `git branch`
  inside a referent.
- **Speed with every tool loaded** (blocks installing tools-all and the new tldr pack, both in
  ~/.noodle/packs-pending). Done in part: versus and `--why` time each turn by stage; the scored
  match's index, SameAs classes and kind distances are kept until what they come from changes (a
  command's output no longer rebuilds them), and a description that cannot reach the threshold is
  not aligned. With everything loaded versus's median turn is 0.21 s (0.15 s without; it was
  3.0 s and 1.15 s), its slowest 7.8 s (Know); "what does jq do" and "what does the tar command
  do" answer from the man page. Left: some sub-second turns are still 2 to 3 times slower with
  everything loaded (the scored match's pool grows with the descriptions that share a common
  concept: an index of which heads are kin would make it sublinear).
- **Open regressions** (small): "read notes.txt and tell me how many lines it has" prints the file
  and junk instead of the count; "what branch am i on" answered the folder path with the
  re-imported packs; "how many grams are in a pound" gets junk Wikipedia with ChatGPT off; "add
  a.txt and b.txt" asks whether to append one file into the other.
- **Direction under review** (tasks/handoff.md): Keal is reconsidering size, load time and host
  dependence. Do not add bulk imports or start the browser port before asking.
