# Names for the rewrite

Written 2026-09-29. Candidates for the name after spoon, soup and napkin.

## What I scored on

- **Lineage.** Small, humble, everyday things at a table or in a kitchen, a little playful. Spoon is a utensil, soup is the dish, napkin is the linen beside it. The next one should feel like it belongs in the same drawer.
- **Fit with the design.** Bonus points when the word also says something true about the system: meaning as rewriting, a graph woven from small pieces, learning by being corrected, a tiny core with the meaning in the pot, being honest and slow rather than confidently fast.
- **Not a model.** Nothing that sounds like a chatbot, an oracle or a brain in a jar. The whole point is that there is no language model.
- **Sound.** One or two syllables, easy to say, no spelling ambiguity when heard aloud.
- **As a tool.** `NAME "what's on today"` in a terminal, `NAME.md`, `~/.NAME/store.ncon`, a package name. Short and lowercase-friendly wins. Colliding with a CLI people already have installed counts against it.
- **Conflicts.** Checked the top ~20 on the npm registry, GitHub and the web (results below each). Most good English words are taken on npm by an abandoned placeholder; that barely matters, a scoped package (`@keal/NAME`) or `NAME-core` solves it. A prominent product in the same space matters a lot.

## The ranked list

1. **Mulligan.** A mulligan stew is the pot made from whatever is on hand, which is exactly how this answers: what the graph holds, what the user said, then Wikidata, Wiktionary, WordNet, all thrown in the pot. And a mulligan is a do-over, a second shot you're allowed to take, which is the heart of the design: corrections are the main teacher and it repairs itself. It follows soup naturally and has a grin in it. Against: eight letters is long for a command (alias `mull`), and it reads a bit golf-bro. Conflicts: npm `mulligan` taken (promise retry helper, last touched 2022, obscure); GitHub has a Unity renaming tool "Mulligan Renamer" (~590 stars) and a golf partner app called Mulligan. Nothing in AI. Use `@keal/mulligan` or `mulligan-core`.

2. **Stew.** The obvious next dish after soup: thicker, more in it, cooked longer. "Let me stew on it" is exactly its honest, works-it-out personality. Four letters, perfect command, `STEW.md` looks great. Against: a real CLI collision, and "stewing" can mean sulking. Conflicts: npm `stew` is a 0.0.0 placeholder (2/wk); `marwanhawari/stew` is a binary package manager with a `stew` command (~355 stars), so some people already have `stew` on their PATH; StewAI is a small AI workflow automation platform. Moderate.

3. **Doily.** A doily is a lace of small knots laid on the table under things, which is a picture of a concept graph if there ever was one, and it sits right next to the napkin. Delightfully humble and old-fashioned, the opposite of an AI brand. Against: twee, and some will hear "daily". Conflicts: npm `doily` free, GitHub has only tiny personal repos, no software products found. Wide open.

4. **Mull.** Mulled cider in the kitchen, mulling it over in the head. Soft, short, a great verb for a command (`mull "is it raining in Ames"`). Against: close to Mullvad in people's ears. Conflicts: npm `mull` is a 0.0.1 placeholder; `mull-project/mull` is a C/C++ mutation-testing tool (~840 stars) that installs a `mull-runner` binary; Mull was a privacy Android browser; no AI product. Moderate but workable.

5. **Levain.** A sourdough starter: a living thing you feed, keep for years, pinch off to start new bread, and that gets better from use. That is how the graph learns. French, pretty, unusual. Against: pronunciation (luh-VAN) is not obvious, and it is the most precious name here. Conflicts: npm `levain` 0.0.0 placeholder; but PyPI `levain` is an "AI memory kit", a local store an AI assistant can read and edit, which is uncomfortably close in spirit. Taken but obscure, in the same neighbourhood.

6. **Kenning.** A kenning is a poetic rewrite ("whale-road" for the sea): a phrase that means another concept, which is literally what a reading is. It also holds "ken", knowing. Not table lineage at all, the strongest pure design-fit name. Conflicts: npm free; `antmicro/kenning` is an ML model deployment framework (~150 stars), AI-adjacent. Obscure but in the field.

7. **Tureen.** The lidded bowl the soup is served from: it holds the soup and brings it to the table, like the runtime holding the graph. Clear lineage, dignified, unusual. Against: people will say "terrine" or "tyoo-reen". Conflicts: npm free, GitHub empty, no products. Wide open.

