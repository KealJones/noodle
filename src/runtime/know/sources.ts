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
  return { text: String(sum.extract).trim(), title: sum.title, url: sum.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${key}`, source: "Wikipedia" };
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
  return { text: `${e.label}: ${e.description}`, title: e.label, url: `https://www.wikidata.org/wiki/${e.id}`, source: "Wikidata" };
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
