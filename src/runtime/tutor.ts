// ChatGPT as a tutor for choices (design section 17): where a choice has no clear evidence path,
// ChatGPT is asked, through Know (the one door outside, design section 21), which of the readings
// was meant, given the request, the conversation's last turns and the readings said in plain
// words. Its reply has a fixed shape that parses, and anything else is ignored.

import type { Know } from "./know/know.js";

/** What the tutor said: the option it picked (from 1), or none, a command it suggests, and its one sentence why. */
export interface TutorReply {
  choice: number | null;
  /** The exact command it suggests where no option is right, as written in its backticks. */
  suggest?: string;
  because: string;
}

/** How many of the conversation's last turns the question carries. */
const TURNS = 4;

/** A turn of the conversation as the question shows it, cut short. */
const line = (x: string) => (x.length > 300 ? `${x.slice(0, 300)} ...` : x).replace(/\s*\n\s*/g, " ").trim();

/**
 * The question: fixed, so the reply parses, and so the same choice asks the same question. The
 * options come said as the numbered choice says them.
 */
export function tutorPrompt(request: string, turns: readonly { who: string; text: string }[], options: readonly string[]): string {
  const said = turns.slice(-TURNS).filter((t) => t.text.trim());
  return [
    "An assistant is choosing what a user's request means. Pick the option the user most likely meant.",
    "",
    ...(said.length ? ["The conversation so far:", ...said.map((t) => `${t.who === "User" ? "the user" : "the assistant"}: ${line(t.text)}`), ""] : []),
    `The request: ${line(request)}`,
    "",
    "The options:",
    ...options.map(line),
    "",
    "Start your answer with exactly these three lines, in this order (anything else goes after them):",
    "choice: <the option's number, or none>",
    "suggest: <if no option is right and you know the right command, that exact command in backticks; otherwise none>",
    "because: <one sentence>",
  ].join("\n");
}

/**
 * The reply read strictly: its first three lines, in order, `choice: N` (or none), `suggest:` a
 * command in backticks (or none), and `because: ...`; otherwise it is no reply. Prose after them is
 * not read (Know keeps the whole reply as content).
 */
export function parseTutor(reply: string | undefined, options: number): TutorReply | undefined {
  const lines = (reply ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines.length < 3) return undefined;
  const choice = /^choice:\s*(\d+|none)$/i.exec(lines[0])?.[1];
  const suggest = /^suggest:\s*(?:`([^`\n]+)`|(none))$/i.exec(lines[1]);
  const because = /^because:\s*(\S.*)$/i.exec(lines[2])?.[1];
  if (!choice || !suggest || !because) return undefined;
  const suggested = suggest[1]?.trim() || undefined;
  if (/^none$/i.test(choice)) return { choice: null, suggest: suggested, because };
  const n = Number(choice);
  return n >= 1 && n <= options ? { choice: n, suggest: suggested, because } : undefined;
}

/** Asking the tutor through Know: kept as content from ChatGPT, not understood as a page is. */
export function tutorThrough(know: Know): (question: string) => Promise<string | undefined> {
  return async (question) => {
    const k = await know.ask(question, undefined, { understand: false });
    return k ? know.store.block(k.block)?.body : undefined;
  };
}
