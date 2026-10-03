import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { actSet, perceptron, predict, target, topProbability, fitTemperature } from "./train.mjs";

const { Weights } = await import(join(import.meta.dirname, "..", "dist", "runtime", "score.js"));
const seedWeights = () => new Weights({ factsWithHead: () => [], facts: () => [] });

// Two readings of "send it up": one that pushes (the gold), one that pulls; the pull wins at first.
const cand = (f, acts) => ({ f: Object.entries(f), acts: acts.map((a) => [a]) });
const push = cand({ "Evidence:send-push": 1, ReachedAct: 1 }, ["git push"]);
const pull = cand({ "Evidence:send-pull": 1, ReachedAct: 1, WordsUsed: 1 }, ["git pull"]);
const nothing = cand({ Unworked: 1 }, []);

test("the target is the best choice whose acts are exactly the gold, across segments", () => {
  const w = seedWeights();
  assert.deepEqual(target([{ cands: [pull, push] }], ["git push"], w.get), [push]);
  assert.equal(target([{ cands: [pull] }], ["git push"], w.get), undefined);
  // Two segments: neither may pull, and together they push.
  const two = target([{ cands: [pull, push] }, { cands: [push, nothing] }], ["git push"], w.get);
  assert.deepEqual(actSet(two.flatMap((c) => c.acts), ["git push"]), ["git push"]);
  assert.deepEqual(target([{ cands: [nothing, pull] }], [], w.get), [nothing]);
  // A two-word subcommand counts where the gold names it so.
  assert.deepEqual(actSet([["gh pr", "gh pr-view"]], ["gh pr-view"]), ["gh pr-view"]);
});

test("the perceptron moves toward the target, caps steps, averages, and leaves seed weights alone", () => {
  const base = seedWeights();
  const examples = [{ segs: [{ cands: [pull, push] }], gold: ["git push"] }];
  assert.deepEqual(predict(examples[0].segs, base.get), [pull]);
  const { weights, stats } = perceptron(base, examples, { epochs: 3, seed: 1 });
  assert.deepEqual(predict(examples[0].segs, weights.get), [push]);
  assert.equal(stats[0].mistakes, 1);
  assert.equal(stats[2].mistakes, 0);
  for (const [, v] of weights.learned) assert.ok(Math.abs(v) <= 1 * 4 + 1e-9);
  assert.equal(base.learned.size, 0);
  // The same seed gives the same weights.
  assert.deepEqual([...perceptron(base, examples, { epochs: 3, seed: 1 }).weights.learned], [...weights.learned]);
});

test("calibration: the winner's softmax probability and a fitted temperature", () => {
  const w = seedWeights();
  w.learned.set("Evidence:send-push", 2);
  const segs = [{ cands: [push, pull] }];
  assert.ok(topProbability(segs, w.get, 1) > 0.5);
  const fit = fitTemperature([{ segs, right: true }, { segs, right: false }], w.get);
  assert.ok(fit.T > 0 && Number.isFinite(fit.loss));
});
