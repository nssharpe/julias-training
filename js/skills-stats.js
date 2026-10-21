import { addDays } from "./prehab-config.js";

export const EVENTS = ["VT", "UB", "BB", "FX", "PH", "SR", "PB", "HB"];

// Hit totals for the `days` window ending today (inclusive); days = null → all time.
export function hitRate(skill, todayKey, days = null) {
  const from = days == null ? "" : addDays(todayKey, -(days - 1));
  let hits = 0, misses = 0;
  for (const [date, d] of Object.entries(skill.days || {})) {
    if (date < from || date > todayKey) continue;
    hits += d.hits || 0;
    misses += d.misses || 0;
  }
  const total = hits + misses;
  return { hits, total, pct: total ? Math.round((hits / total) * 100) : null };
}

export function lastPracticed(skill) {
  let last = null;
  for (const [date, d] of Object.entries(skill.days || {})) {
    if ((d.hits || 0) + (d.misses || 0) > 0 && (!last || date > last)) last = date;
  }
  return last;
}

// Most recently practiced first; never-practiced skills last, alphabetically.
export function sortSkills(skills) {
  return [...skills].sort((a, b) => {
    const la = lastPracticed(a), lb = lastPracticed(b);
    if (la !== lb) return !la ? 1 : !lb ? -1 : la < lb ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

// Adds (or with sign -1, removes) one save's counts to a day. Returns a new skill.
export function applySave(skill, dateKey, hits, misses, sign = 1) {
  const cur = skill.days?.[dateKey] || { hits: 0, misses: 0 };
  const next = {
    hits: Math.max(0, (cur.hits || 0) + sign * hits),
    misses: Math.max(0, (cur.misses || 0) + sign * misses),
  };
  const days = { ...(skill.days || {}) };
  if (next.hits + next.misses === 0) delete days[dateKey];
  else days[dateKey] = next;
  return { ...skill, days };
}
