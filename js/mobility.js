import { loadProgram } from "./program.js";
import { getState, setState, getMobilityDay, setMobilityDay, isoDay } from "./db.js";

// The MFTK program auto-advances one phase every `sessionsPerPhase` (8) logged
// sessions, then cycles back to Phase 1 for a fresh round. We keep a running
// count of completed session-days in state (mobilitySessions / mobilityLastDate),
// bumped once on the first logged entry each day. The current phase is derived
// from that count, so it advances on its own and is stable for the whole day —
// without re-reading months of history on every open.

export async function renderMobility(root) {
  const [program, state, todayDoc] = await Promise.all([
    loadProgram(),
    getState(),
    getMobilityDay(isoDay()),
  ]);
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

  root.innerHTML = "";

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
    const card = document.createElement("article");
    card.className = "card";

    const head2 = `
      <h2><span class="order">${escapeHtml(ex.order)}</span> ${escapeHtml(ex.name)}</h2>
      <div class="meta">${formatRx(ex.prescription)}</div>
      ${ex.videoUrl ? `<a class="video" href="${escapeAttr(ex.videoUrl)}" target="_blank" rel="noopener">▶ Watch video</a>` : ""}
    `;
    card.innerHTML = head2;

    const sets = document.createElement("div");
    if (ex.inputType === "check") {
      sets.className = "checks";
      for (let i = 0; i < ex.defaultSets; i++) {
        const on = Boolean(entry.sets[i]?.checked);
        const btn = document.createElement("button");
        btn.className = "check" + (on ? " on" : "");
        btn.textContent = on ? "✓" : String(i + 1);
        btn.onclick = async () => {
          const cur = ensureSets(entries[ex.key] || entry, ex.defaultSets);
          cur[i] = { checked: !cur[i]?.checked };
          entries[ex.key] = { sets: cur };
          btn.classList.toggle("on", cur[i].checked);
          btn.textContent = cur[i].checked ? "✓" : String(i + 1);
          if (cur[i].checked) await countSessionOnce();
          await setMobilityDay(today, { phaseId: phase.id, entries });
        };
        sets.appendChild(btn);
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
          const cur = ensureSets(entries[ex.key] || entry, ex.defaultSets);
          cur[i] = {
            reps: numOrNull(repsIn.value),
            ...(hasWeight ? { weight: numOrNull(wIn.value) } : {}),
            ...(hasMeas ? { measurement: ex.measurement.type === "number" ? numOrNull(mIn.value) : (mIn.value || "") } : {}),
          };
          entries[ex.key] = { sets: cur };
          if (cur[i] && (cur[i].reps != null || cur[i].weight != null || (cur[i].measurement != null && cur[i].measurement !== ""))) {
            await countSessionOnce();
          }
          await setMobilityDay(today, { phaseId: phase.id, entries });
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
    root.appendChild(card);
  }
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
