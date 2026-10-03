# Kill test draft: review checklist (UNREVIEWED)

Keal's task 4 (PLAN.md) is to hand-write the 30 documentation reductions and the 30 no-name request
reductions of the phase 1 kill test (docs/killtest.md). He asked for drafts to skim and fix
instead. A coding agent wrote them by hand from `seed/core.ncon`, without running Noodle's pipeline
and without looking at what Noodle produces for any of them, into
`~/.noodle/experiment/killtest-draft.ncon` (private, not committed). Nothing here is the kill test
until Keal has reviewed it and copied the fixed file to `~/.noodle/experiment/killtest.ncon`
himself.

## How to review (about 20 minutes)

1. **Requests first, docs half covered.** The same agent wrote both halves, so the requests are not
   blind to the documentation reductions; the convergence number is optimistic until Keal has
   checked each request against what he meant, without looking at the docs table. Mark each line
   `ok` or write the fix.
2. Then the documentation table: is each reduction what the man page line says?
3. Then the open questions at the end.
4. Fix the draft file, copy it to `killtest.ncon`, run `pnpm killtest`.

Notation: `Show(X)` below abbreviates `Cause(result=See(experiencer=Speaker(), stimulus=X))`, the
bridge's form; the file spells it out. Glossary terms: Repository, Remote, Commit, Ref, Branch,
Head, Tag, Index, WorkingTree, Object, Stash (gitglossary), and PullRequest, Comment, Check
(GitHub's docs, not gitglossary; declared as glossary so they count as in the vocabulary).

## Requests (30 of the 33 development-split items in noname-real.jsonl)

Left out: 2273 (a long planning prompt), 565 and 639 (the meaning is all in a plan the fixture does
not show). References are resolved from the prior turns (in brackets). The commit and push the
assistant adds after every edit by habit are left out of the reduction, since the words do not
carry them. Expects: every labelled act that has a documentation reduction, in label order; the
first is the one scored.

| ok? | # | Prompt [meaning from prior turns] | Draft reduction | Expects (first scored) |
|---|---|---|---|---|
| | 1762 | use work trees and address review feedback on PR 1858 | `And(Cause(result=Become(Exist(New(WorkingTree())))), Do(agent=Addressee(), theme=Every(Comment(PullRequest()))))` | pr view, worktree, commit, push |
| | 1244 | in PR 139 remove any changes that would no longer apply because of PR 151 [reason dropped] | `Cause(result=Become(Not(BeIn(Some(Change()), PullRequest()))))` | checkout, rebase, push |
| | 127 | yesss [to design option B] | `Choose(agent=Speaker(), theme=This())` | commit |
| | 1826 | awesome thank you for explaining proceed [bring master in, per the label] | `Continue(theme=Cause(result=Become(Have(Branch(), Every(Change(theme=Other(Branch())))))))` | merge, checkout, commit |
| | 1153 | finish it? [the paused merge] | `Cause(result=Become(Together(And(Branch(), Other(Branch())))))` | commit, push |
| | 1899 | you do it [commit onto the right branch, off the wrong one] | `And(Cause(result=Become(Have(Branch(), This(Commit())))), Cause(result=Become(Not(Have(Other(Branch()), This(Commit()))))))` | stash, checkout, cherry-pick |
| | 31 | do it [take the lockfile churn out of the PR] | `Cause(result=Become(Not(BeIn(Change(theme=File()), PullRequest()))))` | revert, push |
| | 1394 | squash away | `Cause(result=Become(Be(Every(Commit()), One(Commit()))))` | reset, commit, push |
| | 1246 | ci is failing PR 161 | `Cause(result=Become(Work(Check(PullRequest()))))` | pr checks, commit, push |
| | 1310 | check ci and fix PR 2018 and then also create a jira IP ticket for it and add to the title | `And(See(experiencer=Addressee(), stimulus=State(Check(PullRequest()))), Cause(result=Become(Work(Check(PullRequest())))), Cause(result=Become(Exist(New(Ticket())))), Cause(result=Become(BeIn(Name(Ticket()), Name(PullRequest())))))` | pr checks, checkout, pull, commit, push, pr edit |
| | 2124 | keep going dont stop till fully complete | `Continue(theme=Do(agent=Addressee(), theme=Whole(Task())))` | merge, worktree, commit |
| | 1721 | for IP-430 its on spec.risk_level [read the value from there] | `Cause(result=Change(theme=Code(), result=Use(theme=Part(Code()))))` | commit, push |
| | 1832 | sorry just locally can you go back to using browse with the studio filter? | `Cause(result=Become(Again(BeIn(Old(Code()), WorkingTree()))))` | checkout |
| | 1087 | stackit [put the review-tool commit onto #72] | `Cause(result=Become(Have(PullRequest(), This(Commit()))))` | merge, push, pr view |
| | 666 | desktop [it fails on desktop] | `Answer(agent=Speaker(), theme=Desktop())` | commit, push |
| | 1159 | lets resolve that #69 then? [its conflicts with master] | `Cause(result=Become(Together(And(Branch(PullRequest()), Other(Branch())))))` | checkout, merge, commit, push |
| | 102 | main [which branch the first commit goes on] | `Use(agent=Addressee(), theme=Branch(Name("main")))` | branch, commit |
| | 908 | How do you feel about naming it like Document Content Authoring ...? | `Cause(result=Become(Be(Name(This()), "Document Content Authoring")))` | commit, push, pr edit |
| | 1390 | im really not sure the guys will go for this on the backend. but alright lets give it a go | `Try(agent=Addressee(), theme=This())` | commit |
| | 1873 | stcak is fine [two PRs, one on the other] | `Cause(result=Become(Exist(Order(Many(PullRequest())))))` | push, pr create |
| | 1446 | can you address those things? [review findings on #189] | `Do(agent=Addressee(), theme=Every(Comment(PullRequest())))` | checkout, commit, push |
| | 1725 | for 149 sure but couldnt you at least do what the spec asked to swap component wise? ... | `Cause(result=Change(theme=Part(Code()), result=Like(Part(Code()), Document())))` | commit, push |
| | 1933 | for PR 81 is it possible to update the icon in the side bar to match figma? | `Possible(Cause(result=Become(Like(Image(), Other(Image())))))` | pr view, checkout, commit, push |
| | 1417 | mike may have left a review | `And(Maybe(Exist(Comment(PullRequest()))), Do(agent=Addressee(), theme=Comment(PullRequest())))` | pr view, commit, push |
| | 1381 | yeah.. probaby should [take back the list_published change] | `Cause(result=Become(Not(BeIn(This(Change()), Code()))))` | revert, push |
| | 808 | yes start with piece 1 and go till completely done with all steps/pieces | `Do(agent=Addressee(), theme=Every(Part(Task())))` | commit |
| | 1887 | address feedback on PR 91 | `Do(agent=Addressee(), theme=Every(Comment(PullRequest())))` | pr view, commit, push |
| | 1131 | yes fix 56 [PR #56] | `Cause(result=Become(Work(PullRequest())))` | checkout, merge, commit, push |
| | 1491 | yep do that [option 1: Snackbar with custom content] | `Cause(result=Change(theme=Code(), result=Use(theme=This())))` | pr view, checkout |
| | 1415 | review the feedback on PR 1779 | `And(See(experiencer=Addressee(), stimulus=Every(Comment(PullRequest()))), Do(agent=Addressee(), theme=Every(Comment(PullRequest()))))` | pr view, commit, push, pr comment |

## Documentation (30 commands)

The NAME line of the git man page, or the first line of `gh pr <sub> --help`.

| ok? | Command | Summary | Draft reduction |
|---|---|---|---|
| | git add | Add file contents to the index | `Cause(result=Become(BeIn(State(File()), Index())))` |
| | git commit | Record changes to the repository | `Cause(result=Become(Have(Repository(), Change())))` |
| | git push | Update remote refs along with associated objects | `Cause(result=Become(Have(Remote(), Every(Commit()))))` (Keal's example) |
| | git pull | Fetch from and integrate with another repository or a local branch | `Cause(result=Become(And(Have(Repository(), Every(Commit(Remote()))), Together(And(Branch(), Remote())))))` |
| | git fetch | Download objects and refs from another repository | `Cause(result=Become(Have(Repository(), And(Every(Object()), Every(Ref())), source=Remote())))` |
| | git merge | Join two or more development histories together | `Cause(result=Become(Together(Many(Branch()))))` |
| | git rebase | Reapply commits on top of another base tip | `Again(Cause(result=Become(After(Every(Commit()), Last(Commit(), Other(Branch()))))))` |
| | git checkout | Switch branches or restore working tree files | `Or(Cause(result=Become(Be(Head(), Other(Branch())))), Cause(result=Become(Again(Be(File(), Old(File()))))))` |
| | git switch | Switch branches | `Cause(result=Become(Be(Head(), Other(Branch()))))` |
| | git branch | List, create, or delete branches | `Or(Show(Every(Branch())), Cause(result=Become(Exist(New(Branch())))), Cause(result=Become(Not(Exist(Branch())))))` |
| | git status | Show the working tree status | `Show(State(WorkingTree()))` |
| | git diff | Show changes between commits, commit and working tree, etc | `Show(Every(Change(theme=Or(Commit(), WorkingTree()))))` |
| | git log | Show commit logs | `Show(Order(Every(Commit())))` |
| | git show | Show various types of objects | `Show(Object())` |
| | git revert | Revert some existing commits | `Cause(result=End(Some(Commit())))` |
| | git reset | Reset current HEAD to the specified state | `Cause(result=Become(Be(Head(), This(State()))))` |
| | git restore | Restore working tree files | `Cause(result=Become(Again(Be(File(), Old(File())))))` |
| | git stash | Stash the changes in a dirty working directory away | `Move(theme=Every(Change()), source=WorkingTree(), destination=Stash())` |
| | git cherry-pick | Apply the changes introduced by some existing commits | `Cause(result=Become(Have(Branch(), Some(Commit()))))` |
| | git worktree | Manage multiple working trees ["manage" read as add, list, remove] | `Or(Cause(result=Become(Exist(New(WorkingTree())))), Show(Every(WorkingTree())), Cause(result=Become(Not(Exist(WorkingTree())))))` |
| | git clone | Clone a repository into a new directory | `Cause(result=Become(BeIn(Same(Repository()), New(Directory()))))` |
| | git rm | Remove files from the working tree and from the index | `Cause(result=Become(Not(BeIn(File(), And(WorkingTree(), Index())))))` |
| | git tag | Create, list, delete or verify a tag object signed with GPG | `Or(..., Cause(result=Become(Know(experiencer=Speaker(), theme=True(Signed(Tag()))))))`, create/list/delete as for branch |
| | gh pr create | Create a pull request on GitHub. | `Cause(result=Become(Exist(New(PullRequest()))))` |
| | gh pr view | Display the title, body, and other information about a pull request. | `Show(And(Name(PullRequest()), Text(PullRequest()), Every(Part(PullRequest()))))` |
| | gh pr checks | Show CI status for a single pull request. | `Show(State(Check(PullRequest())))` |
| | gh pr edit | Edit a pull request. | `Cause(result=Change(theme=PullRequest()))` |
| | gh pr comment | Add a comment to a GitHub pull request. | `Cause(result=Become(Have(PullRequest(), New(Comment()))))` |
| | gh pr merge | Merge a pull request on GitHub. | `Cause(result=Become(Together(And(Branch(PullRequest()), Other(Branch())))))` |
| | gh pr list | List pull requests in a GitHub repository. | `Show(Every(PullRequest()))` |

## Open questions for Keal

- **Which act a request expects.** Most of these requests mean several acts (edit, commit, push).
  The checker scores one (the first `Expects`); the draft uses the first labelled act that has a
  documentation reduction, mechanically, so no choice was made per request. That often lands on a
  preparatory act (checkout, pr view) the words do not carry. Should the first `Expects` instead
  be the act that carries the meaning (rebase for 1244, merge for 1159, cherry-pick for 1899)?
  `--draft` also prints "top-1 is any of the request's Expects", for information only.
- **Deictic requests** ("do it", "yesss", "keep going") are most of the real no-name pool. Their
  meaning is the prior turn's proposal; the draft resolves it, which is reading context, not the
  words. Keep them, or limit the test to requests whose words carry the act?
- **Habitual commit and push** are left out of request reductions (the user did not say them).
  If they belong in what was meant, about 15 requests change.
- **Outside the vocabulary, on purpose**: `Signed` (git tag), `Ticket` (1310), `Desktop` (666).
  These are what the draft reached for and did not find, not fixes to make.
- **GitHub terms as glossary**: PullRequest, Comment and Check are not in gitglossary(7). Counting
  them as glossary keeps the gh commands representable; without them, eight docs and most requests
  are not.

## Preliminary results (UNREVIEWED DRAFT: not the kill test)

`pnpm killtest -- --draft`, 2026-10-03, runtime 0.35.0, against the draft above as written (the
draft was finished before the run, and nothing was changed after seeing these numbers).

| Line | Draft measured | Stop line |
|---|---|---|
| representable | 57/60 (95.0%) | under 70% |
| convergence, top-1 against the first Expects | **1/30 (3.3%)** | under 60% |
| top-1 is any labelled act (information only) | 7/30 (23.3%), several with negative scores | none |

The only scored hit is 1887 ("address feedback on PR 91", to gh pr view). What the misses say,
read from the per-request lines, before any review:

- **Representability is not the problem**: the vocabulary covered everything reached for except
  `Signed`, `Ticket` and `Desktop`, given the three GitHub glossary terms.
- **Most misses are the expectation, not the match**: the first labelled act is often preparatory
  (checkout, pr view) or habitual (commit), and the request's words carry neither. 1159 ("resolve
  #69") tops gh pr merge at 1.00 and 1153 ("finish it?") tops gh pr merge at 0.88, which is the
  meaning (a merge), but neither expects it.
- **Deictic requests** ("yesss", "you do it", "keep going", "desktop") score below zero against
  everything: their reductions are about choosing, continuing or answering, which no documentation
  describes.
- **Shape collisions**: requests that take a change out of something (`Not(BeIn(...))`: 1244, 31,
  1381) all top git rm, because revert is drafted as `End(Some(Commit()))`. Whether that is a wrong
  draft of revert or a real non-convergence is one of the things the review decides.

If the review keeps these readings, this is a stop under the phase 1 line. Per PLAN.md it is a
finding to report and decide on, not a number to tune toward.
