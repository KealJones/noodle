// Learning an HTTP API from its published description (OpenAPI 3; design sections 20, 21 and 25).
// A service's description is its documentation, as a man page is a tool's: each operation becomes
// a concept whose summary and description are kept, its summary understood by Noodle's own
// pipeline (as a man page's NAME line is, tooldocs.ts), and whose parameters (in the path, the
// query and the request body) are roles of it, each with what its description says fills it.
//
// Each operation gets readings that reach Run of the program that speaks to the API, a command
// line built from the operation: the method, the path with its parameters filled, and the body's
// fields. Which program that is, and how it is told the method and the fields, is configured when
// the description is imported (the user's own say, level 1), never written per operation or per
// service in code. Path placeholders the program fills itself (gh api fills {owner} and {repo}
// from the workspace's git remote) are configured the same way; any other placeholder is a
// variable the request must fill, so an operation whose parameters nothing said stays unworked
// and says so, never guessed (design section 23).
//
// A reading's pattern is the operation's summary as understood: its act, and the kind of thing it
// is done to, so a request heard the same way ("submit my review" and "Submit a review for a pull
// request" reduce alike) reaches it. What the operation changes comes from its HTTP method: GET
// only reads, but reads from a service elsewhere (Reads and SendsOutside); POST, PUT and PATCH change what others see (Publishes); DELETE
// deletes. The claim is the description's, level 3 at best (design section 20): Run can hold none
// of these (holding to reading denies the network a GET needs), so every operation is offered
// before it runs, and nothing the description says grants anything.
//
// Nothing here knows any service: the same code reads any OpenAPI 3 description.

import { createHash } from "node:crypto";
import { type Call, type Expr, c, isCall, isHead, positional, s, v } from "../runtime/expr.js";
import { Chart } from "../runtime/chart.js";
import { hear } from "../runtime/hear.js";
import { Rewriter } from "../runtime/rewrite.js";
import { Weights } from "../runtime/score.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";
import { summaryReader } from "./tooldocs.js";

/** How the program that speaks to the API is told what to do (configured at import). */
export interface ApiCli {
  /** The program and its leading arguments: ["gh", "api"]. */
  command: string[];
  /** The option that takes the HTTP method: "-X". */
  method: string;
  /** The option that takes a string field, key=value: "-f". */
  field: string;
  /** The option that takes a typed field (a number, a boolean), key=value: "-F". Defaults to field. */
  typedField?: string;
  /** Path placeholders the program fills on its own: ["owner", "repo"]. */
  fills?: string[];
}

export interface OpenApiResult {
  text: string;
  operations: number;
  understood: number;
  readings: number;
  parameters: number;
  skipped: string[];
}

type Json = Record<string, unknown>;
const METHODS = ["get", "put", "post", "delete", "patch"] as const;

const isObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

