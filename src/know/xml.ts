// A small XML reader for the import formats (WN-LMF, VerbNet): elements, attributes and text, as
// a tree. Enough for well-formed data files; not a general XML parser (no DTD validation, no
// namespaces beyond keeping prefixed names as they are).

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      i = src.indexOf("-->", lt) + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt);
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      // A DOCTYPE may have an internal subset in brackets.
      let depth = 0;
      let j = lt + 2;
      for (; j < src.length; j++) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        else if (src[j] === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    const gt = findTagEnd(src, lt);
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === "/") {
      stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const m = /^([^\s/>]+)/.exec(body);
    const el: XmlElement = { name: m ? m[1] : "", attrs: {}, children: [], text: "" };
    for (const a of body.slice(el.name.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = decode(a[3] ?? a[4] ?? "");
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

function findTagEnd(src: string, from: number): number {
  let quote: string | undefined;
  for (let j = from + 1; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return j;
  }
  return src.length;
}

export function* elements(el: XmlElement, name?: string): Generator<XmlElement> {
  for (const c of el.children) {
    if (!name || c.name === name) yield c;
    yield* elements(c, name);
  }
}

export const child = (el: XmlElement, name: string) => el.children.find((c) => c.name === name);
export const childrenNamed = (el: XmlElement, name: string) => el.children.filter((c) => c.name === name);
