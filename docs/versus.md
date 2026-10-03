# Noodle beside Napkin

Run 2026-10-03 20:47 UTC with `pnpm versus` (scripts/versus.mjs): 94 everyday prompts in 14 sessions, written once without looking at the corpus and not tuned to either system. The criteria for each verdict are stated at the top of the script: RIGHT (answered, or did or offered the act), HONEST (said it was stuck), WRONG (a wrong answer, a page about something else, or an act it should not have done), ERROR (crashed, timed out or said nothing). Replies are cut at 400 characters here.

## Summary

| | RIGHT | HONEST | WRONG | ERROR |
|---|---|---|---|---|
| Noodle | 38 | 46 | 10 | 0 |
| Napkin | 31 | 49 | 14 | 0 |

By session (RIGHT / HONEST / WRONG / ERROR):

| session | Noodle | Napkin |
|---|---|---|
| small talk | 5 / 3 / 0 / 0 | 6 / 1 / 1 / 0 |
| facts | 4 / 3 / 1 / 0 | 2 / 5 / 1 / 0 |
| math | 5 / 1 / 1 / 0 | 5 / 1 / 1 / 0 |
| units | 1 / 3 / 1 / 0 | 2 / 3 / 0 / 0 |
| time and reminders | 2 / 1 / 2 / 0 | 4 / 1 / 0 / 0 |
| lists and memory | 2 / 7 / 0 / 0 | 2 / 5 / 2 / 0 |
| definitions | 2 / 4 / 0 / 0 | 3 / 1 / 2 / 0 |
| files | 2 / 5 / 1 / 0 | 0 / 7 / 1 / 0 |
| git | 4 / 1 / 3 / 0 | 0 / 8 / 0 / 0 |
| instructions | 3 / 1 / 0 / 0 | 0 / 4 / 0 / 0 |
| multi-step | 1 / 3 / 1 / 0 | 0 / 4 / 1 / 0 |
| typos and messy phrasing | 3 / 5 / 0 / 0 | 2 / 5 / 1 / 0 |
| near-misses | 4 / 3 / 0 / 0 | 2 / 3 / 2 / 0 |
| conversation | 0 / 6 / 0 / 0 | 3 / 1 / 2 / 0 |

## small talk

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 1 | hey there | Hi. | RIGHT | Hello! | RIGHT |
| 2 | how are you doing today? | I'm good, thanks. | RIGHT | I'm doing well, thanks for asking! | RIGHT |
| 3 | good morning! | Hi. | RIGHT | Hello! | RIGHT |
| 4 | what's up | I couldn't work out "what's up". | HONEST | Which up do you mean: the animated film, the public university, or the album? | RIGHT |
| 5 | lol ok | Ha.<br><br>There's nothing I'm waiting to do. | HONEST | Got it. | RIGHT |
| 6 | you're pretty smart | I couldn't work out "you're pretty smart". | HONEST | That's great! In means automotive marque, in inception February 1994, in named after intelligence, in operator smart automobile, in industry automotive industry, in owned by Mercedes Benz, in owned by Geely, in product or material produced electric vehicle, in headquarters location Stuttgart, in is a car brand, in means monitoring system for computer hard disk drives, in is a system, in used by dr ... | WRONG |
| 7 | thanks a lot | You're welcome. | RIGHT | You are welcome. In means French department, in france country, in located in the administrative territorial entity Occitania, in shares border with Aveyron, in shares border with cantal, in shares border with Corr Ze, in shares border with Dordogne, in cahors capital, in inception Thursday, March 4, 1790, in contains the administrative territorial entity Arrondissement Of Cahors, in contains the  ... | RIGHT |
| 8 | see you later | Bye. | RIGHT | I heard that as "noted later", but couldn't work it out. Could you put it another way? | HONEST |