8. **Roux.** The humble base, flour and fat, that everything else is built on. A tiny core that thickens into sauce is a very good description of the architecture. Against: "roo" vs "rukes", and it spells oddly in a terminal. Conflicts: npm `roux` taken, old API framework (~40/wk); a Rust Reddit client named roux (~115 stars); no AI product found. Obscure.

9. **Napery.** The collective word for table linen: napkins, tablecloths, placemats. It is literally the grown-up version of napkin, and keeps the "nap" so the lineage is visible. Against: few people know the word, and it could just feel like napkin with a hat on. Conflicts: npm free. Open.

10. **Ladle.** What you reach into the pot with to bring out exactly what you need. Lovely sound, perfect lineage, spoon's big sibling. Conflicts: taken and prominent. `tajo/ladle` is a well-known Storybook alternative for React (~3k stars) with a `ladle` CLI. Would always be confused in JS circles.

11. **Gloss.** A gloss is the note in the margin that says what a word means, and a glossary is a list of them; in the kitchen it is the shine on a finished sauce. Great design fit. Conflicts: npm `gloss` (styling library, ~380/wk); an open-source "Gloss" tool that explains highlighted text with an LLM; GlossGenius. Crowded, and the LLM one is the wrong association.

12. **Crumb.** Tiny, what's left on the napkin, and a trail of crumbs is provenance: every learned thing can be traced back. Conflicts: npm `crumb` is the hapi CSRF plugin (~940/wk); the Crumb programming language (~440 stars); several AI apps named Crumb (receptionist, recipe app, sourdough coach). Crowded.

13. **Broth.** The base that was simmered from the bones of things, like facts boiled out of sources. Plain and honest. Against: sounds a little like "bro". Conflicts: npm `broth` old browser-testing tool (~55/wk). Obscure.

14. **Marrow.** The meaning inside the bone, "the marrow of it". Soup lineage via bone broth. Against: a bit visceral. Conflicts: npm `marrow` obscure; GitHub org `marrow` (Python web libraries). Obscure.

15. **Trivet.** The little three-legged stand under the hot pot. Small, sturdy, supports everything. Against: nothing to do with meaning. Conflicts: npm `trivet` is an Eleventy starter (tiny). Obscure.

16. **Potluck.** Everyone brings a dish: Wikidata, Wiktionary, WordNet, VerbNet, the user. Warm, social, a little funny. Against: "luck" is the wrong word for an honest system. Conflicts: npm `potluck` obscure; Ink & Switch has a well-known research project called Potluck (dynamic documents), which people in the local-first world will know. Notable.

17. **Steep.** Tea steeping, being steeped in meaning. Conflicts: npm `steep` is a CLI tea timer; `soutaro/steep` is the Ruby type checker (~1.5k stars, with a `steep` command). Taken, moderately prominent in Ruby.

18. **Morsel.** A small bite; the core is a morsel. Conflicts: npm placeholder; at least five food and recipe apps called Morsel, some with AI features. Crowded.

19. **Pottage.** Old word for a thick soup (the "mess of pottage"). Direct lineage, rare. Against: sounds like "potage" or "pottery", slightly biblical. Conflicts: npm free. Open.

20. **Sippet.** A small piece of bread dipped into soup. Cute and obscure, sounds like "snippet". Against: nobody knows it. Conflicts: npm taken, not further checked.

21. **Saucer.** Sits under the cup, catches the spill. Nice sound. Against: flying saucer. npm placeholder.

22. **Spork.** Spoon and fork in one: a wink back to spoon. Against: a joke name, and "fork" means something else in software. npm taken (process spawner).

23. **Larder.** Where the food is kept; the graph as a larder. Old and warm. npm taken (small cache lib).

24. **Pantry.** Same idea, more common. Many products use it, including a JSON storage service.

25. **Tablecloth.** What everything sits on. Too long for a command. npm taken (OCaml/Reason stdlib).

26. **Placemat.** Each conversation gets a placemat. Too long, feels like a template engine. npm taken.

27. **Noodle.** Noodle soup, and "use your noodle" / "noodle on it" means think. Fun. Crowded (noodle.ai, many repos).

28. **Chew.** "Chew on it." Short, plain. Against: sounds like Chewbacca, npm placeholder.

29. **Simmer.** Low and slow, working it out. Nice verb. Common as a name.

