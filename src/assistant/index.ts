// The assistant behind the chat endpoints and the terminal chat: a Session per conversation over
// the seeded store, the primitives, and a world rooted at the workspace. Chat UIs send the whole
// conversation each time; a conversation is known by its first user message, and only the last
// user message is a new turn. Earlier messages from a conversation the assistant has not seen (a
// restart) are not replayed, so nothing runs twice.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { type Call, type Expr, isCall } from "../runtime/expr.js";
import { chatgptServer } from "../runtime/know/sources.js";
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
import { learnTool } from "../know/tooldocs.js";

export interface AssistantOptions {
  /** The workspace every primitive is confined to. */
  root: string;
  store?: Store;
}

/** The store: one SQLite file, imported into once, queried as it is used (ncon.md section 9). */
export const STORE = process.env.NOODLE_STORE ?? join(homedir(), ".noodle", "store.db");
export const PACKS = process.env.NOODLE_PACKS ?? join(homedir(), ".noodle", "packs");

/**
 * The durable store with the seed and every pack in ~/.noodle/packs/ in it (pnpm run import). A part or
 * pack already there with the same text is not read again, so this is fast after the first time.
 * What was learned and taught is in the same database, kept across sessions.
 */
export function packedStore(dir = PACKS, path = STORE): Store {
  if (path !== ":memory:") mkdirSync(join(path, ".."), { recursive: true });
  const store = seededStore(undefined, path);
  if (existsSync(dir)) {
    const order = (f: string) => (f.startsWith("oewn") ? 0 : f.startsWith("verbnet") ? 1 : f.startsWith("wiktionary") ? 2 : 3);
    const present = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ncon")).sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
      const text = readFileSync(join(dir, f), "utf8");
      const name = /Pack\(\s*name\s*=\s*"([^"]*)"/.exec(text)?.[1];
      if (name) present.add(name);
      store.load(text);
    }
    // What earlier versions kept beside the store (learned weights, taught words) is not a pack
    // from the directory, and stays.
    for (const old of ["learned.ncon", "taught.ncon"]) {
      const p = join(homedir(), ".noodle", old);
      const name = existsSync(p) ? /Pack\(\s*name\s*=\s*"([^"]*)"/.exec(readFileSync(p, "utf8"))?.[1] : undefined;
      if (name) present.add(name);
    }
    // The packs directory says which packs there are: one whose file was taken away is taken out.
    for (const name of store.packNames()) if (!name.startsWith("seed-") && !present.has(name)) store.unload(name);
  }
  // What earlier versions kept beside the store (learned weights, taught words) comes in once.
  for (const old of ["learned.ncon", "taught.ncon"]) {
    const p = join(homedir(), ".noodle", old);
    if (path !== ":memory:" && existsSync(p)) store.load(readFileSync(p, "utf8"));
  }
  return store;
}


/**
 * The config (~/.noodle/config.json, design section 20): level 1, the user's own. It grants
 * access: which programs Run may start, and effect classes that run without an offer
 * ({"grants": ["UnknownEffects"]} lets documented commands run when asked). Nothing learned can
 * write it.
 */
const P0 = { line: 0, column: 0 };

export interface Config {
  grants?: EffectClass[];
  programs?: string[];
  root?: string;
  timeoutMs?: number;
  /**
   * Use Know, the door to outside knowledge (the chat and the endpoints turn it on). "offline":
   * Know answers from the graph and what it kept, and never goes out.
   */
  know?: boolean | "offline";
  /** Check learned weight changes against the hand-checked items (testing.md section 4). */
  replay?: boolean;
  /** Keep what corrections teach in ~/.noodle/learned.ncon (the chat and the endpoints turn it on). */
  learn?: boolean;
  /**
   * Ask ChatGPT when no other source answers (design section 21), through the program that
   * speaks to it in the user's browser: the command line before the question (["gptb"] by
   * default), or false to never ask it. Asking sends the question outside, so it is guarded as
   * any lookup is (the SendsOutside grant).
   */
  chatgpt?: boolean | string[];
  /** How long ChatGPT may take to answer, in milliseconds (120000). */
  chatgptTimeoutMs?: number;
}

