import { loadProgram } from "./program.js";
import {
  getState, setState, getMobilityDay, setMobilityDay, isoDay,
  getShoulderDay, setShoulderDay,
} from "./db.js";

// The Mobility tab hosts two sub-programs, switchable via a sub-tab row:
//   • Pike (MFTK) — auto-advances one phase every `sessionsPerPhase` (8) logged
//     sessions, then cycles back to Phase 1. One doc per day.
//   • Shoulder Flexion — a fixed routine logged per session (1–2×/week), no
//     phase rotation. Stored in its own collection so it never collides with a
//     Pike day doc.
// Active sub-tab is module-level (resets to Pike on each page load).

let activeGroup = "pike";

export async function renderMobility(root) {
  const program = await loadProgram();
  root.innerHTML = "";

  // Sub-tab switcher (Pike / Shoulder).
  const switcher = document.createElement("div");
  switcher.className = "subtab";
  for (const [id, label] of [["pike", "Pike"], ["shoulder", "Shoulder"]]) {
    const b = document.createElement("button");
    b.className = "subtabbtn" + (activeGroup === id ? " active" : "");
    b.textContent = label;
    b.onclick = () => { activeGroup = id; renderMobility(root); };
    switcher.appendChild(b);
  }
  root.appendChild(switcher);

  const body = document.createElement("div");
  root.appendChild(body);

  if (activeGroup === "shoulder") await renderShoulder(body, program);
  else await renderPike(body, program);
}

// ─── Pike (MFTK) ────────────────────────────────────────────────────────────
// The phase auto-advances every `sessionsPerPhase` logged sessions. We keep a
// running count of completed session-days in state (mobilitySessions /
// mobilityLastDate), bumped once on the first logged entry each day. The current
// phase is derived from that count, so it advances on its own and is stable for
// the whole day — without re-reading months of history on every open.
async function renderPike(root, program) {
  const [state, todayDoc] = await Promise.all([getState(), getMobilityDay(isoDay())]);
  const mob = program.mobility;
  const today = isoDay();

  // Prior sessions = everything before today. If today is already counted, back
  // it out so the phase/session number stays put for the whole day.
  let countedToday = state.mobilityLastDate === today;
  const totalSessions = state.mobilitySessions || 0;
  const priorSessions = countedToday ? totalSessions - 1 : totalSessions;
  const per = mob.sessionsPerPhase || 8;
  const nPhases = mob.phases.length;
  const phaseIdx = Math.floor(priorSessions / per) % nPhases;
  const cycle = Math.floor(priorSessions / (per * nPhases)) + 1;
  const sessionInPhase = (priorSessions % per) + 1;
  const phase = mob.phases[phaseIdx];
  const nextPhase = mob.phases[(phaseIdx + 1) % nPhases];

  // Called on the first logged entry of the day to advance the session counter.
  async function countSessionOnce() {
    if (countedToday) return;
    countedToday = true;
    await setState({ mobilitySessions: (state.mobilitySessions || 0) + 1, mobilityLastDate: today });
  }

  const entries = todayDoc.entries || {};

  const head = document.createElement("div");
  head.className = "phase-strip";
  const lastOfPhase = sessionInPhase >= per;
  head.innerHTML = `
    <div><span class="phase-name">${escapeHtml(phase.name)}</span> · session ${sessionInPhase} of ${per}${cycle > 1 ? ` · cycle ${cycle}` : ""}</div>
    <div>${lastOfPhase ? "next: " + escapeHtml(nextPhase.name) : ""}</div>
  `;
  root.appendChild(head);

  for (const ex of phase.exercises) {
    const entry = entries[ex.key] || { sets: [] };
    const persist = async (sets, hasData) => {
      entries[ex.key] = { sets };
      if (hasData) await countSessionOnce();
      await setMobilityDay(today, { phaseId: phase.id, entries });
    };
    root.appendChild(buildExerciseCard(ex, entry, persist));
  }
}

// ─── Shoulder Flexion ───────────────────────────────────────────────────────
// Fixed routine, logged per session. No phase rotation, no session counter
// (Tracking derives sessions/week straight from the stored range).
async function renderShoulder(root, program) {
  const today = isoDay();
  const doc = await getShoulderDay(today);
  const sh = program.shoulder;
  const entries = doc.entries || {};

  const head = document.createElement("div");
  head.className = "phase-strip";
  head.innerHTML = `<div><span class="phase-name">${escapeHtml(sh.name)}</span>${sh.cadence ? ` · ${escapeHtml(sh.cadence)}` : ""}</div>`;
  root.appendChild(head);

  for (const ex of sh.exercises) {
    const entry = entries[ex.key] || { sets: [] };
    const persist = async (sets) => {
      entries[ex.key] = { sets };
      await setShoulderDay(today, { entries });
    };
    root.appendChild(buildExerciseCard(ex, entry, persist));
  }
}

