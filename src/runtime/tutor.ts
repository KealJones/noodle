// ChatGPT as a tutor (design section 17): where a choice has no clear evidence path, ChatGPT is
// asked, through Know (the one door outside, design section 21), which of the readings was meant;
// where a message reaches nothing, how it is done or answered. Each question carries the
// conversation's last turns, both sides, and what ChatGPT asked before in this turn and was told.
// Each reply has a fixed shape that parses, and anything else is ignored.

import type { Know } from "./know/know.js";

/** What the tutor said: the option it picked (from 1), or none, a command it suggests, a question it needs answered, and its one sentence why. */
export interface TutorReply {
  choice: number | null;
  /** The exact command it suggests where no option is right, as written in its backticks. */
  suggest?: string;
  /** One question ChatGPT needs answered to help, where it gave nothing. */
  ask?: string;
  because: string;
}

/** A question ChatGPT asked, and the answer it was given: by the assistant, or by the user. */
export interface Exchange {
  asked: string;
  answer: string;
  by: "assistant" | "user";
}

/** How many of the conversation's last turns the question carries. */
const TURNS = 4;

/** A turn of the conversation as the question shows it, cut short. */
const line = (x: string) => (x.length > 300 ? `${x.slice(0, 300)} ...` : x).replace(/\s*\n\s*/g, " ").trim();

/** The conversation's last turns, both sides, and what ChatGPT asked and was told, as the question shows them. */
function context(turns: readonly { who: string; text: string }[], exchanged: readonly Exchange[]): string[] {
  const said = turns.slice(-TURNS).filter((t) => t.text.trim());
  return [
    ...(said.length ? ["The conversation so far:", ...said.map((t) => `${t.who === "User" ? "the user" : "the assistant"}: ${line(t.text)}`), ""] : []),
    ...exchanged.flatMap((x) => [`You asked: ${line(x.asked)}`, `${x.by === "user" ? "The user" : "The assistant"} answered: ${line(x.answer)}`, ""]),
  ];
}

const ASK = "ask: <if you need one question answered to help, that question; otherwise none>";

/** The `ask:` line read: a question, or none. */
function asked(x: string): string | undefined | false {
  const q = /^ask:\s*(\S.*)$/i.exec(x)?.[1];
  if (!q) return false;
  return /^none\.?$/i.test(q) ? undefined : q;
}

/**
 * The question: fixed, so the reply parses, and so the same choice asks the same question. The
 * options come said as the numbered choice says them.
 */
export function tutorPrompt(request: string, turns: readonly { who: string; text: string }[], options: readonly string[], exchanged: readonly Exchange[] = []): string {
  return [
    "An assistant is choosing what a user's request means. Pick the option the user most likely meant.",
    "",
    ...context(turns, exchanged),
    `The request: ${line(request)}`,
    "",
    "The options:",
    ...options.map(line),
    "",
    "Start your answer with exactly these four lines, in this order (anything else goes after them):",
    "choice: <the option's number, or none>",
    "suggest: <if no option is right and you know the right command, that exact command in backticks; otherwise none>",
    ASK,
    "because: <one sentence>",
  ].join("\n");
}

/**
 * The reply read strictly: its first four lines, in order, `choice: N` (or none), `suggest:` a
 * command in backticks (or none), `ask:` a question (or none), and `because: ...`; otherwise it is
 * no reply. Prose after them is not read (Know keeps the whole reply as content).
 */
