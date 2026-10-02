// The store (ncon.md section 9): concepts, facts, readings and content blocks with their meta, in
// SQLite, indexed by lemma, by fact head, by the concepts a claim names, and by pattern head.
// `.ncon` files are its text form: load a pack, export the store, and the text round-trips.
//
// The runtime reads through in-memory indexes built as items arrive; SQLite is the record. A store
// opened on a file keeps everything; `new Store()` is in memory, for the seed and tests.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { type Call, type Expr, type NconFile, NconError, format, parse } from "../ncon/index.js";
import { c, heads, isCall, isHead, key, positional, role, s } from "./expr.js";

export type Status = "Active" | "Proposed" | "Pending" | "Retracted";

export interface Meta {
  id: number;
  from: Expr;
  at?: string;
  status: Status;
  weight?: number;
  pack?: string;
}

export interface FactItem {
  kind: "fact";
  subject: string;
  claim: Expr;
  inSense?: string;
  holds?: Expr;
  meta: Meta;
}

export interface ReadingItem {
  kind: "reading";
  owner: string;
  pattern: Expr;
  wants: Expr[];
  becomes?: Expr;
  needs: Expr[];
  effects: Expr[];
  checks: Expr[];
  mode?: string;
  direction: "Expand" | "Collapse";
  meta: Meta;
}

export interface BlockItem {
  kind: "block";
  id: string;
  media: string;
  body: string;
  meta: Meta;
}

/** Where a token can lead: a concept, and the features of the form it was found by. */
export interface LemmaHit {
  concept: string;
  features: string[];
}

const READING_PARTS = ["pattern", "wants", "becomes", "needs", "effects", "checks", "mode", "direction"] as const;
const META_NAMES = new Set(["from", "at", "status", "weight", "id"]);