/**
 * ChatGPT, asked through Run of the configured program with the question as its last argument;
 * where that cannot reach the browser (another gptb holds it), through gptb's local server. Its
 * reply is its output.
 */
function chatgptAsker(config: Config, world: World): ((question: string) => Promise<string | undefined>) | undefined {
  if (config.chatgpt === false || !config.know || config.know === "offline") return undefined;
  const [program, ...args] = Array.isArray(config.chatgpt) && config.chatgpt.length ? config.chatgpt : ["gptb"];
  // A config that lists the programs Run may start, without this one, does not ask it at all.
  if (world.programs && !world.programs.has(program)) return undefined;
  const timeoutMs = config.chatgptTimeoutMs ?? 120000;
  const run = PRIMITIVES.get("Run")!;
  const str = (x: string): Expr => ({ kind: "string", value: x, pos: P0 });
  return async (question) => {
    const ran = await run.run([str(program), { kind: "call", head: "Args", args: [...args, question].map((x) => ({ value: str(x) })), pos: P0 }], { ...world, timeoutMs }).catch(() => undefined);
    const exit = ran && isCall(ran) ? ran.args.find((a) => a.name === "exit")?.value : undefined;
    const out = ran && isCall(ran) ? ran.args.find((a) => a.name === "output")?.value : undefined;
    const id = isCall(out) ? out.args[0]?.value : undefined;
    const text = exit?.kind === "number" && exit.value === 0 && id?.kind === "string" ? world.store.block(id.value)?.body : undefined;
    return text?.trim() ? text : chatgptServer(question, 7778, timeoutMs);
  };
}

export function readConfig(path = process.env.NOODLE_CONFIG ?? join(homedir(), ".noodle", "config.json")): Config {
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
    programs: config.programs ? new Set(config.programs) : undefined,
    timeoutMs: config.timeoutMs,
  };
  // Know, the door to outside knowledge, where the channel turns it on; whether it may go out is
  // the SendsOutside grant.
  if (config.know) world.know = new Know(store, world.now, { offline: config.know === "offline", chatgpt: chatgptAsker(config, world) });
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
  };
  const session = new Session(store, PRIMITIVES, world);
  // A program a request names that the graph does not know is learned from its documentation
  // (design section 25), understood over the words the store has, and loaded. Where the channel
  // keeps what it learns, the tool's pack is kept with the others, so it is there after a restart.
  session.tools = {
    known: (program) => store.packNames().includes(`tool-${program}`),
    async learn(program, how) {
      const r = await learnTool(program, PRIMITIVES.get("Read")!, world, store, store, how);
      if (!r.commands.length) throw new Error(`nothing in ${program}'s ${how === "help" ? "help" : "manual page"} could be learned`);
      if (config.learn) {
        mkdirSync(PACKS, { recursive: true });
        writeFileSync(join(PACKS, `tool-${program}.ncon`), r.text);
      }
      store.load(r.text);
    },
  };
  // The replay gate, where the corpus is on this machine and the config asks for it.
  if (config.replay) {
    const gate = new ReplayGate(store);
    session.gate = (changed, after, before) => gate.check(changed, after, before);
  }
  // What a correction teaches the score is kept in the store, as facts from the correction.
  if (config.learn)
    session.onLearn = (w, changed) => {
      for (const name of changed)
        store.addFact("Feature", { kind: "call", head: "Weight", args: [{ value: { kind: "string", value: name, pos: P0 } }, { value: { kind: "number", value: w.get(name), pos: P0 } }], pos: P0 }, { kind: "call", head: "Correction", args: [], pos: P0 });
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
