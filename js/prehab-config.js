// Merges the static pre-hab list in program.json with the user's saved edits,
// additions, deletions and ordering (users/{uid}/meta/prehabConfig).
//
// Config shape:
//   {
//     items: { [id]: { name?, sets?, reps?, load?, rest?, tempo?, group?, every?,
//                      since?, until?, custom? } },
//     order: [id, ...]
//   }
//
// A patch on a program.json id overrides those fields; `custom: true` marks an
// entry the user created from scratch. Deletion is soft: `until` is the date the
// item stopped counting, so history (streak / compliance) stays intact.

const REGION_RANK = { shoulder: 0, ankle: 2 };

export const EMPTY_CONFIG = { items: {}, order: [] };

// Full merged list — every item that has ever existed, in display order.
// Date filtering is a separate step (see isActiveOn / isDueOn).
export function buildPrehabItems(program, config) {
  const patches = config?.items || {};

  const base = [
    ...program.prehab.daily.map(x => ({ ...x, group: "daily" })),
    ...program.prehab.alternating.map(x => ({ ...x, group: "alt" })),
  ];
  // Default order is the old region grouping (shoulders, untagged, ankles), so
  // the list looks unchanged for a user who has never reordered anything.
  base.sort((a, b) => (REGION_RANK[a.region] ?? 1) - (REGION_RANK[b.region] ?? 1));

  const known = new Set(base.map(x => x.id));
  const custom = Object.keys(patches)
    .filter(id => patches[id].custom && !known.has(id))
    .map(id => ({ id, group: "daily", sets: 3, reps: "", load: "", rest: "", tempo: "" }));

  const all = [...base, ...custom].map(it => ({ ...it, ...patches[it.id] }));

  // Explicit order wins; anything not in it (e.g. a newly shipped program.json
  // item) keeps its default position, appended after the ordered block.
  const order = config?.order || [];
  const fallback = new Map(all.map((it, i) => [it.id, order.length + i]));
  const rankOf = it => {
    const i = order.indexOf(it.id);
    return i === -1 ? fallback.get(it.id) : i;
  };
  all.sort((a, b) => rankOf(a) - rankOf(b));
  return all;
}

// `since` is inclusive (counts from that day on), `until` is exclusive (the day
// it was deleted it no longer counts — it isn't in the UI to be completed).
export function isActiveOn(it, dateKey) {
  if (it.since && it.since > dateKey) return false;
  if (it.until && it.until <= dateKey) return false;
  return true;
}

// Daily items that counted towards the streak / compliance on a given date.
export function dailyItemsOn(items, dateKey) {
  return items.filter(it => it.group !== "alt" && isActiveOn(it, dateKey));
}

// ─── Scheduling ─────────────────────────────────────────────────────────────
// Each item repeats every `every` days (older configs: daily = 1, alt = 2). It
// is due from (last day with ≥1 set done) + every. If it isn't touched on a due
// day it simply stays due — carried over day to day, never doubled — until at
// least one set is done, which restarts the countdown from that day.
// Everything is derived from the per-day history, so no extra state is stored.

export function everyOf(it) {
  const n = Math.round(Number(it.every));
  if (n >= 1) return n;
  return it.group === "alt" ? 2 : 1;
}

export function setsDoneOf(saved) {
  return Array.isArray(saved) ? saved.filter(Boolean).length : 0;
}

export function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86400000);
}

export function addDays(dateKey, n) {
  const d = new Date(Date.parse(dateKey) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// range: [{ date, data: { items: { [id]: [bool, ...] } } }] → { [id]: [dates asc] }
export function doneDatesById(range) {
  const out = {};
  for (const day of [...range].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const [id, saved] of Object.entries(day.data?.items || {})) {
      if (setsDoneOf(saved) > 0) (out[id] ||= []).push(day.date);
    }
  }
  return out;
}

// The date the item next falls due, looking only at history before `dateKey`.
// null = never done (due from the day it became active).
export function dueDateOn(it, dateKey, doneDates) {
  const prior = (doneDates || []).filter(d => d < dateKey);
  if (prior.length === 0) return it.since || null;
  return addDays(prior[prior.length - 1], everyOf(it));
}

export function isDueOn(it, dateKey, doneDates) {
  if (!isActiveOn(it, dateKey)) return false;
  const due = dueDateOn(it, dateKey, doneDates);
  return due === null || due <= dateKey;
}

// % of assigned sets done over the 7 days ending `todayKey`. An item carried
// over several days is one assignment, not one per day: it counts once, and
// gets credit for the sets done on the day it was finally done.
export function weekCompletion(items, range, todayKey) {
  const done = doneDatesById(range);
  const byDate = new Map(range.map(r => [r.date, r.data?.items || {}]));
  let assigned = 0, completed = 0;
  for (const it of items) {
    const sets = Math.max(1, Number(it.sets) || 1);
    let carrying = false; // due yesterday and untouched → today is the same assignment
    for (let i = 6; i >= 0; i--) {
      const day = addDays(todayKey, -i);
      if (!isDueOn(it, day, done[it.id])) { carrying = false; continue; }
      const setsDone = setsDoneOf((byDate.get(day) || {})[it.id]);
      if (!carrying) assigned += sets;
      completed += Math.min(sets, setsDone);
      carrying = setsDone === 0;
    }
  }
  return assigned === 0 ? null : Math.round((completed / assigned) * 100);
}

export function newPrehabId() {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
