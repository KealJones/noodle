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
  source: "Wikipedia" | "Wiktionary" | "Wikidata" | "Web" | "ChatGPT";
  /** What its words are written in, where not plain text ("text/markdown"). */
  media?: string;
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

/** A part of a page under one heading: what it says, its lists and tables, its links and forms. */
export interface PagePart {
  heading: string;
  level: number;
  /** The heading's id, where the page gives one (a link to the part). */
  anchor?: string;
  paragraphs: string[];
  items: string[];
  rows: string[][];
  links: { text: string; to: string }[];
  forms: { to: string; method: string; fields: string[] }[];
}

export interface PageDoc {
  title: string;
  parts: PagePart[];
}

/**
 * An HTML page read into structure, as a manual page is (design section 21): its title, and its
 * parts under each heading, with their paragraphs, list items, table rows, links (made absolute
 * against the page's address) and forms (where they send, how, and the fields they ask for).
 * What comes before the first heading is a part with no heading. Scripts and styles are left out.
 */
export function readHtml(html: string, base: string): PageDoc {
  const title = htmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const body = html
    .replace(/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // A reference mark ("[1]") is a pointer to a note, not what the paragraph says.
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, "");
  const parts: PagePart[] = [];
  const fresh = (heading: string, level: number, anchor?: string): PagePart => ({ heading, level, anchor, paragraphs: [], items: [], rows: [], links: [], forms: [] });
  let part = fresh("", 0);
  parts.push(part);
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs)?.slice(2).find((x) => x !== undefined);
  const abs = (href: string) => {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  };
  // What is being gathered: the block element's text (a heading, a paragraph, an item, a cell),
  // the link's, the row's cells, the form's fields.
  let block: { tag: string; text: string; anchor?: string } | undefined;
  let link: { to: string; text: string } | undefined;
  let row: string[] | undefined;
  let form: PagePart["forms"][number] | undefined;
  const clean = (x: string) => htmlText(x).replace(/\s+/g, " ").trim();
  const BLOCKS = /^(h[1-6]|p|li|td|th|dt|dd|figcaption|blockquote|pre)$/;
  const close = () => {
    if (!block) return;
    const text = clean(block.text);
    const tag = block.tag;
    const anchor = block.anchor;
    block = undefined;
    if (/^h[1-6]$/.test(tag)) {
      part = fresh(text, Number(tag[1]), anchor);
      parts.push(part);
    } else if (!text) return;
    else if (tag === "li" || tag === "dt" || tag === "dd") part.items.push(text);
    else if (tag === "td" || tag === "th") row?.push(text);
    else part.paragraphs.push(text);
  };
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g)) {
    const [, slash, rawTag, attrs = "", text] = m;
    if (text !== undefined) {
      if (block) block.text += text;
      if (link) link.text += text;
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (BLOCKS.test(tag)) {
      if (!slash) {
        close();
        block = { tag, text: "", anchor: attr(attrs, "id") };
      } else if (block?.tag === tag) close();
    } else if (tag === "br" && block) block.text += "\n";
    else if (tag === "a") {
      if (!slash) link = { to: attr(attrs, "href") ?? "", text: "" };
      else if (link) {
        const t = clean(link.text);
        if (t && link.to && !link.to.startsWith("#") && !/^javascript:/i.test(link.to)) part.links.push({ text: t, to: abs(link.to) });
        link = undefined;
      }
    } else if (tag === "tr") {
      if (!slash) row = [];
      else if (row) {
        close();
        if (row.length) part.rows.push(row);
        row = undefined;
      }
    } else if (tag === "form") {
      if (!slash) {
        form = { to: abs(attr(attrs, "action") ?? base), method: (attr(attrs, "method") ?? "get").toUpperCase(), fields: [] };
        part.forms.push(form);
      } else form = undefined;
    } else if (form && !slash && /^(input|select|textarea|button)$/.test(tag)) {
      const name = attr(attrs, "name") ?? attr(attrs, "aria-label") ?? attr(attrs, "type");
      if (name) form.fields.push(name);
    }
  }
  close();
  return { title, parts: parts.filter((p) => p.heading || p.paragraphs.length || p.items.length || p.rows.length || p.links.length || p.forms.length) };
}

/** A page by its address, read into structure; for Wikipedia, its whole article (not the summary). */
export async function pageDoc(url: string): Promise<PageDoc | undefined> {
  const wiki = /^https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/.exec(url);
  const at = wiki ? `https://en.wikipedia.org/api/rest_v1/page/html/${wiki[1]}` : url;
  if (!/^https?:\/\//i.test(at)) return undefined;
  const html = await get(at, "text/html");
  return html && /<html|<body|<p[\s>]|<h[1-6][\s>]/i.test(html) ? readHtml(html, url) : undefined;
}

/**
 * ChatGPT through gptb's local server (`gptb serve`, an OpenAI-compatible endpoint on this
 * machine), for when the one-shot command cannot reach the browser because the server holds it.
 * Only localhost is asked; what comes back is the reply's text.
 */
/** ChatGPT through gptb serve: one question, or a whole chat (messages that extend one it has seen continue it). */
export async function chatgptServer(question: string | { role: string; content: string }[], port = 7778, timeoutMs = 120000): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "chatgpt", stream: false, messages: typeof question === "string" ? [{ role: "user", content: question }] : question }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    const d: any = await res.json();
    const text = d?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}
