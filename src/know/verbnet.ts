// Import VerbNet 3.4 classes into an N-Con pack (design sections 6 and 22: what verbs do to their
// arguments). Each class's frames give its member verbs chart entries (which arguments they take,
// on which side, in which roles), and each frame's semantics gives a reading: the verb with those
// roles becomes VerbNet's predicates over them. The predicates are kept as VerbNet's own concepts;
// the seed's bridge (seed/bridge.ncon) says which core meanings they are, so this importer decides
// no meaning itself. A frame it cannot read is skipped and counted, never guessed.

import { type Expr, c, s, v } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";
import { type XmlElement, child, childrenNamed, elements, parseXml } from "./xml.js";

/** VerbNet thematic roles that are the seed's roles under another name (ncon.md section 7). */
const ROLE: Record<string, string> = {
  "Co-Agent": "Partner",
  Initial_Location: "Source",
  Goal: "Destination",
  Trajectory: "Path",
  "Co-Theme": "Theme",
  Final_Time: "Time",
};

export interface VerbNetResult {
  text: string;
  classes: number;
  frames: number;
  skippedFrames: number;
  verbs: number;
}

const roleName = (vn: string) => {
  const r = ROLE[vn.replace(/^\?/, "")] ?? vn.replace(/^\?/, "");
  return encodeLemma(r) ?? r;
};
const lower = (x: string) => x[0].toLowerCase() + x.slice(1);

export function importVerbNet(files: { name: string; xml: string }[], store: Store, opts: { version: string }): VerbNetResult {
  const names = new Names(store);
  const forms: Expr[] = [c("Pack", ["name", s("verbnet")], ["version", s(opts.version)], ["from", c("VerbNet", s(opts.version))], ["license", s("VerbNet license (permissive)")])];
  const roles = new Set<string>();
  const predicates = new Set<string>();
  const verbs = new Set<string>();
  let classes = 0;
  let frames = 0;
  let skippedFrames = 0;

  const visit = (cls: XmlElement, inherited: string[]) => {
    classes++;
    const id = cls.attrs.ID;
    const from = c("VerbNet", s(id));
    const members = [...inherited, ...childrenNamed(child(cls, "MEMBERS") ?? cls, "MEMBER").map((m) => m.attrs.name.replace(/_/g, " "))];
    for (const frame of elements(child(cls, "FRAMES") ?? cls, "FRAME")) {
      const parsed = readFrame(frame);
      if (!parsed) {
        skippedFrames++;
        continue;
      }
      frames++;
      for (const r of parsed.roles) roles.add(r);
      for (const p of parsed.predicates) predicates.add(p);
      for (const m of members) {
        if (m.includes(" ")) continue;
        const w = names.word(m);
        verbs.add(w);
        if (!store.facts(w, "Category").length) {
          forms.push(c("Fact", c(w), parsed.entry, ["from", from]));
          if (parsed.becomes) forms.push(c("Reading", ["on", c(w)], ["pattern", c(w, ...parsed.patternRoles)], ["becomes", parsed.becomes], ["from", from]));
        }
      }
    }
    for (const sub of childrenNamed(child(cls, "SUBCLASSES") ?? { name: "", attrs: {}, children: [], text: "" }, "VNSUBCLASS")) visit(sub, members);
  };
  for (const f of files) for (const cls of elements(parseXml(f.xml), "VNCLASS")) visit(cls, []);

  // VerbNet's roles and predicates are concepts of their own; the bridge relates them to the seed.
  const head: Expr[] = [];
  for (const r of roles) if (!store.has(r)) head.push(c("Concept", c(r), c("IsA", c("Role")), ["from", c("VerbNet", s(opts.version))]));
  for (const p of predicates) head.push(c("Concept", c(p), ["from", c("VerbNet", s(opts.version))]));
  return { text: format({ forms: [forms[0], ...head, ...forms.slice(1)] as never }), classes, frames, skippedFrames, verbs: verbs.size };
}

interface Frame {
  entry: Expr;
  patternRoles: [string, Expr][];
  becomes?: Expr;
  roles: string[];
  predicates: string[];
}

