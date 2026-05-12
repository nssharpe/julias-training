import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest } from "./overload.js";

const loadDef = { sets: 3, repRange: [8, 12], progression: "load", startLoad: 10, loadStep: 2.5 };
const variantDef = { sets: 3, repRange: [20, 40], progression: "variant", variants: ["tuck","adv tuck","straddle"], startVariant: "tuck" };

test("no history → bottom of range at start load", () => {
  const out = suggest([], loadDef);
  assert.deepEqual(out, [
    { reps: 8, load: 10 },
    { reps: 8, load: 10 },
    { reps: 8, load: 10 },
  ]);
});

test("no history (variant) → bottom of range at startVariant", () => {
  const out = suggest([], variantDef);
  assert.equal(out[0].load, "tuck");
  assert.equal(out[0].reps, 20);
});

test("last session below low → repeat same", () => {
  const hist = [{ sets: [{ reps: 7, load: 10 }, { reps: 8, load: 10 }, { reps: 8, load: 10 }] }];
  const out = suggest(hist, loadDef);
  assert.deepEqual(out, [
    { reps: 7, load: 10 },
    { reps: 8, load: 10 },
    { reps: 8, load: 10 },
  ]);
});

test("last hit top once → suggest top reps same load (hold)", () => {
  const hist = [{ sets: [{ reps: 12, load: 10 }, { reps: 12, load: 10 }, { reps: 12, load: 10 }] }];
  const out = suggest(hist, loadDef);
  assert.deepEqual(out, [
    { reps: 12, load: 10 },
    { reps: 12, load: 10 },
    { reps: 12, load: 10 },
  ]);
});

test("hit top twice in a row → load bump and reset reps", () => {
  const hist = [
    { sets: [{ reps: 12, load: 10 }, { reps: 12, load: 10 }, { reps: 12, load: 10 }] },
    { sets: [{ reps: 12, load: 10 }, { reps: 12, load: 10 }, { reps: 12, load: 10 }] },
  ];
  const out = suggest(hist, loadDef);
  assert.deepEqual(out, [
    { reps: 8, load: 12.5 },
    { reps: 8, load: 12.5 },
    { reps: 8, load: 12.5 },
  ]);
});

test("mid-range last → +1 rep per set, capped at high", () => {
  const hist = [{ sets: [{ reps: 9, load: 10 }, { reps: 10, load: 10 }, { reps: 12, load: 10 }] }];
  const out = suggest(hist, loadDef);
  assert.deepEqual(out, [
    { reps: 10, load: 10 },
    { reps: 11, load: 10 },
    { reps: 12, load: 10 },
  ]);
});

test("variant: hit top twice → next variant, reset reps", () => {
  const hist = [
    { sets: [{ reps: 40, load: "tuck" }, { reps: 40, load: "tuck" }, { reps: 40, load: "tuck" }] },
    { sets: [{ reps: 40, load: "tuck" }, { reps: 40, load: "tuck" }, { reps: 40, load: "tuck" }] },
  ];
  const out = suggest(hist, variantDef);
  assert.deepEqual(out, [
    { reps: 20, load: "adv tuck" },
    { reps: 20, load: "adv tuck" },
    { reps: 20, load: "adv tuck" },
  ]);
});

test("variant: top variant stays put if maxed", () => {
  const def = { ...variantDef, variants: ["tuck","adv tuck"] };
  const hist = [
    { sets: [{ reps: 40, load: "adv tuck" }, { reps: 40, load: "adv tuck" }, { reps: 40, load: "adv tuck" }] },
    { sets: [{ reps: 40, load: "adv tuck" }, { reps: 40, load: "adv tuck" }, { reps: 40, load: "adv tuck" }] },
  ];
  const out = suggest(hist, def);
  assert.equal(out[0].load, "adv tuck");
  assert.equal(out[0].reps, 20);
});

test("hit top once at a load that's new (different from prev) → hold, no bump", () => {
  const hist = [
    { sets: [{ reps: 12, load: 10 }, { reps: 12, load: 10 }, { reps: 12, load: 10 }] },
    { sets: [{ reps: 12, load: 12.5 }, { reps: 12, load: 12.5 }, { reps: 12, load: 12.5 }] },
  ];
  const out = suggest(hist, loadDef);
  assert.equal(out[0].load, 12.5);
  assert.equal(out[0].reps, 12);
});
