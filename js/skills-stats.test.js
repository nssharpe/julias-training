import { test } from "node:test";
import assert from "node:assert/strict";
import { hitRate, sortSkills, applySave, lastPracticed } from "./skills-stats.js";

const skill = { name: "Kip", days: {
  "2026-10-20": { hits: 3, misses: 1 },  // today
  "2026-10-14": { hits: 1, misses: 1 },  // 7th day back → in week
  "2026-10-13": { hits: 5, misses: 5 },  // 8th day back → month only
  "2026-08-01": { hits: 10, misses: 0 }, // all time only
} };

test("week / month / all-time windows", () => {
  assert.deepEqual(hitRate(skill, "2026-10-20", 7), { hits: 4, total: 6, pct: 67 });
  assert.deepEqual(hitRate(skill, "2026-10-20", 30), { hits: 9, total: 16, pct: 56 });
  assert.deepEqual(hitRate(skill, "2026-10-20"), { hits: 19, total: 26, pct: 73 });
  assert.equal(hitRate({ days: {} }, "2026-10-20", 7).pct, null);
});

test("saves add up within a day, and undo removes exactly one save", () => {
  let s = applySave({ name: "x" }, "2026-10-20", 3, 1);
  s = applySave(s, "2026-10-20", 2, 0);
  assert.deepEqual(s.days["2026-10-20"], { hits: 5, misses: 1 });
  s = applySave(s, "2026-10-20", 2, 0, -1);
  assert.deepEqual(s.days["2026-10-20"], { hits: 3, misses: 1 });
  s = applySave(s, "2026-10-20", 3, 1, -1);
  assert.equal(s.days["2026-10-20"], undefined);
  assert.equal(lastPracticed(s), null);
});

test("most recently practiced first, never-practiced last alphabetically", () => {
  const list = [
    { name: "Zed", days: {} },
    { name: "Old", days: { "2026-09-01": { hits: 1, misses: 0 } } },
    { name: "Abe", days: {} },
    { name: "New", days: { "2026-10-19": { hits: 0, misses: 2 } } },
  ];
  assert.deepEqual(sortSkills(list).map(s => s.name), ["New", "Old", "Abe", "Zed"]);
});
