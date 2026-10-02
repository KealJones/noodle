// Speaking (design sections 23 and 25b): what Say is handed is realized by the seed's Speaking
// readings into a document, then printed in the destination's medium by the medium's readings.
// The runtime holds no wording and no markup: every word said and every mark printed comes from
// seed/realizations.ncon. What is here is mechanism: applying readings, folding a long sequence
// into pairs when only a pair's reading exists, joining printed text, escaping a medium's marks
// (Escapes facts on the medium), and fencing code.

import { type Call, type Expr, c, isCall, isVar, key, positional, role, s } from "./expr.js";
import { carry, instantiate, match, type Bindings } from "./match.js";
import type { ReadingItem, Store } from "./store.js";

const MAX_DEPTH = 64;

export class Speaker {
  constructor(readonly store: Store) {}

  private speakingReadings(head: string): ReadingItem[] {
    return this.store.readingsFor(head).filter((r) => r.mode === "Speaking" && r.becomes);
  }

  /**
   * The Speaking reading that applies with the most specific pattern (most of the expression
   * matched, fewest roles left over), its needs met from the store's facts. Wording has no
   * learned score yet; specificity is its only feature, and ties go to the earlier entry.
   */
  private apply(e: Expr): Expr | undefined {
    if (!isCall(e)) return undefined;
    // A reading whose pattern is a bare variable (a concept said by its lemma) is for a concept on
    // its own: it is tried last, and only on a call with no arguments.
    const general = e.args.length ? [] : this.speakingReadings("");
    let best: { out: Expr; spec: number } | undefined;
    for (const r of [...this.speakingReadings(e.head), ...general]) {
      const m = match(r.pattern, e, this.store);
      if (!m) continue;
      const b = this.needs(r, m.bindings);
      if (!b || !this.wantsHold(r, b)) continue;
      const out = carry(instantiate(r.becomes!, b), isCall(r.pattern) ? m.extra : []);
      if (key(out) === key(e)) continue;
      const spec = specificity(r.pattern) - m.extra.length;
      if (!best || spec > best.spec) best = { out, spec };
    }
    return best?.out;
  }

  /** Needs of the form Fact($x, Claim(...)) are answered from the facts on $x. */
  private needs(r: ReadingItem, b: Bindings): Bindings | undefined {
    let cur = b;
    for (const need of r.needs) {
      if (!(isCall(need) && need.head === "Fact")) return undefined;
      const [subj, claim] = positional(need).map((x) => instantiate(x, cur));
      if (!isCall(subj) || !isCall(claim)) return undefined;
      const hit = this.store.facts(subj.head, claim.head).map((f) => match(claim, f.claim, this.store, cur)).find(Boolean);
      if (!hit) return undefined;
      cur = hit.bindings;
    }
    return cur;
  }

  /** Wants used as conditions here only for kinds: IsA($x, K) holds of what is a K. */
  private wantsHold(r: ReadingItem, b: Bindings): boolean {
    return r.wants.every((w) => {
      if (!(isCall(w) && w.head === "IsA")) return true;
      const [x, k] = positional(w).map((a) => (isVar(a) ? b.get(a.text) : a));
      return isCall(x) && isCall(k) && this.store.kinds(x.head).has(k.head);
    });
  }

  /** Realize: rewrite by Speaking readings until none applies, then the arguments. */
  realize(e: Expr, depth = 0): Expr {
    if (depth > MAX_DEPTH || !isCall(e)) return e;
    const r = this.apply(e);
    if (r !== undefined) return this.realize(r, depth + 1);
    const folded = this.fold(e);
    if (folded) return this.realize(folded, depth + 1);
    return { ...e, args: e.args.map((a) => ({ ...a, value: this.realize(a.value, depth + 1) })) };
  }

  /**
   * A call with more positional arguments than any reading of its head takes is read as nested
   * pairs, Head(a, Head(b, c)), when the head has a reading for two: a sequence realized pairwise.
   */
  private fold(e: Call, readings = this.speakingReadings(e.head)): Call | undefined {
    const pos = positional(e);
    if (pos.length <= 2) return undefined;
    if (!readings.some((r) => isCall(r.pattern) && positional(r.pattern).length === 2)) return undefined;
    if (readings.some((r) => isCall(r.pattern) && positional(r.pattern).length === pos.length)) return undefined;
    const roled = e.args.filter((a) => a.name !== undefined);
    return { ...e, args: [{ value: pos[0] }, { value: { ...e, args: [...pos.slice(1).map((value) => ({ value })), ...roled] } }, ...roled] };
  }

  /** Print a realized document in a medium (Print readings), down to text. */
  print(doc: Expr, medium: string, depth = 0): string {
    if (depth > MAX_DEPTH) return "";
    if (doc.kind === "string") return this.escape(doc.value, medium);
    if (doc.kind === "number") return String(doc.value);
    if (doc.kind === "boolean") return String(doc.value);
    if (!isCall(doc)) return "";
    const p = c("Print", doc, ["medium", c(medium)]);
    const r = this.apply(p);
    if (r !== undefined) return this.text(r, medium, depth + 1);
    if (isCall(doc)) {
      const folded = this.fold(doc, this.speakingReadings(doc.head).filter((x) => isCall(x.pattern) && x.pattern.head === "Print"));
      const foldedForPrint = folded ?? this.foldPrint(doc);
      if (foldedForPrint) return this.print(foldedForPrint, medium, depth + 1);
    }
    // Kept content prints as itself, escaped in the medium: it is the source's words, not markup.
    if (doc.head === "Block" && positional(doc)[0]?.kind === "string") {
      const b = this.store.block((positional(doc)[0] as { value: string }).value);
      if (b) return this.escape(b.body, medium);
    }
    // A concept on its own with no reading prints as its lemma, or its name.
    if (!doc.args.length) return this.escape(this.lemmaOf(doc.head), medium);
    // No reading prints it: its parts, in order.
    return positional(doc)
      .map((x) => this.print(x, medium, depth + 1))
      .join("");
  }