export class Store {
  private db: DatabaseSync;
  private nextId = 1;
  private concepts = new Set<string>();
  private factsBySubject = new Map<string, FactItem[]>();
  private factsByHead = new Map<string, FactItem[]>();
  private factsByNamed = new Map<string, FactItem[]>();
  private readingsByOwner = new Map<string, ReadingItem[]>();
  private readingsByPatternHead = new Map<string, ReadingItem[]>();
  private lemmas = new Map<string, LemmaHit[]>();
  private blocks = new Map<string, BlockItem>();
  private packs: { name: string; version: string; hash: string }[] = [];

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, kind TEXT, owner TEXT, head TEXT, text TEXT, pack TEXT);
      CREATE TABLE IF NOT EXISTS packs (name TEXT, version TEXT, hash TEXT);
      CREATE INDEX IF NOT EXISTS items_owner ON items(owner);
      CREATE INDEX IF NOT EXISTS items_head ON items(head);
    `);
    const rows = this.db.prepare("SELECT id, text, pack FROM items ORDER BY id").all() as { id: number; text: string; pack: string | null }[];
    for (const r of rows) this.index(parse(r.text).forms[0], undefined, r.pack ?? undefined, r.id);
    if (rows.length) this.nextId = rows[rows.length - 1].id + 1;
    this.packs = this.db.prepare("SELECT name, version, hash FROM packs").all() as { name: string; version: string; hash: string }[];
  }

  // -------------------------------------------------------------------------------------------
  // Loading

  /** Loads a `.ncon` file atomically (ncon-format.md section 6, rule 4). Returns the number of items. */
  load(text: string): number {
    const file = parse(text);
    const pack = file.forms[0]?.head === "Pack" ? file.forms[0] : undefined;
    const packFrom = pack ? namedArg(pack, "from") : undefined;
    const packName = pack ? stringArg(pack, "name") : undefined;
    const items = file.forms.filter((f) => f.head !== "Pack");
    // Validate everything before anything is written.
    for (const f of items) this.toItem(f, packFrom, packName, 0);
    this.db.exec("BEGIN");
    try {
      for (const f of items) for (const item of this.index(f, packFrom, packName)) this.persist(item);
      if (pack && packName) {
        const hash = createHash("sha256").update(text).digest("hex");
        const version = stringArg(pack, "version") ?? "";
        this.packs.push({ name: packName, version, hash });
        this.db.prepare("INSERT INTO packs VALUES (?, ?, ?)").run(packName, version, hash);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return items.length;
  }

  /** Adds one fact, at runtime (a learned fact, a state, a correction). */
  addFact(subject: string, claim: Expr, from: Expr, extra: Partial<Omit<Meta, "id" | "from">> = {}): FactItem {
    const meta: Meta = { id: this.nextId++, from, status: extra.status ?? "Active", weight: extra.weight, pack: extra.pack, at: extra.at };
    const item: FactItem = { kind: "fact", subject, claim, meta };
    this.concepts.add(subject);
    this.indexFact(item);
    this.persist(item);
    return item;
  }

  /** Keeps a content block; identical content is one block (ncon.md section 6). */
  addBlock(body: string, media: string, from: Expr): BlockItem {
    const id = "b_" + createHash("sha256").update(body).digest("hex").slice(0, 16);
    const have = this.blocks.get(id);
    if (have) return have;
    const item: BlockItem = { kind: "block", id, media, body, meta: { id: this.nextId++, from, status: "Active" } };
    this.blocks.set(id, item);
    this.persist(item);
    return item;
  }

  private persist(item: FactItem | ReadingItem | BlockItem) {
    const owner = item.kind === "fact" ? item.subject : item.kind === "reading" ? item.owner : item.id;
    const head = item.kind === "fact" && isCall(item.claim) ? item.claim.head : item.kind === "reading" && isCall(item.pattern) ? item.pattern.head : null;
    this.db
      .prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.meta.id, item.kind, owner, head, format({ forms: [toForm(item)] }), item.meta.pack ?? null);
  }

  private toItem(form: Call, packFrom: Expr | undefined, pack: string | undefined, id: number): (FactItem | ReadingItem | BlockItem)[] {
    const from = namedArg(form, "from") ?? packFrom;
    if (!from) throw new NconError("an item needs a source: give it from= or a Pack with from=", form.pos, form.head);
    const statusArg = namedArg(form, "status");
    const meta: Meta = {
      id,
      from,
      at: stringArg(form, "at"),
      status: (isCall(statusArg) ? statusArg.head : "Active") as Status,
      weight: numberArg(form, "weight"),
      pack,
    };
    const pos = form.args.filter((a) => a.name === undefined).map((a) => a.value);
    switch (form.head) {
      case "Concept": {
        const subject = (pos[0] as Call).head;
        return pos.slice(1).map((claim) => ({ kind: "fact", subject, claim, meta: { ...meta } }));
      }
      case "Fact": {
        const subject = (pos[0] as Call).head;
        const inSense = namedArg(form, "inSense");
        return [{ kind: "fact", subject, claim: pos[1], inSense: isCall(inSense) ? inSense.head : undefined, holds: namedArg(form, "holds"), meta }];
      }
      case "Reading": {
        const on = namedArg(form, "on") as Call;
        const many = (n: string) => {
          const e = namedArg(form, n);
          return e === undefined ? [] : isHead(e, "All") ? positional(e) : [e];
        };
        const mode = namedArg(form, "mode");
        const direction = namedArg(form, "direction");
        return [
          {
            kind: "reading",
            owner: on.head,
            pattern: namedArg(form, "pattern")!,
            wants: many("wants"),
            becomes: namedArg(form, "becomes"),
            needs: many("needs"),
            effects: many("effects"),
            checks: many("checks"),
            mode: isCall(mode) ? mode.head : undefined,
            direction: isHead(direction, "Collapse") ? "Collapse" : "Expand",
            meta,
          },
        ];
      }
      case "Block":
        return [{ kind: "block", id: stringArg(form, "id")!, media: stringArg(form, "media")!, body: stringArg(form, "body")!, meta }];
      case "Retract":
        return [];
    }
    throw new NconError(`"${form.head}" cannot be stored`, form.pos, form.head);
  }

  private index(form: Call, packFrom: Expr | undefined, pack: string | undefined, id?: number) {
    const items = this.toItem(form, packFrom, pack, 0);
    for (const item of items) item.meta.id = id ?? this.nextId++;
    if (form.head === "Concept" || form.head === "Fact") this.concepts.add((form.args[0].value as Call).head);
    for (const item of items) {
      if (item.kind === "fact") this.indexFact(item);
      else if (item.kind === "reading") {
        this.concepts.add(item.owner);
        push(this.readingsByOwner, item.owner, item);
        push(this.readingsByPatternHead, isCall(item.pattern) ? item.pattern.head : "", item);
      } else this.blocks.set(item.id, item);
    }
    return items;
  }

  private indexFact(f: FactItem) {
    push(this.factsBySubject, f.subject, f);
    if (isCall(f.claim)) {
      push(this.factsByHead, f.claim.head, f);
      for (const h of heads(f.claim)) if (h !== f.claim.head) push(this.factsByNamed, h, f);
      // Lookup is by lemma, never by name (ncon.md section 2.1).
      if (f.claim.head === "Lemma" || f.claim.head === "Form") {
        const text = positional(f.claim)[0];
        if (text?.kind === "string") {
          const features = positional(f.claim)
            .slice(1)
            .flatMap((x) => (isCall(x) ? [x.head] : []));
          push(this.lemmas, text.value.toLowerCase(), { concept: f.subject, features });
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Reading

  has(concept: string): boolean {
    return this.concepts.has(concept);
  }

  /** Concepts a token's lowercased text is a lemma or form of. */
  lookup(text: string): LemmaHit[] {
    return this.lemmas.get(text.toLowerCase()) ?? [];
  }

  /** Every lemma and form text, for spelling candidates. */
  lemmaTexts(): IterableIterator<string> {
    return this.lemmas.keys();
  }

  facts(subject: string, head?: string): FactItem[] {
    const all = (this.factsBySubject.get(subject) ?? []).filter((f) => f.meta.status !== "Retracted");
    return head ? all.filter((f) => isHead(f.claim, head)) : all;
  }

  factsWithHead(head: string): FactItem[] {
    return (this.factsByHead.get(head) ?? []).filter((f) => f.meta.status !== "Retracted");
  }

  /** Facts whose claim names this concept below its head (IsA(Series()) is found from Series). */
  factsNaming(concept: string): FactItem[] {
    return (this.factsByNamed.get(concept) ?? []).filter((f) => f.meta.status !== "Retracted");
  }

  readingsOn(owner: string): ReadingItem[] {
    return (this.readingsByOwner.get(owner) ?? []).filter((r) => r.meta.status !== "Retracted");
  }

  /** Readings whose pattern has this head; "" for patterns that are a bare variable. */
  readingsFor(head: string): ReadingItem[] {
    return (this.readingsByPatternHead.get(head) ?? []).filter((r) => r.meta.status !== "Retracted");
  }

  block(id: string): BlockItem | undefined {
    return this.blocks.get(id);
  }

  packList() {
    return [...this.packs];
  }

  /** The kinds of a concept by IsA, transitively, with their distance (ncon.md section 3.1). */
  kinds(concept: string): Map<string, number> {
    const out = new Map<string, number>([[concept, 0]]);
    let frontier = [concept];
    for (let d = 1; frontier.length && d < 16; d++) {
      const next: string[] = [];
      for (const x of frontier)
        for (const f of this.facts(x, "IsA")) {
          const k = positional(f.claim as Call)[0];
          if (isCall(k) && !out.has(k.head)) {
            out.set(k.head, d);
            next.push(k.head);
          }
        }
      frontier = next;
    }
    return out;
  }

  /** Kind distance through the nearest common ancestor, or undefined if none. */
  kindDistance(a: string, b2: string): number | undefined {
    const ka = this.kinds(a);
    const kb = this.kinds(b2);
    let best: number | undefined;
    for (const [k, da] of ka) {
      const db = kb.get(k);
      if (db !== undefined && (best === undefined || da + db < best)) best = da + db;
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Export

  /** Every item as one `.ncon` text, in id order (ncon-format.md section 6, rule 3). */
  export(): string {
    const rows = this.db.prepare("SELECT text FROM items ORDER BY id").all() as { text: string }[];
    const file: NconFile = { forms: rows.map((r) => parse(r.text).forms[0]) };
    return format(file);
  }

  close() {
    this.db.close();
  }
}

/** One item as its own top-level form, with its meta written out. */
export function toForm(item: FactItem | ReadingItem | BlockItem): Call {
  const meta: [string, Expr][] = [["from", item.meta.from]];
  if (item.meta.at) meta.push(["at", s(item.meta.at)]);
  if (item.meta.status !== "Active") meta.push(["status", c(item.meta.status)]);
  if (item.meta.weight !== undefined) meta.push(["weight", { kind: "number", value: item.meta.weight, pos: { line: 0, column: 0 } }]);
  if (item.kind === "fact") {
    const extra: [string, Expr][] = [];
    if (item.inSense) extra.push(["inSense", c(item.inSense)]);
    if (item.holds) extra.push(["holds", item.holds]);
    return c("Fact", c(item.subject), item.claim, ...extra, ...meta);
  }
  if (item.kind === "block") return c("Block", ["id", s(item.id)], ["media", s(item.media)], ["body", s(item.body)], ...meta);
  const parts: [string, Expr][] = [["on", c(item.owner)], ["pattern", item.pattern]];
  const many = (name: string, xs: Expr[]) => {
    if (xs.length === 1) parts.push([name, xs[0]]);
    else if (xs.length > 1) parts.push([name, c("All", ...xs)]);
  };
  many("wants", item.wants);
  if (item.becomes) parts.push(["becomes", item.becomes]);
  many("needs", item.needs);
  many("effects", item.effects);
  many("checks", item.checks);
  if (item.mode) parts.push(["mode", c(item.mode)]);
  if (item.direction === "Collapse") parts.push(["direction", c("Collapse")]);
  return c("Reading", ...parts, ...meta);
}

function push<K, T>(m: Map<K, T[]>, k: K, v: T) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function namedArg(form: Call, name: string): Expr | undefined {
  return form.args.find((a) => a.name === name)?.value;
}

function stringArg(form: Call, name: string): string | undefined {
  const e = namedArg(form, name);
  return e?.kind === "string" ? e.value : undefined;
}

function numberArg(form: Call, name: string): number | undefined {
  const e = namedArg(form, name);
  return e?.kind === "number" ? e.value : undefined;
}

export { META_NAMES, READING_PARTS, key, role };