## facts

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 9 | what is the capital of japan? | From Wikidata:<br><br>Tokyo | RIGHT | Tokyo. | RIGHT |
| 10 | who wrote pride and prejudice | From Wikipedia, [Pride & Prejudice (2005 film)](https://en.wikipedia.org/wiki/Pride_%26_Prejudice_(2005_film)):<br><br>Pride & Prejudice is a 2005 period romance film directed by Joe Wright, in his feature directorial debut, based on Jane Austen's 1813 novel of the same name. The film features five sisters from an English family of landed gentry as they deal with issues of marriage, morality, and  ... | RIGHT | I don't know that yet. | HONEST |
| 11 | how many legs does a spider have | I couldn't work out "how many legs does a spider have". | HONEST | I heard that as "how many legs does have spider", but couldn't work it out. Could you put it another way? | HONEST |
| 12 | what's the boiling point of water in celsius | I couldn't work out "what's the boiling point of water in celsius". | HONEST | I don't know boiling point of water in celsius yet. | HONEST |
| 13 | who painted the mona lisa? | From Wikipedia, [Mona Lisa](https://en.wikipedia.org/wiki/Mona_Lisa):<br><br>The Mona Lisa is a half-length portrait painting by the Italian artist Leonardo da Vinci. Considered an archetypal masterpiece of the Italian Renaissance, it has been described as "the best known, the most visited, the most written about, the most sung about, \[and\] the most parodied work of art in the world". The painti ... | RIGHT | Leonardo Da Vinci. | RIGHT |
| 14 | what year did the berlin wall fall | I couldn't work out "what year did the berlin wall fall". | HONEST | I don't know that yet. | HONEST |
| 15 | is a tomato a fruit? | From Wikipedia, [Helicoverpa zea](https://en.wikipedia.org/wiki/Helicoverpa_zea):<br><br>Helicoverpa zea, commonly known as the corn earworm, is a species in the family Noctuidae. The larva of the moth Helicoverpa zea is a major agricultural pest. Since it is polyphagous during the larval stage, the species has been given many different common names, including the cotton bollworm and the tomato fr ... | WRONG | I don't know yet. | HONEST |
| 16 | what language do they speak in brazil | From Wikipedia, [Languages of Brazil](https://en.wikipedia.org/wiki/Languages_of_Brazil):<br><br>Portuguese is the official and national language of Brazil, being widely spoken by nearly all of its population. Brazil is the most populous Portuguese-speaking country in the world, with its lands comprising the minority of Portugal's former colonial holdings in the Americas. | RIGHT | English. | WRONG |

## math

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 17 | what's 12 times 7 | 12 times 7 is 84. | RIGHT | 84. | RIGHT |
| 18 | what is 15% of 200 | 15% of 200 is 30. | RIGHT | 30. | RIGHT |
| 19 | add 45 and 38 | I can run `git add`, but I don't know yet what it changes. Go ahead? | WRONG | 83 | RIGHT |
| 20 | whats 100 divided by 8 | 100 divided by 8 is 12.5. | RIGHT | 12.5. | RIGHT |
| 21 | square root of 144? | the square root of 144 is 12. | RIGHT | 12 | RIGHT |
| 22 | 2+2 | 2 plus 2 is 4. | RIGHT | I see. | WRONG |
| 23 | if i have 3 apples and eat one how many are left | I couldn't work out "if i have 3 apples and eat one how many are left". | HONEST | I don't know how many are left yet. | HONEST |

## units

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 24 | how many inches in a foot | From Wikipedia, [Inch](https://en.wikipedia.org/wiki/Inch):<br><br>The inch is a unit of length in the British Imperial and the United States customary systems of measurement. It is equal to ⁠1/36⁠ yard or ⁠1/12⁠ of a foot. Derived from the Roman uncia ("twelfth"), the word inch is also sometimes used to translate similar units in other measurement systems, usually understood as deriving from the  ... | RIGHT | 12 inches. | RIGHT |
| 25 | convert 5 km to miles | I couldn't work out "convert 5 km to miles". | HONEST | 5 km is 3.106855961 miles. | RIGHT |
| 26 | what is 70 fahrenheit in celsius | From Wikipedia, [Celsius](https://en.wikipedia.org/wiki/Celsius):<br><br>The degree Celsius is the unit of temperature on the Celsius temperature scale, one of two temperature scales used in the International System of Units (SI), the other being the closely related Kelvin scale. The degree Celsius can refer to a specific point on the Celsius temperature scale or to a difference or range between t ... | WRONG | I don't know that yet. | HONEST |
| 27 | how many grams are in a pound | I couldn't work out "how many grams are in a pound". | HONEST | I don't know yet. | HONEST |
| 28 | how many minutes are in 3 hours | I couldn't work out "how many minutes are in 3 hours". | HONEST | I don't know yet. | HONEST |

## time and reminders

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 29 | what time is it | It's 1:48 PM. | RIGHT | It is 10:59 PM. | RIGHT |
| 30 | what day is it today | Today is Saturday, October 3. | RIGHT | Thursday. | RIGHT |
| 31 | what's the date tomorrow | From Wikipedia, [Date palm](https://en.wikipedia.org/wiki/Date_palm):<br><br>Phoenix dactylifera, commonly known as the date palm, is a flowering-plant species in the palm family Arecaceae, native to the region from the Gulf States and Iraq to Pakistan and India. It is cultivated for its edible sweet fruit called dates. The species is widely cultivated across northern Africa, the Middle East, Aust ... | WRONG | Friday, October 2, 2026 | RIGHT |
| 32 | remind me to call the dentist at 3pm | I couldn't work out "remind me to call the dentist at 3pm". | HONEST | I don't know how to remind yet. | HONEST |
| 33 | how many days until christmas | From Wikipedia, [The Twelve Days of Christmas (song)](https://en.wikipedia.org/wiki/The_Twelve_Days_of_Christmas_(song)):<br><br>"The Twelve Days of Christmas" is an English Christmas carol and nursery rhyme. A classic example of a cumulative song, the lyrics detail a series of increasingly numerous gifts given to the speaker by their "true love" on each of the twelve days of Christmas. The carol, ... | WRONG | 85 days. | RIGHT |

## lists and memory

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 34 | start a grocery list | I couldn't work out "start a grocery list". | HONEST | I don't know how to start yet. | HONEST |
| 35 | add eggs and milk to it | I couldn't work out "add eggs and milk to it". | HONEST | Added eggs and milk to your start. | RIGHT |
| 36 | also add bread | I couldn't work out "also add bread". | HONEST | I don't know how to add yet. | HONEST |
| 37 | what's on my grocery list? | You haven't told me that. | HONEST | I don't know yet. | HONEST |
| 38 | take milk off the list | I couldn't work out "take milk off the list". | HONEST | I don't know how to milk yet. | HONEST |
| 39 | remember that my sister's birthday is june 4 | I couldn't work out "remember that my sister's birthday is june 4". | HONEST | That makes 4. | WRONG |
| 40 | when is my sister's birthday? | I couldn't work out "when is my sister's birthday?". | HONEST | I don't know your sister's birthday yet. | HONEST |
| 41 | my name is sam | Got it: your name is sam. | RIGHT | I see. | WRONG |
| 42 | what's my name | Your name is sam. | RIGHT | Sam. | RIGHT |

## definitions

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 43 | what does ephemeral mean | From Wikipedia, [Ephemerality](https://en.wikipedia.org/wiki/Ephemerality):<br><br>Ephemerality is the concept of things being transitory, existing only briefly. Academically, the term ephemeral constitutionally describes a diverse assortment of things and experiences, from digital media to types of ponds and streams.<br>With respect to unique performances, for example, it has been noted that "\[e ... | RIGHT | "ephemeral" means: lasting for a short period of time. | RIGHT |
| 44 | define ubiquitous | I couldn't work out "define ubiquitous". | HONEST | An ubiquitous is the property of being present everywhere. | RIGHT |
| 45 | what's a synonym for happy | I couldn't work out "what's a synonym for happy". | HONEST | I don't know synonym for happy yet. | HONEST |
| 46 | what is photosynthesis | From Wikipedia, [Photosynthesis](https://en.wikipedia.org/wiki/Photosynthesis):<br><br>Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria, convert light energy—typically from sunlight—into the chemical energy necessary to fuel their metabolism. The term photosynthesis usually refers to oxygenic photos ... | RIGHT | A photosynthesis is a biological process to convert light into chemical energy. | RIGHT |
| 47 | what does idempotent mean in programming | I couldn't work out "what does idempotent mean in programming". | HONEST | "programming" means: the designing, scheduling or planning of a radio or television program/programme. | WRONG |
| 48 | meaning of the word serendipity | I couldn't work out "meaning of the word serendipity". | HONEST | I see. | WRONG |

## files

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 49 | what files are in this folder | From Wikipedia, [File folder](https://en.wikipedia.org/wiki/File_folder):<br><br>A file folder is a kind of folder that holds papers together for organization and protection. File folders usually consist of a sheet of heavy paper stock or other thin, but stiff, material which is folded in half, and are used to keep paper documents. They are often used in conjunction with a filing cabinet for stora ... | WRONG | I don't know yet. | HONEST |
| 50 | show me the readme | `README.md`:<br><br>```<br># Shopping app<br><br>A tiny app that keeps a shopping list.<br><br>Run it with node.<br>``` | RIGHT | I worked that out, but I don't know how to say it yet: Readme() | HONEST |
| 51 | what's in notes.txt | `notes.txt`:<br><br>```<br>buy milk<br>call mom<br>fix the bike<br>``` | RIGHT | I don't know yet. | HONEST |
| 52 | how many lines are in notes.txt | I couldn't work out "how many lines are in notes.txt". | HONEST | I don't know yet. | HONEST |
| 53 | create a file called ideas.md with the text 'build a robot' | I don't know what `ideas.md` means here. | HONEST | I worked that out, but I don't know how to say it yet: Robot() | HONEST |
| 54 | yes | There's nothing I'm waiting to do. | HONEST | Got it. | WRONG |
| 55 | rename ideas.md to plans.md | I don't know these words yet: ideas.md and plans.md. | HONEST | I don't know how to rename yet. | HONEST |
| 56 | delete plans.md | I don't know what `plans.md` means here. | HONEST | I don't know how to delete yet. | HONEST |

## git

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 57 | what branch am i on | We're in `/private/var/folders/0d/gsyzwl_x2wl8f2zxbtfq_mj80000gs/T/versus-qfTcHn`. | WRONG | I don't know what branch on you yet. | HONEST |
| 58 | what changed since the last commit | From Wikipedia, [Continuous integration](https://en.wikipedia.org/wiki/Continuous_integration):<br><br>Continuous integration (CI) is the practice of integrating source code changes frequently and ensuring that the integrated codebase is in a workable state. Typically, developers merge changes to an integration branch, and an automated system builds and tests the software system. <br>Often, the au ... | WRONG | I don't know changed since last commit yet. | HONEST |
| 59 | show me the git log | ```<br>git log<br>```<br><br>```<br>commit 7fe132f7e2030e00fe73d24d86d8277135b73672<br>Author: Versus <versus@example.com><br>Date:   Sat Oct 3 13:49:02 2026 -0700<br><br>    first commit<br>``` | RIGHT | I don't know how to log yet. | HONEST |
| 60 | commit my changes with the message 'update readme' | I can run `git commit`, but I don't know yet what it changes. Go ahead? | RIGHT | I don't know how to commit yet. | HONEST |
| 61 | yes go ahead | `git commit` failed (exit 1):<br><br>```<br>On branch main<br>Changes not staged for commit:<br>  (use "git add <file>..." to update what will be committed)<br>  (use "git restore <file>..." to discard changes in working directory)<br>	modified:   README.md<br><br>no changes added to commit (use "git add" and/or "git commit -a")<br>``` | WRONG | I worked that out, but I don't know how to say it yet: GoAhead() | HONEST |
| 62 | is the working tree clean now? | Do you mean run ` git clean  `, or run `git clean`? | RIGHT | I don't know yet. | HONEST |
| 63 | create a branch called feature-login | I don't know what `feature-login` means here. | HONEST | I worked that out, but I don't know how to say it yet: BudgetExceeded(kind="steps", limit=4000) | HONEST |
| 64 | push it | I can run `git push`, but I don't know yet what it changes. Go ahead? | RIGHT | I don't know how to push yet. | HONEST |

## instructions

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 65 | don't run any git commands without asking me first | Got it: I won't run `git ...` until you say so.<br><br>I couldn't work out "first". | RIGHT | I worked that out, but I don't know how to say it yet: Not(NoCode()) | HONEST |
| 66 | show me the git status | Do you mean run `git status`, or run `git status`? | RIGHT | I don't know how to status yet. | HONEST |
| 67 | from now on, keep your answers short | I couldn't work out "from now on, keep your answers short". | HONEST | I worked that out, but I don't know how to say it yet: Short() | HONEST |
| 68 | stop | Stopped. | RIGHT | I worked that out, but I don't know how to say it yet: Stop() | HONEST |

## multi-step

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 69 | read notes.txt and tell me how many lines it has | I couldn't work out "read notes.txt and tell me how many lines it has". | HONEST | I don't know how to note yet. | HONEST |
| 70 | make a file called a.txt, then another called b.txt | I don't know these words yet: a.txt and b.txt. | HONEST | I don't know how to called yet. | HONEST |
| 71 | yes | There's nothing I'm waiting to do. | HONEST | Got it. | WRONG |
| 72 | list the files and then show me package.json | `package.json`:<br><br>```<br>{<br>  "name": "shop",<br>  "version": "1.0.0"<br>}<br>``` | RIGHT | I worked that out, but I don't know how to say it yet: PackageJson() | HONEST |
| 73 | what's 6 times 7 and what's the capital of italy | 6 times 7 is 42. | WRONG | I don't know how to multiply yet. | HONEST |

## typos and messy phrasing

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 74 | waht is teh capitol of france | I couldn't work out "waht is teh capitol of france". | HONEST | Paris. | RIGHT |
| 75 | hwo many days in a leap yeer | I couldn't work out "hwo many days in a leap yeer". | HONEST | I don't know that yet. | HONEST |
| 76 | pls show me whats in teh readme | ```<br>git show<br>```<br><br>```<br>commit 3e74c4f0313b8bab4ca90df31174654c7193540c<br>Author: Versus <versus@example.com><br>Date:   Sat Oct 3 13:49:14 2026 -0700<br><br>    first commit<br><br>diff --git a/README.md b/README.md<br>new file mode 100644<br>index 0000000..4c6e061<br>--- /dev/null<br>+++ b/README.md<br>@@ -0,0 +1,3 @@<br>+# Shopping app<br>+<br>+A tiny app that keeps a shopping lis ... | RIGHT | I don't know how to what yet. | HONEST |
| 77 | whats 9 tims 9 | 9 times 9 is 81. | RIGHT | I don't know yet. | HONEST |
| 78 | remmber my fav color is green | I couldn't work out "remmber my fav color is green". | HONEST | I don't know how to is yet. | HONEST |
| 79 | wats my fav color | You haven't told me that. | HONEST | I see. | WRONG |
| 80 | can u tell me the tiem | I couldn't work out "can u tell me the tiem". | HONEST | It is 11:06 PM. | RIGHT |
| 81 | sooo how r u | I'm good, thanks. | RIGHT | I don't know what sooo is yet. Tell me (like "sooo is ...") and I'll remember. | HONEST |

## near-misses

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 82 | i pushed the code yesterday | Do you mean add I to code, or add yesterday to code? | RIGHT | I'm sorry to hear that. | RIGHT |
| 83 | my friend deleted his whole repo lol | Ha. | RIGHT | I see. | RIGHT |
| 84 | what does git commit do? | From the manual page `git-commit`:<br><br>Record changes to the repository | RIGHT | I don't know commit git yet. | HONEST |
| 85 | the word delete has six letters | I couldn't work out "the word delete has six letters". | HONEST | I don't know what letters is yet. Tell me (like "letters is ...") and I'll remember. | HONEST |
| 86 | should i use tabs or spaces? | I couldn't work out "should i use tabs or spaces?". | HONEST | I couldn't find tabs and spaces as two of the same kind of thing, so I can't compare them yet. | HONEST |
| 87 | how do i make a new branch in git | I couldn't work out "how do i make a new branch in git". | HONEST | Git/Branching & merging (from https://en.wikibooks.org/wiki/Git%2FBranching_%26_merging, CC BY-SA 4.0):<br><br>Why Branch?:<br>- You may have branches representing “stable” releases, which continue to get incremental bug fixes but no (major) new features. At the same time, you may have multiple “unstable” branches representing various new features being proposed for the next major release, and bei | WRONG |
| 88 | never mind | Stopped. | RIGHT | Have you followed the value of dollar lately? A mind is a combination of cognitive faculties that provides consciousness, thinking, reasoning, perception, and judgement in humans and potentially other life forms. | WRONG |

## conversation

| # | prompt | Noodle | verdict | Napkin | verdict |
|---|---|---|---|---|---|
| 89 | tell me a joke | I couldn't work out "tell me a joke". | HONEST | A joke is a short fictional story with the intent to make people laugh. | RIGHT |
| 90 | what can you do? | I don't know that about myself. | HONEST | Arithmetic, follow up arithmetic, dates and times, remember what you tell me, recall what you said, describe what i know, learn new words, look things up, continue sequences, compare two things, say what a plan is missing and forget what you ask. | WRONG |
| 91 | that's not what I meant | I couldn't work out "that's not what I meant". | HONEST | I don't know how to is yet. | HONEST |
| 92 | who made you | I don't know that about myself. | HONEST | I see. | WRONG |
| 93 | wow | I couldn't work out "wow". | HONEST | Glad you like it! | RIGHT |
| 94 | nice | I couldn't work out "nice". | HONEST | Glad you like it! | RIGHT |
