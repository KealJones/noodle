import { type Arg, type Call, type Expr, type NconFile, NconError, type Pos } from "./ast.js";
import { validate } from "./forms.js";

const isDigit = (c: string) => c >= "0" && c <= "9";
const isUpper = (c: string) => c >= "A" && c <= "Z";
const isLower = (c: string) => c >= "a" && c <= "z";
const isLetter = (c: string) => isUpper(c) || isLower(c);
const isIdent = (c: string) => isLetter(c) || isDigit(c) || c === "_";
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

class Parser {
  private i = 0;
  private line = 1;
  private col = 1;
  private form: string | undefined;

  constructor(private readonly src: string) {}

  parseFile(): NconFile {
    const forms: Call[] = [];
    for (;;) {
      this.skip();
      if (this.eof()) break;
      this.form = undefined;
      const e = this.expr();
      if (e.kind !== "call") this.fail("a top-level form must be a call", e.pos);
      forms.push(e);
    }
    return { forms };
  }

  parseSingle(): Expr {
    this.skip();
    const e = this.expr();
    this.skip();
    if (!this.eof()) this.fail("trailing text after expression");
    return e;
  }

  private eof() {
    return this.i >= this.src.length;
  }
  private peek(o = 0) {
    return this.src[this.i + o] ?? "";
  }
  private pos(): Pos {
    return { line: this.line, column: this.col };
  }
  private fail(msg: string, pos = this.pos()): never {
    throw new NconError(msg, pos, this.form);
  }
  private advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (this.src[this.i] === "\n") {
        this.line++;
        this.col = 1;
      } else this.col++;
      this.i++;
    }
  }

  private skip() {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.advance();
      else if (c === "/" && this.peek(1) === "/") while (!this.eof() && this.peek() !== "\n") this.advance();
      else return;
    }
  }

  private ident(): string {
    const start = this.i;
    while (isIdent(this.peek())) this.advance();
    return this.src.slice(start, this.i);
  }

  private expr(): Expr {
    const pos = this.pos();
    const c = this.peek();
    if (c === '"') return this.peek(1) === '"' && this.peek(2) === '"' ? this.raw(pos) : this.string(pos);
    if (c === "-" || isDigit(c)) return this.number(pos);
    if (c === "$") {
      this.advance();
      const c2 = this.peek();
      if (!isLetter(c2) && c2 !== "_") this.fail("a variable needs a name after $");
      return { kind: "variable", text: "$" + this.ident(), pos };
    }
    if (isUpper(c)) return this.call(pos);
    if (isLower(c) || c === "_") {
      const word = this.ident();
      if (word === "_") return { kind: "variable", text: "_", pos };
      if (word === "true" || word === "false") return { kind: "boolean", value: word === "true", pos };
      if (word === "null") return { kind: "null", pos };
      this.fail(`bare identifier "${word}" (did you forget "()" or "name="?)`, pos);
    }
    if (this.eof()) this.fail("unexpected end of file");
    this.fail(`unexpected "${c}"`);
  }

  private number(pos: Pos): Expr {
    NUMBER.lastIndex = this.i;
    const m = NUMBER.exec(this.src);
    if (!m) this.fail("bad number");
    this.advance(m[0].length);
    return { kind: "number", value: Number(m[0]), pos };
  }

  private string(pos: Pos): Expr {
    let j = this.i + 1;
    for (;;) {
      const c = this.src[j];
      if (c === undefined || c === "\n") this.fail("unterminated string", pos);
      if (c === "\\") j += 2;
      else if (c === '"') break;
      else j++;
    }
    const text = this.src.slice(this.i, j + 1);
    let value: string;
    try {
      value = JSON.parse(text);
    } catch {
      this.fail("bad string escape", pos);
    }
    this.advance(text.length);
    return { kind: "string", value, pos };
  }

  private raw(pos: Pos): Expr {
    const end = this.src.indexOf('"""', this.i + 3);
    if (end < 0) this.fail("unterminated raw string", pos);
    const value = this.src.slice(this.i + 3, end);
    this.advance(end + 3 - this.i);
    return { kind: "string", value, pos };
  }

  private call(pos: Pos): Call {
    let head = this.ident();
    if (this.peek() === "#") {
      this.advance();
      if (!isUpper(this.peek())) this.fail("a sense after # must start with a capital letter");
      head += "#" + this.ident();
    }
    if (this.form === undefined) this.form = head;
    if (this.peek() !== "(") {
      this.skip();
      if (this.peek() !== "(") this.fail(`"${head}" must be followed by "("`, pos);
    }
    this.advance();
    const args: Arg[] = [];
    for (;;) {
      this.skip();
      if (this.peek() === ")") break;
      args.push(this.arg());
      this.skip();
      if (this.peek() === ",") this.advance();
      else if (this.peek() !== ")") this.fail(this.eof() ? "unexpected end of file, missing )" : 'expected "," or ")"');
    }
    this.advance();
    return { kind: "call", head, args, pos };
  }

  private arg(): Arg {
    if (isLower(this.peek())) {
      const save = { i: this.i, line: this.line, col: this.col };
      const name = this.ident();
      this.skip();
      if (this.peek() === "=" && name !== "true" && name !== "false" && name !== "null") {
        this.advance();
        this.skip();
        return { name, value: this.expr() };
      }
      Object.assign(this, { i: save.i, line: save.line, col: save.col });
    }
    return { value: this.expr() };
  }
}

/** Parses a whole file. A file with any error loads nothing. */
export function parse(src: string): NconFile {
  const file = new Parser(src).parseFile();
  validate(file);
  return file;
}

/** Parses one expression (for tests and tools that handle a single reference). */
export function parseExpr(src: string): Expr {
  return new Parser(src).parseSingle();
}
