import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../../assistant/index.js";
import { c, key } from "../expr.js";
import { seededStore } from "../seed.js";
import { Know } from "./know.js";
import { readHtml } from "./sources.js";

// Nothing here touches the network or runs a program: pages are given as text, ChatGPT is a
// function standing in for the program the config names, and the tools are invented.

test("an HTML page is read into structure: parts under headings, with items, rows, links and forms", () => {
  const doc = readHtml(
    `<html><head><title>Zorbia</title><script>x()</script></head><body>
     <p>Zorbia is a place.<sup class="reference">[1]</sup></p>
     <h2 id="Climate">Climate</h2><p>It is cold.</p><ul><li>Snow</li><li>Wind</li></ul>
     <table><tr><th>Month</th><th>Snow</th></tr><tr><td>May</td><td>2 m</td></tr></table>
     <h2 id="Visiting">Visiting</h2><p>See <a href="/wiki/Quuxton">Quuxton</a>.</p>
     <form action="/search" method="post"><input name="q"><button type="submit">Go</button></form>
     </body></html>`,
    "https://example.org/wiki/Zorbia",
  );
  assert.equal(doc.title, "Zorbia");
  assert.deepEqual(doc.parts.map((p) => p.heading), ["", "Climate", "Visiting"]);
  assert.deepEqual(doc.parts[0].paragraphs, ["Zorbia is a place."]);
  assert.deepEqual(doc.parts[1].items, ["Snow", "Wind"]);
  assert.deepEqual(doc.parts[1].rows, [["Month", "Snow"], ["May", "2 m"]]);
  assert.equal(doc.parts[1].anchor, "Climate");
  assert.deepEqual(doc.parts[2].links, [{ text: "Quuxton", to: "https://example.org/wiki/Quuxton" }]);
  assert.deepEqual(doc.parts[2].forms, [{ to: "https://example.org/search", method: "POST", fields: ["q", "submit"] }]);
});

test("a page kept as structure answers from the part whose heading names what was asked", async () => {
  const st = seededStore();
  st.load(`Pack(name="test-lexicon", version="0", from=WordNet("test"))
Concept(Climate(), Lemma("climate"), Category(Noun()))
`);
  const know = new Know(st, () => new Date(0), { offline: true });
  const from = c("Wikipedia");
  const block = st.addBlock("It is cold.", "text/plain", from);
  st.load(`Pack(name="test-page", version="0", from=Wikipedia("https://example.org/wiki/Zorbia"))
Fact(Zorbia#Topic(), Section("Climate", Paragraph(Block("${block.id}")), level=2, anchor="Climate"))
Fact(Zorbia#Topic(), Section("History", level=2))
`);
  const k = { block: "", title: "Zorbia", url: "https://example.org/wiki/Zorbia", source: "Wikipedia" };
  const part = await know.look(k, ["climate"]);
  assert.equal(part?.title, "Zorbia: Climate");
  assert.equal(part?.url, "https://example.org/wiki/Zorbia#Climate");
  assert.equal(st.block(part!.block)?.body, "It is cold.");
  assert.equal(await know.look(k, ["population"]), undefined);
});

test("ChatGPT is the last source: its reply is kept as markdown from it, once, and never offline", async () => {
  const st = seededStore();
  const asked: string[] = [];
  const chatgpt = async (q: string) => (asked.push(q), "A **glorp** is an invented thing.");
  const know = new Know(st, () => new Date(0), { chatgpt });
  const k = await know.ask("what is a glorp", "glorp");
  assert.equal(k?.source, "ChatGPT");
  assert.equal(k?.url, "");
  const b = st.block(k!.block)!;
  assert.equal(b.media, "text/markdown");
  assert.equal(key(b.meta.from), "ChatGPT()");
  await know.ask("what is a glorp", "glorp");
  assert.deepEqual(asked, ["what is a glorp"]);
  assert.equal(await new Know(st, () => new Date(0), { chatgpt, offline: true }).ask("what is a frob"), undefined);
  assert.deepEqual(asked, ["what is a glorp"]);
});

test("what a tool can do and what tools there are are answered from the graph, not looked up", async () => {
  const st = seededStore();
  st.load(`Pack(name="tool-zorb", version="local", from=ToolDoc("zorb"))
Block(id="b_zorb_frob", media="text/plain", body="Frob the widgets", from=ToolDoc("zorb-frob"))
Concept(Zorb(), Lemma("zorb"), IsA(Tool()), Name("zorb"), Category(Thing()), from=ToolDoc("zorb"))
Concept(Frob(), Lemma("frob"), Sense(Frob#ZorbCommand()), from=ToolDoc("zorb-frob"))
Concept(Frob#ZorbCommand(), SenseOf(Frob()), IsA(Command()), PartOf(Zorb()), Name("zorb frob"), Said(Block("b_zorb_frob")), from=ToolDoc("zorb-frob"))
Concept(Can(), Category(Act(), Takes(side=Right(), category=Act(), role=Theme())), from=WordNet("test"))
`);
  const s = createSession(st, mkdtempSync(join(tmpdir(), "noodle-members-")), { know: "offline" });
  const asked: string[] = [];
  s.world.know = Object.assign(s.world.know!, { answer: async (q: string) => (asked.push(q), undefined) });
  assert.equal((await s.turn("what can zorb do")).text, "- `zorb frob`: Frob the widgets");
  // A kind's members, every concept its word is counted: "source" is the core's KnowledgeSource.
  st.load(`Pack(name="test-lexicon", version="0", from=WordNet("test"))
Concept(Source_2(), Lemma("source"), Category(Noun()))
Fact(Use(), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme(), optional=true)))
`);
  const sources = (await s.turn("what sources do you use")).text;
  assert.match(sources, /- ChatGPT\n/);
  assert.match(sources, /- Wikipedia\n/);
  assert.deepEqual(asked, []);
});