// ─── Shared exercise card ───────────────────────────────────────────────────
// `persist(sets, hasData)` is called whenever the user changes a value. `hasData`
// is true when the changed set holds real data (used by Pike to bump its session
// counter; ignored by Shoulder).
function buildExerciseCard(ex, entry, persist) {
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <h2><span class="order">${escapeHtml(ex.order)}</span> ${escapeHtml(ex.name)}</h2>
    <div class="meta">${formatRx(ex.prescription)}</div>
    ${ex.note ? `<div class="note">${escapeHtml(ex.note)}</div>` : ""}
    ${ex.videoUrl ? `<a class="video" href="${escapeAttr(ex.videoUrl)}" target="_blank" rel="noopener">▶ Watch video</a>` : ""}
  `;

  const sets = document.createElement("div");

  if (ex.inputType === "check") {
    sets.className = "checks";
    for (let i = 0; i < ex.defaultSets; i++) {
      const on = Boolean(entry.sets[i]?.checked);
      const btn = document.createElement("button");
      btn.className = "check" + (on ? " on" : "");
      btn.textContent = on ? "✓" : String(i + 1);
      btn.onclick = async () => {
        const cur = ensureSets(entry, ex.defaultSets);
        cur[i] = { checked: !cur[i]?.checked };
        entry.sets = cur;
        btn.classList.toggle("on", cur[i].checked);
        btn.textContent = cur[i].checked ? "✓" : String(i + 1);
        await persist(cur, cur[i].checked);
      };
      sets.appendChild(btn);
    }
  } else if (ex.inputType === "timeNotes") {
    sets.className = "msets";
    sets.style.gridTemplateColumns = "32px 1fr 2fr";
    sets.insertAdjacentHTML("beforeend", `<div class="hdr">#</div><div class="hdr">Time (s)</div><div class="hdr">Notes</div>`);
    for (let i = 0; i < ex.defaultSets; i++) {
      const s = entry.sets[i] || {};
      const idx = document.createElement("div"); idx.className = "idx"; idx.textContent = String(i + 1);
      sets.appendChild(idx);
      const timeIn = mkInput("number", "s", s.time);
      const notesIn = mkInput("text", "notes", s.notes);
      const save = debounce(async () => {
        const cur = ensureSets(entry, ex.defaultSets);
        cur[i] = { time: numOrNull(timeIn.value), notes: notesIn.value || "" };
        entry.sets = cur;
        const hasData = cur[i].time != null || cur[i].notes !== "";
        await persist(cur, hasData);
      }, 400);
      for (const inp of [timeIn, notesIn]) {
        inp.addEventListener("input", save);
        inp.addEventListener("change", save.flush);
        sets.appendChild(inp);
      }
    }
  } else {
    const hasWeight = ex.inputType === "repsWeightMeasurement";
    const hasMeas = ex.measurement != null;
    const cols = ["32px", "1fr", hasWeight ? "1fr" : "", hasMeas ? "1fr" : ""].filter(Boolean).join(" ");
    sets.className = "msets";
    sets.style.gridTemplateColumns = cols;
    const repsLabel = /s$/.test(ex.prescription.reps || "") ? "Secs" : "Reps";
    sets.insertAdjacentHTML("beforeend",
      `<div class="hdr">#</div><div class="hdr">${repsLabel}</div>` +
      (hasWeight ? `<div class="hdr">Wt (lb)</div>` : "") +
      (hasMeas ? `<div class="hdr">${escapeHtml(ex.measurement.label)}</div>` : "")
    );
    const repsPh = (ex.prescription.reps || "").replace(/[^\d]/g, "") || "–";
    for (let i = 0; i < ex.defaultSets; i++) {
      const s = entry.sets[i] || {};
      const idx = document.createElement("div"); idx.className = "idx"; idx.textContent = String(i + 1);
      sets.appendChild(idx);
      const repsIn = mkInput("number", repsPh, s.reps);
      const wIn = hasWeight ? mkInput("number", "lb", s.weight) : null;
      const mIn = hasMeas ? mkInput(ex.measurement.type === "number" ? "number" : "text", ex.measurement.label.toLowerCase(), s.measurement) : null;
      const save = debounce(async () => {
        const cur = ensureSets(entry, ex.defaultSets);
        cur[i] = {
          reps: numOrNull(repsIn.value),
          ...(hasWeight ? { weight: numOrNull(wIn.value) } : {}),
          ...(hasMeas ? { measurement: ex.measurement.type === "number" ? numOrNull(mIn.value) : (mIn.value || "") } : {}),
        };
        entry.sets = cur;
        const hasData = cur[i].reps != null || cur[i].weight != null || (cur[i].measurement != null && cur[i].measurement !== "");
        await persist(cur, hasData);
      }, 400);
      for (const inp of [repsIn, wIn, mIn]) {
        if (!inp) continue;
        inp.addEventListener("input", save);
        inp.addEventListener("change", save.flush);
        sets.appendChild(inp);
      }
    }
  }

  card.appendChild(sets);
  return card;
}

function ensureSets(entry, n) {
  const sets = Array.isArray(entry.sets) ? entry.sets.slice() : [];
  while (sets.length < n) sets.push({});
  return sets;
}
function mkInput(type, placeholder, value) {
  const inp = document.createElement("input");
  inp.type = type;
  if (type === "number") inp.inputMode = "decimal";
  inp.placeholder = placeholder;
  if (value != null && value !== "") inp.value = String(value);
  return inp;
}
function numOrNull(v) { return v === "" || v == null ? null : Number(v); }
function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}
function formatRx(p) {
  const bits = [];
  if (p.reps && p.reps !== "—") bits.push(p.reps);
  if (p.tempo && p.tempo !== "—") bits.push(p.tempo);
  if (p.sets && p.sets !== "—") bits.push(`${p.sets} sets`);
  if (p.rest && p.rest !== "—") bits.push(`rest ${p.rest}`);
  return bits.join(" · ");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
