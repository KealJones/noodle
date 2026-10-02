// The assistant behind the chat endpoints and the terminal chat: a Session per conversation over
// the seeded store, the primitives, and a world rooted at the workspace. Chat UIs send the whole
// conversation each time; a conversation is known by its first user message, and only the last
// user message is a new turn. Earlier messages from a conversation the assistant has not seen (a
// restart) are not replayed, so nothing runs twice.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { seededStore } from "../runtime/seed.js";
import { Session } from "../runtime/turn.js";
import type { World } from "../runtime/primitive.js";
import type { Store } from "../runtime/store.js";
import type { Assistant, ChatMessage } from "../serve/assistant.js";

export interface AssistantOptions {
  /** The workspace every primitive is confined to. */
  root: string;
  store?: Store;
}

/** The packs imported into ~/.noodle/packs/ (pnpm import), loaded after the seed, WordNet first. */
export function packedStore(dir = join(homedir(), ".noodle", "packs")): Store {
  const store = seededStore();
  if (!existsSync(dir)) return store;
  const order = (f: string) => (f.startsWith("oewn") ? 0 : f.startsWith("verbnet") ? 1 : 2);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ncon")).sort((a, b) => order(a) - order(b) || a.localeCompare(b)))
    store.load(readFileSync(join(dir, f), "utf8"));
  return store;
}

export function createSession(store: Store, root: string, onSay?: (doc: unknown) => void): Session {
  const world: World = { root, store, now: () => new Date(), say: (d) => onSay?.(d), ask: (d) => onSay?.(d) };
  return new Session(store, PRIMITIVES, world);
}

export function createAssistant(opts: AssistantOptions = { root: process.env.NOODLE_ROOT ?? process.cwd() }): Assistant {
  const store = opts.store ?? packedStore();
  const sessions = new Map<string, Session>();
  return {
    name: "noodle",
    async *reply(messages: readonly ChatMessage[]) {
      const users = messages.filter((m) => m.role === "user");
      const last = users[users.length - 1];
      if (!last) return;
      const id = createHash("sha256").update(users[0].content).digest("hex");
      let session = sessions.get(id);
      if (!session) {
        session = createSession(store, opts.root);
        sessions.set(id, session);
      }
      const { text } = await session.turn(last.content);
      // Stream it by lines and words, as a chat UI expects text to arrive.
      for (const piece of text.match(/\S+\s*|\s+/g) ?? []) yield piece;
    },
  };
}
