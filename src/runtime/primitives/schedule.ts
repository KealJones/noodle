// Schedule (built-ins.md section 2): keep an act to be done at a later time. Scheduled items are
// facts on Schedule in the store, from the user who asked; Read(Schedule()) lists them, each
// marked due once its time has come. The chat has no timer, so what falls due is done at the start
// of the next turn (runtime.md 11: the conversation's own record).
//
// A time is a time expression of the logical form (logical-form.md section 3.3): Now(), At(iso),
// After(t, extent=d), Before(t, extent=d), or a duration on its own, that long from now. A duration d is a unit of time (a concept with a Lasts
// fact, its length in seconds), counted by a number said with it ("10 minutes"), or several
// joined by And. Which words say which unit is the seed's; this file knows no unit.

import { type Call, type Expr, b, c, isCall, isHead, n, positional, role, s } from "../expr.js";
import type { Primitive, World } from "../primitive.js";
import { moment } from "./pure.js";

const USER: Expr = c("User");

/** A number, or a numeral as written, alone or as the one argument of a call (Number("10")). */
function numberIn(v: Expr): number | undefined {
  if (v.kind === "number") return v.value;
  if (v.kind === "string" && /^\d+(\.\d+)?$/.test(v.value)) return Number(v.value);
  if (isCall(v) && v.args.length === 1) return numberIn(v.args[0].value);
  return undefined;
}

/** How many of a unit: the number said with it ("10 minutes"), or one. */
function count(u: Call): number {
  for (const a of u.args) {
    const k = a.name === undefined ? undefined : numberIn(a.value);
    if (k !== undefined) return k;
  }
  return 1;
}

/** A duration in seconds, or undefined if this is not one. */
function seconds(d: Expr | undefined, world: World): number | undefined {
  if (!isCall(d)) return undefined;
  if (d.head === "And") {
    const parts = positional(d).map((x) => seconds(x, world));
    return parts.every((x) => x !== undefined) ? parts.reduce((a, b) => a! + b!, 0) : undefined;
  }
  // A plural unit is still that unit ("minutes").
  if ((d.head === "Every" || d.head === "Some") && positional(d).length === 1) return seconds(positional(d)[0], world);
  const lasts = world.store.facts(d.head, "Lasts").map((f) => positional(f.claim as Call)[0])[0];
  return lasts?.kind === "number" ? lasts.value * count(d) : undefined;
}

/** The time a time expression names, in milliseconds since the epoch. */
export function timeOf(t: Expr | undefined, world: World): number {
  if (isHead(t, "Now")) return world.now().getTime();
  if (isHead(t, "At")) {
    const iso = positional(t as Call)[0];
    if (iso?.kind === "string" && !Number.isNaN(Date.parse(iso.value))) return Date.parse(iso.value);
  }
  if (isHead(t, "After") || isHead(t, "Before")) {
    const from = timeOf(positional(t as Call)[0], world);
    const by = seconds(role(t, "extent"), world);
    if (by === undefined) throw new Error("a time after or before another needs how long");
    return from + (isHead(t, "After") ? 1 : -1) * by * 1000;
  }
  // A duration said as when ("in 10 minutes", read as the act's time) is that long from now.
  const by = seconds(t, world);
  if (by !== undefined) return world.now().getTime() + by * 1000;
  throw new Error("this is not a time Schedule can work out");
}

/**
 * Which day a time is on, counted from the user's today: on=0 for today, on=1 for tomorrow (the
 * words for them are the seed's), nothing when it is later.
 */
function onDay(at: Date, world: World): [string, Expr][] {
  const now = world.now();
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  return days === 0 || days === 1 ? [["on", n(days)]] : [];
}

export const Schedule: Primitive = {
  name: "Schedule",
  params: ["when", "act"],
  plans: ["act"],
  times: ["when"],
  pure: false,
  // Keeping an item changes only the assistant's own store. A time it cannot work out is no
  // schedule at all, so it fails here, before anything is offered or kept.
  effects([when], world) {
    const at = timeOf(when, world);
    if (at < world.now().getTime() - 60_000) throw new Error("that time has passed");
    return ["ChangesLocal"];
  },
  async run([when, act], world) {
    const at = new Date(timeOf(when, world));
    const f = world.store.addFact("Schedule", c("Scheduled", act, ["at", s(at.toISOString())]), USER);
    return c("Scheduled", act, ["at", moment(at)], ...onDay(at, world), ["item", n(f.meta.id)]);
  },
  async check(_args, result, world) {
    const id = role(result, "item");
    return id?.kind === "number" && world.store.facts("Schedule", "Scheduled").some((f) => f.meta.id === id.value);
  },
  // Cancelled by taking back the item it kept (built-ins.md section 2: cancel).
  async inverse(_args, result) {
    const id = role(result, "item");
    return id?.kind === "number" ? c("Remember", c("Retract", c("Fact", id))) : undefined;
  },
};

/**
 * What is scheduled, in time order: Schedule(Scheduled(act, at=moment, due=bool, item=id), ...).
 * Read gives it for Read(Schedule()); the turn uses it to say what has fallen due.
 */
export function readSchedule(world: World): Expr {
  const now = world.now().getTime();
  const items = world.store
    .facts("Schedule", "Scheduled")
    .map((f) => {
      const claim = f.claim as Call;
      const at = role(claim, "at");
      const t = at?.kind === "string" ? Date.parse(at.value) : NaN;
      return { f, act: positional(claim)[0], t };
    })
    .filter((x) => x.act !== undefined && !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  return c("Schedule", ...items.map((x) => c("Scheduled", x.act!, ["at", moment(new Date(x.t))], ...onDay(new Date(x.t), world), ["due", b(x.t <= now)], ["item", n(x.f.meta.id)])));
}
