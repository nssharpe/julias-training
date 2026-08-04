// Merges the static pre-hab list in program.json with the user's saved edits,
// additions, deletions and ordering (users/{uid}/meta/prehabConfig).
//
// Config shape:
//   {
//     items: { [id]: { name?, sets?, reps?, load?, rest?, tempo?, group?,
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
// Date filtering is a separate step (see isActiveOn / visiblePrehabItems).
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

// What to draw for a given day. `showAlt` includes the every-other-day items.
export function visiblePrehabItems(items, dateKey, showAlt) {
  return items.filter(it => isActiveOn(it, dateKey) && (it.group !== "alt" || showAlt));
}

// Daily items that counted towards the streak / compliance on a given date.
export function dailyItemsOn(items, dateKey) {
  return items.filter(it => it.group !== "alt" && isActiveOn(it, dateKey));
}

export function newPrehabId() {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
