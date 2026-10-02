// HTTP adapter: exposes any Assistant through OpenAI- and Anthropic-compatible chat endpoints,
// so open-source chat UIs can talk to it. It knows nothing about Noodle beyond the Assistant
// interface. This file is outside the runtime, so reading the clock (for `created`) is fine here.

import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Assistant, ChatMessage } from "./assistant.js";

export interface ServerOptions {
  /** When set, requests must carry it as `Authorization: Bearer <key>` or `x-api-key: <key>`. */
  apiKey?: string;
}

type Api = "openai" | "anthropic";
type Json = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: string,
  ) {
    super(message);
  }
}

// There is no tokenizer, by design: usage counts whitespace-separated words, input and output.
const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** String content, or an array of parts/blocks: keep the text ones, ignore images and the rest. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is Json => isObject(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

function openaiMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "`messages` must be an array", "invalid_request_error");
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!isObject(m)) continue;
    const content = textOf(m.content);
    if (m.role === "system" || m.role === "developer") out.push({ role: "system", content });
    else if (m.role === "user" || m.role === "assistant") out.push({ role: m.role, content });
    // tool and function messages are ignored
  }
  return out;
}

function anthropicMessages(body: Json): ChatMessage[] {
  if (!Array.isArray(body.messages)) {
    throw new HttpError(400, "`messages` must be an array", "invalid_request_error");
  }
  const out: ChatMessage[] = [];
  const system = textOf(body.system);
  if (system) out.push({ role: "system", content: system });
  for (const m of body.messages) {
    if (isObject(m) && (m.role === "user" || m.role === "assistant")) {
      out.push({ role: m.role, content: textOf(m.content) });
    }
  }
  return out;
}

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON", "invalid_request_error");
  }
  if (!isObject(body)) throw new HttpError(400, "Request body must be a JSON object", "invalid_request_error");
  return body;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function errorBody(api: Api, e: HttpError): Json {
  return api === "openai"
    ? { error: { message: e.message, type: e.kind, code: e.kind } }
    : { type: "error", error: { type: e.kind, message: e.message } };
}

/** Run the assistant, aborting when the client goes away before the response is finished. */
function startReply(assistant: Assistant, messages: ChatMessage[], res: ServerResponse): AsyncGenerator<string> {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return (async function* () {
    for await (const chunk of assistant.reply(messages, controller.signal)) {
      if (controller.signal.aborted) return;
      if (chunk) yield chunk;
    }
  })();
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const c of stream) text += c;
  return text;
}

function startSse(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function chatCompletions(assistant: Assistant, body: Json, res: ServerResponse): Promise<void> {
  const messages = openaiMessages(body.messages);
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = assistant.name;
  const promptTokens = countWords(messages.map((m) => m.content).join(" "));
  const stream = startReply(assistant, messages, res);
  const usageOf = (completionTokens: number): Json => ({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  });

  if (body.stream !== true) {
    const text = await collect(stream);
    sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: usageOf(countWords(text)),
    });
    return;
  }

  const includeUsage = isObject(body.stream_options) && body.stream_options.include_usage === true;
  const send = (choices: Json[], extra: Json = {}): void => {
    const chunk = { id, object: "chat.completion.chunk", created, model, choices, ...extra };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };
  const sendDelta = (delta: Json, finish: string | null): void =>
    send([{ index: 0, delta, finish_reason: finish }]);

  startSse(res);
  sendDelta({ role: "assistant", content: "" }, null);
  let completionTokens = 0;
  try {
    for await (const text of stream) {
      completionTokens += countWords(text);
      sendDelta({ content: text }, null);
    }
  } catch (e) {
    const err = new HttpError(500, messageOf(e), "server_error");
    res.write(`data: ${JSON.stringify(errorBody("openai", err))}\n\n`);
    res.end("data: [DONE]\n\n");
    return;
  }
  sendDelta({}, "stop");
  // The spec sends usage in its own trailing chunk with an empty choices array.
  if (includeUsage) send([], { usage: usageOf(completionTokens) });
  res.end("data: [DONE]\n\n");
}

async function anthropicMessage(assistant: Assistant, body: Json, res: ServerResponse): Promise<void> {
  const messages = anthropicMessages(body);
  const id = `msg_${randomUUID().replaceAll("-", "")}`;
  const model = assistant.name;
  const inputTokens = countWords(messages.map((m) => m.content).join(" "));
  const stream = startReply(assistant, messages, res);

  const message = (content: unknown[], stopReason: string | null, outputTokens: number): Json => ({
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });

  if (body.stream !== true) {
    const text = await collect(stream);
    sendJson(res, 200, message([{ type: "text", text }], "end_turn", countWords(text)));
    return;
  }

  const event = (name: string, data: Json): void => {
    res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`);
  };

  startSse(res);
  event("message_start", { message: message([], null, 0) });
  event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  event("ping", {});
  let outputTokens = 0;
  try {
    for await (const text of stream) {
      outputTokens += countWords(text);
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
    }
  } catch (e) {
    const err = new HttpError(500, messageOf(e), "api_error");
    res.end(`event: error\ndata: ${JSON.stringify(errorBody("anthropic", err))}\n\n`);
    return;
  }
  event("content_block_stop", { index: 0 });
  event("message_delta", {
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  res.end(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
}

function authorized(req: IncomingMessage, apiKey: string): boolean {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
  return bearer === apiKey || req.headers["x-api-key"] === apiKey;
}

export function createServer(assistant: Assistant, opts: ServerOptions = {}): Server {
  return createHttpServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const api: Api = pathname === "/v1/messages" ? "anthropic" : "openai";
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers":
            req.headers["access-control-request-headers"] ??
            "authorization, content-type, x-api-key, anthropic-version",
          "access-control-max-age": "86400",
        });
        res.end();
        return;
      }
      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }
      if (opts.apiKey !== undefined && !authorized(req, opts.apiKey)) {
        throw new HttpError(401, "Invalid or missing API key", "authentication_error");
      }
      if (req.method === "GET" && pathname === "/v1/models") {
        sendJson(res, 200, {
          object: "list",
          data: [{ id: assistant.name, object: "model", created: 0, owned_by: "noodle" }],
        });
      } else if (req.method === "POST" && pathname === "/v1/chat/completions") {
        await chatCompletions(assistant, await readJson(req), res);
      } else if (req.method === "POST" && pathname === "/v1/messages") {
        await anthropicMessage(assistant, await readJson(req), res);
      } else {
        throw new HttpError(404, `No route for ${req.method} ${pathname}`, "not_found_error");
      }
    } catch (e) {
      const err =
        e instanceof HttpError
          ? e
          : new HttpError(500, messageOf(e), api === "openai" ? "server_error" : "api_error");
      if (res.headersSent) res.end();
      else sendJson(res, err.status, errorBody(api, err));
    }
  });
}
