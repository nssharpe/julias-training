import { loadProgram, locate } from "./program.js";
import { getState, setState, saveSession, getHistoryForExercise, isoDay } from "./db.js";
import { suggest } from "./overload.js";
import { toast } from "./app.js";

let cursorOffset = 0; // 0 = current; -1 = prev; +1 = next

export async function renderStrength(root, phaseStrip) {
  const program = await loadProgram();
  const state = await getState();
  const navState = { ...state, queueIndex: state.queueIndex + cursorOffset };
  const loc = locate(program, navState);

  renderPhaseStrip(phaseStrip, loc, program);

  root.innerHTML = "";

  // Superset nav
  const nav = document.createElement("div");
  nav.className = "ss-nav";
  nav.innerHTML = `
    <button class="ghost" id="ss-prev">‹ ${escapeHtml(loc.prev.label)}</button>
    <div class="current">${escapeHtml(loc.current.label)} — ${cursorOffset === 0 ? "current" : (cursorOffset < 0 ? "previous" : "next")}</div>
    <button class="ghost" id="ss-next">${escapeHtml(loc.next.label)} ›</button>
  `;
  root.appendChild(nav);
  nav.querySelector("#ss-prev").onclick = () => { cursorOffset--; renderStrength(root, phaseStrip); };
  nav.querySelector("#ss-next").onclick = () => { cursorOffset++; renderStrength(root, phaseStrip); };

  // Two exercise cards
  const cardsWrap = document.createElement("div");
  root.appendChild(cardsWrap);

  const cardEls = [];
  for (const ex of loc.current.exercises) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.exerciseId = ex.id;
    card.innerHTML = `
      <h2>${escapeHtml(ex.name)}</h2>
      <div class="meta">${ex.sets} × ${ex.repRange[0]}–${ex.repRange[1]} ${ex.unit} · rest ${ex.rest}s · tempo ${escapeHtml(ex.tempo || "—")}</div>
      <div class="last" data-last>Loading history…</div>
      <div class="sets">
        <div class="hdr">#</div><div class="hdr">${ex.unit === "sec" ? "Seconds" : "Reps"}</div><div class="hdr">${ex.progression === "variant" ? "Variant" : "Load (lb)"}</div>
        ${Array.from({ length: ex.sets }).map((_, i) => `
          <div class="idx">${i + 1}</div>
          <input type="number" inputmode="numeric" data-set="${i}" data-field="reps" placeholder="–" />
          <input type="${ex.progression === "variant" ? "text" : "number"}" inputmode="${ex.progression === "variant" ? "text" : "decimal"}" data-set="${i}" data-field="load" placeholder="–" />
        `).join("")}
      </div>
    `;
    cardsWrap.appendChild(card);
    cardEls.push({ ex, el: card });
  }

  // Done bar
  const bar = document.createElement("div");
  bar.className = "done-bar";
  bar.innerHTML = `<button class="primary" id="done">Log superset</button>`;
  root.appendChild(bar);

  // Populate history + suggestions per card
  const draft = loadDraft(loc.current.id);
  for (const { ex, el } of cardEls) {
    const history = await getHistoryForExercise(ex.id, 5);
    const lastEl = el.querySelector("[data-last]");
    if (history.length === 0) {
      lastEl.textContent = "First time — go gently.";
    } else {
      const last = history[history.length - 1];
      lastEl.textContent = "Last: " + last.sets.map(s => `${s.reps}${ex.unit === "sec" ? "s" : ""} @ ${s.load}`).join(", ");
    }
    const suggestion = suggest(history, ex);
    const exDraft = draft[ex.id] || {};
    el.querySelectorAll("input[data-set]").forEach(inp => {
      const i = Number(inp.dataset.set);
      const field = inp.dataset.field;
      const v = suggestion[i]?.[field];
      if (v !== undefined && v !== "") inp.placeholder = String(v);
      // Restore any in-progress value she typed before navigating away.
      const saved = exDraft[i]?.[field];
      if (saved !== undefined && saved !== "") inp.value = String(saved);
      // Persist on every keystroke so nothing is lost on nav / tab switch / reload.
      inp.addEventListener("input", () => saveDraftField(loc.current.id, ex.id, i, field, inp.value));
    });
  }

  bar.querySelector("#done").onclick = async () => {
    const session = collectSession(cardEls);
    if (!session) return;
    session.supersetId = loc.current.id;
    session.dateISO = isoDay();
    try {
      await saveSession(session);
      clearDraft(loc.current.id);
      // Only advance queue if logging the *current* superset (not nav'd prev/next).
      if (cursorOffset === 0) {
        await setState({ queueIndex: (state.queueIndex + 1) });
      }
      cursorOffset = 0;
      toast("Logged.");
      renderStrength(root, phaseStrip);
    } catch (e) {
      console.error(e);
      toast("Save failed — check connection.");
    }
  };
}

