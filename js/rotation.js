import { addDays } from "./prehab-config.js";

// Mobility body-part rotation. One selected part is "up" at a time and stays up
// (carried over day to day) until a session of it is logged on or after its due
// date; the next selected part then falls due GAP_DAYS after that session.
//
// Stored at meta/state.mobilityRotation = { parts: [id...], current, dueDate,
// lastDone?: { part, date } }. "Logged" comes from each program's last-logged
// date in state, so nothing else needs tracking.

export const GAP_DAYS = 2;

export const PARTS = [
  { id: "pike", label: "Pike", lastDateKey: "mobilityLastDate" },
  { id: "shoulder", label: "Shoulder", lastDateKey: "shoulderLastDate" },
  { id: "frontsplit", label: "Front Split", lastDateKey: "frontSplitLastDate" },
];

const canonical = ids => PARTS.map(p => p.id).filter(id => ids.includes(id));

function nextAfter(parts, id) {
  const order = PARTS.map(p => p.id);
  const start = order.indexOf(id);
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(start + i) % order.length];
    if (parts.includes(cand)) return cand;
  }
  return parts[0];
}

// Roll the rotation forward past any part that's been done. `lastDates` maps
// part id → last date (YYYY-MM-DD) a session of it was logged.
export function advanceRotation(rot, lastDates) {
  if (!rot?.parts?.length) return rot || null;
  let r = { ...rot, parts: canonical(rot.parts) };
  if (!r.parts.includes(r.current)) r.current = r.parts[0];
  for (let guard = 0; guard < 10; guard++) {
    const last = lastDates[r.current];
    if (!last || last < r.dueDate) break;
    r = { ...r, lastDone: { part: r.current, date: last }, current: nextAfter(r.parts, r.current), dueDate: addDays(last, GAP_DAYS) };
  }
  return r;
}

// Turn a part on or off. Adding the first part starts it today; removing the
// current part hands its slot (and due date) to the next selected part.
export function togglePart(rot, id, todayKey) {
  const parts = rot?.parts || [];
  if (parts.includes(id)) {
    const left = parts.filter(p => p !== id);
    if (!left.length) return { parts: [], current: null, dueDate: null, lastDone: rot.lastDone };
    return { ...rot, parts: canonical(left), current: rot.current === id ? nextAfter(left, id) : rot.current };
  }
  if (!parts.length) return { ...(rot || {}), parts: [id], current: id, dueDate: todayKey };
  return { ...rot, parts: canonical([...parts, id]) };
}
