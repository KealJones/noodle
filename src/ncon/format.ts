import { type Call, type Expr, type NconFile, equal } from "./ast.js";
import { META_ORDER, isActive, packSource } from "./forms.js";

// The canonical text of a file (docs/specs/ncon-format.md section 5).

const WIDTH = 100;
const RAW_WIDTH = 80;
const META = new Set<string>(META_ORDER);

function str(s: string): string {
  const raw = (s.includes("\n") || s.length > RAW_WIDTH) && !s.includes('"""') && !s.endsWith('"');
  return raw ? `"""${s}"""` : JSON.stringify(s);
}

/** One-line form, or undefined if some part of it must break (a raw string with a newline). */
function flat(e: Expr): string | undefined {
  switch (e.kind) {
    case "number":
      return JSON.stringify(e.value);
    case "boolean":
      return String(e.value);
    case "null":
      return "null";
    case "variable":
      return e.text;
    case "string": {
      const s = str(e.value);
      return s.includes("\n") ? undefined : s;
    }
    case "call": {
      const parts: string[] = [];
      for (const a of e.args) {
        const v = flat(a.value);
        if (v === undefined) return undefined;
        parts.push(a.name ? `${a.name}=${v}` : v);
      }
      return `${e.head}(${parts.join(", ")})`;
    }
  }
}

function print(e: Expr, indent: number, name: string | undefined, suffix: number): string {
  const prefix = name ? `${name}=` : "";
  const one = flat(e);
  if (one !== undefined && indent + prefix.length + one.length + suffix <= WIDTH) return prefix + one;
  if (e.kind === "string") return prefix + str(e.value);
  if (e.kind !== "call" || e.args.length === 0) return prefix + (one ?? "");
  const pad = " ".repeat(indent + 2);
  const lines = e.args.map((a, i) =>
    pad + print(a.value, indent + 2, a.name, i < e.args.length - 1 ? 1 : 0),
  );
  return `${prefix}${e.head}(\n${lines.join(",\n")}\n${" ".repeat(indent)})`;
}

/** A top-level form with its metadata last, in order, and defaults the file already says left out. */
function normalizeForm(form: Call, source: Expr | undefined): Call {
  if (form.head === "Pack") return form;
  const rest = form.args.filter((a) => !(a.name && META.has(a.name)));
  const meta = META_ORDER.flatMap((n) => form.args.filter((a) => a.name === n)).filter((a) => {
    if (a.name === "from") return !(source && equal(a.value, source));
    if (a.name === "status") return !isActive(a.value);
    return true;
  });
  return { ...form, args: [...rest, ...meta] };
}

export function format(file: NconFile): string {
  const source = packSource(file);
  return file.forms.map((f) => print(normalizeForm(f, source), 0, undefined, 0)).join("\n\n") + (file.forms.length ? "\n" : "");
}
