// What the decide baselines share, built once on first use: the store's learned commands, their man
// pages and WordNet expansion (the same knowledge Noodle has), and the development labels the
// trained ones learn from (scripts/devset.mjs: the exploratory labels minus the holdout, every one
// of them, so a baseline gets all it can use; never the confirmatory set).
import { join } from "node:path";
import { devLabels } from "../../devset.mjs";
import { commandsOf, featurizer, knn, logistic, nameMatch, pagesOf, wordnetOf } from "./models.mjs";
import { slotFill } from "./slots.mjs";

const dist = join(import.meta.dirname, "..", "..", "..", "dist");
let shared;
async function context() {
  if (shared) return shared;
  const { packedStore } = await import(join(dist, "assistant", "index.js"));
  const store = packedStore();
  const commands = commandsOf(store);
  const key = (a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim();
  const train = devLabels({ maxWords: 150 })
    .filter((l) => !l.tooLong)
    .map((l) => ({ text: l.text, want: [...new Set((l.acts ?? []).map(key).filter(Boolean))] }));
  shared = { store, commands, train, pages: undefined, expand: undefined };
  return shared;
}

/** Command-name match with the slot filler. */
export const nameMatchBaseline = () => ({
  name: "name match + slots",
  role: "name-match",
  async predict(item) {
    const { commands } = await context();
    return slotFill(nameMatch(item.text ?? "", commands), item);
  },
});

/** A trained act model ("knn", or the word classifier with man-page and WordNet features) with the slot filler. */
export function trainedBaseline(kind, { man = false, wn = false } = {}) {
  let predictLabels;
  return {
    name: `${kind}${man ? "+man" : ""}${wn ? "+wn" : ""} + slots`,
    role: "trained",
    async predict(item) {
      if (!predictLabels) {
        const ctx = await context();
        if (kind === "knn") predictLabels = knn(ctx.train);
        else {
          if (man) ctx.pages ??= pagesOf(ctx.commands);
          if (wn) ctx.expand ??= wordnetOf(ctx.store);
          const feat = featurizer({ pages: ctx.pages ?? [], man, expand: wn ? ctx.expand : undefined });
          const model = logistic(ctx.train.map((x) => feat(x.text)), ctx.train.map((x) => x.want), ctx.train.map((_, k) => k));
          predictLabels = (text) => model(feat(text));
        }
      }
      return slotFill(predictLabels(item.text ?? ""), item);
    },
  };
}
