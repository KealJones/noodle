// Know's source adapters (design section 21; runtime.md section 14): the code that reaches a live
// source and turns what it returns into text and structure. Fetch lives here and only here: cached
// per URL, throttled per host, one user agent, a time limit. Every adapter declares SendsOutside,
// since the query leaves the machine. What comes back is content (kept as a block, with its source
// and trust level 4, the web), never meaning decided by a string.

export interface Found {
  /** The source's own words, to keep as a content block. */
  text: string;
  title: string;
  url: string;
  /** Which source: a concept name with a trust level in the trust table. */
  source: "Wikipedia" | "Wiktionary" | "Wikidata" | "Web";
  /** The Wikidata entity the page is about, where the source says. */
  entity?: string;
}

/** A Wikidata claim on an entity: the property's label and the value's, as the source gives them. */
export interface Claim {
  property: string;
  value: string | number;
  /** The unit a quantity is in, by its label. */
  unit?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const AGENT = "Noodle/0.20 (a research assistant without a language model; https://github.com/kealjones)";
const TIMEOUT_MS = 8000;
const SPACING_MS = 250;
const cache = new Map<string, Promise<string | undefined>>();
const lastByHost = new Map<string, number>();

async function get(url: string, accept = "application/json"): Promise<string | undefined> {
  const have = cache.get(url);
  if (have) return have;
  const p = (async () => {
    const host = new URL(url).host;
    const wait = (lastByHost.get(host) ?? 0) + SPACING_MS - performance.timeOrigin - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastByHost.set(host, performance.timeOrigin + performance.now());
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers: { "user-agent": AGENT, accept }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        if (!res.ok) return undefined;
        return await res.text();
      } catch {
        if (attempt === 1) return undefined;
      }
    }
    return undefined;
  })();
  cache.set(url, p);
  return p;
}

async function json(url: string): Promise<any> {
  const t = await get(url);
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text from HTML: scripts, styles and tags dropped, entities decoded, whitespace collapsed. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

async function summary(key: string): Promise<Found | undefined> {
  const sum = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`);
  if (!sum?.extract || sum.type === "disambiguation") return undefined;
  return { text: String(sum.extract).trim(), title: sum.title, url: sum.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${key}`, source: "Wikipedia", entity: typeof sum.wikibase_item === "string" ? sum.wikibase_item : undefined };
}

/** Wikipedia's page about a topic: by its title, then the best title match. */
export async function wikipediaTopic(topic: string): Promise<Found | undefined> {
  const direct = await summary(topic.replace(/\s+/g, "_"));
  if (direct) return direct;
  const t = await json(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(topic)}&limit=3`);
  for (const p of t?.pages ?? []) {
    const f = await summary(p.key);
    if (f) return f;
  }
  return undefined;
}

/** Wikipedia's full-text search for a question, then the top page's summary. */
export async function wikipedia(query: string): Promise<Found | undefined> {
  const s = await json(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`);
  for (const p of s?.pages ?? []) {
    const f = await summary(p.key);
    if (f) return f;
  }
  return undefined;
}

