// @ts-check
/**
 * Editor support for .ncon (docs/specs/ncon-format.md): every head and the parentheses around
 * its arguments take the color of their depth, everything else is painted in Monokai whatever
 * the theme, hovering a concept shows what the files say about it, and the runtime's own parser
 * and formatter report errors and format the document.
 */
const vscode = require("vscode");
const { scan, callAt, FORMS, RAINBOW, PALETTE } = require("./scan.js");
const { indexPack, describe, FORM_SIGNATURES, META_DOCS } = require("./describe.js");
const { format, problem, CommentsError } = require("./format.js");
const { readFileSync } = require("node:fs");
const { basename } = require("node:path");

/** @type {vscode.TextEditorDecorationType[]} */
let heads = [];
/** @type {vscode.TextEditorDecorationType[]} */
let forms = [];
/** @type {vscode.TextEditorDecorationType[]} */
let parens = [];
/** @type {vscode.TextEditorDecorationType | undefined} */
let formParens;
/** @type {Map<string, vscode.TextEditorDecorationType>} */
let tokens = new Map();
/** @type {vscode.TextEditorDecorationType | undefined} */
let broken;

const config = () => vscode.workspace.getConfiguration("ncon");

function all() {
  return [...heads, ...forms, ...parens, ...(formParens ? [formParens] : []), ...tokens.values(), ...(broken ? [broken] : [])];
}

