// wordfreq's word lists (docs/imports.md): a msgpack array whose first item is a header and whose
// i-th item after it is the list of words at -i centibels, so the words come most frequent first.
// Used to pick the most common words for measuring how much of the language bottoms out (design
// section 6: coverage of the most common lemmas). Only the parts of msgpack the lists use are read.

/** The words of a wordfreq cBpack list, most frequent first. */
export function wordfreqWords(buf: Uint8Array): string[] {
  let i = 0;
  const text = new TextDecoder();
  const u = (n: number) => {
    let x = 0;
    for (let k = 0; k < n; k++) x = x * 256 + buf[i++];
    return x;
  };
  const str = (n: number) => {
    const s = text.decode(buf.subarray(i, i + n));
    i += n;
    return s;
  };
  const read = (): unknown => {
    const t = buf[i++];
    if (t <= 0x7f) return t;
    if (t >= 0x80 && t <= 0x8f) return map(t - 0x80);
    if (t >= 0x90 && t <= 0x9f) return arr(t - 0x90);
    if (t >= 0xa0 && t <= 0xbf) return str(t - 0xa0);
    switch (t) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc:
        return u(1);
      case 0xcd:
        return u(2);
      case 0xce:
        return u(4);
      case 0xd9:
        return str(u(1));
      case 0xda:
        return str(u(2));
      case 0xdb:
        return str(u(4));
      case 0xdc:
        return arr(u(2));
      case 0xdd:
        return arr(u(4));
      case 0xde:
        return map(u(2));
    }
    throw new Error(`wordfreq: msgpack type 0x${t.toString(16)} at ${i - 1} is not one the lists use`);
  };
  const arr = (n: number) => Array.from({ length: n }, read);
  const map = (n: number) => {
    const o: Record<string, unknown> = {};
    for (let k = 0; k < n; k++) o[String(read())] = read();
    return o;
  };
  const all = read() as unknown[];
  return all.slice(1).flatMap((bucket) => (Array.isArray(bucket) ? (bucket as string[]) : []));
}