/** One frame: its syntax as a chart entry, its semantics as what the verb becomes. */
function readFrame(frame: XmlElement): Frame | undefined {
  const syntax = child(frame, "SYNTAX");
  if (!syntax) return undefined;
  const els = syntax.children;
  const verbAt = els.findIndex((e) => e.name === "VERB");
  // Only frames with a subject noun phrase and the verb: "NP V ...".
  if (verbAt !== 1 || els[0].name !== "NP") return undefined;
  const takes: Expr[] = [];
  const patternRoles: [string, Expr][] = [];
  const used = new Set<string>();
  const addRole = (vnRole: string) => {
    const r = roleName(vnRole);
    if (!used.has(r)) {
      used.add(r);
      patternRoles.push([lower(r), v(lower(r))]);
    }
    return r;
  };
  addRole(els[0].attrs.value);
  for (let i = verbAt + 1; i < els.length; i++) {
    const e = els[i];
    if (e.name === "NP") takes.push(c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c(addRole(e.attrs.value))]));
    else if (e.name === "PREP" || e.name === "LEX") {
      const np = els[i + 1];
      if (!np || np.name !== "NP") return undefined;
      const preps = (e.attrs.value ?? "").split(/\s+/).filter(Boolean);
      const prepHead = preps.length === 1 && /^[a-z]+$/.test(preps[0]) ? encodeLemma(preps[0]) : undefined;
      takes.push(c("Takes", ["side", c("Right")], ["category", c("Relation")], ["role", c(addRole(np.attrs.value))], ...(prepHead ? ([["head", c(prepHead)]] as [string, Expr][]) : [])));
      i++;
    } else if (e.name === "ADJ") takes.push(c("Takes", ["side", c("Right")], ["category", c("Property")], ["role", c(addRole(e.attrs.value ?? "Result"))]));
    else if (e.name === "ADV") takes.push(c("Takes", ["side", c("Right")], ["category", c("Manner")], ["optional", { kind: "boolean", value: true, pos: { line: 0, column: 0 } }]));
    else return undefined;
  }
  const entry = c("Category", c("Act"), ...takes);
  const sem = readSemantics(child(frame, "SEMANTICS"), used);
  return { entry, patternRoles, becomes: sem?.expr, roles: [...used], predicates: sem?.predicates ?? [] };
}

/**
 * VerbNet's event semantics: predicates over events and roles, with cause(e_i, e_j). What the verb
 * becomes is the caused result, Cause(agent=$agent, result=Become(the predicates at e_j)), or, with
 * no cause, the predicates of its last event. Predicates negated (bool="!") are the state before;
 * implicit roles (?Role) are left out.
 */
function readSemantics(sem: XmlElement | undefined, roles: Set<string>): { expr: Expr; predicates: string[] } | undefined {
  if (!sem) return undefined;
  const preds = childrenNamed(sem, "PRED").map((p) => ({
    name: encodeLemma(p.attrs.value.replace(/_/g, " ")) ?? p.attrs.value,
    raw: p.attrs.value,
    negated: p.attrs.bool === "!",
    args: childrenNamed(child(p, "ARGS") ?? p, "ARG").map((a) => ({ type: a.attrs.type, value: a.attrs.value })),
  }));
  const eventOf = (p: (typeof preds)[number]) => p.args.find((a) => a.type === "Event")?.value;
  const roleArgs = (p: (typeof preds)[number]): Expr[] | undefined => {
    const out: Expr[] = [];
    for (const a of p.args) {
      if (a.type === "Event") continue;
      if (a.type !== "ThemRole") return undefined;
      if (a.value.startsWith("?")) return undefined;
      const r = roleName(a.value);
      if (!roles.has(r)) return undefined;
      out.push(v(lower(r)));
    }
    return out;
  };
  const used: string[] = [];
  const at = (event: string | undefined): Expr[] => {
    const out: Expr[] = [];
    for (const p of preds) {
      if (p.raw === "cause" || p.raw === "do" || p.negated || eventOf(p) !== event) continue;
      const args = roleArgs(p);
      if (!args) continue;
      used.push(p.name);
      out.push(c(p.name, ...args));
    }
    return out;
  };
  const and = (xs: Expr[]) => (xs.length === 1 ? xs[0] : xs.length ? c("And", ...xs) : undefined);
  const cause = preds.find((p) => p.raw === "cause");
  if (cause) {
    const events = cause.args.filter((a) => a.type === "Event").map((a) => a.value);
    const agentRole = cause.args.find((a) => a.type === "ThemRole")?.value ?? preds.find((p) => p.raw === "do" && eventOf(p) === events[0])?.args.find((a) => a.type === "ThemRole")?.value;
    const result = and(at(events[events.length - 1]));
    if (!result) return undefined;
    const agent = agentRole && roles.has(roleName(agentRole)) ? v(lower(roleName(agentRole))) : undefined;
    return { expr: c("Cause", ...(agent ? ([["agent", agent]] as [string, Expr][]) : []), ["result", c("Become", result)]), predicates: used };
  }
  const events = [...new Set(preds.map(eventOf).filter(Boolean))];
  const result = and(at(events[events.length - 1]));
  return result ? { expr: result, predicates: used } : undefined;
}
