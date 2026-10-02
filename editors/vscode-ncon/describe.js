// @ts-check
/**
 * What a Concept is, for hovering it: read from the .ncon files that define it (the comment above
 * its `Concept(...)`, its facts, the readings that are on it).
 */
const { scan, META } = require("./scan.js");

/**
 * @typedef {{ file: string, line: number, form: "Concept" | "Fact" | "Reading", comment: string, claims: string[], pattern?: string, becomes?: string }} Definition
 */

/** The top-level forms and their arguments, for signature help and completion (ncon-format.md section 2). */
const FORM_SIGNATURES = {
  Pack: {
    signature: "Pack(name=, version=, from=?, license=?)",
    doc: "The file's header. At most one, first. Its `from` is the default source for every item in the file.",
    named: { name: "The pack's name.", version: "The pack's version.", from: "The default source for every item in the file.", license: "The license of what the pack holds." },
  },
  Concept: {
    signature: "Concept(Name(), claim, claim, ..., meta)",
    doc: "A concept and facts about it. Each argument after the first is one fact's claim; the meta applies to all of them.",
    named: {},
  },
  Fact: {
    signature: "Fact(Name(), claim, inSense=?, holds=?, meta)",
    doc: "One fact, when it needs its own meta, sense or time.",
    named: { inSense: "The fact holds of the subject only in this sense.", holds: "When the fact is true, as a time expression." },
  },
  Reading: {
    signature: "Reading(on=, pattern=, wants=?, becomes=?, needs=?, effects=?, checks=?, mode=?, direction=?, meta)",
    doc: "One reading. More than one want, need, effect or check is written as `All(...)`.",
    named: {
      on: "The concept that owns the reading: the word or sense it is about.",
      pattern: "An expression with variables that the reading applies to.",
      wants: "Soft preferences on what the variables are bound to. Each is a score feature, never a filter.",
      becomes: "The result: an expression template, or a primitive call.",
      needs: "What must be known or obtained before it can act.",
      effects: "For readings that act: the effect classes and state changes it declares.",
      checks: "For readings that act: the effect check and, where derivable, the goal check.",
      mode: "The mode it applies in: Speaking, Supposing or Doing.",
      direction: "Expand (a concept to what it means, the default) or Collapse (words to what they name).",
    },
  },
  Block: {
    signature: "Block(id=, media=, body=, meta)",
    doc: "A content block: text or bytes that are content, not meaning. `body` is a raw string for text, base64 for bytes.",
    named: { id: "The content hash.", media: "What the body is.", body: "The content." },
  },
  Retract: {
    signature: "Retract(id=, meta)",
    doc: "The item with that id stops holding. Used in journals and exports, never in the seed.",
    named: { id: "The id of the item." },
  },
};

/** Metadata, on top-level forms only (section 3). */
const META_DOCS = {
  from: "A source expression, e.g. `WordNet(\"list.n.01\")`. Defaults to the Pack's `from`.",
  at: "An ISO 8601 UTC string. Defaults to the time of import.",
  status: "Active(), Proposed() or Pending(). Defaults to Active().",
  weight: "A number, for weighted guesses.",
  id: "A number; only in exports and journals, never hand-written.",
};

/** The top-level arguments of the call whose `(` is at `openIndex`, as text slices. */
function argumentsOf(text, marks, openIndex) {
  const open = marks[openIndex];
  const parts = [];
  let from = open.end;
  for (let i = openIndex + 1; i < marks.length; i++) {
    const m = marks[i];
    if (m.kind === "comma" && m.depth === open.depth) {
      parts.push(text.slice(from, m.start).trim());
      from = m.end;
    } else if (m.kind === "close" && m.depth === open.depth) {
      parts.push(text.slice(from, m.start).trim());
      return { parts: parts.filter(Boolean), end: i };
    }
  }
  return { parts: parts.filter(Boolean), end: marks.length };
}

/** The comment lines right above a line, without section banners. */
function commentAbove(lines, line) {
  const out = [];
  for (let l = line - 1; l >= 0; l--) {
    const t = lines[l].trim();
    if (!t.startsWith("//")) break;
    if (/^\/\/\s*(={4,}|-{4,})/.test(t)) break;
    out.unshift(t.replace(/^\/\/ ?/, ""));
  }
  return out.join("\n").trim();
}

const oneLine = (s) => s.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
const NAMED = /^([a-z][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]*)$/;
const CONCEPT_NAME = /^([A-Z][A-Za-z0-9_]*(?:#[A-Z][A-Za-z0-9_]*)?)\(\s*\)$/;

/**
 * Every concept the file writes about, by name.
 * @param {string} text
 * @param {string} file
 * @returns {Map<string, Definition[]>}
 */
function indexPack(text, file) {
  /** @type {Map<string, Definition[]>} */
  const out = new Map();
  const { marks } = scan(text);
  const lines = text.split("\n");
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === "\n") starts.push(k + 1);
  const lineOf = (/** @type {number} */ offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.kind !== "form") continue;
    const form = /** @type {string} */ (m.of);
    if (form !== "Concept" && form !== "Fact" && form !== "Reading") continue;
    let open = i + 1;
    while (open < marks.length && marks[open].kind !== "open") open++;
    const { parts, end } = argumentsOf(text, marks, open);
    i = end;
    const named = new Map(parts.flatMap((p) => { const n = NAMED.exec(p); return n ? [[n[1], n[2]]] : []; }));
    const positional = parts.filter((p) => !NAMED.test(p));
    const subject = form === "Reading" ? named.get("on") : positional[0];
    const name = CONCEPT_NAME.exec(subject ?? "")?.[1];
    if (!name) continue;
    const line = lineOf(m.start);
    /** @type {Definition} */
    const def = { file, line, form, comment: commentAbove(lines, line), claims: [] };
    if (form === "Concept") def.claims = positional.slice(1).map(oneLine);
    else if (form === "Fact") def.claims = positional.slice(1, 2).map(oneLine);
    else {
      def.pattern = oneLine(named.get("pattern") ?? "");
      if (named.has("becomes")) def.becomes = oneLine(/** @type {string} */ (named.get("becomes")));
    }
    out.set(name, [...(out.get(name) ?? []), def]);
  }
  return out;
}

/** The hover text for a concept: its comment, its facts, its readings. */
function describe(/** @type {string} */ name, /** @type {Definition[]} */ defs) {
  if (!defs.length) return "";
  const comment = defs.map((d) => d.comment).find(Boolean);
  const claims = [...new Set(defs.flatMap((d) => d.claims))];
  const readings = defs.filter((d) => d.form === "Reading");
  const parts = [`**${name}**`];
  if (comment) parts.push(comment);
  if (claims.length) parts.push("```ncon\n" + claims.slice(0, 20).join("\n") + (claims.length > 20 ? `\n// … ${claims.length - 20} more` : "") + "\n```");
  if (readings.length) {
    const shown = readings.slice(0, 8).map((r) => (r.becomes ? `${r.pattern}  =>  ${r.becomes}` : r.pattern));
    parts.push(`${readings.length} reading${readings.length === 1 ? "" : "s"}\n\`\`\`ncon\n${shown.join("\n")}${readings.length > 8 ? `\n// … ${readings.length - 8} more` : ""}\n\`\`\``);
  }
  return parts.join("\n\n");
}

module.exports = { indexPack, describe, FORM_SIGNATURES, META_DOCS, META };