/** Wiktionary's English definitions of a word. */
export async function wiktionary(word: string): Promise<Found | undefined> {
  const d = await json(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  const en = d?.en as { partOfSpeech: string; definitions: { definition: string }[] }[] | undefined;
  if (!en?.length) return undefined;
  const lines = en.slice(0, 3).flatMap((p) => p.definitions.slice(0, 2).map((x) => `(${p.partOfSpeech.toLowerCase()}) ${htmlText(x.definition)}`)).filter((x) => x.length > 4);
  if (!lines.length) return undefined;
  return { text: lines.join("\n"), title: word, url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`, source: "Wiktionary" };
}

/** Wikidata's label and description of the best matching entity. */
export async function wikidata(query: string): Promise<Found | undefined> {
  const s = await json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=1`);
  const e = s?.search?.[0];
  if (!e?.description) return undefined;
  return { text: `${e.label}: ${e.description}`, title: e.label, url: `https://www.wikidata.org/wiki/${e.id}`, source: "Wikidata", entity: e.id };
}

/** English labels of Wikidata entities and properties, fifty at a time. */
async function labels(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join("|")}&props=labels&languages=en&format=json`);
    for (const [id, e] of Object.entries<any>(d?.entities ?? {})) if (e?.labels?.en?.value) out.set(id, e.labels.en.value);
  }
  return out;
}

/** Wikidata's datatypes for a claim about the thing itself (not an identifier, a file or a link). */
const CLAIM_TYPES = new Set(["wikibase-item", "quantity", "time"]);

/**
 * An entity's claims, labelled: for each property whose value is another entity, a quantity or a
 * time, its best value (preferred rank, else the first). Identifiers, media and links are left
 * out: they are references to other sites, not claims about the thing.
 */
export async function wikidataClaims(id: string, max = 120): Promise<Claim[]> {
  const d = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=claims&format=json`);
  const claims = d?.entities?.[id]?.claims as Record<string, any[]> | undefined;
  if (!claims) return [];
  const raw: { property: string; value: any; type: string }[] = [];
  for (const [prop, list] of Object.entries(claims)) {
    const best = list.find((x) => x.rank === "preferred") ?? list.find((x) => x.rank !== "deprecated");
    const snak = best?.mainsnak;
    if (snak?.snaktype !== "value" || !CLAIM_TYPES.has(snak.datatype)) continue;
    raw.push({ property: prop, value: snak.datavalue?.value, type: snak.datatype });
    if (raw.length >= max) break;
  }
  const unitOf = (x: any) => (typeof x?.unit === "string" && x.unit.includes("/entity/") ? x.unit.split("/entity/")[1] : undefined);
  const ids = new Set<string>();
  for (const r of raw) {
    ids.add(r.property);
    if (r.type === "wikibase-item" && r.value?.id) ids.add(r.value.id);
    const u = unitOf(r.value);
    if (u) ids.add(u);
  }
  const names = await labels([...ids]);
  const out: Claim[] = [];
  for (const r of raw) {
    const property = names.get(r.property);
    if (!property) continue;
    if (r.type === "wikibase-item") {
      const label = names.get(r.value?.id);
      if (label) out.push({ property, value: label });
    } else if (r.type === "quantity") {
      const amount = Number(r.value?.amount);
      const u = unitOf(r.value);
      if (Number.isFinite(amount)) out.push({ property, value: amount, unit: u ? names.get(u) : undefined });
    } else {
      // A time, to the precision the source gives (9 a year, 10 a month, 11 a day).
      const m = /^([+-]\d+)-(\d\d)-(\d\d)/.exec(String(r.value?.time ?? ""));
      if (!m) continue;
      const year = String(Number(m[1]));
      const p = Number(r.value?.precision ?? 11);
      out.push({ property, value: p >= 11 ? `${year}-${m[2]}-${m[3]}` : p === 10 ? `${year}-${m[2]}` : year });
    }
  }
  return out;
}

/** A general web search (DuckDuckGo's HTML results). */
export async function webSearch(query: string): Promise<SearchResult[]> {
  const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, "text/html");
  if (!html) return [];
  const out: SearchResult[] = [];
  for (const block of html.split('class="result__body"').slice(1)) {
    const a = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const snip = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, "&");
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;
    out.push({ title: htmlText(a[2]), url, snippet: snip ? htmlText(snip[1]) : "" });
    if (out.length >= 5) break;
  }
  return out;
}

/** Any page by its URL, as text, with its title. */
export async function page(url: string): Promise<Found | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const body = await get(url, "text/html, text/plain, application/json;q=0.9, */*;q=0.5");
  if (body === undefined) return undefined;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
  const text = /<html|<body|<div|<p[\s>]/i.test(body) ? htmlText(body) : body;
  return { text, title: title ? htmlText(title) : url, url, source: "Web" };
}
