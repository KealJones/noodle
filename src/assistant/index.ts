// The assistant behind the chat endpoints and the terminal chat: a Session per conversation over
// the seeded store, the primitives, and a world rooted at the workspace. Chat UIs send the whole
// conversation each time; a conversation is known by its first user message, and only the last
// user message is a new turn. Earlier messages from a conversation the assistant has not seen (a
// restart) are not replayed, so nothing runs twice.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { format } from "../ncon/index.js";
import type { Call } from "../runtime/expr.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { seededStore } from "../runtime/seed.js";
import { Session } from "../runtime/turn.js";
import type { EffectClass, World } from "../runtime/primitive.js";
import type { Store } from "../runtime/store.js";
import type { Assistant, ChatMessage } from "../serve/assistant.js";
import { ReplayGate } from "./replay.js";
import { Know } from "../runtime/know/know.js";

export interface AssistantOptions {
  /** The workspace every primitive is confined to. */
  root: string;
  store?: Store;
}

/** What corrections taught the score, kept across sessions (design section 17). */
export const LEARNED = join(homedir(), ".noodle", "learned.ncon");
/** What the user taught ("X means Y"), confirmed, kept across sessions. */
export const TAUGHT = join(homedir(), ".noodle", "taught.ncon");

/** The packs imported into ~/.noodle/packs/ (pnpm import), loaded after the seed, WordNet first, then what was learned. */
export function packedStore(dir = join(homedir(), ".noodle", "packs"), learned: string | undefined = LEARNED): Store {
  const store = seededStore();
  if (learned && existsSync(learned)) store.load(readFileSync(learned, "utf8"));
  if (existsSync(dir)) {
    const order = (f: string) => (f.startsWith("oewn") ? 0 : f.startsWith("verbnet") ? 1 : 2);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ncon")).sort((a, b) => order(a) - order(b) || a.localeCompare(b)))
      store.load(readFileSync(join(dir, f), "utf8"));
  }
  // What the user taught comes last: it builds on words the packs gave.
  if (learned && existsSync(TAUGHT)) store.load(readFileSync(TAUGHT, "utf8"));
  return store;
}


/**
 * The config (~/.noodle/config.json, design section 20): level 1, the user's own. It grants
 * access: which programs Run may start, and effect classes that run without an offer
 * ({"grants": ["UnknownEffects"]} lets documented commands run when asked). Nothing learned can
 * write it.
 */
export interface Config {
  grants?: EffectClass[];
  programs?: string[];
  root?: string;
  timeoutMs?: number;
  /** Use Know, the door to outside knowledge (the chat and the endpoints turn it on). */
  know?: boolean;
  /** Check learned weight changes against the hand-checked items (testing.md section 4). */
  replay?: boolean;
  /** Keep what corrections teach in ~/.noodle/learned.ncon (the chat and the endpoints turn it on). */
  learn?: boolean;
  learnedPath?: string;
}

export function readConfig(path = join(homedir(), ".noodle", "config.json")): Config {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Config;
}

export function createSession(store: Store, root: string, config: Config = {}, onSay?: (doc: unknown) => void): Session {
  const world: World = {
    root,
    store,
    now: () => new Date(),
    say: (d) => onSay?.(d),
    ask: (d) => onSay?.(d),
    grants: config.grants ? new Set(config.grants) : undefined,
    keep: config.learn
      ? (form) => {
          mkdirSync(join(homedir(), ".noodle"), { recursive: true });
          const text = format({ forms: [form as Call] });
          const head = existsSync(TAUGHT) ? "" : 'Pack(name="taught", version="1", from=User())\n\n';
          appendFileSync(TAUGHT, head + text + "\n");
        }
      : undefined,
    programs: config.programs ? new Set(config.programs) : undefined,
    timeoutMs: config.timeoutMs,
  };
  // Know, the door to outside knowledge, where the channel turns it on; whether it may go out is
  // the SendsOutside grant.
  if (config.know) world.know = new Know(store, world.now);
  // Readings from documentation the user has confirmed, kept as facts (runtime.md 13).
  const confirmed = new Set(
    store
      .facts("Confirmation", "Confirmed")
      .map((f) => (f.claim as Call).args[0]?.value)
      .flatMap((x) => (x?.kind === "string" ? [x.value] : [])),
  );
  world.confirmed = confirmed;
  world.confirm = (k) => {
    if (confirmed.has(k)) return;
    confirmed.add(k);
    const claim: Call = { kind: "call", head: "Confirmed", args: [{ value: { kind: "string", value: k, pos: { line: 0, column: 0 } } }], pos: { line: 0, column: 0 } };
    store.addFact("Confirmation", claim, { kind: "call", head: "User", args: [], pos: { line: 0, column: 0 } });
    world.keep?.({ kind: "call", head: "Fact", args: [{ value: { kind: "call", head: "Confirmation", args: [], pos: { line: 0, column: 0 } } }, { value: claim }], pos: { line: 0, column: 0 } });
  };
  const session = new Session(store, PRIMITIVES, world);
  // The replay gate, where the corpus is on this machine and the config asks for it.
  if (config.replay) {
    const gate = new ReplayGate(store);
    session.gate = (changed, after, before) => gate.check(changed, after, before);
  }
  if (config.learn)
    session.onLearn = (w) => {
      mkdirSync(join(homedir(), ".noodle"), { recursive: true });
      writeFileSync(config.learnedPath ?? LEARNED, w.toNcon());
    };
  return session;
}

export function createAssistant(opts: Partial<AssistantOptions> = {}): Assistant {
  const config = readConfig();
  const root = opts.root ?? process.env.NOODLE_ROOT ?? config.root ?? process.cwd();
  const store = opts.store ?? packedStore();
  const sessions = new Map<string, Session>();
  return {
    name: "noodle",
    async *reply(messages: readonly ChatMessage[]) {
      const lastAt = messages.map((m) => m.role).lastIndexOf("user");
      if (lastAt < 0) return;
      const last = messages[lastAt];
      // A conversation is known by everything said before its last message: the session whose
      // history is exactly that continues; any other history (a new chat, an edited or
      // regenerated turn) gets a new session, so state never crosses chats and nothing runs twice.
      const history = (ms: readonly ChatMessage[]) =>
        createHash("sha256")
          .update(JSON.stringify(ms.filter((m) => m.role !== "system").map((m) => [m.role, m.content.trim()])))
          .digest("hex");
      const before = history(messages.slice(0, lastAt));
      let session = lastAt > 0 ? sessions.get(before) : undefined;
      if (session) sessions.delete(before);
      else session = createSession(store, root, { ...config, learn: config.learn ?? true, know: config.know ?? true });
      const { text } = await session.turn(last.content);
      sessions.set(history([...messages.slice(0, lastAt + 1), { role: "assistant", content: text }]), session);
      // Stream it by lines and words, as a chat UI expects text to arrive.
      for (const piece of text.match(/\S+\s*|\s+/g) ?? []) yield piece;
    },
  };
}