export function parseTutor(reply: string | undefined, options: number): TutorReply | undefined {
  const lines = (reply ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines.length < 4) return undefined;
  const choice = /^choice:\s*(\d+|none)$/i.exec(lines[0])?.[1];
  const suggest = /^suggest:\s*(?:`([^`\n]+)`|(none))$/i.exec(lines[1]);
  const ask = asked(lines[2]);
  const because = /^because:\s*(\S.*)$/i.exec(lines[3])?.[1];
  if (!choice || !suggest || ask === false || !because) return undefined;
  const suggested = suggest[1]?.trim() || undefined;
  if (/^none$/i.test(choice)) return { choice: null, suggest: suggested, ask, because };
  const n = Number(choice);
  return n >= 1 && n <= options ? { choice: n, suggest: suggested, because } : undefined;
}

/**
 * What ChatGPT said when asked how a message nothing could work out is done or answered: a command
 * to run in the user's workspace, an answer in its own words, or neither (and then perhaps a
 * question it needs answered), and its one sentence why.
 */
export interface HowReply {
  kind: "command" | "answer" | "none";
  /** The exact command, as written in its backticks. */
  command?: string;
  answer?: string;
  ask?: string;
  because: string;
}

/**
 * The question for a message nothing could work out (design section 17): fixed, as the tutor's is,
 * so the reply parses, and so the same message asks the same question.
 */
export function howPrompt(message: string, turns: readonly { who: string; text: string }[], exchanged: readonly Exchange[] = []): string {
  return [
    "An assistant that can run commands in a shell in the user's workspace (a folder on their computer) could not work out how to do or answer the user's message.",
    "",
    ...context(turns, exchanged),
    `The message: ${line(message)}`,
    "",
    "Start your answer with exactly these five lines, in this order (anything else goes after them):",
    "kind: <command, answer, or none>",
    "command: <if a command run in the user's workspace would do or answer this, that exact command in backticks; otherwise none>",
    "answer: <if you can answer it yourself, in one or two sentences; otherwise none>",
    ASK,
    "because: <one sentence>",
  ].join("\n");
}

/**
 * The reply read strictly: its first five lines, in order, `kind:` command, answer or none,
 * `command:` a command in backticks (or none), `answer:` one or two sentences (or none), `ask:` a
 * question (or none), and `because: ...`, where the kind names what is given; otherwise it is no reply.
 */
export function parseHow(reply: string | undefined): HowReply | undefined {
  const lines = (reply ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines.length < 5) return undefined;
  const kind = /^kind:\s*(\S+)$/i.exec(lines[0])?.[1]?.toLowerCase();
  const command = /^command:\s*(?:`([^`\n]+)`|(none))$/i.exec(lines[1]);
  const answer = /^answer:\s*(\S.*)$/i.exec(lines[2])?.[1];
  const ask = asked(lines[3]);
  const because = /^because:\s*(\S.*)$/i.exec(lines[4])?.[1];
  if (!kind || !command || !answer || ask === false || !because) return undefined;
  const cmd = command[1]?.trim() || undefined;
  const said = /^none\.?$/i.test(answer) ? undefined : answer;
  // The kind names what the reply gives: a command, an answer, or none.
  const given: HowReply["kind"] = kind === "command" && cmd ? "command" : kind === "answer" && said ? "answer" : "none";
  if (given !== kind) return undefined;
  return { kind: given, command: given === "command" ? cmd : undefined, answer: given === "answer" ? said : undefined, ask: given === "none" ? ask : undefined, because };
}

/** The chat's rules, its first (system) message: what Noodle is, and that each reply keeps the shape each message asks for. */
export const CHAT_RULES = [
  "You are helping Noodle, an assistant that understands and acts without a language model, on a user's computer: it reads what the user says into readings, chooses between them, and runs commands in a shell in the user's workspace.",
  "Noodle asks you when it cannot choose what a request means, or cannot work out how to do or answer a message. Each message carries what it needs: the conversation's last turns, the request or message, the options, and what you asked before and were told.",
  "Start every reply with exactly the lines the message asks for, in that order, plain text, no formatting. Anything else goes after them. Noodle reads only those lines.",
].join("\n");

/** Asking ChatGPT through Know, in Noodle's one chat with it (Know.converse). */
export function tutorThrough(know: Know): (question: string) => Promise<string | undefined> {
  return (question) => know.converse(CHAT_RULES, question);
}
