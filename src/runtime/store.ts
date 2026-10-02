// The store (ncon.md section 9): concepts, facts, readings and content blocks with their meta, in
// SQLite, indexed by lemma, by fact head, by the concepts a claim names, and by pattern head.
// `.ncon` files are its text form: load a pack, export the store, and the text round-trips.
//
// SQLite is the store, not a copy of it: lookups are queries, with a cache in front, and nothing is
// loaded up front. A pack is imported once and kept with its hash; loading it again with the same
// text does nothing, and with new text replaces its items. What is learned at runtime (facts,
// taught readings, Know's answers) goes into the same database. `new Store()` is in memory, for
// tests; `new Store(path)` is durable.

import { DatabaseSync, type StatementSync } from "node:sqlite";
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
  /** The lemma or form as written, case kept ("WHO", "Ada"). */
  text: string;
}


type Item = FactItem | ReadingItem | BlockItem;

/** Expressions as JSON, without the parse positions (only parse errors use them). */
const toJson = (item: Item) => JSON.stringify(item, (k, v) => (k === "pos" ? undefined : v));
const fromJson = (text: string) => JSON.parse(text) as Item;

export class Store {
  private db: DatabaseSync;
  private q: Record<string, StatementSync> = {};
  private cache = {
    bySubject: new Map<string, FactItem[]>(),
    byHead: new Map<string, FactItem[]>(),
    byNamed: new Map<string, FactItem[]>(),
    byOwner: new Map<string, ReadingItem[]>(),
    byPatternHead: new Map<string, ReadingItem[]>(),
    lemmas: new Map<string, LemmaHit[]>(),
    blocks: new Map<string, BlockItem | null>(),
    has: new Map<string, boolean>(),
    kinds: new Map<string, Map<string, number>>(),
  };
  private lemmaList?: string[];

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL, head TEXT, pack TEXT, status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS items_owner ON items(kind, owner);
      CREATE INDEX IF NOT EXISTS items_head ON items(kind, head);
      CREATE INDEX IF NOT EXISTS items_pack ON items(pack);
      CREATE TABLE IF NOT EXISTS named (concept TEXT NOT NULL, item INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS named_concept ON named(concept);
      CREATE TABLE IF NOT EXISTS lemmas (lower TEXT NOT NULL, text TEXT NOT NULL, concept TEXT NOT NULL, features TEXT NOT NULL, item INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS lemmas_lower ON lemmas(lower);
      CREATE TABLE IF NOT EXISTS concepts (name TEXT PRIMARY KEY, pack TEXT);
      CREATE TABLE IF NOT EXISTS packs (name TEXT PRIMARY KEY, version TEXT, hash TEXT);
    `);
    const sql = {
      insert: "INSERT INTO items (kind, owner, head, pack, status, json) VALUES (?, ?, ?, ?, ?, ?)",
      named: "INSERT INTO named VALUES (?, ?)",
      lemma: "INSERT INTO lemmas VALUES (?, ?, ?, ?, ?)",
      concept: "INSERT OR IGNORE INTO concepts VALUES (?, ?)",
      bySubject: "SELECT id, json FROM items WHERE kind = 'fact' AND owner = ? AND status != 'Retracted' ORDER BY id",
      byHead: "SELECT id, json FROM items WHERE kind = 'fact' AND head = ? AND status != 'Retracted' ORDER BY id",
      byNamed: "SELECT i.id, i.json FROM named n JOIN items i ON i.id = n.item WHERE n.concept = ? AND i.status != 'Retracted' ORDER BY i.id",
      byOwner: "SELECT id, json FROM items WHERE kind = 'reading' AND owner = ? AND status != 'Retracted' ORDER BY id",
      byPatternHead: "SELECT id, json FROM items WHERE kind = 'reading' AND head = ? AND status != 'Retracted' ORDER BY id",
      lemmas: "SELECT text, concept, features FROM lemmas WHERE lower = ? ORDER BY item",
      lemmaTexts: "SELECT DISTINCT lower FROM lemmas",
      block: "SELECT id, json FROM items WHERE kind = 'block' AND owner = ?",
      has: "SELECT 1 AS x FROM concepts WHERE name = ? UNION ALL SELECT 1 FROM items WHERE owner = ? LIMIT 1",
      pack: "SELECT hash FROM packs WHERE name = ?",
      setPack: "INSERT OR REPLACE INTO packs VALUES (?, ?, ?)",
      dropPack: "DELETE FROM items WHERE pack = ?",
      dropNamed: "DELETE FROM named WHERE item NOT IN (SELECT id FROM items)",
      dropLemmas: "DELETE FROM lemmas WHERE item NOT IN (SELECT id FROM items)",
      dropConcepts: "DELETE FROM concepts WHERE pack = ?",
    };
    for (const [k, v] of Object.entries(sql)) this.q[k] = this.db.prepare(v);
  }

  private rows<T extends Item>(stmt: string, arg: string): T[] {
    return (this.q[stmt].all(arg) as { id: number; json: string }[]).map((r) => {
      const item = fromJson(r.json) as T;
      item.meta.id = r.id;
      return item;
    });
  }

  private clearCaches() {
    for (const m of Object.values(this.cache)) m.clear();
    this.lemmaList = undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Loading

  /**
   * Loads a `.ncon` file atomically (ncon-format.md section 6, rule 4). A file with a Pack header
   * is that pack: already here with the same text, nothing happens; here with other text, its old
   * items are replaced. Returns the number of items written.
   */
  load(text: string): number {
    const hash = createHash("sha256").update(text).digest("hex");
    const name = /^\s*(?:\/\/[^\n]*\n\s*)*Pack\(\s*name\s*=\s*"([^"]*)"/.exec(text)?.[1];
    if (name && (this.q.pack.get(name) as { hash: string } | undefined)?.hash === hash) return 0;
    const file = parse(text);
    const pack = file.forms[0]?.head === "Pack" ? file.forms[0] : undefined;
    const packFrom = pack ? namedArg(pack, "from") : undefined;
    const packName = pack ? stringArg(pack, "name") : undefined;
    const forms = file.forms.filter((f) => f.head !== "Pack");
    // Validate everything before anything is written.
    const items = forms.map((f) => ({ form: f, items: this.toItem(f, packFrom, packName) }));
    this.db.exec("BEGIN");
    try {
      if (packName) {
        this.q.dropPack.run(packName);
        this.q.dropConcepts.run(packName);
        this.q.dropNamed.run();
        this.q.dropLemmas.run();
      }
      let n = 0;
      for (const { form, items: its } of items) {
        if (form.head === "Concept" || form.head === "Fact") this.q.concept.run((form.args[0].value as Call).head, packName ?? null);
        for (const item of its) {
          this.write(item);
          n++;
        }
      }
      if (packName) this.q.setPack.run(packName, stringArg(pack!, "version") ?? "", hash);
      this.db.exec("COMMIT");
      this.clearCaches();
      return n;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Writes one item and its index rows; sets its id. */
  private write(item: Item): Item {
    const owner = item.kind === "fact" ? item.subject : item.kind === "reading" ? item.owner : item.id;
    const head = item.kind === "fact" && isCall(item.claim) ? item.claim.head : item.kind === "reading" ? (isCall(item.pattern) ? item.pattern.head : "") : null;
    const r = this.q.insert.run(item.kind, owner, head, item.meta.pack ?? null, item.meta.status, toJson(item));
    item.meta.id = Number(r.lastInsertRowid);
    if (item.kind === "reading") this.q.concept.run(item.owner, item.meta.pack ?? null);
    if (item.kind === "fact" && isCall(item.claim)) {
      for (const h of heads(item.claim)) if (h !== item.claim.head) this.q.named.run(h, item.meta.id);
      // Lookup is by lemma, never by name (ncon.md section 2.1).
      if (item.claim.head === "Lemma" || item.claim.head === "Form") {
        const text = positional(item.claim)[0];
        if (text?.kind === "string") {
          const features = positional(item.claim).flatMap((x, i) => (i > 0 && isCall(x) ? [x.head] : []));
          this.q.lemma.run(text.value.toLowerCase(), text.value, item.subject, JSON.stringify(features), item.meta.id);
        }
      }
    }
    return item;
  }

  /** A runtime addition: written, and the caches it touches dropped. */
  private add<T extends Item>(item: T): T {
    this.write(item);
    if (item.kind === "fact") {
      this.cache.bySubject.delete(item.subject);
      this.cache.has.delete(item.subject);
      this.cache.kinds.clear();
      if (isCall(item.claim)) {
        this.cache.byHead.delete(item.claim.head);
        for (const h of heads(item.claim)) this.cache.byNamed.delete(h);
        if (item.claim.head === "Lemma" || item.claim.head === "Form") {
          const t = positional(item.claim)[0];
          if (t?.kind === "string") this.cache.lemmas.delete(t.value.toLowerCase());
          this.lemmaList = undefined;
        }
      }
    } else if (item.kind === "reading") {
      this.cache.byOwner.delete(item.owner);
      this.cache.byPatternHead.delete(isCall(item.pattern) ? item.pattern.head : "");
      this.cache.has.delete(item.owner);
    } else this.cache.blocks.delete(item.id);
    return item;
  }

  /** Adds one fact, at runtime (a learned fact, a state, a correction). */
  addFact(subject: string, claim: Expr, from: Expr, extra: Partial<Omit<Meta, "id" | "from">> = {}): FactItem {
    return this.add<FactItem>({ kind: "fact", subject, claim, meta: { id: 0, from, status: extra.status ?? "Active", weight: extra.weight, pack: extra.pack, at: extra.at } });
  }

  /**
   * Retracts a fact (ncon.md: status Retracted). Nothing is deleted: the item stays in the store,
   * with its source, and is no longer returned; storing it again brings the claim back.
   */
  retract(f: FactItem) {
    this.db.prepare("UPDATE items SET status = 'Retracted', json = ? WHERE id = ?").run(toJson({ ...f, meta: { ...f.meta, status: "Retracted" } }), f.meta.id);
    this.clearCaches();
  }

  /** Adds one reading at runtime (a rewrite the user taught, design section 17). */
  addReading(r: Omit<ReadingItem, "kind" | "meta">, from: Expr, status: Status = "Active"): ReadingItem {
    return this.add<ReadingItem>({ kind: "reading", ...r, meta: { id: 0, from, status } });
  }

  /** Keeps a content block; identical content is one block (ncon.md section 6). */
  addBlock(body: string, media: string, from: Expr): BlockItem {
    const id = "b_" + createHash("sha256").update(body).digest("hex").slice(0, 16);
    return this.block(id) ?? this.add<BlockItem>({ kind: "block", id, media, body, meta: { id: 0, from, status: "Active" } });
  }

  private toItem(form: Call, packFrom: Expr | undefined, pack: string | undefined): Item[] {
    const from = namedArg(form, "from") ?? packFrom;
    if (!from) throw new NconError("an item needs a source: give it from= or a Pack with from=", form.pos, form.head);
    const statusArg = namedArg(form, "status");
    const meta: Meta = {
      id: 0,
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

  // -------------------------------------------------------------------------------------------
  // Reading

  private cached<T>(m: Map<string, T>, k: string, f: () => T): T {
    let v = m.get(k);
    if (v === undefined) {
      v = f();
      m.set(k, v);
    }
    return v;
  }

  has(concept: string): boolean {
    return this.cached(this.cache.has, concept, () => this.q.has.get(concept, concept) !== undefined);
  }

  /** Concepts a token's lowercased text is a lemma or form of. */
  lookup(text: string): LemmaHit[] {
    const lower = text.toLowerCase();
    return this.cached(this.cache.lemmas, lower, () =>
      (this.q.lemmas.all(lower) as { text: string; concept: string; features: string }[]).map((r) => ({ concept: r.concept, features: JSON.parse(r.features) as string[], text: r.text })),
    );
  }

  /** Every lemma and form text, for spelling candidates (read once, then kept). */
  lemmaTexts(): IterableIterator<string> {
    if (!this.lemmaList) this.lemmaList = (this.q.lemmaTexts.all() as { lower: string }[]).map((r) => r.lower);
    return this.lemmaList[Symbol.iterator]();
  }

  facts(subject: string, head?: string): FactItem[] {
    const all = this.cached(this.cache.bySubject, subject, () => this.rows<FactItem>("bySubject", subject));
    return head ? all.filter((f) => isHead(f.claim, head)) : all;
  }

  factsWithHead(head: string): FactItem[] {
    return this.cached(this.cache.byHead, head, () => this.rows<FactItem>("byHead", head));
  }

  /** Facts whose claim names this concept below its head (IsA(Series()) is found from Series). */
  factsNaming(concept: string): FactItem[] {
    return this.cached(this.cache.byNamed, concept, () => this.rows<FactItem>("byNamed", concept));
  }

  readingsOn(owner: string): ReadingItem[] {
    return this.cached(this.cache.byOwner, owner, () => this.rows<ReadingItem>("byOwner", owner));
  }

  /** Readings whose pattern has this head; "" for patterns that are a bare variable. */
  readingsFor(head: string): ReadingItem[] {
    return this.cached(this.cache.byPatternHead, head, () => this.rows<ReadingItem>("byPatternHead", head));
  }

  block(id: string): BlockItem | undefined {
    const b = this.cached(this.cache.blocks, id, () => this.rows<BlockItem>("block", id)[0] ?? null);
    return b ?? undefined;
  }

  packList(): { name: string; version: string; hash: string }[] {
    return this.db.prepare("SELECT name, version, hash FROM packs").all() as { name: string; version: string; hash: string }[];
  }

  /**
   * The kinds of a concept by IsA, transitively, with their distance (ncon.md section 3.1). A word
   * is what its senses are, so a word's kinds are its senses' kinds; and a broader sense is a kind
   * of each word it is a sense of ("shopping list" is a list: its sense's broader sense is a sense
   * of "list"). Sense and SenseOf cost nothing; only IsA is a step. A word's own senses do not lead
   * to their other words (synonyms are not kinds), and a word reached that way does not lead to
   * its other senses (other meanings of it, not kinds of this one). Given a chart category, only
   * senses whose part of speech is read as that category are followed (a thing is what its noun
   * senses are, not what "list" means as a verb).
   */
  kinds(concept: string, category?: string): Map<string, number> {
    const memoKey = category ? `${concept}|${category}` : concept;
    const memo = this.cache.kinds.get(memoKey);
    if (memo) return memo;
    const ofCategory = (sense: string) =>
      !category ||
      this.facts(sense, "PartOfSpeech").some((f) => {
        const pos = positional(f.claim as Call)[0];
        return isCall(pos) && this.readingsOn(pos.head).some((r) => isHead(r.becomes, "Category") && isHead(positional(r.becomes)[0], category));
      });
    const out = new Map<string, number>([[concept, 0]]);
    // How a concept was reached: as a sense of a word, as a word of a broader sense, or by IsA.
    const how = new Map<string, "sense" | "word" | "isa">([[concept, "isa"]]);
    let frontier = [concept];
    const reach = (head: string, d: number, next: string[], by: "sense" | "word" | "isa") => {
      if (out.has(head)) return;
      out.set(head, d);
      how.set(head, by);
      next.push(head);
    };
    for (let d = 0; frontier.length && d < 16; d++) {
      // The steps that cost nothing first, within this distance.
      for (let i = 0; i < frontier.length; i++) {
        const x = frontier[i];
        const by = how.get(x);
        if (by !== "word")
          for (const f of this.facts(x, "Sense")) {
            const k = positional(f.claim as Call)[0];
            if (isCall(k) && ofCategory(k.head)) reach(k.head, d, frontier, "sense");
          }
        if (by === "isa" && x !== concept)
          for (const f of this.facts(x, "SenseOf")) {
            const k = positional(f.claim as Call)[0];
            if (isCall(k)) reach(k.head, d, frontier, "word");
          }
      }
      const next: string[] = [];
      for (const x of frontier)
        for (const f of this.facts(x, "IsA")) {
          const k = positional(f.claim as Call)[0];
          if (isCall(k)) reach(k.head, d + 1, next, "isa");
        }
      frontier = next;
    }
    this.cache.kinds.set(memoKey, out);
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
    const items = (this.db.prepare("SELECT id, json FROM items ORDER BY id").all() as { id: number; json: string }[]).map((r) => fromJson(r.json));
    return format({ forms: items.map(toForm) } as NconFile);
  }

  close() {
    this.db.close();
  }
}

const readingKeys = new WeakMap<ReadingItem, string>();

/**
 * A reading's identity across stores and sessions: a hash of what it says (owner, pattern,
 * becomes), not its store id, which depends on load order. Learned weights are kept by it.
 */
export function readingKey(r: ReadingItem): string {
  let k = readingKeys.get(r);
  if (!k) {
    k = createHash("sha256").update(`${r.owner}|${key(r.pattern)}|${r.becomes ? key(r.becomes) : ""}|${r.mode ?? ""}`).digest("hex").slice(0, 12);
    readingKeys.set(r, k);
  }
  return k;
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

export { key, role };
