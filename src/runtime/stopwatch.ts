// Where a turn's time goes, by stage (hearing, chart, rewriting, the scored match, dry runs,
// evaluation, Know), for the reasons log (`pnpm chat --why`). A stage's time is its own: time spent
// in a stage inside it (Know inside evaluation) counts for the inner one only. A turn runs one
// stage at a time, so one watch for the process is enough.

export class Stopwatch {
  readonly times = new Map<string, number>();
  private stack: { stage: string; since: number }[] = [];

  private charge(now: number) {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      this.times.set(top.stage, (this.times.get(top.stage) ?? 0) + now - top.since);
      top.since = now;
    }
  }

  private enter(stage: string) {
    const now = performance.now();
    this.charge(now);
    this.stack.push({ stage, since: now });
  }

  private leave() {
    this.charge(performance.now());
    this.stack.pop();
    const top = this.stack[this.stack.length - 1];
    if (top) top.since = performance.now();
  }

  /** Runs `f` as `stage`, sync or async. */
  time<T>(stage: string, f: () => T): T {
    this.enter(stage);
    let out: T;
    try {
      out = f();
    } catch (e) {
      this.leave();
      throw e;
    }
    if (out instanceof Promise) return out.finally(() => this.leave()) as T;
    this.leave();
    return out;
  }

  /** Runs `f` and says how long it took, in milliseconds (one lookup's time, for the reasons log). */
  async took<T>(f: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const t0 = performance.now();
    const value = await f();
    return { value, ms: performance.now() - t0 };
  }

  private since = 0;

  /** Starts over: a new turn. */
  reset() {
    this.times.clear();
    this.stack = [];
    this.since = performance.now();
  }

  /** The times so far by stage, with what no stage took ("other") and the total. */
  read(): Map<string, number> {
    const total = performance.now() - this.since;
    const out = new Map(this.times);
    out.set("other", total - [...this.times.values()].reduce((a, b) => a + b, 0));
    out.set("total", total);
    return out;
  }
}

export const stopwatch = new Stopwatch();
