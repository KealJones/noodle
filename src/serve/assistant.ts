// What a chat endpoint talks to: a conversation's messages in, the assistant's reply out as a
// stream of text chunks (markdown, the chat's medium). The server adapters (OpenAI- and
// Anthropic-compatible) know nothing else about Noodle.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Assistant {
  /** The model name the endpoints report. */
  readonly name: string;
  /** The reply to the last user message, given the whole conversation so far. */
  reply(messages: readonly ChatMessage[], signal?: AbortSignal): AsyncIterable<string>;
}