  /** Fold for printing: Print readings are on Print(Head(...)), so look at their inner patterns. */
  private foldPrint(doc: Call): Call | undefined {
    const inner = this.store
      .readingsFor("Print")
      .filter((r) => r.mode === "Speaking")
      .map((r) => positional(r.pattern as Call)[0])
      .filter((x): x is Call => isCall(x) && x.head === doc.head);
    const pos = positional(doc);
    if (pos.length <= 2 || !inner.some((x) => positional(x).length === 2) || inner.some((x) => positional(x).length === pos.length)) return undefined;
    const roled = doc.args.filter((a) => a.name !== undefined);
    return { ...doc, args: [{ value: pos[0] }, { value: { ...doc, args: [...pos.slice(1).map((value) => ({ value })), ...roled] } }, ...roled] };
  }

  /** Evaluate the printing heads (structural) of what a Print reading became. */
  private text(e: Expr, medium: string, depth: number): string {
    if (e.kind === "string") return e.value;
    if (e.kind === "number") return String(e.value);
    if (!isCall(e)) return "";
    const pos = positional(e);
    switch (e.head) {
      case "Printed":
        return pos.map((x) => this.text(x, medium, depth + 1)).join("");
      case "Print": {
        const m = role(e, "medium");
        return this.print(pos[0], isCall(m) ? m.head : medium, depth + 1);
      }
      case "Escaped":
        return pos[0]?.kind === "string" ? this.escape(pos[0].value, medium) : this.print(pos[0], medium, depth + 1);
      case "Repeated": {
        const [t, n] = pos;
        return t?.kind === "string" && n?.kind === "number" ? t.value.repeat(Math.max(0, n.value)) : "";
      }
      case "Uppercase":
        return this.plain(pos[0]).toUpperCase();
      case "Capitalized": {
        const t = this.plain(pos[0]);
        return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
      }
      case "Fenced":
        return this.fence(e);
    }
    return this.print(e, medium, depth + 1);
  }

  private plain(e: Expr | undefined): string {
    if (!e) return "";
    if (e.kind === "string") return e.value;
    if (isCall(e)) return e.head;
    return String((e as { value?: unknown }).value ?? "");
  }

  private escape(t: string, medium: string): string {
    const marks = this.store
      .facts(medium, "Escapes")
      .map((f) => positional(f.claim as Call)[0])
      .flatMap((x) => (x?.kind === "string" ? [x.value] : []));
    if (!marks.length) return t;
    let out = "";
    for (const ch of t) out += marks.includes(ch) ? "\\" + ch : ch;
    return out;
  }

  /** Code: a fence of the mark longer than any run of it inside (design section 25b). */
  private fence(e: Call): string {
    const [content] = positional(e);
    const body = this.plain(isCall(content) && content.head === "Block" ? content : content);
    const text = content?.kind === "string" ? content.value : isCall(content) ? this.blockText(content) : body;
    const mark = role(e, "mark");
    const m = mark?.kind === "string" ? mark.value : "`";
    const min = role(e, "min");
    let longest = 0;
    for (const run of text.match(new RegExp(`${m.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}+`, "g")) ?? []) longest = Math.max(longest, run.length);
    const len = Math.max(min?.kind === "number" ? min.value : 1, longest + 1);
    const f = m.repeat(len);
    const block = role(e, "block");
    if (block?.kind === "boolean" && block.value) {
      const lang = role(e, "language");
      return `${f}${isCall(lang) ? this.lemmaOf(lang.head) : lang?.kind === "string" ? lang.value : ""}\n${text}${text.endsWith("\n") ? "" : "\n"}${f}`;
    }
    const pad = role(e, "pad");
    const sp = pad?.kind === "boolean" && pad.value && (text.startsWith(m) || text.endsWith(m) || text.startsWith(" ") || text.endsWith(" ")) ? " " : "";
    return `${f}${sp}${text}${sp}${f}`;
  }

  private blockText(e: Call): string {
    if (e.head === "Block") {
      const id = positional(e)[0];
      if (id?.kind === "string") return this.store.block(id.value)?.body ?? id.value;
    }
    // Code shows source: an expression inside a fence prints in no medium, so nothing is escaped.
    return this.print(e, "");
  }

  private lemmaOf(concept: string): string {
    const l = this.store.facts(concept, "Lemma").map((f) => positional(f.claim as Call)[0])[0];
    return l?.kind === "string" ? l.value : concept.toLowerCase();
  }

  /** Say: realize, then print in the medium. */
  say(e: Expr, medium: string): string {
    return this.print(this.realize(e), medium).trim();
  }
}

/** How much of an expression a pattern pins down: its calls and literals, not its variables. */
function specificity(p: Expr): number {
  // A call pins down most, a literal less, a variable only that something is there.
  if (!isCall(p)) return isVar(p) ? 0.5 : 1;
  return 2 + p.args.reduce((n, a) => n + specificity(a.value), 0);
}

export { s };