/** Follows a local reference ("#/components/schemas/x") to what it names. */
function deref(doc: Json, x: unknown, depth = 0): Json | undefined {
  if (!isObj(x)) return undefined;
  const ref = x.$ref;
  if (typeof ref !== "string" || depth > 20) return x;
  if (!ref.startsWith("#/")) return undefined;
  let at: unknown = doc;
  for (const part of ref.slice(2).split("/")) at = isObj(at) ? at[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  return deref(doc, at, depth + 1);
}

interface Param {
  name: string;
  in: "path" | "query" | "body";
  required: boolean;
  type?: string;
  enum?: string[];
  description?: string;
}

function schemaType(doc: Json, schema: unknown): { type?: string; enum?: string[] } {
  const sc = deref(doc, schema);
  if (!sc) return {};
  const t = Array.isArray(sc.type) ? sc.type.find((x) => x !== "null") : sc.type;
  const en = Array.isArray(sc.enum) ? sc.enum.filter((x): x is string => typeof x === "string") : undefined;
  return { type: typeof t === "string" ? t : undefined, enum: en?.length ? en : undefined };
}

function parametersOf(doc: Json, pathItem: Json, op: Json): Param[] {
  const out: Param[] = [];
  const seen = new Set<string>();
  // An operation's own parameters override the path's of the same name and place.
  for (const raw of [...(Array.isArray(op.parameters) ? op.parameters : []), ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : [])]) {
    const p = deref(doc, raw);
    if (!p || typeof p.name !== "string" || (p.in !== "path" && p.in !== "query")) continue;
    const k = `${p.in}:${p.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: p.name, in: p.in, required: p.in === "path" || p.required === true, ...schemaType(doc, p.schema), description: typeof p.description === "string" ? p.description : undefined });
  }
  const body = deref(doc, op.requestBody);
  const content = isObj(body?.content) ? body.content : undefined;
  const json = content && deref(doc, (content["application/json"] as Json | undefined)?.schema);
  if (json && isObj(json.properties)) {
    const required = new Set(Array.isArray(json.required) ? json.required : []);
    for (const [name, raw] of Object.entries(json.properties)) {
      const sc = deref(doc, raw);
      out.push({ name, in: "body", required: required.has(name), ...schemaType(doc, raw), description: typeof sc?.description === "string" ? sc.description : undefined });
    }
  }
  return out;
}

/** The first sentence of a description, without markup: what it says the thing is. */
function firstSentence(text: string): string {
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(.*?[.!?])(\s|$)/.exec(plain);
  return (m ? m[1] : plain).replace(/[.!?]$/, "");
}

/**
 * Understands a phrase that names a thing ("The number that identifies the pull request") over a
 * store of words, the way summaryReader understands an act: heard, charted, and the best entry
 * that is a thing and spans it all is what it means. Undefined where nothing spans it.
 */
export function phraseReader(words: Store): (text: string) => Expr | undefined {
  const weights = new Weights(words);
  return (text) => {
    const h = hear(words, text, { names: [] });
    if (!h.tokens.length) return undefined;
    const chart = new Chart(words, h, 0, h.tokens.length, weights.get).build();
    const best = chart
      .edges()
      .filter((e) => e.category === "Thing" && e.start === 0 && e.end === h.tokens.length && !e.wraps && !e.heads && !e.gap && e.pending.every((p) => p.takes.optional))
      .sort((a, b) => b.score - a.score)[0];
    return best?.expr;
  };
}

/** The things a pattern can say a kind of thing as: the one meant, a kind, one of them, all of them. */
const THINGS = ["Ref", "Some", "Every"];

/** A kind as a pattern: its head, and those of its roles that are bare words ("review" in review comment). */
function kindPattern(k: Call): Call {
  return { ...k, args: k.args.filter((a) => a.name !== undefined && isCall(a.value) && !a.value.args.length) };
}

/**
 * The patterns a request matches an operation by: the act its summary reduces to, done to the kind
 * of thing the summary names, said any way a thing is said. Its other roles (what the thing is
 * for, where) are the parameters' to fill; the agent is whoever the request names. A summary of
 * two acts ("Create or update a file") is reached by either. What the act is done to must be a
 * thing (a word the store has as a noun), so an act done to an act gives no pattern.
 */
export function patternsFor(what: Expr, isThing: (head: string) => boolean): Call[] {
  if (!isCall(what)) return [];
  if (what.head === "Or" || what.head === "And") return positional(what).flatMap((x) => patternsFor(x, isThing));
  const args = what.args.filter((a) => a.name !== "agent");
  const kindOf = (x: Expr): Call | undefined => {
    const k = isCall(x) && THINGS.includes(x.head) ? (x.head === "Ref" ? x.args.find((a) => a.name === "kind")?.value : positional(x)[0]) : x;
    return isCall(k) && isThing(k.head) ? k : undefined;
  };
  const i = args.findIndex((a, j) => !(a.name === undefined && j === 0 && isHead(a.value, "Addressee")) && !!kindOf(a.value));
  if (i < 0) return [];
  const k = kindPattern(kindOf(args[i].value)!);
  const forms: Expr[] = [c("Ref", ["kind", k]), k, c("Some", k), c("Every", k)];
  // Positional arguments before the thing stay as places anything fills (the agent, said first).
  const head = (form: Expr): Call => {
    const kept = args.slice(0, i + 1).map((a, j) => (j === i ? { ...a, value: form } : a.name === undefined ? { value: v("_") } : undefined)).filter((a): a is { name?: string; value: Expr } => !!a);
    return { ...what, args: kept };
  };
  return forms.map(head);
}

/**
 * The effect classes an operation's method gives it: the protocol's own claim of what a request
 * does, which a summary saying otherwise does not narrow.
 */
function effectsOf(method: string): Expr {
  const e = method === "get" ? ["Reads", "SendsOutside"] : method === "delete" ? ["Deletes", "SendsOutside"] : ["Publishes", "SendsOutside"];
  return c("All", ...e.map((x) => c(x)));
}

/** The path as pieces: literal text, and a variable for each placeholder the request must fill. */
function pathPieces(path: string, fills: Set<string>, vars: Map<string, string>): Expr {
  const pieces: Expr[] = [];
  let text = "";
  for (const part of path.replace(/^\//, "").split(/(\{[^}]+\})/)) {
    const m = /^\{([^}]+)\}$/.exec(part);
    if (m && !fills.has(m[1])) {
      if (text) pieces.push(s(text));
      text = "";
      pieces.push(v(vars.get(m[1]) ?? m[1]));
    } else text += part;
  }
  if (text) pieces.push(s(text));
  return pieces.length === 1 && pieces[0].kind === "string" ? pieces[0] : c("Joined", ...pieces);
}

/** A variable name for a parameter: letters, digits and underscores, starting with a letter. */
function varName(name: string): string {
  const x = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(x) ? x : `p_${x}`;
}

export async function learnOpenApi(
  doc: Json,
  name: string,
  cli: ApiCli,
  store: Store,
  /** The words other packs give (and no tool's readings), to understand the summaries with. */
  words?: Store,
  progress?: (done: number, total: number) => void,
): Promise<OpenApiResult> {
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.")) throw new Error("not an OpenAPI 3 description (no openapi: 3.x)");
  const names = new Names(store);
  const forms: Expr[] = [];
  const skipped: string[] = [];
  const blocks = new Set<string>();
  const block = (text: string, from: Expr, media = "text/markdown"): Expr => {
    const id = "b_" + createHash("sha256").update(text).digest("hex").slice(0, 16);
    if (!blocks.has(id)) {
      blocks.add(id);
      forms.push(c("Block", ["id", s(id)], ["media", s(media)], ["body", s(text)], ["from", from]));
    }
    return c("Block", s(id));
  };
  const info = isObj(doc.info) ? doc.info : {};
  const apiFrom = c("ApiDoc", s(name));
  forms.unshift(c("Pack", ["name", s(`openapi-${name}`)], ["version", s(typeof info.version === "string" ? info.version : "unknown")], ["from", apiFrom]));
  const api = `${encodeLemma(name) ?? "Service"}#Api`;
  // An API (the core's kind), called by the name it was imported as, a sense of that word (so
  // "what can you do with github" names it), and reached through the program that speaks to it.
  const apiClaims: Expr[] = [c("IsA", c("Api")), c("Name", s(name)), c("ServedBy", c(names.word(cli.command[0])))];
  const apiWord = names.word(name);
  forms.push(c("Concept", c(apiWord), ...(store.facts(apiWord, "Lemma").length ? [] : [c("Lemma", s(name.toLowerCase()))]), c("Sense", c(api)), ...(store.facts(apiWord, "Category").length ? [] : [c("Category", c("Thing"))]), ["from", apiFrom]));
  apiClaims.push(c("SenseOf", c(apiWord)));
  if (typeof info.title === "string") apiClaims.push(c("Said", block(info.title, apiFrom, "text/plain")));
  for (const sv of Array.isArray(doc.servers) ? doc.servers : []) if (isObj(sv) && typeof sv.url === "string") apiClaims.push(c("Server", s(sv.url)));
  forms.push(c("Concept", c(api), ...apiClaims, ["from", apiFrom]));
  // How the API is spoken to: the user's own configuration, given when importing.
  const program = cli.command[0];
  forms.push(
    c(
      "Concept",
      c(api),
      c("Cli", s(program), c("Args", ...cli.command.slice(1).map(s)), ["method", s(cli.method)], ["field", s(cli.field)], ["typedField", s(cli.typedField ?? cli.field)]),
      ...(cli.fills ?? []).map((f) => c("CliFills", s(f))),
      ["from", c("User")],
    ),
  );
  const understand = words ? summaryReader(words) : undefined;
  const phrase = words ? phraseReader(words) : undefined;
  const phrases = new Map<string, Expr | undefined>();
  const fills = new Set(cli.fills ?? []);
  const typed = cli.typedField ?? cli.field;
  const lex = words ?? store;
  const isThing = (head: string) => lex.facts(head, "Category").some((f) => isCall(f.claim) && ["Noun", "Thing"].some((k) => isHead(positional(f.claim as Call)[0], k)));

  const ops: { path: string; method: (typeof METHODS)[number]; item: Json; op: Json }[] = [];
  for (const [path, item] of Object.entries(isObj(doc.paths) ? doc.paths : {}))
    if (isObj(item)) for (const method of METHODS) if (isObj(item[method])) ops.push({ path, method, item, op: item[method] as Json });

  let understood = 0;
  let readings = 0;
  let parameters = 0;
  for (const [n, { path, method, item, op }] of ops.entries()) {
    progress?.(n, ops.length);
    const id = typeof op.operationId === "string" ? op.operationId : `${method} ${path}`;
    const summary = typeof op.summary === "string" ? op.summary.trim() : "";
    const from = c("ApiDoc", s(name), s(id));
    const concept = names.other(`openapi:${name}:${id}`, encodeLemma(id));
    const claims: Expr[] = [c("IsA", c("Operation")), c("PartOf", c(api)), c("Name", s(id)), c("OperationId", s(id)), c("Method", s(method.toUpperCase())), c("Endpoint", s(path))];
    if (summary) claims.push(c("Said", block(summary, from, "text/plain")));
    if (typeof op.description === "string" && op.description.trim()) claims.push(c("Said", block(op.description.trim(), from)));
    if (op.deprecated === true) claims.push(c("Deprecated"));
    const u = summary ? await understand?.(summary) : undefined;
    if (u) {
      claims.push(c("Describes", c(concept), u.what));
      understood++;
    }
    // The parameters are roles of the operation, each with what its description says fills it.
    const params = parametersOf(doc, item, op);
    const vars = new Map<string, string>();
    for (const p of params) {
      if (p.in === "path" && fills.has(p.name)) continue;
      vars.set(p.name, varName(p.name));
      const role = `${concept}#${encodeLemma(p.name.replace(/_/g, " ")) ?? "Parameter"}`;
      const pc: Expr[] = [c("IsA", c("Parameter")), c("PartOf", c(concept)), c("Name", s(p.name)), c("Field", s(p.name)), c("In", s(p.in))];
      if (p.required) pc.push(c("Required"));
      if (p.type) pc.push(c("Type", s(p.type)));
      if (p.enum) pc.push(c("OneOf", ...p.enum.map(s)));
      if (p.description) {
        pc.push(c("Said", block(p.description, from)));
        const first = firstSentence(p.description);
        if (phrase && first && !phrases.has(first)) phrases.set(first, phrase(first));
        const fills = first ? phrases.get(first) : undefined;
        if (fills) pc.push(c("FilledBy", fills));
      }
      forms.push(c("Concept", c(role), ...pc, ["from", from]));
      claims.push(c("Parameter", c(role)));
      parameters++;
    }
    forms.push(c("Concept", c(concept), ...claims, ["from", from]));
    if (!u) {
      skipped.push(id);
      continue;
    }
    // The command line: the method, the path with what the request fills, and every required
    // field of the body or query, typed where the description says it is not text.
    const argv: Expr[] = [...cli.command.slice(1).map(s), s(cli.method), s(method.toUpperCase()), pathPieces(path, fills, vars)];
    for (const p of params)
      if (p.in !== "path" && p.required) argv.push(s(p.type && p.type !== "string" ? typed : cli.field), c("Joined", s(`${p.name}=`), v(vars.get(p.name)!)));
    const becomes = c("Run", s(program), c("Args", ...argv));
    const effects = effectsOf(method);
    for (const pattern of patternsFor(u.what, isThing)) {
      forms.push(c("Reading", ["on", c(pattern.head)], ["pattern", pattern], ["becomes", becomes], ["effects", effects], ["from", from]));
      readings++;
    }
  }
  progress?.(ops.length, ops.length);
  return { text: format({ forms: forms as Call[] }), operations: ops.length, understood, readings, parameters, skipped };
}