function collectSession(cardEls) {
  const exercises = [];
  for (const { ex, el } of cardEls) {
    const sets = [];
    const rows = ex.sets;
    let anyFilled = false;
    for (let i = 0; i < rows; i++) {
      const repsEl = el.querySelector(`input[data-set="${i}"][data-field="reps"]`);
      const loadEl = el.querySelector(`input[data-set="${i}"][data-field="load"]`);
      const reps = repsEl.value !== "" ? Number(repsEl.value) : (repsEl.placeholder !== "–" ? Number(repsEl.placeholder) : null);
      let load;
      if (ex.progression === "variant") {
        load = loadEl.value !== "" ? loadEl.value : (loadEl.placeholder !== "–" ? loadEl.placeholder : "");
      } else {
        load = loadEl.value !== "" ? Number(loadEl.value) : (loadEl.placeholder !== "–" ? Number(loadEl.placeholder) : 0);
      }
      if (reps !== null) anyFilled = true;
      sets.push({ reps, load });
    }
    if (!anyFilled) {
      toast("Fill in at least one set first.");
      return null;
    }
    exercises.push({ id: ex.id, name: ex.name, sets });
  }
  return { exercises };
}

function renderPhaseStrip(el, loc, program) {
  const phaseIdx = program.phases.indexOf(loc.phase);
  const next = program.phases[phaseIdx + 1];
  el.innerHTML = `
    <div><span class="phase-name">${escapeHtml(loc.phase.name)}</span> · week ${loc.weekInPhase + 1} of ${loc.phase.weeks}</div>
    <div>${next ? "next: " + escapeHtml(next.name) : "final phase"}</div>
  `;
}

// ─── Draft persistence ──────────────────────────────────────────────────────
// In-progress inputs are saved per-superset in localStorage so nothing is lost
// when navigating between supersets, switching tabs, or reloading. Cleared on
// successful log.
const DRAFT_PREFIX = "draft:";
function draftKey(supersetId) { return DRAFT_PREFIX + supersetId; }
function loadDraft(supersetId) {
  try { return JSON.parse(localStorage.getItem(draftKey(supersetId)) || "{}"); }
  catch { return {}; }
}
function saveDraftField(supersetId, exId, setIdx, field, value) {
  const d = loadDraft(supersetId);
  d[exId] ??= {};
  d[exId][setIdx] ??= {};
  if (value === "") delete d[exId][setIdx][field];
  else d[exId][setIdx][field] = value;
  if (Object.keys(d[exId][setIdx]).length === 0) delete d[exId][setIdx];
  if (Object.keys(d[exId]).length === 0) delete d[exId];
  if (Object.keys(d).length === 0) localStorage.removeItem(draftKey(supersetId));
  else localStorage.setItem(draftKey(supersetId), JSON.stringify(d));
}
function clearDraft(supersetId) { localStorage.removeItem(draftKey(supersetId)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
