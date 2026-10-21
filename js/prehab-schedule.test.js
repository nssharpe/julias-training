import { test } from "node:test";
import assert from "node:assert/strict";
import { isDueOn, dueDateOn, doneDatesById, weekCompletion, everyOf } from "./prehab-config.js";

const day = (date, items) => ({ date, data: { items } });
const every3 = { id: "a", sets: 3, every: 3 };

test("legacy groups map to every 1 / every 2", () => {
  assert.equal(everyOf({ group: "daily" }), 1);
  assert.equal(everyOf({ group: "alt" }), 2);
  assert.equal(everyOf({ group: "alt", every: 4 }), 4);
});

test("never done → due", () => {
  assert.equal(isDueOn(every3, "2026-10-20", []), true);
});

test("done with ≥1 set → next due `every` days later", () => {
  const done = doneDatesById([day("2026-10-10", { a: [true, false, false] })]).a;
  assert.equal(dueDateOn(every3, "2026-10-11", done), "2026-10-13");
  assert.equal(isDueOn(every3, "2026-10-11", done), false);
  assert.equal(isDueOn(every3, "2026-10-12", done), false);
  assert.equal(isDueOn(every3, "2026-10-13", done), true);
});

test("zero sets on the due day → carried over until done", () => {
  const range = [
    day("2026-10-10", { a: [true, true, true] }),
    day("2026-10-13", { a: [false, false, false] }), // due, skipped
  ];
  const done = doneDatesById(range).a;
  assert.equal(isDueOn(every3, "2026-10-14", done), true);
  assert.equal(isDueOn(every3, "2026-10-17", done), true); // still once, not doubled
  // Done on the 15th → next due the 18th.
  const done2 = doneDatesById([...range, day("2026-10-15", { a: [true] })]).a;
  assert.equal(isDueOn(every3, "2026-10-16", done2), false);
  assert.equal(isDueOn(every3, "2026-10-18", done2), true);
});

test("since / until respected", () => {
  assert.equal(isDueOn({ ...every3, since: "2026-10-21" }, "2026-10-20", []), false);
  assert.equal(isDueOn({ ...every3, until: "2026-10-20" }, "2026-10-20", []), false);
});

test("7-day completion counts sets on each assigned day", () => {
  const items = [{ id: "d", sets: 2, every: 1 }];
  const range = [];
  // Days 14..20: full on 6 days, nothing on the 20th.
  for (let d = 14; d <= 19; d++) range.push(day(`2026-10-${d}`, { d: [true, true] }));
  assert.equal(weekCompletion(items, range, "2026-10-20"), Math.round((12 / 14) * 100));
});

test("7-day completion: carried-over item counts once", () => {
  const items = [{ id: "a", sets: 1, every: 7, since: "2026-10-14" }];
  // Due 14th, carried over until done on the 17th → one assignment, done.
  const range = [day("2026-10-17", { a: [true] })];
  assert.equal(weekCompletion(items, range, "2026-10-20"), 100);
  // Still not done by today → one assignment, not done.
  assert.equal(weekCompletion(items, [], "2026-10-20"), 0);
});

test("7-day completion: partial sets on the done day count", () => {
  const items = [{ id: "a", sets: 3, every: 2, since: "2026-10-14" }];
  // Due 14th, carried to 15th, 1 of 3 sets on 15th → next due 17th, 3/3 on 17th,
  // next due 19th, carried through 20th → 3 assignments: (1 + 3 + 0) / 9.
  const range = [day("2026-10-15", { a: [true, false, false] }), day("2026-10-17", { a: [true, true, true] })];
  assert.equal(weekCompletion(items, range, "2026-10-20"), Math.round((4 / 9) * 100));
});