30. **Sieve.** Keeps several readings and lets the right one through. Very apt for the reading choice. Against: sounds like a filter library, which it would be confused with.

31. **Tine.** One prong of a fork: tiny, sharp. Nice CLI (`tine`). npm taken (template engine).

32. **Sprig.** A sprig of parsley. Small and fresh. Taken prominently: Masterminds/sprig (Go template functions, ~4.7k stars).

33. **Brine.** Soaks things until they change. Salty, short. Minor conflicts.

34. **Crouton.** Goes in soup. Taken prominently: dnschneid/crouton (ChromeOS chroot tool, ~8.5k stars).

35. **Recipe.** Readings are recipes. Far too generic to search for.

36. **Seconds.** Going back for seconds, and it's the second serious try. Clever but awkward as a word on its own.

37. **Grace.** Said at the table before eating; also gracefulness in being wrong. Too much like a person's name, and implies a persona.

38. **Supper.** Plain, homely. Nothing about meaning.

39. **Kettle.** Always on, steady. Common product name.

40. **Cruet.** The little oil and vinegar bottle. Obscure, a DI container on npm already.

41. **Ramekin.** Small dish. Fun to say, feels arbitrary.

42. **Tisane.** Herbal infusion. Pretty, a bit fancy for this project.

43. **Skein.** A loose coil of yarn: the graph as thread. Design fit, no table.

44. **Weft.** The threads woven through the warp. Short, design fit, no table.

45. **Knot.** Concepts tied to each other. Very generic.

46. **Lemma.** Base form of a word, and a small proved step. Too academic, and too close to "lemmatizer".

47. **Rhizome.** A root network with no center. Good image of a graph, but pretentious.

48. **Umami.** The taste you can't name but recognise, like meaning. Taken prominently (Umami web analytics).

49. **Digest.** Digesting what it reads. Collides with hash digests everywhere.

50. **Whisk.** Mixing sources together. Taken prominently: Google Labs "Whisk" is a generative AI product, which is exactly the wrong association.

51. **Mise.** Mise en place, everything in its place. Taken prominently: `jdx/mise`, a very popular dev-tools CLI (~15k npm/wk). Would collide on many machines, including likely yours.

52. **Crock.** Slow cooker. But "a crock" means nonsense.

53. **Gist.** The gist of something is its meaning. Owned by GitHub Gist.

54. **Loom.** Weaving. Owned by Loom the video product.

55. **Grok.** To understand deeply. Owned by xAI's chatbot. Listed only to say no.

Wildcards not ranked above, in case one sparks something: **Hob** (the stove top), **Sop** (bread that soaks up soup, but reads as SOP), **Heel** (the end of the loaf), **Rind**, **Dollop**, **Spoonful** (full circle back to spoon; npm free).

## My top 3 and why

1. **Mulligan.** It is the only name that fits the lineage and two central ideas of the design at once: a stew made from whatever sources are on hand, and a do-over, which is how it learns and repairs itself. It is playful without being cute, and no one in AI uses it. Alias the command to `mull` if eight letters is too many.
2. **Stew.** The most natural successor to soup, four letters, a verb that describes how it thinks. The `stew` binary collision is the only real cost.
3. **Doily.** The best picture of the thing itself: a lace of small knots on the table, beside the napkin. Totally free everywhere. Choose it if you want charm over gravity.

Mulligan and Mull pair nicely: `mulligan` as the project and package, `mull` as the command.

## Patterns worth knowing

- **The lineage so far alternates:** spoon (a utensil), soup (the dish), napkin (the linen). A utensil or serving piece would be next by that rhythm (ladle, tureen, trivet), but a dish (stew, mulligan, broth) reads as "the soup got richer", which is honest for a rewrite that has more in it.
- **Short dish names are almost all taken on npm by placeholders.** Plan on a scope (`@keal/NAME`) from the start and it stops mattering.
- **Words that are both food and thinking** are the richest vein: stew, mull, chew, noodle, digest, simmer, steep, marinate. They describe what it does without implying a brain.
- **If the lineage continues after this one:** from mulligan or stew, the natural next steps are **seconds** (going back for more), **leftovers** (what you make something new from), or back to the table with **tureen** or **doily**.
- **Avoid** anything that sounds like a mind, an oracle or an assistant persona (Grok, Grace, Sage, Oracle). The name should sound like something that sits on the table and does its job.