function build() {
  for (const d of all()) d.dispose();
  const configured = config().get("rainbow.colors");
  const colors = Array.isArray(configured) && configured.length ? configured.map(String) : RAINBOW;
  const bold = config().get("rainbow.boldHeads", false) ? "bold" : undefined;
  heads = colors.map((color) => vscode.window.createTextEditorDecorationType({ color, fontWeight: bold }));
  // A top-level form reads like Monokai's `function` keyword: cyan italic, at any depth color.
  forms = colors.map(() => vscode.window.createTextEditorDecorationType(PALETTE.form));
  parens = colors.map((color) => vscode.window.createTextEditorDecorationType({ color }));
  // A form's parentheses take its color, upright.
  formParens = vscode.window.createTextEditorDecorationType({ color: PALETTE.form.color });
  tokens = new Map(config().get("palette.enabled", true) ? Object.entries(PALETTE).map(([kind, style]) => [kind, vscode.window.createTextEditorDecorationType(style)]) : []);
  broken = vscode.window.createTextEditorDecorationType({
    color: "#FFFFFF",
    backgroundColor: "#F9267255",
    overviewRulerColor: "#F92672",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
}

/** @type {WeakMap<vscode.TextDocument, { version: number, scanned: ReturnType<typeof scan> }>} */
const scans = new WeakMap();
/** @param {vscode.TextDocument} doc */
function scanned(doc) {
  const cached = scans.get(doc);
  if (cached && cached.version === doc.version) return cached.scanned;
  const result = scan(doc.getText());
  scans.set(doc, { version: doc.version, scanned: result });
  return result;
}

/** @param {vscode.TextEditor} editor */
function paint(editor) {
  if (editor.document.languageId !== "ncon") return;
  const doc = editor.document;
  const enabled = config().get("rainbow.enabled", true);
  const native = config().get("rainbow.source", "ncon") === "vscode";
  const { marks, unbalanced } = scanned(doc);
  /** @type {Map<vscode.TextEditorDecorationType, vscode.Range[]>} */
  const ranges = new Map(all().map((d) => [d, []]));
  const at = (/** @type {number} */ s, /** @type {number} */ e) => new vscode.Range(doc.positionAt(s), doc.positionAt(e));
  for (const m of marks) {
    const slot = m.depth % heads.length;
    let type;
    if (m.kind === "head") type = enabled ? heads[slot] : undefined;
    else if (m.kind === "form") type = enabled ? forms[slot] : undefined;
    else if (m.kind === "open" || m.kind === "close") type = enabled && !native ? (m.form ? formParens : parens[slot]) : undefined;
    else type = tokens.get(m.kind);
    if (type) ranges.get(type)?.push(at(m.start, m.end));
  }
  if (broken) ranges.set(broken, unbalanced.map((i) => at(i, i + 1)));
  for (const [type, list] of ranges) editor.setDecorations(type, list);
}

/* ------------------------------------------------------------------ *
 * Hover and go to definition: what a Concept is, from the files that write about it.
 * ------------------------------------------------------------------ */

/** @type {Map<string, Map<string, import("./describe.js").Definition[]>>} every file's concepts */
const packs = new Map();
/** @type {Map<string, string[]>} */
const fileLines = new Map();

async function indexWorkspace() {
  for (const uri of await vscode.workspace.findFiles("**/*.ncon", "**/node_modules/**")) indexFile(uri);
}

/** @param {vscode.Uri} uri */
function indexFile(uri) {
  fileLines.delete(uri.fsPath);
  try {
    packs.set(uri.fsPath, indexPack(readFileSync(uri.fsPath, "utf8"), basename(uri.fsPath)));
  } catch {
    packs.delete(uri.fsPath);
  }
}

/** A line of a file, for the column of the name on it. */
function readLine(/** @type {string} */ path, /** @type {number} */ line) {
  if (!fileLines.has(path)) {
    try {
      fileLines.set(path, readFileSync(path, "utf8").split("\n"));
    } catch {
      fileLines.set(path, []);
    }
  }
  return fileLines.get(path)?.[line] ?? "";
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*(?:#[A-Z][A-Za-z0-9_]*)?/;

/** The head under the cursor: a name followed by its parenthesis (a sense `Word#Sense` is one). */
function headAt(/** @type {vscode.TextDocument} */ doc, /** @type {vscode.Position} */ position) {
  const range = doc.getWordRangeAtPosition(position, WORD);
  if (!range) return undefined;
  const after = doc.getText(new vscode.Range(range.end, range.end.translate(0, 1)));
  const before = range.start.character > 0 ? doc.getText(new vscode.Range(range.start.translate(0, -1), range.start)) : "";
  if (after !== "(" || before === "$") return undefined;
  const name = doc.getText(range);
  return /^[A-Z]/.test(name) ? { name, range } : undefined;
}

const definitions = (/** @type {string} */ name) => [...packs.values()].flatMap((byName) => byName.get(name) ?? []);

/** @type {vscode.HoverProvider} */
const hover = {
  provideHover(doc, position) {
    const head = headAt(doc, position);
    if (!head) return undefined;
    const text = describe(head.name, definitions(head.name));
    return text ? new vscode.Hover(new vscode.MarkdownString(text), head.range) : undefined;
  },
};

/**
 * Cmd+Click (Go to Definition): a Concept goes to every `Concept(Name(), ...)`, `Fact(Name(), ...)`
 * and `Reading(on=Name(), ...)` that writes about it.
 * @type {vscode.DefinitionProvider}
 */
const definition = {
  provideDefinition(doc, position) {
    const head = headAt(doc, position);
    if (!head) return undefined;
    const out = [];
    for (const [path, byName] of packs) {
      for (const def of byName.get(head.name) ?? []) {
        const line = readLine(path, def.line);
        const column = Math.max(0, line.indexOf(`${head.name}(`));
        const start = new vscode.Position(def.line, column);
        out.push(new vscode.Location(vscode.Uri.file(path), new vscode.Range(start, start.translate(0, head.name.length))));
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * Format Document, and the parser's errors.
 * ------------------------------------------------------------------ */

/**
 * The whole text, formatted by the runtime's own formatter (format.js). Text that does not
 * parse, or has comments the formatter would drop, is left alone, and the reason is shown.
 * @type {vscode.DocumentFormattingEditProvider}
 */
const formatter = {
  async provideDocumentFormattingEdits(doc) {
    const text = doc.getText();
    try {
      const out = await format(text);
      if (out === text) return [];
      return [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), out)];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`N-Con: not formatted: ${message}${error instanceof CommentsError ? " (the seed is hand-edited; the formatter only checks it)" : ""}`);
      return [];
    }
  },
};

const diagnostics = vscode.languages.createDiagnosticCollection("ncon");
/** The runtime's parser says where a file stops being valid; it has no half-loaded state. @param {vscode.TextDocument} doc */
async function diagnose(doc) {
  if (doc.languageId !== "ncon") return;
  if (!config().get("diagnostics", true)) return void diagnostics.delete(doc.uri);
  try {
    const found = await problem(doc.getText());
    if (!found) return void diagnostics.delete(doc.uri);
    const line = Math.min(found.line - 1, doc.lineCount - 1);
    const start = new vscode.Position(line, Math.max(0, found.column - 1));
    const word = doc.getWordRangeAtPosition(start, WORD);
    const range = word ?? new vscode.Range(start, start.translate(0, 1));
    diagnostics.set(doc.uri, [new vscode.Diagnostic(range, found.message.replace(/^\d+:\d+: /, ""), vscode.DiagnosticSeverity.Error)]);
  } catch {
    // The runtime is not built: no diagnostics, and the formatter says why when asked.
    diagnostics.delete(doc.uri);
  }
}

/* ------------------------------------------------------------------ *
 * Signature help and completion: the top-level forms, their arguments, and the concepts the files define.
 * ------------------------------------------------------------------ */

/** @type {vscode.SignatureHelpProvider} */
const signatures = {
  provideSignatureHelp(doc, position) {
    const call = callAt(doc.getText(), doc.offsetAt(position));
    const form = call && /** @type {Record<string, { signature: string, doc: string }>} */ (FORM_SIGNATURES)[call.head];
    if (!call || !form) return undefined;
    const help = new vscode.SignatureHelp();
    const info = new vscode.SignatureInformation(form.signature, new vscode.MarkdownString(form.doc));
    const inner = form.signature.slice(form.signature.indexOf("(") + 1, -1).split(", ");
    let from = form.signature.indexOf("(") + 1;
    info.parameters = inner.map((p) => {
      const label = /** @type {[number, number]} */ ([from, from + p.length]);
      from += p.length + 2;
      return new vscode.ParameterInformation(label);
    });
    help.signatures = [info];
    // A named argument is the parameter of that name, wherever it is written.
    const named = /^\s*([a-z][A-Za-z0-9_]*)\s*=/.exec(call.argument)?.[1];
    const k = named ? inner.findIndex((p) => p.startsWith(`${named}=`)) : -1;
    help.activeParameter = k >= 0 ? k : Math.min(call.index, inner.length - 1);
    return help;
  },
};

/** @type {vscode.CompletionItemProvider} */
const completions = {
  provideCompletionItems(doc, position) {
    const nextChar = doc.getText(new vscode.Range(position, position.translate(0, 1)));
    const items = new Map();
    const call = callAt(doc.getText(), doc.offsetAt(position));
    const form = call && /** @type {Record<string, { named: Record<string, string> }>} */ (FORM_SIGNATURES)[call.head];
    // At the start of an argument of a top-level form, its named arguments and the metadata names.
    if (call && form && /^\s*[a-z]*$/.test(call.argument)) {
      for (const [name, text] of Object.entries({ ...(call.head === "Pack" ? {} : META_DOCS), ...form.named })) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
        item.insertText = `${name}=`;
        item.documentation = new vscode.MarkdownString(text);
        item.sortText = `!${name}`;
        items.set(`${name}=`, item);
      }
    }
    if (!call) {
      for (const name of FORMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.insertText = new vscode.SnippetString(`${name}($0)`);
        items.set(name, item);
      }
    }
    for (const byName of packs.values()) {
      for (const [name, defs] of byName) {
        if (items.has(name)) continue;
        const item = new vscode.CompletionItem(name, defs.some((d) => d.form === "Reading") ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Class);
        item.detail = defs.find((d) => d.claims.length)?.claims[0] ?? defs.find((d) => d.pattern)?.pattern;
        if (nextChar !== "(") item.insertText = `${name}()`;
        items.set(name, item);
      }
    }
    return [...items.values()];
  },
  resolveCompletionItem(item) {
    const name = typeof item.label === "string" ? item.label : item.label.label;
    const text = describe(name, definitions(name));
    if (text) item.documentation = new vscode.MarkdownString(text);
    return item;
  },
};

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  build();
  indexWorkspace();
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.ncon");
  context.subscriptions.push(
    watcher,
    diagnostics,
    watcher.onDidChange(indexFile),
    watcher.onDidCreate(indexFile),
    watcher.onDidDelete((uri) => packs.delete(uri.fsPath)),
    vscode.languages.registerHoverProvider("ncon", hover),
    vscode.languages.registerDefinitionProvider("ncon", definition),
    vscode.languages.registerDocumentFormattingEditProvider("ncon", formatter),
    vscode.languages.registerCompletionItemProvider("ncon", completions),
    vscode.languages.registerSignatureHelpProvider("ncon", signatures, "(", ","),
  );
  /** @type {NodeJS.Timeout | undefined} */
  let pending;
  vscode.window.visibleTextEditors.forEach(paint);
  vscode.workspace.textDocuments.forEach(diagnose);
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(paint)),
    vscode.workspace.onDidOpenTextDocument(diagnose),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        for (const editor of vscode.window.visibleTextEditors) if (editor.document === e.document) paint(editor);
        diagnose(e.document);
      }, 60);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("ncon")) return;
      build();
      vscode.window.visibleTextEditors.forEach(paint);
      vscode.workspace.textDocuments.forEach(diagnose);
    }),
    { dispose: () => all().forEach((d) => d.dispose()) },
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
