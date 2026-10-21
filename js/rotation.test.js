import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceRotation, togglePart } from "./rotation.js";

const rot = { parts: ["pike", "frontsplit"], current: "pike", dueDate: "2026-10-20" };

test("current part stays up until it's logged", () => {
  assert.deepEqual(advanceRotation(rot, {}), rot);
  assert.deepEqual(advanceRotation(rot, { pike: "2026-10-18" }), rot); // logged before due
});

test("logging the current part → next part due 2 days later", () => {
  const r = advanceRotation(rot, { pike: "2026-10-22" });
  assert.equal(r.current, "frontsplit");
  assert.equal(r.dueDate, "2026-10-24");
  assert.deepEqual(r.lastDone, { part: "pike", date: "2026-10-22" });
});

test("wraps around, and a single part repeats every 2 days", () => {
  const r = advanceRotation({ ...rot, current: "frontsplit" }, { frontsplit: "2026-10-20" });
  assert.equal(r.current, "pike");
  const one = advanceRotation({ parts: ["shoulder"], current: "shoulder", dueDate: "2026-10-20" }, { shoulder: "2026-10-20" });
  assert.equal(one.current, "shoulder");
  assert.equal(one.dueDate, "2026-10-22");
});

test("toggling parts", () => {
  const a = togglePart(null, "frontsplit", "2026-10-20");
  assert.deepEqual(a, { parts: ["frontsplit"], current: "frontsplit", dueDate: "2026-10-20" });
  const b = togglePart(a, "pike", "2026-10-20");
  assert.deepEqual(b.parts, ["pike", "frontsplit"]);
  assert.equal(b.current, "frontsplit");
  const c = togglePart(b, "frontsplit", "2026-10-20");
  assert.equal(c.current, "pike");
  assert.equal(c.dueDate, "2026-10-20");
});
