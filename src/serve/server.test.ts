// Tests for the OpenAI- and Anthropic-compatible HTTP adapter, using a fake Assistant.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { Assistant, ChatMessage } from "./assistant.js";
import { createServer } from "./server.js";

const CHUNKS = ["Hello ", "there, ", "friend."];
const TEXT = CHUNKS.join("");

let seen: ChatMessage[] = [];
const fake: Assistant = {
  name: "noodle",
  async *reply(messages) {
    seen = [...messages];
    yield* CHUNKS;
  },
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Split an SSE body into events with an optional `event:` name and parsed `data:` payload. */
function parseSse(text: string): { event?: string; data: any }[] {
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)![1]!;
      return { ...(event ? { event } : {}), data: raw === "[DONE]" ? raw : JSON.parse(raw) };
    });
}

describe("serve", () => {
  const server = createServer(fake);
  const secured = createServer(fake, { apiKey: "secret", cors: ["http://chat.example"] });
  let base = "";
  let securedBase = "";
  before(async () => {
    base = await listen(server);
    securedBase = await listen(secured);
  });
  after(() => {
    server.close();
    secured.close();
  });

  it("answers health and lists the model", async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const models = await (await fetch(`${base}/v1/models`)).json();
    assert.equal(models.object, "list");
    assert.deepEqual(
      { id: models.data[0].id, object: models.data[0].object, owned_by: models.data[0].owned_by },
      { id: "noodle", object: "model", owned_by: "noodle" },
    );
  });

  it("streams OpenAI chat completions", async () => {
    const res = await post(`${base}/v1/chat/completions`, {
      model: "noodle",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "hi there" }],
    });
    assert.match(res.headers.get("content-type")!, /text\/event-stream/);
    const events = parseSse(await res.text());
    assert.equal(events.at(-1)!.data, "[DONE]");
    const chunks = events.slice(0, -1).map((e) => e.data);
    assert.equal(chunks[0].choices[0].delta.role, "assistant");
    const content = chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("");
    assert.equal(content, TEXT);
    const finish = chunks.filter((c) => c.choices[0]?.finish_reason === "stop");
    assert.equal(finish.length, 1);
    assert.equal(chunks.at(-1).usage.completion_tokens, 3);
    assert.equal(chunks.at(-1).usage.prompt_tokens, 2);
    assert.ok(chunks.every((c) => c.object === "chat.completion.chunk" && c.id.startsWith("chatcmpl-")));
  });

  it("answers OpenAI non-streaming", async () => {
    const res = await post(`${base}/v1/chat/completions`, {
      model: "noodle",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = await res.json();
    assert.equal(body.object, "chat.completion");
    assert.equal(body.choices[0].message.content, TEXT);
    assert.equal(body.choices[0].finish_reason, "stop");
    assert.equal(body.usage.total_tokens, 1 + 3);
  });

  it("streams Anthropic messages in order", async () => {
    const res = await post(`${base}/v1/messages`, {
      model: "noodle",
      max_tokens: 100,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    const events = parseSse(await res.text());
    const names = events.map((e) => e.event);
    assert.deepEqual(names, [
      "message_start",
      "content_block_start",
      "ping",
      ...CHUNKS.map(() => "content_block_delta"),
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const text = events
      .filter((e) => e.event === "content_block_delta")
      .map((e) => e.data.delta.text)
      .join("");
    assert.equal(text, TEXT);
    assert.equal(events[1]!.data.content_block.type, "text");
    const delta = events.find((e) => e.event === "message_delta")!.data;
    assert.equal(delta.delta.stop_reason, "end_turn");
    assert.equal(delta.usage.output_tokens, 3);
    assert.ok(events[0]!.data.message.id.startsWith("msg_"));
  });

  it("answers Anthropic non-streaming", async () => {
    const res = await post(`${base}/v1/messages`, {
      model: "noodle",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const body = await res.json();
    assert.equal(body.type, "message");
    assert.equal(body.role, "assistant");
    assert.deepEqual(body.content, [{ type: "text", text: TEXT }]);
    assert.equal(body.stop_reason, "end_turn");
  });

  it("rejects bad credentials in each API's format", async () => {
    const openai = await post(`${securedBase}/v1/chat/completions`, { messages: [] });
    assert.equal(openai.status, 401);
    const ob = await openai.json();
    assert.equal(ob.error.type, "authentication_error");
    assert.ok(ob.error.message);

    const anthropic = await post(`${securedBase}/v1/messages`, { messages: [] }, { "x-api-key": "wrong" });
    assert.equal(anthropic.status, 401);
    const ab = await anthropic.json();
    assert.equal(ab.type, "error");
    assert.equal(ab.error.type, "authentication_error");
  });

  it("accepts the key as a bearer token or x-api-key", async () => {
    const bearer = await post(
      `${securedBase}/v1/chat/completions`,
      { messages: [{ role: "user", content: "hi" }] },
      { authorization: "Bearer secret" },
    );
    assert.equal(bearer.status, 200);
    const header = await post(
      `${securedBase}/v1/messages`,
      { messages: [{ role: "user", content: "hi" }] },
      { "x-api-key": "secret" },
    );
    assert.equal(header.status, 200);
    assert.equal((await fetch(`${securedBase}/health`)).status, 200);
  });

  it("passes OpenAI messages through, taking text parts and mapping roles", async () => {
    await post(`${base}/v1/chat/completions`, {
      messages: [
        { role: "developer", content: "be brief" },
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            { type: "text", text: "at this" },
          ],
        },
        { role: "assistant", content: "ok" },
        { role: "tool", content: "ignored", tool_call_id: "x" },
        { role: "user", content: "and now" },
      ],
    });
    assert.deepEqual(seen, [
      { role: "system", content: "be brief" },
      { role: "user", content: "look\nat this" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "and now" },
    ]);
  });

  it("turns Anthropic's top-level system into a system message", async () => {
    await post(`${base}/v1/messages`, {
      max_tokens: 10,
      system: [{ type: "text", text: "be kind" }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    assert.deepEqual(seen, [
      { role: "system", content: "be kind" },
      { role: "user", content: "hi" },
    ]);
    await post(`${base}/v1/messages`, {
      max_tokens: 10,
      system: "plain",
      messages: [{ role: "user", content: "yo" }],
    });
    assert.deepEqual(seen[0], { role: "system", content: "plain" });
  });

  it("answers CORS preflight for an allowed origin only, and refuses other origins", async () => {
    const res = await fetch(`${securedBase}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: { origin: "http://chat.example", "access-control-request-method": "POST" },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://chat.example");
    assert.match(res.headers.get("access-control-allow-methods")!, /POST/);
    // No origin allowed by default; a page from elsewhere is refused, even a simple POST.
    const drive = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "text/plain" },
      body: JSON.stringify({ messages: [{ role: "user", content: "yes" }] }),
    });
    assert.equal(drive.status, 403);
    assert.equal(drive.headers.get("access-control-allow-origin"), null);
    // Without an origin (a server-side client), JSON is required.
    const plain = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    assert.equal(plain.status, 415);
  });

  it("returns 400 for bad JSON or missing messages", async () => {
    const bad = await post(`${base}/v1/chat/completions`, "{nope");
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.type, "invalid_request_error");
    const missing = await post(`${base}/v1/messages`, { model: "noodle" });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).type, "error");
  });

  it("aborts the assistant when the client disconnects mid-stream", async () => {
    let aborted!: () => void;
    const abortSeen = new Promise<void>((r) => (aborted = r));
    const slow: Assistant = {
      name: "slow",
      async *reply(_m, signal) {
        signal?.addEventListener("abort", aborted);
        yield "first ";
        await new Promise((r) => setTimeout(r, 5000).unref());
        yield "never";
      },
    };
    const s = createServer(slow);
    const url = await listen(s);
    const ctl = new AbortController();
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    await res.body!.getReader().read();
    ctl.abort();
    await abortSeen;
    s.closeAllConnections();
    s.close();
  });
});
