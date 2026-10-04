import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../../assistant/index.js";
import { c, key } from "../expr.js";
import { seededStore } from "../seed.js";
import { Know } from "./know.js";
import { chatgptServer, readHtml } from "./sources.js";

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

test("Noodle has one chat with ChatGPT: each message extends it through gptb serve, kept in the store, and a chat that cannot go on starts afresh", async () => {
  // A fake gptb serve: it records each messages array, and fails once when told to.
  const calls: { role: string; content: string }[][] = [];
  let failNext = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const messages = JSON.parse(body).messages;
    calls.push(messages);
    if (failNext && messages.length > 2) {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `reply ${calls.length}` } }] }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  try {
    const st = seededStore();
    const chatgpt = (m: string | { role: "system" | "user" | "assistant"; content: string }[]) => chatgptServer(m, port, 5000);
    const know = new Know(st, () => new Date(0), { chatgpt });
    assert.equal(await know.converse("rules", "first"), "reply 1");
    assert.equal(await know.converse("rules", "second"), "reply 2");
    assert.deepEqual(calls[0], [{ role: "system", content: "rules" }, { role: "user", content: "first" }]);
    // The second call extends the first: the same messages, its reply, then the new message.
    assert.deepEqual(calls[1].slice(0, 2), calls[0]);
    assert.deepEqual(calls[1].slice(2), [{ role: "assistant", content: "reply 1" }, { role: "user", content: "second" }]);
    // Kept in the store, from ChatGPT: a new Know (a restart) goes on with the same chat.
    assert.equal(st.facts("ChatGPT", "Exchange").length, 2);
    assert.equal(key(st.facts("ChatGPT", "Exchange")[0].meta.from), "ChatGPT()");
    await new Know(st, () => new Date(0), { chatgpt }).converse("rules", "third");
    assert.deepEqual(calls[2].slice(0, 4), calls[1]);
    // Where the chat cannot be continued, a new one starts with the rules and the message alone.
    failNext = true;
    assert.equal(await know.converse("rules", "fourth"), "reply 5");
    assert.deepEqual(calls[4], [{ role: "system", content: "rules" }, { role: "user", content: "fourth" }]);
    failNext = false;
    await know.converse("rules", "fifth");
    assert.deepEqual(calls[5], [{ role: "system", content: "rules" }, { role: "user", content: "fourth" }, { role: "assistant", content: "reply 5" }, { role: "user", content: "fifth" }]);
    // Offline, nothing is asked.
    assert.equal(await new Know(st, () => new Date(0), { chatgpt, offline: true }).converse("rules", "sixth"), undefined);
    assert.equal(calls.length, 6);
  } finally {
    server.close();
  }
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
