import { type Arg, type Call, type Expr, type NconFile, NconError } from "./ast.js";

// Top-level forms (docs/specs/ncon-format.md section 2) and their metadata (section 3).

export const META_ORDER = ["from", "at", "status", "weight", "id"] as const;
const META = new Set<string>(META_ORDER);
const STATUSES = new Set(["Active", "Proposed", "Pending"]);

interface FormSpec {
  /** Named arguments that belong to the form itself (metadata names are always allowed). */
  named: string[];
  /** Named arguments that must be present. */
  required: string[];
  /** Number of positional arguments: exact, or a minimum. */
  positional: { min: number; max: number };
  /** Whether the first positional argument is the concept being written about, `Name()`. */
  subject: boolean;
  /** Whether metadata is allowed (Pack is a header, not an item). */
  meta: boolean;
}

const FORMS: Record<string, FormSpec> = {
  Pack: { named: ["name", "version", "from", "license"], required: ["name", "version"], positional: { min: 0, max: 0 }, subject: false, meta: false },
  Concept: { named: [], required: [], positional: { min: 1, max: Infinity }, subject: true, meta: true },
  Fact: { named: ["inSense", "holds"], required: [], positional: { min: 2, max: 2 }, subject: true, meta: true },
  Reading: {
    named: ["on", "pattern", "wants", "becomes", "needs", "effects", "checks", "mode", "direction"],
    required: ["on", "pattern"],
    positional: { min: 0, max: 0 },
    subject: false,
    meta: true,
  },
  Block: { named: ["id", "media", "body"], required: ["media", "body"], positional: { min: 0, max: 0 }, subject: false, meta: true },
  Retract: { named: ["id"], required: ["id"], positional: { min: 0, max: 0 }, subject: false, meta: true },
};

/** Throws NconError on the first invalid top-level form. */
export function validate(file: NconFile): void {
  file.forms.forEach((form, index) => {
    const spec = FORMS[form.head];
    const fail = (msg: string, at: Expr = form): never => {
      throw new NconError(msg, at.pos, form.head);
    };
    if (!spec) return fail(`"${form.head}" cannot appear at top level`);
    if (form.head === "Pack" && index !== 0) fail("Pack must be the first form, and there is at most one");

    const positional = form.args.filter((a) => a.name === undefined);
    if (positional.length < spec.positional.min || positional.length > spec.positional.max)
      fail(`${form.head} takes ${describeCount(spec)} positional arguments, got ${positional.length}`);
    if (spec.subject) {
      const subject = positional[0].value;
      if (subject.kind !== "call" || subject.args.length !== 0) fail("the first argument must be a concept written as Name()", subject);
    }

    const seen = new Set<string>();
    for (const a of form.args) {
      if (a.name === undefined) continue;
      const isMeta = META.has(a.name);
      if (isMeta && !spec.meta && !(form.head === "Pack" && a.name === "from"))
        fail(`${form.head} does not take "${a.name}"`, a.value);
      if (!isMeta && !spec.named.includes(a.name)) fail(`${form.head} does not take "${a.name}"`, a.value);
      if (seen.has(a.name)) fail(`"${a.name}" given twice`, a.value);
      seen.add(a.name);
      if (isMeta) checkMeta(a.name, a.value, fail);
    }
    for (const r of spec.required) if (!seen.has(r)) fail(`${form.head} needs "${r}"`);
  });
}

function describeCount(s: FormSpec): string {
  const { min, max } = s.positional;
  return max === Infinity ? `at least ${min}` : min === max ? `exactly ${min}` : `${min} to ${max}`;
}

function checkMeta(name: string, v: Expr, fail: (msg: string, at: Expr) => never): void {
  const ok = (cond: boolean, what: string) => cond || fail(`"${name}" must be ${what}`, v);
  switch (name) {
    case "from":
      return void ok(v.kind === "call", "a source expression");
    case "at":
      return void ok(v.kind === "string" && !Number.isNaN(Date.parse(v.value)) && /^\d{4}-\d\d-\d\dT.*Z$/.test(v.value), "an ISO 8601 UTC string");
    case "status":
      return void ok(v.kind === "call" && v.args.length === 0 && STATUSES.has(v.head), "Active(), Proposed() or Pending()");
    case "weight":
    case "id":
      return void ok(v.kind === "number", "a number");
  }
}

const isActive = (e: Expr) => e.kind === "call" && e.head === "Active" && e.args.length === 0;

/** The file's default source: the Pack's `from`. */
export function packSource(file: NconFile): Expr | undefined {
  const pack = file.forms[0]?.head === "Pack" ? file.forms[0] : undefined;
  return pack?.args.find((a) => a.name === "from")?.value;
}

/**
 * Fills in what the file defaults say (the Pack's `from`, `status=Active()`) and puts metadata last
 * in its fixed order, so two files that mean the same compare equal whether or not they write the
 * defaults out or order their metadata alike.
 */
export function applyDefaults(file: NconFile): NconFile {
  const source = packSource(file);
  return {
    forms: file.forms.map((form): Call => {
      if (form.head === "Pack" || !FORMS[form.head]) return form;
      const has = (n: string) => form.args.some((a) => a.name === n);
      const extra: Arg[] = [];
      if (source && !has("from")) extra.push({ name: "from", value: source });
      if (!has("status"))
        extra.push({ name: "status", value: { kind: "call", head: "Active", args: [], pos: form.pos } });
      const args = [...form.args, ...extra];
      const rest = args.filter((a) => !(a.name && META.has(a.name)));
      return { ...form, args: [...rest, ...META_ORDER.flatMap((n) => args.filter((a) => a.name === n))] };
    }),
  };
}

export { isActive };
